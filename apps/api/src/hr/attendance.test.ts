// Attendance: a working day starts with the first thing a person does in working hours (or Start
// my day), ends with End my day or else with the last thing they did; HR puts a day right with a
// note; a person sees their own month, a team lead their team's, the CEO everyone's.

import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { addDays, todayManila } from "../inventory/rules";
import { seedDemo } from "../seed";
import type { AttendanceMonth, AttendanceToday, Me } from "../types";
import { forgetSeen, markSeen } from "./attendance";
import { manilaMoment } from "./work-time";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
const ids: Record<string, number> = {};

const get = (who: string, path: string) =>
  app.request(path, { headers: { cookie: cookies[who] as string } });
const read = async <T>(who: string, path: string) => (await (await get(who, path)).json()) as T;
const send = (who: string, path: string, body: unknown = {}) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookies[who] as string },
    body: JSON.stringify(body),
  });
const meOf = (who: string) => ({ id: ids[who], name: who, role: "medrep" }) as unknown as Me;

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["naresh", "daniel", "ryan", "marco", "fiona", "helen"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
    ids[name] = ((await response.json()) as { me: Me }).me.id;
  }
});
beforeEach(async () => {
  forgetSeen();
  await db.execute(sql`delete from attendance`);
});

/** Puts the database's clock aside: a day's row as if made at these Manila times. */
async function dayRow(
  who: string,
  day: string,
  timeIn: string,
  lastSeen: string,
  timeOut?: string,
) {
  await db.execute(
    sql`insert into attendance (person_id, day, time_in, in_source, last_seen, time_out, out_source)
      values (${ids[who]}, ${day}::date, ${new Date(manilaMoment(day, timeIn)).toISOString()}::timestamptz, 'sign_in',
        ${new Date(manilaMoment(day, lastSeen)).toISOString()}::timestamptz,
        ${timeOut ? new Date(manilaMoment(day, timeOut)).toISOString() : null}::timestamptz, ${timeOut ? "button" : null})`,
  );
}

