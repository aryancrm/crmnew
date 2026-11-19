// The company as units and seats (docs/architecture/new-crm-people-teams-saas.md). A unit is a
// box on the org chart; a seat is one job in it that stays when its person leaves; a holding says
// who sits in the seat from a day to a day ("acting" covers a seat for a while). Everything the
// rest of the API reads about a person (role, title, channel, area, boss) and each channel's head
// is written from here (projectOrg), so the screens keep working while the tree becomes the
// source. Only the CEO and the Admin change the tree.

import { randomBytes } from "node:crypto";
import { type SQL, sql } from "drizzle-orm";
import { hashPassword, joinPassword, passwordProblem } from "../auth/password";
import { type Database, rows } from "../db/index";
import { allow, Refusal } from "../http";
import { addDays, todayManila } from "../inventory/rules";
import { clean, day, iso, type Runner } from "../inventory/service";
import { sendMessage } from "../messages/service";
import { notify } from "../notify/service";
import { divisionOf } from "../orders/divisions";
import { isRole, ROLE_LABEL, ROLES, type Role } from "../people/roles";
import type {
  Me,
  OrgHolder,
  OrgLogin,
  OrgMenuUnit,
  OrgPersonHistory,
  OrgPersonInput,
  OrgSeat,
  OrgSeatInput,
  OrgTree,
  OrgUnit,
  OrgUnitInput,
  OrgUnitKind,
  SeatRequest,
  SeatRequestForm,
  SeatRequestInput,
} from "../types";

export const ORG_CHANGE_ROLES: Role[] = ["ceo", "admin"];

/** A holding (by its alias) in force on the day. */
export const inForce = (alias: string, today: string): SQL =>
  sql`(${sql.raw(alias)}.starts_on <= ${today}::date and (${sql.raw(alias)}.ends_on is null or ${sql.raw(alias)}.ends_on >= ${today}::date))`;

/**
 * Whom an order (alias `o`) counts for: the person holding its seat today (on a handover day the
 * one who starts, not the one leaving), else (a vacant seat,
 * or none) the MedRep named on it. My team counts by seat; Home, team sales, targets, the
 * channels and the KPIs count people by this, so one sale is never credited two ways.
 */
export const creditedTo = (today: string): SQL =>
  sql`coalesce((select ch_h.person_id from seat_holder ch_h where ch_h.seat_id = o.seat_id and ch_h.kind = 'holder'
      and ${inForce("ch_h", today)} order by ch_h.starts_on desc, ch_h.id desc limit 1), o.medrep_id)`;

export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Seat login IDs end in the company's domain: "hos1@2mginc.com". */
export const LOGIN_DOMAIN = (process.env.LOGIN_DOMAIN ?? "2mginc.com").toLowerCase();

/** The first part of a seat's login ID, by its work and its channel: hos1, rx2, tl1, fin1. */
const CHANNEL_LOGIN: Record<string, string> = {
  HOSP: "hos",
  RX: "rx",
  B2B: "b2b",
  BID: "bid",
  PAP: "pap",
  TS: "ts",
  MT: "mt",
  ONLINE: "online",
};
const MODULE_LOGIN: Record<Role, string> = {
  medrep: "medrep",
  team_lead: "tl",
  manager: "tl",
  management: "mgmt",
  finance: "fin",
  dispatch: "disp",
  inventory: "inv",
  online: "online",
  admin: "admin",
  ceo: "ceo",
  hr: "hr",
  staff: "staff",
  regulatory: "reg",
};
function loginPrefix(module: Role, channelCode: string | null): string {
  if (module === "medrep")
    return (channelCode && CHANNEL_LOGIN[channelCode]) ?? channelCode?.toLowerCase() ?? "medrep";
  return MODULE_LOGIN[module] ?? module;
}

/** The login ID typed at sign-in, as a seat's ID ("hos1" or "hos1@2mginc.com"), else null. */
export function seatLoginOf(typed: string): string | null {
  const id = typed.trim().toLowerCase();
  if (!id.includes("@")) return id || null;
  return id.endsWith(`@${LOGIN_DOMAIN}`) ? id.slice(0, -(LOGIN_DOMAIN.length + 1)) : null;
}

/** Who signs in with a seat's login ID: whoever holds the seat today. */
export async function personOfSeatLogin(
  db: Runner,
  typed: string,
  today = todayManila(),
): Promise<number | null> {
  const login = seatLoginOf(typed);
  if (!login) return null;
  const [found] = await rows<{ id: number }>(
    db,
    sql`select p.id::int as id from seat s join seat_holder h on h.seat_id = s.id and h.kind = 'holder' and ${inForce("h", today)}
        join person p on p.id = h.person_id and p.active
      where s.active and lower(s.login) = ${login} order by h.starts_on limit 1`,
  );
  return found?.id ?? null;
}

/** A password a person can read out and type once: 12 letters and digits. */
export function freshPassword(): string {
  return randomBytes(9).toString("base64url").replace(/[-_]/g, "x");
}

// ---- Writing the tree onto people and channels ----

type UnitRow = { id: number; parentId: number | null; channelId: number | null };
type SeatRow = {
  id: number;
  unitId: number;
  module: Role;
  title: string;
  lead: boolean;
  reportsToSeatId: number | null;
  areaId: number | null;
  bossId: number | null;
};
type HoldRow = { seatId: number; personId: number; kind: "holder" | "acting" };
type PersonRow = {
  id: number;
  role: Role;
  title: string | null;
  channelId: number | null;
  areaId: number | null;
  reportsTo: number | null;
};

/**
 * Writes the tree onto the people who sit in it: each person's role, title, channel, area and
 * boss come from their seat (when they hold two: a lead seat over one that leads nothing, else the
 * first one they were given), and each
 * channel's head is whoever leads its top unit. A seat's boss is the lead of its unit (a lead's:
 * of the unit above), else the seat it names; a vacant boss seat is skipped upwards and an acting
 * cover counts as its occupant. People with no seat are left as they are. Writes only what changed.
 */
export async function projectOrg(db: Runner, today = todayManila()): Promise<void> {
  const units = await rows<UnitRow>(
    db,
    sql`select id::int as id, parent_id::int as "parentId", channel_id::int as "channelId"
      from org_unit where active order by sort, id`,
  );
  if (!units.length) return;
  await fillSeatLogins(db);
  const seats = await rows<SeatRow>(
    db,
    sql`select id::int as id, unit_id::int as "unitId", module, title, lead, reports_to_seat_id::int as "reportsToSeatId",
        area_id::int as "areaId", boss_id::int as "bossId"
      from seat where active order by sort, id`,
  );
  const holds = await rows<HoldRow>(
    db,
    sql`select h.seat_id::int as "seatId", h.person_id::int as "personId", h.kind
      from seat_holder h join person p on p.id = h.person_id and p.active join seat s on s.id = h.seat_id and s.active
      where ${inForce("h", today)} order by h.starts_on, h.id`,
  );
  const people = await rows<PersonRow>(
    db,
    sql`select id::int as id, role, title, channel_id::int as "channelId", area_id::int as "areaId", reports_to::int as "reportsTo"
      from person where id in (select person_id from seat_holder h where ${inForce("h", today)})`,
  );

  const unitById = new Map(units.map((unit) => [unit.id, unit]));
  const seatById = new Map(seats.map((seat) => [seat.id, seat]));
  const leadOf = new Map<number, SeatRow>();
  for (const seat of seats)
    if (seat.lead && !leadOf.has(seat.unitId)) leadOf.set(seat.unitId, seat);
  const holderOf = new Map<number, number>();
  const actingOf = new Map<number, number>();
  const firstSeatOf = new Map<number, SeatRow>();
  for (const hold of holds) {
    if (hold.kind === "holder") {
      if (!holderOf.has(hold.seatId)) holderOf.set(hold.seatId, hold.personId);
      const seat = seatById.get(hold.seatId);
      // The seat that decides their screens: a lead seat over one that leads nothing (Reynan,
      // Government Account's coachee and TeleSales's lead, works as TeleSales's lead), else the
      // first they were given.
      const known = firstSeatOf.get(hold.personId);
      if (seat && (!known || (seat.lead && !known.lead))) firstSeatOf.set(hold.personId, seat);
    } else actingOf.set(hold.seatId, hold.personId);
  }
  const occupant = (seat: SeatRow) => actingOf.get(seat.id) ?? holderOf.get(seat.id) ?? null;
  const parentOf = (unitId: number) => unitById.get(unitId)?.parentId ?? null;

  const nextUp = (seat: SeatRow): SeatRow | null => {
    const named = seat.reportsToSeatId ? seatById.get(seat.reportsToSeatId) : undefined;
    if (named) return named;
    let unitId: number | null = seat.lead ? parentOf(seat.unitId) : seat.unitId;
    for (let guard = 0; unitId !== null && guard < 50; guard++) {
      const lead = leadOf.get(unitId);
      if (lead && lead.id !== seat.id) return lead;
      unitId = parentOf(unitId);
    }
    return null;
  };
  const bossOf = (seat: SeatRow): number | null => {
    const own = new Set([holderOf.get(seat.id), actingOf.get(seat.id)]);
    const seen = new Set([seat.id]);
    let up = nextUp(seat);
    while (up && !seen.has(up.id)) {
      seen.add(up.id);
      const who = occupant(up);
      if (who !== null && !own.has(who)) return who;
      up = nextUp(up);
    }
    return null;
  };
  const channelOf = (unitId: number): number | null => {
    let at: number | null = unitId;
    for (let guard = 0; at !== null && guard < 50; guard++) {
      const unit = unitById.get(at);
      if (!unit) return null;
      if (unit.channelId !== null) return unit.channelId;
      at = unit.parentId;
    }
    return null;
  };

  for (const seat of seats) {
    const boss = bossOf(seat);
    if (boss !== seat.bossId)
      await db.execute(sql`update seat set boss_id = ${boss} where id = ${seat.id}`);
  }
  for (const person of people) {
    const seat = firstSeatOf.get(person.id);
    if (!seat) continue;
    const want = {
      role: seat.module,
      title: seat.title,
      channelId: channelOf(seat.unitId),
      areaId: seat.areaId,
      reportsTo: bossOf(seat),
    };
    const reportsTo = want.reportsTo === person.id ? null : want.reportsTo;
    if (
      person.role !== want.role ||
      person.title !== want.title ||
      person.channelId !== want.channelId ||
      person.areaId !== want.areaId ||
      person.reportsTo !== reportsTo
    )
      await db.execute(
        sql`update person set role = ${want.role}, title = ${want.title}, channel_id = ${want.channelId},
            area_id = ${want.areaId}, reports_to = ${reportsTo} where id = ${person.id}`,
      );
  }

  // Each channel named on a unit: its head leads the top unit of that channel.
  const depth = (unitId: number) => {
    let n = 0;
    for (let at = parentOf(unitId); at !== null && n < 50; at = parentOf(at)) n++;
    return n;
  };
  const topUnit = new Map<number, UnitRow>();
  for (const unit of units) {
    if (unit.channelId === null) continue;
    const known = topUnit.get(unit.channelId);
    if (!known || depth(unit.id) < depth(known.id)) topUnit.set(unit.channelId, unit);
  }
  for (const [channelId, unit] of topUnit) {
    const lead = leadOf.get(unit.id);
    const head = lead ? occupant(lead) : null;
    await db.execute(
      sql`update channel set head_id = ${head} where id = ${channelId} and head_id is distinct from ${head}`,
    );
  }
}

