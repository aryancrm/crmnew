// Whose figures a lead's page shows, read from the Admin panel's tree (Aryan, 19 Nov: "Subir looks
// after CLIDP and BID: how does he see each one's data? Many people lead in two places, one may
// look after two channels: the tree in the Admin panel decides it"). Every lead page has the team
// switch (All · each box under the person, by its lead); the box picked rides in the address as
// ?unit= and narrows the page to the seats in that box and every box under it, today. "All" is
// everything the person leads: every box they hold a lead seat of (Honey: RX Business and MD
// Telesales; Subir: Sales & Marketing, Government Bidding under it) and whoever reports up to them.
// The CEO and the Admin may pick any box.

import { type SQL, sql } from "drizzle-orm";
import type { Database } from "../db/index";
import { Refusal } from "../http";
import type { Me } from "../types";
import { ledUnits } from "./service";

/** The box and every open box under it (ids). */
export const boxesUnder = (unitId: number): SQL =>
  sql`(with recursive down as (select id from org_unit where id = ${unitId}
      union all select u.id from org_unit u join down on u.parent_id = down.id where u.active)
    select id from down)`;

/** Every seat in the box or under it, closed ones too (what was sold from them stays the box's). */
export const seatsUnder = (unitId: number): SQL =>
  sql`(select s.id from seat s where s.unit_id in ${boxesUnder(unitId)})`;

/** The people sitting in the box or under it today, holders and covers. */
export const peopleUnder = (unitId: number): SQL =>
  sql`(select h.person_id from seat_holder h where h.seat_id in ${seatsUnder(unitId)}
      and h.starts_on <= current_date and (h.ends_on is null or h.ends_on >= current_date))`;

/** The areas of the seats in the box or under it: their customers are the box's. */
export const areasUnder = (unitId: number): SQL =>
  sql`(select s.area_id from seat s where s.active and s.area_id is not null and s.unit_id in ${boxesUnder(unitId)})`;

/** The team CTE (`team`, one `id` per person) a lead's page reads: the box picked on the switch,
 *  else the person and everyone who reports up to them. */
export const teamCte = (me: Me): SQL =>
  me.unit
    ? sql`with recursive team as (select person_id as id from ${peopleUnder(me.unit)} x)`
    : sql`with recursive team as (
        select id from person where id = ${me.id}
        union all select p.id from person p join team t on p.reports_to = t.id)`;

/** The people a page counts for this person (a list of ids): the box picked, else the person and
 *  everyone under them. */
export const teamIds = (me: Me): SQL =>
  me.unit
    ? peopleUnder(me.unit)
    : sql`(with recursive team as (select id from person where id = ${me.id}
        union all select p.id from person p join team t on p.reports_to = t.id) select id from team)`;

/** Does this person lead any box today (a lead seat they hold or cover)? */
export async function leadsABox(db: Database, me: Me): Promise<boolean> {
  return (await ledUnits(db, me)).length > 0;
}

/** The box asked for on a page (?unit=), checked: the CEO and the Admin any; anyone else one they
 *  lead or one under it. Null when none is asked. */
export async function pickedUnit(db: Database, me: Me, asked: string | undefined | null): Promise<number | null> {
  const unitId = Number(asked);
  if (!asked || !Number.isInteger(unitId) || unitId <= 0) return null;
  if (me.role === "ceo" || me.role === "admin") return unitId;
  if (!(await ledUnits(db, me)).includes(unitId)) throw new Refusal(403, "not_allowed", "That team isn't under you.");
  return unitId;
}
