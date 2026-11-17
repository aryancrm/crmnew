// The old CRM's insight reports brought back (docs/ERP-PLAN.md phase 2, docs/OLD-CRM-GAPS.md):
// sales by channel month by month, top medicines against the days before, stock by age and expiry,
// days of stock left, ABC classes, purchases by supplier and by item, online cases by source and
// by person, and senior / PWD sales. Each reads Zoho's history and the CRM's own work together
// where both hold it, so a month before the switch and a month after read the same way.

import { type SQL, sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { allow, Refusal } from "../http";
import { todayManila } from "../inventory/rules";
import type { Insight, Me, Role } from "../types";

const SALES_ROLES: Role[] = ["ceo", "admin", "management", "finance"];
const STOCK_ROLES: Role[] = ["ceo", "admin", "management", "finance", "inventory"];
const BUY_ROLES: Role[] = ["ceo", "admin", "finance", "inventory"];

const isDay = (value?: string | null) => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
function period(asked: { from?: string | null; to?: string | null }) {
  const to = isDay(asked.to) ? (asked.to as string) : todayManila();
  const from = isDay(asked.from) ? (asked.from as string) : `${to.slice(0, 7)}-01`;
  if (from > to) throw new Refusal(400, "invalid", "The first day comes after the last one.", "from");
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  const shift = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  return { from, to, beforeFrom: shift(from, -days), beforeTo: shift(from, -1) };
}

/** Every medicine line sold, the CRM's billed orders and Zoho's invoiced orders, with its day. */
const SOLD_LINES = sql`(
  select i.issued_on as day, coalesce(m.name || coalesce(' ' || m.strength, ''), oi.name_then) as medicine, oi.medicine_id,
    oi.qty::bigint as qty, (oi.qty::bigint * oi.unit_price) as amount
  from invoice i join order_item oi on oi.order_id = i.order_id join medicine m on m.id = oi.medicine_id
  where i.status <> 'cancelled'
  union all
  select o.ordered_on, coalesce(m.name || coalesce(' ' || m.strength, ''), p.name), m.id, p.qty::bigint, (p.qty::bigint * p.unit_price)
  from past_order o join past_order_item p on p.past_order_id = o.id
    left join lateral (select x.id, x.name, x.strength from medicine x where x.sku = p.sku
      or x.id = (select s.medicine_id from medicine_sku s where s.sku = p.sku limit 1) limit 1) m on true
  where o.status in ('invoiced', 'partially_invoiced', 'closed') and not p.free
) s`;

type Column = Insight["columns"][number];
const col = (key: string, label: string, kind: Column["kind"] = "text"): Column => ({ key, label, kind });

async function salesTrend(db: Database, asked: { to?: string | null }): Promise<Insight> {
  const to = isDay(asked.to) ? (asked.to as string) : todayManila();
  const last = `${to.slice(0, 7)}-01`;
  const first = new Date(Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 6, 1)).toISOString().slice(0, 10);
  const found = await rows<{ channel: string; month: string; amount: number }>(
    db,
    sql`select coalesce(ch.name, 'No channel yet') as channel, to_char(s.issued_on, 'YYYY-MM') as month, sum(s.total)::float8 as amount
      from sale_invoice s left join channel ch on ch.id = s.channel_id
      where s.status <> 'cancelled' and s.issued_on >= ${first}::date and s.issued_on <= ${to}::date
      group by 1, 2`,
  );
  const months: string[] = [];
  for (let at = new Date(`${first}T00:00:00Z`); at.toISOString().slice(0, 10) <= last; at.setUTCMonth(at.getUTCMonth() + 1))
    months.push(at.toISOString().slice(0, 7));
  const channels = [...new Set(found.map((one) => one.channel))];
  const table = channels
    .map((channel) => {
      const row: Record<string, string | number> = { channel };
      let total = 0;
      for (const month of months) {
        const amount = found.find((one) => one.channel === channel && one.month === month)?.amount ?? 0;
        row[month] = amount;
        total += amount;
      }
      row.total = total;
      return row;
    })
    .sort((a, b) => Number(b.total) - Number(a.total));
  const totals: Record<string, string | number> = { channel: "Total" };
  for (const key of [...months, "total"]) totals[key] = table.reduce((sum, row) => sum + Number(row[key] ?? 0), 0);
  return {
    title: "Sales by channel, month by month",
    note: "Billed, Zoho's invoices and the CRM's, by the channel of the seat that sold. 'No channel yet' is Zoho's sales by salespeople not yet tied to a seat.",
    columns: [col("channel", "Channel"), ...months.map((month) => col(month, month, "money")), col("total", "Six months", "money")],
    rows: table,
    totals,
  };
}

