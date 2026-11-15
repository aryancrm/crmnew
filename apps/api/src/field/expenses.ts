// What the field spends: petrol (with the kilometres), fares, parking, tolls, food, lodging and
// other costs, on a day and (when there is one) for a visit, each with the photo of its bill or
// payment proof (a fare may have none). The person adds them; their team lead approves each or
// sends it back with a word; the CEO, Management and the Admin read everyone's.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { Refusal } from "../http";
import { addDays, todayManila } from "../inventory/rules";
import { clean, type Runner } from "../inventory/service";
import { inForce } from "../org/service";
import type { ExpenseInput, ExpenseKind, ExpenseRow, FieldExpenses, Me } from "../types";
import { FIELD_READ_ROLES, FIELD_ROLES, LEAD_ROLES, leads, maySeeField } from "./visits";

export const EXPENSE_KINDS: ExpenseKind[] = [
  "petrol",
  "fare",
  "parking",
  "toll",
  "food",
  "lodging",
  "other",
];
const RECEIPT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
];
export const RECEIPT_MAX_BYTES = 10 * 1024 * 1024;
/** How far back a person may add what they spent. */
const BACK_DAYS = 31;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export type Receipt = { name: string; mime: string; bytes: Uint8Array };

function checkReceipt(receipt: Receipt | null) {
  if (!receipt) return;
  if (!RECEIPT_TYPES.includes(receipt.mime))
    throw new Refusal(400, "invalid", "Attach a photo or a PDF of the bill.", "file");
  if (receipt.bytes.byteLength === 0)
    throw new Refusal(400, "invalid", "That file is empty.", "file");
  if (receipt.bytes.byteLength > RECEIPT_MAX_BYTES)
    throw new Refusal(400, "invalid", "That file is over 10 MB. Take the photo again.", "file");
}

function checkInput(input: ExpenseInput, hasReceipt: boolean) {
  const today = todayManila();
  if (!EXPENSE_KINDS.includes(input.kind))
    throw new Refusal(400, "invalid", "Say what it was for.", "kind");
  if (!DAY.test(input.day) || input.day > today || input.day < addDays(today, -BACK_DAYS))
    throw new Refusal(
      400,
      "invalid",
      `Pick the day: today or up to ${BACK_DAYS} days back.`,
      "day",
    );
  if (!Number.isInteger(input.amount) || input.amount <= 0 || input.amount > 10_000_000)
    throw new Refusal(400, "invalid", "Type the amount in pesos.", "amount");
  if (
    input.km !== null &&
    input.km !== undefined &&
    (!Number.isInteger(input.km) || input.km <= 0 || input.km > 2000)
  )
    throw new Refusal(400, "invalid", "Type the kilometres as a whole number.", "km");
  if (input.kind === "other" && !clean(input.note))
    throw new Refusal(400, "invalid", "Say what it was.", "note");
  if (input.kind !== "fare" && !hasReceipt)
    throw new Refusal(400, "invalid", "Attach the photo of the bill or payment proof.", "file");
}

async function checkVisit(tx: Runner, me: Me, visitId: number | null | undefined, day: string) {
  if (!visitId) return null;
  const [visit] = await rows<{ id: number }>(
    tx,
    sql`select id::int as id from visit where id = ${visitId} and person_id = ${me.id} and day = ${day}::date`,
  );
  if (!visit) throw new Refusal(400, "invalid", "Pick one of your visits that day.", "visitId");
  return visit.id;
}

/** Adds a line of what the person spent, with the bill's photo. */
export async function addExpense(
  db: Database,
  me: Me,
  input: ExpenseInput,
  receipt: Receipt | null,
): Promise<{ id: number }> {
  if (!FIELD_ROLES.includes(me.role) || me.viewedBy)
    throw new Refusal(403, "not_allowed", "Field expenses are added by the person who spent.");
  checkReceipt(receipt);
  checkInput(input, Boolean(receipt));
  return db.transaction(async (tx) => {
    const visitId = await checkVisit(tx, me, input.visitId, input.day);
    const [made] = await rows<{ id: number }>(
      tx,
      sql`insert into field_expense (person_id, seat_id, day, kind, amount, km, visit_id, note,
          receipt_name, receipt_mime, receipt_size, receipt_data)
        values (${me.id},
          (select h.seat_id from seat_holder h join seat s on s.id = h.seat_id and s.active
            where h.person_id = ${me.id} and h.kind = 'holder' and ${inForce("h", todayManila())}
            order by h.starts_on limit 1),
          ${input.day}::date, ${input.kind}, ${input.amount}, ${input.km ?? null}, ${visitId},
          ${clean(input.note) ?? null}, ${receipt ? receipt.name.trim().slice(0, 120) || "receipt" : null},
          ${receipt?.mime ?? null}, ${receipt?.bytes.byteLength ?? null},
          ${receipt ? Buffer.from(receipt.bytes) : null})
        returning id::int as id`,
    );
    return { id: made?.id as number };
  });
}

