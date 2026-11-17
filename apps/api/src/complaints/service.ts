// Complaints and side-effects (migration 0100): reported by anyone at work, handled by Regulatory
// (Management, the CEO and the Admin see them too) to a due day, closed with the outcome.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { allow, Refusal } from "../http";
import { todayManila } from "../inventory/rules";
import type { Runner } from "../inventory/service";
import { notify, peopleIn } from "../notify/service";
import type { ComplaintInput, ComplaintKind, ComplaintList, Me, Role } from "../types";

/** Who handles complaints; everyone else sees the ones they reported. */
export const COMPLAINT_ROLES: readonly Role[] = ["regulatory", "management", "ceo", "admin"];
const KINDS: ComplaintKind[] = ["quality", "side_effect", "delivery", "service", "other"];
export const COMPLAINT_KIND_LABEL: Record<ComplaintKind, string> = {
  quality: "Product quality",
  side_effect: "Side-effect",
  delivery: "Wrong or damaged delivery",
  service: "Service",
  other: "Other",
};
const isDay = (value?: string | null) => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

async function log(tx: Runner, id: number, me: Me, message: string) {
  await tx.execute(sql`insert into complaint_event (complaint_id, message, by_person) values (${id}, ${message}, ${me.id})`);
}

export async function reportComplaint(db: Database, me: Me, input: ComplaintInput): Promise<{ id: number; code: string }> {
  if (me.viewedBy) throw new Refusal(403, "not_allowed", "Report it from your own login.");
  if (!KINDS.includes(input.kind)) throw new Refusal(400, "invalid", "Pick what it is about.", "kind");
  const description = input.description?.trim();
  if (!description || description.length < 10) throw new Refusal(400, "invalid", "Say what happened (a few words at least).", "description");
  if (input.kind === "side_effect" && !input.medicineId) throw new Refusal(400, "invalid", "Pick the medicine for a side-effect.", "medicineId");
  const today = todayManila();
  const received = isDay(input.receivedOn) ? (input.receivedOn as string) : today;
  if (received > today) throw new Refusal(400, "invalid", "That day is still to come.", "receivedOn");
  const serious = input.kind === "side_effect" && Boolean(input.serious);
  // A serious side-effect within 15 days of hearing of it (the FDA's window); anything else 30.
  const due = addDays(received, serious ? 15 : 30);
  return db.transaction(async (tx) => {
    const [next] = await rows<{ value: number }>(
      tx,
      sql`insert into counter (name, value) values ('complaint', 1)
        on conflict (name) do update set value = counter.value + 1 returning value::int as value`,
    );
    const code = `CMP-${String(next?.value ?? 1).padStart(5, "0")}`;
    const [made] = await rows<{ id: number }>(
      tx,
      sql`insert into complaint (code, kind, serious, customer_id, patient_name, medicine_id, batch_no, order_id, description, received_on, due_on, reported_by)
        values (${code}, ${input.kind}, ${serious}, ${input.customerId ?? null}, ${input.patientName?.trim() || null}, ${input.medicineId ?? null},
          ${input.batchNo?.trim() || null}, ${input.orderId ?? null}, ${description}, ${received}::date, ${due}::date, ${me.id})
        returning id::int as id`,
    );
    const id = made?.id as number;
    await log(tx, id, me, `Reported by ${me.name}.`);
    const regulatory = await peopleIn(tx, ["regulatory"]);
    await notify(tx, {
      to: [...(regulatory.length ? regulatory : await peopleIn(tx, ["management"])), ...(serious ? await peopleIn(tx, ["ceo"]) : [])],
      kind: "complaint",
      title: `${serious ? "SERIOUS side-effect" : COMPLAINT_KIND_LABEL[input.kind]} reported (${code}), due ${due}`,
      body: description.slice(0, 200),
      link: `/complaints?open=${id}`,
      key: `complaint:${id}:reported`,
    });
    return { id, code };
  });
}

