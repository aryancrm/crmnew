// Work schedules (docs/HR-PLAN.md, step 2): the company's default (Office hours) and the shifts HR
// gives some people. Attendance reads each person's schedule for late, undertime, rest days and
// leave days (schedulesOf in attendance.ts); a person with none is on the default. HR and the Admin
// add schedules, archive one nobody is on any more (never deleted) and give a person a schedule or
// put them back on the default; HR's trail writes it down. HR, the CEO and the Admin read.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { allow, Refusal } from "../http";
import { clean } from "../inventory/service";
import type { HrSchedules, Me, ScheduleInput } from "../types";
import { hrEvent } from "./events";
import { HR_ROLES, HR_WRITE_ROLES } from "./people";

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function hrSchedules(db: Database, me: Me): Promise<HrSchedules> {
  allow(me, HR_ROLES, "see the work schedules");
  const schedules = await rows<HrSchedules["schedules"][number]>(
    db,
    sql`select w.id::int as id, w.name, w.days, to_char(w.starts, 'HH24:MI') as start, to_char(w.ends, 'HH24:MI') as "end",
        w.grace_minutes::int as "graceMinutes", w.break_minutes::int as "breakMinutes",
        (w.is_default and w.active) as "isDefault", not w.active as archived,
        (select count(*)::int from person p where p.active and p.role <> 'admin'
          and coalesce(p.schedule_id, case when w.is_default and w.active then w.id end) = w.id) as people
      from work_schedule w order by not w.active, not w.is_default, lower(w.name)`,
  );
  return { schedules, can: { change: HR_WRITE_ROLES.includes(me.role) } };
}

export async function addSchedule(db: Database, me: Me, input: ScheduleInput): Promise<{ id: number }> {
  allow(me, HR_WRITE_ROLES, "change the work schedules");
  const name = clean(input.name)?.replace(/\s+/g, " ");
  if (!name || name.length > 80)
    throw new Refusal(400, "invalid", "Name the schedule, like Night shift.", "name");
  const days = [...new Set(input.days)].sort((a, b) => a - b);
  if (!days.length || days.some((day) => !Number.isInteger(day) || day < 0 || day > 6))
    throw new Refusal(400, "invalid", "Pick the days it works.", "days");
  if (!CLOCK.test(input.start)) throw new Refusal(400, "invalid", "Type the start as 07:00.", "start");
  if (!CLOCK.test(input.end)) throw new Refusal(400, "invalid", "Type the end as 16:00.", "end");
  // A shift past midnight would be read as a day that ends before it starts.
  if (input.end <= input.start)
    throw new Refusal(400, "invalid", "It ends after it starts, on the same day.", "end");
  const grace = input.graceMinutes ?? 0;
  if (!Number.isInteger(grace) || grace < 0 || grace > 120)
    throw new Refusal(400, "invalid", "Grace is 0 to 120 minutes.", "graceMinutes");
  const breakMinutes = input.breakMinutes ?? 60;
  if (!Number.isInteger(breakMinutes) || breakMinutes < 0 || breakMinutes > 240)
    throw new Refusal(400, "invalid", "The break is 0 to 240 minutes.", "breakMinutes");
  const [h1, m1] = input.start.split(":").map(Number);
  const [h2, m2] = input.end.split(":").map(Number);
  if ((h2 ?? 0) * 60 + (m2 ?? 0) - ((h1 ?? 0) * 60 + (m1 ?? 0)) <= breakMinutes)
    throw new Refusal(400, "invalid", "The break is shorter than the day.", "breakMinutes");
  const [same] = await rows<{ name: string }>(
    db,
    sql`select name from work_schedule where active and lower(name) = ${name.toLowerCase()}`,
  );
  if (same) throw new Refusal(409, "taken", `"${same.name}" is a schedule already.`, "name");
  const [made] = await rows<{ id: number }>(
    db,
    sql`insert into work_schedule (name, days, starts, ends, grace_minutes, break_minutes, created_at, created_by)
      values (${name}, ${`{${days.join(",")}}`}::integer[], ${input.start}::time, ${input.end}::time, ${grace},
        ${breakMinutes}, now(), ${me.id})
      returning id::int as id`,
  );
  return { id: made?.id as number };
}

/** Archive a schedule (not given any more). The default can't be, nor one people are still on. */
export async function archiveSchedule(db: Database, me: Me, id: number): Promise<void> {
  allow(me, HR_WRITE_ROLES, "change the work schedules");
  await db.transaction(async (tx) => {
    const [one] = await rows<{ name: string; isDefault: boolean; active: boolean }>(
      tx,
      sql`select name, is_default as "isDefault", active from work_schedule where id = ${id} for update`,
    );
    if (!one) throw new Refusal(404, "not_found", "No such schedule.");
    if (!one.active) throw new Refusal(409, "invalid", "That schedule is archived already.");
    if (one.isDefault)
      throw new Refusal(409, "invalid", "The company's default schedule can't be archived.");
    const [on] = await rows<{ n: number }>(
      tx,
      sql`select count(*)::int as n from person where schedule_id = ${id} and active`,
    );
    if (on?.n)
      throw new Refusal(
        409,
        "in_use",
        `${on.n === 1 ? "1 person is" : `${on.n} people are`} on ${one.name}: give them another schedule first.`,
      );
    await tx.execute(
      sql`update work_schedule set active = false, archived_at = now(), archived_by = ${me.id} where id = ${id}`,
    );
  });
}

/** Gives a person a schedule, or puts them back on the company's default (null). */
export async function setPersonSchedule(
  db: Database,
  me: Me,
  personId: number,
  scheduleId: number | null,
): Promise<void> {
  allow(me, HR_WRITE_ROLES, "give people a schedule");
  await db.transaction(async (tx) => {
    const [person] = await rows<{ role: string; from: string | null; fromId: number | null }>(
      tx,
      sql`select p.role, p.schedule_id::int as "fromId",
          (select w.name from work_schedule w where w.id = p.schedule_id) as "from"
        from person p join employee e on e.person_id = p.id where p.id = ${personId} for update of p`,
    );
    if (!person) throw new Refusal(404, "not_found", "No such person.");
    if (person.role === "admin")
      throw new Refusal(400, "invalid", "The Admin login keeps no attendance.");
    let to: string | null = null;
    if (scheduleId !== null) {
      const [one] = await rows<{ name: string; active: boolean; isDefault: boolean }>(
        tx,
        sql`select name, active, is_default as "isDefault" from work_schedule where id = ${scheduleId}`,
      );
      if (!one) throw new Refusal(404, "not_found", "No such schedule.", "scheduleId");
      if (!one.active)
        throw new Refusal(400, "invalid", `${one.name} is archived: pick another.`, "scheduleId");
      // The default is given as "none", so it follows the company's default if that changes.
      if (one.isDefault) scheduleId = null;
      else to = one.name;
    }
    if (person.fromId === scheduleId) return;
    const [fallback] = await rows<{ name: string }>(
      tx,
      sql`select name from work_schedule where is_default and active limit 1`,
    );
    const defaultWords = `${fallback?.name ?? "Office hours"} (the default)`;
    await tx.execute(sql`update person set schedule_id = ${scheduleId} where id = ${personId}`);
    await hrEvent(tx, personId, me.id, "record", "Schedule changed", [
      {
        field: "schedule",
        label: "Schedule",
        from: person.from ?? defaultWords,
        to: to ?? defaultWords,
        hidden: false,
      },
    ]);
  });
}
