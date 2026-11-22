// The API. Every route answers JSON; every refusal is { error: { code, message, field? } }.

import { createMiddleware } from "hono/factory";
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
import { deviceCookie, deviceMark, passwordGuard } from "./auth/guard";
import { hashPassword, passwordProblem } from "./auth/password";
import { ownWorkspace, WORKSPACE_KEYS, workspaceAllows, workspaceByKey } from "./auth/workspaces";
import type { Role } from "./people/roles";
import {
  BACK_COOKIE,
  DAY_SESSION_ROLES,
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
import { countQueries, type Database, rows } from "./db/index";
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
import { hospitalRoutes } from "./hospitals/routes";
import { telesalesRoutes } from "./telesales/routes";
import { tenderRoutes } from "./tenders/routes";
import { rxRoutes } from "./rx/routes";
import { scoreRoutes } from "./scores/routes";
import { kpiRoutes } from "./kpis/routes";
import { sellerRoutes } from "./sellers/routes";
import { targetRoutes } from "./targets/routes";
import { teamRoutes } from "./team/routes";
import { DUTY_DESKS, type DutyDesk, deskPerson, deskReport, deskTeam, shareOut, shareOutAll, startPerson, takeFinanceOrder } from "./desks/service";
import { portalDepartment } from "./portal/service";
import type { ApiError, Me } from "./types";

export type AppOptions = {
  /** The web app's address: allowed to call with the cookie; https makes the cookie Secure. */
  webUrl: string;
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

export function createApp(db: Database, options: AppOptions) {
  const app = new Hono<Env>();
  const secure = options.webUrl.startsWith("https://");
  const passwordRight = passwordGuard(db);

  // Time and query count on every response: how a slow screen is found.
  app.use("*", async (c, next) => {
    const started = performance.now();
    const { queries } = await countQueries(next);
    const ms = (performance.now() - started).toFixed(1);
    c.header("Server-Timing", `app;dur=${ms}, db;desc="${queries} queries"`);
  });

  app.use("*", secureHeaders());
  app.use("/api/*", cors({ origin: options.webUrl, credentials: true }));
  app.use("/api/auth/*", atMost(16 * 1024));
  app.use("/api/*", atMost(50 * MB));
  app.use("/webhooks/*", atMost(2 * MB));

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
  const signedInOnly = signedInWith(db, (me) => markSeen(db, me));
  // A lead's page reading one box of the team switch (?unit=): checked once here, then every
  // service's team is that box and what is under it (org/scope.ts).
  const signedIn = createMiddleware<Env>((c, next) =>
    signedInOnly(c, async () => {
      const asked = c.req.method === "GET" ? c.req.query("unit") : undefined;
      if (asked) c.set("me", { ...c.get("me"), unit: await pickedUnit(db, c.get("me"), asked) });
      await next();
    }),
  );

  app.get("/api/health", (c) => c.json({ ok: true }));
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
    if (input.on && c.get("me").role !== "admin" && c.get("me").id !== idParam(c))
      throw new Refusal(403, "not_allowed", "Each person starts themselves, on their own login.");
    await startPerson(db, c.get("me"), desk, idParam(c), input.on);
    return c.json(await deskTeam(db, c.get("me"), desk));
  });
  app.post("/api/finance/orders/:id/take", signedIn, async (c) => {
    const input = await readBody(c, z.object({ release: z.boolean().default(false) }));
    await takeFinanceOrder(db, c.get("me"), idParam(c), input.release);
    return c.json({ ok: true });
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

  // The one way in: a person's own login ID and their own password. It opens one session, theirs,
  // good in every app their role has; what they may do is checked on each call.
  app.post("/api/auth/login", async (c) => {
    const input = await readBody(
      c,
      z.object({
        email: z.string().trim().min(1, "Type your login ID.").max(200),
        password: z.string().min(1, "Type your password.").max(200),
        // The department page signed in at. The web app always sends it; without it the session
        // is opened for the login's own department.
        workspace: z.enum(WORKSPACE_KEYS, { error: "Pick the department." }).optional(),
      }),
    );
    const wrong = new Refusal(401, "wrong_login", "Wrong login ID or password.");
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
        "This login needs a one-time password. Ask your administrator for yours.",
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
    if (!still.length) throw wrong;

    const until = DAY_SESSION_ROLES.includes(role) ? endOfWorkingDay() : undefined;
    const token = await startSession(db, found.id, undefined, workspace ?? own?.key ?? null, until);
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      secure,
      sameSite: "Lax",
      path: "/",
      ...(until ? { expires: until } : { maxAge: SESSION_DAYS * 24 * 60 * 60 }),
    });
    // An earlier "look as" of whoever used this browser before isn't this person's.
    deleteCookie(c, BACK_COOKIE, { path: "/" });
    rememberDevice(c, found);
    return c.json({ me: await whoIs(db, token) });
  });

  app.post("/api/auth/logout", async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) await endSession(db, token);
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
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
    rememberDevice(c, { id: me.id, passwordHash });
    return c.json({ ok: true });
  });

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
  hospitalRoutes(app, db, signedIn);
  telesalesRoutes(app, db, signedIn);
  mtRoutes(app, db, signedIn);
  workLogRoutes(app, db, signedIn);
  regulatoryRoutes(app, db, signedIn);
  bookRoutes(app, db, signedIn);
  decisionRoutes(app, db, signedIn);
  sampleRoutes(app, db, signedIn);
  complaintRoutes(app, db, signedIn);
  mrRoutes(app, db, signedIn);

  return app;
}
