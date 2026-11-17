import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase } from "../db/index";
import { migrate } from "../db/migrate";
import { seedDemo } from "../seed";
import type { BookAccountDetail, BookAccountList, BookDoc, BookList, Banking } from "../types";
import { bankOtherDocs, importAccounts, ledgerDocs, refreshLedger, zohoClock } from "./ledger";
import { type Row, saveDocs } from "./zoho";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
const get = (who: string, path: string) => app.request(path, { headers: { cookie: cookies[who] as string } });

const account = (name: string, type: string, id: string): Row => ({
  "Account ID": id, "Account Name": name, "Account Code": "", Description: "", "Account Type": type, "Account Status": "Active", Currency: "PHP", "Parent Account": "",
});
// Books' backup: an expense's rows (one per line, the expense's own fields on each).
const expense = (line: Partial<Row>): Row => ({
  "Expense Date": "2026-11-03", "Expense Description": "LBC to Davao", "Expense Account": "Courier", "Paid Through": "Petty Cash", Vendor: "LBC Express",
  "Entry Number": "9001", "Currency Code": "PHP", "Exchange Rate": "1.00", "Is Inclusive Tax": "false", "Tax Name": "", "Tax Percentage": "", "Tax Amount": "0",
  "Expense Amount": "100.00", Total: "200.000", "Reference#": "", "Is Billable": "false", "Expense Reference ID": "e1", "Customer Name": "", ...line,
} as Row);
const journal = (line: Partial<Row>): Row => ({
  "Journal Date": "2026-11-04", "Journal ID": "j1", "Journal Number": "MA445", "Journal Number Prefix": "MA", "Journal Number Suffix": "", Status: "Published",
  "Reference Number": "PCV-12", Notes: "Courier, cash advance", "Exchange Rate": "1", Currency: "PHP", Total: "112.00", "Contact Name": "", "Journal Created By": "Aman",
  Account: "", Description: "", Debit: "0", Credit: "0", "Tax Name": "", "Tax Percentage": "", "Tax Amount": "0", ...line,
} as Row);

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["naresh", "ryan", "irene", "fiona"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
  await importAccounts(
    db,
    [
      account("Petty Cash", "Cash", "a1"),
      account("BDO - 2MG 6722", "Bank", "a2"),
      account("Courier", "Expense", "a3"),
      account("Tax Payable", "Other Current Liability", "a4"),
      account("Employee Cash Advance", "Other Current Asset", "a5"),
    ],
    [{ account_id: "a6", account_name: "Old Gateway", account_type: "bank", is_active: false, is_system_account: false }],
    true,
  );
  // Two equal lines stay two lines; a journal line's tax goes to Tax Payable on its side.
  await saveDocs(db, ledgerDocs("Expense.csv", [expense({}), expense({})]), true);
  await saveDocs(db, ledgerDocs("Journal.csv", [
    journal({ Account: "Courier", Debit: "100.00", "Tax Name": "Vat", "Tax Percentage": "12", "Tax Amount": "12.00" }),
    journal({ Account: "Employee Cash Advance", Credit: "112.00" }),
  ]), true);
  await saveDocs(db, ledgerDocs("Transfer_Fund.csv", [
    { "Transaction Date": "2026-11-01", "Transaction Type": "Funds Transfer", "From Account": "BDO - 2MG 6722", "To Account": "Petty Cash", Reference: "", Description: "Cash for the week", "Currency Code": "PHP", "Exchange Rate": "1", Total: "500.00" } as Row,
  ]), true);
  // A customer's payment given back, read from Zoho's bank account (the backup lacks it), and a
  // transfer dated next year (it counts on its day, not today).
  await saveDocs(db, bankOtherDocs([
    { transaction_id: "t1", transaction_type: "payment_refund", date: "2026-11-05", debit_or_credit: "credit", amount: "50.00", account: "Petty Cash", offset_account: "", payee: "Ramon Uy", reference: "", description: "" } as Row,
    { transaction_id: "t2", transaction_type: "interest_income", date: "2026-11-05", debit_or_credit: "debit", amount: "9.00", account: "Petty Cash", offset_account: "Interest Income", payee: "", reference: "", description: "" } as Row,
  ]), true);
  await saveDocs(db, ledgerDocs("Transfer_Fund.csv", [
    { "Transaction Date": "2099-01-10", "Transaction Type": "Funds Transfer", "From Account": "BDO - 2MG 6722", "To Account": "Petty Cash", Reference: "LATER", Description: "Next year's", "Currency Code": "PHP", "Exchange Rate": "1", Total: "1000.00" } as Row,
  ]), true);
  await refreshLedger(db);
});

