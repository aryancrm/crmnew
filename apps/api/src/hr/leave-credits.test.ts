// Leave, step 3 of docs/HR-PLAN.md: credits HR adjusts (a ledger, reversed never edited, in HR's
// trail), the 7-day notice for vacation leave, sick leave after the fact, proof files (up to five;
// two days of sick leave need one), a second approver (the first to decide wins), revoking approved
// leave (kept, its days back) and the year-end report of VL to convert.

import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { addDays, todayManila } from "../inventory/rules";
import { seedDemo } from "../seed";
import type { LeaveCredits, LeaveList, Me, MyLeave, VlConversion } from "../types";
import { DEFAULT_SCHEDULE, isWorkDay } from "./work-time";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
const ids: Record<string, number> = {};
/** Working days from a week ahead (one year), the days from tomorrow, and working days gone by. */
const ahead: string[] = [];
const soon: string[] = [];
let past: string[] = [];
let year = 0;

const get = (who: string, path: string) =>
  app.request(path, { headers: { cookie: cookies[who] as string } });
const read = async <T>(who: string, path: string) => (await (await get(who, path)).json()) as T;
const send = (who: string, path: string, body: unknown = {}, method = "POST") =>
  app.request(path, {
    method,
    headers: { "content-type": "application/json", cookie: cookies[who] as string },
    body: JSON.stringify(body),
  });
const pdf = (name: string) =>
  new File([new Uint8Array([37, 80, 68, 70, 1, name.length])], name, { type: "application/pdf" });
const ask = (who: string, fields: Record<string, string>, papers: File[] = []) => {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  for (const paper of papers) body.append("file", paper);
  return app.request("/api/hr/leave/request", {
    method: "POST",
    headers: { cookie: cookies[who] as string },
    body,
  });
};
const message = async (response: Response) =>
  ((await response.json()) as { error: { message: string } }).error.message;

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["ryan", "daniel", "naresh", "helen", "admin", "irene", "jane", "fiona"]) {
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
  const start =
    today.slice(5) > "11-30" ? `${Number(today.slice(0, 4)) + 1}-01-05` : addDays(today, 7);
  year = Number(start.slice(0, 4));
  for (let at = start; ahead.length < 12 && at.slice(0, 4) === start.slice(0, 4); at = addDays(at, 1))
    if (isWorkDay(at, DEFAULT_SCHEDULE, holidays)) ahead.push(at);
  for (let at = addDays(today, 1); soon.length < 3; at = addDays(at, 1))
    if (isWorkDay(at, DEFAULT_SCHEDULE, holidays)) soon.push(at);
  for (let at = addDays(today, -1); past.length < 2; at = addDays(at, -1))
    if (isWorkDay(at, DEFAULT_SCHEDULE, holidays)) past.unshift(at);
  past = past.slice(-2);
  for (const who of ["ryan", "fiona"])
    expect(
      (await send("helen", `/api/hr/people/${ids[who]}`, { classification: "regular", salary: 3_130_000 }, "PATCH"))
        .status,
    ).toBe(200);
});

