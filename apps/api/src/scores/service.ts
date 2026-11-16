// The monthly scorecards worked out from the data: each selling person's figures for a month
// (invoices, payments, orders, enquiries), scored by their seat's playbook card. The running
// month is shown live (IST on the month-end pace of working days); a month is locked on the 1st
// of the next and never changed by hand. The 12-month average of the locked cards sets the
// increment band. Working days are the company calendar: Monday to Saturday, less holidays.

import { type SQL, sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { DEFAULT_SCHEDULE, isWorkDay } from "../hr/work-time";
import { Refusal } from "../http";
import { todayManila } from "../inventory/rules";
import { inForce } from "../org/service";
import { teamSeats } from "../team/service";
import type { Me, MyScore, ScoreCard, ScoreDispute, TeamNeed, TeamScores } from "../types";
import { incrementOf, type Recipe, RECIPES, scoreOf } from "./recipes";

const WHOLE = ["ceo", "admin"];
/** The Rx CHC's doctor list: 80 doctors (20 Tier 1, 40 Tier 2, 20 Tier 3). */
const DOCTOR_LIST = 80;

const firstOf = (month: string) => `${month.slice(0, 7)}-01`;
const lastOf = (month: string) => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return `${month.slice(0, 7)}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
};
const shiftMonth = (month: string, by: number) => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
};
const daysBetween = (from: string, to: string) => {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000)
    out.push(new Date(t).toISOString().slice(0, 10));
  return out;
};

/** The card a seat is scored on: Hospital CHC for a hospital MedRep, Rx CHC for a prescription
 *  MedRep, B2C CHC for the online desk, the B2C card for telesales (until theirs is published),
 *  and a lead their team's average. Leads and the other channels have no card here yet. */
export function recipeFor(seat: { module: string; lead: boolean; channel: string | null } | undefined): Recipe | null {
  if (!seat) return null;
  if (seat.lead || seat.module === "team_lead" || seat.module === "manager") return RECIPES.team;
  if (seat.channel === "TS") return RECIPES.telesales;
  if (seat.module === "online" || seat.channel === "ONLINE") return RECIPES.b2c;
  if (seat.module === "medrep" && seat.channel === "HOSP") return RECIPES.hospital;
  if (seat.module === "medrep" && seat.channel === "RX") return RECIPES.rx;
  return null;
}

type SeatOn = { seatId: number | null; module: string; lead: boolean; channel: string | null; title: string | null; area: string | null };

/** The seat a person held on a day (their latest one in force), or their own role and area. */
async function seatOn(db: Database, personId: number, day: string): Promise<SeatOn | undefined> {
  const [held] = await rows<SeatOn>(
    db,
    sql`select s.id::int as "seatId", s.module, s.lead, ch.code as channel, s.title, a.name as area
      from seat_holder h join seat s on s.id = h.seat_id
        left join area a on a.id = s.area_id left join channel ch on ch.id = a.channel_id
      where h.person_id = ${personId} and h.kind = 'holder'
        and h.starts_on <= ${day}::date and (h.ends_on is null or h.ends_on >= ${firstOf(day)}::date)
      order by h.starts_on desc, h.id desc limit 1`,
  );
  if (held) return held;
  const [own] = await rows<SeatOn>(
    db,
    sql`select null::int as "seatId", p.role as module, false as lead, ch.code as channel, null as title, a.name as area
      from person p left join area a on a.id = p.area_id left join channel ch on ch.id = a.channel_id where p.id = ${personId}`,
  );
  return own;
}

async function holidaysIn(db: Database, from: string, to: string): Promise<Set<string>> {
  const found = await rows<{ day: string }>(
    db,
    sql`select to_char(day, 'YYYY-MM-DD') as day from holiday where active and day between ${from}::date and ${to}::date`,
  );
  return new Set(found.map((row) => row.day));
}

/** A person's measured values for a month, up to a day (the month's last, or today). */
export async function measure(
  db: Database,
  personId: number,
  recipe: Recipe,
  month: string,
  upTo: string,
  live: boolean,
): Promise<{ values: Record<string, number | null>; notes: Record<string, string>; active: boolean; facts?: MonthFacts }> {
  if (recipe.key === "team") return teamMeasure(db, personId, month, upTo);
  const first = firstOf(month);
  const last = lastOf(month);
  const prevFirst = firstOf(shiftMonth(month, -1));
  const mine: SQL = sql`(o.medrep_id = ${personId} or o.raised_by = ${personId})`;
  const [row] = await rows<{
    sales: number;
    target: number | null;
    owed: number;
    credit90: number;
    lastCustomers: number;
    cameBack: number;
    enquiries: number;
    converted: number;
    orders: number;
    cancelled: number;
  }>(
    db,
    sql`select
        coalesce((select sum(i.total) from invoice i join sales_order o on o.id = i.order_id
          where ${mine} and i.status <> 'cancelled' and i.issued_on between ${first}::date and ${upTo}::date), 0)::float8 as sales,
        (select t.amount::float8 from sales_target t where t.person_id = ${personId} and t.month = ${first}::date) as target,
        coalesce((select sum(i.total - coalesce((select sum(pm.amount) from payment pm where pm.invoice_id = i.id and pm.paid_on <= ${upTo}::date), 0))
          from invoice i join sales_order o on o.id = i.order_id
          where ${mine} and i.status <> 'cancelled' and i.terms = 'days' and i.issued_on <= ${upTo}::date), 0)::float8 as owed,
        coalesce((select sum(i.total) from invoice i join sales_order o on o.id = i.order_id
          where ${mine} and i.status <> 'cancelled' and i.terms = 'days'
            and i.issued_on between (${upTo}::date - 89) and ${upTo}::date), 0)::float8 as credit90,
        (select count(distinct i.customer_id) from invoice i join sales_order o on o.id = i.order_id
          where ${mine} and i.status <> 'cancelled' and i.issued_on between ${prevFirst}::date and (${first}::date - 1))::int as "lastCustomers",
        (select count(distinct i.customer_id) from invoice i join sales_order o on o.id = i.order_id
          where ${mine} and i.status <> 'cancelled' and i.issued_on between ${prevFirst}::date and (${first}::date - 1)
            and exists (select 1 from invoice n where n.customer_id = i.customer_id and n.status <> 'cancelled'
              and n.issued_on between ${first}::date and ${upTo}::date))::int as "cameBack",
        (select count(*) from lead l where l.assigned_to = ${personId}
          and (l.first_contact_at at time zone 'Asia/Manila')::date between ${first}::date and ${upTo}::date)::int as enquiries,
        (select count(*) from lead l where l.assigned_to = ${personId} and l.customer_id is not null
          and (l.first_contact_at at time zone 'Asia/Manila')::date between ${first}::date and ${upTo}::date
          and (select min(n.issued_on) from invoice n where n.customer_id = l.customer_id and n.status <> 'cancelled')
            between ${first}::date and ${upTo}::date)::int as converted,
        (select count(*) from sales_order o where ${mine} and o.status <> 'draft'
          and (coalesce(o.submitted_at, o.created_at) at time zone 'Asia/Manila')::date between ${first}::date and ${upTo}::date)::int as orders,
        (select count(*) from sales_order o where ${mine} and o.status = 'cancelled'
          and (coalesce(o.submitted_at, o.created_at) at time zone 'Asia/Manila')::date between ${first}::date and ${upTo}::date)::int as cancelled`,
  );
  const invoiceDays = await rows<{ day: string }>(
    db,
    sql`select distinct to_char(i.issued_on, 'YYYY-MM-DD') as day from invoice i join sales_order o on o.id = i.order_id
      where ${mine} and i.status <> 'cancelled' and i.issued_on between ${first}::date and ${upTo}::date`,
  );
  const holidays = await holidaysIn(db, first, last);
  const workDay = (day: string) => isWorkDay(day, DEFAULT_SCHEDULE, holidays);
  const workedSoFar = daysBetween(first, upTo).filter(workDay).length;
  const workInMonth = daysBetween(first, last).filter(workDay).length;
  const daysWithInvoice = invoiceDays.filter((one) => workDay(one.day)).length;
  const r = row as NonNullable<typeof row>;
  const peso = (centavos: number) => `₱${Math.round(centavos / 100).toLocaleString("en-PH")}`;

  const values: Record<string, number | null> = {};
  const notes: Record<string, string> = {};
  // IST: the month's sales against its target; a running month on its working-day pace.
  const pace = live && workedSoFar > 0 ? (r.sales * workInMonth) / workedSoFar : r.sales;
  values.ist = r.target && r.target > 0 ? (pace / r.target) * 100 : null;
  notes.ist = r.target
    ? `${peso(r.sales)} of ${peso(r.target)}${live ? `, ${peso(pace)} on the pace of ${workedSoFar} of ${workInMonth} working days` : ""}`
    : "No target for this month";
  // DSO: what credit customers owe at the day, over the last 90 days' credit sales.
  values.dso = r.credit90 > 0 ? (r.owed / r.credit90) * 90 : r.owed > 0 ? 365 : null;
  notes.dso = `${peso(r.owed)} owed on credit, ${peso(r.credit90)} sold on credit in 90 days`;
  // HRR / CRR: last month's customers who bought again this month.
  const back = r.lastCustomers > 0 ? (r.cameBack / r.lastCustomers) * 100 : null;
  values.hrr = back;
  values.crr = back;
  notes.hrr = notes.crr = r.lastCustomers ? `${r.cameBack} of last month's ${r.lastCustomers} bought again` : "No customers last month";
  values.nzsd = workedSoFar > 0 ? Math.min(100, (daysWithInvoice / workedSoFar) * 100) : null;
  notes.nzsd = `${daysWithInvoice} of ${workedSoFar} working days with an invoice`;
  values.nbd = r.enquiries > 0 ? (r.converted / r.enquiries) * 100 : null;
  notes.nbd = r.enquiries ? `${r.converted} of ${r.enquiries} new enquiries ordered` : "No new enquiries yet";
  values.ocr = r.orders > 0 ? (r.cancelled / r.orders) * 100 : null;
  notes.ocr = r.orders ? `${r.cancelled} of ${r.orders} orders cancelled` : "No orders yet";
  if (recipe.key === "rx") {
    const doctorInvoices = sql`invoice i join sales_order o on o.id = i.order_id join customer c on c.id = i.customer_id`;
    const [rx] = await rows<{ newDoctors: number; lastDoctors: number; doctorsBack: number; approved: number; visited: number }>(
      db,
      sql`select
          (select count(distinct i.customer_id) from ${doctorInvoices}
            where ${mine} and c.kind = 'doctor' and i.status <> 'cancelled' and i.issued_on between ${first}::date and ${upTo}::date
              and not exists (select 1 from invoice e where e.customer_id = i.customer_id and e.status <> 'cancelled' and e.issued_on < ${first}::date))::int as "newDoctors",
          (select count(distinct i.customer_id) from ${doctorInvoices}
            where ${mine} and c.kind = 'doctor' and i.status <> 'cancelled' and i.issued_on between ${prevFirst}::date and (${first}::date - 1))::int as "lastDoctors",
          (select count(distinct i.customer_id) from ${doctorInvoices}
            where ${mine} and c.kind = 'doctor' and i.status <> 'cancelled' and i.issued_on between ${prevFirst}::date and (${first}::date - 1)
              and exists (select 1 from invoice n where n.customer_id = i.customer_id and n.status <> 'cancelled'
                and n.issued_on between ${first}::date and ${upTo}::date))::int as "doctorsBack",
          (select count(*) from lead l where l.assigned_to = ${personId} and l.road = 'gl'
            and l.gl_letter_on between ${first}::date and ${upTo}::date)::int as approved,
          (select count(distinct v.customer_id) from visit v join customer c on c.id = v.customer_id
            where v.person_id = ${personId} and v.status = 'done' and c.kind = 'doctor'
              and v.day between ${first}::date and ${upTo}::date)::int as visited`,
    );
    const x = rx as NonNullable<typeof rx>;
    const rxValues: Record<string, number | null> = {
      nbd: x.newDoctors,
      crr: x.lastDoctors > 0 ? (x.doctorsBack / x.lastDoctors) * 100 : null,
      pap: x.approved,
      // The formulary tracker comes in Phase 5.
      hit: null,
      ccf: (x.visited / DOCTOR_LIST) * 100,
    };
    const rxNotes: Record<string, string> = {
      nbd: `${x.newDoctors} doctors invoiced for the first time`,
      crr: x.lastDoctors ? `${x.doctorsBack} of last month's ${x.lastDoctors} doctors again` : "No doctors last month",
      pap: `${x.approved} guarantee letters received`,
      hit: "Not in the CRM yet: the formulary tracker comes in Phase 5",
      ccf: `${x.visited} of ${DOCTOR_LIST} doctors visited`,
    };
    // A rep is scored once they visit, sell, get a letter or have a target.
    return { values: rxValues, notes: rxNotes, active: Boolean(r.target || r.sales || r.orders || x.visited || x.approved) };
  }
  // A month with no target, no sale, no order and no enquiry has nothing to score (days without
  // an invoice alone don't make a card).
  const active = Boolean(r.target || r.sales || r.orders || r.lastCustomers || r.enquiries);
  const facts: MonthFacts = { sales: r.sales, target: r.target, owed: r.owed, workedSoFar, daysWithInvoice };
  return { values, notes, active, facts };
}

