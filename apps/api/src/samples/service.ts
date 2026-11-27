// Samples and gifts with the reps (docs/ERP-PLAN.md phase 3, migration 0097), the old CRM's rules:
// - A rep asks (samples or gifts; 1–20 lines, 1–1,000 pieces a line, a medicine once; "no samples"
//   medicines can't be asked for as samples).
// - Their lead decides (anyone they report to, up the line; the CEO and the Admin as backup); a
//   refusal says why. The rep can withdraw while it waits.
// - The stock desk (Inventory, Dispatch, the Admin) issues it from a warehouse, the batches
//   expiring first, unexpired only: the pieces leave the company's stock. The rep marks them
//   received. The desk can also send samples with no request.
// - The rep gives them to a doctor at a visit of their own (1–100 pieces a medicine), the doctor's
//   signed acknowledgement attached, from their unexpired pieces, expiring first.
// - Each month the rep counts what they hold, batch by batch; every difference needs a reason.
// - Samples and gifts are never sold.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { keepFile } from "../files/store";
import type { IncomingFile } from "../files/store";
import { allow, Refusal } from "../http";
import { todayManila } from "../inventory/rules";
import type { Runner } from "../inventory/service";
import { FIELD_ROLES, leads, LEAD_ROLES, refuseOffice } from "../field/visits";
import { notify } from "../notify/service";
import type { Me, Role, SampleKind, SampleLineInput, SamplesOfPerson, TeamSamples } from "../types";

/** Who sends samples out of the warehouses. */
export const ISSUE_ROLES: readonly Role[] = ["inventory", "dispatch", "admin"];
/** Backup deciders (the old CRM's owners and admins). */
const BACKUP_ROLES: readonly Role[] = ["ceo", "admin"];
/** Who sees every rep's samples. */
const ALL_ROLES: readonly Role[] = ["ceo", "admin", "management", "inventory", "dispatch"];

const KIND_WORD: Record<SampleKind, string> = { samples: "samples", gifts: "gifts" };
const isKind = (kind: unknown): kind is SampleKind => kind === "samples" || kind === "gifts";

function checkLines(lines: SampleLineInput[], max: number, most: number) {
  if (!lines.length) throw new Refusal(400, "invalid", "Add a medicine.", "lines");
  if (lines.length > most) throw new Refusal(400, "invalid", `At most ${most} medicines at a time.`, "lines");
  const seen = new Set<number>();
  for (const line of lines) {
    if (!Number.isInteger(line.qty) || line.qty < 1 || line.qty > max)
      throw new Refusal(400, "invalid", `Each medicine takes 1 to ${max.toLocaleString("en-PH")} pieces.`, "lines");
    if (seen.has(line.medicineId)) throw new Refusal(400, "invalid", "A medicine is there twice: put it once.", "lines");
    seen.add(line.medicineId);
  }
}

/** Antimicrobials and the like are never given as samples (gifts may be any item). */
async function noSamplesRefused(tx: Runner, kind: SampleKind, medicineIds: number[]) {
  if (kind !== "samples" || !medicineIds.length) return;
  const [blocked] = await rows<{ name: string }>(
    tx,
    sql`select name from medicine where id in (${sql.join(medicineIds.map((id) => sql`${id}`), sql`, `)}) and no_samples limit 1`,
  );
  if (blocked) throw new Refusal(400, "invalid", `${blocked.name} is never given as a sample.`, "lines");
}

async function nextCode(tx: Runner): Promise<string> {
  const [next] = await rows<{ value: number }>(
    tx,
    sql`insert into counter (name, value) values ('sample_request', 1)
      on conflict (name) do update set value = counter.value + 1 returning value::int as value`,
  );
  return `SRQ-${String(next?.value ?? 1).padStart(5, "0")}`;
}

async function stockDesk(tx: Runner): Promise<number[]> {
  return (
    await rows<{ id: number }>(tx, sql`select id::int as id from person where active and role in ('inventory', 'dispatch')`)
  ).map((one) => one.id);
}

