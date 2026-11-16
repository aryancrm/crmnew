// In-licensing & Regulatory (docs/PLAN.md 16.9). Two teams under the Founder: In-licensing (its
// Mentor, a Coach, Executives) brings products in from partners abroad, stage by stage; Regulatory
// Affairs (its Mentor, a Coach, Pharmacists, Coachees) gets each product its FDA registration (CPR)
// and keeps every CPR alive: a renewal is filed well before it runs out (interim rule: flagged from
// 180 days, urgent from 90). A product handed over at "dossier" opens its registration; an approved
// registration moves the product to "registered". Both teams read both lists; each changes its own.
// The Founder and the Admin read; the bidding desks read the approved CPRs for their envelopes.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { Refusal } from "../http";
import { todayManila } from "../inventory/rules";
import type { Me, PipelineRow, PipelineStage, RegEvent, RegistrationRow, RegistrationStatus, RegulatoryDesk } from "../types";

export const STAGES: PipelineStage[] = ["identified", "talks", "agreement", "dossier", "filed", "registered", "launched", "dropped"];
export const STATUSES: RegistrationStatus[] = ["preparing", "filed", "approved", "renewal_filed", "expired", "withdrawn"];
// The stages in order, as a SQL array (a JS array would go in as a record).
const STAGE_ORDER = sql.raw(`array[${STAGES.map((stage) => `'${stage}'`).join(", ")}]::text[]`);
const STAGE_WORD: Record<PipelineStage, string> = {
  identified: "Identified", talks: "In talks", agreement: "Agreement signed", dossier: "Dossier in hand",
  filed: "Filed with the FDA", registered: "Registered", launched: "Launched", dropped: "Dropped",
};
const STATUS_WORD: Record<RegistrationStatus, string> = {
  preparing: "Preparing", filed: "Filed", approved: "Approved", renewal_filed: "Renewal filed", expired: "Expired", withdrawn: "Withdrawn",
};

export const regTeam = (me: Me): RegulatoryDesk["team"] =>
  me.role !== "regulatory" ? null : /in-?licens/i.test(me.title ?? "") ? "inlicensing" : "ra";
const biddingDesk = (me: Me) => me.channel?.code === "BID" || /bidding/i.test(me.title ?? "");
const mayRead = (me: Me) => me.role === "regulatory" || ["ceo", "admin"].includes(me.role) || biddingDesk(me);

function mustBe(me: Me, team: "inlicensing" | "ra") {
  if (regTeam(me) !== team)
    throw new Refusal(403, "not_allowed", team === "ra" ? "Regulatory Affairs keeps the registrations." : "The In-licensing team keeps the pipeline.");
}

const pipelineSelect = sql`select p.id::int as id, p.name, p.generic, p.strength, p.partner, p.country, p.stage,
    case when h.id is null then null else json_build_object('id', h.id::int, 'name', h.name) end as "handledBy",
    p.next_step as "nextStep", to_char(p.next_on, 'YYYY-MM-DD') as "nextOn", p.note,
    to_char(p.updated_at at time zone 'Asia/Manila', 'YYYY-MM-DD') as "updatedOn",
    (select r.id::int from product_registration r where r.pipeline_id = p.id order by r.id desc limit 1) as "registrationId"
  from pipeline_product p left join person h on h.id = p.handled_by`;

const registrationSelect = (today: string) => sql`select r.id::int as id, r.product, r.medicine_id::int as "medicineId", r.pipeline_id::int as "pipelineId",
    r.number, r.status, to_char(r.filed_on, 'YYYY-MM-DD') as "filedOn", to_char(r.valid_until, 'YYYY-MM-DD') as "validUntil",
    case when r.valid_until is null or r.status in ('withdrawn', 'preparing', 'filed') then null else (r.valid_until - ${today}::date)::int end as "daysLeft",
    case when r.status in ('approved', 'expired') and r.valid_until is not null then
      case when r.valid_until < ${today}::date then 'expired'
           when r.status = 'approved' and r.valid_until < ${today}::date + 90 then 'urgent'
           when r.status = 'approved' and r.valid_until < ${today}::date + 180 then 'soon' end end as flag,
    case when h.id is null then null else json_build_object('id', h.id::int, 'name', h.name) end as "handledBy", r.note
  from product_registration r left join person h on h.id = r.handled_by`;

