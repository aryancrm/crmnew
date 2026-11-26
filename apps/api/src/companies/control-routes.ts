// Bishnoi One's control panel (/control on the website): the companies on the server, added,
// changed, paused and resumed, and their Admin given a new one-time password. Only for the people
// who run Bishnoi One, on logins of its own: a short login ID (no email), their own password and,
// every time, the code from the authenticator app on their phone (Aryan, 26 Nov 2026). A panel
// login is not a login of any company: it never clashes with one, and it opens no company's data.
//
// The first panel login is made with the setup key the server writes in its log on start while
// there is none (whoever can read the server's log runs the server); after that, never again.

import { createHash, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { secureHeaders } from "hono/secure-headers";
import { z } from "zod";
import { hashPassword, passwordMatches, passwordProblem } from "../auth/password";
import { newKey, setupUri, stepOfCode } from "../auth/totp";
import { type Database, rows } from "../db/index";
import { readBody, Refusal } from "../http";
import { seal, unseal } from "../online/secrets";
import type { CompanyList } from "./registry";

export const CONTROL_COOKIE = "bo_control";
const SESSION_HOURS = 12;
const TRIES = 5;
const LOCK_MINUTES = 15;
const SETUP_MINUTES = 15;
const LOGIN_ID = /^[a-z0-9][a-z0-9._-]{1,31}$/;

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

type ControlEnv = { Variables: { controlId: number } };
type PanelPerson = {
  id: number;
  loginId: string;
  name: string;
  passwordHash: string;
  totpSealed: string;
  totpStep: number | null;
  active: boolean;
  failedTries: number;
  /** Locked for a while after too many wrong tries (worked out by the database's clock). */
  locked: boolean;
};

const PERSON = sql`id::int as id, login_id as "loginId", name, password_hash as "passwordHash",
  totp_sealed as "totpSealed", totp_step::int as "totpStep", active, failed_tries as "failedTries",
  coalesce(locked_until > now(), false) as locked`;

/** A key sealed with the code's own local key would protect nothing on a real server. */
function canSeal(): void {
  if (!process.env.SECRETS_KEY && (process.env.NODE_ENV === "production" || process.env.DATABASE_URL))
    throw new Refusal(409, "not_ready", "The control panel isn't ready on this server yet: SECRETS_KEY needs to be set.");
}

export function controlRoutes(control: Database, list: CompanyList, options: { secure: boolean }) {
  const app = new Hono<ControlEnv>();
  app.use("/api/control/*", secureHeaders());

  // ---- The first panel login: the setup key from the server's log ----
  let setupKey: string | null = null;
  let setupWrong = { tries: 0, until: 0 };
  /** Waiting for the first code from the phone: ticket → the new login. */
  const waiting = new Map<string, { personId: number; until: number }>();

  async function anyActive(): Promise<boolean> {
    const [found] = await rows(control, sql`select 1 as one from control_person where active limit 1`);
    return !!found;
  }

  /** Written in the log while nobody can sign in to the panel (on start, and checked again here). */
  async function announceSetup(): Promise<string | null> {
    if (await anyActive()) {
      setupKey = null;
      return null;
    }
    setupKey ??= randomBytes(12).toString("base64url");
    console.log(
      `control panel: no panel login yet. Open /control on the website and use this setup key to make the first one: ${setupKey}`,
    );
    return setupKey;
  }

  async function startSession(c: Context<ControlEnv>, personId: number): Promise<void> {
    const token = randomBytes(32).toString("base64url");
    await control.execute(
      sql`insert into control_session (token_hash, person_id, expires_at)
        values (${sha(token)}, ${personId}, now() + make_interval(hours => ${SESSION_HOURS}))`,
    );
    await control.execute(
      sql`update control_person set last_sign_in_at = now(), failed_tries = 0, locked_until = null where id = ${personId}`,
    );
    setCookie(c, CONTROL_COOKIE, token, {
      httpOnly: true,
      secure: options.secure,
      sameSite: "Strict",
      path: "/api/control",
      maxAge: SESSION_HOURS * 60 * 60,
    });
  }

  /** The code from the phone, right and not used before; the step it was for is kept. */
  async function codeRight(person: PanelPerson, code: string): Promise<boolean> {
    let key: string;
    try {
      key = unseal(person.totpSealed);
    } catch {
      throw new Refusal(409, "unreadable", "This login's phone code can't be read on this server (its SECRETS_KEY changed).");
    }
    const step = stepOfCode(key, code.replace(/\s/g, ""));
    if (step === null || (person.totpStep !== null && step <= person.totpStep)) return false;
    await control.execute(sql`update control_person set totp_step = ${step} where id = ${person.id}`);
    return true;
  }

  const signedIn = async (c: Context<ControlEnv>, next: () => Promise<void>) => {
    const token = getCookie(c, CONTROL_COOKIE);
    const [found] = token
      ? await rows<{ id: number }>(
          control,
          sql`select p.id::int as id from control_session s join control_person p on p.id = s.person_id
            where s.token_hash = ${sha(token)} and s.expires_at > now() and p.active`,
        )
      : [];
    if (!found) throw new Refusal(401, "signed_out", "Sign in to the control panel.");
    c.set("controlId", found.id);
    await next();
  };

  app.onError((error, c) => {
    if (error instanceof Refusal)
      return c.json(
        { error: { code: error.code, message: error.message, ...(error.field ? { field: error.field } : {}), ...(error.fields ? { fields: error.fields } : {}) } },
        error.status,
      );
    console.error("[control]", error);
    return c.json({ error: { code: "internal", message: "Something went wrong on the server." } }, 500);
  });

  // ---- Who is here ----
  app.get("/api/control/me", async (c) => {
    c.header("cache-control", "no-store");
    const token = getCookie(c, CONTROL_COOKIE);
    const [me] = token
      ? await rows<{ loginId: string; name: string }>(
          control,
          sql`select p.login_id as "loginId", p.name from control_session s join control_person p on p.id = s.person_id
            where s.token_hash = ${sha(token)} and s.expires_at > now() and p.active`,
        )
      : [];
    return c.json({ me: me ?? null, setup: !(await anyActive()) });
  });

  // ---- The first panel login ----
  app.post("/api/control/setup", async (c) => {
    const input = await readBody(
      c,
      z.object({
        key: z.string().trim().min(1, "Type the setup key from the server's log.").max(100),
        loginId: z.string().trim().toLowerCase().regex(LOGIN_ID, "2 to 32 small letters, digits, dots or dashes, starting with a letter or digit."),
        name: z.string().trim().min(1, "Type your name.").max(80),
        // Aryan, 26 Nov: "the normal 6 or 8, not 12".
        password: z.string().min(8, "Use at least 8 characters.").max(200),
      }),
    );
    if (await anyActive()) throw new Refusal(409, "done", "The control panel is set up already: sign in.");
    canSeal();
    if (Date.now() < setupWrong.until) throw new Refusal(429, "locked", "Too many wrong setup keys. Try again in 15 minutes.");
    if (!setupKey || input.key !== setupKey) {
      setupWrong = { tries: setupWrong.tries + 1, until: setupWrong.tries + 1 >= TRIES ? Date.now() + LOCK_MINUTES * 60_000 : 0 };
      if (setupWrong.until) setupWrong.tries = 0;
      throw new Refusal(400, "wrong_key", "That isn't the setup key in the server's log.", "key");
    }
    const problem = passwordProblem(input.password);
    if (problem) throw new Refusal(400, "invalid", problem, "password");
    const key = newKey();
    // An earlier setup that never got its first code is replaced.
    await control.execute(sql`delete from control_person where not active and login_id = ${input.loginId}`);
    const [made] = await rows<{ id: number }>(
      control,
      sql`insert into control_person (login_id, name, password_hash, totp_sealed)
        values (${input.loginId}, ${input.name}, ${await hashPassword(input.password)}, ${seal(key)})
        returning id::int as id`,
    );
    const ticket = randomBytes(24).toString("base64url");
    waiting.set(ticket, { personId: made?.id as number, until: Date.now() + SETUP_MINUTES * 60_000 });
    c.header("cache-control", "no-store");
    return c.json({ ticket, key, uri: setupUri(input.loginId, key, "Bishnoi One control") });
  });

  app.post("/api/control/setup/code", async (c) => {
    const input = await readBody(c, z.object({ ticket: z.string().min(10).max(100), code: z.string().trim().min(6, "Type the 6-digit code.").max(12) }));
    const wait = waiting.get(input.ticket);
    if (!wait || wait.until < Date.now()) throw new Refusal(400, "expired", "This setup took too long. Start again.");
    const [person] = await rows<PanelPerson>(control, sql`select ${PERSON} from control_person where id = ${wait.personId}`);
    if (!person || person.active) throw new Refusal(400, "expired", "Start again.");
    if (await anyActive()) throw new Refusal(409, "done", "The control panel is set up already: sign in.");
    if (!(await codeRight(person, input.code)))
      throw new Refusal(400, "wrong_code", "That code isn't right. Check the phone's time and type the newest code.", "code");
    await control.execute(sql`update control_person set active = true where id = ${person.id}`);
    waiting.delete(input.ticket);
    setupKey = null;
    await list.event(person.id, null, "panel_login_made", { loginId: person.loginId });
    await startSession(c, person.id);
    return c.json({ me: { loginId: person.loginId, name: person.name } });
  });

  // ---- Signing in: login ID, password and the code from the phone, all three every time ----
  app.post("/api/control/login", async (c) => {
    const input = await readBody(
      c,
      z.object({
        loginId: z.string().trim().toLowerCase().min(1, "Type your login ID.").max(40),
        password: z.string().min(1, "Type your password.").max(200),
        code: z.string().trim().min(6, "Type the 6-digit code from your phone.").max(12),
      }),
    );
    const wrong = new Refusal(401, "wrong_login", "Wrong login ID, password or code.");
    const [person] = await rows<PanelPerson>(control, sql`select ${PERSON} from control_person where login_id = ${input.loginId}`);
    if (!person?.active) {
      // As long as a real check, so a wrong ID can't be told from a wrong password.
      await passwordMatches(input.password, "scrypt$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA").catch(() => false);
      throw wrong;
    }
    if (person.locked)
      throw new Refusal(429, "locked", `Too many wrong tries. Try again after ${LOCK_MINUTES} minutes.`);
    // The try is counted before it is checked: tries sent together can't beat the lock.
    const [counted] = await rows<{ tries: number }>(
      control,
      sql`update control_person set failed_tries = failed_tries + 1,
          locked_until = case when failed_tries + 1 >= ${TRIES} then now() + make_interval(mins => ${LOCK_MINUTES}) else locked_until end
        where id = ${person.id} returning failed_tries as tries`,
    );
    if ((counted?.tries ?? 0) > TRIES) throw new Refusal(429, "locked", `Too many wrong tries. Try again after ${LOCK_MINUTES} minutes.`);
    if (!(await passwordMatches(input.password, person.passwordHash))) throw wrong;
    if (!(await codeRight(person, input.code))) throw wrong;
    await startSession(c, person.id);
    await list.event(person.id, null, "signed_in");
    return c.json({ me: { loginId: person.loginId, name: person.name } });
  });

  app.post("/api/control/logout", async (c) => {
    const token = getCookie(c, CONTROL_COOKIE);
    if (token) await control.execute(sql`delete from control_session where token_hash = ${sha(token)}`);
    deleteCookie(c, CONTROL_COOKIE, { path: "/api/control" });
    return c.json({ ok: true });
  });

  // ---- The companies ----
  app.get("/api/control/companies", signedIn, async (c) => {
    c.header("cache-control", "no-store");
    const all = await list.rows();
    const out = [];
    for (const row of all) {
      const one = list.byOrgId(row.orgId);
      let people: number | null = null;
      let loginId: string | null = null;
      if (one) {
        const [counted] = await rows<{ n: number }>(one.db, sql`select count(*)::int as n from person where active`);
        people = counted?.n ?? 0;
        loginId = (await list.adminOf(one))?.login ?? null;
      }
      out.push({
        orgId: row.orgId,
        name: row.name,
        code: row.code,
        loginDomain: row.loginDomain,
        home: row.database === null,
        pausedAt: row.pausedAt,
        pausedReason: row.pausedReason,
        createdAt: row.createdAt,
        running: !!one,
        problem: list.brokenWhy(row.orgId),
        people,
        loginId,
      });
    }
    return c.json({ companies: out });
  });

  app.post("/api/control/companies", signedIn, async (c) => {
    const input = await readBody(
      c,
      z.object({
        name: z.string().trim().min(1, "Give the company's name.").max(120),
        code: z.string().trim().toUpperCase().min(2, "2 to 8 capital letters or digits, like GM.").max(8, "2 to 8 capital letters or digits, like GM."),
        loginId: z.string().trim().toLowerCase().min(3, "Type its login ID, like info@getmeds.ph.").max(120),
        copyStockFrom: z.string().trim().regex(/^[1-9][0-9]{5}$/).nullable().optional(),
      }),
    );
    const made = await list.add(input, c.get("controlId"));
    c.header("cache-control", "no-store");
    return c.json({
      orgId: made.company.ref.orgId,
      name: made.company.ref.name,
      loginId: made.loginId,
      password: made.password,
      stock: made.stock,
    });
  });

  app.patch("/api/control/companies/:orgId", signedIn, async (c) => {
    const input = await readBody(
      c,
      z.object({
        name: z.string().trim().min(1).max(120).optional(),
        code: z.string().trim().toUpperCase().optional(),
        loginId: z.string().trim().toLowerCase().max(120).optional(),
      }),
    );
    const one = await list.change((c.req.param("orgId") ?? ""), input, c.get("controlId"));
    return c.json({ orgId: one.ref.orgId, name: one.ref.name, code: one.ref.code, loginId: (await list.adminOf(one))?.login ?? null });
  });

  app.post("/api/control/companies/:orgId/pause", signedIn, async (c) => {
    const input = await readBody(c, z.object({ reason: z.string().trim().max(300).default("") }));
    await list.pause((c.req.param("orgId") ?? ""), input.reason, c.get("controlId"));
    return c.json({ ok: true });
  });

  app.post("/api/control/companies/:orgId/resume", signedIn, async (c) => {
    await list.resume((c.req.param("orgId") ?? ""), c.get("controlId"));
    return c.json({ ok: true });
  });

  app.post("/api/control/companies/:orgId/admin-password", signedIn, async (c) => {
    const given = await list.newAdminPassword((c.req.param("orgId") ?? ""), c.get("controlId"));
    c.header("cache-control", "no-store");
    return c.json(given);
  });

  app.get("/api/control/events", signedIn, async (c) => {
    const orgId = c.req.query("company") ?? null;
    const found = await rows(
      control,
      sql`select e.id::int as id, e.at, e.what, e.detail, p.name as "by", co.name as company, co.org_id as "orgId"
        from control_event e left join control_person p on p.id = e.person_id left join company co on co.id = e.company_id
        where (${orgId}::text is null or co.org_id = ${orgId})
        order by e.at desc, e.id desc limit 100`,
    );
    return c.json({ events: found });
  });

  return { app, announceSetup };
}