export async function askSamples(
  db: Database,
  me: Me,
  input: { kind: SampleKind; lines: SampleLineInput[]; note?: string | null },
): Promise<{ id: number; code: string }> {
  if (!FIELD_ROLES.includes(me.role) || me.viewedBy) throw new Refusal(403, "not_allowed", "Samples are asked for by MedReps and their team leads.");
  refuseOffice(me);
  if (!isKind(input.kind)) throw new Refusal(400, "invalid", "Samples or gifts?", "kind");
  checkLines(input.lines, 1000, 20);
  return db.transaction(async (tx) => {
    await noSamplesRefused(tx, input.kind, input.lines.map((line) => line.medicineId));
    const code = await nextCode(tx);
    const [made] = await rows<{ id: number }>(
      tx,
      sql`insert into sample_request (code, person_id, kind, lines, note, asked_by)
        values (${code}, ${me.id}, ${input.kind}, ${JSON.stringify(input.lines)}::jsonb, ${input.note?.trim() || null}, ${me.id})
        returning id::int as id`,
    );
    const [boss] = await rows<{ id: number | null }>(tx, sql`select reports_to::int as id from person where id = ${me.id}`);
    await notify(tx, {
      to: boss?.id ? [boss.id] : [],
      kind: "sample_request",
      title: `${me.name} asks for ${KIND_WORD[input.kind]} (${code})`,
      body: input.note?.trim() || null,
      link: "/field/samples",
      key: `sample:${made?.id}:asked`,
    });
    return { id: made?.id as number, code };
  });
}

type RequestRow = { id: number; code: string; personId: number; person: string; kind: SampleKind; status: string; lines: SampleLineInput[] };
async function lockRequest(tx: Runner, id: number): Promise<RequestRow> {
  const [found] = await rows<RequestRow>(
    tx,
    sql`select r.id::int as id, r.code, r.person_id::int as "personId", p.name as person, r.kind, r.status, r.lines
      from sample_request r join person p on p.id = r.person_id where r.id = ${id} for update of r`,
  );
  if (!found) throw new Refusal(404, "not_found", "That request isn't here.");
  return found;
}

/** The rep's leads up the line decide; the CEO and the Admin as backup. Never the rep. */
async function mayDecide(tx: Runner, me: Me, personId: number): Promise<boolean> {
  if (me.id === personId || me.viewedBy) return false;
  return BACKUP_ROLES.includes(me.role) || (await leads(tx, me, personId));
}

export async function decideSamples(db: Database, me: Me, id: number, input: { approve: boolean; reason?: string | null }): Promise<void> {
  await db.transaction(async (tx) => {
    const request = await lockRequest(tx, id);
    if (!(await mayDecide(tx, me, request.personId))) throw new Refusal(403, "not_allowed", "Samples are approved by the rep's team lead.");
    if (request.status !== "submitted") throw new Refusal(409, "not_now", `${request.code} isn't waiting for a decision.`);
    const reason = input.reason?.trim() || null;
    if (!input.approve && !reason) throw new Refusal(400, "invalid", "Say why not.", "reason");
    await tx.execute(
      sql`update sample_request set status = ${input.approve ? "approved" : "rejected"}, decided_by = ${me.id}, decided_at = now(),
          reject_reason = ${input.approve ? null : reason} where id = ${id}`,
    );
    await notify(tx, {
      to: [request.personId],
      kind: "sample_request",
      title: `${request.code} ${input.approve ? "approved" : "not approved"} by ${me.name}`,
      body: reason,
      link: "/me/samples",
      key: `sample:${id}:decided`,
    });
    if (input.approve)
      await notify(tx, {
        to: await stockDesk(tx),
        kind: "sample_request",
        title: `${request.code}: ${KIND_WORD[request.kind]} to issue to ${request.person}`,
        link: "/field/samples",
        key: `sample:${id}:to-issue`,
      });
  });
}

export async function withdrawSamples(db: Database, me: Me, id: number): Promise<void> {
  await db.transaction(async (tx) => {
    const request = await lockRequest(tx, id);
    if (request.personId !== me.id) throw new Refusal(403, "not_allowed", "Only the one who asked can withdraw it.");
    if (!["submitted", "approved"].includes(request.status)) throw new Refusal(409, "not_now", `${request.code} can't be withdrawn now.`);
    await tx.execute(sql`update sample_request set status = 'withdrawn' where id = ${id}`);
  });
}