export async function regulatoryDesk(db: Database, me: Me): Promise<RegulatoryDesk> {
  if (!mayRead(me)) throw new Refusal(403, "not_allowed", "This is In-licensing & Regulatory's desk.");
  const today = todayManila();
  const bidding = biddingDesk(me) && me.role !== "regulatory" && !["ceo", "admin"].includes(me.role);
  const [pipeline, registrations, people] = await Promise.all([
    bidding ? Promise.resolve([] as PipelineRow[]) : rows<PipelineRow>(db, sql`${pipelineSelect} order by array_position(${STAGE_ORDER}, p.stage), p.next_on nulls last, p.name`),
    rows<RegistrationRow>(
      db,
      sql`${registrationSelect(today)} ${bidding ? sql`where r.status in ('approved', 'renewal_filed')` : sql``}
        order by array_position(array['expired', 'urgent', 'soon']::text[], (case when r.status in ('approved', 'expired') and r.valid_until is not null then
          case when r.valid_until < ${today}::date then 'expired' when r.status = 'approved' and r.valid_until < ${today}::date + 90 then 'urgent'
               when r.status = 'approved' and r.valid_until < ${today}::date + 180 then 'soon' end end)) nulls last, r.valid_until nulls last, r.product`,
    ),
    rows<RegulatoryDesk["people"][number]>(db, sql`select id::int as id, name, title from person where role = 'regulatory' and active order by name`),
  ]);
  const team = regTeam(me);
  return { today, team, canPipeline: team === "inlicensing", canRegistrations: team === "ra", people, pipeline, registrations };
}

async function log(db: Database, me: Me, what: string, ids: { pipelineId?: number | null; registrationId?: number | null }) {
  await db.execute(
    sql`insert into reg_event (pipeline_id, registration_id, what, by_person) values (${ids.pipelineId ?? null}, ${ids.registrationId ?? null}, ${what}, ${me.id})`,
  );
}

async function regulatoryPerson(db: Database, id: number | null | undefined): Promise<number | null> {
  if (!id) return null;
  const [p] = await rows<{ id: number }>(db, sql`select id::int as id from person where id = ${id} and role = 'regulatory' and active`);
  if (!p) throw new Refusal(400, "invalid", "Pick someone from In-licensing & Regulatory.", "handledBy");
  return p.id;
}

export type PipelineInput = {
  name: string; generic?: string | null; strength?: string | null; partner?: string | null; country?: string | null;
  stage?: PipelineStage; handledBy?: number | null; nextStep?: string | null; nextOn?: string | null; note?: string | null;
};
const clean = (text?: string | null) => text?.trim() || null;

export async function savePipeline(db: Database, me: Me, id: number | null, input: PipelineInput): Promise<{ id: number }> {
  mustBe(me, "inlicensing");
  const handledBy = await regulatoryPerson(db, input.handledBy);
  const stage = input.stage ?? "identified";
  if (!id) {
    const [made] = await rows<{ id: number }>(
      db,
      sql`insert into pipeline_product (name, generic, strength, partner, country, stage, handled_by, next_step, next_on, note, added_by)
        values (${input.name.trim()}, ${clean(input.generic)}, ${clean(input.strength)}, ${clean(input.partner)}, ${clean(input.country)}, ${stage},
          ${handledBy ?? me.id}, ${clean(input.nextStep)}, ${input.nextOn ?? null}::date, ${clean(input.note)}, ${me.id}) returning id::int as id`,
    );
    if (!made) throw new Error("pipeline insert");
    await log(db, me, `Added at "${STAGE_WORD[stage]}"`, { pipelineId: made.id });
    await handOver(db, me, made.id, stage);
    return made;
  }
  const [old] = await rows<{ stage: PipelineStage; nextStep: string | null }>(
    db,
    sql`select stage, next_step as "nextStep" from pipeline_product where id = ${id}`,
  );
  if (!old) throw new Refusal(404, "not_found", "That product is not in the pipeline.");
  if (["registered", "launched"].includes(old.stage) && ["identified", "talks", "agreement"].includes(stage))
    throw new Refusal(400, "invalid", "A registered product does not go back to talks: mark it Dropped instead.", "stage");
  await db.execute(
    sql`update pipeline_product set name = ${input.name.trim()}, generic = ${clean(input.generic)}, strength = ${clean(input.strength)},
      partner = ${clean(input.partner)}, country = ${clean(input.country)}, stage = ${stage}, handled_by = ${handledBy},
      next_step = ${clean(input.nextStep)}, next_on = ${input.nextOn ?? null}::date, note = ${clean(input.note)}, updated_at = now()
      where id = ${id}`,
  );
  if (old.stage !== stage) await log(db, me, `${STAGE_WORD[old.stage]} → ${STAGE_WORD[stage]}`, { pipelineId: id });
  else if (clean(input.nextStep) !== old.nextStep) await log(db, me, `Next: ${clean(input.nextStep) ?? "—"}`, { pipelineId: id });
  await handOver(db, me, id, stage);
  return { id };
}

/** At "dossier" (or later) the product is handed to Regulatory Affairs: its registration opens once. */
async function handOver(db: Database, me: Me, pipelineId: number, stage: PipelineStage) {
  if (!["dossier", "filed"].includes(stage)) return;
  const [open] = await rows<{ id: number }>(db, sql`select id::int as id from product_registration where pipeline_id = ${pipelineId}`);
  if (open) return;
  const [made] = await rows<{ id: number }>(
    db,
    sql`insert into product_registration (pipeline_id, product, status, added_by)
      select id, name || coalesce(' ' || strength, ''), 'preparing', ${me.id} from pipeline_product where id = ${pipelineId}
      returning id::int as id`,
  );
  await log(db, me, "Handed to Regulatory Affairs: registration opened", { pipelineId, registrationId: made?.id });
}

