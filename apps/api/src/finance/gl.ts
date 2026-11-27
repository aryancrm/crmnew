// A guarantee letter's money (Aryan, 26 Nov 2026): "we give the medicine to the patient first, we
// don't make them wait; the agency's money comes much later, months sometimes, and not the whole of
// it; the patient often pays the rest. Who records it, Fhaye or Finance?"
//
// - The order goes Management, Finance, Dispatch as every order, billed to the agency on credit:
//   nothing is paid first, so the medicine goes out (online/service.ts placeOrder).
// - After the delivery the PAP person follows it up: the claim to the agency (she or Finance marks
//   it sent), then what comes in. She marks it, the agency's or the patient's, with its proof;
//   Finance confirms each mark against the bank and only then is it a payment (or refuses it,
//   saying why). Finance may still record a payment itself, and alone lets the rest go (22 Nov).
// - While the agency hasn't paid, its money isn't the patient's debt: it doesn't hold the patient's
//   next order or send their seller to collect (finance/dues.ts, `gl_waiting`).
// - One list for it all: Finance's Guarantee letters (every one), the PAP person's (her own), the
//   CEO's and the Admin's, each by where its money stands, with how long it has waited.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { allow, may, Refusal } from "../http";
import { todayManila } from "../inventory/rules";
import { clean } from "../inventory/service";
import { isPapRep } from "../online/rules";
import { logEvent, peso } from "../orders/events";
import type { GlMark, GlMarkInput, GlMoneyList, GlMoneyRow, GlStage, Me, PaymentMethod } from "../types";
import { FINANCE_ROLES } from "./rules";
import { recordPayment } from "./service";

/** Who sees every guarantee letter's money: Finance, the CEO, the Admin. The PAP person sees hers. */
const GL_READ_ROLES = ["finance", "admin", "ceo"] as const;

const mayReadAll = (me: Me) => may(me, GL_READ_ROLES);

/** Where its money stands. */
export function glStage(row: { status: string; owed: number; claimSentOn: string | null; agencyPaid: number }): GlStage {
  if (row.status !== "completed") return "deliver";
  if (row.owed <= 0) return "done";
  if (row.agencyPaid > 0) return "short";
  return row.claimSentOn ? "agency" : "claim";
}

const daysBetween = (from: string, to: string) =>
  Math.max(0, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000));

type Raw = Omit<GlMoneyRow, "stage" | "waitingDays" | "marks"> & { marks: GlMark[] | null };

