// The API. Every route answers JSON; every refusal is { error: { code, message, field? } }.

import { decisionRoutes } from "./decisions/routes";
import { sampleRoutes } from "./samples/routes";
import { complaintRoutes } from "./complaints/routes";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { cors } from "hono/cors";
import { z } from "zod";
import { hashPassword, passwordMatches, passwordProblem } from "./auth/password";
import {
  BACK_COOKIE,
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
import { countQueries, type Database } from "./db/index";
import { person } from "./db/schema";
import { dispatchRoutes } from "./dispatch/routes";
import { fieldRoutes } from "./field/routes";
import { financeRoutes } from "./finance/routes";
import { markSeen } from "./hr/attendance";
import { hrRoutes } from "./hr/routes";
import { allow, type Env, idParam, Refusal, readBody, signedInWith } from "./http";
import { inventoryRoutes } from "./inventory/routes";
import { messageRoutes } from "./messages/routes";
import { notifyRoutes } from "./notify/routes";
import { channelRoutes } from "./online/channel-routes";
import { onlineRoutes } from "./online/routes";
import { orderRoutes } from "./orders/routes";
import { orgRoutes } from "./org/routes";
import { personOfSeatLogin } from "./org/service";
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
import { tenderRoutes } from "./tenders/routes";
import { rxRoutes } from "./rx/routes";
import { scoreRoutes } from "./scores/routes";
import { sellerRoutes } from "./sellers/routes";
import { targetRoutes } from "./targets/routes";
import { teamRoutes } from "./team/routes";
import type { ApiError, Me } from "./types";

export type AppOptions = {
  /** The web app's address: allowed to call with the cookie; https makes the cookie Secure. */
  webUrl: string;
};

const MAX_WRONG = 5;
const LOCK_MINUTES = 15;

export function createApp(db: Database, options: AppOptions) {
  const app = new Hono<Env>();
  const secure = options.webUrl.startsWith("https://");

  // Time and query count on every response: how a slow screen is found.
  app.use("*", async (c, next) => {
    const started = performance.now();
    const { queries } = await countQueries(next);
    const ms = (performance.now() - started).toFixed(1);
    c.header("Server-Timing", `app;dur=${ms}, db;desc="${queries} queries"`);
  });

  app.use("/api/*", cors({ origin: options.webUrl, credentials: true }));

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
  const signedIn = signedInWith(db, (me) => markSeen(db, me));

  app.get("/api/health", (c) => c.json({ ok: true }));

  app.post("/api/auth/login", async (c) => {
    const input = await readBody(
      c,
      z.object({
        email: z.string().trim().min(1, "Type your login ID."),
        password: z.string().min(1, "Type your password."),
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
    if (!found || !found.active) throw wrong;

    if (found.lockedUntil && found.lockedUntil.getTime() > Date.now()) {
      const minutes = Math.ceil((found.lockedUntil.getTime() - Date.now()) / 60000);
      throw new Refusal(
        429,
        "locked",
        `Too many wrong passwords. Try again in ${minutes} minutes.`,
      );
    }

    if (!(await passwordMatches(input.password, found.passwordHash))) {
      const failed = found.failedLogins + 1;
      const lock = failed >= MAX_WRONG;
      await db
        .update(person)
        .set({
          failedLogins: lock ? 0 : failed,
          lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60000) : null,
        })
        .where(eq(person.id, found.id));
      throw wrong;
    }

    await db
      .update(person)
      .set({ failedLogins: 0, lockedUntil: null, lastSignInAt: new Date() })
      .where(eq(person.id, found.id));

    const token = await startSession(db, found.id);
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      secure,
      sameSite: "Lax",
      path: "/",
      maxAge: SESSION_DAYS * 24 * 60 * 60,
    });
    const me = await whoIs(db, token);
    return c.json({ me });
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
    allow(me, ["ceo", "admin"], "look as someone else");
    if (me.viewedBy) throw new Refusal(400, "invalid", "Go back first.");
    const target = idParam(c);
    if (target === me.id) throw new Refusal(400, "invalid", "That's you.");
    const [found] = await db.select().from(person).where(eq(person.id, target)).limit(1);
    if (!found?.active) throw new Refusal(404, "not_found", "That person isn't working here.");
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
    const input = await readBody(c, z.object({ current: z.string(), next: z.string() }));
    const me = c.get("me");
    const [row] = await db.select().from(person).where(eq(person.id, me.id)).limit(1);
    if (!row || !(await passwordMatches(input.current, row.passwordHash)))
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
    await db
      .update(person)
      .set({ passwordHash: await hashPassword(input.next), mustChangePassword: false })
      .where(eq(person.id, me.id));
    await endOtherSessions(db, me.id, c.get("token"));
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
  sellerRoutes(app, db, signedIn);
  rxRoutes(app, db, signedIn);
  b2cRoutes(app, db, signedIn);
  b2bRoutes(app, db, signedIn);
  clidpRoutes(app, db, signedIn);
  tenderRoutes(app, db, signedIn);
  mtRoutes(app, db, signedIn);
  workLogRoutes(app, db, signedIn);
  regulatoryRoutes(app, db, signedIn);
  bookRoutes(app, db, signedIn);
  decisionRoutes(app, db, signedIn);
  sampleRoutes(app, db, signedIn);
  complaintRoutes(app, db, signedIn);

  return app;
}
