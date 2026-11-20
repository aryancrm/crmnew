// Expenses in the MR App (SEFMED's Expenses, docs/PLAN.md 22): for each day worked the per diem
// and TA lines are worked out at the rates for the day's work place (the company's rates, set by
// the team lead or the Admin; 0 until set, as in GetMeds' SEFMED); the MR claims them, and adds
// other heads (GetMeds' own list) with the date, amount, a remark and the bill's photo. The team
// lead approves each line (the amount may be less) or rejects it with why. What is worked out,
// claimed and approved stay apart; nothing is approved because it was worked out.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { bytesOf, type IncomingFile, keepFile } from "../files/store";
import { Refusal } from "../http";
import { addDays, todayManila } from "../inventory/rules";
import { clean, type Runner } from "../inventory/service";
import { notify } from "../notify/service";
import type { Me } from "../types";
import { accessOf, isLeadNow, mustLead, mustSee, mustWork } from "./access";
import { type ExpenseMonth, type ExpenseRow, WORK_TYPES, type WorkType } from "./words";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;
const BACK_DAYS = 31;
const FILE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"];
export const EXPENSE_FILE_MAX = 10 * 1024 * 1024;
const MAX_AMOUNT = 100_000_000;

const expenseColumns = sql`x.id::int as id, json_build_object('id', p.id::int, 'name', p.name) as person,
  to_char(x.day, 'YYYY-MM-DD') as day, x.head, h.name as "headName", x.auto, x.generated::float8 as generated,
  x.claimed::float8 as claimed, x.approved::float8 as approved, x.note,
  (x.file_data is not null or x.file_key is not null) as "hasFile", x.status, d.name as "decidedBy", x.decision_note as "decisionNote"`;
const expenseFrom = sql`from mr_expense x join mr_expense_head h on h.code = x.head join person p on p.id = x.person_id
  left join person d on d.id = x.decided_by`;

