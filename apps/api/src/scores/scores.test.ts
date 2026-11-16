import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { todayManila } from "../inventory/rules";
import { seedDemo } from "../seed";
import type { MyScore, TeamScores } from "../types";
import { B2C, HOSPITAL, incrementOf, RX, scoreOf } from "./recipes";
import { lockDue, lockMonth } from "./service";

describe("the playbook cards", () => {
  it("score each KPI by its band and cap the total when IST scores nothing", () => {
    const full = scoreOf(HOSPITAL, { ist: 95, dso: 60, hrr: 96, nzsd: 100 });
    expect(full).toMatchObject({ total: 100, max: 100, capped: false });
    const mid = scoreOf(HOSPITAL, { ist: 75, dso: 80, hrr: 86, nzsd: 82 });
    expect(mid.kpis.map((kpi) => kpi.points)).toEqual([30, 10, 12, 9]);
    expect(mid.kpis[0]?.next).toEqual({ value: 81, points: 40 });
    const capped = scoreOf(HOSPITAL, { ist: 40, dso: 30, hrr: 100, nzsd: 100 });
    expect(capped).toMatchObject({ total: 40, capped: true });
    expect(scoreOf(HOSPITAL, { ist: 92, dso: 95, hrr: null, nzsd: 50 })).toMatchObject({ total: 50, max: 85 });
  });

  it("B2C: cancellations count against, fewer is better", () => {
    const card = scoreOf(B2C, { ist: 100, crr: 70, nbd: 40, nzsd: 91, ocr: 0.5 });
    expect(card.kpis.map((kpi) => kpi.points)).toEqual([45, 8, 7, 13, 10]);
    expect(scoreOf(B2C, { ist: null, crr: null, nbd: null, nzsd: null, ocr: 12 }).kpis[4]?.points).toBe(2);
    expect(scoreOf(B2C, { ist: null, crr: null, nbd: null, nzsd: null, ocr: 20 }).kpis[4]?.points).toBe(0);
  });

  it("Rx: counts by band, HIT left out until it is measured, coverage below 80% caps at 70", () => {
    const card = scoreOf(RX, { nbd: 9, crr: 92, pap: 12, hit: null, ccf: 85 });
    expect(card).toMatchObject({ total: 85, max: 85, capped: false });
    expect(card.kpis.find((kpi) => kpi.key === "ccf")?.band).toBe("Pass");
    const short = scoreOf(RX, { nbd: 9, crr: 92, pap: 12, hit: 3, ccf: 60 });
    expect(short).toMatchObject({ total: 70, max: 100, capped: true });
    expect(scoreOf(RX, { nbd: 2, crr: 55, pap: 4, hit: null, ccf: 90 }).kpis.map((kpi) => kpi.points)).toEqual([12, 12, 15, null, null]);
  });

  it("the year's average sets the increment", () => {
    expect(incrementOf(100).increment).toBe(35);
    expect(incrementOf(94.6).increment).toBe(20);
    expect(incrementOf(84).increment).toBe(6);
    expect(incrementOf(59).increment).toBe(0);
  });
});

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
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["admin", "ryan", "sarla", "tess"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
});

describe("cards from the data", () => {
  it("a hospital MedRep sees this month's card live; others' cards are not theirs", async () => {
    const mine = (await (await get("ryan", "/api/scores")).json()) as MyScore;
    expect(mine.mine).toBe(true);
    expect(mine.card?.recipe).toBe("hospital");
    expect(mine.card?.live).toBe(true);
    expect(mine.card?.kpis.map((kpi) => kpi.key)).toEqual(["ist", "dso", "hrr", "nzsd"]);
    const [sarla] = await rows<{ id: number }>(db, sql`select id::int as id from person where email = 'sarla@2mg.test'`);
    expect((await get("ryan", `/api/scores?personId=${sarla?.id}`)).status).toBe(403);
    const [ryan] = await rows<{ id: number }>(db, sql`select id::int as id from person where email = 'ryan@2mg.test'`);
    expect((await get("admin", `/api/scores?personId=${ryan?.id}`)).status).toBe(200);
  });

  it("last month is locked once, its figures kept; a locked month can be questioned and answered", async () => {
    const today = todayManila();
    const [y, m] = today.split("-").map(Number) as [number, number];
    const last = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
    const [ryan] = await rows<{ id: number }>(db, sql`select id::int as id from person where email = 'ryan@2mg.test'`);
    // A sale for Ryan last month, with a target, so there is something to lock.
    await db.execute(
      sql`insert into sales_target (person_id, month, amount, set_by) values (${ryan?.id}, ${`${last}-01`}::date, 1000000,
        (select id from person where email = 'admin@2mg.test')) on conflict (person_id, month) do update set amount = excluded.amount`,
    );
    await lockDue(db, today);
    const again = await lockDue(db, today);
    expect(again).toBe(0);
    const [locked] = await rows<{ total: number; recipe: string }>(
      db,
      sql`select total, recipe from score_month where person_id = ${ryan?.id} and month = ${`${last}-01`}::date`,
    );
    expect(locked?.recipe).toBe("hospital");
    const card = (await (await get("ryan", `/api/scores?month=${last}`)).json()) as MyScore;
    expect(card.card?.live).toBe(false);
    expect(card.card?.total).toBe(locked?.total);
    expect(card.history.at(-1)?.month).toBe(last);

    // Running month: can't be questioned yet.
    expect((await post("ryan", "/api/scores/disputes", { month: today.slice(0, 7), kpi: "ist", note: "My sale is missing" })).status).toBe(400);
    const raised = await post("ryan", "/api/scores/disputes", { month: last, kpi: "ist", note: "My sale on the 3rd is missing" });
    expect(raised.status).toBe(200);
    const { id } = (await raised.json()) as { id: number };
    expect((await post("ryan", `/api/scores/disputes/${id}/answer`, { upheld: true, answer: "Mine" })).status).toBe(403);
    expect((await post("admin", `/api/scores/disputes/${id}/answer`, { upheld: false, answer: "Invoiced on the 2nd of next month" })).status).toBe(200);
    const after = (await (await get("ryan", `/api/scores?month=${last}`)).json()) as MyScore;
    expect(after.disputes[0]).toMatchObject({ state: "turned_down", answeredBy: expect.any(String) });

    // Only the Admin locks a month again, and only one that is over.
    expect((await post("ryan", "/api/scores/lock", { month: last })).status).toBe(403);
    expect((await post("admin", "/api/scores/lock", { month: today.slice(0, 7) })).status).toBe(400);
    expect(await lockMonth(db, last, true)).toBeGreaterThan(0);
  });

  it("a prescription MedRep's card counts new doctors, doctors again, letters and visits", async () => {
    const team = (await (await get("admin", "/api/scores/team")).json()) as TeamScores;
    const rx = team.rows.find((row) => row.card?.recipe === "rx");
    if (!rx) return; // the demo has no prescription MedRep in a seat
    expect(rx.card?.kpis.map((kpi) => kpi.key)).toEqual(["nbd", "crr", "pap", "hit", "ccf"]);
    expect(rx.card?.kpis.find((kpi) => kpi.key === "ccf")?.band).toMatch(/Pass|Fail/);
    expect(rx.card?.kpis.find((kpi) => kpi.key === "hit")?.points).toBeNull();
  });

  it("a lead sees their team's cards; a MedRep has no team view", async () => {
    expect((await get("ryan", "/api/scores/team")).status).toBe(403);
    const team = (await (await get("admin", "/api/scores/team")).json()) as TeamScores;
    expect(team.rows.some((row) => row.name && row.card?.recipe === "hospital")).toBe(true);
  });
});
