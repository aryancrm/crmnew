-- Widen integer centavo money columns to bigint (PLAN 30 item 8b) so amounts past ₱21.47M never overflow.
-- Drops and recreates dependent views (sale_invoice, crm_entry, book_entry) verbatim.

drop view if exists book_entry;
--> statement-breakpoint
drop view if exists crm_entry;
--> statement-breakpoint
drop view if exists sale_invoice;
--> statement-breakpoint

alter table customer alter column credit_limit type bigint;
--> statement-breakpoint
alter table sales_order
  alter column total type bigint,
  alter column delivery_fee type bigint,
  alter column points_used type bigint,
  alter column cod_collected type bigint,
  alter column gl_amount type bigint;
--> statement-breakpoint
alter table order_item
  alter column list_price type bigint,
  alter column unit_price type bigint;
--> statement-breakpoint
alter table invoice
  alter column total type bigint,
  alter column vatable type bigint,
  alter column vat type bigint,
  alter column exempt type bigint,
  alter column zero_rated type bigint,
  alter column paid type bigint,
  alter column refunded type bigint,
  alter column credited type bigint;
--> statement-breakpoint
alter table payment
  alter column amount type bigint,
  alter column bank_charges type bigint;
--> statement-breakpoint
alter table refund alter column amount type bigint;
--> statement-breakpoint
alter table lead
  alter column gl_amount type bigint,
  alter column points_to_use type bigint;
--> statement-breakpoint
alter table gl_money_mark alter column amount type bigint;
--> statement-breakpoint
alter table sales_return alter column credit type bigint;
--> statement-breakpoint
drop trigger if exists batch_cost_changed on batch;
--> statement-breakpoint
alter table batch alter column unit_cost type bigint;
--> statement-breakpoint
create trigger batch_cost_changed after update of unit_cost on batch for each row execute function batch_cost_changed();
--> statement-breakpoint
alter table stock_move alter column unit_cost type bigint;
--> statement-breakpoint
alter table batch_cost_change
  alter column was type bigint,
  alter column now type bigint;
--> statement-breakpoint
alter table order_pick alter column unit_cost type bigint;
--> statement-breakpoint
alter table purchase
  alter column goods_total type bigint,
  alter column extras_total type bigint;
--> statement-breakpoint
alter table purchase_line
  alter column goods type bigint,
  alter column extras type bigint,
  alter column landed_unit type bigint;
--> statement-breakpoint
alter table purchase_cost alter column amount type bigint;
--> statement-breakpoint

