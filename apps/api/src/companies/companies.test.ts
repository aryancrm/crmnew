// Several companies on one server (Aryan, 26 Nov 2026). What must hold: each company's data stays
// in its own database; a person signs in to their company by the domain after the @; a session
// of one company opens nothing in another; a new company starts with its own Admin and, if asked,
// another company's stock, and nothing else of it; a paused company's people can't work; and the
// control panel lets in only its own logins, with the phone's code every time.

import { createHmac } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../app";
import { codeAt, stepAt } from "../auth/totp";
import { runChecks } from "../checks/integrity";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedDemoInventory } from "../inventory/seed";
import { useGraph } from "../online/graph";
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
      { name: "GetMeds Philippines Inc.", code: "gm", loginId: "Admin@GetMeds.test", copyStockFrom: list.home().ref.orgId },
      null,
    );
    gm = made.company;
    gmPassword = made.password;
    expect(gm.ref).toMatchObject({ name: "GetMeds Philippines Inc.", code: "GM", loginDomain: "getmeds.test", home: false });
    expect(gm.ref.orgId).not.toBe(list.home().ref.orgId);
    expect(made.loginId).toBe("admin@getmeds.test");
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
    const base = { name: "Another", code: "AN", loginId: "info@another.test" };
    await expect(list.add({ ...base, loginId: "info@getmeds.test" }, null)).rejects.toMatchObject({ field: "loginId" });
    await expect(list.add({ ...base, loginId: "someone@gmail.com" }, null)).rejects.toMatchObject({ field: "loginId" });
    await expect(list.add({ ...base, code: "2MG" }, null)).rejects.toMatchObject({ field: "code" });
    await expect(list.add({ ...base, code: "A" }, null)).rejects.toMatchObject({ field: "code" });
    await expect(list.add({ ...base, loginId: "not an email" }, null)).rejects.toMatchObject({ field: "loginId" });
    expect(list.all()).toHaveLength(2);
  });
});

describe("the first company's login ID on the list's first start", () => {
  it("becomes the one given (HOME_COMPANY_LOGIN), once, and its Admin signs in with it", async () => {
    const own = openDatabase({ dir: "memory" });
    await migrate(own);
    await seedDemo(own, PASSWORD);
    const places = memoryPlaces(own);
    const open = (loginId: string) =>
      openCompanies({
        control: placesControl,
        places,
        home: { name: "2MG Inc.", code: "2MG", loginDomain: "2mg.test", loginId },
        ready: async (db) => createApp(db, { webUrl: "http://localhost:5180" }),
      });
    const placesControl = await places.control();
    const first = await open("Info@2mg.test");
    expect((await first.adminOf(first.home()))?.login).toBe("info@2mg.test");
    // A later start leaves a login ID changed since as it is.
    await first.change(first.home().ref.orgId, { loginId: "office@2mg.test" }, null);
    const again = await open("info@2mg.test");
    expect((await again.adminOf(again.home()))?.login).toBe("office@2mg.test");
  });
});

