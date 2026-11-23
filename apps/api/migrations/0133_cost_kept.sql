-- What stock cost is kept as it was on the day it moved. The ledger and Gross Profit read the
-- batch's cost of today, so a landed-cost bill or a later receipt changed the cost of goods of
-- months already closed. Now each stock move keeps its piece's cost; when a batch's cost changes,
-- the difference on the pieces already gone is posted on the day of the change (Aryan's go, 22 Nov).
alter table stock_move add column unit_cost integer;
--> statement-breakpoint
-- Every move so far at its batch's cost of today: no figure changes on this day.
update stock_move m set unit_cost = b.unit_cost from batch b where b.id = m.batch_id and b.unit_cost is not null;
--> statement-breakpoint
create function stock_move_cost() returns trigger language plpgsql as $$
begin
  if new.unit_cost is null then
    select b.unit_cost into new.unit_cost from batch b where b.id = new.batch_id;
  end if;
  return new;
end $$;
--> statement-breakpoint
create trigger stock_move_cost before insert on stock_move for each row execute function stock_move_cost();
--> statement-breakpoint
create table batch_cost_change (
  id bigint generated always as identity primary key,
  batch_id bigint not null references batch (id),
  at timestamptz not null default now(),
  was integer not null,
  now integer not null,
  -- Pieces of the batch already gone to customers (net of returns and counts), and to reps as samples.
  out_qty integer not null,
  sample_qty integer not null
);
--> statement-breakpoint
create index batch_cost_change_batch on batch_cost_change (batch_id);
--> statement-breakpoint
create function batch_cost_changed() returns trigger language plpgsql as $$
declare gone integer; sampled integer;
begin
  if coalesce(new.unit_cost, 0) = coalesce(old.unit_cost, 0) then return new; end if;
  select coalesce(-sum(m.qty) filter (where m.kind in ('deliver', 'return', 'count') and coalesce(m.ref, '') <> 'GO-LIVE'), 0),
         coalesce(-sum(m.qty) filter (where m.kind = 'sample_out'), 0)
    into gone, sampled from stock_move m where m.batch_id = new.id;
  -- The moves that had no cost yet take the new one; the rest keep theirs and the difference is posted.
  update stock_move set unit_cost = new.unit_cost where batch_id = new.id and coalesce(unit_cost, 0) = 0;
  if coalesce(old.unit_cost, 0) > 0 and (gone <> 0 or sampled <> 0) then
    insert into batch_cost_change (batch_id, was, now, out_qty, sample_qty) values (new.id, old.unit_cost, coalesce(new.unit_cost, 0), gone, sampled);
  end if;
  return new;
end $$;
--> statement-breakpoint
create trigger batch_cost_changed after update of unit_cost on batch for each row execute function batch_cost_changed();
--> statement-breakpoint
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
    case p.method when 'withholding' then 'Advance Tax' when 'points' then 'Discount' when 'deduction' then 'Discount' else coalesce(p.money_account, 'Undeposited Funds') end,
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
  -- Samples and gifts sent to a rep: out of Inventory Asset at their batch's cost, onto the
  -- company's own expense accounts for them (Zoho's chart): samples on "Product Samples to
  -- clients", gifts on "Promotional Materials" (decided 18 Nov on Aryan's word: "do what's right").
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
  -- A batch's cost changed after pieces of it had left (a landed-cost bill came later, more was
  -- received at another cost): the difference on those pieces, on the day the cost changed.
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