/** The plain figures behind a month's card, for the coaches' screens. */
export type MonthFacts = { sales: number; target: number | null; owed: number; workedSoFar: number; daysWithInvoice: number };

/** A lead's month: the average of the cards of the people in the seats under them (not other
 *  leads, so a head's number isn't counted twice). */
async function teamMeasure(db: Database, personId: number, month: string, upTo: string) {
  const [who] = await rows<{ role: Me["role"] }>(db, sql`select role from person where id = ${personId}`);
  if (!who) return { values: { team: null }, notes: { team: "" }, active: false };
  let seatIds: number[] = [];
  try {
    seatIds = (await teamSeats(db, { id: personId, role: who.role } as Me, null)).seatIds;
  } catch {
    seatIds = [];
  }
  const members = seatIds.length
    ? await rows<{ personId: number; module: string; lead: boolean; channel: string | null }>(
        db,
        sql`select distinct on (h.person_id) h.person_id::int as "personId", s.module, s.lead, ch.code as channel
          from seat s join seat_holder h on h.seat_id = s.id and h.kind = 'holder' and ${inForce("h", upTo)}
            left join area a on a.id = s.area_id left join channel ch on ch.id = a.channel_id
          where s.id in (${sql.join(seatIds.map((id) => sql`${id}`), sql`, `)}) and h.person_id <> ${personId}
          order by h.person_id, h.starts_on desc`,
      )
    : [];
  const percents: number[] = [];
  for (const member of members) {
    const recipe = recipeFor(member);
    if (!recipe || recipe.key === "team") continue;
    const card = await cardOf(db, member.personId, month, upTo);
    if (card && card.max > 0) percents.push(card.percent);
  }
  const average = percents.length ? percents.reduce((a, b) => a + b, 0) / percents.length : null;
  return {
    values: { team: average },
    notes: { team: percents.length ? `${percents.length} people's cards averaged` : "No one under them has a card yet" },
    active: percents.length > 0,
  };
}