/** Every guarantee letter's order the person may see, with its money (one query). */
async function glRows(db: Database, me: Me, orderId?: number): Promise<GlMoneyRow[]> {
  const mine = mayReadAll(me) ? sql`true` : sql`(l.desk = 'pap' and l.assigned_to = ${me.id})`;
  const one = orderId ? sql`and o.id = ${orderId}` : sql``;
  const found = await rows<Raw>(
    db,
    sql`select o.id::int as "orderId", o.code as "orderCode", o.status, c.name as patient, rep.name as seller,
        l.id::int as "leadId", l.code as "caseCode", l.agency, coalesce(l.gl_letter_no, o.gl_number) as "letterNo",
        coalesce(l.gl_amount, o.gl_amount)::float8 as "letterAmount", pap.name as "papBy",
        i.id::int as "invoiceId", i.code as "invoiceCode", coalesce(i.total, o.total)::float8 as total,
        coalesce(i.total - i.paid, o.total)::float8 as owed,
        to_char(o.delivered_at at time zone 'Asia/Manila', 'YYYY-MM-DD') as "deliveredOn",
        to_char(l.claim_sent_on, 'YYYY-MM-DD') as "claimSentOn", l.claim_ref as "claimRef",
        (select coalesce(sum(p.amount), 0) from payment p where p.invoice_id = i.id and p.active and p.payer = 'agency' and p.method <> 'deduction')::float8 as "agencyPaid",
        (select coalesce(sum(p.amount), 0) from payment p where p.invoice_id = i.id and p.active and p.payer <> 'agency' and p.method <> 'deduction')::float8 as "patientPaid",
        (select coalesce(sum(p.amount), 0) from payment p where p.invoice_id = i.id and p.active and p.method = 'deduction' and p.deduction_kind = 'gl_waived')::float8 as "letGo",
        (select json_agg(json_build_object('id', m.id::int, 'payer', m.payer, 'amount', m.amount, 'paidOn', to_char(m.paid_on, 'YYYY-MM-DD'),
            'reference', m.reference, 'note', m.note, 'proofId', m.proof_id::int, 'by', mb.name,
            'at', to_char(m.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'state', m.state, 'reason', m.reason, 'decidedBy', md.name) order by m.id)
          from gl_money_mark m join person mb on mb.id = m.by_person left join person md on md.id = m.decided_by
          where m.order_id = o.id and (m.state = 'waiting' or (m.state = 'refused' and m.decided_at > now() - interval '30 days'))) as marks
      from sales_order o
      join customer c on c.id = o.customer_id
      left join person rep on rep.id = o.medrep_id
      left join lead l on l.id = (select g.id from lead g where g.order_id = o.id and g.road = 'gl' order by g.id desc limit 1)
      left join person pap on pap.id = l.assigned_to
      left join invoice i on i.id = (select v.id from invoice v where v.order_id = o.id and v.status <> 'cancelled' order by v.id desc limit 1)
      where (o.order_type = 'gl' or l.id is not null) and o.status <> 'cancelled' and ${mine} ${one}
      order by o.delivered_at desc nulls first, o.id desc limit 500`,
  );
  const today = todayManila();
  return found.map((row) => {
    const stage = glStage(row);
    const since = row.claimSentOn ?? row.deliveredOn;
    return {
      ...row,
      marks: row.marks ?? [],
      stage,
      waitingDays: (stage === "claim" || stage === "agency") && since ? daysBetween(since, today) : null,
    };
  });
}

/** Finance's Guarantee letters, the PAP person's own, the CEO's and the Admin's. */
export async function glMoneyList(db: Database, me: Me): Promise<GlMoneyList> {
  if (!mayReadAll(me) && !isPapRep(me)) allow(me, GL_READ_ROLES, "see the guarantee letters' money");
  const all = await glRows(db, me);
  const counts: GlMoneyList["counts"] = { confirm: 0, deliver: 0, claim: 0, agency: 0, short: 0, done: 0 };
  for (const row of all) {
    counts[row.stage] += 1;
    if (row.marks.some((mark) => mark.state === "waiting")) counts.confirm += 1;
  }
  return { rows: all, counts, can: { confirm: may(me, FINANCE_ROLES), mark: isPapRep(me) || may(me, ["admin"]) } };
}

/** The guarantee letter's order the PAP person may mark: one of her own cases'. */
async function markable(db: Database, me: Me, orderId: number): Promise<GlMoneyRow> {
  if (!isPapRep(me) && me.role !== "admin")
    throw new Refusal(403, "forbidden", "Only the PAP person marks a guarantee letter's money; Finance records it.");
  const [row] = await glRows(db, me, orderId);
  if (!row) throw new Refusal(404, "not_found", "That isn't one of your guarantee letters.");
  return row;
}

/**
 * The PAP person marks money that came in on a guarantee letter's order: the agency's (often months
 * after the delivery) or the patient's rest, with its proof. It waits for Finance's confirmation.
 */
