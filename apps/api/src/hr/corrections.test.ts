// Asking for a day of one's own attendance to be put right: a day of the last 31, one open a day,
// decided by whom the person reports to (HR when that is the CEO) or HR; approved, the day is set
// as HR puts one right, marked as a request, and HR's trail says so; refused with a word;
// cancelled while it waits, and kept.

import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { addDays, todayManila } from "../inventory/rules";
import { seedDemo } from "../seed";
import type { AttendanceMonth, Decisions, FixLine, FixList, HrHistory, Me } from "../types";
import { DEFAULT_SCHEDULE, isWorkDay } from "./work-time";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
const ids: Record<string, number> = {};
let past: string[] = [];

const get = (who: string, path: string) =>
  app.request(path, { headers: { cookie: cookies[who] as string } });
const read = async <T>(who: string, path: string) => (await (await get(who, path)).json()) as T;
const send = (who: string, path: string, body: unknown = {}) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookies[who] as string },
    body: JSON.stringify(body),
  });
const mine = async (who: string) => (await read<{ lines: FixLine[] }>(who, "/api/hr/fixes/mine")).lines;
const dayOf = async (personId: number, day: string) =>
  (
    await rows<{ timeIn: string; timeOut: string | null; inSource: string; outSource: string | null; note: string | null }>(
      db,
      sql`select to_char(time_in at time zone 'Asia/Manila', 'HH24:MI') as "timeIn",
          to_char(time_out at time zone 'Asia/Manila', 'HH24:MI') as "timeOut", in_source as "inSource",
          out_source as "outSource", note
        from attendance where person_id = ${personId} and day = ${day}::date`,
    )
  )[0];

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["ryan", "daniel", "naresh", "fiona", "helen", "admin"]) {
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
  for (let at = addDays(todayManila(), -1); past.length < 4; at = addDays(at, -1))
    if (isWorkDay(at, DEFAULT_SCHEDULE, holidays)) past.unshift(at);
  past = past.slice(-4);
});

