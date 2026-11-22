// Sign up, the Admin confirms, the email lets them in. What must hold: asking grants and tells
// nothing, only the Admin lets someone in, the seat decides the role, only the inbox's owner sets
// the password, and a link works once.

import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { runChecks } from "../checks/integrity";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { connectMailbox, type OutgoingMail, useMailTransport } from "../online/email";
import { seedDemo } from "../seed";
import type { Me, SignUpList, SignUpSent, WelcomeInfo } from "../types";
import { MOST_WAITING, PER_HOUR } from "./sign-up";

const PASSWORD = "test-password-1";
const OWN = "my-own-words-42";
const WEB = "http://localhost:5180";
let db: Database;
let app: ReturnType<typeof createApp>;
let outbox: OutgoingMail[];
let failing: boolean;

const post = (path: string, body: unknown, cookie = "", headers: Record<string, string> = {}) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie, ...headers },
    body: JSON.stringify(body),
  });
const get = (path: string, cookie = "") => app.request(path, { headers: { cookie } });
const cookiesOf = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((one) => one.split(";")[0] as string)
    .filter((one) => !one.endsWith("="))
    .join("; ");
const login = (email: string, password = PASSWORD, more: object = {}) => post("/api/auth/login", { email, password, ...more });
const signIn = async (who: string) => {
  const response = await login(`${who}@2mg.test`);
  expect(response.status, who).toBe(200);
  return cookiesOf(response);
};
const errorOf = async (response: Response) =>
  ((await response.json()) as { error?: { code: string; field?: string } }).error;
const one = async <T>(query: ReturnType<typeof sql>) => (await rows<T>(db, query))[0] as T;
const count = async (query: ReturnType<typeof sql>) => (await one<{ n: number }>(query)).n;
const person = (email: string) =>
  one<{ id: number; role: string; name: string; pending: boolean } | undefined>(
    sql`select id::int as id, role, name, password_pending as pending from person where email = ${email}`,
  );

const EMAIL = "liza.reyes@example.com";
const form = (more: object = {}) => ({
  firstName: "Liza",
  middleName: "Marie",
  lastName: "Reyes",
  suffix: null,
  email: EMAIL,
  phone: "0917 555 0303",
  department: "finance",
  ...more,
});
const ask = (more: object = {}) => post("/api/auth/sign-up", form(more));
const idAsked = async (email = EMAIL) =>
  (await one<{ id: number }>(sql`select id::int as id from sign_up where email = ${email} order by id desc limit 1`)).id;

async function job(module = "finance") {
  const unit = await one<{ id: number }>(
    sql`select s.unit_id::int as id from seat s where s.active and s.module = 'finance' limit 1`,
  );
  return { confirmed: true, unitId: unit.id, title: "Finance officer", module, lead: false };
}

async function mailbox() {
  const admin = await one<{ id: number }>(sql`select id::int as id from person where email = 'admin@2mg.test'`);
  await connectMailbox(db, { id: admin.id, name: "Admin", role: "admin" } as Me, {
    address: "hello@company.test",
    password: "app-pass-for-tests",
    imapHost: "imap.company.test",
    imapPort: 993,
    smtpHost: "smtp.company.test",
    smtpPort: 465,
  });
}

/** Asked and accepted: the link's token, from the email (or from the answer, when none went). */
async function accepted(more: object = {}) {
  expect((await ask()).status).toBe(200);
  const response = await post(`/api/sign-ups/${await idAsked()}/accept`, { ...(await job()), ...more }, await signIn("admin"));
  expect(response.status).toBe(200);
  const sent = (await response.json()) as SignUpSent;
  const link = sent.link ?? /\S+\/welcome#\S+/.exec(outbox.at(-1)?.text ?? "")?.[0] ?? "";
  return { sent, token: link.split("#")[1] as string, link };
}
const setPassword = (token: string, password = OWN) => post("/api/auth/welcome/password", { token, password });

