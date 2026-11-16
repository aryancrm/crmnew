// Customers to call: each customer's usual gap between orders (the median of their last six,
// this CRM's orders and the old system's together), and where they stand against it today. Soon
// when the refill falls within the next two days (MD Telesales' "refills due in 48 hours"); due
// once the usual gap has passed; late past 1.5 times it; at risk past 2.5 times, or 90 days and
// late; lost past 180 days (the thresholds found in Zoho's orders: the usual reorder gap is 28
// days, which is taken for a customer with one order). A seller sees their own customers; a lead
// their team's, with a count per area, so the head sees whose customers are slipping.

import { type SQL, sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { onlineDesk, Refusal } from "../http";
import { todayManila } from "../inventory/rules";
import { inForce, ledUnits } from "../org/service";
import type { CustomerKind, Me, Reorders, ReorderState } from "../types";
import { seen, team } from "./service";

export const REORDER_STATES: ReorderState[] = ["soon", "due", "late", "at_risk", "lost"];
const DEFAULT_GAP = 28;

export async function reorders(
  db: Database,
  me: Me,
  asked: { state?: string; kind?: string; area?: number },
): Promise<Reorders> {
  // The sellers' and their heads' list: a seller, a lead or head, the online desk, the CEO and
  // the Admin. Management, Finance and the warehouse have their own work.
  if (!["medrep", "online", "team_lead", "manager", "ceo", "admin"].includes(me.role))
    throw new Refusal(403, "not_allowed", "Customers to call is the sellers' and their heads' list.");
  const today = todayManila();
  const state = REORDER_STATES.find((one) => one === asked.state) ?? "due";
  const online = onlineDesk(me);
  const kind = (["hospital", "doctor", "patient", "drugstore", "distributor", "government"] as const).find((one) => one === asked.kind);
  // Patients are the online desk's; everyone else's list is the buying businesses and doctors.
  // An Rx CHC's list is their doctors; MD Telesales' their patients and doctors.
  const kindIs: SQL = kind
    ? sql`c.kind = ${kind}`
    : online
      ? sql`c.kind = 'patient'`
      : me.channel?.code === "RX" && me.role === "medrep"
        ? sql`c.kind = 'doctor'`
        : me.channel?.code === "TS"
          ? sql`c.kind in ('patient', 'doctor')`
          : sql`c.kind <> 'patient'`;
  const areaIs: SQL = asked.area ? sql`c.area_id = ${asked.area}` : sql`true`;

  const base = sql`${team(me)},
    mine as (select c.id from customer c where c.active and ${kindIs} and ${areaIs} and ${seen(me)}),
    days as (
      select o.customer_id as cid, (coalesce(o.submitted_at, o.created_at) at time zone 'Asia/Manila')::date as d, o.total::bigint as total
        from sales_order o where o.customer_id in (select id from mine) and o.status not in ('draft', 'cancelled')
      union all
      select p.customer_id, p.ordered_on, p.total from past_order p where p.customer_id in (select id from mine) and p.status <> 'void'
    ),
    dd as (select cid, d, sum(total) as total from days group by cid, d),
    g as (select cid, d, total, d - lag(d) over (partition by cid order by d) as gap,
        row_number() over (partition by cid order by d desc) as rn from dd),
    s as (select cid, max(d) as last, count(*)::int as orders,
        greatest(7, coalesce(percentile_cont(0.5) within group (order by gap) filter (where gap is not null and rn <= 7), ${DEFAULT_GAP}))::float8 as usual,
        max(total) filter (where rn = 1) as "lastTotal"
      from g group by cid),
    st as (select s.*, (${today}::date - s.last)::int as since,
        case
          when ${today}::date - s.last > 180 and ${today}::date - s.last > 2.5 * s.usual then 'lost'
          when ${today}::date - s.last > 2.5 * s.usual or (${today}::date - s.last > 90 and ${today}::date - s.last > 1.5 * s.usual) then 'at_risk'
          when ${today}::date - s.last > 1.5 * s.usual then 'late'
          when ${today}::date - s.last >= s.usual then 'due'
          when ${today}::date - s.last >= s.usual - 2 then 'soon'
          else 'ok' end as state
      from s where ${today}::date - s.last <= 730)`;

  const [counts, list, areas, scope] = await Promise.all([
    rows<{ state: ReorderState | "ok"; n: number; value: number }>(
      db,
      sql`${base} select state, count(*)::int as n, coalesce(sum("lastTotal"), 0)::float8 as value from st group by state`,
    ),
    rows<Reorders["rows"][number]>(
      db,
      sql`${base} select c.id::int as "customerId", c.name, c.kind, c.city, c.phone, a.name as area,
          (select p.name from seat x join seat_holder h on h.seat_id = x.id and h.kind = 'holder' and ${inForce("h", today)}
             join person p on p.id = h.person_id where x.area_id = c.area_id and x.active and not x.lead
           order by h.starts_on desc limit 1) as seller,
          to_char(st.last, 'YYYY-MM-DD') as "lastOn", st.orders, round(st.usual)::int as usual, st.since,
          to_char(st.last + round(st.usual)::int, 'YYYY-MM-DD') as "expectedOn", coalesce(st."lastTotal", 0)::float8 as "lastTotal",
          -- What they took last time: this CRM's latest order, else the old system's.
          coalesce(
            (select string_agg(m.name || coalesce(' ' || m.strength, '') || ' × ' || i.qty, ', ' order by i.id)
               from order_item i join medicine m on m.id = i.medicine_id
              where i.order_id = (select o.id from sales_order o where o.customer_id = c.id and o.status not in ('draft', 'cancelled')
                order by coalesce(o.submitted_at, o.created_at) desc limit 1)),
            (select string_agg(pi.name || ' × ' || pi.qty, ', ' order by pi.id) from past_order_item pi
              where pi.past_order_id = (select p.id from past_order p where p.customer_id = c.id and p.status <> 'void'
                order by p.ordered_on desc, p.id desc limit 1))
          ) as "lastItems"
        from st join customer c on c.id = st.cid left join area a on a.id = c.area_id
        where st.state = ${state}
        order by st."lastTotal" desc nulls last, st.since desc limit 200`,
    ),
    // The head's view: whose customers are slipping, per area.
    me.role === "medrep" || online
      ? Promise.resolve([])
      : rows<Reorders["areas"][number]>(
          db,
          sql`${base} select c.area_id::int as "areaId", coalesce(a.name, 'No area') as area,
              count(*) filter (where st.state = 'due')::int as due, count(*) filter (where st.state = 'late')::int as late,
              count(*) filter (where st.state = 'at_risk')::int as "atRisk", count(*) filter (where st.state = 'lost')::int as lost,
              count(*) filter (where st.state = 'ok')::int as ok,
              (select p.name from seat x join seat_holder h on h.seat_id = x.id and h.kind = 'holder' and ${inForce("h", today)}
                 join person p on p.id = h.person_id where x.area_id = c.area_id and x.active and not x.lead
               order by h.starts_on desc limit 1) as seller
            from st join customer c on c.id = st.cid left join area a on a.id = c.area_id
            group by c.area_id, a.name order by count(*) filter (where st.state in ('late', 'at_risk')) desc, a.name limit 100`,
        ),
    scopeOf(db, me, today, online),
  ]);
  const of = (key: ReorderState | "ok") => counts.find((row) => row.state === key);
  return {
    today,
    state,
    kind: kind ?? (online ? "patient" : null) as CustomerKind | null,
    counts: (["ok", ...REORDER_STATES] as const).map((key) => ({ state: key, customers: of(key)?.n ?? 0, lastValue: of(key)?.value ?? 0 })),
    rows: list,
    areas,
    scope,
  };
}

/** Whose customers the list is, in the person's own words: their seat's area, the teams they
 *  lead, the online desk, or the whole company. */
async function scopeOf(db: Database, me: Me, today: string, online: boolean): Promise<Reorders["scope"]> {
  if (online) return { label: "Online desk", detail: "Patients of the online desk's enquiries and orders" };
  if (me.role === "medrep") {
    const seats = await rows<{ title: string; area: string | null; unit: string }>(
      db,
      sql`select s.title, a.name as area, u.name as unit from seat_holder h join seat s on s.id = h.seat_id
          join org_unit u on u.id = s.unit_id left join area a on a.id = s.area_id
        where h.person_id = ${me.id} and h.kind = 'holder' and ${inForce("h", today)} order by h.starts_on desc`,
    );
    const first = seats[0];
    return first
      ? { label: first.area ?? first.title, detail: `My customers · ${first.unit}` }
      : { label: me.area?.name ?? "My customers", detail: "Customers I added or in my area" };
  }
  if (me.role === "team_lead" || me.role === "manager") {
    const led = await ledUnits(db, me);
    const units = led.length
      ? await rows<{ name: string }>(
          db,
          sql`select name from org_unit where id in (${sql.join(led.map((id) => sql`${id}`), sql`, `)}) order by name`,
        )
      : [];
    return {
      label: units.length === 1 ? (units[0]?.name as string) : units.length ? `${units.length} teams` : "My team",
      detail: units.length > 1 ? `My teams' customers · ${units.map((unit) => unit.name).join(", ")}` : "My team's customers, every seat under me",
    };
  }
  return { label: "Whole company", detail: "Every seller's customers, by area" };
}