async function topMedicines(db: Database, asked: { from?: string | null; to?: string | null }): Promise<Insight> {
  const { from, to, beforeFrom, beforeTo } = period(asked);
  const found = await rows<{ medicine: string; qty: number; amount: number; qtyBefore: number; amountBefore: number }>(
    db,
    sql`select s.medicine,
        coalesce(sum(s.qty) filter (where s.day between ${from}::date and ${to}::date), 0)::float8 as qty,
        coalesce(sum(s.amount) filter (where s.day between ${from}::date and ${to}::date), 0)::float8 as amount,
        coalesce(sum(s.qty) filter (where s.day between ${beforeFrom}::date and ${beforeTo}::date), 0)::float8 as "qtyBefore",
        coalesce(sum(s.amount) filter (where s.day between ${beforeFrom}::date and ${beforeTo}::date), 0)::float8 as "amountBefore"
      from ${SOLD_LINES} where s.day between ${beforeFrom}::date and ${to}::date
      group by 1 having sum(s.amount) filter (where s.day between ${from}::date and ${to}::date) > 0
      order by 3 desc limit 100`,
  );
  return {
    title: "Top medicines",
    note: `Sold ${from} to ${to} against the same number of days before (${beforeFrom} to ${beforeTo}); Zoho's invoiced orders and the CRM's billed ones, free pieces left out.`,
    columns: [col("medicine", "Medicine"), col("qty", "Pieces", "number"), col("amount", "Sold", "money"), col("amountBefore", "Before", "money"), col("change", "Change", "percent")],
    rows: found.map((row) => ({ ...row, change: row.amountBefore ? Math.round(((row.amount - row.amountBefore) / row.amountBefore) * 1000) / 10 : "new" })),
    totals: { medicine: "Total", qty: found.reduce((n, row) => n + row.qty, 0), amount: found.reduce((n, row) => n + row.amount, 0), amountBefore: found.reduce((n, row) => n + row.amountBefore, 0) },
  };
}

async function stockAging(db: Database): Promise<Insight> {
  const today = todayManila();
  const found = await rows<Record<string, string | number>>(
    db,
    sql`select m.name || coalesce(' ' || m.strength, '') as medicine, w.name as warehouse, b.batch_no as batch,
        to_char(b.expires_on, 'YYYY-MM-DD') as expires, s.qty::float8 as qty, (s.qty::bigint * coalesce(b.unit_cost, 0))::float8 as value,
        (${today}::date - (b.created_at at time zone 'Asia/Manila')::date)::int as "daysHeld",
        case when b.expires_on is null then 'No expiry'
          when b.expires_on < ${today}::date then 'Expired'
          when b.expires_on < ${today}::date + 90 then 'Within 90 days'
          when b.expires_on < ${today}::date + 180 then 'Within 180 days'
          else 'Later' end as expiry
      from stock s join batch b on b.id = s.batch_id join medicine m on m.id = b.medicine_id join warehouse w on w.id = s.warehouse_id
      where s.qty > 0
      order by b.expires_on nulls last, m.name`,
  );
  const value = found.reduce((sum, row) => sum + Number(row.value), 0);
  return {
    title: "Stock by age and expiry",
    note: "Every batch on a shelf: how long it has been here, when it expires, and what it cost. Soonest to expire first.",
    columns: [col("medicine", "Medicine"), col("warehouse", "Warehouse"), col("batch", "Batch"), col("expires", "Expires"), col("expiry", "Expiry"), col("daysHeld", "Days held", "number"), col("qty", "Pieces", "number"), col("value", "Value at cost", "money")],
    rows: found,
    totals: { medicine: "Total", qty: found.reduce((sum, row) => sum + Number(row.qty), 0), value },
  };
}