/** Gives every seat without one its login ID: the next free number for its work and channel. */
export async function fillSeatLogins(db: Runner): Promise<void> {
  const missing = await rows<{ id: number; module: Role; code: string | null }>(
    db,
    sql`with recursive up as (
        select s.id as seat, u.id, u.parent_id, u.channel_id, 0 as depth from seat s join org_unit u on u.id = s.unit_id
          where s.active and s.login is null
        union all select up.seat, u.id, u.parent_id, u.channel_id, up.depth + 1 from org_unit u join up on u.id = up.parent_id where up.depth < 50)
      select s.id::int as id, s.module,
        (select ch.code from up join channel ch on ch.id = up.channel_id where up.seat = s.id order by up.depth limit 1) as code
      from seat s join org_unit u on u.id = s.unit_id where s.active and s.login is null order by u.sort, u.id, s.sort, s.id`,
  );
  if (!missing.length) return;
  const taken = new Set(
    (
      await rows<{ login: string }>(
        db,
        sql`select lower(login) as login from seat where active and login is not null`,
      )
    ).map((row) => row.login),
  );
  for (const seat of missing) {
    const prefix = loginPrefix(seat.module, seat.code);
    let login = prefix === "ceo" || prefix === "admin" ? prefix : `${prefix}1`;
    for (let n = 2; taken.has(login); n++) login = `${prefix}${n}`;
    taken.add(login);
    await db.execute(sql`update seat set login = ${login} where id = ${seat.id}`);
  }
}

// ---- Reading the tree ----

export async function orgTree(db: Database, me: Me): Promise<OrgTree> {
  allow(me, ORG_CHANGE_ROLES, "see and change the company's teams");
  const today = todayManila();
  const [units, seats, holders, unplaced, channels, areas] = await Promise.all([
    rows<
      Omit<OrgUnit, "seats" | "channel"> & {
        channelId: number | null;
        code: string | null;
        channelName: string | null;
      }
    >(
      db,
      sql`select u.id::int as id, u.name, u.kind, u.parent_id::int as "parentId", u.sort::int as sort, u.report_channel as "reportChannel",
          u.channel_id::int as "channelId", ch.code, ch.name as "channelName"
        from org_unit u left join channel ch on ch.id = u.channel_id where u.active order by u.sort, u.id`,
    ),
    rows<
      Omit<OrgSeat, "holder" | "acting" | "moduleLabel" | "area"> & {
        areaId: number | null;
        areaName: string | null;
        cities: string[] | null;
      }
    >(
      db,
      sql`select s.id::int as id, s.unit_id::int as "unitId", s.login, s.title, s.module, s.lead, s.reports_to_seat_id::int as "reportsToSeatId",
          b.name as boss, s.area_id::int as "areaId", a.name as "areaName", a.cities,
          (select count(*) from customer c where s.area_id is not null and c.area_id = s.area_id)::int as customers,
          (select count(*) from sales_order o where o.seat_id = s.id
            and o.status not in ('completed', 'cancelled', 'draft'))::int as "openOrders"
        from seat s left join person b on b.id = s.boss_id left join area a on a.id = s.area_id
        where s.active order by s.lead desc, s.sort, s.id`,
    ),
    rows<OrgHolder & { seatId: number }>(
      db,
      sql`select h.id::int as id, h.seat_id::int as "seatId", p.id::int as "personId", p.name, p.email, p.phone, h.kind,
          ${day("h.starts_on")} as "startsOn", ${day("h.ends_on")} as "endsOn", p.must_change_password as "newLogin",
          (select count(*) from seat_holder o where o.person_id = h.person_id and o.id <> h.id and ${inForce("o", today)})::int as "otherSeats",
          (select string_agg(case when o.kind = 'acting' then 'Covers ' else 'Also ' end || os.title || ' · ' || ou.name, ', ' order by o.starts_on)
            from seat_holder o join seat os on os.id = o.seat_id join org_unit ou on ou.id = os.unit_id
            where o.person_id = h.person_id and o.id <> h.id and ${inForce("o", today)}) as elsewhere
        from seat_holder h join person p on p.id = h.person_id and p.active
        where ${inForce("h", today)} order by h.starts_on, h.id`,
    ),
    rows<OrgTree["unplaced"][number]>(
      db,
      sql`select p.id::int as id, p.name, p.email, p.role, p.title from person p
        where p.active and not exists (select 1 from seat_holder h where h.person_id = p.id and ${inForce("h", today)})
        order by p.name`,
    ),
    rows<OrgTree["channels"][number]>(
      db,
      sql`select id::int as id, code, name, division, active from channel order by active desc, sort, id`,
    ),
    rows<OrgTree["areas"][number]>(
      db,
      sql`select a.id::int as id, a.name, a.channel_id::int as "channelId", a.cities,
          (select s.id::int from seat s where s.area_id = a.id and s.active limit 1) as "seatId",
          (select count(*) from customer c where c.area_id = a.id and c.active)::int as customers
        from area a order by a.name`,
    ),
  ]);
  const requests = await seatRequests(db, sql`true`);
  const holderOf = new Map<number, OrgHolder>();
  const actingOf = new Map<number, OrgHolder>();
  for (const { seatId, ...holder } of holders) {
    if (holder.kind === "holder") {
      if (!holderOf.has(seatId)) holderOf.set(seatId, holder);
    } else actingOf.set(seatId, holder);
  }
  const seatsOf = new Map<number, OrgSeat[]>();
  for (const { areaId, areaName, cities, ...seat } of seats) {
    const list = seatsOf.get(seat.unitId) ?? [];
    list.push({
      ...seat,
      moduleLabel: ROLE_LABEL[seat.module] ?? seat.module,
      area: areaId ? { id: areaId, name: areaName ?? "", cities: cities ?? [] } : null,
      holder: holderOf.get(seat.id) ?? null,
      acting: actingOf.get(seat.id) ?? null,
    });
    seatsOf.set(seat.unitId, list);
  }
  return {
    today,
    loginDomain: LOGIN_DOMAIN,
    commonPassword: joinPassword() !== null,
    units: units.map(({ channelId, code, channelName, ...unit }) => ({
      ...unit,
      channel: channelId ? { id: channelId, code: code ?? "", name: channelName ?? "" } : null,
      seats: seatsOf.get(unit.id) ?? [],
    })),
    unplaced: unplaced.map((person) => ({
      ...person,
      roleLabel: ROLE_LABEL[person.role] ?? person.role,
    })),
    channels,
    areas: areas.map((area) => ({ ...area, cities: area.cities ?? [] })),
    requests,
    modules: ROLES.map((value) => ({ value, label: ROLE_LABEL[value] })),
    can: { change: ORG_CHANGE_ROLES.includes(me.role) },
  };
}

