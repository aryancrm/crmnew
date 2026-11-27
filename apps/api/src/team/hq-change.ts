// The head's HQs (Aryan, 28 Nov: "do you think the Admin should make the HQs and not Javed?"; his
// plan's phase 4, PLAN 264): on the Headquarters page the head makes an HQ, renames it, decides who
// works it (puts someone in, moves them from another HQ, or leaves it empty) and closes an empty one.
// An HQ is a selling seat of a channel's box with its territory: it stays, the person in it changes,
// and its customers, doctors, orders and sign-in ID stay with it. The seat and the moves are the
// company tree's own (org/service), so the tree, the Home and every report show the same. The head
// of the box changes it (holding a head's seat that leads it or a box above it), the CEO and the
// Admin too; a team lead sees the HQs but doesn't change them ("Javed decides").

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { Refusal } from "../http";
import { todayManila } from "../inventory/rules";
import type { Runner } from "../inventory/service";
import { change, closeSeatIn, endHoldingIn, fillSeatIn, inForce, makeSeat } from "../org/service";
import type { Role } from "../people/roles";
import type { HqPeople, Me, SeatWorks } from "../types";
import { hqBoxes, hqOf, ON_SITE, plain } from "./headquarters";

const changeable = hqBoxes;

/** Whether this person changes the HQs of this box. */
export async function mayChangeHqs(db: Runner, me: Me, unitId: number): Promise<boolean> {
  const units = await changeable(db, me);
  return units === null || units.includes(unitId);
}

async function mustChange(db: Runner, me: Me, unitId: number): Promise<void> {
  if (!(await mayChangeHqs(db, me, unitId)))
    throw new Refusal(403, "not_allowed", "Only the head makes and changes the HQs.");
}

/** An HQ's name as the team's sheet writes them: capitals, single spaces, no "|" (it parts a
 *  territory's name). */
const nameOf = (typed: string) => typed.replace(/\|/g, "/").replace(/\s+/g, " ").trim().toUpperCase();
/** A territory's first part: its channel's mark (RX, B2C). */
const prefixOf = (area: string) => area.split("|")[0]?.trim() || "HQ";

type HqSeat = {
  seatId: number;
  unitId: number;
  areaId: number;
  area: string;
  channelId: number;
  personId: number | null;
  person: string | null;
  holdingId: number | null;
};

async function hqSeat(db: Runner, seatId: number, today: string): Promise<HqSeat> {
  const [found] = await rows<HqSeat>(
    db,
    sql`select s.id::int as "seatId", s.unit_id::int as "unitId", a.id::int as "areaId", a.name as area, a.channel_id::int as "channelId",
        p.id::int as "personId", p.name as person, h.id::int as "holdingId"
      from seat s join area a on a.id = s.area_id
        left join lateral (select x.id, x.person_id from seat_holder x join person q on q.id = x.person_id and q.active
          where x.seat_id = s.id and x.kind = 'holder' and ${inForce("x", today)} order by x.starts_on desc limit 1) h on true
        left join person p on p.id = h.person_id
      where s.id = ${seatId} and s.active and not s.lead and s.module in ('medrep', 'online')`,
  );
  if (!found) throw new Refusal(404, "not_found", "That HQ isn't there any more.");
  return found;
}

/** The names of a channel's HQs (in capitals), but one. */
async function namesTaken(tx: Runner, channelId: number, exceptSeat: number | null, today: string): Promise<Set<string>> {
  const found = await rows<{ area: string; person: string | null }>(
    tx,
    sql`select a.name as area, (select p.name from seat_holder h join person p on p.id = h.person_id
          where h.seat_id = s.id and h.kind = 'holder' and ${inForce("h", today)} order by h.starts_on desc limit 1) as person
      from seat s join area a on a.id = s.area_id
      where a.channel_id = ${channelId} and s.active and not s.lead and s.module in ('medrep', 'online') and s.id is distinct from ${exceptSeat}`,
  );
  return new Set(found.map((one) => hqOf(one.area, one.person).toUpperCase()));
}

/** The territory's name for an HQ: "RX | MAKATI"; an on-site HQ's "B2C | ON SITE", numbered when
 *  the channel has more ("B2C | ON SITE | 2"). A name another HQ of the channel has is refused; the
 *  territory of a closed HQ of that name is opened again by a new HQ (its customers come back). */
