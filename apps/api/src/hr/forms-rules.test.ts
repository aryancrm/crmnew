// Forms, step 3 of docs/HR-PLAN.md: overtime with its type, half-hour times, the night part and
// no overtime on a day with official business; Head Requisition (a lead files overtime for someone
// under them, straight to HR); revoking until decided (kept, with who and from which desk); HR
// returning a form to fix and the person sending it again; the daily accomplishment report and the
// incident report (to HR); and HR's one queue of everything waiting under Leave & forms.

import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { addDays, todayManila } from "../inventory/rules";
import { seedDemo } from "../seed";
import type {
  AttendanceMonth,
  Decisions,
  FixList,
  FormLine,
  FormList,
  HrQueue,
  LeaveList,
  Me,
} from "../types";
import { DEFAULT_SCHEDULE, isWorkDay } from "./work-time";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
const ids: Record<string, number> = {};
const soon: string[] = [];
let yesterday = "";
let sunday = "";

const get = (who: string, path: string) =>
  app.request(path, { headers: { cookie: cookies[who] as string } });
const read = async <T>(who: string, path: string) => (await (await get(who, path)).json()) as T;
const send = (who: string, path: string, body: unknown = {}) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookies[who] as string },
    body: JSON.stringify(body),
  });
const file = async (who: string, body: Record<string, unknown>) => {
  const response = await send(who, "/api/hr/forms", body);
  return { status: response.status, id: response.status === 200 ? ((await response.json()) as { id: number }).id : 0 };
};
const mine = async (who: string, id: number) =>
  (await read<{ lines: FormLine[] }>(who, "/api/hr/forms/mine")).lines.find((one) => one.id === id);
const ot = (day: string, from: string, to: string, more: Record<string, unknown> = {}) => ({
  kind: "ot",
  day,
  from,
  to,
  reason: "Stock count",
  ...more,
});

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["ryan", "daniel", "naresh", "helen", "admin", "jane", "irene"]) {
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
  const today = todayManila();
  for (let at = addDays(today, 1); soon.length < 5; at = addDays(at, 1))
    if (isWorkDay(at, DEFAULT_SCHEDULE, holidays)) soon.push(at);
  for (let at = addDays(today, -1); !yesterday; at = addDays(at, -1))
    if (isWorkDay(at, DEFAULT_SCHEDULE, holidays)) yesterday = at;
  for (let at = addDays(today, 1); !sunday; at = addDays(at, 1))
    if (new Date(`${at}T00:00:00Z`).getUTCDay() === 0 && !holidays.has(at)) sunday = at;
});

describe("overtime", () => {
  it("takes half-hour times, a whole first hour, and the type of the day or broken time", async () => {
    expect((await file("ryan", ot(soon[0] as string, "16:15", "18:00"))).status).toBe(400);
    expect((await file("ryan", ot(soon[0] as string, "16:00", "16:30"))).status).toBe(400);
    expect((await file("ryan", ot(soon[0] as string, "16:00", "18:00", { otType: "rest" }))).status).toBe(400);
    const evening = await file("ryan", ot(soon[0] as string, "16:00", "23:00"));
    expect(evening.status).toBe(200);
    expect(await mine("ryan", evening.id)).toMatchObject({ otType: "regular", minutes: 420, nightMinutes: 60 });
    const rest = await file("ryan", ot(sunday, "08:00", "18:00"));
    expect(rest.status).toBe(200);
    expect(await mine("ryan", rest.id)).toMatchObject({ otType: "rest", minutes: 540, nightMinutes: 0 });
    const broken = await file("ryan", ot(soon[2] as string, "20:00", "02:00", { otType: "broken" }));
    expect(broken.status).toBe(200);
    expect(await mine("ryan", broken.id)).toMatchObject({ otType: "broken", minutes: 360, nightMinutes: 240 });
  });

  it("refuses overtime on a day with official business filed", async () => {
    const ob = await file("ryan", { kind: "ob", day: soon[1], from: "09:00", to: "12:00", place: "Pasay General", reason: "Meeting" });
    expect(ob.status).toBe(200);
    const clash = await send("ryan", "/api/hr/forms", ot(soon[1] as string, "16:00", "18:00"));
    expect(clash.status).toBe(409);
    expect(((await clash.json()) as { error: { message: string } }).error.message).toMatch(/official business/);
  });

  it("counts approved overtime by its rules in attendance (past midnight too)", async () => {
    const night = await file("ryan", ot(yesterday, "20:00", "02:00"));
    expect((await send("daniel", `/api/hr/forms/${night.id}/decide`, { approve: true })).status).toBe(200);
    const month = await read<AttendanceMonth>("helen", `/api/hr/attendance/${ids.ryan}?month=${yesterday.slice(0, 7)}`);
    expect(month.days.find((one) => one.day === yesterday)?.overtimeMinutes).toBe(360);
  });
});

