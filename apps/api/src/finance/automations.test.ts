import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedDemo } from "../seed";

const PASSWORD = "test-password-auto-28";
let db: Database;
let app: ReturnType<typeof createApp>;
let fionaCookie = "";

const req = (path: string, init?: RequestInit) =>
  app.request(path, {
    ...init,
    headers: {
      cookie: fionaCookie,
      ...(init?.headers ?? {}),
    },
  });

const postJson = (path: string, body: unknown) =>
  req(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  app = createApp(db, { webUrl: "http://localhost:5180" });

  const res = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "fiona@2mg.test", password: PASSWORD }),
  });
  expect(res.status).toBe(200);
  fionaCookie = res.headers.get("set-cookie")?.split(";")[0] as string;

  await postJson("/api/books/bir/settings/seed-coa", {});
});

describe("Phase 2 Finance automations", () => {
  it("pays approved MedRep field_expense claims into Books Expenses in 1 click and blocks double-pay", async () => {
    const [rep] = await rows<{ id: number }>(db, sql`select id::int as id from person where role = 'medrep' limit 1`);
    const [fiona] = await rows<{ id: number }>(db, sql`select id::int as id from person where email = 'fiona@2mg.test'`);
    const [exp] = await rows<{ id: number }>(
      db,
      sql`insert into field_expense (person_id, day, kind, head, amount, approved_amount, status, decided_by, decided_at, note)
          values (${rep!.id}, '2026-02-18', 'petrol', 'er_fuel', 850_00, 800_00, 'approved', ${fiona!.id}, now(), 'Makati hospital visits')
          returning id::int as id`,
    );

    const listRes = await (await req("/api/finance/reimbursements?view=open")).json();
    expect(listRes.rows.some((r: { id: number; amount: number }) => r.id === exp!.id && r.amount === 800_00)).toBe(true);

    const payRes = await postJson("/api/finance/reimbursements/pay", {
      ids: [exp!.id],
      paidThrough: listRes.paidThroughAccounts[0],
      accountName: listRes.defaultExpenseAccount,
      paidOn: "2026-02-20",
      reference: "INSTAPAY-REIMB-1",
    });
    expect(payRes.status).toBe(200);
    const paidBody = (await payRes.json()) as { docId: number; count: number; total: number };
    expect(paidBody.count).toBe(1);
    expect(paidBody.total).toBe(800_00);

    // Double-pay is blocked cleanly
    const again = await postJson("/api/finance/reimbursements/pay", {
      ids: [exp!.id],
      paidThrough: listRes.paidThroughAccounts[0],
      accountName: listRes.defaultExpenseAccount,
    });
    expect(again.status).toBe(409);

    // Posted cleanly to book_entry
    const entries = await rows<{ debit: number; credit: number }>(
      db,
      sql`select debit::float8 as debit, credit::float8 as credit from book_entry where source = 'books' and doc_id = ${paidBody.docId}`,
    );
    expect(entries.reduce((s, e) => s + e.debit, 0)).toBe(800_00);
    expect(entries.reduce((s, e) => s + e.credit, 0)).toBe(800_00);
  });

  it("posts a released HR pay_run into a balanced Books journal", async () => {
    const [fiona] = await rows<{ id: number }>(db, sql`select id::int as id from person where email = 'fiona@2mg.test'`);
    const [run] = await rows<{ id: number }>(
      db,
      sql`insert into pay_run (month, period_from, period_to, pay_day, people, gross, deductions, net, employer, released_by, released_at)
          values ('2026-02', '2026-02-01', '2026-02-28', '2026-02-28', 1, 30000_00, 3200_00, 26800_00, 2700_00, ${fiona!.id}, '2026-02-28T09:00:00Z')
          returning id::int as id`,
    );
    const slip = {
      month: "2026-02",
      person: { id: fiona!.id, name: "Fiona", employeeCode: "2MG-001", company: "2mg", position: "Finance", department: "Finance" },
      monthlySalary: 30000_00,
      monthlyAllowance: 0,
      dailyRate: 1363_64,
      hourlyRate: 170_45,
      attendance: { workDays: 22, present: 22, late: 0, undertime: 0, overtime: 0, leave: 0, absent: 0 },
      earnings: [{ key: "basic", label: "Basic Pay", amount: 30000_00 }],
      less: [],
      gross: 30000_00,
      sssBase: 30000_00,
      taxable: 28000_00,
      deductions: [
        { key: "sss", label: "SSS", amount: 1000_00 },
        { key: "philhealth", label: "PhilHealth", amount: 500_00 },
        { key: "pagibig", label: "Pag-IBIG", amount: 200_00 },
        { key: "tax", label: "Withholding Tax", amount: 1500_00 },
      ],
      totalDeductions: 3200_00,
      net: 26800_00,
      employer: { sss: 2000_00, philhealth: 500_00, pagibig: 200_00, total: 2700_00 },
      paidThrough: null,
    };
    await db.execute(
      sql`insert into payslip (run_id, month, person_id, company, gross, net, tax, slip)
          values (${run!.id}, '2026-02', ${fiona!.id}, '2mg', 30000_00, 26800_00, 1500_00, ${JSON.stringify(slip)}::jsonb)`,
    );

    const listRes = await (await req("/api/finance/payroll-gl")).json();
    expect(listRes.runs[0].month).toBe("2026-02");
    const acct = listRes.accounts[0];

    const postRes = await postJson("/api/finance/payroll-gl/2026-02/post", {
      expenseAccount: acct,
      payableAccount: acct,
      taxAccount: acct,
      contribAccount: acct,
      date: "2026-02-28",
    });
    expect(postRes.status).toBe(200);
    const { docId } = (await postRes.json()) as { docId: number };

    const entries = await rows<{ debit: number; credit: number }>(
      db,
      sql`select debit::float8 as debit, credit::float8 as credit from book_entry where source = 'books' and doc_id = ${docId}`,
    );
    expect(entries.reduce((s, e) => s + e.debit, 0)).toBe(32700_00);
    expect(entries.reduce((s, e) => s + e.credit, 0)).toBe(32700_00);
  });

  it("creates bank rules and flags matching uncategorized statement lines", async () => {
    const accountsRes = await (await req("/api/books/accounts?view=active")).json();
    const expAccount = accountsRes.rows.find((r: { type: string }) => r.type === "expense")?.name ?? accountsRes.rows[0].name;

    const ruleRes = await postJson("/api/books-bank/rules", {
      name: "InstaPay Fee Rule",
      pattern: "INSTAPAY FEE",
      direction: "out",
      accountName: expAccount,
    });
    expect(ruleRes.status).toBe(200);

    await postJson("/api/books-bank/Cash%20in%20Bank%20-%20Metrobank/import", {
      fileName: "metro-rules.csv",
      rows: [{ date: "2026-02-27", description: "DEBIT INSTAPAY FEE CHARGE", reference: "FEE-01", amount: -25_00 }],
    });

    const stmt = await (await req("/api/books-bank/Cash%20in%20Bank%20-%20Metrobank/statement")).json();
    const line = stmt.lines.find((l: { reference: string }) => l.reference === "FEE-01");
    expect(line?.ruleMatch?.accountName).toBe(expAccount);
  });
});
