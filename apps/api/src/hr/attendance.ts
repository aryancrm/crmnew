// Attendance, the HR app's first piece: every person's working day has a time in and a time out.
// The day starts by itself with their first activity on a working day (from three hours before
// it opens until it closes), or with "Start my day" on any day; it ends with "End my day", else
// with the last thing they did that day. HR puts a day right (with a note); the person, their
// team lead, HR, the CEO and the Admin see it. Everyone's hours go to HR's and the CEO's pages.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { allow, Refusal } from "../http";
import { addDays, todayManila } from "../inventory/rules";
import { iso, type Runner } from "../inventory/service";
import type { Role } from "../people/roles";
import type { AttendanceDay, AttendanceMonth, AttendanceToday, Me, MyDay } from "../types";
import {
  DEFAULT_SCHEDULE,
  dayFigures,
  isWorkDay,
  manilaMoment,
  type WorkSchedule,
  workMinutes,
} from "./work-time";

/** Who sees everyone's attendance and puts a day right. */
export const ATTENDANCE_ALL_ROLES: Role[] = ["ceo", "admin", "hr"];
/** Who sees their own team's (whoever reports to them, down the line). */
const LEAD_ROLES: Role[] = ["team_lead", "manager"];

const SEEN_EVERY_MS = 2 * 60_000;
const seenAt = new Map<number, number>();

type ScheduleRow = {
  id: number;
  name: string;
  days: number[];
  starts: string;
  ends: string;
  graceMinutes: number;
  breakMinutes: number;
};

const toSchedule = (row: ScheduleRow): WorkSchedule => ({
  days: row.days,
  start: row.starts.slice(0, 5),
  end: row.ends.slice(0, 5),
  graceMinutes: row.graceMinutes,
  breakMinutes: row.breakMinutes,
});

const scheduleColumns = sql`w.id::int as id, w.name, w.days, w.starts::text as starts, w.ends::text as ends,
  w.grace_minutes::int as "graceMinutes", w.break_minutes::int as "breakMinutes"`;

/** The company's working hours (the default schedule) and its holidays: what desks are timed on. */
export async function workCalendar(
  db: Runner,
): Promise<{ schedule: WorkSchedule; holidays: Set<string> }> {
  const [found, days] = await Promise.all([
    rows<ScheduleRow>(
      db,
      sql`select ${scheduleColumns} from work_schedule w where w.is_default and w.active limit 1`,
    ),
    rows<{ day: string }>(
      db,
      sql`select to_char(day, 'YYYY-MM-DD') as day from holiday where active and day >= current_date - 400`,
    ),
  ]);
  return {
    schedule: found[0] ? toSchedule(found[0]) : DEFAULT_SCHEDULE,
    holidays: new Set(days.map((one) => one.day)),
  };
}

/**
 * Notes that a person is working now (called with every signed-in request, at most every two
 * minutes a person, never while someone looks as them). Their first activity on a working day,
 * from three hours before it opens until it closes, starts their day; later activity moves
 * their "last seen", which ends a day nobody ended.
 */
export async function markSeen(db: Database, me: Me): Promise<void> {
  if (me.viewedBy) return;
  const now = Date.now();
  if ((seenAt.get(me.id) ?? 0) > now - SEEN_EVERY_MS) return;
  seenAt.set(me.id, now);
  const today = todayManila();
  const moved = await rows<{ id: number }>(
    db,
    sql`update attendance set last_seen = now() where person_id = ${me.id} and day = ${today}::date
      returning id::int as id`,
  );
  if (moved.length) return;
  await db.execute(
    sql`insert into attendance (person_id, day, time_in, in_source, last_seen)
      select ${me.id}, ${today}::date, now(), 'sign_in', now()
      from work_schedule w
      where w.id = coalesce((select schedule_id from person where id = ${me.id}),
          (select id from work_schedule where is_default and active limit 1))
        and extract(dow from ${today}::date)::int = any (w.days)
        and not exists (select 1 from holiday h where h.day = ${today}::date and h.active)
        and (now() at time zone 'Asia/Manila')::time between w.starts - interval '3 hours' and w.ends
      on conflict (person_id, day) do update set last_seen = excluded.last_seen`,
  );
}

/** For the tests: forget when each person was last noted, so the next request notes them again. */
export const forgetSeen = () => seenAt.clear();

