import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedDemo } from "../seed";
import type { Collections, District, Huddle, MyScore, Pulse, TeamHuddle } from "../types";
import { seedHospitalBoxes } from "./seed";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
const get = (who: string, path: string) => app.request(path, { headers: { cookie: cookies[who] as string } });
const post = (who: string, path: string, body: unknown) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookies[who] as string },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  expect(await seedHospitalBoxes(db, PASSWORD)).toBe(true);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["admin", "ryan", "daniel", "vanessa", "sarla", "ana", "rey"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
});

describe("a Hospital CHC's day", () => {
  it("today's pulse: four lights, a seller's only", async () => {
    const response = await get("ryan", "/api/my/pulse");
    expect(response.status).toBe(200);
    const pulse = (await response.json()) as Pulse;
    expect(pulse.tiles.map((tile) => tile.key)).toEqual(["sales", "dso", "reorder", "invoice"]);
    expect(pulse.lastDay < pulse.today).toBe(true);
    expect((await get("daniel", "/api/my/pulse")).status).toBe(403);
  });

  it("collections: each customer's oldest unpaid invoice with its age flag", async () => {
    const mine = (await (await get("ryan", "/api/my/collections")).json()) as Collections;
    expect(mine.scope).toBe("My customers");
    for (const row of mine.rows) expect(row.flag).toBe(row.age >= 90 ? "d90" : row.age >= 75 ? "d75" : row.age >= 60 ? "d60" : "ok");
    expect(mine.buckets.reduce((sum, one) => sum + one.amount, 0)).toBe(mine.total);
    expect((await get("sarla", "/api/my/collections")).status).toBe(403);
  });

  it("the 7 PM huddle: prefilled, a blocker when no invoice, and the coach reads it", async () => {
    const before = (await (await get("ryan", "/api/huddle")).json()) as Huddle;
    expect(before.declared).toBeNull();
    const noBlocker = await post("ryan", "/api/huddle", { ...before.actual, invoiced: false, blocker: "" });
    expect(noBlocker.status).toBe(400);
    const ok = await post("ryan", "/api/huddle", { ...before.actual, invoiced: false, blocker: "PO not signed at the hospital", tomorrow: "Pasay General" });
    expect(ok.status).toBe(200);
    const after = (await (await get("ryan", "/api/huddle")).json()) as Huddle;
    expect(after.declared?.blocker).toBe("PO not signed at the hospital");
    expect((await post("daniel", "/api/huddle", { ...before.actual, invoiced: true })).status).toBe(403);
    const team = (await (await get("daniel", "/api/huddle/team")).json()) as TeamHuddle;
    const ryan = team.rows.find((row) => row.name === "Ryan");
    expect(ryan?.declared?.tomorrow).toBe("Pasay General");
    expect(team.declared).toBeGreaterThanOrEqual(1);
    expect((await get("ryan", "/api/huddle/team")).status).toBe(403);
    const [count] = await rows<{ n: number }>(db, sql`select count(*)::int as n from huddle`);
    expect(count?.n).toBe(1);
  });

  it("the coach's district now: each CHC's month, worst first, and who needs the coach", async () => {
    const response = await get("daniel", "/api/team/district");
    expect(response.status).toBe(200);
    const district = (await response.json()) as District;
    expect(district.rows.some((row) => row.name === "Ryan")).toBe(true);
    for (let n = 1; n < district.rows.length; n++)
      expect((district.rows[n - 1] as District["rows"][number]).weight).toBeGreaterThanOrEqual((district.rows[n] as District["rows"][number]).weight);
    const ryan = district.rows.find((row) => row.name === "Ryan");
    expect(ryan?.huddle?.declared).toBe(true);
    expect((await get("ryan", "/api/team/district")).status).toBe(403);
    // Up the line: the head of the division sees the same CHCs with their coach, and the huddle.
    const division = (await (await get("vanessa", "/api/team/district")).json()) as District;
    const seen = division.rows.find((row) => row.name === "Ryan");
    expect(seen?.coach).toBe("Daniel");
    expect(seen?.huddle?.declared).toBe(true);
    const evening = (await (await get("vanessa", "/api/huddle/team")).json()) as TeamHuddle;
    expect(evening.rows.find((row) => row.name === "Ryan")?.declared?.blocker).toBe("PO not signed at the hospital");
  });

  it("each Hospital box gets its own work: anesthesia telesales sell to hospitals, the bidding coachee works tenders", async () => {
    // Anesthesia telesales (TS inside the Hospital Division): the hospital pulse, no care groups,
    // the Hospital CHC card; counted with the division, not as Rx telesales.
    const pulse = (await (await get("ana", "/api/my/pulse")).json()) as Pulse;
    expect(pulse.tiles.map((tile) => tile.key)).toEqual(["sales", "dso", "reorder", "invoice"]);
    expect((await get("ana", "/api/care-groups")).status).toBe(403);
    expect((await get("ana", "/api/huddle")).status).toBe(403);
    const division = (await (await get("vanessa", "/api/team/district")).json()) as District;
    expect(division.rows.map((row) => row.name)).toContain("Ana");
    // The government bidding coachee: no CHC card, no huddle, not counted as a CHC.
    expect(division.rows.map((row) => row.name)).not.toContain("Rey");
    expect((await get("rey", "/api/huddle")).status).toBe(403);
    const rey = (await (await get("rey", "/api/scores")).json()) as MyScore;
    expect(rey.card).toBeNull();
    const evening = (await (await get("vanessa", "/api/huddle/team")).json()) as TeamHuddle;
    expect(evening.rows.map((row) => row.name)).not.toContain("Ana");
    expect(evening.rows.map((row) => row.name)).not.toContain("Rey");
  });
});
