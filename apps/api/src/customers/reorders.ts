// Customers to call: each customer's usual gap between orders (the median of their last six,
// this CRM's orders and the old system's together), and where they stand against it today. Soon
// when the refill falls within the next two days (MD Telesales' "refills due in 48 hours"); due
// once the usual gap has passed; late past 1.5 times it; at risk past 2.5 times, or 90 days and
// late; lost past 180 days (the thresholds found in Zoho's orders: the usual reorder gap is 28
// days, which is taken for a customer with one order). A seller sees their own customers; a lead
// their team's, with a count per area, so the head sees whose customers are slipping.
//
// The next refill a person set (Aryan, 19 Nov): the one who took the order types the day the
// medicines run out, and that day counts in place of the usual gap until the customer's next order.

import { type SQL, sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { allow, onlineDesk, Refusal } from "../http";
import { todayManila } from "../inventory/rules";
import { rxTelesales } from "../org/boxes";
import { inForce, ledUnits } from "../org/service";
import type { CustomerKind, Me, Refill, Reorders, ReorderState } from "../types";
import { CUSTOMER_ADD_ROLES, seen, team } from "./service";

export const REORDER_STATES: ReorderState[] = ["soon", "due", "late", "at_risk", "lost"];
const DEFAULT_GAP = 28;

/** The customers' orders and gaps, for the ids `who` gives: `s` has each one's last order, how many
 *  and their usual gap; `st` adds the gap that counts (the day a person set, until the customer
 *  orders again, else the usual gap), the days since and the state. */
const refillCtes = (who: SQL, today: string) => sql`days as (
      select o.customer_id as cid, (coalesce(o.submitted_at, o.created_at) at time zone 'Asia/Manila')::date as d, o.total::bigint as total
        from sales_order o where o.customer_id in ${who} and o.status not in ('draft', 'cancelled')
      union all
      select p.customer_id, p.ordered_on, p.total from past_order p where p.customer_id in ${who} and p.status <> 'void'
    ),
    dd as (select cid, d, sum(total) as total from days group by cid, d),
    g as (select cid, d, total, d - lag(d) over (partition by cid order by d) as gap,
        row_number() over (partition by cid order by d desc) as rn from dd),
    s as (select cid, max(d) as last, count(*)::int as orders,
        greatest(7, coalesce(percentile_cont(0.5) within group (order by gap) filter (where gap is not null and rn <= 7), ${DEFAULT_GAP}))::float8 as usual,
        max(total) filter (where rn = 1) as "lastTotal"
      from g group by cid),
    r as (select s.*, case when c.next_refill_on is not null and (c.refill_set_at at time zone 'Asia/Manila')::date >= s.last
          then c.next_refill_on end as "setOn"
        from s join customer c on c.id = s.cid),
    q as (select r.*, greatest(1, coalesce(r."setOn" - r.last, round(r.usual)::int))::float8 as want from r),
    st as (select q.*, (${today}::date - q.last)::int as since,
        case
          when ${today}::date - q.last > 180 and ${today}::date - q.last > 2.5 * q.want then 'lost'
          when ${today}::date - q.last > 2.5 * q.want or (${today}::date - q.last > 90 and ${today}::date - q.last > 1.5 * q.want) then 'at_risk'
          when ${today}::date - q.last > 1.5 * q.want then 'late'
          when ${today}::date - q.last >= q.want then 'due'
          when ${today}::date - q.last >= q.want - 2 then 'soon'
          else 'ok' end as state
      from q where ${today}::date - q.last <= 730)`;

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
  // An Rx CHC's list is their doctors; MD Telesales Oncology's their patients and doctors (the
  // Hospital Division's anesthesia telesales sell to hospitals and doctors: the default).
  // The Online desk's own customers are mostly patients, and the businesses that ordered through it.
  const kindIs: SQL = kind
    ? sql`c.kind = ${kind}`
    : online
      ? sql`true`
      : me.channel?.code === "RX" && me.role === "medrep"
        ? sql`c.kind = 'doctor'`
        : rxTelesales(me)
          ? sql`c.kind in ('patient', 'doctor')`
          : sql`c.kind <> 'patient'`;
  const areaIs: SQL = asked.area ? sql`c.area_id = ${asked.area}` : sql`true`;
  // A B2C CHC's customers are their own (B2C CHC Playbook: the CHC on the first invoice owns the
  // customer): ones they added, ordered for, or whose enquiry is theirs; not every patient.
  const ownIs: SQL = online
    ? sql`(c.added_by = ${me.id}
        or exists (select 1 from sales_order o where o.customer_id = c.id and (o.medrep_id = ${me.id} or o.raised_by = ${me.id}))
        or exists (select 1 from lead l where l.customer_id = c.id and l.assigned_to = ${me.id}))`
    : sql`true`;

  const base = sql`${team(me)},
    mine as (select c.id from customer c where c.active and ${kindIs} and ${areaIs} and ${ownIs} and ${seen(me)}),
    ${refillCtes(sql`(select id from mine)`, today)}`;

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
          to_char(st.last + st.want::int, 'YYYY-MM-DD') as "expectedOn",
          to_char(st."setOn", 'YYYY-MM-DD') as "setOn", case when st."setOn" is not null then c.refill_note end as "refillNote",
          -- The field's visits (Aryan, 19 Nov: "which hospitals has he visited?"): the last one done, by
          -- whom, and the next one planned.
          (select to_char(v.day, 'YYYY-MM-DD') from visit v where v.customer_id = c.id and v.status = 'done' order by v.day desc, v.id desc limit 1) as "lastVisitOn",
          (select p.name from visit v join person p on p.id = v.person_id where v.customer_id = c.id and v.status = 'done' order by v.day desc, v.id desc limit 1) as "lastVisitBy",
          (select to_char(v.day, 'YYYY-MM-DD') from visit v where v.customer_id = c.id and v.status = 'planned' and v.day >= ${today}::date order by v.day limit 1) as "nextVisitOn",
          case when st."setOn" is not null then (select p.name from person p where p.id = c.refill_set_by) end as "setBy", coalesce(st."lastTotal", 0)::float8 as "lastTotal",
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
    kind: (kind ?? null) as CustomerKind | null,
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

/** May this person set a customer's next refill: the sellers who take the orders, their leads,
 *  and Management. */
const REFILL_ROLES = CUSTOMER_ADD_ROLES;

/** A customer's next refill: the day a person set (it counts until their next order), else their
 *  last order plus their usual gap (28 days with one order). */
export async function refillOf(db: Database, me: Me, customerId: number): Promise<Refill> {
  const today = todayManila();
  const [row] = await rows<{
    lastOn: string;
    orders: number;
    usual: number;
    suggestedOn: string;
    setOn: string | null;
  }>(
    db,
    sql`with ${refillCtes(sql`(${customerId})`, today)}
      select to_char(st.last, 'YYYY-MM-DD') as "lastOn", st.orders, round(st.usual)::int as usual,
        to_char(st.last + round(st.usual)::int, 'YYYY-MM-DD') as "suggestedOn", to_char(st."setOn", 'YYYY-MM-DD') as "setOn"
      from st`,
  );
  const [set] = await rows<{ on: string | null; note: string | null; by: string | null; at: string | null }>(
    db,
    sql`select to_char(c.next_refill_on, 'YYYY-MM-DD') as on, c.refill_note as note, p.name as by,
        to_char(c.refill_set_at at time zone 'Asia/Manila', 'YYYY-MM-DD') as at
      from customer c left join person p on p.id = c.refill_set_by where c.id = ${customerId}`,
  );
  // A day set before their latest order no longer counts: the usual gap after the new order does.
  const counts = Boolean(row?.setOn);
  return {
    lastOn: row?.lastOn ?? null,
    orders: row?.orders ?? 0,
    usual: row?.usual ?? DEFAULT_GAP,
    suggestedOn: row?.suggestedOn ?? null,
    setOn: counts ? (set?.on ?? null) : null,
    note: counts ? (set?.note ?? null) : null,
    setBy: counts ? (set?.by ?? null) : null,
    setAt: counts ? (set?.at ?? null) : null,
    nextOn: counts ? (set?.on ?? null) : (row?.suggestedOn ?? null),
    canSet: REFILL_ROLES.includes(me.role),
  };
}

/** Sets (or clears, with no day) a customer's next refill, for one who may see the customer. */
export async function setRefill(
  db: Database,
  me: Me,
  customerId: number,
  input: { on: string | null; note?: string | null },
): Promise<void> {
  allow(me, REFILL_ROLES, "set the next refill");
  const today = todayManila();
  const [seenIt] = await rows<{ id: number }>(
    db,
    sql`${team(me)} select c.id::int as id from customer c where c.id = ${customerId} and c.active and ${seen(me)}`,
  );
  if (!seenIt) throw new Refusal(404, "not_found", "No such customer, or it isn't one of yours.");
  if (input.on !== null) {
    if (input.on < today) throw new Refusal(400, "invalid", "That day has passed. Pick a day from today on.", "on");
    const limit = new Date(`${today}T00:00:00Z`);
    limit.setUTCFullYear(limit.getUTCFullYear() + 1);
    if (input.on > limit.toISOString().slice(0, 10))
      throw new Refusal(400, "invalid", "Pick a day within a year.", "on");
  }
  const note = input.note?.trim().slice(0, 200) || null;
  await db.execute(
    input.on === null
      ? sql`update customer set next_refill_on = null, refill_note = null, refill_set_by = ${me.id}, refill_set_at = now() where id = ${customerId}`
      : sql`update customer set next_refill_on = ${input.on}, refill_note = ${note}, refill_set_by = ${me.id}, refill_set_at = now() where id = ${customerId}`,
  );
}

/** How many of this person's customers need a call now: due, or due within two days (the menu's count). */
export async function refillsWaiting(db: Database, me: Me): Promise<{ soon: number; due: number }> {
  if (!["medrep", "online", "team_lead", "manager"].includes(me.role)) return { soon: 0, due: 0 };
  const list = await reorders(db, me, { state: "due" });
  const of = (key: ReorderState) => list.counts.find((one) => one.state === key)?.customers ?? 0;
  return { soon: of("soon"), due: of("due") };
}
