// The statements (docs/ERP-PLAN.md phase 1): trial balance, profit and loss, balance sheet, cash
// flow, VAT, what we owe suppliers by age, gross profit by medicine, channel, customer or order,
// and the company's days of sales owed. Every figure is read from the same debits and credits the
// chart shows (book_entry: Zoho's documents, the books' forms and this CRM's own work, migration
// 0096), so a statement always agrees with the accounts behind it.

import { type SQL, sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { allow, Refusal } from "../http";
import { todayManila } from "../inventory/rules";
import type {
  BalanceSheet,
  CashFlow,
  GrossProfit,
  GrossProfitBy,
  Me,
  MoneySummary,
  PayablesAging,
  ProfitAndLoss,
  StatementLine,
  TrialBalance,
  VatSummary,
} from "../types";
import { ACCOUNT_HEADS, MONEY_TYPES, mayReadLedger } from "./accounts";

const isDay = (value?: string | null) => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));

/** The days asked for: this month so far unless picked. */
function period(asked: { from?: string | null; to?: string | null }): { from: string; to: string } {
  const to = isDay(asked.to) ? (asked.to as string) : todayManila();
  const from = isDay(asked.from) ? (asked.from as string) : `${to.slice(0, 7)}-01`;
  if (from > to) throw new Refusal(400, "invalid", "The first day comes after the last one.", "from");
  return { from, to };
}
const asOfDay = (asOf?: string | null) => (isDay(asOf) ? (asOf as string) : todayManila());

export const headOf = (type: string | null): string =>
  type ? (Object.entries(ACCOUNT_HEADS).find(([, types]) => types.includes(type))?.[0] ?? "asset") : "unknown";

type Moved = { account: string; accountId: number | null; type: string | null; debit: number; credit: number };

/** Each account's debits and credits on the days given. */
async function moved(db: Database, days: SQL): Promise<Moved[]> {
  return rows<Moved>(
    db,
    sql`select coalesce(a.name, e.account) as account, a.id::int as "accountId", a.type,
        sum(e.debit)::float8 as debit, sum(e.credit)::float8 as credit
      from book_entry e left join book_account a on lower(a.name) = lower(e.account)
      where e.account is not null and ${days}
      group by 1, 2, 3 having sum(e.debit) <> 0 or sum(e.credit) <> 0
      order by 3 nulls last, 1`,
  );
}

const line = (row: Moved, amount: number): StatementLine => ({
  account: row.account,
  accountId: row.accountId,
  type: row.type,
  amount,
});

export async function trialBalance(db: Database, me: Me, asked: { asOf?: string | null }): Promise<TrialBalance> {
  mayReadLedger(me);
  const asOf = asOfDay(asked.asOf);
  const all = await moved(db, sql`e.on_date <= ${asOf}::date`);
  const lines = all
    .map((row) => {
      const balance = row.debit - row.credit;
      return { ...line(row, balance), head: headOf(row.type), debit: Math.max(balance, 0), credit: Math.max(-balance, 0) };
    })
    .filter((row) => row.amount !== 0);
  const debit = lines.reduce((sum, row) => sum + row.debit, 0);
  const credit = lines.reduce((sum, row) => sum + row.credit, 0);
  return { asOf, lines, totals: { debit, credit, difference: debit - credit } };
}

const PL_PARTS: { key: keyof ProfitAndLoss["parts"]; types: string[]; credit: boolean }[] = [
  { key: "income", types: ["income"], credit: true },
  { key: "costOfSales", types: ["cost_of_goods_sold"], credit: false },
  { key: "expenses", types: ["expense"], credit: false },
  { key: "otherIncome", types: ["other_income"], credit: true },
  { key: "otherExpenses", types: ["other_expense"], credit: false },
];

async function plOf(db: Database, from: string, to: string) {
  const all = await moved(db, sql`e.on_date between ${from}::date and ${to}::date`);
  const parts = Object.fromEntries(
    PL_PARTS.map((part) => [
      part.key,
      all
        .filter((row) => row.type && part.types.includes(row.type))
        .map((row) => line(row, part.credit ? row.credit - row.debit : row.debit - row.credit))
        .filter((row) => row.amount !== 0),
    ]),
  ) as ProfitAndLoss["parts"];
  const sum = (key: keyof ProfitAndLoss["parts"]) => parts[key].reduce((total, row) => total + row.amount, 0);
  const income = sum("income");
  const costOfSales = sum("costOfSales");
  const grossProfit = income - costOfSales;
  const operatingProfit = grossProfit - sum("expenses");
  const netProfit = operatingProfit + sum("otherIncome") - sum("otherExpenses");
  return {
    parts,
    totals: {
      income,
      costOfSales,
      grossProfit,
      grossMargin: income ? Math.round((grossProfit / income) * 1000) / 10 : null,
      expenses: sum("expenses"),
      operatingProfit,
      otherIncome: sum("otherIncome"),
      otherExpenses: sum("otherExpenses"),
      netProfit,
    },
  };
}

