// Zoho Books' own part moved in (docs/PLAN.md 17): the chart of accounts, the documents only
// Books has (expenses, manual journals, money moved between accounts, deposits, credit notes'
// refunds, recurring bills and expenses, fixed assets) and Zoho's activity log. Documents go
// through the same door as Inventory's (docsFromCsv, saveDocs): every field with data is kept.

import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { type BookDocInput, type CsvSpec, docsFromCsv, num, type Row, said, statusKey } from "./zoho";

const filled = (value: string | undefined | null) => {
  const text = said(value);
  return text === "" ? null : text;
};

/** The documents only Zoho Books has, as its backup files them. */
export const LEDGER_SPECS: Record<string, CsvSpec> = {
  "Expense.csv": {
    kind: "expense",
    id: "Expense Reference ID",
    number: "_number",
    reference: "Reference#",
    date: "Expense Date",
    status: "_status",
    party: "Vendor",
    currency: "Currency Code",
    fx: "Exchange Rate",
    total: "Total",
    line: { account: "Expense Account", description: "Expense Description", taxName: "Tax Name", taxPct: "Tax Percentage", taxAmount: "Tax Amount", amount: "Expense Amount" },
  },
  "Journal.csv": {
    kind: "journal",
    id: "Journal ID",
    number: "_number",
    reference: "Reference Number",
    date: "Journal Date",
    status: "Status",
    party: "Contact Name",
    currency: "Currency",
    fx: "Exchange Rate",
    total: "Total",
    notes: "Notes",
    // A line's amount is its debit less its credit (a credit line is below zero).
    line: { account: "Account", description: "Description", taxName: "Tax Name", taxPct: "Tax Percentage", taxAmount: "Tax Amount", amount: "_signed" },
  },
  "Transfer_Fund.csv": {
    kind: "transfer_fund",
    id: "_id",
    number: "_number",
    reference: "Reference",
    date: "Transaction Date",
    status: "_status",
    currency: "Currency Code",
    fx: "Exchange Rate",
    total: "Total",
    notes: "Description",
    line: {},
  },
  "Deposit.csv": {
    kind: "deposit",
    id: "_id",
    number: "_number",
    reference: "Reference",
    date: "Transaction Date",
    status: "_status",
    currency: "Currency Code",
    fx: "Exchange Rate",
    total: "Total",
    notes: "Description",
    line: {},
  },
  "Refund.csv": {
    kind: "refund",
    id: "_id",
    number: "_number",
    reference: "Reference Number",
    date: "Date",
    status: "_status",
    party: "Customer Name",
    total: "Amount",
    notes: "Description",
    line: {},
    linksFromHeader: [{ kind: "credit_note", column: "Credit Note Number" }],
  },
  "Credit_Note.csv": {
    kind: "credit_note",
    id: "CreditNotes ID",
    number: "Credit Note Number",
    reference: "Reference#",
    date: "Credit Note Date",
    status: "Credit Note Status",
    party: "Customer Name",
    partyId: "Customer ID",
    currency: "Currency Code",
    fx: "Exchange Rate",
    subTotal: "SubTotal",
    total: "Total",
    balance: "Balance",
    notes: "Notes",
    line: { item: "Item Name", sku: "SKU", description: "Item Desc", account: "Account", warehouse: "Warehouse Name", unit: "Usage unit", qty: "Quantity", rate: "Item Price", taxName: "Item Tax", taxPct: "Item Tax %", taxAmount: "Item Tax Amount", amount: "Item Total", batch: ["Batch ID", "Batch Reference#", "Manufacturer Batch#", "Manufactured Date", "Expiry Date", "Quantity In"] },
  },
  "Vendor_Credits.csv": {
    kind: "vendor_credit",
    id: "Vendor Credit ID",
    number: "Vendor Credit Number",
    reference: "Reference#",
    date: "Vendor Credit Date",
    status: "Vendor Credit Status",
    party: "Vendor Name",
    partyId: "Vendor ID",
    currency: "Currency Code",
    fx: "Exchange Rate",
    subTotal: "SubTotal",
    total: "Total",
    balance: "Balance",
    notes: "Notes",
    line: { item: "Item Name", sku: "SKU", description: "Item Desc", account: "Account", warehouse: "Warehouse Name", unit: "Usage unit", qty: "Quantity", rate: "Item Price", taxName: "Item Tax", taxPct: "Item Tax %", taxAmount: "Item Tax Amount", amount: "Item Total", batch: ["Batch ID", "Batch Reference#", "Manufacturer Batch#", "Manufactured Date", "Expiry Date", "Quantity Out"] },
  },
  "Recurring_Bill.csv": {
    kind: "recurring_bill",
    id: "Recurring Bill Name",
    number: "Recurring Bill Name",
    date: "Start Date",
    dueDate: "End Date",
    status: "Recurrence Profile Status",
    party: "Vendor Name",
    currency: "Currency Code",
    fx: "Exchange Rate",
    subTotal: "SubTotal",
    total: "Total",
    notes: "Vendor Notes",
    line: { account: "Account", description: "Description", qty: "Quantity", rate: "Rate", taxName: "Tax Name", taxPct: "Tax Percentage", taxAmount: "Tax Amount", amount: "Item Total" },
  },
  "Recurring_Expense.csv": {
    kind: "recurring_expense",
    id: "Recurring Expense Name",
    number: "Recurring Expense Name",
    date: "Start Date",
    dueDate: "End Date",
    status: "Recurrence Status",
    party: "Vendor",
    currency: "Currency Code",
    fx: "Exchange Rate",
    total: "Total",
    line: { account: "Expense Account", description: "Expense Description", taxName: "Tax Name", taxPct: "Tax Percentage", taxAmount: "Tax Amount", amount: "Expense Amount" },
  },
  "Fixed_Asset.csv": {
    kind: "fixed_asset",
    id: "Fixed Asset Number",
    number: "Fixed Asset Number",
    date: "Purchase Date",
    status: "Status",
    total: "Purchase Value",
    balance: "Current Value",
    line: {},
  },
};