describe("credits HR adjusts", () => {
  it("adds and takes off days with a reason, in half days; only HR and the Admin", async () => {
    const path = `/api/hr/people/${ids.ryan}/credits`;
    expect((await send("helen", path, { year, kind: "vl", days: 2.5 })).status).toBe(400);
    expect((await send("helen", path, { year, kind: "vl", days: 0.3, reason: "x" })).status).toBe(400);
    expect((await send("helen", path, { year, kind: "vl", days: 0, reason: "x" })).status).toBe(400);
    for (const who of ["daniel", "naresh", "ryan"])
      expect((await send(who, path, { year, kind: "vl", days: 1, reason: "x" })).status).toBe(403);
    expect(
      (await send("helen", path, { year, kind: "vl", days: 2.5, reason: "Carried from the old tracker" })).status,
    ).toBe(200);
    expect((await send("admin", path, { year, kind: "sl", days: -1, reason: "Used before the CRM" })).status).toBe(200);
    const credits = await read<LeaveCredits>("naresh", `${path}?year=${year}`);
    expect(credits.can.adjust).toBe(false);
    expect(credits.vl).toMatchObject({ opening: 10, adjusted: 2.5, allotted: 12.5, left: 12.5 });
    expect(credits.sl).toMatchObject({ opening: 10, adjusted: -1, allotted: 9 });
    expect(credits.lines.map((one) => one.days)).toEqual([-1, 2.5]);
    expect((await get("daniel", path)).status).toBe(403);
    const mine = await read<MyLeave>("ryan", `/api/hr/leave/mine?year=${year}`);
    expect(mine.balances.vl.allotted).toBe(12.5);
    expect(mine.credits.length).toBe(2);
  });

  it("reverses a line with another that names it, once; both in HR's trail", async () => {
    const path = `/api/hr/people/${ids.ryan}/credits?year=${year}`;
    const line = (await read<LeaveCredits>("helen", path)).lines.find((one) => one.days === 2.5);
    expect((await send("helen", `/api/hr/credits/${line?.id}/reverse`, {})).status).toBe(400);
    expect((await send("daniel", `/api/hr/credits/${line?.id}/reverse`, { reason: "x" })).status).toBe(403);
    const reversed = await send("helen", `/api/hr/credits/${line?.id}/reverse`, { reason: "Typed twice" });
    expect(reversed.status).toBe(200);
    const { id } = (await reversed.json()) as { id: number };
    expect((await send("helen", `/api/hr/credits/${line?.id}/reverse`, { reason: "again" })).status).toBe(409);
    expect((await send("helen", `/api/hr/credits/${id}/reverse`, { reason: "again" })).status).toBe(409);
    const after = await read<LeaveCredits>("helen", path);
    expect(after.vl).toMatchObject({ adjusted: 0, allotted: 10 });
    expect(after.lines.find((one) => one.id === line?.id)?.reversedBy).toBe(id);
    expect(after.lines.find((one) => one.id === id)).toMatchObject({ days: -2.5, reverses: line?.id });
    // Nothing deleted: three lines kept.
    const [kept] = await rows<{ n: number }>(db, sql`select count(*)::int as n from leave_credit where person_id = ${ids.ryan}`);
    expect(kept?.n).toBe(3);
    const trail = await rows<{ what: string }>(
      db,
      sql`select what from hr_event where person_id = ${ids.ryan} and kind = 'leave' order by id`,
    );
    expect(trail.length).toBe(3);
    expect(trail[2]?.what).toMatch(/reversed \(Typed twice\)/);
  });

  it("lets someone on probation use days HR gave", async () => {
    expect((await ask("jane", { kind: "vl", from: ahead[0] as string, to: ahead[0] as string })).status).toBe(400);
    await send("helen", `/api/hr/people/${ids.jane}/credits`, { year, kind: "vl", days: 1, reason: "Granted by the CEO" });
    expect((await ask("jane", { kind: "vl", from: ahead[0] as string, to: ahead[0] as string })).status).toBe(200);
  });
});

