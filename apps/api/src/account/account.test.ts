// A person's profile and two-step sign-in. What must hold: a password alone opens nothing of who
// turned it on, a code works once, guesses sent together can't beat the lock, nobody reads or
// changes another's profile, a name can't pass for a colleague's, and a picture is only a picture.

import { sql } from "drizzle-orm";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app";
import { base32, codeAt, stepAt, stepOfCode } from "../auth/totp";
import { turnOff } from "../auth/two-step";
import { runChecks } from "../checks/integrity";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedDemo } from "../seed";
import type { HrPerson, Me, Profile } from "../types";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;

const post = (path: string, body: unknown, cookie = "") =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
const get = (path: string, cookie = "") => app.request(path, { headers: { cookie } });
const upload = (bytes: Uint8Array, cookie: string, type = "image/jpeg") => {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(bytes)], "me.jpg", { type }));
  return app.request("/api/me/photo", { method: "POST", headers: { cookie }, body: form });
};
const cookiesOf = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((one) => one.split(";")[0] as string)
    .filter((one) => !one.endsWith("="))
    .join("; ");
const login = (who: string, password = PASSWORD, more: object = {}) =>
  post("/api/auth/login", { email: `${who}@2mg.test`, password, ...more });
const signIn = async (who: string) => {
  const response = await login(who);
  expect(response.status, who).toBe(200);
  return cookiesOf(response);
};
const errorOf = async (response: Response) =>
  ((await response.json()) as { error?: { code: string; field?: string } }).error;
const idOf = async (who: string) =>
  (await rows<{ id: number }>(db, sql`select id::int as id from person where email = ${`${who}@2mg.test`}`))[0]?.id as number;
const ticketOf = async (who: string, password = PASSWORD, more: object = {}) =>
  ((await (await login(who, password, more)).json()) as { ticket: string }).ticket;
const withCode = (ticket: string, code: string) => post("/api/auth/login/code", { ticket, code });
/** The code `ahead` steps from now. */
const codeNow = (key: string, ahead = 0) => codeAt(key, stepAt(Date.now()) + ahead);
const profile = async (cookie: string) => (await (await get("/api/me/profile", cookie)).json()) as Profile;
const count = (responses: Response[], status: number) => responses.filter((one) => one.status === status).length;
const wrongFor = (key: string) => {
  const good = [-2, -1, 0, 1, 2].map((ahead) => codeNow(key, ahead));
  return ["111111", "222222", "333333", "444444", "555555", "666666"].find((one) => !good.includes(one)) as string;
};

/**
 * A step's last seconds waited out: the previous step's code (turnOn's) is good only while this
 * step lasts, and a busy machine took longer than that between making it and sending it once
 * (GitHub, 26 Nov: 400 instead of 200).
 */
async function clearOfTheStepsEnd() {
  const left = 30_000 - (Date.now() % 30_000);
  if (left < 3_000) await new Promise((done) => setTimeout(done, left + 100));
}

/** Two-step sign-in on: the browser it was done on, the key, the recovery codes. */
async function turnOn(who: string) {
  const cookie = await signIn(who);
  const started = await post("/api/auth/two-step/start", { password: PASSWORD }, cookie);
  expect(started.status).toBe(200);
  const { key } = (await started.json()) as { key: string };
  await clearOfTheStepsEnd();
  const confirmed = await post("/api/auth/two-step/confirm", { code: codeNow(key, -1) }, cookie);
  expect(confirmed.status).toBe(200);
  return { cookie, key, codes: ((await confirmed.json()) as { codes: string[] }).codes };
}

const personal = (more: object = {}) => ({
  firstName: "Ryan",
  middleName: "Santos",
  lastName: "Dela Cruz",
  suffix: null,
  birthDate: "1994-03-18",
  ...more,
});
const contact = (more: object = {}) => ({
  mobile: null,
  personalEmail: null,
  address: null,
  emergencyName: null,
  emergencyPhone: null,
  emergencyRelation: null,
  ...more,
});