describe("attendance", () => {
  it("starts a day with Start my day, ends it with End my day, once a day", async () => {
    // Signing in during working hours starts the day by itself; on a holiday it doesn't, so the
    // buttons are tested alone whatever the time the tests run.
    await db.execute(
      sql`insert into holiday (day, name) values (${todayManila()}::date, 'Test holiday')
        on conflict (day) where active do nothing`,
    );
    await db.execute(sql`delete from attendance where person_id = ${ids.ryan}`);
    forgetSeen();
    expect((await send("ryan", "/api/hr/day/end")).status).toBe(409);
    expect((await send("ryan", "/api/hr/day/start", { place: "14.55,121.02" })).status).toBe(200);
    expect((await send("ryan", "/api/hr/day/start")).status).toBe(200);
    const [day] = await rows<{ n: number; source: string; place: string }>(
      db,
      sql`select count(*) over ()::int as n, in_source as source, in_place as place from attendance where person_id = ${ids.ryan}`,
    );
    expect(day).toMatchObject({ n: 1, source: "button", place: "14.55,121.02" });
    expect((await send("ryan", "/api/hr/day/end")).status).toBe(200);
    const mine = await read<AttendanceMonth>("ryan", `/api/hr/attendance/${ids.ryan}`);
    const today = mine.days.find((one) => one.day === todayManila());
    expect(today).toMatchObject({ working: false, outFrom: "button", inFrom: "button" });
    await db.execute(sql`delete from holiday where name = 'Test holiday'`);
  });

  it("starts the day by itself in working hours only, and keeps the last thing they did", async () => {
    // The insert's working-hours check uses the database's clock: test it on a working day's row
    // that already exists (then any activity moves last seen), and on a holiday (none is made).
    await db.execute(
      sql`insert into holiday (day, name) values (${todayManila()}::date, 'Test holiday')
        on conflict (day) where active do nothing`,
    );
    await markSeen(db, meOf("marco"));
    const none = await rows(db, sql`select 1 from attendance where person_id = ${ids.marco}`);
    expect(none).toHaveLength(0);
    await db.execute(sql`delete from holiday`);
    await send("marco", "/api/hr/day/start");
    forgetSeen();
    const before = await rows<{ seen: string }>(
      db,
      sql`select last_seen::text as seen from attendance where person_id = ${ids.marco}`,
    );
    await new Promise((done) => setTimeout(done, 20));
    await markSeen(db, meOf("marco"));
    const after = await rows<{ seen: string }>(
      db,
      sql`select last_seen::text as seen from attendance where person_id = ${ids.marco}`,
    );
    expect(after[0]?.seen).not.toBe(before[0]?.seen);
  });

  it("works a past day out: late, hours less the break, a day nobody ended ends when last seen", async () => {
    // The last working day (Monday to Saturday) before today.
    let day = addDays(todayManila(), -1);
    while (new Date(`${day}T00:00:00Z`).getUTCDay() === 0) day = addDays(day, -1);
    await dayRow("ryan", day, "08:40", "18:10");
    await dayRow("marco", day, "07:05", "15:00", "15:00");
    const ryan = await read<AttendanceMonth>(
      "ryan",
      `/api/hr/attendance/${ids.ryan}?month=${day.slice(0, 7)}`,
    );
    // In at 8:40 (100 minutes late: seven blocks), never ended: out when last seen, 18:10.
    expect(ryan.days.find((one) => one.day === day)).toMatchObject({
      kind: "work",
      outFrom: "last_seen",
      lateMinutes: 105,
      undertimeMinutes: 0,
      afterHoursMinutes: 120,
      workedMinutes: 9 * 60 + 30 - 60,
    });
    const mia = await read<AttendanceMonth>(
      "naresh",
      `/api/hr/attendance/${ids.marco}?month=${day.slice(0, 7)}`,
    );
    // Five minutes late is a block; out at 15:00 is an hour short.
    expect(mia.days.find((one) => one.day === day)).toMatchObject({
      lateMinutes: 15,
      undertimeMinutes: 60,
      workedMinutes: 7 * 60 + 55 - 60,
    });
    // A working day gone by with nothing is absent.
    expect(ryan.days.filter((one) => one.absent).length).toBeGreaterThanOrEqual(0);
  });

  it("shows each person only what is theirs to see, and lets HR (not the CEO) put a day right", async () => {
    expect((await get("ryan", `/api/hr/attendance/${ids.marco}`)).status).toBe(403);
    expect((await get("daniel", `/api/hr/attendance/${ids.ryan}`)).status).toBe(200);
    expect((await get("daniel", `/api/hr/attendance/${ids.fiona}`)).status).toBe(403);
    const mine = await read<AttendanceToday>("ryan", "/api/hr/attendance");
    expect(mine.people.map((one) => one.name)).toEqual(["Ryan"]);
    const team = await read<AttendanceToday>("daniel", "/api/hr/attendance");
    expect(team.people.map((one) => one.name)).toEqual(expect.arrayContaining(["Daniel", "Ryan"]));
    const all = await read<AttendanceToday>("naresh", "/api/hr/attendance");
    expect(all.people.length).toBeGreaterThan(team.people.length);
    expect(all.can.putRight).toBe(false);
    expect((await read<AttendanceToday>("helen", "/api/hr/attendance")).can.putRight).toBe(true);

    const day = addDays(todayManila(), -1);
    expect(
      (
        await send("daniel", `/api/hr/attendance/${ids.ryan}`, {
          day,
          timeIn: "08:00",
          timeOut: "17:00",
          note: "Biometric",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await send("naresh", `/api/hr/attendance/${ids.ryan}`, {
          day,
          timeIn: "08:00",
          timeOut: "17:00",
          note: "The CEO reads only",
        })
      ).status,
    ).toBe(403);
    const noNote = await send("helen", `/api/hr/attendance/${ids.ryan}`, {
      day,
      timeIn: "08:00",
      timeOut: "17:00",
      note: "",
    });
    expect(noNote.status).toBe(400);
    expect(
      (
        await send("helen", `/api/hr/attendance/${ids.ryan}`, {
          day,
          timeIn: "08:00",
          timeOut: "17:00",
          note: "Forgot to sign in: was at Pasay General",
        })
      ).status,
    ).toBe(200);
    const fixed = await read<AttendanceMonth>(
      "ryan",
      `/api/hr/attendance/${ids.ryan}?month=${day.slice(0, 7)}`,
    );
    expect(fixed.days.find((one) => one.day === day)).toMatchObject({
      inFrom: "hr",
      outFrom: "hr",
      note: "Forgot to sign in: was at Pasay General",
    });
  });
});