async function stockTurnover(db: Database): Promise<Insight> {
  const today = todayManila();
  const found = await rows<{ medicine: string; onHand: number; value: number; sold90: number }>(
    db,
    sql`with held as (
        select b.medicine_id, sum(s.qty)::float8 as qty, sum(s.qty::bigint * coalesce(b.unit_cost, 0))::float8 as value
        from stock s join batch b on b.id = s.batch_id group by 1
      ),
      sold as (select s.medicine_id, sum(s.qty)::float8 as qty from ${SOLD_LINES}
        where s.day > ${today}::date - 90 and s.medicine_id is not null group by 1)
      select m.name || coalesce(' ' || m.strength, '') as medicine, coalesce(h.qty, 0) as "onHand", coalesce(h.value, 0) as value,
        coalesce(x.qty, 0) as sold90
      from medicine m left join held h on h.medicine_id = m.id left join sold x on x.medicine_id = m.id
      where coalesce(h.qty, 0) > 0 or coalesce(x.qty, 0) > 0
      order by 3 desc`,
  );
  return {
    title: "Days of stock left",
    note: "What is on the shelves against what sold in the last 90 days (Zoho's and the CRM's): how many days it lasts at that pace. Slow movers last longest.",
    columns: [col("medicine", "Medicine"), col("onHand", "On hand", "number"), col("value", "Value at cost", "money"), col("sold90", "Sold in 90 days", "number"), col("days", "Days of stock", "number")],
    rows: found.map((row) => ({ ...row, days: row.sold90 ? Math.round(row.onHand / (row.sold90 / 90)) : row.onHand ? "Not selling" : 0 })),
    totals: { medicine: "Total", value: found.reduce((sum, row) => sum + row.value, 0) },
  };
}

async function abc(db: Database): Promise<Insight> {
  const today = todayManila();
  const found = await rows<{ medicine: string; amount: number; qty: number }>(
    db,
    sql`select s.medicine, sum(s.amount)::float8 as amount, sum(s.qty)::float8 as qty from ${SOLD_LINES}
      where s.day > ${today}::date - 365 group by 1 having sum(s.amount) > 0 order by 2 desc`,
  );
  const total = found.reduce((sum, row) => sum + row.amount, 0);
  let running = 0;
  return {
    title: "ABC classes",
    note: "The last 12 months' sales by medicine, biggest first: class A makes the first 80% of sales, B the next 15%, C the last 5%.",
    columns: [col("medicine", "Medicine"), col("class", "Class"), col("qty", "Pieces", "number"), col("amount", "Sold", "money"), col("share", "Share", "percent"), col("running", "Running share", "percent")],
    rows: found.map((row) => {
      const before = running;
      running += row.amount;
      const share = total ? Math.round((row.amount / total) * 1000) / 10 : 0;
      return { ...row, share, running: total ? Math.round((running / total) * 1000) / 10 : 0, class: before / total < 0.8 ? "A" : before / total < 0.95 ? "B" : "C" };
    }),
    totals: { medicine: "Total", amount: total },
  };
}

async function purchases(db: Database, asked: { from?: string | null; to?: string | null; by?: string | null }): Promise<Insight> {
  const { from, to } = period(asked);
  const byItem = asked.by === "item";
  const found = byItem
    ? await rows<Record<string, string | number>>(
        db,
        sql`select coalesce(m.name, l.item_name, l.description, 'Other') as name, count(distinct d.id)::int as bills,
            coalesce(sum(l.qty), 0)::float8 as qty, sum(round(coalesce(l.amount, 0) * d.fx_rate))::float8 as amount
          from book_doc d join book_line l on l.doc_id = d.id left join medicine m on m.id = l.medicine_id
          where d.kind = 'bill' and d.status not in ('void', 'draft') and d.voided_at is null and d.doc_date between ${from}::date and ${to}::date
          group by 1 order by 4 desc`,
      )
    : await rows<Record<string, string | number>>(
        db,
        sql`select coalesce(s.name, d.party_name, 'Supplier') as name, count(*)::int as bills, null::float8 as qty,
            sum(round(d.total * d.fx_rate))::float8 as amount, sum(round(d.balance * d.fx_rate))::float8 as unpaid
          from book_doc d left join supplier s on s.id = d.supplier_id
          where d.kind = 'bill' and d.status not in ('void', 'draft') and d.voided_at is null and d.doc_date between ${from}::date and ${to}::date
          group by 1 order by 4 desc`,
      );
  return {
    title: byItem ? "Purchases by item" : "Purchases by supplier",
    note: `Bills dated ${from} to ${to}, in pesos.`,
    columns: byItem
      ? [col("name", "Item"), col("bills", "Bills", "number"), col("qty", "Quantity", "number"), col("amount", "Billed", "money")]
      : [col("name", "Supplier"), col("bills", "Bills", "number"), col("amount", "Billed", "money"), col("unpaid", "Still unpaid", "money")],
    rows: found,
    totals: { name: "Total", bills: found.reduce((n, row) => n + Number(row.bills), 0), amount: found.reduce((n, row) => n + Number(row.amount), 0) },
  };
}