beforeEach(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  app = createApp(db, { webUrl: "http://localhost:5180" });
}, 180_000);
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("the authenticator's codes", () => {
  it("are RFC 6238's own", () => {
    const key = base32(Buffer.from("12345678901234567890"));
    for (const [seconds, code] of [
      [59, "287082"],
      [1111111109, "081804"],
      [1111111111, "050471"],
      [1234567890, "005924"],
      [2000000000, "279037"],
    ] as const)
      expect(codeAt(key, stepAt(seconds * 1000))).toBe(code);
  });

  it("allow a clock one step off, no more", () => {
    const key = base32(Buffer.from("12345678901234567890"));
    const ms = 1111111111_000;
    const step = stepAt(ms);
    expect(stepOfCode(key, codeAt(key, step - 1), ms)).toBe(step - 1);
    expect(stepOfCode(key, codeAt(key, step + 1), ms)).toBe(step + 1);
    expect(stepOfCode(key, codeAt(key, step - 2), ms)).toBeNull();
  });
});

describe("turning it on", () => {
  it("needs the password, then a code; a key not confirmed changes nothing", async () => {
    const cookie = await signIn("ryan");
    expect((await errorOf(await post("/api/auth/two-step/start", { password: "not-it-at-all" }, cookie)))?.field).toBe("password");
    const { key } = (await (await post("/api/auth/two-step/start", { password: PASSWORD }, cookie)).json()) as { key: string };
    expect(((await (await login("ryan")).json()) as { me?: Me }).me?.twoStep).toBe(false);
    expect((await errorOf(await post("/api/auth/two-step/confirm", { code: wrongFor(key) }, cookie)))?.code).toBe("wrong_code");
    expect((await profile(cookie)).security.twoStep.on).toBe(false);
  });

  it("keeps neither the key nor a recovery code as it is", async () => {
    const { key, codes } = await turnOn("ryan");
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    const [kept] = await rows<{ all: string }>(db, sql`select row_to_json(t)::text as all from person_two_step t`);
    expect(kept?.all).not.toContain(key);
    for (const code of codes) expect(kept?.all).not.toContain(code.replaceAll("-", ""));
  });

  it("signs out whoever was in elsewhere with the password alone", async () => {
    const elsewhere = await signIn("ryan");
    const { cookie } = await turnOn("ryan");
    expect((await get("/api/me", elsewhere)).status).toBe(401);
    expect((await get("/api/me", cookie)).status).toBe(200);
  });

  it("can't be started over while on", async () => {
    const { cookie } = await turnOn("ryan");
    expect((await post("/api/auth/two-step/start", { password: PASSWORD }, cookie)).status).toBe(409);
  });

  it("doesn't seal with the local key on a server that has none", async () => {
    const cookie = await signIn("ryan");
    vi.stubEnv("SECRETS_KEY", "");
    vi.stubEnv("DATABASE_URL", "postgres://somewhere/crm");
    expect((await errorOf(await post("/api/auth/two-step/start", { password: PASSWORD }, cookie)))?.code).toBe("not_ready");
  });

  it("doesn't take a code for a key shown too long ago", async () => {
    const cookie = await signIn("ryan");
    const { key } = (await (await post("/api/auth/two-step/start", { password: PASSWORD }, cookie)).json()) as { key: string };
    await db.execute(sql`update person_two_step set pending_at = now() - interval '16 minutes'`);
    expect((await post("/api/auth/two-step/confirm", { code: codeNow(key) }, cookie)).status).toBe(409);
  });
});

