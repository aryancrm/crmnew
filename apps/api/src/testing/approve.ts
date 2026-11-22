// Tests approve orders without the screen: every Management check is marked approved first
// (the API refuses Approve until each is), by the first Management person. And since what isn't
// in stock can't be approved (23 Nov), the shelf is topped up first with what the order is short
// of; a test about short stock takes that back with `shelfBack` (stock that went after approval).

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { tickChecks } from "../orders/service";
import { todayManila } from "../inventory/rules";
import { PROMISED_ORDER } from "../inventory/service";
import { shortLines } from "../orders/stock-wait";

const topped = new Map<number, { batchId: number; warehouseId: number; qty: number }[]>();

/** Puts on the default warehouse's shelf exactly what the order is short of (its newest batch):
 *  nothing is left over, so an order placed after it is as short as it would have been. */
export async function shelfUp(db: Database, orderId: number): Promise<void> {
  const today = todayManila();
  await mainUp(db, orderId, today);
  if (!(await shortLines(db, orderId)).length) return;
  const lines = await rows<{ deficit: number; batchId: number | null; warehouseId: number | null }>(
    db,
    sql`with need as (select i.medicine_id, sum(i.qty)::int as qty from order_item i where i.order_id = ${orderId} group by 1)
      select (n.qty
          + coalesce((select sum(i.qty) from order_item i join sales_order o on o.id = i.order_id
              where i.medicine_id = n.medicine_id and o.id <> ${orderId} and ${PROMISED_ORDER}), 0)
          - coalesce((select sum(s.qty) from stock s join batch b on b.id = s.batch_id
              where b.medicine_id = n.medicine_id and s.qty > 0 and b.expires_on >= ${today}::date), 0))::int as deficit,
        pick.batch_id::int as "batchId", pick.warehouse_id::int as "warehouseId"
      from need n left join lateral (select s.batch_id, s.warehouse_id from stock s join batch b on b.id = s.batch_id join warehouse w on w.id = s.warehouse_id
        where b.medicine_id = n.medicine_id and w.active and b.expires_on >= ${today}::date order by w.is_default desc, b.expires_on desc limit 1) pick on true`,
  );
  const added = topped.get(orderId) ?? [];
  for (const one of lines) {
    if (one.deficit <= 0 || !one.batchId || !one.warehouseId) continue;
    await db.execute(sql`update stock set qty = qty + ${one.deficit} where batch_id = ${one.batchId} and warehouse_id = ${one.warehouseId}`);
    added.push({ batchId: one.batchId, warehouseId: one.warehouseId, qty: one.deficit });
  }
  topped.set(orderId, added);
}

/** The default warehouse itself has what the order needs (enough in the company but in another
 *  warehouse is refused for the one picked): its newest batch gets what is missing there. */
async function mainUp(db: Database, orderId: number, today: string): Promise<void> {
  const lines = await rows<{ deficit: number; batchId: number | null; warehouseId: number }>(
    db,
    sql`with need as (select i.medicine_id, sum(i.qty)::int as qty from order_item i where i.order_id = ${orderId} group by 1),
        main as (select id from warehouse where active order by is_default desc, id limit 1)
      select (n.qty
          + coalesce((select sum(i.qty) from order_item i join sales_order o on o.id = i.order_id
              where o.warehouse_id = (select id from main) and i.medicine_id = n.medicine_id and o.id <> ${orderId} and ${PROMISED_ORDER}), 0)
          - coalesce((select sum(s.qty) from stock s join batch b on b.id = s.batch_id
              where s.warehouse_id = (select id from main) and b.medicine_id = n.medicine_id and s.qty > 0 and b.expires_on >= ${today}::date), 0))::int as deficit,
        (select s.batch_id::int from stock s join batch b on b.id = s.batch_id
          where s.warehouse_id = (select id from main) and b.medicine_id = n.medicine_id and b.expires_on >= ${today}::date order by b.expires_on desc limit 1) as "batchId",
        (select id::int from main) as "warehouseId"
      from need n`,
  );
  const added = topped.get(orderId) ?? [];
  for (const one of lines) {
    if (one.deficit <= 0 || !one.batchId) continue;
    await db.execute(sql`update stock set qty = qty + ${one.deficit} where batch_id = ${one.batchId} and warehouse_id = ${one.warehouseId}`);
    added.push({ batchId: one.batchId, warehouseId: one.warehouseId, qty: one.deficit });
  }
  topped.set(orderId, added);
}

/** Takes back what `ticked` put on the shelf for an order: the stock went after it was approved. */
export async function shelfBack(db: Database, orderId: number): Promise<void> {
  for (const one of topped.get(orderId) ?? [])
    await db.execute(sql`update stock set qty = greatest(0, qty - ${one.qty}) where batch_id = ${one.batchId} and warehouse_id = ${one.warehouseId}`);
  topped.delete(orderId);
}

/** Marks the order's checks approved and gives the address back, to post to. */
export async function ticked(db: Database, path: string): Promise<string> {
  const id = Number(path.match(/\/orders\/(\d+)\/approve$/)?.[1]);
  const [who] = await rows<{ id: number }>(db, sql`select id::int as id from person where role = 'management' and active order by id limit 1`);
  if (id) await shelfUp(db, id);
  if (id && who) await tickChecks(db, id, who.id);
  return path;
}
