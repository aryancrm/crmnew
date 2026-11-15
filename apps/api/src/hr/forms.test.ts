// HR's forms: official business, work from home and overtime, asked by the person, decided by
// whom they report to (HR when that is the CEO); approved ones change attendance: an OB or WFH day
// isn't absent and counts its hours, overtime counts as approved overtime.

import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { addDays, todayManila } from "../inventory/rules";
import { seedDemo } from "../seed";
import type { AttendanceMonth, AttendanceReport, FormLine, FormList, Me } from "../types";
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
const decideFirst = async (who: string, approve: boolean, note?: string) => {
  const list = await read<FormList>(who, "/api/hr/forms/list?view=waiting");
  return send(who, `/api/hr/forms/${list.lines[0]?.id}/decide`, { approve, note });
};

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["ryan", "daniel", "naresh", "fiona", "helen"]) {
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
    (
      await rows<{ day: string }>(db, sql`select to_char(day, 'YYYY-MM-DD') as day from holiday`)
    ).map((one) => one.day),
  );
  for (let at = addDays(todayManila(), -1); past.length < 3; at = addDays(at, -1))
    if (isWorkDay(at, DEFAULT_SCHEDULE, holidays)) past.unshift(at);
  past = past.slice(-3);
});

describe("HR forms", () => {
  it("asks for the hours and the place of official business; one of a kind a day", async () => {
    const ob = { kind: "ob", day: past[0], from: "09:00", to: "12:00", reason: "Hospital meeting" };
    expect((await send("ryan", "/api/hr/forms", ob)).status).toBe(400);
    expect(
      (await send("ryan", "/api/hr/forms", { ...ob, place: "Pasay General", to: "08:00" })).status,
    ).toBe(400);
    expect((await send("ryan", "/api/hr/forms", { ...ob, place: "Pasay General" })).status).toBe(
      200,
    );
    expect((await send("ryan", "/api/hr/forms", { ...ob, place: "Elsewhere" })).status).toBe(409);
    expect(
      (await send("ryan", "/api/hr/forms", { kind: "wfh", day: past[1], reason: "Reports" }))
        .status,
    ).toBe(200);
    expect(
      (
        await send("ryan", "/api/hr/forms", {
          kind: "ot",
          day: past[2],
          from: "16:00",
          to: "18:00",
          reason: "Stock count",
        })
      ).status,
    ).toBe(200);
    expect(
      (await send("naresh", "/api/hr/forms", { kind: "wfh", day: past[1], reason: "x" })).status,
    ).toBe(403);
  });

  it("goes to the team lead, who approves; the CEO can't decide", async () => {
    const waiting = await read<FormList>("daniel", "/api/hr/forms/list?view=waiting");
    expect(waiting.lines.map((one) => one.kind).sort()).toEqual(["ob", "ot", "wfh"]);
    expect(waiting.lines.find((one) => one.kind === "ot")?.minutes).toBe(120);
    const first = waiting.lines[0] as FormLine;
    expect(
      (await send("naresh", `/api/hr/forms/${first.id}/decide`, { approve: true })).status,
    ).toBe(403);
    for (let at = 0; at < 3; at += 1) expect((await decideFirst("daniel", true)).status).toBe(200);
    const [told] = await rows<{ n: number }>(
      db,
      sql`select count(*)::int as n from notification where person_id = ${ids.ryan} and kind = 'form_approved'`,
    );
    expect(told?.n).toBe(3);
  });

  it("counts an OB or WFH day as worked, never absent, and overtime as approved overtime", async () => {
    const month = await read<AttendanceMonth>(
      "helen",
      `/api/hr/attendance/${ids.ryan}?month=${(past[0] as string).slice(0, 7)}`,
    );
    expect(month.days.find((one) => one.day === past[0])).toMatchObject({
      form: "ob",
      absent: false,
      workedMinutes: 180,
    });
    if ((past[1] as string).slice(0, 7) === (past[0] as string).slice(0, 7))
      expect(month.days.find((one) => one.day === past[1])).toMatchObject({
        form: "wfh",
        absent: false,
        workedMinutes: 8 * 60,
      });
    const report = await read<AttendanceReport>(
      "naresh",
      `/api/hr/attendance/report?from=${past[0]}&to=${past[2]}`,
    );
    expect(report.people.find((one) => one.personId === ids.ryan)).toMatchObject({
      present: 2,
      absent: 1,
      overtimeMinutes: 120,
      formDays: 2,
    });
  });

  it("sends a form from someone under the CEO to HR; refusing needs a word; cancelling", async () => {
    expect(
      (await send("fiona", "/api/hr/forms", { kind: "wfh", day: past[2], reason: "Closing books" }))
        .status,
    ).toBe(200);
    expect((await read<FormList>("daniel", "/api/hr/forms/list?view=waiting")).lines).toEqual([]);
    expect((await decideFirst("helen", false)).status).toBe(400);
    expect((await decideFirst("helen", false, "Come to the office for closing")).status).toBe(200);
    const all = await read<FormList>("naresh", "/api/hr/forms/list?view=all");
    expect(all.lines.length).toBe(4);
    expect(all.lines.every((one) => !one.canDecide && !one.canCancel)).toBe(true);
    const ryan = await read<{ lines: FormLine[] }>("ryan", "/api/hr/forms/mine");
    const ob = ryan.lines.find((one) => one.kind === "ob") as FormLine;
    expect(ob.canCancel).toBe(false);
    expect((await send("ryan", `/api/hr/forms/${ob.id}/cancel`)).status).toBe(403);
    expect((await send("helen", `/api/hr/forms/${ob.id}/cancel`)).status).toBe(200);
  });
});
