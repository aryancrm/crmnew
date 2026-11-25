// A customer's credit (step C3, 17 Nov): open credit notes (Zoho's, and those made in Books here) and
// payments received in Books not yet put on an invoice (a customer's advance) still holding money for them
// (₱2.5M over 443 customers when Zoho stopped), and money paid beyond one of our bills that
// Finance kept for their next one instead of giving it back. Finance uses it on an invoice as a
// payment of its own: never cash in, never given back as cash, and back with the customer if that
// invoice is cancelled. What is left is worked out from the payments that used it, so taking a
// payment off gives the credit back by itself.

import { type SQL, sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { allow, Refusal } from "../http";
import { todayManila } from "../inventory/rules";
import type { Runner } from "../inventory/service";
import { logEvent, peso } from "../orders/events";
import { settleOrderPoints } from "../points/service";
import type { CustomerCredit, Me } from "../types";
import { FINANCE_READ_ROLES, FINANCE_ROLES } from "./rules";

/** Every credit's source with what is left, for some customers (aliases: none outside). */
const sourcesSql = (customers: SQL) => sql`
  select d.customer_id::int as "customerId", 'zoho' as kind, d.id::int as id, d.number, to_char(d.doc_date, 'YYYY-MM-DD') as day,
    round(d.balance * d.fx_rate)::int as amount,
    (round(d.balance * d.fx_rate) - coalesce((select sum(p.amount) from payment p where p.active and p.credit_doc_id = d.id), 0))::int as left
  from book_doc d
  where d.kind in ('credit_note', 'customer_payment') and d.balance > 0 and d.status not in ('void', 'draft')
    and d.voided_at is null and d.customer_id in (${customers})
  union all
  select i.customer_id::int, 'kept', r.id::int, i.code, to_char(r.refunded_on, 'YYYY-MM-DD'), r.amount::int,
    (r.amount - coalesce((select sum(p.amount) from payment p where p.active and p.credit_refund_id = r.id), 0))::int
  from refund r join invoice i on i.id = r.invoice_id
  where r.method = 'credit' and i.customer_id in (${customers})`;

/** What a customer's credit holds now, source by source (oldest first). */
export async function customerCredit(db: Runner, customerId: number): Promise<CustomerCredit> {
  const sources = (
    await rows<CustomerCredit["sources"][number] & { customerId: number }>(
      db,
      sql`select * from (${sourcesSql(sql`${customerId}`)}) s where s.left > 0 order by s.day, s.id`,
    )
  ).map(({ customerId: _c, ...source }) => source);
  return { total: sources.reduce((sum, one) => sum + one.left, 0), sources };
}

/** The same, read by Finance and Management (the customer's page, the order's money check). */
export async function readCustomerCredit(
  db: Database,
  me: Me,
  customerId: number,
): Promise<CustomerCredit> {
  allow(me, FINANCE_READ_ROLES, "see a customer's credit");
  return customerCredit(db, customerId);
}

/** Finance uses some of a customer's credit on one of their open invoices. */
export async function useCredit(
  db: Database,
  me: Me,
  invoiceId: number,
  input: { kind: "zoho" | "kept"; sourceId: number; amount: number },
): Promise<void> {
  allow(me, FINANCE_ROLES, "use a customer's credit");
  if (!Number.isInteger(input.amount) || input.amount <= 0)
    throw new Refusal(400, "invalid", "Type how much of the credit to use.", "amount");
  await db.transaction(async (tx) => {
    const [invoice] = await rows<{
      id: number;
      code: string;
      orderId: number;
      customerId: number;
      owed: number;
      status: string;
    }>(
      tx,
      sql`select id::int as id, code, order_id::int as "orderId", customer_id::int as "customerId",
          (total - paid)::int as owed, status from invoice where id = ${invoiceId} for update`,
    );
    if (!invoice) throw new Refusal(404, "not_found", "That invoice doesn't exist.");
    if (invoice.status !== "open" || invoice.owed <= 0)
      throw new Refusal(409, "not_now", `Nothing is owed on ${invoice.code} now.`);
    // The source is locked so two people can't use the same credit twice.
    if (input.kind === "zoho")
      await tx.execute(sql`select id from book_doc where id = ${input.sourceId} for update`);
    else await tx.execute(sql`select id from refund where id = ${input.sourceId} for update`);
    const credit = await customerCredit(tx, invoice.customerId);
    const source = credit.sources.find(
      (one) => one.kind === input.kind && one.id === input.sourceId,
    );
    if (!source)
      throw new Refusal(400, "invalid", "That credit isn't this customer's, or nothing is left of it.", "sourceId");
    if (input.amount > source.left)
      throw new Refusal(400, "invalid", `Only ${peso(source.left)} is left of ${source.number}.`, "amount");
    if (input.amount > invoice.owed)
      throw new Refusal(400, "invalid", `Only ${peso(invoice.owed)} is owed on ${invoice.code}.`, "amount");
    const word = input.kind === "zoho" ? `credit ${source.number} (credit note or advance)` : `credit kept from ${source.number}`;
    await tx.execute(
      sql`insert into payment (invoice_id, customer_id, amount, method, reference, paid_on, note, by_person, payer,
          credit_doc_id, credit_refund_id)
        values (${invoice.id}, ${invoice.customerId}, ${input.amount}, 'credit', ${source.number}, ${todayManila()}::date,
          ${`From the customer's credit: ${word}`}, ${me.id}, 'customer',
          ${input.kind === "zoho" ? input.sourceId : null}, ${input.kind === "kept" ? input.sourceId : null})`,
    );
    const [after] = await rows<{ left: number }>(
      tx,
      sql`update invoice set paid = paid + ${input.amount}, status = case when paid + ${input.amount} >= total then 'paid' else 'open' end
        where id = ${invoice.id} returning (total - paid)::int as left`,
    );
    const left = after?.left ?? 0;
    await logEvent(
      tx,
      invoice.orderId,
      me,
      "payment",
      `${peso(input.amount)} of the customer's credit (${word}) used on ${invoice.code}. ${left > 0 ? `${peso(left)} still owed.` : "Paid in full."}`,
      left > 0 ? null : "paid",
    );
    if (left === 0) {
      const [order] = await rows<{ status: string }>(
        tx,
        sql`select status from sales_order where id = ${invoice.orderId}`,
      );
      if (order?.status === "completed")
        await logEvent(tx, invoice.orderId, me, "status", "Completed: delivered and paid.", "completed");
    }
    await settleOrderPoints(tx, invoice.orderId);
  });
}

