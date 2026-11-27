// One way in: a person's own login ID and their own password, one session, theirs. What must hold:
// nobody in without a password of their own, a one-time password opens only choosing one, tries
// sent together can't beat the lock, a stranger can't lock a person out of their own browser, and
// nothing a browser sends can make the session someone else's.

import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { makeFirstAdmin } from "../first-admin";
import { seedDemo } from "../seed";
import type { Me, OrgLogin } from "../types";
import { passwordProblem } from "./password";
import { endOfWorkingDay, startSession, whoIs } from "./sessions";

const PASSWORD = "test-password-1";
const OWN = "my-own-words-42";
let db: Database;
let app: ReturnType<typeof createApp>;

const post = (path: string, body: unknown, cookie = "") =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
const get = (path: string, cookie = "") => app.request(path, { headers: { cookie } });
const login = (who: string, password = PASSWORD, cookie = "", more: object = {}) =>
  post("/api/auth/login", { email: `${who}@2mg.test`, password, ...more }, cookie);
const cookiesOf = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((one) => one.split(";")[0] as string)
    .filter((one) => !one.endsWith("="))
    .join("; ");
const signIn = async (who: string, password = PASSWORD) => {
  const response = await login(who, password);
  expect(response.status, who).toBe(200);
  return cookiesOf(response);
};
const deviceOnly = (cookies: string) =>
  cookies
    .split("; ")
    .filter((one) => one.startsWith("dev_"))
    .join("; ");
const codeOf = async (response: Response) => ((await response.json()) as { error?: { code: string } }).error?.code;
const idOf = async (who: string) =>
  (await rows<{ id: number }>(db, sql`select id::int as id from person where email = ${`${who}@2mg.test`}`))[0]
    ?.id as number;
const wrongTries = async (who: string, times: number) => {
  for (let i = 0; i < times; i += 1) await login(who, `wrong-${i}`);
};
const count = (responses: Response[], status: number) => responses.filter((one) => one.status === status).length;

beforeEach(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  app = createApp(db, { webUrl: "http://localhost:5180" });
}, 120_000);
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the one way in", () => {
  it("has no door or PIN way in; a desk's screen opens only with the desks' own password (desk.test.ts)", async () => {
    // Nobody's own password opens a desk's screen, and none opens it until the Admin sets one.
    expect(await codeOf(await post("/api/auth/desk", { desk: "finance", password: PASSWORD }))).toBe("desk_off");
    expect((await post("/api/auth/door", { door: "heads", password: PASSWORD })).status).toBe(404);
    const admin = await signIn("admin");
    expect((await post(`/api/org/people/${await idOf("ryan")}/pin`, {}, admin)).status).toBe(404);
  });

  it("needs a login ID as well as the password", async () => {
    expect((await post("/api/auth/login", { password: PASSWORD })).status).toBe(400);
    expect((await login("nobody")).status).toBe(401);
  });

  it("opens every app the role has with the one token, and no other", async () => {
    const finance = cookiesOf(await login("fiona", PASSWORD, "", { workspace: "finance" }));
    expect((await get("/api/finance/board", finance)).status).toBe(200);
    expect((await get("/api/books/accounts", finance)).status).toBe(200);
    expect((await get("/api/desk/management/team", finance)).status).toBe(403);
    const seller = await signIn("ryan");
    expect((await get("/api/books/accounts", seller)).status).toBe(403);
    expect((await get("/api/finance/board", seller)).status).toBe(403);
  });

  it("refuses a login on another department's page", async () => {
    expect(await codeOf(await login("ryan", PASSWORD, "", { workspace: "books" }))).toBe("wrong_department");
  });

  it("takes who it is from the token, never from a header", async () => {
    const fiona = await signIn("fiona");
    const response = await app.request("/api/me", {
      headers: { cookie: fiona, "x-desk-person": String(await idOf("admin")) },
    });
    expect(((await response.json()) as { me: Me }).me.name).toBe("Fiona");
  });
});

