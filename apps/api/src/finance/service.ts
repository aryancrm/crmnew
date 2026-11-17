// Finance's work: letting an order on once its money is checked (advance) or its invoice is made
// (credit, cash on delivery), recording the money that comes in, giving back money for a
// cancelled order, and the lists: invoices, payments received, customers owe, refunds owed.
// Every change is one transaction that also writes the order's timeline.

import { keepFile } from "../files/store";
import { duesSql } from "./dues";
import { type SQL, sql } from "drizzle-orm";
import { customerDetail } from "../customers/service";
import { type Database, rows } from "../db/index";
import { allow, Refusal } from "../http";
import { todayManila } from "../inventory/rules";
import { clean, day, iso, type Runner } from "../inventory/service";
import { SOURCE_LABEL } from "../online/rules";
import { logEvent, peso } from "../orders/events";
import {
  CASE_AGENT_ROLES,
  INVOICE_FROM_LABEL,
  orderActions,
  PAPER_LABEL,
  STATUS_LABEL,
} from "../orders/rules";
import { mayReadOrder, withCity } from "../orders/service";
import { POINT_CENTAVOS, settleOrderPoints } from "../points/service";
import { companyInfo } from "../settings/service";
import type {
  ConfirmPaymentInput,
  InvoiceDetail,
  InvoiceFrom,
  InvoiceList,
  InvoiceRow,
  InvoiceTab,
  LeadSource,
  Me,
  MyConfirmations,
  OrderPaper,
  OrderStatus,
  OwedInvoices,
  OwedList,
  OwedRow,
  PaymentInput,
  PaymentList,
  PaymentRow,
  PaymentTerms,
  RefundInput,
  RefundList,
  RefundOwed,
  RefundRow,
  Statement,
  Vat,
} from "../types";
import {
  AGE_BUCKETS,
  daysBetween,
  dueOn,
  FINANCE_READ_ROLES,
  FINANCE_ROLES,
  invoiceCode,
  invoiceState,
  METHOD_LABEL,
  METHODS,
  vatSplit,
} from "./rules";

const PAGE = 25;
const ids = (values: number[]) =>
  sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  );

// ---------------------------------------------------------------- shared reads

type InvoiceSql = Omit<InvoiceRow, "invoiceFromLabel" | "balance" | "state"> & {
  delivered: boolean;
};

/** An invoice (alias `i`) with its order (`o`) and customer (`c`). */
const invoiceColumns = sql`i.id::int as id, i.code, i.order_id::int as "orderId", o.code as "orderCode",
  i.customer_id::int as "customerId", c.name as customer, c.kind as "customerKind", i.invoice_from as "invoiceFrom",
  i.terms, ${day("i.issued_on")} as "issuedOn", ${day("i.due_on")} as "dueOn", i.total::int as total,
  i.paid::int as paid, i.refunded::int as refunded, i.status, (o.status = 'completed') as delivered`;
const invoiceFrom = sql`from invoice i join sales_order o on o.id = i.order_id join customer c on c.id = i.customer_id`;

/** Unpaid and past its due day; cash on delivery is never late before the goods arrive. */
const overdue = (today: string): SQL =>
  sql`(i.status = 'open' and i.due_on < ${today}::date and not (i.terms in ('cod', 'days') and o.status <> 'completed'))`;

const shown = (row: InvoiceSql, today: string): InvoiceRow => {
  const { delivered, ...rest } = row;
  return {
    ...rest,
    invoiceFromLabel: INVOICE_FROM_LABEL[row.invoiceFrom],
    balance: row.status === "cancelled" ? 0 : row.total - row.paid,
    state: invoiceState({ ...row, delivered }, today),
  };
};

const paymentColumns = sql`p.id::int as id, p.invoice_id::int as "invoiceId", i.code as "invoiceCode",
  i.order_id::int as "orderId", o.code as "orderCode", p.customer_id::int as "customerId", c.name as customer,
  p.amount::int as amount, p.method, p.reference, ${day("p.paid_on")} as "paidOn", p.note, p.proof_id::int as "proofId",
  who.name as by, ${iso("p.at")} as at, p.active, p.removed_reason as "removedReason"`;
const paymentFrom = sql`from payment p join invoice i on i.id = p.invoice_id join sales_order o on o.id = i.order_id
  join customer c on c.id = p.customer_id join person who on who.id = p.by_person`;
const withMethod = <T extends { method: PaymentRow["method"] }>(row: T) => ({
  ...row,
  methodLabel: METHOD_LABEL[row.method],
});

const refundColumns = sql`r.id::int as id, r.invoice_id::int as "invoiceId", r.amount::int as amount, r.method, r.reference,
  ${day("r.refunded_on")} as "refundedOn", r.note, who.name as by, ${iso("r.at")} as at`;

/** What some customers owe on open invoices: in all, overdue, and the oldest's days late. */
export async function moneyOf(
  db: Runner,
  customerIds: number[],
): Promise<Map<number, { owed: number; overdue: number; days: number }>> {
  if (customerIds.length === 0) return new Map();
  const today = todayManila();
  const found = await rows<{ customerId: number; owed: number; overdue: number; days: number }>(
    db,
    // Owed: everything but cash on delivery not delivered yet; late: past its due day (credit
    // counts from delivery). Zoho's invoices and opening balances with this CRM's.
    sql`select dd.customer_id::int as "customerId",
        coalesce(sum(dd.balance) filter (where not dd.cod_waiting), 0)::float8 as owed,
        coalesce(sum(dd.balance) filter (where not dd.on_delivery and dd.late > 0), 0)::float8 as overdue,
        coalesce(max(dd.late) filter (where not dd.on_delivery and dd.late > 0), 0)::int as days
      from ${duesSql(today)} dd where dd.customer_id in (${ids([...new Set(customerIds)])})
      group by dd.customer_id
      having coalesce(sum(dd.balance) filter (where not dd.cod_waiting), 0) > 0`,
  );
  return new Map(found.map(({ customerId, ...money }) => [customerId, money]));
}

/** An order's invoice, the money received against it and any given back: for the order page. */
export async function orderMoney(
  db: Runner,
  orderId: number,
): Promise<{ invoice: InvoiceRow | null; payments: PaymentRow[]; refunds: RefundRow[] }> {
  const today = todayManila();
  const [invoice] = await rows<InvoiceSql>(
    db,
    sql`select ${invoiceColumns} ${invoiceFrom} where i.order_id = ${orderId}`,
  );
  if (!invoice) return { invoice: null, payments: [], refunds: [] };
  const [payments, refunds] = await Promise.all([
    rows<Omit<PaymentRow, "methodLabel">>(
      db,
      sql`select ${paymentColumns} ${paymentFrom} where p.invoice_id = ${invoice.id} order by p.paid_on, p.id`,
    ),
    rows<Omit<RefundRow, "methodLabel">>(
      db,
      sql`select ${refundColumns} from refund r join person who on who.id = r.by_person where r.invoice_id = ${invoice.id} order by r.at, r.id`,
    ),
  ]);
  return {
    invoice: shown(invoice, today),
    payments: payments.map(withMethod),
    refunds: refunds.map(withMethod),
  };
}

/** Finance's counts for the menu: payments to confirm, orders to invoice, refunds owed. */
export async function financeCounts(
  db: Runner,
  me: Me,
): Promise<{ toConfirm: number; toInvoice: number; refunds: number }> {
  if (!FINANCE_READ_ROLES.includes(me.role)) return { toConfirm: 0, toInvoice: 0, refunds: 0 };
  const [counted] = await rows<{ toConfirm: number; toInvoice: number; refunds: number }>(
    db,
    sql`select (select count(*) from sales_order where status = 'finance_check')::int as "toConfirm",
        (select count(*) from sales_order where status = 'ready_for_invoice')::int as "toInvoice",
        (select count(*) from invoice i where i.status = 'cancelled' and i.paid - (select coalesce(sum(pp.amount), 0) from payment pp where pp.invoice_id = i.id and pp.active and pp.method = 'points') > i.refunded)::int as refunds`,
  );
  return counted ?? { toConfirm: 0, toInvoice: 0, refunds: 0 };
}