beforeEach(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  app = createApp(db, { webUrl: WEB });
  outbox = [];
  failing = false;
  useMailTransport({
    check: async () => ({ error: null, cursor: null }),
    read: async () => ({ cursor: { uidValidity: "t", lastUid: 0 }, sources: [] }),
    send: async (_mailbox, mail) => {
      if (failing) throw new Error("Sending mail (SMTP): the server refused it.");
      outbox.push(mail);
    },
  });
}, 180_000);
afterEach(() => useMailTransport(null));

describe("asking", () => {
  it("makes a request, and nothing else: no account, session or email", async () => {
    await mailbox();
    const before = await count(sql`select count(*)::int as n from person`);
    const response = await ask();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(await count(sql`select count(*)::int as n from person`)).toBe(before);
    expect(outbox).toEqual([]);
    expect((await login(EMAIL, OWN)).status).toBe(401);
  });

  it("answers the same for a colleague's email, a new one and one asked already", async () => {
    const answers = [];
    for (const email of ["naresh@2mg.test", EMAIL, EMAIL, "NARESH@2mg.test"]) {
      const response = await ask({ email });
      answers.push([response.status, await response.text()]);
    }
    expect(new Set(answers.map((answer) => JSON.stringify(answer))).size).toBe(1);
  });

  it("asking again can't rewrite the request that waits", async () => {
    await ask();
    await ask({ email: EMAIL.toUpperCase(), firstName: "Mallory", phone: "0999 999 9999" });
    const all = await rows<{ first_name: string; phone: string }>(db, sql`select first_name, phone from sign_up`);
    expect(all).toEqual([{ first_name: "Liza", phone: "0917 555 0303" }]);
  });

  it("ignores a role, a status or a password sent with it", async () => {
    await ask({ role: "admin", module: "admin", status: "accepted", password: OWN, personId: 1 });
    expect(await one(sql`select status, person_id from sign_up`)).toEqual({ status: "pending", person_id: null });
    expect(await person(EMAIL)).toBeUndefined();
  });

  it.each([
    ["firstName", ""],
    ["lastName", "<script>"],
    ["firstName", "Nаresh"],
    ["middleName", "http://x.io"],
    ["suffix", "CEO"],
    ["email", "not-an-email"],
    ["email", "a@b.co\r\nBcc: victim@x.com"],
    ["email", "a@b.co, victim@x.com"],
    ["email", "Name <a@b.co>"],
    ["email", "nаresh@2mginc.com"],
    ["phone", "call me"],
    ["department", "admin"],
    ["department", "ceo"],
    ["department", "books"],
    ["department", "nothing"],
  ])("refuses %s = %j", async (field, value) => {
    const response = await ask({ [field]: value });
    expect(response.status).toBe(400);
    expect((await errorOf(response))?.field).toBe(field);
  });

  it("a line break in a name never reaches what is kept or emailed", async () => {
    await mailbox();
    await accepted();
    await ask({ email: "break@example.com", firstName: "Liza\r\nBcc", lastName: "Two\nLines" });
    const id = await idAsked("break@example.com");
    expect((await post(`/api/sign-ups/${id}/accept`, await job(), await signIn("admin"))).status).toBe(200);
    expect(await one(sql`select first_name, last_name from sign_up where id = ${id}`)).toEqual({ first_name: "Liza Bcc", last_name: "Two Lines" });
    expect(outbox.at(-1)?.to).toBe("break@example.com");
    expect(outbox.at(-1)?.text.split("\n")[0]).toBe("Hi Liza Bcc,");
  });

  it("stops at its hourly limit, whatever address it says it comes from", async () => {
    const sent = await Promise.all(
      Array.from({ length: PER_HOUR + 12 }, (_, i) =>
        post("/api/auth/sign-up", form({ email: `p${i}@example.com` }), "", { "x-forwarded-for": `10.0.0.${i}` }),
      ),
    );
    expect(sent.filter((response) => response.status === 200)).toHaveLength(PER_HOUR);
    expect(sent.filter((response) => response.status === 429)).toHaveLength(12);
  });

  it("stops when too many wait", async () => {
    await db.execute(sql`insert into sign_up (first_name, last_name, email, phone, department, created_at)
      select 'A', 'B', 'w' || g || '@example.com', '0917 555 0303', 'sales', now() - interval '2 days'
      from generate_series(1, ${MOST_WAITING}::int) g`);
    expect((await ask()).status).toBe(429);
  });

  it("takes 16 KB at most", async () => {
    expect((await ask({ firstName: "a".repeat(20_000) })).status).toBe(413);
  });

  it("tells the Admin once an hour, never in the stranger's words", async () => {
    await ask({ firstName: "Urgent", lastName: "Payroll" });
    await ask({ email: "second@example.com" });
    const told = await rows<{ title: string; body: string }>(
      db,
      sql`select n.title, n.body from notification n join person p on p.id = n.person_id where p.role = 'admin' and n.link = '/admin/sign-ups'`,
    );
    expect(told).toHaveLength(1);
    expect(JSON.stringify(told)).not.toMatch(/Urgent|Payroll/);
  });
});

