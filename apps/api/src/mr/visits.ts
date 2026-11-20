// A visit, step by step (SEFMED's call, docs/PLAN.md 22), on the CRM's own visits and customers: put
// on a day (from the tour plan, or added on the day with why), the call objective, I'm here (the
// time, the phone's place, how far from the customer's pin), the call (met or not; the products
// promoted and how they were taken, the doctor's prescribing list; a hospital's or a firm's own
// answers; samples through the samples module), the business (the CRM's own order placed at the
// visit, a chance, promotional or business, the outcome, productive or not: said by the MR, never
// worked out), and Close the call (the place again; a follow-up and the next visit made). Skip or
// move with a reason; after the month's plan is approved, a change is a deviation for the team
// lead. A closed call stays as it is: only the person's team lead reopens it (with why) or judges
// a "not sure yet".

import { sql } from "drizzle-orm";
import { seen, team } from "../customers/service";
import { type Database, rows } from "../db/index";
import { bytesOf, type IncomingFile, keepFile } from "../files/store";
import { moneyOf } from "../finance/service";
import { Refusal } from "../http";
import { addDays, todayManila } from "../inventory/rules";
import { clean, iso, type Runner } from "../inventory/service";
import { notify } from "../notify/service";
import { STATUS_LABEL } from "../orders/rules";
import type { Me, OrderStatus } from "../types";
import {
  accessOf,
  fieldPerson,
  ids,
  idArray,
  inTeam,
  leadOf,
  mayDecideFor,
  metresBetween,
  mustDecideFor,
  mustSee,
  mustWork,
  partnersOf,
  peopleFrom,
  placeOf,
  seatNow,
  teamSql,
  textArray,
  words,
} from "./access";
import { cardColumns, cardFrom, type CardSql, clientJson, FIELD_KINDS, toCard } from "./cards";
import {
  type CallDetails,
  type CallProduct,
  CLIENT_KINDS,
  type ClientKind,
  type CloseCallInput,
  clientKindOf,
  type FieldOrder,
  FOLLOW_UP_KINDS,
  MEETINGS,
  MISS_REASONS,
  MISS_WORDS,
  type MissReason,
  NATURES,
  OBJECTIVES,
  OUTCOMES,
  PRODUCTIVES,
  REACTIONS,
  stateOf,
  type VisitList,
  type VisitPage,
  type VisitState,
} from "./words";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;
/** A check-in farther than this from the customer's pin is "away from the place". */
export const NEAR_METRES = 300;
const ahead = (today: string) => addDays(today, 62);
const FILE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"];
export const FILE_MAX = 10 * 1024 * 1024;

/** Whether the person's tour plan for that day's month is approved (changes are deviations). */
export async function planApproved(db: Runner, personId: number, day: string): Promise<boolean> {
  const [plan] = await rows<{ status: string }>(
    db,
    sql`select status from visit_plan where person_id = ${personId} and month = ${`${day.slice(0, 7)}-01`}::date`,
  );
  return plan?.status === "approved";
}

export async function addDeviation(
  tx: Runner,
  input: { personId: number; day: string; kind: "moved" | "added" | "dropped" | "place"; visitId?: number | null; fromDay?: string | null; toDay?: string | null; note: string },
) {
  await tx.execute(
    sql`insert into plan_deviation (person_id, day, kind, visit_id, from_day, to_day, note)
      values (${input.personId}, ${input.day}::date, ${input.kind}, ${input.visitId ?? null}, ${input.fromDay ?? null}::date,
        ${input.toDay ?? null}::date, ${input.note})`,
  );
  const lead = await leadOf(tx, input.personId);
  if (lead)
    await notify(tx, {
      to: [lead],
      kind: "field_deviation",
      title: "A change to an approved tour plan",
      body: input.note,
      link: "/field/plan?view=deviations",
      key: `field_deviation:${input.personId}:${input.day}:${input.kind}:${input.visitId ?? 0}:${Date.now()}`,
    });
}

type VisitLock = { id: number; personId: number; customerId: number; kind: ClientKind; day: string; status: string; checkedInAt: string | null; pin: string | null };

async function lockVisit(tx: Runner, visitId: number): Promise<VisitLock> {
  const [visit] = await rows<VisitLock & { customerKind: string }>(
    tx,
    sql`select v.id::int as id, v.person_id::int as "personId", v.customer_id::int as "customerId", c.kind as "customerKind",
        to_char(v.day, 'YYYY-MM-DD') as day, v.status, ${iso("v.checked_in_at")} as "checkedInAt", c.pin
      from visit v join customer c on c.id = v.customer_id where v.id = ${visitId} for update of v`,
  );
  if (!visit) throw new Refusal(404, "not_found", "No such visit.");
  return { ...visit, kind: clientKindOf(visit.customerKind) ?? "doctor" };
}

async function ownOpen(tx: Runner, me: Me, visitId: number): Promise<VisitLock> {
  const visit = await lockVisit(tx, visitId);
  if (visit.personId !== me.id) throw new Refusal(403, "not_allowed", "Only the person visiting works their visit.");
  if (visit.status !== "planned") throw new Refusal(409, "invalid", "That visit is already closed.");
  return visit;
}