/** Takes the pieces off a warehouse's shelf, unexpired, the batches expiring first. */
async function pickFromShelf(tx: Runner, warehouseId: number, lines: SampleLineInput[], ref: string, note: string, me: Me) {
  const today = todayManila();
  const picked: { medicineId: number; batchId: number; qty: number }[] = [];
  for (const line of lines) {
    const batches = await rows<{ batchId: number; qty: number }>(
      tx,
      sql`select s.batch_id::int as "batchId", s.qty::int as qty from stock s join batch b on b.id = s.batch_id
        where s.warehouse_id = ${warehouseId} and b.medicine_id = ${line.medicineId} and s.qty > 0
          and (b.expires_on is null or b.expires_on > ${today}::date)
        order by b.expires_on nulls last, b.id for update of s`,
    );
    let left = line.qty;
    for (const batch of batches) {
      if (left <= 0) break;
      const take = Math.min(left, batch.qty);
      await tx.execute(sql`update stock set qty = qty - ${take} where batch_id = ${batch.batchId} and warehouse_id = ${warehouseId}`);
      await tx.execute(
        sql`insert into stock_move (medicine_id, batch_id, warehouse_id, qty, kind, ref, note, by_person)
          values (${line.medicineId}, ${batch.batchId}, ${warehouseId}, ${-take}, 'sample_out', ${ref}, ${note}, ${me.id})`,
      );
      picked.push({ medicineId: line.medicineId, batchId: batch.batchId, qty: take });
      left -= take;
    }
    if (left > 0) {
      const [medicine] = await rows<{ name: string }>(tx, sql`select name from medicine where id = ${line.medicineId}`);
      throw new Refusal(409, "not_now", `Not enough unexpired ${medicine?.name ?? "stock"} in that warehouse: ${left.toLocaleString("en-PH")} short.`, "lines");
    }
  }
  return picked;
}

async function defaultWarehouse(tx: Runner, asked?: number | null): Promise<{ id: number; name: string }> {
  const [found] = await rows<{ id: number; name: string }>(
    tx,
    asked
      ? sql`select id::int as id, name from warehouse where id = ${asked} and active`
      : sql`select id::int as id, name from warehouse where is_default and active limit 1`,
  );
  if (!found) throw new Refusal(400, "invalid", "Pick the warehouse it goes out of.", "warehouseId");
  return found;
}

export async function issueSamples(db: Database, me: Me, id: number, input: { warehouseId?: number | null }): Promise<void> {
  allow(me, ISSUE_ROLES, "issue samples");
  await db.transaction(async (tx) => {
    const request = await lockRequest(tx, id);
    if (request.status !== "approved") throw new Refusal(409, "not_now", `${request.code} isn't approved and waiting to go out.`);
    await noSamplesRefused(tx, request.kind, request.lines.map((line) => line.medicineId));
    const warehouse = await defaultWarehouse(tx, input.warehouseId);
    const picked = await pickFromShelf(tx, warehouse.id, request.lines, request.code, `${KIND_WORD[request.kind]} for ${request.person}`, me);
    await tx.execute(
      sql`update sample_request set status = 'issued', issued_by = ${me.id}, issued_at = now(), issued_from = ${warehouse.id},
          issued_lines = ${JSON.stringify(picked)}::jsonb where id = ${id}`,
    );
    await notify(tx, {
      to: [request.personId],
      kind: "sample_request",
      title: `${request.code}: your ${KIND_WORD[request.kind]} are on the way`,
      body: "Mark them received when they reach you.",
      link: "/me/samples",
      key: `sample:${id}:issued`,
    });
  });
}

/** The stock desk sends samples or gifts to a rep with no request (the old CRM's "Send stock"). */
export async function sendSamples(
  db: Database,
  me: Me,
  input: { personId: number; kind: SampleKind; lines: SampleLineInput[]; note?: string | null; warehouseId?: number | null },
): Promise<{ id: number; code: string }> {
  allow(me, ISSUE_ROLES, "send samples");
  if (!isKind(input.kind)) throw new Refusal(400, "invalid", "Samples or gifts?", "kind");
  checkLines(input.lines, 1000, 50);
  const made = await db.transaction(async (tx) => {
    const [rep] = await rows<{ role: Role }>(tx, sql`select role from person where id = ${input.personId} and active`);
    if (!rep || !FIELD_ROLES.includes(rep.role)) throw new Refusal(400, "invalid", "Pick a MedRep or team lead.", "personId");
    const code = await nextCode(tx);
    const [row] = await rows<{ id: number }>(
      tx,
      sql`insert into sample_request (code, person_id, kind, lines, note, status, asked_by, decided_by, decided_at)
        values (${code}, ${input.personId}, ${input.kind}, ${JSON.stringify(input.lines)}::jsonb, ${input.note?.trim() || null}, 'approved', ${me.id}, ${me.id}, now())
        returning id::int as id`,
    );
    return { id: row?.id as number, code };
  });
  await issueSamples(db, me, made.id, { warehouseId: input.warehouseId });
  return made;
}

