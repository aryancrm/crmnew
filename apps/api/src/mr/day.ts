// The MR's working day (SEFMED's Start working, docs/PLAN.md 22): where the day's work is (Head
// quarter, Ex-station, Out-station, In transit, Other), the day's cities and who works with them,
// with the time and the phone's place; a change of place (back to HQ too) and breaks; the day
// report on Stop working (each planned visit not done gets its reason, the day's numbers, a
// remark), which ends the day; the person's team lead marks it seen. Starting also makes the day's
// allowance lines (per diem, TA) and starts the CRM's attendance day (one record, HR's).

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { endDay, startDay } from "../hr/attendance";
import { Refusal } from "../http";
import { todayManila } from "../inventory/rules";
import { clean, iso, type Runner } from "../inventory/service";
import type { Me } from "../types";
import {
  accessOf,
  idArray,
  mayDecideFor,
  mustDecideFor,
  mustSee,
  mustWork,
  partnersOf,
  peopleFrom,
  placeOf,
  seatNow,
  textArray,
} from "./access";
import { lookedAfterBy } from "../field/visits";
import { cardColumns, cardFrom, type CardSql, toCard } from "./cards";

/** The customers (alias c) of the field's kinds a person looks after, on the field's lists. */
export const myCustomers = (personId: number, today: string) =>
  sql`c.active and c.kind in ('doctor', 'hospital', 'drugstore', 'distributor') and ${lookedAfterBy(sql`${personId}`, today)}
    and not exists (select 1 from customer_field f0 where f0.customer_id = c.id and f0.off_list)`;
import {
  type DayEvent,
  type DayReport,
  type DayState,
  MISS_REASONS,
  MISS_WORDS,
  type MissReason,
  type MrHome,
  WORK_TYPES,
  type WorkType,
} from "./words";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export type DayInput = {
  workType: WorkType;
  workNote?: string | null;
  cities: string[];
  workingWith?: number[] | null;
  place?: string | null;
  accuracy?: number | null;
};

function checkPlace(input: { workType: WorkType; workNote?: string | null; cities: string[] }) {
  if (!WORK_TYPES.includes(input.workType))
    throw new Refusal(400, "invalid", "Pick where you work today.", "workType");
  const note = clean(input.workNote) ?? null;
  if (input.workType === "other" && !note) throw new Refusal(400, "invalid", "Say where you work today.", "workNote");
  const cities = [...new Set((input.cities ?? []).map((one) => one.trim()).filter(Boolean))];
  if (input.workType !== "transit" && cities.length === 0)
    throw new Refusal(400, "invalid", "Pick the city you work in today.", "cities");
  if (cities.length > 12 || cities.some((one) => one.length > 80))
    throw new Refusal(400, "invalid", "Twelve cities at most.", "cities");
  return { note, cities };
}

/** The day's allowance lines (per diem, TA) at the rates for the work place: worked out, not
 *  claimed. A line already claimed or decided keeps its amount. */
async function allowanceLines(tx: Runner, personId: number, day: string, workType: WorkType) {
  const heads = await rows<{ code: string; allowance: "per_diem" | "ta" }>(
    tx,
    sql`select code, allowance from field_expense_head where active and allowance is not null`,
  );
  for (const head of heads) {
    const rate =
      head.allowance === "per_diem"
        ? sql`(select per_diem from field_allowance where work_type = ${workType})`
        : sql`(select ta from field_allowance where work_type = ${workType})`;
    await tx.execute(
      sql`insert into field_expense (person_id, seat_id, day, head, auto, generated, amount, status)
        values (${personId}, ${seatNow(sql`${personId}`)}, ${day}::date, ${head.code}, true, coalesce(${rate}, 0), 0, 'open')
        on conflict (person_id, day, head) where auto do update set generated = excluded.generated
          where field_expense.status = 'open'`,
    );
  }
}

