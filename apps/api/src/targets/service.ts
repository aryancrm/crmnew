// Monthly sales targets. The Admin and the CEO set anyone's; a manager or team lead sets the
// targets of the people under them. A MedRep sees his own on his Home.

import { peopleUnder, seatsUnder } from "../org/scope";
import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { Refusal } from "../http";
import { todayManila } from "../inventory/rules";
import { salesByPerson } from "../kpis/invoices";
import { creditedTo, inForce } from "../org/service";
import { ROLE_LABEL, type Role } from "../people/roles";
import type { Me, TargetList } from "../types";

const EVERYONE: readonly Role[] = ["admin", "ceo"];
const LEADS: readonly Role[] = ["manager", "team_lead"];
/** Roles that sell and so can have a target. */
const SELLERS: readonly Role[] = ["medrep", "team_lead", "manager", "online"];

export const mayListTargets = (me: Me) => EVERYONE.includes(me.role) || LEADS.includes(me.role);

/** "2026-11", or this Manila month when none (or a wrong one) is asked for. */
function monthOf(asked?: string): string {
  if (asked && /^\d{4}-(0[1-9]|1[0-2])$/.test(asked)) return asked;
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }).slice(0, 7);
}

/** The people this person sets targets for (alias `p`); with a box picked on the team switch,
 *  those sitting in it (a lead not themselves). */
const inScope = (me: Me) =>
  me.unit
    ? sql`p.id in ${peopleUnder(me.unit)} ${EVERYONE.includes(me.role) ? sql`` : sql`and p.id <> ${me.id}`}`
    : EVERYONE.includes(me.role)
    ? sql`true`
    : sql`p.id in (with recursive team as (
          select id from person where reports_to = ${me.id}
          union all select q.id from person q join team t on q.reports_to = t.id
        ) select id from team)`;

export async function listTargets(db: Database, me: Me, asked?: string): Promise<TargetList> {
  if (!mayListTargets(me))
    throw new Refusal(403, "not_allowed", "Only the Admin, the CEO and team heads set targets.");
  const month = monthOf(asked);
  const first = `${month}-01`;
  const found = await rows<Omit<TargetList["rows"][number], "roleLabel"> & { role: Role }>(
    db,
    sql`select p.id::int as "personId", p.name, p.role, p.title, ch.code as channel, a.name as area,
        t.amount::float8 as target, t.tlb::int as "tlbTarget", t.billed::int as "billedTarget", setter.name as "setBy", seat.unit_id::int as "unitId", seat.login,
        (select l.amount::float8 from sales_target l where l.person_id = p.id
          and l.month = (${first}::date - interval '1 month')::date) as "lastTarget",
        coalesce((select sum(o.total) from sales_order o where ${creditedTo(todayManila())} = p.id and o.status not in ('draft', 'cancelled')
          and date_trunc('month', o.created_at at time zone 'Asia/Manila')::date = ${first}::date), 0)::float8 as placed,
        coalesce((select sum(i.total) from invoice i join sales_order o on o.id = i.order_id where ${creditedTo(todayManila())} = p.id
          and i.status <> 'cancelled' and date_trunc('month', i.issued_on)::date = ${first}::date), 0)::float8 as sold
      from person p
      left join channel ch on ch.id = p.channel_id
      left join area a on a.id = p.area_id
      left join sales_target t on t.person_id = p.id and t.month = ${first}::date
      left join person setter on setter.id = t.set_by
      left join lateral (select s.unit_id, s.login from seat_holder h join seat s on s.id = h.seat_id and s.active
        where h.person_id = p.id and h.kind = 'holder' and ${inForce("h", todayManila())} order by h.starts_on, h.id limit 1) seat on true
      where p.active and p.role in (${sql.join(
        SELLERS.map((role) => sql`${role}`),
        sql`, `,
      )}) and ${inScope(me)}
      order by ch.code nulls last, p.name`,
  );
  const units = await rows<{ id: number; name: string; parentId: number | null; sort: number }>(
    db,
    sql`select id::int as id, name, parent_id::int as "parentId", sort::int as sort from org_unit where active order by sort, id`,
  );
  const used = new Set(found.map((row) => row.unitId));
  const ordered: { id: number; name: string }[] = [];
  const walk = (parentId: number | null) => {
    for (const unit of units.filter((one) => one.parentId === parentId)) {
      if (used.has(unit.id)) ordered.push({ id: unit.id, name: unit.name });
      walk(unit.id);
    }
  };
  walk(null);
  const today = todayManila();
  const [y, m] = month.split("-").map(Number) as [number, number];
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const daysGone =
    month < today.slice(0, 7)
      ? daysInMonth
      : month > today.slice(0, 7)
        ? 0
        : Number(today.slice(8, 10));
  // Selling seats nobody holds today, with their targets: whoever takes the seat takes them.
  const emptySeats = await rows<TargetList["emptySeats"][number]>(
    db,
    sql`select s.id::int as "seatId", s.title, u.name as unit, a.name as area,
        (select t.amount::float8 from seat_target t where t.seat_id = s.id and t.month = ${first}::date) as target,
        (select t.amount::float8 from seat_target t where t.seat_id = s.id and t.month = (${first}::date - interval '1 month')::date) as "lastTarget"
      from seat s join org_unit u on u.id = s.unit_id left join area a on a.id = s.area_id
      where s.active and s.module in (${sql.join(SELLERS.map((role) => sql`${role}`), sql`, `)}) and ${seatsInScope(me)}
        and not exists (select 1 from seat_holder h where h.seat_id = s.id and h.kind = 'holder' and ${inForce("h", todayManila())})
      order by u.sort, u.id, s.sort`,
  );
  // What each one sold is what My KPIs, Sales performance and Sales vs target count: this CRM's
  // invoices and Zoho's, without VAT (Aryan, 28 Nov: "one number everywhere"; it counted this CRM's
  // own invoices only, with VAT, and said ₱0 of ₱12.7M while the company bills in Zoho; PLAN 272).
  const sales = await salesByPerson(db, first, `${month}-${String(daysInMonth).padStart(2, "0")}`);
  return {
    emptySeats,
    month,
    daysInMonth,
    daysGone,
    units: ordered,
    monthLabel: new Date(`${first}T00:00:00+08:00`).toLocaleDateString("en-PH", {
      month: "long",
      year: "numeric",
      timeZone: "Asia/Manila",
    }),
    can: { set: true },
    rows: found.map(({ role, ...row }) => ({ ...row, sold: sales.get(row.personId)?.sales ?? 0, roleLabel: ROLE_LABEL[role] })),
  };
}

