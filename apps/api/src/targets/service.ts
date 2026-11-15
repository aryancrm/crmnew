// Monthly sales targets. The Admin and the CEO set anyone's; a manager or team lead sets the
// targets of the people under them. A MedRep sees his own on his Home.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { Refusal } from "../http";
import { todayManila } from "../inventory/rules";
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

/** The people this person sets targets for (alias `p`). */
const inScope = (me: Me) =>
  EVERYONE.includes(me.role)
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
        t.amount::float8 as target, setter.name as "setBy", seat.unit_id::int as "unitId", seat.login,
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
        where h.person_id = p.id and h.kind = 'holder' and ${inForce("h", todayManila())} order by h.starts_on limit 1) seat on true
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
  return {
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
    rows: found.map(({ role, ...row }) => ({ ...row, roleLabel: ROLE_LABEL[role] })),
  };
}

/** Sets (or, with no amount, clears) one person's target for a month. */
export async function setTarget(
  db: Database,
  me: Me,
  input: { personId: number; month: string; amount: number | null },
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
  if (input.amount === null) {
    await db.execute(
      sql`delete from sales_target where person_id = ${input.personId} and month = ${first}::date`,
    );
    return;
  }
  await db.execute(
    sql`insert into sales_target (person_id, month, amount, set_by) values (${input.personId}, ${first}::date, ${input.amount}, ${me.id})
      on conflict (person_id, month) do update set amount = excluded.amount, set_by = excluded.set_by, set_at = now()`,
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
  return { copied: copied.length };
}
