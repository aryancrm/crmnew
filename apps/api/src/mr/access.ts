// Who may use the MR App (docs/PLAN.md 22): its MRs (their own work), its one team lead (everyone's
// work, and the approvals), and the CEO and the Admin, who look (the Admin also stands in for the
// lead and sets the app up). Nothing here reads the company tree: the app keeps its own members.

import { type SQL, sql } from "drizzle-orm";
import { rows } from "../db/index";
import { Refusal } from "../http";
import { clean, type Runner } from "../inventory/service";
import type { Me } from "../types";
import type { MrAccess } from "./words";

export async function accessOf(db: Runner, me: Me): Promise<MrAccess | null> {
  const [found] = await rows<{ role: "mr" | "lead" }>(
    db,
    sql`select role from mr_member where person_id = ${me.id} and active`,
  );
  if (found) return found.role;
  if (me.role === "ceo" || me.role === "admin") return "viewer";
  return null;
}

/** The app's door: its members, and the CEO and the Admin to look. */
export async function mustUse(db: Runner, me: Me): Promise<MrAccess> {
  const access = await accessOf(db, me);
  if (!access) throw new Refusal(403, "not_allowed", "The MR App is for its MRs and their team lead.");
  return access;
}

/** A member working their own day, in their own login (the lead does calls too). */
export async function mustWork(db: Runner, me: Me): Promise<void> {
  if (me.viewedBy) throw new Refusal(403, "not_allowed", "Looking at someone's screens changes nothing.");
  const access = await accessOf(db, me);
  if (access !== "mr" && access !== "lead")
    throw new Refusal(403, "not_allowed", "Only the app's MRs work a day here.");
}

/** The team lead deciding (approve, send back, reopen, judge, mark seen); the Admin stands in. */
export async function mustLead(db: Runner, me: Me): Promise<void> {
  if (me.viewedBy) throw new Refusal(403, "not_allowed", "Looking at someone's screens changes nothing.");
  if (me.role === "admin") return;
  if ((await accessOf(db, me)) !== "lead")
    throw new Refusal(403, "not_allowed", "That is the team lead's to decide.");
}

export async function isLeadNow(db: Runner, me: Me): Promise<boolean> {
  if (me.viewedBy) return false;
  return me.role === "admin" || (await accessOf(db, me)) === "lead";
}

/** Whether `me` may see this person's work: their own (as a member); the lead's and the
 *  viewers' everyone's in the app. */
export async function maySee(db: Runner, me: Me, personId: number): Promise<boolean> {
  const access = await accessOf(db, me);
  if (!access) return false;
  if (access === "lead" || access === "viewer") return true;
  return me.id === personId;
}

export async function mustSee(db: Runner, me: Me, personId: number): Promise<MrAccess> {
  if (!(await maySee(db, me, personId))) throw new Refusal(403, "not_allowed", "That is another MR's work.");
  return (await accessOf(db, me)) as MrAccess;
}

/** The app's people (alias given) as an SQL condition: the active members. */
export const memberSql = (column: string): SQL =>
  sql`${sql.raw(column)} in (select person_id from mr_member where active)`;

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

/** People the member may say they work with: the app's other members, the lead first. */
export async function partnersOf(db: Runner, me: Me): Promise<{ id: number; name: string }[]> {
  return rows<{ id: number; name: string }>(
    db,
    sql`select p.id::int as id, p.name from mr_member m join person p on p.id = m.person_id
      where m.active and p.active and p.id <> ${me.id} order by m.role = 'lead' desc, p.name`,
  );
}

/** The members a list names (working with): the app's own active members, checked. */
export async function membersFrom(db: Runner, me: Me, asked: number[] | null | undefined, field: string): Promise<number[]> {
  const list = [...new Set((asked ?? []).filter((id) => Number.isInteger(id) && id > 0 && id !== me.id))];
  if (!list.length) return [];
  if (list.length > 6) throw new Refusal(400, "invalid", "Six people at most.", field);
  const found = await rows<{ id: number }>(
    db,
    sql`select person_id::int as id from mr_member where active and person_id in (${ids(list)})`,
  );
  if (found.length !== list.length) throw new Refusal(400, "invalid", "Pick the people from the list.", field);
  return list;
}
