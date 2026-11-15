// Speed: how long each desk keeps an order and who is slow, from the time each order spent at each
// status (order_step) and who moved it on (order_event at that moment). Management approving,
// Finance checking and invoicing, Dispatch packing and shipping, the road (by courier or rider),
// and a MedRep fixing a sent-back order. Each has a limit; a pass over it is late. The CEO, the
// Admin and the desks see the company; a team lead their team's orders.

import { type SQL, sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { Refusal } from "../http";
import { todayManila } from "../inventory/rules";
import { day } from "../inventory/service";
import { LATE_AFTER as LIMITS } from "../orders/late";
import { ledUnits } from "../org/service";
import type { Role } from "../people/roles";
import type { Me, SpeedReport, SpeedStep } from "../types";

const COMPANY: Role[] = ["ceo", "admin", "management", "finance", "dispatch", "inventory"];
const LEADS: Role[] = ["team_lead", "manager"];

/** How long each step may take before it counts as late, in minutes. */
export const LATE_AFTER: Record<SpeedStep, number> = LIMITS;

const STEP_OF = sql`case when st.status = 'pending_approval' then 'management'
  when st.status in ('finance_check', 'ready_for_invoice') then 'finance'
  when st.status in ('ready_for_dispatch', 'packing') then 'dispatch'
  when st.status = 'shipped' then 'road'
  when st.status = 'draft' and st.entered_at > o.created_at + interval '5 seconds' then 'fix' end`;

const median = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
};
const p90 = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))] as number;
};
const avg = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

function rangeOf(asked: { from?: string | null; to?: string | null }, today: string) {
  const isDay = (value?: string | null) => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
  const from = isDay(asked.from) ? (asked.from as string) : `${today.slice(0, 7)}-01`;
  const to = isDay(asked.to) ? (asked.to as string) : today;
  if (from > to)
    throw new Refusal(400, "invalid", "The first day comes after the last one.", "from");
  return { from, to };
}

/** Whose orders: the whole company for the CEO, the Admin and the desks; a lead's team. */
async function scopeOf(db: Database, me: Me): Promise<{ where: SQL; words: string }> {
  if (COMPANY.includes(me.role)) return { where: sql`true`, words: "The whole company" };
  if (!LEADS.includes(me.role))
    throw new Refusal(403, "not_allowed", "Speed is for the desks, team leads and the CEO.");
  const units = await ledUnits(db, me);
  const list = units.length
    ? sql.join(
        units.map((id) => sql`${id}`),
        sql`, `,
      )
    : sql`0`;
  return {
    where: sql`(o.seat_id in (select s.id from seat s where s.unit_id in (${list}))
      or o.medrep_id in (with recursive team as (select id from person where id = ${me.id}
        union all select p.id from person p join team t on p.reports_to = t.id) select id from team))`,
    words: "Your team's orders",
  };
}