describe("signing in with it on", () => {
  it("gives a right password no session, only the next step", async () => {
    await turnOn("ryan");
    const response = await login("ryan");
    expect(cookiesOf(response)).not.toMatch(/sid=|dev_/);
    expect(await response.json()).toEqual({ twoStep: true, ticket: expect.any(String) });
  });

  it("doesn't let a ticket stand for a session", async () => {
    await turnOn("ryan");
    const ticket = await ticketOf("ryan");
    expect((await get("/api/me", `sid=${ticket}`)).status).toBe(401);
  });

  it("opens on the code, for the department signed in at", async () => {
    const { key } = await turnOn("fiona");
    const ticket = await ticketOf("fiona", PASSWORD, { workspace: "books" });
    const done = await withCode(ticket, codeNow(key));
    expect(done.status).toBe(200);
    const me = ((await (await get("/api/me", cookiesOf(done))).json()) as { me: Me }).me;
    expect(me).toMatchObject({ name: "Fiona", workspace: "books", twoStep: true });
  });

  it("still refuses another department before any code", async () => {
    await turnOn("ryan");
    expect((await errorOf(await login("ryan", PASSWORD, { workspace: "finance" })))?.code).toBe("wrong_department");
  });

  it("takes a code once, on another ticket too", async () => {
    const { key } = await turnOn("ryan");
    const code = codeNow(key);
    expect((await withCode(await ticketOf("ryan"), code)).status).toBe(200);
    expect((await errorOf(await withCode(await ticketOf("ryan"), code)))?.code).toBe("wrong_code");
  });

  it("doesn't take the code that turned it on again", async () => {
    const { key } = await turnOn("ryan");
    expect((await withCode(await ticketOf("ryan"), codeNow(key, -1))).status).not.toBe(200);
  });

  it("lets one of the same code sent twenty times at once in", async () => {
    const { key } = await turnOn("ryan");
    const code = codeNow(key);
    const tickets = await Promise.all(Array.from({ length: 4 }, () => ticketOf("ryan")));
    const answers = await Promise.all(Array.from({ length: 20 }, (_, i) => withCode(tickets[i % 4] as string, code)));
    expect(count(answers, 200)).toBe(1);
  });

  it("takes a ticket once", async () => {
    const { key, codes } = await turnOn("ryan");
    const ticket = await ticketOf("ryan");
    expect((await withCode(ticket, codeNow(key))).status).toBe(200);
    expect((await errorOf(await withCode(ticket, codes[0] as string)))?.code).toBe("sign_in_again");
  });

  it("refuses a made-up or five-minute-old ticket", async () => {
    const { key } = await turnOn("ryan");
    expect((await withCode("x".repeat(43), codeNow(key))).status).toBe(401);
    const ticket = await ticketOf("ryan");
    await db.execute(sql`update sign_in_ticket set expires_at = now() - interval '1 second'`);
    expect((await withCode(ticket, codeNow(key))).status).toBe(401);
  });

  it("ends a waiting ticket on a new password, and on switching the person off", async () => {
    const { key } = await turnOn("ryan");
    const first = await ticketOf("ryan");
    await post(`/api/org/people/${await idOf("ryan")}/password`, {}, await signIn("admin"));
    expect((await withCode(first, codeNow(key))).status).toBe(401);
    await turnOn("daniel");
    const second = await ticketOf("daniel");
    await db.execute(sql`update person set active = false where email = 'daniel@2mg.test'`);
    expect((await withCode(second, "123456")).status).toBe(401);
  });

  it("doesn't take one person's code or recovery code for another", async () => {
    const ryan = await turnOn("ryan");
    await turnOn("daniel");
    const ticket = await ticketOf("daniel");
    expect((await withCode(ticket, ryan.codes[0] as string)).status).toBe(400);
    expect((await withCode(ticket, codeNow(ryan.key))).status).toBe(400);
  });

  it("doesn't open a key copied from another person's row", async () => {
    const ryan = await turnOn("ryan");
    await turnOn("daniel");
    await db.execute(sql`update person_two_step set last_step = null,
      secret = (select secret from person_two_step where person_id = ${await idOf("ryan")})
      where person_id = ${await idOf("daniel")}`);
    expect((await errorOf(await withCode(await ticketOf("daniel"), codeNow(ryan.key))))?.code).toBe("two_step_unreadable");
  });
});

describe("guessing codes", () => {
  it("sixty at once get five, then the lock", async () => {
    const { key } = await turnOn("ryan");
    const ticket = await ticketOf("ryan");
    const wrong = wrongFor(key);
    const answers = await Promise.all(Array.from({ length: 60 }, () => withCode(ticket, wrong)));
    expect(count(answers, 400)).toBe(5);
    expect(count(answers, 429)).toBe(55);
  });

  it("the right password again clears nothing, and the right code waits out the lock", async () => {
    const { key } = await turnOn("ryan");
    const ticket = await ticketOf("ryan");
    for (let i = 0; i < 5; i += 1) await withCode(ticket, wrongFor(key));
    expect((await errorOf(await withCode(await ticketOf("ryan"), codeNow(key))))?.code).toBe("code_locked");
  });

  it("waits longer each round", async () => {
    const { key } = await turnOn("ryan");
    const minutes: number[] = [];
    for (let round = 0; round < 3; round += 1) {
      const ticket = await ticketOf("ryan");
      for (let i = 0; i < 5; i += 1) await withCode(ticket, wrongFor(key));
      const [row] = await rows<{ m: number }>(
        db,
        sql`select round(extract(epoch from locked_until - now()) / 60)::int as m from person_two_step`,
      );
      minutes.push(row?.m as number);
      await db.execute(sql`update person_two_step set locked_until = now() - interval '1 second'`);
    }
    expect(minutes).toEqual([15, 30, 60]);
  });

  it("never waits more than a day", async () => {
    const { key } = await turnOn("ryan");
    await db.execute(sql`update person_two_step set failed = 499`);
    await withCode(await ticketOf("ryan"), wrongFor(key));
    const [row] = await rows<{ m: number }>(
      db,
      sql`select round(extract(epoch from locked_until - now()) / 60)::int as m from person_two_step`,
    );
    expect(row?.m).toBe(1440);
  });

  it("tells the person someone has their password", async () => {
    const { key } = await turnOn("ryan");
    const ticket = await ticketOf("ryan");
    for (let i = 0; i < 5; i += 1) await withCode(ticket, wrongFor(key));
    const told = await rows<{ title: string }>(db, sql`select title from notification where person_id = ${await idOf("ryan")}`);
    expect(told.map((one) => one.title)).toContain("Someone entered wrong sign-in codes on your account");
  });
});