export async function updateComplaint(
  db: Database,
  me: Me,
  id: number,
  input: { status?: "open" | "investigating" | "closed"; note?: string | null; ownerId?: number | null; dueOn?: string | null; fdaRef?: string | null; outcome?: string | null },
): Promise<void> {
  allow(me, COMPLAINT_ROLES, "handle complaints");
  await db.transaction(async (tx) => {
    const [found] = await rows<{ status: string; code: string; reportedBy: number }>(
      tx,
      sql`select status, code, reported_by::int as "reportedBy" from complaint where id = ${id} for update`,
    );
    if (!found) throw new Refusal(404, "not_found", "That complaint isn't here.");
    if (found.status === "closed" && input.status !== "open") throw new Refusal(409, "not_now", `${found.code} is closed: open it again first.`);
    const said: string[] = [];
    if (input.ownerId !== undefined) {
      const [owner] = input.ownerId ? await rows<{ name: string }>(tx, sql`select name from person where id = ${input.ownerId} and active`) : [{ name: "nobody" }];
      if (!owner) throw new Refusal(400, "invalid", "Pick someone at work.", "ownerId");
      await tx.execute(sql`update complaint set owner_id = ${input.ownerId ?? null} where id = ${id}`);
      said.push(`given to ${owner.name}`);
    }
    if (input.dueOn !== undefined && input.dueOn !== null) {
      if (!isDay(input.dueOn)) throw new Refusal(400, "invalid", "Pick the day.", "dueOn");
      await tx.execute(sql`update complaint set due_on = ${input.dueOn}::date where id = ${id}`);
      said.push(`due ${input.dueOn}`);
    }
    if (input.fdaRef?.trim()) {
      await tx.execute(sql`update complaint set fda_ref = ${input.fdaRef.trim()} where id = ${id}`);
      said.push(`reported to the FDA (${input.fdaRef.trim()})`);
    }
    if (input.status === "closed") {
      if (!input.outcome?.trim()) throw new Refusal(400, "invalid", "Say how it ended before closing it.", "outcome");
      await tx.execute(sql`update complaint set status = 'closed', outcome = ${input.outcome.trim()}, closed_by = ${me.id}, closed_at = now() where id = ${id}`);
      said.push(`closed: ${input.outcome.trim()}`);
      await notify(tx, {
        to: [found.reportedBy],
        kind: "complaint",
        title: `${found.code} closed by ${me.name}`,
        body: input.outcome.trim(),
        link: `/complaints?open=${id}`,
        key: `complaint:${id}:closed:${Date.now()}`,
      });
    } else if (input.status && input.status !== found.status) {
      await tx.execute(sql`update complaint set status = ${input.status}, closed_by = null, closed_at = null where id = ${id}`);
      said.push(input.status === "investigating" ? "being looked into" : "opened again");
    }
    if (input.note?.trim()) said.push(input.note.trim());
    if (!said.length) throw new Refusal(400, "invalid", "Nothing to change.", "note");
    await log(tx, id, me, `${me.name}: ${said.join("; ")}.`);
  });
}

export async function listComplaints(db: Database, me: Me, asked: { view?: string | null }): Promise<ComplaintList> {
  const all = COMPLAINT_ROLES.includes(me.role);
  const today = todayManila();
  const view = asked.view === "closed" ? "closed" : asked.view === "all" ? "all" : "open";
  const found = await rows<Omit<ComplaintList["rows"][number], "kindLabel" | "late">>(
    db,
    sql`select k.id::int as id, k.code, k.kind, k.serious, k.status, k.description, to_char(k.received_on, 'YYYY-MM-DD') as "receivedOn",
        to_char(k.due_on, 'YYYY-MM-DD') as "dueOn", c.id::int as "customerId", c.name as customer, k.patient_name as "patientName",
        m.name || coalesce(' ' || m.strength, '') as medicine, k.batch_no as "batchNo", o.id::int as "orderId", o.code as "orderCode",
        r.name as "reportedBy", ow.name as owner, k.owner_id::int as "ownerId", k.fda_ref as "fdaRef", k.outcome,
        coalesce((select json_agg(json_build_object('at', e.at::text, 'message', e.message) order by e.at) from complaint_event e where e.complaint_id = k.id), '[]'::json) as events
      from complaint k join person r on r.id = k.reported_by left join person ow on ow.id = k.owner_id
        left join customer c on c.id = k.customer_id left join medicine m on m.id = k.medicine_id left join sales_order o on o.id = k.order_id
      where ${all ? sql`true` : sql`k.reported_by = ${me.id}`}
        ${view === "open" ? sql`and k.status <> 'closed'` : view === "closed" ? sql`and k.status = 'closed'` : sql``}
      order by k.status = 'closed', k.serious desc, k.due_on, k.id desc limit 300`,
  );
  const [counts] = await rows<{ open: number; late: number; serious: number }>(
    db,
    sql`select count(*) filter (where status <> 'closed')::int as open, count(*) filter (where status <> 'closed' and due_on < ${today}::date)::int as late,
        count(*) filter (where status <> 'closed' and serious)::int as serious
      from complaint where ${all ? sql`true` : sql`reported_by = ${me.id}`}`,
  );
  return {
    view,
    rows: found.map((row) => ({ ...row, kindLabel: COMPLAINT_KIND_LABEL[row.kind], late: row.status !== "closed" && row.dueOn < today })),
    counts: counts ?? { open: 0, late: 0, serious: 0 },
    can: { handle: all },
  };
}