/** Sets (or, with no amount, clears) one person's target for a month. */
export async function setTarget(
  db: Database,
  me: Me,
  input: { personId: number; month: string; amount: number | null; tlb?: number | null; billed?: number | null },
): Promise<void> {
  if (!mayListTargets(me))
    throw new Refusal(403, "not_allowed", "Only the Admin, the CEO and team heads set targets.");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month))
    throw new Refusal(400, "invalid", "Pick the month.", "month");
  const [person] = await rows<{ id: number }>(
    db,
    sql`select p.id::int as id from person p where p.id = ${input.personId} and p.active
      and p.role in (${sql.join(
        SELLERS.map((role) => sql`${role}`),
        sql`, `,
      )}) and ${inScope(me)}`,
  );
  if (!person)
    throw new Refusal(403, "not_allowed", "You can only set targets for the people under you.");
  const first = `${input.month}-01`;
  // The seat they hold that month keeps the target too, for whoever sits there next.
  const [seat] = await rows<{ id: number }>(
    db,
    sql`select h.seat_id::int as id from seat_holder h join seat s on s.id = h.seat_id and s.active
      where h.person_id = ${input.personId} and h.kind = 'holder'
        and h.starts_on <= (${first}::date + interval '1 month' - interval '1 day')::date and (h.ends_on is null or h.ends_on >= ${first}::date)
      order by h.starts_on desc limit 1`,
  );
  await db.transaction(async (tx) => {
    if (input.amount === null) {
      await tx.execute(sql`delete from sales_target where person_id = ${input.personId} and month = ${first}::date`);
      if (seat) await tx.execute(sql`delete from seat_target where seat_id = ${seat.id} and month = ${first}::date`);
      return;
    }
    await tx.execute(
      sql`insert into sales_target (person_id, month, amount, tlb, billed, set_by)
        values (${input.personId}, ${first}::date, ${input.amount}, ${input.tlb ?? null}, ${input.billed ?? null}, ${me.id})
        on conflict (person_id, month) do update set amount = excluded.amount, set_by = excluded.set_by, set_at = now(),
          tlb = case when ${input.tlb !== undefined} then excluded.tlb else sales_target.tlb end,
          billed = case when ${input.billed !== undefined} then excluded.billed else sales_target.billed end`,
    );
    if (seat)
      await tx.execute(
        sql`insert into seat_target (seat_id, month, amount, tlb, billed, set_by)
          values (${seat.id}, ${first}::date, ${input.amount}, ${input.tlb ?? null}, ${input.billed ?? null}, ${me.id})
          on conflict (seat_id, month) do update set amount = excluded.amount, set_by = excluded.set_by, set_at = now(),
            tlb = case when ${input.tlb !== undefined} then excluded.tlb else seat_target.tlb end,
            billed = case when ${input.billed !== undefined} then excluded.billed else seat_target.billed end`,
      );
  });
}