describe("recovery codes", () => {
  it("each works once, typed with or without its dashes", async () => {
    const { codes } = await turnOn("ryan");
    const code = (codes[0] as string).toLowerCase();
    expect((await withCode(await ticketOf("ryan"), code)).status).toBe(200);
    expect((await withCode(await ticketOf("ryan"), code.replaceAll("-", ""))).status).toBe(400);
    const done = await withCode(await ticketOf("ryan"), (codes[1] as string).replaceAll("-", ""));
    expect(done.status).toBe(200);
    expect((await profile(cookiesOf(done))).security.twoStep.codesLeft).toBe(8);
  });

  it("renewed, the old ones stop", async () => {
    const { cookie, key, codes } = await turnOn("ryan");
    expect((await post("/api/auth/two-step/recovery", { password: "not-it-at-all", code: codeNow(key) }, cookie)).status).toBe(400);
    const renewed = await post("/api/auth/two-step/recovery", { password: PASSWORD, code: codeNow(key) }, cookie);
    expect(renewed.status).toBe(200);
    const fresh = ((await renewed.json()) as { codes: string[] }).codes;
    expect((await withCode(await ticketOf("ryan"), codes[0] as string)).status).toBe(400);
    expect((await withCode(await ticketOf("ryan"), fresh[0] as string)).status).toBe(200);
  });
});

describe("turning it off", () => {
  it("needs the password and a code", async () => {
    const { cookie, key } = await turnOn("ryan");
    expect((await post("/api/auth/two-step/off", { password: "not-it-at-all", code: codeNow(key) }, cookie)).status).toBe(400);
    expect((await post("/api/auth/two-step/off", { password: PASSWORD, code: wrongFor(key) }, cookie)).status).toBe(400);
    expect((await post("/api/auth/two-step/off", { password: PASSWORD, code: codeNow(key) }, cookie)).status).toBe(200);
    expect(cookiesOf(await login("ryan"))).toContain("sid=");
  });

  it("a password given by the Admin or HR leaves it on", async () => {
    await turnOn("ryan");
    const id = await idOf("ryan");
    const given = await post(`/api/org/people/${id}/password`, {}, await signIn("admin"));
    const { password } = (await given.json()) as { password: string };
    expect(await (await login("ryan", password)).json()).toMatchObject({ twoStep: true });
    expect((await post(`/api/hr/people/${id}/login`, { password: "given-by-hr-9" }, await signIn("helen"))).status).toBe(200);
    expect(await (await login("ryan", "given-by-hr-9")).json()).toMatchObject({ twoStep: true });
  });

  it("only the Admin resets another's", async () => {
    await turnOn("ryan");
    const id = await idOf("ryan");
    for (const who of ["helen", "naresh", "daniel", "vanessa", "sarla"])
      expect((await post(`/api/auth/two-step/reset/${id}`, { password: PASSWORD }, await signIn(who))).status, who).toBe(403);
  });

  it("the Admin's reset takes their password, signs the person out and tells them", async () => {
    const { cookie } = await turnOn("ryan");
    const id = await idOf("ryan");
    const admin = await signIn("admin");
    expect((await post(`/api/auth/two-step/reset/${id}`, { password: "not-it-at-all" }, admin)).status).toBe(400);
    expect((await post(`/api/auth/two-step/reset/${id}`, { password: PASSWORD }, admin)).status).toBe(200);
    expect((await get("/api/me", cookie)).status).toBe(401);
    const after = await signIn("ryan");
    expect((await profile(after)).security.events[0]).toMatchObject({ what: "Two-step sign-in reset", by: "Admin" });
    const told = await rows<{ title: string }>(db, sql`select title from notification where person_id = ${id}`);
    expect(told.map((one) => one.title)).toContain("Your two-step sign-in was reset");
  });

  it("an Admin with their own on gives its code too, and can't reset themselves", async () => {
    await turnOn("ryan");
    const admin = await turnOn("admin");
    const id = await idOf("ryan");
    expect((await errorOf(await post(`/api/auth/two-step/reset/${id}`, { password: PASSWORD }, admin.cookie)))?.code).toBe("code_needed");
    expect((await post(`/api/auth/two-step/reset/${await idOf("admin")}`, { password: PASSWORD }, admin.cookie)).status).toBe(400);
    expect((await post(`/api/auth/two-step/reset/${id}`, { password: PASSWORD, code: codeNow(admin.key) }, admin.cookie)).status).toBe(200);
  });

  it("from the server, for an only Admin who lost both", async () => {
    await turnOn("admin");
    expect(await turnOff(db, await idOf("admin"), null)).toBe(true);
    expect(cookiesOf(await login("admin"))).toContain("sid=");
  });
});

