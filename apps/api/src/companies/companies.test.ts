// Several companies on one server (Aryan, 26 Nov 2026). What must hold: each company's data stays
// in its own database; a person signs in to their company by the domain after the @; a session
// of one company opens nothing in another; a new company starts with its own Admin and, if asked,
// another company's stock, and nothing else of it; a paused company's people can't work; and the
// control panel lets in only its own logins, with the phone's code every time.

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../app";
import { codeAt, stepAt } from "../auth/totp";
import { runChecks } from "../checks/integrity";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedDemoInventory } from "../inventory/seed";
import { seedDemo } from "../seed";
import { asCompany, loginDomain } from "./context";
import { controlRoutes } from "./control-routes";
import { type CompanyList, memoryPlaces, openCompanies, type Running } from "./registry";
import { companyRouter } from "./router";

const PASSWORD = "test-password-1";
const PANEL_PASSWORD = "a-long-panel-password-1";
let main: Database;
let list: CompanyList;
let router: ReturnType<typeof companyRouter>;
let setupKey: string | null;
let gm: Running;
let gmPassword: string;
let panelKey = "";
let panelCookie = "";

/** The cookies a response sets, joined onto those a browser had (a later one replaces its name). */
function jar(before: string, response: Response): string {
  const all = new Map(before.split("; ").filter(Boolean).map((one) => [one.split("=")[0] as string, one]));
  for (const line of response.headers.getSetCookie()) {
    const pair = line.split(";")[0] as string;
    const [name, value] = [pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1)];
    if (value) all.set(name, pair);
    else all.delete(name);
  }
  return [...all.values()].join("; ");
}
const send = (path: string, options: { method?: string; body?: unknown; cookie?: string } = {}) =>
  router.request(path, {
    method: options.method ?? (options.body === undefined ? "GET" : "POST"),
    headers: { "content-type": "application/json", cookie: options.cookie ?? "" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
const login = (email: string, password: string, cookie = "") => send("/api/auth/login", { body: { email, password }, cookie });
const codeOf = async (response: Response) => ((await response.clone().json()) as { error?: { code: string } }).error?.code;
const count = async (db: Database, query: ReturnType<typeof sql>) => (await rows<{ n: number }>(db, query))[0]?.n ?? 0;
const phoneCode = () => codeAt(panelKey, stepAt(Date.now()));

beforeAll(async () => {
  main = openDatabase({ dir: "memory" });
  await migrate(main);
  await seedDemo(main, PASSWORD);
  await seedDemoInventory(main);
  const places = memoryPlaces(main);
  const control = await places.control();
  list = await openCompanies({
    control,
    places,
    home: { name: "2MG Inc.", code: "2MG", loginDomain: "2mg.test" },
    ready: async (db) => createApp(db, { webUrl: "http://localhost:5180" }),
  });
  const panel = controlRoutes(control, list, { secure: false });
  vi.spyOn(console, "log").mockImplementation(() => {});
  setupKey = await panel.announceSetup();
  router = companyRouter(list, { secure: false, control: panel.app });
});

afterAll(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("several companies on one server", () => {
  it("lists the server's own database as the first company, with a six-digit Org ID", () => {
    expect(list.all()).toHaveLength(1);
    expect(list.home().ref).toMatchObject({ name: "2MG Inc.", code: "2MG", loginDomain: "2mg.test", home: true });
    expect(list.home().ref.orgId).toMatch(/^[1-9][0-9]{5}$/);
  });

  it("signs the first company's people in as before, and the browser remembers the company", async () => {
    const response = await login("helen@2mg.test", PASSWORD);
    expect(response.status).toBe(200);
    expect(jar("", response)).toContain(`org=${list.home().ref.orgId}`);
  });

  it("adds a company with its own database, its own Admin and the stock it was asked to copy, nothing else", async () => {
    const medicines = await count(main, sql`select count(*)::int as n from medicine`);
    const pieces = await count(main, sql`select coalesce(sum(qty), 0)::int as n from stock where qty > 0`);
    const moves = await count(main, sql`select count(*)::int as n from stock_move`);
    expect(medicines).toBeGreaterThan(0);
    expect(pieces).toBeGreaterThan(0);

    const made = await list.add(
      { name: "GetMeds Philippines Inc.", code: "gm", loginDomain: "GetMeds.test", adminLogin: "admin", copyStockFrom: list.home().ref.orgId },
      null,
    );
    gm = made.company;
    gmPassword = made.password;
    expect(gm.ref).toMatchObject({ name: "GetMeds Philippines Inc.", code: "GM", loginDomain: "getmeds.test", home: false });
    expect(gm.ref.orgId).not.toBe(list.home().ref.orgId);
    expect(made.adminLogin).toBe("admin@getmeds.test");
    expect(made.stock).toMatchObject({ medicines, pieces });

    // Its own: one Admin, no orders, customers, invoices or money.
    expect(await count(gm.db, sql`select count(*)::int as n from person`)).toBe(1);
    for (const table of ["sales_order", "customer", "invoice", "payment", "lead"])
      expect(await count(gm.db, sql.raw(`select count(*)::int as n from ${table}`)), table).toBe(0); // nosemgrep
    // The stock: the same medicines and pieces, each shelf equal to its log.
    expect(await count(gm.db, sql`select count(*)::int as n from medicine`)).toBe(medicines);
    expect(await count(gm.db, sql`select coalesce(sum(qty), 0)::int as n from stock`)).toBe(pieces);
    expect(
      await count(gm.db, sql`select count(*)::int as n from stock s where s.qty <> (select coalesce(sum(m.qty), 0) from stock_move m where m.batch_id = s.batch_id and m.warehouse_id = s.warehouse_id)`),
    ).toBe(0);
    const checks = await runChecks(gm.db);
    expect(checks.checks.filter((one) => !one.ok).map((one) => `${one.key}: ${one.problems.join("; ")}`)).toEqual([]);
    // The first company's data didn't move.
    expect(await count(main, sql`select count(*)::int as n from stock_move`)).toBe(moves);
    expect(await count(main, sql`select count(*)::int as n from medicine`)).toBe(medicines);
    // A new medicine there gets its own next number, after the copied ones.
    const [next] = await rows<{ id: number }>(
      gm.db,
      sql`insert into medicine (code, name) values ('NEW-1', 'New one') returning id::int as id`,
    );
    expect(next?.id).toBeGreaterThan(await count(main, sql`select max(id)::int as n from medicine`));
  });

  it("names the new company's tree and login IDs after it", async () => {
    expect(asCompany(gm.ref, () => loginDomain())).toBe("getmeds.test");
    expect(loginDomain()).toBe("2mginc.com");
    const [root] = await rows<{ name: string }>(gm.db, sql`select name from org_unit where kind = 'company'`);
    expect(root?.name).toBe("GetMeds Philippines Inc.");
  });

  it("signs the new company's Admin in by its domain; their session opens nothing in another company", async () => {
    const response = await login("Admin@GetMeds.test", gmPassword);
    expect(response.status).toBe(200);
    const cookie = jar("", response);
    expect(cookie).toContain(`org=${gm.ref.orgId}`);
    const me = await send("/api/me", { cookie });
    expect(me.status).toBe(200);
    expect(((await me.json()) as { me: { role: string; mustChangePassword: boolean } }).me).toMatchObject({ role: "admin", mustChangePassword: true });
    expect(((await (await send("/api/company", { cookie })).json()) as { company: { name: string } }).company.name).toBe("GetMeds Philippines Inc.");

    // The same session sent to the first company: unknown there.
    const elsewhere = cookie.replace(`org=${gm.ref.orgId}`, `org=${list.home().ref.orgId}`);
    expect((await send("/api/me", { cookie: elsewhere })).status).toBe(401);
  });

  it("keeps one company's people out of another's", async () => {
    expect((await login("helen@getmeds.test", PASSWORD)).status).toBe(401);
    expect((await login("admin@2mg.test", gmPassword)).status).toBe(401);
    // The domain typed wins over the company the browser remembers.
    const gmBrowser = `org=${gm.ref.orgId}`;
    expect((await login("helen@2mg.test", PASSWORD, gmBrowser)).status).toBe(200);
    expect(((await (await send("/api/company", { cookie: gmBrowser })).json()) as { company: { code: string } }).company.code).toBe("GM");
    expect(((await (await send("/api/company")).json()) as { company: { code: string } }).company.code).toBe("2MG");
    // A made-up Org ID in the cookie is just the first company.
    expect(((await (await send("/api/company", { cookie: "org=999999x" })).json()) as { company: { code: string } }).company.code).toBe("2MG");
  });

  it("stops a paused company's people, and lets them in again when it is resumed", async () => {
    const signedIn = jar("", await login("admin@getmeds.test", gmPassword));
    await list.pause(gm.ref.orgId, "Not paid", null);
    const refused = await login("admin@getmeds.test", gmPassword);
    expect(refused.status).toBe(403);
    expect(await codeOf(refused)).toBe("company_paused");
    expect((await send("/api/me", { cookie: signedIn })).status).toBe(403);
    await list.resume(gm.ref.orgId, null);
    expect((await send("/api/me", { cookie: signedIn })).status).toBe(200);
    await expect(list.pause(list.home().ref.orgId, "", null)).rejects.toThrow(/can't be paused/);
  });

  it("checks a new company's name, code and domain", async () => {
    const base = { name: "Another", code: "AN", loginDomain: "another.test", adminLogin: "admin" };
    await expect(list.add({ ...base, loginDomain: "getmeds.test" }, null)).rejects.toMatchObject({ field: "loginDomain" });
    await expect(list.add({ ...base, code: "2MG" }, null)).rejects.toMatchObject({ field: "code" });
    await expect(list.add({ ...base, code: "A" }, null)).rejects.toMatchObject({ field: "code" });
    await expect(list.add({ ...base, loginDomain: "not a domain" }, null)).rejects.toMatchObject({ field: "loginDomain" });
    expect(list.all()).toHaveLength(2);
  });
});

describe("the control panel", () => {
  it("is set up once, with the key from the server's log and the code from the phone", async () => {
    expect(await (await send("/api/control/me")).json()).toEqual({ me: null, setup: true });
    expect(setupKey).toBeTruthy();
    const wrong = await send("/api/control/setup", { body: { key: "not-it", loginId: "1001", name: "Aryan", password: PANEL_PASSWORD } });
    expect(await codeOf(wrong)).toBe("wrong_key");
    expect(await codeOf(await send("/api/control/setup", { body: { key: setupKey, loginId: "1001", name: "Aryan", password: "short" } }))).toBe("invalid");

    const started = await send("/api/control/setup", { body: { key: setupKey, loginId: "1001", name: "Aryan", password: PANEL_PASSWORD } });
    expect(started.status).toBe(200);
    const { ticket, key, uri } = (await started.json()) as { ticket: string; key: string; uri: string };
    expect(uri).toContain("otpauth://totp/");
    panelKey = key;
    expect(await codeOf(await send("/api/control/setup/code", { body: { ticket, code: "000000" } }))).toBe("wrong_code");
    const done = await send("/api/control/setup/code", { body: { ticket, code: phoneCode() } });
    expect(done.status).toBe(200);
    panelCookie = jar("", done);
    expect(await (await send("/api/control/me", { cookie: panelCookie })).json()).toEqual({ me: { loginId: "1001", name: "Aryan" }, setup: false });
    expect(await codeOf(await send("/api/control/setup", { body: { key: setupKey, loginId: "1002", name: "X", password: PANEL_PASSWORD } }))).toBe("done");
    // A company's session isn't a panel session.
    expect((await send("/api/control/companies", { cookie: jar("", await login("naresh@2mg.test", PASSWORD)) })).status).toBe(401);
  });

  it("signs in with the login ID, password and phone code together, and a code works once", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 60_000 });
    const code = phoneCode();
    expect((await send("/api/control/login", { body: { loginId: "1001", password: PANEL_PASSWORD, code: "123456" } })).status).toBe(401);
    expect((await send("/api/control/login", { body: { loginId: "1001", password: "wrong-password-1", code } })).status).toBe(401);
    expect((await send("/api/control/login", { body: { loginId: "1001", password: PANEL_PASSWORD, code } })).status).toBe(200);
    expect((await send("/api/control/login", { body: { loginId: "1001", password: PANEL_PASSWORD, code } })).status).toBe(401);
    vi.useRealTimers();
  });

  it("lists and adds companies, and gives a company's Admin a new one-time password", async () => {
    expect((await send("/api/control/companies")).status).toBe(401);
    const listed = (await (await send("/api/control/companies", { cookie: panelCookie })).json()) as {
      companies: { orgId: string; code: string; people: number; home: boolean; admin: string | null }[];
    };
    expect(listed.companies.map((one) => [one.code, one.home])).toEqual([["2MG", true], ["GM", false]]);
    expect(listed.companies[1]).toMatchObject({ people: 1, admin: "admin@getmeds.test" });

    const added = await send("/api/control/companies", {
      cookie: panelCookie,
      body: { name: "Third Pharma Inc.", code: "tp", loginDomain: "third.test", adminLogin: "boss", adminName: "Rosa" },
    });
    expect(added.status).toBe(200);
    const third = (await added.json()) as { orgId: string; adminLogin: string; password: string };
    expect(third.adminLogin).toBe("boss@third.test");
    expect((await login("boss@third.test", third.password)).status).toBe(200);

    const given = await send(`/api/control/companies/${gm.ref.orgId}/admin-password`, { cookie: panelCookie, body: {} });
    const fresh = (await given.json()) as { adminLogin: string; password: string };
    expect(fresh.adminLogin).toBe("admin@getmeds.test");
    expect((await login("admin@getmeds.test", gmPassword)).status).toBe(401);
    expect((await login("admin@getmeds.test", fresh.password)).status).toBe(200);

    const events = (await (await send("/api/control/events", { cookie: panelCookie })).json()) as { events: { what: string }[] };
    expect(events.events.map((one) => one.what)).toEqual(expect.arrayContaining(["added", "admin_password", "paused", "resumed", "panel_login_made"]));
  });

  it("locks a panel login after five wrong tries", async () => {
    for (let i = 0; i < 5; i += 1)
      await send("/api/control/login", { body: { loginId: "1001", password: `wrong-${i}-password`, code: "123456" } });
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 120_000 });
    const locked = await send("/api/control/login", { body: { loginId: "1001", password: PANEL_PASSWORD, code: phoneCode() } });
    expect(locked.status).toBe(429);
    vi.useRealTimers();
  });
});
