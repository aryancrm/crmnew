// The field's visits (SEFMED's daily work, inside the CRM): a MedRep plans visits to the doctors,
// hospitals and drugstores they look after, checks in on the spot (the phone's place kept), then
// reports the call (what was detailed and how the doctor took it, notes, the next visit) or skips
// it with a reason. The team lead runs the team's field (approves the month plan, sets each
// customer's class, sees the team's days); the CEO, Management and the Admin read everyone's.
// The visit keeps its seat: the work stays with the seat when its person changes. A check-in is
// compared with the clinic's pin; far away is said, never refused.

import { peopleUnder } from "../org/scope";
import { type SQL, sql } from "drizzle-orm";
import { seen, team } from "../customers/service";
import { type Database, rows } from "../db/index";
import { Refusal } from "../http";
import { addDays, todayManila } from "../inventory/rules";
import { clean, iso, type Runner } from "../inventory/service";
import { inForce } from "../org/service";
import type { Role } from "../people/roles";
import type {
  FieldDay,
  FieldForm,
  FieldReport,
  Me,
  SkipReason,
  VisitPlanInput,
  VisitReaction,
  VisitReportInput,
  VisitRow,
} from "../types";

/** Who visits: MedReps, and team leads and managers on their own calls. */
export const FIELD_ROLES: Role[] = ["medrep", "team_lead", "manager"];
/** Who runs a team's field: approves plans, sets classes, sees the team's days. */
export const LEAD_ROLES: Role[] = ["team_lead", "manager"];
/** Who reads every person's field work. */
export const FIELD_READ_ROLES: Role[] = ["ceo", "admin", "management"];
const ALL_ROLES = FIELD_READ_ROLES;
/** Visits a month a class asks for; a customer with no class yet, once. */
export const CLASS_VISITS: Record<string, number> = { A: 4, B: 2, C: 1, D: 1 };
export const visitsNeeded = (visitClass: string | null) =>
  (visitClass && CLASS_VISITS[visitClass]) || 1;
/** A check-in farther than this from the clinic's pin is "away from the clinic". */
export const NEAR_METRES = 300;

/** Metres between two "lat,lng" places (haversine). */
export function metresBetween(a: string, b: string): number | null {
  const [lat1, lng1] = a.split(",").map(Number);
  const [lat2, lng2] = b.split(",").map(Number);
  if ([lat1, lng1, lat2, lng2].some((one) => one === undefined || Number.isNaN(one))) return null;
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad((lat2 as number) - (lat1 as number));
  const dLng = rad((lng2 as number) - (lng1 as number));
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1 as number)) * Math.cos(rad(lat2 as number)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * 6_371_000 * Math.asin(Math.sqrt(h)));
}
const REACTIONS: VisitReaction[] = ["will_prescribe", "prescribes", "needs_info", "not_interested"];
export const SKIP_WORDS: Record<SkipReason, string> = {
  not_available: "Doctor not available",
  busy: "Doctor busy",
  clinic_closed: "Clinic closed",
  out_of_town: "Out of town",
  rescheduled: "Moved to another day",
  other: "Other",
};
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const PLACE = /^-?\d{1,2}\.\d+,-?\d{1,3}\.\d+$/;
const ahead = (today: string) => addDays(today, 62);

function mustVisit(me: Me) {
  if (!FIELD_ROLES.includes(me.role) || me.viewedBy)
    throw new Refusal(403, "not_allowed", "Visits are made by MedReps and their team leads.");
}

/** Whether `me` leads this person (they are in my team, down the reporting line). */
export async function leads(db: Runner, me: Me, personId: number): Promise<boolean> {
  if (!LEAD_ROLES.includes(me.role) || me.id === personId) return false;
  const [found] = await rows<{ id: number }>(
    db,
    sql`${team(me)} select id::int as id from team where id = ${personId}`,
  );
  return Boolean(found);
}

/** Whether `me` may look at this person's field work: their own, their team lead's, and
 *  everyone's for the CEO, Management and the Admin. */
export async function maySeeField(db: Runner, me: Me, personId: number): Promise<boolean> {
  return me.id === personId || ALL_ROLES.includes(me.role) || leads(db, me, personId);
}