/**
 * Fills what a Books file leaves out before it becomes documents: an id for the files that have
 * none (the same row gets the same id on every run), a number Zoho shows, a status, and a manual
 * journal's line amount as its debit less its credit.
 */
export function prepareLedgerRows(file: string, all: Row[], expenseStatus?: Map<string, string>): Row[] {
  const seen = new Map<string, number>();
  return all.map((raw, at) => {
    const row: Row = { ...raw };
    if (file === "Transfer_Fund.csv" || file === "Deposit.csv" || file === "Refund.csv") {
      // Same day, accounts, amount and words twice is two documents: the second gets "#2".
      const key = createHash("sha1")
        .update([file, ...Object.values(raw)].join("\u0001"))
        .digest("hex")
        .slice(0, 20);
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      row._id = `${file.split(".")[0]?.toLowerCase()}-${key}${n > 1 ? `-${n}` : ""}`;
      const prefix = file === "Transfer_Fund.csv" ? "TRF" : file === "Deposit.csv" ? "DEP" : "RFD";
      row._number = filled(raw.Reference) ?? filled(raw["Reference Number"]) ?? `${prefix}-${String(at + 1).padStart(4, "0")}`;
      row._status = "posted";
    }
    if (file === "Expense.csv") {
      row._number = filled(raw["Entry Number"]) ? `EXP-${raw["Entry Number"]}` : (filled(raw["Reference#"]) ?? raw["Expense Reference ID"] ?? "");
      row._status = expenseStatus?.get(said(raw["Expense Reference ID"])) ?? (raw["Is Billable"] === "true" ? "unbilled" : "nonbillable");
    }
    if (file === "Journal.csv") {
      // "Journal Number" is the whole number ("MA445"); its prefix and suffix are its parts.
      row._number = said(raw["Journal Number"]) || said(raw["Journal ID"]);
      row._signed = String((num(raw.Debit) ?? 0) - (num(raw.Credit) ?? 0));
    }
    return row;
  });
}

export function ledgerDocs(file: string, all: Row[], expenseStatus?: Map<string, string>): BookDocInput[] {
  const spec = LEDGER_SPECS[file];
  if (!spec) return [];
  return docsFromCsv(spec, prepareLedgerRows(file, all, expenseStatus));
}

