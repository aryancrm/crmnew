// Vacant seats (docs/HR-PLAN.md, "Moves and vacant seats", 25 Nov). A seat nobody sits in keeps its
// area, its customers and its quota; its team lead looks after it and may give it to one of their
// own people as a cover (added work: the sale counts for the vacant seat, the team's, never the
// covering MedRep's own KPI; see order_seat in migration 0156). Who sees what:
// - the team lead: the vacant seats in the boxes they lead (and under them), and may give each to
//   one of their people until a day, or take the cover back;
// - HR, the CEO and the Admin: every vacant seat (HR may arrange a cover too; the CEO and the Admin
//   also from Teams & people).
// A seat vacant 7 days with nobody covering it is flagged to its lead; 14 days, to the head and HR.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { Refusal } from "../http";
import { todayManila } from "../inventory/rules";
import type { Role } from "../people/roles";
import type { Me, VacantSeats } from "../types";
import { HR_ROLES, HR_WRITE_ROLES } from "../hr/people";
import { coverSeat, endHolding, inForce, LOGIN_DOMAIN, ledUnits, ORG_CHANGE_ROLES } from "./service";

/** Days vacant with nobody covering before the lead is reminded, and before the head and HR are. */
export const VACANT_LEAD_DAYS = 7;
export const VACANT_UP_DAYS = 14;

/** The first day a seat (alias `s`) has been empty: the day after its last holder's last day,
 *  else the day it was made. */
export const vacantSince = (today: string) =>
  sql`coalesce((select max(vh.ends_on) + 1 from seat_holder vh where vh.seat_id = s.id and vh.kind = 'holder' and vh.ends_on < ${today}::date),
    (s.created_at at time zone 'Asia/Manila')::date)`;

/** The boxes this person may see the vacant seats of: null = every box (HR, the CEO, the Admin). */
async function reach(db: Database, me: Me): Promise<number[] | null> {
  if (HR_ROLES.includes(me.role)) return null;
  const units = await ledUnits(db, me);
  if (!units.length)
    throw new Refusal(403, "not_allowed", "Vacant seats are for team leads, HR, the CEO and the Admin.");
  return units;
}

const inUnits = (units: number[] | null) =>
  units === null
    ? sql`true`
    : sql`s.unit_id in (${sql.join(
        units.map((id) => sql`${id}`),
        sql`, `,
      )})`;

export async function vacantSeats(db: Database, me: Me): Promise<VacantSeats> {
  const today = todayManila();
  const units = await reach(db, me);
  const seats = await rows<Omit<VacantSeats["seats"][number], "alert" | "login"> & { login: string | null }>(
    db,
    sql`select s.id::int as "seatId", s.title, u.name as team, a.name as area, s.login,
        to_char(${vacantSince(today)}, 'YYYY-MM-DD') as since, (${today}::date - ${vacantSince(today)})::int as days,
        (select b.name from person b where b.id = s.boss_id) as lead,
        (select json_build_object('holdingId', h.id::int, 'personId', q.id::int, 'name', q.name, 'until', to_char(h.ends_on, 'YYYY-MM-DD'))
          from seat_holder h join person q on q.id = h.person_id and q.active
          where h.seat_id = s.id and h.kind = 'acting' and ${inForce("h", today)} order by h.starts_on desc limit 1) as cover,
        (select json_build_object('name', q.name, 'startsOn', to_char(h.starts_on, 'YYYY-MM-DD'))
          from seat_holder h join person q on q.id = h.person_id and q.active
          where h.seat_id = s.id and h.kind = 'holder' and h.starts_on > ${today}::date order by h.starts_on limit 1) as promised,
        (select count(*) from customer c where c.active and s.area_id is not null and c.area_id = s.area_id)::int as customers,
        (select count(*) from sales_order o where o.seat_id = s.id and o.status not in ('completed', 'cancelled', 'draft'))::int as open,
        (select t.amount::float8 from seat_target t where t.seat_id = s.id and t.month = date_trunc('month', ${today}::date)::date) as quota,
        (select coalesce(sum(o.total), 0)::float8 from sales_order o where o.seat_id = s.id and o.status not in ('draft', 'cancelled')
          and date_trunc('month', o.created_at at time zone 'Asia/Manila') = date_trunc('month', ${today}::date)) as sold,
        (select coalesce(sum(o.total), 0)::float8 from sales_order o where o.seat_id = s.id and o.covered and o.status not in ('draft', 'cancelled')
          and date_trunc('month', o.created_at at time zone 'Asia/Manila') = date_trunc('month', ${today}::date)) as "soldCovering"
      from seat s join org_unit u on u.id = s.unit_id left join area a on a.id = s.area_id
      where s.active and ${inUnits(units)}
        and not exists (select 1 from seat_holder h join person q on q.id = h.person_id and q.active
          where h.seat_id = s.id and h.kind = 'holder' and ${inForce("h", today)})
      order by (${today}::date - ${vacantSince(today)}) desc, s.sort, s.id`,
  );
  const people = await rows<VacantSeats["people"][number]>(
    db,
    sql`select distinct on (p.id) p.id::int as id, p.name, s.title as seat, s.unit_id::int as "unitId"
      from seat_holder h join seat s on s.id = h.seat_id and s.active join person p on p.id = h.person_id and p.active
      where h.kind = 'holder' and ${inForce("h", today)} and ${inUnits(units)}
      order by p.id, s.lead desc, h.starts_on`,
  );
  const canCover = units !== null || HR_WRITE_ROLES.includes(me.role) || ORG_CHANGE_ROLES.includes(me.role);
  return {
    today,
    leadDays: VACANT_LEAD_DAYS,
    upDays: VACANT_UP_DAYS,
    seats: seats.map((seat) => ({
      ...seat,
      login: seat.login ? `${seat.login}@${LOGIN_DOMAIN}` : null,
      alert: seat.cover || seat.promised ? "none" : seat.days >= VACANT_UP_DAYS ? "up" : seat.days >= VACANT_LEAD_DAYS ? "lead" : "none",
    })),
    people: people.filter((one) => one.id !== me.id || units === null).sort((a, b) => a.name.localeCompare(b.name)),
    can: { cover: canCover },
  };
}

