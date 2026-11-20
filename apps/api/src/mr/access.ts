// Who works the field and who sees it (docs/PLAN.md 22), from the company's own hierarchy: the
// MedReps (and team leads and heads on their own calls) work their day; a team lead sees and
// approves their team's (whom they lead, down the reporting line; the team switch narrows to a
// box); the head and the CEO see everything under them; Management and the Admin stand in for a
// lead; the CEO reads and decides nothing. Nothing here keeps its own list of people.

import { type SQL, sql } from "drizzle-orm";
import { rows } from "../db/index";
import { FIELD_READ_ROLES, FIELD_ROLES, LEAD_ROLES, leads, maySeeField } from "../field/visits";
import { Refusal } from "../http";
import { todayManila } from "../inventory/rules";
import { clean, type Runner } from "../inventory/service";
import { inForce } from "../org/service";
import { teamCte } from "../org/scope";
import type { Me } from "../types";
import type { MrAccess } from "./words";

/** How the field stands for this person: works their own day (an MR), leads a team (works too),
 *  or reads everyone's (the CEO, Management, the Admin). */
export async function accessOf(_db: Runner, me: Me): Promise<MrAccess | null> {
  if (LEAD_ROLES.includes(me.role)) return "lead";
  if (FIELD_ROLES.includes(me.role)) return "mr";
  if (FIELD_READ_ROLES.includes(me.role)) return "viewer";
  return null;
}

export async function mustUse(db: Runner, me: Me): Promise<MrAccess> {
  const access = await accessOf(db, me);
  if (!access) throw new Refusal(403, "not_allowed", "The field's pages are the MedReps', their leads' and the CEO's.");
  return access;
}

/** Working one's own field day, in one's own login. */
export async function mustWork(_db: Runner, me: Me): Promise<void> {
  if (me.viewedBy) throw new Refusal(403, "not_allowed", "Looking at someone's screens changes nothing.");
  if (!FIELD_ROLES.includes(me.role))
    throw new Refusal(403, "not_allowed", "The field day is worked by the MedReps and their leads.");
}

/** Deciding for a person (approve, send back, reopen, judge, mark seen): their team lead (anyone
 *  above them in the line); Management and the Admin stand in; the CEO only reads. */
export async function mayDecideFor(db: Runner, me: Me, personId: number): Promise<boolean> {
  if (me.viewedBy || me.id === personId) return false;
  if (me.role === "admin" || me.role === "management") return true;
  return leads(db, me, personId);
}

export async function mustDecideFor(db: Runner, me: Me, personId: number): Promise<void> {
  if (!(await mayDecideFor(db, me, personId)))
    throw new Refusal(403, "not_allowed", "That is the person's team lead's to decide.");
}

/** Whether `me` may see this person's field work: their own, their lead's (up the line), and
 *  everyone's for the CEO, Management and the Admin. */
export async function maySee(db: Runner, me: Me, personId: number): Promise<boolean> {
  return maySeeField(db, me, personId);
}

export async function mustSee(db: Runner, me: Me, personId: number): Promise<MrAccess> {
  if (!(await maySee(db, me, personId))) throw new Refusal(403, "not_allowed", "That is someone else's field work.");
  return (await accessOf(db, me)) as MrAccess;
}

/** The team a lead's page counts (`team` CTE, one `id` per person): the box picked on the team
 *  switch, else the lead and everyone under them; everyone's for the CEO, Management and the Admin
 *  when no box is picked. Put `teamSql(me)` in front of a query, then use `inTeam(column)`. */
export const teamSql = (me: Me): SQL => teamCte(me);
export const inTeam = (me: Me, column: string): SQL =>
  FIELD_READ_ROLES.includes(me.role) && !me.unit
    ? sql`${sql.raw(column)} in (select id from person where active)`
    : sql`${sql.raw(column)} in (select id from team)`;