export async function personHistory(
  db: Database,
  me: Me,
  personId: number,
): Promise<OrgPersonHistory> {
  allow(me, ORG_CHANGE_ROLES, "see a person's seats");
  const [person] = await rows<OrgPersonHistory["person"]>(
    db,
    sql`select id::int as id, name, email, phone, active, role, title from person where id = ${personId}`,
  );
  if (!person) throw new Refusal(404, "not_found", "No such person.");
  const holdings = await rows<OrgPersonHistory["holdings"][number]>(
    db,
    sql`select h.id::int as id, s.id::int as "seatId", s.title as seat, u.name as unit, h.kind,
        ${day("h.starts_on")} as "startsOn", ${day("h.ends_on")} as "endsOn", h.reason, b.name as by,
        h.end_reason as "endReason", e.name as "endedBy"
      from seat_holder h join seat s on s.id = h.seat_id join org_unit u on u.id = s.unit_id
        left join person b on b.id = h.by_person left join person e on e.id = h.ended_by
      where h.person_id = ${personId} order by h.starts_on desc, h.id desc`,
  );
  return { person, holdings };
}

// ---- Changing the tree. Each change writes the tree onto people in the same transaction. ----

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export async function change<T>(
  db: Database,
  work: (tx: Tx, today: string) => Promise<T>,
): Promise<T> {
  const today = todayManila();
  return db.transaction(async (tx) => {
    const result = await work(tx, today);
    await projectOrg(tx, today);
    return result;
  });
}

async function unitRow(tx: Runner, unitId: number) {
  const [unit] = await rows<{
    id: number;
    name: string;
    kind: OrgUnitKind;
    parentId: number | null;
  }>(
    tx,
    sql`select id::int as id, name, kind, parent_id::int as "parentId" from org_unit where id = ${unitId} and active`,
  );
  if (!unit) throw new Refusal(404, "not_found", "That team isn't there any more.", "unitId");
  return unit;
}

/** The channel a unit sells in: its own, else the nearest unit above's. */
async function unitChannel(tx: Runner, unitId: number): Promise<number | null> {
  const [found] = await rows<{ channelId: number | null }>(
    tx,
    sql`with recursive up as (
        select id, parent_id, channel_id, 0 as depth from org_unit where id = ${unitId}
        union all select u.id, u.parent_id, u.channel_id, up.depth + 1 from org_unit u join up on u.id = up.parent_id where up.depth < 50)
      select channel_id::int as "channelId" from up where channel_id is not null order by depth limit 1`,
  );
  return found?.channelId ?? null;
}

export async function seatRow(tx: Runner, seatId: number, today: string) {
  const [seat] = await rows<{
    id: number;
    unitId: number;
    title: string;
    module: Role;
    lead: boolean;
    areaId: number | null;
    holderId: number | null;
    holder: string | null;
  }>(
    tx,
    sql`select s.id::int as id, s.unit_id::int as "unitId", s.title, s.module, s.lead, s.area_id::int as "areaId",
        p.id::int as "holderId", p.name as holder
      from seat s left join seat_holder h on h.seat_id = s.id and h.kind = 'holder' and ${inForce("h", today)}
        and exists (select 1 from person q where q.id = h.person_id and q.active)
        left join person p on p.id = h.person_id
      where s.id = ${seatId} and s.active limit 1`,
  );
  if (!seat) throw new Refusal(404, "not_found", "That seat isn't there any more.", "seatId");
  return seat;
}

/** A seat a new joiner starts in on a later day: nobody else is put in it meanwhile. */
export async function refuseIfPromised(tx: Runner, seatId: number, today: string): Promise<void> {
  const [promised] = await rows<{ name: string; starts: string }>(
    tx,
    sql`select p.name, to_char(h.starts_on, 'FMDD Mon YYYY') as starts from seat_holder h join person p on p.id = h.person_id
      where h.seat_id = ${seatId} and h.kind = 'holder' and h.starts_on > ${today}::date and p.active limit 1`,
  );
  if (promised)
    throw new Refusal(
      409,
      "taken",
      `This seat is ${promised.name}'s from ${promised.starts}: they are joining.`,
      "seatId",
    );
}

async function activePerson(tx: Runner, personId: number) {
  const [person] = await rows<{ id: number; name: string; role: Role }>(
    tx,
    sql`select id::int as id, name, role from person where id = ${personId} and active`,
  );
  if (!person)
    throw new Refusal(404, "not_found", "That person isn't working here any more.", "personId");
  return person;
}

/** The area a new seat holds: one picked (not held by another seat) or one made now. */
async function seatArea(
  tx: Runner,
  unitId: number,
  input: { areaId?: number | null; newArea?: { name: string; cities: string[] } | null },
  exceptSeat: number | null = null,
): Promise<number | null> {
  if (input.newArea?.name?.trim()) {
    const channelId = await unitChannel(tx, unitId);
    if (!channelId)
      throw new Refusal(
        400,
        "invalid",
        "This team sells in no channel yet: give the team its channel first.",
        "newArea.name",
      );
    const name = input.newArea.name.trim();
    const cities = input.newArea.cities.map((city) => city.trim()).filter(Boolean);
    const [taken] = await rows<{ id: number }>(
      tx,
      sql`select id::int as id from area where channel_id = ${channelId} and lower(name) = lower(${name})`,
    );
    if (taken)
      throw new Refusal(
        409,
        "taken",
        `There is already an area called ${name}: pick it instead.`,
        "newArea.name",
      );
    const [made] = await rows<{ id: number }>(
      tx,
      sql`insert into area (channel_id, name, cities) values (${channelId}, ${name}, string_to_array(${cities.join("|")}, '|'))
        returning id::int as id`,
    );
    return made?.id ?? null;
  }
  if (!input.areaId) return null;
  const [area] = await rows<{ id: number; name: string; seat: string | null }>(
    tx,
    sql`select a.id::int as id, a.name,
        (select s.title from seat s where s.area_id = a.id and s.active and s.id is distinct from ${exceptSeat} limit 1) as seat
      from area a where a.id = ${input.areaId}`,
  );
  if (!area) throw new Refusal(404, "not_found", "That area isn't there.", "areaId");
  if (area.seat)
    throw new Refusal(
      409,
      "taken",
      `${area.name} already belongs to the seat "${area.seat}".`,
      "areaId",
    );
  return area.id;
}

async function checkReportsTo(tx: Runner, seatId: number | null | undefined, self: number | null) {
  if (!seatId) return null;
  if (seatId === self)
    throw new Refusal(400, "invalid", "A seat can't report to itself.", "reportsToSeatId");
  const [seat] = await rows<{ id: number }>(
    tx,
    sql`select id::int as id from seat where id = ${seatId} and active`,
  );
  if (!seat)
    throw new Refusal(404, "not_found", "The seat to report to isn't there.", "reportsToSeatId");
  return seat.id;
}

async function makeSeat(tx: Runner, input: OrgSeatInput): Promise<number> {
  const unit = await unitRow(tx, input.unitId);
  const title = input.title.trim();
  if (!title) throw new Refusal(400, "invalid", "Name the job (its title).", "title");
  if (!isRole(input.module))
    throw new Refusal(400, "invalid", "Pick the work this seat does.", "module");
  if (input.lead) {
    const [lead] = await rows<{ title: string }>(
      tx,
      sql`select title from seat where unit_id = ${unit.id} and active and lead limit 1`,
    );
    if (lead)
      throw new Refusal(
        409,
        "taken",
        `${unit.name} already has its lead seat ("${lead.title}"). Fill that one instead.`,
        "lead",
      );
  }
  const reportsTo = await checkReportsTo(tx, input.reportsToSeatId, null);
  const areaId = await seatArea(tx, unit.id, input);
  const [made] = await rows<{ id: number }>(
    tx,
    sql`insert into seat (unit_id, title, module, lead, reports_to_seat_id, area_id, sort)
      values (${unit.id}, ${title}, ${input.module}, ${Boolean(input.lead)}, ${reportsTo}, ${areaId},
        (select coalesce(max(sort), 0) + 1 from seat where unit_id = ${unit.id}))
      returning id::int as id`,
  );
  return made?.id as number;
}

function startDay(asked: string | null | undefined, today: string): string {
  if (!asked) return today;
  if (asked > today)
    throw new Refusal(400, "invalid", "The first day can't be in the future yet.", "startsOn");
  return asked;
}

