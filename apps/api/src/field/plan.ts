// A MedRep's month of visits as one plan: every customer they look after visited as often as its
// class asks (A 4, B 2, C 1, D 1; no class yet, once), spread over the month's working days left
// (leave and holidays off). The MedRep makes it and sends it to their team lead, who approves it
// or sends it back with a word; the plan never stops the day's work. The team lead sets each
// customer's class; the MedRep pins a clinic from a check-in there.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { workCalendar } from "../hr/attendance";
import { isWorkDay } from "../hr/work-time";
import { Refusal } from "../http";
import { addDays, todayManila } from "../inventory/rules";
import { iso, type Runner } from "../inventory/service";
import { inForce } from "../org/service";
import type { Me, PlanStatus, VisitClass, VisitPlanPage } from "../types";
import {
  FIELD_READ_ROLES,
  FIELD_ROLES,
  LEAD_ROLES,
  leads,
  lookedAfterBy,
  maySeeField,
  visitsNeeded,
} from "./visits";

const MONTH = /^\d{4}-\d{2}$/;
const CLASSES: VisitClass[] = ["A", "B", "C", "D"];

const nextMonth = (month: string) => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
};
const lastDayOf = (month: string) => addDays(`${nextMonth(month)}-01`, -1);

async function planOf(db: Runner, personId: number, month: string) {
  const [plan] = await rows<{
    status: PlanStatus;
    sentAt: string | null;
    decidedBy: string | null;
    decidedAt: string | null;
    note: string | null;
  }>(
    db,
    sql`select vp.status, ${iso("vp.sent_at")} as "sentAt", d.name as "decidedBy",
        ${iso("vp.decided_at")} as "decidedAt", vp.note
      from visit_plan vp left join person d on d.id = vp.decided_by
      where vp.person_id = ${personId} and vp.month = ${`${month}-01`}::date`,
  );
  return plan ?? null;
}

/** The month's days with whether each is a working day and a leave day for this person. */
async function monthDays(db: Runner, personId: number, month: string) {
  const first = `${month}-01`;
  const last = lastDayOf(month);
  const [{ schedule, holidays }, leave] = await Promise.all([
    workCalendar(db),
    rows<{ from: string; to: string }>(
      db,
      sql`select to_char(from_day, 'YYYY-MM-DD') as "from", to_char(to_day, 'YYYY-MM-DD') as "to"
        from person_leave where person_id = ${personId} and status = 'approved' and not half_day
          and from_day <= ${last}::date and to_day >= ${first}::date`,
    ),
  ]);
  const days: { day: string; work: boolean; leave: boolean }[] = [];
  for (let at = first; at <= last; at = addDays(at, 1)) {
    const onLeave = leave.some((one) => one.from <= at && one.to >= at);
    days.push({ day: at, work: isWorkDay(at, schedule, holidays) && !onLeave, leave: onLeave });
  }
  return days;
}

export async function fieldPlan(
  db: Runner,
  me: Me,
  asked: { month?: string | null; person?: number | null },
): Promise<VisitPlanPage> {
  const today = todayManila();
  const month = asked.month && MONTH.test(asked.month) ? asked.month : today.slice(0, 7);
  const personId = asked.person ?? me.id;
  if (!(await maySeeField(db, me, personId)))
    throw new Refusal(403, "not_allowed", "That person's plan isn't yours to see.");
  const first = `${month}-01`;
  const last = lastDayOf(month);
  const [person] = await rows<{ id: number; name: string; area: string | null }>(
    db,
    sql`select p.id::int as id, p.name, a.name as area from person p left join area a on a.id = p.area_id
      where p.id = ${personId}`,
  );
  if (!person) throw new Refusal(404, "not_found", "No such person.");
  const [plan, days, customers, perDay, isLead] = await Promise.all([
    planOf(db, personId, month),
    monthDays(db, personId, month),
    rows<Omit<VisitPlanPage["customers"][number], "needed">>(
      db,
      sql`select c.id::int as id, c.name, c.kind, c.specialty, c.city, c.visit_class as "visitClass",
          count(v.id) filter (where v.status = 'planned')::int as planned,
          count(v.id) filter (where v.status = 'done')::int as done,
          count(v.id) filter (where v.status = 'skipped')::int as skipped,
          (select to_char(max(d.day), 'YYYY-MM-DD') from visit d where d.customer_id = c.id and d.status = 'done') as "lastVisit"
        from customer c
        left join visit v on v.customer_id = c.id and v.person_id = ${personId}
          and v.day between ${first}::date and ${last}::date
        where c.active and c.kind in ('doctor', 'hospital', 'drugstore')
          and ${lookedAfterBy(sql`${personId}`, today)}
        group by c.id
        order by coalesce(c.visit_class, 'E'), c.name`,
    ),
    rows<{ day: string; planned: number; done: number }>(
      db,
      sql`select to_char(day, 'YYYY-MM-DD') as day, count(*) filter (where status = 'planned')::int as planned,
          count(*) filter (where status = 'done')::int as done
        from visit where person_id = ${personId} and day between ${first}::date and ${last}::date group by day`,
    ),
    leads(db, me, personId),
  ]);
  const withNeeds = customers.map((one) => ({ ...one, needed: visitsNeeded(one.visitClass) }));
  const mine = me.id === personId && FIELD_ROLES.includes(me.role) && !me.viewedBy;
  const open = !plan || plan.status === "draft" || plan.status === "sent_back";
  const current = month >= today.slice(0, 7);
  return {
    month,
    today,
    person,
    plan: plan ?? { status: null, sentAt: null, decidedBy: null, decidedAt: null, note: null },
    customers: withNeeds,
    days: days.map((one) => ({
      ...one,
      planned: perDay.find((row) => row.day === one.day)?.planned ?? 0,
      done: perDay.find((row) => row.day === one.day)?.done ?? 0,
    })),
    totals: {
      needed: withNeeds.reduce((sum, one) => sum + one.needed, 0),
      planned: withNeeds.reduce((sum, one) => sum + one.planned, 0),
      done: withNeeds.reduce((sum, one) => sum + one.done, 0),
    },
    can: {
      make: mine && open && current,
      send: mine && open && current,
      decide:
        plan?.status === "sent" &&
        me.id !== personId &&
        !me.viewedBy &&
        (isLead || ["admin", "management"].includes(me.role)),
      setClass: !me.viewedBy && (isLead || ["admin", "management"].includes(me.role)),
    },
  };
}