export async function profitAndLoss(db: Database, me: Me, asked: { from?: string | null; to?: string | null }): Promise<ProfitAndLoss> {
  mayReadLedger(me);
  const { from, to } = period(asked);
  const now = await plOf(db, from, to);
  // The same number of days just before, to compare.
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  const shift = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const before = await plOf(db, shift(from, -days), shift(from, -1));
  // Zoho's invoices of these days carry no cost of goods here yet (Zoho's Account Transactions
  // file brings it): say so, or their gross profit reads as if the goods cost nothing.
  const [zoho] = await rows<{ n: number; sales: number }>(
    db,
    sql`select count(*)::int as n, coalesce(sum(round(d.total * d.fx_rate)), 0)::float8 as sales from book_doc d
      where d.kind = 'invoice' and d.zoho_id is not null and d.status not in ('void', 'draft') and d.doc_date between ${from}::date and ${to}::date`,
  );
  const notes: string[] = [];
  if (zoho?.n)
    notes.push(
      `${zoho.n.toLocaleString("en-PH")} of Zoho's invoices in these days carry no cost of goods in these books yet (Zoho's Account Transactions file brings it), so the gross profit reads high. Gross profit on the CRM's own orders, with their batches' cost, is under Gross profit.`,
    );
  return { from, to, ...now, before: { from: shift(from, -days), to: shift(from, -1), totals: before.totals }, notes };
}

const BS_HEADS = ["asset", "liability", "equity"] as const;

export async function balanceSheet(db: Database, me: Me, asked: { asOf?: string | null }): Promise<BalanceSheet> {
  mayReadLedger(me);
  const asOf = asOfDay(asked.asOf);
  const all = await moved(db, sql`e.on_date <= ${asOf}::date`);
  const parts = Object.fromEntries(
    BS_HEADS.map((head) => [
      head,
      all
        .filter((row) => headOf(row.type) === head)
        .map((row) => line(row, head === "asset" ? row.debit - row.credit : row.credit - row.debit))
        .filter((row) => row.amount !== 0),
    ]),
  ) as Record<(typeof BS_HEADS)[number], StatementLine[]>;
  // What the business earned and hasn't closed into equity yet (Zoho's current year earnings and
  // retained earnings together).
  const profitToDate = all
    .filter((row) => ["income", "expense"].includes(headOf(row.type)))
    .reduce((sum, row) => sum + row.credit - row.debit, 0);
  // Accounts the documents name that the chart doesn't have: shown, so the totals can be checked.
  const notInChart = all
    .filter((row) => headOf(row.type) === "unknown")
    .map((row) => line(row, row.debit - row.credit))
    .filter((row) => row.amount !== 0);
  const sum = (list: StatementLine[]) => list.reduce((total, row) => total + row.amount, 0);
  const assets = sum(parts.asset);
  const liabilities = sum(parts.liability);
  const equity = sum(parts.equity) + profitToDate;
  return {
    asOf,
    assets: parts.asset,
    liabilities: parts.liability,
    equity: parts.equity,
    profitToDate,
    notInChart,
    totals: { assets, liabilities, equity, difference: assets + sum(notInChart) - liabilities - equity },
  };
}

/** What moved money in or out, by the kind of document. */
const CASH_WHAT: Record<string, string> = {
  customer_payment: "From customers",
  crm_payment: "From customers",
  refund: "Given back to customers",
  crm_refund: "Given back to customers",
  vendor_payment: "Paid to suppliers",
  expense: "Expenses",
  transfer_fund: "Between our own accounts",
  deposit: "Other money in",
  journal: "Journals",
};