function checkObjectives(list: string[] | null | undefined, required: boolean): string[] {
  const picked = [...new Set(list ?? [])];
  if (picked.some((one) => !(OBJECTIVES as readonly string[]).includes(one)))
    throw new Refusal(400, "invalid", "Pick the call objective from the list.", "objectives");
  if (required && !picked.length) throw new Refusal(400, "invalid", "Select the call objective.", "objectives");
  if (picked.length > 6) throw new Refusal(400, "invalid", "Six objectives at most.", "objectives");
  return picked;
}

/** Puts a visit on a day (one open visit to a customer a day), to a doctor, hospital or firm the
 *  person may see. Answers the new visit's id, or null when it is on that day already and `quiet`. */
export async function planOn(
  tx: Runner,
  me: Me,
  input: { customerId: number; day: string; objectives?: string[]; unplanned?: boolean; why?: string | null },
  options: { fromVisit?: number | null; quiet?: boolean } = {},
): Promise<number | null> {
  const [customer] = await rows<{ id: number; name: string }>(
    tx,
    sql`${team(me)} select c.id::int as id, c.name from customer c
      where c.id = ${input.customerId} and c.active and c.kind in ${FIELD_KINDS} and ${seen(me)}`,
  );
  if (!customer) throw new Refusal(400, "invalid", "Pick a doctor, hospital or firm you look after.", "customerIds");
  const [open] = await rows<{ id: number }>(
    tx,
    sql`select id::int as id from visit where person_id = ${me.id} and customer_id = ${customer.id}
      and day = ${input.day}::date and status in ('planned', 'done')`,
  );
  if (open) {
    if (options.quiet) return null;
    throw new Refusal(409, "taken", `${customer.name} is already on your visits that day.`, "customerIds");
  }
  const [made] = await rows<{ id: number }>(
    tx,
    sql`insert into visit (person_id, seat_id, customer_id, day, objectives, unplanned, added_why, from_visit, made_by)
      values (${me.id}, ${seatNow(sql`${me.id}`)}, ${customer.id}, ${input.day}::date, ${textArray(input.objectives ?? [])},
        ${Boolean(input.unplanned)}, ${input.why ?? null}, ${options.fromVisit ?? null}, ${me.id})
      returning id::int as id`,
  );
  return made?.id ?? null;
}

/** Adds visits to a day (the tour plan's day, the visits page). On the day itself once the day
 *  has started, or after the month's plan is approved, a visit is "added" and needs why. */
