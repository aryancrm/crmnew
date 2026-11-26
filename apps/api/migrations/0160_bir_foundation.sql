-- BIR compliance foundation, taxpayer profiles, ATC catalog, company-scoped tax metadata,
-- account mapping (including Sir Rommel's Advances to GPI / Advances to 2MG), and cross-company
-- payment tagging. Strictly additive: leaves all existing tables, book_entry, and crm_entry intact.

-- 1. Registered taxpayer details per legal entity (2mg = 2MG Incorporated, gpi = Getmeds Philippines Incorporated).
-- TIN, branch code, RDO and address stay blank until filled in-app (never invented).
create table if not exists bir_taxpayer_profile (
  company text primary key check (company in ('2mg', 'gpi')),
  registered_name text not null,
  trade_name text not null,
  tin text,
  branch_code text not null default '00000',
  rdo_code text,
  registered_address text,
  regime text not null default 'vat' check (regime in ('vat', 'non_vat')),
  fiscal_month_end integer not null default 12 check (fiscal_month_end between 1 and 12),
  is_tamp boolean not null default true,
  updated_by bigint references person (id),
  updated_at timestamptz not null default now()
);
--> statement-breakpoint
insert into bir_taxpayer_profile (company, registered_name, trade_name) values
  ('2mg', '2MG Incorporated', '2MG Inc.'),
  ('gpi', 'Getmeds Philippines Incorporated', 'GetMeds Philippines Inc.')
on conflict (company) do nothing;
--> statement-breakpoint

-- 2. BIR Alphanumeric Tax Code (ATC) catalog (EWT + Gov't 5% Creditable VAT).
create table if not exists bir_atc_rate (
  code text primary key,
  description text not null,
  rate_bps integer not null check (rate_bps >= 0),
  category text not null check (category in ('ewt', 'vat_withholding', 'final')),
  bir_form text not null check (bir_form in ('1601-EQ', '2550Q', '1601-FQ')),
  active boolean not null default true
);
--> statement-breakpoint
insert into bir_atc_rate (code, description, rate_bps, category, bir_form) values
  ('WC850', 'Direct pharma goods supplier / e-marketplace (0.5%)', 50, 'ewt', '1601-EQ'),
  ('WC158', 'Goods, from a company (top withholding agent)', 100, 'ewt', '1601-EQ'),
  ('WI158', 'Goods, from an individual (top withholding agent)', 100, 'ewt', '1601-EQ'),
  ('WC640', 'Sale of goods to government / designated entities (1%)', 100, 'ewt', '1601-EQ'),
  ('WC160', 'Services, from a company (top withholding agent)', 200, 'ewt', '1601-EQ'),
  ('WI160', 'Services, from an individual (top withholding agent)', 200, 'ewt', '1601-EQ'),
  ('WC157', 'Services to government / designated entities (2%)', 200, 'ewt', '1601-EQ'),
  ('WC120', 'Contractors, companies', 200, 'ewt', '1601-EQ'),
  ('WI120', 'Contractors, individuals', 200, 'ewt', '1601-EQ'),
  ('WC100', 'Rent, to a company', 500, 'ewt', '1601-EQ'),
  ('WI100', 'Rent, to an individual', 500, 'ewt', '1601-EQ'),
  ('WI010', 'Professional fees, individual, gross up to ₱3M', 500, 'ewt', '1601-EQ'),
  ('WI011', 'Professional fees, individual, gross over ₱3M', 1000, 'ewt', '1601-EQ'),
  ('WC010', 'Professional fees, company, gross up to ₱720,000', 1000, 'ewt', '1601-EQ'),
  ('WC011', 'Professional fees, company, gross over ₱720,000', 1500, 'ewt', '1601-EQ'),
  ('WC140', 'Brokerage fees, company, gross over ₱720,000', 1500, 'ewt', '1601-EQ'),
  ('WV010', 'Government VAT withholding on goods (5%)', 500, 'vat_withholding', '2550Q'),
  ('WV020', 'Government VAT withholding on services (5%)', 500, 'vat_withholding', '2550Q')
on conflict (code) do nothing;
--> statement-breakpoint

-- 3. Logical GL account mapping per company (defaults to Aryan's Zoho names + Sir Rommel's Advances to GPI / 2MG).
create table if not exists finance_account_map (
  company text not null check (company in ('2mg', 'gpi')),
  role_key text not null,
  account_name text not null,
  updated_by bigint references person (id),
  updated_at timestamptz not null default now(),
  primary key (company, role_key)
);
--> statement-breakpoint
insert into finance_account_map (company, role_key, account_name) values
  ('2mg', 'ar', 'Accounts Receivable'),
  ('2mg', 'ap', 'Accounts Payable'),
  ('2mg', 'sales', 'Sales'),
  ('2mg', 'tax_payable', 'Tax Payable'),
  ('2mg', 'advance_tax', 'Advance Tax'),
  ('2mg', 'ewt_payable', 'Withholding Tax Payable'),
  ('2mg', 'undeposited_funds', 'Undeposited Funds'),
  ('2mg', 'petty_cash', 'Petty Cash'),
  ('2mg', 'ic_due_from', 'Advances to GPI'),
  ('2mg', 'ic_due_to', 'Advances to GPI'),
  ('gpi', 'ar', 'Accounts Receivable'),
  ('gpi', 'ap', 'Accounts Payable'),
  ('gpi', 'sales', 'Sales'),
  ('gpi', 'tax_payable', 'Tax Payable'),
  ('gpi', 'advance_tax', 'Advance Tax'),
  ('gpi', 'ewt_payable', 'Withholding Tax Payable'),
  ('gpi', 'undeposited_funds', 'Undeposited Funds'),
  ('gpi', 'petty_cash', 'Petty Cash'),
  ('gpi', 'ic_due_from', 'Advances to 2MG'),
  ('gpi', 'ic_due_to', 'Advances to 2MG')
on conflict (company, role_key) do nothing;
--> statement-breakpoint

-- 4. BIR tax metadata on Books bills/expenses (ATC, VAT classification, no-withholding reason, SLI customs).
create table if not exists book_doc_tax_meta (
  doc_id bigint primary key references book_doc (id),
  supplier_origin text check (supplier_origin in ('local', 'foreign')),
  vat_kind text check (vat_kind in ('vat', 'zero', 'exempt', 'none')),
  purchase_type text check (purchase_type in ('services', 'capital_goods', 'other_goods', 'importation')),
  atc_code text references bir_atc_rate (code),
  ewt_base_centavos bigint not null default 0,
  ewt_centavos bigint not null default 0,
  no_withholding_reason text check (no_withholding_reason in ('foreign', 'not_covered', 'government', 'exempt_charge', 'other')),
  no_withholding_note text,
  import_ieird_no text,
  import_assessment_date date,
  import_dutiable_centavos bigint,
  import_vat_centavos bigint,
  updated_by bigint references person (id),
  updated_at timestamptz not null default now()
);
--> statement-breakpoint

-- 5. BIR filing & remittance acknowledgement log per company.
create table if not exists bir_filing_log (
  id bigint generated always as identity primary key,
  company text not null check (company in ('2mg', 'gpi')),
  form_code text not null,
  period_label text not null,
  period_from date not null,
  period_to date not null,
  filed_on date,
  reference_no text,
  amount_due_centavos bigint,
  status text not null default 'draft' check (status in ('draft', 'filed', 'paid', 'amended')),
  notes text,
  by_person bigint references person (id),
  at timestamptz not null default now()
);
--> statement-breakpoint
create index if not exists bir_filing_log_company_period on bir_filing_log (company, period_from desc, form_code);
--> statement-breakpoint

-- 6. Nullable company tags & payment SAWT/slip grouping columns on existing tables.
alter table book_account add column if not exists owner_company text check (owner_company in ('2mg', 'gpi'));
--> statement-breakpoint
alter table book_doc add column if not exists company text check (company in ('2mg', 'gpi'));
--> statement-breakpoint
update book_doc
set company = case
  when lower(trim(fields->>'CF.Company')) in ('2mg', '2mg inc.', '2mg incorporated') then '2mg'
  when lower(trim(fields->>'CF.Company')) in ('gpi', 'getmeds', 'getmeds philippines inc.', 'getmeds philippines incorporated') then 'gpi'
  else company
end
where company is null and fields ? 'CF.Company';
--> statement-breakpoint
create index if not exists book_doc_company_date on book_doc (company, doc_date desc) where company is not null;
--> statement-breakpoint
alter table payment add column if not exists tax_atc text;
--> statement-breakpoint
alter table payment add column if not exists sawt_form text check (sawt_form in ('1702Q', '2550Q'));
--> statement-breakpoint
alter table payment add column if not exists payment_group_id text;
--> statement-breakpoint
create index if not exists payment_group_idx on payment (payment_group_id) where payment_group_id is not null;
