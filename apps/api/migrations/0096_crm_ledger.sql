-- This CRM's own money in the books (docs/ERP-PLAN.md, phase 1): every invoice, payment, refund,
-- return credit and piece of stock delivered or counted here gives its debits and credits by
-- itself, on the accounts Zoho used for the same thing, so the chart, the banks and the statements
-- hold the CRM's work beside Zoho's. Nobody types a journal for daily work.
--
-- An invoice: what the customer owes on Accounts Receivable; the sale on Sales, the delivery fee
--   (a VAT-able service) on Shipping Charge, the VAT on Tax Payable. As first billed: a return's
--   credit lowers the invoice later, on the day it is credited (below), not back on the invoice.
-- A payment: into the account Finance names (Undeposited Funds when none, as in Zoho), off what is
--   owed; tax withheld (2307) on Advance Tax (as Zoho kept it); points on Discount. A payment from
--   the customer's credit moves nothing: the credit was taken off what they owe when it was made.
-- A refund: out of the account named (Petty Cash when none, as Zoho's refunds), back onto what is
--   owed. A refund kept as the customer's credit moves no money.
-- A return credited: Sales and its VAT back, off what is owed.
-- Stock delivered: its batch's cost from Inventory Asset to Cost of Goods Sold; stock back from a
--   return the other way; a stock count's difference on Cost of Goods Sold (Zoho's adjustment
--   account). The demo stock taken off before going live (ref GO-LIVE) moves nothing.
alter table payment add column money_account text;
--> statement-breakpoint
alter table refund add column money_account text;
--> statement-breakpoint
create view crm_entry as
  with ret as (
    select r.id, r.code, r.order_id, (r.credited_at at time zone 'Asia/Manila')::date as on_date, r.credit::bigint as credit,
      round(coalesce(sum(l.qty::bigint * l.unit_price) filter (where coalesce(oi.vat_then, m.vat) = 'vat12'), 0) * 12 / 112.0)::bigint as vat
    from sales_return r
      join sales_return_line l on l.return_id = r.id and l.outcome <> 'missing'
      join medicine m on m.id = l.medicine_id
      left join order_item oi on oi.id = l.order_item_id
    where r.credited_at is not null and r.credit > 0
    group by r.id, r.code, r.order_id, r.credited_at, r.credit
  ),
  inv as (
    select i.id, i.code, i.customer_id, i.issued_on as on_date,
      (i.total + i.credited)::bigint as total,
      (i.vat + coalesce((select sum(ret.vat) from ret where ret.order_id = i.order_id), 0))::bigint as vat,
      (coalesce(o.delivery_fee, 0) - round(coalesce(o.delivery_fee, 0) * 12 / 112.0))::bigint as fee
    from invoice i join sales_order o on o.id = i.order_id
    where i.status <> 'cancelled'
  )
  select i.id as doc_id, 'crm_invoice'::text as kind, i.on_date, 'Accounts Receivable'::text as account,
    i.total as debit, 0::bigint as credit, i.code as number, i.customer_id, '/invoices/' || i.id as link
  from inv i
  union all
  select i.id, 'crm_invoice', i.on_date, 'Sales', 0, i.total - i.vat - i.fee, i.code, i.customer_id, '/invoices/' || i.id
  from inv i
  union all
  select i.id, 'crm_invoice', i.on_date, 'Shipping Charge', 0, i.fee, i.code, i.customer_id, '/invoices/' || i.id
  from inv i where i.fee <> 0
  union all
  select i.id, 'crm_invoice', i.on_date, 'Tax Payable', 0, i.vat, i.code, i.customer_id, '/invoices/' || i.id
  from inv i where i.vat <> 0
  -- Payments.
  union all
  select p.id, 'crm_payment', p.paid_on,
    case p.method when 'withholding' then 'Advance Tax' when 'points' then 'Discount' else coalesce(p.money_account, 'Undeposited Funds') end,
    p.amount::bigint, 0, i.code, p.customer_id, '/invoices/' || i.id
  from payment p join invoice i on i.id = p.invoice_id
  where p.active and p.method <> 'credit'
  union all
  select p.id, 'crm_payment', p.paid_on, 'Accounts Receivable', 0, p.amount::bigint, i.code, p.customer_id, '/invoices/' || i.id
  from payment p join invoice i on i.id = p.invoice_id
  where p.active and p.method <> 'credit'
  -- Refunds.
  union all
  select r.id, 'crm_refund', r.refunded_on, 'Accounts Receivable', r.amount::bigint, 0, i.code, i.customer_id, '/invoices/' || i.id
  from refund r join invoice i on i.id = r.invoice_id
  where r.method <> 'credit'
  union all
  select r.id, 'crm_refund', r.refunded_on, coalesce(r.money_account, 'Petty Cash'), 0, r.amount::bigint, i.code, i.customer_id, '/invoices/' || i.id
  from refund r join invoice i on i.id = r.invoice_id
  where r.method <> 'credit'
  -- Returns credited.
  union all
  select r.id, 'crm_return', r.on_date, 'Sales', r.credit - r.vat, 0, r.code, o.customer_id, '/orders/' || o.id
  from ret r join sales_order o on o.id = r.order_id
  union all
  select r.id, 'crm_return', r.on_date, 'Tax Payable', r.vat, 0, r.code, o.customer_id, '/orders/' || o.id
  from ret r join sales_order o on o.id = r.order_id where r.vat <> 0
  union all
  select r.id, 'crm_return', r.on_date, 'Accounts Receivable', 0, r.credit, r.code, o.customer_id, '/orders/' || o.id
  from ret r join sales_order o on o.id = r.order_id
  -- Stock out and back, at its batch's cost.
  union all
  select s.id, 'crm_stock', s.on_date, 'Cost of Goods Sold', greatest(s.cost, 0), greatest(-s.cost, 0), s.ref, s.customer_id, s.link
  from (
    select m.id, (m.at at time zone 'Asia/Manila')::date as on_date, (-m.qty)::bigint * b.unit_cost as cost, m.ref,
      o.customer_id, case when o.id is not null then '/orders/' || o.id end as link
    from stock_move m join batch b on b.id = m.batch_id
      left join sales_order o on o.code = m.ref
    where m.kind in ('deliver', 'return', 'count') and coalesce(m.ref, '') <> 'GO-LIVE' and b.unit_cost > 0
  ) s
  union all
  select s.id, 'crm_stock', s.on_date, 'Inventory Asset', greatest(-s.cost, 0), greatest(s.cost, 0), s.ref, s.customer_id, s.link
  from (
    select m.id, (m.at at time zone 'Asia/Manila')::date as on_date, (-m.qty)::bigint * b.unit_cost as cost, m.ref,
      o.customer_id, case when o.id is not null then '/orders/' || o.id end as link
    from stock_move m join batch b on b.id = m.batch_id
      left join sales_order o on o.code = m.ref
    where m.kind in ('deliver', 'return', 'count') and coalesce(m.ref, '') <> 'GO-LIVE' and b.unit_cost > 0
  ) s;
--> statement-breakpoint
-- Every document's debits and credits: Zoho's as written down, the books' forms' and this CRM's own
-- as they stand. `source` tells a book document ('books', doc_id is book_doc's) from this CRM's
-- ('crm', doc_id is the invoice's, payment's, refund's, return's or stock move's own).
create or replace view book_entry as
  select doc_id, kind, on_date, account, debit, credit, 'books'::text as source, null::text as number, null::bigint as customer_id, null::text as link
  from book_ledger
  union all
  select doc_id, kind, on_date, account, debit, credit, 'books', null, null, null from book_entry_calc where not zoho
  union all
  select doc_id, kind, on_date, account, debit, credit, 'crm', number, customer_id, link from crm_entry;
