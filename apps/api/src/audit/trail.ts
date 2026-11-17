// Audit (docs/ERP-PLAN.md phase 2): who did what, when, across the CRM, in one list: every step of
// an order, a case, a tender, a registration, every stock move, payment, refund and seat change,
// and Zoho's own activity log brought in with the books. Read from the logs each part already
// keeps, so nothing is written twice and nothing can be left out of it. For the CEO and the Admin.

import { type SQL, sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { allow } from "../http";
import type { AuditTrail, Me } from "../types";

export const AUDIT_KINDS: Record<string, string> = {
  order: "Orders",
  case: "Cases (online)",
  tender: "Tenders",
  regulatory: "Regulatory",
  stock: "Stock",
  money: "Payments and refunds",
  people: "Seats and people",
  zoho: "Zoho's own log",
};

/** Every line any log holds: when, who, what kind, about which record, what happened. */
const TRAIL = sql`(
  select e.at, p.name as who, 'order' as kind, o.code as record, '/orders/' || o.id as link, e.message as what
    from order_event e join person p on p.id = e.by_person join sales_order o on o.id = e.order_id
  union all
  select e.at, p.name, 'case', 'Case ' || e.lead_id, '/leads/' || e.lead_id, e.message
    from lead_event e join person p on p.id = e.by_person
  union all
  select e.at, p.name, 'tender', t.code, '/tenders/' || t.id, initcap(replace(e.step, '_', ' ')) || coalesce(': ' || e.note, '')
    from tender_event e join person p on p.id = e.by_person join tender t on t.id = e.tender_id
  union all
  select e.at, p.name, 'regulatory', null, case when e.pipeline_id is not null then '/regulatory/pipeline' else '/regulatory/registrations' end, e.what
    from reg_event e join person p on p.id = e.by_person
  union all
  select m.at, p.name, 'stock', m.ref, null,
      initcap(replace(m.kind, '_', ' ')) || ' ' || m.qty || ' × ' || md.name || coalesce(' (batch ' || b.batch_no || ')', '') || coalesce(' · ' || w.name, '') || coalesce(': ' || m.note, '')
    from stock_move m join person p on p.id = m.by_person join medicine md on md.id = m.medicine_id
      left join batch b on b.id = m.batch_id left join warehouse w on w.id = m.warehouse_id
  union all
  select y.at, p.name, 'money', i.code, '/invoices/' || i.id,
      'Payment recorded: ' || to_char(y.amount / 100.0, 'FM999,999,990.00') || ' by ' || y.method || coalesce(' into ' || y.money_account, '') || coalesce(' (ref ' || y.reference || ')', '')
    from payment y join person p on p.id = y.by_person join invoice i on i.id = y.invoice_id
  union all
  select y.removed_at, p.name, 'money', i.code, '/invoices/' || i.id,
      'Payment taken off: ' || to_char(y.amount / 100.0, 'FM999,999,990.00') || coalesce(': ' || y.removed_reason, '')
    from payment y join person p on p.id = y.removed_by join invoice i on i.id = y.invoice_id where y.removed_at is not null
  union all
  select r.at, p.name, 'money', i.code, '/invoices/' || i.id,
      'Refund: ' || to_char(r.amount / 100.0, 'FM999,999,990.00') || ' by ' || r.method || coalesce(' out of ' || r.money_account, '')
    from refund r join person p on p.id = r.by_person join invoice i on i.id = r.invoice_id
  union all
  select h.at, p.name, 'people', s.title, null,
      who.name || case when h.kind = 'acting' then ' covers ' else ' put in ' end || s.title || ' from ' || to_char(h.starts_on, 'DD Mon YYYY') || coalesce(': ' || h.reason, '')
    from seat_holder h join person p on p.id = h.by_person join person who on who.id = h.person_id join seat s on s.id = h.seat_id
  union all
  select h.ends_on::timestamptz, p.name, 'people', s.title, null,
      who.name || ' left ' || s.title || ' on ' || to_char(h.ends_on, 'DD Mon YYYY') || coalesce(': ' || h.end_reason, '')
    from seat_holder h join person p on p.id = h.ended_by join person who on who.id = h.person_id join seat s on s.id = h.seat_id where h.ends_on is not null
  union all
  select a.at, coalesce(a.user_name, 'Zoho'), 'zoho', a.transaction_name, null,
      concat_ws(' · ', a.operation, a.transaction_type, a.customer_name, a.description)
    from book_activity a where a.at is not null
) t`;

export async function auditTrail(
  db: Database,
  me: Me,
  asked: { kind?: string | null; who?: string | null; q?: string | null; from?: string | null; to?: string | null; page?: number },
): Promise<AuditTrail> {
  allow(me, ["ceo", "admin"], "read the audit");
  const day = (value?: string | null) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null);
  const filters: SQL[] = [sql`t.at is not null`];
  if (asked.kind && AUDIT_KINDS[asked.kind]) filters.push(sql`t.kind = ${asked.kind}`);
  if (asked.who?.trim()) filters.push(sql`t.who ilike ${`%${asked.who.trim()}%`}`);
  if (asked.q?.trim()) filters.push(sql`(t.what ilike ${`%${asked.q.trim()}%`} or t.record ilike ${`%${asked.q.trim()}%`})`);
  if (day(asked.from)) filters.push(sql`t.at >= (${day(asked.from)}::date)::timestamp at time zone 'Asia/Manila'`);
  if (day(asked.to)) filters.push(sql`t.at < (${day(asked.to)}::date + 1)::timestamp at time zone 'Asia/Manila'`);
  const where = sql.join(filters, sql` and `);
  const perPage = 50;
  const page = Math.max(1, asked.page ?? 1);
  const lines = await rows<AuditTrail["lines"][number]>(
    db,
    sql`select t.at::text as at, t.who, t.kind, t.record, t.link, t.what from ${TRAIL} where ${where}
      order by t.at desc limit ${perPage + 1} offset ${(page - 1) * perPage}`,
  );
  return {
    kinds: Object.entries(AUDIT_KINDS).map(([key, label]) => ({ key, label })),
    page,
    more: lines.length > perPage,
    lines: lines.slice(0, perPage),
  };
}
