// HR does the work, the CEO reads: HR records leave and puts days right; a day on leave is not an
// absence; the attendance report says who worked how long, who less, late, absent and on leave.
// The CEO can't change any of it; a team lead sees their team's report.

import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { addDays, todayManila } from "../inventory/rules";
import { seedDemo } from "../seed";
import type { AttendanceMonth, AttendanceReport, HrPeople, Me } from "../types";
import { DEFAULT_SCHEDULE, isWorkDay, manilaMoment } from "./work-time";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
const ids: Record<string, number> = {};
/** Three working days gone by, oldest first. */
let workDays: string[] = [];

const get = (who: string, path: string) =>
  app.request(path, { headers: { cookie: cookies[who] as string } });
const read = async <T>(who: string, path: string) => (await (await get(who, path)).json()) as T;
const send = (who: string, path: string, body: unknown = {}) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookies[who] as string },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["helen", "naresh", "daniel", "ryan", "fiona"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
    ids[name] = ((await response.json()) as { me: Me }).me.id;
  }
  const holidays = new Set(
    (
      await rows<{ day: string }>(db, sql`select to_char(day, 'YYYY-MM-DD') as day from holiday`)
    ).map((one) => one.day),
  );
  const today = todayManila();
  for (let at = addDays(today, -1); workDays.length < 3; at = addDays(at, -1))
    if (isWorkDay(at, DEFAULT_SCHEDULE, holidays)) workDays.unshift(at);
  workDays = workDays.slice(-3);
  await db.execute(sql`delete from attendance`);
  // Everyone joined well before these days.
  await db.execute(sql`update employee set hire_date = hire_date - 120`);
  // Ryan worked the first day 8:00–16:00 (late an hour), Fiona all three days 7:00–16:00.
  const day = (who: string, on: string, from: string, to: string) =>
    db.execute(
      sql`insert into attendance (person_id, day, time_in, in_source, last_seen, time_out, out_source)
        values (${ids[who]}, ${on}::date, ${new Date(manilaMoment(on, from)).toISOString()}::timestamptz, 'button',
          ${new Date(manilaMoment(on, to)).toISOString()}::timestamptz,
          ${new Date(manilaMoment(on, to)).toISOString()}::timestamptz, 'button')`,
    );
  await day("ryan", workDays[0] as string, "08:00", "16:00");
  for (const on of workDays) await day("fiona", on, "07:00", "16:00");
});

const reportFor = (who: string) =>
  read<AttendanceReport>(who, `/api/hr/attendance/report?from=${workDays[0]}&to=${workDays[2]}`);

describe("HR's work and the CEO's report", () => {
  it("lets HR record leave and put a day right; the CEO only reads", async () => {
    const leave = { personId: ids.ryan, kind: "vl", from: workDays[1], to: workDays[1] };
    expect((await send("naresh", "/api/hr/leave", leave)).status).toBe(403);
    expect(
      (
        await send("naresh", `/api/hr/attendance/${ids.ryan}`, {
          day: workDays[2],
          timeIn: "07:00",
          timeOut: "16:00",
          note: "Forgot to start",
        })
      ).status,
    ).toBe(403);
    const joiner = {
      name: "Not Allowed",
      mobile: "0917 555 0199",
      company: "2mg",
      seatId: 1,
      startsOn: todayManila(),
      classification: "regular",
      loginEmail: "not.allowed@2mginc.com",
      password: "long-enough-1",
    };
    expect((await send("naresh", "/api/hr/joiners", joiner)).status).toBe(403);
    expect((await read<HrPeople>("naresh", "/api/hr/people")).can.add).toBe(false);
    expect((await read<HrPeople>("helen", "/api/hr/people")).can.add).toBe(true);
    const month = await read<AttendanceMonth>(
      "naresh",
      `/api/hr/attendance/${ids.ryan}?month=${(workDays[0] as string).slice(0, 7)}`,
    );
    expect(month.can).toEqual({ putRight: false, leave: false, askFix: false, biometric: false });

    expect((await send("helen", "/api/hr/leave", leave)).status).toBe(200);
    expect((await send("helen", "/api/hr/leave", { ...leave, kind: "sl" })).status).toBe(409);
    expect(
      (await send("ryan", "/api/hr/leave", { ...leave, from: workDays[2], to: workDays[2] }))
        .status,
    ).toBe(403);
  });

  it("counts a day on leave as leave, not absence", async () => {
    const month = await read<AttendanceMonth>(
      "helen",
      `/api/hr/attendance/${ids.ryan}?month=${(workDays[1] as string).slice(0, 7)}`,
    );
    const onLeave = month.days.find((one) => one.day === workDays[1]);
    expect(onLeave).toMatchObject({ leave: "vl", absent: false });
    expect(month.leaves.map((one) => one.kind)).toContain("vl");
    expect(month.can).toEqual({ putRight: true, leave: true, askFix: false, biometric: true });
  });

  it("reports who worked how long, late, absent and on leave over the chosen days", async () => {
    const report = await reportFor("naresh");
    expect(report.from).toBe(workDays[0]);
    const ryan = report.people.find((one) => one.personId === ids.ryan);
    const fiona = report.people.find((one) => one.personId === ids.fiona);
    expect(ryan).toMatchObject({
      workDays: 3,
      present: 1,
      absent: 1,
      leaveDays: 1,
      leave: { vl: 1 },
      workedMinutes: 7 * 60,
      lateDays: 1,
      lateMinutes: 60,
      // Two working days asked for (one was leave), eight hours each.
      expectedMinutes: 2 * 8 * 60,
    });
    expect(fiona).toMatchObject({ present: 3, absent: 0, workedMinutes: 3 * 8 * 60, lateDays: 0 });
    expect(report.totals.leaveDays).toBe(1);
  });

  it("gives a team lead their team's report and nobody else's; a MedRep none", async () => {
    const team = await reportFor("daniel");
    expect(team.people.map((one) => one.name).sort()).toEqual(["Daniel", "Ryan"]);
    expect((await get("ryan", "/api/hr/attendance/report")).status).toBe(403);
  });

  it("counts a half day of leave as half, and the other half isn't late", async () => {
    const leave = await send("helen", "/api/hr/leave", {
      personId: ids.ryan,
      kind: "sl",
      from: workDays[0],
      to: workDays[0],
      halfDay: true,
    });
    expect(leave.status).toBe(200);
    const ryan = (await reportFor("helen")).people.find((one) => one.personId === ids.ryan);
    expect(ryan).toMatchObject({ leaveDays: 1.5, leave: { vl: 1, sl: 0.5 }, lateMinutes: 0 });

    // HR takes it back: the morning is late again.
    const { id } = (await leave.json()) as { id: number };
    expect((await send("naresh", `/api/hr/leave/${id}/cancel`)).status).toBe(403);
    expect((await send("helen", `/api/hr/leave/${id}/cancel`)).status).toBe(200);
    const again = (await reportFor("helen")).people.find((one) => one.personId === ids.ryan);
    expect(again).toMatchObject({ leaveDays: 1, lateMinutes: 60 });
  });

  it("doesn't count the days before someone joined as absences", async () => {
    await db.execute(
      sql`update employee set hire_date = ${workDays[2]}::date where person_id = ${ids.daniel}`,
    );
    const daniel = (await reportFor("naresh")).people.find((one) => one.personId === ids.daniel);
    expect(daniel).toMatchObject({ workDays: 1, absent: 1, expectedMinutes: 8 * 60 });
  });
});
