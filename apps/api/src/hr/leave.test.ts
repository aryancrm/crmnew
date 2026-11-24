// Leave asked for by people: it waits for whom they report to (HR when that is the CEO), who
// approves it or refuses it with a word; VL and SL come from the year's days (none on probation);
// the approver and the person are told; approved leave shows in attendance; the CEO only reads.

import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { addDays, todayManila } from "../inventory/rules";
import { seedDemo } from "../seed";
import type { AttendanceMonth, LeaveList, Me, MyLeave } from "../types";
import { DEFAULT_SCHEDULE, isWorkDay } from "./work-time";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
const ids: Record<string, number> = {};
/** Working days ahead, and two gone by. */
const ahead: string[] = [];
let past: string[] = [];

const get = (who: string, path: string) =>
  app.request(path, { headers: { cookie: cookies[who] as string } });
const read = async <T>(who: string, path: string) => (await (await get(who, path)).json()) as T;
const send = (who: string, path: string, body: unknown = {}, method = "POST") =>
  app.request(path, {
    method,
    headers: { "content-type": "application/json", cookie: cookies[who] as string },
    body: JSON.stringify(body),
  });
const ask = (who: string, fields: Record<string, string>, paper = false) => {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  if (paper)
    body.set(
      "file",
      new File([new Uint8Array([37, 80, 68, 70, 1])], "medcert.pdf", { type: "application/pdf" }),
    );
  return app.request("/api/hr/leave/request", {
    method: "POST",
    headers: { cookie: cookies[who] as string },
    body,
  });
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
  const holidays = new Set(
    (
      await rows<{ day: string }>(db, sql`select to_char(day, 'YYYY-MM-DD') as day from holiday`)
    ).map((one) => one.day),
  );
  const today = todayManila();
  // In December the days ahead come from January, so one year holds them all. A week ahead at the
  // earliest: vacation leave needs 7 days' notice (leave-rules.ts).
  const start =
    today.slice(5) > "11-30" ? `${Number(today.slice(0, 4)) + 1}-01-05` : addDays(today, 7);
  const year = start.slice(0, 4);
  for (let at = start; ahead.length < 12 && at.slice(0, 4) === year; at = addDays(at, 1))
    if (isWorkDay(at, DEFAULT_SCHEDULE, holidays)) ahead.push(at);
  for (let at = addDays(today, -1); past.length < 2; at = addDays(at, -1))
    if (isWorkDay(at, DEFAULT_SCHEDULE, holidays)) past.unshift(at);
  past = past.slice(-2);
});