async function territoryFor(
  tx: Runner,
  channelId: number,
  prefix: string,
  hq: string,
  self: { seatId: number; areaId: number } | null,
  today: string,
): Promise<{ name: string; reuse: number | null }> {
  if (hq !== ON_SITE && (await namesTaken(tx, channelId, self?.seatId ?? null, today)).has(hq))
    throw new Refusal(409, "taken", `There is already an HQ called ${hq}.`, "name");
  const existing = async (name: string) =>
    (
      await rows<{ id: number; held: boolean }>(
        tx,
        sql`select a.id::int as id, exists (select 1 from seat s where s.area_id = a.id and s.active) as held
          from area a where a.channel_id = ${channelId} and lower(a.name) = lower(${name}) limit 1`,
      )
    )[0] ?? null;
  if (hq === ON_SITE) {
    for (let n = 1; n < 500; n++) {
      const name = n === 1 ? `${prefix} | ${ON_SITE}` : `${prefix} | ${ON_SITE} | ${n}`;
      const found = await existing(name);
      if (!found || found.id === self?.areaId) return { name, reuse: null };
    }
    throw new Refusal(409, "taken", "This channel has too many ON SITE HQs.", "name");
  }
  const name = `${prefix} | ${hq}`;
  const found = await existing(name);
  if (!found || found.id === self?.areaId) return { name, reuse: null };
  if (found.held) throw new Refusal(409, "taken", `There is already an HQ called ${hq}.`, "name");
  if (self) throw new Refusal(409, "taken", `${hq} was an HQ that closed: make a new HQ called ${hq} to open it again.`, "name");
  return { name, reuse: found.id };
}

/** A territory named after the person in it ("B2C | Rachelle Upao", the on-site HQs' old names):
 *  when they leave it their name leaves it too, so the HQ keeps its own (ON SITE) for whoever comes
 *  next. */
async function unname(tx: Runner, seatId: number, person: string, today: string): Promise<void> {
  const [seat] = await rows<{ areaId: number; area: string; channelId: number }>(
    tx,
    sql`select a.id::int as "areaId", a.name as area, a.channel_id::int as "channelId"
      from seat s join area a on a.id = s.area_id where s.id = ${seatId}`,
  );
  if (!seat) return;
  const own = plain(person);
  const parts = seat.area.split("|").map((part) => part.trim()).filter(Boolean);
  if (!parts.slice(1).some((part) => plain(part) === own)) return;
  const hq = hqOf(seat.area, person);
  const prefix = prefixOf(seat.area);
  let name = `${prefix} | ${hq}`;
  if (hq === ON_SITE) name = (await territoryFor(tx, seat.channelId, prefix, ON_SITE, { seatId, areaId: seat.areaId }, today)).name;
  else {
    const [taken] = await rows<{ id: number }>(
      tx,
      sql`select id::int as id from area where channel_id = ${seat.channelId} and lower(name) = lower(${name}) and id <> ${seat.areaId}`,
    );
    if (taken) return;
  }
  await tx.execute(sql`update area set name = ${name} where id = ${seat.areaId}`);
}

type Candidate = { id: number; name: string; seatId: number | null; area: string | null; team: string | null };

/** Whom the head can put in an HQ: the people working the HQs of their boxes, and the sellers with
 *  no HQ now (someone from another head's team is moved by HR or the Admin first). */
async function candidates(db: Runner, me: Me, today: string, personId: number | null = null): Promise<Candidate[]> {
  const units = await changeable(db, me);
  if (units !== null && !units.length) throw new Refusal(403, "not_allowed", "Only the head makes and changes the HQs.");
  const inUnits = units === null ? sql`true` : sql`s.unit_id in (${sql.join(units.map((id) => sql`${id}`), sql`, `)})`;
  return rows<Candidate>(
    db,
    sql`select p.id::int as id, p.name, s.id::int as "seatId", a.name as area, u.name as team
      from person p
        left join lateral (select x.seat_id from seat_holder x join seat y on y.id = x.seat_id and y.active
          where x.person_id = p.id and x.kind = 'holder' and ${inForce("x", today)} order by x.starts_on, x.id limit 1) h on true
        left join seat s on s.id = h.seat_id
        left join area a on a.id = s.area_id
        left join org_unit u on u.id = s.unit_id
      where p.active ${personId ? sql`and p.id = ${personId}` : sql``}
        and ((s.id is not null and not s.lead and s.module in ('medrep', 'online') and ${inUnits})
          or (s.id is null and p.role in ('medrep', 'online')))
      order by p.name`,
  );
}

async function pick(tx: Runner, me: Me, personId: number, today: string): Promise<Candidate> {
  const [found] = await candidates(tx, me, today, personId);
  if (!found)
    throw new Refusal(404, "not_found", "Pick someone working one of your HQs, or a seller with no HQ now.", "personId");
  return found;
}

/** Puts a person in an HQ: out of the HQ they work now, which is left empty. */
async function moveIn(tx: Runner, me: Me, seatId: number, person: Candidate, hq: string, today: string): Promise<void> {
  if (person.seatId) await unname(tx, person.seatId, person.name, today);
  await fillSeatIn(tx, me, seatId, { personId: person.id, reason: `HQ ${hq}` }, today);
}

