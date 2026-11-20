// Expenses on the CRM's own field expenses (SEFMED's Expenses, docs/PLAN.md 22): for each day worked
// the per diem and TA lines are worked out at the rates for the day's work place (the company's
// rates, set by a team lead or the Admin; 0 until set, as in GetMeds' SEFMED); the MR claims them,
// and adds other heads (GetMeds' own list) with the date, amount, a remark and the bill's photo.
// The person's team lead approves each line (the amount may be less) or sends it back with why;
// put right, it waits again. Worked out, claimed and approved stay apart; nothing is approved
// because it was worked out. Older lines keep their kinds (petrol, fare…).

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { EXPENSE_KINDS } from "../field/expenses";
import { FIELD_READ_ROLES, LEAD_ROLES } from "../field/visits";
import { bytesOf, type IncomingFile, keepFile } from "../files/store";
import { Refusal } from "../http";
import { addDays, todayManila } from "../inventory/rules";
import { clean, type Runner } from "../inventory/service";
import { notify } from "../notify/service";
import type { Me } from "../types";
import { accessOf, fieldPerson, inTeam, leadOf, mayDecideFor, mustDecideFor, mustSee, mustWork, seatNow, teamSql } from "./access";
import { type ExpenseMonth, type ExpenseRow, WORK_TYPES, type WorkType } from "./words";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;
const BACK_DAYS = 31;
const FILE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"];
export const EXPENSE_FILE_MAX = 10 * 1024 * 1024;
const MAX_AMOUNT = 100_000_000;
const KIND_NAMES: Record<string, string> = {
  petrol: "Petrol",
  fare: "Fare",
  parking: "Parking",
  toll: "Toll",
  food: "Food",
  lodging: "Lodging",
  other: "Other",
};
void EXPENSE_KINDS;

const expenseColumns = sql`x.id::int as id, json_build_object('id', p.id::int, 'name', p.name) as person,
  to_char(x.day, 'YYYY-MM-DD') as day, coalesce(x.head, x.kind) as head, h.name as "headName", x.kind, x.auto,
  x.generated::float8 as generated, x.amount::float8 as claimed,
  case when x.status = 'approved' then coalesce(x.approved_amount, x.amount) else x.approved_amount end::float8 as approved,
  x.note, (x.receipt_data is not null or x.receipt_key is not null) as "hasFile", x.status, d.name as "decidedBy",
  x.decision_note as "decisionNote"`;
const expenseFrom = sql`from field_expense x left join field_expense_head h on h.code = x.head join person p on p.id = x.person_id
  left join person d on d.id = x.decided_by`;

/** A month of expenses: one's own; a lead's team's (one person, or all; the team switch narrows
 *  it); everyone's for the CEO, Management and the Admin. `waiting` keeps the claimed ones. */
