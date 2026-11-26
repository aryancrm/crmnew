// Work schedules: HR adds a shift, gives it to a person (or puts them back on the company's
// default), and attendance counts late and undertime on the person's own schedule; a schedule
// people are on, or the default, can't be archived; an archived one isn't given any more.

import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { addDays, todayManila } from "../inventory/rules";
import { seedDemo } from "../seed";
import type { AttendanceMonth, HrHistory, HrPerson, HrSchedules, Me } from "../types";
import { isWorkDay } from "./work-time";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
const ids: Record<string, number> = {};
let weekday = "";

const get = (who: string, path: string) =>
  app.request(path, { headers: { cookie: cookies[who] as string } });
const read = async <T>(who: string, path: string) => (await (await get(who, path)).json()) as T;
const send = (who: string, path: string, body: unknown = {}) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookies[who] as string },
    body: JSON.stringify(body),
  });
const late = { name: "Late shift", days: [1, 2, 3, 4, 5], start: "10:00", end: "19:00", graceMinutes: 0, breakMinutes: 60 };
const scheduleId = async (name: string) =>
  (await read<HrSchedules>("helen", "/api/hr/schedules")).schedules.find((one) => one.name === name)?.id as number;
const ryanDay = async () => {
  const month = await read<AttendanceMonth>("helen", `/api/hr/attendance/${ids.ryan}?month=${weekday.slice(0, 7)}`);
  return { month, day: month.days.find((one) => one.day === weekday) };
};

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["helen", "naresh", "admin", "daniel", "ryan"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
    ids[name] = ((await response.json()) as { me: Me }).me.id;
  }
  await db.execute(sql`delete from attendance`);
  await db.execute(sql`update employee set hire_date = hire_date - 120`);
  const holidays = new Set(
    (await rows<{ day: string }>(db, sql`select to_char(day, 'YYYY-MM-DD') as day from holiday`)).map(
      (one) => one.day,
    ),
  );
  // A Monday to Friday gone by, no holiday: a working day on both schedules.
  const weekdays = { days: [1, 2, 3, 4, 5], start: "10:00", end: "19:00", graceMinutes: 0, breakMinutes: 60 };
  for (let at = addDays(todayManila(), -1); !weekday; at = addDays(at, -1))
    if (isWorkDay(at, weekdays, holidays)) weekday = at;
  // Ryan worked 10:00 to 19:00 that day.
  await db.execute(
    sql`insert into attendance (person_id, day, time_in, in_source, time_out, out_source, last_seen)
      values (${ids.ryan}, ${weekday}::date, (${weekday}::date + time '10:00') at time zone 'Asia/Manila', 'button',
        (${weekday}::date + time '19:00') at time zone 'Asia/Manila', 'button',
        (${weekday}::date + time '19:00') at time zone 'Asia/Manila')`,
  );
});

