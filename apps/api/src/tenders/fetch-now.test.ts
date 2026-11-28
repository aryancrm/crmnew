import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedDemoInventory } from "../inventory/seed";
import { seedDemo } from "../seed";
import type { FoundList } from "../types";
import { closeLocalAsks, fetchWay, type Portal, useFetchers } from "./fetch-now";
import { seedBidding } from "./seed";

const PASSWORD = "test-password-1";
const KEY = "robot-key-for-the-tests-0123456789";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
const press = (who: string, portal: string = "philgeps") =>
  app.request("/api/tenders/found/robot/fetch", { method: "POST", headers: { "content-type": "application/json", cookie: cookies[who] as string }, body: JSON.stringify({ portal }) });
const state = async () => ((await (await app.request("/api/tenders/found", { headers: { cookie: cookies.jimmy as string } })).json()) as FoundList).robot.fetch;
const asks = () => rows<{ via: string; portal: string; status: string; note: string | null }>(db, sql`select via, portal, status, note from tender_find_ask order by id`);
const connectPs = () => db.execute(sql`insert into tender_robot_row (tbl, key, value) values ('ps_sync_status', 'latest', ${JSON.stringify({ id: "latest", connected_at: "2026-11-25T03:00:00.000Z" })}::jsonb)`);

let dispatched: Portal[] = [];
let dispatchFails: string | null = null;
let ran: Portal[] = [];
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
    dispatch: async (portal) => {
      if (dispatchFails) throw new Error(dispatchFails);
      dispatched.push(portal);
    },
    runHere: (portal, onEnd) => {
      ran.push(portal);
      endRun = onEnd;
    },
  });
});
beforeEach(async () => {
  await db.execute(sql`delete from tender_find_ask`);
  await db.execute(sql`delete from tender_find_run`);
  await db.execute(sql`delete from tender_robot_row`);
  dispatched = [];
  ran = [];
  dispatchFails = null;
  endRun = null;
  for (const name of ["TENDER_FINDER_FETCH", "TENDER_FINDER_DISPATCH_TOKEN", "TENDER_FINDER_KEY", "TENDER_FINDER_GITHUB"]) delete process.env[name];
});
afterAll(() => {
  for (const name of ["TENDER_FINDER_FETCH", "TENDER_FINDER_DISPATCH_TOKEN", "TENDER_FINDER_KEY", "TENDER_FINDER_GITHUB"]) delete process.env[name];
});