/** A new person: their login and the seat they sit in. The password is answered once. */
export async function addPerson(db: Database, me: Me, input: OrgPersonInput): Promise<OrgLogin> {
  allow(me, ORG_CHANGE_ROLES, "add people");
  const name = input.name.trim();
  // Their own email is only a way to reach them; they sign in with the seat's login ID.
  const email = clean(input.email)?.toLowerCase() ?? null;
  if (!name) throw new Refusal(400, "invalid", "Type their name.", "name");
  if (email && !EMAIL.test(email))
    throw new Refusal(
      400,
      "invalid",
      "Type an email like name@gmail.com, or leave it empty.",
      "email",
    );
  const typed = clean(input.password);
  if (typed) {
    const problem = passwordProblem(typed);
    if (problem) throw new Refusal(400, "invalid", problem, "password");
  }
  // Nothing typed: the company's common password, kept as it is (Aryan, 17 Nov); without one set,
  // a fresh one they change at their first sign-in.
  const common = typed ? null : joinPassword();
  const password = typed ?? common ?? freshPassword();
  const hash = await hashPassword(password);
  const result = await change(db, async (tx, today) => {
    const [used] = email
      ? await rows<{ name: string; active: boolean }>(
          tx,
          sql`select name, active from person where lower(email) = ${email}`,
        )
      : [];
    if (used)
      throw new Refusal(
        409,
        "taken",
        used.active
          ? `${email} is already ${used.name}'s email.`
          : `${email} was ${used.name}'s email: use another one.`,
        "email",
      );
    let seatId: number;
    if (input.seatId) {
      const seat = await seatRow(tx, input.seatId, today);
      if (seat.holderId)
        throw new Refusal(
          409,
          "taken",
          `${seat.holder} already sits in "${seat.title}".`,
          "seatId",
        );
      await refuseIfPromised(tx, seat.id, today);
      seatId = seat.id;
    } else {
      if (!input.unitId) throw new Refusal(400, "invalid", "Pick the team they join.", "unitId");
      if (!input.module) throw new Refusal(400, "invalid", "Pick the work they do.", "module");
      seatId = await makeSeat(tx, {
        unitId: input.unitId,
        title: input.title ?? "",
        module: input.module,
        lead: input.lead,
        reportsToSeatId: input.reportsToSeatId,
        areaId: input.areaId,
        newArea: input.newArea,
      });
    }
    const seat = await seatRow(tx, seatId, today);
    const [made] = await rows<{ id: number }>(
      tx,
      sql`insert into person (name, email, phone, title, role, password_hash, must_change_password)
        values (${name}, ${email}, ${clean(input.phone)}, ${seat.title}, ${seat.module}, ${hash}, ${!common})
        returning id::int as id`,
    );
    const personId = made?.id as number;
    const starts = startDay(input.startsOn, today);
    await tx.execute(
      sql`insert into seat_holder (seat_id, person_id, kind, starts_on, reason, by_person)
        values (${seatId}, ${personId}, 'holder', ${starts}::date, 'Joined', ${me.id})`,
    );
    // Everyone has an employee record (with the employee ID when it is known); HR fills in the rest.
    const code = clean(input.employeeCode)?.toUpperCase() ?? null;
    if (code) {
      const [taken] = await rows<{ name: string }>(
        tx,
        sql`select p.name from employee e join person p on p.id = e.person_id where upper(e.employee_code) = ${code} and p.active`,
      );
      if (taken) throw new Refusal(409, "taken", `${code} is already ${taken.name}'s employee ID.`, "employeeCode");
    }
    await tx.execute(
      sql`insert into employee (person_id, hire_date, position, mobile, employee_code, created_by)
        values (${personId}, ${starts}::date, ${seat.title}, ${clean(input.phone)}, ${code}, ${me.id})`,
    );
    // Its login ID now signs this person in.
    await fillSeatLogins(tx);
    const [login] = await rows<{ login: string | null }>(
      tx,
      sql`select login from seat where id = ${seatId}`,
    );
    return { personId, seatId, login: login?.login ? `${login.login}@${LOGIN_DOMAIN}` : null };
  });
  return { ...result, email, password: typed ? null : password, common: Boolean(common) };
}

/** A vacant seat (to fill later). */
export async function addSeat(
  db: Database,
  me: Me,
  input: OrgSeatInput,
): Promise<{ seatId: number }> {
  allow(me, ORG_CHANGE_ROLES, "add seats");
  return change(db, async (tx) => ({ seatId: await makeSeat(tx, input) }));
}

export async function updateSeat(
  db: Database,
  me: Me,
  seatId: number,
  input: Partial<OrgSeatInput>,
): Promise<void> {
  allow(me, ORG_CHANGE_ROLES, "change seats");
  await change(db, async (tx, today) => {
    const seat = await seatRow(tx, seatId, today);
    const unitId = input.unitId ?? seat.unitId;
    if (input.unitId) await unitRow(tx, input.unitId);
    const title = input.title === undefined ? seat.title : input.title.trim();
    if (!title) throw new Refusal(400, "invalid", "Name the job (its title).", "title");
    const module = input.module ?? seat.module;
    if (!isRole(module))
      throw new Refusal(400, "invalid", "Pick the work this seat does.", "module");
    const lead = input.lead ?? seat.lead;
    if (lead && (!seat.lead || unitId !== seat.unitId)) {
      const [other] = await rows<{ title: string }>(
        tx,
        sql`select title from seat where unit_id = ${unitId} and active and lead and id <> ${seat.id} limit 1`,
      );
      if (other)
        throw new Refusal(
          409,
          "taken",
          `That team already has its lead seat ("${other.title}").`,
          "lead",
        );
    }
    const reportsTo =
      input.reportsToSeatId === undefined
        ? undefined
        : await checkReportsTo(tx, input.reportsToSeatId, seat.id);
    const areaId =
      input.areaId === undefined && input.newArea === undefined
        ? seat.areaId
        : await seatArea(tx, unitId, input, seat.id);
    await tx.execute(
      sql`update seat set unit_id = ${unitId}, title = ${title}, module = ${module}, lead = ${lead}, area_id = ${areaId}
        ${reportsTo === undefined ? sql`` : sql`, reports_to_seat_id = ${reportsTo}`}
        where id = ${seat.id}`,
    );
    // Whoever lost the area keeps no customers by it.
    if (seat.areaId && seat.areaId !== areaId)
      await tx.execute(sql`update person set area_id = null where area_id = ${seat.areaId}`);
  });
}

/** Closes a vacant seat. Its area is free for another seat; its history stays. */
export async function closeSeat(db: Database, me: Me, seatId: number): Promise<void> {
  allow(me, ORG_CHANGE_ROLES, "close seats");
  await change(db, async (tx, today) => {
    const seat = await seatRow(tx, seatId, today);
    if (seat.holderId)
      throw new Refusal(
        409,
        "taken",
        `${seat.holder} sits in "${seat.title}": move them or mark them as left first.`,
      );
    const [reporting] = await rows<{ n: number }>(
      tx,
      sql`select count(*)::int as n from seat where reports_to_seat_id = ${seat.id} and active`,
    );
    if (reporting?.n)
      throw new Refusal(
        409,
        "in_use",
        `${reporting.n} seat${reporting.n === 1 ? " reports" : "s report"} to "${seat.title}": point them elsewhere first.`,
      );
    await tx.execute(
      sql`update seat_holder set ends_on = greatest(${addDays(today, -1)}::date, starts_on - 1), end_reason = 'Seat closed', ended_by = ${me.id}
        where seat_id = ${seat.id} and (ends_on is null or ends_on >= ${today}::date)`,
    );
    await tx.execute(sql`update seat set active = false, closed_at = now() where id = ${seat.id}`);
  });
}

/** A person already here sits in a vacant seat: moving out of their seat, or keeping it too. */
export async function fillSeat(
  db: Database,
  me: Me,
  seatId: number,
  input: {
    personId: number;
    keepOther?: boolean;
    reason?: string | null;
    startsOn?: string | null;
  },
): Promise<void> {
  allow(me, ORG_CHANGE_ROLES, "move people");
  await change(db, async (tx, today) => {
    const seat = await seatRow(tx, seatId, today);
    if (seat.holderId === input.personId)
      throw new Refusal(409, "taken", `${seat.holder} already sits there.`);
    if (seat.holderId)
      throw new Refusal(
        409,
        "taken",
        `${seat.holder} sits in "${seat.title}": it isn't vacant.`,
        "seatId",
      );
    await refuseIfPromised(tx, seat.id, today);
    const person = await activePerson(tx, input.personId);
    const starts = startDay(input.startsOn, today);
    const reason = clean(input.reason);
    if (!input.keepOther)
      await tx.execute(
        sql`update seat_holder set ends_on = greatest(${addDays(starts, -1)}::date, starts_on - 1),
            end_reason = ${reason ?? `Moved to ${seat.title}`}, ended_by = ${me.id}
          where person_id = ${person.id} and kind = 'holder' and (ends_on is null or ends_on >= ${starts}::date)`,
      );
    // Covering the seat until now ends with taking it.
    await tx.execute(
      sql`update seat_holder set ends_on = greatest(${addDays(starts, -1)}::date, starts_on - 1), end_reason = 'Took the seat', ended_by = ${me.id}
        where seat_id = ${seat.id} and kind = 'acting' and person_id = ${person.id} and (ends_on is null or ends_on >= ${starts}::date)`,
    );
    await tx.execute(
      sql`insert into seat_holder (seat_id, person_id, kind, starts_on, reason, by_person)
        values (${seat.id}, ${person.id}, 'holder', ${starts}::date, ${reason ?? (input.keepOther ? "Second seat" : "Moved")}, ${me.id})`,
    );
    // The seat's targets come with it, from the month they start (not over one already theirs).
    await tx.execute(
      sql`insert into sales_target (person_id, month, amount, set_by)
        select ${person.id}, t.month, t.amount, t.set_by from seat_target t
        where t.seat_id = ${seat.id} and t.month >= date_trunc('month', ${starts}::date)::date
        on conflict (person_id, month) do nothing`,
    );
  });
}

/** Someone covers a seat until a day (while it is empty or its person is away). */
export async function coverSeat(
  db: Database,
  me: Me,
  seatId: number,
  input: { personId: number; until: string; reason?: string | null },
): Promise<void> {
  allow(me, ORG_CHANGE_ROLES, "arrange cover");
  await change(db, async (tx, today) => {
    const seat = await seatRow(tx, seatId, today);
    const person = await activePerson(tx, input.personId);
    if (seat.holderId === person.id)
      throw new Refusal(
        409,
        "invalid",
        `${person.name} already sits in "${seat.title}".`,
        "personId",
      );
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.until) || input.until < today)
      throw new Refusal(400, "invalid", "Pick the last day of the cover: today or later.", "until");
    await tx.execute(
      sql`update seat_holder set ends_on = greatest(${addDays(today, -1)}::date, starts_on - 1), end_reason = 'Another cover', ended_by = ${me.id}
        where seat_id = ${seat.id} and kind = 'acting' and (ends_on is null or ends_on >= ${today}::date)`,
    );
    await tx.execute(
      sql`insert into seat_holder (seat_id, person_id, kind, starts_on, ends_on, reason, by_person)
        values (${seat.id}, ${person.id}, 'acting', ${today}::date, ${input.until}::date, ${clean(input.reason) ?? "Cover"}, ${me.id})`,
    );
  });
}