/** A month of expenses: a member's own; the lead's and the viewers' anyone's or everyone's. */
export async function expenseMonth(
  db: Database,
  me: Me,
  asked: { month?: string | null; person?: string | null },
): Promise<ExpenseMonth> {
  const access = await accessOf(db, me);
  if (!access) throw new Refusal(403, "not_allowed", "The MR App is for its MRs and their team lead.");
  const today = todayManila();
  const month = asked.month && MONTH.test(asked.month) ? asked.month : today.slice(0, 7);
  const everyone = access !== "mr" && (asked.person === "all" || (!asked.person && access === "viewer"));
  const personId = everyone ? null : Number(asked.person) || me.id;
  if (personId !== null) await mustSee(db, me, personId);
  const first = `${month}-01`;
  const [found, heads, people, allowances, person, lead] = await Promise.all([
    rows<ExpenseRow>(
      db,
      sql`select ${expenseColumns} ${expenseFrom}
        where ${personId === null ? sql`x.person_id in (select person_id from mr_member)` : sql`x.person_id = ${personId}`}
          and x.day >= ${first}::date and x.day < (${first}::date + interval '1 month')
        order by x.day desc, h.sort, x.id`,
    ),
    rows<ExpenseMonth["heads"][number]>(
      db,
      sql`select code, name, allowance, needs_bill as "needsBill", active from mr_expense_head order by sort`,
    ),
    access === "mr"
      ? Promise.resolve([] as { id: number; name: string }[])
      : rows<{ id: number; name: string }>(
          db,
          sql`select p.id::int as id, p.name from mr_member m join person p on p.id = m.person_id where m.active order by p.name`,
        ),
    rows<ExpenseMonth["allowances"][number]>(
      db,
      sql`select work_type as "workType", per_diem::float8 as "perDiem", ta::float8 as ta from mr_allowance order by work_type`,
    ),
    personId === null
      ? Promise.resolve([] as { id: number; name: string }[])
      : rows<{ id: number; name: string }>(db, sql`select id::int as id, name from person where id = ${personId}`),
    isLeadNow(db, me),
  ]);
  const sum = (pick: (one: ExpenseRow) => number) => found.reduce((total, one) => total + pick(one), 0);
  return {
    month,
    today,
    person: person[0] ?? null,
    heads,
    rows: found,
    totals: {
      generated: sum((one) => one.generated),
      claimed: sum((one) => (one.status === "open" ? 0 : one.claimed)),
      approved: sum((one) => (one.status === "approved" ? (one.approved ?? 0) : 0)),
      waiting: sum((one) => (one.status === "claimed" ? one.claimed : 0)),
    },
    people,
    allowances: WORK_TYPES.map((workType) => allowances.find((one) => one.workType === workType) ?? { workType, perDiem: 0, ta: 0 }),
    can: {
      add: personId === me.id && (access === "mr" || access === "lead") && !me.viewedBy,
      decide: lead,
      setRates: lead,
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
  const [lead] = await rows<{ id: number }>(tx, sql`select person_id::int as id from mr_member where role = 'lead' and active`);
  if (lead && lead.id !== me.id)
    await notify(tx, {
      to: [lead.id],
      kind: "mr_expense",
      title: "An expense to approve",
      body: `${me.name} · ${what}`,
      link: `/mr/expenses?person=${me.id}`,
      key: `mr_expense:${me.id}:${Date.now()}`,
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
    sql`select code, name, allowance, needs_bill as "needsBill" from mr_expense_head where code = ${input.head} and active`,
  );
  if (!head) throw new Refusal(400, "invalid", "Pick the expense head.", "head");
  if (head.allowance) throw new Refusal(400, "invalid", `${head.name} comes with the day worked: claim it on its line.`, "head");
  if (head.needsBill && !file) throw new Refusal(400, "invalid", "Attach the photo of the bill.", "file");
  const kept = file ? await keepFile("mr-expenses", { ...file, name: file.name.trim().slice(0, 120) || "bill" }) : null;
  return db.transaction(async (tx) => {
    const [made] = await rows<{ id: number }>(
      tx,
      sql`insert into mr_expense (person_id, day, head, claimed, note, status, file_name, file_mime, file_size, file_data, file_key)
        values (${me.id}, ${input.day}::date, ${head.code}, ${input.amount}, ${clean(input.note) ?? null}, 'claimed',
          ${kept?.name ?? null}, ${kept?.mime ?? null}, ${kept?.size ?? null}, ${kept?.data ?? null}, ${kept?.key ?? null})
        returning id::int as id`,
    );
    await tellLead(tx, me, `${head.name} ₱${(input.amount / 100).toLocaleString("en-PH")}`);
    return { id: made?.id as number };
  });
}

/** Claims a line (a day's allowance, or changes one's own claim not yet approved). */
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
  const kept = file ? await keepFile("mr-expenses", { ...file, name: file.name.trim().slice(0, 120) || "bill" }) : null;
  await db.transaction(async (tx) => {
    const [line] = await rows<{ personId: number; status: string; needsBill: boolean; hasFile: boolean; name: string; auto: boolean }>(
      tx,
      sql`select x.person_id::int as "personId", x.status, h.needs_bill as "needsBill", h.name, x.auto,
          (x.file_data is not null or x.file_key is not null) as "hasFile"
        from mr_expense x join mr_expense_head h on h.code = x.head where x.id = ${id} for update of x`,
    );
    if (!line || line.personId !== me.id) throw new Refusal(404, "not_found", "No such expense of yours.");
    if (line.status === "approved") throw new Refusal(409, "invalid", "That line is approved: it stays as it is.");
    if (input.amount === 0 && !line.auto) throw new Refusal(400, "invalid", "Type the amount in pesos.", "amount");
    if (line.needsBill && !line.hasFile && !kept) throw new Refusal(400, "invalid", "Attach the photo of the bill.", "file");
    await tx.execute(
      sql`update mr_expense set claimed = ${input.amount}, note = ${clean(input.note) ?? null},
          status = ${input.amount === 0 ? "open" : "claimed"}, decided_by = null, decided_at = null, decision_note = null,
          file_name = coalesce(${kept?.name ?? null}, file_name), file_mime = coalesce(${kept?.mime ?? null}, file_mime),
          file_size = coalesce(${kept?.size ?? null}, file_size), file_data = coalesce(${kept?.data ?? null}, file_data),
          file_key = coalesce(${kept?.key ?? null}, file_key)
        where id = ${id}`,
    );
    if (input.amount > 0) await tellLead(tx, me, `${line.name} ₱${(input.amount / 100).toLocaleString("en-PH")}`);
  });
}

/** The team lead approves a claimed line (the amount may be less) or rejects it with why. */
export async function decideExpense(
  db: Database,
  me: Me,
  id: number,
  input: { approve: boolean; amount?: number | null; note?: string | null },
): Promise<void> {
  await mustLead(db, me);
  const note = clean(input.note) ?? null;
  if (!input.approve && !note) throw new Refusal(400, "invalid", "Say why it is rejected.", "note");
  await db.transaction(async (tx) => {
    const [line] = await rows<{ personId: number; status: string; claimed: number; generated: number }>(
      tx,
      sql`select person_id::int as "personId", status, claimed::float8 as claimed, generated::float8 as generated
        from mr_expense where id = ${id} for update`,
    );
    if (!line) throw new Refusal(404, "not_found", "No such expense.");
    if (line.personId === me.id) throw new Refusal(403, "not_allowed", "Your own expenses are approved by someone else.");
    if (line.status !== "claimed") throw new Refusal(409, "invalid", "That line isn't waiting for approval.");
    const amount = input.approve ? (input.amount ?? line.claimed) : null;
    if (amount !== null && (!Number.isInteger(amount) || amount < 0 || amount > Math.max(line.claimed, line.generated)))
      throw new Refusal(400, "invalid", "Approve up to the amount claimed.", "amount");
    await tx.execute(
      sql`update mr_expense set status = ${input.approve ? "approved" : "rejected"}, approved = ${amount}, decided_by = ${me.id},
          decided_at = now(), decision_note = ${note} where id = ${id}`,
    );
    await notify(tx, {
      to: [line.personId],
      kind: "mr_expense_decided",
      title: input.approve ? "An expense was approved" : "An expense was rejected",
      body: note,
      link: "/mr/expenses",
      key: `mr_expense_decided:${id}:${Date.now()}`,
    });
  });
}

/** The day's allowances by work place (pesos in, centavos kept), set by the lead or the Admin. */
export async function setRates(
  db: Database,
  me: Me,
  input: { workType: WorkType; perDiem: number; ta: number }[],
): Promise<void> {
  await mustLead(db, me);
  for (const one of input) {
    if (!WORK_TYPES.includes(one.workType)) throw new Refusal(400, "invalid", "Pick the work place.", "workType");
    for (const value of [one.perDiem, one.ta])
      if (!Number.isInteger(value) || value < 0 || value > MAX_AMOUNT)
        throw new Refusal(400, "invalid", "Type each rate in pesos.", "rates");
  }
  await db.transaction(async (tx) => {
    for (const one of input)
      await tx.execute(
        sql`update mr_allowance set per_diem = ${one.perDiem}, ta = ${one.ta}, set_by = ${me.id}, set_at = now() where work_type = ${one.workType}`,
      );
  });
}

export async function expenseFile(db: Database, me: Me, id: number) {
  const [file] = await rows<{ name: string; mime: string; data: Uint8Array | null; key: string | null; personId: number }>(
    db,
    sql`select file_name as name, file_mime as mime, file_data as data, file_key as key, person_id::int as "personId"
      from mr_expense where id = ${id} and file_name is not null`,
  );
  if (!file) throw new Refusal(404, "not_found", "No such bill.");
  await mustSee(db, me, file.personId);
  return { name: file.name, mime: file.mime, bytes: await bytesOf(file) };
}
