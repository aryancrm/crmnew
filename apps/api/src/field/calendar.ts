// The field as a calendar and on the map: each day of a month with whom a person visited (planned,
// done, skipped) and their leave; for a team lead (their team) and the CEO, Management and the
// Admin (everyone) the whole team's days as counts with who was out, and any day's visits. And
// where each field person is now: their phone's last place, sent every few minutes while their
// working day runs and the app is open (only the latest place is kept, no trail).

import { type SQL, sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { workCalendar } from "../hr/attendance";
import { isWorkDay } from "../hr/work-time";
import { Refusal } from "../http";
import { addDays, todayManila } from "../inventory/rules";
import { iso, type Runner } from "../inventory/service";
import { inForce } from "../org/service";
import type { FieldCalendar, LeaveKind, LivePeople, Me, VisitStatus } from "../types";
import { FIELD_READ_ROLES, FIELD_ROLES, LEAD_ROLES } from "./visits";

const MONTH = /^\d{4}-\d{2}$/;
const PLACE = /^-?\d{1,2}\.\d+,-?\d{1,3}\.\d+$/;
/** A place older than this no longer says where someone is. */
const STALE_MINUTES = 30;

/** The field people this viewer may look at: everyone for the CEO, Management and the Admin; a
 *  team lead their team (themselves too); anyone else only themselves. */
async function fieldPeople(db: Runner, me: Me): Promise<FieldCalendar["people"]> {
  const today = todayManila();
  const everyone = FIELD_READ_ROLES.includes(me.role);
  const lead = LEAD_ROLES.includes(me.role);
  const scope: SQL = everyone
    ? sql`true`
    : lead
      ? sql`p.id in (with recursive team as (select id from person where id = ${me.id}
          union all select q.id from person q join team t on q.reports_to = t.id) select id from team)`
      : sql`p.id = ${me.id}`;
  return rows(
    db,
    sql`select p.id::int as id, p.name,
        (select u.name from seat_holder h join seat s on s.id = h.seat_id and s.active join org_unit u on u.id = s.unit_id
          where h.person_id = p.id and h.kind = 'holder' and ${inForce("h", today)} order by h.starts_on, h.id limit 1) as team
      from person p where p.active and p.role in ('medrep', 'team_lead', 'manager') and ${scope}
      order by p.name`,
  );
}

const ids = (list: number[]) =>
  sql.join(
    list.map((id) => sql`${id}`),
    sql`, `,
  );

export async function fieldCalendar(
  db: Database,
  me: Me,
  asked: { month?: string | null; person?: number | null },
): Promise<FieldCalendar> {
  const today = todayManila();
  const month = asked.month && MONTH.test(asked.month) ? asked.month : today.slice(0, 7);
  const people = await fieldPeople(db, me);
  // A MedRep sees their own; a lead or the CEO the person picked, else the whole team.
  const picked =
    asked.person ??
    (FIELD_READ_ROLES.includes(me.role) || LEAD_ROLES.includes(me.role) ? null : me.id);
  if (picked !== null && !people.some((one) => one.id === picked))
    throw new Refusal(403, "not_allowed", "That person's visits aren't yours to see.");
  const shown = picked !== null ? people.filter((one) => one.id === picked) : people;
  const first = `${month}-01`;
  const [y, m] = month.split("-").map(Number) as [number, number];
  const last = addDays(new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10), -1);
  const shownIds = shown.map((one) => one.id);
  const [{ schedule }, holidays, visits, leave] = await Promise.all([
    workCalendar(db),
    rows<{ day: string; name: string }>(
      db,
      sql`select to_char(day, 'YYYY-MM-DD') as day, name from holiday where active and day between ${first}::date and ${last}::date`,
    ),
    shownIds.length
      ? rows<FieldCalendar["days"][number]["visits"][number] & { day: string }>(
          db,
          sql`select v.id::int as id, to_char(v.day, 'YYYY-MM-DD') as day, v.person_id::int as "personId",
              p.name as "personName", c.name as customer, c.kind, v.status,
              ${iso("coalesce(v.done_at, v.checked_in_at)")} as at
            from visit v join customer c on c.id = v.customer_id join person p on p.id = v.person_id
            where v.person_id in (${ids(shownIds)}) and v.day between ${first}::date and ${last}::date
            order by v.day, coalesce(v.checked_in_at, v.made_at), c.name`,
        )
      : Promise.resolve([]),
    shownIds.length
      ? rows<{ personId: number; kind: LeaveKind; from: string; to: string }>(
          db,
          sql`select person_id::int as "personId", kind, to_char(from_day, 'YYYY-MM-DD') as "from",
              to_char(to_day, 'YYYY-MM-DD') as "to"
            from person_leave where status = 'approved' and person_id in (${ids(shownIds)})
              and from_day <= ${last}::date and to_day >= ${first}::date`,
        )
      : Promise.resolve([]),
  ]);
  const holidayOf = new Map(holidays.map((one) => [one.day, one.name]));
  const days: FieldCalendar["days"] = [];
  for (let day = first; day <= last; day = addDays(day, 1)) {
    const todays = visits.filter((one) => one.day === day);
    const out = leave.filter((one) => one.from <= day && one.to >= day);
    const count = (status: VisitStatus) => todays.filter((one) => one.status === status).length;
    days.push({
      day,
      work: isWorkDay(day, schedule, new Set(holidayOf.keys())),
      holiday: holidayOf.get(day) ?? null,
      planned: count("planned"),
      done: count("done"),
      skipped: count("skipped") + count("missed"),
      leave: picked !== null ? (out[0]?.kind ?? null) : null,
      away: out.length,
      // A team's month carries counts; its visits come one day at a time (fieldCalendarDay).
      visits: picked !== null ? todays.map(({ day: _day, ...one }) => one) : [],
    });
  }
  const person =
    picked !== null ? (shown[0] ? { id: shown[0].id, name: shown[0].name } : null) : null;
  return { month, today, person, people, days };
}