/** A person's card for a month: the locked one when the month is locked, else worked out now. */
export async function cardOf(db: Database, personId: number, month: string, today = todayManila()): Promise<ScoreCard | null> {
  const [locked] = await rows<{ recipe: string; total: number; max: number; capped: boolean; kpis: ScoreCard["kpis"]; lockedAt: string }>(
    db,
    sql`select recipe, total, max, capped, kpis, to_char(locked_at at time zone 'Asia/Manila', 'YYYY-MM-DD') as "lockedAt"
      from score_month where person_id = ${personId} and month = ${firstOf(month)}::date`,
  );
  if (locked) {
    const recipe = RECIPES[locked.recipe as keyof typeof RECIPES];
    return {
      month: month.slice(0, 7), recipe: locked.recipe, label: recipe?.label ?? locked.recipe, source: recipe?.source ?? "",
      live: false, lockedOn: locked.lockedAt, upTo: lastOf(month), total: locked.total, max: locked.max,
      percent: locked.max ? Math.round((locked.total * 100) / locked.max) : 0, capped: locked.capped, kpis: locked.kpis,
    };
  }
  if (firstOf(month) > today) return null;
  const live = lastOf(month) >= today;
  const upTo = live ? today : lastOf(month);
  const recipe = recipeFor(await seatOn(db, personId, upTo));
  if (!recipe) return null;
  const { values, notes, active } = await measure(db, personId, recipe, month, upTo, live);
  // Nothing to score (no target, sale, order, enquiry; for a lead, no one carded): no card.
  if (!active) return null;
  const scored = scoreOf(recipe, values);
  return {
    month: month.slice(0, 7), recipe: recipe.key, label: recipe.label, source: recipe.source, live, lockedOn: null, upTo,
    total: scored.total, max: scored.max, percent: scored.max ? Math.round((scored.total * 100) / scored.max) : 0,
    capped: scored.capped, kpis: scored.kpis.map((kpi) => ({ ...kpi, note: notes[kpi.key] ?? "" })),
  };
}