const visitColumns = sql`v.id::int as id, to_char(v.day, 'YYYY-MM-DD') as day, v.status,
  json_build_object('id', c.id::int, 'name', c.name, 'kind', c.kind, 'specialty', c.specialty, 'city', c.city,
    'visitClass', c.visit_class, 'pinned', c.pin is not null) as customer,
  v.distance_m as "distanceM",
  ${iso("v.checked_in_at")} as "checkedInAt", v.check_in_place as "checkInPlace", ${iso("v.done_at")} as "doneAt",
  v.objective, v.notes, to_char(v.next_day, 'YYYY-MM-DD') as "nextDay", v.skip_reason as "skipReason",
  coalesce((select json_agg(json_build_object('medicineId', m.id::int, 'name', m.name, 'reaction', d.item->>'reaction')
      order by d.n)
    from jsonb_array_elements(v.detailed) with ordinality as d(item, n)
    join medicine m on m.id = (d.item->>'medicineId')::bigint), '[]'::json) as detailed,
  (select to_char(max(p.day), 'YYYY-MM-DD') from visit p where p.customer_id = v.customer_id
    and p.status = 'done' and p.day < v.day) as "lastVisit"`;

export async function fieldDay(
  db: Database,
  me: Me,
  asked: { day?: string | null; person?: number | null },
): Promise<FieldDay> {
  const today = todayManila();
  const day = asked.day && DAY.test(asked.day) ? asked.day : today;
  const personId = asked.person ?? me.id;
  if (!(await maySeeField(db, me, personId)))
    throw new Refusal(403, "not_allowed", "That person's visits aren't yours to see.");
  const [person] = await rows<{ id: number; name: string; area: string | null; role: Role }>(
    db,
    sql`select p.id::int as id, p.name, p.role, a.name as area from person p left join area a on a.id = p.area_id
      where p.id = ${personId}`,
  );
  if (!person) throw new Refusal(404, "not_found", "No such person.");
  const visits = await rows<VisitRow>(
    db,
    sql`select ${visitColumns} from visit v join customer c on c.id = v.customer_id
      where v.person_id = ${personId} and v.day = ${day}::date
      order by case v.status when 'planned' then 0 when 'done' then 1 else 2 end, v.checked_in_at nulls last, c.name`,
  );
  return {
    day,
    today,
    person: { id: person.id, name: person.name, area: person.area },
    visits,
    counts: {
      planned: visits.filter((one) => one.status === "planned").length,
      done: visits.filter((one) => one.status === "done").length,
      skipped: visits.filter((one) => one.status === "skipped").length,
    },
    can: { work: person.id === me.id && FIELD_ROLES.includes(me.role) && !me.viewedBy },
  };
}

/** The customers a person may plan a visit to (those they look after), and the medicines. */
export async function fieldForm(db: Database, me: Me, q?: string | null): Promise<FieldForm> {
  mustVisit(me);
  const words = clean(q)?.toLowerCase();
  const [customers, medicines] = await Promise.all([
    rows<FieldForm["customers"][number]>(
      db,
      sql`${team(me)} select c.id::int as id, c.name, c.kind, c.specialty, c.city,
          (select to_char(max(v.day), 'YYYY-MM-DD') from visit v where v.customer_id = c.id and v.status = 'done') as "lastVisit"
        from customer c
        where c.active and c.kind in ('doctor', 'hospital', 'drugstore') and ${seen(me)}
          ${words ? sql`and (lower(c.name) like ${`%${words}%`} or lower(coalesce(c.city, '')) like ${`%${words}%`} or lower(coalesce(c.specialty, '')) like ${`%${words}%`})` : sql``}
        order by c.kind = 'doctor' desc, c.name limit 200`,
    ),
    rows<FieldForm["medicines"][number]>(
      db,
      sql`select id::int as id, name, strength from medicine where active order by name`,
    ),
  ]);
  return { customers, medicines };
}

async function ownVisit(tx: Runner, me: Me, visitId: number) {
  const [visit] = await rows<{
    id: number;
    personId: number;
    customerId: number;
    day: string;
    status: string;
    checkedInAt: string | null;
  }>(
    tx,
    sql`select id::int as id, person_id::int as "personId", customer_id::int as "customerId",
        to_char(day, 'YYYY-MM-DD') as day, status, ${iso("checked_in_at")} as "checkedInAt"
      from visit where id = ${visitId} for update`,
  );
  if (!visit) throw new Refusal(404, "not_found", "No such visit.");
  if (visit.personId !== me.id)
    throw new Refusal(403, "not_allowed", "Only the person visiting works their visit.");
  return visit;
}