/** "Start my day" (any day, a Saturday's work too), or "End my day". */
export async function startDay(db: Database, me: Me, place?: string | null): Promise<void> {
  const today = todayManila();
  await db.execute(
    sql`insert into attendance (person_id, day, time_in, in_source, last_seen, in_place)
      values (${me.id}, ${today}::date, now(), 'button', now(), ${place ?? null})
      on conflict (person_id, day) do update set last_seen = now(),
        in_place = coalesce(attendance.in_place, excluded.in_place)`,
  );
  seenAt.set(me.id, Date.now());
}

export async function endDay(db: Database, me: Me, place?: string | null): Promise<void> {
  const today = todayManila();
  const [ended] = await rows<{ id: number }>(
    db,
    sql`update attendance set time_out = greatest(now(), time_in), out_source = 'button', last_seen = now(),
        out_place = ${place ?? null}
      where person_id = ${me.id} and day = ${today}::date returning id::int as id`,
  );
  if (!ended)
    throw new Refusal(409, "not_started", "Your day hasn't started yet: press Start my day first.");
}

/** HR (for now the CEO and the Admin) puts a day right: its time in and out, with why. */
export async function putDayRight(
  db: Database,
  me: Me,
  personId: number,
  input: { day: string; timeIn: string; timeOut: string | null; note: string },
): Promise<void> {
  allow(me, ATTENDANCE_ALL_ROLES, "put attendance right");
  const note = input.note.trim();
  if (!note) throw new Refusal(400, "invalid", "Say why the day is changed.", "note");
  const timeIn = manilaMoment(input.day, input.timeIn);
  const timeOut = input.timeOut ? manilaMoment(input.day, input.timeOut) : null;
  if (timeOut !== null && timeOut < timeIn)
    throw new Refusal(400, "invalid", "Time out comes after time in.", "timeOut");
  if (input.day > todayManila())
    throw new Refusal(400, "invalid", "That day hasn't come yet.", "day");
  const [found] = await rows<{ id: number }>(
    db,
    sql`select id::int as id from person where id = ${personId}`,
  );
  if (!found) throw new Refusal(404, "not_found", "No such person.");
  const inAt = new Date(timeIn).toISOString();
  const outAt = timeOut === null ? null : new Date(timeOut).toISOString();
  await db.execute(
    sql`insert into attendance (person_id, day, time_in, in_source, time_out, out_source, last_seen, note, changed_by)
      values (${personId}, ${input.day}::date, ${inAt}::timestamptz, 'hr', ${outAt}::timestamptz,
        ${outAt ? "hr" : null}, coalesce(${outAt}::timestamptz, ${inAt}::timestamptz), ${note}, ${me.id})
      on conflict (person_id, day) do update set time_in = excluded.time_in, in_source = 'hr',
        time_out = excluded.time_out, out_source = excluded.out_source, note = excluded.note,
        changed_by = excluded.changed_by`,
  );
}

// ------------------------------------------------------------------ reading

type DayRow = {
  personId: number;
  day: string;
  timeIn: string;
  timeOut: string | null;
  inFrom: AttendanceDay["inFrom"];
  outFrom: AttendanceDay["outFrom"];
  lastSeen: string;
  note: string | null;
};

const dayColumns = sql`a.person_id::int as "personId", to_char(a.day, 'YYYY-MM-DD') as day,
  ${iso("a.time_in")} as "timeIn", ${iso("a.time_out")} as "timeOut", a.in_source as "inFrom",
  a.out_source as "outFrom", ${iso("a.last_seen")} as "lastSeen", a.note`;

/** One day of one person, worked out: a day nobody ended ends at the last thing they did. */
function dayOf(
  day: string,
  row: DayRow | undefined,
  schedule: WorkSchedule,
  holidays: Map<string, string>,
  today: string,
): AttendanceDay {
  const holiday = holidays.get(day) ?? null;
  const work = isWorkDay(day, schedule, new Set(holidays.keys()));
  const kind = holiday ? "holiday" : work ? "work" : "rest";
  if (!row)
    return {
      day,
      kind,
      holiday,
      timeIn: null,
      timeOut: null,
      outFrom: null,
      inFrom: null,
      working: false,
      workedMinutes: 0,
      lateMinutes: 0,
      undertimeMinutes: 0,
      afterHoursMinutes: 0,
      absent: kind === "work" && day < today,
      note: null,
    };
  const ended = row.timeOut ?? (day < today ? row.lastSeen : null);
  const outFrom = row.timeOut ? row.outFrom : day < today ? "last_seen" : null;
  const figures = dayFigures(day, row.timeIn, ended, schedule, kind === "work");
  const working = !ended;
  return {
    day,
    kind,
    holiday,
    timeIn: row.timeIn,
    timeOut: ended,
    outFrom,
    inFrom: row.inFrom,
    working,
    // Still working: the hours so far.
    workedMinutes: working
      ? dayFigures(day, row.timeIn, Date.now(), schedule, kind === "work").workedMinutes
      : figures.workedMinutes,
    lateMinutes: figures.lateMinutes,
    undertimeMinutes: figures.undertimeMinutes,
    afterHoursMinutes: figures.afterHoursMinutes,
    absent: false,
    note: row.note,
  };
}