// ---------------------------------------------------------------- the order's step

type LockedOrder = {
  id: number;
  code: string;
  status: OrderStatus;
  raisedBy: number;
  medrepId: number;
  heldFrom: OrderStatus | null;
  terms: PaymentTerms;
  days: number | null;
  total: number;
  customerId: number;
  invoiceFrom: InvoiceFrom;
  expectedOn: string | null;
};

async function lockOrder(tx: Runner, id: number): Promise<LockedOrder> {
  const [order] = await rows<LockedOrder>(
    tx,
    sql`select id::int as id, code, status, raised_by::int as "raisedBy", medrep_id::int as "medrepId", held_from as "heldFrom",
        payment_terms as terms, payment_days::int as days, total::int as total, customer_id::int as "customerId",
        invoice_from as "invoiceFrom", ${day("expected_on")} as "expectedOn"
      from sales_order where id = ${id} for update`,
  );
  if (!order) throw new Refusal(404, "not_found", "That order doesn't exist.");
  return order;
}

const notNow = (order: LockedOrder) =>
  new Refusal(
    409,
    "not_now",
    `${order.code} is ${STATUS_LABEL[order.status]} now, so that can't be done. Reload it.`,
  );

function payable(input: { amount: number; paidOn: string }, field = "paidOn") {
  if (!Number.isInteger(input.amount) || input.amount <= 0)
    throw new Refusal(400, "invalid", "Type the amount received.", "amount");
  if (input.paidOn > todayManila())
    throw new Refusal(400, "invalid", "That day hasn't come yet.", field);
}

/** Makes the order's invoice under its company, numbered in that company's own series. */
async function issueInvoice(
  tx: Runner,
  me: Me,
  order: LockedOrder,
  today: string,
): Promise<{ id: number; code: string }> {
  const lines = await rows<{ amount: number; vat: Vat }>(
    tx,
    // A senior's or PWD's line is sold VAT-exempt (the law), whatever the medicine's own VAT.
    sql`select (i.qty * i.unit_price)::int as amount, case when i.relief then 'exempt' else m.vat end as vat
      from order_item i join medicine m on m.id = i.medicine_id where i.order_id = ${order.id}`,
  );
  // Delivery is a service the company sells: VAT-able, on the same invoice.
  const [fee] = await rows<{ fee: number }>(
    tx,
    sql`select delivery_fee::int as fee from sales_order where id = ${order.id}`,
  );
  if (fee?.fee) lines.push({ amount: fee.fee, vat: "vat12" });
  const split = vatSplit(lines);
  const [next] = await rows<{ value: number }>(
    tx,
    sql`update counter set value = value + 1 where name = ${`invoice:${order.invoiceFrom}`} returning value::int as value`,
  );
  const code = invoiceCode(order.invoiceFrom, next?.value ?? 1);
  const due = dueOn(order.terms, order.days, today, order.expectedOn);
  const [made] = await rows<{ id: number }>(
    tx,
    sql`insert into invoice (code, order_id, customer_id, invoice_from, terms, issued_on, due_on, total, vatable, vat, exempt, zero_rated, by_person)
      values (${code}, ${order.id}, ${order.customerId}, ${order.invoiceFrom}, ${order.terms}, ${today}::date, ${due}::date, ${order.total},
        ${split.vatable}, ${split.vat}, ${split.exempt}, ${split.zeroRated}, ${me.id})
      returning id::int as id`,
  );
  const when =
    order.terms === "days"
      ? `due on ${dated(due)}`
      : order.terms === "cod"
        ? "collected on delivery"
        : "paid in advance";
  await logEvent(
    tx,
    order.id,
    me,
    "invoice",
    `Invoice ${code} made under ${INVOICE_FROM_LABEL[order.invoiceFrom]}: ${peso(order.total)}, ${when}.`,
    "invoiced",
  );
  // The points the customer used are paid on it at once.
  const [used] = await rows<{ points: number }>(
    tx,
    sql`select points_used::int as points from sales_order where id = ${order.id}`,
  );
  if (used?.points) {
    await addPayment(
      tx,
      me,
      { id: made?.id as number, customerId: order.customerId },
      {
        amount: used.points * POINT_CENTAVOS,
        method: "points",
        reference: `${used.points.toLocaleString("en-PH")} points`,
        paidOn: today,
      },
    );
    await logEvent(
      tx,
      order.id,
      me,
      "payment",
      `${used.points.toLocaleString("en-PH")} points (${peso(used.points * POINT_CENTAVOS)}) paid on ${code}.`,
    );
  }
  return { id: made?.id as number, code };
}

async function addPayment(
  tx: Runner,
  me: Me,
  invoice: { id: number; customerId: number },
  input: {
    amount: number;
    method: string;
    reference?: string | null;
    paidOn: string;
    note?: string | null;
    proofId?: number | null;
  },
) {
  // On a guarantee letter's order the money is the agency's (a patient's top-up is told apart later).
  const [road] = await rows<{ gl: boolean }>(
    tx,
    sql`select coalesce(l.road = 'gl', false) as gl from invoice i join sales_order o on o.id = i.order_id left join lead l on l.id = o.lead_id where i.id = ${invoice.id}`,
  );
  const payer = input.method !== "points" && road?.gl ? "agency" : "customer";
  await tx.execute(
    sql`insert into payment (invoice_id, customer_id, amount, method, reference, paid_on, proof_id, note, by_person, payer)
      values (${invoice.id}, ${invoice.customerId}, ${input.amount}, ${input.method}, ${clean(input.reference)}, ${input.paidOn}::date,
        ${input.proofId ?? null}, ${clean(input.note)}, ${me.id}, ${payer})`,
  );
  const [after] = await rows<{ paid: number; total: number }>(
    tx,
    sql`update invoice set paid = paid + ${input.amount}, status = case when paid + ${input.amount} >= total then 'paid' else 'open' end
      where id = ${invoice.id} returning paid::int as paid, total::int as total`,
  );
  return { left: (after?.total ?? 0) - (after?.paid ?? 0) };
}

/** A day as people write it: "Nov 15, 2026". */
const dated = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

const how = (input: {
  amount: number;
  method: keyof typeof METHOD_LABEL;
  reference?: string | null;
  paidOn: string;
}) =>
  `${peso(input.amount)} by ${METHOD_LABEL[input.method].toLowerCase()}${clean(input.reference) ? ` (ref ${clean(input.reference)})` : ""} on ${dated(input.paidOn)}`;

/** An advance order: Finance has checked the slip and seen the money, so it records the payment,
 *  makes the invoice and lets the order go to Dispatch, all at once. */
export async function confirmPayment(
  db: Database,
  me: Me,
  orderId: number,
  input: ConfirmPaymentInput,
): Promise<{ invoiceId: number }> {
  allow(me, FINANCE_ROLES, "confirm a payment");
  if (!input.checked)
    throw new Refusal(
      400,
      "invalid",
      "Tick that you checked the proof and the money is in our account.",
      "checked",
    );
  payable(input);
  const today = todayManila();
  return db.transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (!orderActions(me, order).confirm_payment) throw notNow(order);
    const [used] = await rows<{ points: number }>(
      tx,
      sql`select points_used::int as points from sales_order where id = ${orderId}`,
    );
    const due = order.total - (used?.points ?? 0) * POINT_CENTAVOS;
    if (input.amount > due)
      throw new Refusal(
        400,
        "invalid",
        `That is more than the ${peso(due)} the customer pays.`,
        "amount",
      );
    const [proof] = await rows<{ id: number }>(
      tx,
      sql`select id::int as id from order_file where order_id = ${orderId} and active and kind = 'payment_proof' order by at desc, id desc limit 1`,
    );
    if (!proof && !clean(input.reference))
      throw new Refusal(
        400,
        "invalid",
        "There is no proof of payment on the order. Add the slip, or type the bank reference you checked.",
        "reference",
      );
    await tx.execute(
      sql`update sales_order set status = 'ready_for_dispatch', finance_checked_at = now(), finance_checked_by = ${me.id},
          held_from = null, held_role = null, flag_reason = null, updated_at = now() where id = ${orderId}`,
    );
    const left = due - input.amount;
    await logEvent(
      tx,
      orderId,
      me,
      "status",
      `Payment checked: ${how(input)}${proof ? ", proof of payment on file" : ""}.${left > 0 ? ` ${peso(left)} still to pay.` : ""} It goes to Dispatch.${clean(input.note) ? ` ${clean(input.note)}` : ""}`,
      "finance_verified",
    );
    // A check undone left its invoice: the same one takes the payment again.
    const [kept] = await rows<{ id: number; code: string }>(
      tx,
      sql`select id::int as id, code from invoice where order_id = ${orderId} and status <> 'cancelled'`,
    );
    const invoice = kept ?? (await issueInvoice(tx, me, order, today));
    await addPayment(
      tx,
      me,
      { id: invoice.id, customerId: order.customerId },
      { ...input, proofId: proof?.id ?? null },
    );
    if (left === 0)
      await logEvent(tx, orderId, me, "payment", `Paid in full (invoice ${invoice.code}).`, "paid");
    return { invoiceId: invoice.id };
  });
}

