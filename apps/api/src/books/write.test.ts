// Writing the books here (docs/BOOKS-PLAN.md A and B): every document made posts balanced debits and
// credits by itself, once; drafts post nothing; a reversal undoes; a refund comes off its credit; a
// lock refuses a closed period; only Finance, the CEO and the Admin write.

import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { customerCredit } from "../finance/credit";
import { addDays } from "../finance/rules";
import { todayManila } from "../inventory/rules";
import { seedDemo } from "../seed";
import type { BankReconcileView, BankStatement, Insight, LedgerChoices } from "../types";
import { dueDays, makeDueRecurring } from "./recurring";

const PASSWORD = "test-password-1";
const BANK = "BDO - 2MG 6722";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
let customer = 0;
const today = todayManila();

const get = (who: string, path: string) => app.request(path, { headers: { cookie: cookies[who] as string } });
const read = async <T>(who: string, path: string) => (await (await get(who, path)).json()) as T;
const post = (who: string, path: string, body: unknown = {}) =>
  app.request(path, { method: "POST", headers: { "content-type": "application/json", cookie: cookies[who] as string }, body: JSON.stringify(body) });
const ok = async <T = { id: number }>(who: string, path: string, body: unknown = {}) => {
  const response = await post(who, path, body);
  expect(response.status, `${who} ${path}: ${await response.clone().text()}`).toBe(200);
  return (await response.json()) as T;
};
const refused = async (who: string, path: string, body: unknown, status: number) => {
  const response = await post(who, path, body);
  expect(response.status, `${who} ${path}: ${await response.clone().text()}`).toBe(status);
  return ((await response.json()) as { error: { message: string; field?: string } }).error;
};
type Entry = { account: string; debit: number; credit: number };
const posted = (id: number) =>
  rows<Entry>(db, sql`select account, debit::int as debit, credit::int as credit from book_entry where doc_id = ${id} and source <> 'crm' order by account`);
const net = (list: Entry[], account: string) => list.filter((one) => one.account === account).reduce((sum, one) => sum + one.debit - one.credit, 0);
const balanced = (list: Entry[]) => expect(list.reduce((sum, one) => sum + one.debit - one.credit, 0)).toBe(0);

const expense = (over: Record<string, unknown> = {}) => ({
  date: today,
  lines: [{ account: "Office Rent", amount: 1_300_000, taxId: null }],
  taxInclusive: true,
  paidThrough: BANK,
  costCentre: "2MG0001",
  type: "Rental",
  department: "Admin",
  pic: "Fiona",
  ...over,
});

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["fiona", "sarla", "naresh"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
  await db.execute(
    sql`insert into book_account (name, type) values (${BANK}, 'bank'), ('Petty Cash', 'cash'), ('Eastwest - 2MG 4173', 'bank'),
      ('Accounts Receivable', 'accounts_receivable'), ('Sales', 'income'), ('Tax Payable', 'other_current_liability'),
      ('Office Rent', 'expense'), ('Courier', 'expense'), ('Interest Income', 'other_income'), ('Accrued Expense', 'other_current_liability'),
      ('Owner''s Equity', 'equity')`,
  );
  customer = ((await ok("sarla", "/api/customers", { kind: "hospital", name: "Books Write Hospital", city: "Pasay", paymentTerms: "days", paymentDays: 30 })) as { id: number }).id;
});