/** The people a person may see the attendance of: everyone, their team down the line, or themselves. */
async function visiblePeople(
  db: Runner,
  me: Me,
): Promise<{ id: number; name: string; title: string | null; role: Role; team: string | null }[]> {
  const scope = ATTENDANCE_ALL_ROLES.includes(me.role)
    ? sql`true`
    : LEAD_ROLES.includes(me.role)
      ? sql`p.id in (with recursive team as (select id from person where id = ${me.id}
          union all select q.id from person q join team t on q.reports_to = t.id) select id from team)`
      : sql`p.id = ${me.id}`;
  return rows(
    db,
    sql`select p.id::int as id, p.name, p.title, p.role,
        (select u.name from seat_holder h join seat s on s.id = h.seat_id and s.active join org_unit u on u.id = s.unit_id
          where h.person_id = p.id and h.kind = 'holder' and h.starts_on <= current_date
            and (h.ends_on is null or h.ends_on >= current_date) order by h.starts_on limit 1) as team
      from person p where p.active and p.role <> 'admin' and ${scope} order by p.name`,
  );
}

async function schedulesOf(db: Runner, ids: number[]): Promise<Map<number, WorkSchedule>> {
  if (!ids.length) return new Map();
  const found = await rows<ScheduleRow & { personId: number }>(
    db,
    sql`select p.id::int as "personId", ${scheduleColumns} from person p
      join work_schedule w on w.id = coalesce(p.schedule_id, (select id from work_schedule where is_default and active limit 1))
      where p.id in (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `,
      )})`,
  );
  return new Map(found.map((row) => [row.personId, toSchedule(row)]));
}

async function holidaysBetween(db: Runner, from: string, to: string) {
  const found = await rows<{ day: string; name: string }>(
    db,
    sql`select to_char(day, 'YYYY-MM-DD') as day, name from holiday where active and day between ${from}::date and ${to}::date`,
  );
  return new Map(found.map((row) => [row.day, row.name]));
}

/** Who is working on a day (today by default), and each person's month so far. */
export async function attendanceToday(
  db: Database,
  me: Me,
  asked?: string,
): Promise<AttendanceToday> {
  const today = todayManila();
  const day = asked && asked <= today ? asked : today;
  const people = await visiblePeople(db, me);
  const ids = people.map((one) => one.id);
  const first = `${day.slice(0, 7)}-01`;
  const [schedules, holidays, found] = await Promise.all([
    schedulesOf(db, ids),
    holidaysBetween(db, first, day),
    ids.length
      ? rows<DayRow>(
          db,
          sql`select ${dayColumns} from attendance a where a.day between ${first}::date and ${day}::date
            and a.person_id in (${sql.join(
              ids.map((id) => sql`${id}`),
              sql`, `,
            )})`,
        )
      : Promise.resolve([]),
  ]);
  const days: string[] = [];
  for (let at = first; at <= day; at = addDays(at, 1)) days.push(at);
  const out = people.map((person) => {
    const schedule = schedules.get(person.id) ?? DEFAULT_SCHEDULE;
    const mine = found.filter((row) => row.personId === person.id);
    const month = days.map((one) =>
      dayOf(
        one,
        mine.find((row) => row.day === one),
        schedule,
        holidays,
        today,
      ),
    );
    const todays = month[month.length - 1] as AttendanceDay;
    return {
      personId: person.id,
      name: person.name,
      title: person.title,
      role: person.role,
      team: person.team,
      today: todays,
      month: {
        days: month.filter((one) => one.timeIn).length,
        workedMinutes: month.reduce((sum, one) => sum + one.workedMinutes, 0),
        lateDays: month.filter((one) => one.lateMinutes > 0).length,
        absentDays: month.filter((one) => one.absent).length,
      },
    };
  });
  return {
    day,
    holiday: holidays.get(day) ?? null,
    can: { putRight: ATTENDANCE_ALL_ROLES.includes(me.role) },
    counts: {
      working: out.filter((one) => one.today.working).length,
      done: out.filter((one) => one.today.timeIn && !one.today.working).length,
      notIn: out.filter((one) => !one.today.timeIn && one.today.kind === "work").length,
      late: out.filter((one) => one.today.lateMinutes > 0).length,
      rest: out.filter((one) => !one.today.timeIn && one.today.kind !== "work").length,
    },
    people: out,
  };
}

/** One person's month, day by day (their DTR): yours, your team's, or anyone's for HR. */
export async function attendanceMonth(
  db: Database,
  me: Me,
  personId: number,
  asked?: string,
): Promise<AttendanceMonth> {
  const allowed = await visiblePeople(db, me);
  const person = allowed.find((one) => one.id === personId);
  if (!person)
    throw new Refusal(403, "not_allowed", "That person's attendance isn't yours to see.");
  const today = todayManila();
  const month = asked && /^\d{4}-\d{2}$/.test(asked) ? asked : today.slice(0, 7);
  const first = `${month}-01`;
  const lastOfMonth = addDays(`${nextMonth(month)}-01`, -1);
  const last = lastOfMonth < today ? lastOfMonth : today;
  const [schedules, holidays, found, named] = await Promise.all([
    schedulesOf(db, [personId]),
    holidaysBetween(db, first, lastOfMonth),
    rows<DayRow>(
      db,
      sql`select ${dayColumns} from attendance a where a.person_id = ${personId}
        and a.day between ${first}::date and ${lastOfMonth}::date order by a.day`,
    ),
    rows<{ name: string }>(
      db,
      sql`select w.name from person p join work_schedule w on w.id = coalesce(p.schedule_id,
          (select id from work_schedule where is_default and active limit 1)) where p.id = ${personId}`,
    ),
  ]);
  const schedule = schedules.get(personId) ?? DEFAULT_SCHEDULE;
  const days: AttendanceDay[] = [];
  for (let at = first; at <= last; at = addDays(at, 1))
    days.push(
      dayOf(
        at,
        found.find((row) => row.day === at),
        schedule,
        holidays,
        today,
      ),
    );
  return {
    month,
    person: { id: person.id, name: person.name, title: person.title },
    schedule: { ...schedule, name: named[0]?.name ?? "Office hours" },
    days,
    totals: {
      workDays: days.filter((one) => one.kind === "work").length,
      present: days.filter((one) => one.timeIn).length,
      absent: days.filter((one) => one.absent).length,
      workedMinutes: days.reduce((sum, one) => sum + one.workedMinutes, 0),
      lateMinutes: days.reduce((sum, one) => sum + one.lateMinutes, 0),
      undertimeMinutes: days.reduce((sum, one) => sum + one.undertimeMinutes, 0),
      afterHoursMinutes: days.reduce((sum, one) => sum + one.afterHoursMinutes, 0),
    },
    can: { putRight: ATTENDANCE_ALL_ROLES.includes(me.role) },
  };
}

/** The person's own day today: when it started, whether it is running, its hours so far. */
export async function myDay(db: Database, me: Me): Promise<MyDay> {
  const today = todayManila();
  const [schedules, holidays, found] = await Promise.all([
    schedulesOf(db, [me.id]),
    holidaysBetween(db, today, today),
    rows<DayRow>(
      db,
      sql`select ${dayColumns} from attendance a where a.person_id = ${me.id} and a.day = ${today}::date`,
    ),
  ]);
  const schedule = schedules.get(me.id) ?? DEFAULT_SCHEDULE;
  return {
    today: dayOf(today, found[0], schedule, holidays, today),
    schedule: { start: schedule.start, end: schedule.end },
  };
}

function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${(y ?? 0) + 1}-01` : `${y}-${String((m ?? 0) + 1).padStart(2, "0")}`;
}

/** Working minutes between two moments on the company's calendar (for desks' clocks). */
export async function workMinutesNow(db: Runner, since: string): Promise<number> {
  const { schedule, holidays } = await workCalendar(db);
  return workMinutes(since, Date.now(), schedule, holidays);
}