/** Start working. */
export async function startWorking(db: Database, me: Me, input: DayInput): Promise<void> {
  await mustWork(db, me);
  const { note, cities } = checkPlace(input);
  const partners = await peopleFrom(db, me, input.workingWith, "workingWith");
  const place = placeOf(input.place);
  const accuracy =
    typeof input.accuracy === "number" && Number.isFinite(input.accuracy)
      ? Math.min(Math.round(input.accuracy), 100_000)
      : null;
  const today = todayManila();
  await db.transaction(async (tx) => {
    const [made] = await rows<{ id: number }>(
      tx,
      sql`insert into field_day (person_id, seat_id, day, work_type, work_note, cities, working_with, start_place, start_accuracy_m)
        values (${me.id}, ${seatNow(sql`${me.id}`, today)}, ${today}::date, ${input.workType}, ${note}, ${textArray(cities)},
          ${idArray(partners)}, ${place}, ${accuracy})
        on conflict (person_id, day) do nothing returning id::int as id`,
    );
    if (!made) throw new Refusal(409, "taken", "Your day has started already.");
    await tx.execute(
      sql`insert into field_day_event (day_id, kind, place, work_type, cities, note)
        values (${made.id}, 'start', ${place}, ${input.workType}, ${textArray(cities)}, ${note})`,
    );
    await allowanceLines(tx, me.id, today, input.workType);
  });
  // The CRM's attendance day starts too (it keeps the first time in).
  await startDay(db, me, place);
}

async function openDay(tx: Runner, me: Me) {
  const [day] = await rows<{ id: number; endedAt: string | null; onBreak: boolean }>(
    tx,
    sql`select d.id::int as id, ${iso("d.ended_at")} as "endedAt",
        coalesce((select e.kind = 'break' from field_day_event e where e.day_id = d.id and e.kind in ('break', 'resume')
          order by e.at desc, e.id desc limit 1), false) as "onBreak"
      from field_day d where d.person_id = ${me.id} and d.day = ${todayManila()}::date for update`,
  );
  if (!day) throw new Refusal(409, "not_started", "Start working first.");
  if (day.endedAt) throw new Refusal(409, "closed", "Your day is closed: the day report was sent.");
  return day;
}

/** A change of place during the day (another city, back to Head quarter). */
export async function changePlace(
  db: Database,
  me: Me,
  input: { workType: WorkType; workNote?: string | null; cities: string[]; place?: string | null },
): Promise<void> {
  await mustWork(db, me);
  const { note, cities } = checkPlace(input);
  const place = placeOf(input.place);
  await db.transaction(async (tx) => {
    const day = await openDay(tx, me);
    await tx.execute(
      sql`update field_day set work_type = ${input.workType}, work_note = ${note}, cities = ${textArray(cities)} where id = ${day.id}`,
    );
    await tx.execute(
      sql`insert into field_day_event (day_id, kind, place, work_type, cities, note)
        values (${day.id}, 'place', ${place}, ${input.workType}, ${textArray(cities)}, ${note})`,
    );
    await allowanceLines(tx, me.id, todayManila(), input.workType);
  });
}

/** A break starts, or ends. */
export async function takeBreak(db: Database, me: Me, input: { on: boolean; place?: string | null }): Promise<void> {
  await mustWork(db, me);
  await db.transaction(async (tx) => {
    const day = await openDay(tx, me);
    if (input.on === day.onBreak)
      throw new Refusal(409, "invalid", day.onBreak ? "You are on a break already." : "You aren't on a break.");
    await tx.execute(
      sql`insert into field_day_event (day_id, kind, place) values (${day.id}, ${input.on ? "break" : "resume"}, ${placeOf(input.place)})`,
    );
  });
}

/** A person's day as the pages show it, or null when it hasn't started. */
export async function dayState(db: Runner, personId: number, day: string): Promise<DayState | null> {
  const [found] = await rows<
    Omit<DayState, "onBreak" | "breakSince" | "breakMinutes" | "events" | "report"> & {
      id: number;
      reportStatus: DayState["report"]["status"];
      reportNote: string | null;
      sentAt: string | null;
      seenBy: string | null;
      seenAt: string | null;
      seenNote: string | null;
    }
  >(
    db,
    sql`select d.id::int as id, to_char(d.day, 'YYYY-MM-DD') as day, d.work_type as "workType", d.work_note as "workNote",
        to_json(d.cities) as cities,
        coalesce((select json_agg(json_build_object('id', p.id::int, 'name', p.name) order by p.name)
          from person p where p.id = any (d.working_with)), '[]'::json) as "workingWith",
        ${iso("d.started_at")} as "startedAt", d.start_place as "startPlace", ${iso("d.ended_at")} as "endedAt",
        d.end_place as "endPlace", d.report_status as "reportStatus", d.report_note as "reportNote",
        ${iso("d.sent_at")} as "sentAt", s.name as "seenBy", ${iso("d.seen_at")} as "seenAt", d.seen_note as "seenNote"
      from field_day d left join person s on s.id = d.seen_by where d.person_id = ${personId} and d.day = ${day}::date`,
  );
  if (!found) return null;
  const events = await rows<DayEvent>(
    db,
    sql`select ${iso("e.at")} as at, e.kind, e.work_type as "workType", to_json(e.cities) as cities, e.note, e.place
      from field_day_event e where e.day_id = ${found.id} order by e.at, e.id`,
  );
  let breakMinutes = 0;
  let since: string | null = null;
  for (const one of events) {
    if (one.kind === "break") since = one.at;
    if (one.kind === "resume" && since) {
      breakMinutes += (Date.parse(one.at) - Date.parse(since)) / 60_000;
      since = null;
    }
  }
  const onBreak = Boolean(since) && !found.endedAt;
  if (since) breakMinutes += Math.max(0, ((found.endedAt ? Date.parse(found.endedAt) : Date.now()) - Date.parse(since)) / 60_000);
  const { id: _id, reportStatus, reportNote, sentAt, seenBy, seenAt, seenNote, ...rest } = found;
  return {
    ...rest,
    onBreak,
    breakSince: onBreak ? since : null,
    breakMinutes: Math.round(breakMinutes),
    events,
    report: { status: reportStatus, note: reportNote, sentAt, seenBy, seenAt, seenNote },
  };
}