describe("Head Requisition", () => {
  let id = 0;
  it("lets a lead file overtime for someone under them, straight to HR", async () => {
    expect((await file("daniel", ot(soon[3] as string, "16:00", "18:00", { forPersonId: ids.jane }))).status).toBe(403);
    expect((await file("jane", ot(soon[3] as string, "16:00", "18:00", { forPersonId: ids.irene }))).status).toBe(403);
    expect(
      (await file("daniel", { kind: "ob", day: soon[3], from: "09:00", to: "10:00", place: "x", reason: "x", forPersonId: ids.ryan }))
        .status,
    ).toBe(400);
    const made = await file("daniel", ot(soon[3] as string, "16:00", "18:00", { forPersonId: ids.ryan }));
    expect(made.status).toBe(200);
    id = made.id;
    expect(await mine("ryan", id)).toMatchObject({
      person: { id: ids.ryan },
      approver: null,
      headBy: "Daniel",
      canRevoke: false,
    });
    expect((await mine("daniel", id))?.canRevoke).toBe(true);
    expect((await read<FormList>("daniel", "/api/hr/forms/list?view=waiting")).lines.map((one) => one.id)).not.toContain(id);
    expect((await read<FormList>("helen", "/api/hr/forms/list?view=waiting")).lines.map((one) => one.id)).toContain(id);
    const [told] = await rows<{ n: number }>(
      db,
      sql`select count(*)::int as n from notification where person_id = ${ids.ryan} and kind = 'form_filed_for_you'`,
    );
    expect(told?.n).toBe(1);
  });

  it("is revoked by the lead who filed it (at HR's desk), never by the person", async () => {
    expect((await send("ryan", `/api/hr/forms/${id}/revoke`)).status).toBe(403);
    expect((await send("daniel", `/api/hr/forms/${id}/revoke`)).status).toBe(200);
    expect((await mine("daniel", id))?.revoked).toMatchObject({ by: "Daniel", from: "asked", stage: "hr" });
  });
});

describe("revoking and returning forms", () => {
  it("is revoked by the person until decided, kept with who and from which desk", async () => {
    const broken = (await read<{ lines: FormLine[] }>("ryan", "/api/hr/forms/mine")).lines.find(
      (one) => one.day === soon[2] && one.kind === "ot",
    ) as FormLine;
    expect((await send("daniel", `/api/hr/forms/${broken.id}/revoke`)).status).toBe(403);
    expect((await send("ryan", `/api/hr/forms/${broken.id}/revoke`)).status).toBe(200);
    expect(await mine("ryan", broken.id)).toMatchObject({
      status: "revoked",
      revoked: { by: "Ryan", from: "asked", stage: "approver" },
      canRevoke: false,
    });
    const [told] = await rows<{ n: number }>(
      db,
      sql`select count(*)::int as n from notification where person_id = ${ids.daniel} and kind = 'form_revoked'`,
    );
    expect(told?.n).toBe(1);
    const evening = (await read<{ lines: FormLine[] }>("ryan", "/api/hr/forms/mine")).lines.find(
      (one) => one.day === soon[0] && one.kind === "ot",
    ) as FormLine;
    expect((await send("daniel", `/api/hr/forms/${evening.id}/decide`, { approve: true })).status).toBe(200);
    expect((await send("ryan", `/api/hr/forms/${evening.id}/revoke`)).status).toBe(409);
    // The same day can be filed again once revoked.
    expect((await file("ryan", ot(soon[2] as string, "16:00", "18:00"))).status).toBe(200);
  });

  it("is returned by HR with what to fix; the person sends it again, or revokes it", async () => {
    const ob = (await read<{ lines: FormLine[] }>("ryan", "/api/hr/forms/mine")).lines.find(
      (one) => one.kind === "ob",
    ) as FormLine;
    expect((await send("helen", `/api/hr/forms/${ob.id}/return`, {})).status).toBe(400);
    expect((await send("daniel", `/api/hr/forms/${ob.id}/return`, { note: "x" })).status).toBe(403);
    expect((await send("helen", `/api/hr/forms/${ob.id}/return`, { note: "Name the hospital" })).status).toBe(200);
    expect(await mine("ryan", ob.id)).toMatchObject({
      status: "returned",
      returnNote: "Name the hospital",
      canResend: true,
      canRevoke: true,
    });
    const decisions = await read<Decisions>("ryan", "/api/decisions");
    expect(decisions.forMe.find((one) => one.key === "forms:returned")?.count).toBe(1);
    // Another form of the kind that day waits until this one is sent again or revoked.
    expect(
      (await file("ryan", { kind: "ob", day: soon[1], from: "13:00", to: "15:00", place: "x", reason: "x" })).status,
    ).toBe(409);
    const fixed = { kind: "ob", day: soon[1], from: "09:00", to: "12:00", reason: "Meeting" };
    expect((await send("daniel", `/api/hr/forms/${ob.id}/resend`, { ...fixed, place: "x" })).status).toBe(403);
    expect((await send("ryan", `/api/hr/forms/${ob.id}/resend`, fixed)).status).toBe(400);
    expect(
      (await send("ryan", `/api/hr/forms/${ob.id}/resend`, { ...fixed, place: "Pasay General Hospital" })).status,
    ).toBe(200);
    expect(await mine("ryan", ob.id)).toMatchObject({ status: "asked", place: "Pasay General Hospital", canDecide: false });
    expect((await read<FormList>("daniel", "/api/hr/forms/list?view=waiting")).lines.map((one) => one.id)).toContain(ob.id);
    expect((await send("helen", `/api/hr/forms/${ob.id}/return`, { note: "Wrong day" })).status).toBe(200);
    expect((await send("ryan", `/api/hr/forms/${ob.id}/revoke`)).status).toBe(200);
    expect((await mine("ryan", ob.id))?.revoked).toMatchObject({ from: "returned" });
  });
});

