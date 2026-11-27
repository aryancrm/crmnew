// On a developer's own computer only (Aryan, 27 Nov: "on localhost let me straight in, whoever I
// pick"): the sign-in page lists the company's people and one click opens as that person, no
// password. server.ts turns it on only when every one of these holds: no DATABASE_URL (the local
// PGlite copy), the web app at http://localhost, NODE_ENV not production, and LOCAL_OPEN not "off".
// The live server has a DATABASE_URL and an https address, so it never has these routes. Each
// call is also refused unless it came to localhost.

import { sql } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { rows, type Database } from "../db/index";
import { type Env, idParam, Refusal, readBody } from "../http";
import type { Role } from "../people/roles";
import { BACK_COOKIE, DAY_SESSION_ROLES, endOfWorkingDay, SESSION_COOKIE, SESSION_DAYS, startSession, whoIs } from "./sessions";
import { ownWorkspace, WORKSPACE_KEYS, workspaceAllows } from "./workspaces";

const THIS_COMPUTER = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/** The guards server.ts checks before turning it on. */
export const localOpenAllowed = (env: NodeJS.ProcessEnv, webUrl: string): boolean =>
  !env.DATABASE_URL &&
  env.NODE_ENV !== "production" &&
  env.LOCAL_OPEN !== "off" &&
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(webUrl);

const onThisComputer = (c: Context<Env>) => {
  if (!THIS_COMPUTER.test(c.req.header("host") ?? "")) throw new Refusal(404, "not_found", "Not here.");
};

export function localOpenRoutes(app: Hono<Env>, db: Database) {
  app.get("/api/local/people", async (c) => {
    onThisComputer(c);
    const people = await rows<{ id: number; name: string; role: string; title: string | null; login: string | null }>(
      db,
      sql`select p.id::int as id, p.name, p.role, coalesce(s.title, p.title) as title, s.login
        from person p
        left join lateral (
          select s.title, s.login from seat_holder h join seat s on s.id = h.seat_id and s.active
          where h.person_id = p.id and h.starts_on <= (now() at time zone 'Asia/Manila')::date
            and (h.ends_on is null or h.ends_on >= (now() at time zone 'Asia/Manila')::date)
          order by (h.kind = 'holder') desc, s.lead desc, h.starts_on, h.id limit 1) s on true
        where p.active order by p.name`,
    );
    c.header("cache-control", "no-store");
    return c.json({ people });
  });

  app.post("/api/local/open/:id", async (c) => {
    onThisComputer(c);
    const input = await readBody(c, z.object({ workspace: z.enum(WORKSPACE_KEYS).optional() }));
    const [found] = await rows<{ id: number; role: string }>(
      db,
      sql`select id::int as id, role from person where id = ${idParam(c)} and active`,
    );
    if (!found) throw new Refusal(404, "not_found", "That person isn't working here.");
    const role = found.role as Role;
    const workspace = input.workspace && workspaceAllows(input.workspace, role) ? input.workspace : (ownWorkspace(role)?.key ?? null);
    const until = DAY_SESSION_ROLES.includes(role) ? endOfWorkingDay() : undefined;
    const token = await startSession(db, found.id, undefined, workspace, until);
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      ...(until ? { expires: until } : { maxAge: SESSION_DAYS * 24 * 60 * 60 }),
    });
    deleteCookie(c, BACK_COOKIE, { path: "/" });
    return c.json({ me: await whoIs(db, token) });
  });
}