/**
 * Fills the month: every customer the person looks after gets the visits its class asks for,
 * less those already planned or done this month, spread over the working days left (today on),
 * each on the least busy day near its share of the month, never twice a day. Nothing already
 * planned moves. Answers how many visits were added.
 */
export async function makePlan(db: Database, me: Me, month: string): Promise<{ added: number }> {
  if (!FIELD_ROLES.includes(me.role) || me.viewedBy)
    throw new Refusal(403, "not_allowed", "Plans are made by the person who visits.");
  const today = todayManila();
  if (!MONTH.test(month) || month < today.slice(0, 7))
    throw new Refusal(400, "invalid", "Plan this month or a month ahead.", "month");
  if (month > nextMonth(today.slice(0, 7)))
    throw new Refusal(400, "invalid", "Plan this month or next month.", "month");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select id from person where id = ${me.id} for update`);
    const plan = await planOf(tx, me.id, month);
    if (plan && (plan.status === "sent" || plan.status === "approved"))
      throw new Refusal(409, "invalid", "This month's plan is with your team lead already.");
    const page = await fieldPlan(tx, me, { month });
    const days = page.days.filter((one) => one.work && one.day >= today).map((one) => one.day);
    if (!days.length)
      throw new Refusal(400, "invalid", "No working days left in this month to plan.", "month");
    const load = new Map(
      days.map((day) => [day, page.days.find((one) => one.day === day)?.planned ?? 0]),
    );
    const taken = new Set(
      (
        await rows<{ key: string }>(
          tx,
          sql`select customer_id || ':' || to_char(day, 'YYYY-MM-DD') as key from visit
            where person_id = ${me.id} and status <> 'skipped' and day between ${days[0]}::date and ${days[days.length - 1]}::date`,
        )
      ).map((one) => one.key),
    );
    const [seat] = await rows<{ id: number }>(
      tx,
      sql`select h.seat_id::int as id from seat_holder h join seat s on s.id = h.seat_id and s.active
        where h.person_id = ${me.id} and h.kind = 'holder' and ${inForce("h", today)} order by h.starts_on limit 1`,
    );
    let added = 0;
    for (const customer of page.customers) {
      const missing = customer.needed - customer.planned - customer.done;
      for (let k = 0; k < missing; k += 1) {
        const ideal = Math.floor(((k + 0.5) * days.length) / missing);
        let best: string | null = null;
        let score = Number.POSITIVE_INFINITY;
        days.forEach((day, at) => {
          if (taken.has(`${customer.id}:${day}`)) return;
          const value = (load.get(day) ?? 0) * 3 + Math.abs(at - ideal);
          if (value < score) {
            score = value;
            best = day;
          }
        });
        if (!best) break;
        const day: string = best;
        await tx.execute(
          sql`insert into visit (person_id, seat_id, customer_id, day, made_by)
            values (${me.id}, ${seat?.id ?? null}, ${customer.id}, ${day}::date, ${me.id})`,
        );
        taken.add(`${customer.id}:${day}`);
        load.set(day, (load.get(day) ?? 0) + 1);
        added += 1;
      }
    }
    await tx.execute(
      sql`insert into visit_plan (person_id, month) values (${me.id}, ${`${month}-01`}::date)
        on conflict (person_id, month) do nothing`,
    );
    return { added };
  });
}

/** Sends the month's plan to the team lead. */
export async function sendPlan(db: Database, me: Me, month: string): Promise<void> {
  if (!FIELD_ROLES.includes(me.role) || me.viewedBy)
    throw new Refusal(403, "not_allowed", "Plans are sent by the person who visits.");
  if (!MONTH.test(month)) throw new Refusal(400, "invalid", "Pick the month.", "month");
  await db.transaction(async (tx) => {
    const [planned] = await rows<{ n: number }>(
      tx,
      sql`select count(*)::int as n from visit where person_id = ${me.id} and status = 'planned'
        and day between ${`${month}-01`}::date and ${lastDayOf(month)}::date`,
    );
    if (!planned?.n)
      throw new Refusal(400, "invalid", "Plan some visits first (Make my plan fills the month).");
    const plan = await planOf(tx, me.id, month);
    if (plan && (plan.status === "sent" || plan.status === "approved"))
      throw new Refusal(409, "invalid", "This plan is with your team lead already.");
    await tx.execute(
      sql`insert into visit_plan (person_id, month, status, sent_at) values (${me.id}, ${`${month}-01`}::date, 'sent', now())
        on conflict (person_id, month) do update set status = 'sent', sent_at = now(), decided_by = null,
          decided_at = null, note = null`,
    );
  });
}

/** The team lead approves the plan or sends it back with a word. */
export async function decidePlan(
  db: Database,
  me: Me,
  personId: number,
  input: { month: string; approve: boolean; note?: string | null },
): Promise<void> {
  const isLead = await leads(db, me, personId);
  if (me.viewedBy || (!isLead && !["admin", "management"].includes(me.role)) || me.id === personId)
    throw new Refusal(403, "not_allowed", "A plan is approved by the person's team lead.");
  if (!MONTH.test(input.month)) throw new Refusal(400, "invalid", "Pick the month.", "month");
  const note = input.note?.trim() || null;
  if (!input.approve && !note)
    throw new Refusal(400, "invalid", "Say what to change in the plan.", "note");
  const changed = await rows<{ id: number }>(
    db,
    sql`update visit_plan set status = ${input.approve ? "approved" : "sent_back"}, decided_by = ${me.id},
        decided_at = now(), note = ${note}
      where person_id = ${personId} and month = ${`${input.month}-01`}::date and status = 'sent'
      returning id::int as id`,
  );
  if (!changed.length) throw new Refusal(409, "invalid", "That plan isn't waiting for approval.");
}

/** The team lead (or Management, the Admin) sets a customer's visit class; none clears it. */
export async function setVisitClass(
  db: Database,
  me: Me,
  customerId: number,
  visitClass: VisitClass | null,
): Promise<void> {
  if (visitClass !== null && !CLASSES.includes(visitClass))
    throw new Refusal(400, "invalid", "Pick A, B, C or D.", "visitClass");
  if (me.viewedBy || (!LEAD_ROLES.includes(me.role) && !["admin", "management"].includes(me.role)))
    throw new Refusal(403, "not_allowed", "A customer's class is set by the team lead.");
  const today = todayManila();
  // A team lead sets it for the customers their team looks after.
  const scope = LEAD_ROLES.includes(me.role)
    ? sql`and exists (select 1 from person p where p.active and p.id in (
          with recursive team as (select id from person where id = ${me.id}
            union all select q.id from person q join team t on q.reports_to = t.id) select id from team)
        and ${lookedAfterBy(sql`p.id`, today)})`
    : sql``;
  const changed = await rows<{ id: number }>(
    db,
    sql`update customer c set visit_class = ${visitClass}
      where c.id = ${customerId} and c.active and c.kind in ('doctor', 'hospital', 'drugstore') ${scope}
      returning c.id::int as id`,
  );
  if (!changed.length)
    throw new Refusal(404, "not_found", "That customer isn't one your team looks after.");
}

/** Pins a clinic from the visit's check-in there: by the MedRep when it has no pin yet, or by
 *  their team lead (or Management, the Admin) to put a wrong pin right. */
export async function pinClinic(db: Database, me: Me, visitId: number): Promise<void> {
  await db.transaction(async (tx) => {
    const [visit] = await rows<{
      personId: number;
      customerId: number;
      place: string | null;
      pin: string | null;
    }>(
      tx,
      sql`select v.person_id::int as "personId", v.customer_id::int as "customerId",
          v.check_in_place as place, c.pin
        from visit v join customer c on c.id = v.customer_id where v.id = ${visitId} for update of c`,
    );
    if (!visit) throw new Refusal(404, "not_found", "No such visit.");
    if (!visit.place)
      throw new Refusal(400, "invalid", "That check-in has no place to pin the clinic with.");
    const own = visit.personId === me.id && FIELD_ROLES.includes(me.role);
    const boss =
      (await leads(tx, me, visit.personId)) ||
      (FIELD_READ_ROLES.includes(me.role) && me.role !== "ceo");
    if (me.viewedBy || (!own && !boss))
      throw new Refusal(
        403,
        "not_allowed",
        "Only the person who checked in, or their team lead, pins it.",
      );
    if (visit.pin && !boss)
      throw new Refusal(
        409,
        "taken",
        "This clinic is pinned already. Ask your team lead to move it.",
      );
    await tx.execute(
      sql`update customer set pin = ${visit.place}, pinned_by = ${me.id} where id = ${visit.customerId}`,
    );
    await tx.execute(sql`update visit set distance_m = 0 where id = ${visitId}`);
  });
}
