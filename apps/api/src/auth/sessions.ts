// A signed-in browser holds a random token in a cookie its scripts can't read. The database
// keeps only the token's hash, so a copy of the database signs nobody in.

import { divisionsOf } from "../orders/divisions";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Database } from "../db/index";
import { area, channel, person, session } from "../db/schema";
import { isRole, ROLE_LABEL } from "../people/roles";
import type { Me } from "../types";

export const SESSION_COOKIE = "sid";
/** Holds the CEO's (or Admin's) own session while they look as someone else. */
export const BACK_COOKIE = "sid_back";
export const SESSION_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");

export async function startSession(
  db: Database,
  personId: number,
  viewedBy?: number,
  desk?: "management" | "finance" | "dispatch",
  workspace?: string | null,
  /** When it ends, if not the usual (a desk's common screen: the end of the working day). */
  until?: Date,
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.insert(session).values({
    tokenHash: hashOf(token),
    personId,
    desk: desk ?? null,
    workspace: workspace ?? null,
    // Looking as someone else lasts two hours at most.
    expiresAt: until ?? new Date(Date.now() + (viewedBy ? 2 * 60 * 60 * 1000 : SESSION_DAYS * DAY)),
    viewedBy: viewedBy ?? null,
  });
  return token;
}

/** The session behind a token: who it is, and who is looking as them on it. */
export async function sessionOf(db: Database, token: string) {
  const [row] = await db
    .select({ personId: session.personId, viewedBy: session.viewedBy })
    .from(session)
    .where(and(eq(session.tokenHash, hashOf(token)), gt(session.expiresAt, sql`now()`)))
    .limit(1);
  return row ?? null;
}

export async function endSession(db: Database, token: string): Promise<void> {
  await db.delete(session).where(eq(session.tokenHash, hashOf(token)));
}

/** Ends every session of a person except the one given (after a password change). */
export async function endOtherSessions(
  db: Database,
  personId: number,
  keep: string,
): Promise<void> {
  await db
    .delete(session)
    .where(and(eq(session.personId, personId), ne(session.tokenHash, hashOf(keep))));
}

/** Who is asking, in one query. Null when the token is unknown, expired or the person is off. */
export async function whoIs(db: Database, token: string): Promise<Me | null> {
  const boss = alias(person, "boss");
  const viewer = alias(person, "viewer");
  const [row] = await db
    .select({
      sessionId: session.id,
      lastSeenAt: session.lastSeenAt,
      id: person.id,
      name: person.name,
      email: person.email,
      title: person.title,
      role: person.role,
      mustChangePassword: person.mustChangePassword,
      channelCode: channel.code,
      channelName: channel.name,
      channelDivision: channel.division,
      areaId: area.id,
      areaName: area.name,
      areaCities: area.cities,
      bossName: boss.name,
      bossTitle: boss.title,
      viewerId: viewer.id,
      viewerName: viewer.name,
      deskScreen: session.desk,
      workspace: session.workspace,
      // The business box their seat sits in (by its channel), so a seat's desk follows the chart.
      // Of two seats, the one that decides their screens (org/service.ts projectOrg): a lead seat
      // over one that leads nothing, else the first given.
      businessCode: sql<string | null>`(select seat_business_channel(h.seat_id) from seat_holder h join seat s on s.id = h.seat_id and s.active
        where h.person_id = ${person.id} and h.starts_on <= (now() at time zone 'Asia/Manila')::date and (h.ends_on is null or h.ends_on >= (now() at time zone 'Asia/Manila')::date)
        order by (h.kind = 'holder') desc, s.lead desc, h.starts_on, h.id limit 1)`,
      // The Divisions their orders carry: their seats' own (migration 0114), the main seat's first.
      seatDivisions: sql<string[] | null>`(select array_agg(seat_division(h.seat_id) order by (h.kind = 'holder') desc, s.lead desc, h.starts_on, h.id)
        from seat_holder h join seat s on s.id = h.seat_id and s.active
        where h.person_id = ${person.id} and h.starts_on <= (now() at time zone 'Asia/Manila')::date and (h.ends_on is null or h.ends_on >= (now() at time zone 'Asia/Manila')::date))`,
    })
    .from(session)
    .innerJoin(person, eq(person.id, session.personId))
    .leftJoin(channel, eq(channel.id, person.channelId))
    .leftJoin(area, eq(area.id, person.areaId))
    .leftJoin(boss, eq(boss.id, person.reportsTo))
    .leftJoin(viewer, eq(viewer.id, session.viewedBy))
    .where(
      and(
        eq(session.tokenHash, hashOf(token)),
        gt(session.expiresAt, sql`now()`),
        eq(person.active, true),
      ),
    )
    .limit(1);
  if (!row || !isRole(row.role)) return null;

  // Keep a session in use alive, writing at most once a day.
  // A desk's common screen ends with the working day: never kept alive past it.
  if (!row.viewerId && !row.deskScreen && Date.now() - row.lastSeenAt.getTime() > DAY)
    await db
      .update(session)
      .set({ lastSeenAt: new Date(), expiresAt: new Date(Date.now() + SESSION_DAYS * DAY) })
      .where(eq(session.id, row.sessionId));

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    title: row.title,
    role: row.role,
    roleLabel: ROLE_LABEL[row.role],
    business: row.businessCode ?? null,
    divisions: divisionsOf(row.seatDivisions, row.channelDivision ?? null),
    deskScreen: (row.deskScreen as Me["deskScreen"]) ?? null,
    workspace: row.workspace ?? null,
    // Someone looking as this person isn't asked to change their password.
    mustChangePassword: row.viewerId ? false : row.mustChangePassword,
    channel:
      row.channelCode && row.channelName
        ? { code: row.channelCode, name: row.channelName, division: row.channelDivision ?? null }
        : null,
    area:
      row.areaId && row.areaName
        ? { id: row.areaId, name: row.areaName, cities: row.areaCities ?? [] }
        : null,
    reportsTo: row.bossName ? { name: row.bossName, title: row.bossTitle } : null,
    viewedBy: row.viewerId ? { id: row.viewerId, name: row.viewerName ?? "" } : null,
  };
}

/** The end of today's working day in Manila (11 pm), or of tomorrow's if that has passed. */
export function endOfWorkingDay(now = new Date()): Date {
  const manila = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const end = Date.UTC(manila.getUTCFullYear(), manila.getUTCMonth(), manila.getUTCDate(), 23) - 8 * 60 * 60 * 1000;
  return new Date(end > now.getTime() ? end : end + DAY);
}