/** Changes a line still waiting or sent back; it waits for the team lead again. */
export async function changeExpense(
  db: Database,
  me: Me,
  expenseId: number,
  input: ExpenseInput,
  receipt: Receipt | null,
): Promise<void> {
  if (me.viewedBy) throw new Refusal(403, "not_allowed", "Look-only: nothing changes.");
  checkReceipt(receipt);
  await db.transaction(async (tx) => {
    const [line] = await rows<{ personId: number; status: string; hasReceipt: boolean }>(
      tx,
      sql`select person_id::int as "personId", status, receipt_data is not null as "hasReceipt"
        from field_expense where id = ${expenseId} for update`,
    );
    if (!line) throw new Refusal(404, "not_found", "No such expense.");
    if (line.personId !== me.id)
      throw new Refusal(403, "not_allowed", "Only the person who spent changes it.");
    if (line.status === "approved")
      throw new Refusal(409, "invalid", "That expense is approved already.");
    checkInput(input, Boolean(receipt) || line.hasReceipt);
    const visitId = await checkVisit(tx, me, input.visitId, input.day);
    await tx.execute(
      sql`update field_expense set day = ${input.day}::date, kind = ${input.kind}, amount = ${input.amount},
          km = ${input.km ?? null}, visit_id = ${visitId}, note = ${clean(input.note) ?? null},
          status = 'pending', decided_by = null, decided_at = null, decision_note = null
          ${
            receipt
              ? sql`, receipt_name = ${receipt.name.trim().slice(0, 120) || "receipt"}, receipt_mime = ${receipt.mime},
                receipt_size = ${receipt.bytes.byteLength}, receipt_data = ${Buffer.from(receipt.bytes)}`
              : sql``
          }
        where id = ${expenseId}`,
    );
  });
}

/** The team lead (or Management, the Admin) approves a line or sends it back with a word. */
export async function decideExpense(
  db: Database,
  me: Me,
  expenseId: number,
  input: { approve: boolean; note?: string | null },
): Promise<void> {
  const note = clean(input.note) ?? null;
  if (!input.approve && !note)
    throw new Refusal(400, "invalid", "Say what is wrong with it.", "note");
  await db.transaction(async (tx) => {
    const [line] = await rows<{ personId: number; status: string }>(
      tx,
      sql`select person_id::int as "personId", status from field_expense where id = ${expenseId} for update`,
    );
    if (!line) throw new Refusal(404, "not_found", "No such expense.");
    const allowed =
      !me.viewedBy &&
      me.id !== line.personId &&
      ((await leads(tx, me, line.personId)) || ["admin", "management"].includes(me.role));
    if (!allowed)
      throw new Refusal(403, "not_allowed", "An expense is approved by the person's team lead.");
    if (line.status !== "pending")
      throw new Refusal(409, "invalid", "That expense isn't waiting for approval.");
    await tx.execute(
      sql`update field_expense set status = ${input.approve ? "approved" : "sent_back"}, decided_by = ${me.id},
          decided_at = now(), decision_note = ${note}
        where id = ${expenseId}`,
    );
  });
}

const rowColumns = sql`x.id::int as id, json_build_object('id', p.id::int, 'name', p.name) as person,
  to_char(x.day, 'YYYY-MM-DD') as day, x.kind, x.amount, x.km, x.note, x.status,
  d.name as "decidedBy", x.decision_note as "decisionNote",
  case when x.visit_id is null then null else json_build_object('id', x.visit_id::int, 'customer', c.name) end as visit,
  case when x.receipt_data is null then null else json_build_object('name', x.receipt_name, 'mime', x.receipt_mime) end as receipt`;

/**
 * Expenses over chosen days: one person's (their own, their team lead's, everyone's for the CEO,
 * Management and the Admin), or with `waiting` every line waiting for this person's decision
 * (their team's; everyone's for Management and the Admin).
 */