export async function speedReport(
  db: Database,
  me: Me,
  asked: { from?: string | null; to?: string | null } = {},
): Promise<SpeedReport> {
  const today = todayManila();
  const { from, to } = rangeOf(asked, today);
  const scope = await scopeOf(db, me);
  const leftDay = sql`(st.left_at at time zone 'Asia/Manila')::date`;

  const [passes, whole, waiting] = await Promise.all([
    // One row per order and step: the minutes it spent there (all its passes added), when it left,
    // and who moved it on (the timeline's entry at that moment).
    rows<{
      orderId: number;
      code: string;
      customer: string;
      step: SpeedStep;
      minutes: number;
      leftDay: string;
      how: string | null;
      byId: number | null;
      by: string | null;
    }>(
      db,
      sql`with passed as (
          select st.order_id, ${STEP_OF} as step, st.left_at, st.how,
            extract(epoch from st.left_at - st.entered_at) / 60 as minutes,
            (select e.by_person from order_event e where e.order_id = st.order_id
              and e.at between st.left_at - interval '15 seconds' and st.left_at + interval '15 seconds'
              order by abs(extract(epoch from e.at - st.left_at)), e.id limit 1) as by_person
          from order_step st join sales_order o on o.id = st.order_id
          where st.left_at is not null and ${leftDay} between ${from}::date and ${to}::date and ${scope.where})
        select p.order_id::int as "orderId", o.code, c.name as customer, p.step,
          sum(p.minutes)::float8 as minutes, ${day("max(p.left_at at time zone 'Asia/Manila')")} as "leftDay",
          max(p.how) as how,
          (array_agg(p.by_person order by p.left_at desc))[1]::int as "byId",
          (select q.name from person q where q.id = (array_agg(p.by_person order by p.left_at desc))[1]) as by
        from passed p join sales_order o on o.id = p.order_id join customer c on c.id = o.customer_id
        where p.step is not null
        group by p.order_id, o.code, c.name, p.step`,
    ),
    rows<{ minutes: number }>(
      db,
      sql`select extract(epoch from o.delivered_at - coalesce(o.submitted_at, o.created_at)) / 60 as minutes
        from sales_order o where o.status = 'completed' and o.delivered_at is not null
          and o.delivered_on between ${from}::date and ${to}::date and ${scope.where}`,
    ),
    rows<{ step: SpeedStep; orders: number; oldestMinutes: number; late: number }>(
      db,
      sql`select s.step, count(*)::int as orders, max(s.minutes)::float8 as "oldestMinutes",
          count(*) filter (where s.minutes > s.limit_minutes)::int as late
        from (select case when o.status = 'pending_approval' then 'management'
              when o.status in ('finance_check', 'ready_for_invoice') then 'finance'
              when o.status in ('ready_for_dispatch', 'packing') then 'dispatch'
              when o.status = 'shipped' then 'road'
              when o.status = 'draft' and o.sent_back_at is not null then 'fix' end as step,
            extract(epoch from now() - o.status_since) / 60 as minutes,
            case when o.status = 'pending_approval' then ${LATE_AFTER.management}::int when o.status = 'shipped' then ${LATE_AFTER.road}::int
              else ${LATE_AFTER.finance}::int end as limit_minutes
          from sales_order o where ${scope.where}) s
        where s.step is not null group by s.step`,
    ),
  ]);

  const STEPS: SpeedStep[] = ["management", "finance", "dispatch", "road", "fix"];
  const steps = STEPS.map((step) => {
    const minutes = passes.filter((pass) => pass.step === step).map((pass) => pass.minutes);
    return {
      step,
      orders: minutes.length,
      avgMinutes: avg(minutes),
      medianMinutes: median(minutes),
      p90Minutes: p90(minutes),
      late: minutes.filter((value) => value > LATE_AFTER[step]).length,
      lateAfterMinutes: LATE_AFTER[step],
    };
  });

  const peopleMap = new Map<
    string,
    { personId: number; name: string; step: SpeedStep; minutes: number[] }
  >();
  for (const pass of passes) {
    if (!pass.byId || pass.step === "road") continue;
    const key = `${pass.byId}-${pass.step}`;
    const known = peopleMap.get(key) ?? {
      personId: pass.byId,
      name: pass.by ?? "",
      step: pass.step,
      minutes: [],
    };
    known.minutes.push(pass.minutes);
    peopleMap.set(key, known);
  }
  const people = [...peopleMap.values()]
    .map((one) => ({
      personId: one.personId,
      name: one.name,
      step: one.step,
      orders: one.minutes.length,
      avgMinutes: avg(one.minutes),
      medianMinutes: median(one.minutes),
      late: one.minutes.filter((value) => value > LATE_AFTER[one.step]).length,
    }))
    .sort((a, b) => STEPS.indexOf(a.step) - STEPS.indexOf(b.step) || b.avgMinutes - a.avgMinutes);

  const courierMap = new Map<string, number[]>();
  for (const pass of passes.filter((one) => one.step === "road")) {
    const how = pass.how ?? "Not said";
    courierMap.set(how, [...(courierMap.get(how) ?? []), pass.minutes]);
  }
  const couriers = [...courierMap.entries()]
    .map(([how, minutes]) => ({
      how,
      orders: minutes.length,
      avgMinutes: avg(minutes),
      late: minutes.filter((value) => value > LATE_AFTER.road).length,
    }))
    .sort((a, b) => b.orders - a.orders);

  const days: string[] = [];
  for (
    let at = Date.parse(`${from}T00:00:00Z`);
    at <= Date.parse(`${to}T00:00:00Z`) && days.length < 366;
    at += 86_400_000
  )
    days.push(new Date(at).toISOString().slice(0, 10));
  const dayAvg = (dayName: string, step: SpeedStep) => {
    const minutes = passes
      .filter((pass) => pass.leftDay === dayName && pass.step === step)
      .map((pass) => pass.minutes);
    return minutes.length ? avg(minutes) : null;
  };

  const ends = whole.map((row) => row.minutes);
  return {
    from,
    to,
    scope: scope.words,
    steps,
    endToEnd: { orders: ends.length, avgMinutes: avg(ends), medianMinutes: median(ends) },
    people,
    couriers,
    daily: days.map((name) => ({
      day: name,
      management: dayAvg(name, "management"),
      finance: dayAvg(name, "finance"),
      dispatch: dayAvg(name, "dispatch"),
    })),
    slowest: [...passes]
      .filter((pass) => pass.step !== "road")
      .sort((a, b) => b.minutes / LATE_AFTER[b.step] - a.minutes / LATE_AFTER[a.step])
      .slice(0, 10)
      .map((pass) => ({
        orderId: pass.orderId,
        code: pass.code,
        customer: pass.customer,
        step: pass.step,
        minutes: pass.minutes,
        by: pass.by,
      })),
    waitingNow: STEPS.map(
      (step) =>
        waiting.find((row) => row.step === step) ?? { step, orders: 0, oldestMinutes: 0, late: 0 },
    ),
  };
}