/** May this person arrange covers on the seat (and with the person)? HR and the Admin anywhere;
 *  the CEO anywhere; a team lead in the boxes they lead, with their own people only. */
async function coverRoles(db: Database, me: Me, seatId: number, personId: number | null): Promise<Role[]> {
  if (HR_WRITE_ROLES.includes(me.role) || ORG_CHANGE_ROLES.includes(me.role)) return [me.role];
  const units = await ledUnits(db, me);
  if (!units.length) throw new Refusal(403, "not_allowed", "Only the seat's team lead, HR or the Admin arranges a cover.");
  const today = todayManila();
  const list = sql.join(
    units.map((id) => sql`${id}`),
    sql`, `,
  );
  const [seat] = await rows<{ id: number }>(
    db,
    sql`select s.id::int as id from seat s where s.id = ${seatId} and s.active and s.unit_id in (${list})`,
  );
  if (!seat) throw new Refusal(403, "not_allowed", "That seat isn't in your team.");
  if (personId !== null) {
    const [person] = await rows<{ id: number }>(
      db,
      sql`select h.person_id::int as id from seat_holder h join seat s on s.id = h.seat_id and s.active
        where h.person_id = ${personId} and h.kind = 'holder' and ${inForce("h", today)} and s.unit_id in (${list}) limit 1`,
    );
    if (!person) throw new Refusal(403, "not_allowed", "Give it to one of your own people.", "personId");
  }
  return [me.role];
}

/** The team lead (or HR) gives a vacant seat to one of their people until a day: added work. */
export async function giveCover(
  db: Database,
  me: Me,
  seatId: number,
  input: { personId: number; until: string; reason?: string | null },
): Promise<void> {
  const roles = await coverRoles(db, me, seatId, input.personId);
  const today = todayManila();
  const [held] = await rows<{ id: number }>(
    db,
    sql`select h.id::int as id from seat_holder h join person q on q.id = h.person_id and q.active
      where h.seat_id = ${seatId} and h.kind = 'holder' and ${inForce("h", today)} limit 1`,
  );
  // A lead covers only an empty seat; someone away from a held seat is for HR or the Admin.
  if (held && !HR_WRITE_ROLES.includes(me.role) && !ORG_CHANGE_ROLES.includes(me.role))
    throw new Refusal(409, "taken", "Someone sits in that seat: it isn't vacant.");
  await coverSeat(db, me, seatId, input, roles);
}

/** Takes a cover back (ends it today). */
export async function takeCoverBack(db: Database, me: Me, holdingId: number, reason?: string | null): Promise<void> {
  const [holding] = await rows<{ seatId: number; kind: string }>(
    db,
    sql`select seat_id::int as "seatId", kind from seat_holder where id = ${holdingId}`,
  );
  if (!holding || holding.kind !== "acting") throw new Refusal(404, "not_found", "That cover isn't there.");
  const roles = await coverRoles(db, me, holding.seatId, null);
  await endHolding(db, me, holdingId, reason ?? "Cover taken back", roles);
}