export async function fieldExpenses(
  db: Database,
  me: Me,
  asked: { from?: string | null; to?: string | null; person?: number | null; waiting?: boolean },
): Promise<FieldExpenses> {
  const today = todayManila();
  const to = asked.to && DAY.test(asked.to) ? asked.to : today;
  let from = asked.from && DAY.test(asked.from) ? asked.from : `${today.slice(0, 7)}-01`;
  if (from > to) from = to;
  if (from < addDays(to, -366)) from = addDays(to, -366);
  let found: Omit<ExpenseRow, "canDecide">[];
  let person: { id: number; name: string } | null = null;
  if (asked.waiting) {
    const everyone = ["admin", "management"].includes(me.role);
    if (!everyone && !LEAD_ROLES.includes(me.role))
      throw new Refusal(403, "not_allowed", "Approving expenses is the team lead's.");
    found = await rows(
      db,
      sql`with recursive team as (select id from person where id = ${me.id}
          union all select q.id from person q join team t on q.reports_to = t.id)
        select ${rowColumns} from field_expense x join person p on p.id = x.person_id
          left join person d on d.id = x.decided_by left join visit v on v.id = x.visit_id
          left join customer c on c.id = v.customer_id
        where x.status = 'pending' and x.person_id <> ${me.id}
          ${everyone ? sql`` : sql`and x.person_id in (select id from team)`}
        order by x.day, p.name, x.id`,
    );
  } else {
    const personId = asked.person ?? me.id;
    if (!(await maySeeField(db, me, personId)))
      throw new Refusal(403, "not_allowed", "That person's expenses aren't yours to see.");
    const [named] = await rows<{ id: number; name: string }>(
      db,
      sql`select id::int as id, name from person where id = ${personId}`,
    );
    if (!named) throw new Refusal(404, "not_found", "No such person.");
    person = named;
    found = await rows(
      db,
      sql`select ${rowColumns} from field_expense x join person p on p.id = x.person_id
          left join person d on d.id = x.decided_by left join visit v on v.id = x.visit_id
          left join customer c on c.id = v.customer_id
        where x.person_id = ${personId} and x.day between ${from}::date and ${to}::date
        order by x.day desc, x.id desc`,
    );
  }
  const leadOf = new Map<number, boolean>();
  const out: ExpenseRow[] = [];
  for (const row of found) {
    if (!leadOf.has(row.person.id))
      leadOf.set(
        row.person.id,
        !me.viewedBy &&
          me.id !== row.person.id &&
          ((await leads(db, me, row.person.id)) || ["admin", "management"].includes(me.role)),
      );
    out.push({ ...row, canDecide: row.status === "pending" && Boolean(leadOf.get(row.person.id)) });
  }
  const byKind: FieldExpenses["totals"]["byKind"] = {};
  for (const row of out)
    if (row.status !== "sent_back") byKind[row.kind] = (byKind[row.kind] ?? 0) + row.amount;
  const total = (status: string) =>
    out.filter((row) => row.status === status).reduce((sum, row) => sum + row.amount, 0);
  return {
    from,
    to,
    person,
    rows: out,
    totals: {
      pending: total("pending"),
      approved: total("approved"),
      sentBack: total("sent_back"),
      byKind,
      km: out
        .filter((row) => row.status !== "sent_back")
        .reduce((sum, row) => sum + (row.km ?? 0), 0),
    },
    can: {
      add: !asked.waiting && person?.id === me.id && FIELD_ROLES.includes(me.role) && !me.viewedBy,
    },
  };
}

/** The bill's photo, for the person, their team lead and those who read everyone's. */
export async function readReceipt(db: Database, me: Me, expenseId: number): Promise<Receipt> {
  const [line] = await rows<{
    personId: number;
    name: string;
    mime: string;
    data: Uint8Array | null;
  }>(
    db,
    sql`select person_id::int as "personId", receipt_name as name, receipt_mime as mime, receipt_data as data
      from field_expense where id = ${expenseId}`,
  );
  if (!line?.data) throw new Refusal(404, "not_found", "No bill on file.");
  if (!(await maySeeField(db, me, line.personId)) && !FIELD_READ_ROLES.includes(me.role))
    throw new Refusal(403, "not_allowed", "That bill isn't yours to see.");
  return { name: line.name, mime: line.mime, bytes: line.data };
}
