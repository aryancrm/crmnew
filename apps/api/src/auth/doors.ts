// The sales line's two doors on the sign-in page (Aryan, 19 Nov: "open Heads, put one password, and
// all the heads come; press one and the page that opens shows their team's data"): the company's
// password once, then the door's people by name; a press signs that person in with their own login
// (their seat's ID and that password), so they see exactly what their own sign-in shows. Only the
// people the password opens are listed: anyone who changed theirs signs in with their own ID.
//
// Behind the Heads door: whoever holds a head's lead seat. Behind Team leads: the sales tracker's
// managers, under their head: every team lead, and a head who leads sellers with no team lead
// between, under their own name (the tracker's "BID · SUBIR", "CLIDP · SUBIR", "MT · MHALOU";
// Aryan, 19 Nov: "Under Vanessa, under Javed, under Subir; there was no Under Mhalou"). As the
// tracker's rows, those sellers are the ones with a target (this month or the two before).

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { todayManila } from "../inventory/rules";
import { inForce } from "../org/service";
import type { DoorList } from "../types";
import { passwordMatches } from "./password";

export const DOORS = ["heads", "leads"] as const;
export type DoorKey = (typeof DOORS)[number];

/** One person behind the door: their seat's login ID, name, boxes, and a team lead's head. */
export type DoorPerson = DoorList["people"][number];
type Behind = DoorPerson & { personId: number; hash: string };

