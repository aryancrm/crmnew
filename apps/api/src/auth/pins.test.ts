// Each person's own PIN (Aryan, 21 Nov): the password is the company's, the PIN is theirs. Set on
// the first sign-in, asked after the password; on a desk's common screen nothing is done without
// the name and PIN of whoever does it, each person starts themselves, and wrong passwords there
// lock the screen, never a person's own login.

import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedDemo } from "../seed";
import type { Me } from "../types";
import { endOfWorkingDay } from "./sessions";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const login = (email: string, extra: Record<string, string> = {}) =>
  post("/api/auth/login", { email, password: PASSWORD, ...extra });
const codeOf = async (response: Response) => ((await response.json()) as { error?: { code: string } }).error?.code;
const cookieOf = (response: Response) => response.headers.get("set-cookie")?.split(";")[0] as string;
const idOf = async (email: string) =>
  (await rows<{ id: number }>(db, sql`select id::int as id from person where email = ${email}`))[0]?.id as number;

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  // A second person at Management, with the demo password.
  await db.execute(
    sql`insert into person (name, email, role, title, password_hash, active)
      select 'Kate', 'kate@2mg.test', 'management', 'Desk', password_hash, true from person where name = 'Sarla'`,
  );
  app = createApp(db, { webUrl: "http://localhost:5180", pins: true });
});

describe("a person's own PIN", () => {
  it("is created on the first sign-in, then asked every time", async () => {
    expect(await codeOf(await login("ryan@2mg.test"))).toBe("pin_setup");
    // A wrong password says only wrong, before anything about a PIN.
    expect(await codeOf(await post("/api/auth/login", { email: "ryan@2mg.test", password: "nope" }))).toBe("wrong_login");
    expect((await login("ryan@2mg.test", { newPin: "1234" })).status).toBe(400);
    expect((await login("ryan@2mg.test", { newPin: "7777" })).status).toBe(400);
    expect((await login("ryan@2mg.test", { newPin: "4826" })).status).toBe(200);

    expect(await codeOf(await login("ryan@2mg.test"))).toBe("pin_needed");
    expect(await codeOf(await login("ryan@2mg.test", { pin: "0000" }))).toBe("wrong_pin");
    const right = await login("ryan@2mg.test", { pin: "4826" });
    expect(right.status).toBe(200);
    expect(cookieOf(right)).toContain("sid=");
  });

  it("five wrong PINs lock the PIN, not the login", async () => {
    await login("fiona@2mg.test", { newPin: "5937" });
    for (let i = 0; i < 4; i += 1) expect(await codeOf(await login("fiona@2mg.test", { pin: "1111" }))).toBe("wrong_pin");
    expect((await login("fiona@2mg.test", { pin: "1111" })).status).toBe(429);
    expect((await login("fiona@2mg.test", { pin: "5937" })).status).toBe(429);
    const [fiona] = await rows<{ failed: number; locked: boolean }>(
      db,
      sql`select failed_logins::int as failed, locked_until is not null as locked from person where email = 'fiona@2mg.test'`,
    );
    expect(fiona).toEqual({ failed: 0, locked: false });
  });

  it("the administrator clears a forgotten PIN; a new one is created on the next sign-in", async () => {
    const admin = await login("admin@2mg.test", { newPin: "2580" });
    const ryan = await idOf("ryan@2mg.test");
    expect((await post(`/api/org/people/${ryan}/pin`, {}, { cookie: cookieOf(admin) })).status).toBe(200);
    expect(await codeOf(await login("ryan@2mg.test", { pin: "4826" }))).toBe("pin_setup");
    expect((await login("ryan@2mg.test", { newPin: "3917" })).status).toBe(200);
    // Not everyone may clear one.
    const asRyan = await login("ryan@2mg.test", { pin: "3917" });
    expect((await post(`/api/org/people/${ryan}/pin`, {}, { cookie: cookieOf(asRyan) })).status).toBe(403);
  });
});

describe("a desk's common screen", () => {
  const desk = (password = PASSWORD) => post("/api/auth/desk", { desk: "management", password });

  it("opens with the company's password until the end of the working day", async () => {
    const response = await desk();
    expect(response.status).toBe(200);
    expect(((await response.json()) as { me: Me }).me.deskScreen).toBe("management");
    const [row] = await rows<{ ends: string }>(db, sql`select expires_at as ends from session where desk = 'management' order by id desc limit 1`);
    expect(new Date(row?.ends as string).getTime()).toBe(endOfWorkingDay().getTime());
  });

  it("does nothing without the name and PIN of whoever does it; each person starts themselves", async () => {
    await login("sarla@2mg.test", { newPin: "6142" });
    await login("kate@2mg.test", { newPin: "8053" });
    const screen = cookieOf(await desk());
    const [sarla, kate] = [await idOf("sarla@2mg.test"), await idOf("kate@2mg.test")];
    const start = (who: number, as?: { id: number; pin: string }) =>
      post(`/api/desk/management/people/${who}/start`, { on: true }, {
        cookie: screen,
        ...(as ? { "x-desk-person": String(as.id), "x-desk-pin": as.pin } : {}),
      });

    expect(await codeOf(await start(kate))).toBe("desk_pin");
    expect(await codeOf(await start(kate, { id: kate, pin: "0000" }))).toBe("wrong_pin");
    expect((await start(kate, { id: sarla, pin: "6142" })).status).toBe(403);
    expect((await start(kate, { id: kate, pin: "8053" })).status).toBe(200);
    // Someone outside the desk can't act on its screen.
    expect((await start(kate, { id: await idOf("ryan@2mg.test"), pin: "3917" })).status).toBe(403);
    // Reading needs no PIN.
    expect((await app.request("/api/desk/management/team", { headers: { cookie: screen } })).status).toBe(200);
  });

  it("wrong passwords lock the screen, never the lead's own login", async () => {
    for (let i = 0; i < 5; i += 1) await desk("not-the-password");
    expect((await desk()).status).toBe(429);
    const [sarla] = await rows<{ failed: number; locked: boolean }>(
      db,
      sql`select failed_logins::int as failed, locked_until is not null as locked from person where email = 'sarla@2mg.test'`,
    );
    expect(sarla).toEqual({ failed: 0, locked: false });
    expect((await login("sarla@2mg.test", { pin: "6142" })).status).toBe(200);
  });
});