describe("writing the books", () => {
  it("only Finance, the CEO and the Admin write; the forms get Zoho's lists", async () => {
    await refused("sarla", "/api/books/expense/new", expense(), 403);
    const choices = await read<LedgerChoices>("fiona", "/api/books-ledger-choices");
    expect(choices.options["Cost Centre"]).toEqual(["GetMEDS0001", "2MG0001", "Cenevo0001"]);
    expect(choices.taxes.map((tax) => tax.name)).toContain("RENT");
    expect(choices.moneyAccounts.map((one) => one.name)).toContain(BANK);
    expect(choices.moneyAccounts.map((one) => one.name)).not.toContain("Office Rent");
    expect(choices.next.expense).toBe("EXP-1");
  });

  it("an expense with its tax inside posts the account, the tax and the bank, and asks Zoho's fields", async () => {
    const [rent] = await rows<{ id: number }>(db, sql`select id::int as id from book_tax where name = 'RENT'`);
    const { id } = await ok("fiona", "/api/books/expense/new", expense({ lines: [{ account: "Office Rent", amount: 1_300_000, taxId: rent?.id }] }));
    const list = await posted(id);
    balanced(list);
    // ₱13,000 with RENT 5% inside: ₱619.05 tax, ₱12,380.95 rent (Zoho's own figure).
    expect(net(list, "Tax Payable")).toBe(61_905);
    expect(net(list, "Office Rent")).toBe(1_238_095);
    expect(net(list, BANK)).toBe(-1_300_000);
    const missing = await refused("fiona", "/api/books/expense/new", expense({ costCentre: "" }), 400);
    expect(missing.field).toBe("costCentre");
    await refused("fiona", "/api/books/expense/new", expense({ paidThrough: "Office Rent" }), 400);
    // Tax on top: the bank pays the amount and its tax.
    const [vat] = await rows<{ id: number }>(db, sql`select id::int as id from book_tax where name = 'Vat'`);
    const second = await ok("fiona", "/api/books/expense/new", expense({ taxInclusive: false, lines: [{ account: "Courier", amount: 10_000, taxId: vat?.id }] }));
    const onTop = await posted(second.id);
    balanced(onTop);
    expect(net(onTop, "Courier")).toBe(10_000);
    expect(net(onTop, BANK)).toBe(-11_200);
    const [made] = await rows<{ number: string }>(db, sql`select number from book_doc where id = ${second.id}`);
    expect(made?.number).toBe("EXP-2");
  });

  it("a journal balances, a draft posts nothing until published, a reversal undoes it on its day", async () => {
    const body = {
      date: today,
      notes: "Accrued courier",
      department: "Finance",
      company: "2MG",
      publish: false,
      reverseOn: addDays(today, 30),
      lines: [
        { account: "Courier", debit: 50_000, credit: 0 },
        { account: "Accrued Expense", debit: 0, credit: 40_000 },
      ],
    };
    const unequal = await refused("fiona", "/api/books/journal/new", body, 400);
    expect(unequal.message).toContain("must be equal");
    const { id } = await ok("fiona", "/api/books/journal/new", { ...body, lines: [body.lines[0], { ...body.lines[1], credit: 50_000 }] });
    expect(await posted(id)).toEqual([]);
    await ok("fiona", `/api/books/journal/${id}/publish`);
    const list = await posted(id);
    balanced(list);
    expect(net(list, "Courier")).toBe(50_000);
    const [reversal] = await rows<{ id: number; date: string; number: string }>(
      db,
      sql`select id::int as id, to_char(doc_date, 'YYYY-MM-DD') as date, number from book_doc where reversal_of = ${id}`,
    );
    expect(reversal?.date).toBe(addDays(today, 30));
    expect(net(await posted(reversal?.id as number), "Courier")).toBe(-50_000);
    // Voiding the journal takes its reversal too.
    await ok("fiona", `/api/books/journal/${id}/void`, { reason: "Typed twice" });
    expect(await posted(id)).toEqual([]);
    expect(await posted(reversal?.id as number)).toEqual([]);
  });

  it("a transfer and a deposit move money between the right accounts", async () => {
    const move = await ok("fiona", "/api/books/transfer_fund/new", { date: today, from: BANK, to: "Petty Cash", amount: 500_000 });
    const moved = await posted(move.id);
    expect(net(moved, "Petty Cash")).toBe(500_000);
    expect(net(moved, BANK)).toBe(-500_000);
    await refused("fiona", "/api/books/transfer_fund/new", { date: today, from: BANK, to: BANK, amount: 1 }, 400);
    const deposit = await ok("fiona", "/api/books/deposit/new", { date: today, to: BANK, from: "Interest Income", amount: 12_345 });
    const got = await posted(deposit.id);
    expect(net(got, BANK)).toBe(12_345);
    expect(net(got, "Interest Income")).toBe(-12_345);
  });

  it("a credit note takes off receivables, counts as the customer's credit, and is refunded from a bank", async () => {
    const { id } = await ok("fiona", "/api/books/credit_note/new", {
      customerId: customer,
      date: today,
      reason: "Price corrected",
      lines: [{ itemName: "Price difference", account: "Sales", qty: 1, rate: 1000 }],
    });
    const list = await posted(id);
    balanced(list);
    expect(net(list, "Accounts Receivable")).toBe(-100_000);
    expect((await customerCredit(db, customer)).total).toBe(100_000);

    await refused("fiona", `/api/books/credit_note/${id}/refund`, { date: today, amount: 100_001, from: BANK }, 400);
    const refund = await ok("fiona", `/api/books/credit_note/${id}/refund`, { date: today, amount: 40_000, from: BANK, mode: "Bank Transfer" });
    const out = await posted(refund.id);
    expect(net(out, BANK)).toBe(-40_000);
    expect(net(out, "Accounts Receivable")).toBe(40_000);
    expect((await customerCredit(db, customer)).total).toBe(60_000);
    // The credit note can't be voided while a refund stands; voiding the refund gives the money back.
    await refused("fiona", `/api/books/credit_note/${id}/void`, { reason: "x" }, 409);
    await ok("fiona", `/api/books/refund/${refund.id}/void`, { reason: "Bank returned it" });
    expect((await customerCredit(db, customer)).total).toBe(100_000);
  });

  it("a locked period refuses its module's documents, not the others'; unlocking needs a reason", async () => {
    await ok("fiona", "/api/books-locks/purchases", { lockDate: today, reason: "Month closed" });
    const locked = await refused("fiona", "/api/books/expense/new", expense(), 409);
    expect(locked.message).toContain("locked up to");
    await ok("fiona", "/api/books/transfer_fund/new", { date: today, from: BANK, to: "Petty Cash", amount: 100 });
    await refused("fiona", "/api/books-locks/purchases/unlock", { reason: "" }, 400);
    await ok("fiona", "/api/books-locks/purchases/unlock", { reason: "One more receipt" });
    await ok("fiona", "/api/books/expense/new", expense());
    await ok("naresh", "/api/books-locks/all", { lockDate: addDays(today, -1) });
    await refused("fiona", "/api/books/transfer_fund/new", { date: addDays(today, -1), from: BANK, to: "Petty Cash", amount: 100 }, 409);
    await ok("fiona", "/api/books/transfer_fund/new", { date: today, from: BANK, to: "Petty Cash", amount: 100 });
  });

  it("the chart grows; an account with entries keeps its name; an inactive one leaves the forms", async () => {
    const { id } = await ok("fiona", "/api/books/accounts", { name: "Seminars", type: "expense", code: "6100" });
    await refused("fiona", "/api/books/accounts", { name: "seminars", type: "expense" }, 409);
    await ok("fiona", `/api/books/accounts/${id}`, { name: "Seminars and Training" });
    const [rent] = await rows<{ id: number }>(db, sql`select id::int as id from book_account where name = 'Office Rent'`);
    await refused("fiona", `/api/books/accounts/${rent?.id}`, { name: "Rent" }, 409);
    await ok("fiona", `/api/books/accounts/${id}`, { active: false });
    const choices = await read<LedgerChoices>("fiona", "/api/books-ledger-choices");
    expect(choices.accounts.map((one) => one.name)).not.toContain("Seminars and Training");
  });

  it("a recurring expense makes its days only from when it is taken over, each day once", async () => {
    expect(dueDays("2026-01-31", 1, "Months", "2026-04-30")).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    expect(dueDays("2026-01-01", 2, "Weeks", "2026-01-29")).toEqual(["2026-01-01", "2026-01-15", "2026-01-29"]);
    await db.execute(sql`delete from book_lock`);
    const start = addDays(today, -65);
    const [profile] = await rows<{ id: number }>(
      db,
      sql`insert into book_doc (kind, number, doc_date, status, party_name, total, fields)
        values ('recurring_expense', 'UNIT 9 RENT', ${start}::date, 'Active', 'Landlord', 1150000,
          ${JSON.stringify({ "Recurrence Frequency": "Months", "Repeat Every": "1", "Paid Through": BANK, "Is Inclusive Tax": "false", "Expense Account": "Office Rent", "CF.Cost Centre": "GetMEDS0001", "CF.Type": "Rental" })}::jsonb)
        returning id::int as id`,
    );
    const id = profile?.id as number;
    await db.execute(sql`insert into book_line (doc_id, n, account, amount) values (${id}, 1, 'Office Rent', 1150000)`);
    // Not taken over: Zoho still makes them.
    expect(await makeDueRecurring(db, today)).toBe(0);
    const taken = await ok<{ made: number }>("fiona", `/api/books/recurring_expense/${id}/take-over`, { from: addDays(today, -40) });
    const expected = dueDays(start, 1, "Months", today).filter((on) => on >= addDays(today, -40)).length;
    expect(taken.made).toBe(expected);
    expect(await makeDueRecurring(db, today)).toBe(0);
    const made = await rows<{ id: number }>(db, sql`select from_doc::int as id from book_link where to_doc = ${id}`);
    expect(made.length).toBe(expected);
    const list = await posted(made[0]?.id as number);
    balanced(list);
    expect(net(list, "Office Rent")).toBe(1_150_000);
    expect(net(list, BANK)).toBe(-1_150_000);
    await ok("fiona", `/api/books/recurring_expense/${id}/recurring`, { active: false });
    expect(await makeDueRecurring(db, addDays(today, 70))).toBe(0);
  });

  it("a statement imports once, matches what the books hold, categorizes the rest, and reconciles to nil", async () => {
    await db.execute(sql`delete from book_lock`);
    const ACCOUNT = "Eastwest - 2MG 4173";
    const path = `/api/books-bank/${encodeURIComponent(ACCOUNT)}`;
    const day1 = addDays(today, -3);
    // The books already hold a transfer into this bank.
    const transfer = await ok("fiona", "/api/books/transfer_fund/new", { date: day1, from: BANK, to: ACCOUNT, amount: 250_000 });
    const rowsIn = [
      { date: day1, description: "TRANSFER IN", reference: "FT1", amount: 250_000 },
      { date: addDays(today, -2), description: "SERVICE CHARGE", reference: "SC", amount: -5_000 },
      { date: addDays(today, -1), description: "INTEREST", amount: 1_234 },
    ];
    expect(await ok<{ added: number }>("fiona", `${path}/import`, { fileName: "nov.csv", rows: rowsIn })).toEqual({ added: 3, skipped: 0 });
    expect(await ok<{ added: number }>("fiona", `${path}/import`, { fileName: "nov.csv", rows: rowsIn })).toEqual({ added: 0, skipped: 3 });

    let statement = await read<BankStatement>("fiona", `${path}/statement`);
    expect(statement.lines).toHaveLength(3);
    const transferLine = statement.lines.find((line) => line.amount === 250_000);
    expect(transferLine?.suggestions?.[0]?.key).toBe(`books:${transfer.id}`);
    await ok("fiona", `/api/books-bank/line/${transferLine?.id}/match`, { entryKey: `books:${transfer.id}` });
    // Not twice.
    const charge = statement.lines.find((line) => line.amount === -5_000);
    await refused("fiona", `/api/books-bank/line/${charge?.id}/match`, { entryKey: `books:${transfer.id}` }, 400);
    const made = await ok<{ docId: number }>("fiona", `/api/books-bank/line/${charge?.id}/categorize`, {
      as: "expense",
      expense: { account: "Courier", taxInclusive: true, costCentre: "2MG0001", type: "Services", department: "Finance", pic: "Fiona" },
    });
    expect(net(await posted(made.docId), ACCOUNT)).toBe(-5_000);
    const interest = statement.lines.find((line) => line.amount === 1_234);
    await refused("fiona", `/api/books-bank/line/${interest?.id}/categorize`, { as: "expense", expense: { account: "Courier", taxInclusive: true, costCentre: "2MG0001", type: "Services", department: "Finance", pic: "F" } }, 400);
    await ok("fiona", `/api/books-bank/line/${interest?.id}/categorize`, { as: "deposit", from: "Interest Income" });
    statement = await read<BankStatement>("fiona", `${path}/statement?view=all`);
    expect(statement.lines.every((line) => line.status !== "uncategorized")).toBe(true);

    // Reconcile: the ticked entries must bring the opening to the statement's closing.
    const view = await read<BankReconcileView>("fiona", `${path}/reconcile?end=${addDays(today, -1)}`);
    expect(view.opening).toBe(0);
    const keys = view.entries.filter((entry) => entry.onStatement).map((entry) => entry.key);
    expect(keys).toHaveLength(3);
    const wrong = await refused("fiona", `${path}/reconcile`, { end: addDays(today, -1), closing: 250_000, keys }, 400);
    expect(wrong.message).toContain("difference");
    const done = await ok("fiona", `${path}/reconcile`, { end: addDays(today, -1), closing: 250_000 - 5_000 + 1_234, keys });
    // A reconciled document can't be voided; undoing the reconciliation frees it.
    await refused("fiona", `/api/books/transfer_fund/${transfer.id}/void`, { reason: "x" }, 409);
    await ok("fiona", `/api/books-bank/reconciliation/${done.id}/undo`);
    await ok("fiona", `/api/books/transfer_fund/${transfer.id}/void`, { reason: "Wrong account" });
    statement = await read<BankStatement>("fiona", `${path}/statement`);
    expect(statement.lines.map((line) => line.amount)).toEqual([250_000]);
  });

  it("Zoho's missing reports read the books: the ledger balances, expenses add up by every grouping", async () => {
    const q = `from=${addDays(today, -90)}&to=${addDays(today, 60)}`;
    const ledger = await read<Insight>("fiona", `/api/books/insights/general-ledger?${q}`);
    expect(ledger.totals.debit).toBe(ledger.totals.credit);
    expect(ledger.rows.some((row) => row.account === "Office Rent")).toBe(true);
    const journal = await read<Insight>("fiona", `/api/books/insights/journal-report?${q}`);
    expect(journal.totals.debit).toBe(journal.totals.credit);
    const rent = await read<Insight>("fiona", `/api/books/insights/account-transactions?${q}&by=${encodeURIComponent("Office Rent")}`);
    expect(rent.rows.length).toBeGreaterThan(0);
    const details = await read<Insight>("fiona", `/api/books/insights/expenses?${q}`);
    for (const by of ["category", "department", "pic", "cost-centre", "paid-through"]) {
      const grouped = await read<Insight>("fiona", `/api/books/insights/expenses?${q}&by=${by}`);
      expect(grouped.totals.total, by).toBe(details.totals.total);
    }
    for (const key of ["ar-aging", "ar-aging-details", "customer-balances", "vendor-balances", "payments-received", "payments-made", "credit-notes", "sales-by-customer"])
      expect((await get("fiona", `/api/books/insights/${key}?${q}`)).status, key).toBe(200);
    const credits = await read<Insight>("fiona", `/api/books/insights/customer-balances?${q}`);
    expect(credits.rows.find((row) => row.customer === "Books Write Hospital")?.credit).toBe(100_000);
    expect((await get("sarla", `/api/books/insights/general-ledger?${q}`)).status).toBe(403);
  });
});