/** Plans a visit (one open visit to a customer a day). */
async function planOn(
  tx: Runner,
  me: Me,
  input: VisitPlanInput,
  fromVisit: number | null,
): Promise<number | null> {
  const [customer] = await rows<{ id: number; name: string }>(
    tx,
    sql`${team(me)} select c.id::int as id, c.name from customer c
      where c.id = ${input.customerId} and c.active and c.kind in ('doctor', 'hospital', 'drugstore')
        and ${seen(me)}`,
  );
  if (!customer)
    throw new Refusal(
      400,
      "invalid",
      "Pick a doctor, hospital or drugstore you look after.",
      "customerId",
    );
  const [open] = await rows<{ id: number }>(
    tx,
    sql`select id::int as id from visit where person_id = ${me.id} and customer_id = ${customer.id}
      and day = ${input.day}::date and status in ('planned', 'done')`,
  );
  if (open) {
    if (fromVisit) return null;
    throw new Refusal(
      409,
      "taken",
      `${customer.name} is already on your visits that day.`,
      "customerId",
    );
  }
  const [made] = await rows<{ id: number }>(
    tx,
    sql`insert into visit (person_id, seat_id, customer_id, day, objective, from_visit, made_by)
      values (${me.id},
        (select h.seat_id from seat_holder h join seat s on s.id = h.seat_id and s.active
          where h.person_id = ${me.id} and h.kind = 'holder' and ${inForce("h", todayManila())}
          order by h.starts_on, h.id limit 1),
        ${customer.id}, ${input.day}::date, ${clean(input.objective) ?? null}, ${fromVisit}, ${me.id})
      returning id::int as id`,
  );
  return made?.id ?? null;
}

export async function planVisit(
  db: Database,
  me: Me,
  input: VisitPlanInput,
): Promise<{ id: number }> {
  mustVisit(me);
  const today = todayManila();
  if (!DAY.test(input.day) || input.day < today)
    throw new Refusal(400, "invalid", "Plan it for today or a day ahead.", "day");
  if (input.day > ahead(today))
    throw new Refusal(400, "invalid", "Plan at most two months ahead.", "day");
  return db.transaction(async (tx) => ({ id: (await planOn(tx, me, input, null)) as number }));
}

/** Checks in at the doctor: today's planned visit, the time and the phone's place. */
export async function checkIn(
  db: Database,
  me: Me,
  visitId: number,
  place?: string | null,
): Promise<void> {
  mustVisit(me);
  await db.transaction(async (tx) => {
    const visit = await ownVisit(tx, me, visitId);
    if (visit.status !== "planned")
      throw new Refusal(409, "invalid", "That visit is already closed.");
    if (visit.day !== todayManila())
      throw new Refusal(
        400,
        "invalid",
        "Check in on the day of the visit. Move it to today first.",
      );
    if (visit.checkedInAt) return;
    const typed = clean(place);
    const at = typed && PLACE.test(typed) ? typed : null;
    const [customer] = await rows<{ pin: string | null }>(
      tx,
      sql`select pin from customer where id = ${visit.customerId}`,
    );
    const distance = at && customer?.pin ? metresBetween(at, customer.pin) : null;
    await tx.execute(
      sql`update visit set checked_in_at = now(), check_in_place = ${at}, distance_m = ${distance}
        where id = ${visit.id}`,
    );
  });
}

