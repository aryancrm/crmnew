// The sales line's two doors on the sign-in page (Aryan, 19 Nov: "open Heads, put one password, and
// all the heads come; press one and the page that opens shows their team's data"): the company's
// password once, then the door's people by name; a press signs that person in with their own login
// (their seat's ID and that password), so they see exactly what their own sign-in shows. Only the
// people the password opens are listed: anyone who changed theirs signs in with their own ID.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { todayManila } from "../inventory/rules";
import { inForce } from "../org/service";
import type { DoorList } from "../types";
import { passwordMatches } from "./password";

export const DOORS = ["heads", "leads"] as const;
export type DoorKey = (typeof DOORS)[number];

/** Who stands behind each door: the heads (a lead seat over a business), the team leads. */
const MODULE: Record<DoorKey, string> = { heads: "manager", leads: "team_lead" };

/** One person behind the door: their seat's login ID (the press signs in with it and the password
 *  typed), name, boxes, and a team lead's head (the first head up their reporting line). */
export type DoorPerson = DoorList["people"][number];

/** The door's people the password opens, in the chart's order (a team lead's head's order first). */
export async function doorPeople(db: Database, door: DoorKey, password: string): Promise<DoorPerson[]> {
  const today = todayManila();
  const [found, units, people] = await Promise.all([
    rows<{ personId: number; name: string; hash: string; email: string | null; logins: (string | null)[]; units: number[] }>(
      db,
      sql`select p.id::int as "personId", p.name, p.password_hash as hash, p.email,
          array_agg(s.login order by s.lead desc, s.sort, s.id) as logins,
          array_agg(s.unit_id::int order by s.lead desc, s.sort, s.id) as units
        from seat s
        join seat_holder h on h.seat_id = s.id and h.kind = 'holder' and ${inForce("h", today)}
        join person p on p.id = h.person_id and p.active
        where s.active and s.module = ${MODULE[door]} ${door === "heads" ? sql`and s.lead` : sql``}
        group by p.id, p.name, p.password_hash, p.email`,
    ),
    rows<{ id: number; parentId: number | null; name: string; sort: number }>(
      db,
      sql`select id::int as id, parent_id::int as "parentId", name, sort from org_unit where active`,
    ),
    rows<{ id: number; name: string; role: string; reportsTo: number | null }>(
      db,
      sql`select id::int as id, name, role, reports_to::int as "reportsTo" from person where active`,
    ),
  ]);
  // Each box's place in the chart, read top to bottom as the Admin panel shows it.
  const children = new Map<number | null, typeof units>();
  for (const unit of units) children.set(unit.parentId, [...(children.get(unit.parentId) ?? []), unit]);
  const place = new Map<number, number>();
  const walk = (parent: number | null) => {
    for (const unit of [...(children.get(parent) ?? [])].sort((a, b) => a.sort - b.sort || a.id - b.id)) {
      place.set(unit.id, place.size);
      walk(unit.id);
    }
  };
  walk(null);
  const unitName = new Map(units.map((unit) => [unit.id, unit.name]));
  const byId = new Map(people.map((one) => [one.id, one]));
  const headOf = (id: number): { id: number; name: string } | null => {
    const seen = new Set<number>();
    let at = byId.get(id)?.reportsTo ?? null;
    while (at !== null && !seen.has(at)) {
      seen.add(at);
      const up = byId.get(at);
      if (!up) return null;
      if (up.role === "manager") return { id: up.id, name: up.name };
      at = up.reportsTo;
    }
    return null;
  };
  // The password, against each person's own (in turn, so a wrong one costs what one sign-in does
  // per person and no more at once).
  const opened: typeof found = [];
  for (const one of found) if (await passwordMatches(password, one.hash)) opened.push(one);
  if (!opened.length) return [];
  // Heads' order: their own box's; a team lead's: their head's box first, then their own.
  const headPlace = new Map<number, number>();
  if (door === "leads") {
    const heads = await rows<{ personId: number; unitId: number }>(
      db,
      sql`select distinct on (h.person_id) h.person_id::int as "personId", s.unit_id::int as "unitId"
        from seat s join seat_holder h on h.seat_id = s.id and h.kind = 'holder' and ${inForce("h", today)}
        where s.active and s.lead and s.module = 'manager' order by h.person_id, s.sort, s.id`,
    );
    for (const one of heads) headPlace.set(one.personId, place.get(one.unitId) ?? Number.MAX_SAFE_INTEGER);
  }
  return opened
    .map((one) => {
      const head = door === "leads" ? headOf(one.personId) : null;
      return {
        login: one.logins.find((login): login is string => Boolean(login)) ?? one.email ?? "",
        name: one.name,
        // In the chart's order, as the Admin panel and the sales tracker read them.
        boxes: [
          ...new Set(
            [...one.units]
              .sort((a, b) => (place.get(a) ?? Number.MAX_SAFE_INTEGER) - (place.get(b) ?? Number.MAX_SAFE_INTEGER))
              .map((unit) => unitName.get(unit))
              .filter((name): name is string => Boolean(name)),
          ),
        ],
        head: head?.name ?? null,
        order: [
          head ? (headPlace.get(head.id) ?? Number.MAX_SAFE_INTEGER) : 0,
          Math.min(...one.units.map((unit) => place.get(unit) ?? Number.MAX_SAFE_INTEGER)),
        ] as const,
      };
    })
    .filter((one) => one.login)
    .sort((a, b) => a.order[0] - b.order[0] || a.order[1] - b.order[1] || a.name.localeCompare(b.name))
    .map(({ order: _order, ...one }) => one);
}
