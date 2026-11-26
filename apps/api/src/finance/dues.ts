import { type SQL, sql } from "drizzle-orm";

/** An advance-pay invoice (aliases `i`, `o`) made at Management's approval whose money Finance
 *  hasn't checked yet: not owed and not late — Finance's check is where that money comes in (it
 *  is what the order waits for). An Online case's order goes to Finance like any other (18 Nov);
 *  an order Management let skip Finance is left as it was. */
export const awaitingPaymentSql = sql`(i.terms = 'advance' and o.finance_check and o.finance_checked_at is null)`;

/** Not due yet (aliases `i`, `o`): credit and cash on delivery until delivered, advance pay until
 *  Finance has checked the money. */
export const notDueSql = sql`((i.terms in ('cod', 'days') and o.status <> 'completed') or ${awaitingPaymentSql})`;

/** A guarantee letter's invoice (aliases `i`, `o`) the agency hasn't paid anything on yet: the
 *  agency's money, not the patient's debt (Aryan, 26 Nov: the medicine goes first, the agency pays
 *  months later). The company is still owed it (its totals keep it); a patient's own dues, their
 *  next order's checks and their seller's reminders leave it out (`and not dd.gl_waiting`). Never
 *  null (an order with no type would make it so, and hide every other debt): false unless both. */
export const glWaitingSql = sql`coalesce((o.order_type = 'gl' or exists (select 1 from lead gl_case where gl_case.order_id = o.id and gl_case.road = 'gl'))
  and not exists (select 1 from payment gl_paid where gl_paid.invoice_id = i.id and gl_paid.active and gl_paid.payer = 'agency'), false)`;

/**
 * Every amount a customer owes, wherever it was billed (Aryan, 17 Nov: Finance checks what the
 * hospital or patient already owes before the order goes on): this CRM's open invoices, Zoho's
 * unpaid invoices, and what Zoho had them owing before its invoices (their opening balance, as
 * old as it gets). One row per amount: the customer, what is left to pay, how many days past its
 * due day, whether it is cash on delivery not delivered yet or advance pay not checked yet (not
 * owed till then), its terms and MedRep, and its order (this CRM's invoices: an order's own
 * invoice is left out when Finance or Management looks at what the customer owed before it).
 */
export const duesSql = (today: string): SQL => sql`(
  select i.customer_id, (i.total - i.paid)::bigint as balance, (${today}::date - i.due_on) as late,
    ${notDueSql} as on_delivery,
    ((i.terms = 'cod' and o.status <> 'completed') or ${awaitingPaymentSql}) as cod_waiting,
    i.terms, o.payment_days as days, o.medrep_id, 'crm' as source, i.order_id,
    ${glWaitingSql} as gl_waiting
  from invoice i join sales_order o on o.id = i.order_id where i.status = 'open' and i.total > i.paid
  union all
  select d.customer_id, round(d.balance * d.fx_rate)::bigint, (${today}::date - coalesce(d.due_date, d.doc_date)),
    false, false, 'days', null, null, 'zoho', null::bigint, false
  from book_doc d
  where d.kind = 'invoice' and d.zoho_id is not null and d.customer_id is not null and d.balance > 0
    and d.status not in ('void', 'draft') and d.voided_at is null
  union all
  select c.id, c.opening_receivables, 366, false, false, 'days', null, null, 'zoho_opening', null::bigint, false
  from customer c where c.opening_receivables > 0
)`;

/** What was paid on an invoice (alias `i`) without cash: never given back as money. */
const notCashOnSql = sql`(select coalesce(sum(pp.amount), 0) from payment pp where pp.invoice_id = i.id and pp.active and pp.method in ('points', 'withholding', 'credit', 'deduction'))`;

/** How many refunds Finance owes, as its Refunds owed list counts them: a cancelled order's
 *  money not given back yet, and money paid beyond a bill a return lowered. One count for the
 *  menu's badge and the board (the badge counted only the cancelled ones before 23 Nov). */
export const refundsOwedCountSql = sql`(
  (select count(*) from invoice i join sales_order o on o.id = i.order_id
    where i.status = 'cancelled' and o.status = 'cancelled' and i.paid - ${notCashOnSql} > i.refunded)
  + (select count(*) from invoice i
    where i.status <> 'cancelled' and least(i.paid - i.refunded - i.total, i.paid - i.refunded - ${notCashOnSql}) > 0))`;
