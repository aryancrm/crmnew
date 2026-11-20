// The tour plan (SEFMED's Tour Plan Calendar, docs/PLAN.md 22): the month with each day's marks
// (the plan, leave asked / approved / refused from HR, holidays), a day's work place, cities and
// who works along, the visits added by city (visits.ts addVisits); Create tour plan sends the
// month to the team lead, who approves it or sends it back with a word. Each decision keeps the
// plan as it was (a revision). Once approved, a change is a deviation with the MR's reason: a
// visit added, moved or dropped (visits.ts) or a day's place changed (here); the lead approves it
// or not. The plan never stops the day's work.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { workCalendar } from "../hr/attendance";
import { isWorkDay } from "../hr/work-time";
import { Refusal } from "../http";
import { addDays, todayManila } from "../inventory/rules";
import { clean, iso, type Runner } from "../inventory/service";
import { notify } from "../notify/service";
import type { Me } from "../types";
import { idArray, isLeadNow, membersFrom, mustLead, mustSee, mustWork, textArray } from "./access";
import { addDeviation, planApproved } from "./visits";
import { type DeviationRow, type PlanMonth, type PlanStatus, WORK_TYPES, type WorkType } from "./words";

const MONTH = /^\d{4}-\d{2}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const lastOf = (month: string) => addDays(`${addDays(`${month}-01`, 32).slice(0, 7)}-01`, -1);

async function deviationRows(db: Runner, where: ReturnType<typeof sql>): Promise<DeviationRow[]> {
  return rows<DeviationRow>(
    db,
    sql`select d.id::int as id, json_build_object('id', p.id::int, 'name', p.name) as person, to_char(d.day, 'YYYY-MM-DD') as day,
        d.kind, d.visit_id::int as "visitId", (select c.name from mr_visit v join mr_client c on c.id = v.client_id where v.id = d.visit_id) as client,
        to_char(d.from_day, 'YYYY-MM-DD') as "fromDay", to_char(d.to_day, 'YYYY-MM-DD') as "toDay", d.note, d.status,
        (select name from person where id = d.decided_by) as "decidedBy", d.decision_note as "decisionNote", ${iso("d.made_at")} as "madeAt"
      from mr_deviation d join person p on p.id = d.person_id where ${where} order by d.made_at desc, d.id desc limit 300`,
  );
}

