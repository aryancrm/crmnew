// The company's figures for Management's Home, in the same shape as a MedRep's (orders/my-kpis.ts)
// so both Homes read alike: orders submitted in a day or this month and where they stand now,
// what waits for Management right now, this month's invoiced sales against everyone's targets,
// and who sold what (by MedRep, by channel) in the period. Every order, for the roles that see
// every order; a handful of grouped queries, whatever the number of orders.

import { type SQL, sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { allow } from "../http";
import { addDays, todayManila } from "../inventory/rules";
import { iso } from "../inventory/service";
import { creditedTo } from "../org/service";
import type { CompanyKpis, Me, MyKpisPeriod, OrderStatus } from "../types";
import { ORDER_ALL_ROLES } from "./rules";

const PENDING: OrderStatus[] = [
  "pending_approval",
  "finance_check",
  "ready_for_invoice",
  "on_hold",
  "exception",
];
const FULFILMENT: OrderStatus[] = ["ready_for_dispatch", "packing", "shipped"];

export async function companyKpis(
  db: Database,
  me: Me,
  asked: { period?: string; day?: string },
): Promise<CompanyKpis> {
  allow(me, ORDER_ALL_ROLES, "see the company's orders");
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
  const placedOn = sql`(coalesce(o.submitted_at, o.created_at) at time zone 'Asia/Manila')::date`;
  const within = (column: SQL): SQL =>
    period === "month"
      ? sql`date_trunc('month', ${column}) = date_trunc('month', ${today}::date)`
      : sql`${column} = ${shown}::date`;
  const inPeriod = sql`o.status <> 'draft' and ${within(placedOn)}`;
  const month = sql`date_trunc('month', ${today}::date)`;

  const [byStatus, now, totals, byRep, byChannel, added] = await Promise.all([
    rows<{ status: OrderStatus; n: number; value: number }>(
      db,
      sql`select o.status, count(*)::int as n, coalesce(sum(o.total), 0)::int as value
        from sales_order o where ${inPeriod} group by o.status`,
    ),
    // What waits right now, whenever it was placed.
    rows<{
      waiting: number;
      oldest: string | null;
      onHold: number;
      toPack: number;
      onTheWay: number;
    }>(
      db,
      sql`select count(*) filter (where o.status = 'pending_approval')::int as waiting,
          ${iso("min(o.status_since) filter (where o.status = 'pending_approval')")} as oldest,
          count(*) filter (where o.status in ('on_hold', 'exception'))::int as "onHold",
          count(*) filter (where o.status in ('ready_for_dispatch', 'packing'))::int as "toPack",
          count(*) filter (where o.status = 'shipped')::int as "onTheWay"
        from sales_order o`,
    ),
    rows<{
      todayN: number;
      todayValue: number;
      monthN: number;
      monthValue: number;
      sales: number;
      target: number;
    }>(
      db,
      sql`select
          count(*) filter (where ${placedOn} = ${today}::date)::int as "todayN",
          coalesce(sum(o.total) filter (where ${placedOn} = ${today}::date and o.status <> 'cancelled'), 0)::int as "todayValue",
          count(*) filter (where date_trunc('month', ${placedOn}) = ${month})::int as "monthN",
          coalesce(sum(o.total) filter (where date_trunc('month', ${placedOn}) = ${month} and o.status <> 'cancelled'), 0)::int as "monthValue",
          coalesce((select sum(i.total) from invoice i where i.status <> 'cancelled'
            and date_trunc('month', i.issued_on) = ${month}), 0)::float8 as sales,
          coalesce((select sum(t.amount) from sales_target t where t.month = ${month}::date), 0)::float8 as target
        from sales_order o where o.status <> 'draft'`,
    ),
    rows<CompanyKpis["byRep"][number]>(
      db,
      sql`select rep.id::int as id, rep.name, ch.code as channel, count(*)::int as orders,
          coalesce(sum(o.total) filter (where o.status <> 'cancelled'), 0)::int as value,
          count(*) filter (where o.status = 'completed')::int as completed
        from sales_order o join person rep on rep.id = ${creditedTo(today)} left join channel ch on ch.id = o.channel_id
        where ${inPeriod}
        group by rep.id, rep.name, ch.code
        order by value desc, orders desc limit 12`,
    ),
    rows<CompanyKpis["byChannel"][number]>(
      db,
      sql`select coalesce(ch.code, 'Other') as channel, count(*)::int as orders,
          coalesce(sum(o.total) filter (where o.status <> 'cancelled'), 0)::int as value
        from sales_order o left join channel ch on ch.id = o.channel_id
        where ${inPeriod}
        group by ch.code order by value desc`,
    ),
    rows<{ n: number; toReview: number }>(
      db,
      sql`select count(*) filter (where ${within(sql`(c.created_at at time zone 'Asia/Manila')::date`)})::int as n,
          count(*) filter (where c.review = 'to_review')::int as "toReview"
        from customer c where c.active`,
    ),
  ]);
  const sum = (statuses: OrderStatus[] | null, key: "n" | "value") =>
    byStatus
      .filter((row) =>
        statuses ? statuses.includes(row.status) : key === "n" || row.status !== "cancelled",
      )
      .reduce((total, row) => total + row[key], 0);
  const t = totals[0];
  const w = now[0];
  return {
    period,
    day: shown,
    today,
    submitted: sum(null, "n"),
    submittedValue: sum(null, "value"),
    pending: sum(PENDING, "n"),
    fulfilment: sum(FULFILMENT, "n"),
    completed: sum(["completed"], "n"),
    completedValue: sum(["completed"], "value"),
    cancelled: sum(["cancelled"], "n"),
    newCustomers: added[0]?.n ?? 0,
    toReview: added[0]?.toReview ?? 0,
    todayOrders: t?.todayN ?? 0,
    todayValue: t?.todayValue ?? 0,
    monthOrders: t?.monthN ?? 0,
    monthValue: t?.monthValue ?? 0,
    sales: t?.sales ?? 0,
    target: t?.target ?? 0,
    waiting: w?.waiting ?? 0,
    oldestWaiting: w?.oldest ?? null,
    onHold: w?.onHold ?? 0,
    toPack: w?.toPack ?? 0,
    onTheWay: w?.onTheWay ?? 0,
    byRep,
    byChannel,
  };
}