export async function expenseMonth(
  db: Database,
  me: Me,
  asked: { month?: string | null; person?: string | null; waiting?: boolean },
): Promise<ExpenseMonth> {
  const access = await accessOf(db, me);
  if (!access) throw new Refusal(403, "not_allowed", "The field's pages are the MedReps', their leads' and the CEO's.");
  const today = todayManila();
  const month = asked.month && MONTH.test(asked.month) ? asked.month : today.slice(0, 7);
  // What waits for approval is the whole team's unless one person is picked.
  const everyone = access !== "mr" && (asked.person === "all" || (!asked.person && (access === "viewer" || Boolean(asked.waiting))));
  const personId = everyone ? null : Number(asked.person) || me.id;
  if (personId !== null) await mustSee(db, me, personId);
  const first = `${month}-01`;
  const [found, heads, people, allowances, person, decide] = await Promise.all([
    rows<ExpenseRow & { kind: string | null }>(
      db,
      sql`${teamSql(me)} select ${expenseColumns} ${expenseFrom}
        where ${personId === null ? sql`${inTeam(me, "x.person_id")} and x.person_id <> ${me.id}` : sql`x.person_id = ${personId}`}
          and ${asked.waiting ? sql`x.status = 'pending'` : sql`x.day >= ${first}::date and x.day < (${first}::date + interval '1 month')`}
        order by x.day desc, h.sort nulls last, x.id limit 1000`,
    ),
    rows<ExpenseMonth["heads"][number]>(
      db,
      sql`select code, name, allowance, needs_bill as "needsBill", active from field_expense_head order by sort`,
    ),
    access === "mr"
      ? Promise.resolve([] as { id: number; name: string }[])
      : rows<{ id: number; name: string }>(
          db,
          sql`${teamSql(me)} select p.id::int as id, p.name from person p where ${fieldPerson} and ${inTeam(me, "p.id")} and p.id <> ${me.id}
            order by p.name limit 400`,
        ),
    rows<ExpenseMonth["allowances"][number]>(
      db,
      sql`select work_type as "workType", per_diem::float8 as "perDiem", ta::float8 as ta from field_allowance order by work_type`,
    ),
    personId === null
      ? Promise.resolve([] as { id: number; name: string }[])
      : rows<{ id: number; name: string }>(db, sql`select id::int as id, name from person where id = ${personId}`),
    personId === null ? Promise.resolve(LEAD_ROLES.includes(me.role) || me.role === "admin" || me.role === "management") : mayDecideFor(db, me, personId),
  ]);
  const rowsOut: ExpenseRow[] = found.map(({ kind, ...one }) => ({ ...one, headName: one.headName ?? KIND_NAMES[kind ?? ""] ?? "Other" }));
  const sum = (pick: (one: ExpenseRow) => number) => rowsOut.reduce((total, one) => total + pick(one), 0);
  return {
    month,
    today,
    person: person[0] ?? null,
    heads,
    rows: rowsOut,
    totals: {
      generated: sum((one) => one.generated),
      claimed: sum((one) => (one.status === "open" ? 0 : one.claimed)),
      approved: sum((one) => (one.status === "approved" ? (one.approved ?? 0) : 0)),
      waiting: sum((one) => (one.status === "pending" ? one.claimed : 0)),
    },
    people,
    allowances: WORK_TYPES.map((workType) => allowances.find((one) => one.workType === workType) ?? { workType, perDiem: 0, ta: 0 }),
    can: {
      add: personId === me.id && (access === "mr" || access === "lead") && !me.viewedBy,
      decide: decide && !me.viewedBy && me.role !== "ceo",
      setRates: RATE_ROLES.includes(me.role) && !me.viewedBy,
    },
  };
}

function checkFile(file: IncomingFile | null) {
  if (!file) return;
  if (!FILE_TYPES.includes(file.mime)) throw new Refusal(400, "invalid", "Attach a photo or a PDF of the bill.", "file");
  if (file.bytes.byteLength === 0 || file.bytes.byteLength > EXPENSE_FILE_MAX)
    throw new Refusal(400, "invalid", "That file is empty or over 10 MB.", "file");
}

function checkAmount(amount: number) {
  if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_AMOUNT) throw new Refusal(400, "invalid", "Type the amount in pesos.", "amount");
}

async function tellLead(tx: Runner, me: Me, what: string) {
  const lead = await leadOf(tx, me.id);
  if (lead)
    await notify(tx, {
      to: [lead],
      kind: "field_expense",
      title: "An expense to approve",
      body: `${me.name} · ${what}`,
      link: `/visits/expenses?person=${me.id}`,
      key: `field_expense:${me.id}:${Date.now()}`,
    });
}