/** Locks a month for everyone who held a scored seat in it; a card with nothing to measure is
 *  not kept (nor one with no target, sale, order or enquiry). Returns how many were locked. `again` (the Admin) rewrites ones already locked. */
export async function lockMonth(db: Database, month: string, again = false): Promise<number> {
  const first = firstOf(month);
  const last = lastOf(month);
  const people = await rows<{ personId: number; seatId: number; module: string; lead: boolean; channel: string | null }>(
    db,
    sql`select distinct on (h.person_id) h.person_id::int as "personId", s.id::int as "seatId", s.module, s.lead, ch.code as channel
      from seat_holder h join seat s on s.id = h.seat_id
        left join area a on a.id = s.area_id left join channel ch on ch.id = a.channel_id
      where h.kind = 'holder' and h.starts_on <= ${last}::date and (h.ends_on is null or h.ends_on >= ${first}::date)
      order by h.person_id, h.starts_on desc, h.id desc`,
  );
  // Leads last: their card is their team's locked cards.
  people.sort((a, b) => Number(recipeFor(a)?.key === "team") - Number(recipeFor(b)?.key === "team"));
  let locked = 0;
  for (const one of people) {
    const recipe = recipeFor(one);
    if (!recipe) continue;
    const { values, notes, active } = await measure(db, one.personId, recipe, month, last, false);
    const scored = scoreOf(recipe, values);
    if (!active || scored.max === 0) continue;
    const kpis = JSON.stringify(scored.kpis.map((kpi) => ({ ...kpi, note: notes[kpi.key] ?? "" })));
    const done = await rows<{ n: number }>(
      db,
      sql`insert into score_month (person_id, month, recipe, seat_id, total, max, capped, kpis)
        values (${one.personId}, ${first}::date, ${recipe.key}, ${one.seatId}, ${scored.total}, ${scored.max}, ${scored.capped}, ${kpis}::jsonb)
        on conflict (person_id, month) do ${again
          ? sql`update set recipe = excluded.recipe, seat_id = excluded.seat_id, total = excluded.total, max = excluded.max,
              capped = excluded.capped, kpis = excluded.kpis, locked_at = now()`
          : sql`nothing`}
        returning 1 as n`,
    );
    locked += done.length;
  }
  return locked;
}

