-- Adding up the chart from every document each time was slow (seconds), so Zoho's documents' debits
-- and credits are written down once (book_ledger) when Zoho's data comes in, and only the documents
-- made here are worked out as they are read. Zoho's documents change only by an import (which calls
-- refresh_book_ledger() at its end) or by a void here (which takes the voided document's lines out).
drop view book_entry;
--> statement-breakpoint
create view book_entry_calc as
  -- Not materialized: each part below reads only its own kind, through the indexes.
  with doc as not materialized (
    select d.id, d.kind, d.doc_date, d.total, d.fx_rate, d.money_account, d.from_account, d.party_account, d.fields, d.zoho_id
    from book_doc d
    where d.voided_at is null and d.status not in ('void', 'draft', 'pending_approval')
  ),
  line as not materialized (
    select l.doc_id, l.n, l.account, l.description, coalesce(l.amount, 0) as amount, coalesce(l.tax_amount, 0) as tax
    from book_line l
  )
  -- Money received: into the account it was deposited to, off what the customer owed.
  select d.id as doc_id, d.kind, d.doc_date as on_date, coalesce(d.money_account, 'Undeposited Funds') as account,
    round(d.total * d.fx_rate)::bigint as debit, 0::bigint as credit, d.zoho_id is not null as zoho
  from doc d where d.kind = 'customer_payment'
  union all
  select d.id, d.kind, d.doc_date, coalesce(d.party_account, 'Accounts Receivable'), 0, round(d.total * d.fx_rate)::bigint, d.zoho_id is not null
  from doc d where d.kind = 'customer_payment'
  -- Money paid to a vendor: out of the account it was paid through, off what was owed to them.
  union all
  select d.id, d.kind, d.doc_date, coalesce(d.money_account, 'Petty Cash'), 0, round(d.total * d.fx_rate)::bigint, d.zoho_id is not null
  from doc d where d.kind = 'vendor_payment'
  union all
  select d.id, d.kind, d.doc_date, coalesce(d.party_account, 'Accounts Payable'), round(d.total * d.fx_rate)::bigint, 0, d.zoho_id is not null
  from doc d where d.kind = 'vendor_payment'
  -- An expense: each line on its expense account (its tax on Tax Payable), paid out of one account.
  union all
  select d.id, d.kind, d.doc_date, l.account,
    round((l.amount - case when d.fields->>'Is Inclusive Tax' = 'true' then l.tax else 0 end) * d.fx_rate)::bigint, 0, d.zoho_id is not null
  from doc d join line l on l.doc_id = d.id where d.kind = 'expense'
  union all
  select d.id, d.kind, d.doc_date, 'Tax Payable', round(sum(l.tax) * d.fx_rate)::bigint, 0, d.zoho_id is not null
  from doc d join line l on l.doc_id = d.id where d.kind = 'expense' and l.tax <> 0 group by d.id, d.kind, d.doc_date, d.fx_rate, d.zoho_id
  union all
  select d.id, d.kind, d.doc_date, coalesce(d.money_account, 'Petty Cash'), 0, round(d.total * d.fx_rate)::bigint, d.zoho_id is not null
  from doc d where d.kind = 'expense'
  -- A manual journal, line by line (a line's amount is its debit less its credit); a line's tax on
  -- Tax Payable, on the line's side.
  union all
  select d.id, d.kind, d.doc_date, l.account, round(greatest(l.amount, 0) * d.fx_rate)::bigint, round(greatest(-l.amount, 0) * d.fx_rate)::bigint, d.zoho_id is not null
  from doc d join line l on l.doc_id = d.id where d.kind = 'journal'
  union all
  select d.id, d.kind, d.doc_date, 'Tax Payable',
    round(case when l.amount >= 0 then l.tax else 0 end * d.fx_rate)::bigint, round(case when l.amount >= 0 then 0 else l.tax end * d.fx_rate)::bigint, d.zoho_id is not null
  from doc d join line l on l.doc_id = d.id where d.kind = 'journal' and l.tax <> 0
  -- Money moved between two accounts; a deposit (interest, other income) into a bank.
  union all
  select d.id, d.kind, d.doc_date, d.money_account, round(d.total * d.fx_rate)::bigint, 0, d.zoho_id is not null
  from doc d where d.kind in ('transfer_fund', 'deposit')
  union all
  select d.id, d.kind, d.doc_date, d.from_account, 0, round(d.total * d.fx_rate)::bigint, d.zoho_id is not null
  from doc d where d.kind in ('transfer_fund', 'deposit')
  -- A credit note's money given back: out of the account it was paid from.
  union all
  select d.id, d.kind, d.doc_date, coalesce(d.money_account, 'Petty Cash'), 0, round(d.total * d.fx_rate)::bigint, d.zoho_id is not null
  from doc d where d.kind = 'refund'
  union all
  select d.id, d.kind, d.doc_date, 'Accounts Receivable', round(d.total * d.fx_rate)::bigint, 0, d.zoho_id is not null
  from doc d where d.kind = 'refund'
  -- A bill owed to a vendor (a vendor credit the other way): its lines on their accounts, their tax.
  union all
  select d.id, d.kind, d.doc_date, coalesce(d.party_account, 'Accounts Payable'),
    case when d.kind = 'vendor_credit' then round(d.total * d.fx_rate)::bigint else 0 end,
    case when d.kind = 'bill' then round(d.total * d.fx_rate)::bigint else 0 end, d.zoho_id is not null
  from doc d where d.kind in ('bill', 'vendor_credit')
  union all
  select d.id, d.kind, d.doc_date, coalesce(l.account, 'Cost of Goods Sold'),
    case when d.kind = 'bill' then round(l.amount * d.fx_rate)::bigint else 0 end,
    case when d.kind = 'vendor_credit' then round(l.amount * d.fx_rate)::bigint else 0 end, d.zoho_id is not null
  from doc d join line l on l.doc_id = d.id where d.kind in ('bill', 'vendor_credit')
  union all
  -- What the lines don't hold (tax, discount, adjustment), as one amount on Tax Payable.
  select d.id, d.kind, d.doc_date, 'Tax Payable',
    case when d.kind = 'bill' then greatest(r.rest, 0) else greatest(-r.rest, 0) end,
    case when d.kind = 'bill' then greatest(-r.rest, 0) else greatest(r.rest, 0) end, d.zoho_id is not null
  from doc d join lateral (
    select round((d.total - coalesce(sum(l.amount), 0)) * d.fx_rate)::bigint as rest from book_line l where l.doc_id = d.id
  ) r on r.rest <> 0
  where d.kind in ('bill', 'vendor_credit')
  -- An invoice owed by a customer (a credit note the other way): its lines' income, the rest on Tax Payable.
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
create table book_ledger (
  doc_id bigint not null references book_doc (id),
  kind text not null,
  on_date date not null,
  account text,
  debit bigint not null default 0,
  credit bigint not null default 0
);
--> statement-breakpoint
create index book_ledger_account on book_ledger (lower(account), on_date desc);
--> statement-breakpoint
create index book_ledger_doc on book_ledger (doc_id);
--> statement-breakpoint
create or replace function refresh_book_ledger() returns integer
language plpgsql as $$
declare
  written integer;
begin
  delete from book_ledger;
  insert into book_ledger (doc_id, kind, on_date, account, debit, credit)
    select doc_id, kind, on_date, account, debit, credit from book_entry_calc where zoho;
  get diagnostics written = row_count;
  return written;
end
$$;
--> statement-breakpoint
-- Every document's debits and credits: Zoho's as written down, this CRM's own as they stand.
create view book_entry as
  select doc_id, kind, on_date, account, debit, credit from book_ledger
  union all
  select doc_id, kind, on_date, account, debit, credit from book_entry_calc where not zoho;
--> statement-breakpoint
select refresh_book_ledger();