/** The selling seats this person sets targets for (alias `s`): every one for the Admin and the
 *  CEO, else those whose line runs up to them. */
const seatsInScope = (me: Me) =>
  me.unit
    ? sql`s.id in ${seatsUnder(me.unit)}`
    : EVERYONE.includes(me.role)
    ? sql`true`
    : sql`s.boss_id in (with recursive team as (
          select ${me.id}::bigint as id
          union all select q.id from person q join team t on q.reports_to = t.id
        ) select id from team)`;

/** Sets (or, with no amount, clears) an empty seat's target for a month: whoever takes the seat
 *  takes it with them. */
export async function setSeatTarget(
  db: Database,
  me: Me,
  input: { seatId: number; month: string; amount: number | null },
): Promise<void> {
  if (!mayListTargets(me))
    throw new Refusal(403, "not_allowed", "Only the Admin, the CEO and team heads set targets.");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month))
    throw new Refusal(400, "invalid", "Pick the month.", "month");
  const [seat] = await rows<{ id: number }>(
    db,
    sql`select s.id::int as id from seat s where s.id = ${input.seatId} and s.active
      and s.module in (${sql.join(SELLERS.map((role) => sql`${role}`), sql`, `)}) and ${seatsInScope(me)}`,
  );
  if (!seat) throw new Refusal(403, "not_allowed", "You can only set targets for the seats under you.");
  const first = `${input.month}-01`;
  if (input.amount === null) {
    await db.execute(sql`delete from seat_target where seat_id = ${seat.id} and month = ${first}::date`);
    return;
  }
  await db.execute(
    sql`insert into seat_target (seat_id, month, amount, set_by) values (${seat.id}, ${first}::date, ${input.amount}, ${me.id})
      on conflict (seat_id, month) do update set amount = excluded.amount, set_by = excluded.set_by, set_at = now()`,
  );
}

/** Gives everyone (in scope) with no target this month the target they had the month before. */
export async function copyLastTargets(
  db: Database,
  me: Me,
  month: string,
): Promise<{ copied: number }> {
  if (!mayListTargets(me))
    throw new Refusal(403, "not_allowed", "Only the Admin, the CEO and team heads set targets.");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    throw new Refusal(400, "invalid", "Pick the month.", "month");
  const first = `${month}-01`;
  const copied = await rows<{ id: number }>(
    db,
    sql`insert into sales_target (person_id, month, amount, set_by)
      select l.person_id, ${first}::date, l.amount, ${me.id} from sales_target l join person p on p.id = l.person_id
      where l.month = (${first}::date - interval '1 month')::date and p.active
        and p.role in (${sql.join(
          SELLERS.map((role) => sql`${role}`),
          sql`, `,
        )}) and ${inScope(me)}
        and not exists (select 1 from sales_target t where t.person_id = l.person_id and t.month = ${first}::date)
      returning person_id::int as id`,
  );
  const seats = await rows<{ id: number }>(
    db,
    sql`insert into seat_target (seat_id, month, amount, set_by)
      select l.seat_id, ${first}::date, l.amount, ${me.id} from seat_target l join seat s on s.id = l.seat_id
      where l.month = (${first}::date - interval '1 month')::date and s.active and ${seatsInScope(me)}
        and not exists (select 1 from seat_target t where t.seat_id = l.seat_id and t.month = ${first}::date)
      returning seat_id::int as id`,
  );
  return { copied: copied.length + seats.length };
}