/** Ends one holding now: a cover ends early, or someone steps out of a seat but stays. */
export async function endHolding(
  db: Database,
  me: Me,
  holdingId: number,
  reason?: string | null,
): Promise<void> {
  allow(me, ORG_CHANGE_ROLES, "end a cover");
  await change(db, async (tx, today) => {
    const [found] = await rows<{ id: number }>(
      tx,
      sql`select id::int as id from seat_holder h where id = ${holdingId} and ${inForce("h", today)}`,
    );
    if (!found) throw new Refusal(404, "not_found", "That isn't in force any more.");
    await tx.execute(
      sql`update seat_holder set ends_on = greatest(${addDays(today, -1)}::date, starts_on - 1),
          end_reason = ${clean(reason) ?? "Ended"}, ended_by = ${me.id} where id = ${holdingId}`,
    );
  });
}

/** Someone leaves the company: their seats stay, vacant; their login is switched off. */
export async function personLeaves(
  db: Database,
  me: Me,
  personId: number,
  input: { reason?: string | null; lastDay?: string | null },
  roles: readonly Role[] = ORG_CHANGE_ROLES,
): Promise<{ vacant: string[] }> {
  allow(me, roles, "mark people as left");
  if (personId === me.id) throw new Refusal(400, "invalid", "You can't mark yourself as left.");
  return change(db, async (tx, today) => {
    const person = await activePerson(tx, personId);
    if (person.role === "ceo" && me.role !== "ceo")
      throw new Refusal(403, "not_allowed", "Only the CEO can change the CEO's seat.");
    const lastDay = input.lastDay ?? today;
    if (lastDay > today)
      throw new Refusal(400, "invalid", "The last day can't be in the future yet.", "lastDay");
    const vacant = await rows<{ title: string }>(
      tx,
      sql`select s.title from seat_holder h join seat s on s.id = h.seat_id
        where h.person_id = ${person.id} and h.kind = 'holder' and ${inForce("h", today)} order by s.title`,
    );
    await tx.execute(
      sql`update seat_holder set ends_on = greatest(${lastDay}::date, starts_on - 1),
          end_reason = ${clean(input.reason) ?? "Left the company"}, ended_by = ${me.id}
        where person_id = ${person.id} and (ends_on is null or ends_on > ${lastDay}::date)`,
    );
    await tx.execute(sql`update person set active = false where id = ${person.id}`);
    await tx.execute(sql`delete from session where person_id = ${person.id}`);
    // The record stays, marked left with the day and why.
    await tx.execute(
      sql`update employee set status = 'left', left_on = ${lastDay}::date,
          left_reason = ${clean(input.reason) ?? "Left the company"}, updated_at = now(), updated_by = ${me.id}
        where person_id = ${person.id}`,
    );
    return { vacant: vacant.map((seat) => seat.title) };
  });
}

/** A new password for someone who forgot theirs, shown once; they change it when they sign in. */
export async function resetPassword(db: Database, me: Me, personId: number): Promise<OrgLogin> {
  allow(me, ORG_CHANGE_ROLES, "give a new password");
  // Back to the company's common password when there is one; else a fresh one to change.
  const common = joinPassword();
  const password = common ?? freshPassword();
  const hash = await hashPassword(password);
  const [person] = await rows<{ id: number; email: string | null }>(
    db,
    sql`update person set password_hash = ${hash}, must_change_password = ${!common}, failed_logins = 0, locked_until = null
      where id = ${personId} and active returning id::int as id, email`,
  );
  if (!person) throw new Refusal(404, "not_found", "That person isn't working here any more.");
  await db.execute(sql`delete from session where person_id = ${person.id}`);
  const [seat] = await rows<{ id: number; login: string | null }>(
    db,
    sql`select s.id::int as id, s.login from seat_holder h join seat s on s.id = h.seat_id and s.active
      where h.person_id = ${person.id} and h.kind = 'holder' and ${inForce("h", todayManila())} order by h.starts_on limit 1`,
  );
  return {
    personId: person.id,
    seatId: seat?.id ?? null,
    login: seat?.login ? `${seat.login}@${LOGIN_DOMAIN}` : person.email,
    email: person.email,
    password,
    common: Boolean(common),
  };
}

const CHANNEL_CODE = /^[A-Z0-9&]{2,12}$/;

/** A new sales channel (the Admin): its code, name and Division, and its own box at the top of the
 *  company, where its head, team leads and MedReps go. Everything that reads channels (sales,
 *  targets, the CEO's figures) takes it from there. */
export async function addChannel(
  db: Database,
  me: Me,
  input: { code: string; name: string; division?: string | null },
): Promise<{ channelId: number; unitId: number }> {
  allow(me, ORG_CHANGE_ROLES, "add channels");
  const code = input.code.trim().toUpperCase();
  const name = input.name.trim();
  if (!CHANNEL_CODE.test(code))
    throw new Refusal(
      400,
      "invalid",
      "A short code: 2 to 12 letters or digits, like HOSP.",
      "code",
    );
  if (!name) throw new Refusal(400, "invalid", "Name the channel.", "name");
  const typedDivision = clean(input.division);
  const division = divisionOf(typedDivision);
  if (typedDivision && !division)
    throw new Refusal(400, "invalid", "Pick the Division from the list.", "division");
  return change(db, async (tx) => {
    const [taken] = await rows<{ id: number }>(
      tx,
      sql`select id::int as id from channel where upper(code) = ${code} or lower(name) = lower(${name})`,
    );
    if (taken)
      throw new Refusal(409, "taken", "A channel with that code or name is already there.", "code");
    const [sort] = await rows<{ next: number }>(
      tx,
      sql`select coalesce(max(sort), 0)::int + 1 as next from channel`,
    );
    const [made] = await rows<{ id: number }>(
      tx,
      sql`insert into channel (code, name, sort, division) values (${code}, ${name}, ${sort?.next ?? 1}, ${division})
        returning id::int as id`,
    );
    const [company] = await rows<{ id: number }>(
      tx,
      sql`select id::int as id from org_unit where kind = 'company'`,
    );
    if (!company) throw new Refusal(409, "not_now", "The company's tree isn't set up yet.");
    const [box] = await rows<{ id: number }>(
      tx,
      sql`insert into org_unit (name, kind, parent_id, channel_id, sort)
        values (${name}, 'business', ${company.id}, ${made?.id}, ${sort?.next ?? 1}) returning id::int as id`,
    );
    return { channelId: made?.id as number, unitId: box?.id as number };
  });
}

/** Rename a channel, set its Division, or take it out of use (only once nobody sits in it). */
export async function updateChannel(
  db: Database,
  me: Me,
  id: number,
  input: { name?: string; division?: string | null; active?: boolean },
): Promise<void> {
  allow(me, ORG_CHANGE_ROLES, "change channels");
  const typedDivision = input.division === undefined ? undefined : clean(input.division);
  const division = typedDivision === undefined ? undefined : divisionOf(typedDivision);
  if (typedDivision && !division)
    throw new Refusal(400, "invalid", "Pick the Division from the list.", "division");
  await change(db, async (tx) => {
    const [channel] = await rows<{ id: number; name: string }>(
      tx,
      sql`select id::int as id, name from channel where id = ${id}`,
    );
    if (!channel) throw new Refusal(404, "not_found", "No such channel.");
    if (input.active === false) {
      const [busy] = await rows<{ n: number }>(
        tx,
        sql`select count(*)::int as n from person where active and channel_id = ${id}`,
      );
      if ((busy?.n ?? 0) > 0)
        throw new Refusal(
          409,
          "not_now",
          "People still work in this channel: move them first.",
          "active",
        );
    }
    const name = input.name?.trim();
    await tx.execute(
      sql`update channel set name = ${name || channel.name},
          division = ${division === undefined ? sql`division` : division},
          active = ${input.active ?? sql`active`}
        where id = ${id}`,
    );
    if (name)
      await tx.execute(
        sql`update org_unit set name = ${name} where channel_id = ${id} and kind = 'business' and name = ${channel.name}`,
      );
  });
}

export async function addUnit(
  db: Database,
  me: Me,
  input: OrgUnitInput,
): Promise<{ unitId: number }> {
  allow(me, ORG_CHANGE_ROLES, "add teams");
  return change(db, async (tx) => {
    const parent = await unitRow(tx, input.parentId);
    const name = input.name.trim();
    if (!name) throw new Refusal(400, "invalid", "Name the team.", "name");
    const [same] = await rows<{ id: number }>(
      tx,
      sql`select id::int as id from org_unit where parent_id = ${parent.id} and active and lower(name) = lower(${name})`,
    );
    if (same) throw new Refusal(409, "taken", `${parent.name} already has ${name}.`, "name");
    const [made] = await rows<{ id: number }>(
      tx,
      sql`insert into org_unit (name, kind, parent_id, channel_id, sort)
        values (${name}, ${input.kind}, ${parent.id}, ${input.channelId ?? null},
          (select coalesce(max(sort), 0) + 1 from org_unit where parent_id = ${parent.id}))
        returning id::int as id`,
    );
    return { unitId: made?.id as number };
  });
}