export async function addVisits(
  db: Database,
  me: Me,
  input: { day: string; customerIds: number[]; objectives?: string[] | null; why?: string | null },
): Promise<{ ids: number[] }> {
  await mustWork(db, me);
  const today = todayManila();
  if (!DAY.test(input.day) || input.day < today) throw new Refusal(400, "invalid", "Plan for today or a day ahead.", "day");
  if (input.day > ahead(today)) throw new Refusal(400, "invalid", "Plan at most two months ahead.", "day");
  const customerIds = [...new Set(input.customerIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (!customerIds.length) throw new Refusal(400, "invalid", "Pick whom to visit.", "customerIds");
  if (customerIds.length > 40) throw new Refusal(400, "invalid", "Forty visits at most at once.", "customerIds");
  const objectives = checkObjectives(input.objectives, false);
  const why = clean(input.why) ?? null;
  return db.transaction(async (tx) => {
    const [started] = await rows<{ n: number }>(
      tx,
      sql`select count(*)::int as n from field_day where person_id = ${me.id} and day = ${today}::date`,
    );
    const onTheDay = input.day === today && Boolean(started?.n);
    const approved = await planApproved(tx, me.id, input.day);
    if ((onTheDay || approved) && !why) throw new Refusal(400, "invalid", "Say why this visit wasn't in the plan.", "why");
    const made: number[] = [];
    for (const customerId of customerIds) {
      const id = await planOn(tx, me, { customerId, day: input.day, objectives, unplanned: onTheDay || approved, why });
      if (!id) continue;
      made.push(id);
      if (onTheDay || approved)
        await tx.execute(
          sql`insert into visit_change (visit_id, what, to_day, note, by_person) values (${id}, 'added', ${input.day}::date, ${why}, ${me.id})`,
        );
      if (approved)
        await addDeviation(tx, { personId: me.id, day: input.day, kind: "added", visitId: id, toDay: input.day, note: why as string });
    }
    return { ids: made };
  });
}

/** I'm here: the time and the phone's place, compared with the customer's pin. */
export async function checkIn(db: Database, me: Me, visitId: number, place?: string | null): Promise<void> {
  await mustWork(db, me);
  const today = todayManila();
  await db.transaction(async (tx) => {
    const visit = await ownOpen(tx, me, visitId);
    if (visit.day !== today) throw new Refusal(400, "invalid", "I'm here works on the visit's day. Move it to today first.");
    if (visit.checkedInAt) return;
    const [day] = await rows<{ endedAt: string | null }>(
      tx,
      sql`select ${iso("ended_at")} as "endedAt" from field_day where person_id = ${me.id} and day = ${today}::date`,
    );
    if (!day) throw new Refusal(409, "not_started", "Start working first, then I'm here.");
    if (day.endedAt) throw new Refusal(409, "closed", "Your day is closed: the day report was sent.");
    const [objectives] = await rows<{ n: number }>(tx, sql`select cardinality(objectives)::int as n from visit where id = ${visit.id}`);
    if (!objectives?.n) throw new Refusal(400, "invalid", "Select the call objective first.", "objectives");
    const [busy] = await rows<{ name: string }>(
      tx,
      sql`select c.name from visit v join customer c on c.id = v.customer_id where v.person_id = ${me.id}
        and v.day = ${today}::date and v.status = 'planned' and v.checked_in_at is not null and v.id <> ${visit.id}`,
    );
    if (busy) throw new Refusal(409, "invalid", `Close the call at ${busy.name} first.`);
    const at = placeOf(place);
    const distance = at && visit.pin ? metresBetween(at, visit.pin) : null;
    await tx.execute(
      sql`update visit set checked_in_at = now(), check_in_place = ${at}, distance_m = ${distance} where id = ${visit.id}`,
    );
  });
}

/** Before the call: the objectives (and their remark), how high it stands, who comes along. */
export async function setVisitPlan(
  db: Database,
  me: Me,
  visitId: number,
  input: { objectives: string[]; objectiveNote?: string | null; priority?: number | null; workingWith?: number[] | null },
): Promise<void> {
  await mustWork(db, me);
  const objectives = checkObjectives(input.objectives, true);
  const priority = input.priority ?? null;
  if (priority !== null && (!Number.isInteger(priority) || priority < 1 || priority > 3))
    throw new Refusal(400, "invalid", "Pick high, usual or low.", "priority");
  const partners = await peopleFrom(db, me, input.workingWith, "workingWith");
  await db.transaction(async (tx) => {
    const visit = await ownOpen(tx, me, visitId);
    await tx.execute(
      sql`update visit set objectives = ${textArray(objectives)},
          objective_note = ${words(input.objectiveNote, 300)}, priority = ${priority}, working_with = ${idArray(partners)}
        where id = ${visit.id}`,
    );
  });
}

/** Keeps the call's form as typed (the MR steps out to place the order and comes back). */
export async function saveDraft(db: Database, me: Me, visitId: number, draft: Record<string, unknown>): Promise<void> {
  await mustWork(db, me);
  const text = JSON.stringify(draft ?? {});
  if (text.length > 60_000) throw new Refusal(400, "invalid", "The call is too long to keep.");
  await db.transaction(async (tx) => {
    const visit = await ownOpen(tx, me, visitId);
    await tx.execute(sql`update visit set draft = ${text}::jsonb where id = ${visit.id}`);
  });
}

function checkProducts(products: CallProduct[], kind: ClientKind): CallProduct[] {
  if (products.length > 60) throw new Refusal(400, "invalid", "Sixty medicines at most.", "products");
  const seenIds = new Set<number>();
  const whole = (value: unknown, what: string) => {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    if (!Number.isInteger(number) || number < 0 || number > 10_000_000)
      throw new Refusal(400, "invalid", `Type ${what} as a whole number.`, "products");
    return number;
  };
  return products.map((line) => {
    if (!Number.isInteger(line.medicineId) || line.medicineId <= 0)
      throw new Refusal(400, "invalid", "Pick medicines from the catalogue.", "products");
    if (seenIds.has(line.medicineId)) throw new Refusal(400, "invalid", "Each medicine once.", "products");
    seenIds.add(line.medicineId);
    if (line.reaction && !REACTIONS.includes(line.reaction))
      throw new Refusal(400, "invalid", "Say how each medicine was taken.", "products");
    if (line.demand && !["high", "normal", "low"].includes(line.demand))
      throw new Refusal(400, "invalid", "Pick the demand: high, normal or low.", "products");
    const firm = kind === "firm";
    return {
      medicineId: line.medicineId,
      promoted: Boolean(line.promoted),
      reaction: line.reaction ?? null,
      prescribing: kind === "doctor" ? Boolean(line.prescribing) : null,
      competitor: words(line.competitor, 120),
      inStock: kind === "doctor" ? null : (line.inStock ?? null),
      stock: kind === "doctor" ? null : whole(line.stock, "the stock"),
      sold: firm ? whole(line.sold, "what was sold") : null,
      demand: firm ? (line.demand ?? null) : null,
    };
  });
}

function checkDetails(call: CallDetails | null | undefined, kind: ClientKind): CallDetails {
  if (!call) return {};
  const out: CallDetails = { competitors: words(call.competitors, 500), market: words(call.market, 500) };
  if (kind === "hospital") {
    const met = (call.met ?? []).map((one) => words(one, 80)).filter((one): one is string => Boolean(one));
    if (met.length > 20) throw new Refusal(400, "invalid", "Twenty people at most.", "call");
    out.met = met;
    out.pharmacy = words(call.pharmacy, 500);
    out.purchasing = words(call.purchasing, 500);
    out.institutional = words(call.institutional, 500);
  }
  if (kind === "firm") {
    out.chemist = words(call.chemist, 300);
    out.money = words(call.money, 300);
  }
  return out;
}

/** Close the call, with its full record. */
export async function closeCall(
  db: Database,
  me: Me,
  visitId: number,
  input: CloseCallInput,
): Promise<{ nextVisitId: number | null; followUpId: number | null }> {
  await mustWork(db, me);
  const today = todayManila();
  if (!MEETINGS.includes(input.meeting)) throw new Refusal(400, "invalid", "Say whether you met them.", "meeting");
  const objectives = checkObjectives(input.objectives, true);
  if (!OUTCOMES.includes(input.outcome)) throw new Refusal(400, "invalid", "Say what came of the call.", "outcome");
  if (!PRODUCTIVES.includes(input.productive))
    throw new Refusal(400, "invalid", "Say whether the call was productive (or not sure yet).", "productive");
  const met = input.meeting === "met";
  if (met && (!input.nature || !NATURES.includes(input.nature)))
    throw new Refusal(400, "invalid", "Say whether it was promotional, business or both.", "nature");
  let chanceAmount: number | null = null;
  let chanceOn: string | null = null;
  if (input.outcome === "opportunity") {
    const amount = Number(input.chanceAmount);
    if (!Number.isInteger(amount) || amount <= 0 || amount > 100_000_000_000)
      throw new Refusal(400, "invalid", "Type the business expected, in pesos.", "chanceAmount");
    chanceAmount = amount;
    if (input.chanceOn) {
      if (!DAY.test(input.chanceOn) || input.chanceOn < today)
        throw new Refusal(400, "invalid", "The expected day is today or later.", "chanceOn");
      chanceOn = input.chanceOn;
    }
  }
  const follow = input.followUp ?? null;
  if (input.outcome === "follow_up" && !follow)
    throw new Refusal(400, "invalid", "Set the follow-up: when, and what.", "followUp");
  if (follow) {
    if (!DAY.test(follow.on) || follow.on < today || follow.on > addDays(today, 92))
      throw new Refusal(400, "invalid", "The follow-up is today or within three months.", "followUp");
    if (!FOLLOW_UP_KINDS.includes(follow.kind)) throw new Refusal(400, "invalid", "Pick what the follow-up is.", "followUp");
    if (!words(follow.what, 300)) throw new Refusal(400, "invalid", "Say what to follow up.", "followUp");
  }
  const nextDay = input.nextDay || null;
  if (nextDay && (!DAY.test(nextDay) || nextDay <= today || nextDay > ahead(today)))
    throw new Refusal(400, "invalid", "The next visit is a later day, within two months.", "nextDay");
  const place = placeOf(input.place);
  return db.transaction(async (tx) => {
    const visit = await ownOpen(tx, me, visitId);
    if (!visit.checkedInAt) throw new Refusal(400, "invalid", "Press I'm here at the customer first, then close the call.");
    const products = checkProducts(input.products ?? [], visit.kind);
    const call = checkDetails(input.call, visit.kind);
    if (products.length) {
      const found = await rows<{ id: number }>(
        tx,
        sql`select id::int as id from medicine where id in (${ids(products.map((one) => one.medicineId))})`,
      );
      if (found.length !== products.length) throw new Refusal(400, "invalid", "Pick medicines from the catalogue.", "products");
    }
    if (input.outcome === "business") {
      const [placed] = await rows<{ n: number }>(
        tx,
        sql`select count(*)::int as n from visit_order vo join sales_order o on o.id = vo.order_id
          where vo.visit_id = ${visit.id} and o.status <> 'cancelled'`,
      );
      if (!placed?.n)
        throw new Refusal(400, "invalid", "Place the order first (Add order), or pick what else came of the call.", "outcome");
    }
    const distance = place && visit.pin ? metresBetween(place, visit.pin) : null;
    await tx.execute(
      sql`update visit set status = 'done', done_at = now(), objectives = ${textArray(objectives)},
          objective_note = coalesce(${words(input.objectiveNote, 300)}, objective_note),
          meeting = ${input.meeting}, nature = ${met ? (input.nature ?? null) : null}, outcome = ${input.outcome},
          productive = ${input.productive}, feedback = ${words(input.feedback, 1000)}, notes = ${words(input.notes, 1000)},
          chance_amount = ${chanceAmount}, chance_on = ${chanceOn}::date, call = ${JSON.stringify(call)}::jsonb,
          detailed = ${JSON.stringify(products)}::jsonb, closed_place = ${place}, closed_distance_m = ${distance},
          next_day = ${nextDay}::date, draft = null
        where id = ${visit.id}`,
    );
    if (visit.kind === "doctor" && input.prescribing?.length) {
      if (input.prescribing.length > 80) throw new Refusal(400, "invalid", "Eighty medicines at most.", "prescribing");
      if (input.prescribing.filter((one) => one.top5).length > 5)
        throw new Refusal(400, "invalid", "Five at most in the top five.", "prescribing");
      for (const line of input.prescribing) {
        if (!Number.isInteger(line.medicineId) || line.medicineId <= 0) continue;
        await tx.execute(
          sql`insert into field_prescribing (customer_id, medicine_id, prescribing, top5, by_person)
            select ${visit.customerId}, m.id, ${Boolean(line.prescribing)}, ${Boolean(line.top5)}, ${me.id} from medicine m where m.id = ${line.medicineId}
            on conflict (customer_id, medicine_id) do update set prescribing = excluded.prescribing, top5 = excluded.top5,
              by_person = excluded.by_person, at = now()`,
        );
      }
    }
    await tx.execute(sql`insert into visit_change (visit_id, what, by_person) values (${visit.id}, 'closed', ${me.id})`);
    let followUpId: number | null = null;
    if (follow) {
      const [made] = await rows<{ id: number }>(
        tx,
        sql`insert into field_follow_up (person_id, customer_id, visit_id, due_on, kind, what)
          values (${me.id}, ${visit.customerId}, ${visit.id}, ${follow.on}::date, ${follow.kind}, ${words(follow.what, 300)})
          returning id::int as id`,
      );
      followUpId = made?.id ?? null;
    }
    const nextVisitId = nextDay
      ? await planOn(tx, me, { customerId: visit.customerId, day: nextDay, objectives }, { fromVisit: visit.id, quiet: true })
      : null;
    return { nextVisitId, followUpId };
  });
}

/** Skips a visit not started, with the reason (after approval: a deviation, "dropped"). */
export async function skipVisit(db: Database, me: Me, visitId: number, input: { reason: MissReason; note?: string | null }): Promise<void> {
  await mustWork(db, me);
  if (!MISS_REASONS.includes(input.reason)) throw new Refusal(400, "invalid", "Pick why it didn't happen.", "reason");
  const note = clean(input.note);
  if (input.reason === "other" && !note) throw new Refusal(400, "invalid", "Say why it didn't happen.", "note");
  const text = note ? `${MISS_WORDS[input.reason]}: ${note}` : MISS_WORDS[input.reason];
  await db.transaction(async (tx) => {
    const visit = await ownOpen(tx, me, visitId);
    if (visit.checkedInAt) throw new Refusal(409, "invalid", "You are at the place: close the call (met or not) instead.");
    await tx.execute(sql`update visit set status = 'skipped', skip_reason = ${text} where id = ${visit.id}`);
    await tx.execute(sql`insert into visit_change (visit_id, what, note, by_person) values (${visit.id}, 'skipped', ${text}, ${me.id})`);
    if (await planApproved(tx, me.id, visit.day))
      await addDeviation(tx, { personId: me.id, day: visit.day, kind: "dropped", visitId: visit.id, fromDay: visit.day, note: text });
  });
}

/** Moves a visit not started to another day (SEFMED's Reschedule), with why once approved. */
export async function moveVisit(db: Database, me: Me, visitId: number, input: { day: string; why?: string | null }): Promise<void> {
  await mustWork(db, me);
  const today = todayManila();
  if (!DAY.test(input.day) || input.day < today || input.day > ahead(today))
    throw new Refusal(400, "invalid", "Move it to today or a day within two months.", "day");
  const why = clean(input.why) ?? null;
  await db.transaction(async (tx) => {
    const visit = await ownOpen(tx, me, visitId);
    if (visit.checkedInAt) throw new Refusal(409, "invalid", "Only a visit not started yet can move.");
    if (visit.day === input.day) return;
    const approved = (await planApproved(tx, me.id, visit.day)) || (await planApproved(tx, me.id, input.day));
    if (approved && !why) throw new Refusal(400, "invalid", "Say why the visit moves (the plan is approved).", "why");
    const [clash] = await rows<{ id: number }>(
      tx,
      sql`select id::int as id from visit where person_id = ${me.id} and customer_id = ${visit.customerId}
        and day = ${input.day}::date and status in ('planned', 'done') and id <> ${visit.id}`,
    );
    if (clash) throw new Refusal(409, "taken", "That customer is already on your visits that day.", "day");
    await tx.execute(sql`update visit set day = ${input.day}::date where id = ${visit.id}`);
    await tx.execute(
      sql`insert into visit_change (visit_id, what, from_day, to_day, note, by_person)
        values (${visit.id}, 'moved', ${visit.day}::date, ${input.day}::date, ${why}, ${me.id})`,
    );
    if (approved)
      await addDeviation(tx, { personId: me.id, day: visit.day, kind: "moved", visitId: visit.id, fromDay: visit.day, toDay: input.day, note: why as string });
  });
}

/** The person's team lead reopens a closed call for a correction, with why; the MR is told. */
export async function reopenCall(db: Database, me: Me, visitId: number, note: string): Promise<void> {
  const why = words(note, 300);
  if (!why) throw new Refusal(400, "invalid", "Say what needs correcting.", "note");
  await db.transaction(async (tx) => {
    const visit = await lockVisit(tx, visitId);
    await mustDecideFor(tx, me, visit.personId);
    if (visit.status !== "done") throw new Refusal(409, "invalid", "Only a closed call is reopened.");
    await tx.execute(sql`update visit set status = 'planned', done_at = null where id = ${visit.id}`);
    await tx.execute(sql`insert into visit_change (visit_id, what, note, by_person) values (${visit.id}, 'reopened', ${why}, ${me.id})`);
    await notify(tx, {
      to: [visit.personId],
      kind: "field_reopened",
      title: "A call was reopened for a correction",
      body: why,
      link: `/visits/${visit.id}`,
      key: `field_reopened:${visit.id}:${Date.now()}`,
    });
  });
}

/** The person's team lead judges a call left "not sure yet": productive or not, with a word. */
export async function judgeCall(db: Database, me: Me, visitId: number, input: { productive: "yes" | "no"; note?: string | null }): Promise<void> {
  if (input.productive !== "yes" && input.productive !== "no") throw new Refusal(400, "invalid", "Productive or not?", "productive");
  const note = words(input.note, 300);
  await db.transaction(async (tx) => {
    const visit = await lockVisit(tx, visitId);
    await mustDecideFor(tx, me, visit.personId);
    const changed = await rows<{ id: number }>(
      tx,
      sql`update visit set productive = ${input.productive}, judged_by = ${me.id}, judged_at = now(), judge_note = ${note}
        where id = ${visit.id} and status = 'done' and productive = 'pending' returning id::int as id`,
    );
    if (!changed.length) throw new Refusal(409, "invalid", "That call isn't waiting to be judged.");
    await tx.execute(
      sql`insert into visit_change (visit_id, what, note, by_person)
        values (${visit.id}, 'judged', ${`${input.productive === "yes" ? "Productive" : "Not productive"}${note ? `: ${note}` : ""}`}, ${me.id})`,
    );
  });
}

/** Pins the customer's place from the visit's check-in: the MR when it has none; their lead (or
 *  Management, the Admin) to move it. */
export async function pinFromVisit(db: Database, me: Me, visitId: number): Promise<void> {
  await db.transaction(async (tx) => {
    const visit = await lockVisit(tx, visitId);
    const [found] = await rows<{ place: string | null }>(tx, sql`select check_in_place as place from visit where id = ${visit.id}`);
    if (!found?.place) throw new Refusal(400, "invalid", "That check-in has no place to pin with.");
    const own = visit.personId === me.id && !me.viewedBy;
    const boss = await mayDecideFor(tx, me, visit.personId);
    if (!own && !boss) throw new Refusal(403, "not_allowed", "Only the MR who checked in, or their team lead, pins it.");
    if (visit.pin && !boss) throw new Refusal(409, "taken", "This place is pinned already. Ask your team lead to move it.");
    await tx.execute(sql`update customer set pin = ${found.place}, pinned_by = ${me.id} where id = ${visit.customerId}`);
    await tx.execute(sql`update visit set distance_m = 0 where id = ${visit.id}`);
  });
}

/** A photo on the call (checked in, or closed today). */
export async function addVisitFile(db: Database, me: Me, visitId: number, file: IncomingFile): Promise<{ id: number }> {
  await mustWork(db, me);
  if (!FILE_TYPES.includes(file.mime)) throw new Refusal(400, "invalid", "Attach a photo or a PDF.", "file");
  if (file.bytes.byteLength === 0 || file.bytes.byteLength > FILE_MAX) throw new Refusal(400, "invalid", "That file is empty or over 10 MB.", "file");
  const kept = await keepFile("visits", { ...file, name: file.name.trim().slice(0, 120) || "photo" });
  return db.transaction(async (tx) => {
    const visit = await lockVisit(tx, visitId);
    if (visit.personId !== me.id) throw new Refusal(403, "not_allowed", "Only the person visiting adds photos.");
    if (!visit.checkedInAt || visit.day !== todayManila()) throw new Refusal(409, "invalid", "Photos go on today's call, after I'm here.");
    const [count] = await rows<{ n: number }>(tx, sql`select count(*)::int as n from visit_file where visit_id = ${visit.id}`);
    if ((count?.n ?? 0) >= 6) throw new Refusal(409, "invalid", "Six photos a call at most.", "file");
    const [made] = await rows<{ id: number }>(
      tx,
      sql`insert into visit_file (visit_id, name, mime, size, data, store_key, by_person)
        values (${visit.id}, ${kept.name}, ${kept.mime}, ${kept.size}, ${kept.data}, ${kept.key}, ${me.id}) returning id::int as id`,
    );
    return { id: made?.id as number };
  });
}

export async function readVisitFile(db: Database, me: Me, visitId: number, fileId: number) {
  const [file] = await rows<{ name: string; mime: string; data: Uint8Array | null; key: string | null; personId: number }>(
    db,
    sql`select f.name, f.mime, f.data, f.store_key as key, v.person_id::int as "personId"
      from visit_file f join visit v on v.id = f.visit_id where f.id = ${fileId} and f.visit_id = ${visitId}`,
  );
  if (!file) throw new Refusal(404, "not_found", "No such photo.");
  await mustSee(db, me, file.personId);
  return { name: file.name, mime: file.mime, bytes: await bytesOf(file) };
}

/** Ties the CRM order just placed at a visit to it (the order form sends the visit). */
export async function linkOrderToVisit(tx: Runner, me: Me, visitId: number, orderId: number): Promise<void> {
  const [visit] = await rows<{ personId: number; customerId: number; day: string; checkedIn: boolean; status: string }>(
    tx,
    sql`select person_id::int as "personId", customer_id::int as "customerId", to_char(day, 'YYYY-MM-DD') as day,
        checked_in_at is not null as "checkedIn", status from visit where id = ${visitId}`,
  );
  const [order] = await rows<{ customerId: number }>(tx, sql`select customer_id::int as "customerId" from sales_order where id = ${orderId}`);
  if (!visit || visit.personId !== me.id)
    throw new Refusal(400, "invalid", "That visit isn't yours: place the order from your own visit.", "visitId");
  if (!order || order.customerId !== visit.customerId)
    throw new Refusal(400, "invalid", "The order is for another customer than the visit's.", "visitId");
  if (visit.day !== todayManila() || !(visit.checkedIn || visit.status === "done"))
    throw new Refusal(409, "invalid", "An order joins today's call, after I'm here.", "visitId");
  await tx.execute(sql`insert into visit_order (order_id, visit_id) values (${orderId}, ${visitId}) on conflict (order_id) do nothing`);
}

const orderColumns = sql`o.id::int as id, o.code, to_char((o.created_at at time zone 'Asia/Manila')::date, 'YYYY-MM-DD') as on,
  o.total::float8 as total, o.status, (select name from person where id = o.medrep_id) as by`;
const withWords = (list: (Omit<FieldOrder, "statusWord"> & { status: OrderStatus })[]): FieldOrder[] =>
  list.map((one) => ({ ...one, statusWord: STATUS_LABEL[one.status] ?? one.status }));

/** A customer's latest CRM orders. */
export async function customerOrders(db: Runner, customerId: number, limit = 5): Promise<FieldOrder[]> {
  return withWords(
    await rows<Omit<FieldOrder, "statusWord"> & { status: OrderStatus }>(
      db,
      sql`select ${orderColumns} from sales_order o where o.customer_id = ${customerId} order by o.created_at desc, o.id desc limit ${limit}`,
    ),
  );
}

/** The last five visits to a customer, by anyone (SEFMED's View last five visits). */
export async function lastVisits(db: Runner, customerId: number, leaveOut = 0): Promise<VisitPage["history"]> {
  return rows<VisitPage["history"][number]>(
    db,
    sql`select v.id::int as id, to_char(v.day, 'YYYY-MM-DD') as day, p.name as person, v.status,
        ${iso("v.checked_in_at")} as "checkedInAt", ${iso("v.done_at")} as "doneAt",
        case when cardinality(v.objectives) > 0 then to_json(v.objectives) when v.objective is not null then json_build_array(v.objective) else '[]'::json end as objectives,
        v.objective_note as "objectiveNote", v.meeting, v.outcome, v.feedback, v.notes
      from visit v join person p on p.id = v.person_id
      where v.customer_id = ${customerId} and v.id <> ${leaveOut} and v.status in ('done', 'skipped', 'missed')
      order by v.day desc, v.id desc limit 5`,
  );
}

/** One visit's page. */
export async function visitPage(db: Database, me: Me, visitId: number): Promise<VisitPage> {
  const [card] = await rows<
    CardSql & Omit<VisitPage["visit"], keyof CardSql | "files" | "changes"> & { clientFull: VisitPage["client"]; draft: Record<string, unknown> | null }
  >(
    db,
    sql`select ${cardColumns}, v.objective_note as "objectiveNote", v.check_in_place as "checkInPlace",
        v.closed_place as "closedPlace", v.closed_distance_m as "closedDistanceM", v.notes, v.feedback,
        v.chance_amount::float8 as "chanceAmount", to_char(v.chance_on, 'YYYY-MM-DD') as "chanceOn",
        to_char(v.next_day, 'YYYY-MM-DD') as "nextDay", v.added_why as "addedWhy", v.call, v.draft,
        coalesce((select json_agg(d.item || jsonb_build_object('name', m.name) order by d.n)
          from jsonb_array_elements(v.detailed) with ordinality as d(item, n)
          join medicine m on m.id = (d.item->>'medicineId')::bigint), '[]'::json) as products,
        coalesce((select json_agg(json_build_object('id', w.id::int, 'name', w.name) order by w.name)
          from person w where w.id = any (v.working_with)), '[]'::json) as "workingWith",
        case when v.judged_by is null then null else json_build_object('by', (select name from person where id = v.judged_by),
          'at', ${iso("v.judged_at")}, 'note', v.judge_note) end as judged,
        (${clientJson})::jsonb || jsonb_build_object('address', c.address, 'phone', c.phone, 'contactPerson', f.contact_person,
          'pin', c.pin, 'worksAt', (select json_build_object('id', h.id::int, 'name', h.name) from customer h where h.id = c.works_at)) as "clientFull"
      ${cardFrom} where v.id = ${visitId}`,
  );
  if (!card) throw new Refusal(404, "not_found", "No such visit.");
  const access = await mustSee(db, me, card.person.id);
  const today = todayManila();
  const customerId = card.client.id;
  const [history, orders, owed, followUps, prescribing, medicines, files, changes, placed, given, held, boss] = await Promise.all([
    lastVisits(db, customerId, visitId),
    customerOrders(db, customerId),
    moneyOf(db, [customerId]),
    rows<VisitPage["followUps"][number]>(
      db,
      sql`select f.id::int as id, to_char(f.due_on, 'YYYY-MM-DD') as "dueOn", f.kind, f.what, p.name as by
        from field_follow_up f join person p on p.id = f.person_id where f.customer_id = ${customerId} and f.status = 'open'
        order by f.due_on, f.id limit 10`,
    ),
    rows<VisitPage["prescribing"][number]>(
      db,
      sql`select m.id::int as "medicineId", m.name, f.prescribing, f.top5 from field_prescribing f join medicine m on m.id = f.medicine_id
        where f.customer_id = ${customerId} order by f.top5 desc, f.prescribing desc, m.name`,
    ),
    rows<VisitPage["medicines"][number]>(db, sql`select id::int as id, name, strength from medicine where active order by name`),
    rows<VisitPage["visit"]["files"][number]>(db, sql`select id::int as id, name, mime from visit_file where visit_id = ${visitId} order by id`),
    rows<VisitPage["visit"]["changes"][number]>(
      db,
      sql`select ch.what, to_char(ch.from_day, 'YYYY-MM-DD') as "fromDay", to_char(ch.to_day, 'YYYY-MM-DD') as "toDay", ch.note,
          p.name as by, ${iso("ch.at")} as at
        from visit_change ch join person p on p.id = ch.by_person where ch.visit_id = ${visitId} order by ch.at, ch.id`,
    ),
    rows<Omit<FieldOrder, "statusWord"> & { status: OrderStatus }>(
      db,
      sql`select ${orderColumns} from visit_order vo join sales_order o on o.id = vo.order_id where vo.visit_id = ${visitId} order by o.id`,
    ),
    rows<VisitPage["samplesGiven"][number]>(
      db,
      sql`select m.medicine_id::int as "medicineId", d.name, m.kind, sum(-m.qty)::int as qty
        from sample_move m join medicine d on d.id = m.medicine_id where m.visit_id = ${visitId} and m.what = 'given'
        group by m.medicine_id, d.name, m.kind order by d.name`,
    ),
    rows<{ n: number }>(db, sql`select coalesce(sum(qty), 0)::int as n from sample_stock where person_id = ${card.person.id}`),
    mayDecideFor(db, me, card.person.id),
  ]);
  const work = card.person.id === me.id && (access === "mr" || access === "lead") && !me.viewedBy;
  const planned = card.status === "planned";
  const money = owed.get(customerId);
  const { clientFull, draft, ...rest } = card;
  return {
    visit: { ...rest, files, changes },
    client: clientFull,
    history,
    orders,
    owed: { total: money?.owed ?? 0, overdue: money?.overdue ?? 0 },
    followUps,
    prescribing,
    medicines,
    placed: withWords(placed),
    samplesGiven: given,
    samplesHeld: held[0]?.n ?? 0,
    draft: planned ? draft : null,
    partners: work ? await partnersOf(db, me) : [],
    can: {
      work,
      checkIn: work && planned && !card.checkedInAt && card.day === today,
      close: work && planned && Boolean(card.checkedInAt),
      skip: work && planned && !card.checkedInAt,
      move: work && planned && !card.checkedInAt,
      book: work && card.day === today && (card.status === "done" || Boolean(card.checkedInAt)),
      reopen: boss && card.status === "done",
      judge: boss && card.status === "done" && card.productive === "pending",
    },
  };
}

/** A person's visits on a day (today by default) or over a month, in one tab (KOLs · Hospitals ·
 *  KBLs); a lead picks one of the team, or the whole team (the team switch narrows it). */
export async function visitList(
  db: Database,
  me: Me,
  asked: { kind?: string | null; day?: string | null; month?: string | null; person?: string | null },
): Promise<VisitList> {
  const access = await accessOf(db, me);
  if (!access) throw new Refusal(403, "not_allowed", "The field's pages are the MedReps', their leads' and the CEO's.");
  const today = todayManila();
  const everyone = access !== "mr" && (asked.person === "all" || (!asked.person && access === "viewer"));
  const personId = everyone ? null : Number(asked.person) || me.id;
  if (personId !== null) await mustSee(db, me, personId);
  const kind = (CLIENT_KINDS as string[]).includes(asked.kind ?? "") ? (asked.kind as ClientKind) : "doctor";
  const kinds = kind === "firm" ? sql`('drugstore', 'distributor')` : kind === "doctor" ? sql`('doctor')` : sql`('hospital')`;
  const month = asked.month && MONTH.test(asked.month) ? asked.month : null;
  const day = month ? null : asked.day && DAY.test(asked.day) ? asked.day : today;
  const when = month
    ? sql`v.day >= ${`${month}-01`}::date and v.day < (${`${month}-01`}::date + interval '1 month')`
    : sql`v.day = ${day}::date`;
  const who = personId === null ? inTeam(me, "v.person_id") : sql`v.person_id = ${personId}`;
  const [cards, counted, person, people] = await Promise.all([
    rows<CardSql>(
      db,
      sql`${teamSql(me)} select ${cardColumns} ${cardFrom} where ${who} and ${when} and c.kind in ${kinds}
        order by v.day ${month ? sql`desc` : sql``}, case v.status when 'planned' then 0 when 'done' then 1 else 2 end,
          v.checked_in_at nulls last, v.priority nulls last, c.name limit 600`,
    ),
    rows<{ kind: ClientKind; n: number }>(
      db,
      sql`${teamSql(me)} select case c.kind when 'doctor' then 'doctor' when 'hospital' then 'hospital' else 'firm' end as kind,
          count(*)::int as n from visit v join customer c on c.id = v.customer_id
        where ${who} and ${when} and c.kind in ${FIELD_KINDS} group by 1`,
    ),
    personId === null
      ? Promise.resolve([] as { id: number; name: string }[])
      : rows<{ id: number; name: string }>(db, sql`select id::int as id, name from person where id = ${personId}`),
    access === "mr"
      ? Promise.resolve([] as { id: number; name: string }[])
      : rows<{ id: number; name: string }>(
          db,
          sql`${teamSql(me)} select p.id::int as id, p.name from person p where ${fieldPerson} and ${inTeam(me, "p.id")} and p.id <> ${me.id}
            order by p.name limit 400`,
        ),
  ]);
  const all = cards.map(toCard);
  const states: Record<VisitState, number> = { new: 0, at: 0, closed: 0, skipped: 0, missed: 0 };
  for (const one of all) states[stateOf(one)] += 1;
  return {
    today,
    person: person[0] ?? null,
    kind,
    day,
    month,
    counts: {
      doctor: counted.find((one) => one.kind === "doctor")?.n ?? 0,
      hospital: counted.find((one) => one.kind === "hospital")?.n ?? 0,
      firm: counted.find((one) => one.kind === "firm")?.n ?? 0,
    },
    states,
    rows: all,
    people,
    can: { work: personId === me.id && (access === "mr" || access === "lead") && !me.viewedBy },
  };
}