export async function markGlMoney(db: Database, me: Me, orderId: number, input: GlMarkInput): Promise<number> {
  const row = await markable(db, me, orderId);
  if (!row.invoiceId) throw new Refusal(409, "not_now", "Finance hasn't billed this order yet.");
  if (!(input.amount > 0)) throw new Refusal(400, "invalid", "Type the amount that came in.", "amount");
  if (input.paidOn > todayManila()) throw new Refusal(400, "invalid", "That day hasn't come yet.", "paidOn");
  const waiting = row.marks.filter((mark) => mark.state === "waiting").reduce((sum, mark) => sum + mark.amount, 0);
  if (input.amount > row.owed - waiting)
    throw new Refusal(
      400,
      "invalid",
      `Only ${peso(Math.max(0, row.owed - waiting))} is still owed${waiting ? ` beside the ${peso(waiting)} waiting for Finance` : ""}.`,
      "amount",
    );
  if (input.proofId) {
    const [proof] = await rows<{ id: number }>(
      db,
      sql`select id::int as id from order_file where id = ${input.proofId} and order_id = ${orderId}`,
    );
    if (!proof) throw new Refusal(400, "invalid", "That proof isn't one of this order's papers.", "proofId");
  }
  const [made] = await rows<{ id: number }>(
    db,
    sql`insert into gl_money_mark (order_id, payer, amount, paid_on, reference, note, proof_id, by_person)
      values (${orderId}, ${input.payer}, ${input.amount}, ${input.paidOn}::date, ${clean(input.reference)}, ${clean(input.note)}, ${input.proofId ?? null}, ${me.id})
      returning id::int as id`,
  );
  const who = input.payer === "agency" ? "The agency" : "The patient";
  await logEvent(db, orderId, me, "status", `${who} paid ${peso(input.amount)} on ${input.paidOn} (marked by ${me.name}; waiting for Finance to confirm it).`);
  return made?.id as number;
}

async function waitingMark(db: Database, markId: number) {
  const [mark] = await rows<{ id: number; orderId: number; payer: "agency" | "patient"; amount: number; paidOn: string; reference: string | null; note: string | null; proofId: number | null; state: string; by: string }>(
    db,
    sql`select m.id::int as id, m.order_id::int as "orderId", m.payer, m.amount, to_char(m.paid_on, 'YYYY-MM-DD') as "paidOn",
        m.reference, m.note, m.proof_id::int as "proofId", m.state, p.name as by
      from gl_money_mark m join person p on p.id = m.by_person where m.id = ${markId}`,
  );
  if (!mark) throw new Refusal(404, "not_found", "No such mark.");
  if (mark.state !== "waiting") throw new Refusal(409, "not_now", "Finance has answered this mark already.");
  return mark;
}

/** Finance confirms a mark against the bank: it becomes the payment, the agency's or the patient's. */
export async function confirmGlMark(
  db: Database,
  me: Me,
  markId: number,
  input: { method: PaymentMethod; moneyAccount?: string | null; paidOn?: string | null; reference?: string | null },
): Promise<void> {
  allow(me, FINANCE_ROLES, "confirm a guarantee letter's money");
  const mark = await waitingMark(db, markId);
  const [row] = await glRows(db, me, mark.orderId);
  if (!row?.invoiceId) throw new Refusal(409, "not_now", "This order has no invoice.");
  await recordPayment(db, me, row.invoiceId, {
    amount: mark.amount,
    payer: mark.payer,
    method: input.method,
    moneyAccount: input.moneyAccount ?? null,
    // Finance may put the day and the reference right as the bank shows them.
    reference: clean(input.reference) ?? mark.reference,
    paidOn: input.paidOn ?? mark.paidOn,
    note: `Marked by ${mark.by}${mark.note ? `: ${mark.note}` : ""}`,
    proofId: mark.proofId,
  });
  const [payment] = await rows<{ id: number }>(
    db,
    sql`select id::int as id from payment where invoice_id = ${row.invoiceId} and by_person = ${me.id} and amount = ${mark.amount} order by id desc limit 1`,
  );
  await db.execute(
    sql`update gl_money_mark set state = 'confirmed', decided_by = ${me.id}, decided_at = now(), payment_id = ${payment?.id ?? null} where id = ${markId}`,
  );
}

/** Finance refuses a mark (not in the bank, the wrong amount…), saying why: the PAP person sees it. */
export async function refuseGlMark(db: Database, me: Me, markId: number, reason: string): Promise<void> {
  allow(me, FINANCE_ROLES, "answer a guarantee letter's money");
  const why = reason.trim();
  if (!why) throw new Refusal(400, "invalid", "Say why: the PAP person reads it.", "reason");
  const mark = await waitingMark(db, markId);
  await db.execute(
    sql`update gl_money_mark set state = 'refused', decided_by = ${me.id}, decided_at = now(), reason = ${why.slice(0, 300)} where id = ${markId}`,
  );
  await logEvent(db, mark.orderId, me, "status", `${peso(mark.amount)} marked by ${mark.by} not confirmed: ${why.slice(0, 300)}`);
}
