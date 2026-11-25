// Waiting for stock: Management (or Dispatch) holds an order until what it needs is on the shelf,
// instead of sending it back. Its lines are short when the sellable pieces (unexpired) less what
// the orders ahead of it (placed before it, or approved already) are promised don't cover them.
// When stock comes in (received, counted up, put back, an order cancelled), the person who held it
// and the MedRep are told once per wait; the holder resumes it as any hold.

import { type SQL, sql } from "drizzle-orm";
import { rows } from "../db/index";
import { todayManila } from "../inventory/rules";
import { PROMISED_ORDER, type Runner } from "../inventory/service";
import { notify } from "../notify/service";

/**
 * The orders (alias `o`) whose pieces come before an order's own: those placed before it, and those
 * Management has already approved. First placed, first served (Aryan, 23 Nov: "if the stock fills
 * one order, that one goes; the rest are held or sent back"): 20 pieces with six orders wanting
 * 210 used to wait for all 210, each order counting every other's promise.
 */
export const aheadOf = (orderId: SQL | number): SQL => sql`(${PROMISED_ORDER} and o.id <> ${orderId}
  and (o.id < ${orderId}
    or o.status in ('finance_check', 'ready_for_invoice', 'ready_for_dispatch')
    or (o.status in ('on_hold', 'exception') and o.held_from in ('finance_check', 'ready_for_invoice', 'ready_for_dispatch'))))`;

export type ShortLine = { name: string; need: number; free: number };

/** What an order needs that isn't free on the shelf once the orders ahead of it have theirs. */
export async function shortLines(db: Runner, orderId: number): Promise<ShortLine[]> {
  const today = todayManila();
  return rows<ShortLine>(
    db,
    sql`with need as (
          select i.medicine_id, sum(i.qty)::int as qty from order_item i where i.order_id = ${orderId} group by 1
        )
        select m.name || coalesce(' ' || m.strength, '') as name, n.qty as need,
          greatest(0,
            coalesce((select sum(s.qty) from stock s join batch b on b.id = s.batch_id
              where b.medicine_id = n.medicine_id and s.qty > 0 and b.expires_on >= ${today}::date), 0)
            - coalesce((select sum(i.qty) from order_item i join sales_order o on o.id = i.order_id
              where i.medicine_id = n.medicine_id and ${aheadOf(orderId)}), 0)
          )::int as free
        from need n join medicine m on m.id = n.medicine_id
        order by m.name`,
  ).then((found) => found.filter((one) => one.free < one.need));
}

export const shortWords = (short: ShortLine[]) =>
  short
    .map(
      (one) =>
        `${one.name} (needs ${one.need.toLocaleString("en-PH")}, ${one.free.toLocaleString("en-PH")} free)`,
    )
    .join("; ");

/** After stock came in: tell the holder and the MedRep of each waiting order now covered. */
export async function tellStockBack(db: Runner): Promise<number> {
  const waiting = await rows<{
    id: number;
    code: string;
    medrepId: number;
    by: number | null;
    since: string;
  }>(
    db,
    sql`select id::int as id, code, medrep_id::int as "medrepId", waiting_stock_by::int as by,
        extract(epoch from waiting_stock_at)::bigint::text as since
      from sales_order where status = 'on_hold' and waiting_stock_at is not null`,
  );
  let told = 0;
  for (const order of waiting) {
    if ((await shortLines(db, order.id)).length) continue;
    told += 1;
    if (order.by)
      await notify(db, {
        to: [order.by],
        kind: "stock_back",
        title: `Stock is in for ${order.code}: take it off hold`,
        body: "Everything it was waiting for is on the shelf now.",
        link: `/orders/${order.id}`,
        orderId: order.id,
        key: `stock-back:${order.id}:${order.since}`,
      });
    await notify(db, {
      to: [order.medrepId].filter((id) => id !== order.by),
      kind: "stock_back_info",
      title: `Stock is in for your order ${order.code}`,
      body: "It goes on once Management takes it off hold.",
      link: `/orders/${order.id}`,
      orderId: order.id,
      key: `stock-back:${order.id}:${order.since}`,
    });
  }
  return told;
}

/** After stock came in, quietly: telling never fails the work that brought the stock. */
export async function afterStockIn(db: Runner): Promise<void> {
  try {
    await tellStockBack(db);
  } catch (error) {
    console.error("[stock back]", error);
  }
}