export async function cashFlow(db: Database, me: Me, asked: { from?: string | null; to?: string | null }): Promise<CashFlow> {
  mayReadLedger(me);
  const { from, to } = period(asked);
  const money = sql`(${sql.join(MONEY_TYPES.map((type) => sql`${type}`), sql`, `)})`;
  const accounts = await rows<CashFlow["accounts"][number]>(
    db,
    sql`select a.name as account, a.id::int as "accountId", a.type,
        coalesce(sum(e.debit - e.credit) filter (where e.on_date < ${from}::date), 0)::float8 as opening,
        coalesce(sum(e.debit) filter (where e.on_date between ${from}::date and ${to}::date), 0)::float8 as "in",
        coalesce(sum(e.credit) filter (where e.on_date between ${from}::date and ${to}::date), 0)::float8 as "out",
        coalesce(sum(e.debit - e.credit) filter (where e.on_date <= ${to}::date), 0)::float8 as closing
      from book_account a join book_entry e on lower(e.account) = lower(a.name)
      where a.type in ${money}
      group by a.name, a.id, a.type
      having coalesce(sum(e.debit - e.credit) filter (where e.on_date <= ${to}::date), 0) <> 0
        or coalesce(sum(e.debit + e.credit) filter (where e.on_date between ${from}::date and ${to}::date), 0) <> 0
      order by case a.type when 'bank' then 0 when 'cash' then 1 else 2 end, lower(a.name)`,
  );
  const kinds = await rows<{ kind: string; in: number; out: number }>(
    db,
    sql`select e.kind, sum(e.debit)::float8 as "in", sum(e.credit)::float8 as "out"
      from book_entry e join book_account a on lower(a.name) = lower(e.account)
      where a.type in ${money} and e.on_date between ${from}::date and ${to}::date group by 1`,
  );
  const byWhat = new Map<string, { in: number; out: number }>();
  for (const kind of kinds) {
    const what = CASH_WHAT[kind.kind] ?? "Other";
    const now = byWhat.get(what) ?? { in: 0, out: 0 };
    byWhat.set(what, { in: now.in + kind.in, out: now.out + kind.out });
  }
  const sum = (key: "opening" | "in" | "out" | "closing") => accounts.reduce((total, row) => total + row[key], 0);
  return {
    from,
    to,
    accounts,
    what: [...byWhat.entries()].map(([what, flow]) => ({ what, ...flow, net: flow.in - flow.out })).sort((a, b) => b.net - a.net),
    totals: { opening: sum("opening"), in: sum("in"), out: sum("out"), closing: sum("closing") },
  };
}

const OUTPUT_KINDS = ["invoice", "credit_note", "crm_invoice", "crm_return"];
const INPUT_KINDS = ["bill", "vendor_credit", "expense"];

export async function vatSummary(db: Database, me: Me, asked: { from?: string | null; to?: string | null }): Promise<VatSummary> {
  mayReadLedger(me);
  const { from, to } = period(asked);
  const list = (kinds: string[]) => sql`(${sql.join(kinds.map((kind) => sql`${kind}`), sql`, `)})`;
  const months = await rows<VatSummary["months"][number]>(
    db,
    sql`select to_char(e.on_date, 'YYYY-MM') as month,
        coalesce(sum(e.credit - e.debit) filter (where lower(e.account) = 'tax payable' and e.kind in ${list(OUTPUT_KINDS)}), 0)::float8 as output,
        coalesce(sum(e.debit - e.credit) filter (where lower(e.account) = 'tax payable' and e.kind in ${list(INPUT_KINDS)}), 0)::float8 as input,
        coalesce(sum(e.credit - e.debit) filter (where lower(e.account) = 'tax payable' and e.kind not in ${list([...OUTPUT_KINDS, ...INPUT_KINDS])}), 0)::float8 as other,
        coalesce(sum(e.debit - e.credit) filter (where lower(e.account) = 'advance tax'), 0)::float8 as withheld
      from book_entry e
      where e.on_date between ${from}::date and ${to}::date and lower(e.account) in ('tax payable', 'advance tax')
      group by 1 order by 1`,
  );
  const sum = (key: "output" | "input" | "other" | "withheld") => months.reduce((total, row) => total + row[key], 0);
  return {
    from,
    to,
    months: months.map((row) => ({ ...row, net: row.output - row.input })),
    totals: { output: sum("output"), input: sum("input"), other: sum("other"), withheld: sum("withheld"), net: sum("output") - sum("input") },
  };
}

