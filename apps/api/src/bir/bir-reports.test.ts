import { sql } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { importAccounts } from "../books/ledger";
import type { Row } from "../books/zoho";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedDemo } from "../seed";
import { render1702qPdf, render2307Pdf, render2550qPdf, renderWithholdingPdf, roundPesoHalfUp } from "./pdf";

const PASSWORD = "test-password-bir-2";
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

  for (const name of ["fiona", "naresh", "admin", "ryan", "irene", "helen", "marco"]) {
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    expect(res.status).toBe(200);
    cookies[name] = res.headers.get("set-cookie")?.split(";")[0] as string;
  }

  // Resolve seeded users for FK inserts.
  const people = await rows<{ id: number; email: string }>(db, sql`select id::int as id, email from person`);
  const pid = (email: string) => people.find((p) => p.email === email)?.id as number;
  const fionaId = pid("fiona@2mg.test");
  const ryanId = pid("ryan@2mg.test");

  // Save clean TIN/RDO/branch metadata for 2MG & GPI via API.
  const prof2mg = await postJson("fiona", "/api/books/bir/settings/profile", {
    company: "2mg",
    registeredName: "2MG Incorporated",
    tradeName: "2MG Inc.",
    tin: "009-123-456",
    branchCode: "00000",
    rdoCode: "043",
    address: "Unit 501 Medical Plaza, Pasig City, Metro Manila",
    regime: "vat",
    fiscalMonthEnd: 12,
    isTamp: true,
  });
  expect(prof2mg.status).toBe(200);

  const profGpi = await postJson("fiona", "/api/books/bir/settings/profile", {
    company: "gpi",
    registeredName: "Getmeds Philippines Incorporated",
    tradeName: "GetMeds Philippines Inc.",
    tin: "010-987-654",
    branchCode: "00001",
    rdoCode: "044",
    address: "Bonifacio Global City, Taguig",
    regime: "vat",
    fiscalMonthEnd: 12,
    isTamp: true,
  });
  expect(profGpi.status).toBe(200);

  // Seed active book_account so emptyChart check passes cleanly.
  await importAccounts(
    db,
    [
      {
        "Account ID": "bir-acc-1",
        "Account Name": "Cash in Bank - 2MG",
        "Account Code": "",
        Description: "",
        "Account Type": "Bank",
        "Account Status": "Active",
        Currency: "PHP",
        "Parent Account": "",
      } as Row,
    ],
    [],
    true,
  );

  // Seed customers (1 with TIN, 1 without TIN to test .DAT missing-TIN blocker).
  const [custA] = await rows<{ id: number }>(
    db,
    sql`insert into customer (kind, name, tin, address, city, added_by)
        values ('hospital', 'St. Jude Medical Center Inc.', '111-222-333-000', '123 Shaw Blvd', 'Mandaluyong', ${fionaId})
        returning id::int as id`,
  );
  const [custNoTin] = await rows<{ id: number }>(
    db,
    sql`insert into customer (kind, name, tin, address, city, added_by)
        values ('drugstore', 'Mercury Corner Drug', null, '88 Ortigas Ave', 'Pasig', ${fionaId})
        returning id::int as id`,
  );

  // Seed CRM sales_orders & invoices (2MG Q1 + GPI Q1).
  const [so1] = await rows<{ id: number }>(
    db,
    sql`insert into sales_order (customer_id, medrep_id, raised_by, status, payment_terms)
        values (${custA!.id}, ${ryanId}, ${fionaId}, 'completed', 'days') returning id::int as id`,
  );
  const [inv2mg] = await rows<{ id: number }>(
    db,
    sql`insert into invoice (code, order_id, customer_id, invoice_from, terms, issued_on, due_on, total, vatable, vat, exempt, zero_rated, credited, status, by_person)
        values ('INV-2MG-001', ${so1!.id}, ${custA!.id}, '2mg', 'days', '2026-01-15', '2026-02-15', 1120000, 1000000, 120000, 0, 0, 0, 'open', ${fionaId})
        returning id::int as id`,
  );

  const [so2] = await rows<{ id: number }>(
    db,
    sql`insert into sales_order (customer_id, medrep_id, raised_by, status, payment_terms)
        values (${custNoTin!.id}, ${ryanId}, ${fionaId}, 'completed', 'cod') returning id::int as id`,
  );
  await db.execute(
    sql`insert into invoice (code, order_id, customer_id, invoice_from, terms, issued_on, due_on, total, vatable, vat, exempt, zero_rated, credited, status, by_person)
        values ('INV-2MG-002', ${so2!.id}, ${custNoTin!.id}, '2mg', 'cod', '2026-02-10', '2026-02-10', 500000, 0, 0, 500000, 0, 0, 'open', ${fionaId})`,
  );

  const [so3] = await rows<{ id: number }>(
    db,
    sql`insert into sales_order (customer_id, medrep_id, raised_by, status, payment_terms)
        values (${custA!.id}, ${ryanId}, ${fionaId}, 'completed', 'days') returning id::int as id`,
  );
  await db.execute(
    sql`insert into invoice (code, order_id, customer_id, invoice_from, terms, issued_on, due_on, total, vatable, vat, exempt, zero_rated, credited, status, by_person)
        values ('INV-GPI-001', ${so3!.id}, ${custA!.id}, 'gpi', 'days', '2026-01-20', '2026-02-20', 2240000, 2000000, 240000, 0, 0, 0, 'open', ${fionaId})`,
  );

  // Customer withholding payments on 2MG:
  // - WC158 1% EWT (₱100 = 10,000 centavos) -> belongs on 1702Q SAWT
  // - WV010 5% Gov VAT withheld (₱500 = 50,000 centavos) -> belongs ONLY on 2550Q SAWT, never 1702Q!
  await db.execute(sql`
    insert into payment (invoice_id, customer_id, amount, method, reference, paid_on, by_person, tax_atc, sawt_form)
    values
      (${inv2mg!.id}, ${custA!.id}, 10000, 'withholding', '2307-JUDE-01', '2026-01-20', ${fionaId}, 'WC158', '1702Q'),
      (${inv2mg!.id}, ${custA!.id}, 50000, 'withholding', '2306-JUDE-02', '2026-01-25', ${fionaId}, 'WV010', '2550Q')
  `);

  // Seed suppliers: 1 withheld local, 1 unwithheld local (TAMP review), 1 foreign (no TAMP flag).
  const [supPharma] = await rows<{ id: number }>(
    db,
    sql`insert into supplier (name, country, currency) values ('Zuellig Pharma Corp.', 'PH', 'PHP') returning id::int as id`,
  );
  await db.execute(sql`update supplier set tin = '222-333-444-000', billing_address = 'Parañaque City' where id = ${supPharma!.id}`);

  const [supLogistics] = await rows<{ id: number }>(
    db,
    sql`insert into supplier (name, country, currency) values ('FastTrack Courier Inc.', 'PH', 'PHP') returning id::int as id`,
  );
  await db.execute(sql`update supplier set tin = '333-444-555-000' where id = ${supLogistics!.id}`);

  const [supForeign] = await rows<{ id: number }>(
    db,
    sql`insert into supplier (name, country, currency) values ('Roche Pharma Ltd.', 'CH', 'USD') returning id::int as id`,
  );
  await db.execute(sql`update supplier set tin = '000-000-000-000' where id = ${supForeign!.id}`);

  // 2MG bill in Jan (month 1 -> appears in 0619-E M1 & 1601-EQ Q1): ₱11,200 gross (₱10,000 net + ₱1,200 VAT), WC850 (0.5% = ₱50).
  const [billJan] = await rows<{ id: number }>(
    db,
    sql`insert into book_doc (kind, number, doc_date, status, supplier_id, company, currency, fx_rate, total, balance, withheld)
        values ('bill', 'BILL-2MG-01', '2026-01-12', 'open', ${supPharma!.id}, '2mg', 'PHP', 1, 1120000, 1115000, 5000)
        returning id::int as id`,
  );
  await db.execute(sql`
    insert into book_line (doc_id, n, item_name, description, tax_name, tax_pct, tax_amount, amount)
    values (${billJan!.id}, 1, 'Direct Meds', 'Direct pharma batch', 'Vat', 12, 120000, 1000000)
  `);
  await db.execute(sql`
    insert into book_doc_tax_meta (doc_id, supplier_origin, vat_kind, purchase_type, atc_code, ewt_base_centavos, ewt_centavos)
    values (${billJan!.id}, 'local', 'vat', 'other_goods', 'WC850', 1000000, 5000)
  `);

  // 2MG bill in March (month 3 -> month 3 does NOT go on 0619-E, goes on 1601-EQ Q1): ₱5,000 non-VAT WC160 (2% = ₱100).
  const [billMar] = await rows<{ id: number }>(
    db,
    sql`insert into book_doc (kind, number, doc_date, status, supplier_id, company, currency, fx_rate, total, balance, withheld)
        values ('bill', 'BILL-2MG-02', '2026-03-10', 'open', ${supPharma!.id}, '2mg', 'PHP', 1, 500000, 490000, 10000)
        returning id::int as id`,
  );
  await db.execute(sql`
    insert into book_line (doc_id, n, item_name, description, tax_name, tax_pct, tax_amount, amount)
    values (${billMar!.id}, 1, 'Consultancy', 'Advisory service', 'No Tax', 0, 0, 500000)
  `);
  await db.execute(sql`
    insert into book_doc_tax_meta (doc_id, supplier_origin, vat_kind, purchase_type, atc_code, ewt_base_centavos, ewt_centavos)
    values (${billMar!.id}, 'local', 'exempt', 'services', 'WC160', 500000, 10000)
  `);

  // 2MG unwithheld local expense -> should trigger TAMP Audit review on 2mg.
  const [expUnwithheld] = await rows<{ id: number }>(
    db,
    sql`insert into book_doc (kind, number, doc_date, status, supplier_id, company, currency, fx_rate, total, balance, withheld)
        values ('expense', 'EXP-2MG-03', '2026-02-14', 'paid', ${supLogistics!.id}, '2mg', 'PHP', 1, 300000, 0, 0)
        returning id::int as id`,
  );
  await db.execute(sql`
    insert into book_line (doc_id, n, description, tax_name, tax_pct, tax_amount, amount)
    values (${expUnwithheld!.id}, 1, 'Freight delivery', 'No Tax', 0, 0, 300000)
  `);
  await db.execute(sql`
    insert into book_doc_tax_meta (doc_id, supplier_origin, vat_kind, purchase_type, no_withholding_reason)
    values (${expUnwithheld!.id}, 'local', 'exempt', 'services', 'exempt_charge')
  `);

  // Foreign bill on 2MG -> excluded from TAMP review.
  await db.execute(sql`
    insert into book_doc (kind, number, doc_date, status, supplier_id, company, currency, fx_rate, total, balance, withheld)
    values ('bill', 'BILL-2MG-FOR', '2026-02-20', 'open', ${supForeign!.id}, '2mg', 'PHP', 1, 800000, 800000, 0)
  `);

  // GPI bill (must stay completely isolated from 2MG!).
  const [billGpi] = await rows<{ id: number }>(
    db,
    sql`insert into book_doc (kind, number, doc_date, status, supplier_id, company, currency, fx_rate, total, balance, withheld)
        values ('bill', 'BILL-GPI-01', '2026-01-18', 'open', ${supPharma!.id}, 'gpi', 'PHP', 1, 2240000, 2220000, 20000)
        returning id::int as id`,
  );
  await db.execute(sql`
    insert into book_line (doc_id, n, item_name, description, tax_name, tax_pct, tax_amount, amount)
    values (${billGpi!.id}, 1, 'GPI Meds', 'GPI inventory', 'Vat', 12, 240000, 2000000)
  `);
  await db.execute(sql`
    insert into book_doc_tax_meta (doc_id, supplier_origin, vat_kind, purchase_type, atc_code, ewt_base_centavos, ewt_centavos)
    values (${billGpi!.id}, 'local', 'vat', 'other_goods', 'WC158', 2000000, 20000)
  `);

  // Untagged Zoho book_doc (company is null) + legacy PO -> flagged in Readiness diagnostics!
  await db.execute(sql`
    insert into book_doc (kind, number, doc_date, status, company, currency, fx_rate, total, balance)
    values ('bill', 'BILL-UNTAGGED-99', '2026-02-01', 'open', null, 'PHP', 1, 150000, 150000)
  `);
  await db.execute(sql`
    insert into warehouse (code, name) values ('BIR-MAIN', 'Main Warehouse') on conflict (code) do nothing
  `);
  const [wh] = await rows<{ id: number }>(db, sql`select id::int as id from warehouse limit 1`);
  await db.execute(sql`
    insert into purchase (supplier_id, warehouse_id, ordered_on, expected_on, state, currency, fx_rate, goods_total, created_by)
    values (${supPharma!.id}, ${wh!.id}, '2026-02-05', '2026-02-10', 'ordered', 'PHP', 1, 900000, ${fionaId})
  `);

  // Released HR payroll run & payslip for Jan 2026 (2MG vs GPI check for 1601-C).
  await db.execute(sql`
    update employee set tin = '555-666-777' where person_id = ${fionaId}
  `);
  const [run] = await rows<{ id: number }>(
    db,
    sql`insert into pay_run (month, period_from, period_to, pay_day, people, gross, deductions, net, employer, released_by)
        values ('2026-01', '2026-01-01', '2026-01-31', '2026-01-30', 1, 5000000, 500000, 4500000, 200000, ${fionaId})
        returning id::int as id`,
  );
  await db.execute(sql`
    insert into payslip (run_id, month, person_id, company, gross, net, tax, slip)
    values (
      ${run!.id}, '2026-01', ${fionaId}, '2mg', 5000000, 4500000, 250000,
      '{"deductions":[{"key":"sss","amount":120000},{"key":"philhealth","amount":100000},{"key":"pagibig","amount":20000}]}'::jsonb
    )
  `);
});

