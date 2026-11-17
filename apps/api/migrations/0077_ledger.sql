-- Zoho Books moved in (docs/PLAN.md 17): the chart of accounts, the documents only Books has
-- (expenses, manual journals, money moved between accounts, deposits, refunds of credit notes,
-- recurring bills and expenses, fixed assets) and Zoho's activity log. Every account's movements
-- are read from the documents themselves (book_entry), so an account never disagrees with them.

create table book_account (
  id bigint generated always as identity primary key,
  zoho_id text unique,
  name text not null,
  code text,
  -- Zoho's account type as a key: bank, cash, credit_card, expense, income, other_current_asset…
  type text not null,
  parent_id bigint references book_account (id),
  description text,
  currency text not null default 'PHP',
  active boolean not null default true,
  fields jsonb not null default '{}'::jsonb
);
--> statement-breakpoint
create unique index book_account_name on book_account (lower(name));
--> statement-breakpoint

alter table book_doc drop constraint book_doc_kind_check;
--> statement-breakpoint
alter table book_doc add constraint book_doc_kind_check check (kind in (
  'purchase_order', 'purchase_receive', 'bill', 'vendor_payment', 'vendor_credit',
  'sales_order', 'invoice', 'customer_payment', 'sales_return', 'credit_note',
  'package', 'shipment', 'transfer_order', 'adjustment',
  'expense', 'journal', 'transfer_fund', 'deposit', 'refund',
  'recurring_bill', 'recurring_expense', 'fixed_asset'
));
--> statement-breakpoint

-- Zoho's activity log: who did what in Zoho, as Zoho wrote it.
create table book_activity (
  id bigint generated always as identity primary key,
  zoho_id text unique,
  at timestamptz,
  user_name text,
  role_name text,
  operation text,
  transaction_type text,
  transaction_id text,
  transaction_name text,
  customer_name text,
  description text,
  fields jsonb not null default '{}'::jsonb
);
--> statement-breakpoint
create index book_activity_at on book_activity (at desc);
--> statement-breakpoint
create index book_activity_doc on book_activity (transaction_id);
--> statement-breakpoint