export async function receiveSamples(db: Database, me: Me, id: number): Promise<void> {
  await db.transaction(async (tx) => {
    const request = await lockRequest(tx, id);
    if (request.personId !== me.id && !BACKUP_ROLES.includes(me.role)) throw new Refusal(403, "not_allowed", "The rep marks their samples received.");
    if (request.status !== "issued") throw new Refusal(409, "not_now", `${request.code} isn't on the way.`);
    const [issued] = await rows<{ lines: { medicineId: number; batchId: number; qty: number }[] }>(
      tx,
      sql`select issued_lines as lines from sample_request where id = ${id}`,
    );
    for (const line of issued?.lines ?? []) {
      await tx.execute(
        sql`insert into sample_stock (person_id, kind, batch_id, qty) values (${request.personId}, ${request.kind}, ${line.batchId}, ${line.qty})
          on conflict (person_id, kind, batch_id) do update set qty = sample_stock.qty + excluded.qty`,
      );
      await tx.execute(
        sql`insert into sample_move (person_id, kind, batch_id, medicine_id, qty, what, request_id, by_person)
          values (${request.personId}, ${request.kind}, ${line.batchId}, ${line.medicineId}, ${line.qty}, 'received', ${id}, ${me.id})`,
      );
    }
    await tx.execute(sql`update sample_request set status = 'received', received_at = now() where id = ${id}`);
  });
}

export async function giveSamples(
  db: Database,
  me: Me,
  input: { visitId: number; kind: SampleKind; lines: SampleLineInput[]; ack: IncomingFile | null },
): Promise<void> {
  if (!FIELD_ROLES.includes(me.role) || me.viewedBy) throw new Refusal(403, "not_allowed", "Samples are given by the rep at their visit.");
  refuseOffice(me);
  if (!isKind(input.kind)) throw new Refusal(400, "invalid", "Samples or gifts?", "kind");
  checkLines(input.lines, 100, 20);
  if (!input.ack) throw new Refusal(400, "invalid", "Attach the doctor's signed acknowledgement.", "file");
  // A photo or a PDF only: the file is shown back from the CRM's own address.
  if (!["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"].includes(input.ack.mime))
    throw new Refusal(400, "invalid", "Attach a photo or a PDF.", "file");
  const kept = await keepFile("samples", input.ack);
  const today = todayManila();
  await db.transaction(async (tx) => {
    const [visit] = await rows<{ personId: number; customerId: number; kind: string }>(
      tx,
      sql`select v.person_id::int as "personId", v.customer_id::int as "customerId", c.kind from visit v join customer c on c.id = v.customer_id where v.id = ${input.visitId}`,
    );
    if (!visit || visit.personId !== me.id) throw new Refusal(404, "not_found", "That visit isn't yours.");
    if (visit.kind !== "doctor") throw new Refusal(400, "invalid", "Samples and gifts go to a doctor.", "visitId");
    await noSamplesRefused(tx, input.kind, input.lines.map((line) => line.medicineId));
    for (const line of input.lines) {
      const held = await rows<{ batchId: number; qty: number }>(
        tx,
        sql`select s.batch_id::int as "batchId", s.qty::int as qty from sample_stock s join batch b on b.id = s.batch_id
          where s.person_id = ${me.id} and s.kind = ${input.kind} and b.medicine_id = ${line.medicineId} and s.qty > 0
            and (b.expires_on is null or b.expires_on > ${today}::date)
          order by b.expires_on nulls last, b.id for update of s`,
      );
      const have = held.reduce((sum, one) => sum + one.qty, 0);
      if (have < line.qty) {
        const [medicine] = await rows<{ name: string }>(tx, sql`select name from medicine where id = ${line.medicineId}`);
        throw new Refusal(409, "not_now", `Not enough in your ${KIND_WORD[input.kind]}: ${have} ${medicine?.name ?? ""} unexpired.`, "lines");
      }
      let left = line.qty;
      for (const batch of held) {
        if (left <= 0) break;
        const take = Math.min(left, batch.qty);
        await tx.execute(sql`update sample_stock set qty = qty - ${take} where person_id = ${me.id} and kind = ${input.kind} and batch_id = ${batch.batchId}`);
        await tx.execute(
          sql`insert into sample_move (person_id, kind, batch_id, medicine_id, qty, what, visit_id, customer_id, ack_key, ack_data, ack_name, ack_mime, by_person)
            values (${me.id}, ${input.kind}, ${batch.batchId}, ${line.medicineId}, ${-take}, 'given', ${input.visitId}, ${visit.customerId},
              ${kept.key}, ${kept.data}, ${kept.name}, ${kept.mime}, ${me.id})`,
        );
        left -= take;
      }
    }
  });
}

