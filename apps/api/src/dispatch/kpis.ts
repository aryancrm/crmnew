// Dispatch's Home figures, read the way Management's are: what waits in the warehouse now (to
// pack, to ship, came back, on the road) and since when, and the warehouse's work in a day or this
// month (packed, shipped, delivered, came back, pieces out, how long an order takes from reaching
// Dispatch to leaving), by courier. Step times come from `order_step` (migration 0023), so the
// figures count from when an order reached each step. A handful of grouped queries.

import { type SQL, sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { allow } from "../http";
import { addDays, todayManila } from "../inventory/rules";
import { iso } from "../inventory/service";
import type { DispatchKpis, Me, MyKpisPeriod } from "../types";
import { DISPATCH_READ_ROLES } from "./rules";

export async function dispatchKpis(
  db: Database,
  me: Me,
  asked: { period?: string; day?: string },
): Promise<DispatchKpis> {
  allow(me, DISPATCH_READ_ROLES, "see Dispatch's figures");
  const today = todayManila();
  const period: MyKpisPeriod =
    asked.period === "yesterday" || asked.period === "month" || asked.period === "day"
      ? asked.period
      : "today";
  const day =
    /^\d{4}-\d{2}-\d{2}$/.test(asked.day ?? "") && (asked.day as string) <= today
      ? (asked.day as string)
      : today;
  const shown = period === "day" ? day : period === "yesterday" ? addDays(today, -1) : today;
  const within = (column: SQL): SQL =>
    period === "month"
      ? sql`date_trunc('month', (${column} at time zone 'Asia/Manila')::date) = date_trunc('month', ${today}::date)`
      : sql`(${column} at time zone 'Asia/Manila')::date = ${shown}::date`;
  // An order coming back: a step back to packed straight after it was on the road.
  const cameBack = sql`s.status = 'packing' and exists (select 1 from order_step p
    where p.order_id = s.order_id and p.status = 'shipped' and p.left_at = s.entered_at)`;

  const [now, work, couriers] = await Promise.all([
    rows<DispatchKpis["now"]>(
      db,
      sql`select count(*) filter (where o.status = 'ready_for_dispatch')::int as "toPack",
          count(*) filter (where o.status = 'packing' and o.came_back_at is null)::int as "toShip",
          count(*) filter (where o.status = 'packing' and o.came_back_at is not null)::int as "cameBack",
          count(*) filter (where o.status = 'shipped')::int as "onTheWay",
          count(*) filter (where o.status = 'completed' and o.delivered_on = ${today}::date)::int as "deliveredToday",
          count(*) filter (where o.status in ('ready_for_dispatch', 'packing') and o.expected_on <= ${today}::date)::int as "dueToday",
          count(*) filter (where o.status in ('ready_for_dispatch', 'packing') and o.dispatch_by = ${me.id})::int as mine,
          ${iso("min(o.status_since) filter (where o.status = 'ready_for_dispatch')")} as "oldestToPack",
          ${iso("min(o.status_since) filter (where o.status = 'packing')")} as "oldestToShip",
          ${iso("min(o.shipped_at) filter (where o.status = 'shipped')")} as "oldestOnTheWay"
        from sales_order o where o.status in ('ready_for_dispatch', 'packing', 'shipped', 'completed')`,
    ),
    rows<DispatchKpis["work"]>(
      db,
      sql`select
          (select count(distinct s.order_id) from order_step s where s.status = 'packing' and not (${cameBack}) and ${within(sql`s.entered_at`)})::int as packed,
          (select count(distinct s.order_id) from order_step s where s.status = 'shipped' and ${within(sql`s.entered_at`)})::int as shipped,
          (select count(*) from sales_order o where o.status = 'completed' and o.delivered_at is not null and ${within(sql`o.delivered_at`)})::int as delivered,
          (select count(*) from order_step s where ${cameBack} and ${within(sql`s.entered_at`)})::int as "cameBack",
          (select coalesce(sum(i.qty), 0) from order_item i where i.order_id in (select s.order_id from order_step s
            where s.status = 'shipped' and ${within(sql`s.entered_at`)}))::int as pieces,
          -- From reaching Dispatch to leaving, for orders that left in the period.
          (select round(avg(extract(epoch from (s.entered_at - r.reached)) / 60))
            from order_step s
            join lateral (select min(p.entered_at) as reached from order_step p
              where p.order_id = s.order_id and p.status = 'ready_for_dispatch' and p.entered_at <= s.entered_at) r on true
            where s.status = 'shipped' and r.reached is not null and ${within(sql`s.entered_at`)})::int as "avgMinutes"`,
    ),
    rows<DispatchKpis["byCourier"][number]>(
      db,
      sql`select s.how as courier, count(distinct s.order_id)::int as orders
        from order_step s
        where s.how is not null and (s.status = 'shipped' or s.how = 'Picked up') and ${within(sql`s.entered_at`)}
        group by 1 order by 2 desc, 1`,
    ),
  ]);
  return {
    period,
    day: shown,
    today,
    now: now[0] ?? {
      toPack: 0,
      toShip: 0,
      cameBack: 0,
      onTheWay: 0,
      deliveredToday: 0,
      dueToday: 0,
      mine: 0,
      oldestToPack: null,
      oldestToShip: null,
      oldestOnTheWay: null,
    },
    work: work[0] ?? {
      packed: 0,
      shipped: 0,
      delivered: 0,
      cameBack: 0,
      pieces: 0,
      avgMinutes: null,
    },
    byCourier: couriers,
  };
}