/** Everyone behind the door, in the chart's order (a team lead's head's place first). */
async function behind(db: Database, door: DoorKey): Promise<Behind[]> {
  const today = todayManila();
  const [seats, units, people, targeted] = await Promise.all([
    rows<{
      seatId: number;
      unitId: number;
      module: string;
      lead: boolean;
      login: string | null;
      sort: number;
      reportsToSeat: number | null;
      personId: number | null;
    }>(
      db,
      sql`select s.id::int as "seatId", s.unit_id::int as "unitId", s.module, s.lead, s.login, s.sort,
          s.reports_to_seat_id::int as "reportsToSeat",
          (select h.person_id::int from seat_holder h join person p on p.id = h.person_id and p.active
            where h.seat_id = s.id and h.kind = 'holder' and ${inForce("h", today)} order by h.starts_on limit 1) as "personId"
        from seat s where s.active order by s.lead desc, s.sort, s.id`,
    ),
    rows<{ id: number; parentId: number | null; name: string; sort: number }>(
      db,
      sql`select id::int as id, parent_id::int as "parentId", name, sort from org_unit where active`,
    ),
    rows<{ id: number; name: string; role: string; reportsTo: number | null; email: string | null; hash: string }>(
      db,
      sql`select id::int as id, name, role, reports_to::int as "reportsTo", email, password_hash as hash
        from person where active`,
    ),
    // The sellers with a target, the seat's or its holder's, this month or the two before.
    rows<{ id: number }>(
      db,
      sql`select s.id::int as id from seat s where s.active and s.module = 'medrep' and (
          exists (select 1 from seat_target t where t.seat_id = s.id
            and t.month >= (date_trunc('month', ${today}::date) - interval '2 months')::date)
          or exists (select 1 from sales_target t join seat_holder h on h.person_id = t.person_id and h.seat_id = s.id
            and h.kind = 'holder' and ${inForce("h", today)}
            where t.month >= (date_trunc('month', ${today}::date) - interval '2 months')::date))`,
    ),
  ]);
  const withTarget = new Set(targeted.map((one) => one.id));
  // Each box's place in the chart, read top to bottom as the Admin panel shows it.
  const unitById = new Map(units.map((unit) => [unit.id, unit]));
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
  const placeOf = (unitId: number) => place.get(unitId) ?? Number.MAX_SAFE_INTEGER;
  const byPerson = new Map(people.map((one) => [one.id, one]));
  const seatById = new Map(seats.map((seat) => [seat.seatId, seat]));
  const held = seats.filter((seat) => seat.personId !== null && unitById.has(seat.unitId));
  // A box's lead, when somebody holds it today.
  const leadOf = (unitId: number) => held.find((seat) => seat.unitId === unitId && seat.lead) ?? null;
  // Heads: each head's own box (their lead seat's), for the order.
  const headSeats = held.filter((seat) => seat.lead && seat.module === "manager");
  const headBox = new Map<number, number>();
  for (const seat of headSeats) if (!headBox.has(seat.personId as number)) headBox.set(seat.personId as number, seat.unitId);
  const headOf = (personId: number): number | null => {
    const seen = new Set<number>();
    let at = byPerson.get(personId)?.reportsTo ?? null;
    while (at !== null && !seen.has(at)) {
      seen.add(at);
      if (headBox.has(at)) return at;
      at = byPerson.get(at)?.reportsTo ?? null;
    }
    return null;
  };

  // Who stands behind the door, with the boxes to show beside their name.
  const boxes = new Map<number, Set<number>>();
  const add = (personId: number, unitId: number) => {
    const known = boxes.get(personId) ?? new Set<number>();
    known.add(unitId);
    boxes.set(personId, known);
  };
  if (door === "heads") for (const seat of headSeats) add(seat.personId as number, seat.unitId);
  else {
    for (const seat of held) if (seat.module === "team_lead") add(seat.personId as number, seat.unitId);
    // A head over sellers (with a target) with nobody leading between: the box under the head those
    // sellers sit in.
    for (const seat of seats) {
      if (seat.module !== "medrep" || !withTarget.has(seat.seatId) || !unitById.has(seat.unitId)) continue;
      const named = seat.reportsToSeat !== null ? seatById.get(seat.reportsToSeat) : undefined;
      let manager = named?.personId ? named : null;
      let channel = seat.unitId;
      for (let at: number | null = seat.unitId, steps = 0; !manager && at !== null && steps < 20; steps += 1) {
        const lead = leadOf(at);
        if (lead && lead.seatId !== seat.seatId) manager = lead;
        else {
          channel = at;
          at = unitById.get(at)?.parentId ?? null;
        }
      }
      if (manager?.module === "manager" && manager.personId !== null) add(manager.personId, manager.unitId === seat.unitId ? seat.unitId : channel);
    }
  }

  const list: (Behind & { order: [number, number, number] })[] = [];
  for (const [personId, unitIds] of boxes) {
    const one = byPerson.get(personId);
    if (!one) continue;
    const mine = held.filter((seat) => seat.personId === personId && (door === "heads" ? seat.module === "manager" && seat.lead : true));
    const login = mine.find((seat) => seat.login)?.login ?? one.email ?? "";
    if (!login) continue;
    const isHead = headBox.has(personId);
    const head = door === "leads" ? (isHead ? personId : headOf(personId)) : null;
    const inOrder = [...unitIds].sort((a, b) => placeOf(a) - placeOf(b));
    list.push({
      personId,
      hash: one.hash,
      login,
      name: one.name,
      // In the chart's order, as the Admin panel and the sales tracker read them.
      boxes: [...new Set(inOrder.map((unitId) => unitById.get(unitId)?.name).filter((name): name is string => Boolean(name)))],
      head: head !== null ? (byPerson.get(head)?.name ?? null) : null,
      order: [
        head !== null ? placeOf(headBox.get(head) ?? -1) : 0,
        // At the Team leads door a head comes first among their own.
        door === "leads" && isHead ? -1 : 0,
        Math.min(...inOrder.map(placeOf)),
      ],
    });
  }
  return list
    .sort((a, b) => a.order[0] - b.order[0] || a.order[1] - b.order[1] || a.order[2] - b.order[2] || a.name.localeCompare(b.name))
    .map(({ order: _order, ...one }) => one);
}

const shown = ({ personId: _id, hash: _hash, ...one }: Behind): DoorPerson => one;

/** The door's people the password opens (their own password, each in turn, so a wrong one costs
 *  what one sign-in does per person and no more at once). */
export async function doorPeople(db: Database, door: DoorKey, password: string): Promise<DoorPerson[]> {
  const opened: DoorPerson[] = [];
  for (const one of await behind(db, door)) if (await passwordMatches(password, one.hash)) opened.push(shown(one));
  return opened;
}