describe("work schedules", () => {
  it("lists the company's default with who is on it; HR changes, the CEO reads", async () => {
    const list = await read<HrSchedules>("helen", "/api/hr/schedules");
    expect(list.can.change).toBe(true);
    const office = list.schedules[0];
    expect(office).toMatchObject({ name: "Office hours", isDefault: true, archived: false, start: "07:00", end: "16:00" });
    expect(office?.people).toBeGreaterThan(5);
    expect((await read<HrSchedules>("naresh", "/api/hr/schedules")).can.change).toBe(false);
    for (const who of ["daniel", "ryan"]) expect((await get(who, "/api/hr/schedules")).status).toBe(403);
  });

  it("adds a schedule, checked; a name once", async () => {
    for (const wrong of [
      { ...late, name: " " },
      { ...late, days: [] },
      { ...late, end: "09:00" },
      { ...late, start: "25:00" },
      { ...late, breakMinutes: 600 },
      { ...late, start: "10:00", end: "10:30", breakMinutes: 60 },
    ])
      expect((await send("helen", "/api/hr/schedules", wrong)).status).toBe(400);
    expect((await send("naresh", "/api/hr/schedules", late)).status).toBe(403);
    expect((await send("daniel", "/api/hr/schedules", late)).status).toBe(403);
    expect((await send("helen", "/api/hr/schedules", late)).status).toBe(200);
    expect((await send("admin", "/api/hr/schedules", { ...late, name: "late SHIFT" })).status).toBe(409);
    const added = (await read<HrSchedules>("helen", "/api/hr/schedules")).schedules.find((one) => one.name === "Late shift");
    expect(added).toMatchObject({ days: [1, 2, 3, 4, 5], start: "10:00", end: "19:00", isDefault: false, people: 0 });
  });

  it("on the default, Ryan's 10:00 start is late; given the late shift, it isn't", async () => {
    const before = await ryanDay();
    expect(before.month.schedule.name).toBe("Office hours");
    expect(before.day?.lateMinutes).toBeGreaterThan(0);
    const shift = await scheduleId("Late shift");
    expect((await send("daniel", `/api/hr/people/${ids.ryan}/schedule`, { scheduleId: shift })).status).toBe(403);
    expect((await send("naresh", `/api/hr/people/${ids.ryan}/schedule`, { scheduleId: shift })).status).toBe(403);
    expect((await send("helen", `/api/hr/people/${ids.ryan}/schedule`, { scheduleId: 999999 })).status).toBe(404);
    expect((await send("helen", `/api/hr/people/${ids.ryan}/schedule`, { scheduleId: shift })).status).toBe(200);
    const after = await ryanDay();
    expect(after.month.schedule).toMatchObject({ name: "Late shift", start: "10:00", end: "19:00" });
    expect(after.day).toMatchObject({ lateMinutes: 0, undertimeMinutes: 0, kind: "work" });
    // The person's page and HR's trail say so.
    const person = await read<HrPerson>("helen", `/api/hr/people/${ids.ryan}`);
    expect(person.schedule).toMatchObject({ id: shift, name: "Late shift" });
    expect(person.can.schedule).toBe(true);
    expect((await read<HrPerson>("ryan", `/api/hr/people/${ids.ryan}`)).can.schedule).toBe(false);
    const trail = await read<HrHistory>("helen", `/api/hr/people/${ids.ryan}/history`);
    expect(trail.lines[0]).toMatchObject({
      kind: "record",
      what: "Schedule changed",
      changes: [{ field: "schedule", label: "Schedule", from: "Office hours (the default)", to: "Late shift", hidden: false }],
    });
    const list = await read<HrSchedules>("helen", "/api/hr/schedules");
    expect(list.schedules.find((one) => one.id === shift)?.people).toBe(1);
  });

  it("can't archive the default, nor a schedule someone is on; archived isn't given", async () => {
    const shift = await scheduleId("Late shift");
    const office = await scheduleId("Office hours");
    expect((await send("helen", `/api/hr/schedules/${office}/archive`)).status).toBe(409);
    expect((await send("helen", `/api/hr/schedules/${shift}/archive`)).status).toBe(409);
    expect((await send("naresh", `/api/hr/schedules/${shift}/archive`)).status).toBe(403);
    // Back on the default: picking the default is the same as none.
    expect((await send("helen", `/api/hr/people/${ids.ryan}/schedule`, { scheduleId: office })).status).toBe(200);
    const [kept] = await rows<{ id: number | null }>(db, sql`select schedule_id::int as id from person where id = ${ids.ryan}`);
    expect(kept?.id).toBeNull();
    expect((await read<HrPerson>("helen", `/api/hr/people/${ids.ryan}`)).schedule).toMatchObject({ id: null, name: "Office hours" });
    expect((await ryanDay()).day?.lateMinutes).toBeGreaterThan(0);
    expect((await send("helen", `/api/hr/schedules/${shift}/archive`)).status).toBe(200);
    expect((await send("helen", `/api/hr/schedules/${shift}/archive`)).status).toBe(409);
    expect((await send("helen", `/api/hr/people/${ids.ryan}/schedule`, { scheduleId: shift })).status).toBe(400);
    const list = await read<HrSchedules>("helen", "/api/hr/schedules");
    expect(list.schedules.at(-1)).toMatchObject({ name: "Late shift", archived: true });
    // Kept, never deleted; its name may be used again.
    expect((await send("helen", "/api/hr/schedules", late)).status).toBe(200);
  });
});