describe("asking for leave", () => {
  it("keeps VL and SL from people on probation: they ask for leave without pay", async () => {
    const refused = await ask("ryan", {
      kind: "vl",
      from: ahead[0] as string,
      to: ahead[0] as string,
    });
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { error: { message: string } }).error.message).toMatch(
      /without pay/,
    );
    const mine = await read<MyLeave>("ryan", "/api/hr/leave/mine");
    expect(mine).toMatchObject({ classification: "probationary", approver: "Daniel" });
    expect(mine.balances.vl).toMatchObject({ allotted: 0, left: 0 });
  });

  it("waits for the team lead, who is told; VL comes from the year's ten days", async () => {
    expect(
      (await send("helen", `/api/hr/people/${ids.ryan}`, { classification: "regular" }, "PATCH"))
        .status,
    ).toBe(200);
    const asked = await ask("ryan", {
      kind: "vl",
      from: ahead[0] as string,
      to: ahead[2] as string,
      reason: "Family trip",
    });
    expect(asked.status).toBe(200);
    expect(
      (await ask("ryan", { kind: "sl", from: ahead[1] as string, to: ahead[1] as string })).status,
    ).toBe(409);
    const mine = await read<MyLeave>("ryan", "/api/hr/leave/mine");
    expect(mine.balances.vl).toMatchObject({ allotted: 10, used: 0, asked: 3, left: 7 });
    const tooMany = await ask("ryan", {
      kind: "vl",
      from: ahead[3] as string,
      to: ahead[11] as string,
    });
    expect(tooMany.status).toBe(400);
    expect(((await tooMany.json()) as { error: { message: string } }).error.message).toMatch(
      /Only 7 days/,
    );

    const [told] = await rows<{ kind: string; link: string }>(
      db,
      sql`select kind, link from notification where person_id = ${ids.daniel} and kind = 'leave_request'`,
    );
    expect(told).toMatchObject({ kind: "leave_request", link: "/hr/leave?view=waiting" });
    const waiting = await read<LeaveList>("daniel", "/api/hr/leave/list?view=waiting");
    expect(waiting.lines.map((one) => one.person.name)).toEqual(["Ryan"]);
    expect(waiting.lines[0]).toMatchObject({
      kind: "vl",
      days: 3,
      approver: "Daniel",
      canDecide: true,
    });
  });

  it("is approved by the team lead, shows in attendance, and the person is told", async () => {
    const waiting = await read<LeaveList>("daniel", "/api/hr/leave/list?view=waiting");
    const id = waiting.lines[0]?.id as number;
    expect((await send("naresh", `/api/hr/leave/${id}/decide`, { approve: true })).status).toBe(
      403,
    );
    expect((await send("ryan", `/api/hr/leave/${id}/decide`, { approve: true })).status).toBe(403);
    expect((await send("daniel", `/api/hr/leave/${id}/decide`, { approve: true })).status).toBe(
      200,
    );
    expect((await send("daniel", `/api/hr/leave/${id}/decide`, { approve: true })).status).toBe(
      409,
    );
    const [told] = await rows<{ kind: string }>(
      db,
      sql`select kind from notification where person_id = ${ids.ryan} and kind = 'leave_approved'`,
    );
    expect(told?.kind).toBe("leave_approved");
    const month = await read<AttendanceMonth>(
      "helen",
      `/api/hr/attendance/${ids.ryan}?month=${(ahead[0] as string).slice(0, 7)}`,
    );
    expect(month.leaves.map((one) => one.id)).toContain(id);
    expect((await read<MyLeave>("ryan", "/api/hr/leave/mine")).balances.vl).toMatchObject({
      used: 3,
      left: 7,
    });
  });

  it("goes to HR when the person reports to the CEO; refusing needs a word", async () => {
    const asked = await ask(
      "fiona",
      { kind: "sl", from: past[0] as string, to: past[1] as string, reason: "Flu" },
      true,
    );
    expect(asked.status).toBe(400);
    expect(
      (await send("helen", `/api/hr/people/${ids.fiona}`, { classification: "regular" }, "PATCH"))
        .status,
    ).toBe(200);
    const again = await ask(
      "fiona",
      { kind: "sl", from: past[0] as string, to: past[1] as string, reason: "Flu" },
      true,
    );
    expect(again.status).toBe(200);
    const { id } = (await again.json()) as { id: number };
    expect((await read<LeaveList>("daniel", "/api/hr/leave/list?view=waiting")).lines).toEqual([]);
    const hr = await read<LeaveList>("helen", "/api/hr/leave/list?view=waiting");
    expect(hr.lines.find((one) => one.id === id)).toMatchObject({
      approver: null,
      file: { name: "medcert.pdf", mime: "application/pdf" },
      canDecide: true,
    });
    for (const who of ["fiona", "helen", "naresh"])
      expect((await get(who, `/api/hr/leave/${id}/file`)).status).toBe(200);
    expect((await get("ryan", `/api/hr/leave/${id}/file`)).status).toBe(403);
    expect((await send("helen", `/api/hr/leave/${id}/decide`, { approve: false })).status).toBe(
      400,
    );
    expect(
      (
        await send("helen", `/api/hr/leave/${id}/decide`, {
          approve: false,
          note: "Bring the certificate",
        })
      ).status,
    ).toBe(200);
    const mine = await read<MyLeave>("fiona", "/api/hr/leave/mine");
    expect(mine.lines.find((one) => one.id === id)).toMatchObject({
      status: "refused",
      decidedBy: "Helen",
      decisionNote: "Bring the certificate",
    });
    expect(mine.balances.sl).toMatchObject({ used: 0, asked: 0, left: 10 });
  });

  it("lets the person cancel leave not started, HR any; the CEO reads every line", async () => {
    const asked = await ask("ryan", {
      kind: "lwop",
      from: ahead[5] as string,
      to: ahead[5] as string,
    });
    const { id } = (await asked.json()) as { id: number };
    expect((await send("daniel", `/api/hr/leave/${id}/cancel`)).status).toBe(403);
    expect((await send("ryan", `/api/hr/leave/${id}/cancel`)).status).toBe(200);
    const ceo = await read<LeaveList>("naresh", "/api/hr/leave/list?view=all");
    expect(ceo.lines.length).toBeGreaterThanOrEqual(3);
    expect(ceo.lines.every((one) => !one.canDecide)).toBe(true);
    expect(
      (await ask("naresh", { kind: "vl", from: ahead[0] as string, to: ahead[0] as string }))
        .status,
    ).toBe(403);
    expect((await get("ryan", "/api/hr/leave/list")).status).toBe(403);
  });
});