describe("nobody in without a password of their own", () => {
  it("refuses whoever has none, with the right password too", async () => {
    await db.execute(sql`update person set password_pending = true where id = ${await idOf("admin")}`);
    expect(await codeOf(await login("admin"))).toBe("password_pending");
    expect(await codeOf(await login("admin", "anything-else"))).toBe("password_pending");
  });

  it("ends their open sessions, those looking as someone else too", async () => {
    const admin = await idOf("admin");
    const own = await startSession(db, admin);
    const looking = await startSession(db, await idOf("ryan"), admin);
    expect(await whoIs(db, looking)).not.toBeNull();
    await db.execute(sql`update person set password_pending = true where id = ${admin}`);
    expect(await whoIs(db, own)).toBeNull();
    expect(await whoIs(db, looking)).toBeNull();
  });

  it("still lets the Admin look as someone who has none yet", async () => {
    const admin = await signIn("admin");
    const ryan = await idOf("ryan");
    await db.execute(sql`update person set password_pending = true where id = ${ryan}`);
    expect((await post(`/api/auth/view/${ryan}`, {}, admin)).status).toBe(200);
  });

  it("doesn't bring back a shared screen's session of before 23 Nov with the desks' password", async () => {
    const token = await startSession(db, await idOf("marco"));
    await db.execute(sql`update session set desk = 'dispatch'`);
    // Migration 0166 clears them before the desk screens come back.
    await db.execute(sql`delete from schema_migration where name = '0166_desk_password.sql'`);
    expect(await migrate(db)).toEqual(["0166_desk_password.sql"]);
    expect(await whoIs(db, token)).toBeNull();
  });

  it("keeps a desk's screen to the desk: its seat's person moved to another role opens nothing", async () => {
    const token = await startSession(db, await idOf("marco"), undefined, "dispatch", undefined, "dispatch");
    expect((await whoIs(db, token))?.deskScreen).toBe("dispatch");
    await db.execute(sql`update person set role = 'inventory' where id = ${await idOf("marco")}`);
    expect(await whoIs(db, token)).toBeNull();
  });

  it("marks everyone who was here before the change, and nobody added after it", async () => {
    // The change itself, undone and made again over people who are already here.
    await db.execute(sql`alter table person drop column password_pending`);
    await db.execute(sql`delete from schema_migration where name = '0142_own_passwords.sql'`);
    expect(await migrate(db)).toEqual(["0142_own_passwords.sql"]);
    expect(await rows(db, sql`select distinct password_pending as pending from person`)).toEqual([{ pending: true }]);
    expect(await codeOf(await login("admin"))).toBe("password_pending");
    await db.execute(sql`insert into person (name, role, password_hash) values ('New', 'medrep', 'x')`);
    expect(await rows(db, sql`select password_pending as pending from person where name = 'New'`)).toEqual([
      { pending: false },
    ]);
  });
});