/** The MR's Home. */
export async function mrHome(db: Database, me: Me): Promise<MrHome> {
  const access = await accessOf(db, me);
  if (!access) throw new Refusal(403, "not_allowed", "The field's day is the MedReps' and their leads'.");
  const today = todayManila();
  const work = (access === "mr" || access === "lead") && !me.viewedBy;
  const mine = myCustomers(me.id, today);
  const [state, counted, next, visits, tiles, planned, cities, partners] = await Promise.all([
    dayState(db, me.id, today),
    rows<MrHome["counts"]>(
      db,
      sql`select count(*) filter (where not v.unplanned)::int as planned,
          count(*) filter (where v.status = 'planned')::int as open,
          count(*) filter (where v.status = 'done')::int as done,
          count(*) filter (where v.status = 'skipped')::int as skipped,
          count(*) filter (where v.status = 'missed')::int as missed,
          count(*) filter (where v.status = 'done' and v.meeting = 'met')::int as met,
          count(*) filter (where v.status = 'done' and v.productive = 'yes')::int as productive,
          (select count(*) from visit_order vo join sales_order o on o.id = vo.order_id join visit w on w.id = vo.visit_id
            where w.person_id = ${me.id} and w.day = ${today}::date and o.status <> 'cancelled')::int as booked,
          (select coalesce(sum(o.total), 0) from visit_order vo join sales_order o on o.id = vo.order_id join visit w on w.id = vo.visit_id
            where w.person_id = ${me.id} and w.day = ${today}::date and o.status <> 'cancelled')::float8 as "bookedAmount"
        from visit v where v.person_id = ${me.id} and v.day = ${today}::date`,
    ),
    rows<CardSql>(
      db,
      sql`select ${cardColumns} ${cardFrom} where v.person_id = ${me.id} and v.day = ${today}::date and v.status = 'planned'
        order by v.checked_in_at is null, v.priority nulls last, v.id limit 1`,
    ),
    rows<CardSql>(
      db,
      sql`select ${cardColumns} ${cardFrom} where v.person_id = ${me.id} and v.day = ${today}::date
        order by v.status <> 'planned', v.checked_in_at is null, v.priority nulls last, v.done_at, v.id limit 80`,
    ),
    rows<MrHome["tiles"]>(
      db,
      sql`select
          (select count(*) from customer c where ${mine} and c.kind = 'doctor')::int as doctors,
          (select count(*) from customer c where ${mine} and c.kind = 'hospital')::int as hospitals,
          (select count(*) from customer c where ${mine} and c.kind in ('drugstore', 'distributor'))::int as firms,
          (select count(*) from field_follow_up f where f.person_id = ${me.id} and f.status = 'open' and f.due_on <= ${today}::date)::int as "followUpsDue",
          (select coalesce(sum(x.amount), 0) from field_expense x where x.person_id = ${me.id} and x.status <> 'open'
            and x.day >= ${`${today.slice(0, 7)}-01`}::date)::float8 as claimed`,
    ),
    rows<{ workType: WorkType; cities: string[] }>(
      db,
      sql`select work_type as "workType", to_json(cities) as cities from plan_day where person_id = ${me.id} and day = ${today}::date`,
    ),
    rows<{ city: string }>(
      db,
      sql`select distinct c.city from customer c where ${mine} and c.city is not null and c.city <> ''
        order by c.city limit 400`,
    ),
    work ? partnersOf(db, me) : Promise.resolve([]),
  ]);
  let plannedCities = planned[0]?.cities ?? [];
  if (!plannedCities.length) {
    const fromVisits = await rows<{ city: string }>(
      db,
      sql`select distinct c.city from visit v join customer c on c.id = v.customer_id
        where v.person_id = ${me.id} and v.day = ${today}::date and v.status in ('planned', 'done') and c.city is not null
        order by c.city`,
    );
    plannedCities = fromVisits.map((one) => one.city);
  }
  const [person] = await rows<{ id: number; name: string }>(db, sql`select id::int as id, name from person where id = ${me.id}`);
  return {
    today,
    person: person as MrHome["person"],
    day: state,
    plannedCities,
    plannedWork: planned[0]?.workType ?? null,
    cities: cities.map((one) => one.city),
    partners,
    counts: counted[0] ?? { planned: 0, open: 0, done: 0, skipped: 0, missed: 0, met: 0, productive: 0, booked: 0, bookedAmount: 0 },
    next: next[0] ? toCard(next[0]) : null,
    visits: visits.map(toCard),
    tiles: tiles[0] ?? { doctors: 0, hospitals: 0, firms: 0, followUpsDue: 0, claimed: 0 },
    can: { work },
  };
}

