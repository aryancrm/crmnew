// Demo deliveries for a developer's computer: the demo orders a later step stood "on the way"
// or "completed" get the courier, tracking and receiver Dispatch would have written. Runs once.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";

export async function seedDemoDispatch(db: Database): Promise<boolean> {
  const bare = await rows<{ id: number; status: string }>(
    db,
    sql`select id::int as id, status from sales_order where status in ('shipped', 'completed') and delivery_method is null order by id`,
  );
  if (bare.length === 0) return false;
  const [marco] = await rows<{ id: number }>(
    db,
    sql`select id::int as id from person where role = 'dispatch' and active order by id limit 1`,
  );
  for (const [index, order] of bare.entries()) {
    const rider = index % 3 === 2;
    await db.execute(
      sql`update sales_order set delivery_method = ${rider ? "rider" : "courier"}, courier = ${rider ? null : index % 2 ? "J&T Express" : "LBC"},
          tracking = ${rider ? null : `${index % 2 ? "JT" : "LBC"}-${74120 + order.id}`}, rider = ${rider ? "Jun" : null},
          shipped_at = coalesce(shipped_at, updated_at), shipped_by = ${marco?.id ?? null},
          delivered_on = ${order.status === "completed" ? sql`(updated_at at time zone 'Asia/Manila')::date` : null},
          delivered_at = ${order.status === "completed" ? sql`updated_at` : null},
          received_by = ${order.status === "completed" ? "Pharmacy receiving" : null}
        where id = ${order.id}`,
    );
  }
  return true;
}