export async function updateUnit(
  db: Database,
  me: Me,
  unitId: number,
  input: { name?: string; channelId?: number | null; parentId?: number; reportChannel?: string | null },
): Promise<void> {
  allow(me, ORG_CHANGE_ROLES, "change teams");
  await change(db, async (tx) => {
    const unit = await unitRow(tx, unitId);
    if (input.parentId !== undefined && input.parentId !== unit.parentId) {
      if (unit.kind === "company")
        throw new Refusal(400, "invalid", "The company sits at the top.", "parentId");
      const [loop] = await rows<{ id: number }>(
        tx,
        sql`with recursive up as (select id, parent_id from org_unit where id = ${input.parentId}
            union all select u.id, u.parent_id from org_unit u join up on u.id = up.parent_id)
          select id::int as id from up where id = ${unit.id} limit 1`,
      );
      if (loop)
        throw new Refusal(400, "invalid", `${unit.name} can't go under its own team.`, "parentId");
      const parent = await unitRow(tx, input.parentId);
      // Straight under the company a line or team stands as a business of its own.
      if (parent.kind === "company" && (unit.kind === "line" || unit.kind === "team"))
        await tx.execute(sql`update org_unit set kind = 'business' where id = ${unit.id}`);
    }
    const name = input.name === undefined ? unit.name : input.name.trim();
    if (!name) throw new Refusal(400, "invalid", "Name the team.", "name");
    await tx.execute(
      sql`update org_unit set name = ${name}
        ${input.channelId === undefined ? sql`` : sql`, channel_id = ${input.channelId}`}
        ${input.parentId === undefined ? sql`` : sql`, parent_id = ${input.parentId}`}
        ${input.reportChannel === undefined ? sql`` : sql`, report_channel = ${input.reportChannel}`}
        where id = ${unit.id}`,
    );
  });
}

export async function closeUnit(db: Database, me: Me, unitId: number): Promise<void> {
  allow(me, ORG_CHANGE_ROLES, "close teams");
  await change(db, async (tx) => {
    const unit = await unitRow(tx, unitId);
    if (unit.kind === "company") throw new Refusal(400, "invalid", "The company can't be closed.");
    const [inside] = await rows<{ seats: number; units: number }>(
      tx,
      sql`select (select count(*) from seat where unit_id = ${unit.id} and active)::int as seats,
          (select count(*) from org_unit where parent_id = ${unit.id} and active)::int as units`,
    );
    if (inside?.seats || inside?.units)
      throw new Refusal(
        409,
        "in_use",
        `${unit.name} still has seats or teams in it: close or move them first.`,
      );
    await tx.execute(sql`update org_unit set active = false where id = ${unit.id}`);
  });
}

/** Orders from before the tree get their seat, by the same rule as a new order: the seat with an
 *  area their MedRep sits in, else the seat of the customer's area, else any seat the MedRep holds. */
export async function fillOrderSeats(db: Runner, today = todayManila()): Promise<void> {
  await db.execute(
    sql`update sales_order o set seat_id = coalesce(
        (select h.seat_id from seat_holder h join seat s on s.id = h.seat_id and s.active and s.area_id is not null
          where h.person_id = o.medrep_id and h.kind = 'holder' and ${inForce("h", today)} order by h.starts_on limit 1),
        (select s.id from customer c join seat s on s.area_id = c.area_id and s.active where c.id = o.customer_id limit 1),
        (select h.seat_id from seat_holder h join seat s on s.id = h.seat_id and s.active
          where h.person_id = o.medrep_id and h.kind = 'holder' and ${inForce("h", today)} order by h.starts_on limit 1))
      where o.seat_id is null`,
  );
}

// ---- Areas ----

/** Customers of the area's cities who have no area yet join it. */
/** The kinds of customer each channel's areas look after: a hospital territory takes the city's
 *  hospitals, not its patients or drugstores (with Zoho's 90,000 customers a city holds all kinds). */
const CHANNEL_KINDS: Record<string, string[]> = {
  HOSP: ["hospital", "government"],
  RX: ["doctor"],
  B2B: ["drugstore", "distributor"],
  BID: ["government", "hospital"],
  MT: ["drugstore"],
};

async function claimCustomers(tx: Runner, areaId: number, cities: string[]): Promise<void> {
  if (!cities.length) return;
  await tx.execute(
    sql`update customer set area_id = ${areaId} where area_id is null
      and lower(city) = any(string_to_array(${cities.map((city) => city.toLowerCase()).join("|")}, '|'))
      and kind = any(string_to_array(coalesce((select case c.code ${sql.raw(
        Object.entries(CHANNEL_KINDS)
          .map(([code, kinds]) => `when '${code}' then '${kinds.join("|")}'`)
          .join(" "),
      )} end from area a join channel c on c.id = a.channel_id where a.id = ${areaId}), ''), '|'))`,
  );
}

const citiesOf = (cities: string[]) => [
  ...new Set(cities.map((city) => city.trim()).filter(Boolean)),
];

/** A new area in a channel: its name and the cities in it. */
/** A city belongs to one area of a channel: else two MedReps would claim the same customers. */
async function citiesFree(
  tx: Runner,
  channelId: number,
  cities: string[],
  except: number | null,
): Promise<void> {
  if (!cities.length) return;
  const [taken] = await rows<{ city: string; area: string }>(
    tx,
    sql`select c.city, a.name as area from area a, unnest(a.cities) as c(city)
      where a.channel_id = ${channelId} ${except ? sql`and a.id <> ${except}` : sql``}
        and lower(c.city) in (${sql.join(
          cities.map((city) => sql`${city.toLowerCase()}`),
          sql`, `,
        )})
      limit 1`,
  );
  if (taken)
    throw new Refusal(
      409,
      "taken",
      `${taken.city} is already in the area ${taken.area}. Take it out there first, or pick another city.`,
      "cities",
    );
}

export async function addArea(
  db: Database,
  me: Me,
  input: { channelId: number; name: string; cities: string[] },
): Promise<{ areaId: number }> {
  allow(me, ORG_CHANGE_ROLES, "add areas");
  const name = input.name.trim();
  if (!name) throw new Refusal(400, "invalid", "Name the area.", "name");
  const cities = citiesOf(input.cities);
  return db.transaction(async (tx) => {
    const [taken] = await rows<{ id: number }>(
      tx,
      sql`select id::int as id from area where channel_id = ${input.channelId} and lower(name) = lower(${name})`,
    );
    if (taken)
      throw new Refusal(
        409,
        "taken",
        `There is already an area called ${name} in this channel.`,
        "name",
      );
    await citiesFree(tx, input.channelId, cities, null);
    const [made] = await rows<{ id: number }>(
      tx,
      sql`insert into area (channel_id, name, cities) values (${input.channelId}, ${name}, string_to_array(${cities.join("|")}, '|'))
        returning id::int as id`,
    );
    const areaId = made?.id as number;
    await claimCustomers(tx, areaId, cities);
    return { areaId };
  });
}

/** An area renamed or its cities changed. Customers already in it stay in it. */
export async function updateArea(
  db: Database,
  me: Me,
  areaId: number,
  input: { name?: string; cities?: string[] },
): Promise<void> {
  allow(me, ORG_CHANGE_ROLES, "change areas");
  await db.transaction(async (tx) => {
    const [area] = await rows<{ id: number; name: string; channelId: number }>(
      tx,
      sql`select id::int as id, name, channel_id::int as "channelId" from area where id = ${areaId}`,
    );
    if (!area) throw new Refusal(404, "not_found", "That area isn't there.");
    const name = input.name === undefined ? area.name : input.name.trim();
    if (!name) throw new Refusal(400, "invalid", "Name the area.", "name");
    const [taken] = await rows<{ id: number }>(
      tx,
      sql`select id::int as id from area where channel_id = ${area.channelId} and lower(name) = lower(${name}) and id <> ${areaId}`,
    );
    if (taken)
      throw new Refusal(
        409,
        "taken",
        `There is already an area called ${name} in this channel.`,
        "name",
      );
    const cities = input.cities === undefined ? null : citiesOf(input.cities);
    if (cities) await citiesFree(tx, area.channelId, cities, area.id);
    await tx.execute(
      sql`update area set name = ${name}
        ${cities === null ? sql`` : sql`, cities = string_to_array(${cities.join("|")}, '|')`}
        where id = ${areaId}`,
    );
    if (cities) await claimCustomers(tx, areaId, cities);
  });
}

// ---- A team lead asks for a new person; the CEO or the Admin decides ----

/** The boxes a lead leads (holding or covering a lead seat) and every box under them. */
export async function ledUnits(db: Runner, me: Me): Promise<number[]> {
  const found = await rows<{ id: number }>(
    db,
    sql`with recursive down as (
        select s.unit_id as id from seat_holder h join seat s on s.id = h.seat_id and s.active and s.lead
        where h.person_id = ${me.id} and ${inForce("h", todayManila())}
        union all select u.id from org_unit u join down on u.parent_id = down.id where u.active)
      select distinct id::int as id from down`,
  );
  return found.map((row) => row.id);
}

