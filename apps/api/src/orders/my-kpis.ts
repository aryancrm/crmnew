// A MedRep's own figures for a day or a month, for their Home: how many orders they submitted and
// for how much, and where those orders stand now (waiting for Management or Finance, being packed
// or on the way, delivered, cancelled), plus the customers they added. Only their own orders: the
// ones they placed or that are theirs as MedRep. One read, a handful of grouped queries.
//
// The scorecard is this month's card from the scorecard engine (src/scores): the seat's
// playbook card, worked out live; My score has the whole of it.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { addDays, todayManila } from "../inventory/rules";
import { iso } from "../inventory/service";
import type { Me, MyKpis, MyKpisPeriod, OrderStatus } from "../types";
import { cardOf } from "../scores/service";
import { STATUS_LABEL } from "./rules";

const PENDING: OrderStatus[] = [
  "pending_approval",
  "finance_check",
  "ready_for_invoice",
  "on_hold",
  "exception",
];
const FULFILMENT: OrderStatus[] = ["ready_for_dispatch", "packing", "shipped"];

export async function myKpis(
  db: Database,
  me: Me,
  asked: { period?: string; day?: string },
): Promise<MyKpis> {
  const today = todayManila();
  const period: MyKpisPeriod =
    asked.period === "yesterday" || asked.period === "month" || asked.period === "day"
      ? asked.period
      : "today";
  const day =
    /^\d{4}-\d{2}-\d{2}$/.test(asked.day ?? "") && (asked.day as string) <= today
      ? (asked.day as string)
      : today;
  const placedOn = sql`(coalesce(o.submitted_at, o.created_at) at time zone 'Asia/Manila')::date`;
  const inPeriod =
    period === "month"
      ? sql`date_trunc('month', ${placedOn}) = date_trunc('month', ${today}::date)`
      : sql`${placedOn} = ${period === "yesterday" ? addDays(today, -1) : period === "day" ? day : today}::date`;
  // A sale made covering a vacant area is the team's, not their KPI (HR-PLAN, moves and vacant seats).
  const mine = sql`((o.medrep_id = ${me.id} and not o.covered) or o.raised_by = ${me.id}) and o.status <> 'draft'`;

  const [byStatus, orders, added, todayRow, monthRow] = await Promise.all([
    rows<{ status: OrderStatus; n: number; value: number }>(
      db,
      sql`select o.status, count(*)::int as n, coalesce(sum(o.total), 0)::float8 as value
        from sales_order o where ${mine} and ${inPeriod} group by o.status`,
    ),
    rows<Omit<MyKpis["orders"][number], "statusLabel">>(
      db,
      sql`select o.id::int as id, o.code, c.name as customer, c.kind as "customerKind", o.total::int as total, o.status,
          ${iso("coalesce(o.submitted_at, o.created_at)")} as at,
          (select string_agg(m.name || coalesce(' ' || m.strength, '') || ' × ' || i.qty, ', ' order by i.id)
             from order_item i join medicine m on m.id = i.medicine_id where i.order_id = o.id) as lines,
          exists (select 1 from order_version v where v.order_id = o.id and v.kind = 'changed') as changed
        from sales_order o join customer c on c.id = o.customer_id
        where ${mine} and ${inPeriod}
        order by coalesce(o.submitted_at, o.created_at) desc, o.id desc limit 50`,
    ),
    rows<{ n: number }>(
      db,
      sql`select count(*)::int as n from customer c where c.added_by = ${me.id} and c.active
        and ${
          period === "month"
            ? sql`date_trunc('month', (c.created_at at time zone 'Asia/Manila')::date) = date_trunc('month', ${today}::date)`
            : sql`(c.created_at at time zone 'Asia/Manila')::date = ${period === "yesterday" ? addDays(today, -1) : period === "day" ? day : today}::date`
        }`,
    ),
    rows<{ n: number; value: number }>(
      db,
      sql`select count(*) filter (where o.status <> 'cancelled')::int as n, coalesce(sum(o.total) filter (where o.status <> 'cancelled'), 0)::float8 as value from sales_order o
        where ${mine} and ${placedOn} = ${today}::date`,
    ),
    rows<{ n: number; value: number }>(
      db,
      sql`select count(*) filter (where o.status <> 'cancelled')::int as n, coalesce(sum(o.total) filter (where o.status <> 'cancelled'), 0)::float8 as value from sales_order o
        where ${mine} and date_trunc('month', ${placedOn}) = date_trunc('month', ${today}::date)`,
    ),
  ]);
  const scorecard = await monthScorecard(db, me, today);
  const sum = (statuses: OrderStatus[], key: "n" | "value") =>
    byStatus
      .filter((row) => statuses.includes(row.status))
      .reduce((total, row) => total + row[key], 0);
  const all = byStatus.map((row) => row.status);
  return {
    period,
    day: period === "day" ? day : period === "yesterday" ? addDays(today, -1) : today,
    today,
    submitted: sum(all, "n"),
    submittedValue: sum(
      all.filter((status) => status !== "cancelled"),
      "value",
    ),
    pending: sum(PENDING, "n"),
    fulfilment: sum(FULFILMENT, "n"),
    completed: sum(["completed"], "n"),
    completedValue: sum(["completed"], "value"),
    cancelled: sum(["cancelled"], "n"),
    newCustomers: added[0]?.n ?? 0,
    todayOrders: todayRow[0]?.n ?? 0,
    todayValue: todayRow[0]?.value ?? 0,
    monthOrders: monthRow[0]?.n ?? 0,
    monthValue: monthRow[0]?.value ?? 0,
    orders: orders.map((order) => ({ ...order, statusLabel: STATUS_LABEL[order.status] })),
    scorecard,
  };
}

/** This month's card from the scorecard engine (src/scores), in the Home's shape. */
async function monthScorecard(db: Database, me: Me, today: string): Promise<MyKpis["scorecard"]> {
  const card = await cardOf(db, me.id, today.slice(0, 7), today);
  const month = new Date(`${today}T00:00:00Z`).toLocaleDateString("en-PH", { month: "long", timeZone: "UTC" });
  if (!card) return { card: "No scorecard", month, total: 0, max: 0, status: "none", capped: false, kpis: [] };
  return {
    card: card.label,
    month,
    total: card.total,
    max: card.max,
    status: card.max === 0 ? "none" : card.percent >= 80 ? "strong" : card.total > 0 ? "watch" : "review",
    capped: card.capped,
    kpis: card.kpis.map((kpi) => ({
      code: kpi.key.toUpperCase(),
      label: ((part) => part.charAt(0).toUpperCase() + part.slice(1))(kpi.label.split(" · ")[1] ?? kpi.label),
      value: kpi.value === null ? null : Math.round(kpi.value),
      unit: kpi.unit,
      weight: kpi.weight,
      points: kpi.points,
      note: kpi.note,
    })),
  };
}
