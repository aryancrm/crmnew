// Who has each order at Management and Finance (Aryan, 18 Nov): one screen for the whole desk, as
// before, but every waiting order is given automatically to one of the desk's people on the chart
// (whoever has the fewest open, someone on leave skipped), so each card names who has it. Anyone at
// the desk may still take one over (or act on it: the role decides, as always); the timeline says
// who was given it and who acted.

import { type SQL, sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import type { Runner } from "../inventory/service";
import { Refusal } from "../http";
import { notify } from "../notify/service";
import { logEvent } from "../orders/events";
import type { DeskDuty, Me } from "../types";

export type DutyDesk = "management" | "finance";
export const DUTY_DESKS: DutyDesk[] = ["management", "finance"];

const WORDS: Record<DutyDesk, string> = { management: "Management", finance: "Finance" };

/** The orders waiting at a desk (alias `o`), and the column naming who has each in hand. */
const AT_DESK: Record<DutyDesk, SQL> = {
  // A PAP case's order is its PAP head's to approve: never shared out.
  management: sql`(o.status = 'pending_approval' and not exists (select 1 from channel ch where ch.id = o.channel_id and ch.code = 'PAP'))`,
  finance: sql`o.status in ('finance_check', 'ready_for_invoice')`,
};
const OWNER: Record<DutyDesk, SQL> = { management: sql.raw("manage_by"), finance: sql.raw("finance_by") };
const OWNER_AT: Record<DutyDesk, SQL> = {
  management: sql.raw("manage_by_at"),
  finance: sql.raw("finance_by_at"),
};

/** Someone on approved leave today (Manila). */
const ON_LEAVE = (person: SQL) =>
  sql`exists (select 1 from person_leave l where l.person_id = ${person} and l.status = 'approved'
    and (now() at time zone 'Asia/Manila')::date between l.from_day and l.to_day)`;

/** The desk's people: everyone with its role, at work today (not on leave), and the divisions a
 *  Management person approves. */
async function deskPeople(db: Runner, desk: DutyDesk) {
  return rows<{ id: number; name: string; approves: string[] | null }>(
    db,
    sql`select p.id::int as id, p.name, p.approves from person p
      where p.active and p.role = ${desk} and not ${ON_LEAVE(sql`p.id`)} order by p.name`,
  );
}

/**
 * Shares out the waiting orders at a desk: an order nobody has (or whose person has left or is on
 * leave today) is given to whoever at the desk (and allowed it: a Management person's divisions)
 * has the fewest open, the oldest order first. Told on the order's timeline and to the person.
 */
export async function shareOut(db: Database, me: Me, desk: DutyDesk): Promise<number> {
  return db.transaction(async (tx) => {
    const people = await deskPeople(tx, desk);
    if (!people.length) return 0;
    const owner = OWNER[desk];
    const waiting = await rows<{ id: number; code: string; division: string | null; owner: number | null; kept: boolean }>(
      tx,
      sql`select o.id::int as id, o.code, o.division, o.${owner}::int as owner,
          (o.${owner} is not null and exists (select 1 from person q where q.id = o.${owner} and q.active)
            and not ${ON_LEAVE(sql`o.${owner}`)}) as kept
        from sales_order o where ${AT_DESK[desk]} order by o.status_since nulls last, o.id for update of o`,
    );
    const load = new Map(people.map((one) => [one.id, 0]));
    for (const order of waiting) if (order.kept && order.owner && load.has(order.owner)) load.set(order.owner, (load.get(order.owner) ?? 0) + 1);
    let given = 0;
    for (const order of waiting) {
      if (order.kept) continue;
      const allowed = people.filter(
        (one) => desk !== "management" || !one.approves || (order.division !== null && one.approves.includes(order.division)),
      );
      if (!allowed.length) continue;
      const to = allowed.reduce((best, one) => ((load.get(one.id) ?? 0) < (load.get(best.id) ?? 0) ? one : best));
      load.set(to.id, (load.get(to.id) ?? 0) + 1);
      await tx.execute(sql`update sales_order set ${owner} = ${to.id}, ${OWNER_AT[desk]} = now() where id = ${order.id}`);
      await logEvent(tx, order.id, me, "note", `Given to ${to.name} (${WORDS[desk]}).`);
      await notify(tx, {
        to: [to.id],
        kind: "order",
        title: `${order.code} is yours to ${desk === "management" ? "check" : "check for Finance"}`,
        link: `/orders/${order.id}`,
        orderId: order.id,
        key: `desk:${desk}:${order.id}:${to.id}`,
      });
      given += 1;
    }
    return given;
  });
}

/** Both desks shared out, after anything that may have moved an order. */
export async function shareOutAll(db: Database, me: Me): Promise<void> {
  for (const desk of DUTY_DESKS) await shareOut(db, me, desk);
}

/** The desk's team on its screen: each person, away on leave or not, what each has open and has
 *  done today, and what is waiting. */
export async function deskTeam(db: Database, me: Me, desk: DutyDesk): Promise<DeskDuty> {
  if (![desk, "admin", "ceo"].includes(me.role))
    throw new Refusal(403, "not_allowed", `${WORDS[desk]}'s team is for ${WORDS[desk]}.`);
  const owner = OWNER[desk];
  const doneToday =
    desk === "management"
      ? sql`(select count(*) from sales_order o where o.approved_by = p.id and (o.approved_at at time zone 'Asia/Manila')::date = (now() at time zone 'Asia/Manila')::date)`
      : sql`(select count(*) from sales_order o where o.finance_checked_by = p.id and (o.finance_checked_at at time zone 'Asia/Manila')::date = (now() at time zone 'Asia/Manila')::date)`;
  const [people, [waiting]] = await Promise.all([
    rows<DeskDuty["people"][number]>(
      db,
      sql`select p.id::int as id, p.name, ${ON_LEAVE(sql`p.id`)} as away,
          (select count(*) from sales_order o where ${AT_DESK[desk]} and o.${owner} = p.id)::int as open,
          ${doneToday}::int as "doneToday"
        from person p where p.active and p.role = ${desk} order by p.name`,
    ),
    rows<{ all: number; unassigned: number }>(
      db,
      sql`select count(*)::int as all, count(*) filter (where o.${owner} is null)::int as unassigned
        from sales_order o where ${AT_DESK[desk]}`,
    ),
  ]);
  return { desk, people, mine: me.role === desk, waiting: waiting?.all ?? 0, unassigned: waiting?.unassigned ?? 0 };
}

/** Finance's own "I'll take it" / "Take over" / "Let go" on one order (Management's is handleOrder). */
export async function takeFinanceOrder(db: Database, me: Me, orderId: number, release: boolean): Promise<void> {
  if (!["finance", "admin"].includes(me.role)) throw new Refusal(403, "not_allowed", "Only Finance takes an order here.");
  await db.transaction(async (tx) => {
    const [order] = await rows<{ code: string; atDesk: boolean; by: number | null; name: string | null }>(
      tx,
      sql`select o.code, ${AT_DESK.finance} as "atDesk", o.finance_by::int as by, p.name
        from sales_order o left join person p on p.id = o.finance_by where o.id = ${orderId} for update of o`,
    );
    if (!order) throw new Refusal(404, "not_found", "That order doesn't exist.");
    if (!order.atDesk) throw new Refusal(409, "not_now", `${order.code} isn't with Finance now. Reload it.`);
    if (release) {
      if (order.by !== me.id) return;
      await tx.execute(sql`update sales_order set finance_by = null, finance_by_at = null where id = ${orderId}`);
      await logEvent(tx, orderId, me, "note", `${me.name} let it go: anyone in Finance can take it.`);
      return;
    }
    if (order.by === me.id) return;
    await tx.execute(sql`update sales_order set finance_by = ${me.id}, finance_by_at = now() where id = ${orderId}`);
    await logEvent(tx, orderId, me, "note", order.by ? `${me.name} took it over from ${order.name}.` : `${me.name} is handling it.`);
  });
}