/** The rep's own count, batch by batch: what they hold now; every difference needs a reason. */
export async function countSamples(
  db: Database,
  me: Me,
  input: { kind: SampleKind; lines: { batchId: number; counted: number; reason?: string | null }[] },
): Promise<{ differences: number }> {
  if (!FIELD_ROLES.includes(me.role) || me.viewedBy) throw new Refusal(403, "not_allowed", "Each rep counts their own samples.");
  if (!isKind(input.kind)) throw new Refusal(400, "invalid", "Samples or gifts?", "kind");
  if (!input.lines.length || input.lines.length > 200) throw new Refusal(400, "invalid", "Count 1 to 200 batches at a time.", "lines");
  return db.transaction(async (tx) => {
    let differences = 0;
    for (const line of input.lines) {
      if (!Number.isInteger(line.counted) || line.counted < 0) throw new Refusal(400, "invalid", "Type how many you have (0 or more).", "lines");
      const [held] = await rows<{ qty: number; medicineId: number }>(
        tx,
        sql`select coalesce(s.qty, 0)::int as qty, b.medicine_id::int as "medicineId" from batch b
          left join sample_stock s on s.batch_id = b.id and s.person_id = ${me.id} and s.kind = ${input.kind}
          where b.id = ${line.batchId}`,
      );
      if (!held) throw new Refusal(400, "invalid", "That batch isn't known.", "lines");
      const difference = line.counted - held.qty;
      if (difference === 0) continue;
      if (!line.reason?.trim()) throw new Refusal(400, "invalid", "Say why each count differs.", "lines");
      differences++;
      await tx.execute(
        sql`insert into sample_stock (person_id, kind, batch_id, qty) values (${me.id}, ${input.kind}, ${line.batchId}, ${line.counted})
          on conflict (person_id, kind, batch_id) do update set qty = excluded.qty`,
      );
      await tx.execute(
        sql`insert into sample_move (person_id, kind, batch_id, medicine_id, qty, what, reason, by_person)
          values (${me.id}, ${input.kind}, ${line.batchId}, ${held.medicineId}, ${difference}, 'counted', ${line.reason.trim()}, ${me.id})`,
      );
    }
    // A count with no difference is still a count: kept (0) so "counted this month" shows.
    if (!differences)
      await tx.execute(
        sql`insert into sample_move (person_id, kind, batch_id, medicine_id, qty, what, reason, by_person)
          select ${me.id}, ${input.kind}, b.id, b.medicine_id, 0, 'counted', 'Counted, no difference', ${me.id} from batch b where b.id = ${input.lines[0]?.batchId}`,
      );
    return { differences };
  });
}

const monthOf = (asked?: string | null) => (asked && /^\d{4}-\d{2}$/.test(asked) ? asked : todayManila().slice(0, 7));