/** Locks the months before this one (up to a year back) that have not been locked yet. */
export async function lockDue(db: Database, today = todayManila()): Promise<number> {
  let locked = 0;
  for (let back = 12; back >= 1; back--) {
    const month = shiftMonth(today, -back);
    const [done] = await rows<{ n: number }>(
      db,
      sql`select count(*)::int as n from score_month where month = ${firstOf(month)}::date`,
    );
    if (done?.n) continue;
    locked += await lockMonth(db, month);
  }
  return locked;
}

/** The 12 locked months before a month, oldest first, their average and the increment band. */
async function yearOf(db: Database, personId: number, month: string) {
  const history = await rows<{ month: string; total: number; max: number }>(
    db,
    sql`select to_char(month, 'YYYY-MM') as month, total, max from score_month
      where person_id = ${personId} and month < ${firstOf(month)}::date and month >= ${firstOf(shiftMonth(month, -12))}::date
      order by month`,
  );
  const percents = history.map((one) => (one.max ? (one.total * 100) / one.max : 0));
  const average = percents.length ? Math.round(percents.reduce((a, b) => a + b, 0) / percents.length) : null;
  const band = average === null ? null : incrementOf(average);
  const lastTwo = percents.slice(-2);
  return {
    history: history.map((one) => ({ ...one, percent: one.max ? Math.round((one.total * 100) / one.max) : 0 })),
    average,
    increment: band ? { percent: band.increment, label: band.label } : null,
    // Below 60 two locked months running: the playbooks' improvement plan.
    pip: lastTwo.length === 2 && lastTwo.every((one) => one < 60),
  };
}