describe("only the Admin confirms", () => {
  it("nobody else reads, accepts, declines or sends again", async () => {
    await ask();
    const id = await idAsked();
    const body = await job();
    for (const who of ["naresh", "helen", "sarla", "fiona", "marco", "irene", "vanessa", "daniel", "ryan", "jane"]) {
      const cookie = await signIn(who);
      expect((await get("/api/sign-ups", cookie)).status, who).toBe(403);
      expect((await get("/api/sign-ups/count", cookie)).status, who).toBe(403);
      expect((await post(`/api/sign-ups/${id}/accept`, body, cookie)).status, who).toBe(403);
      expect((await post(`/api/sign-ups/${id}/decline`, {}, cookie)).status, who).toBe(403);
      expect((await post(`/api/sign-ups/${id}/resend`, {}, cookie)).status, who).toBe(403);
    }
    expect((await get("/api/sign-ups")).status).toBe(401);
    expect((await post(`/api/sign-ups/${id}/accept`, body)).status).toBe(401);
    expect(await person(EMAIL)).toBeUndefined();
  });

  it("not while the CEO looks as the Admin", async () => {
    const admin = await one<{ id: number }>(sql`select id::int as id from person where email = 'admin@2mg.test'`);
    const looking = cookiesOf(await post(`/api/auth/view/${admin.id}`, {}, await signIn("naresh")));
    expect((await get("/api/sign-ups", looking)).status).toBe(403);
  });

  it("needs the confirmation", async () => {
    await ask();
    const id = await idAsked();
    const admin = await signIn("admin");
    for (const confirmed of [false, undefined, "true"])
      expect((await post(`/api/sign-ups/${id}/accept`, { ...(await job()), confirmed }, admin)).status).toBe(400);
    expect(await person(EMAIL)).toBeUndefined();
  });

  it("warns of a known email and of a colleague's name", async () => {
    await ask({ email: "ryan@2mg.test" });
    await db.execute(sql`update person set name = 'Liza Reyes' where email = 'fiona@2mg.test'`);
    await ask();
    const list = (await (await get("/api/sign-ups", await signIn("admin"))).json()) as SignUpList;
    expect(list.rows.find((row) => row.email === "ryan@2mg.test")?.knownAs).toBe("Ryan");
    expect(list.rows.find((row) => row.email === EMAIL)?.sameName).toBe("Liza Reyes");
  });

  it("can't accept onto someone's account", async () => {
    await ask({ email: "naresh@2mg.test" });
    const response = await post(`/api/sign-ups/${await idAsked("naresh@2mg.test")}/accept`, await job(), await signIn("admin"));
    expect(response.status).toBe(409);
    expect(await person("naresh@2mg.test")).toMatchObject({ role: "ceo", pending: false, name: "Naresh" });
    expect((await login("naresh@2mg.test")).status).toBe(200);
  });

  it("never gives CEO or Admin, and undoes it all", async () => {
    await ask();
    const id = await idAsked();
    const admin = await signIn("admin");
    const seats = await count(sql`select count(*)::int as n from seat`);
    for (const module of ["admin", "ceo"])
      expect((await post(`/api/sign-ups/${id}/accept`, await job(module), admin)).status, module).toBe(400);
    expect(await person(EMAIL)).toBeUndefined();
    expect(await count(sql`select count(*)::int as n from seat`)).toBe(seats);
    expect(await one(sql`select status from sign_up`)).toEqual({ status: "pending" });
  });

  it("not an email that is another seat's login", async () => {
    const seat = await one<{ login: string }>(sql`select login from seat where active and login is not null limit 1`);
    const email = `${seat.login}@2mginc.com`.toLowerCase();
    await ask({ email });
    expect((await post(`/api/sign-ups/${await idAsked(email)}/accept`, await job(), await signIn("admin"))).status).toBe(409);
  });

  it("the role is the seat's, not what was asked", async () => {
    await ask({ department: "management" });
    expect((await post(`/api/sign-ups/${await idAsked()}/accept`, await job(), await signIn("admin"))).status).toBe(200);
    expect(await person(EMAIL)).toMatchObject({ role: "finance", name: "Liza M. Reyes", pending: true });
  });

  it("two presses at once make one account", async () => {
    await ask();
    const id = await idAsked();
    const body = await job();
    const admin = await signIn("admin");
    const answers = await Promise.all([1, 2, 3, 4].map(() => post(`/api/sign-ups/${id}/accept`, body, admin)));
    expect(answers.filter((response) => response.status === 200)).toHaveLength(1);
    expect(await count(sql`select count(*)::int as n from person where email = ${EMAIL}`)).toBe(1);
  });

  it("declined: kept, no account, no email, no accepting after; they may ask again", async () => {
    await mailbox();
    await ask();
    const id = await idAsked();
    const admin = await signIn("admin");
    expect((await post(`/api/sign-ups/${id}/decline`, { reason: "Not staff" }, admin)).status).toBe(200);
    expect((await post(`/api/sign-ups/${id}/accept`, await job(), admin)).status).toBe(409);
    expect(await person(EMAIL)).toBeUndefined();
    expect(outbox).toEqual([]);
    expect((await ask()).status).toBe(200);
    expect(await idAsked()).not.toBe(id);
  });
});