/** A rep's samples and gifts: what they hold, what is on the way, their requests, the month. */
export async function samplesOf(db: Database, me: Me, asked: { personId?: number | null; month?: string | null }): Promise<SamplesOfPerson> {
  const personId = asked.personId ?? me.id;
  const own = personId === me.id;
  if (!own && !ALL_ROLES.includes(me.role) && !(await leads(db, me, personId)))
    throw new Refusal(403, "not_allowed", "A rep's samples are theirs, their leads' and the stock desk's to see.");
  const month = monthOf(asked.month);
  const today = todayManila();
  const [person] = await rows<{ name: string }>(db, sql`select name from person where id = ${personId}`);
  const held = await rows<SamplesOfPerson["held"][number]>(
    db,
    sql`select s.kind, b.id::int as "batchId", b.batch_no as "batchNo", m.id::int as "medicineId", m.name || coalesce(' ' || m.strength, '') as medicine,
        to_char(b.expires_on, 'YYYY-MM-DD') as expires, s.qty::int as qty,
        case when b.expires_on is not null and b.expires_on <= ${today}::date then 'expired'
          when b.expires_on is not null and b.expires_on <= ${today}::date + 90 then 'soon' else 'ok' end as tone
      from sample_stock s join batch b on b.id = s.batch_id join medicine m on m.id = b.medicine_id
      where s.person_id = ${personId} and s.qty > 0 order by s.kind, m.name, b.expires_on nulls last`,
  );
  const requests = await rows<SamplesOfPerson["requests"][number]>(
    db,
    sql`select r.id::int as id, r.code, r.kind, r.status, r.note, r.reject_reason as "rejectReason", r.asked_at::text as "askedAt",
        coalesce((select json_agg(json_build_object('medicine', m.name || coalesce(' ' || m.strength, ''), 'qty', (l->>'qty')::int))
          from jsonb_array_elements(r.lines) l join medicine m on m.id = (l->>'medicineId')::bigint), '[]'::json) as lines
      from sample_request r where r.person_id = ${personId}
        and (r.status in ('submitted', 'approved', 'issued') or to_char(r.asked_at, 'YYYY-MM') = ${month})
      order by r.asked_at desc limit 50`,
  );
  const [moves] = await rows<{ givenSamples: number; givenGifts: number; doctors: number; receivedSamples: number; receivedGifts: number; countedSamples: boolean; countedGifts: boolean }>(
    db,
    sql`select
        coalesce(sum(-qty) filter (where what = 'given' and kind = 'samples'), 0)::int as "givenSamples",
        coalesce(sum(-qty) filter (where what = 'given' and kind = 'gifts'), 0)::int as "givenGifts",
        count(distinct customer_id) filter (where what = 'given')::int as doctors,
        coalesce(sum(qty) filter (where what = 'received' and kind = 'samples'), 0)::int as "receivedSamples",
        coalesce(sum(qty) filter (where what = 'received' and kind = 'gifts'), 0)::int as "receivedGifts",
        bool_or(what = 'counted' and kind = 'samples') as "countedSamples",
        bool_or(what = 'counted' and kind = 'gifts') as "countedGifts"
      from sample_move where person_id = ${personId} and to_char(at at time zone 'Asia/Manila', 'YYYY-MM') = ${month}`,
  );
  return {
    personId,
    person: person?.name ?? "",
    month,
    own,
    held,
    requests,
    month_: {
      givenSamples: moves?.givenSamples ?? 0,
      givenGifts: moves?.givenGifts ?? 0,
      doctors: moves?.doctors ?? 0,
      receivedSamples: moves?.receivedSamples ?? 0,
      receivedGifts: moves?.receivedGifts ?? 0,
      countedSamples: Boolean(moves?.countedSamples),
      countedGifts: Boolean(moves?.countedGifts),
    },
    can: { ask: own && FIELD_ROLES.includes(me.role) && !me.viewedBy },
  };
}