/** The day report: hours, visits, business and expenses of a person's day. */
export async function dayReport(
  db: Database,
  me: Me,
  asked: { day?: string | null; person?: number | null },
): Promise<DayReport> {
  const today = todayManila();
  const day = asked.day && DAY.test(asked.day) && asked.day <= today ? asked.day : today;
  const personId = asked.person ?? me.id;
  const access = await mustSee(db, me, personId);
  const [person] = await rows<{ id: number; name: string }>(db, sql`select id::int as id, name from person where id = ${personId}`);
  if (!person) throw new Refusal(404, "not_found", "No such person.");
  const [state, cards, business, expenses, lead] = await Promise.all([
    dayState(db, personId, day),
    rows<CardSql>(
      db,
      sql`select ${cardColumns} ${cardFrom} where v.person_id = ${personId} and v.day = ${day}::date order by v.checked_in_at nulls last, v.id`,
    ),
    rows<DayReport["business"]>(
      db,
      sql`select
          (select count(*) from visit_order vo join sales_order o on o.id = vo.order_id join visit w on w.id = vo.visit_id
            where w.person_id = ${personId} and w.day = ${day}::date and o.status <> 'cancelled')::int as booked,
          (select coalesce(sum(o.total), 0) from visit_order vo join sales_order o on o.id = vo.order_id join visit w on w.id = vo.visit_id
            where w.person_id = ${personId} and w.day = ${day}::date and o.status <> 'cancelled')::float8 as "bookedAmount",
          (select count(*) from visit v where v.person_id = ${personId} and v.day = ${day}::date and v.chance_amount is not null)::int as chances,
          (select coalesce(sum(v.chance_amount), 0) from visit v where v.person_id = ${personId} and v.day = ${day}::date)::float8 as "chanceAmount",
          (select count(*) from field_follow_up f where f.person_id = ${personId} and (f.made_at at time zone 'Asia/Manila')::date = ${day}::date)::int as "followUpsMade",
          (select count(*) from field_follow_up f where f.person_id = ${personId} and f.status = 'open' and f.due_on <= ${day}::date)::int as "followUpsDue",
          (select coalesce(sum(-m.qty), 0) from sample_move m where m.person_id = ${personId} and m.what = 'given'
            and (m.at at time zone 'Asia/Manila')::date = ${day}::date)::int as samples`,
    ),
    rows<DayReport["expenses"]>(
      db,
      sql`select coalesce(sum(x.generated), 0)::float8 as generated,
          coalesce(sum(x.amount) filter (where x.status <> 'open'), 0)::float8 as claimed, count(*)::int as lines
        from field_expense x where x.person_id = ${personId} and x.day = ${day}::date`,
    ),
    mayDecideFor(db, me, personId),
  ]);
  const all = cards.map(toCard);
  const count = (test: (one: (typeof all)[number]) => boolean) => all.filter(test).length;
  const closed = all.filter((one) => one.status === "done");
  const end = state?.endedAt ? Date.parse(state.endedAt) : day === today ? Date.now() : null;
  const workedMinutes = state && end ? Math.max(0, Math.round((end - Date.parse(state.startedAt)) / 60_000) - state.breakMinutes) : 0;
  const mine = personId === me.id && (access === "mr" || access === "lead") && !me.viewedBy;
  return {
    day,
    today,
    person,
    state,
    workedMinutes,
    visits: {
      planned: count((one) => !one.unplanned),
      done: closed.length,
      skipped: count((one) => one.status === "skipped"),
      missed: count((one) => one.status === "missed"),
      open: count((one) => one.status === "planned"),
      unplanned: count((one) => one.unplanned),
      met: count((one) => one.status === "done" && one.meeting === "met"),
      notMet: count((one) => one.status === "done" && one.meeting !== null && one.meeting !== "met"),
      productive: count((one) => one.status === "done" && one.productive === "yes"),
      notProductive: count((one) => one.status === "done" && one.productive === "no"),
      pending: count((one) => one.status === "done" && one.productive === "pending"),
      promotional: count((one) => one.status === "done" && one.nature === "promotional"),
      business: count((one) => one.status === "done" && one.nature === "business"),
      both: count((one) => one.status === "done" && one.nature === "both"),
    },
    open: all.filter((one) => one.status === "planned"),
    closed,
    notDone: all.filter((one) => one.status === "skipped" || one.status === "missed"),
    business: business[0] ?? { booked: 0, bookedAmount: 0, chances: 0, chanceAmount: 0, followUpsMade: 0, followUpsDue: 0, samples: 0 },
    expenses: expenses[0] ?? { generated: 0, claimed: 0, lines: 0 },
    can: {
      send: mine && day === today && Boolean(state) && state?.report.status === "open",
      see: lead && personId !== me.id && state?.report.status === "sent",
    },
  };
}

