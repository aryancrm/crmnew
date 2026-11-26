// Who has each order at Management and Finance (Aryan, 18 Nov): one screen for the whole desk, as
// before, but every waiting order is given automatically to one of the desk's people on the chart
// (whoever has the fewest open, someone on leave skipped), so each card names who has it. Anyone at
// the desk may still take one over (or act on it: the role decides, as always); the timeline says
// who was given it and who acted.
// Each signs in as themselves: what is done is written in the name of whoever did it.

import { type SQL, sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import type { Runner } from "../inventory/service";
import { Refusal } from "../http";
import { notify } from "../notify/service";
import { logEvent } from "../orders/events";
import type { DeskDuty, DeskPerson, DeskReport, Me } from "../types";

export type DutyDesk = "management" | "finance" | "dispatch";
// Dispatch is one of them since 19 Nov (Aryan: "make Dispatch's like Management's"): its people
// press Start and the orders to pack are shared out.
export const DUTY_DESKS: DutyDesk[] = ["management", "finance", "dispatch"];

const WORDS: Record<DutyDesk, string> = { management: "Management", finance: "Finance", dispatch: "Dispatch" };
/** The statuses an order waits in at each desk, and how long it may wait there (minutes of work). */
const STATUSES: Record<DutyDesk, string[]> = {
  management: ["pending_approval"],
  finance: ["finance_check", "ready_for_invoice"],
  dispatch: ["ready_for_dispatch", "packing"],
};
const LIMIT: Record<DutyDesk, number> = { management: 4 * 60, finance: 9 * 60, dispatch: 9 * 60 };
const VERB: Record<DutyDesk, string> = { management: "check", finance: "check for Finance", dispatch: "pack" };

/** The orders waiting at a desk (alias `o`), and the column naming who has each in hand. */
const AT_DESK: Record<DutyDesk, SQL> = {
  // Every order waiting for approval, a PAP case's too (Aryan, 22 Nov: PAP has no head).
  management: sql`(o.status = 'pending_approval')`,
  finance: sql`o.status in ('finance_check', 'ready_for_invoice')`,
  dispatch: sql`o.status in ('ready_for_dispatch', 'packing')`,
};
const OWNER: Record<DutyDesk, SQL> = { management: sql.raw("manage_by"), finance: sql.raw("finance_by"), dispatch: sql.raw("dispatch_by") };
const OWNER_AT: Record<DutyDesk, SQL> = {
  management: sql.raw("manage_by_at"),
  finance: sql.raw("finance_by_at"),
  dispatch: sql.raw("dispatch_by_at"),
};

/** A start still open today (Manila): yesterday's left open counts as over. */
const STARTED_TODAY = sql`s.ended_at is null and (s.started_at at time zone 'Asia/Manila')::date = (now() at time zone 'Asia/Manila')::date`;
const startedSql = (desk: DutyDesk, person: SQL) =>
  sql`exists (select 1 from desk_shift s where s.person_id = ${person} and s.desk = ${desk} and ${STARTED_TODAY})`;

/** The desk's people who have started today, and the divisions a Management person approves. */
async function deskPeople(db: Runner, desk: DutyDesk) {
  return rows<{ id: number; name: string; approves: string[] | null }>(
    db,
    sql`select p.id::int as id, p.name, p.approves from person p
      where p.active and p.role = ${desk} and ${startedSql(desk, sql`p.id`)} order by p.name`,
  );
}

/**
 * Shares out the waiting orders at a desk among the people started: an order nobody started has is
 * given to whoever started (and allowed it: a Management person's divisions) has the fewest open,
 * the oldest order first. Told on the order's timeline and to the person.
 */
export async function shareOut(db: Database, me: Me, desk: DutyDesk): Promise<number> {
  return db.transaction(async (tx) => {
    const people = await deskPeople(tx, desk);
    if (!people.length) return 0;
    const owner = OWNER[desk];
    const waiting = await rows<{ id: number; code: string; division: string | null; owner: number | null; kept: boolean }>(
      tx,
      sql`select o.id::int as id, o.code, o.division, o.${owner}::int as owner,
          (o.${owner} is not null and ${startedSql(desk, sql`o.${owner}`)}) as kept
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
      await tx.execute(
        sql`insert into order_assignment (order_id, desk, person_id, how, by_person) values (${order.id}, ${desk}, ${to.id}, 'given', ${me.id})`,
      );
      await logEvent(tx, order.id, me, "note", `Given to ${to.name} (${WORDS[desk]}).`);
      await notify(tx, {
        to: [to.id],
        kind: "order",
        title: `${order.code} is yours to ${VERB[desk]}`,
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

/** The desk's people on its common screen: each, started or not (since when), what each has open
 *  and has done today, and what is waiting (and not given to anyone started). */
export async function deskTeam(db: Database, me: Me, desk: DutyDesk): Promise<DeskDuty> {
  if (![desk, "admin", "ceo"].includes(me.role))
    throw new Refusal(403, "not_allowed", `${WORDS[desk]}'s screen is for ${WORDS[desk]}.`);
  const owner = OWNER[desk];
  const doneToday =
    desk === "management"
      ? sql`(select count(*) from sales_order o where o.approved_by = p.id and (o.approved_at at time zone 'Asia/Manila')::date = (now() at time zone 'Asia/Manila')::date)`
      : desk === "finance"
        ? sql`(select count(*) from sales_order o where o.finance_checked_by = p.id and (o.finance_checked_at at time zone 'Asia/Manila')::date = (now() at time zone 'Asia/Manila')::date)`
        : sql`(select count(*) from sales_order o where o.packed_by = p.id and (o.packed_at at time zone 'Asia/Manila')::date = (now() at time zone 'Asia/Manila')::date)`;
  const [people, [waiting]] = await Promise.all([
    rows<DeskDuty["people"][number]>(
      db,
      sql`select p.id::int as id, p.name, p.title,
          (select to_char(s.started_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') from desk_shift s
            where s.person_id = p.id and s.desk = ${desk} and ${STARTED_TODAY} order by s.started_at limit 1) as "startedAt",
          (select count(*) from sales_order o where ${AT_DESK[desk]} and o.${owner} = p.id)::int as open,
          ${doneToday}::int as "doneToday"
        from person p where p.active and p.role = ${desk} order by p.name`,
    ),
    rows<{ all: number; unassigned: number }>(
      db,
      sql`select count(*)::int as all,
          count(*) filter (where o.${owner} is null or not ${startedSql(desk, sql`o.${owner}`)})::int as unassigned
        from sales_order o where ${AT_DESK[desk]}`,
    ),
  ]);
  return {
    desk,
    people,
    canStart: [desk, "admin"].includes(me.role),
    waiting: waiting?.all ?? 0,
    unassigned: waiting?.unassigned ?? 0,
  };
}

/** Start or Stop for one of the desk's people, pressed on the common screen. Stopping puts their
 *  open orders back to be shared among those still started. */
export async function startPerson(db: Database, me: Me, desk: DutyDesk, personId: number, on: boolean): Promise<void> {
  if (![desk, "admin"].includes(me.role)) throw new Refusal(403, "not_allowed", `Only ${WORDS[desk]} starts people here.`);
  await db.transaction(async (tx) => {
    const [who] = await rows<{ name: string }>(
      tx,
      sql`select name from person where id = ${personId} and active and role = ${desk}`,
    );
    if (!who) throw new Refusal(404, "not_found", `That person isn't in ${WORDS[desk]}.`);
    await tx.execute(
      sql`update desk_shift s set ended_at = now(), end_reason = 'The day ended'
        where s.person_id = ${personId} and s.desk = ${desk} and s.ended_at is null and not (${STARTED_TODAY})`,
    );
    const [open] = await rows<{ id: number }>(
      tx,
      sql`select s.id::int as id from desk_shift s where s.person_id = ${personId} and s.desk = ${desk} and ${STARTED_TODAY} limit 1`,
    );
    if (on) {
      if (!open) await tx.execute(sql`insert into desk_shift (person_id, desk, started_by) values (${personId}, ${desk}, ${me.id})`);
      return;
    }
    if (!open) return;
    await tx.execute(sql`update desk_shift set ended_at = now(), ended_by = ${me.id}, end_reason = 'Stopped' where id = ${open.id}`);
    const theirs = await rows<{ id: number }>(
      tx,
      sql`select o.id::int as id from sales_order o where ${AT_DESK[desk]} and o.${OWNER[desk]} = ${personId} for update of o`,
    );
    for (const order of theirs) {
      await tx.execute(sql`update sales_order set ${OWNER[desk]} = null, ${OWNER_AT[desk]} = null where id = ${order.id}`);
      await logEvent(tx, order.id, me, "note", `Back to ${WORDS[desk]}'s queue: ${who.name} stopped.`);
      await tx.execute(
        sql`insert into order_assignment (order_id, desk, person_id, how, by_person) values (${order.id}, ${desk}, ${personId}, 'stopped', ${me.id})`,
      );
    }
  });
  await shareOut(db, me, desk);
  // Someone starting later gets a fair share of what is already waiting (Aryan, 18 Nov).
  if (on) await evenOut(db, me, desk);
}

/**
 * Evens out the waiting orders among the people started: while someone has two or more than
 * another, their newest order (never one taken by hand) goes to whoever has the fewest and may
 * take it. Told on the timeline and to the person.
 */
async function evenOut(db: Database, me: Me, desk: DutyDesk): Promise<void> {
  await db.transaction(async (tx) => {
    const people = await deskPeople(tx, desk);
    if (people.length < 2) return;
    const owner = OWNER[desk];
    const held = await rows<{ id: number; code: string; division: string | null; owner: number; took: boolean }>(
      tx,
      sql`select o.id::int as id, o.code, o.division, o.${owner}::int as owner,
          coalesce((select a.how = 'took' from order_assignment a where a.order_id = o.id and a.desk = ${desk}
            order by a.at desc, a.id desc limit 1), false) as took
        from sales_order o where ${AT_DESK[desk]} and o.${owner} in (${sql.join(people.map((one) => sql`${one.id}`), sql`, `)})
        order by o.status_since desc nulls last, o.id desc for update of o`,
    );
    const load = new Map(people.map((one) => [one.id, held.filter((order) => order.owner === one.id).length]));
    const may = (person: (typeof people)[number], order: (typeof held)[number]) =>
      desk !== "management" || !person.approves || (order.division !== null && person.approves.includes(order.division));
    for (let guard = 0; guard < held.length; guard += 1) {
      const most = people.reduce((a, b) => ((load.get(b.id) ?? 0) > (load.get(a.id) ?? 0) ? b : a));
      // The newest order the busiest has, not taken by hand, that someone with fewer may take.
      const order = held.find((one) => one.owner === most.id && !one.took);
      if (!order) return;
      const fewer = people
        .filter((one) => one.id !== most.id && (load.get(one.id) ?? 0) + 1 < (load.get(most.id) ?? 0) && may(one, order))
        .sort((a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0))[0];
      if (!fewer) return;
      order.owner = fewer.id;
      load.set(most.id, (load.get(most.id) ?? 0) - 1);
      load.set(fewer.id, (load.get(fewer.id) ?? 0) + 1);
      await tx.execute(sql`update sales_order set ${owner} = ${fewer.id}, ${OWNER_AT[desk]} = now() where id = ${order.id}`);
      await tx.execute(
        sql`insert into order_assignment (order_id, desk, person_id, how, by_person) values (${order.id}, ${desk}, ${fewer.id}, 'given', ${me.id})`,
      );
      await logEvent(tx, order.id, me, "note", `Given to ${fewer.name} (${WORDS[desk]}), to share the load with ${most.name}.`);
      await notify(tx, {
        to: [fewer.id],
        kind: "order",
        title: `${order.code} is yours to ${VERB[desk]}`,
        link: `/orders/${order.id}`,
        orderId: order.id,
        key: `desk:${desk}:${order.id}:${fewer.id}`,
      });
    }
  });
}

/**
 * On a desk's shared screen (opened with the desks' common password, Aryan 19 Nov, back 27 Nov), what
 * is done on an order is written in the name of the person it was given to (Aryan, 18 Nov), when they
 * have started today; else in the desk's name. Taking an order, or letting it go, stays the screen's.
 * A person's own login always acts as themselves.
 */
export async function deskStandIn(db: Database, me: Me, method: string, path: string): Promise<Me | null> {
  const desk = me.deskScreen;
  if (method !== "POST" || !desk) return null;
  const found = path.match(/^\/api\/(?:finance\/|dispatch\/)?orders\/(\d+)\/([a-z-]+)$/);
  if (!found || ["handle", "take", "release"].includes(found[2] as string)) return null;
  const [owner] = await rows<{ id: number; name: string; title: string | null; email: string | null }>(
    db,
    sql`select p.id::int as id, p.name, p.title, p.email from sales_order o join person p on p.id = o.${OWNER[desk]} and p.active and p.role = ${desk}
      where o.id = ${Number(found[1])} and ${AT_DESK[desk]} and ${startedSql(desk, sql`p.id`)}`,
  );
  if (!owner || owner.id === me.id) return null;
  return { ...me, id: owner.id, name: owner.name, title: owner.title, email: owner.email };
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
      await tx.execute(
        sql`insert into order_assignment (order_id, desk, person_id, how, by_person) values (${orderId}, 'finance', ${me.id}, 'released', ${me.id})`,
      );
      await logEvent(tx, orderId, me, "note", `${me.name} let it go: anyone in Finance can take it.`);
      return;
    }
    if (order.by === me.id) return;
    await tx.execute(sql`update sales_order set finance_by = ${me.id}, finance_by_at = now() where id = ${orderId}`);
    await tx.execute(
      sql`insert into order_assignment (order_id, desk, person_id, how, by_person) values (${orderId}, 'finance', ${me.id}, 'took', ${me.id})`,
    );
    await logEvent(tx, orderId, me, "note", order.by ? `${me.name} took it over from ${order.name}.` : `${me.name} is handling it.`);
  });
}

/**
 * Each of the desk's people over some days (Aryan, 18 Nov: "every person's data"): how long they
 * were started, how many orders they were given and took over, what they did with the ones they
 * moved on (approved / checked, sent back, held, rejected), how long each took them from when it
 * was theirs (working minutes; from when it reached the desk if it was never given), how many went
 * past the desk's limit, and what they have open now.
 */
export async function deskReport(
  db: Database,
  me: Me,
  desk: DutyDesk,
  asked: { from?: string | null; to?: string | null },
): Promise<DeskReport> {
  if (![desk, "admin", "ceo"].includes(me.role))
    throw new Refusal(403, "not_allowed", `${WORDS[desk]}'s figures are for ${WORDS[desk]}.`);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
  const isDay = (value?: string | null) => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
  const from = isDay(asked.from) ? (asked.from as string) : today;
  const to = isDay(asked.to) ? (asked.to as string) : today;
  if (from > to) throw new Refusal(400, "invalid", "The first day comes after the last one.", "from");
  const statuses = STATUSES[desk];
  const inDesk = sql.join(statuses.map((one) => sql`${one}`), sql`, `);
  const limit = LIMIT[desk];
  const day = (column: SQL) => sql`(${column} at time zone 'Asia/Manila')::date between ${from}::date and ${to}::date`;
  const people = await rows<DeskReport["people"][number]>(
    db,
    sql`with moved as (
        -- Each time an order left the desk in these days: who moved it on, where it went, how long it was theirs.
        select st.order_id, st.left_at,
          (select e.by_person from order_event e where e.order_id = st.order_id
            and e.at between st.left_at - interval '15 seconds' and st.left_at + interval '15 seconds'
            order by abs(extract(epoch from e.at - st.left_at)), e.id limit 1) as by_person,
          (select st2.status from order_step st2 where st2.order_id = st.order_id and st2.entered_at >= st.left_at
            order by st2.entered_at limit 1) as went,
          st.entered_at
        from order_step st join sales_order o on o.id = st.order_id
        where st.status in (${inDesk}) and st.left_at is not null and ${day(sql`st.left_at`)}
      ), acted as (
        select m.*, work_minutes(greatest(m.entered_at, coalesce((select max(a.at) from order_assignment a
            where a.order_id = m.order_id and a.desk = ${desk} and a.person_id = m.by_person and a.how in ('given', 'took') and a.at <= m.left_at), m.entered_at)), m.left_at) as minutes
        from moved m where m.by_person is not null
      )
      select p.id::int as id, p.name,
        coalesce((select round(sum(extract(epoch from least(coalesce(s.ended_at, now()), (${to}::date + 1)::timestamp at time zone 'Asia/Manila')
            - greatest(s.started_at, ${from}::date::timestamp at time zone 'Asia/Manila')) / 3600)::numeric, 1)
          from desk_shift s where s.person_id = p.id and s.desk = ${desk}
            and s.started_at < (${to}::date + 1)::timestamp at time zone 'Asia/Manila'
            and coalesce(s.ended_at, now()) > ${from}::date::timestamp at time zone 'Asia/Manila'), 0)::float8 as hours,
        -- Given to them and kept (not moved on to someone else afterwards to even the load).
        (select count(distinct a.order_id) from order_assignment a where a.person_id = p.id and a.desk = ${desk} and a.how = 'given' and ${day(sql`a.at`)}
          and not exists (select 1 from order_assignment b where b.order_id = a.order_id and b.desk = a.desk and b.at > a.at
            and b.person_id <> p.id and b.how in ('given', 'took')))::int as given,
        (select count(*) from order_assignment a where a.person_id = p.id and a.desk = ${desk} and a.how = 'took' and ${day(sql`a.at`)})::int as took,
        (select count(*) from acted x where x.by_person = p.id and x.went in ('finance_check', 'ready_for_invoice', 'ready_for_dispatch', 'packing', 'shipped'))::int as done,
        (select count(*) from acted x where x.by_person = p.id and x.went = 'draft')::int as "sentBack",
        (select count(*) from acted x where x.by_person = p.id and x.went in ('on_hold', 'exception'))::int as held,
        (select count(*) from acted x where x.by_person = p.id and x.went = 'cancelled')::int as rejected,
        (select percentile_cont(0.5) within group (order by x.minutes) from acted x where x.by_person = p.id)::float8 as "medianMinutes",
        (select count(*) from acted x where x.by_person = p.id and x.minutes > ${limit})::int as late,
        (select count(*) from sales_order o where ${AT_DESK[desk]} and o.${OWNER[desk]} = p.id)::int as open
      from person p where p.active and p.role = ${desk} order by p.name`,
  );
  return { desk, from, to, limitMinutes: limit, people };
}

/**
 * One of the desk's people over some days (Aryan, 18 Nov: "click a name and see everything they
 * did"): their figures, the orders they have now, and every order they moved on — approved or
 * checked, sent back, held, rejected — with how long each took them from when it was theirs.
 */
export async function deskPerson(
  db: Database,
  me: Me,
  desk: DutyDesk,
  personId: number,
  asked: { from?: string | null; to?: string | null },
): Promise<DeskPerson> {
  const report = await deskReport(db, me, desk, asked);
  const figures = report.people.find((one) => one.id === personId);
  if (!figures) throw new Refusal(404, "not_found", `That person isn't in ${WORDS[desk]}.`);
  const statuses = STATUSES[desk];
  const inDesk = sql.join(statuses.map((one) => sql`${one}`), sql`, `);
  const day = (column: SQL) =>
    sql`(${column} at time zone 'Asia/Manila')::date between ${report.from}::date and ${report.to}::date`;
  const [[person], open, done] = await Promise.all([
    rows<{ title: string | null; startedAt: string | null }>(
      db,
      sql`select p.title, (select to_char(s.started_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') from desk_shift s
          where s.person_id = p.id and s.desk = ${desk} and ${STARTED_TODAY} order by s.started_at limit 1) as "startedAt"
        from person p where p.id = ${personId}`,
    ),
    rows<DeskPerson["open"][number]>(
      db,
      sql`select o.id::int as id, o.code, c.name as customer, o.total::int as total, o.status,
          to_char(coalesce(o.${OWNER_AT[desk]}, o.status_since) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as since
        from sales_order o join customer c on c.id = o.customer_id
        where ${AT_DESK[desk]} and o.${OWNER[desk]} = ${personId} order by o.status_since nulls last`,
    ),
    rows<DeskPerson["done"][number]>(
      db,
      sql`with moved as (
          select st.order_id, st.left_at, st.entered_at,
            (select e.by_person from order_event e where e.order_id = st.order_id
              and e.at between st.left_at - interval '15 seconds' and st.left_at + interval '15 seconds'
              order by abs(extract(epoch from e.at - st.left_at)), e.id limit 1) as by_person,
            (select st2.status from order_step st2 where st2.order_id = st.order_id and st2.entered_at >= st.left_at
              order by st2.entered_at limit 1) as went
          from order_step st where st.status in (${inDesk}) and st.left_at is not null and ${day(sql`st.left_at`)}
        )
        select o.id::int as id, o.code, c.name as customer, o.total::int as total,
          case when m.went in ('finance_check', 'ready_for_invoice', 'ready_for_dispatch', 'packing', 'shipped') then 'done'
            when m.went = 'draft' then 'sent_back' when m.went in ('on_hold', 'exception') then 'held'
            when m.went = 'cancelled' then 'rejected' else 'moved' end as outcome,
          to_char(m.left_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as at,
          work_minutes(greatest(m.entered_at, coalesce((select max(a.at) from order_assignment a where a.order_id = m.order_id
            and a.desk = ${desk} and a.person_id = ${personId} and a.how in ('given', 'took') and a.at <= m.left_at), m.entered_at)), m.left_at)::int as minutes
        from moved m join sales_order o on o.id = m.order_id join customer c on c.id = o.customer_id
        where m.by_person = ${personId} order by m.left_at desc limit 300`,
    ),
  ]);
  return {
    desk,
    from: report.from,
    to: report.to,
    limitMinutes: report.limitMinutes,
    person: { id: personId, name: figures.name, title: person?.title ?? null, startedAt: person?.startedAt ?? null },
    figures,
    open,
    done,
  };
}