describe("a one-time password", () => {
  it("is different for each, and opens only choosing one's own", async () => {
    vi.stubEnv("JOIN_PASSWORD", "the-old-company-one");
    const admin = await signIn("admin");
    const ryan = await idOf("ryan");
    await db.execute(sql`update person set password_pending = true where id = ${ryan}`);
    const give = async (id: number) =>
      (await (await post(`/api/org/people/${id}/password`, {}, admin)).json()) as OrgLogin;
    const mine = (await give(ryan)).password as string;
    const theirs = (await give(await idOf("fiona"))).password as string;
    expect(mine).not.toBe(theirs);
    expect([mine, theirs]).not.toContain("the-old-company-one");
    expect((await login("fiona", mine)).status).toBe(401);

    const first = await login("ryan", mine);
    const cookie = cookiesOf(first);
    expect(((await first.json()) as { me: Me }).me.mustChangePassword).toBe(true);
    expect((await get("/api/me", cookie)).status).toBe(200);
    for (const path of ["/api/orders/dashboard", "/api/messages", "/api/hr/payslips/mine", "/api/customers"])
      expect(await codeOf(await get(path, cookie)), path).toBe("password_change");
    expect(await codeOf(await post("/api/messages", { to: { kind: "everyone" }, body: "hi" }, cookie))).toBe(
      "password_change",
    );

    const change = (next: string) => post("/api/auth/password", { current: mine, next }, cookie);
    expect((await change(mine)).status).toBe(400);
    expect((await change("the-old-company-one")).status).toBe(400);
    expect((await change("short")).status).toBe(400);
    expect((await change(OWN)).status).toBe(200);
    expect((await get("/api/messages", cookie)).status).toBe(200);
    expect((await login("ryan", mine)).status).toBe(401);
    expect((await login("ryan", OWN)).status).toBe(200);
  });

  it("is what the environment's first Admin password is", async () => {
    const empty = openDatabase({ dir: "memory" });
    await migrate(empty);
    await makeFirstAdmin(empty, "first@example.com", "first-pass-123");
    expect(
      await rows(empty, sql`select must_change_password as change, password_pending as pending from person`),
    ).toEqual([{ change: true, pending: false }]);
  });

  it("is what HR gives, and never to the CEO or the Admin", async () => {
    const hr = await signIn("helen");
    const given = "given-by-hr-1";
    const give = async (who: string) => post(`/api/hr/people/${await idOf(who)}/login`, { password: given }, hr);
    expect((await give("admin")).status).toBe(403);
    expect((await give("naresh")).status).toBe(403);
    expect((await give("ryan")).status).toBe(200);
    expect(((await (await login("ryan", given)).json()) as { me: Me }).me.mustChangePassword).toBe(true);
  });

  it("is needed again by someone who left and is back; their old sessions stay dead", async () => {
    const hr = await signIn("helen");
    const ryan = await signIn("ryan");
    const id = await idOf("ryan");
    await db.execute(sql`update person set active = false where id = ${id}`);
    expect((await post(`/api/hr/people/${id}/back`, {}, hr)).status).toBe(200);
    expect(await codeOf(await login("ryan"))).toBe("password_pending");
    await db.execute(sql`update person set password_pending = false where id = ${id}`);
    expect((await get("/api/me", ryan)).status).toBe(401);
  });
});

describe("a new password ends what was open", () => {
  it("chosen: other browsers and looking as someone; this one stays", async () => {
    const here = await signIn("admin");
    const there = await signIn("admin");
    const looking = cookiesOf(await post(`/api/auth/view/${await idOf("ryan")}`, {}, await signIn("admin")));
    expect((await get("/api/me", looking)).status).toBe(200);
    expect((await post("/api/auth/password", { current: PASSWORD, next: OWN }, here)).status).toBe(200);
    expect((await get("/api/me", here)).status).toBe(200);
    expect((await get("/api/me", there)).status).toBe(401);
    expect((await get("/api/me", looking)).status).toBe(401);
  });

  it("given: every session of theirs", async () => {
    const ryan = await signIn("ryan");
    const admin = await signIn("admin");
    await post(`/api/org/people/${await idOf("ryan")}/password`, {}, admin);
    expect((await get("/api/me", ryan)).status).toBe(401);
  });
});