export async function payablesAging(db: Database, me: Me): Promise<PayablesAging> {
  mayReadLedger(me);
  const today = todayManila();
  const suppliers = await rows<PayablesAging["suppliers"][number]>(
    db,
    sql`select coalesce(s.name, d.party_name, 'Supplier') as supplier, s.id::int as "supplierId", count(*)::int as bills,
        sum(round(d.balance * d.fx_rate)) filter (where d.due_date is null or d.due_date >= ${today}::date)::float8 as current,
        sum(round(d.balance * d.fx_rate)) filter (where ${today}::date - d.due_date between 1 and 30)::float8 as d30,
        sum(round(d.balance * d.fx_rate)) filter (where ${today}::date - d.due_date between 31 and 60)::float8 as d60,
        sum(round(d.balance * d.fx_rate)) filter (where ${today}::date - d.due_date between 61 and 90)::float8 as d90,
        sum(round(d.balance * d.fx_rate)) filter (where ${today}::date - d.due_date > 90)::float8 as older,
        sum(round(d.balance * d.fx_rate))::float8 as total
      from book_doc d left join supplier s on s.id = d.supplier_id
      where d.kind = 'bill' and d.balance > 0 and d.status not in ('void', 'draft') and d.voided_at is null
      group by 1, 2 order by total desc`,
  );
  const clean = suppliers.map((row) => ({
    ...row,
    current: row.current ?? 0,
    d30: row.d30 ?? 0,
    d60: row.d60 ?? 0,
    d90: row.d90 ?? 0,
    older: row.older ?? 0,
  }));
  const sum = (key: "current" | "d30" | "d60" | "d90" | "older" | "total") => clean.reduce((total, row) => total + row[key], 0);
  return {
    today,
    suppliers: clean,
    totals: { current: sum("current"), d30: sum("d30"), d60: sum("d60"), d90: sum("d90"), older: sum("older"), total: sum("total"), bills: clean.reduce((n, row) => n + row.bills, 0) },
  };
}

const GP_KEY: Record<GrossProfitBy, { key: SQL; label: SQL; link: SQL }> = {
  medicine: { key: sql`l.medicine_id::text`, label: sql`max(m.name || coalesce(' ' || m.strength, ''))`, link: sql`null::text` },
  channel: { key: sql`coalesce(o.channel_id::text, '-')`, label: sql`coalesce(max(ch.name), 'No channel')`, link: sql`null::text` },
  customer: { key: sql`o.customer_id::text`, label: sql`max(c.name)`, link: sql`'/customers/' || o.customer_id::text` },
  order: { key: sql`o.id::text`, label: sql`max(o.code || ' · ' || c.name)`, link: sql`'/orders/' || o.id::text` },
  // A branch is a warehouse (Main, Cebu, Davao…), decided 18 Nov on Aryan's word.
  branch: { key: sql`coalesce(o.warehouse_id::text, '-')`, label: sql`coalesce(max(wh.name), 'No warehouse yet')`, link: sql`null::text` },
};

/**
 * Gross profit on the CRM's own orders whose goods have left, by what was asked: what they were
 * billed less VAT, less what their batches cost; a credited return takes its sale and (when its
 * goods came back) its cost off again. Billed in the days asked.
 */