describe("the leave rules", () => {
  it("asks 7 days' notice for vacation leave", async () => {
    const early = await ask("ryan", { kind: "vl", from: soon[0] as string, to: soon[0] as string });
    expect(early.status).toBe(400);
    expect(await message(early)).toMatch(/7 days' notice/);
    const mine = await read<MyLeave>("ryan", "/api/hr/leave/mine");
    expect(mine.rules).toMatchObject({ vlNoticeDays: 7, slProofFromDays: 2, filesMax: 5 });
  });

  it("takes sick leave after the fact, and asks a certificate for two days or more", async () => {
    const old = addDays(todayManila(), -31);
    expect((await ask("fiona", { kind: "sl", from: old, to: old })).status).toBe(400);
    const two = await ask("fiona", { kind: "sl", from: past[0] as string, to: past[1] as string });
    expect(two.status).toBe(400);
    expect(await message(two)).toMatch(/medical certificate/);
    const one = await ask("fiona", { kind: "sl", from: past[1] as string, to: past[1] as string });
    expect(one.status).toBe(200);
  });

  it("carries up to five proof files, each opened by whoever reads the leave", async () => {
    const six = ["a", "b", "c", "d", "e", "f"].map((one) => pdf(`${one}.pdf`));
    expect((await ask("ryan", { kind: "lwop", from: soon[1] as string, to: soon[1] as string }, six)).status).toBe(400);
    const asked = await ask(
      "ryan",
      { kind: "lwop", from: soon[1] as string, to: soon[1] as string, reason: "Errand" },
      [pdf("one.pdf"), pdf("two.pdf")],
    );
    expect(asked.status).toBe(200);
    const { id } = (await asked.json()) as { id: number };
    const line = (await read<MyLeave>("ryan", "/api/hr/leave/mine")).lines.find((one) => one.id === id);
    expect(line?.files.map((one) => one.name)).toEqual(["one.pdf", "two.pdf"]);
    expect(line?.file).toMatchObject({ name: "one.pdf" });
    for (const file of line?.files ?? []) {
      for (const who of ["ryan", "daniel", "helen", "naresh"])
        expect((await get(who, `/api/hr/leave/${id}/files/${file.id}`)).status).toBe(200);
      for (const who of ["jane", "irene"])
        expect((await get(who, `/api/hr/leave/${id}/files/${file.id}`)).status).toBe(403);
    }
    expect((await get("ryan", `/api/hr/leave/${id}/files/999999`)).status).toBe(404);
    expect((await send("ryan", `/api/hr/leave/${id}/cancel`)).status).toBe(200);
  });
});

describe("a second approver", () => {
  it("is named by HR, sees the person's leave, and the first of the two to decide wins", async () => {
    const path = `/api/hr/people/${ids.ryan}/second-approver`;
    expect((await send("daniel", path, { personId: ids.irene })).status).toBe(403);
    expect((await send("helen", path, { personId: ids.ryan })).status).toBe(400);
    expect((await send("helen", path, { personId: ids.irene })).status).toBe(200);
    expect((await read<LeaveCredits>("helen", `/api/hr/people/${ids.ryan}/credits`)).secondApprover).toMatchObject({
      name: "Irene",
    });
    const first = await ask("ryan", { kind: "lwop", from: ahead[1] as string, to: ahead[1] as string });
    const second = await ask("ryan", { kind: "lwop", from: ahead[2] as string, to: ahead[2] as string });
    const firstId = ((await first.json()) as { id: number }).id;
    const secondId = ((await second.json()) as { id: number }).id;
    const irene = await read<LeaveList>("irene", "/api/hr/leave/list?view=waiting");
    expect(irene.lines.map((one) => one.id).sort()).toEqual([firstId, secondId].sort());
    expect(irene.lines[0]).toMatchObject({ approver: "Daniel", secondApprover: "Irene", canDecide: true });
    const [told] = await rows<{ n: number }>(
      db,
      sql`select count(*)::int as n from notification where person_id = ${ids.irene} and kind = 'leave_request'`,
    );
    expect(told?.n).toBe(2);
    // Irene first on one, Daniel first on the other: the later one finds it decided.
    expect((await send("irene", `/api/hr/leave/${firstId}/decide`, { approve: true })).status).toBe(200);
    expect((await send("daniel", `/api/hr/leave/${firstId}/decide`, { approve: false, note: "No" })).status).toBe(409);
    expect((await send("daniel", `/api/hr/leave/${secondId}/decide`, { approve: true })).status).toBe(200);
    expect((await send("irene", `/api/hr/leave/${secondId}/decide`, { approve: true })).status).toBe(409);
    // Someone who is nobody's second approver (and no lead) still has no list.
    expect((await get("jane", "/api/hr/leave/list")).status).toBe(403);
    const history = await rows<{ what: string }>(
      db,
      sql`select what from hr_event where person_id = ${ids.ryan} and what like 'Second approver%'`,
    );
    expect(history.length).toBe(1);
  });
});

describe("revoking approved leave", () => {
  it("is the person's until the first day, HR's any time; kept, and its days come back", async () => {
    const asked = await ask("ryan", { kind: "vl", from: ahead[4] as string, to: ahead[6] as string, reason: "Trip" });
    expect(asked.status).toBe(200);
    const { id } = (await asked.json()) as { id: number };
    expect((await send("ryan", `/api/hr/leave/${id}/revoke`, {})).status).toBe(409);
    expect((await send("daniel", `/api/hr/leave/${id}/decide`, { approve: true })).status).toBe(200);
    const before = await read<MyLeave>("ryan", `/api/hr/leave/mine?year=${year}`);
    expect(before.balances.vl).toMatchObject({ used: 3, left: 7 });
    expect(before.lines.find((one) => one.id === id)).toMatchObject({ canRevoke: true, canPrint: true });
    expect((await send("daniel", `/api/hr/leave/${id}/revoke`, {})).status).toBe(403);
    expect((await send("ryan", `/api/hr/leave/${id}/revoke`, { reason: "Trip moved" })).status).toBe(200);
    const after = await read<MyLeave>("ryan", `/api/hr/leave/mine?year=${year}`);
    expect(after.balances.vl).toMatchObject({ used: 0, left: 10 });
    expect(after.lines.find((one) => one.id === id)).toMatchObject({
      status: "revoked",
      revokedBy: "Ryan",
      revokeReason: "Trip moved",
      canRevoke: false,
    });
    const [told] = await rows<{ n: number }>(
      db,
      sql`select count(*)::int as n from notification where person_id = ${ids.daniel} and kind = 'leave_revoked'`,
    );
    expect(told?.n).toBe(1);
    const hr = await read<LeaveList>("helen", "/api/hr/leave/list?view=revoked");
    expect(hr.lines.map((one) => one.id)).toContain(id);
    expect(hr.counts.revoked).toBe(1);
  });
});

describe("the year-end report", () => {
  it("shows each person's unused VL and half of it in pesos at their day rate; HR, the CEO, the Admin", async () => {
    for (const who of ["daniel", "ryan"])
      expect((await get(who, `/api/hr/leave/conversion?year=${year}`)).status).toBe(403);
    const report = await read<VlConversion>("naresh", `/api/hr/leave/conversion?year=${year}`);
    const ryan = report.people.find((one) => one.personId === ids.ryan);
    // 10 days, none used (the trip was revoked): 5 days at ₱1,200.
    expect(ryan).toMatchObject({ total: 10, used: 0, unused: 10, convertDays: 5, perDay: 120_000, amount: 600_000 });
    expect(report.totals.amount).toBeGreaterThanOrEqual(600_000);
  });
});