/** The field's people in a team (alias p), for the lead's lists. */
export const fieldPerson = sql`p.active and p.role in ('medrep', 'team_lead', 'manager')`;

const PLACE = /^-?\d{1,2}\.\d+,-?\d{1,3}\.\d+$/;
/** "lat,lng" from the phone, or null when none (or not one). */
export const placeOf = (text?: string | null): string | null => {
  const typed = clean(text);
  return typed && PLACE.test(typed) ? typed : null;
};
/** A list as a Postgres text[] (through JSON, the same on every driver). */
export const textArray = (list: string[]): SQL =>
  sql`array(select value from jsonb_array_elements_text(${JSON.stringify(list)}::jsonb))`;
export const idArray = (list: number[]): SQL =>
  sql`array(select value::bigint from jsonb_array_elements_text(${JSON.stringify(list.map(String))}::jsonb))`;
export const words = (value: unknown, max: number): string | null => {
  if (typeof value !== "string") return null;
  const typed = value.trim();
  return typed ? typed.slice(0, max) : null;
};
export const ids = (list: number[]): SQL =>
  sql.join(
    list.map((id) => sql`${id}`),
    sql`, `,
  );

/** The seat a person holds today (their first): the visit's work stays with the seat. */
export const seatNow = (person: SQL, today = todayManila()): SQL =>
  sql`(select h.seat_id from seat_holder h join seat s on s.id = h.seat_id and s.active
    where h.person_id = ${person} and h.kind = 'holder' and ${inForce("h", today)} order by h.starts_on, h.id limit 1)`;

/** Metres between two "lat,lng" places (haversine). */
export function metresBetween(a: string, b: string): number | null {
  const [lat1, lng1] = a.split(",").map(Number);
  const [lat2, lng2] = b.split(",").map(Number);
  if ([lat1, lng1, lat2, lng2].some((one) => one === undefined || Number.isNaN(one))) return null;
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad((lat2 as number) - (lat1 as number));
  const dLng = rad((lng2 as number) - (lng1 as number));
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1 as number)) * Math.cos(rad(lat2 as number)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * 6_371_000 * Math.asin(Math.sqrt(h)));
}

/** People a field person may say they work with: whom they report to, their team-mates, and
 *  those who report to them. */
export async function partnersOf(db: Runner, me: Me): Promise<{ id: number; name: string }[]> {
  return rows<{ id: number; name: string }>(
    db,
    sql`select p.id::int as id, p.name from person p
      where ${fieldPerson} and p.id <> ${me.id}
        and (p.id = (select reports_to from person where id = ${me.id})
          or p.reports_to = (select reports_to from person where id = ${me.id})
          or p.reports_to = ${me.id})
      order by p.id = (select reports_to from person where id = ${me.id}) desc, p.name`,
  );
}

/** The people a list names (working with), checked: active field people or leads. */
export async function peopleFrom(db: Runner, me: Me, asked: number[] | null | undefined, field: string): Promise<number[]> {
  const list = [...new Set((asked ?? []).filter((id) => Number.isInteger(id) && id > 0 && id !== me.id))];
  if (!list.length) return [];
  if (list.length > 6) throw new Refusal(400, "invalid", "Six people at most.", field);
  const found = await rows<{ id: number }>(
    db,
    sql`select id::int as id from person p where ${fieldPerson} and p.id in (${ids(list)})`,
  );
  if (found.length !== list.length) throw new Refusal(400, "invalid", "Pick the people from the list.", field);
  return list;
}

/** The person whom someone reports to (their team lead), for telling them. */
export async function leadOf(db: Runner, personId: number): Promise<number | null> {
  const [found] = await rows<{ id: number | null }>(
    db,
    sql`select p.reports_to::int as id from person p join person b on b.id = p.reports_to and b.active
      where p.id = ${personId} and b.role not in ('ceo', 'admin')`,
  );
  return found?.id ?? null;
}
