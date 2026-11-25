import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedDemoInventory } from "../inventory/seed";
import { seedDemo } from "../seed";
import type { FoundList } from "../types";
import { fetchWay, useFetchers } from "./fetch-now";
import { seedBidding } from "./seed";

const PASSWORD = "test-password-1";
const KEY = "robot-key-for-the-tests-0123456789";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
const press = (who: string) =>
  app.request("/api/tenders/found/robot/fetch", { method: "POST", headers: { "content-type": "application/json", cookie: cookies[who] as string }, body: "{}" });
const state = async () => ((await (await app.request("/api/tenders/found", { headers: { cookie: cookies.jimmy as string } })).json()) as FoundList).robot.fetch;
const asks = () => rows<{ via: string; status: string; note: string | null }>(db, sql`select via, status, note from tender_find_ask order by id`);

let dispatched = 0;
let dispatchFails: string | null = null;
let endRun: ((problem: string | null) => void) | null = null;

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  await seedDemoInventory(db);
  await seedBidding(db, PASSWORD);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["jimmy", "ryan"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
  useFetchers({
    dispatch: async () => {
      if (dispatchFails) throw new Error(dispatchFails);
      dispatched += 1;
    },
    runHere: (onEnd) => {
      endRun = onEnd;
    },
  });
});
beforeEach(async () => {
  await db.execute(sql`delete from tender_find_ask`);
  await db.execute(sql`delete from tender_find_run`);
  dispatched = 0;
  dispatchFails = null;
  endRun = null;
  for (const name of ["TENDER_FINDER_FETCH", "TENDER_FINDER_DISPATCH_TOKEN", "TENDER_FINDER_KEY", "TENDER_FINDER_GITHUB"]) delete process.env[name];
});
afterAll(() => {
  for (const name of ["TENDER_FINDER_FETCH", "TENDER_FINDER_DISPATCH_TOKEN", "TENDER_FINDER_KEY", "TENDER_FINDER_GITHUB"]) delete process.env[name];
});