create view sale_invoice as
  select i.id, 'crm' as source, i.issued_on, i.due_on, i.total::bigint as total, i.paid::bigint as paid,
    i.status, i.customer_id, o.seat_id, o.medrep_id, o.channel_id, o.id as order_id, o.covered, o.cover_lead_id,
    (select coalesce(sum(round((oi.qty - coalesce((select sum(rl.qty) from sales_return_line rl join sales_return rr on rr.id = rl.return_id
          where rl.order_item_id = oi.id and rr.credited_at is not null and rl.outcome <> 'missing'), 0))::numeric * oi.unit_price
          / case when coalesce(oi.vat_then, m.vat) = 'vat12' then 1.12 else 1 end)), 0)
      from order_item oi join medicine m on m.id = oi.medicine_id where oi.order_id = o.id)::bigint as net
  from invoice i join sales_order o on o.id = i.order_id
  union all
  select d.id, 'zoho', d.doc_date, d.due_date, round(d.total * d.fx_rate)::bigint, round((d.total - d.balance) * d.fx_rate)::bigint,
    case when d.status = 'void' then 'cancelled' when d.balance <= 0 then 'paid' else 'open' end,
    d.customer_id, zs.seat_id, null::bigint, seat_channel_id(zs.seat_id), null::bigint, false, null::bigint,
    (select coalesce(sum(round(coalesce(l.amount, 0) * d.fx_rate)), 0) from book_line l where l.doc_id = d.id and coalesce(l.qty, 1) > 0)::bigint
  from book_doc d
    left join zoho_seller zs on zs.name = coalesce(d.fields->>'Sales Person', d.fields->>'salesperson_name')
  where d.kind = 'invoice' and d.zoho_id is not null and d.status not in ('draft');
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
  union all
  select p.id, 'crm_payment', p.paid_on,
    case p.method
      when 'withholding' then 'Advance Tax'
      when 'points' then 'Discount'
      when 'deduction' then case when p.deduction_kind = 'retention' then 'Retention Receivable' else 'Discount' end
      else coalesce(p.money_account, 'Undeposited Funds')
    end,
    (p.amount - p.bank_charges)::bigint, 0, i.code, p.customer_id, '/invoices/' || i.id
  from payment p join invoice i on i.id = p.invoice_id
  where p.active and p.method <> 'credit' and (p.amount - p.bank_charges) > 0
  union all
  select p.id, 'crm_payment', p.paid_on, 'Bank Fees and Charges',
    p.bank_charges::bigint, 0, i.code, p.customer_id, '/invoices/' || i.id
  from payment p join invoice i on i.id = p.invoice_id
  where p.active and p.method <> 'credit' and p.bank_charges > 0
  union all
  select p.id, 'crm_payment', p.paid_on, 'Accounts Receivable', 0, p.amount::bigint, i.code, p.customer_id, '/invoices/' || i.id
  from payment p join invoice i on i.id = p.invoice_id
  where p.active and p.method <> 'credit'
  union all
  select r.id, 'crm_refund', r.refunded_on, 'Accounts Receivable', r.amount::bigint, 0, i.code, i.customer_id, '/invoices/' || i.id
  from refund r join invoice i on i.id = r.invoice_id
  where r.method <> 'credit'
  union all
  select r.id, 'crm_refund', r.refunded_on, coalesce(r.money_account, 'Petty Cash'), 0, r.amount::bigint, i.code, i.customer_id, '/invoices/' || i.id
  from refund r join invoice i on i.id = r.invoice_id
  where r.method <> 'credit'
  union all
  select r.id, 'crm_return', r.on_date, 'Sales', r.credit - r.vat, 0, r.code, o.customer_id, '/orders/' || o.id
  from ret r join sales_order o on o.id = r.order_id
  union all
  select r.id, 'crm_return', r.on_date, 'Tax Payable', r.vat, 0, r.code, o.customer_id, '/orders/' || o.id
  from ret r join sales_order o on o.id = r.order_id where r.vat <> 0
  union all
  select r.id, 'crm_return', r.on_date, 'Accounts Receivable', 0, r.credit, r.code, o.customer_id, '/orders/' || o.id
  from ret r join sales_order o on o.id = r.order_id
  union all
  select s.id, 'crm_stock', s.on_date, 'Cost of Goods Sold', greatest(s.cost, 0), greatest(-s.cost, 0), s.ref, s.customer_id, s.link
  from (
    select m.id, (m.at at time zone 'Asia/Manila')::date as on_date, (-m.qty)::bigint * coalesce(m.unit_cost, b.unit_cost) as cost, m.ref,
      o.customer_id, case when o.id is not null then '/orders/' || o.id end as link
    from stock_move m join batch b on b.id = m.batch_id
      left join sales_order o on o.code = m.ref
    where m.kind in ('deliver', 'return', 'count') and coalesce(m.ref, '') <> 'GO-LIVE' and coalesce(m.unit_cost, b.unit_cost) > 0
  ) s
  union all
  select s.id, 'crm_stock', s.on_date, 'Inventory Asset', greatest(-s.cost, 0), greatest(s.cost, 0), s.ref, s.customer_id, s.link
  from (
    select m.id, (m.at at time zone 'Asia/Manila')::date as on_date, (-m.qty)::bigint * coalesce(m.unit_cost, b.unit_cost) as cost, m.ref,
      o.customer_id, case when o.id is not null then '/orders/' || o.id end as link
    from stock_move m join batch b on b.id = m.batch_id
      left join sales_order o on o.code = m.ref
    where m.kind in ('deliver', 'return', 'count') and coalesce(m.ref, '') <> 'GO-LIVE' and coalesce(m.unit_cost, b.unit_cost) > 0
  ) s
  union all
  select m.id, 'crm_sample', (m.at at time zone 'Asia/Manila')::date,
    case when r.kind = 'gifts' then 'Promotional Materials' else 'Product Samples to clients' end,
    (-m.qty)::bigint * coalesce(m.unit_cost, b.unit_cost), 0, m.ref, null::bigint, '/field/samples'
  from stock_move m join batch b on b.id = m.batch_id left join sample_request r on r.code = m.ref
  where m.kind = 'sample_out' and coalesce(m.unit_cost, b.unit_cost) > 0
  union all
  select m.id, 'crm_sample', (m.at at time zone 'Asia/Manila')::date, 'Inventory Asset',
    0, (-m.qty)::bigint * coalesce(m.unit_cost, b.unit_cost), m.ref, null::bigint, '/field/samples'
  from stock_move m join batch b on b.id = m.batch_id
  where m.kind = 'sample_out' and coalesce(m.unit_cost, b.unit_cost) > 0
  union all
  select c.id, 'crm_stock', (c.at at time zone 'Asia/Manila')::date, 'Cost of Goods Sold',
    greatest(c.out_qty::bigint * (c.now - c.was), 0), greatest(-c.out_qty::bigint * (c.now - c.was), 0), 'Cost change ' || b.batch_no, null::bigint, null::text
  from batch_cost_change c join batch b on b.id = c.batch_id where c.out_qty <> 0
  union all
  select c.id, 'crm_stock', (c.at at time zone 'Asia/Manila')::date, 'Inventory Asset',
    greatest(-c.out_qty::bigint * (c.now - c.was), 0), greatest(c.out_qty::bigint * (c.now - c.was), 0), 'Cost change ' || b.batch_no, null::bigint, null::text
  from batch_cost_change c join batch b on b.id = c.batch_id where c.out_qty <> 0
  union all
  select c.id, 'crm_sample', (c.at at time zone 'Asia/Manila')::date, 'Product Samples to clients',
    greatest(c.sample_qty::bigint * (c.now - c.was), 0), greatest(-c.sample_qty::bigint * (c.now - c.was), 0), 'Cost change ' || b.batch_no, null::bigint, '/field/samples'
  from batch_cost_change c join batch b on b.id = c.batch_id where c.sample_qty <> 0
  union all
  select c.id, 'crm_sample', (c.at at time zone 'Asia/Manila')::date, 'Inventory Asset',
    greatest(-c.sample_qty::bigint * (c.now - c.was), 0), greatest(c.sample_qty::bigint * (c.now - c.was), 0), 'Cost change ' || b.batch_no, null::bigint, '/field/samples'
  from batch_cost_change c join batch b on b.id = c.batch_id where c.sample_qty <> 0;
--> statement-breakpoint

create view book_entry as
  select doc_id, kind, on_date, account, debit, credit, 'books'::text as source, null::text as number, null::bigint as customer_id, null::text as link
  from book_ledger
  union all
  select doc_id, kind, on_date, account, debit, credit, 'books', null, null, null from book_entry_calc where not zoho
  union all
  select doc_id, kind, on_date, account, debit, credit, 'crm', number, customer_id, link from crm_entry;
