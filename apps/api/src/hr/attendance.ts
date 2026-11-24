// Attendance, the HR app's first piece: every person's working day has a time in and a time out.
// The day starts by itself with their first activity on a working day (from three hours before
// it opens until it closes), or with "Start my day" on any day; it ends with "End my day", else
// with the last thing they did that day. HR does the work: puts a day right (with a note) and
// records leave. The person, their team lead, HR, the CEO and the Admin see it; the CEO's page is
// the report (who worked how long, who less, late, absent, on leave), with nothing to change.

import { peopleUnder } from "../org/scope";
import { fixesOf, mayAskFix } from "./corrections";
import { hrEvent } from "./events";
import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { allow, Refusal } from "../http";
import { addDays, todayManila } from "../inventory/rules";
import { iso, type Runner } from "../inventory/service";
import type { Role } from "../people/roles";
import type {
  AttendanceDay,
  AttendanceMonth,
  AttendanceReport,
  AttendanceToday,
  LeaveInput,
  LeaveKind,
  LeaveRow,
  Me,
  MyDay,
} from "../types";
import {
  DEFAULT_SCHEDULE,
  dayFigures,
  dayMinutes,
  isWorkDay,
  manilaMoment,
  type WorkSchedule,
  workMinutes,
} from "./work-time";

/** Who sees everyone's attendance. */
export const ATTENDANCE_ALL_ROLES: Role[] = ["ceo", "admin", "hr"];
/** Who changes it (puts a day right, records leave): HR, with the Admin as its backup. The CEO
 *  reads the report. */
export const ATTENDANCE_WRITE_ROLES: Role[] = ["hr", "admin"];
const LEAVE_KINDS: LeaveKind[] = ["vl", "sl", "lwop", "other"];
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
      sql`select to_char(day, 'YYYY-MM-DD') as day from holiday where active and day >= (now() at time zone 'Asia/Manila')::date - 400`,
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

/** HR (with the Admin as its backup) puts a day right: its time in and out, with why. */
export async function putDayRight(
  db: Database,
  me: Me,
  personId: number,
  input: { day: string; timeIn: string; timeOut: string | null; note: string },
): Promise<void> {
  allow(me, ATTENDANCE_WRITE_ROLES, "put attendance right");
  const note = input.note.trim();
  if (!note) throw new Refusal(400, "invalid", "Say why the day is changed.", "note");
  checkDay(input);
  const [found] = await rows<{ id: number }>(
    db,
    sql`select id::int as id from person where id = ${personId}`,
  );
  if (!found) throw new Refusal(404, "not_found", "No such person.");
  await db.transaction(async (tx) => {
    await setDay(tx, personId, me.id, { ...input, note }, "hr");
    // HR's trail: every change to someone's HR record, a day of attendance too.
    await hrEvent(
      tx,
      personId,
      me.id,
      "attendance",
      `Attendance of ${input.day} put right: ${input.timeIn}–${input.timeOut ?? "no time out"}: ${note}`,
    );
  });
}

/** A day's times make sense: time out after time in, and the day has come. */
export function checkDay(input: { day: string; timeIn: string; timeOut: string | null }): void {
  const timeIn = manilaMoment(input.day, input.timeIn);
  const timeOut = input.timeOut ? manilaMoment(input.day, input.timeOut) : null;
  if (timeOut !== null && timeOut < timeIn)
    throw new Refusal(400, "invalid", "Time out comes after time in.", "timeOut");
  if (input.day > todayManila())
    throw new Refusal(400, "invalid", "That day hasn't come yet.", "day");
}

/** Sets a day's time in and out as it really was: put right by HR, or from a person's request
 *  HR or their lead approved (`request`). */