/** Every rep's samples and gifts for a lead (their team), the stock desk and the CEO. */
export async function teamSamples(db: Database, me: Me, asked: { month?: string | null }): Promise<TeamSamples> {
  const everyone = ALL_ROLES.includes(me.role);
  if (!everyone && !LEAD_ROLES.includes(me.role)) throw new Refusal(403, "not_allowed", "The team's samples are for leads, the stock desk and the CEO.");
  const month = monthOf(asked.month);
  const scope = everyone
    ? sql`true`
    : sql`p.id in (with recursive team as (select id from person where id = ${me.id}
        union all select q.id from person q join team t on q.reports_to = t.id) select id from team where id <> ${me.id})`;
  const reps = await rows<TeamSamples["reps"][number]>(
    db,
    sql`select p.id::int as "personId", p.name,
        coalesce((select sum(s.qty) from sample_stock s where s.person_id = p.id and s.kind = 'samples'), 0)::int as samples,
        coalesce((select sum(s.qty) from sample_stock s where s.person_id = p.id and s.kind = 'gifts'), 0)::int as gifts,
        coalesce((select sum(x.qty) from sample_move x where x.person_id = p.id and x.what = 'received' and to_char(x.at at time zone 'Asia/Manila', 'YYYY-MM') = ${month}), 0)::int as received,
        coalesce((select sum(-x.qty) from sample_move x where x.person_id = p.id and x.what = 'given' and to_char(x.at at time zone 'Asia/Manila', 'YYYY-MM') = ${month}), 0)::int as given,
        (select count(distinct x.customer_id) from sample_move x where x.person_id = p.id and x.what = 'given' and to_char(x.at at time zone 'Asia/Manila', 'YYYY-MM') = ${month})::int as doctors,
        exists (select 1 from sample_move x where x.person_id = p.id and x.what = 'counted' and to_char(x.at at time zone 'Asia/Manila', 'YYYY-MM') = ${month}) as counted,
        coalesce((select sum(x.qty) from sample_move x where x.person_id = p.id and x.what = 'counted' and to_char(x.at at time zone 'Asia/Manila', 'YYYY-MM') = ${month}), 0)::int as difference
      from person p where p.active and p.role in ('medrep', 'team_lead', 'manager') and ${scope}
        and (exists (select 1 from sample_stock s where s.person_id = p.id and s.qty > 0) or exists (select 1 from sample_move x where x.person_id = p.id)
          or exists (select 1 from sample_request r where r.person_id = p.id))
      order by p.name`,
  );
  const open = await rows<Omit<TeamSamples["requests"][number], "canDecide" | "canIssue">>(
    db,
    sql`select r.id::int as id, r.code, r.kind, r.status, r.note, p.id::int as "personId", p.name as person, r.asked_at::text as "askedAt",
        coalesce((select json_agg(json_build_object('medicine', m.name || coalesce(' ' || m.strength, ''), 'qty', (l->>'qty')::int))
          from jsonb_array_elements(r.lines) l join medicine m on m.id = (l->>'medicineId')::bigint), '[]'::json) as lines
      from sample_request r join person p on p.id = r.person_id
      where r.status in ('submitted', 'approved', 'issued') and ${scope} order by r.asked_at`,
  );
  const requests: TeamSamples["requests"] = [];
  for (const one of open)
    requests.push({
      ...one,
      canDecide: one.status === "submitted" && (await mayDecide(db, me, one.personId)),
      canIssue: one.status === "approved" && ISSUE_ROLES.includes(me.role),
    });
  const counts = await rows<TeamSamples["counts"][number]>(
    db,
    sql`select p.id::int as "personId", p.name as person, x.kind, m.name as medicine, x.qty::int as difference, x.reason, x.at::text as at
      from sample_move x join person p on p.id = x.person_id join medicine m on m.id = x.medicine_id
      where x.what = 'counted' and x.qty <> 0 and to_char(x.at at time zone 'Asia/Manila', 'YYYY-MM') = ${month} and ${scope}
      order by x.at desc`,
  );
  const doctors = await rows<TeamSamples["doctors"][number]>(
    db,
    sql`select c.id::int as "customerId", c.name as doctor, p.id::int as "personId", p.name as person, string_agg(distinct m.name, ', ') as medicines,
        sum(-x.qty)::int as pieces, count(distinct x.visit_id)::int as visits
      from sample_move x join person p on p.id = x.person_id join customer c on c.id = x.customer_id join medicine m on m.id = x.medicine_id
      where x.what = 'given' and to_char(x.at at time zone 'Asia/Manila', 'YYYY-MM') = ${month} and ${scope}
      group by c.id, c.name, p.id, p.name order by pieces desc`,
  );
  return { month, reps, requests, counts, doctors, can: { send: ISSUE_ROLES.includes(me.role) } };
}

/** The doctor's signed acknowledgement of a give. */
export async function sampleAck(db: Database, me: Me, moveId: number): Promise<{ name: string; mime: string; data: Uint8Array | null; key: string | null }> {
  const [found] = await rows<{ personId: number; name: string; mime: string; data: Uint8Array | null; key: string | null }>(
    db,
    sql`select person_id::int as "personId", ack_name as name, ack_mime as mime, ack_data as data, ack_key as key from sample_move where id = ${moveId} and what = 'given'`,
  );
  if (!found) throw new Refusal(404, "not_found", "That acknowledgement isn't here.");
  if (found.personId !== me.id && !ALL_ROLES.includes(me.role) && !(await leads(db, me, found.personId)))
    throw new Refusal(403, "not_allowed", "Not yours to open.");
  return found;
}