/** Reports the call: what was detailed and how it was taken, notes, the next visit. */
export async function reportVisit(
  db: Database,
  me: Me,
  visitId: number,
  input: VisitReportInput,
): Promise<{ nextVisitId: number | null }> {
  mustVisit(me);
  const detailed = input.detailed ?? [];
  const notes = clean(input.notes) ?? null;
  if (!detailed.length && !notes)
    throw new Refusal(
      400,
      "invalid",
      "Say which medicines you detailed, or write what happened.",
      "detailed",
    );
  const ids = new Set<number>();
  for (const line of detailed) {
    if (!REACTIONS.includes(line.reaction))
      throw new Refusal(400, "invalid", "Say how the doctor took each medicine.", "detailed");
    if (ids.has(line.medicineId))
      throw new Refusal(400, "invalid", "Each medicine once.", "detailed");
    ids.add(line.medicineId);
  }
  return db.transaction(async (tx) => {
    const visit = await ownVisit(tx, me, visitId);
    if (visit.status !== "planned")
      throw new Refusal(409, "invalid", "That visit is already closed.");
    if (!visit.checkedInAt)
      throw new Refusal(400, "invalid", "Check in at the doctor first, then report the call.");
    if (ids.size) {
      const found = await rows<{ id: number }>(
        tx,
        sql`select id::int as id from medicine where active and id in (${sql.join(
          [...ids].map((id) => sql`${id}`),
          sql`, `,
        )})`,
      );
      if (found.length !== ids.size)
        throw new Refusal(400, "invalid", "Pick medicines from the catalogue.", "detailed");
    }
    const nextDay = input.nextDay || null;
    if (nextDay && (!DAY.test(nextDay) || nextDay <= visit.day || nextDay > ahead(todayManila())))
      throw new Refusal(
        400,
        "invalid",
        "The next visit is a later day, within two months.",
        "nextDay",
      );
    await tx.execute(
      sql`update visit set status = 'done', done_at = now(), objective = coalesce(${clean(input.objective) ?? null}, objective),
          detailed = ${JSON.stringify(detailed.map(({ medicineId, reaction }) => ({ medicineId, reaction })))}::jsonb,
          notes = ${notes}, next_day = ${nextDay}::date
        where id = ${visit.id}`,
    );
    const nextVisitId = nextDay
      ? await planOn(tx, me, { customerId: visit.customerId, day: nextDay }, visit.id)
      : null;
    return { nextVisitId };
  });
}

/** Skips a planned visit with a reason (Other needs a word). */
export async function skipVisit(
  db: Database,
  me: Me,
  visitId: number,
  input: { reason: SkipReason; note?: string | null },
): Promise<void> {
  mustVisit(me);
  if (!(input.reason in SKIP_WORDS))
    throw new Refusal(400, "invalid", "Pick why it didn't happen.", "reason");
  const note = clean(input.note);
  if (input.reason === "other" && !note)
    throw new Refusal(400, "invalid", "Say why it didn't happen.", "note");
  await db.transaction(async (tx) => {
    const visit = await ownVisit(tx, me, visitId);
    if (visit.status !== "planned")
      throw new Refusal(409, "invalid", "That visit is already closed.");
    await tx.execute(
      sql`update visit set status = 'skipped', skip_reason = ${note ? `${SKIP_WORDS[input.reason]}: ${note}` : SKIP_WORDS[input.reason]}
        where id = ${visit.id}`,
    );
  });
}

/** Moves a planned visit not checked in to another day (today or later). */
export async function moveVisit(db: Database, me: Me, visitId: number, day: string): Promise<void> {
  mustVisit(me);
  const today = todayManila();
  if (!DAY.test(day) || day < today || day > ahead(today))
    throw new Refusal(400, "invalid", "Move it to today or a day within two months.", "day");
  await db.transaction(async (tx) => {
    const visit = await ownVisit(tx, me, visitId);
    if (visit.status !== "planned" || visit.checkedInAt)
      throw new Refusal(409, "invalid", "Only a visit not started yet can move.");
    const [clash] = await rows<{ id: number }>(
      tx,
      sql`select id::int as id from visit where person_id = ${me.id} and customer_id = ${visit.customerId}
        and day = ${day}::date and status in ('planned', 'done') and id <> ${visit.id}`,
    );
    if (clash)
      throw new Refusal(409, "taken", "That customer is already on your visits that day.", "day");
    await tx.execute(sql`update visit set day = ${day}::date where id = ${visit.id}`);
  });
}

/** The customers (alias `c`) a person (by id) looks after: those they added and those of their
 *  area or of the seats they hold today. */
export const lookedAfterBy = (person: SQL, today: string): SQL => sql`(c.added_by = ${person}
  or c.area_id = (select area_id from person where id = ${person})
  or c.area_id in (select s.area_id from seat s join seat_holder h on h.seat_id = s.id
    where h.person_id = ${person} and s.active and s.area_id is not null and ${inForce("h", today)}))`;

/** Visits over chosen days, per person: a team lead's for the team, everyone's for the CEO,
 *  Management and the Admin. Done, skipped, still planned, covered, calls a day, check-ins away
 *  from the clinic, this month's coverage by class and the month plan's state. */