export type RegistrationInput = {
  product: string; medicineId?: number | null; number?: string | null; status?: RegistrationStatus;
  filedOn?: string | null; validUntil?: string | null; handledBy?: number | null; note?: string | null;
};

export async function saveRegistration(db: Database, me: Me, id: number | null, input: RegistrationInput): Promise<{ id: number }> {
  mustBe(me, "ra");
  const handledBy = await regulatoryPerson(db, input.handledBy);
  const status = input.status ?? "preparing";
  if (["approved", "renewal_filed"].includes(status) && (!clean(input.number) || !input.validUntil))
    throw new Refusal(400, "invalid", "An approved CPR needs its number and the day it is valid until.", "number");
  if (["filed", "renewal_filed"].includes(status) && !input.filedOn)
    throw new Refusal(400, "invalid", "Pick the day it was filed with the FDA.", "filedOn");
  if (input.medicineId) {
    const [m] = await rows<{ id: number }>(db, sql`select id::int as id from medicine where id = ${input.medicineId}`);
    if (!m) throw new Refusal(400, "invalid", "Pick a medicine from the list.", "medicineId");
  }
  let regId = id;
  let pipelineId: number | null = null;
  if (!regId) {
    const [made] = await rows<{ id: number }>(
      db,
      sql`insert into product_registration (medicine_id, product, number, status, filed_on, valid_until, handled_by, note, added_by)
        values (${input.medicineId ?? null}, ${input.product.trim()}, ${clean(input.number)}, ${status}, ${input.filedOn ?? null}::date,
          ${input.validUntil ?? null}::date, ${handledBy ?? me.id}, ${clean(input.note)}, ${me.id}) returning id::int as id`,
    );
    if (!made) throw new Error("registration insert");
    regId = made.id;
    await log(db, me, `Added as "${STATUS_WORD[status]}"`, { registrationId: regId });
  } else {
    const [old] = await rows<{ status: RegistrationStatus; validUntil: string | null; pipelineId: number | null }>(
      db,
      sql`select status, to_char(valid_until, 'YYYY-MM-DD') as "validUntil", pipeline_id::int as "pipelineId" from product_registration where id = ${regId}`,
    );
    if (!old) throw new Refusal(404, "not_found", "That registration is not on the list.");
    pipelineId = old.pipelineId;
    await db.execute(
      sql`update product_registration set medicine_id = ${input.medicineId ?? null}, product = ${input.product.trim()}, number = ${clean(input.number)},
        status = ${status}, filed_on = ${input.filedOn ?? null}::date, valid_until = ${input.validUntil ?? null}::date, handled_by = ${handledBy},
        note = ${clean(input.note)}, updated_at = now() where id = ${regId}`,
    );
    if (old.status !== status) await log(db, me, `${STATUS_WORD[old.status]} → ${STATUS_WORD[status]}`, { registrationId: regId });
    if ((input.validUntil ?? null) !== old.validUntil)
      await log(db, me, `Valid until ${input.validUntil ?? "—"} (was ${old.validUntil ?? "—"})`, { registrationId: regId });
  }
  // The FDA filing and the approval move the pipeline product along with it.
  if (pipelineId && ["filed", "approved"].includes(status)) {
    const to: PipelineStage = status === "approved" ? "registered" : "filed";
    const moved = await rows<{ id: number }>(
      db,
      sql`update pipeline_product set stage = ${to}, updated_at = now() where id = ${pipelineId}
        and array_position(${STAGE_ORDER}, stage) < array_position(${STAGE_ORDER}, ${to}::text) and stage <> 'dropped' returning id::int as id`,
    );
    if (moved.length) await log(db, me, `→ ${STAGE_WORD[to]} (from its registration)`, { pipelineId });
  }
  return { id: regId };
}

export async function regHistory(db: Database, me: Me, ids: { pipelineId?: number; registrationId?: number }): Promise<RegEvent[]> {
  if (!mayRead(me) || (biddingDesk(me) && me.role !== "regulatory" && !["ceo", "admin"].includes(me.role)))
    throw new Refusal(403, "not_allowed", "This is In-licensing & Regulatory's desk.");
  const where = ids.pipelineId ? sql`e.pipeline_id = ${ids.pipelineId}` : sql`e.registration_id = ${ids.registrationId ?? 0}`;
  return rows<RegEvent>(
    db,
    sql`select to_char(e.at at time zone 'Asia/Manila', 'YYYY-MM-DD HH24:MI') as at, e.what, p.name as by
      from reg_event e join person p on p.id = e.by_person where ${where} order by e.id desc limit 50`,
  );
}