/** The order's invoice as Management approves it (Aryan, 17 Nov: the invoice is made when
 *  Management approves): the one it has already, or a new one in its company's series. */
export async function invoiceOnApproval(
  tx: Runner,
  me: Me,
  orderId: number,
): Promise<{ id: number; code: string }> {
  const [kept] = await rows<{ id: number; code: string }>(
    tx,
    sql`select id::int as id, code from invoice where order_id = ${orderId} and status <> 'cancelled'`,
  );
  if (kept) return kept;
  const order = await lockOrder(tx, orderId);
  return issueInvoice(tx, me, order, todayManila());
}

/** An unpaid invoice follows the order's details changed before Finance's check: its terms and
 *  due day, and its company (with a number in that company's series) when that changed. */
export async function refreshInvoice(tx: Runner, me: Me, orderId: number): Promise<void> {
  const order = await lockOrder(tx, orderId);
  const [invoice] = await rows<{ id: number; code: string; invoiceFrom: string; issuedOn: string; dueOn: string; terms: string }>(
    tx,
    sql`select id::int as id, code, invoice_from as "invoiceFrom", ${day("issued_on")} as "issuedOn", ${day("due_on")} as "dueOn", terms
      from invoice where order_id = ${orderId} and status <> 'cancelled' for update`,
  );
  if (!invoice) return;
  const due = dueOn(order.terms, order.days, invoice.issuedOn, order.expectedOn);
  let code = invoice.code;
  if (invoice.invoiceFrom !== order.invoiceFrom) {
    const [next] = await rows<{ value: number }>(
      tx,
      sql`update counter set value = value + 1 where name = ${`invoice:${order.invoiceFrom}`} returning value::int as value`,
    );
    code = invoiceCode(order.invoiceFrom, next?.value ?? 1);
  }
  if (code === invoice.code && due === invoice.dueOn && order.terms === invoice.terms) return;
  await tx.execute(
    sql`update invoice set code = ${code}, invoice_from = ${order.invoiceFrom}, terms = ${order.terms}, due_on = ${due}::date where id = ${invoice.id}`,
  );
  await logEvent(
    tx,
    orderId,
    me,
    "invoice",
    `Invoice ${invoice.code}${code !== invoice.code ? ` is now ${code} under ${INVOICE_FROM_LABEL[order.invoiceFrom]}` : ""} follows the new details: ${order.terms === "days" ? `due on ${dated(due)}` : order.terms === "cod" ? "collected on delivery" : "paid in advance"}.`,
  );
}

/** A credit or cash-on-delivery order: Finance looks at what the customer owes and lets the
 *  order go to Dispatch with the invoice Management's approval made. The money comes later. */
export async function makeInvoice(
  db: Database,
  me: Me,
  orderId: number,
  input: { note?: string | null },
): Promise<{ invoiceId: number }> {
  allow(me, FINANCE_ROLES, "make an invoice");
  const today = todayManila();
  return db.transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (!orderActions(me, order).make_invoice) throw notNow(order);
    await tx.execute(
      sql`update sales_order set status = 'ready_for_dispatch', finance_checked_at = now(), finance_checked_by = ${me.id},
          held_from = null, held_role = null, flag_reason = null, updated_at = now() where id = ${orderId}`,
    );
    const pays =
      order.terms === "days" ? `pays ${order.days} days after the invoice` : "pays on delivery";
    await logEvent(
      tx,
      orderId,
      me,
      "status",
      `Checked by Finance: the customer ${pays}. It goes to Dispatch.${clean(input.note) ? ` ${clean(input.note)}` : ""}`,
      "finance_verified",
    );
    // Made when Management approved; an order approved before that rule gets it now.
    const [kept] = await rows<{ id: number; code: string }>(
      tx,
      sql`select id::int as id, code from invoice where order_id = ${orderId} and status <> 'cancelled'`,
    );
    const invoice = kept ?? (await issueInvoice(tx, me, order, today));
    return { invoiceId: invoice.id };
  });
}

/**
 * An Online case's order needs no check, or Management has passed it: it gets its invoice and
 * goes to Dispatch. Finance doesn't stop it: the case's agent records the money received (in
 * advance, or after the delivery) and Finance sees every payment and its proof.
 */
export async function clearCaseOrder(
  tx: Runner,
  me: Me,
  orderId: number,
  cleared?: string,
): Promise<{ invoiceId: number }> {
  const order = await lockOrder(tx, orderId);
  const today = todayManila();
  const [place] = await rows<{ id: number }>(
    tx,
    sql`select id::int as id from warehouse where active order by is_default desc, id limit 1`,
  );
  await tx.execute(
    sql`update sales_order set status = 'ready_for_dispatch', warehouse_id = coalesce(warehouse_id, ${place?.id ?? null}),
        approved_at = coalesce(approved_at, now()), held_from = null, held_role = null, flag_reason = null, updated_at = now()
      where id = ${orderId}`,
  );
  // Nothing to check: say so on the timeline, in the place Management's approval would be.
  if (cleared) await logEvent(tx, orderId, me, "status", cleared, "approved");
  const [kept] = await rows<{ id: number; code: string }>(
    tx,
    sql`select id::int as id, code from invoice where order_id = ${orderId} and status <> 'cancelled'`,
  );
  const invoice = kept ?? (await issueInvoice(tx, me, order, today));
  return { invoiceId: invoice.id };
}

/** When an order is cancelled its invoice is too; money already received is owed back. */
export async function cancelInvoiceOf(
  tx: Runner,
  me: Me,
  orderId: number,
  reason: string | null,
): Promise<void> {
  const [invoice] = await rows<{
    id: number;
    code: string;
    paid: number;
    refunded: number;
    status: string;
  }>(
    tx,
    sql`select id::int as id, code, paid::int as paid, refunded::int as refunded, status from invoice where order_id = ${orderId} for update`,
  );
  if (!invoice || invoice.status === "cancelled") return;
  await tx.execute(
    sql`update invoice set status = 'cancelled', cancelled_reason = ${reason}, cancelled_at = now() where id = ${invoice.id}`,
  );
  // Points paid on it go back to the customer's points, not as money.
  const owed = invoice.paid - invoice.refunded - (await pointsPaid(tx, invoice.id));
  await logEvent(
    tx,
    orderId,
    me,
    "invoice",
    `Invoice ${invoice.code} cancelled.${owed > 0 ? ` ${peso(owed)} was received for it: Finance gives it back (Refunds owed).` : ""}`,
  );
}

// ---------------------------------------------------------------- money after the invoice

async function lockInvoice(tx: Runner, id: number) {
  const [invoice] = await rows<{
    id: number;
    code: string;
    orderId: number;
    customerId: number;
    total: number;
    paid: number;
    refunded: number;
    status: "open" | "paid" | "cancelled";
  }>(
    tx,
    sql`select id::int as id, code, order_id::int as "orderId", customer_id::int as "customerId", total::int as total,
        paid::int as paid, refunded::int as refunded, status from invoice where id = ${id} for update`,
  );
  if (!invoice) throw new Refusal(404, "not_found", "That invoice doesn't exist.");
  return invoice;
}