async function disputesOf(db: Database, personIds: number[], month: string): Promise<ScoreDispute[]> {
  if (!personIds.length) return [];
  return rows<ScoreDispute>(
    db,
    sql`select d.id::int as id, d.person_id::int as "personId", p.name as person, to_char(d.month, 'YYYY-MM') as month, d.kpi, d.note,
        to_char(d.raised_at at time zone 'Asia/Manila', 'YYYY-MM-DD') as "raisedOn", d.state, d.answer, b.name as "answeredBy"
      from score_dispute d join person p on p.id = d.person_id left join person b on b.id = d.answered_by
      where d.person_id in (${sql.join(personIds.map((id) => sql`${id}`), sql`, `)})
        and (d.month = ${firstOf(month)}::date or d.state = 'open')
      order by d.raised_at desc`,
  );
}

/** Whether `me` may see a person's card: their own, someone in a seat under them, or anyone for
 *  the CEO and the Admin. */
async function maySee(db: Database, me: Me, personId: number): Promise<boolean> {
  if (personId === me.id || WHOLE.includes(me.role)) return true;
  if (me.role !== "team_lead" && me.role !== "manager") return false;
  const { seatIds } = await teamSeats(db, me, null);
  if (!seatIds.length) return false;
  const [found] = await rows<{ n: number }>(
    db,
    sql`select count(*)::int as n from seat_holder h where h.person_id = ${personId} and h.kind = 'holder'
      and h.seat_id in (${sql.join(seatIds.map((id) => sql`${id}`), sql`, `)})`,
  );
  return Boolean(found?.n);
}

const monthOf = (asked: string | undefined, today: string) =>
  asked && /^\d{4}-(0[1-9]|1[0-2])$/.test(asked) && asked <= today.slice(0, 7) ? asked : today.slice(0, 7);

export async function myScore(db: Database, me: Me, asked: { month?: string; personId?: number }): Promise<MyScore> {
  const today = todayManila();
  const month = monthOf(asked.month, today);
  const personId = asked.personId ?? me.id;
  if (!(await maySee(db, me, personId))) throw new Refusal(403, "not_allowed", "That person's score isn't yours to see.");
  const [who] = await rows<{ name: string }>(db, sql`select name from person where id = ${personId}`);
  if (!who) throw new Refusal(404, "not_found", "No such person.");
  const seat = await seatOn(db, personId, month === today.slice(0, 7) ? today : lastOf(month));
  const [card, year, disputes] = await Promise.all([
    cardOf(db, personId, month, today),
    yearOf(db, personId, shiftMonth(today, 1)),
    disputesOf(db, [personId], month),
  ]);
  return {
    personId, name: who.name, seat: seat?.title ?? null, area: seat?.area ?? null, month, today, card, ...year, disputes,
    mine: personId === me.id,
  };
}

export async function teamScores(db: Database, me: Me, asked: { month?: string; unitId?: number | null }): Promise<TeamScores> {
  const today = todayManila();
  const month = monthOf(asked.month, today);
  const { seatIds } = await teamSeats(db, me, asked.unitId ?? null);
  const day = month === today.slice(0, 7) ? today : lastOf(month);
  const seats = seatIds.length
    ? await rows<{ seatId: number; title: string; area: string | null; unit: string; module: string; lead: boolean; channel: string | null; personId: number | null; name: string | null }>(
        db,
        sql`select s.id::int as "seatId", s.title, a.name as area, u.name as unit, s.module, s.lead, ch.code as channel,
            h.person_id::int as "personId", p.name
          from seat s join org_unit u on u.id = s.unit_id left join area a on a.id = s.area_id left join channel ch on ch.id = a.channel_id
            left join lateral (select x.person_id from seat_holder x where x.seat_id = s.id and x.kind = 'holder' and ${inForce("x", day)}
              order by x.starts_on desc, x.id desc limit 1) h on true
            left join person p on p.id = h.person_id
          where s.id in (${sql.join(seatIds.map((id) => sql`${id}`), sql`, `)})
          order by u.name, s.sort, s.title`,
      )
    : [];
  const scored = seats.filter((seat) => recipeFor(seat));
  const people = await Promise.all(
    scored.map(async (seat) => {
      if (!seat.personId) return { ...seat, card: null, average: null, increment: null, pip: false, history: [] };
      const [card, year] = await Promise.all([cardOf(db, seat.personId, month, today), yearOf(db, seat.personId, shiftMonth(today, 1))]);
      return { ...seat, card, ...year };
    }),
  );
  // A lead's row only when someone under them has a card.
  const shown = people.filter((one) => one.card || recipeFor(one)?.key !== "team");
  const ids = shown.flatMap((one) => (one.personId ? [one.personId] : []));
  return {
    month,
    today,
    rows: shown.map((one) => ({
      seatId: one.seatId, title: one.title, area: one.area, unit: one.unit, personId: one.personId, name: one.name,
      card: one.card, average: one.average, increment: one.increment, pip: one.pip,
      history: one.history.map((h) => ({ month: h.month, percent: h.percent })),
    })),
    disputes: await disputesOf(db, ids, month),
  };
}

