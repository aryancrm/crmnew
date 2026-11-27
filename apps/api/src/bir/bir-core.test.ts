import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { buildListDat, buildQapDat, buildSawtDat, buildSlpDat, buildSlsDat, cleanName, foldText, splitAddr } from "./dat";
import { originByName, sawtFormForAtc, withholdingDecision, workOutPayable } from "./ewt";
import { calendarQuarter, monthEnd, monthsOf, quarter } from "./periods";

describe("BIR migration 0167 foundation", () => {
  it("applies cleanly on fresh PGlite, seeds profiles/ATCs/account maps, and backfills book_doc.company", async () => {
    const db = openDatabase({ dir: "memory" });
    await migrate(db);
    // Re-running migrate is a clean no-op.
    expect(await migrate(db)).toEqual([]);

    const profiles = await rows<{ company: string; registeredName: string }>(
      db,
      sql`select company, registered_name as "registeredName" from bir_taxpayer_profile order by company`,
    );
    expect(profiles).toEqual([
      { company: "2mg", registeredName: "2MG Incorporated" },
      { company: "gpi", registeredName: "Getmeds Philippines Incorporated" },
    ]);

    const atcs = await rows<{ code: string; rateBps: number; birForm: string }>(
      db,
      sql`select code, rate_bps as "rateBps", bir_form as "birForm" from bir_atc_rate where code in ('WC850', 'WC140', 'WV010') order by code`,
    );
    expect(atcs).toEqual([
      { code: "WC140", rateBps: 1500, birForm: "1601-EQ" },
      { code: "WC850", rateBps: 50, birForm: "1601-EQ" },
      { code: "WV010", rateBps: 500, birForm: "2550Q" },
    ]);

    const icMaps = await rows<{ company: string; roleKey: string; accountName: string }>(
      db,
      sql`select company, role_key as "roleKey", account_name as "accountName"
          from finance_account_map where role_key like 'ic_%' order by company, role_key`,
    );
    expect(icMaps).toEqual([
      { company: "2mg", roleKey: "ic_due_from", accountName: "Advances to GPI" },
      { company: "2mg", roleKey: "ic_due_to", accountName: "Advances to GPI" },
      { company: "gpi", roleKey: "ic_due_from", accountName: "Advances to 2MG" },
      { company: "gpi", roleKey: "ic_due_to", accountName: "Advances to 2MG" },
    ]);
  });
});

describe("BIR periods", () => {
  it("computes leap-year month ends, fiscal quarters, and calendar quarters", () => {
    expect(monthEnd(2024, 2)).toBe("2024-02-29");
    expect(monthEnd(2026, 2)).toBe("2026-02-28");

    const calQ1 = calendarQuarter(2026, 1);
    expect(calQ1.start).toBe("2026-01-01");
    expect(calQ1.end).toBe("2026-03-31");
    expect(monthsOf(calQ1).map((m) => m.label)).toEqual(["January 2026", "February 2026", "March 2026"]);

    const fiscalQ1 = quarter(2026, 1, 6);
    expect(fiscalQ1.start).toBe("2025-07-01");
    expect(fiscalQ1.end).toBe("2025-09-30");
  });
});

describe("BIR EWT & VAT payable rules (NABHI_FINANCE parity)", () => {
  it("detects foreign suppliers by name and enforces local/foreign withholding decisions", () => {
    expect(originByName("Roche Pharma Ltd.")).toBe("foreign");
    expect(originByName("Zuellig Pharma Corp.")).toBe("local");

    expect(withholdingDecision("foreign", null, null, null, true)).toEqual({
      code: null,
      reason: "foreign",
      note: null,
    });
    expect(() => withholdingDecision("foreign", "WC158", null, null, true)).toThrow(/foreign supplier/i);
    expect(() => withholdingDecision("local", null, null, null, true)).toThrow(/Pick a withholding code/i);
    expect(() => withholdingDecision("local", null, "other", "  ", true)).toThrow(/note/i);
    expect(withholdingDecision("local", null, "government", null, true)).toEqual({
      code: null,
      reason: "government",
      note: null,
    });
    expect(withholdingDecision("local", "wc850", null, null, true)).toEqual({
      code: "WC850",
      reason: null,
      note: null,
    });
  });

  it("computes VAT-inclusive and VAT-exclusive bills with EWT net of VAT", () => {
    // ₱11,200 VAT-inclusive goods (WC158 1%) -> ₱10,000 net + ₱1,200 VAT - ₱100 EWT = ₱11,100 payable
    const inclusive = workOutPayable([{ amountCentavos: 1_120_000, vat: "vat", withholding: "WC158" }], true);
    expect(inclusive.netCentavos).toBe(1_000_000);
    expect(inclusive.vatCentavos).toBe(120_000);
    expect(inclusive.withheldCentavos).toBe(10_000);
    expect(inclusive.payableCentavos).toBe(1_110_000);

    // Non-VAT service ₱5,000 (WC160 2%) + direct pharma goods ₱10,000 excl VAT (WC850 0.5%)
    const mixed = workOutPayable(
      [
        { amountCentavos: 500_000, vat: "none", withholding: "WC160" },
        { amountCentavos: 1_000_000, vat: "vat", withholding: "WC850" },
      ],
      false,
    );
    expect(mixed.netCentavos).toBe(1_500_000);
    expect(mixed.vatCentavos).toBe(120_000);
    expect(mixed.withheldCentavos).toBe(10_000 + 5_000);
    expect(mixed.payableCentavos).toBe(1_605_000);
  });

  it("routes WV* ATCs to 2550Q SAWT and EWT ATCs to 1702Q SAWT", () => {
    expect(sawtFormForAtc("WV010")).toBe("2550Q");
    expect(sawtFormForAtc("WC158")).toBe("1702Q");
    expect(sawtFormForAtc("WC158", "2550Q")).toBe("2550Q");
  });
});

