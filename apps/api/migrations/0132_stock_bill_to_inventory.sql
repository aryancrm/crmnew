-- A bill's line for a medicine, with no account typed, was posted to Cost of Goods Sold; the same
-- pieces are posted to Cost of Goods Sold again when they are delivered (crm_entry), so their cost
-- was counted twice and Inventory Asset went below nothing. A medicine bought is stock: its bill
-- line sits in Inventory Asset until it is sold (Aryan's go, 22 Nov). A line with no medicine and no
-- account stays an expense, as before. Zoho's own bills keep the lines Zoho wrote (book_ledger).
create or replace view book_entry_calc as
  -- Not materialized: each part below reads only its own kind, through the indexes.
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
  -- Money received: into the account it was deposited to, off what the customer owed.
  select d.id as doc_id, d.kind, d.doc_date as on_date, coalesce(d.money_account, 'Undeposited Funds') as account,
    round((d.total - d.charges) * d.fx_rate)::bigint as debit, 0::bigint as credit, d.zoho_id is not null as zoho
  from doc d where d.kind = 'customer_payment'
  union all
  select d.id, d.kind, d.doc_date, coalesce(d.party_account, 'Accounts Receivable'), 0, round((d.total + d.withheld) * d.fx_rate)::bigint, d.zoho_id is not null
  from doc d where d.kind = 'customer_payment'
  -- Tax the customer withheld: off what they owed too, kept as Advance Tax (creditable).
  union all
  select d.id, d.kind, d.doc_date, coalesce(d.tax_account, 'Advance Tax'), round(d.withheld * d.fx_rate)::bigint, 0, d.zoho_id is not null
  from doc d where d.kind = 'customer_payment' and d.withheld <> 0
  -- Money paid to a vendor: out of the account it was paid through, off what was owed to them.
  union all
  select d.id, d.kind, d.doc_date, coalesce(d.money_account, 'Petty Cash'), 0, round((d.total + d.charges) * d.fx_rate)::bigint, d.zoho_id is not null
  from doc d where d.kind = 'vendor_payment'
  -- The bank's charge on a payment: out of the money that came in, or on top of what went out.
  union all
  select d.id, d.kind, d.doc_date, 'Bank Fees and Charges', round(d.charges * d.fx_rate)::bigint, 0, d.zoho_id is not null
  from doc d where d.kind in ('customer_payment', 'vendor_payment') and d.charges <> 0
  union all
  select d.id, d.kind, d.doc_date, coalesce(d.party_account, 'Accounts Payable'), round((d.total + d.withheld) * d.fx_rate)::bigint, 0, d.zoho_id is not null
  from doc d where d.kind = 'vendor_payment'
  -- Tax we withheld from the vendor: owed to the government instead.
  union all
  select d.id, d.kind, d.doc_date, coalesce(d.tax_account, 'Withholding Tax Payable'), 0, round(d.withheld * d.fx_rate)::bigint, d.zoho_id is not null
  from doc d where d.kind = 'vendor_payment' and d.withheld <> 0
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
  select d.id, d.kind, d.doc_date, coalesce(l.account, case when l.medicine_id is not null then 'Inventory Asset' else 'Cost of Goods Sold' end),
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
