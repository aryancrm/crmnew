// The customer behind a case, as the old CRM's "This customer's orders" bar shows them: every
// order and every other enquiry on the same mobile number (or the same customer on file),
// newest first, with where each stands. The number is who they are; names are never matched.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { iso } from "../inventory/service";
import { STATUS_LABEL } from "../orders/rules";
import type { CaseHistory, OrderStatus } from "../types";

const LIMIT = 50;

export async function caseHistory(
  db: Database,
  lead: { id: number; phoneKey: string | null; customerId: number | null },
): Promise<CaseHistory> {
  if (!lead.phoneKey && !lead.customerId)
    return {
      number: null,
      customerId: null,
      orders: [],
      enquiries: [],
      ordersTotal: 0,
      enquiriesTotal: 0,
    };
  // The same person: their number on any case, or the customer the case is linked to.
  const sameCase = sql`(${lead.phoneKey ? sql`l.phone_key = ${lead.phoneKey}` : sql`false`}
    or ${lead.customerId ? sql`l.customer_id = ${lead.customerId}` : sql`false`})`;
  const customers = sql`(select ${lead.customerId ?? null}::bigint union
    select l.customer_id from lead l where ${sameCase} and l.customer_id is not null)`;
  const [orders, enquiries, totals] = await Promise.all([
    rows<{
      id: number;
      code: string;
      total: number;
      status: OrderStatus;
      at: string;
      leadId: number | null;
      medicines: string | null;
      invoiceBalance: number | null;
    }>(
      db,
      sql`select o.id::int as id, o.code, o.total::int as total, o.status, ${iso("o.created_at")} as at,
          o.lead_id::int as "leadId",
          (select string_agg(m.name || ' × ' || i.qty, ', ' order by i.id) from order_item i
             join medicine m on m.id = i.medicine_id where i.order_id = o.id) as medicines,
          (select (v.total - v.paid)::int from invoice v where v.order_id = o.id and v.status <> 'cancelled'
             order by v.id desc limit 1) as "invoiceBalance"
        from sales_order o
        where o.status <> 'draft' and (o.customer_id in ${customers}
          or o.lead_id in (select l.id from lead l where ${sameCase}))
        order by o.created_at desc, o.id desc limit ${LIMIT}`,
    ),
    rows<{
      id: number;
      code: string;
      state: string;
      at: string;
      orderCode: string | null;
      request: string | null;
    }>(
      db,
      sql`select l.id::int as id, l.code, l.state, ${iso("l.first_contact_at")} as at,
          o.code as "orderCode", l.request
        from lead l left join sales_order o on o.id = l.order_id
        where ${sameCase} and l.id <> ${lead.id}
        order by l.first_contact_at desc, l.id desc limit ${LIMIT}`,
    ),
    rows<{ orders: number; enquiries: number }>(
      db,
      sql`select
          (select count(*) from sales_order o where o.status <> 'draft' and (o.customer_id in ${customers}
            or o.lead_id in (select l.id from lead l where ${sameCase})))::int as orders,
          (select count(*) from lead l where ${sameCase} and l.id <> ${lead.id})::int as enquiries`,
    ),
  ]);
  return {
    number: lead.phoneKey,
    customerId:
      lead.customerId ??
      (
        await rows<{ id: number }>(
          db,
          sql`select l.customer_id::int as id from lead l where ${sameCase} and l.customer_id is not null
          order by l.id desc limit 1`,
        )
      )[0]?.id ??
      null,
    orders: orders.map((order) => ({ ...order, statusLabel: STATUS_LABEL[order.status] })),
    enquiries,
    ordersTotal: totals[0]?.orders ?? 0,
    enquiriesTotal: totals[0]?.enquiries ?? 0,
  };
}
