import { type SQL, sql } from "drizzle-orm";

/** An advance-pay invoice (aliases `i`, `o`) made at Management's approval whose money Finance
 *  hasn't checked yet: not owed and not late — Finance's check is where that money comes in (it
 *  is what the order waits for). An Online case's agent and an order Management let skip Finance
 *  are left as they were. */
export const awaitingPaymentSql = sql`(i.terms = 'advance' and o.finance_check and o.lead_id is null and o.finance_checked_at is null)`;

/** Not due yet (aliases `i`, `o`): credit and cash on delivery until delivered, advance pay until
 *  Finance has checked the money. */
export const notDueSql = sql`((i.terms in ('cod', 'days') and o.status <> 'completed') or ${awaitingPaymentSql})`;

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
    i.terms, o.payment_days as days, o.medrep_id, 'crm' as source, i.order_id
  from invoice i join sales_order o on o.id = i.order_id where i.status = 'open' and i.total > i.paid
  union all
  select d.customer_id, round(d.balance * d.fx_rate)::bigint, (${today}::date - coalesce(d.due_date, d.doc_date)),
    false, false, 'days', null, null, 'zoho', null::bigint
  from book_doc d
  where d.kind = 'invoice' and d.zoho_id is not null and d.customer_id is not null and d.balance > 0
    and d.status not in ('void', 'draft') and d.voided_at is null
  union all
  select c.id, c.opening_receivables, 366, false, false, 'days', null, null, 'zoho_opening', null::bigint
  from customer c where c.opening_receivables > 0
)`;
