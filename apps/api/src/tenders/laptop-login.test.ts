import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedDemoInventory } from "../inventory/seed";
import { seedDemo } from "../seed";
import type { FoundList } from "../types";
import { checkCode, issueCode, philgepsCookies, setupScript } from "./laptop-login";
import { seedBidding } from "./seed";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
const press = (who: string, purpose: string) =>
  app.request("/api/tenders/found/ps/connect", { method: "POST", headers: { "content-type": "application/json", cookie: cookies[who] as string }, body: JSON.stringify({ purpose }) });
const laptop = (body: Record<string, unknown>) =>
  app.request("/api/ps-philgeps/laptop", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const psState = async () => ((await (await app.request("/api/tenders/found", { headers: { cookie: cookies.jimmy as string } })).json()) as FoundList).robot.ps;
const logins = () => rows<{ outcome: string; source: string | null }>(db, sql`select outcome, source from tender_find_login where site = 'ps-philgeps' order by id`);
const SESSION = [
  { name: "CAKEPHP", value: "a-live-log-in", domain: "philgeps.gov.ph", path: "/" },
  { name: "csrfToken", value: "x", domain: ".philgeps.gov.ph", path: "/" },
];

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
});
beforeEach(async () => {
  await db.execute(sql`delete from tender_find_login`);
  await db.execute(sql`delete from tender_robot_row`);
  delete process.env.PS_PHILGEPS_USERNAME;
  delete process.env.PS_PHILGEPS_PASSWORD;
});
afterAll(() => {
  delete process.env.PS_PHILGEPS_USERNAME;
  delete process.env.PS_PHILGEPS_PASSWORD;
});
const jimmyCode = async () => ((await (await press("jimmy", "login")).json()) as { code: string }).code;