/** Adds an expense (a head other than the day's allowances): date, head, amount, remark, bill. */
export async function addExpense(
  db: Database,
  me: Me,
  input: { day: string; head: string; amount: number; note?: string | null },
  file: IncomingFile | null,
): Promise<{ id: number }> {
  await mustWork(db, me);
  const today = todayManila();
  if (!DAY.test(input.day) || input.day > today || input.day < addDays(today, -BACK_DAYS))
    throw new Refusal(400, "invalid", `Pick the day: today or up to ${BACK_DAYS} days back.`, "day");
  checkAmount(input.amount);
  checkFile(file);
  const [head] = await rows<{ code: string; name: string; allowance: string | null; needsBill: boolean }>(
    db,
    sql`select code, name, allowance, needs_bill as "needsBill" from field_expense_head where code = ${input.head} and active`,
  );
  if (!head) throw new Refusal(400, "invalid", "Pick the expense head.", "head");
  if (head.allowance) throw new Refusal(400, "invalid", `${head.name} comes with the day worked: claim it on its line.`, "head");
  if (head.needsBill && !file) throw new Refusal(400, "invalid", "Attach the photo of the bill.", "file");
  const kept = file ? await keepFile("expenses", { ...file, name: file.name.trim().slice(0, 120) || "bill" }) : null;
  return db.transaction(async (tx) => {
    const [made] = await rows<{ id: number }>(
      tx,
      sql`insert into field_expense (person_id, seat_id, day, head, amount, note, status, receipt_name, receipt_mime, receipt_size, receipt_data, receipt_key)
        values (${me.id}, ${seatNow(sql`${me.id}`)}, ${input.day}::date, ${head.code}, ${input.amount}, ${clean(input.note) ?? null}, 'pending',
          ${kept?.name ?? null}, ${kept?.mime ?? null}, ${kept?.size ?? null}, ${kept?.data ?? null}, ${kept?.key ?? null})
        returning id::int as id`,
    );
    await tellLead(tx, me, `${head.name} ₱${(input.amount / 100).toLocaleString("en-PH")}`);
    return { id: made?.id as number };
  });
}

/** Claims a line (a day's allowance), or changes one's own claim not approved yet. */
export async function claimExpense(
  db: Database,
  me: Me,
  id: number,
  input: { amount: number; note?: string | null },
  file: IncomingFile | null,
): Promise<void> {
  await mustWork(db, me);
  if (input.amount !== 0) checkAmount(input.amount);
  checkFile(file);
  const kept = file ? await keepFile("expenses", { ...file, name: file.name.trim().slice(0, 120) || "bill" }) : null;
  await db.transaction(async (tx) => {
    const [line] = await rows<{ personId: number; status: string; needsBill: boolean | null; hasFile: boolean; name: string | null; auto: boolean; kind: string | null }>(
      tx,
      sql`select x.person_id::int as "personId", x.status, h.needs_bill as "needsBill", h.name, x.auto, x.kind,
          (x.receipt_data is not null or x.receipt_key is not null) as "hasFile"
        from field_expense x left join field_expense_head h on h.code = x.head where x.id = ${id} for update of x`,
    );
    if (!line || line.personId !== me.id) throw new Refusal(404, "not_found", "No such expense of yours.");
    if (line.status === "approved") throw new Refusal(409, "invalid", "That line is approved: it stays as it is.");
    if (input.amount === 0 && !line.auto) throw new Refusal(400, "invalid", "Type the amount in pesos.", "amount");
    if (line.needsBill && !line.hasFile && !kept) throw new Refusal(400, "invalid", "Attach the photo of the bill.", "file");
    await tx.execute(
      sql`update field_expense set amount = ${input.amount}, note = coalesce(${clean(input.note) ?? null}, note),
          status = ${input.amount === 0 ? "open" : "pending"}, decided_by = null, decided_at = null, decision_note = null,
          approved_amount = null,
          receipt_name = coalesce(${kept?.name ?? null}, receipt_name), receipt_mime = coalesce(${kept?.mime ?? null}, receipt_mime),
          receipt_size = coalesce(${kept?.size ?? null}, receipt_size), receipt_data = coalesce(${kept?.data ?? null}, receipt_data),
          receipt_key = coalesce(${kept?.key ?? null}, receipt_key)
        where id = ${id}`,
    );
    if (input.amount > 0) await tellLead(tx, me, `${line.name ?? KIND_NAMES[line.kind ?? ""] ?? "Expense"} ₱${(input.amount / 100).toLocaleString("en-PH")}`);
  });
}