export async function raiseDispute(db: Database, me: Me, input: { month: string; kpi: string; note: string }): Promise<{ id: number }> {
  const [locked] = await rows<{ kpis: { key: string }[] }>(
    db,
    sql`select kpis from score_month where person_id = ${me.id} and month = ${firstOf(input.month)}::date`,
  );
  if (!locked) throw new Refusal(400, "not_locked", "Only a locked month can be questioned; this one is still running.", "month");
  if (!locked.kpis.some((kpi) => kpi.key === input.kpi)) throw new Refusal(400, "invalid", "Pick a figure from that month's card.", "kpi");
  const [made] = await rows<{ id: number }>(
    db,
    sql`insert into score_dispute (person_id, month, kpi, note) values (${me.id}, ${firstOf(input.month)}::date, ${input.kpi}, ${input.note})
      returning id::int as id`,
  );
  return made as { id: number };
}

export async function answerDispute(db: Database, me: Me, id: number, input: { upheld: boolean; answer: string }): Promise<void> {
  const [found] = await rows<{ personId: number; state: string }>(
    db,
    sql`select person_id::int as "personId", state from score_dispute where id = ${id}`,
  );
  if (!found) throw new Refusal(404, "not_found", "No such question.");
  if (found.personId === me.id || !(await maySee(db, me, found.personId)))
    throw new Refusal(403, "not_allowed", "Their lead answers this.");
  if (found.state !== "open") throw new Refusal(409, "answered", "This was answered already.");
  await db.execute(
    sql`update score_dispute set state = ${input.upheld ? "upheld" : "turned_down"}, answer = ${input.answer},
      answered_by = ${me.id}, answered_at = now() where id = ${id}`,
  );
}

/** For a lead's "needs you now": the people under them whose month is going badly on their card
 *  (below 60 with a week gone), whose coverage gate is failing, or who are due an improvement
 *  plan (below 60 two locked months running). Leads' own team cards are left out. */
export async function scoreNeeds(db: Database, seatIds: number[], today: string): Promise<TeamNeed[]> {
  if (!seatIds.length) return [];
  const held = await rows<{ seatId: number; personId: number; name: string; module: string; lead: boolean; channel: string | null }>(
    db,
    sql`select distinct on (h.person_id) s.id::int as "seatId", h.person_id::int as "personId", p.name, s.module, s.lead, ch.code as channel
      from seat s join seat_holder h on h.seat_id = s.id and h.kind = 'holder' and ${inForce("h", today)}
        join person p on p.id = h.person_id
        left join area a on a.id = s.area_id left join channel ch on ch.id = a.channel_id
      where s.id in (${sql.join(seatIds.map((id) => sql`${id}`), sql`, `)})
      order by h.person_id, h.starts_on desc`,
  );
  const needs: TeamNeed[] = [];
  const base = { orderId: null, code: null, customer: null, customerId: null, since: null, amount: null } as const;
  for (const one of held) {
    const recipe = recipeFor(one);
    if (!recipe || recipe.key === "team") continue;
    const [card, year] = await Promise.all([cardOf(db, one.personId, today.slice(0, 7), today), yearOf(db, one.personId, shiftMonth(today, 1))]);
    if (year.pip)
      needs.push({ ...base, kind: "score", who: one.name, seatId: one.seatId, why: "Below 60 two months running: the improvement plan is due" });
    if (!card) continue;
    // Give the month a week before calling a low score.
    if (Number(today.slice(8)) >= 8 && card.max > 0 && card.percent < 60)
      needs.push({ ...base, kind: "score", who: one.name, seatId: one.seatId, why: `Score ${card.total} of ${card.max} this month, below 60` });
    const gate = card.kpis.find((kpi) => kpi.weight === 0 && kpi.band && kpi.band !== "Pass");
    if (gate && Number(today.slice(8)) >= 15)
      needs.push({ ...base, kind: "score", who: one.name, seatId: one.seatId, why: `${gate.label.split(" ·")[0]} gate failing: ${gate.note}` });
  }
  return needs;
}
