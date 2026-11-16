// This CRM's own sales documents in the books' lists (docs/PLAN.md 17): the orders, invoices,
// payments and returns made on the CRM's order line show beside Zoho's, as Zoho would show them.
// Their ids are negative in the books, so a list can hold both; opening one shows it as Zoho
// draws a document, with a link to the CRM's own page where its work is done.

import { type SQL, sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { Refusal } from "../http";
import type { BookDoc, BookKind, BookLine, BookLinked, BookRow } from "../types";

const DAY = (column: string) => sql.raw(`to_char(${column}, 'YYYY-MM-DD')`);
const MANILA_DAY = (column: string) => sql.raw(`to_char((${column} at time zone 'Asia/Manila')::date, 'YYYY-MM-DD')`);

/** An invoice's word, as Zoho's: open, partially paid, overdue, paid, void. */
const invoiceStatus = (today: string) => sql`case when i.status = 'cancelled' then 'void' when i.status = 'paid' or i.total - i.paid <= 0 then 'paid'
  when i.due_on < ${today}::date then 'overdue' when i.paid > 0 then 'partially_paid' else 'open' end`;

/** The light rows (for counting, filtering, sorting) of the CRM's own documents of a kind. */
export function crmLight(kind: BookKind, today: string): SQL {
  if (kind === "sales_order")
    return sql`union all select -o.id::int, ${MANILA_DAY("o.created_at")}, coalesce(o.code, 'DRAFT-' || o.id), o.customer_po, c.name, o.customer_id::int, o.status,
      o.total::float8, 0::float8, ${DAY("o.expected_on")} from sales_order o join customer c on c.id = o.customer_id`;
  if (kind === "invoice")
    return sql`union all select -i.id::int, ${DAY("i.issued_on")}, i.code, o.customer_po, c.name, i.customer_id::int, ${invoiceStatus(today)},
      i.total::float8, greatest(0, i.total - i.paid)::float8, ${DAY("i.due_on")}
      from invoice i join customer c on c.id = i.customer_id join sales_order o on o.id = i.order_id`;
  if (kind === "customer_payment")
    return sql`union all select -p.id::int, ${DAY("p.paid_on")}, 'CRM-' || lpad(p.id::text, 5, '0'), p.reference, c.name, p.customer_id::int,
      case when p.active then 'paid' else 'void' end, p.amount::float8, 0::float8, null from payment p join customer c on c.id = p.customer_id`;
  if (kind === "sales_return")
    return sql`union all select -r.id::int, ${MANILA_DAY("r.requested_at")}, coalesce(r.code, 'RET-' || r.id), o.code, c.name, o.customer_id::int, r.status,
      r.credit::float8, 0::float8, null from sales_return r join sales_order o on o.id = r.order_id join customer c on c.id = o.customer_id`;
  return sql``;
}

const dot = (full: SQL, partial: SQL) => sql`case when ${full} then 'full' when ${partial} then 'partial' else 'none' end`;

/** Everything a list row shows, for the CRM's own documents (ids negative). */
export async function crmRows(db: Database, kind: BookKind, ids: number[], today: string): Promise<BookRow[]> {
  if (!ids.length) return [];
  const list = sql.join(ids.map((id) => sql`${-id}`), sql`, `);
  const base = { overdueDays: null, currency: "PHP", received: null, billed: null, unused: null, qty: null, mode: null, linked: null };
  if (kind === "sales_order")
    return (
      await rows<BookRow>(
        db,
        sql`select -o.id::int as id, coalesce(o.code, 'DRAFT-' || o.id) as number, o.customer_po as reference, ${MANILA_DAY("o.created_at")} as date,
            ${DAY("o.expected_on")} as "dueDate", o.status, c.name as party, o.customer_id::int as "partyId", o.total::float8 as total, 0::float8 as balance,
            ${dot(sql`i.id is not null and i.status <> 'cancelled'`, sql`false`)} as invoiced,
            ${dot(sql`i.status = 'paid'`, sql`coalesce(i.paid, 0) > 0`)} as paid,
            ${dot(sql`o.packed_at is not null`, sql`false`)} as packed,
            ${dot(sql`o.shipped_at is not null or o.status in ('shipped', 'completed')`, sql`false`)} as shipped,
            o.delivery_method as "deliveryMethod", json_build_object('href', '/orders/' || o.id) as crm
          from sales_order o join customer c on c.id = o.customer_id left join invoice i on i.order_id = o.id
          where o.id in (${list})`,
      )
    ).map((row) => ({ ...base, ...row }));
  if (kind === "invoice")
    return (
      await rows<BookRow>(
        db,
        sql`select -i.id::int as id, i.code as number, o.customer_po as reference, ${DAY("i.issued_on")} as date, ${DAY("i.due_on")} as "dueDate",
            ${invoiceStatus(today)} as status, case when i.status = 'open' and i.due_on < ${today}::date and i.total > i.paid then (${today}::date - i.due_on)::int end as "overdueDays",
            c.name as party, i.customer_id::int as "partyId", i.total::float8 as total, greatest(0, i.total - i.paid)::float8 as balance,
            o.code as linked, json_build_object('href', '/invoices/' || i.id) as crm
          from invoice i join customer c on c.id = i.customer_id join sales_order o on o.id = i.order_id where i.id in (${list})`,
      )
    ).map((row) => ({ ...base, ...row, overdueDays: row.overdueDays ?? null }));
  if (kind === "customer_payment")
    return (
      await rows<BookRow>(
        db,
        sql`select -p.id::int as id, 'CRM-' || lpad(p.id::text, 5, '0') as number, p.reference, ${DAY("p.paid_on")} as date, null as "dueDate",
            case when p.active then 'paid' else 'void' end as status, c.name as party, p.customer_id::int as "partyId", p.amount::float8 as total, 0::float8 as balance,
            i.code as linked, p.method as mode, 0::float8 as unused, json_build_object('href', '/invoices/' || i.id) as crm
          from payment p join customer c on c.id = p.customer_id join invoice i on i.id = p.invoice_id where p.id in (${list})`,
      )
    ).map((row) => ({ ...base, ...row }));
  if (kind === "sales_return")
    return (
      await rows<BookRow>(
        db,
        sql`select -r.id::int as id, coalesce(r.code, 'RET-' || r.id) as number, o.code as reference, ${MANILA_DAY("r.requested_at")} as date, null as "dueDate",
            r.status, c.name as party, o.customer_id::int as "partyId", r.credit::float8 as total, 0::float8 as balance, o.code as linked,
            (select sum(l.qty)::float8 from sales_return_line l where l.return_id = r.id) as qty, json_build_object('href', '/orders/' || o.id) as crm
          from sales_return r join sales_order o on o.id = r.order_id join customer c on c.id = o.customer_id where r.id in (${list})`,
      )
    ).map((row) => ({ ...base, ...row }));
  return [];
}

/** One of the CRM's own documents, drawn as a books document. */
export async function crmDoc(db: Database, kind: BookKind, id: number, today: string): Promise<BookDoc> {
  const [row] = await crmRows(db, kind, [-id], today);
  if (!row) throw new Refusal(404, "not_found", "That document is not in the books.");
  let lines: BookLine[] = [];
  let linkedDocs: BookLinked[] = [];
  const line = (l: Partial<BookLine>, n: number): BookLine => ({
    id: n,
    n,
    medicineId: null,
    medicine: null,
    itemName: null,
    sku: null,
    description: null,
    account: null,
    warehouse: null,
    unit: "pcs",
    qty: null,
    rate: null,
    taxName: null,
    taxPct: null,
    amount: null,
    qtyDone: {},
    batches: [],
    fields: {},
    fromLine: null,
    ...l,
  });
  const orderLines = async (orderId: number) =>
    (
      await rows<{ medicineId: number; name: string; qty: number; price: number }>(
        db,
        sql`select oi.medicine_id::int as "medicineId", m.name || coalesce(' ' || m.strength, '') as name, oi.qty, oi.unit_price::float8 as price
          from order_item oi join medicine m on m.id = oi.medicine_id where oi.order_id = ${orderId} order by oi.id`,
      )
    ).map((l, n) => line({ medicineId: l.medicineId, medicine: l.name, itemName: l.name, qty: l.qty, rate: l.price / 100, amount: l.qty * l.price }, n + 1));
  if (kind === "sales_order") {
    lines = await orderLines(id);
    linkedDocs = await rows<BookLinked>(
      db,
      sql`select -i.id::int as id, 'invoice' as kind, i.code as number, ${DAY("i.issued_on")} as date, ${invoiceStatus(today)} as status, i.total::float8 as total,
          greatest(0, i.total - i.paid)::float8 as balance, null::float8 as amount, null as on, 'from' as direction
        from invoice i where i.order_id = ${id}
        union all
        select -r.id::int, 'sales_return', coalesce(r.code, 'RET-' || r.id), ${MANILA_DAY("r.requested_at")}, r.status, r.credit::float8, 0::float8, null::float8, null, 'from'
        from sales_return r where r.order_id = ${id}`,
    );
  }
  if (kind === "invoice") {
    const [inv] = await rows<{ orderId: number }>(db, sql`select order_id::int as "orderId" from invoice where id = ${id}`);
    if (inv) lines = await orderLines(inv.orderId);
    linkedDocs = await rows<BookLinked>(
      db,
      sql`select -o.id::int as id, 'sales_order' as kind, o.code as number, ${MANILA_DAY("o.created_at")} as date, o.status, o.total::float8 as total, 0::float8 as balance,
          null::float8 as amount, null as on, 'to' as direction
        from invoice i join sales_order o on o.id = i.order_id where i.id = ${id}
        union all
        select -p.id::int, 'customer_payment', 'CRM-' || lpad(p.id::text, 5, '0'), ${DAY("p.paid_on")}, case when p.active then 'paid' else 'void' end,
          p.amount::float8, 0::float8, p.amount::float8, ${DAY("p.paid_on")}, 'from'
        from payment p where p.invoice_id = ${id}`,
    );
  }
  if (kind === "sales_return")
    lines = (
      await rows<{ medicineId: number; name: string; qty: number; price: number; outcome: string | null }>(
        db,
        sql`select l.medicine_id::int as "medicineId", m.name || coalesce(' ' || m.strength, '') as name, l.qty, l.unit_price::float8 as price, l.outcome
          from sales_return_line l join medicine m on m.id = l.medicine_id where l.return_id = ${id} order by l.id`,
      )
    ).map((l, n) => line({ medicineId: l.medicineId, medicine: l.name, itemName: l.name, qty: l.qty, rate: l.price / 100, amount: l.qty * l.price, fields: l.outcome ? { Outcome: l.outcome } : {} }, n + 1));
  return {
    ...row,
    kind,
    fxRate: 1,
    subTotal: null,
    paymentTerms: null,
    notes: null,
    fields: {},
    fromZoho: false,
    zohoCreated: null,
    vendor: null,
    lines,
    linkedDocs,
  };
}
