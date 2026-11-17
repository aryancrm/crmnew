-- Samples and gifts in the books (docs/ERP-PLAN.md 7.3): the pieces sent to a rep leave the
-- Inventory Asset at their batch's cost and land on the expense the company's chart keeps for them.
-- The view is migration 0096's, with that one part added.
create or replace view crm_entry as
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
  ) s
  -- Samples and gifts sent to a rep: out of Inventory Asset at their batch's cost, onto the
  -- company's own expense accounts for them (Zoho's chart): samples on "Product Samples to
  -- clients", gifts on "Promotional Materials" (decided 18 Nov on Aryan's word: "do what's right").
  union all
  select m.id, 'crm_sample', (m.at at time zone 'Asia/Manila')::date,
    case when r.kind = 'gifts' then 'Promotional Materials' else 'Product Samples to clients' end,
    (-m.qty)::bigint * b.unit_cost, 0, m.ref, null::bigint, '/field/samples'
  from stock_move m join batch b on b.id = m.batch_id left join sample_request r on r.code = m.ref
  where m.kind = 'sample_out' and b.unit_cost > 0
  union all
  select m.id, 'crm_sample', (m.at at time zone 'Asia/Manila')::date, 'Inventory Asset',
    0, (-m.qty)::bigint * b.unit_cost, m.ref, null::bigint, '/field/samples'
  from stock_move m join batch b on b.id = m.batch_id
  where m.kind = 'sample_out' and b.unit_cost > 0;