describe("the email", () => {
  it("says accepted and usable, to that address alone, with the server's own link", async () => {
    await mailbox();
    const { sent, link } = await accepted();
    expect(sent).toEqual({ email: EMAIL, emailed: true, problem: null, link: null });
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.to).toBe(EMAIL);
    expect(outbox[0]?.subject).toBe("Your Bishnoi One account is accepted");
    expect(outbox[0]?.text).toContain("has been accepted and can be used");
    expect(link.startsWith(`${WEB}/welcome#`)).toBe(true);
  });

  it("isn't built from the request's host", async () => {
    await mailbox();
    await ask();
    const response = await post(`/api/sign-ups/${await idAsked()}/accept`, await job(), await signIn("admin"), {
      host: "evil.test",
      origin: "https://evil.test",
      "x-forwarded-host": "evil.test",
    });
    expect(response.status).toBe(200);
    expect(outbox[0]?.text).not.toContain("evil.test");
  });

  it("without a mailbox: accepted, said as not sent, the link to pass on", async () => {
    const { sent } = await accepted();
    expect(sent.emailed).toBe(false);
    expect(sent.problem).toMatch(/No mailbox/);
    expect(sent.link).toContain("/welcome#");
    expect(await person(EMAIL)).toBeDefined();
  });

  it("failed: accepted, said as not sent; sending again works and ends the first link", async () => {
    await mailbox();
    failing = true;
    const { sent, token } = await accepted();
    expect(sent.emailed).toBe(false);
    expect(sent.problem).toMatch(/didn't go/);
    failing = false;
    const again = await post(`/api/sign-ups/${await idAsked()}/resend`, {}, await signIn("admin"));
    expect(await again.json()).toMatchObject({ emailed: true, link: null });
    expect((await setPassword(token)).status).toBe(409);
    const fresh = /welcome#(\S+)/.exec(outbox[0]?.text ?? "")?.[1] as string;
    expect((await setPassword(fresh)).status).toBe(200);
  });

  it("keeps only the link's hash", async () => {
    const { token } = await accepted();
    expect(JSON.stringify(await rows(db, sql`select * from sign_up`))).not.toContain(token);
  });
});