describe("BIR RBAC and kill-switch", () => {
  it("blocks non-ledger roles and allows ledger roles; respects FINANCE_BIR_ENABLED=false", async () => {
    for (const denied of ["ryan", "irene", "helen", "marco"]) {
      const res = await req(denied, "/api/books/bir/readiness?company=2mg&from=2026-01-01&to=2026-03-31");
      expect(res.status, `role ${denied}`).toBe(403);
    }

    for (const allowed of ["fiona", "naresh", "admin"]) {
      const res = await req(allowed, "/api/books/bir/readiness?company=2mg&from=2026-01-01&to=2026-03-31");
      expect(res.status, `role ${allowed}`).toBe(200);
    }

    const prev = process.env.FINANCE_BIR_ENABLED;
    process.env.FINANCE_BIR_ENABLED = "false";
    try {
      const res = await req("fiona", "/api/books/bir/returns/2550q?company=2mg&year=2026&q=1");
      expect(res.status).toBe(503);
    } finally {
      if (prev === undefined) delete process.env.FINANCE_BIR_ENABLED;
      else process.env.FINANCE_BIR_ENABLED = prev;
    }
  });
});

describe("BIR books, returns, summary lists, SAWT/1702Q split, readiness, and DAT export", () => {
  it("keeps 2mg and gpi isolated across sales, 2550Q, 1702Q SAWT credits, 0619E, 1601EQ, 1604E, 2307, and 1601C", async () => {
    // 2550Q 2MG Q1: Output VAT ₱1,200 (120,000), Input VAT ₱1,200 (120,000), WV010 VAT withheld ₱500 (50,000) -> Net VAT Due -₱500 (overpayment/creditable).
    const r2550 = await req("fiona", "/api/books/bir/returns/2550q?company=2mg&year=2026&q=1");
    expect(r2550.status).toBe(200);
    const v2550 = (await r2550.json()) as {
      totals: {
        outputVatCentavos: number;
        inputVatCentavos: number;
        govVatWithheldCentavos: number;
        netVatPayableCentavos: number;
      };
    };
    expect(v2550.totals.outputVatCentavos).toBe(120_000);
    expect(v2550.totals.inputVatCentavos).toBe(120_000);
    expect(v2550.totals.govVatWithheldCentavos).toBe(50_000);
    expect(v2550.totals.netVatPayableCentavos).toBe(-50_000);

    // 2550Q GPI Q1 is isolated: Output ₱2,400, Input ₱2,400, WV010 ₱0.
    const r2550Gpi = await (await req("fiona", "/api/books/bir/returns/2550q?company=gpi&year=2026&q=1")).json() as {
      totals: {
        outputVatCentavos: number;
        inputVatCentavos: number;
        govVatWithheldCentavos: number;
      };
    };
    expect(r2550Gpi.totals.outputVatCentavos).toBe(240_000);
    expect(r2550Gpi.totals.inputVatCentavos).toBe(240_000);
    expect(r2550Gpi.totals.govVatWithheldCentavos).toBe(0);

    // 1702Q 2MG Q1: Gross ₱15,000 (1,000,000 VATable + 500,000 exempt); SAWT credit ONLY includes WC158 (₱100 = 10,000), NEVER WV010 (50,000).
    const r1702 = await (await req("fiona", "/api/books/bir/returns/1702q?company=2mg&year=2026&q=1")).json() as {
      totals: {
        grossSalesCentavos: number;
        cwtCreditsCentavos: number;
      };
    };
    expect(r1702.totals.grossSalesCentavos).toBe(1_500_000);
    expect(r1702.totals.cwtCreditsCentavos).toBe(10_000);

    // 0619-E M1 (Jan): ₱50 EWT from WC850.
    const r0619 = await (await req("fiona", "/api/books/bir/returns/0619e?company=2mg&year=2026&month=1")).json() as {
      totalCentavos: number;
    };
    expect(r0619.totalCentavos).toBe(5_000);

    // 1601-EQ Q1 2MG: Total EWT ₱150 (WC850 ₱50 in Jan + WC160 ₱100 in Mar), with Month 1 calculated ₱50.
    const r1601eq = await (await req("fiona", "/api/books/bir/returns/1601eq?company=2mg&year=2026&q=1")).json() as {
      totalCentavos: number;
      remitted: { label: string; calculatedWithholdingCentavos: number }[];
      rows: { atc: string; taxCentavos: number }[];
    };
    expect(r1601eq.totalCentavos).toBe(15_000);
    expect(r1601eq.remitted[0]?.calculatedWithholdingCentavos).toBe(5_000);
    expect(r1601eq.rows.map((r) => r.atc)).toEqual(["WC160", "WC850"]);

    // 1604-E 2MG annual total matches ₱150.
    const r1604e = await (await req("fiona", "/api/books/bir/returns/1604e?company=2mg&year=2026")).json() as {
      totals: { taxCentavos: number };
    };
    expect(r1604e.totals.taxCentavos).toBe(15_000);

    // 2307 quarterly vs monthly (Jan only returns WC850 ₱50; Mar only returns WC160 ₱100).
    const sups = await (await req("fiona", "/api/books/bir/2307/suppliers?company=2mg&year=2026&q=1")).json() as {
      suppliers: { id: string; name: string; taxCentavos: number }[];
    };
    expect(sups.suppliers).toHaveLength(1);
    expect(sups.suppliers[0]!.taxCentavos).toBe(15_000);

    const c2307Jan = await (
      await req("fiona", `/api/books/bir/2307?company=2mg&year=2026&q=1&month=1&supplierId=${sups.suppliers[0]!.id}`)
    ).json() as {
      certificate: {
        totals: { taxCentavos: number };
        rows: { atc: string; months: [number, number, number]; baseCentavos: number; taxCentavos: number }[];
      };
    };
    expect(c2307Jan.certificate.totals.taxCentavos).toBe(5_000);
    expect(c2307Jan.certificate.rows).toHaveLength(1);
    expect(c2307Jan.certificate.rows[0]!.atc).toBe("WC850");
    expect(c2307Jan.certificate.rows[0]!.months[0]).toBe(1_000_000);

    // 1601-C reads HR payslips for 2MG vs GPI.
    const c1601c2mg = await (await req("fiona", "/api/books/bir/returns/1601c?company=2mg&year=2026&month=1")).json() as {
      totals: { employees: number; grossCentavos: number; nonTaxableStatCentavos: number; taxableCentavos: number; taxWithheldCentavos: number };
    };
    expect(c1601c2mg.totals).toEqual({
      employees: 1,
      grossCentavos: 5_000_000,
      nonTaxableStatCentavos: 240_000,
      taxableCentavos: 4_760_000,
      taxWithheldCentavos: 250_000,
    });
    const c1601cGpi = await (await req("fiona", "/api/books/bir/returns/1601c?company=gpi&year=2026&month=1")).json() as {
      totals: { employees: number };
    };
    expect(c1601cGpi.totals.employees).toBe(0);
  });

  it("flags TAMP, missing TIN, untagged docs, and legacy purchases in readiness; enforces DAT TIN check and saves filing log", async () => {
    const readiness = await (
      await req("fiona", "/api/books/bir/readiness?company=2mg&from=2026-01-01&to=2026-03-31")
    ).json() as {
      alerts: { key: string; count: number }[];
      untaggedDocs: { number: string }[];
      tampAudit: { suppliers: { name: string }[] };
    };
    const alertByKey = Object.fromEntries(readiness.alerts.map((a) => [a.key, a.count]));
    expect(alertByKey.empty_chart).toBeUndefined();
    expect(alertByKey.untagged_company).toBe(1);
    expect(alertByKey.legacy_purchases).toBe(1);
    expect(alertByKey.missing_customer_tin).toBe(1);
    expect(readiness.untaggedDocs.map((d) => d.number)).toEqual(["BILL-UNTAGGED-99"]);
    expect(readiness.tampAudit.suppliers.map((s) => s.name)).toEqual(["FastTrack Courier Inc."]);

    // SLS .DAT blocked by missing customer TIN -> 400.
    const datBlocked = await req("fiona", "/api/books/bir/dat/sls?company=2mg&year=2026&q=1");
    expect(datBlocked.status).toBe(400);

    // Fix missing customer TIN, then SLS & SLP & QAP & SAWT .DAT export cleanly!
    await db.execute(sql`update customer set tin = '444-555-666-000' where name = 'Mercury Corner Drug'`);
    for (const [list, qs] of [
      ["sls", ""],
      ["slp", ""],
      ["qap", ""],
      ["sawt", "&form=1702Q"],
    ]) {
      const datRes = await req("fiona", `/api/books/bir/dat/${list}?company=2mg&year=2026&q=1${qs}`);
      expect(datRes.status, `dat/${list}`).toBe(200);
      expect(datRes.headers.get("content-type")).toContain("text/plain");
      const text = await datRes.text();
      expect(text.length).toBeGreaterThan(20);
    }

    // Save & read BIR filing log.
    const saved = await postJson("fiona", "/api/books/bir/filing-log", {
      company: "2mg",
      formCode: "1601-EQ",
      periodLabel: "2026-Q1",
      periodFrom: "2026-01-01",
      periodTo: "2026-03-31",
      filedOn: "2026-04-28",
      referenceNo: "EFPS-2026-0001",
      amountDueCentavos: 10_000,
      status: "filed",
      notes: "Q1 EWT filed cleanly",
    });
    expect(saved.status).toBe(200);
    const logs = await (await req("fiona", "/api/books/bir/filing-log?company=2mg")).json() as {
      rows: { formCode: string; status: string }[];
    };
    expect(logs.rows).toHaveLength(1);
    expect(logs.rows[0]).toMatchObject({ formCode: "1601-EQ", status: "filed" });
  });
});