async function cases(db: Database, asked: { from?: string | null; to?: string | null; by?: string | null }): Promise<Insight> {
  const { from, to } = period(asked);
  const byPerson = asked.by === "person";
  const key: SQL = byPerson ? sql`coalesce(p.name, 'Not given to anyone')` : sql`initcap(replace(l.source, '_', ' '))`;
  const found = await rows<{ name: string; cases: number; ordered: number; sold: number }>(
    db,
    sql`select ${key} as name, count(*)::int as cases,
        count(*) filter (where exists (select 1 from sales_order o where o.lead_id = l.id and o.status <> 'cancelled'))::int as ordered,
        coalesce(sum((select sum(o.total) from sales_order o where o.lead_id = l.id and o.status <> 'cancelled')), 0)::float8 as sold
      from lead l left join person p on p.id = l.assigned_to
      where (l.created_at at time zone 'Asia/Manila')::date between ${from}::date and ${to}::date
      group by 1 order by 2 desc`,
  );
  return {
    title: byPerson ? "Online cases by person" : "Online cases by source",
    note: `Cases opened ${from} to ${to}: how many became an order, and what those orders came to.`,
    columns: [col("name", byPerson ? "Person" : "Source"), col("cases", "Cases", "number"), col("ordered", "Became an order", "number"), col("rate", "Conversion", "percent"), col("sold", "Ordered", "money")],
    rows: found.map((row) => ({ ...row, rate: row.cases ? Math.round((row.ordered / row.cases) * 1000) / 10 : 0 })),
    totals: { name: "Total", cases: found.reduce((n, row) => n + row.cases, 0), ordered: found.reduce((n, row) => n + row.ordered, 0), sold: found.reduce((n, row) => n + row.sold, 0) },
  };
}

async function seniorPwd(db: Database, asked: { from?: string | null; to?: string | null }): Promise<Insight> {
  const { from, to } = period(asked);
  const found = await rows<Record<string, string | number>>(
    db,
    sql`select o.code as "order", to_char(i.issued_on, 'YYYY-MM-DD') as day, upper(coalesce(o.relief_kind, '')) as kind,
        o.relief_name as name, o.relief_id_no as "idNo", sum(oi.qty)::float8 as qty,
        sum(oi.qty::bigint * oi.list_price)::float8 as list, sum(oi.qty::bigint * oi.unit_price)::float8 as billed
      from invoice i join sales_order o on o.id = i.order_id join order_item oi on oi.order_id = o.id and oi.relief
      where i.status <> 'cancelled' and i.issued_on between ${from}::date and ${to}::date
      group by o.id, o.code, i.issued_on, o.relief_kind, o.relief_name, o.relief_id_no order by i.issued_on, o.code`,
  );
  return {
    title: "Senior citizen and PWD sales",
    note: `Lines sold with the senior or PWD relief (20% off, no VAT), billed ${from} to ${to}, with the ID on file: for the BIR's records.`,
    columns: [col("day", "Billed"), col("order", "Order"), col("kind", "Relief"), col("name", "Name"), col("idNo", "ID number"), col("qty", "Pieces", "number"), col("list", "List value", "money"), col("billed", "Billed", "money"), col("relief", "Relief given", "money")],
    rows: found.map((row) => ({ ...row, relief: Number(row.list) - Number(row.billed) })),
    totals: { day: "Total", list: found.reduce((n, row) => n + Number(row.list), 0), billed: found.reduce((n, row) => n + Number(row.billed), 0), relief: found.reduce((n, row) => n + Number(row.list) - Number(row.billed), 0) },
  };
}

export const INSIGHTS: Record<string, { roles: Role[]; run: (db: Database, asked: { from?: string | null; to?: string | null; by?: string | null }) => Promise<Insight> }> = {
  "sales-trend": { roles: SALES_ROLES, run: (db, asked) => salesTrend(db, asked) },
  "top-medicines": { roles: SALES_ROLES, run: topMedicines },
  "stock-aging": { roles: STOCK_ROLES, run: (db) => stockAging(db) },
  "stock-turnover": { roles: STOCK_ROLES, run: (db) => stockTurnover(db) },
  abc: { roles: SALES_ROLES, run: (db) => abc(db) },
  purchases: { roles: BUY_ROLES, run: purchases },
  cases: { roles: [...SALES_ROLES, "online"], run: cases },
  "senior-pwd": { roles: SALES_ROLES, run: seniorPwd },
};

export async function insight(db: Database, me: Me, key: string, asked: { from?: string | null; to?: string | null; by?: string | null }): Promise<Insight> {
  const found = INSIGHTS[key];
  if (!found) throw new Refusal(404, "not_found", "There is no such report.");
  allow(me, found.roles, "read this report");
  return found.run(db, asked);
}