describe("the link", () => {
  it("nobody in until it sets the password; then their department", async () => {
    const { token } = await accepted();
    expect((await errorOf(await login(EMAIL, OWN)))?.code).toBe("password_pending");
    const info = (await (await post("/api/auth/welcome", { token })).json()) as WelcomeInfo;
    expect(info).toMatchObject({ firstName: "Liza", email: EMAIL, department: "finance" });
    const set = await setPassword(token);
    expect(set.status).toBe(200);
    expect(set.headers.getSetCookie()).toEqual([]);
    const entered = await login(EMAIL, OWN, { workspace: "finance" });
    expect(entered.status).toBe(200);
    const cookie = cookiesOf(entered);
    const me = ((await (await get("/api/me", cookie)).json()) as { me: Me }).me;
    expect(me).toMatchObject({ name: "Liza M. Reyes", role: "finance", mustChangePassword: false });
    expect((await get("/api/me/profile", cookie)).status).toBe(200);
    expect((await get("/api/sign-ups", cookie)).status).toBe(403);
    expect((await login(info.seatLogin as string, OWN)).status).toBe(200);
  });

  it("looking at it doesn't use it up", async () => {
    const { token } = await accepted();
    for (let i = 0; i < 3; i += 1) expect((await post("/api/auth/welcome", { token })).status).toBe(200);
    expect((await setPassword(token)).status).toBe(200);
  });

  it("a weak password doesn't use it up", async () => {
    const { token } = await accepted();
    expect((await errorOf(await setPassword(token, "short")))?.field).toBe("password");
    expect((await setPassword(token)).status).toBe(200);
  });

  it("works once, ten at the same moment too", async () => {
    const { token } = await accepted();
    const answers = await Promise.all(Array.from({ length: 10 }, (_, i) => setPassword(token, `own-words-number-${i}`)));
    expect(answers.filter((response) => response.status === 200)).toHaveLength(1);
    expect((await setPassword(token, "someone-elses-words")).status).toBe(409);
  });

  it("ends after three days", async () => {
    const { token } = await accepted();
    await db.execute(sql`update sign_up set link_expires_at = now() - interval '1 second'`);
    expect((await post("/api/auth/welcome", { token })).status).toBe(409);
    expect((await setPassword(token)).status).toBe(409);
  });

  it("ends when a password is given meanwhile", async () => {
    const { token } = await accepted();
    const who = await person(EMAIL);
    expect((await post(`/api/org/people/${who?.id}/password`, {}, await signIn("admin"))).status).toBe(200);
    expect((await setPassword(token)).status).toBe(409);
  });

  it("ends when they leave", async () => {
    const { token } = await accepted();
    await db.execute(sql`update person set active = false where email = ${EMAIL}`);
    expect((await setPassword(token)).status).toBe(409);
  });

  it("ends when the email is corrected: the wrong inbox's link is dead", async () => {
    const { token } = await accepted();
    await db.execute(sql`update person set email = 'the.right@example.com' where email = ${EMAIL}`);
    expect((await setPassword(token)).status).toBe(409);
    expect((await post(`/api/sign-ups/${await idAsked()}/resend`, {}, await signIn("admin"))).status).toBe(409);
  });

  it("a made-up one opens nothing", async () => {
    await accepted();
    expect((await setPassword("x".repeat(43))).status).toBe(409);
    expect((await person("naresh@2mg.test"))?.pending).toBe(false);
  });

  it("isn't sent again once used", async () => {
    const { token } = await accepted();
    await setPassword(token);
    expect((await post(`/api/sign-ups/${await idAsked()}/resend`, {}, await signIn("admin"))).status).toBe(409);
  });

  it("leaves the data checks green", async () => {
    const { token } = await accepted();
    await setPassword(token);
    expect((await runChecks(db)).checks.filter((check) => !check.ok)).toEqual([]);
  });
});
