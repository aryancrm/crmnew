-- Step 2A Finance UAT enhancements (additive, preserves all existing ledger balances):
-- 1. Stamp new book_doc rows with OWN ('2mg') by default (explicit NULL still allowed).
-- 2. Support manual Input VAT override on book_doc_tax_meta (e.g. Meralco partial-VAT bills).
-- 3. Support CRM payment bank_charges ('Bank Fees and Charges') and 1% retention ('Retention Receivable').
-- 4. Preserve explicit book_doc.withheld on bills/expenses and post supplier EWT to 'Withholding Tax Payable'.

alter table book_doc alter column company set default '2mg';
--> statement-breakpoint
alter table book_doc_tax_meta add column if not exists manual_vat_centavos bigint check (manual_vat_centavos is null or manual_vat_centavos >= 0);
--> statement-breakpoint
alter table payment add column if not exists bank_charges integer not null default 0 check (bank_charges >= 0);
--> statement-breakpoint
alter table payment drop constraint if exists payment_deduction_kind_check;
--> statement-breakpoint
alter table payment add constraint payment_deduction_kind_check
  check (deduction_kind in ('near_expiry', 'listing_fee', 'promo', 'penalty', 'other', 'gl_waived', 'retention'));
--> statement-breakpoint
insert into finance_account_map (company, role_key, account_name) values
  ('2mg', 'retention_receivable', 'Retention Receivable'),
  ('2mg', 'bank_fees', 'Bank Fees and Charges'),
  ('gpi', 'retention_receivable', 'Retention Receivable'),
  ('gpi', 'bank_fees', 'Bank Fees and Charges')
on conflict (company, role_key) do nothing;
--> statement-breakpoint
create or replace function book_doc_accounts() returns trigger
language plpgsql as $$
declare
  charge text;
  held text;
begin
  new.money_account := coalesce(new.fields->>'Deposit To', new.fields->>'deposit_to_account_name', new.fields->>'Paid Through',
    new.fields->>'paid_through_account_name', new.fields->>'Refund From Account', new.fields->>'To Account');
  new.from_account := new.fields->>'From Account';
  new.party_account := coalesce(new.fields->>'Accounts Receivable', new.fields->>'Accounts Payable');
  charge := coalesce(nullif(new.fields->>'Bank Charges', ''), nullif(new.fields->>'bank_charges', ''));
  new.bank_charges := coalesce(case when charge ~ '^-?[0-9]+(\.[0-9]+)?$' then nullif(round(charge::numeric * 100), 0) end, new.bank_charges);
  held := coalesce(nullif(new.fields->>'Withholding Tax Amount (BCY)', ''), nullif(new.fields->>'Withholding Tax Amount', ''), nullif(new.fields->>'tax_amount_withheld', ''));
  new.withheld := coalesce(case when held ~ '^-?[0-9]+(\.[0-9]+)?$' then nullif(round(held::numeric * 100), 0) end, new.withheld);
  new.tax_account := coalesce(nullif(new.fields->>'Tax Account', ''), nullif(new.fields->>'tax_account_name', ''), new.tax_account);
  return new;