/** A cancelled invoice gives the credit used on it back to the customer (the payments come off). */
export async function releaseCredit(tx: Runner, me: Me, invoiceId: number): Promise<number> {
  const back = await rows<{ amount: number }>(
    tx,
    sql`update payment set active = false, removed_reason = 'The invoice was cancelled: the credit goes back to the customer',
        removed_by = ${me.id}, removed_at = now()
      where invoice_id = ${invoiceId} and active and method = 'credit' returning amount::int as amount`,
  );
  const total = back.reduce((sum, one) => sum + one.amount, 0);
  if (total > 0)
    await tx.execute(sql`update invoice set paid = paid - ${total} where id = ${invoiceId}`);
  return total;
}

/**
 * A return lowered a bill below what was paid on it, and part of that was the customer's own
 * credit: that part is their credit again (it was never cash, so Finance has nothing to give back
 * for it). Takes the credit used on the invoice off, the newest first; one only partly given back
 * is replaced by what is still used. Says how much went back.
 */
export async function creditBack(tx: Runner, me: Me, invoiceId: number, amount: number): Promise<number> {
  if (amount <= 0) return 0;
  const used = await rows<{ id: number; amount: number }>(
    tx,
    sql`select id::int as id, amount::int as amount from payment
      where invoice_id = ${invoiceId} and active and method = 'credit' order by id desc for update`,
  );
  let left = amount;
  for (const one of used) {
    if (left <= 0) break;
    const back = Math.min(left, one.amount);
    if (back < one.amount)
      await tx.execute(
        sql`insert into payment (invoice_id, customer_id, amount, method, reference, paid_on, note, by_person, payer, credit_doc_id, credit_refund_id)
          select invoice_id, customer_id, ${one.amount - back}, method, reference, paid_on, note, by_person, payer, credit_doc_id, credit_refund_id
          from payment where id = ${one.id}`,
      );
    await tx.execute(
      sql`update payment set active = false, removed_reason = 'A return lowered the bill: the credit goes back to the customer',
          removed_by = ${me.id}, removed_at = now() where id = ${one.id}`,
    );
    left -= back;
  }
  const total = amount - left;
  if (total > 0) await tx.execute(sql`update invoice set paid = paid - ${total} where id = ${invoiceId}`);
  return total;
}