describe("Official BIR PDF draft overlay generators", () => {
  it("rounds pesos half-up accurately and returns valid PDFs across all HTTP PDF endpoints", async () => {
    expect(roundPesoHalfUp(149)).toBe(1);
    expect(roundPesoHalfUp(150)).toBe(2);
    expect(roundPesoHalfUp(-150)).toBe(-2);

    // Month 3 on 0619-E must be refused cleanly.
    const m3Refused = await req("fiona", "/api/books/bir/returns/0619e/pdf?company=2mg&year=2026&month=3");
    expect(m3Refused.status).toBe(400);

    for (const path of [
      "/api/books/bir/returns/2550q/pdf?company=2mg&year=2026&q=1",
      "/api/books/bir/returns/0619e/pdf?company=2mg&year=2026&month=1",
      "/api/books/bir/returns/1601eq/pdf?company=2mg&year=2026&q=1",
      "/api/books/bir/returns/1604e/pdf?company=2mg&year=2026",
      "/api/books/bir/returns/1702q/pdf?company=2mg&year=2026&q=1",
      "/api/books/bir/2307/pdf?company=2mg&year=2026&q=1",
    ]) {
      const res = await req("fiona", path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/pdf");
      const bytes = new Uint8Array(await res.arrayBuffer());
      expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
      const parsed = await PDFDocument.load(bytes);
      expect(parsed.getPageCount()).toBeGreaterThanOrEqual(1);
    }
  });

  it("renders 1702Q for Q1/Q2/Q3 and appends continuation pages when ATC lines overflow 1601-EQ (>6) or 2307 (>10)", async () => {
    const baseTaxpayer = {
      registeredName: "2MG Incorporated",
      tin: "009-123-456",
      branchCode: "00000",
      rdoCode: "043",
      address: "Pasig City",
    };

    for (const q of [1, 2, 3]) {
      const pdfBytes = await render1702qPdf({
        year: 2026,
        quarter: q,
        rateBp: 2500,
        taxpayer: baseTaxpayer,
        totals: {
          grossSalesCentavos: q * 1_500_000,
          costOfSalesCentavos: q * 900_000,
          grossIncomeCentavos: q * 600_000,
          operatingExpensesCentavos: q * 100_000,
          taxableIncomeCentavos: q * 500_000,
          rcitCentavos: q * 125_000,
          mcitCentavos: q * 12_000,
          taxDueCentavos: q * 125_000,
          cwtCreditsCentavos: q * 10_000,
          netPayableCentavos: q * 115_000,
        },
      });
      const parsed = await PDFDocument.load(pdfBytes);
      expect(parsed.getPageCount()).toBeGreaterThanOrEqual(1);
    }

    // 8 ATCs on 1601-EQ (>6 cap) must add 1 Continuation Schedule page.
    const eightRows = Array.from({ length: 8 }, (_, idx) => ({
      atc: `WC15${idx}`,
      nature: `Test EWT Nature #${idx + 1}`,
      rateBp: 100,
      baseCentavos: 100_000,
      taxCentavos: 1_000,
    }));
    const eqOverflow = await renderWithholdingPdf({
      form: "1601EQ",
      year: 2026,
      quarter: 1,
      period: { start: "2026-01-01", end: "2026-03-31", label: "2026-Q1" },
      taxpayer: baseTaxpayer,
      rows: eightRows,
      totalCentavos: 8_000,
    });
    const eqSingle = await renderWithholdingPdf({
      form: "1601EQ",
      year: 2026,
      quarter: 1,
      period: { start: "2026-01-01", end: "2026-03-31", label: "2026-Q1" },
      taxpayer: baseTaxpayer,
      rows: eightRows.slice(0, 2),
      totalCentavos: 2_000,
    });
    const eqOverflowDoc = await PDFDocument.load(eqOverflow);
    const eqSingleDoc = await PDFDocument.load(eqSingle);
    expect(eqOverflowDoc.getPageCount()).toBe(eqSingleDoc.getPageCount() + 1);

    // 12 ATCs on Form 2307 (>10 cap) must append 1 continuation page to the 2-page official template (total 3 pages).
    const twelve2307 = Array.from({ length: 12 }, (_, idx) => ({
      atc: `WC20${idx}`,
      nature: `Vendor line #${idx + 1}`,
      months: [10_000, 20_000, 30_000] as [number, number, number],
      baseCentavos: 60_000,
      taxCentavos: 600,
    }));
    const pdf2307 = await render2307Pdf({
      period: { start: "2026-01-01", end: "2026-03-31" },
      taxpayer: baseTaxpayer,
      certificate: {
        payee: { tin: "222-333-444", branchCode: "00000", name: "Zuellig Pharma Corp.", address: "Parañaque City" },
        rows: twelve2307,
        totals: { baseCentavos: 720_000, taxCentavos: 7_200 },
      },
    });
    const pdf2307Single = await render2307Pdf({
      period: { start: "2026-01-01", end: "2026-03-31" },
      taxpayer: baseTaxpayer,
      certificate: {
        payee: { tin: "222-333-444", branchCode: "00000", name: "Zuellig Pharma Corp.", address: "Parañaque City" },
        rows: twelve2307.slice(0, 2),
        totals: { baseCentavos: 120_000, taxCentavos: 1_200 },
      },
    });
    expect((await PDFDocument.load(pdf2307)).getPageCount()).toBe(
      (await PDFDocument.load(pdf2307Single)).getPageCount() + 1,
    );

    const pdf2550 = await render2550qPdf({
      year: 2026,
      quarter: 1,
      period: { start: "2026-01-01", end: "2026-03-31" },
      taxpayer: baseTaxpayer,
      totals: {
        taxableSalesCentavos: 1_000_000,
        zeroRatedSalesCentavos: 0,
        exemptSalesCentavos: 500_000,
        outputVatCentavos: 120_000,
        vatablePurchasesCentavos: 1_000_000,
        otherPurchasesCentavos: 0,
        inputVatCentavos: 120_000,
        govVatWithheldCentavos: 50_000,
        netVatPayableCentavos: -50_000,
      },
    });
    expect((await PDFDocument.load(pdf2550)).getPageCount()).toBeGreaterThanOrEqual(1);
  });
});