describe("Fetch now", () => {
  it("is off until the server is given a way to start the robot", async () => {
    expect(fetchWay()).toBe("off");
    process.env.TENDER_FINDER_FETCH = "local"; // local needs the robot's key too
    expect(fetchWay()).toBe("off");
    process.env.TENDER_FINDER_KEY = KEY;
    expect(fetchWay()).toBe("local");
    delete process.env.TENDER_FINDER_FETCH;
    process.env.TENDER_FINDER_DISPATCH_TOKEN = "github-token";
    expect(fetchWay()).toBe("github");
    process.env.TENDER_FINDER_GITHUB = "off";
    expect(fetchWay()).toBe("off");
    delete process.env.TENDER_FINDER_GITHUB;
    process.env.TENDER_FINDER_FETCH = "off";
    expect(fetchWay()).toBe("off");

    delete process.env.TENDER_FINDER_FETCH;
    delete process.env.TENDER_FINDER_DISPATCH_TOKEN;
    expect((await state()).way).toBe("off");
    expect((await press("jimmy")).status).toBe(409);
    expect(await asks()).toEqual([]);
  });

  it("is the bidding team's only", async () => {
    process.env.TENDER_FINDER_DISPATCH_TOKEN = "github-token";
    expect((await press("ryan")).status).toBe(403);
    expect(dispatched).toBe(0);
  });

  it("asks GitHub once, waits for the run a person started, and refuses a second press meanwhile", async () => {
    process.env.TENDER_FINDER_DISPATCH_TOKEN = "github-token";
    const first = await press("jimmy");
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ via: "github" });
    expect(dispatched).toBe(1);
    expect(await state()).toMatchObject({ way: "github", running: { by: "Jimmy", done: false }, failed: null });

    // A second press, or a second person, while it runs: refused, GitHub not asked again.
    expect((await press("jimmy")).status).toBe(409);
    expect(dispatched).toBe(1);

    // The hourly run coming in meanwhile is not this press's run.
    await db.execute(sql`insert into tender_find_run (source, trigger, status, found) values ('philgeps', 'schedule', 'success', 500)`);
    expect((await state()).running?.done).toBe(false);
    // The run it started comes in: done, and still not pressed again within 10 minutes.
    await db.execute(sql`insert into tender_find_run (source, trigger, status, found) values ('philgeps', 'manual', 'success', 543)`);
    expect((await state()).running?.done).toBe(true);
    expect((await press("jimmy")).status).toBe(409);

    // Ten minutes later it can be pressed again.
    await db.execute(sql`update tender_find_ask set at = now() - interval '11 minutes'`);
    await db.execute(sql`update tender_find_run set at = now() - interval '5 minutes'`);
    expect((await state()).running).toBeNull();
    expect((await press("jimmy")).status).toBe(200);
    expect(dispatched).toBe(2);
  });

  it("a press whose run never comes stops waiting after 45 minutes", async () => {
    process.env.TENDER_FINDER_DISPATCH_TOKEN = "github-token";
    expect((await press("jimmy")).status).toBe(200);
    await db.execute(sql`update tender_find_ask set at = now() - interval '30 minutes'`);
    expect((await state()).running).toMatchObject({ done: false });
    expect((await press("jimmy")).status).toBe(409);
    await db.execute(sql`update tender_find_ask set at = now() - interval '46 minutes'`);
    expect((await state()).running).toBeNull();
    expect((await press("jimmy")).status).toBe(200);
  });

  it("says so when GitHub refuses, and lets it be pressed again at once", async () => {
    process.env.TENDER_FINDER_DISPATCH_TOKEN = "github-token";
    dispatchFails = "GitHub refused the server's token (put it right on the server)";
    const refused = await press("jimmy");
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: { message: string } }).error.message).toContain("GitHub refused the server's token");
    expect(await asks()).toEqual([{ via: "github", status: "failed", note: dispatchFails }]);
    expect(await state()).toMatchObject({ running: null, failed: { note: dispatchFails } });

    dispatchFails = null;
    expect((await press("jimmy")).status).toBe(200);
    expect((await state()).failed).toBeNull();
  });

  it("each portal's card gets its own last runs, and the bridge's hand-overs their own", async () => {
    for (let i = 0; i < 8; i += 1) {
      await db.execute(sql`insert into tender_find_run (source, trigger, status, found, at) values ('philgeps', 'schedule', 'success', ${i}, now() - make_interval(mins => ${i}))`);
      await db.execute(sql`insert into tender_find_run (source, trigger, status, found, at) values ('ps', 'schedule', 'success', ${i}, now() - make_interval(hours => ${i + 1}))`);
    }
    for (let i = 0; i < 2; i += 1) await db.execute(sql`insert into tender_find_run (source, trigger, status, at) values ('ps', 'feed', 'success', now() - interval '1 minute')`);
    const runs = ((await (await app.request("/api/tenders/found", { headers: { cookie: cookies.jimmy as string } })).json()) as FoundList).robot.runs;
    expect(runs.filter((run) => run.source === "philgeps")).toHaveLength(6);
    expect(runs.filter((run) => run.source === "ps" && run.trigger !== "feed")).toHaveLength(6);
    expect(runs.filter((run) => run.trigger === "feed")).toHaveLength(2);
    // Newest first, and each portal's newest kept (the PhilGEPS runs are all newer than PS's)
    expect(runs.filter((run) => run.source === "philgeps").map((run) => run.found)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(runs.filter((run) => run.source === "ps" && run.trigger !== "feed").map((run) => run.found)).toEqual([0, 1, 2, 3, 4, 5]);
    expect([...runs].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).map((run) => run.id)).toEqual(runs.map((run) => run.id));
  });

  it("runs the robot on this computer when set so, and notes a robot that stopped", async () => {
    process.env.TENDER_FINDER_FETCH = "local";
    process.env.TENDER_FINDER_KEY = KEY;
    const pressed = await press("jimmy");
    expect(pressed.status).toBe(200);
    expect(await pressed.json()).toEqual({ via: "local" });
    expect(endRun).not.toBeNull();
    expect(dispatched).toBe(0);
    endRun?.("The robot stopped (exit 1); the API's log says why");
    await new Promise((done) => setTimeout(done, 50));
    expect(await asks()).toEqual([{ via: "local", status: "failed", note: "The robot stopped (exit 1); the API's log says why" }]);
    expect(await state()).toMatchObject({ running: null, failed: { note: "The robot stopped (exit 1); the API's log says why" } });
  });
});