describe("Connect PS-PhilGEPS from a team laptop", () => {
  it("a one-time code is for one purpose, one person, and 15 minutes", () => {
    const code = issueCode(7, "login", 1_000_000);
    expect(checkCode(code, "login", 1_000_000 + 60_000)).toBe(7);
    expect(checkCode(code, "setup", 1_000_000)).toBeNull();
    expect(checkCode(code, "login", 1_000_000 + 15 * 60_000 + 1)).toBeNull();
    const [payload, mac] = code.split(".");
    const forged = `${Buffer.from(JSON.stringify({ i: 1, p: "login", x: 9e15 })).toString("base64url")}.${mac}`;
    expect(checkCode(forged, "login")).toBeNull();
    expect(checkCode(`${payload}.${mac}.more`, "login")).toBeNull();
    expect(checkCode(42, "login")).toBeNull();
    expect(checkCode(issueCode(7, "setup", 1_000_000), "setup", 1_000_000 + 59 * 60_000)).toBe(7);
  });

  it("only PS-PhilGEPS's own cookies are taken from a laptop", () => {
    expect(philgepsCookies(SESSION)).toHaveLength(2);
    expect(philgepsCookies([...SESSION, { name: "NID", value: "g", domain: ".google.com" }])).toBeNull();
    expect(philgepsCookies([])).toBeNull();
    expect(philgepsCookies("cookies")).toBeNull();
    expect(philgepsCookies([{ name: "big", value: "x".repeat(9000), domain: "philgeps.gov.ph" }])).toBeNull();
  });

  it("the button is the bidding team's; it gives a log-in code or the laptop's setup file", async () => {
    expect((await press("ryan", "login")).status).toBe(403);
    expect((await press("jimmy", "anything")).status).toBe(400);
    const code = await jimmyCode();
    expect(checkCode(code, "login")).toBeGreaterThan(0);
    const { script } = (await (await press("jimmy", "setup")).json()) as { script: string };
    // Its own folder and link (not the bidding system's), and where the CRM is
    expect(script).toContain("Bishnoi One PS-PhilGEPS Connect");
    expect(script).toContain('set "CRM=http://localhost:5180"');
    expect(script).toContain("DASHBOARD_URL=%CRM%");
    expect(script).toContain("node register-connect-link.js");
    expect(script).not.toContain("ps-philgeps-connect");
    expect(setupScript("c", "https://one.bishnoi.ai/")).toContain('set "CRM=https://one.bishnoi.ai"');
  });

  it("the laptop gets its files only with a setup code", async () => {
    const { script } = (await (await press("jimmy", "setup")).json()) as { script: string };
    const setup = /set "CODE=([^"]+)"/.exec(script)?.[1] as string;
    const file = await app.request(`/api/ps-philgeps/laptop?code=${encodeURIComponent(setup)}&file=${encodeURIComponent("Connect PS-PhilGEPS.vbs")}`);
    expect(file.status).toBe(200);
    expect(await file.text()).toContain("bishnoi-ps-connect:");
    expect((await app.request(`/api/ps-philgeps/laptop?code=${encodeURIComponent(setup)}&file=.env`)).status).toBe(404);
    expect((await app.request(`/api/ps-philgeps/laptop?code=${encodeURIComponent(await jimmyCode())}&file=package.json`)).status).toBe(401);
    expect((await app.request("/api/ps-philgeps/laptop?file=package.json")).status).toBe(401);
  });

  it("the laptop logs in with the server's account, and the session serves everyone, sealed", async () => {
    expect((await laptop({ action: "begin", code: "nonsense" })).status).toBe(401);
    const code = await jimmyCode();
    // No account on the server yet
    const none = await laptop({ action: "begin", code });
    expect(none.status).toBe(500);
    expect(await none.json()).toMatchObject({ ok: false, code: "NO_CREDENTIALS" });
    // The page that opened the log-in hears why it stopped
    expect((await psState()).login).toMatchObject({ outcome: "error", detail: expect.stringContaining("PS_PHILGEPS_USERNAME") });

    process.env.PS_PHILGEPS_USERNAME = "the-merchant";
    process.env.PS_PHILGEPS_PASSWORD = "its-password";
    const begin = await laptop({ action: "begin", code });
    expect(begin.status).toBe(200);
    expect(await begin.json()).toEqual({ ok: true, username: "the-merchant", password: "its-password" });
    expect((await laptop({ action: "submitted", code })).status).toBe(200);
    expect(await psState()).toMatchObject({ connected: false });

    expect((await laptop({ action: "done", code, cookies: [{ name: "NID", value: "g", domain: ".google.com" }] })).status).toBe(400);
    // The robot's own Sync status keeps what it said; the log-in only adds when it was connected
    await db.execute(sql`insert into tender_robot_row (tbl, key, value) values ('ps_sync_status', 'latest', ${JSON.stringify({ id: "latest", status: "idle", stage: "Done" })}::jsonb)`);
    const done = await laptop({ action: "done", code, cookies: SESSION, savedAt: "2026-11-25T03:00:00.000Z" });
    expect(done.status).toBe(200);
    expect(await psState()).toMatchObject({ connected: true, connectedAt: "2026-11-25T03:00:00.000Z", status: "idle", stage: "Done" });
    const [kept] = await rows<{ value: unknown; sealed: string | null }>(db, sql`select value, sealed from tender_robot_row where tbl = 'ps_philgeps_session'`);
    expect(kept?.value).toBeNull();
    expect(JSON.stringify(kept)).not.toContain("a-live-log-in");
    // The robot reads it back through its door as it wrote it
    process.env.TENDER_FINDER_KEY = "robot-key-for-the-tests-0123456789";
    const back = await app.request("/webhooks/tender-finder/store?table=ps_philgeps_session", { headers: { authorization: `Bearer ${process.env.TENDER_FINDER_KEY}` } });
    expect(((await back.json()) as { rows: { cookies: unknown }[] }).rows[0]?.cookies).toEqual(SESSION);
    delete process.env.TENDER_FINDER_KEY;
    expect((await logins()).map((one) => one.outcome)).toEqual(["error", "started", "submitted", "ok"]);
    expect((await logins())[0]?.source).toBe("team laptop (Jimmy)");
  });

  it("the bidding system's log-in rules: a minute apart, three refusals pause it, six an hour", async () => {
    process.env.PS_PHILGEPS_USERNAME = "the-merchant";
    process.env.PS_PHILGEPS_PASSWORD = "its-password";
    const code = await jimmyCode();
    expect((await laptop({ action: "begin", code })).status).toBe(200);
    const soon = await laptop({ action: "begin", code });
    expect(soon.status).toBe(429);
    expect(await soon.json()).toMatchObject({ code: "LOGIN_PAUSED" });
    expect((await psState()).login).toMatchObject({ outcome: "paused", detail: expect.stringContaining("less than a minute ago") });

    await db.execute(sql`update tender_find_login set at = now() - interval '5 minutes'`);
    for (let i = 0; i < 3; i += 1) expect((await laptop({ action: "refused", code, detail: "Invalid username or password" })).status).toBe(200);
    const paused = await laptop({ action: "begin", code });
    expect(paused.status).toBe(429);
    expect(((await paused.json()) as { error: string }).error).toContain("refused 3 log-ins");

    // A good log-in since clears the refusals; then six log-ins that sent the password in an hour are the most
    await db.execute(sql`delete from tender_find_login`);
    for (let i = 0; i < 6; i += 1) await db.execute(sql`insert into tender_find_login (site, outcome, at) values ('ps-philgeps', 'submitted', now() - interval '10 minutes')`);
    expect(((await (await laptop({ action: "begin", code })).json()) as { error: string }).error).toContain("6 times in the last hour");
    // Log-ins that never sent the password do not count (only the minute between two starts does)
    await db.execute(sql`delete from tender_find_login`);
    for (let i = 0; i < 8; i += 1) await db.execute(sql`insert into tender_find_login (site, outcome, at) values ('ps-philgeps', 'started', now() - interval '10 minutes')`);
    expect((await laptop({ action: "begin", code })).status).toBe(200);
    // The old PhilGEPS's records are another site's
    await db.execute(sql`delete from tender_find_login`);
    for (let i = 0; i < 3; i += 1) await db.execute(sql`insert into tender_find_login (site, outcome) values ('philgeps', 'rejected')`);
    expect((await laptop({ action: "begin", code })).status).toBe(200);
  });

  it("the laptop's files travel up to date inside the API", async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const builder = resolve(here, "../../../../workers/tender-finder/ps/laptop/build-kit.mjs");
    const kit = (await import(pathToFileURL(builder).href)) as { kitFiles: () => Record<string, string>; kitText: (files: Record<string, string>) => string };
    const built = readFileSync(resolve(here, "laptop-kit.generated.ts"), "utf8").replace(/\r\n/g, "\n");
    // If this fails: node ps/laptop/build-kit.mjs in workers/tender-finder
    expect(built).toBe(kit.kitText(kit.kitFiles()));
    // The bidding system's own log-in module, with the CRM's address given on the laptop (.env), not its default
    expect(kit.kitFiles()["ps-philgeps-session.js"]).toContain("/api/ps-philgeps/laptop");
  });
});