describe("the profile", () => {
  it("is for each role, their own", async () => {
    for (const who of ["naresh", "admin", "sarla", "fiona", "marco", "irene", "vanessa", "daniel", "ryan", "jane", "helen"]) {
      const response = await get("/api/me/profile", await signIn(who));
      expect(response.status, who).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("needs signing in", async () => {
    expect((await get("/api/me/profile")).status).toBe(401);
    expect((await post("/api/me/profile/personal", personal())).status).toBe(401);
    expect((await post("/api/me/profile/contact", contact())).status).toBe(401);
    expect((await post("/api/auth/two-step/start", { password: PASSWORD })).status).toBe(401);
    expect((await get("/api/people/1/photo/1")).status).toBe(401);
  });

  it("waits for a one-time password to be changed", async () => {
    const cookie = await signIn("ryan");
    await db.execute(sql`update person set must_change_password = true where email = 'ryan@2mg.test'`);
    expect((await errorOf(await get("/api/me/profile", cookie)))?.code).toBe("password_change");
  });

  it("is closed to whoever looks as the person", async () => {
    for (const who of ["naresh", "admin", "daniel"]) {
      const own = await signIn(who);
      const looking = await post(`/api/auth/view/${await idOf("ryan")}`, {}, own);
      expect(looking.status, who).toBe(200);
      const cookie = cookiesOf(looking);
      expect((await errorOf(await get("/api/me/profile", cookie)))?.code, who).toBe("private");
      expect((await post("/api/me/profile/personal", personal(), cookie)).status).toBe(403);
      expect((await post("/api/auth/two-step/start", { password: PASSWORD }, cookie)).status).toBe(403);
      expect(((await (await get("/api/me", cookie)).json()) as { me: Me }).me.twoStep).toBeUndefined();
    }
  });

  it("pay and the HR record don't open to a lead looking as someone", async () => {
    const id = await idOf("ryan");
    await db.execute(sql`update employee set salary = 4321000, bank_account = 'PRIVATE-BANK' where person_id = ${id}`);
    const paths = [`/api/hr/people/${id}`, "/api/hr/people", "/api/hr/payslips/mine", "/api/hr/payslips/2026-11", "/api/hr/payroll", "/api/hr/leave/1/file"];
    for (const who of ["daniel", "vanessa"]) {
      const cookie = cookiesOf(await post(`/api/auth/view/${id}`, {}, await signIn(who)));
      for (const path of paths) expect((await errorOf(await get(path, cookie)))?.code, `${who} ${path}`).toBe("private");
      expect((await get("/api/hr/my-day", cookie)).status, who).toBe(200);
      expect((await get("/api/hr/leave/mine", cookie)).status, who).toBe(200);
    }
    for (const who of ["naresh", "admin"]) {
      const cookie = cookiesOf(await post(`/api/auth/view/${id}`, {}, await signIn(who)));
      expect((await get(`/api/hr/people/${id}`, cookie)).status, who).toBe(200);
    }
    const own = await signIn("ryan");
    expect((await get(`/api/hr/people/${id}`, own)).status).toBe(200);
    expect((await get("/api/hr/payslips/mine", own)).status).toBe(200);
  });

  it("makes the shown name from its parts, everywhere", async () => {
    const cookie = await signIn("ryan");
    expect((await post("/api/me/profile/personal", personal({ suffix: "Jr." }), cookie)).status).toBe(200);
    expect(((await (await get("/api/me", cookie)).json()) as { me: Me }).me.name).toBe("Ryan S. Dela Cruz Jr.");
    expect(await profile(cookie)).toMatchObject({
      complete: true,
      personal: { firstName: "Ryan", middleName: "Santos", lastName: "Dela Cruz", suffix: "Jr.", birthDate: "1994-03-18" },
    });
  });

  it("takes no middle name or suffix", async () => {
    const cookie = await signIn("ryan");
    expect((await post("/api/me/profile/personal", personal({ middleName: null }), cookie)).status).toBe(200);
    expect((await profile(cookie)).name).toBe("Ryan Dela Cruz");
  });

  it("writes the birth date and contact where HR reads them", async () => {
    const cookie = await signIn("ryan");
    await post("/api/me/profile/personal", personal(), cookie);
    const sent = contact({ mobile: "0917 555 0101", emergencyName: "Ana Dela Cruz", emergencyPhone: "0918 555 0202" });
    expect((await post("/api/me/profile/contact", sent, cookie)).status).toBe(200);
    const seen = (await (await get(`/api/hr/people/${await idOf("ryan")}`, await signIn("helen"))).json()) as HrPerson;
    expect(seen.record).toMatchObject({ birthDate: "1994-03-18", mobile: "0917 555 0101", emergencyName: "Ana Dela Cruz" });
  });

  it("tells HR and the Admin of a new name, once", async () => {
    const cookie = await signIn("ryan");
    await post("/api/me/profile/personal", personal(), cookie);
    await post("/api/me/profile/personal", personal(), cookie);
    for (const who of ["helen", "admin"]) {
      const told = await rows<{ title: string }>(
        db,
        sql`select title from notification where person_id = ${await idOf(who)} and kind = 'account'`,
      );
      expect(told, who).toEqual([{ title: "Ryan changed their name to Ryan S. Dela Cruz" }]);
    }
  });

  it.each([
    ["firstName", ""],
    ["lastName", " "],
    ["firstName", "Rуаn"],
    ["lastName", "<script>"],
    ["lastName", "Cruz​"],
    ["lastName", "Cruz‮"],
    ["lastName", "C3O"],
    ["middleName", "@admin"],
    ["suffix", "CEO"],
    ["birthDate", ""],
    ["birthDate", "1994-02-30"],
    ["birthDate", "2025-01-01"],
    ["birthDate", "1890-01-01"],
  ])("refuses %s = %j", async (field, value) => {
    const response = await post("/api/me/profile/personal", personal({ [field]: value }), await signIn("ryan"));
    expect(response.status).toBe(400);
    expect((await errorOf(response))?.field).toBe(field);
  });

  it("takes the names people have", async () => {
    const cookie = await signIn("ryan");
    for (const [firstName, lastName] of [
      ["María Niña", "Peñaflor"],
      ["Jean-Luc", "O'Brien"],
      ["Ma. Cristina", "de los Santos"],
    ])
      expect((await post("/api/me/profile/personal", personal({ firstName, lastName }), cookie)).status, firstName).toBe(200);
  });

  it("can't pass for a colleague", async () => {
    await db.execute(sql`update person set name = 'Naresh Bishnoi' where email = 'naresh@2mg.test'`);
    const cookie = await signIn("ryan");
    for (const [firstName, middleName, lastName] of [
      ["Naresh", null, "Bishnoi"],
      ["NARESH", null, "bishnoi"],
      ["Naresh", "Kumar", "Bishnoi"],
      ["Náresh", null, "Bishnöi"],
      ["Na resh", null, "Bish-noi"],
    ])
      expect((await post("/api/me/profile/personal", personal({ firstName, middleName, lastName }), cookie)).status, String(firstName)).toBe(409);
  });

  it("a namesake who already has the name can still save", async () => {
    const cookie = await signIn("ryan");
    await post("/api/me/profile/personal", personal(), cookie);
    expect((await post("/api/me/profile/personal", personal({ birthDate: "1994-03-19" }), cookie)).status).toBe(200);
  });

  it.each([
    ["mobile", { mobile: "call me" }],
    ["personalEmail", { personalEmail: "not-an-email" }],
    ["emergencyPhone", { emergencyName: "Ana" }],
    ["emergencyName", { emergencyPhone: "0918 555 0202" }],
  ])("refuses a wrong %s", async (field, value) => {
    const response = await post("/api/me/profile/contact", contact(value), await signIn("ryan"));
    expect((await errorOf(response))?.field).toBe(field);
  });

  it("can't set what isn't a person's to set", async () => {
    const cookie = await signIn("ryan");
    await post("/api/me/profile/personal", personal({ role: "admin", id: await idOf("naresh"), email: "x@x.test" }), cookie);
    await post("/api/me/profile/contact", contact({ salary: 99999900, personId: await idOf("naresh") }), cookie);
    const [me] = await rows<{ role: string; salary: number | null; email: string }>(
      db,
      sql`select p.role, p.email, e.salary from person p join employee e on e.person_id = p.id where p.id = ${await idOf("ryan")}`,
    );
    expect(me).toEqual({ role: "medrep", salary: null, email: "ryan@2mg.test" });
    const [ceo] = await rows<{ name: string }>(db, sql`select name from person where email = 'naresh@2mg.test'`);
    expect(ceo?.name).toBe("Naresh");
  });

  it("signs out the other devices", async () => {
    const other = await signIn("ryan");
    const here = await signIn("ryan");
    expect((await profile(here)).security.otherSessions).toBe(1);
    expect((await post("/api/auth/sessions/end-others", {}, here)).status).toBe(200);
    expect((await get("/api/me", other)).status).toBe(401);
    expect((await profile(here)).security.otherSessions).toBe(0);
  });

  it("leaves the data checks green", async () => {
    await post("/api/me/profile/personal", personal(), await signIn("ryan"));
    await turnOn("daniel");
    expect((await runChecks(db)).checks.filter((one) => !one.ok)).toEqual([]);
  });
});

describe("the picture", () => {
  const photo = () =>
    sharp({ create: { width: 900, height: 600, channels: 3, background: "#17824a" } })
      .withExif({ IFD0: { Copyright: "SECRET-PLACE" } })
      .jpeg()
      .toBuffer();

  it("becomes a small square with nothing else in it, seen by colleagues", async () => {
    const cookie = await signIn("ryan");
    const made = await upload(await photo(), cookie);
    expect(made.status).toBe(200);
    const { id } = (await made.json()) as { id: number };
    expect(((await (await get("/api/me", cookie)).json()) as { me: Me }).me.photo).toBe(id);
    const read = await get(`/api/people/${await idOf("ryan")}/photo/${id}`, await signIn("sarla"));
    expect(read.headers.get("content-type")).toBe("image/webp");
    const bytes = Buffer.from(await read.arrayBuffer());
    const meta = await sharp(bytes).metadata();
    expect([meta.width, meta.height, meta.exif]).toEqual([320, 320, undefined]);
    expect(bytes.includes(Buffer.from("SECRET-PLACE"))).toBe(false);
  });

  it("is only a picture, whatever it is called", async () => {
    const cookie = await signIn("ryan");
    for (const body of ['<svg xmlns="http://www.w3.org/2000/svg" width="9" height="9"/>', "<html><script>1</script></html>", "%PDF-1.7"])
      expect((await upload(Buffer.from(body), cookie)).status, body).toBe(400);
    expect((await upload(Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3]), cookie)).status).toBe(400);
  });

  it("is under 8 MB", async () => {
    const big = Buffer.alloc(8 * 1024 * 1024 + 10, 1);
    expect((await upload(big, await signIn("ryan"))).status).toBe(413);
  });

  it("replaced or removed is archived, and opens for nobody", async () => {
    const cookie = await signIn("ryan");
    const id = await idOf("ryan");
    const first = ((await (await upload(await photo(), cookie)).json()) as { id: number }).id;
    const second = ((await (await upload(await photo(), cookie)).json()) as { id: number }).id;
    expect((await get(`/api/people/${id}/photo/${first}`, cookie)).status).toBe(404);
    expect((await get(`/api/people/${await idOf("sarla")}/photo/${second}`, cookie)).status).toBe(404);
    expect((await post("/api/me/photo/remove", {}, cookie)).status).toBe(200);
    expect((await get(`/api/people/${id}/photo/${second}`, cookie)).status).toBe(404);
    expect((await rows(db, sql`select id from person_photo`)).length).toBe(2);
  });
});