describe("the control panel", () => {
  it("is set up once, with the key from the server's log and the code from the phone", async () => {
    expect(await (await send("/api/control/me")).json()).toEqual({ me: null, setup: true });
    expect(setupKey).toBeTruthy();
    const wrong = await send("/api/control/setup", { body: { key: "not-it", loginId: "1001", name: "Aryan", password: PANEL_PASSWORD } });
    expect(await codeOf(wrong)).toBe("wrong_key");
    expect(await codeOf(await send("/api/control/setup", { body: { key: setupKey, loginId: "1001", name: "Aryan", password: "short" } }))).toBe("invalid");
    // Eight characters are enough (Aryan, 26 Nov); seven aren't.
    expect(await codeOf(await send("/api/control/setup", { body: { key: setupKey, loginId: "1001", name: "Aryan", password: "seven77" } }))).toBe("invalid");

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
    expect(listed.companies[1]).toMatchObject({ people: 1, loginId: "admin@getmeds.test" });

    const added = await send("/api/control/companies", {
      cookie: panelCookie,
      body: { name: "Third Pharma Inc.", code: "tp", loginId: "boss@third.test" },
    });
    expect(added.status).toBe(200);
    const third = (await added.json()) as { orgId: string; loginId: string; password: string };
    expect(third.loginId).toBe("boss@third.test");
    expect((await login("boss@third.test", third.password)).status).toBe(200);

    const given = await send(`/api/control/companies/${gm.ref.orgId}/admin-password`, { cookie: panelCookie, body: {} });
    const fresh = (await given.json()) as { loginId: string; password: string };
    expect(fresh.loginId).toBe("admin@getmeds.test");
    expect((await login("admin@getmeds.test", gmPassword)).status).toBe(401);
    expect((await login("admin@getmeds.test", fresh.password)).status).toBe(200);

    const events = (await (await send("/api/control/events", { cookie: panelCookie })).json()) as { events: { what: string }[] };
    expect(events.events.map((one) => one.what)).toEqual(expect.arrayContaining(["added", "admin_password", "paused", "resumed", "panel_login_made"]));
  });

  it("changes a company's login ID: the first company's becomes info@, and signs in with it", async () => {
    const home = list.home().ref.orgId;
    const taken = await send(`/api/control/companies/${home}`, { method: "PATCH", cookie: panelCookie, body: { loginId: "helen@2mg.test" } });
    expect(taken.status).toBe(409);
    const changed = await send(`/api/control/companies/${home}`, { method: "PATCH", cookie: panelCookie, body: { loginId: "Info@2MG.test" } });
    expect(changed.status).toBe(200);
    expect(((await changed.json()) as { loginId: string }).loginId).toBe("info@2mg.test");
    // The Admin signs in with it (their own password unchanged); nobody else's login moved.
    expect((await login("info@2mg.test", PASSWORD)).status).toBe(200);
    expect((await login("helen@2mg.test", PASSWORD)).status).toBe(200);
    expect(list.home().ref.loginDomain).toBe("2mg.test");
    const listed = (await (await send("/api/control/companies", { cookie: panelCookie })).json()) as { companies: { code: string; loginId: string }[] };
    expect(listed.companies.find((one) => one.code === "2MG")?.loginId).toBe("info@2mg.test");
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

describe("each company's own Facebook pages, websites and links (Aryan, 26 Nov)", () => {
  const SECRET = "meta-app-secret";
  const meta = (page: string, mid: string) => {
    const text = JSON.stringify({
      object: "page",
      entry: [{ id: page, messaging: [{ sender: { id: `psid-${mid}` }, recipient: { id: page }, timestamp: Date.now(), message: { mid, text: "Hello" } }] }],
    });
    return router.request("/webhooks/messenger", {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${createHmac("sha256", SECRET).update(text).digest("hex")}` },
      body: text,
    });
  };
  const kept = (db: Database, page: string) => count(db, sql`select count(*)::int as n from inbox_event where page_key = ${page}`);

  beforeAll(async () => {
    vi.stubEnv("MESSENGER_APP_SECRET", SECRET);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // Meta answers nothing here: only where each message is kept is checked.
    useGraph({ call: async () => ({ data: null, error: "Not in tests.", code: 1 }), fetchFile: async () => null });
    await main.execute(sql`insert into channel_account (kind, key, name, secret) values ('messenger', 'page-2mg', '2MG Inc.', 'x')`);
    await gm.db.execute(sql`insert into channel_account (kind, key, name, secret) values ('messenger', 'page-gm', 'GetMeds', 'x')`);
  });
  afterAll(() => {
    useGraph(null);
    vi.unstubAllEnvs();
  });

  it("keeps a Facebook message in the company that connected its page, and nowhere else", async () => {
    expect((await meta("page-gm", "m-gm-1")).status).toBe(200);
    expect(await kept(gm.db, "page-gm")).toBe(1);
    expect(await kept(main, "page-gm")).toBe(0);
    expect((await meta("page-2mg", "m-2mg-1")).status).toBe(200);
    expect(await kept(main, "page-2mg")).toBe(1);
    expect(await kept(gm.db, "page-2mg")).toBe(0);
  });

  it("keeps a page nobody connected waiting at the first company's, as before", async () => {
    expect((await meta("page-nobody", "m-x-1")).status).toBe(200);
    expect(await count(main, sql`select count(*)::int as n from inbox_event where page_key = 'page-nobody' and state = 'unrouted'`)).toBe(1);
    expect(await kept(gm.db, "page-nobody")).toBe(0);
  });

  it("refuses a Facebook message Meta didn't sign, in every company", async () => {
    const response = await router.request("/webhooks/messenger", {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=00" },
      body: JSON.stringify({ object: "page", entry: [{ id: "page-gm", messaging: [] }] }),
    });
    expect(response.status).toBe(401);
  });

  it("sends a website's call to the company its address names (its Org ID), else the first company", async () => {
    // Unsigned, so each refuses it: which company answered is what is checked (its own websites).
    const theirs = await router.request(`/webhooks/store/${gm.ref.orgId}`, { method: "POST", body: "{}" });
    const ours = await router.request("/webhooks/store/2mg", { method: "POST", body: "{}" });
    expect(theirs.status).toBe(ours.status);
    const seen: string[] = [];
    const spy = vi.spyOn(gm.app, "fetch").mockImplementation(async () => {
      seen.push("gm");
      return new Response("{}", { status: 200 });
    });
    await router.request(`/webhooks/store/${gm.ref.orgId}/order-progress`, { method: "POST", body: "{}" });
    await router.request("/webhooks/store/2mg/order-progress", { method: "POST", body: "{}" });
    spy.mockRestore();
    expect(seen).toEqual(["gm"]);
  });

  it("opens a link that names its company (?org=) in that company, without signing in", async () => {
    const seen: string[] = [];
    const spy = vi.spyOn(gm.app, "fetch").mockImplementation(async () => {
      seen.push("gm");
      return new Response("{}", { status: 404 });
    });
    await router.request(`/api/public/quotation/some-token?org=${gm.ref.orgId}`);
    await router.request(`/api/auth/welcome?org=${gm.ref.orgId}`, { method: "POST", body: "{}" });
    await router.request("/api/public/quotation/some-token");
    await router.request("/api/public/quotation/some-token?org=12x456");
    spy.mockRestore();
    expect(seen).toEqual(["gm", "gm"]);
  });

  it("sends a request to join to the company of the email's domain", async () => {
    const asked = (email: string) =>
      send("/api/auth/sign-up", { body: { firstName: "Ana", lastName: "Reyes", email, phone: "09171234567", department: "online" } });
    expect((await asked("ana.reyes@getmeds.test")).status).toBeLessThan(500);
    expect((await asked("ben.cruz@2mg.test")).status).toBeLessThan(500);
    expect(await count(gm.db, sql`select count(*)::int as n from sign_up where email = 'ana.reyes@getmeds.test'`)).toBeLessThanOrEqual(1);
    expect(await count(main, sql`select count(*)::int as n from sign_up where email = 'ana.reyes@getmeds.test'`)).toBe(0);
    expect(await count(gm.db, sql`select count(*)::int as n from sign_up where email = 'ben.cruz@2mg.test'`)).toBe(0);
  });
});