export async function fieldReport(
  db: Database,
  me: Me,
  asked: { from?: string | null; to?: string | null },
): Promise<FieldReport> {
  if (!ALL_ROLES.includes(me.role) && !LEAD_ROLES.includes(me.role))
    throw new Refusal(
      403,
      "not_allowed",
      "The visits report is for team leads, Management and the CEO.",
    );
  // A box picked on the team switch: the people sitting in it and under it.
  const scope = me.unit ? sql`p.id in ${peopleUnder(me.unit)}` : ALL_ROLES.includes(me.role) ? sql`true` : sql`p.id in (select id from team)`;
  const today = todayManila();
  const to = asked.to && DAY.test(asked.to) ? asked.to : today;
  let from = asked.from && DAY.test(asked.from) ? asked.from : `${today.slice(0, 7)}-01`;
  if (from > to) from = to;
  if (from < addDays(to, -366)) from = addDays(to, -366);
  const monthStart = `${to.slice(0, 7)}-01`;
  const monthEnd = addDays(`${nextMonthOf(to.slice(0, 7))}-01`, -1);
  const people = await rows<Omit<FieldReport["people"][number], "perDay">>(
    db,
    sql`${team(me)} select p.id::int as "personId", p.name, p.title,
        (select u.name from seat_holder h join seat s on s.id = h.seat_id and s.active join org_unit u on u.id = s.unit_id
          where h.person_id = p.id and h.kind = 'holder' and ${inForce("h", today)} order by h.starts_on, h.id limit 1) as team,
        count(v.id) filter (where v.status = 'planned')::int as planned,
        count(v.id) filter (where v.status = 'done')::int as done,
        -- Missed: a visit the day report closed with its reason; to this report, not done (skipped).
        count(v.id) filter (where v.status in ('skipped', 'missed'))::int as skipped,
        count(distinct v.customer_id) filter (where v.status = 'done')::int as covered,
        count(distinct v.day) filter (where v.status = 'done')::int as "fieldDays",
        count(v.id) filter (where v.status = 'done' and v.distance_m > ${NEAR_METRES})::int as away,
        count(v.id) filter (where v.status = 'done' and v.check_in_place is null)::int as "noPlace",
        (select count(*)::int from customer c where c.active and c.kind in ('doctor', 'hospital', 'drugstore')
          and ${lookedAfterBy(sql`p.id`, today)}) as customers,
        (select count(*)::int from customer c where c.active and c.kind in ('doctor', 'hospital', 'drugstore')
          and ${lookedAfterBy(sql`p.id`, today)}
          and (select count(*) from visit d where d.customer_id = c.id and d.person_id = p.id and d.status = 'done'
            and d.day between ${monthStart}::date and ${monthEnd}::date)
            >= case c.visit_class when 'A' then 4 when 'B' then 2 else 1 end) as "seenEnough",
        (select vp.status from visit_plan vp where vp.person_id = p.id and vp.month = ${monthStart}::date) as plan,
        (select coalesce(sum(coalesce(x.approved_amount, x.amount)), 0)::int from field_expense x where x.person_id = p.id
          and x.status = 'approved' and x.day between ${from}::date and ${to}::date) as spent,
        (select coalesce(sum(x.amount), 0)::int from field_expense x where x.person_id = p.id and x.status = 'pending'
          and x.day between ${from}::date and ${to}::date) as "spentPending"
      from person p
      left join visit v on v.person_id = p.id and v.day between ${from}::date and ${to}::date
      where p.active and p.role in ('medrep', 'team_lead', 'manager') and ${scope}
        and p.id <> ${me.id}
      group by p.id, p.name, p.title
      -- A lead with no visits isn't listed; every MedRep is (none is the point).
      having p.role = 'medrep' or count(v.id) > 0
      order by p.name`,
  );
  const out = people.map((one) => ({
    ...one,
    perDay: one.fieldDays ? Math.round((one.done / one.fieldDays) * 10) / 10 : 0,
  }));
  type Counted =
    | "planned"
    | "done"
    | "skipped"
    | "covered"
    | "fieldDays"
    | "away"
    | "customers"
    | "seenEnough"
    | "spent"
    | "spentPending";
  const sum = (key: Counted) => out.reduce((total, one) => total + one[key], 0);
  return {
    from,
    to,
    month: to.slice(0, 7),
    people: out,
    totals: {
      planned: sum("planned"),
      done: sum("done"),
      skipped: sum("skipped"),
      covered: sum("covered"),
      fieldDays: sum("fieldDays"),
      away: sum("away"),
      customers: sum("customers"),
      seenEnough: sum("seenEnough"),
      spent: sum("spent"),
      spentPending: sum("spentPending"),
    },
  };
}

const nextMonthOf = (month: string) => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
};
