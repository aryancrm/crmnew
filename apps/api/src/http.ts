// What every route shares: the refusal, reading a body, who is asking, who may.

import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import type { z } from "zod";
import { SESSION_COOKIE, whoIs } from "./auth/sessions";
import { type Database, uncounted } from "./db/index";
import { ROLE_LABEL, type Role } from "./people/roles";
import type { Me } from "./types";

/** A "no" the person can act on. The message is shown as it is; `field` names the input. */
export class Refusal extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 429,
    readonly code: string,
    message: string,
    readonly field?: string,
    /** Every wrong input and its message, when several are wrong at once. */
    readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export type Env = { Variables: { me: Me; token: string } };

/** Reads a JSON body against a schema; the refusal names the field. */
export async function readBody<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  if (parsed.success) return parsed.data;
  // Every wrong input is named, so a form can mark them all at once.
  const fields: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const name = issue.path.join(".");
    if (name && !(name in fields)) fields[name] = issue.message;
  }
  const issue = parsed.error.issues[0];
  const field = issue?.path.join(".") || undefined;
  throw new Refusal(400, "invalid", issue?.message ?? "The request isn't right.", field, fields);
}

/** A whole number from the address (`/things/:id`). */
export function idParam(c: Context, name = "id"): number {
  const value = Number(c.req.param(name));
  if (!Number.isInteger(value) || value <= 0)
    throw new Refusal(404, "not_found", "No such record.");
  return value;
}

/** Routes behind this need a signed-in person; `c.get("me")` is who. */
/** The signed-in check. `onSeen` hears each signed-in request (attendance notes who is working);
 *  it never holds the request up or fails it. */
export function signedInWith(
  db: Database,
  onSeen?: (me: Me) => Promise<void>,
  /** Who the request acts as, when not the account itself (Management's and Finance's common
   *  screen: an order's own person). */
  standIn?: (me: Me, method: string, path: string) => Promise<Me | null>,
) {
  return createMiddleware<Env>(async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE);
    const me = token ? await whoIs(db, token) : null;
    if (!token || !me) throw new Refusal(401, "signed_out", "Sign in first.");
    // Looking as someone else is reading only: nothing is changed in their name.
    const reading = c.req.method === "GET" || c.req.method === "HEAD";
    const leaving = ["/api/auth/view/back", "/api/auth/logout"].includes(c.req.path);
    if (me.viewedBy && !reading && !leaving)
      throw new Refusal(
        403,
        "viewing",
        `You are looking as ${me.name}: nothing can be changed. Go back to ${me.viewedBy.name} first.`,
      );
    c.set("me", (!me.viewedBy && standIn ? await standIn(me, c.req.method, c.req.path) : null) ?? me);
    c.set("token", token);
    if (onSeen && !me.viewedBy)
      void uncounted(() => onSeen(me)).catch((error) =>
        console.error("attendance: couldn't note", error),
      );
    await next();
  });
}

/** The Online channel's MedRep works in the office: a MedRep (orders go up the usual line) who
 *  also works the Online desk (leads, Inbox, email, patients). */
export const officeMedrep = (me: Me) => me.role === "medrep" && me.channel?.code === "ONLINE";
/** Works the Online desk: its own desk role, or the Online channel's MedRep. */
export const onlineDesk = (me: Me) => me.role === "online" || officeMedrep(me);
export const may = (me: Me, roles: readonly Role[]) =>
  roles.includes(me.role) || (roles.includes("online") && officeMedrep(me));

/** Refuses unless the person has one of the roles; says who can. */
export function allow(me: Me, roles: readonly Role[], what: string): void {
  if (may(me, roles)) return;
  const who = [...new Set(roles.map((role) => ROLE_LABEL[role]))].join(", ");
  throw new Refusal(403, "not_allowed", `Only ${who} can ${what}.`);
}
