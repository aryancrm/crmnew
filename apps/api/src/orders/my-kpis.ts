// A MedRep's own figures for a day or a month, for their Home: how many orders they submitted and
// for how much, and where those orders stand now (waiting for Management or Finance, being packed
// or on the way, delivered, cancelled), plus the customers they added. Only their own orders: the
// ones they placed or that are theirs as MedRep. One read, a handful of grouped queries.
//
// The scorecard is the old CRM's Hospital CHC card (backend/platform/src/scorecards.ts, the
// Hospital Division play book), for this month so far: IST sales against the target on the
// month-end pace (50), DSO days to collect (20), HRR last month's customers who bought again
// (15), NZSD weekdays with a delivery (15). A KPI with nothing to measure yet is left out of
// the maximum, never scored 0; IST at 60% or less caps the total at 40.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { addDays, todayManila } from "../inventory/rules";
import { iso } from "../inventory/service";
import type { Me, MyKpis, MyKpisPeriod, OrderStatus } from "../types";
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
  const mine = sql`(o.medrep_id = ${me.id} or o.raised_by = ${me.id}) and o.status <> 'draft'`;

  const [byStatus, orders, added, todayRow, monthRow] = await Promise.all([
    rows<{ status: OrderStatus; n: number; value: number }>(
      db,
      sql`select o.status, count(*)::int as n, coalesce(sum(o.total), 0)::int as value
        from sales_order o where ${mine} and ${inPeriod} group by o.status`,
    ),
    rows<Omit<MyKpis["orders"][number], "statusLabel">>(
      db,
      sql`select o.id::int as id, o.code, c.name as customer, c.kind as "customerKind", o.total::int as total, o.status,
          ${iso("coalesce(o.submitted_at, o.created_at)")} as at,
          (select string_agg(m.name || coalesce(' ' || m.strength, '') || ' × ' || i.qty, ', ' order by i.id)
             from order_item i join medicine m on m.id = i.medicine_id where i.order_id = o.id) as lines
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
      sql`select count(*)::int as n, coalesce(sum(o.total) filter (where o.status <> 'cancelled'), 0)::int as value from sales_order o
        where ${mine} and ${placedOn} = ${today}::date`,
    ),
    rows<{ n: number; value: number }>(
      db,
      sql`select count(*)::int as n, coalesce(sum(o.total) filter (where o.status <> 'cancelled'), 0)::int as value from sales_order o
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

type Band = [number, number];
const pointsAbove = (value: number, bands: Band[], strict = false) =>
  bands.find(([at]) => (strict ? value > at : value >= at))?.[1] ?? 0;

async function monthScorecard(db: Database, me: Me, today: string): Promise<MyKpis["scorecard"]> {
  const mine = sql`(o.medrep_id = ${me.id} or o.raised_by = ${me.id})`;
  const month = sql`date_trunc('month', ${today}::date)`;
  const [row] = await rows<{
    sales: number;
    target: number | null;
    day: number;
    daysInMonth: number;
    unpaid: number;
    creditSales: number;
    lastCustomers: number;
    cameBack: number;
    weekdays: number;
    saleDays: number;
  }>(
    db,
    sql`select
        coalesce((select sum(i.total) from invoice i join sales_order o on o.id = i.order_id
          where ${mine} and i.status <> 'cancelled' and date_trunc('month', i.issued_on) = ${month}), 0)::float8 as sales,
        (select t.amount::float8 from sales_target t where t.person_id = ${me.id} and t.month = ${month}::date) as target,
        extract(day from ${today}::date)::int as day,
        extract(day from (${month} + interval '1 month' - interval '1 day'))::int as "daysInMonth",
        coalesce((select sum(i.total - i.paid) from invoice i join sales_order o on o.id = i.order_id
          where ${mine} and i.status = 'open'), 0)::float8 as unpaid,
        coalesce((select sum(i.total) from invoice i join sales_order o on o.id = i.order_id
          where ${mine} and i.status <> 'cancelled' and i.terms = 'days' and date_trunc('month', i.issued_on) = ${month}), 0)::float8 as "creditSales",
        (select count(distinct o.customer_id) from sales_order o where ${mine} and o.status not in ('draft', 'cancelled')
          and date_trunc('month', (coalesce(o.submitted_at, o.created_at) at time zone 'Asia/Manila')::date) = ${month} - interval '1 month')::int as "lastCustomers",
        (select count(distinct o.customer_id) from sales_order o where ${mine} and o.status not in ('draft', 'cancelled')
          and date_trunc('month', (coalesce(o.submitted_at, o.created_at) at time zone 'Asia/Manila')::date) = ${month} - interval '1 month'
          and exists (select 1 from sales_order n where n.customer_id = o.customer_id and (n.medrep_id = ${me.id} or n.raised_by = ${me.id})
            and n.status not in ('draft', 'cancelled')
            and date_trunc('month', (coalesce(n.submitted_at, n.created_at) at time zone 'Asia/Manila')::date) = ${month}))::int as "cameBack",
        (select count(*) from generate_series(${month}::date, ${today}::date, interval '1 day') d
          where extract(isodow from d) < 6)::int as weekdays,
        (select count(distinct o.delivered_on) from sales_order o where ${mine} and o.status = 'completed'
          and date_trunc('month', o.delivered_on) = ${month} and extract(isodow from o.delivered_on) < 6)::int as "saleDays"`,
  );
  const r = row ?? {
    sales: 0,
    target: null,
    day: 1,
    daysInMonth: 30,
    unpaid: 0,
    creditSales: 0,
    lastCustomers: 0,
    cameBack: 0,
    weekdays: 1,
    saleDays: 0,
  };
  const pace = r.day > 0 ? (r.sales * r.daysInMonth) / r.day : r.sales;
  const ist = r.target && r.target > 0 ? Math.round((pace / r.target) * 100) : null;
  const dso =
    r.creditSales > 0 ? Math.round(r.unpaid / (r.creditSales / Math.max(1, r.day))) : null;
  const hrr = r.lastCustomers > 0 ? Math.round((r.cameBack / r.lastCustomers) * 100) : null;
  const nzsd = r.weekdays > 0 ? Math.round((r.saleDays / r.weekdays) * 100) : null;
  const kpis: MyKpis["scorecard"]["kpis"] = [
    {
      code: "IST",
      label: "Sales vs target",
      value: ist,
      unit: "%",
      weight: 50,
      points:
        ist === null
          ? null
          : pointsAbove(
              ist,
              [
                [90, 50],
                [80, 40],
                [70, 30],
                [60, 20],
              ],
              true,
            ),
      note: r.target
        ? `${Math.round(r.sales / 100).toLocaleString("en-PH")} of ${Math.round(r.target / 100).toLocaleString("en-PH")} pesos, on the month-end pace`
        : "No target set for this month",
    },
    {
      code: "DSO",
      label: "Days to collect",
      value: dso,
      unit: "days",
      weight: 20,
      points: dso === null ? null : dso <= 70 ? 20 : dso < 90 ? 10 : 0,
      note:
        dso === null
          ? "No sale on credit this month yet"
          : "Unpaid on your bills, against a day's credit sales",
    },
    {
      code: "HRR",
      label: "Customers who came back",
      value: hrr,
      unit: "%",
      weight: 15,
      points:
        hrr === null
          ? null
          : pointsAbove(hrr, [
              [95, 15],
              [85, 12],
              [75, 8],
            ]),
      note: r.lastCustomers
        ? `${r.cameBack} of last month's ${r.lastCustomers} customers ordered again`
        : "No customer last month to count",
    },
    {
      code: "NZSD",
      label: "Days with a sale",
      value: nzsd,
      unit: "%",
      weight: 15,
      points:
        nzsd === null
          ? null
          : pointsAbove(nzsd, [
              [95, 15],
              [90, 12],
              [80, 9],
              [70, 6],
            ]),
      note: `${r.saleDays} of ${r.weekdays} weekdays had a delivery`,
    },
  ];
  const measured = kpis.filter((kpi) => kpi.points !== null);
  const max = measured.reduce((sum, kpi) => sum + kpi.weight, 0);
  let total = measured.reduce((sum, kpi) => sum + (kpi.points ?? 0), 0);
  const capped = ist !== null && ist <= 60 && total > 40;
  if (capped) total = 40;
  return {
    card: "Hospital CHC",
    month: new Date(`${today}T00:00:00Z`).toLocaleDateString("en-PH", {
      month: "long",
      timeZone: "UTC",
    }),
    total,
    max,
    status: max === 0 ? "none" : total >= max * 0.8 ? "strong" : total > 0 ? "watch" : "review",
    capped,
    kpis,
  };
}