/** The teams a sidebar lists under the person's Company / My team: the CEO's and the Admin's the
 *  company's divisions and the boxes right under them; a lead's the boxes they lead (the top ones)
 *  and those right under. Each with how many sit in it. */
export async function menuUnits(
  db: Runner,
  me: Me,
): Promise<{ units: OrgMenuUnit[]; openRequests: number; whole: boolean }> {
  const whole = me.role === "ceo" || me.role === "admin";
  const led = whole ? [] : await ledUnits(db, me);
  if (!whole && !led.length) return { units: [], openRequests: 0, whole };
  // The CEO's and the Admin's: asks waiting for them; a lead's: their own still waiting.
  const [open] = await rows<{ n: number }>(
    db,
    sql`select count(*)::int as n from seat_request where status = 'open' ${whole ? sql`` : sql`and asked_by = ${me.id}`}`,
  );
  const today = todayManila();
  const tops = whole
    ? sql`select u.id from org_unit u join org_unit c on c.id = u.parent_id and c.kind = 'company'
        left join channel ch on ch.id = u.channel_id where u.active and coalesce(ch.active, true)`
    : sql`select u.id from org_unit u where u.id in (${sql.join(
        led.map((id) => sql`${id}`),
        sql`, `,
      )}) and (u.parent_id is null or u.parent_id not in (${sql.join(
        led.map((id) => sql`${id}`),
        sql`, `,
      )}))`;
  const units = await rows<OrgMenuUnit>(
    db,
    // Every box under the lead's own, at any depth (the sidebar shows two levels; the team switch
    // on My team goes down the chart: Sales & Marketing › B2B Telesales › CRR, NBD).
    sql`with recursive top as (${tops}),
        shown as (
          select u.id, u.parent_id, 0 as level, u.sort, u.name, u.id as top_id from org_unit u where u.id in (select id from top)
          union all
          select u.id, u.parent_id, s.level + 1, u.sort, u.name, s.top_id from org_unit u join shown s on u.parent_id = s.id
          where u.active and s.level < 8
        )
      select s.id::int as id, s.name, s.level::int as level, s.top_id::int as "topId", s.parent_id::int as "parentId",
        (select p.name from seat st join seat_holder h on h.seat_id = st.id and h.kind = 'holder' and ${inForce("h", today)}
          join person p on p.id = h.person_id where st.unit_id = s.id and st.active and st.lead order by st.id limit 1) as lead,
        (with recursive down as (select s.id as id union all select u.id from org_unit u join down on u.parent_id = down.id where u.active)
          select count(distinct h.person_id)::int from seat_holder h join seat st on st.id = h.seat_id and st.active
          where st.unit_id in (select id from down) and ${inForce("h", today)}) as people
      from shown s
      order by (select t.sort from org_unit t where t.id = s.top_id), (select t.name from org_unit t where t.id = s.top_id), s.level, s.sort, s.name`,
  );
  return { units, openRequests: open?.n ?? 0, whole };
}

async function seatRequests(db: Runner, where: SQL): Promise<SeatRequest[]> {
  const found = await rows<
    SeatRequest & { newAreaName: string | null; newAreaCities: string[] | null }
  >(
    db,
    sql`select r.id::int as id, r.kind, r.unit_id::int as "unitId", u.name as unit, r.module, r.title, a.name as area,
        lp.name as "leadPerson",
        (select concat(coalesce(hp.name, 'Empty seat'), ' (', fs.title, ' · ', fu.name, ')') from seat fs join org_unit fu on fu.id = fs.unit_id
          left join seat_holder hh on hh.seat_id = fs.id and hh.kind = 'holder' and ${inForce("hh", todayManila())}
          left join person hp on hp.id = hh.person_id where fs.id = r.for_seat_id limit 1) as "forSeat",
        r.new_area_name as "newAreaName", r.new_area_cities as "newAreaCities", r.person_name as "personName",
        r.person_phone as "personPhone", r.reason, r.status, b.name as "askedBy", ${iso("r.asked_at")} as "askedAt",
        d.name as "decidedBy", ${iso("r.decided_at")} as "decidedAt", r.answer
      from seat_request r join org_unit u on u.id = r.unit_id join person b on b.id = r.asked_by
        left join person d on d.id = r.decided_by left join area a on a.id = r.area_id
        left join person lp on lp.id = r.lead_person_id
      where ${where}
      order by (r.status = 'open') desc, r.asked_at desc limit 100`,
  );
  return found.map(({ newAreaName, newAreaCities, ...row }) => ({
    ...row,
    newArea: newAreaName ? { name: newAreaName, cities: newAreaCities ?? [] } : null,
  }));
}

