-- The accounts a document names, in columns of their own (docs/PLAN.md 17): reading them out of
-- each document's Zoho fields made adding up the whole chart slow. A trigger keeps them as the
-- fields say, for Zoho's documents and for the ones made here.
alter table book_doc add column money_account text;
--> statement-breakpoint
alter table book_doc add column from_account text;
--> statement-breakpoint
alter table book_doc add column party_account text;
--> statement-breakpoint
create or replace function book_doc_accounts() returns trigger
language plpgsql as $$
begin
  -- The bank or cash account money went into or came out of.
  new.money_account := coalesce(new.fields->>'Deposit To', new.fields->>'deposit_to_account_name', new.fields->>'Paid Through',
    new.fields->>'paid_through_account_name', new.fields->>'Refund From Account', new.fields->>'To Account');
  new.from_account := new.fields->>'From Account';
  -- Receivables or payables, as the document names them.
  new.party_account := coalesce(new.fields->>'Accounts Receivable', new.fields->>'Accounts Payable');
  return new;
end
$$;
--> statement-breakpoint
create trigger book_doc_accounts before insert or update of fields on book_doc
  for each row execute function book_doc_accounts();
--> statement-breakpoint
update book_doc set
  money_account = coalesce(fields->>'Deposit To', fields->>'deposit_to_account_name', fields->>'Paid Through',
    fields->>'paid_through_account_name', fields->>'Refund From Account', fields->>'To Account'),
  from_account = fields->>'From Account',
  party_account = coalesce(fields->>'Accounts Receivable', fields->>'Accounts Payable')
where kind in ('customer_payment', 'vendor_payment', 'expense', 'transfer_fund', 'deposit', 'refund', 'bill', 'vendor_credit', 'invoice', 'credit_note');
--> statement-breakpoint
-- A line's account: the line's own, else its document's (Zoho repeats it on every row).
update book_line l set account = coalesce(l.fields->>'Account', l.fields->>'account_name', d.fields->>'Account')
from book_doc d
where d.id = l.doc_id and l.account is null and d.kind in ('invoice', 'credit_note', 'bill', 'vendor_credit')
  and coalesce(l.fields->>'Account', l.fields->>'account_name', d.fields->>'Account') is not null;
--> statement-breakpoint
create index book_doc_money on book_doc (lower(money_account)) where money_account is not null;
--> statement-breakpoint

create or replace view book_entry as
  -- Not materialized: each part below reads only its own kind, through the indexes.
  with doc as not materialized (
    select d.id, d.kind, d.doc_date, d.total, d.fx_rate, d.money_account, d.from_account, d.party_account, d.fields
    from book_doc d
    where d.voided_at is null and d.status not in ('void', 'draft', 'pending_approval')
  ),
  line as not materialized (
    select l.doc_id, l.n, l.account, l.description, coalesce(l.amount, 0) as amount, coalesce(l.tax_amount, 0) as tax
    from book_line l
  )
  -- Money received: into the account it was deposited to, off what the customer owed.
  select d.id as doc_id, d.kind, d.doc_date as on_date, coalesce(d.money_account, 'Undeposited Funds') as account,
    round(d.total * d.fx_rate)::bigint as debit, 0::bigint as credit
  from doc d where d.kind = 'customer_payment'
  union all
  select d.id, d.kind, d.doc_date, coalesce(d.party_account, 'Accounts Receivable'), 0, round(d.total * d.fx_rate)::bigint
  from doc d where d.kind = 'customer_payment'
  -- Money paid to a vendor: out of the account it was paid through, off what was owed to them.
  union all
  select d.id, d.kind, d.doc_date, coalesce(d.money_account, 'Petty Cash'), 0, round(d.total * d.fx_rate)::bigint
  from doc d where d.kind = 'vendor_payment'
  union all
  select d.id, d.kind, d.doc_date, coalesce(d.party_account, 'Accounts Payable'), round(d.total * d.fx_rate)::bigint, 0
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
  select d.id, d.kind, d.doc_date, coalesce(d.money_account, 'Petty Cash'), 0, round(d.total * d.fx_rate)::bigint
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
  select d.id, d.kind, d.doc_date, d.money_account, round(d.total * d.fx_rate)::bigint, 0
  from doc d where d.kind in ('transfer_fund', 'deposit')
  union all
  select d.id, d.kind, d.doc_date, d.from_account, 0, round(d.total * d.fx_rate)::bigint
  from doc d where d.kind in ('transfer_fund', 'deposit')
  -- A credit note's money given back: out of the account it was paid from.
  union all
  select d.id, d.kind, d.doc_date, coalesce(d.money_account, 'Petty Cash'), 0, round(d.total * d.fx_rate)::bigint
  from doc d where d.kind = 'refund'
  union all
  select d.id, d.kind, d.doc_date, 'Accounts Receivable', round(d.total * d.fx_rate)::bigint, 0
  from doc d where d.kind = 'refund'
  -- A bill owed to a vendor (a vendor credit the other way): its lines on their accounts, their tax.
  union all
  select d.id, d.kind, d.doc_date, coalesce(d.party_account, 'Accounts Payable'),
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
  select d.id, d.kind, d.doc_date, coalesce(d.party_account, 'Accounts Receivable'),
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
