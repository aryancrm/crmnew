import { sql } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedDemo } from "../seed";
import { spread } from "./doc-tax";

const PASSWORD = "test-password-uat-2a";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};

const req = (who: string, path: string, init?: RequestInit) =>
  app.request(path, {
    ...init,
    headers: {
      cookie: cookies[who] as string,
      ...(init?.headers ?? {}),
    },
  });

const postJson = (who: string, path: string, body: unknown) =>
  req(who, path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  app = createApp(db, { webUrl: "http://localhost:5180" });

  for (const name of ["fiona", "admin", "irene"]) {
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    expect(res.status).toBe(200);
    cookies[name] = res.headers.get("set-cookie")?.split(";")[0] as string;
  }

  const prof = await postJson("fiona", "/api/books/bir/settings/profile", {
    company: "2mg",
    registeredName: "2MG Incorporated",
    tradeName: "2MG Inc.",
    tin: "009-123-456",
    branchCode: "00000",
    rdoCode: "043",
    address: "Pasig City, Metro Manila",
    regime: "vat",
    fiscalMonthEnd: 12,
    isTamp: true,
  });
  expect(prof.status).toBe(200);
});

describe("Step 2A Finance UAT Sprint workflows", () => {
  it("seeds the 2MG Starter Chart of Accounts with active/inactive segregation and tags untagged docs", async () => {
    const first = await postJson("fiona", "/api/books/bir/settings/seed-coa", {});
    expect(first.status).toBe(200);
    const body1 = (await first.json()) as { added: number; totalActive: number; totalInactive: number };
    expect(body1.added).toBeGreaterThanOrEqual(20);
    expect(body1.totalActive).toBeGreaterThanOrEqual(20);
    expect(body1.totalInactive).toBeGreaterThanOrEqual(1);

    // Idempotent second run adds 0 duplicates.
    const second = await postJson("fiona", "/api/books/bir/settings/seed-coa", {});
    expect(second.status).toBe(200);
    const body2 = (await second.json()) as { added: number };
    expect(body2.added).toBe(0);

    // Active vs Inactive views in /api/books/accounts work out of the box.
    const activeList = await (await req("fiona", "/api/books/accounts?view=active")).json();
    const inactiveList = await (await req("fiona", "/api/books/accounts?view=inactive")).json();
    expect(activeList.rows.some((r: { name: string }) => r.name === "Advances to GPI")).toBe(true);
    expect(activeList.rows.some((r: { name: string }) => r.name === "Retention Receivable")).toBe(true);
    expect(inactiveList.rows.some((r: { name: string }) => r.name === "Legacy Clearing (Inactive)")).toBe(true);

    // Explicit untagged doc gets stamped by /api/books/bir/readiness/tag-company.
    await db.execute(
      sql`insert into book_doc (kind, number, doc_date, status, party_name, total, balance, company)
          values ('bill', 'OLD-UNTAGGED-1', '2026-02-10', 'open', 'Old Vendor', 50000, 50000, null)`,
    );
    const tagRes = await postJson("fiona", "/api/books/bir/readiness/tag-company?company=2mg", {});
    expect(tagRes.status).toBe(200);
    expect(((await tagRes.json()) as { tagged: number }).tagged).toBe(1);
  });

  it("captures supplier EWT (WC158), Meralco manual VAT override (WC160), and generates inline Form 2307 PDF on Bills & Expenses", async () => {
    const vRes = await postJson("fiona", "/api/books/vendors", {
      name: "Zuellig Pharma Corp",
      company: "Zuellig Pharma Corporation",
      tin: "000-444-555-00000",
      country: "Philippines",
      billingAddress: "Makati City",
      currency: "PHP",
    });
    expect(vRes.status).toBe(200);
    const vendorId = ((await vRes.json()) as { id: number }).id;

    // 1. Goods bill: ₱100,000 + 12% VAT = ₱112,000, WC158 (1% of ₱100,000 = ₱1,000 EWT -> ₱111,000 AP balance)
    const billRes = await postJson("fiona", "/api/books/bill/new", {
      supplierId: vendorId,
      number: "ZPC-2026-001",
      date: "2026-02-15",
      dueDate: "2026-03-15",
      lines: [{ itemName: "Pharma Cold Chain Supplies", account: "Cost of Goods Sold", qty: 1, rate: 100000, taxPct: 12 }],
      birTax: {
        supplierOrigin: "local",
        vatKind: "vat",
        purchaseType: "other_goods",
        atcCode: "WC158",
      },
    });
    expect(billRes.status).toBe(200);
    const billId = ((await billRes.json()) as { id: number }).id;

    const billDoc = await (await req("fiona", `/api/books/bill/${billId}`)).json();
    expect(billDoc.withheld).toBe(1000_00);
    expect(billDoc.balance).toBe(111000_00);

    // Verify book_entry debits == credits for this bill.
    const billEntries = await rows<{ account: string; debit: number; credit: number }>(
      db,
      sql`select account, debit::float8 as debit, credit::float8 as credit from book_entry where source = 'books' and doc_id = ${billId}`,
    );
    const billDebit = billEntries.reduce((s, e) => s + e.debit, 0);
    const billCredit = billEntries.reduce((s, e) => s + e.credit, 0);
    expect(billDebit).toBe(112000_00);
    expect(billCredit).toBe(112000_00);
    expect(billEntries.find((e) => e.account === "Withholding Tax Payable")?.credit).toBe(1000_00);
    expect(billEntries.find((e) => e.account === "Accounts Payable")?.credit).toBe(111000_00);

    // Verify inline Form 2307 PDF download for this specific billId.
    const pdfRes = await req("fiona", `/api/books/bir/2307/pdf?company=2mg&year=2026&q=1&docId=${billId}`);
    expect(pdfRes.status).toBe(200);
    expect(pdfRes.headers.get("content-type")).toContain("application/pdf");
    const pdfBytes = new Uint8Array(await pdfRes.arrayBuffer());
    const parsedPdf = await PDFDocument.load(pdfBytes);
    expect(parsedPdf.getPageCount()).toBeGreaterThanOrEqual(1);

    // 2. Meralco utility bill: gross ₱10,500.00 entered on 1 line with manual Input VAT override = ₱840.00 & WC160 (2% of ₱9,660 = ₱193.20)
    const meralcoVendor = await postJson("fiona", "/api/books/vendors", {
      name: "Manila Electric Company (Meralco)",
      company: "Manila Electric Company",
      tin: "000-101-528-00000",
      country: "Philippines",
      billingAddress: "Ortigas Center, Pasig City",
      currency: "PHP",
    });
    const meralcoId = ((await meralcoVendor.json()) as { id: number }).id;

    const meralcoBill = await postJson("fiona", "/api/books/bill/new", {
      supplierId: meralcoId,
      number: "MER-2026-02",
      date: "2026-02-20",
      lines: [{ itemName: "Electricity Feb 2026", account: "Utilities Expense", qty: 1, rate: 10500, taxPct: 0 }],
      birTax: {
        supplierOrigin: "local",
        vatKind: "vat",
        manualVatCentavos: 840_00,
        purchaseType: "services",
        atcCode: "WC160",
      },
    });
    expect(meralcoBill.status).toBe(200);
    const meralcoBillId = ((await meralcoBill.json()) as { id: number }).id;

    const mEntries = await rows<{ account: string; debit: number; credit: number }>(
      db,
      sql`select account, debit::float8 as debit, credit::float8 as credit from book_entry where source = 'books' and doc_id = ${meralcoBillId}`,
    );
    expect(mEntries.find((e) => e.account === "Utilities Expense")?.debit).toBe(9660_00);
    expect(mEntries.find((e) => e.account === "Tax Payable")?.debit).toBe(840_00);
    expect(mEntries.find((e) => e.account === "Withholding Tax Payable")?.credit).toBe(193_20);
    expect(mEntries.find((e) => e.account === "Accounts Payable")?.credit).toBe(10306_80);

    // 2b. The same kind of bill typed the usual way, 12% on its lines (two lines this time): the typed
    // VAT still wins in the books (Aryan, 27 Nov). ₱10,000 + ₱1,200 = ₱11,200; typed VAT ₱1,185.42.
    const typed = await postJson("fiona", "/api/books/bill/new", {
      supplierId: meralcoId,
      number: "MER-2026-03",
      date: "2026-03-20",
      lines: [
        { itemName: "Electricity, office", account: "Utilities Expense", qty: 1, rate: 7500, taxPct: 12 },
        { itemName: "Electricity, warehouse", account: "Utilities Expense", qty: 1, rate: 2500, taxPct: 12 },
      ],
      birTax: { supplierOrigin: "local", vatKind: "vat", manualVatCentavos: 1185_42, purchaseType: "services", atcCode: "WC160" },
    });
    expect(typed.status).toBe(200);
    const typedId = ((await typed.json()) as { id: number }).id;
    const tEntries = await rows<{ account: string; debit: number; credit: number }>(
      db,
      sql`select account, sum(debit)::float8 as debit, sum(credit)::float8 as credit from book_entry where source = 'books' and doc_id = ${typedId} group by account`,
    );
    expect(tEntries.find((e) => e.account === "Tax Payable")?.debit).toBe(1185_42);
    expect(tEntries.find((e) => e.account === "Utilities Expense")?.debit).toBe(10014_58);
    // 2% of ₱10,014.58 withheld; the supplier is owed the rest of the ₱11,200.
    expect(tEntries.find((e) => e.account === "Withholding Tax Payable")?.credit).toBe(200_29);
    expect(tEntries.find((e) => e.account === "Accounts Payable")?.credit).toBe(10999_71);
    expect(tEntries.reduce((s, e) => s + e.debit - e.credit, 0)).toBe(0);
    const [typedDoc] = await rows<{ total: number; subTotal: number }>(
      db,
      sql`select total::float8 as total, sub_total::float8 as "subTotal" from book_doc where id = ${typedId}`,
    );
    expect(typedDoc).toEqual({ total: 11200_00, subTotal: 10014_58 });

    // 3. Expense with EWT (WC100 5% Rent on ₱20,000 net + 12% VAT = ₱22,400 gross -> ₱1,000 EWT)
    const lChoices = (await (await req("fiona", "/api/books-ledger-choices")).json()) as {
      taxes: { id: number; pct: number }[];
      options: Record<string, string[]>;
    };
    const vatTaxId = lChoices.taxes.find((t) => t.pct === 12)?.id ?? null;
    const expRes = await postJson("fiona", "/api/books/expense/new", {
      date: "2026-02-22",
      lines: [{ account: "Rent Expense", amount: 20000_00, description: "Warehouse rent", taxId: vatTaxId }],
      taxInclusive: false,
      paidThrough: "Cash in Bank - BDO",
      supplierId: meralcoId,
      reference: "OR-9912",
      costCentre: lChoices.options["Cost Centre"]?.[0] ?? "Head Office",
      type: lChoices.options["Type"]?.[0] ?? "Goods",
      department: lChoices.options["Department"]?.[0] ?? "Finance",
      pic: "Fiona",
      birTax: {
        supplierOrigin: "local",
        vatKind: "vat",
        purchaseType: "services",
        atcCode: "WC100",
      },
    });
    expect(expRes.status).toBe(200);
    const expId = ((await expRes.json()) as { id: number }).id;
    const expEntries = await rows<{ account: string; debit: number; credit: number }>(
      db,
      sql`select account, debit::float8 as debit, credit::float8 as credit from book_entry where source = 'books' and doc_id = ${expId}`,
    );
    expect(expEntries.find((e) => e.account === "Withholding Tax Payable")?.credit).toBe(1000_00);
    expect(expEntries.find((e) => e.account === "Cash in Bank - BDO")?.credit).toBe(21400_00);

    // 3b. An expense with its VAT inside (₱5,600 at 12% = ₱600) and ₱580 typed: the books take ₱580.
    const inside = await postJson("fiona", "/api/books/expense/new", {
      date: "2026-02-23",
      lines: [{ account: "Utilities Expense", amount: 5600_00, description: "Water, partial VAT", taxId: vatTaxId }],
      taxInclusive: true,
      paidThrough: "Cash in Bank - BDO",
      supplierId: meralcoId,
      reference: "OR-9913",
      costCentre: lChoices.options["Cost Centre"]?.[0] ?? "Head Office",
      type: lChoices.options["Type"]?.[0] ?? "Goods",
      department: lChoices.options["Department"]?.[0] ?? "Finance",
      pic: "Fiona",
      birTax: { supplierOrigin: "local", vatKind: "vat", manualVatCentavos: 580_00, purchaseType: "services", noWithholdingReason: "not_covered" },
    });
    expect(inside.status, await inside.clone().text()).toBe(200);
    const insideId = ((await inside.json()) as { id: number }).id;
    const iEntries = await rows<{ account: string; debit: number; credit: number }>(
      db,
      sql`select account, sum(debit)::float8 as debit, sum(credit)::float8 as credit from book_entry where source = 'books' and doc_id = ${insideId} group by account`,
    );
    expect(iEntries.find((e) => e.account === "Tax Payable")?.debit).toBe(580_00);
    expect(iEntries.find((e) => e.account === "Utilities Expense")?.debit).toBe(5020_00);
    expect(iEntries.find((e) => e.account === "Cash in Bank - BDO")?.credit).toBe(5600_00);
  });

  it("spreads a typed VAT over lines so the shares always add up", () => {
    expect(spread(1185_42, [840000, 280000])).toEqual([889_07, 296_35]);
    expect(spread(100, [1, 1, 1])).toEqual([33, 33, 34]);
    expect(spread(5, [0, 0])).toEqual([3, 2]);
  });

  it("handles Ms. Erica's AR payment workflow (ATC auto-routing, 1% retention, late penalty, bank charges, Advances to GPI) and smart bank recon", async () => {
    const people = await rows<{ id: number; email: string }>(db, sql`select id::int as id, email from person`);
    const fionaId = people.find((p) => p.email === "fiona@2mg.test")!.id;
    const ryanId = people.find((p) => p.email === "ryan@2mg.test")!.id;
    const [cust] = await rows<{ id: number }>(
      db,
      sql`insert into customer (kind, name, tin, address, city, added_by)
          values ('hospital', 'St. Lukes Medical Center', '001-222-333-000', 'Taguig City', 'Taguig', ${fionaId})
          returning id::int as id`,
    );

    // Invoice 1: ₱11,200 gross (₱10,000 vatable + ₱1,200 VAT)
    const [ord1] = await rows<{ id: number }>(
      db,
      sql`insert into sales_order (customer_id, medrep_id, raised_by, status, payment_terms)
          values (${cust!.id}, ${ryanId}, ${fionaId}, 'completed', 'days')
          returning id::int as id`,
    );
    const [inv1] = await rows<{ id: number }>(
      db,
      sql`insert into invoice (code, order_id, customer_id, invoice_from, terms, issued_on, due_on, total, vatable, vat, exempt, zero_rated, credited, status, by_person)
          values ('2MG-SI-900101', ${ord1!.id}, ${cust!.id}, '2mg', 'days', '2026-02-10', '2026-03-12', 1120000, 1000000, 120000, 0, 0, 0, 'open', ${fionaId})
          returning id::int as id`,
    );

    // Record payment with WC158 (₱100), 1% gross retention (₱112), late delivery penalty (₱50), bank fee (₱25), and shared slip ID.
    const pay1 = await postJson("fiona", `/api/invoices/${inv1!.id}/payments`, {
      amount: 10938_00,
      method: "bank",
      moneyAccount: "Cash in Bank - BDO",
      reference: "BDO-SLMC-8811",
      paidOn: "2026-02-25",
      withheld: 100_00,
      form2307: "2307-SLMC-01",
      taxAtc: "WC158",
      retention: 112_00,
      retentionRef: "RET-SLMC-01",
      deducted: 50_00,
      deductionKind: "penalty",
      deductionRef: "DM-LATE-01",
      bankCharges: 25_00,
      paymentGroupId: "BDO-BATCH-0225",
    });
    expect(pay1.status).toBe(200);

    const inv1Check = await (await req("fiona", `/api/invoices/${inv1!.id}`)).json();
    expect(inv1Check.invoice.status).toBe("paid");
    expect(inv1Check.invoice.balance).toBe(0);

    // Verify crm_entry ledger postings for Invoice 1's payments!
    const crmEntries = await rows<{ account: string; debit: number; credit: number }>(
      db,
      sql`select account, sum(debit)::float8 as debit, sum(credit)::float8 as credit
          from book_entry where source = 'crm' and kind = 'crm_payment' and number = '2MG-SI-900101'
          group by account`,
    );
    const byAccount = Object.fromEntries(crmEntries.map((e) => [e.account, e]));
    expect(byAccount["Cash in Bank - BDO"]?.debit).toBe(10913_00); // 10,938 - 25 bank fee
    expect(byAccount["Bank Fees and Charges"]?.debit).toBe(25_00);
    expect(byAccount["Advance Tax"]?.debit).toBe(100_00);
    expect(byAccount["Retention Receivable"]?.debit).toBe(112_00);
    expect(byAccount["Discount"]?.debit).toBe(50_00);
    expect(byAccount["Accounts Receivable"]?.credit).toBe(11200_00);

    // Invoice 2: Gov't agency paying into sister-company clearing ('Advances to GPI') with WV010 (5% Gov't VAT -> 2550Q SAWT)
    const [ord2] = await rows<{ id: number }>(
      db,
      sql`insert into sales_order (customer_id, medrep_id, raised_by, status, payment_terms)
          values (${cust!.id}, ${ryanId}, ${fionaId}, 'completed', 'days')
          returning id::int as id`,
    );
    const [inv2] = await rows<{ id: number }>(
      db,
      sql`insert into invoice (code, order_id, customer_id, invoice_from, terms, issued_on, due_on, total, vatable, vat, exempt, zero_rated, credited, status, by_person)
          values ('2MG-SI-900102', ${ord2!.id}, ${cust!.id}, '2mg', 'days', '2026-02-12', '2026-03-14', 2240000, 2000000, 240000, 0, 0, 0, 'open', ${fionaId})
          returning id::int as id`,
    );
    const pay2 = await postJson("fiona", `/api/invoices/${inv2!.id}/payments`, {
      amount: 21400_00,
      method: "bank",
      moneyAccount: "Advances to GPI",
      reference: "GPI-BANK-5521",
      paidOn: "2026-02-26",
      withheld: 1000_00,
      form2307: "2307-GOV-02",
      taxAtc: "WV010",
    });
    expect(pay2.status).toBe(200);

    // Verify SAWT 2550Q has WV010 while SAWT 1702Q has WC158!
    const sawt2550 = await (await req("fiona", "/api/books/bir/lists/sawt?company=2mg&year=2026&q=1&form=2550Q")).json();
    const sawt1702 = await (await req("fiona", "/api/books/bir/lists/sawt?company=2mg&year=2026&q=1&form=1702Q")).json();
    expect(sawt2550.rows.some((r: { atc: string; withheldCentavos: number }) => r.atc === "WV010" && r.withheldCentavos === 1000_00)).toBe(true);
    expect(sawt1702.rows.some((r: { atc: string; withheldCentavos: number }) => r.atc === "WC158" && r.withheldCentavos === 100_00)).toBe(true);

    // Invoice 3: Smart Bank Reconciliation — customer paid ₱4,000 (no bank fee typed at collection), bank statement shows ₱3,975 with tracking ref!
    const [ord3] = await rows<{ id: number }>(
      db,
      sql`insert into sales_order (customer_id, medrep_id, raised_by, status, payment_terms)
          values (${cust!.id}, ${ryanId}, ${fionaId}, 'completed', 'days')
          returning id::int as id`,
    );
    const [inv3] = await rows<{ id: number }>(
      db,
      sql`insert into invoice (code, order_id, customer_id, invoice_from, terms, issued_on, due_on, total, vatable, vat, exempt, zero_rated, credited, status, by_person)
          values ('2MG-SI-900103', ${ord3!.id}, ${cust!.id}, '2mg', 'days', '2026-02-20', '2026-03-22', 400000, 357143, 42857, 0, 0, 0, 'open', ${fionaId})
          returning id::int as id`,
    );
    const pay3 = await postJson("fiona", `/api/invoices/${inv3!.id}/payments`, {
      amount: 4000_00,
      method: "bank",
      moneyAccount: "Cash in Bank - Metrobank",
      reference: "INSTAPAY-774411",
      paidOn: "2026-02-27",
    });
    expect(pay3.status).toBe(200);

    // Import Metrobank CSV statement line with ₱3,975.00 (₱25 deducted by bank) and reference '774411'
    const imp = await postJson("fiona", "/api/books-bank/Cash%20in%20Bank%20-%20Metrobank/import", {
      fileName: "metrobank-feb.csv",
      rows: [{ date: "2026-02-27", description: "INSTAPAY CREDIT", reference: "0000774411", amount: 3975_00 }],
    });
    expect(imp.status).toBe(200);

    const stmt = await (await req("fiona", "/api/books-bank/Cash%20in%20Bank%20-%20Metrobank/statement")).json();
    expect(stmt.lines.length).toBe(1);
    const line = stmt.lines[0];
    expect(line.suggestions.length).toBeGreaterThanOrEqual(1);
    expect(line.suggestions[0].matchReason).toBe("reference");
    expect(line.suggestions[0].feeDiff).toBe(25_00);

    // One-click Match with recordBankCharge: true adjusts payment bank_charges and reconciles to ₱3,975.00!
    const matchRes = await postJson("fiona", `/api/books-bank/line/${line.id}/match`, {
      entryKey: line.suggestions[0].key,
      recordBankCharge: true,
    });
    expect(matchRes.status).toBe(200);

    const stmtAfter = await (await req("fiona", "/api/books-bank/Cash%20in%20Bank%20-%20Metrobank/statement?view=matched")).json();
    expect(stmtAfter.lines.length).toBe(1);
    expect(stmtAfter.booksBalance).toBe(3975_00);
  });

  it("handles amounts above 32-bit int max (₱21.47M) without overflow via bigint money columns", async () => {
    const [cust] = await rows<{ id: number }>(db, sql`select id::int as id from customer limit 1`);
    const [rep] = await rows<{ id: number }>(db, sql`select id::int as id from person where role = 'medrep' limit 1`);
    const [fiona] = await rows<{ id: number }>(db, sql`select id::int as id from person where email = 'fiona@2mg.test'`);
    const fionaId = fiona!.id;
    const ryanId = rep?.id ?? fionaId;

    // ₱30,000,000.00 = 3_000_000_000 centavos (> 2_147_483_647 int32 max)
    const bigTotal = 3_000_000_000;
    const bigVatable = 2_678_571_429;
    const bigVat = 321_428_571;
    const bigCharge = 2_200_000_000; // > int32 max on bank_charges too
    const bigPaid = 3_000_000_000;

    const [ord] = await rows<{ id: number }>(
      db,
      sql`insert into sales_order (customer_id, medrep_id, raised_by, status, payment_terms, total)
          values (${cust!.id}, ${ryanId}, ${fionaId}, 'completed', 'days', ${bigTotal})
          returning id::int as id`,
    );
    const [inv] = await rows<{ id: number }>(
      db,
      sql`insert into invoice (code, order_id, customer_id, invoice_from, terms, issued_on, due_on, total, vatable, vat, exempt, zero_rated, credited, status, by_person)
          values ('2MG-SI-900999', ${ord!.id}, ${cust!.id}, '2mg', 'days', '2026-02-28', '2026-03-30', ${bigTotal}, ${bigVatable}, ${bigVat}, 0, 0, 0, 'open', ${fionaId})
          returning id::int as id`,
    );

    const payRes = await postJson("fiona", `/api/invoices/${inv!.id}/payments`, {
      amount: bigPaid,
      bankCharges: bigCharge,
      method: "bank",
      moneyAccount: "Cash in Bank - Metrobank",
      reference: "BIGINT-30M",
      paidOn: "2026-02-28",
    });
    expect(payRes.status).toBe(200);

    const detail = await (await req("fiona", `/api/invoices/${inv!.id}`)).json();
    expect(detail.invoice.total).toBe(bigTotal);
    expect(detail.invoice.paid).toBe(bigPaid);
    expect(detail.payments[0].amount).toBe(bigPaid);

    const entries = await rows<{ kind: string; account: string; debit: number; credit: number }>(
      db,
      sql`select kind, account, debit::float8 as debit, credit::float8 as credit
          from book_entry where source = 'crm' and (doc_id = ${inv!.id} or (kind = 'crm_payment' and debit = ${bigCharge}))`,
    );
    const invEntries = entries.filter((e) => e.kind === "crm_invoice");
    expect(invEntries.reduce((s, e) => s + e.debit, 0)).toBe(invEntries.reduce((s, e) => s + e.credit, 0));
    expect(invEntries.some((e) => e.debit === bigTotal)).toBe(true);
    expect(entries.some((e) => e.kind === "crm_payment" && e.debit === bigCharge)).toBe(true);
  });
});