/** Money received against an invoice: a credit customer paying, or the rest of an advance. */
export async function recordPayment(
  db: Database,
  me: Me,
  invoiceId: number,
  input: PaymentInput,
): Promise<void> {
  // An Online case's agent records the money for the case's own order; Finance for any.
  if (!FINANCE_ROLES.includes(me.role)) {
    const [own] = await rows<{ leadId: number | null }>(
      db,
      sql`select o.lead_id::int as "leadId" from invoice i join sales_order o on o.id = i.order_id where i.id = ${invoiceId}`,
    );
    if (!own?.leadId || !CASE_AGENT_ROLES.includes(me.role))
      allow(me, FINANCE_ROLES, "record a payment");
  }
  payable(input);
  await db.transaction(async (tx) => {
    const invoice = await lockInvoice(tx, invoiceId);
    if (invoice.status === "cancelled")
      throw new Refusal(
        409,
        "not_now",
        `Invoice ${invoice.code} was cancelled, so nothing is owed on it.`,
      );
    const owed = invoice.total - invoice.paid;
    if (owed <= 0)
      throw new Refusal(409, "not_now", `Invoice ${invoice.code} is already paid in full.`);
    const [cod] = await rows<{ waiting: boolean }>(
      tx,
      sql`select (i.terms = 'cod' and o.status <> 'completed') as waiting
        from invoice i join sales_order o on o.id = i.order_id where i.id = ${invoice.id}`,
    );
    if (cod?.waiting)
      throw new Refusal(
        409,
        "not_now",
        `${invoice.code} is cash on delivery: record the money once the goods are delivered.`,
      );
    if (input.amount > owed)
      throw new Refusal(
        400,
        "invalid",
        `That is more than the ${peso(owed)} still owed on ${invoice.code}.`,
        "amount",
      );
    if (input.proofId) {
      const [proof] = await rows<{ id: number }>(
        tx,
        sql`select id::int as id from order_file where id = ${input.proofId} and order_id = ${invoice.orderId} and kind = 'payment_proof' and active`,
      );
      if (!proof)
        throw new Refusal(400, "invalid", "That proof of payment isn't on this order.", "proofId");
    }
    const { left } = await addPayment(tx, me, invoice, input);
    await logEvent(
      tx,
      invoice.orderId,
      me,
      "payment",
      left > 0
        ? `${how(input)} received for ${invoice.code}. ${peso(left)} still owed.`
        : `${how(input)} received for ${invoice.code}. Paid in full.`,
      left > 0 ? null : "paid",
    );
    if (left === 0) {
      const [order] = await rows<{ status: string }>(
        tx,
        sql`select status from sales_order where id = ${invoice.orderId}`,
      );
      if (order?.status === "completed")
        await logEvent(
          tx,
          invoice.orderId,
          me,
          "status",
          "Completed: delivered and paid.",
          "completed",
        );
    }
    await settleOrderPoints(tx, invoice.orderId);
  });
}

/** What was paid on an invoice with points (given back as points, never as money). */
async function pointsPaid(tx: Runner, invoiceId: number): Promise<number> {
  const [found] = await rows<{ amount: number }>(
    tx,
    sql`select coalesce(sum(amount), 0)::int as amount from payment where invoice_id = ${invoiceId} and active and method = 'points'`,
  );
  return found?.amount ?? 0;
}

/** A payment recorded by mistake is taken off, with why. It stays in the history. */
export async function removePayment(
  db: Database,
  me: Me,
  paymentId: number,
  reason: string | null,
): Promise<void> {
  allow(me, FINANCE_ROLES, "take off a payment");
  const why = clean(reason);
  if (!why) throw new Refusal(400, "invalid", "Say why it is taken off.", "reason");
  await db.transaction(async (tx) => {
    const [payment] = await rows<{
      invoiceId: number;
      amount: number;
      method: keyof typeof METHOD_LABEL;
      paidOn: string;
      active: boolean;
    }>(
      tx,
      sql`select invoice_id::int as "invoiceId", amount::int as amount, method, ${day("paid_on")} as "paidOn", active from payment where id = ${paymentId} for update`,
    );
    if (!payment?.active) throw new Refusal(404, "not_found", "That payment isn't there any more.");
    if (payment.method === "points")
      throw new Refusal(
        409,
        "not_now",
        "Points paid on an order come back only when the order is cancelled.",
      );
    const invoice = await lockInvoice(tx, payment.invoiceId);
    if (invoice.status === "cancelled")
      throw new Refusal(
        409,
        "not_now",
        `Invoice ${invoice.code} was cancelled: give the money back from Refunds owed instead.`,
      );
    await tx.execute(
      sql`update payment set active = false, removed_reason = ${why}, removed_by = ${me.id}, removed_at = now() where id = ${paymentId}`,
    );
    await tx.execute(
      sql`update invoice set paid = paid - ${payment.amount}, status = 'open' where id = ${invoice.id}`,
    );
    await logEvent(
      tx,
      invoice.orderId,
      me,
      "payment",
      `Payment of ${peso(payment.amount)} (${METHOD_LABEL[payment.method].toLowerCase()}, ${dated(payment.paidOn)}) taken off ${invoice.code}: ${why}. ${peso(invoice.total - invoice.paid + payment.amount)} owed now.`,
    );
    await settleOrderPoints(tx, invoice.orderId);
  });
}

/** Money given back for an order that was cancelled after the customer paid. */
export async function recordRefund(
  db: Database,
  me: Me,
  invoiceId: number,
  input: RefundInput,
): Promise<void> {
  allow(me, FINANCE_ROLES, "record a refund");
  payable({ amount: input.amount, paidOn: input.refundedOn }, "refundedOn");
  await db.transaction(async (tx) => {
    const invoice = await lockInvoice(tx, invoiceId);
    // A cancelled order gives back what came in; a return gives back what was paid beyond the
    // bill it left (never the points).
    const cash = invoice.paid - invoice.refunded - (await pointsPaid(tx, invoice.id));
    const owed =
      invoice.status === "cancelled"
        ? cash
        : Math.min(cash, invoice.paid - invoice.refunded - invoice.total);
    if (invoice.status !== "cancelled" && owed <= 0)
      throw new Refusal(
        409,
        "not_now",
        `Nothing was paid beyond invoice ${invoice.code}: there is nothing to give back.`,
      );
    if (owed <= 0)
      throw new Refusal(
        409,
        "not_now",
        `Everything received for ${invoice.code} has already been given back.`,
      );
    if (input.amount > owed)
      throw new Refusal(400, "invalid", `That is more than the ${peso(owed)} owed back.`, "amount");
    await tx.execute(
      sql`insert into refund (invoice_id, amount, method, reference, refunded_on, note, by_person)
        values (${invoice.id}, ${input.amount}, ${input.method}, ${clean(input.reference)}, ${input.refundedOn}::date, ${clean(input.note)}, ${me.id})`,
    );
    await tx.execute(
      sql`update invoice set refunded = refunded + ${input.amount} where id = ${invoice.id}`,
    );
    const left = owed - input.amount;
    await logEvent(
      tx,
      invoice.orderId,
      me,
      "payment",
      `Given back to the customer: ${how({ ...input, paidOn: input.refundedOn })}.${left > 0 ? ` ${peso(left)} still to give back.` : ""}`,
    );
  });
}

// ---------------------------------------------------------------- lists

const TABS: Record<InvoiceTab, (today: string) => SQL> = {
  all: () => sql`true`,
  unpaid: () => sql`i.status = 'open'`,
  overdue: overdue,
  paid: () => sql`i.status = 'paid'`,
  cancelled: () => sql`i.status = 'cancelled'`,
};