/** Every visit of the team (or everyone) on one day, for the whole team's calendar. */
export async function fieldCalendarDay(
  db: Database,
  me: Me,
  day: string,
): Promise<FieldCalendar["days"][number]["visits"]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Refusal(400, "invalid", "Pick the day.", "day");
  const people = await fieldPeople(db, me);
  if (!people.length) return [];
  return rows(
    db,
    sql`select v.id::int as id, v.person_id::int as "personId", p.name as "personName", c.name as customer,
        c.kind, v.status, ${iso("coalesce(v.done_at, v.checked_in_at)")} as at
      from visit v join customer c on c.id = v.customer_id join person p on p.id = v.person_id
      where v.day = ${day}::date and v.person_id in (${ids(people.map((one) => one.id))})
      order by p.name, coalesce(v.checked_in_at, v.made_at), c.name`,
  );
}

/** The phone tells where it is, while its person's working day runs (else it is not kept). */
export async function tellWhere(
  db: Database,
  me: Me,
  input: { place: string; accuracy?: number | null },
): Promise<{ kept: boolean }> {
  if (!FIELD_ROLES.includes(me.role) || me.viewedBy) return { kept: false };
  const place = input.place.trim();
  if (!PLACE.test(place)) throw new Refusal(400, "invalid", "That isn't a place.", "place");
  const [running] = await rows<{ id: number }>(
    db,
    sql`select id::int as id from attendance where person_id = ${me.id} and day = ${todayManila()}::date
      and time_out is null`,
  );
  if (!running) return { kept: false };
  const accuracy =
    input.accuracy && Number.isFinite(input.accuracy)
      ? Math.round(Math.min(input.accuracy, 100_000))
      : null;
  await db.execute(
    sql`insert into live_location (person_id, place, accuracy_m, at) values (${me.id}, ${place}, ${accuracy}, now())
      on conflict (person_id) do update set place = excluded.place, accuracy_m = excluded.accuracy_m, at = now()`,
  );
  return { kept: true };
}

/** Where the team is now: a team lead's team, everyone for the CEO, Management and the Admin. A
 *  place older than half an hour, or from a day already ended, isn't shown as where they are. */
export async function whereIsTheTeam(db: Database, me: Me): Promise<LivePeople> {
  if (!FIELD_READ_ROLES.includes(me.role) && !LEAD_ROLES.includes(me.role))
    throw new Refusal(403, "not_allowed", "Live location is for team leads and the CEO.");
  const people = (await fieldPeople(db, me)).filter((one) => one.id !== me.id);
  if (!people.length) return { people: [] };
  const today = todayManila();
  const found = await rows<{
    personId: number;
    place: string | null;
    at: string | null;
    accuracyM: number | null;
    working: boolean;
    atVisit: string | null;
  }>(
    db,
    sql`select p.id::int as "personId",
        case when l.at > now() - (${STALE_MINUTES} || ' minutes')::interval and a.time_out is null then l.place end as place,
        ${iso("l.at")} as at, l.accuracy_m as "accuracyM",
        (a.id is not null and a.time_out is null) as working,
        (select c.name from visit v join customer c on c.id = v.customer_id where v.person_id = p.id
          and v.day = ${today}::date and v.status = 'planned' and v.checked_in_at is not null
          order by v.checked_in_at desc limit 1) as "atVisit"
      from person p left join live_location l on l.person_id = p.id
        left join attendance a on a.person_id = p.id and a.day = ${today}::date
      where p.id in (${ids(people.map((one) => one.id))})`,
  );
  const byId = new Map(found.map((one) => [one.personId, one]));
  return {
    people: people.map((one) => {
      const live = byId.get(one.id);
      return {
        personId: one.id,
        name: one.name,
        team: one.team,
        place: live?.place ?? null,
        at: live?.at ?? null,
        accuracyM: live?.accuracyM ?? null,
        working: live?.working ?? false,
        atVisit: live?.atVisit ?? null,
      };
    }),
  };
}