/** Sends the day report and stops working: each planned visit not done gets its reason (missed). */
export async function sendDayReport(
  db: Database,
  me: Me,
  input: { missed: { visitId: number; reason: MissReason; note?: string | null }[]; note?: string | null; place?: string | null },
): Promise<void> {
  await mustWork(db, me);
  const today = todayManila();
  const place = placeOf(input.place);
  const note = clean(input.note) ?? null;
  for (const one of input.missed ?? []) {
    if (!MISS_REASONS.includes(one.reason)) throw new Refusal(400, "invalid", "Pick why each visit didn't happen.", "missed");
    if (one.reason === "other" && !clean(one.note)) throw new Refusal(400, "invalid", "Say why the visit didn't happen.", "missed");
  }
  await db.transaction(async (tx) => {
    const day = await openDay(tx, me);
    const open = await rows<{ id: number; checkedIn: boolean }>(
      tx,
      sql`select id::int as id, checked_in_at is not null as "checkedIn" from visit
        where person_id = ${me.id} and day = ${today}::date and status = 'planned' for update`,
    );
    if (open.some((one) => one.checkedIn))
      throw new Refusal(409, "invalid", "Close the call you are at before you stop working.", "missed");
    const given = new Map((input.missed ?? []).map((one) => [one.visitId, one]));
    if (open.some((one) => !given.has(one.id)))
      throw new Refusal(400, "invalid", "Give the reason for each visit not done today.", "missed");
    for (const one of open) {
      const why = given.get(one.id) as { reason: MissReason; note?: string | null };
      const text = clean(why.note) ? `${MISS_WORDS[why.reason]}: ${clean(why.note)}` : MISS_WORDS[why.reason];
      await tx.execute(sql`update visit set status = 'missed', skip_reason = ${text} where id = ${one.id}`);
      await tx.execute(sql`insert into visit_change (visit_id, what, note, by_person) values (${one.id}, 'missed', ${text}, ${me.id})`);
    }
    await tx.execute(
      sql`update field_day set report_status = 'sent', report_note = ${note}, sent_at = now(), ended_at = now(), end_place = ${place}
        where id = ${day.id}`,
    );
    await tx.execute(sql`insert into field_day_event (day_id, kind, place, note) values (${day.id}, 'stop', ${place}, ${note})`);
  });
  await endDay(db, me, place).catch(() => undefined);
}

/** The team lead marks a sent day report seen, with a word. */
export async function seeDayReport(db: Database, me: Me, input: { person: number; day: string; note?: string | null }): Promise<void> {
  await mustDecideFor(db, me, input.person);
  if (!DAY.test(input.day)) throw new Refusal(400, "invalid", "Pick the day.", "day");
  const changed = await rows<{ id: number }>(
    db,
    sql`update field_day set report_status = 'seen', seen_by = ${me.id}, seen_at = now(), seen_note = ${clean(input.note) ?? null}
      where person_id = ${input.person} and day = ${input.day}::date and report_status = 'sent' returning id::int as id`,
  );
  if (!changed.length) throw new Refusal(409, "invalid", "That day report isn't waiting to be seen.");
}