describe("BIR .DAT generators (RELIEF SLS/SLP, QAP, split SAWT)", () => {
  const taxpayer = {
    tin: "123-456-789-000",
    branchCode: "0000",
    registeredName: "2MG INCORPORATED",
    tradeName: "2MG INC.",
    address: "Unit 301 & 305 Vatican Bldg BF Resort Village Las Pinas",
    rdoCode: "053",
    fiscalMonthEnd: 12,
  };

  it("normalizes diacritics, names, and splits 30-char addresses cleanly", () => {
    expect(foldText("Børge Peña")).toBe("Borge Pena");
    expect(cleanName("St. Luke's & Co., Inc.")).toBe("ST LUKES AND CO INC");
    const [a1, a2] = splitAddr("Unit 301 Vatican Bldg BF Resort Village Las Pinas");
    expect(a1.length).toBeLessThanOrEqual(30);
    expect(a2.length).toBeLessThanOrEqual(30);
  });

  it("builds byte-exact RELIEF SLS and SLP DAT files with CRLF endings", () => {
    const sls = buildSlsDat(taxpayer, "2026-03-31", {
      rows: [
        {
          tin: "987-654-321-000",
          name: "St. Jude Hospital & Clinic",
          address: "123 Rizal Ave Manila",
          exemptCentavos: 50_000,
          zeroRatedCentavos: 0,
          taxableCentavos: 100_000,
          outputTaxCentavos: 12_000,
        },
      ],
      totals: { exemptCentavos: 50_000, zeroRatedCentavos: 0, taxableCentavos: 100_000, outputTaxCentavos: 12_000 },
    });
    expect(sls.filename).toBe("123456789S032026.DAT");
    expect(sls.content.endsWith("\r\n")).toBe(true);
    const slsLines = sls.content.trimEnd().split("\r\n");
    expect(slsLines[0]).toContain('H,S,"123456789","2MG INCORPORATED"');
    expect(slsLines[0]).toContain('500.00,0.00,1000.00,120.00,"053",03/31/2026,12');
    expect(slsLines[1]).toContain('D,S,"987654321","ST JUDE HOSPITAL AND CLINIC"');

    const slp = buildSlpDat(taxpayer, "2026-01-31", {
      rows: [
        {
          tin: "111-222-333",
          name: "Pharma Supplier Co.",
          address: "Makati City",
          exemptCentavos: 0,
          zeroRatedCentavos: 0,
          servicesCentavos: 0,
          capitalGoodsCentavos: 0,
          otherGoodsCentavos: 200_000,
          inputTaxCentavos: 24_000,
        },
      ],
      totals: {
        exemptCentavos: 0,
        zeroRatedCentavos: 0,
        servicesCentavos: 0,
        capitalGoodsCentavos: 0,
        otherGoodsCentavos: 200_000,
        inputTaxCentavos: 24_000,
      },
    });
    expect(slp.filename).toBe("123456789P012026.DAT");
    expect(slp.content).toContain("H,P,");
    expect(slp.content).toContain("D,P,");
  });

  it("builds QAP (MM/YYYY) and split SAWT (1702Q & 2550Q) DAT files", () => {
    const qap = buildQapDat(taxpayer, "2026-03-31", {
      rows: [{ tin: "222-333-444", payee: "Broker Corp.", atc: "WC140", rateBp: 1500, baseCentavos: 100_000, taxCentavos: 15_000 }],
      totals: { baseCentavos: 100_000, taxCentavos: 15_000 },
    });
    expect(qap.filename).toBe("12345678900000320261601EQ.DAT");
    expect(qap.content).toContain('H1601EQ,123456789,0000,"2MG INCORPORATED",03/2026,053');
    expect(qap.content).toContain("D1601EQ,1,222333444,0000,");
    expect(qap.content).toContain("C1601EQ,123456789,0000,03/2026,1000.00,150.00");

    const sawt2550 = buildSawtDat(
      taxpayer,
      "2026-03-31",
      {
        rows: [{ tin: "333-444-555", payor: "City Health Office", atc: "WV010", rateBp: 500, incomePaymentCentavos: 100_000, withheldCentavos: 5_000 }],
        totals: { incomePaymentCentavos: 100_000, withheldCentavos: 5_000 },
      },
      "2550Q",
    );
    expect(sawt2550.filename).toBe("12345678900000320262550Q.DAT");
    expect(sawt2550.content).toContain("HSAWT,H2550Q,123456789,0000");
    expect(sawt2550.content).toContain("CSAWT,C2550Q,123456789,0000,03/2026,1000.00,50.00");

    const viaDispatcher = buildListDat(
      "sawt",
      taxpayer,
      "2026-03-31",
      {
        rows: [{ tin: "333-444-555", payor: "Hospital A", atc: "WC158", rateBp: 100, incomePaymentCentavos: 100_000, withheldCentavos: 1_000 }],
        totals: { incomePaymentCentavos: 100_000, withheldCentavos: 1_000 },
      },
      "1702Q",
    );
    expect(viaDispatcher.filename).toBe("12345678900000320261702Q.DAT");
  });
});
