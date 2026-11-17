import { type SQL, sql } from "drizzle-orm";

/**
 * Every amount a customer owes, wherever it was billed (Aryan, 17 Nov: Finance checks what the
 * hospital or patient already owes before the order goes on): this CRM's open invoices, Zoho's
 * unpaid invoices, and what Zoho had them owing before its invoices (their opening balance, as
 * old as it gets). One row per amount: the customer, what is left to pay, how many days past its
 * due day, whether it is cash on delivery not delivered yet (not owed till then), its terms and
 * MedRep (this CRM's invoices).
 */
export const duesSql = (today: string): SQL => sql`(
  select i.customer_id, (i.total - i.paid)::bigint as balance, (${today}::date - i.due_on) as late,
    (i.terms in ('cod', 'days') and o.status <> 'completed') as on_delivery,
    (i.terms = 'cod' and o.status <> 'completed') as cod_waiting,
    i.terms, o.payment_days as days, o.medrep_id, 'crm' as source
  from invoice i join sales_order o on o.id = i.order_id where i.status = 'open' and i.total > i.paid
  union all
  select d.customer_id, round(d.balance * d.fx_rate)::bigint, (${today}::date - coalesce(d.due_date, d.doc_date)),
    false, false, 'days', null, null, 'zoho'
  from book_doc d
  where d.kind = 'invoice' and d.zoho_id is not null and d.customer_id is not null and d.balance > 0
    and d.status not in ('void', 'draft') and d.voided_at is null
  union all
  select c.id, c.opening_receivables, 366, false, false, 'days', null, null, 'zoho_opening'
  from customer c where c.opening_receivables > 0
)`;