/** A person's month of the tour plan. */
export async function planMonth(db: Database, me: Me, asked: { month?: string | null; person?: number | null }): Promise<PlanMonth> {
  const today = todayManila();
  const month = asked.month && MONTH.test(asked.month) ? asked.month : today.slice(0, 7);
  const personId = asked.person ?? me.id;
  const access = await mustSee(db, me, personId);
  const first = `${month}-01`;
  const last = lastOf(month);
  const [{ schedule, holidays }, holidayNames, leave, planDays, counts, plan, cities, revisions, deviations, person, lead] =
    await Promise.all([
      workCalendar(db),
      rows<{ day: string; name: string }>(
        db,
        sql`select to_char(day, 'YYYY-MM-DD') as day, name from holiday where active and day between ${first}::date and ${last}::date`,
      ),
      rows<{ from: string; to: string; status: "approved" | "asked" | "refused" }>(
        db,
        sql`select to_char(from_day, 'YYYY-MM-DD') as "from", to_char(to_day, 'YYYY-MM-DD') as "to", status from person_leave
          where person_id = ${personId} and status in ('approved', 'asked', 'refused') and from_day <= ${last}::date and to_day >= ${first}::date`,
      ),
      rows<{ day: string; workType: WorkType; cities: string[]; workingWith: { id: number; name: string }[]; note: string | null }>(
        db,
        sql`select to_char(d.day, 'YYYY-MM-DD') as day, d.work_type as "workType", to_json(d.cities) as cities,
            coalesce((select json_agg(json_build_object('id', p.id::int, 'name', p.name)) from person p where p.id = any (d.working_with)), '[]'::json) as "workingWith",
            d.note
          from mr_plan_day d where d.person_id = ${personId} and d.day between ${first}::date and ${last}::date`,
      ),
      rows<{ day: string; planned: number; done: number }>(
        db,
        sql`select to_char(day, 'YYYY-MM-DD') as day, count(*) filter (where status in ('planned', 'done', 'missed'))::int as planned,
            count(*) filter (where status = 'done')::int as done
          from mr_visit where person_id = ${personId} and day between ${first}::date and ${last}::date group by day`,
      ),
      rows<PlanMonth["plan"] & { id: number }>(
        db,
        sql`select pl.id::int as id, pl.status, pl.revision, ${iso("pl.sent_at")} as "sentAt", d.name as "decidedBy",
            ${iso("pl.decided_at")} as "decidedAt", pl.note
          from mr_plan pl left join person d on d.id = pl.decided_by where pl.person_id = ${personId} and pl.month = ${first}::date`,
      ),
      rows<{ city: string }>(
        db,
        sql`select distinct city from mr_client where active and city is not null and city <> '' order by city limit 500`,
      ),
      rows<PlanMonth["revisions"][number]>(
        db,
        sql`select r.revision, r.status, p.name as by, ${iso("r.decided_at")} as at, r.note, jsonb_array_length(r.visits)::int as visits
          from mr_plan_revision r join mr_plan pl on pl.id = r.plan_id join person p on p.id = r.decided_by
          where pl.person_id = ${personId} and pl.month = ${first}::date order by r.revision desc`,
      ),
      deviationRows(db, sql`d.person_id = ${personId} and d.day between ${first}::date and ${last}::date`),
      rows<{ id: number; name: string }>(db, sql`select id::int as id, name from person where id = ${personId}`),
      isLeadNow(db, me),
    ]);
  const own = personId === me.id && (access === "mr" || access === "lead") && !me.viewedBy;
  const status = plan[0]?.status ?? null;
  const days: PlanMonth["days"] = [];
  for (let at = first; at <= last; at = addDays(at, 1)) {
    const onLeave = leave.find((one) => one.from <= at && one.to >= at);
    const planned = planDays.find((one) => one.day === at);
    const counted = counts.find((one) => one.day === at);
    days.push({
      day: at,
      work: isWorkDay(at, schedule, holidays),
      holiday: holidayNames.find((one) => one.day === at)?.name ?? null,
      leave: onLeave?.status ?? null,
      plan: planned ? { workType: planned.workType, cities: planned.cities, workingWith: planned.workingWith, note: planned.note } : null,
      planned: counted?.planned ?? 0,
      done: counted?.done ?? 0,
      backDated: 0,
    });
  }
  const { id: _id, ...shown } = plan[0] ?? { id: 0, status: null, revision: 0, sentAt: null, decidedBy: null, decidedAt: null, note: null };
  return {
    month,
    today,
    person: person[0] as PlanMonth["person"],
    plan: shown,
    days,
    cities: cities.map((one) => one.city),
    revisions,
    deviations,
    can: {
      edit: own && month >= today.slice(0, 7) && status !== "sent",
      send: own && month >= today.slice(0, 7) && (status === null || status === "draft" || status === "sent_back"),
      decide: lead && personId !== me.id && status === "sent",
    },
  };
}

/** A day's work place, cities and who works along. Once the month is approved, a change is a
 *  deviation with why. */
