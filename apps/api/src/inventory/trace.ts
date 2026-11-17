// Batch trace (docs/ERP-PLAN.md phase 3), for a recall or a complaint: a batch number gives the
// medicine, its expiry and cost, where its pieces are now, every move it made, and every customer
// it reached with how many pieces, when, and how to reach them. Read from the stock's own moves.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { allow, Refusal } from "../http";
import type { BatchTrace, Me, Role } from "../types";

/** Who traces a batch: the stock desks, Management, Regulatory, the CEO and the Admin. */
export const TRACE_ROLES: readonly Role[] = ["inventory", "dispatch", "management", "regulatory", "ceo", "admin"];

export async function traceBatch(db: Database, me: Me, asked: { batch?: string | null }): Promise<BatchTrace> {
  allow(me, TRACE_ROLES, "trace a batch");
  const words = asked.batch?.trim();
  if (!words) throw new Refusal(400, "invalid", "Type the batch number.", "batch");
  const batches = await rows<BatchTrace["batches"][number]>(
    db,
    sql`select b.id::int as id, b.batch_no as "batchNo", m.id::int as "medicineId", m.name || coalesce(' ' || m.strength, '') as medicine,
        to_char(b.expires_on, 'YYYY-MM-DD') as expires, b.unit_cost::int as "unitCost",
        coalesce((select sum(s.qty) from stock s where s.batch_id = b.id), 0)::int as "onHand"
      from batch b join medicine m on m.id = b.medicine_id
      where lower(b.batch_no) = lower(${words}) or lower(b.batch_no) like lower(${`%${words}%`})
      order by lower(b.batch_no) = lower(${words}) desc, b.expires_on nulls last limit 20`,
  );
  if (!batches.length) return { batches: [], places: [], moves: [], customers: [] };
  const ids = sql.join(batches.map((one) => sql`${one.id}`), sql`, `);
  const [places, moves, customers] = await Promise.all([
    rows<BatchTrace["places"][number]>(
      db,
      sql`select s.batch_id::int as "batchId", w.name as warehouse, s.qty::int as qty from stock s join warehouse w on w.id = s.warehouse_id
        where s.batch_id in (${ids}) and s.qty > 0 order by w.name`,
    ),
    rows<BatchTrace["moves"][number]>(
      db,
      sql`select m.batch_id::int as "batchId", m.at::text as at, m.kind, m.qty::int as qty, w.name as warehouse, m.ref, m.note, p.name as by,
          o.id::int as "orderId", c.name as customer
        from stock_move m join warehouse w on w.id = m.warehouse_id join person p on p.id = m.by_person
          left join sales_order o on o.code = m.ref left join customer c on c.id = o.customer_id
        where m.batch_id in (${ids}) order by m.at, m.id`,
    ),
    rows<BatchTrace["customers"][number]>(
      db,
      sql`select c.id::int as "customerId", c.name, c.kind, c.phone, coalesce(o.delivery_address, c.address) as address, c.city,
          string_agg(distinct o.code, ', ') as orders, sum(-m.qty)::int as pieces,
          to_char(min((m.at at time zone 'Asia/Manila')::date), 'YYYY-MM-DD') as first, to_char(max((m.at at time zone 'Asia/Manila')::date), 'YYYY-MM-DD') as last,
          coalesce((select sum(l.qty) from sales_return_line l join sales_return r on r.id = l.return_id
            where l.batch_id in (${ids}) and r.order_id = any(array_agg(o.id)) and l.outcome = 'restocked'), 0)::int as returned
        from stock_move m join sales_order o on o.code = m.ref join customer c on c.id = o.customer_id
        where m.batch_id in (${ids}) and m.kind = 'deliver'
        group by c.id, c.name, c.kind, c.phone, coalesce(o.delivery_address, c.address), c.city
        order by pieces desc`,
    ),
  ]);
  return { batches, places, moves, customers };
}
