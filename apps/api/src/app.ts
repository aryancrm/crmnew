// The API. Every route answers JSON; every refusal is { error: { code, message, field? } }.

import { createMiddleware } from "hono/factory";
import { companyKey, companyNow, otherCompanies } from "./companies/context";
import { ORG_COOKIE } from "./companies/router";
import { decisionRoutes } from "./decisions/routes";
import { sampleRoutes } from "./samples/routes";
import { complaintRoutes } from "./complaints/routes";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { z } from "zod";
import { accountEvent } from "./account/events";
import { accountRoutes } from "./account/routes";
import { signUpRoutes } from "./account/sign-up-routes";
import { deviceCookie, deviceMark, passwordGuard } from "./auth/guard";
import { localOpenRoutes } from "./auth/local-open";
import { makeTicket, readTicket, spendTicket, twoStepOn, useCode } from "./auth/two-step";
import { hashPassword, passwordProblem } from "./auth/password";
import { ownWorkspace, WORKSPACE_KEYS, type WorkspaceKey, workspaceAllows, workspaceByKey } from "./auth/workspaces";
import type { Role } from "./people/roles";
import {
  BACK_COOKIE,
  DAY_SESSION_ROLES,
  MAX_ACCOUNTS,
  MORE_COOKIE,
  endOfWorkingDay,
  endOtherSessions,
  endSession,
  SESSION_COOKIE,
  SESSION_DAYS,
  sessionOf,
  startSession,
  whoIs,
} from "./auth/sessions";
import { checkRoutes } from "./checks/routes";
import { customerRoutes } from "./customers/routes";
import { countQueries, type Database, rows, uncounted } from "./db/index";
import { person } from "./db/schema";
import { dispatchRoutes } from "./dispatch/routes";
import { fieldRoutes } from "./field/routes";
import { financeRoutes } from "./finance/routes";
import { markSeen } from "./hr/attendance";
import { hrRoutes } from "./hr/routes";
import { mrRoutes } from "./mr/routes";
import { allow, type Env, idParam, Refusal, readBody, signedInWith } from "./http";
import { inventoryRoutes } from "./inventory/routes";
import { messageRoutes } from "./messages/routes";
import { notifyRoutes } from "./notify/routes";
import { channelRoutes } from "./online/channel-routes";
import { onlineRoutes } from "./online/routes";
import { orderRoutes } from "./orders/routes";
import { orgRoutes } from "./org/routes";
import { pickedUnit, teamIds } from "./org/scope";
import { ledUnits, personOfSeatLogin } from "./org/service";
import { overviewRoutes } from "./overview/routes";
import { pointsRoutes } from "./points/routes";
import { purchaseRoutes } from "./purchases/routes";
import { returnRoutes } from "./returns/routes";
import { salesRoutes } from "./sales/routes";
import { speedRoutes } from "./speed/routes";
import { b2bRoutes } from "./b2b/routes";
import { b2cRoutes } from "./b2c/routes";
import { clidpRoutes } from "./clidp/routes";
import { mtRoutes } from "./mt/routes";
import { workLogRoutes } from "./worklog/routes";
import { regulatoryRoutes } from "./regulatory/routes";
import { bookRoutes } from "./books/routes";
import { birRoutes } from "./bir/routes";
import { hospitalRoutes } from "./hospitals/routes";
import { telesalesRoutes } from "./telesales/routes";
import { tenderFinderDoor, tenderRoutes } from "./tenders/routes";
import { rxRoutes } from "./rx/routes";
import { scoreRoutes } from "./scores/routes";
import { kpiRoutes } from "./kpis/routes";
import { sellerRoutes } from "./sellers/routes";
import { targetRoutes } from "./targets/routes";
import { teamRoutes } from "./team/routes";
import { DUTY_DESKS, type DutyDesk, deskPerson, deskReport, deskStandIn, deskTeam, shareOut, shareOutAll, startPerson, takeFinanceOrder } from "./desks/service";
import { DESK_SCREENS, DESK_WORDS, deskPasswordRight, deskPasswordState } from "./auth/desk-password";
import { portalDepartment } from "./portal/service";
import type { ApiError, Me } from "./types";

export type AppOptions = {
  /** The web app's address: allowed to call with the cookie; https makes the cookie Secure. */
  webUrl: string;
  /** A developer's own computer: anyone opens without a password (auth/local-open.ts). */
  localOpen?: boolean;
};


const deskParam = (value: string): DutyDesk => {
  if (!DUTY_DESKS.includes(value as DutyDesk)) throw new Refusal(404, "not_found", "No such desk.");
  return value as DutyDesk;
};
// The proxy's own limit (nginx: 50 MB, for photos and papers) holds without the proxy too.
const MB = 1024 * 1024;
const atMost = (maxSize: number) =>
  bodyLimit({
    maxSize,
    onError: (c) =>
      c.json({ error: { code: "too_large", message: "That is too large to send." } } satisfies ApiError, 413),
  });