export async function grossProfit(
  db: Database,
  me: Me,
  asked: { from?: string | null; to?: string | null; by?: string | null },
): Promise<GrossProfit> {
  allow(me, ["finance", "ceo", "admin", "management"], "see gross profit");
  const { from, to } = period(asked);
  const by: GrossProfitBy = (["medicine", "channel", "customer", "order", "branch"] as const).find((one) => one === asked.by) ?? "medicine";
  const pick = GP_KEY[by];
  const found = await rows<GrossProfit["rows"][number]>(
    db,
    sql`with sold as (
        select o.id as order_id, oi.medicine_id,
          sum(case when coalesce(oi.vat_then, md.vat) = 'vat12' then round(oi.qty::bigint * oi.unit_price * 100 / 112.0) else oi.qty::bigint * oi.unit_price end) as revenue,
          sum(oi.qty)::bigint as qty
        from invoice i join sales_order o on o.id = i.order_id join order_item oi on oi.order_id = o.id join medicine md on md.id = oi.medicine_id
        where i.status <> 'cancelled' and i.issued_on between ${from}::date and ${to}::date
          and exists (select 1 from stock_move x where x.kind = 'deliver' and x.ref = o.code)
        group by 1, 2
      ),
      back as (
        select r.order_id, l.medicine_id,
          sum(case when coalesce(oi.vat_then, md.vat) = 'vat12' then round(l.qty::bigint * l.unit_price * 100 / 112.0) else l.qty::bigint * l.unit_price end) as revenue
        from sales_return r join sales_return_line l on l.return_id = r.id and l.outcome <> 'missing'
          join medicine md on md.id = l.medicine_id left join order_item oi on oi.id = l.order_item_id
        where r.credited_at is not null and r.order_id in (select order_id from sold)
        group by 1, 2
      ),
      cost as (
        select o.id as order_id, x.medicine_id, sum(-x.qty::bigint * coalesce(x.unit_cost, b.unit_cost, 0)) as cost,
          bool_or(coalesce(x.unit_cost, b.unit_cost, 0) = 0) as uncosted
        from stock_move x join batch b on b.id = x.batch_id
          join sales_order o on o.code = x.ref or o.id = (select r.order_id from sales_return r where r.code = x.ref)
        where x.kind in ('deliver', 'return') and o.id in (select order_id from sold)
        group by 1, 2
      ),
      l as (
        select s.order_id, s.medicine_id, s.qty, s.revenue - coalesce(bk.revenue, 0) as revenue, coalesce(c.cost, 0) as cost,
          coalesce(c.uncosted, false) as uncosted
        from sold s left join back bk on bk.order_id = s.order_id and bk.medicine_id = s.medicine_id
          left join cost c on c.order_id = s.order_id and c.medicine_id = s.medicine_id
      )
      select ${pick.key} as key, ${pick.label} as label, max(${pick.link}) as link, sum(l.qty)::int as qty,
        sum(l.revenue)::float8 as revenue, sum(l.cost)::float8 as cost, sum(l.revenue - l.cost)::float8 as profit,
        bool_or(l.uncosted) as uncosted
      from l join sales_order o on o.id = l.order_id join medicine m on m.id = l.medicine_id
        join customer c on c.id = o.customer_id left join channel ch on ch.id = o.channel_id left join warehouse wh on wh.id = o.warehouse_id
      group by 1 order by 7 desc`,
  );
  const out = found.map((row) => ({ ...row, margin: row.revenue ? Math.round((row.profit / row.revenue) * 1000) / 10 : null }));
  const revenue = out.reduce((sum, row) => sum + row.revenue, 0);
  const cost = out.reduce((sum, row) => sum + row.cost, 0);
  // Billed in these days, goods not out yet: no cost to count against them yet.
  const [waiting] = await rows<{ n: number; total: number }>(
    db,
    sql`select count(*)::int as n, coalesce(sum(i.total), 0)::float8 as total from invoice i join sales_order o on o.id = i.order_id
      where i.status <> 'cancelled' and i.issued_on between ${from}::date and ${to}::date
        and not exists (select 1 from stock_move x where x.kind = 'deliver' and x.ref = o.code)`,
  );
  return {
    from,
    to,
    by,
    rows: out,
    totals: { revenue, cost, profit: revenue - cost, margin: revenue ? Math.round(((revenue - cost) / revenue) * 1000) / 10 : null },
    notOut: { invoices: waiting?.n ?? 0, total: waiting?.total ?? 0 },
  };
}

/**
 * The month's money at a glance for the CEO's Home and Finance: gross profit on the CRM's orders
 * this month, what customers owe and the company's days of sales owed (DSO: owed now against the
 * last 90 days' billing, Zoho's invoices and the CRM's).
 */
export async function moneySummary(db: Database, me: Me): Promise<MoneySummary> {
  allow(me, ["finance", "ceo", "admin", "management"], "see the money summary");
  const today = todayManila();
  const profit = await grossProfit(db, me, { from: `${today.slice(0, 7)}-01`, to: today, by: "channel" });
  const [owed] = await rows<{ owed: number; billed: number }>(
    db,
    sql`select coalesce(sum(total - paid) filter (where status = 'open'), 0)::float8 as owed,
        coalesce(sum(total) filter (where status <> 'cancelled' and issued_on > ${today}::date - 90), 0)::float8 as billed
      from sale_invoice`,
  );
  return {
    today,
    profit: profit.totals,
    notOut: profit.notOut,
    owed: owed?.owed ?? 0,
    billed90: owed?.billed ?? 0,
    dso: owed?.billed ? Math.round(((owed.owed ?? 0) / owed.billed) * 90) : null,
  };
}