export async function setPlanDay(
  db: Database,
  me: Me,
  input: { day: string; workType: WorkType; cities: string[]; workingWith?: number[] | null; note?: string | null; why?: string | null },
): Promise<void> {
  await mustWork(db, me);
  const today = todayManila();
  if (!DAY.test(input.day) || input.day < today || input.day > addDays(today, 62))
    throw new Refusal(400, "invalid", "Plan today or a day within two months.", "day");
  if (!WORK_TYPES.includes(input.workType)) throw new Refusal(400, "invalid", "Pick the work place.", "workType");
  const cities = [...new Set((input.cities ?? []).map((one) => one.trim()).filter(Boolean))];
  if (input.workType !== "transit" && !cities.length) throw new Refusal(400, "invalid", "Pick the day's city.", "cities");
  if (cities.length > 12) throw new Refusal(400, "invalid", "Twelve cities at most.", "cities");
  const partners = await membersFrom(db, me, input.workingWith, "workingWith");
  const why = clean(input.why) ?? null;
  await db.transaction(async (tx) => {
    const [plan] = await rows<{ status: PlanStatus }>(
      tx,
      sql`select status from mr_plan where person_id = ${me.id} and month = ${`${input.day.slice(0, 7)}-01`}::date for update`,
    );
    if (plan?.status === "sent") throw new Refusal(409, "invalid", "The month is with your team lead: wait for the answer.");
    const [before] = await rows<{ workType: string; cities: string[] }>(
      tx,
      sql`select work_type as "workType", to_json(cities) as cities from mr_plan_day where person_id = ${me.id} and day = ${input.day}::date`,
    );
    const changed = !before || before.workType !== input.workType || before.cities.join("|") !== cities.join("|");
    if (plan?.status === "approved" && changed && !why)
      throw new Refusal(400, "invalid", "Say why the day changes (the plan is approved).", "why");
    await tx.execute(
      sql`insert into mr_plan_day (person_id, day, work_type, cities, working_with, note)
        values (${me.id}, ${input.day}::date, ${input.workType}, ${textArray(cities)}, ${idArray(partners)}, ${clean(input.note) ?? null})
        on conflict (person_id, day) do update set work_type = excluded.work_type, cities = excluded.cities,
          working_with = excluded.working_with, note = excluded.note`,
    );
    if (plan?.status === "approved" && changed)
      await addDeviation(tx, { personId: me.id, day: input.day, kind: "place", note: why as string });
  });
}

/** Create tour plan: the month goes to the team lead (a new revision). */
export async function sendPlan(db: Database, me: Me, month: string): Promise<void> {
  await mustWork(db, me);
  const today = todayManila();
  if (!MONTH.test(month) || month < today.slice(0, 7)) throw new Refusal(400, "invalid", "Send this month or a month ahead.", "month");
  const first = `${month}-01`;
  await db.transaction(async (tx) => {
    const [planned] = await rows<{ n: number }>(
      tx,
      sql`select (select count(*) from mr_plan_day where person_id = ${me.id} and day between ${first}::date and ${lastOf(month)}::date)
          + (select count(*) from mr_visit where person_id = ${me.id} and day between ${first}::date and ${lastOf(month)}::date) as n`,
    );
    if (!Number(planned?.n)) throw new Refusal(400, "invalid", "Plan some days first: tap a day, pick its city, add visits.");
    const [plan] = await rows<{ status: PlanStatus }>(
      tx,
      sql`select status from mr_plan where person_id = ${me.id} and month = ${first}::date for update`,
    );
    if (plan && (plan.status === "sent" || plan.status === "approved"))
      throw new Refusal(409, "invalid", plan.status === "sent" ? "It is with your team lead already." : "This month is approved already.");
    await tx.execute(
      sql`insert into mr_plan (person_id, month, status, revision, sent_at) values (${me.id}, ${first}::date, 'sent', 1, now())
        on conflict (person_id, month) do update set status = 'sent', revision = mr_plan.revision + 1, sent_at = now(),
          decided_by = null, decided_at = null, note = null`,
    );
    const [lead] = await rows<{ id: number }>(tx, sql`select person_id::int as id from mr_member where role = 'lead' and active`);
    if (lead && lead.id !== me.id)
      await notify(tx, {
        to: [lead.id],
        kind: "mr_plan",
        title: "A tour plan to approve",
        body: `${me.name} · ${month}`,
        link: `/mr/plan?person=${me.id}&month=${month}`,
        key: `mr_plan:${me.id}:${month}:${Date.now()}`,
      });
  });
}