describe("Fetch now, one on each portal's card", () => {
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

  it("is the bidding team's only, and names a portal", async () => {
    process.env.TENDER_FINDER_DISPATCH_TOKEN = "github-token";
    expect((await press("ryan")).status).toBe(403);
    expect((await press("jimmy", "both")).status).toBe(400);
    expect(dispatched).toEqual([]);
  });

  it("asks GitHub for that portal only, waits for its run, and refuses a second press of it meanwhile", async () => {
    process.env.TENDER_FINDER_DISPATCH_TOKEN = "github-token";
    const first = await press("jimmy", "philgeps");
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ via: "github", portal: "philgeps" });
    expect(dispatched).toEqual(["philgeps"]);
    expect(await state()).toMatchObject({ way: "github", philgeps: { running: { by: "Jimmy", done: false }, failed: null }, ps: { running: null } });

    // A second press of PhilGEPS while it runs: refused, GitHub not asked again.
    expect((await press("jimmy", "philgeps")).status).toBe(409);
    expect(dispatched).toEqual(["philgeps"]);

    // Not this press's run: the hourly run, the bridge's hand-over, or a PS-PhilGEPS run.
    await db.execute(sql`insert into tender_find_run (source, trigger, status, found) values ('philgeps', 'schedule', 'success', 500)`);
    await db.execute(sql`insert into tender_find_run (source, trigger, status, found) values ('philgeps', 'feed', 'success', 450)`);
    await db.execute(sql`insert into tender_find_run (source, trigger, status, found) values ('ps', 'dashboard', 'success', 98)`);
    expect((await state()).philgeps.running?.done).toBe(false);
    // The run it started comes in: done (the status box says how it went), and it can be pressed again at once.
    await db.execute(sql`insert into tender_find_run (source, trigger, status, found) values ('philgeps', 'manual', 'success', 543)`);
    expect((await state()).philgeps.running?.done).toBe(true);
    expect((await press("jimmy", "philgeps")).status).toBe(200);
    expect(dispatched).toEqual(["philgeps", "philgeps"]);
    // That new press waits for its own run.
    expect((await state()).philgeps.running?.done).toBe(false);
    expect((await press("jimmy", "philgeps")).status).toBe(409);

    // Ten minutes on, a finished press is no longer shown.
    await db.execute(sql`update tender_find_ask set at = now() - interval '11 minutes'`);
    await db.execute(sql`update tender_find_run set at = now() - interval '5 minutes'`);
    expect((await state()).philgeps.running).toBeNull();
  });

  it("PS-PhilGEPS waits for a person to connect it, then has its own press beside PhilGEPS's", async () => {
    process.env.TENDER_FINDER_DISPATCH_TOKEN = "github-token";
    const refused = await press("jimmy", "ps");
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: { message: string } }).error.message).toContain("Connect PS-PhilGEPS first");
    expect(await asks()).toEqual([]);

    await connectPs();
    expect((await press("jimmy", "philgeps")).status).toBe(200);
    // A PhilGEPS press running does not stop PS-PhilGEPS's
    expect((await press("jimmy", "ps")).status).toBe(200);
    expect(dispatched).toEqual(["philgeps", "ps"]);
    expect(await state()).toMatchObject({ philgeps: { running: { done: false } }, ps: { running: { done: false } } });
    // A Sync a person started (the bidding system's module logs it as "dashboard") ends PS-PhilGEPS's wait only
    await db.execute(sql`insert into tender_find_run (source, trigger, status) values ('ps', 'dashboard', 'success')`);
    expect(await state()).toMatchObject({ philgeps: { running: { done: false } }, ps: { running: { done: true } } });
    expect((await asks()).map((one) => one.portal)).toEqual(["philgeps", "ps"]);
  });

  it("a press whose run never comes stops waiting after 45 minutes", async () => {
    process.env.TENDER_FINDER_DISPATCH_TOKEN = "github-token";
    expect((await press("jimmy")).status).toBe(200);
    await db.execute(sql`update tender_find_ask set at = now() - interval '30 minutes'`);
    expect((await state()).philgeps.running).toMatchObject({ done: false });
    expect((await press("jimmy")).status).toBe(409);
    await db.execute(sql`update tender_find_ask set at = now() - interval '46 minutes'`);
    expect((await state()).philgeps.running).toBeNull();
    expect((await press("jimmy")).status).toBe(200);
  });

  it("says so when GitHub refuses, on that portal's card, and lets it be pressed again at once", async () => {
    process.env.TENDER_FINDER_DISPATCH_TOKEN = "github-token";
    dispatchFails = "GitHub refused the server's token (put it right on the server)";
    const refused = await press("jimmy");
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: { message: string } }).error.message).toContain("GitHub refused the server's token");
    expect(await asks()).toEqual([{ via: "github", portal: "philgeps", status: "failed", note: dispatchFails }]);
    expect(await state()).toMatchObject({ philgeps: { running: null, failed: { note: dispatchFails } }, ps: { failed: null } });

    dispatchFails = null;
    expect((await press("jimmy")).status).toBe(200);
    expect((await state()).philgeps.failed).toBeNull();
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

  it("runs that portal's robot on this computer when set so, and notes a robot that stopped", async () => {
    process.env.TENDER_FINDER_FETCH = "local";
    process.env.TENDER_FINDER_KEY = KEY;
    const pressed = await press("jimmy", "philgeps");
    expect(pressed.status).toBe(200);
    expect(await pressed.json()).toEqual({ via: "local", portal: "philgeps" });
    expect(ran).toEqual(["philgeps"]);
    expect(dispatched).toEqual([]);
    endRun?.("The robot stopped (exit 1); the API's log says why");
    await new Promise((done) => setTimeout(done, 50));
    expect(await asks()).toEqual([{ via: "local", portal: "philgeps", status: "failed", note: "The robot stopped (exit 1); the API's log says why" }]);
    expect(await state()).toMatchObject({ philgeps: { running: null, failed: { note: "The robot stopped (exit 1); the API's log says why" } } });
  });

  it("on the API's start, closes a press whose robot ran on this computer (it ended with the API)", async () => {
    process.env.TENDER_FINDER_FETCH = "local";
    process.env.TENDER_FINDER_KEY = KEY;
    expect((await press("jimmy", "ps")).status).toBe(409); // not connected: nothing asked
    expect((await press("jimmy", "philgeps")).status).toBe(200);
    await db.execute(sql`insert into tender_find_ask (by_person, via, portal) select by_person, 'github', 'ps' from tender_find_ask limit 1`);
    await db.execute(sql`insert into tender_robot_row (tbl, key, value) values ('ps_sync_status', 'latest', ${JSON.stringify({ id: "latest", status: "running", stage: "Reading Bid Match (page 15)" })}::jsonb)
      on conflict (tbl, key) do update set value = excluded.value`);
    expect(await closeLocalAsks(db)).toBe(1);
    const [sync] = await rows<{ value: Record<string, unknown> }>(db, sql`select value from tender_robot_row where tbl = 'ps_sync_status' and key = 'latest'`);
    expect(sync?.value).toMatchObject({ status: "failed", error: "Stopped when the CRM restarted.", stage: "Reading Bid Match (page 15)" });
    expect(await asks()).toEqual([
      { via: "local", portal: "philgeps", status: "failed", note: "The CRM restarted while the robot ran on this computer; press Fetch now again." },
      { via: "github", portal: "ps", status: "asked", note: null },
    ]);
    expect(await state()).toMatchObject({ philgeps: { running: null, failed: { note: expect.stringContaining("CRM restarted") } } });
  });
});