/** The person's team lead approves a claimed line (the amount may be less) or sends it back with why. */
export async function decideExpense(
  db: Database,
  me: Me,
  id: number,
  input: { approve: boolean; amount?: number | null; note?: string | null },
): Promise<void> {
  const note = clean(input.note) ?? null;
  if (!input.approve && !note) throw new Refusal(400, "invalid", "Say why it is rejected.", "note");
  await db.transaction(async (tx) => {
    const [line] = await rows<{ personId: number; status: string; claimed: number; generated: number }>(
      tx,
      sql`select person_id::int as "personId", status, amount::float8 as claimed, generated::float8 as generated
        from field_expense where id = ${id} for update`,
    );
    if (!line) throw new Refusal(404, "not_found", "No such expense.");
    await mustDecideFor(tx, me, line.personId);
    if (line.status !== "pending") throw new Refusal(409, "invalid", "That line isn't waiting for approval.");
    const amount = input.approve ? (input.amount ?? line.claimed) : null;
    if (amount !== null && (!Number.isInteger(amount) || amount < 0 || amount > Math.max(line.claimed, line.generated)))
      throw new Refusal(400, "invalid", "Approve up to the amount claimed.", "amount");
    await tx.execute(
      sql`update field_expense set status = ${input.approve ? "approved" : "sent_back"}, approved_amount = ${amount}, decided_by = ${me.id},
          decided_at = now(), decision_note = ${note} where id = ${id}`,
    );
    await notify(tx, {
      to: [line.personId],
      kind: "field_expense_decided",
      title: input.approve ? "An expense was approved" : "An expense was sent back",
      body: note,
      link: "/visits/expenses",
      key: `field_expense_decided:${id}:${Date.now()}`,
    });
  });
}

/** Who sets the day's allowance rates: they are the company's, the same for every field person
 *  (docs/PLAN.md question 29 asks Aryan for the amounts), so Management or the Admin. */
export const RATE_ROLES = ["admin", "management"];

/** The day's allowances by work place (centavos). */
export async function setRates(db: Database, me: Me, input: { workType: WorkType; perDiem: number; ta: number }[]): Promise<void> {
  if (me.viewedBy || !RATE_ROLES.includes(me.role))
    throw new Refusal(403, "not_allowed", "The allowance rates are the company's: Management or the Admin set them.");
  for (const one of input) {
    if (!WORK_TYPES.includes(one.workType)) throw new Refusal(400, "invalid", "Pick the work place.", "workType");
    for (const value of [one.perDiem, one.ta])
      if (!Number.isInteger(value) || value < 0 || value > MAX_AMOUNT) throw new Refusal(400, "invalid", "Type each rate in pesos.", "rates");
  }
  await db.transaction(async (tx) => {
    for (const one of input)
      await tx.execute(
        sql`update field_allowance set per_diem = ${one.perDiem}, ta = ${one.ta}, set_by = ${me.id}, set_at = now() where work_type = ${one.workType}`,
      );
  });
}

export async function expenseFile(db: Database, me: Me, id: number) {
  const [file] = await rows<{ name: string; mime: string; data: Uint8Array | null; key: string | null; personId: number }>(
    db,
    sql`select receipt_name as name, receipt_mime as mime, receipt_data as data, receipt_key as key, person_id::int as "personId"
      from field_expense where id = ${id} and receipt_name is not null`,
  );
  if (!file) throw new Refusal(404, "not_found", "No such bill.");
  await mustSee(db, me, file.personId);
  return { name: file.name, mime: file.mime, bytes: await bytesOf(file) };
}

void FIELD_READ_ROLES;