export async function seatRequestForm(db: Database, me: Me): Promise<SeatRequestForm> {
  const unitIds = await ledUnits(db, me);
  if (!unitIds.length)
    throw new Refusal(403, "not_allowed", "Only a team lead asks for new people for their team.");
  const list = sql.join(
    unitIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const units = await rows<{ id: number; name: string; channelId: number | null }>(
    db,
    sql`select u.id::int as id, u.name, u.channel_id::int as "channelId" from org_unit u where u.id in (${list}) order by u.sort, u.id`,
  );
  const withChannel = await Promise.all(
    units.map(async (unit) => {
      const channelId = await unitChannel(db, unit.id);
      const [channel] = channelId
        ? await rows<{ code: string }>(db, sql`select code from channel where id = ${channelId}`)
        : [];
      return { id: unit.id, name: unit.name, channel: channel?.code ?? null, channelId };
    }),
  );
  const channels = [
    ...new Set(withChannel.flatMap((unit) => (unit.channelId ? [unit.channelId] : []))),
  ];
  const areas = channels.length
    ? await rows<SeatRequestForm["areas"][number]>(
        db,
        sql`select a.id::int as id, a.name, a.channel_id::int as "channelId", a.cities from area a
          where a.channel_id in (${sql.join(
            channels.map((id) => sql`${id}`),
            sql`, `,
          )}) and not exists (select 1 from seat s where s.area_id = a.id and s.active) order by a.name`,
      )
    : [];
  const today = todayManila();
  const people = await rows<SeatRequestForm["people"][number]>(
    db,
    sql`select distinct on (p.id) p.id::int as id, p.name, s.title, u.name as unit
      from seat_holder h join seat s on s.id = h.seat_id and s.active join org_unit u on u.id = s.unit_id
        join person p on p.id = h.person_id and p.active
      where s.unit_id in (${list}) and ${inForce("h", today)} order by p.id, s.lead desc`,
  );
  const seats = await rows<SeatRequestForm["seats"][number]>(
    db,
    sql`select s.id::int as id, s.title, u.name as unit, u.id::int as "unitId",
        (select p.name from seat_holder h join person p on p.id = h.person_id
          where h.seat_id = s.id and h.kind = 'holder' and ${inForce("h", today)} limit 1) as holder
      from seat s join org_unit u on u.id = s.unit_id
      where s.active and not s.lead and s.area_id is null and s.unit_id in (${list}) order by u.sort, u.name, s.sort, s.id`,
  );
  return {
    units: withChannel.map(({ channelId: _c, ...unit }) => unit),
    areas: areas.map((area) => ({ ...area, cities: area.cities ?? [] })),
    people: people.sort((a, b) => a.name.localeCompare(b.name)),
    seats,
    mine: await seatRequests(db, sql`r.asked_by = ${me.id}`),
  };
}

export async function askForSeat(
  db: Database,
  me: Me,
  input: SeatRequestInput,
): Promise<{ requestId: number }> {
  const led = await ledUnits(db, me);
  if (!led.includes(input.unitId))
    throw new Refusal(403, "not_allowed", "You can ask only for the teams you lead.", "unitId");
  const kind = input.kind ?? "seat";
  const today = todayManila();
  const newArea = input.newArea?.name?.trim()
    ? { name: input.newArea.name.trim(), cities: citiesOf(input.newArea.cities) }
    : null;
  let title: string;
  let leadPersonId: number | null = null;
  let forSeatId: number | null = null;
  if (kind === "region") {
    const name = clean(input.name);
    if (!name) throw new Refusal(400, "invalid", "Name the new region.", "name");
    const [twin] = await rows<{ id: number }>(
      db,
      sql`select id::int as id from org_unit where active and parent_id = ${input.unitId} and lower(name) = lower(${name})`,
    );
    if (twin) throw new Refusal(409, "taken", `${name} is already a team there.`, "name");
    title = name;
    if (input.leadPersonId) {
      const [inTeam] = await rows<{ id: number }>(
        db,
        sql`select h.person_id::int as id from seat_holder h join seat s on s.id = h.seat_id and s.active
          where h.person_id = ${input.leadPersonId} and s.unit_id in (${sql.join(
            led.map((id) => sql`${id}`),
            sql`, `,
          )}) and ${inForce("h", today)} limit 1`,
      );
      if (!inTeam)
        throw new Refusal(
          400,
          "invalid",
          "Pick someone from your team to lead it.",
          "leadPersonId",
        );
      leadPersonId = inTeam.id;
    }
  } else if (kind === "area") {
    if (!newArea) throw new Refusal(400, "invalid", "Name the new area.", "newArea");
    if (!newArea.cities.length)
      throw new Refusal(400, "invalid", "Write the cities in it, with commas.", "newArea");
    if (!(await unitChannel(db, input.unitId)))
      throw new Refusal(
        400,
        "invalid",
        "This team has no sales channel, so it has no areas.",
        "unitId",
      );
    title = newArea.name;
    if (input.forSeatId) {
      const [seat] = await rows<{ id: number }>(
        db,
        sql`select id::int as id from seat where id = ${input.forSeatId} and active and not lead and area_id is null
          and unit_id in (${sql.join(
            led.map((id) => sql`${id}`),
            sql`, `,
          )})`,
      );
      if (!seat)
        throw new Refusal(
          400,
          "invalid",
          "Pick a seat of your team with no area yet.",
          "forSeatId",
        );
      forSeatId = seat.id;
    }
  } else {
    if (!input.module) throw new Refusal(400, "invalid", "Say what work they do.", "module");
    title =
      clean(input.title) ?? (input.module === "team_lead" ? "District Sales Coach" : "MedRep");
  }
  const [made] = await rows<{ id: number }>(
    db,
    sql`insert into seat_request (kind, unit_id, module, title, area_id, new_area_name, new_area_cities, person_name, person_phone,
        reason, asked_by, lead_person_id, for_seat_id)
      values (${kind}, ${input.unitId}, ${kind === "seat" ? (input.module ?? null) : null}, ${title},
        ${kind === "seat" && !newArea ? (input.areaId ?? null) : null}, ${newArea?.name ?? null},
        ${newArea ? sql`string_to_array(${newArea.cities.join("|")}, '|')` : null},
        ${kind === "seat" ? clean(input.personName) : null}, ${kind === "seat" ? clean(input.personPhone) : null},
        ${clean(input.reason)}, ${me.id}, ${leadPersonId}, ${forSeatId})
      returning id::int as id`,
  );
  const deciders = await rows<{ id: number }>(
    db,
    sql`select id::int as id from person where active and role in ('ceo', 'admin')`,
  );
  await notify(db, {
    to: deciders.map((row) => row.id),
    kind: "seat_request",
    title:
      kind === "region"
        ? `${me.name} asks for a new region: ${title}`
        : kind === "area"
          ? `${me.name} asks for a new area: ${title}`
          : `${me.name} asks for a new ${input.module === "team_lead" ? "team lead" : "MedRep"}`,
    body: [
      kind === "seat" ? clean(input.personName) : null,
      newArea ? `${newArea.name} (${newArea.cities.join(", ")})` : null,
      clean(input.reason),
    ]
      .filter(Boolean)
      .join(" · "),
    link: "/people?tab=requests",
    key: `seat-request-${made?.id}`,
  });
  return { requestId: made?.id as number };
}

/** Approve (the seat, a new area and, when a name was given, the person and their login are made)
 *  or decline with a reason. The one who asked is told either way. */
export async function decideSeatRequest(
  db: Database,
  me: Me,
  requestId: number,
  input: { approve: boolean; answer?: string | null; password?: string | null },
): Promise<{ login: OrgLogin | null }> {
  allow(me, ORG_CHANGE_ROLES, "decide on new people");
  // Claimed first, so two clicks don't make two seats.
  const [request] = await rows<{
    id: number;
    kind: SeatRequest["kind"];
    leadPersonId: number | null;
    forSeatId: number | null;
    unitId: number;
    module: Role;
    title: string;
    areaId: number | null;
    newAreaName: string | null;
    newAreaCities: string[] | null;
    personName: string | null;
    personPhone: string | null;
    askedBy: number;
  }>(
    db,
    sql`update seat_request set status = ${input.approve ? "approved" : "declined"}, decided_by = ${me.id}, decided_at = now(),
        answer = ${clean(input.answer)}
      where id = ${requestId} and status = 'open'
      returning id::int as id, kind, lead_person_id::int as "leadPersonId", for_seat_id::int as "forSeatId",
        unit_id::int as "unitId", module, title, area_id::int as "areaId", new_area_name as "newAreaName",
        new_area_cities as "newAreaCities", person_name as "personName", person_phone as "personPhone", asked_by::int as "askedBy"`,
  );
  if (!request) throw new Refusal(409, "taken", "That ask was already decided.");
  if (!input.approve && !clean(input.answer)) {
    await db.execute(
      sql`update seat_request set status = 'open', decided_by = null, decided_at = null where id = ${requestId}`,
    );
    throw new Refusal(400, "invalid", "Say why, so the team lead knows.", "answer");
  }
  let login: OrgLogin | null = null;
  // What the team is told on Messages once it is made.
  let news: string | null = null;
  const [names] = await rows<{
    unit: string;
    askedBy: string;
    lead: string | null;
    holder: string | null;
  }>(
    db,
    sql`select u.name as unit, b.name as "askedBy", lp.name as lead,
        (select p.name from seat_holder h join person p on p.id = h.person_id
          where h.seat_id = ${request.forSeatId} and h.kind = 'holder' and ${inForce("h", todayManila())} limit 1) as holder
      from org_unit u, person b left join person lp on lp.id = ${request.leadPersonId}
      where u.id = ${request.unitId} and b.id = ${request.askedBy}`,
  );
  const approvedBy = `Asked by ${names?.askedBy}, approved by ${me.name}.`;
  if (input.approve && request.kind !== "seat") {
    try {
      if (request.kind === "region") {
        const { unitId } = await addUnit(db, me, {
          name: request.title,
          kind: "team",
          parentId: request.unitId,
        });
        if (request.leadPersonId) {
          const { seatId } = await addSeat(db, me, {
            unitId,
            title: "Team lead",
            module: "team_lead",
            lead: true,
          });
          await fillSeat(db, me, seatId, {
            personId: request.leadPersonId,
            keepOther: true,
            reason: `Leads the new region ${request.title}`,
          });
        }
        await db.execute(
          sql`update seat_request set made_unit_id = ${unitId} where id = ${requestId}`,
        );
        news = `New region: ${request.title}, under ${names?.unit}. ${
          names?.lead ? `${names.lead} leads it.` : "Its lead is still to be named."
        } ${approvedBy}`;
      } else {
        const channelId = await unitChannel(db, request.unitId);
        if (!channelId)
          throw new Refusal(400, "invalid", "This team has no sales channel, so it has no areas.");
        const { areaId } = await addArea(db, me, {
          channelId,
          name: request.title,
          cities: request.newAreaCities ?? [],
        });
        if (request.forSeatId) await updateSeat(db, me, request.forSeatId, { areaId });
        await db.execute(
          sql`update seat_request set made_area_id = ${areaId} where id = ${requestId}`,
        );
        news = `New area: ${request.title} (${(request.newAreaCities ?? []).join(", ")}), in ${names?.unit}. ${
          names?.holder
            ? `Given to ${names.holder}: its customers are theirs.`
            : "Not given to anyone yet."
        } ${approvedBy}`;
      }
    } catch (error) {
      await db.execute(
        sql`update seat_request set status = 'open', decided_by = null, decided_at = null where id = ${requestId}`,
      );
      throw error;
    }
  }
  if (input.approve && request.kind === "seat") {
    const seat = {
      unitId: request.unitId,
      title: request.title,
      module: request.module,
      areaId: request.areaId,
      newArea: request.newAreaName
        ? { name: request.newAreaName, cities: request.newAreaCities ?? [] }
        : null,
    };
    try {
      if (request.personName) {
        login = await addPerson(db, me, {
          name: request.personName,
          phone: request.personPhone,
          password: input.password,
          ...seat,
        });
        await db.execute(
          sql`update seat_request set seat_id = ${login.seatId}, person_id = ${login.personId} where id = ${requestId}`,
        );
      } else {
        const made = await addSeat(db, me, seat);
        await db.execute(
          sql`update seat_request set seat_id = ${made.seatId} where id = ${requestId}`,
        );
      }
      const where = request.newAreaName ? ` for ${request.newAreaName}` : "";
      news = request.personName
        ? `${request.personName} joins ${names?.unit} as ${request.title}${where}. ${approvedBy}`
        : `A new ${request.title} seat${where} in ${names?.unit}, to fill. ${approvedBy}`;
    } catch (error) {
      // Nothing was made: the ask is open again, with what went wrong said to the CEO.
      await db.execute(
        sql`update seat_request set status = 'open', decided_by = null, decided_at = null where id = ${requestId}`,
      );
      throw error;
    }
  }
  // The team hears of it on Messages, as an announcement from the one who approved.
  if (news)
    await sendMessage(db, me, {
      to: { kind: "unit", unitId: request.unitId },
      announcement: true,
      title:
        request.kind === "region"
          ? "New region"
          : request.kind === "area"
            ? "New area"
            : "New in the team",
      body: news,
    }).catch(() => undefined);
  const what =
    request.kind === "region"
      ? `the new region ${request.title}`
      : request.kind === "area"
        ? `the new area ${request.title}`
        : null;
  await notify(db, {
    to: [request.askedBy],
    kind: "seat_request",
    title: input.approve
      ? what
        ? `${me.name} approved ${what}`
        : `${me.name} approved your ask${request.personName ? `: ${request.personName} can sign in` : ""}`
      : `${me.name} declined ${what ?? "your ask"}`,
    body: clean(input.answer),
    link: "/my-team",
    key: `seat-request-decided-${requestId}`,
  });
  return { login };
}