export async function listInvoices(
  db: Database,
  me: Me,
  filter: { tab?: string; q?: string; customer?: number; page?: number },
): Promise<InvoiceList> {
  allow(me, FINANCE_READ_ROLES, "see invoices");
  const today = todayManila();
  const tab: InvoiceTab = filter.tab && filter.tab in TABS ? (filter.tab as InvoiceTab) : "all";
  const page = Math.max(1, Math.floor(filter.page ?? 1) || 1);
  const narrowed: SQL[] = [];
  if (filter.customer) narrowed.push(sql`i.customer_id = ${filter.customer}`);
  for (const word of (filter.q ?? "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 5)) {
    const like = `%${word.replace(/[%_\\]/g, "\\$&")}%`;
    narrowed.push(
      sql`(lower(i.code) like ${like} or lower(o.code) like ${like} or lower(c.name) like ${like})`,
    );
  }
  const scope = narrowed.length ? sql.join(narrowed, sql` and `) : sql`true`;
  const where = sql`${scope} and ${TABS[tab](today)}`;
  const [found, counted, sums, customer] = await Promise.all([
    rows<InvoiceSql>(
      db,
      sql`select ${invoiceColumns} ${invoiceFrom} where ${where} order by i.issued_on desc, i.id desc limit ${PAGE} offset ${(page - 1) * PAGE}`,
    ),
    rows<Record<InvoiceTab, number>>(
      db,
      sql`select count(*)::int as "all", count(*) filter (where ${TABS.unpaid(today)})::int as unpaid,
          count(*) filter (where ${TABS.overdue(today)})::int as overdue, count(*) filter (where ${TABS.paid(today)})::int as paid,
          count(*) filter (where ${TABS.cancelled(today)})::int as cancelled
        ${invoiceFrom} where ${scope}`,
    ),
    rows<{ total: number; balance: number }>(
      db,
      sql`select coalesce(sum(i.total), 0)::float8 as total,
          coalesce(sum(i.total - i.paid) filter (where i.status <> 'cancelled'), 0)::float8 as balance
        ${invoiceFrom} where ${where}`,
    ),
    filter.customer
      ? rows<{ id: number; name: string }>(
          db,
          sql`select id::int as id, name from customer where id = ${filter.customer}`,
        )
      : Promise.resolve([]),
  ]);
  const counts = counted[0] ?? { all: 0, unpaid: 0, overdue: 0, paid: 0, cancelled: 0 };
  return {
    tab,
    counts,
    rows: found.map((row) => shown(row, today)),
    total: counts[tab],
    page,
    pageSize: PAGE,
    sums: sums[0] ?? { total: 0, balance: 0 },
    customer: customer[0] ?? null,
  };
}

export async function invoiceDetail(db: Database, me: Me, id: number): Promise<InvoiceDetail> {
  // The MedRep, the team lead and the Online desk read the invoice of an order they may read.
  if (!FINANCE_READ_ROLES.includes(me.role)) {
    const [own] = await rows<{ orderId: number }>(
      db,
      sql`select order_id::int as "orderId" from invoice where id = ${id}`,
    );
    if (!own || !(await mayReadOrder(db, me, own.orderId)))
      allow(me, FINANCE_READ_ROLES, "see invoices");
  }
  const today = todayManila();
  const [invoice] = await rows<InvoiceSql & Omit<InvoiceDetail["invoice"], keyof InvoiceRow>>(
    db,
    sql`select ${invoiceColumns}, i.vatable::int as vatable, i.vat::int as vat, i.exempt::int as exempt, i.zero_rated::int as "zeroRated",
        o.payment_days::int as "paymentDays", rep.name as medrep, nullif(concat_ws(', ', c.address, c.city), '') as "customerAddress",
        c.tin as "customerTin", o.customer_po as "customerPo", o.delivery_address as "deliveryAddress",
        who.name as by, ${iso("i.at")} as at, i.cancelled_reason as "cancelledReason", o.delivery_fee::int as "deliveryFee",
        c.phone as "customerPhone", o.receiver, doc.name as doctor,
        concat_ws(' | ', coalesce(ch.code, '—'), rep.name) as salesperson, o.payment_term as "paymentTerm",
        case when o.relief_kind is not null then json_build_object('kind', o.relief_kind, 'idNo', o.relief_id_no, 'name', o.relief_name) end as relief,
        case when l.source is null then 'MedRep order' else l.source end as source
      ${invoiceFrom} join person rep on rep.id = o.medrep_id join person who on who.id = i.by_person
        left join channel ch on ch.id = o.channel_id left join customer doc on doc.id = o.doctor_id
        left join lead l on l.id = o.lead_id
      where i.id = ${id}`,
  );
  if (!invoice) throw new Refusal(404, "not_found", "That invoice doesn't exist.");
  const [items, money, proofs, company] = await Promise.all([
    rows<InvoiceDetail["items"][number]>(
      db,
      sql`select i.id::int as id, m.name || coalesce(' ' || m.strength, '') as medicine, i.qty::int as qty, m.unit,
          i.unit_price::int as "unitPrice", (i.qty * i.unit_price)::int as amount, m.vat, i.free,
          m.strength, m.form, i.relief
        from order_item i join medicine m on m.id = i.medicine_id where i.order_id = ${invoice.orderId} order by i.id`,
    ),
    orderMoney(db, invoice.orderId),
    rows<Omit<OrderPaper, "kindLabel">>(
      db,
      sql`select f.id::int as id, f.kind, f.name, f.mime, f.size::int as size, p.name as by, ${iso("f.at")} as at
        from order_file f join person p on p.id = f.by_person
        where f.order_id = ${invoice.orderId} and f.active and f.kind = 'payment_proof' order by f.at, f.id`,
    ),
    companyInfo(db),
  ]);
  const { delivered, ...rest } = invoice;
  const acts = FINANCE_ROLES.includes(me.role);
  const source = rest.source;
  return {
    invoice: {
      ...rest,
      ...shown(invoice, today),
      source:
        source && source !== "MedRep order" && source in SOURCE_LABEL
          ? `${SOURCE_LABEL[source as LeadSource]} enquiry`
          : "MedRep order",
    },
    company,
    items,
    payments: money.payments,
    refunds: money.refunds,
    proofs: proofs.map((paper) => ({ ...paper, kindLabel: PAPER_LABEL[paper.kind] })),
    can: {
      pay:
        acts &&
        invoice.status === "open" &&
        !(invoice.terms === "cod" && !(invoice as { delivered?: boolean }).delivered),
      removePayment: acts && invoice.status !== "cancelled",
      refund: acts && invoice.status === "cancelled" && invoice.paid > invoice.refunded,
    },
  };
}

/** Payments received in a month (Manila), newest first. */
export async function listPayments(
  db: Database,
  me: Me,
  filter: { month?: string; method?: string; q?: string; page?: number },
): Promise<PaymentList> {
  allow(me, FINANCE_READ_ROLES, "see payments");
  const month = /^\d{4}-\d{2}$/.test(filter.month ?? "")
    ? (filter.month as string)
    : todayManila().slice(0, 7);
  const page = Math.max(1, Math.floor(filter.page ?? 1) || 1);
  const where: SQL[] = [sql`p.active`, sql`to_char(p.paid_on, 'YYYY-MM') = ${month}`];
  if (METHODS.includes(filter.method as PaymentRow["method"]))
    where.push(sql`p.method = ${filter.method}`);
  for (const word of (filter.q ?? "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 5)) {
    const like = `%${word.replace(/[%_\\]/g, "\\$&")}%`;
    where.push(
      sql`(lower(i.code) like ${like} or lower(o.code) like ${like} or lower(c.name) like ${like} or lower(coalesce(p.reference, '')) like ${like})`,
    );
  }
  const scope = sql.join(where, sql` and `);
  const [found, counted, byMethod, byDay] = await Promise.all([
    rows<Omit<PaymentRow, "methodLabel">>(
      db,
      sql`select ${paymentColumns} ${paymentFrom} where ${scope} order by p.paid_on desc, p.id desc limit ${PAGE} offset ${(page - 1) * PAGE}`,
    ),
    rows<{ total: number; sum: number }>(
      db,
      sql`select count(*)::int as total, coalesce(sum(p.amount), 0)::float8 as sum ${paymentFrom} where ${scope}`,
    ),
    // The month's money by how it came, and day by day (the filters' payments).
    rows<{ method: PaymentRow["method"]; amount: number; count: number }>(
      db,
      sql`select p.method, sum(p.amount)::float8 as amount, count(*)::int as count ${paymentFrom} where ${scope}
        group by p.method order by sum(p.amount) desc`,
    ),
    rows<{ day: string; amount: number }>(
      db,
      sql`select ${day("p.paid_on")} as day, sum(p.amount)::float8 as amount ${paymentFrom} where ${scope}
        group by p.paid_on order by p.paid_on`,
    ),
  ]);
  const [year, monthNumber] = month.split("-").map(Number);
  return {
    rows: found.map(withMethod),
    total: counted[0]?.total ?? 0,
    sum: counted[0]?.sum ?? 0,
    byMethod: byMethod.map((row) => ({ ...row, label: METHOD_LABEL[row.method] })),
    byDay,
    page,
    pageSize: PAGE,
    month,
    monthLabel: new Date(Date.UTC(year ?? 2026, (monthNumber ?? 1) - 1, 1)).toLocaleString(
      "en-PH",
      { month: "long", year: "numeric", timeZone: "UTC" },
    ),
    methods: METHODS.map((key) => ({ key, label: METHOD_LABEL[key] })),
  };
}

/** What each customer owes on open invoices, by how late. */
export async function customersOwe(
  db: Database,
  me: Me,
  filter: { q?: string },
): Promise<OwedList> {
  allow(me, FINANCE_READ_ROLES, "see what customers owe");
  const today = todayManila();
  const narrowed: SQL[] = [sql`true`];
  for (const word of (filter.q ?? "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 5)) {
    const like = `%${word.replace(/[%_\\]/g, "\\$&")}%`;
    narrowed.push(sql`(lower(c.name) like ${like} or lower(coalesce(c.city, '')) like ${like})`);
  }
  const found = await rows<
    Omit<OwedRow, "terms"> & { paymentTerms: PaymentTerms; paymentDays: number | null }
  >(
    db,
    // Terms and MedRep as the open invoices have them (the order's), not the customer's today: a
    // customer moved to credit last week still owes on the advance invoices of before. Zoho's
    // unpaid invoices and opening balances count with this CRM's (an opening balance as "older").
    sql`select c.id::int as "customerId", c.name as customer, c.kind, c.city,
        case when count(distinct dd.terms) = 1 then min(dd.terms) else 'mixed' end as "paymentTerms",
        case when count(distinct dd.days) = 1 then min(dd.days)::int end as "paymentDays",
        c.credit_limit::int as "creditLimit",
        (select string_agg(distinct p.name, ', ') from person p where p.id in (select dd2.medrep_id from ${duesSql(today)} dd2 where dd2.customer_id = c.id)) as medrep,
        count(*)::int as invoices,
        coalesce(sum(dd.balance) filter (where not dd.on_delivery and dd.late <= 0), 0)::float8 as current,
        coalesce(sum(dd.balance) filter (where not dd.on_delivery and dd.late between 1 and 30), 0)::float8 as d30,
        coalesce(sum(dd.balance) filter (where not dd.on_delivery and dd.late between 31 and 60), 0)::float8 as d60,
        coalesce(sum(dd.balance) filter (where not dd.on_delivery and dd.late between 61 and 90), 0)::float8 as d90,
        coalesce(sum(dd.balance) filter (where not dd.on_delivery and dd.late > 90), 0)::float8 as older,
        coalesce(sum(dd.balance) filter (where dd.on_delivery), 0)::float8 as "onDelivery",
        sum(dd.balance)::float8 as total,
        coalesce(sum(dd.balance) filter (where not dd.on_delivery and dd.late > 0), 0)::float8 as overdue,
        coalesce(max(dd.late) filter (where not dd.on_delivery and dd.late > 0), 0)::int as "oldestDays"
      from ${duesSql(today)} dd join customer c on c.id = dd.customer_id
      where ${sql.join(narrowed, sql` and `)}
      group by c.id, c.name, c.kind, c.city, c.credit_limit, c.area_id
      having sum(dd.balance) > 0
      order by overdue desc, total desc, c.name`,
  );
  const keys = [
    "invoices",
    "current",
    "d30",
    "d60",
    "d90",
    "older",
    "onDelivery",
    "total",
    "overdue",
  ] as const;
  const totals = Object.fromEntries(
    keys.map((key) => [key, found.reduce((sum, row) => sum + row[key], 0)]),
  ) as OwedList["totals"];
  return {
    rows: found.map(({ paymentTerms, paymentDays, ...row }) => ({
      ...row,
      terms:
        (paymentTerms as string) === "mixed"
          ? "Mixed"
          : paymentTerms === "days"
            ? paymentDays
              ? `${paymentDays} days`
              : "Credit"
            : paymentTerms === "cod"
              ? "COD"
              : "Advance",
    })),
    totals,
    today,
  };
}

/** Cancelled orders the customer had paid for, and what was given back. */
export async function refundsOwed(db: Database, me: Me): Promise<RefundList> {
  allow(me, FINANCE_READ_ROLES, "see refunds");
  const today = todayManila();
  const [owed, overpaid, done] = await Promise.all([
    rows<Omit<RefundOwed, "days" | "owed"> & { cancelledDay: string | null }>(
      db,
      sql`select i.id::int as "invoiceId", i.code as "invoiceCode", i.order_id::int as "orderId", o.code as "orderCode",
          i.customer_id::int as "customerId", c.name as customer, (i.paid - (select coalesce(sum(pp.amount), 0) from payment pp where pp.invoice_id = i.id and pp.active and pp.method = 'points'))::int as received, i.refunded::int as refunded,
          i.cancelled_reason as reason, ${iso("i.cancelled_at")} as "cancelledAt",
          to_char(i.cancelled_at at time zone 'Asia/Manila', 'YYYY-MM-DD') as "cancelledDay"
        ${invoiceFrom} where i.status = 'cancelled' and i.paid - (select coalesce(sum(pp.amount), 0) from payment pp where pp.invoice_id = i.id and pp.active and pp.method = 'points') > i.refunded order by i.cancelled_at, i.id`,
    ),
    // Paid beyond the bill a return left: given back as well.
    rows<Omit<RefundOwed, "days"> & { cancelledDay: string | null }>(
      db,
      sql`select i.id::int as "invoiceId", i.code as "invoiceCode", i.order_id::int as "orderId", o.code as "orderCode",
          i.customer_id::int as "customerId", c.name as customer, i.paid::int as received, i.refunded::int as refunded,
          least(i.paid - i.refunded - i.total,
            i.paid - i.refunded - (select coalesce(sum(pp.amount), 0) from payment pp where pp.invoice_id = i.id and pp.active and pp.method = 'points'))::int as owed,
          'Goods returned: ' || coalesce((select string_agg(r.code, ', ') from sales_return r where r.order_id = i.order_id and r.status = 'received'), 'credit') as reason,
          ${iso("(select max(r.received_at) from sales_return r where r.order_id = i.order_id)")} as "cancelledAt",
          to_char((select max(r.received_at) from sales_return r where r.order_id = i.order_id) at time zone 'Asia/Manila', 'YYYY-MM-DD') as "cancelledDay"
        ${invoiceFrom} where i.status <> 'cancelled' and i.credited > 0
          and least(i.paid - i.refunded - i.total,
            i.paid - i.refunded - (select coalesce(sum(pp.amount), 0) from payment pp where pp.invoice_id = i.id and pp.active and pp.method = 'points')) > 0
        order by i.id`,
    ),
    rows<RefundList["done"][number]>(
      db,
      sql`select ${refundColumns}, i.code as "invoiceCode", i.order_id::int as "orderId", o.code as "orderCode", c.name as customer
        from refund r join invoice i on i.id = r.invoice_id join sales_order o on o.id = i.order_id
        join customer c on c.id = i.customer_id join person who on who.id = r.by_person
        order by r.at desc, r.id desc limit 50`,
    ),
  ]);
  return {
    owed: [
      ...owed.map(({ cancelledDay, ...row }) => ({
        ...row,
        owed: row.received - row.refunded,
        days: cancelledDay ? Math.max(0, daysBetween(cancelledDay, today)) : 0,
      })),
      ...overpaid.map(({ cancelledDay, ...row }) => ({
        ...row,
        days: cancelledDay ? Math.max(0, daysBetween(cancelledDay, today)) : 0,
      })),
    ],
    done: done.map(withMethod),
    can: { refund: FINANCE_ROLES.includes(me.role) },
  };
}

export { AGE_BUCKETS };

/** The order an invoice belongs to. */
export async function orderOfInvoice(db: Database, invoiceId: number): Promise<number | null> {
  const [found] = await rows<{ orderId: number }>(
    db,
    sql`select order_id::int as "orderId" from invoice where id = ${invoiceId}`,
  );
  return found?.orderId ?? null;
}

/** A customer's statement of account (anyone who may see the customer). Cancelled invoices are left
 *  out with their payments; a refund is money given back, so it raises the balance again. */
export async function customerStatement(
  db: Database,
  me: Me,
  customerId: number,
  asked: { from?: string; to?: string },
): Promise<Statement> {
  const { customer } = await customerDetail(db, me, customerId);
  const today = todayManila();
  const isDay = (value?: string) => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
  const to = isDay(asked.to) ? (asked.to as string) : today;
  const from = isDay(asked.from) ? (asked.from as string) : `${to.slice(0, 7)}-01`;
  if (from > to)
    throw new Refusal(400, "invalid", "The first day comes after the last one.", "from");
  const moves = await rows<{
    day: string;
    kind: Statement["lines"][number]["kind"];
    ref: string;
    note: string | null;
    debit: number;
    credit: number;
  }>(
    db,
    sql`select * from (
        select ${day("i.issued_on")} as day, 'invoice' as kind, i.code as ref, o.code as note, i.total::int as debit, 0 as credit, i.id as sort
          from invoice i join sales_order o on o.id = i.order_id
          where i.customer_id = ${customerId} and i.status <> 'cancelled'
        union all
        select ${day("p.paid_on")}, 'payment', i.code, concat_ws(' · ', initcap(p.method), p.reference), 0, p.amount::int, p.id
          from payment p join invoice i on i.id = p.invoice_id
          where i.customer_id = ${customerId} and p.active and i.status <> 'cancelled'
        union all
        select ${day("r.refunded_on")}, 'refund', i.code, concat_ws(' · ', initcap(r.method), r.reference), r.amount::int, 0, r.id
          from refund r join invoice i on i.id = r.invoice_id
          where i.customer_id = ${customerId} and i.status <> 'cancelled'
      ) m where m.day <= ${to} order by m.day, case m.kind when 'invoice' then 0 when 'payment' then 1 else 2 end, m.sort`,
  );
  let balance = 0;
  let opening = 0;
  const lines: Statement["lines"] = [];
  for (const move of moves) {
    balance += move.debit - move.credit;
    if (move.day < from) opening = balance;
    else lines.push({ ...move, balance });
  }
  const [aging] = await rows<Statement["aging"]>(
    db,
    sql`select
        coalesce(sum(i.total - i.paid) filter (where i.due_on is null or i.due_on >= ${today}::date or (i.terms in ('cod', 'days') and o.status <> 'completed')), 0)::int as current,
        coalesce(sum(i.total - i.paid) filter (where i.due_on < ${today}::date and ${today}::date - i.due_on <= 30 and not (i.terms in ('cod', 'days') and o.status <> 'completed')), 0)::int as d30,
        coalesce(sum(i.total - i.paid) filter (where ${today}::date - i.due_on between 31 and 60 and not (i.terms in ('cod', 'days') and o.status <> 'completed')), 0)::int as d60,
        coalesce(sum(i.total - i.paid) filter (where ${today}::date - i.due_on > 60 and not (i.terms in ('cod', 'days') and o.status <> 'completed')), 0)::int as older
      from invoice i join sales_order o on o.id = i.order_id
      where i.customer_id = ${customerId} and i.status = 'open'`,
  );
  return {
    company: await companyInfo(db),
    customer: {
      id: customer.id,
      code: customer.code,
      name: customer.name,
      address: withCity(customer.address, customer.city),
      tin: customer.tin ?? null,
      terms:
        customer.paymentTerms === "days"
          ? `${customer.paymentDays ?? ""} days`.trim()
          : customer.paymentTerms === "cod"
            ? "Cash on delivery"
            : "Advance",
    },
    from,
    to,
    opening,
    lines,
    closing: balance,
    aging: aging ?? { current: 0, d30: 0, d60: 0, older: 0 },
  };
}

/** Every unpaid invoice with whose it is and its days (Finance, Management, the CEO, the Admin). */
export async function owedInvoices(db: Database, me: Me): Promise<OwedInvoices> {
  allow(me, FINANCE_READ_ROLES, "see what customers owe");
  const today = todayManila();
  const found = await rows<
    Omit<OwedInvoices["rows"][number], "terms"> & { termsKey: string; days: number | null }
  >(
    db,
    sql`select i.id::int as "invoiceId", i.code as "invoiceCode", o.id::int as "orderId", o.code as "orderCode",
        c.id::int as "customerId", c.name as customer, c.kind, c.city, rep.id::int as "medrepId", rep.name as medrep,
        coalesce(u.name, (select u2.name from seat_holder h join seat s2 on s2.id = h.seat_id join org_unit u2 on u2.id = s2.unit_id
          where h.person_id = o.medrep_id and h.kind = 'holder' order by h.starts_on desc limit 1)) as team,
        ${day("i.issued_on")} as "issuedOn",
        case when i.terms = 'days' and o.status <> 'completed' then null else ${day("i.due_on")} end as "dueOn",
        ${day("o.delivered_on")} as "deliveredOn", i.terms as "termsKey", o.payment_days::int as days,
        i.total::int as total, i.paid::int as paid, (i.total - i.paid)::int as balance,
        case when i.terms = 'cod' and o.status <> 'completed' then 'on_delivery'
             when i.terms = 'days' and o.status <> 'completed' then 'due'
             when i.due_on < ${today}::date then 'late' else 'due' end as state,
        case when not (i.terms in ('cod', 'days') and o.status <> 'completed') and i.due_on < ${today}::date
             then (${today}::date - i.due_on)::int else 0 end as "daysLate"
      from invoice i join sales_order o on o.id = i.order_id join customer c on c.id = i.customer_id
        join person rep on rep.id = o.medrep_id
        left join seat s on s.id = o.seat_id left join org_unit u on u.id = s.unit_id
      where i.status = 'open' and i.total > i.paid
      order by (case when i.terms = 'cod' and o.status <> 'completed' then 1 else 0 end),
        "daysLate" desc, (i.total - i.paid) desc
      limit 2000`,
  );
  // Zoho's invoices still unpaid when Zoho was closed (the books): their seller is whoever holds
  // the seat of the customer's area now (else Zoho's salesperson).
  const zoho = await rows<Omit<OwedInvoices["rows"][number], "terms"> & { termsKey: string; days: number | null }>(
    db,
    sql`select -d.id::int as "invoiceId", d.number as "invoiceCode", null::int as "orderId",
        (select string_agg(so.number, ', ') from book_link k join book_doc so on so.id = k.to_doc and so.kind = 'sales_order' where k.from_doc = d.id) as "orderCode",
        c.id::int as "customerId", c.name as customer, c.kind, c.city, h.person_id::int as "medrepId",
        coalesce(p.name, d.fields->>'salesperson_name', d.fields->>'Sales Person', 'Zoho') as medrep, u.name as team,
        ${day("d.doc_date")} as "issuedOn", ${day("d.due_date")} as "dueOn", null as "deliveredOn", 'zoho' as "termsKey", null::int as days,
        round(d.total * d.fx_rate)::int as total, round((d.total - d.balance) * d.fx_rate)::int as paid, round(d.balance * d.fx_rate)::int as balance,
        case when d.due_date < ${today}::date then 'late' else 'due' end as state,
        case when d.due_date < ${today}::date then (${today}::date - d.due_date)::int else 0 end as "daysLate"
      from book_doc d join customer c on c.id = d.customer_id
        left join lateral (select h.person_id, s.unit_id from seat s join seat_holder h on h.seat_id = s.id and h.ends_on is null and h.kind = 'holder'
          where s.area_id = c.area_id order by h.starts_on desc limit 1) h on true
        left join person p on p.id = h.person_id left join org_unit u on u.id = h.unit_id
      where d.kind = 'invoice' and d.zoho_id is not null and d.balance > 0 and d.status not in ('void', 'draft')
      order by "daysLate" desc, d.balance desc`,
  );
  found.push(...zoho);
  found.sort((a, b) => (a.state === "on_delivery" ? 1 : 0) - (b.state === "on_delivery" ? 1 : 0) || b.daysLate - a.daysLate || b.balance - a.balance);
  const rowsOut = found.map(({ termsKey, days, ...row }) => ({
    ...row,
    terms:
      termsKey === "zoho" ? "From Zoho" : termsKey === "days" ? `${days ?? ""} days`.trim() : termsKey === "cod" ? "COD" : "Advance",
  }));
  const counted = rowsOut.filter((row) => row.state !== "on_delivery");
  return {
    today,
    rows: rowsOut,
    totals: {
      owed: counted.reduce((sum, row) => sum + row.balance, 0),
      overdue: counted
        .filter((row) => row.state === "late")
        .reduce((sum, row) => sum + row.balance, 0),
      onDelivery: rowsOut
        .filter((row) => row.state === "on_delivery")
        .reduce((sum, row) => sum + row.balance, 0),
      invoices: counted.length,
      customers: new Set(counted.map((row) => row.customerId)).size,
    },
  };
}

/** How long after confirming a payment Finance may take it back (as the hub's Undo). */
export const UNDO_SECONDS = 90;

/** Finance takes back a payment check it just made (within a minute and a half, before Dispatch
 *  touched the order): the invoice it made and the payment go, the order is back with Finance.
 *  An order paid partly with points is held instead. */
export async function undoConfirm(db: Database, me: Me, orderId: number): Promise<void> {
  allow(me, FINANCE_ROLES, "undo a payment check");
  await db.transaction(async (tx) => {
    const [order] = await rows<{
      code: string;
      status: string;
      by: number | null;
      seconds: number | null;
      points: number;
    }>(
      tx,
      sql`select code, status, finance_checked_by::int as by, points_used::int as points,
          extract(epoch from now() - finance_checked_at)::int as seconds
        from sales_order where id = ${orderId} for update`,
    );
    if (!order) throw new Refusal(404, "not_found", "That order doesn't exist.");
    if (
      order.status !== "ready_for_dispatch" ||
      order.by !== me.id ||
      order.seconds === null ||
      order.seconds > UNDO_SECONDS
    )
      throw new Refusal(
        409,
        "too_late",
        `${order.code}'s payment check can't be undone now: put it on hold instead.`,
      );
    if (order.points > 0)
      throw new Refusal(
        409,
        "too_late",
        `${order.code} was paid partly with points: put it on hold instead.`,
      );
    const [invoice] = await rows<{ id: number; code: string }>(
      tx,
      sql`select id::int as id, code from invoice where order_id = ${orderId} and status <> 'cancelled' for update`,
    );
    // The invoice keeps its number (one invoice an order); the money taken in with the check goes.
    if (invoice) {
      await tx.execute(
        sql`update payment set active = false, removed_reason = 'Payment check undone', removed_by = ${me.id},
            removed_at = now() where invoice_id = ${invoice.id} and active`,
      );
      await tx.execute(sql`update invoice set paid = 0, status = 'open' where id = ${invoice.id}`);
    }
    // The steps the check marked are taken off the order's road.
    await tx.execute(
      sql`update order_event set stage = null where order_id = ${orderId} and stage in ('finance_verified', 'paid')`,
    );
    await tx.execute(
      sql`update sales_order set status = 'finance_check', finance_checked_at = null, finance_checked_by = null,
          updated_at = now() where id = ${orderId}`,
    );
    await logEvent(
      tx,
      orderId,
      me,
      "status",
      `${me.name} undid the payment check${invoice ? ` (the payment on invoice ${invoice.code} taken off)` : ""}: it is back with Finance.`,
    );
    await settleOrderPoints(tx, orderId);
  });
}

export const HOLD_PROOF_MAX = 5;
export const HOLD_PROOF_BYTES = 10 * 1024 * 1024;

/** A screenshot Finance adds to its hold, shown to the MedRep with the reason. */
export async function addHoldProof(
  db: Database,
  me: Me,
  orderId: number,
  file: { name: string; mime: string; bytes: Uint8Array },
): Promise<{ id: number }> {
  allow(me, FINANCE_ROLES, "add a screenshot to a hold");
  if (!file.mime.startsWith("image/"))
    throw new Refusal(400, "invalid", "Add a screenshot (a photo or an image).", "file");
  if (file.bytes.length === 0 || file.bytes.length > HOLD_PROOF_BYTES)
    throw new Refusal(400, "invalid", "That image is over 10 MB.", "file");
  const kept = await keepFile("orders", file);
  return db.transaction(async (tx) => {
    const [order] = await rows<{ status: string; heldRole: string | null }>(
      tx,
      sql`select status, held_role as "heldRole" from sales_order where id = ${orderId} for update`,
    );
    if (order?.status !== "on_hold" || order.heldRole !== "finance")
      throw new Refusal(409, "not_now", "Only an order Finance holds takes its screenshots.");
    const [hold] = await rows<{ id: number }>(
      tx,
      sql`select max(id)::int as id from order_event where order_id = ${orderId} and kind = 'status'`,
    );
    const [counted] = await rows<{ n: number }>(
      tx,
      sql`select count(*)::int as n from order_file where order_id = ${orderId} and active and hold_event_id = ${hold?.id ?? 0}`,
    );
    if ((counted?.n ?? 0) >= HOLD_PROOF_MAX)
      throw new Refusal(
        400,
        "invalid",
        `At most ${HOLD_PROOF_MAX} screenshots with a hold.`,
        "file",
      );
    const [made] = await rows<{ id: number }>(
      tx,
      sql`insert into order_file (order_id, kind, name, mime, size, data, store_key, by_person, hold_event_id)
        values (${orderId}, 'other', ${kept.name}, ${kept.mime}, ${kept.size}, ${kept.data}, ${kept.key},
          ${me.id}, ${hold?.id ?? null})
        returning id::int as id`,
    );
    return { id: made?.id as number };
  });
}

/** The orders a Finance person confirmed (their payment check) over chosen Manila days. */
export async function myConfirmations(
  db: Database,
  me: Me,
  asked: { from?: string | null; to?: string | null },
): Promise<MyConfirmations> {
  allow(me, FINANCE_ROLES, "see your confirmations");
  const today = todayManila();
  const DAY = /^\d{4}-\d{2}-\d{2}$/;
  const to = asked.to && DAY.test(asked.to) ? asked.to : today;
  const from = asked.from && DAY.test(asked.from) && asked.from <= to ? asked.from : to;
  const found = await rows<MyConfirmations["rows"][number]>(
    db,
    sql`select o.id::int as id, o.code, c.name as customer, o.total::int as total, o.status,
        ${iso("o.finance_checked_at")} as at
      from sales_order o join customer c on c.id = o.customer_id
      where o.finance_checked_by = ${me.id}
        and (o.finance_checked_at at time zone 'Asia/Manila')::date between ${from}::date and ${to}::date
      order by o.finance_checked_at desc`,
  );
  for (const one of found) one.statusLabel = STATUS_LABEL[one.status as OrderStatus] ?? one.status;
  return { from, to, rows: found, total: found.reduce((sum, one) => sum + one.total, 0) };
}