/** The chart of accounts: Books' backup (every account, active or not) and Zoho's API list. */
export async function importAccounts(db: Database, chart: Row[], listed: Record<string, unknown>[], apply: boolean): Promise<{ accounts: number; made: number; parents: number }> {
  const byId = new Map<string, { name: string; code: string | null; type: string; parent: string | null; description: string | null; currency: string; active: boolean; fields: Record<string, unknown> }>();
  for (const row of chart) {
    const id = filled(row["Account ID"]);
    const name = filled(row["Account Name"]);
    if (!id || !name) continue;
    const fields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) if (filled(value) && !["Account ID", "Account Name", "Account Code", "Account Type", "Description", "Account Status", "Currency", "Parent Account"].includes(key)) fields[key] = value;
    byId.set(id, {
      name,
      code: filled(row["Account Code"]),
      type: statusKey(row["Account Type"]),
      parent: filled(row["Parent Account"]),
      description: filled(row.Description),
      currency: filled(row.Currency) ?? "PHP",
      active: said(row["Account Status"]) !== "Inactive",
      fields,
    });
  }
  for (const item of listed) {
    const id = String(item.account_id ?? "");
    const name = String(item.account_name ?? "").trim();
    if (!id || !name) continue;
    const extra = { is_system_account: item.is_system_account, is_user_created: item.is_user_created, placeholder: item.placeholder || undefined };
    const have = byId.get(id);
    if (have) Object.assign(have.fields, extra);
    else
      byId.set(id, {
        name,
        code: String(item.account_code ?? "") || null,
        type: String(item.account_type ?? "other_asset"),
        parent: String(item.parent_account_name ?? "") || null,
        description: null,
        currency: "PHP",
        active: item.is_active !== false,
        fields: extra,
      });
  }
  const [before] = await rows<{ n: number }>(db, sql`select count(*)::int as n from book_account`);
  if (apply) {
    for (const [id, a] of byId)
      await db.execute(
        sql`insert into book_account (zoho_id, name, code, type, description, currency, active, fields)
          values (${id}, ${a.name}, ${a.code}, ${a.type}, ${a.description}, ${a.currency}, ${a.active}, ${JSON.stringify(a.fields)}::jsonb)
          on conflict (zoho_id) do update set name = excluded.name, code = excluded.code, type = excluded.type, description = excluded.description,
            currency = excluded.currency, active = excluded.active, fields = book_account.fields || excluded.fields`,
      );
    for (const [id, a] of byId)
      if (a.parent)
        await db.execute(
          sql`update book_account set parent_id = (select p.id from book_account p where lower(p.name) = lower(${a.parent}) limit 1) where zoho_id = ${id}`,
        );
  }
  const [after] = await rows<{ n: number }>(db, sql`select count(*)::int as n from book_account`);
  return { accounts: byId.size, made: (after?.n ?? 0) - (before?.n ?? 0), parents: [...byId.values()].filter((a) => a.parent).length };
}

/** What Zoho's expense list says that the backup does not: status, who, the report, the receipt. */
export async function expenseExtras(db: Database, listed: Record<string, unknown>[], apply: boolean): Promise<number> {
  const keep = ["status", "user_name", "report_name", "report_number", "report_id", "has_attachment", "expense_receipt_name", "is_personal", "expense_type"];
  const items = listed
    .filter((item) => item.expense_id)
    .map((item) => ({
      id: String(item.expense_id),
      status: statusKey(String(item.status ?? "")),
      fields: Object.fromEntries(keep.filter((key) => item[key] !== undefined && item[key] !== "" && item[key] !== null).map((key) => [key, item[key]])),
      created: item.created_time ?? null,
      modified: item.last_modified_time ?? null,
    }));
  if (!apply || !items.length) return items.length;
  for (let at = 0; at < items.length; at += 2000)
    await db.execute(
      sql`update book_doc d set status = x.status, fields = d.fields || x.fields,
          zoho_created = coalesce(d.zoho_created, x.created::timestamptz), zoho_modified = coalesce(x.modified::timestamptz, d.zoho_modified)
        from jsonb_to_recordset(${JSON.stringify(items.slice(at, at + 2000))}::jsonb) as x(id text, status text, fields jsonb, created text, modified text)
        where d.kind = 'expense' and d.zoho_id = x.id`,
    );
  return items.length;
}

