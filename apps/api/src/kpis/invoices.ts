// The invoices My KPIs counts (this CRM's and Zoho's), and each person's sales from them. Kept apart
// from the KPI panel so the scorecards can count the very same sales (Aryan, 22 Nov: a seller's Home
// said ₱192,272 under My KPIs and ₱0 under "Sales vs target": the scorecard counted only this
// CRM's invoices, while the company still bills in Zoho).

import { AsyncLocalStorage } from "node:async_hooks";
import { type SQL, sql } from "drizzle-orm";
import { type Database, requestMemo, rows } from "../db/index";
import { soldFor } from "../org/service";

/** Every invoice in the days, with its sales without VAT (line by line, as Sales performance),
 *  its total with VAT, and the person it counts for (the seat's holder on the invoice's day; a
 *  sale from before the seat was filled here, its first holder after; else the order's MedRep). */
export function invoicesSql(from: string, to: string): SQL {
  return sql`
    with inv as (
      select 'crm' as source, i.id, i.code as invoice, i.issued_on as day, o.seat_id, ${soldFor("o")} as fallback, o.raised_by,
        o.id as order_id, o.code as order_code, o.customer_id, o.created_at as order_at, i.total::bigint as total,
        -- Less what came back and was credited: the invoice's total is lowered by the same pieces, so
        -- sales with and without VAT stay one figure (22 Nov).
        (select coalesce(sum(round((oi.qty - coalesce((select sum(rl.qty) from sales_return_line rl join sales_return rr on rr.id = rl.return_id where rl.order_item_id = oi.id and rr.credited_at is not null and rl.outcome <> 'missing'), 0))::numeric * oi.unit_price / case when coalesce(oi.vat_then, m.vat) = 'vat12' then 1.12 else 1 end)), 0)
          from order_item oi join medicine m on m.id = oi.medicine_id where oi.order_id = o.id)::bigint as net
      from invoice i join sales_order o on o.id = i.order_id
      where i.status <> 'cancelled' and i.issued_on between ${from}::date and ${to}::date
      union all
      select 'zoho', d.id, coalesce(d.number, ''), d.doc_date, zs.seat_id, null::bigint, null::bigint,
        null::bigint, null::text, d.customer_id, null::timestamptz, round(d.total * d.fx_rate)::bigint,
        (select coalesce(sum(round(coalesce(l.amount, 0) * d.fx_rate)), 0) from book_line l where l.doc_id = d.id and coalesce(l.qty, 1) > 0)::bigint
      from book_doc d left join zoho_seller zs on zs.name = coalesce(d.fields->>'Sales Person', d.fields->>'salesperson_name')
      where d.kind = 'invoice' and d.zoho_id is not null and d.status not in ('draft', 'void') and d.voided_at is null
        and d.doc_date between ${from}::date and ${to}::date
    )
    select inv.*,
      coalesce((select h.person_id from seat_holder h where h.seat_id = inv.seat_id and h.kind = 'holder' and h.starts_on <= inv.day
          and (h.ends_on is null or h.ends_on >= inv.day) order by h.starts_on desc limit 1),
        (select h.person_id from seat_holder h where h.seat_id = inv.seat_id and h.kind = 'holder' and h.starts_on > inv.day order by h.starts_on, h.id limit 1),
        inv.fallback) as person_id
    from inv`;
}


export type PersonSales = { personId: number; sales: number; withVat: number; invoices: number; days: string[] };

/** Each person's sales in the days as My KPIs counts them (without VAT, with VAT, how many
 *  invoices, on which days), worked out once in a reading request for everyone. */
export function salesByPerson(db: Database, from: string, to: string): Promise<Map<number, PersonSales>> {
  const key = `kpi-sales-by-person:${from}:${to}`;
  const kept = batch.getStore();
  if (kept) {
    const had = kept.get(key);
    if (had) return had;
    const made = salesNow(db, from, to);
    kept.set(key, made);
    return made;
  }
  return requestMemo(key, () => salesNow(db, from, to));
}

const batch = new AsyncLocalStorage<Map<string, Promise<Map<number, PersonSales>>>>();
/** A job that scores many people outside a reading request (locking a month): their sales are
 *  counted once for the job, not once a person. Nothing else is remembered. */
export const salesBatch = <T>(work: () => Promise<T>): Promise<T> => batch.run(new Map(), work);

function salesNow(db: Database, from: string, to: string): Promise<Map<number, PersonSales>> {
  return (async () => {
    const found = await rows<PersonSales>(
      db,
      sql`select x.person_id::int as "personId", coalesce(sum(x.net), 0)::float8 as sales, coalesce(sum(x.total), 0)::float8 as "withVat",
          count(*)::int as invoices, array_agg(distinct to_char(x.day, 'YYYY-MM-DD')) as days
        from (${invoicesSql(from, to)}) x where x.person_id is not null group by 1`,
    );
    return new Map(found.map((row) => [row.personId, row]));
  })();
}