-- Each document's debits and credits on the accounts it names, in centavos of pesos. Money in and
-- out of the banks and cash (payments, expenses, transfers, deposits, refunds), manual journals line
-- by line, and what a bill or an invoice owes (payables, receivables) against its lines' accounts
-- and their tax. A voided or draft document moves nothing. Zoho's own postings Zoho never exported
-- (the cost of goods sold, opening balances) are not here.
create or replace view book_entry as
  -- Not materialized: each part below reads only its own kind, through the indexes.
  with doc as not materialized (
    select d.* from book_doc d
    where d.voided_at is null and d.status not in ('void', 'draft', 'pending_approval')
  ),
  line as not materialized (
    select l.doc_id, l.n, coalesce(l.account, l.fields->>'Account', l.fields->>'account_name') as account,
      l.description, coalesce(l.amount, 0) as amount, coalesce(l.tax_amount, 0) as tax
    from book_line l
  )
  -- Money received: into the account it was deposited to, off what the customer owed.
  select d.id as doc_id, d.kind, d.doc_date as on_date, coalesce(d.fields->>'Deposit To', d.fields->>'deposit_to_account_name', 'Undeposited Funds') as account,
    round(d.total * d.fx_rate)::bigint as debit, 0::bigint as credit
  from doc d where d.kind = 'customer_payment'
  union all
  select d.id, d.kind, d.doc_date, coalesce(d.fields->>'Accounts Receivable', 'Accounts Receivable'), 0, round(d.total * d.fx_rate)::bigint
  from doc d where d.kind = 'customer_payment'
  -- Money paid to a vendor: out of the account it was paid through, off what was owed to them.
  union all
  select d.id, d.kind, d.doc_date, coalesce(d.fields->>'Paid Through', d.fields->>'paid_through_account_name', 'Petty Cash'), 0, round(d.total * d.fx_rate)::bigint
  from doc d where d.kind = 'vendor_payment'
  union all
  select d.id, d.kind, d.doc_date, coalesce(d.fields->>'Accounts Payable', 'Accounts Payable'), round(d.total * d.fx_rate)::bigint, 0
  from doc d where d.kind = 'vendor_payment'
  -- An expense: each line on its expense account (its tax on Tax Payable), paid out of one account.
  union all
  select d.id, d.kind, d.doc_date, l.account,
    round((l.amount - case when d.fields->>'Is Inclusive Tax' = 'true' then l.tax else 0 end) * d.fx_rate)::bigint, 0
  from doc d join line l on l.doc_id = d.id where d.kind = 'expense'
  union all
  select d.id, d.kind, d.doc_date, 'Tax Payable', round(sum(l.tax) * d.fx_rate)::bigint, 0
  from doc d join line l on l.doc_id = d.id where d.kind = 'expense' and l.tax <> 0 group by d.id, d.kind, d.doc_date, d.fx_rate
  union all
  select d.id, d.kind, d.doc_date, coalesce(d.fields->>'Paid Through', 'Petty Cash'), 0, round(d.total * d.fx_rate)::bigint
  from doc d where d.kind = 'expense'
  -- A manual journal, line by line (a line's amount is its debit less its credit); a line's tax on
  -- Tax Payable, on the line's side.
  union all
  select d.id, d.kind, d.doc_date, l.account, round(greatest(l.amount, 0) * d.fx_rate)::bigint, round(greatest(-l.amount, 0) * d.fx_rate)::bigint
  from doc d join line l on l.doc_id = d.id where d.kind = 'journal'
  union all
  select d.id, d.kind, d.doc_date, 'Tax Payable',
    round(case when l.amount >= 0 then l.tax else 0 end * d.fx_rate)::bigint, round(case when l.amount >= 0 then 0 else l.tax end * d.fx_rate)::bigint
  from doc d join line l on l.doc_id = d.id where d.kind = 'journal' and l.tax <> 0
  -- Money moved between two accounts; a deposit (interest, other income) into a bank.
  union all
  select d.id, d.kind, d.doc_date, d.fields->>'To Account', round(d.total * d.fx_rate)::bigint, 0
  from doc d where d.kind in ('transfer_fund', 'deposit')
  union all
  select d.id, d.kind, d.doc_date, d.fields->>'From Account', 0, round(d.total * d.fx_rate)::bigint
  from doc d where d.kind in ('transfer_fund', 'deposit')
  -- A credit note's money given back: out of the account it was paid from.
  union all
  select d.id, d.kind, d.doc_date, coalesce(d.fields->>'Refund From Account', 'Petty Cash'), 0, round(d.total * d.fx_rate)::bigint
  from doc d where d.kind = 'refund'
  union all
  select d.id, d.kind, d.doc_date, 'Accounts Receivable', round(d.total * d.fx_rate)::bigint, 0
  from doc d where d.kind = 'refund'
  -- A bill owed to a vendor (a vendor credit the other way): its lines on their accounts, their tax.
  union all
  select d.id, d.kind, d.doc_date, coalesce(d.fields->>'Accounts Payable', 'Accounts Payable'),
    case when d.kind = 'vendor_credit' then round(d.total * d.fx_rate)::bigint else 0 end,
    case when d.kind = 'bill' then round(d.total * d.fx_rate)::bigint else 0 end
  from doc d where d.kind in ('bill', 'vendor_credit')
  union all
  select d.id, d.kind, d.doc_date, coalesce(l.account, 'Cost of Goods Sold'),
    case when d.kind = 'bill' then round(l.amount * d.fx_rate)::bigint else 0 end,
    case when d.kind = 'vendor_credit' then round(l.amount * d.fx_rate)::bigint else 0 end
  from doc d join line l on l.doc_id = d.id where d.kind in ('bill', 'vendor_credit')
  union all
  -- What the lines don't hold (tax, discount, adjustment), as one amount on Tax Payable.
  select d.id, d.kind, d.doc_date, 'Tax Payable',
    case when d.kind = 'bill' then greatest(r.rest, 0) else greatest(-r.rest, 0) end,
    case when d.kind = 'bill' then greatest(-r.rest, 0) else greatest(r.rest, 0) end
  from doc d join lateral (
    select round((d.total - coalesce(sum(l.amount), 0)) * d.fx_rate)::bigint as rest from book_line l where l.doc_id = d.id
  ) r on r.rest <> 0
  where d.kind in ('bill', 'vendor_credit')
  -- An invoice owed by a customer (a credit note the other way): its lines' income, the rest on Tax Payable.
  union all
  select d.id, d.kind, d.doc_date, coalesce(d.fields->>'Accounts Receivable', 'Accounts Receivable'),
    case when d.kind = 'invoice' then round(d.total * d.fx_rate)::bigint else 0 end,
    case when d.kind = 'credit_note' then round(d.total * d.fx_rate)::bigint else 0 end
  from doc d where d.kind in ('invoice', 'credit_note')
  union all
  select d.id, d.kind, d.doc_date, coalesce(l.account, 'Sales'),
    case when d.kind = 'credit_note' then round(l.amount * d.fx_rate)::bigint else 0 end,
    case when d.kind = 'invoice' then round(l.amount * d.fx_rate)::bigint else 0 end
  from doc d join line l on l.doc_id = d.id where d.kind in ('invoice', 'credit_note')
  union all
  select d.id, d.kind, d.doc_date, 'Tax Payable',
    case when d.kind = 'credit_note' then greatest(r.rest, 0) else greatest(-r.rest, 0) end,
    case when d.kind = 'credit_note' then greatest(-r.rest, 0) else greatest(r.rest, 0) end
  from doc d join lateral (
    select round((d.total - coalesce(sum(l.amount), 0)) * d.fx_rate)::bigint as rest from book_line l where l.doc_id = d.id
  ) r on r.rest <> 0
  where d.kind in ('invoice', 'credit_note');