describe("asking for a day to be put right", () => {
  it("takes a day of the last 31 days with a reason; one open a day", async () => {
    const ask = { day: past[0], timeIn: "08:30", timeOut: "17:30", reason: "Forgot to sign in" };
    const today = todayManila();
    for (const wrong of [
      { ...ask, day: addDays(today, 1) },
      { ...ask, day: addDays(today, -32) },
      { ...ask, timeOut: "08:00" },
      { ...ask, timeOut: "08:30" },
      { ...ask, reason: "  " },
      { ...ask, timeIn: "8.30" },
    ])
      expect((await send("ryan", "/api/hr/fixes", wrong)).status).toBe(400);
    expect((await send("ryan", "/api/hr/fixes", ask)).status).toBe(200);
    expect((await send("ryan", "/api/hr/fixes", { ...ask, timeIn: "09:00" })).status).toBe(409);
    // No time out is fine: the day had a time in only.
    expect(
      (await send("ryan", "/api/hr/fixes", { day: past[1], timeIn: "07:00", reason: "Phone was dead" })).status,
    ).toBe(200);
    // The CEO's and the Admin's are kept by HR.
    expect((await send("naresh", "/api/hr/fixes", ask)).status).toBe(403);
    expect((await send("admin", "/api/hr/fixes", ask)).status).toBe(403);
    const lines = await mine("ryan");
    expect(lines.map((one) => one.day)).toEqual([past[1], past[0]]);
    expect(lines.every((one) => one.status === "asked" && one.canCancel && !one.canDecide)).toBe(true);
    expect(lines[0]).toMatchObject({ timeIn: "07:00", timeOut: null, approver: expect.stringMatching(/^Daniel/) });
    const [told] = await rows<{ n: number }>(
      db,
      sql`select count(*)::int as n from notification where person_id = ${ids.daniel} and kind = 'fix_request'`,
    );
    expect(told?.n).toBe(2);
  });

  it("waits for the team lead (and HR); the CEO reads, others don't see it", async () => {
    const daniel = await read<FixList>("daniel", "/api/hr/fixes/list?view=waiting");
    expect(daniel.counts.waiting).toBe(2);
    expect(daniel.lines.every((one) => one.canDecide && one.person.id === ids.ryan)).toBe(true);
    const helen = await read<FixList>("helen", "/api/hr/fixes/list?view=waiting");
    expect(helen.counts.waiting).toBe(2);
    const ceo = await read<FixList>("naresh", "/api/hr/fixes/list?view=asked");
    expect(ceo.lines.length).toBe(2);
    expect(ceo.lines.every((one) => !one.canDecide && !one.canCancel)).toBe(true);
    expect((await get("fiona", "/api/hr/fixes/list")).status).toBe(403);
    expect((await get("ryan", "/api/hr/fixes/list")).status).toBe(403);
    const first = daniel.lines[0] as FixLine;
    expect((await send("naresh", `/api/hr/fixes/${first.id}/decide`, { approve: true })).status).toBe(403);
    expect((await send("ryan", `/api/hr/fixes/${first.id}/decide`, { approve: true })).status).toBe(403);
    expect((await send("fiona", `/api/hr/fixes/${first.id}/decide`, { approve: true })).status).toBe(403);
    // On "To decide" for the lead, and among Ryan's own open asks.
    const decisions = await read<Decisions>("daniel", "/api/decisions");
    expect(decisions.forMe.find((one) => one.key === "fixes")?.count).toBe(2);
    const own = await read<Decisions>("ryan", "/api/decisions");
    expect(own.mine.find((one) => one.key === "my-fixes")?.count).toBe(2);
  });

  it("can't be decided while looking as the lead", async () => {
    const opened = await send("naresh", `/api/auth/view/${ids.daniel}`);
    expect(opened.status).toBe(200);
    const looking = opened.headers.getSetCookie().find((one) => one.startsWith("sid="))?.split(";")[0] as string;
    const list = await app.request("/api/hr/fixes/list?view=asked", { headers: { cookie: looking } });
    const seen = (await list.json()) as FixList;
    expect(seen.lines.every((one) => !one.canDecide)).toBe(true);
    const tried = await app.request(`/api/hr/fixes/${seen.lines[0]?.id}/decide`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: looking },
      body: JSON.stringify({ approve: true }),
    });
    expect(tried.status).toBe(403);
    expect((await mine("ryan")).every((one) => one.status === "asked")).toBe(true);
  });

  it("approved, sets the day as a request, writes HR's trail and tells the person", async () => {
    const line = (await mine("ryan")).find((one) => one.day === past[0]) as FixLine;
    expect((await send("daniel", `/api/hr/fixes/${line.id}/decide`, { approve: true })).status).toBe(200);
    expect((await send("helen", `/api/hr/fixes/${line.id}/decide`, { approve: true })).status).toBe(409);
    expect(await dayOf(ids.ryan as number, past[0] as string)).toMatchObject({
      timeIn: "08:30",
      timeOut: "17:30",
      inSource: "request",
      outSource: "request",
      note: "Correction request: Forgot to sign in",
    });
    const month = await read<AttendanceMonth>(
      "ryan",
      `/api/hr/attendance/${ids.ryan}?month=${(past[0] as string).slice(0, 7)}`,
    );
    expect(month.days.find((one) => one.day === past[0])).toMatchObject({
      inFrom: "request",
      outFrom: "request",
      absent: false,
    });
    expect(month.can.askFix).toBe(true);
    expect(month.fixes.find((one) => one.id === line.id)?.status).toBe("approved");
    const trail = await read<HrHistory>("helen", `/api/hr/people/${ids.ryan}/history`);
    expect(trail.lines[0]).toMatchObject({
      kind: "attendance",
      what: `Attendance of ${past[0]} put right: 08:30–17:30 (request)`,
    });
    const [told] = await rows<{ n: number }>(
      db,
      sql`select count(*)::int as n from notification where person_id = ${ids.ryan} and kind = 'fix_approved'`,
    );
    expect(told?.n).toBe(1);
    // Once decided, a new one for the same day may be asked.
    expect(
      (await send("ryan", "/api/hr/fixes", { day: past[0], timeIn: "08:00", reason: "Came earlier" })).status,
    ).toBe(200);
  });

  it("refusing needs a word, and leaves the day as it was", async () => {
    const line = (await mine("ryan")).find((one) => one.day === past[1]) as FixLine;
    expect((await send("helen", `/api/hr/fixes/${line.id}/decide`, { approve: false })).status).toBe(400);
    expect(
      (await send("helen", `/api/hr/fixes/${line.id}/decide`, { approve: false, note: "No sign of you that day" })).status,
    ).toBe(200);
    expect(await dayOf(ids.ryan as number, past[1] as string)).toBeUndefined();
    const after = (await mine("ryan")).find((one) => one.id === line.id);
    expect(after).toMatchObject({ status: "refused", decisionNote: "No sign of you that day", canCancel: false });
    const [told] = await rows<{ n: number }>(
      db,
      sql`select count(*)::int as n from notification where person_id = ${ids.ryan} and kind = 'fix_refused'`,
    );
    expect(told?.n).toBe(1);
  });

  it("the person cancels one waiting (kept, never deleted); nobody else but HR may", async () => {
    expect(
      (await send("ryan", "/api/hr/fixes", { day: past[2], timeIn: "07:10", timeOut: "16:05", reason: "Wrong time" })).status,
    ).toBe(200);
    const line = (await mine("ryan")).find((one) => one.day === past[2]) as FixLine;
    expect((await send("daniel", `/api/hr/fixes/${line.id}/cancel`)).status).toBe(403);
    expect((await send("ryan", `/api/hr/fixes/${line.id}/cancel`)).status).toBe(200);
    expect((await send("ryan", `/api/hr/fixes/${line.id}/cancel`)).status).toBe(409);
    expect((await send("daniel", `/api/hr/fixes/${line.id}/decide`, { approve: true })).status).toBe(409);
    expect((await mine("ryan")).find((one) => one.id === line.id)?.status).toBe("cancelled");
    const [kept] = await rows<{ n: number }>(db, sql`select count(*)::int as n from attendance_fix where id = ${line.id}`);
    expect(kept?.n).toBe(1);
  });

  it("someone under the CEO asks HR; HR sees the person's requests on their month", async () => {
    expect(
      (await send("fiona", "/api/hr/fixes", { day: past[3], timeIn: "07:00", timeOut: "16:00", reason: "Bank run" })).status,
    ).toBe(200);
    const line = (await mine("fiona"))[0] as FixLine;
    expect(line.approver).toBeNull();
    expect((await read<FixList>("daniel", "/api/hr/fixes/list?view=waiting")).lines.some((one) => one.id === line.id)).toBe(false);
    const month = await read<AttendanceMonth>(
      "helen",
      `/api/hr/attendance/${ids.fiona}?month=${(past[3] as string).slice(0, 7)}`,
    );
    expect(month.can.askFix).toBe(false);
    expect(month.fixes.find((one) => one.id === line.id)).toMatchObject({ canDecide: true, status: "asked" });
    expect((await send("helen", `/api/hr/fixes/${line.id}/decide`, { approve: true })).status).toBe(200);
    expect(await dayOf(ids.fiona as number, past[3] as string)).toMatchObject({ timeIn: "07:00", inSource: "request" });
  });
});

describe("HR putting a day right", () => {
  it("is written in HR's trail with the times and the reason", async () => {
    const day = past[0] as string;
    const done = await send("helen", `/api/hr/attendance/${ids.ryan}`, {
      day,
      timeIn: "08:10",
      timeOut: "17:05",
      note: "Biometric was down",
    });
    expect(done.status).toBe(200);
    expect(await dayOf(ids.ryan as number, day)).toMatchObject({ timeIn: "08:10", inSource: "hr" });
    const trail = await read<HrHistory>("helen", `/api/hr/people/${ids.ryan}/history`);
    expect(trail.lines[0]).toMatchObject({
      kind: "attendance",
      by: "Helen",
      what: `Attendance of ${day} put right: 08:10–17:05: Biometric was down`,
    });
  });
});