describe("guessing", () => {
  it("60 tries at once get five, then the lock", async () => {
    const all = await Promise.all(Array.from({ length: 60 }, (_, i) => login("admin", `guess-${i}`)));
    expect(count(all, 401)).toBe(5);
    expect(count(all, 429)).toBe(55);
    expect((await login("admin")).status).toBe(429);
  });

  it("the right one hidden among 60 doesn't get through after the lock", async () => {
    const all = await Promise.all(
      Array.from({ length: 60 }, (_, i) => login("admin", i === 59 ? PASSWORD : `guess-${i}`)),
    );
    expect(count(all, 200)).toBe(0);
  });

  it("the fifth try, when right, signs in and clears the count", async () => {
    await wrongTries("ryan", 4);
    expect((await login("ryan")).status).toBe(200);
    await wrongTries("ryan", 4);
    expect((await login("ryan")).status).toBe(200);
  });

  it("opens again when the 15 minutes are over", async () => {
    await wrongTries("ryan", 5);
    expect((await login("ryan")).status).toBe(429);
    await db.execute(sql`update person set locked_until = now() - interval '1 second' where id = ${await idOf("ryan")}`);
    expect((await login("ryan")).status).toBe(200);
  });

  it("a stranger's wrong tries don't shut out the person's own browser", async () => {
    const device = deviceOnly(await signIn("admin"));
    expect(device).not.toBe("");
    await wrongTries("admin", 5);
    expect((await login("admin")).status).toBe(429);
    expect((await login("admin", PASSWORD, device)).status).toBe(200);
  });

  it("a known browser has five tries too", async () => {
    const device = deviceOnly(await signIn("admin"));
    const all = await Promise.all(Array.from({ length: 30 }, (_, i) => login("admin", `guess-${i}`, device)));
    expect(count(all, 401)).toBe(5);
    expect((await login("admin", PASSWORD, device)).status).toBe(429);
  });

  it("a made-up, borrowed or outdated device cookie counts for nothing", async () => {
    const admin = await idOf("admin");
    const ryans = deviceOnly(await signIn("ryan")).split("=")[1];
    const here = await signIn("admin");
    const outdated = deviceOnly(here);
    await post("/api/auth/password", { current: PASSWORD, next: OWN }, here);
    await wrongTries("admin", 5);
    for (const cookie of [`dev_${admin}=made.up`, `dev_${admin}=${ryans}`, outdated])
      expect((await login("admin", OWN, cookie)).status, cookie).toBe(429);
  });

  it("the change-password box locks the same", async () => {
    const ryan = await signIn("ryan");
    const all = await Promise.all(
      Array.from({ length: 20 }, (_, i) => post("/api/auth/password", { current: `guess-${i}`, next: OWN }, ryan)),
    );
    expect(count(all, 400)).toBe(5);
    expect(count(all, 429)).toBe(15);
  });

  it("the company's old password is nobody's own", () => {
    vi.stubEnv("JOIN_PASSWORD", "the-old-company-one");
    expect(passwordProblem("the-old-company-one")).not.toBeNull();
    expect(passwordProblem(OWN)).toBeNull();
  });
});

describe("shared computers", () => {
  it("sign Management, Finance and Dispatch in until the working day ends, and no longer", async () => {
    for (const who of ["sarla", "fiona", "marco"]) {
      const cookie = await signIn(who);
      const id = await idOf(who);
      await db.execute(sql`update session set last_seen_at = now() - interval '2 days' where person_id = ${id}`);
      expect((await get("/api/me", cookie)).status).toBe(200);
      const [row] = await rows<{ ends: string }>(db, sql`select expires_at as ends from session where person_id = ${id}`);
      expect(new Date(row?.ends as string).getTime(), who).toBe(endOfWorkingDay().getTime());
    }
  });

  it("don't hand one person's look-as to the next", async () => {
    const response = await login("marco");
    expect(response.headers.getSetCookie().some((one) => one.startsWith("sid_back=;"))).toBe(true);
  });
});

describe("the edges", () => {
  it("refuses a huge body", async () => {
    expect((await login("x".repeat(20 * 1024))).status).toBe(413);
    expect((await post("/webhooks/store/2mg", { filler: "x".repeat(2 * 1024 * 1024) })).status).toBe(413);
  });

  it("sends the security headers, on refusals too", async () => {
    for (const response of [await get("/api/health"), await get("/api/me")]) {
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("x-frame-options")).toBeTruthy();
      expect(response.headers.get("strict-transport-security")).toBeTruthy();
    }
  });
});
