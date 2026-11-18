// The Zoho Books reports Finance used that were still missing (docs/BOOKS-PLAN.md D, read from Zoho's
// Reports Center on 18 Nov: General Ledger, Account Transactions, Journal Report, AR Aging Summary
// and Details, Customer and Vendor Balance Summary, Expense Details, Expenses by Category and by
// Employee, Payments Received, Payments Made, Credit Note Details, Sales by Customer). Each reads the
// ledger or the documents themselves, Zoho's history and the CRM's own together.

import { type SQL, sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { Refusal } from "../http";
import { todayManila } from "../inventory/rules";
import type { Insight, Role } from "../types";
import { duesSql } from "../finance/dues";

const LEDGER: Role[] = ["finance", "ceo", "admin"];
type Asked = { from?: string | null; to?: string | null; by?: string | null };
type Column = Insight["columns"][number];
const col = (key: string, label: string, kind: Column["kind"] = "text"): Column => ({ key, label, kind });
const isDay = (value?: string | null) => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
function range(asked: Asked) {
  const to = isDay(asked.to) ? (asked.to as string) : todayManila();
  const from = isDay(asked.from) ? (asked.from as string) : `${to.slice(0, 7)}-01`;
  if (from > to) throw new Refusal(400, "invalid", "The first day comes after the last one.", "from");
  return { from, to };
}
const sum = (list: Record<string, unknown>[], key: string) => list.reduce((total, row) => total + (Number(row[key]) || 0), 0);

// ------------------------------------------------------------------ accountant

async function generalLedger(db: Database, asked: Asked): Promise<Insight> {
  const { from, to } = range(asked);
  const found = await rows<{ account: string; type: string | null; opening: number; debit: number; credit: number }>(
    db,
    sql`select e.account, a.type,
        coalesce(sum(e.debit - e.credit) filter (where e.on_date < ${from}::date), 0)::float8 as opening,
        coalesce(sum(e.debit) filter (where e.on_date between ${from}::date and ${to}::date), 0)::float8 as debit,
        coalesce(sum(e.credit) filter (where e.on_date between ${from}::date and ${to}::date), 0)::float8 as credit
      from book_entry e left join book_account a on lower(a.name) = lower(e.account)
      where e.on_date <= ${to}::date and e.account is not null
      group by e.account, a.type order by a.type nulls last, e.account`,
  );
  const table = found
    .map((row) => ({ ...row, type: (row.type ?? "").replace(/_/g, " "), closing: row.opening + row.debit - row.credit }))
    .filter((row) => row.opening || row.debit || row.credit);
  return {
    title: "General Ledger",
    note: `Every account from ${from} to ${to}: what it held before, what moved, what it holds after (debit positive).`,
    columns: [col("account", "Account"), col("type", "Account Type"), col("opening", "Opening", "money"), col("debit", "Debit", "money"), col("credit", "Credit", "money"), col("closing", "Closing", "money")],
    rows: table,
    totals: { account: "Total", debit: sum(table, "debit"), credit: sum(table, "credit") },
  };
}

/** One document's line per row: what each document put on each account, in order. */
async function entryLines(db: Database, asked: Asked, account: string | null): Promise<Insight> {
  const { from, to } = range(asked);
  const found = await rows<{ date: string; kind: string; number: string | null; party: string | null; account: string; debit: number; credit: number }>(
    db,
    sql`select to_char(e.on_date, 'YYYY-MM-DD') as date, replace(e.kind, '_', ' ') as kind, coalesce(d.number, e.number) as number,
        coalesce(d.party_name, d.notes) as party, e.account, e.debit::float8 as debit, e.credit::float8 as credit
      from book_entry e left join book_doc d on e.source = 'books' and d.id = e.doc_id
      where e.on_date between ${from}::date and ${to}::date ${account ? sql`and lower(e.account) = lower(${account})` : sql``}
      order by e.on_date, e.source, e.doc_id, e.debit desc limit 5000`,
  );
  return {
    title: account ? `Account Transactions: ${account}` : "Journal Report",
    note: `${found.length >= 5000 ? "The first 5,000 lines" : "Every line"} from ${from} to ${to}${account ? "" : ": each document's debits and credits, account by account"}.`,
    columns: [col("date", "Date"), col("kind", "Transaction Type"), col("number", "Transaction#"), col("party", "Details"), ...(account ? [] : [col("account", "Account")]), col("debit", "Debit", "money"), col("credit", "Credit", "money")],
    rows: found,
    totals: { date: "Total", debit: sum(found, "debit"), credit: sum(found, "credit") },
  };
}

// ------------------------------------------------------------------ receivables and payables

const BUCKETS = [
  ["current", "Current", -100000, 0],
  ["d15", "1-15 Days", 1, 15],
  ["d30", "16-30 Days", 16, 30],
  ["d45", "31-45 Days", 31, 45],
  ["over", "> 45 Days", 46, 100000],
] as const;

async function arAging(db: Database, asked: Asked, detail: boolean): Promise<Insight> {
  const asOf = isDay(asked.to) ? (asked.to as string) : todayManila();
  if (detail) {
    const found = await rows<Record<string, string | number | null>>(
      db,
      sql`select * from (
          select i.code as number, to_char(i.issued_on, 'YYYY-MM-DD') as date, to_char(i.due_on, 'YYYY-MM-DD') as due, c.name as customer,
            greatest(${asOf}::date - i.due_on, 0) as late, (i.total - i.paid)::float8 as balance, 'CRM' as source
          from invoice i join customer c on c.id = i.customer_id where i.status = 'open' and i.total > i.paid
          union all
          select d.number, to_char(d.doc_date, 'YYYY-MM-DD'), to_char(coalesce(d.due_date, d.doc_date), 'YYYY-MM-DD'), coalesce(c.name, d.party_name),
            greatest(${asOf}::date - coalesce(d.due_date, d.doc_date), 0), round(d.balance * d.fx_rate)::float8, 'Zoho'
          from book_doc d left join customer c on c.id = d.customer_id
          where d.kind = 'invoice' and d.balance > 0 and d.status not in ('void', 'draft') and d.voided_at is null
        ) x order by late desc, balance desc limit 5000`,
    );
    return {
      title: "AR Aging Details",
      note: `Every unpaid invoice on ${asOf}, the latest first.`,
      columns: [col("date", "Date"), col("number", "Invoice#"), col("customer", "Customer Name"), col("due", "Due Date"), col("late", "Age (days)", "number"), col("balance", "Balance Due", "money"), col("source", "Billed In")],
      rows: found,
      totals: { date: "Total", balance: sum(found, "balance") },
    };
  }
  const found = await rows<{ customer: string; late: number; balance: number }>(
    db,
    sql`select c.name as customer, d.late::int as late, d.balance::float8 as balance from ${duesSql(asOf)} d join customer c on c.id = d.customer_id where d.balance > 0`,
  );
  const by = new Map<string, Record<string, string | number>>();
  for (const row of found) {
    const entry = by.get(row.customer) ?? { customer: row.customer, current: 0, d15: 0, d30: 0, d45: 0, over: 0, total: 0 };
    const bucket = BUCKETS.find(([, , low, high]) => row.late >= low && row.late <= high)?.[0] ?? "over";
    entry[bucket] = (Number(entry[bucket]) || 0) + row.balance;
    entry.total = (Number(entry.total) || 0) + row.balance;
    by.set(row.customer, entry);
  }
  const table = [...by.values()].sort((a, b) => Number(b.total) - Number(a.total));
  return {
    title: "AR Aging Summary",
    note: `What each customer owes on ${asOf} by how late it is (the CRM's invoices, Zoho's and Zoho's opening balances).`,
    columns: [col("customer", "Customer Name"), ...BUCKETS.map(([key, label]) => col(key, label, "money")), col("total", "Total", "money")],
    rows: table,
    totals: { customer: "Total", ...Object.fromEntries([...BUCKETS.map(([key]) => key), "total"].map((key) => [key, sum(table, key)])) },
  };
}

async function customerBalances(db: Database, asked: Asked): Promise<Insight> {
  const asOf = isDay(asked.to) ? (asked.to as string) : todayManila();
  const found = await rows<{ customer: string; owed: number; credit: number }>(
    db,
    sql`select c.name as customer, coalesce(o.owed, 0)::float8 as owed, coalesce(k.credit, 0)::float8 as credit
      from customer c
      left join (select customer_id, sum(balance) as owed from ${duesSql(asOf)} d where d.balance > 0 group by customer_id) o on o.customer_id = c.id
      left join (
        select d.customer_id, sum(round(d.balance * d.fx_rate) - coalesce((select sum(p.amount) from payment p where p.active and p.credit_doc_id = d.id), 0)) as credit
        from book_doc d where d.kind in ('credit_note', 'customer_payment') and d.balance > 0 and d.status <> 'void' and d.voided_at is null group by d.customer_id
      ) k on k.customer_id = c.id
      where coalesce(o.owed, 0) <> 0 or coalesce(k.credit, 0) <> 0
      order by coalesce(o.owed, 0) desc limit 5000`,
  );
  const table = found.map((row) => ({ ...row, net: row.owed - row.credit }));
  return {
    title: "Customer Balance Summary",
    note: `What each customer owes and the credit they hold (open credit notes, unused payments) on ${asOf}.`,
    columns: [col("customer", "Customer Name"), col("owed", "Invoice Balance", "money"), col("credit", "Available Credits", "money"), col("net", "Balance", "money")],
    rows: table,
    totals: { customer: "Total", owed: sum(table, "owed"), credit: sum(table, "credit"), net: sum(table, "net") },
  };
}

async function vendorBalances(db: Database): Promise<Insight> {
  const found = await rows<{ vendor: string; billed: number; credit: number }>(
    db,
    sql`select coalesce(s.name, d.party_name) as vendor,
        coalesce(sum(round(d.balance * d.fx_rate)) filter (where d.kind = 'bill'), 0)::float8 as billed,
        coalesce(sum(round(d.balance * d.fx_rate)) filter (where d.kind in ('vendor_credit', 'vendor_payment')), 0)::float8 as credit
      from book_doc d left join supplier s on s.id = d.supplier_id
      where d.kind in ('bill', 'vendor_credit', 'vendor_payment') and d.balance > 0 and d.status not in ('void', 'draft') and d.voided_at is null
      group by 1 order by 2 desc`,
  );
  const table = found.map((row) => ({ ...row, net: row.billed - row.credit }));
  return {
    title: "Vendor Balance Summary",
    note: "What the company owes each vendor on its bills, and the credit it holds with them (vendor credits, unused payments).",
    columns: [col("vendor", "Vendor Name"), col("billed", "Bill Balance", "money"), col("credit", "Available Credits", "money"), col("net", "Balance", "money")],
    rows: table,
    totals: { vendor: "Total", billed: sum(table, "billed"), credit: sum(table, "credit"), net: sum(table, "net") },
  };
}

// ------------------------------------------------------------------ expenses

const EXPENSE_BY: Record<string, { label: string; field: SQL }> = {
  category: { label: "Expense Account", field: sql`l.account` },
  department: { label: "Department", field: sql`coalesce(d.fields->>'CF.Department', '(none)')` },
  pic: { label: "PIC (person in charge)", field: sql`coalesce(upper(trim(d.fields->>'CF.PIC')), '(none)')` },
  "cost-centre": { label: "Cost Centre", field: sql`coalesce(d.fields->>'CF.Cost Centre', '(none)')` },
  "paid-through": { label: "Paid Through", field: sql`coalesce(d.money_account, '(none)')` },
};

async function expenses(db: Database, asked: Asked): Promise<Insight> {
  const { from, to } = range(asked);
  const by = asked.by && asked.by !== "details" ? EXPENSE_BY[asked.by] : null;
  const net = sql`(l.amount - case when d.fields->>'Is Inclusive Tax' = 'true' then coalesce(l.tax_amount, 0) else 0 end)`;
  const live = sql`d.kind = 'expense' and d.status not in ('void', 'draft') and d.voided_at is null and d.doc_date between ${from}::date and ${to}::date`;
  if (by) {
    const found = await rows<{ name: string; count: number; amount: number; tax: number }>(
      db,
      sql`select ${by.field} as name, count(distinct d.id)::int as count, sum(${net})::float8 as amount, sum(coalesce(l.tax_amount, 0))::float8 as tax
        from book_doc d join book_line l on l.doc_id = d.id where ${live} group by 1 order by 3 desc`,
    );
    const table = found.map((row) => ({ ...row, total: row.amount + row.tax }));
    return {
      title: `Expenses by ${by.label}`,
      note: `Expenses from ${from} to ${to}, before tax and with it.`,
      columns: [col("name", by.label), col("count", "Expenses", "number"), col("amount", "Amount", "money"), col("tax", "Tax", "money"), col("total", "Total", "money")],
      rows: table,
      totals: { name: "Total", count: sum(table, "count"), amount: sum(table, "amount"), tax: sum(table, "tax"), total: sum(table, "total") },
    };
  }
  const found = await rows<Record<string, string | number | null>>(
    db,
    sql`select to_char(d.doc_date, 'YYYY-MM-DD') as date, d.number, string_agg(distinct l.account, ', ') as account, d.party_name as vendor, d.money_account as "paidThrough",
        d.fields->>'CF.PIC' as pic, d.fields->>'CF.Department' as department, d.fields->>'CF.Cost Centre' as "costCentre", d.total::float8 as total
      from book_doc d join book_line l on l.doc_id = d.id where ${live}
      group by d.id order by d.doc_date desc, d.id desc limit 5000`,
  );
  return {
    title: "Expense Details",
    note: `Every expense from ${from} to ${to}.`,
    columns: [col("date", "Date"), col("number", "Expense#"), col("account", "Expense Account"), col("vendor", "Vendor"), col("paidThrough", "Paid Through"), col("pic", "PIC"), col("department", "Department"), col("costCentre", "Cost Centre"), col("total", "Amount", "money")],
    rows: found,
    totals: { date: "Total", total: sum(found, "total") },
  };
}

// ------------------------------------------------------------------ money in and out

async function paymentsReceived(db: Database, asked: Asked): Promise<Insight> {
  const { from, to } = range(asked);
  const found = await rows<Record<string, string | number | null>>(
    db,
    sql`select * from (
        select to_char(p.paid_on, 'YYYY-MM-DD') as date, coalesce(p.reference, '') as number, c.name as customer, p.method as mode,
          coalesce(p.money_account, 'Undeposited Funds') as "depositTo", i.code as invoices, p.amount::float8 as amount, 'CRM' as source
        from payment p join invoice i on i.id = p.invoice_id join customer c on c.id = p.customer_id
        where p.active and p.method <> 'credit' and p.paid_on between ${from}::date and ${to}::date
        union all
        select to_char(d.doc_date, 'YYYY-MM-DD'), d.number, coalesce(c.name, d.party_name), coalesce(d.fields->>'Mode', d.fields->>'Payment Mode'),
          coalesce(d.money_account, 'Undeposited Funds'),
          (select string_agg(b.number, ', ') from book_link k join book_doc b on b.id = k.to_doc where k.from_doc = d.id), round(d.total * d.fx_rate)::float8, 'Zoho'
        from book_doc d left join customer c on c.id = d.customer_id
        where d.kind = 'customer_payment' and d.status <> 'void' and d.voided_at is null and d.doc_date between ${from}::date and ${to}::date
      ) x order by date desc limit 5000`,
  );
  return {
    title: "Payments Received",
    note: `Money received from customers from ${from} to ${to} (the CRM's and Zoho's; a customer's credit used is not money in).`,
    columns: [col("date", "Date"), col("number", "Payment#"), col("customer", "Customer Name"), col("mode", "Mode"), col("depositTo", "Deposit To"), col("invoices", "Invoices"), col("amount", "Amount", "money"), col("source", "Recorded In")],
    rows: found,
    totals: { date: "Total", amount: sum(found, "amount") },
  };
}

async function paymentsMade(db: Database, asked: Asked): Promise<Insight> {
  const { from, to } = range(asked);
  const found = await rows<Record<string, string | number | null>>(
    db,
    sql`select to_char(d.doc_date, 'YYYY-MM-DD') as date, d.number, coalesce(s.name, d.party_name) as vendor, d.fields->>'Mode' as mode, d.money_account as "paidThrough",
        (select string_agg(b.number, ', ') from book_link k join book_doc b on b.id = k.to_doc where k.from_doc = d.id) as bills,
        round(d.total * d.fx_rate)::float8 as amount, round(d.balance * d.fx_rate)::float8 as unused
      from book_doc d left join supplier s on s.id = d.supplier_id
      where d.kind = 'vendor_payment' and d.status <> 'void' and d.voided_at is null and d.doc_date between ${from}::date and ${to}::date
      order by d.doc_date desc, d.id desc limit 5000`,
  );
  return {
    title: "Payments Made",
    note: `Money paid to vendors from ${from} to ${to}.`,
    columns: [col("date", "Date"), col("number", "Payment#"), col("vendor", "Vendor Name"), col("mode", "Mode"), col("paidThrough", "Paid Through"), col("bills", "Bills"), col("amount", "Amount", "money"), col("unused", "Unused", "money")],
    rows: found,
    totals: { date: "Total", amount: sum(found, "amount"), unused: sum(found, "unused") },
  };
}

async function creditNotes(db: Database, asked: Asked): Promise<Insight> {
  const { from, to } = range(asked);
  const found = await rows<Record<string, string | number | null>>(
    db,
    sql`select to_char(d.doc_date, 'YYYY-MM-DD') as date, d.number, coalesce(c.name, d.party_name) as customer, d.status, d.fields->>'Reason' as reason,
        round(d.total * d.fx_rate)::float8 as total, round(d.balance * d.fx_rate)::float8 as balance
      from book_doc d left join customer c on c.id = d.customer_id
      where d.kind = 'credit_note' and d.voided_at is null and d.doc_date between ${from}::date and ${to}::date
      order by d.doc_date desc, d.id desc limit 5000`,
  );
  return {
    title: "Credit Note Details",
    note: `Credit notes from ${from} to ${to}: what each credited and what is left of it.`,
    columns: [col("date", "Date"), col("number", "Credit Note#"), col("customer", "Customer Name"), col("status", "Status"), col("reason", "Reason"), col("total", "Amount", "money"), col("balance", "Balance", "money")],
    rows: found,
    totals: { date: "Total", total: sum(found, "total"), balance: sum(found, "balance") },
  };
}

async function salesByCustomer(db: Database, asked: Asked): Promise<Insight> {
  const { from, to } = range(asked);
  const found = await rows<{ customer: string; count: number; amount: number }>(
    db,
    sql`select customer, count(*)::int as count, sum(amount)::float8 as amount from (
        select c.name as customer, i.total::bigint as amount from invoice i join customer c on c.id = i.customer_id
        where i.status <> 'cancelled' and i.issued_on between ${from}::date and ${to}::date
        union all
        select coalesce(c.name, d.party_name), round(d.total * d.fx_rate)::bigint from book_doc d left join customer c on c.id = d.customer_id
        where d.kind = 'invoice' and d.status not in ('void', 'draft') and d.voided_at is null and d.doc_date between ${from}::date and ${to}::date
      ) x group by customer order by 3 desc limit 5000`,
  );
  return {
    title: "Sales by Customer",
    note: `Invoiced from ${from} to ${to} (the CRM's invoices and Zoho's), with tax.`,
    columns: [col("customer", "Customer Name"), col("count", "Invoices", "number"), col("amount", "Sales", "money")],
    rows: found,
    totals: { customer: "Total", count: sum(found, "count"), amount: sum(found, "amount") },
  };
}

export const LEDGER_INSIGHTS: Record<string, { roles: Role[]; run: (db: Database, asked: Asked) => Promise<Insight> }> = {
  "general-ledger": { roles: LEDGER, run: generalLedger },
  "journal-report": { roles: LEDGER, run: (db, asked) => entryLines(db, asked, null) },
  "account-transactions": {
    roles: LEDGER,
    run: (db, asked) => {
      if (!asked.by?.trim()) throw new Refusal(400, "invalid", "Pick the account.", "by");
      return entryLines(db, asked, asked.by.trim());
    },
  },
  "ar-aging": { roles: LEDGER, run: (db, asked) => arAging(db, asked, false) },
  "ar-aging-details": { roles: LEDGER, run: (db, asked) => arAging(db, asked, true) },
  "customer-balances": { roles: LEDGER, run: customerBalances },
  "vendor-balances": { roles: LEDGER, run: (db) => vendorBalances(db) },
  expenses: { roles: LEDGER, run: expenses },
  "payments-received": { roles: LEDGER, run: paymentsReceived },
  "payments-made": { roles: LEDGER, run: paymentsMade },
  "credit-notes": { roles: LEDGER, run: creditNotes },
  "sales-by-customer": { roles: [...LEDGER, "management"], run: salesByCustomer },
};