/** An answer slower than this (on the server) is noted for the Admin's Slow screens page. */
const SLOW_MS = 800;

/** What a desk's shared screen may not open (Aryan, 19 Nov: "no Me, no payslips on the common
 *  screen"): a person's own leave, forms, payslips, documents, day, numbers, messages, profile,
 *  picture, password, two-step, sessions and accounts, and looking as someone. */
const DESK_SCREEN_REFUSES =
  /^\/api\/(?:auth\/(?:password|two-step|sessions|accounts|switch|view)|me\/|messages|hr\/|kpis\/me|mr\/me)/;

export function createApp(db: Database, options: AppOptions) {
  const app = new Hono<Env>();
  const secure = options.webUrl.startsWith("https://");
  const passwordRight = passwordGuard(db);

  // Time and query count on every response: how a slow screen is found.
  app.use("*", async (c, next) => {
    const started = performance.now();
    const { queries } = await countQueries(next, c.req.method === "GET");
    const ms = (performance.now() - started).toFixed(1);
    c.header("Server-Timing", `app;dur=${ms}, db;desc="${queries} queries"`);
    // A slow answer is noted (address by its pattern, never the ids in it), so the Admin's Slow
    // screens page shows what is slow online, where the database and the server are smaller than a
    // developer's computer. Never waited for; a failure to note is nothing.
    if (Number(ms) >= SLOW_MS && c.req.path.startsWith("/api/")) {
      const path = (c.req.routePath && c.req.routePath !== "/api/*" && c.req.routePath !== "*" ? c.req.routePath : c.req.path.replace(/\/\d+(?=\/|$)/g, "/:id")).slice(0, 200);
      const role = (c.get("me") as { role?: string } | undefined)?.role ?? null;
      void uncounted(async () => {
        await db.execute(sql`insert into slow_request (method, path, ms, queries, role) values (${c.req.method}, ${path}, ${Math.round(Number(ms))}, ${queries}, ${role})`);
        if (Math.random() < 0.02) await db.execute(sql`delete from slow_request where at < now() - interval '14 days'`);
      }).catch(() => {});
    }
  });

  app.use("*", secureHeaders());
  app.use("/api/*", cors({ origin: options.webUrl, credentials: true }));
  app.use("/api/auth/*", atMost(16 * 1024));
  app.use("/api/*", atMost(50 * MB));
  // A webhook is small, but for the tender papers the robot hands in (bid documents, tens of MB).
  const small = atMost(2 * MB);
  const paper = atMost(60 * MB);
  // (and the robot's own records: one Sync's lists and notices are several MB)
  const large = new Set(["/webhooks/tender-finder/papers/file", "/webhooks/tender-finder/store"]);
  app.use("/webhooks/*", (c, next) => (large.has(c.req.path) ? paper(c, next) : small(c, next)));

  app.onError((error, c) => {
    if (error instanceof Refusal) {
      const body: ApiError = {
        error: {
          code: error.code,
          message: error.message,
          ...(error.field ? { field: error.field } : {}),
          ...(error.fields ? { fields: error.fields } : {}),
        },
      };
      return c.json(body, error.status);
    }
    const reference = randomUUID().slice(0, 8);
    console.error(`[error ${reference}]`, error);
    const body: ApiError = {
      error: {
        code: "internal",
        message: `Something went wrong on the server (reference ${reference}).`,
      },
    };
    return c.json(body, 500);
  });

  app.notFound((c) =>
    c.json({ error: { code: "not_found", message: "No such address." } } satisfies ApiError, 404),
  );

  // Every signed-in request notes who is working (their day starts with the first one).
  // A desk's shared screen marks nobody present: it is nobody's own day.
  const signedInOnly = signedInWith(db, (me) => (me.deskScreen ? Promise.resolve() : markSeen(db, me)));
  // A lead's page reading one box of the team switch (?unit=): checked once here, then every
  // service's team is that box and what is under it (org/scope.ts).
  const signedIn = createMiddleware<Env>((c, next) =>
    signedInOnly(c, async () => {
      // A desk's shared screen (the desks' common password) does the desk's work only: nobody's
      // own leave, forms, payslips, documents, messages, profile or password on it, and what is
      // done on an order is written in the name of the person it was given to (desks/service.ts).
      const me = c.get("me");
      if (me.deskScreen) {
        if (DESK_SCREEN_REFUSES.test(c.req.path) && !(c.req.method === "GET" && c.req.path === "/api/auth/accounts"))
          throw new Refusal(403, "desk_screen", "This is the desk's shared screen. Sign in with your own ID for your own things.");
        const standIn = await deskStandIn(db, me, c.req.method, c.req.path);
        if (standIn) c.set("me", standIn);
      }
      const asked = c.req.method === "GET" ? c.req.query("unit") : undefined;
      if (asked) c.set("me", { ...c.get("me"), unit: await pickedUnit(db, c.get("me"), asked) });
      await next();
    }),
  );

  // Which code is running, where the host says (Render and Coolify name the commit they built):
  // the tender finder's workflow waits for its own commit before a run that follows a change.
  const commit = (process.env.RENDER_GIT_COMMIT || process.env.SOURCE_COMMIT || "").slice(0, 40) || null;
  app.get("/api/health", (c) => c.json({ ok: true, commit }));
  // Management's and Finance's waiting orders, each given to one of the desk's people: after
  // anything that may have moved an order, the new ones are shared out; the team on the screen.
  app.use("/api/*", async (c, next) => {
    await next();
    const me = c.get("me");
    if (me && c.req.method === "POST" && c.res.status < 300)
      await shareOutAll(db, me).catch((error) => console.error("[desk]", error));
  });
  app.get("/api/desk/:desk/team", signedIn, async (c) => {
    const desk = deskParam(c.req.param("desk"));
    const team = await deskTeam(db, c.get("me"), desk);
    // Opening the screen shares out anything still waiting for a name; not when someone is only
    // looking as this person (read only: nothing given out, nothing written in their name).
    if (team.unassigned && !c.get("me").viewedBy) {
      await shareOut(db, c.get("me"), desk);
      return c.json(await deskTeam(db, c.get("me"), desk));
    }
    return c.json(team);
  });
  app.get("/api/desk/:desk/report", signedIn, async (c) =>
    c.json(
      await deskReport(db, c.get("me"), deskParam(c.req.param("desk")), {
        from: c.req.query("from"),
        to: c.req.query("to"),
      }),
    ),
  );
  app.get("/api/desk/:desk/people/:id", signedIn, async (c) =>
    c.json(
      await deskPerson(db, c.get("me"), deskParam(c.req.param("desk")), idParam(c), {
        from: c.req.query("from"),
        to: c.req.query("to"),
      }),
    ),
  );
  app.post("/api/desk/:desk/people/:id/start", signedIn, async (c) => {
    const input = await readBody(c, z.object({ on: z.boolean() }));
    const desk = deskParam(c.req.param("desk"));
    // A person starts themselves, on their own login (the Admin may start anyone); anyone at the
    // desk may stop someone.
    if (input.on && (c.get("me").deskScreen || (c.get("me").role !== "admin" && c.get("me").id !== idParam(c))))
      throw new Refusal(403, "not_allowed", "Each person starts themselves, on their own login.");
    await startPerson(db, c.get("me"), desk, idParam(c), input.on);
    return c.json(await deskTeam(db, c.get("me"), desk));
  });
  app.post("/api/finance/orders/:id/take", signedIn, async (c) => {
    const input = await readBody(c, z.object({ release: z.boolean().default(false) }));
    await takeFinanceOrder(db, c.get("me"), idParam(c), input.release);
    return c.json({ ok: true });
  });

  // The company this browser signs in to, when the server has several (companies/router.ts): its
  // name for the sign-in page and the frame. Null with one company, as before 26 Nov 2026.
  app.get("/api/company", (c) => {
    const company = companyNow();
    return c.json({
      company: company ? { orgId: company.orgId, name: company.name, code: company.code, loginDomain: company.loginDomain } : null,
      // This browser is inside this company (Aryan, 27 Nov: "signing out of Management should leave
      // that app, not the company"): it signed in here, so the company's systems show again after
      // signing out of one, without the company's sign-in. "Sign out of the company" ends it.
      inside: company ? getCookie(c, ORG_COOKIE) === company.orgId : true,
    });
  });

  // A department's page on the portal, before signing in: counts, times and the team's seats only.
  app.get("/api/portal/departments/:key", async (c) =>
    c.json(await portalDepartment(db, c.req.param("key"))),
  );

  /** This browser is one of theirs from now on (auth/guard.ts). */
  const rememberDevice = (c: Context<Env>, who: { id: number; passwordHash: string }) =>
    setCookie(c, deviceCookie(who.id), deviceMark(who), {
      httpOnly: true,
      secure,
      sameSite: "Lax",
      path: "/api/auth",
      maxAge: 365 * 24 * 60 * 60,
    });

  // ---- More than one account on one browser (26 Nov: "like Google: add an account with its own
  // login, then switch"). The account in use is the session cookie; the others wait in MORE_COOKIE
  // (httpOnly, read only under /api/auth). Each was opened with its own login ID and password;
  // signing out signs every one of them out (a shared computer keeps nobody's). ----
  const TOKEN = /^[A-Za-z0-9_-]{20,100}$/;
  // With several companies each kept session says whose it is ("<Org ID>~<token>", 27 Nov: an account
  // of another company added): it is asked about in that company's database (companies/context.ts).
  type Kept = { org: string | null; token: string };
  const ENTRY = /^(?:(\d{6})~)?([A-Za-z0-9_-]{20,100})$/;
  const myOrg = () => companyNow()?.orgId ?? null;
  const mine = (one: Kept) => one.org === myOrg();
  const moreOf = (c: Context<Env>): Kept[] =>
    (getCookie(c, MORE_COOKIE) ?? "")
      .split(",")
      .map((one) => ENTRY.exec(one))
      .filter((one): one is RegExpExecArray => Boolean(one))
      .map((one) => ({ org: one[1] ?? myOrg(), token: one[2] as string }));
  const keepMore = (c: Context<Env>, kept: Kept[]) =>
    kept.length
      ? setCookie(c, MORE_COOKIE, kept.map((one) => (one.org ? `${one.org}~${one.token}` : one.token)).join(","), {
          httpOnly: true,
          secure,
          sameSite: "Lax",
          path: "/api/auth",
          maxAge: SESSION_DAYS * 24 * 60 * 60,
        })
      : deleteCookie(c, MORE_COOKIE, { path: "/api/auth" });
  const useSession = (c: Context<Env>, token: string) =>
    setCookie(c, SESSION_COOKIE, token, { httpOnly: true, secure, sameSite: "Lax", path: "/", maxAge: SESSION_DAYS * 24 * 60 * 60 });
  /** This browser becomes that company's (switching to an account of another company). */
  const useOrg = (c: Context<Env>, org: string | null) => {
    if (org) setCookie(c, ORG_COOKIE, org, { httpOnly: true, secure, sameSite: "Lax", path: "/", maxAge: 365 * 24 * 60 * 60 });
  };
  const endKept = async (one: Kept) => {
    if (mine(one)) await endSession(db, one.token);
    else if (one.org) await otherCompanies()?.end(one.org, one.token);
  };
  const whoKept = async (one: Kept): Promise<Me | null> =>
    mine(one) ? whoIs(db, one.token) : one.org ? ((await otherCompanies()?.whoIs(one.org, one.token)) ?? null) : null;
  /** The session in use, and whose it is: a sign-in on this company may come from a browser whose
   *  account in use was another company's. */
  const currentKept = (c: Context<Env>): Kept | null => {
    const token = getCookie(c, SESSION_COOKIE);
    if (!token || !TOKEN.test(token)) return null;
    const remembered = getCookie(c, ORG_COOKIE) ?? null;
    return { org: myOrg() && remembered && /^\d{6}$/.test(remembered) ? remembered : myOrg(), token };
  };

  /** The end of every sign-in, with or without a code. `add`: kept beside the account in use. */
  async function letIn(c: Context<Env>, found: typeof person.$inferSelect, workspace: string | null, add = false) {
    // A password changed or a person switched off while this one was being checked: not signed in.
    const still = await db
      .update(person)
      .set({ lastSignInAt: new Date() })
      .where(
        and(
          eq(person.id, found.id),
          eq(person.passwordHash, found.passwordHash),
          eq(person.active, true),
          eq(person.passwordPending, false),
        ),
      )
      .returning({ id: person.id });
    if (!still.length) throw new Refusal(401, "wrong_login", "Wrong login ID or password.");

    const role = found.role as Role;
    // The accounts already on this browser: kept beside the new one when it is added (each still
    // good, never twice), else signed out, so a plain sign-in starts this browser afresh.
    const current = currentKept(c);
    const earlier = [...(current ? [current] : []), ...moreOf(c)];
    const kept: Kept[] = [];
    for (const one of earlier) {
      const room = kept.length < MAX_ACCOUNTS - 1 && !kept.some((other) => other.token === one.token);
      // Another company's account: kept as it is (its own company tells whether it is still good).
      if (add && !mine(one)) {
        if (room) kept.push(one);
        else await endKept(one);
        continue;
      }
      const held = add ? await sessionOf(db, one.token) : null;
      if (held && !held.viewedBy && held.personId !== found.id && room) kept.push(one);
      else await endKept(one);
    }
    const until = DAY_SESSION_ROLES.includes(role) ? endOfWorkingDay() : undefined;
    const token = await startSession(db, found.id, undefined, workspace ?? ownWorkspace(role)?.key ?? null, until);
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      secure,
      sameSite: "Lax",
      path: "/",
      ...(until ? { expires: until } : { maxAge: SESSION_DAYS * 24 * 60 * 60 }),
    });
    // An earlier "look as" of whoever used this browser before isn't this person's.
    deleteCookie(c, BACK_COOKIE, { path: "/" });
    keepMore(c, kept);
    rememberDevice(c, found);
    return c.json({ me: await whoIs(db, token) });
  }

  // ---- A desk's shared screen (Aryan, 19 Nov; back on 27 Nov: "Management, Finance and Dispatch had
  // a common password only, bring it back"). The desks' password, set by the company's Admin in the
  // Admin panel, opens Management's, Finance's or Dispatch's screen alone, as the desk's lead seat;
  // each person's own login stays theirs. Five wrong passwords close that desk's screen for 15
  // minutes, never anyone's own login. It lasts until the end of the working day. ----
  const deskTries = new Map<string, { wrong: number; until: number }>();
  app.get("/api/auth/desk", async (c) => c.json({ on: (await deskPasswordState(db)).on }));
  app.post("/api/auth/desk", async (c) => {
    const input = await readBody(
      c,
      z.object({
        desk: z.enum(DESK_SCREENS, { error: "Pick the desk." }),
        password: z.string().min(1, "Type the password.").max(200),
      }),
    );
    const words = DESK_WORDS[input.desk];
    if (!(await deskPasswordState(db)).on)
      throw new Refusal(409, "desk_off", `${words}'s desk screen isn't open: sign in with your own ID.`, "password");
    const key = companyKey(`desk:${input.desk}`);
    const now = Date.now();
    const before = deskTries.get(key);
    if (before && before.until > now) {
      const minutes = Math.ceil((before.until - now) / 60000);
      throw new Refusal(429, "locked", `Too many wrong passwords on ${words}'s desk screen. Try again in ${minutes} minutes, or sign in with your own ID.`, "password");
    }
    // Counted before it is checked, so tries sent together can't slip past the lock.
    const wrong = (before && before.until === 0 ? before.wrong : 0) + 1;
    deskTries.set(key, wrong >= 5 ? { wrong: 0, until: now + 15 * 60 * 1000 } : { wrong, until: 0 });
    if (!(await deskPasswordRight(db, input.password))) throw new Refusal(401, "wrong_login", "Wrong password.", "password");
    deskTries.delete(key);

    // The desk's lead seat today, else whoever works at the desk: the screen opens as them, in the
    // desk's name.
    const [found] = await rows<{ personId: number }>(
      db,
      sql`select p.id::int as "personId" from person p
        left join seat_holder h on h.person_id = p.id and h.kind = 'holder' and h.starts_on <= (now() at time zone 'Asia/Manila')::date
          and (h.ends_on is null or h.ends_on >= (now() at time zone 'Asia/Manila')::date)
        left join seat s on s.id = h.seat_id and s.active and s.module = ${input.desk}
        where p.active and p.role = ${input.desk}
        order by (s.id is not null) desc, s.lead desc nulls last, s.sort nulls last, s.id nulls last, p.id limit 1`,
    );
    if (!found) throw new Refusal(409, "no_seat", `Nobody works at ${words} yet. Ask the administrator.`, "password");
    // A desk's screen starts this browser afresh, as a plain sign-in does.
    const current = currentKept(c);
    for (const one of [...(current ? [current] : []), ...moreOf(c)]) await endKept(one);
    const until = endOfWorkingDay();
    const token = await startSession(db, found.personId, undefined, input.desk, until, input.desk);
    setCookie(c, SESSION_COOKIE, token, { httpOnly: true, secure, sameSite: "Lax", path: "/", expires: until });
    deleteCookie(c, BACK_COOKIE, { path: "/" });
    keepMore(c, []);
    return c.json({ me: await whoIs(db, token) });
  });

  // The one way in: a person's own login ID and their own password (and, for whoever turned on
  // two-step sign-in, their code). It opens one session, theirs, good in every app their role has;
  // what they may do is checked on each call.
  app.post("/api/auth/login", async (c) => {
    const input = await readBody(
      c,
      z.object({
        email: z.string().trim().min(1, "Type your login ID.").max(200),
        password: z.string().min(1, "Type your password.").max(200),
        // The department page signed in at. The web app always sends it; without it the session
        // is opened for the login's own department.
        workspace: z.enum(WORKSPACE_KEYS, { error: "Pick the department." }).optional(),
        // Add another account: this browser keeps the one in use beside it, to switch between.
        add: z.boolean().optional(),
      }),
    );
    const wrong = new Refusal(401, "wrong_login", "Wrong login ID or password.");
    if (input.add && getCookie(c, BACK_COOKIE))
      throw new Refusal(400, "invalid", "Go back to your own screens before adding an account.");
    // A seat's login ID (hos1, tl2@2mginc.com) signs in whoever holds the seat today.
    const seatHolder = await personOfSeatLogin(db, input.email);
    const [found] = await db
      .select()
      .from(person)
      .where(
        seatHolder
          ? eq(person.id, seatHolder)
          : eq(sql`lower(${person.email})`, input.email.toLowerCase()),
      )
      .limit(1);
    if (!found?.active) throw wrong;
    // Said before any password is checked, so this is no way to test the company's old one.
    if (found.passwordPending)
      throw new Refusal(
        403,
        "password_pending",
        "This login has no password yet. Use the link in your acceptance email, or ask your administrator for a one-time password.",
        "email",
      );
    if (!(await passwordRight(found, input.password, getCookie(c, deviceCookie(found.id))))) throw wrong;

    // Checked only after the password is right, so a wrong page never tells a stranger whose login
    // it is. A right password on the wrong department isn't a wrong try: it opens nothing.
    const role = found.role as Role;
    const own = ownWorkspace(role);
    const workspace = input.workspace;
    if (workspace && !workspaceAllows(workspace, role))
      throw new Refusal(
        403,
        "wrong_department",
        `This login has no access to ${workspaceByKey(workspace)?.label ?? "this department"}.${own ? ` Sign in on the ${own.label} page.` : ""}`,
        "email",
      );

    // Two-step sign-in: the password was right; the session waits for the code.
    if (await twoStepOn(db, found.id)) {
      const ticket = await makeTicket(db, found, workspace ?? null);
      c.header("cache-control", "no-store");
      return c.json({ twoStep: true, ticket });
    }
    return letIn(c, found, workspace ?? null, input.add ?? false);
  });

  // The second step: the code from their app, or a recovery code, for the ticket the password got.
  app.post("/api/auth/login/code", async (c) => {
    const input = await readBody(
      c,
      z.object({
        ticket: z.string().min(20).max(100),
        code: z.string().trim().min(6, "Enter the code.").max(24),
        add: z.boolean().optional(),
      }),
    );
    const waiting = await readTicket(db, input.ticket);
    await useCode(db, waiting.personId, input.code);
    await spendTicket(db, input.ticket);
    const [found] = await db.select().from(person).where(eq(person.id, waiting.personId)).limit(1);
    const workspace = waiting.workspace as WorkspaceKey | null;
    // A new password or another role since the password step: start again.
    if (!found || found.passwordHash !== waiting.passwordHash || (workspace && !workspaceAllows(workspace, found.role as Role)))
      throw new Refusal(401, "sign_in_again", "Your account changed meanwhile. Sign in again.");
    return letIn(c, found, workspace, input.add ?? false);
  });

  // Signing out signs out every account on this browser.
  app.post("/api/auth/logout", async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) await endSession(db, token);
    for (const one of moreOf(c)) await endKept(one);
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    deleteCookie(c, MORE_COOKIE, { path: "/api/auth" });
    return c.json({ ok: true });
  });

  // Signing out of the company itself (27 Nov): every account on this browser, and the company it
  // remembers, so the next person starts at "Sign in to your company".
  app.post("/api/auth/leave-company", async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) await endSession(db, token);
    for (const one of moreOf(c)) await endKept(one);
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    deleteCookie(c, MORE_COOKIE, { path: "/api/auth" });
    deleteCookie(c, ORG_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  // The accounts on this browser: the one in use first, then the others still signed in, whichever
  // company each is (27 Nov). Each is known by its key: "<Org ID>:<person>" (a person's number is
  // only theirs inside their own company).
  const keyOf = (org: string | null, personId: number) => `${org ?? ""}:${personId}`;
  const accountsBody = z.object({ key: z.string().max(40).optional(), personId: z.number().int().positive().optional() });
  /** The key asked about: the key, else (the screen before 27 Nov) a person of this company. */
  const askedKey = (body: z.infer<typeof accountsBody>) => body.key ?? (body.personId ? keyOf(myOrg(), body.personId) : "");
  const keptWithWho = async (c: Context<Env>, me: Me) => {
    const out: { kept: Kept; who: Me }[] = [];
    for (const one of moreOf(c)) {
      const who = await whoKept(one);
      if (who && !who.viewedBy && !(mine(one) && who.id === me.id)) out.push({ kept: one, who });
    }
    return out;
  };

  app.get("/api/auth/accounts", signedIn, async (c) => {
    const me = c.get("me");
    const others = await keptWithWho(c, me);
    keepMore(c, others.map((one) => one.kept));
    const row = (who: Me, org: string | null, current: boolean) => ({
      key: keyOf(org, who.id),
      id: who.id,
      name: who.name,
      email: who.email,
      title: who.title,
      roleLabel: who.roleLabel,
      photo: who.photo ?? null,
      company: org ? (mine({ org, token: "" }) ? (companyNow()?.code ?? null) : (otherCompanies()?.code(org) ?? null)) : null,
      current,
    });
    return c.json({
      accounts: [row(me, myOrg(), true), ...others.map((one) => row(one.who, one.kept.org, false))],
      max: MAX_ACCOUNTS,
    });
  });

  // Remove one account from this browser (27 Nov: "be able to remove them also"): it is signed out
  // on the server too. Removing the one in use opens the next one kept here, else signs out.
  app.post("/api/auth/accounts/remove", signedIn, async (c) => {
    const me = c.get("me");
    if (me.viewedBy) throw new Refusal(400, "invalid", "Go back to your own screens first.");
    const key = askedKey(await readBody(c, accountsBody));
    const others = await keptWithWho(c, me);
    if (key === keyOf(myOrg(), me.id)) {
      await endSession(db, c.get("token"));
      const [next, ...rest] = others;
      if (next) {
        keepMore(c, rest.map((one) => one.kept));
        useSession(c, next.kept.token);
        useOrg(c, next.kept.org);
        return c.json({ me: next.who });
      }
      deleteCookie(c, SESSION_COOKIE, { path: "/" });
      keepMore(c, []);
      return c.json({ me: null });
    }
    const gone = others.find((one) => keyOf(one.kept.org, one.who.id) === key);
    if (!gone) throw new Refusal(404, "not_found", "That account isn't signed in on this browser.");
    await endKept(gone.kept);
    keepMore(c, others.filter((one) => one !== gone).map((one) => one.kept));
    return c.json({ me });
  });

  // Switch to another account on this browser, whichever company it is; the one in use waits beside it.
  app.post("/api/auth/switch", signedIn, async (c) => {
    const me = c.get("me");
    if (me.viewedBy) throw new Refusal(400, "invalid", "Go back to your own screens first.");
    const key = askedKey(await readBody(c, accountsBody));
    const others = await keptWithWho(c, me);
    const chosen = others.find((one) => keyOf(one.kept.org, one.who.id) === key);
    if (!chosen) throw new Refusal(404, "not_found", "That account isn't signed in on this browser any more. Add it again.");
    keepMore(c, [{ org: myOrg(), token: c.get("token") }, ...others.filter((one) => one !== chosen).map((one) => one.kept)]);
    useSession(c, chosen.kept.token);
    useOrg(c, chosen.kept.org);
    return c.json({ me: chosen.who });
  });

  app.get("/api/me", signedIn, (c) => c.json({ me: c.get("me") }));

  // The CEO and the Admin look at the CRM as someone sees it: a read-only session of theirs, for
  // two hours at most; their own session waits in a second cookie for "Back".
  app.post("/api/auth/view/back", signedIn, async (c) => {
    const me = c.get("me");
    if (!me.viewedBy) throw new Refusal(400, "invalid", "You are already yourself.");
    await endSession(db, c.get("token"));
    const back = getCookie(c, BACK_COOKIE);
    const mine = back ? await sessionOf(db, back) : null;
    deleteCookie(c, BACK_COOKIE, { path: "/" });
    if (!back || !mine || mine.personId !== me.viewedBy.id) {
      deleteCookie(c, SESSION_COOKIE, { path: "/" });
      return c.json({ me: null });
    }
    setCookie(c, SESSION_COOKIE, back, {
      httpOnly: true,
      secure,
      sameSite: "Lax",
      path: "/",
      maxAge: SESSION_DAYS * 24 * 60 * 60,
    });
    return c.json({ me: await whoIs(db, back) });
  });
  app.post("/api/auth/view/:id", signedIn, async (c) => {
    const me = c.get("me");
    // The CEO and the Admin look as anyone; a team lead or a head as the people under them (Aryan,
    // 19 Nov: "press a person and what they do opens, what they see"), read only as always.
    allow(me, ["ceo", "admin", "team_lead", "manager"], "look as someone else");
    if (me.viewedBy) throw new Refusal(400, "invalid", "Go back first.");
    const target = idParam(c);
    if (target === me.id) throw new Refusal(400, "invalid", "That's you.");
    const [found] = await db.select().from(person).where(eq(person.id, target)).limit(1);
    if (!found?.active) throw new Refusal(404, "not_found", "That person isn't working here.");
    if (me.role === "team_lead" || me.role === "manager") {
      const led = await ledUnits(db, me);
      const [under] = await rows<{ ok: boolean }>(
        db,
        sql`select (${target} in ${teamIds(me)} or exists (
            select 1 from seat_holder h join seat s on s.id = h.seat_id and s.active
            where h.person_id = ${target} and s.unit_id in (${led.length ? sql.join(led.map((id) => sql`${id}`), sql`, `) : sql`0`})
              and h.starts_on <= (now() at time zone 'Asia/Manila')::date and (h.ends_on is null or h.ends_on >= (now() at time zone 'Asia/Manila')::date))) as ok`,
      );
      if (!under?.ok) throw new Refusal(403, "not_allowed", "That person isn't in your team.");
    }
    const token = await startSession(db, found.id, me.id);
    setCookie(c, BACK_COOKIE, c.get("token"), {
      httpOnly: true,
      secure,
      sameSite: "Lax",
      path: "/",
      maxAge: 3 * 60 * 60,
    });
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      secure,
      sameSite: "Lax",
      path: "/",
      maxAge: 2 * 60 * 60,
    });
    return c.json({ me: await whoIs(db, token) });
  });

  app.post("/api/auth/password", signedIn, async (c) => {
    const input = await readBody(c, z.object({ current: z.string().max(200), next: z.string() }));
    const me = c.get("me");
    const [row] = await db.select().from(person).where(eq(person.id, me.id)).limit(1);
    if (!row) throw new Refusal(401, "signed_out", "Sign in first.");
    if (!(await passwordRight(row, input.current, getCookie(c, deviceCookie(row.id)))))
      throw new Refusal(400, "invalid", "That isn't your current password.", "current");
    const problem = passwordProblem(input.next);
    if (problem) throw new Refusal(400, "invalid", problem, "next");
    if (input.next === input.current)
      throw new Refusal(
        400,
        "invalid",
        "Choose a password different from the current one.",
        "next",
      );
    const passwordHash = await hashPassword(input.next);
    // Only over the password just checked: one the administrator gave meanwhile stands.
    const changed = await db
      .update(person)
      .set({ passwordHash, mustChangePassword: false })
      .where(and(eq(person.id, me.id), eq(person.passwordHash, row.passwordHash)))
      .returning({ id: person.id });
    if (!changed.length) throw new Refusal(409, "not_now", "Your password was changed meanwhile. Sign in again.");
    await endOtherSessions(db, me.id, c.get("token"));
    await accountEvent(db, me.id, me.id, "password_changed");
    rememberDevice(c, { id: me.id, passwordHash });
    return c.json({ ok: true });
  });
  accountRoutes(app, db, signedIn, passwordRight);
  signUpRoutes(app, db, signedIn, options.webUrl);
  if (options.localOpen) localOpenRoutes(app, db);

  inventoryRoutes(app, db, signedIn);
  notifyRoutes(app, db, signedIn);
  orgRoutes(app, db, signedIn);
  hrRoutes(app, db, signedIn);
  fieldRoutes(app, db, signedIn);
  messageRoutes(app, db, signedIn);
  teamRoutes(app, db, signedIn);
  speedRoutes(app, db, signedIn);
  purchaseRoutes(app, db, signedIn);
  customerRoutes(app, db, signedIn);
  overviewRoutes(app, db, signedIn);
  // Before the orders' own addresses: /api/orders/:id/returns is theirs.
  returnRoutes(app, db, signedIn);
  checkRoutes(app, db, signedIn);
  orderRoutes(app, db, signedIn);
  financeRoutes(app, db, signedIn);
  dispatchRoutes(app, db, signedIn);
  salesRoutes(app, db, signedIn);
  onlineRoutes(app, db, signedIn);
  channelRoutes(app, db, signedIn);
  pointsRoutes(app, db, signedIn);
  targetRoutes(app, db, signedIn);
  scoreRoutes(app, db, signedIn);
  kpiRoutes(app, db, signedIn);
  sellerRoutes(app, db, signedIn);
  rxRoutes(app, db, signedIn);
  b2cRoutes(app, db, signedIn);
  b2bRoutes(app, db, signedIn);
  clidpRoutes(app, db, signedIn);
  tenderRoutes(app, db, signedIn);
  tenderFinderDoor(app, db);
  hospitalRoutes(app, db, signedIn);
  telesalesRoutes(app, db, signedIn);
  mtRoutes(app, db, signedIn);
  workLogRoutes(app, db, signedIn);
  regulatoryRoutes(app, db, signedIn);
  birRoutes(app, db, signedIn);
  bookRoutes(app, db, signedIn);
  decisionRoutes(app, db, signedIn);
  sampleRoutes(app, db, signedIn);
  complaintRoutes(app, db, signedIn);
  mrRoutes(app, db, signedIn);

  return app;
}