describe("the daily accomplishment report and the incident report", () => {
  it("files the day's activities to HR", async () => {
    const eod = { kind: "eod", day: soon[4], reason: "Hospital calls" };
    expect((await file("ryan", eod)).status).toBe(400);
    expect(
      (await file("ryan", { ...eod, activities: [{ timeIn: "9", timeOut: "10:00", details: "Calls" }] })).status,
    ).toBe(400);
    const made = await file("ryan", {
      ...eod,
      activities: [
        { timeIn: "08:00", timeOut: "10:00", location: "Pasay", details: "Visited the pharmacy head" },
        { timeIn: "10:30", timeOut: "12:00", details: "Reports", remarks: "Done" },
      ],
    });
    expect(made.status).toBe(200);
    const line = await mine("ryan", made.id);
    expect(line).toMatchObject({ approver: null, details: { activities: [{ location: "Pasay" }, { remarks: "Done" }] } });
    expect((await read<FormList>("daniel", "/api/hr/forms/list?view=waiting")).lines.map((one) => one.id)).not.toContain(made.id);
    expect((await send("helen", `/api/hr/forms/${made.id}/decide`, { approve: true })).status).toBe(200);
  });

  it("reports an incident within 30 days, never ahead, to HR, who takes it in", async () => {
    const incident = {
      time: "14:30",
      location: "Warehouse",
      type: "Property Damage",
      persons: "None",
      action: "Cleaned up",
    };
    const base = { kind: "incident", reason: "A shelf fell" };
    expect((await file("ryan", { ...base, day: soon[0], incident })).status).toBe(400);
    expect((await file("ryan", { ...base, day: yesterday, incident: { ...incident, persons: "" } })).status).toBe(400);
    expect((await file("ryan", { ...base, day: yesterday, incident: { ...incident, type: "Other" } })).status).toBe(400);
    const made = await file("ryan", { ...base, day: yesterday, incident });
    expect(made.status).toBe(200);
    expect(await mine("ryan", made.id)).toMatchObject({
      approver: null,
      canReturn: false,
      details: { type: "Property Damage", location: "Warehouse" },
    });
    expect((await send("helen", `/api/hr/forms/${made.id}/return`, { note: "x" })).status).toBe(403);
    expect((await send("helen", `/api/hr/forms/${made.id}/decide`, { approve: false, note: "x" })).status).toBe(400);
    expect((await send("helen", `/api/hr/forms/${made.id}/decide`, { approve: true })).status).toBe(200);
  });
});

describe("HR's one queue", () => {
  it("counts everything waiting across leave, forms and attendance, as the lists do", async () => {
    expect((await send("ryan", "/api/hr/fixes", { day: yesterday, timeIn: "07:00", reason: "Forgot" })).status).toBe(200);
    const leave = new FormData();
    for (const [key, value] of Object.entries({ kind: "lwop", from: soon[4] as string, to: soon[4] as string }))
      leave.set(key, value);
    expect(
      (await app.request("/api/hr/leave/request", { method: "POST", headers: { cookie: cookies.jane as string }, body: leave }))
        .status,
    ).toBe(200);
    const queue = await read<HrQueue>("helen", "/api/hr/queue");
    const lists = {
      leave: (await read<LeaveList>("helen", "/api/hr/leave/list?view=waiting")).counts.waiting,
      forms: (await read<FormList>("helen", "/api/hr/forms/list?view=waiting")).counts.waiting,
      fixes: (await read<FixList>("helen", "/api/hr/fixes/list?view=waiting")).counts.waiting,
    };
    expect(queue).toMatchObject(lists);
    expect(queue.total).toBe(lists.leave + lists.forms + lists.fixes);
    expect(queue.leave).toBeGreaterThanOrEqual(1);
    expect(queue.forms).toBeGreaterThanOrEqual(1);
    expect(queue.fixes).toBeGreaterThanOrEqual(1);
    // Jane reports to the CEO: her leave is HR's own; Ryan's day waits for Daniel first.
    expect(queue.atHr).toMatchObject({ leave: 1, fixes: 0 });
    const decisions = await read<Decisions>("helen", "/api/decisions");
    const line = (key: string) => decisions.forMe.find((one) => one.key === key)?.count ?? 0;
    expect(line("leave") + line("forms") + line("fixes")).toBe(queue.total);
    const lead = await read<HrQueue>("daniel", "/api/hr/queue");
    expect(lead.atHr).toBeNull();
    expect(lead.fixes).toBe(1);
    expect((await get("ryan", "/api/hr/queue")).status).toBe(403);
  });
});