end
$$;
--> statement-breakpoint
create or replace view book_entry_calc as
  with doc as not materialized (
    select d.id, d.kind, d.doc_date, d.total, d.fx_rate, d.money_account, d.from_account, d.party_account, d.fields, d.zoho_id,
      coalesce(d.bank_charges, 0) as charges, coalesce(d.withheld, 0) as withheld, d.tax_account
    from book_doc d
    where d.voided_at is null and d.status not in ('void', 'draft', 'pending_approval')
  ),
  line as not materialized (
    select l.doc_id, l.n, l.account, l.medicine_id, l.description, coalesce(l.amount, 0) as amount, coalesce(l.tax_amount, 0) as tax
    from book_line l
  )
  select d.id as doc_id, d.kind, d.doc_date as on_date, coalesce(d.money_account, 'Undeposited Funds') as account,
    round((d.total - d.charges) * d.fx_rate)::bigint as debit, 0::bigint as credit, d.zoho_id is not null as zoho
  from doc d where d.kind = 'customer_payment'
  union all
  select d.id, d.kind, d.doc_date, coalesce(d.party_account, 'Accounts Receivable'), 0, round((d.total + d.withheld) * d.fx_rate)::bigint, d.zoho_id is not null
  from doc d where d.kind = 'customer_payment'
  union all
  select d.id, d.kind, d.doc_date, coalesce(d.tax_account, 'Advance Tax'), round(d.withheld * d.fx_rate)::bigint, 0, d.zoho_id is not null
  from doc d where d.kind = 'customer_payment' and d.withheld <> 0
  union all
  select d.id, d.kind, d.doc_date, coalesce(d.money_account, 'Petty Cash'), 0, round((d.total + d.charges) * d.fx_rate)::bigint, d.zoho_id is not null
  from doc d where d.kind = 'vendor_payment'
  union all
  select d.id, d.kind, d.doc_date, 'Bank Fees and Charges', round(d.charges * d.fx_rate)::bigint, 0, d.zoho_id is not null
  from doc d where d.kind in ('customer_payment', 'vendor_payment') and d.charges <> 0
  union all
  select d.id, d.kind, d.doc_date, coalesce(d.party_account, 'Accounts Payable'), round((d.total + d.withheld) * d.fx_rate)::bigint, 0, d.zoho_id is not null
  from doc d where d.kind = 'vendor_payment'
  union all
  select d.id, d.kind, d.doc_date, coalesce(d.tax_account, 'Withholding Tax Payable'), 0, round(d.withheld * d.fx_rate)::bigint, d.zoho_id is not null
  from doc d where d.kind = 'vendor_payment' and d.withheld <> 0
  union all
  select d.id, d.kind, d.doc_date, l.account,
    round((l.amount - case when d.fields->>'Is Inclusive Tax' = 'true' then l.tax else 0 end) * d.fx_rate)::bigint, 0, d.zoho_id is not null
  from doc d join line l on l.doc_id = d.id where d.kind = 'expense'
  union all
  select d.id, d.kind, d.doc_date, 'Tax Payable', round(sum(l.tax) * d.fx_rate)::bigint, 0, d.zoho_id is not null
  from doc d join line l on l.doc_id = d.id where d.kind = 'expense' and l.tax <> 0 group by d.id, d.kind, d.doc_date, d.fx_rate, d.zoho_id
  union all
  select d.id, d.kind, d.doc_date, coalesce(d.money_account, 'Petty Cash'), 0, round((d.total - d.withheld) * d.fx_rate)::bigint, d.zoho_id is not null
  from doc d where d.kind = 'expense'
  union all
  select d.id, d.kind, d.doc_date, coalesce(d.tax_account, 'Withholding Tax Payable'), 0, round(d.withheld * d.fx_rate)::bigint, d.zoho_id is not null
  from doc d where d.kind = 'expense' and d.withheld <> 0
  union all
  select d.id, d.kind, d.doc_date, l.account, round(greatest(l.amount, 0) * d.fx_rate)::bigint, round(greatest(-l.amount, 0) * d.fx_rate)::bigint, d.zoho_id is not null
  from doc d join line l on l.doc_id = d.id where d.kind = 'journal'
  union all
  select d.id, d.kind, d.doc_date, 'Tax Payable',
    round(case when l.amount >= 0 then l.tax else 0 end * d.fx_rate)::bigint, round(case when l.amount >= 0 then 0 else l.tax end * d.fx_rate)::bigint, d.zoho_id is not null
  from doc d join line l on l.doc_id = d.id where d.kind = 'journal' and l.tax <> 0
  union all
  select d.id, d.kind, d.doc_date, d.money_account, round(d.total * d.fx_rate)::bigint, 0, d.zoho_id is not null
  from doc d where d.kind in ('transfer_fund', 'deposit')
  union all
  select d.id, d.kind, d.doc_date, d.from_account, 0, round(d.total * d.fx_rate)::bigint, d.zoho_id is not null
  from doc d where d.kind in ('transfer_fund', 'deposit')
  union all
  select d.id, d.kind, d.doc_date, coalesce(d.money_account, 'Petty Cash'), 0, round(d.total * d.fx_rate)::bigint, d.zoho_id is not null
  from doc d where d.kind = 'refund'
  union all
  select d.id, d.kind, d.doc_date, 'Accounts Receivable', round(d.total * d.fx_rate)::bigint, 0, d.zoho_id is not null
  from doc d where d.kind = 'refund'
  union all
  select d.id, d.kind, d.doc_date, coalesce(d.party_account, 'Accounts Payable'),
    case when d.kind = 'vendor_credit' then round(d.total * d.fx_rate)::bigint else 0 end,
    case when d.kind = 'bill' then round((d.total - d.withheld) * d.fx_rate)::bigint else 0 end, d.zoho_id is not null
  from doc d where d.kind in ('bill', 'vendor_credit')
  union all
  select d.id, d.kind, d.doc_date, coalesce(d.tax_account, 'Withholding Tax Payable'), 0, round(d.withheld * d.fx_rate)::bigint, d.zoho_id is not null
  from doc d where d.kind = 'bill' and d.withheld <> 0
  union all
  select d.id, d.kind, d.doc_date, coalesce(l.account, case when l.medicine_id is not null then 'Inventory Asset' else 'Cost of Goods Sold' end),
    case when d.kind = 'bill' then round(l.amount * d.fx_rate)::bigint else 0 end,
    case when d.kind = 'vendor_credit' then round(l.amount * d.fx_rate)::bigint else 0 end, d.zoho_id is not null
  from doc d join line l on l.doc_id = d.id where d.kind in ('bill', 'vendor_credit')
  union all
  select d.id, d.kind, d.doc_date, 'Tax Payable',
    case when d.kind = 'bill' then greatest(r.rest, 0) else greatest(-r.rest, 0) end,
    case when d.kind = 'bill' then greatest(-r.rest, 0) else greatest(r.rest, 0) end, d.zoho_id is not null
  from doc d join lateral (
    select round((d.total - coalesce(sum(l.amount), 0)) * d.fx_rate)::bigint as rest from book_line l where l.doc_id = d.id
  ) r on r.rest <> 0
  where d.kind in ('bill', 'vendor_credit')
  union all
  select d.id, d.kind, d.doc_date, coalesce(d.party_account, 'Accounts Receivable'),
    case when d.kind = 'invoice' then round(d.total * d.fx_rate)::bigint else 0 end,
    case when d.kind = 'credit_note' then round(d.total * d.fx_rate)::bigint else 0 end, d.zoho_id is not null
  from doc d where d.kind in ('invoice', 'credit_note')
  union all
  select d.id, d.kind, d.doc_date, coalesce(l.account, 'Sales'),
    case when d.kind = 'credit_note' then round(l.amount * d.fx_rate)::bigint else 0 end,
    case when d.kind = 'invoice' then round(l.amount * d.fx_rate)::bigint else 0 end, d.zoho_id is not null
  from doc d join line l on l.doc_id = d.id where d.kind in ('invoice', 'credit_note')
  union all
  select d.id, d.kind, d.doc_date, 'Tax Payable',
    case when d.kind = 'credit_note' then greatest(r.rest, 0) else greatest(-r.rest, 0) end,
    case when d.kind = 'credit_note' then greatest(-r.rest, 0) else greatest(r.rest, 0) end, d.zoho_id is not null
  from doc d join lateral (
    select round((d.total - coalesce(sum(l.amount), 0)) * d.fx_rate)::bigint as rest from book_line l where l.doc_id = d.id
  ) r on r.rest <> 0
  where d.kind in ('invoice', 'credit_note');
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