describe("Zoho Books' own part", () => {
  it("every account's balance is what its documents moved", async () => {
    const response = await get("naresh", "/api/books/accounts?view=all");
    expect(response.status).toBe(200);
    const list = (await response.json()) as BookAccountList;
    const balance = (name: string) => list.rows.find((row) => row.name === name)?.balance;
    // In 500, out 200 of expenses and 50 given back to a customer; next year's 1,000 not yet.
    expect(balance("Petty Cash")).toBe(50000 - 20000 - 5000);
    expect(balance("BDO - 2MG 6722")).toBe(-50000);
    expect(balance("Courier")).toBe(20000 + 10000);
    expect(balance("Tax Payable")).toBe(1200);
    expect(balance("Employee Cash Advance")).toBe(-11200);
    // Zoho's API list adds the accounts the backup lacked, inactive ones too.
    expect(list.rows.find((row) => row.name === "Old Gateway")).toMatchObject({ type: "bank", active: false });
    expect(list.views.find((v) => v.key === "expense")?.count).toBe(1);
  });

  it("an account's page lists what moved on it, document by document", async () => {
    const list = (await (await get("naresh", "/api/books/accounts?view=all")).json()) as BookAccountList;
    const petty = list.rows.find((row) => row.name === "Petty Cash");
    const detail = (await (await get("naresh", `/api/books/accounts/${petty?.id}`)).json()) as BookAccountDetail;
    // Newest first; next year's transfer is listed, it just doesn't count yet.
    expect(detail.entries.map((e) => [e.kind, e.debit, e.credit])).toEqual([
      ["transfer_fund", 100000, 0],
      ["refund", 0, 5000],
      ["expense", 0, 20000],
      ["transfer_fund", 50000, 0],
    ]);
    expect(detail.kinds.map((k) => k.kind).sort()).toEqual(["expense", "refund", "transfer_fund"]);
  });

  it("banking adds up the banks and the cash", async () => {
    const banking = (await (await get("fiona", "/api/books/banking")).json()) as Banking;
    // Interest from the bank list is Deposit.csv's already: only the refund came in.
    expect(banking.totals).toEqual({ bank: -50000, cash: 25000, clearing: 0, card: 0 });
    expect(banking.accounts.map((a) => a.name)).toContain("Old Gateway");
  });

  it("expenses and journals are lists of the books, each with its journal", async () => {
    const expenses = (await (await get("naresh", "/api/books/expense")).json()) as BookList;
    expect(expenses.rows).toHaveLength(1);
    expect(expenses.rows[0]).toMatchObject({ number: "EXP-9001", party: "LBC Express", total: 20000, status: "nonbillable" });
    expect(expenses.rows[0]?.extra).toMatchObject({ account: "Courier", paidThrough: "Petty Cash" });
    const doc = (await (await get("naresh", `/api/books/expense/${expenses.rows[0]?.id}`)).json()) as BookDoc;
    expect(doc.lines).toHaveLength(2);
    const journals = (await (await get("naresh", "/api/books/journal")).json()) as BookList;
    const entry = (await (await get("naresh", `/api/books/journal/${journals.rows[0]?.id}`)).json()) as BookDoc;
    expect(entry.number).toBe("MA445");
    expect(entry.entries?.map((e) => [e.account, e.debit, e.credit])).toEqual([
      ["Courier", 10000, 0],
      ["Tax Payable", 1200, 0],
      ["Employee Cash Advance", 0, 11200],
    ]);
  });

  it("the money lists are for Finance, the CEO and the Admin", async () => {
    expect((await get("ryan", "/api/books/accounts")).status).toBe(403);
    expect((await get("irene", "/api/books/banking")).status).toBe(403);
    expect((await get("irene", "/api/books/expense")).status).toBe(403);
    // Inventory still reads the purchases, without the journal behind them.
    expect((await get("irene", "/api/books/bill")).status).toBe(200);
  });

  it("reads Zoho's clock in Manila time", () => {
    expect(zohoClock("16 Nov 2026 07:56 PM")).toBe("2026-11-16T19:56:00+08:00");
    expect(zohoClock("1 Jan 2026 12:05 AM")).toBe("2026-01-01T00:05:00+08:00");
  });
});