/** The people the head can put in an HQ, with the HQ each works now. */
export async function hqPeople(db: Database, me: Me): Promise<HqPeople> {
  const found = await candidates(db, me, todayManila());
  return {
    people: found.map((one) => ({
      id: one.id,
      name: one.name,
      seatId: one.seatId,
      hq: one.seatId && one.area ? hqOf(one.area, one.name) : null,
      team: one.team,
    })),
  };
}

/** A new HQ in a channel's box, made as its other HQs are (their job, their work, their way of
 *  naming), with the person who works it or empty. */
export async function addHq(
  db: Database,
  me: Me,
  input: { unitId: number; name: string; personId?: number | null },
): Promise<{ seatId: number }> {
  await mustChange(db, me, input.unitId);
  const hq = nameOf(input.name);
  if (!hq) throw new Refusal(400, "invalid", "Name the HQ.", "name");
  return change(db, async (tx, today) => {
    const [model] = await rows<{
      title: string;
      module: Role;
      works: SeatWorks | null;
      reportsTo: number | null;
      area: string;
      channelId: number;
    }>(
      tx,
      sql`select s.title, s.module, s.works, s.reports_to_seat_id::int as "reportsTo", a.name as area, a.channel_id::int as "channelId"
        from seat s join area a on a.id = s.area_id
        where s.unit_id = ${input.unitId} and s.active and not s.lead and s.module in ('medrep', 'online')
        order by s.sort, s.id limit 1`,
    );
    if (!model)
      throw new Refusal(400, "invalid", "This team has no HQ yet to make a new one like: its first is made on the company tree.", "unitId");
    const person = input.personId ? await pick(tx, me, input.personId, today) : null;
    const territory = await territoryFor(tx, model.channelId, prefixOf(model.area), hq, null, today);
    const areaId =
      territory.reuse ??
      (
        await rows<{ id: number }>(
          tx,
          sql`insert into area (channel_id, name) values (${model.channelId}, ${territory.name}) returning id::int as id`,
        )
      )[0]?.id ??
      null;
    const seatId = await makeSeat(tx, {
      unitId: input.unitId,
      title: model.title,
      module: model.module,
      works: model.works,
      lead: false,
      reportsToSeatId: model.reportsTo,
      areaId,
    });
    if (person) await moveIn(tx, me, seatId, person, hq, today);
    return { seatId };
  });
}

/** An HQ's new name. Its customers, doctors, orders and sales stay with it. */
export async function renameHq(db: Database, me: Me, seatId: number, input: { name: string }): Promise<void> {
  const seat = await hqSeat(db, seatId, todayManila());
  await mustChange(db, me, seat.unitId);
  const hq = nameOf(input.name);
  if (!hq) throw new Refusal(400, "invalid", "Name the HQ.", "name");
  await change(db, async (tx, today) => {
    const now = await hqSeat(tx, seatId, today);
    if (hqOf(now.area, now.person) === hq) return;
    const territory = await territoryFor(tx, now.channelId, prefixOf(now.area), hq, { seatId, areaId: now.areaId }, today);
    await tx.execute(sql`update area set name = ${territory.name} where id = ${now.areaId}`);
  });
}

/** Who works an HQ from today: someone put in (out of the HQ they worked, left empty) in place of
 *  whoever worked it, or nobody (it is left empty; the one who worked it keeps no HQ until put in
 *  one). The CRM keeps who worked it before. */
export async function setHqPerson(db: Database, me: Me, seatId: number, input: { personId: number | null }): Promise<void> {
  const seat = await hqSeat(db, seatId, todayManila());
  await mustChange(db, me, seat.unitId);
  await change(db, async (tx, today) => {
    const now = await hqSeat(tx, seatId, today);
    const hq = hqOf(now.area, now.person);
    if (input.personId !== null && input.personId === now.personId)
      throw new Refusal(409, "taken", `${now.person} already works ${hq}.`, "personId");
    if (input.personId === null && now.holdingId === null) throw new Refusal(409, "invalid", `${hq} is empty already.`);
    const person = input.personId !== null ? await pick(tx, me, input.personId, today) : null;
    if (now.holdingId !== null && now.person) {
      await unname(tx, seatId, now.person, today);
      await endHoldingIn(tx, me, now.holdingId, person ? `${person.name} works ${hq} now` : `${hq} left empty`, today);
    }
    if (person) await moveIn(tx, me, seatId, person, hq, today);
  });
}

/** Closes an empty HQ. Its customers and its history stay under its name; a new HQ of that name
 *  opens it again. */
export async function closeHq(db: Database, me: Me, seatId: number): Promise<void> {
  const seat = await hqSeat(db, seatId, todayManila());
  await mustChange(db, me, seat.unitId);
  await change(db, async (tx, today) => {
    const now = await hqSeat(tx, seatId, today);
    if (now.person)
      throw new Refusal(409, "taken", `${now.person} works ${hqOf(now.area, now.person)}: put them in another HQ, or leave it empty, first.`);
    await closeSeatIn(tx, me, seatId, today);
  });
}