/** The team lead approves the month or sends it back with a word; the plan as it was is kept. */
export async function decidePlan(
  db: Database,
  me: Me,
  input: { person: number; month: string; approve: boolean; note?: string | null },
): Promise<void> {
  await mustLead(db, me);
  if (!MONTH.test(input.month)) throw new Refusal(400, "invalid", "Pick the month.", "month");
  if (input.person === me.id) throw new Refusal(403, "not_allowed", "Your own plan is approved by someone else.");
  const note = clean(input.note) ?? null;
  if (!input.approve && !note) throw new Refusal(400, "invalid", "Say what to change in the plan.", "note");
  const first = `${input.month}-01`;
  const last = lastOf(input.month);
  await db.transaction(async (tx) => {
    const [plan] = await rows<{ id: number; revision: number }>(
      tx,
      sql`update mr_plan set status = ${input.approve ? "approved" : "sent_back"}, decided_by = ${me.id}, decided_at = now(), note = ${note}
        where person_id = ${input.person} and month = ${first}::date and status = 'sent' returning id::int as id, revision`,
    );
    if (!plan) throw new Refusal(409, "invalid", "That plan isn't waiting for approval.");
    await tx.execute(
      sql`insert into mr_plan_revision (plan_id, revision, status, decided_by, note, days, visits)
        values (${plan.id}, ${plan.revision}, ${input.approve ? "approved" : "sent_back"}, ${me.id}, ${note},
          coalesce((select jsonb_agg(jsonb_build_object('day', to_char(d.day, 'YYYY-MM-DD'), 'workType', d.work_type, 'cities', to_jsonb(d.cities)) order by d.day)
            from mr_plan_day d where d.person_id = ${input.person} and d.day between ${first}::date and ${last}::date), '[]'::jsonb),
          coalesce((select jsonb_agg(jsonb_build_object('visitId', v.id, 'day', to_char(v.day, 'YYYY-MM-DD'), 'clientId', v.client_id) order by v.day, v.id)
            from mr_visit v where v.person_id = ${input.person} and v.day between ${first}::date and ${last}::date and v.status in ('planned', 'done')), '[]'::jsonb))`,
    );
    await notify(tx, {
      to: [input.person],
      kind: "mr_plan_decided",
      title: input.approve ? "Your tour plan is approved" : "Your tour plan was sent back",
      body: note,
      link: `/mr/plan?month=${input.month}`,
      key: `mr_plan_decided:${input.person}:${input.month}:${plan.revision}`,
    });
  });
}

/** Deviations: the lead's waiting ones (or everyone's), an MR's own. */
export async function deviationList(db: Database, me: Me, asked: { status?: string | null }): Promise<DeviationRow[]> {
  const lead = await isLeadNow(db, me);
  const status = asked.status === "all" ? sql`true` : sql`d.status = 'waiting'`;
  if (lead || me.role === "ceo") return deviationRows(db, sql`${status} and d.person_id <> ${me.id}`);
  await mustSee(db, me, me.id);
  return deviationRows(db, sql`${status} and d.person_id = ${me.id}`);
}

/** The lead approves a deviation or not, with a word (a word needed to refuse). */
export async function decideDeviation(db: Database, me: Me, id: number, input: { approve: boolean; note?: string | null }): Promise<void> {
  await mustLead(db, me);
  const note = clean(input.note) ?? null;
  if (!input.approve && !note) throw new Refusal(400, "invalid", "Say why it isn't approved.", "note");
  const changed = await rows<{ personId: number }>(
    db,
    sql`update mr_deviation set status = ${input.approve ? "approved" : "rejected"}, decided_by = ${me.id}, decided_at = now(),
        decision_note = ${note} where id = ${id} and status = 'waiting' and person_id <> ${me.id} returning person_id::int as "personId"`,
  );
  if (!changed.length) throw new Refusal(409, "invalid", "That change isn't waiting for you.");
}

/** Whether a person's month is approved (re-exported for the pages). */
export const isPlanApproved = planApproved;