/** Credit notes put on invoices (Creditnotes_Invoice.csv), with the amount and the day. */
export async function creditsApplied(db: Database, all: Row[]): Promise<{ kind: "credit_note"; zohoId: string; links: BookDocInput["links"] }[]> {
  const ids = new Map(
    (await rows<{ number: string; zohoId: string }>(db, sql`select lower(number) as number, zoho_id as "zohoId" from book_doc where kind = 'credit_note' and zoho_id is not null`)).map((row) => [row.number, row.zohoId]),
  );
  const out = new Map<string, { kind: "credit_note"; zohoId: string; links: BookDocInput["links"] }>();
  for (const row of all) {
    const note = filled(row["Credit Note Number"]);
    const invoice = filled(row["Invoice Number"]);
    const zohoId = note ? ids.get(note.toLowerCase()) : undefined;
    if (!zohoId || !invoice) continue;
    const doc = out.get(zohoId) ?? { kind: "credit_note" as const, zohoId, links: [] };
    const amount = Math.round((num(row.Amount) ?? 0) * 100);
    const have = doc.links.find((link) => link.number === invoice);
    if (have) have.amount = (have.amount ?? 0) + amount;
    else doc.links.push({ kind: "invoice", number: invoice, amount, on: filled(row["Applied Invoice Date"]) ?? filled(row.Date) });
    out.set(zohoId, doc);
  }
  return [...out.values()];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "16 Nov 2026 07:56 PM" (Manila time) → ISO. */
export function zohoClock(value: string | undefined | null): string | null {
  const found = said(value).match(/^(\d{1,2}) ([A-Za-z]{3}) (\d{4}) (\d{1,2}):(\d{2}) (AM|PM)$/);
  if (!found) return null;
  const [, d, mon, y, h, m, half] = found;
  const month = MONTHS.indexOf(mon ?? "") + 1;
  if (!month) return null;
  const hour = (Number(h) % 12) + (half === "PM" ? 12 : 0);
  const two = (n: number | string) => String(n).padStart(2, "0");
  return `${y}-${two(month)}-${two(d ?? 1)}T${two(hour)}:${m}:00+08:00`;
}

/** Zoho's activity log (the last weeks Zoho keeps): who did what, on which document. */
export async function importActivity(db: Database, all: Row[], apply: boolean): Promise<{ seen: number; made: number }> {
  const items = all
    .filter((row) => filled(row.activity_id))
    .map((row) => {
      const typed = new Set(["activity_id", "date", "activity_time", "user_name", "role_name", "operation_type", "transaction_type", "transaction_id", "transaction_name", "customer_name", "description"]);
      const fields = Object.fromEntries(Object.entries(row).filter(([key, value]) => !typed.has(key) && filled(value)));
      return {
        id: said(row.activity_id),
        at: zohoClock(row.activity_time) ?? (filled(row.date) ? `${said(row.date)}T00:00:00+08:00` : null),
        user: filled(row.user_name),
        role: filled(row.role_name),
        operation: filled(row.operation_type),
        type: filled(row.transaction_type),
        doc: filled(row.transaction_id),
        name: filled(row.transaction_name),
        customer: filled(row.customer_name),
        description: filled(row.description),
        fields,
      };
    });
  const [before] = await rows<{ n: number }>(db, sql`select count(*)::int as n from book_activity`);
  if (apply)
    for (let at = 0; at < items.length; at += 2000)
      await db.execute(
        sql`insert into book_activity (zoho_id, at, user_name, role_name, operation, transaction_type, transaction_id, transaction_name, customer_name, description, fields)
          select x.id, x.at::timestamptz, x.user, x.role, x.operation, x.type, x.doc, x.name, x.customer, x.description, x.fields
          from jsonb_to_recordset(${JSON.stringify(items.slice(at, at + 2000))}::jsonb)
            as x(id text, at text, "user" text, role text, operation text, type text, doc text, name text, customer text, description text, fields jsonb)
          on conflict (zoho_id) do nothing`,
      );
  const [after] = await rows<{ n: number }>(db, sql`select count(*)::int as n from book_activity`);
  return { seen: items.length, made: (after?.n ?? 0) - (before?.n ?? 0) };
}

/** Writes Zoho's documents' debits and credits down again (book_ledger): after every import. */
export async function refreshLedger(db: Database): Promise<number> {
  const [done] = await rows<{ n: number }>(db, sql`select refresh_book_ledger() as n`);
  return done?.n ?? 0;
}

/**
 * Bank transactions Books' backup leaves out, read from Zoho's bank accounts: a customer's payment
 * given back (a refund out of the account; Zoho's "payment refund"). Row: Zoho's transaction id, type, date, debit or credit, amount in
 * pesos, the bank account, the other account, the payee, the reference and the description.
 */
export function bankOtherDocs(all: Row[]): BookDocInput[] {
  const out: BookDocInput[] = [];
  for (const row of all) {
    const id = filled(row.transaction_id);
    const type = said(row.transaction_type);
    const amount = Math.round((num(row.amount) ?? 0) * 100);
    if (!id || !amount) continue;
    // Only a customer's payment given back is missing from the backup: interest and other income
    // are its Deposit.csv already, and a card's bills its bills.
    if (type !== "payment_refund") continue;
    const fields: Record<string, unknown> = {
      "Transaction Type": "Payment Refund",
      "Refund From Account": row.account,
      ...(filled(row.description) ? { Description: row.description } : {}),
      source: "Zoho's bank account (not in the backup)",
    };
    out.push({
      kind: "refund",
      zohoId: id,
      number: filled(row.reference) ?? `RFD-${id.slice(-6)}`,
      reference: filled(row.reference),
      date: said(row.date),
      dueDate: null,
      status: "posted",
      party: filled(row.payee),
      partyZohoId: null,
      currency: "PHP",
      fxRate: 1,
      subTotal: null,
      total: amount,
      balance: 0,
      paymentTerms: null,
      notes: filled(row.description),
      zohoCreated: null,
      zohoModified: null,
      fields,
      lines: [],
      links: [],
    });
  }
  return out;
}

/**
 * Zoho's opening balances (Settings → Opening Balances, read from Zoho's API; not in the backup) as
 * one journal on the day the books opened. Zoho balances them on Opening Balance Adjustments, so
 * that line takes whatever the others leave.
 */
export function openingJournal(opening: { date: string; accounts: { account_name: string; debit_or_credit: string; bcy_amount: number }[] }): BookDocInput {
  const lines = opening.accounts
    .filter((a) => a.account_name !== "Opening Balance Adjustments")
    .map((a) => ({ account: a.account_name, amount: Math.round(a.bcy_amount * 100) * (a.debit_or_credit === "debit" ? 1 : -1) }));
  const rest = -lines.reduce((sum, line) => sum + line.amount, 0);
  if (rest) lines.push({ account: "Opening Balance Adjustments", amount: rest });
  const total = lines.reduce((sum, line) => sum + Math.max(line.amount, 0), 0);
  return {
    kind: "journal",
    zohoId: "opening-balance",
    number: "Opening Balance",
    reference: null,
    date: opening.date,
    dueDate: null,
    status: "published",
    party: null,
    partyZohoId: null,
    currency: "PHP",
    fxRate: 1,
    subTotal: null,
    total,
    balance: 0,
    paymentTerms: null,
    notes: "Zoho's opening balances",
    zohoCreated: null,
    zohoModified: null,
    fields: { "Journal Type": "Opening balance", source: "Zoho's opening balances (not in the backup)" },
    lines: lines.map((line) => ({
      itemName: null, sku: null, description: null, account: line.account, warehouse: null, unit: null, qty: null, rate: null,
      taxName: null, taxPct: null, taxAmount: null, amount: line.amount, qtyDone: {}, batches: [], fields: {},
    })),
    links: [],
  };
}