export async function setDay(
  db: Runner,
  personId: number,
  by: number,
  input: { day: string; timeIn: string; timeOut: string | null; note: string },
  source: "hr" | "request",
): Promise<void> {
  const inAt = new Date(manilaMoment(input.day, input.timeIn)).toISOString();
  const outAt = input.timeOut ? new Date(manilaMoment(input.day, input.timeOut)).toISOString() : null;
  await db.execute(
    sql`insert into attendance (person_id, day, time_in, in_source, time_out, out_source, last_seen, note, changed_by)
      values (${personId}, ${input.day}::date, ${inAt}::timestamptz, ${source}, ${outAt}::timestamptz,
        ${outAt ? source : null}, coalesce(${outAt}::timestamptz, ${inAt}::timestamptz), ${input.note}, ${by})
      on conflict (person_id, day) do update set time_in = excluded.time_in, in_source = excluded.in_source,
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
  leaves: LeaveRow[] = [],
  hiredOn: string | null = null,
  forms: FormRow[] = [],
): AttendanceDay {
  const holiday = holidays.get(day) ?? null;
  const work = isWorkDay(day, schedule, new Set(holidays.keys()));
  // A day before they joined isn't theirs to miss (a time in that day still counts).
  const kind =
    hiredOn && day < hiredOn && !row ? "before" : holiday ? "holiday" : work ? "work" : "rest";
  // Leave counts only on a working day.
  const onLeave =
    kind === "work" ? leaves.find((one) => one.from <= day && one.to >= day) : undefined;
  const leave = onLeave?.kind ?? null;
  const halfDay = Boolean(onLeave?.halfDay);
  // An approved official business or work from home covers the day; overtime adds its hours.
  const covering = forms.find((one) => one.day === day && one.kind !== "ot") ?? null;
  const form = covering?.kind === "ob" || covering?.kind === "wfh" ? covering.kind : null;
  const formMinutes = covering
    ? covering.kind === "wfh"
      ? dayMinutes(schedule) - schedule.breakMinutes
      : formSpan(covering)
    : 0;
  const overtimeMinutes = forms
    .filter((one) => one.day === day && one.kind === "ot")
    .reduce((sum, one) => sum + formSpan(one), 0);
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
      lateMinutes: 0,
      undertimeMinutes: 0,
      afterHoursMinutes: 0,
      absent: kind === "work" && day < today && !onLeave && !form,
      leave,
      halfDay,
      form,
      overtimeMinutes,
      workedMinutes: formMinutes,
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
    workedMinutes: Math.max(
      formMinutes,
      working
        ? dayFigures(day, row.timeIn, Date.now(), schedule, kind === "work").workedMinutes
        : figures.workedMinutes,
    ),
    // On leave that day (a half day), or covered by a form: not counted late or short.
    lateMinutes: onLeave || form ? 0 : figures.lateMinutes,
    undertimeMinutes: onLeave || form ? 0 : figures.undertimeMinutes,
    afterHoursMinutes: figures.afterHoursMinutes,
    absent: false,
    leave,
    halfDay,
    form,
    overtimeMinutes,
    note: row.note,
  };
}

/** The working days a leave takes (a half day is 0.5): holidays and rest days don't count. */
export function leaveDays(
  from: string,
  to: string,
  halfDay: boolean,
  schedule: WorkSchedule,
  holidays: ReadonlySet<string>,
): number {
  let days = 0;
  for (let at = from; at <= to; at = addDays(at, 1))
    if (isWorkDay(at, schedule, holidays)) days += 1;
  return halfDay ? days / 2 : days;
}

type FormRow = {
  personId: number;
  kind: "ob" | "wfh" | "ot";
  day: string;
  from: string | null;
  to: string | null;
};

/** The minutes from a form's start to its end ("HH:MM"). */
export const formSpan = (form: { from: string | null; to: string | null }) => {
  if (!form.from || !form.to) return 0;
  const minutes = (clock: string) => {
    const [h, m] = clock.split(":").map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };
  return Math.max(0, minutes(form.to) - minutes(form.from));
};

/** Approved forms of these people in these days, by person. */
async function formsOf(
  db: Runner,
  ids: number[],
  from: string,
  to: string,
): Promise<Map<number, FormRow[]>> {
  const out = new Map<number, FormRow[]>();
  if (!ids.length) return out;
  const found = await rows<FormRow>(
    db,
    sql`select person_id::int as "personId", kind, to_char(day, 'YYYY-MM-DD') as day,
        to_char(from_time, 'HH24:MI') as "from", to_char(to_time, 'HH24:MI') as "to"
      from hr_form where status = 'approved' and day between ${from}::date and ${to}::date
        and person_id in (${sql.join(
          ids.map((id) => sql`${id}`),
          sql`, `,
        )})`,
  );
  for (const row of found) out.set(row.personId, [...(out.get(row.personId) ?? []), row]);
  return out;
}

/** Approved leave of these people that touches these days, by person. */
async function leavesOf(
  db: Runner,
  ids: number[],
  from: string,
  to: string,
): Promise<Map<number, LeaveRow[]>> {
  const out = new Map<number, LeaveRow[]>();
  if (!ids.length) return out;
  const found = await rows<Omit<LeaveRow, "days">>(
    db,
    sql`select l.id::int as id, l.person_id::int as "personId", l.kind, to_char(l.from_day, 'YYYY-MM-DD') as "from",
        to_char(l.to_day, 'YYYY-MM-DD') as "to", l.half_day as "halfDay", l.reason, m.name as "madeBy",
        ${iso("l.made_at")} as "madeAt"
      from person_leave l join person m on m.id = l.made_by
      where l.status = 'approved' and l.from_day <= ${to}::date and l.to_day >= ${from}::date
        and l.person_id in (${sql.join(
          ids.map((id) => sql`${id}`),
          sql`, `,
        )})
      order by l.from_day`,
  );
  for (const row of found)
    out.set(row.personId, [...(out.get(row.personId) ?? []), { ...row, days: 0 }]);
  return out;
}

/** The people a person may see the attendance of: everyone, their team down the line, or themselves. */
async function visiblePeople(
  db: Runner,
  me: Me,
): Promise<
  {
    id: number;
    name: string;
    title: string | null;
    role: Role;
    team: string | null;
    hiredOn: string | null;
  }[]
> {
  // A box picked on the team switch: the people sitting in it and under it.
  const scope = me.unit
    ? sql`p.id in ${peopleUnder(me.unit)}`
    : ATTENDANCE_ALL_ROLES.includes(me.role)
    ? sql`true`
    : LEAD_ROLES.includes(me.role)
      ? sql`p.id in (with recursive team as (select id from person where id = ${me.id}
          union all select q.id from person q join team t on q.reports_to = t.id) select id from team)`
      : sql`p.id = ${me.id}`;
  return rows(
    db,
    sql`select p.id::int as id, p.name, p.title, p.role,
        (select u.name from seat_holder h join seat s on s.id = h.seat_id and s.active join org_unit u on u.id = s.unit_id
          where h.person_id = p.id and h.kind = 'holder' and h.starts_on <= (now() at time zone 'Asia/Manila')::date
            and (h.ends_on is null or h.ends_on >= (now() at time zone 'Asia/Manila')::date) order by h.starts_on, h.id limit 1) as team,
        (select to_char(e.hire_date, 'YYYY-MM-DD') from employee e where e.person_id = p.id) as "hiredOn"
      from person p where p.active and p.role <> 'admin' and ${scope}
        -- Someone joining on a later day has no attendance yet.
        and not exists (select 1 from employee e where e.person_id = p.id and e.hire_date > ${todayManila()}::date)
      order by p.name`,
  );
}

export async function schedulesOf(db: Runner, ids: number[]): Promise<Map<number, WorkSchedule>> {
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

export async function holidaysBetween(db: Runner, from: string, to: string) {
  const found = await rows<{ day: string; name: string }>(
    db,
    sql`select to_char(day, 'YYYY-MM-DD') as day, name from holiday where active and day between ${from}::date and ${to}::date`,
  );
  return new Map(found.map((row) => [row.day, row.name]));
}

/** Each person's days from one day to another, worked out as the report counts them (time in and
 *  out, late, undertime, absent, leave, forms): what the report and payroll read. One query at a
 *  time, so it runs inside a transaction too. */
export async function attendanceDays(
  db: Runner,
  people: { id: number; hiredOn: string | null }[],
  from: string,
  to: string,
): Promise<Map<number, { schedule: WorkSchedule; days: AttendanceDay[] }>> {
  const out = new Map<number, { schedule: WorkSchedule; days: AttendanceDay[] }>();
  const ids = people.map((one) => one.id);
  if (!ids.length) return out;
  const today = todayManila();
  const schedules = await schedulesOf(db, ids);
  const holidays = await holidaysBetween(db, from, to);
  const leaveMap = await leavesOf(db, ids, from, to);
  const formMap = await formsOf(db, ids, from, to);
  const found = await rows<DayRow>(
    db,
    sql`select ${dayColumns} from attendance a where a.day between ${from}::date and ${to}::date
      and a.person_id in (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `,
      )})`,
  );
  const byPerson = new Map<number, Map<string, DayRow>>();
  for (const row of found) {
    const mine = byPerson.get(row.personId) ?? new Map<string, DayRow>();
    mine.set(row.day, row);
    byPerson.set(row.personId, mine);
  }
  for (const person of people) {
    const schedule = schedules.get(person.id) ?? DEFAULT_SCHEDULE;
    const mine = byPerson.get(person.id);
    const days: AttendanceDay[] = [];
    for (let at = from; at <= to; at = addDays(at, 1))
      days.push(
        dayOf(
          at,
          mine?.get(at),
          schedule,
          holidays,
          today,
          leaveMap.get(person.id) ?? [],
          person.hiredOn,
          formMap.get(person.id),
        ),
      );
    out.set(person.id, { schedule, days });
  }
  return out;
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
  const [schedules, holidays, leaves, forms, found] = await Promise.all([
    schedulesOf(db, ids),
    holidaysBetween(db, first, day),
    leavesOf(db, ids, first, day),
    formsOf(db, ids, first, day),
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
        leaves.get(person.id),
        person.hiredOn,
        forms.get(person.id),
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
    can: { putRight: ATTENDANCE_WRITE_ROLES.includes(me.role) },
    counts: {
      working: out.filter((one) => one.today.working).length,
      done: out.filter((one) => one.today.timeIn && !one.today.working).length,
      notIn: out.filter(
        (one) =>
          !one.today.timeIn && one.today.kind === "work" && (!one.today.leave || one.today.halfDay),
      ).length,
      onLeave: out.filter((one) => one.today.leave).length,
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
  const [schedules, holidays, leaveMap, formMap, found, named, fixes] = await Promise.all([
    schedulesOf(db, [personId]),
    holidaysBetween(db, first, lastOfMonth),
    leavesOf(db, [personId], first, lastOfMonth),
    formsOf(db, [personId], first, lastOfMonth),
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
    fixesOf(db, me, personId, month),
  ]);
  const schedule = schedules.get(personId) ?? DEFAULT_SCHEDULE;
  const holidaySet = new Set(holidays.keys());
  const leaves = (leaveMap.get(personId) ?? []).map((one) => ({
    ...one,
    days: leaveDays(one.from, one.to, one.halfDay, schedule, holidaySet),
  }));
  const days: AttendanceDay[] = [];
  for (let at = first; at <= last; at = addDays(at, 1))
    days.push(
      dayOf(
        at,
        found.find((row) => row.day === at),
        schedule,
        holidays,
        today,
        leaves,
        person.hiredOn,
        formMap.get(personId),
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
      leaveDays: days.reduce((sum, one) => sum + (one.leave ? (one.halfDay ? 0.5 : 1) : 0), 0),
    },
    leaves,
    fixes,
    can: {
      putRight: ATTENDANCE_WRITE_ROLES.includes(me.role),
      leave: ATTENDANCE_WRITE_ROLES.includes(me.role),
      askFix: me.id === personId && mayAskFix(me),
    },
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

// ------------------------------------------------------------------ leave (HR's work)

/** HR records a person's leave (from their form or message): approved as recorded. Leave can't
 *  overlap leave already recorded, and it must take at least one working day. */
export async function recordLeave(
  db: Database,
  me: Me,
  input: LeaveInput,
): Promise<{ id: number }> {
  allow(me, ATTENDANCE_WRITE_ROLES, "record leave");
  if (!LEAVE_KINDS.includes(input.kind))
    throw new Refusal(400, "invalid", "Pick the kind of leave.", "kind");
  const DAY = /^\d{4}-\d{2}-\d{2}$/;
  if (!DAY.test(input.from)) throw new Refusal(400, "invalid", "Pick the first day.", "from");
  const to = input.halfDay ? input.from : input.to;
  if (!DAY.test(to) || to < input.from)
    throw new Refusal(400, "invalid", "The last day comes on or after the first.", "to");
  if (to > addDays(input.from, 92))
    throw new Refusal(400, "invalid", "Record a leave of at most three months at a time.", "to");
  const [person] = await rows<{ id: number; name: string }>(
    db,
    sql`select id::int as id, name from person where id = ${input.personId} and role <> 'admin'`,
  );
  if (!person) throw new Refusal(404, "not_found", "No such person.", "personId");
  const [schedules, holidays] = await Promise.all([
    schedulesOf(db, [person.id]),
    holidaysBetween(db, input.from, to),
  ]);
  const schedule = schedules.get(person.id) ?? DEFAULT_SCHEDULE;
  if (leaveDays(input.from, to, false, schedule, new Set(holidays.keys())) === 0)
    throw new Refusal(
      400,
      "invalid",
      "Those days are rest days or holidays: no leave needed.",
      "from",
    );
  return db.transaction(async (tx) => {
    // One person's leave is recorded one at a time, so two can't overlap.
    await tx.execute(sql`select id from person where id = ${person.id} for update`);
    const [overlap] = await rows<{ from: string; to: string }>(
      tx,
      sql`select to_char(from_day, 'YYYY-MM-DD') as "from", to_char(to_day, 'YYYY-MM-DD') as "to"
        from person_leave where person_id = ${person.id} and status in ('approved', 'asked')
          and from_day <= ${to}::date and to_day >= ${input.from}::date limit 1`,
    );
    if (overlap)
      throw new Refusal(
        409,
        "taken",
        `${person.name} already has leave ${overlap.from === overlap.to ? `on ${overlap.from}` : `from ${overlap.from} to ${overlap.to}`}.`,
        "from",
      );
    const [made] = await rows<{ id: number }>(
      tx,
      sql`insert into person_leave (person_id, kind, from_day, to_day, half_day, reason, made_by, decided_by, decided_at)
        values (${person.id}, ${input.kind}, ${input.from}::date, ${to}::date, ${Boolean(input.halfDay)},
          ${input.reason?.trim() || null}, ${me.id}, ${me.id}, now()) returning id::int as id`,
    );
    return { id: made?.id as number };
  });
}

// ------------------------------------------------------------------ the report (read only)

/** Who worked how long over chosen days, who less, late, absent and on leave: the CEO's report
 *  (everyone), HR's, and a team lead's for their team. Nothing on it changes anything. */
export async function attendanceReport(
  db: Database,
  me: Me,
  asked: { from?: string | null; to?: string | null },
): Promise<AttendanceReport> {
  if (!ATTENDANCE_ALL_ROLES.includes(me.role) && !LEAD_ROLES.includes(me.role))
    throw new Refusal(
      403,
      "not_allowed",
      "The attendance report is for HR, team leads and the CEO.",
    );
  const today = todayManila();
  const DAY = /^\d{4}-\d{2}-\d{2}$/;
  const to = asked.to && DAY.test(asked.to) && asked.to < today ? asked.to : today;
  let from = asked.from && DAY.test(asked.from) ? asked.from : `${today.slice(0, 7)}-01`;
  if (from > to) from = to;
  if (from < addDays(to, -366)) from = addDays(to, -366);
  const people = await visiblePeople(db, me);
  const worked = await attendanceDays(db, people, from, to);
  const out = people.map((person) => {
    const { schedule, days } = worked.get(person.id) ?? { schedule: DEFAULT_SCHEDULE, days: [] };
    const fullDay = dayMinutes(schedule) - schedule.breakMinutes;
    const figures = {
      workDays: 0,
      present: 0,
      absent: 0,
      leaveDays: 0,
      leave: {} as Partial<Record<LeaveKind, number>>,
      workedMinutes: 0,
      expectedMinutes: 0,
      lateDays: 0,
      lateMinutes: 0,
      undertimeMinutes: 0,
      afterHoursMinutes: 0,
      overtimeMinutes: 0,
      formDays: 0,
    };
    for (const day of days) {
      const at = day.day;
      if (day.kind === "work") {
        figures.workDays += 1;
        // Today counts only once they came in: a day not over isn't a shortfall yet.
        if (at < today || day.timeIn)
          figures.expectedMinutes += day.leave ? (day.halfDay ? fullDay / 2 : 0) : fullDay;
      }
      // Came in (or worked on a form) on a working day; a rest day's work counts in the hours.
      if ((day.timeIn || day.form) && day.kind === "work") figures.present += 1;
      if (day.absent) figures.absent += 1;
      if (day.leave) {
        const share = day.halfDay ? 0.5 : 1;
        figures.leaveDays += share;
        figures.leave[day.leave] = (figures.leave[day.leave] ?? 0) + share;
      }
      figures.workedMinutes += day.workedMinutes;
      if (day.lateMinutes > 0) figures.lateDays += 1;
      figures.lateMinutes += day.lateMinutes;
      figures.undertimeMinutes += day.undertimeMinutes;
      figures.afterHoursMinutes += day.afterHoursMinutes;
      figures.overtimeMinutes += day.overtimeMinutes;
      if (day.form) figures.formDays += 1;
    }
    return {
      personId: person.id,
      name: person.name,
      title: person.title,
      team: person.team,
      ...figures,
      averageMinutes: figures.present ? Math.round(figures.workedMinutes / figures.present) : 0,
    };
  });
  const sum = (key: keyof (typeof out)[number]) =>
    out.reduce((total, one) => total + (one[key] as number), 0);
  return {
    from,
    to,
    people: out,
    totals: {
      people: out.length,
      workDays: sum("workDays"),
      present: sum("present"),
      absent: sum("absent"),
      leaveDays: sum("leaveDays"),
      workedMinutes: sum("workedMinutes"),
      expectedMinutes: sum("expectedMinutes"),
      lateDays: sum("lateDays"),
      lateMinutes: sum("lateMinutes"),
      overtimeMinutes: sum("overtimeMinutes"),
    },
  };
}
