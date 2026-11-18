-- Writing the books here (docs/BOOKS-PLAN.md, A and B, 18 Nov 2026): expenses, manual journals,
-- transfers, deposits, credit notes and their refunds are made in this CRM as Zoho Books made them;
-- the chart can grow; a period can be locked. Zoho's lists come over as they are in Zoho (read
-- 18 Nov from Settings → Custom fields and Taxes), so a document made here carries the same fields.

-- The choices of a document's own fields (Zoho's custom fields): an expense's Cost Centre, Type and
-- Department; a journal's or bill's Company and Department.
create table book_option (
  field text not null,
  value text not null,
  sort integer not null default 0,
  active boolean not null default true,
  primary key (field, value)
);
--> statement-breakpoint
insert into book_option (field, value, sort) values
  ('Cost Centre', 'GetMEDS0001', 1), ('Cost Centre', '2MG0001', 2), ('Cost Centre', 'Cenevo0001', 3),
  ('Type', 'Goods', 1), ('Type', 'Services', 2), ('Type', 'Rental', 3), ('Type', 'Others', 4),
  ('Company', 'Getmeds', 1), ('Company', '2MG', 2),
  ('Department', 'MSA', 1), ('Department', 'B2C', 2), ('Department', 'Pharmacy', 3), ('Department', 'Admin', 4),
  ('Department', 'Executives', 5), ('Department', 'Finance', 6), ('Department', 'HR', 7), ('Department', 'Bidding', 8),
  ('Department', 'Procurement', 9), ('Department', 'Regulatory', 10), ('Department', 'Business Development', 11),
  ('Department', 'B2B CRR', 12), ('Department', 'B2B NBD', 13), ('Department', 'Telesales', 14), ('Department', 'CLIDP', 15),
  ('Department', 'DSWD', 16), ('Department', 'Digital Marketing', 17), ('Department', 'STC', 18), ('Department', 'MODERN TRADE', 19),
  ('Department', 'B&B', 20), ('Department', 'MD TELESALES', 21), ('Department', 'Sales Department (Government Account)', 22);
--> statement-breakpoint

-- Zoho's taxes, as named there. Every one posts to Tax Payable, as Zoho's documents did.
create table book_tax (
  id bigint generated always as identity primary key,
  name text not null unique,
  pct numeric(7, 3) not null,
  kind text not null check (kind in ('vat', 'withholding', 'other')),
  active boolean not null default true
);
--> statement-breakpoint
insert into book_tax (name, pct, kind) values
  ('Vat', 12, 'vat'), ('No Tax', 0, 'other'), ('EWT', 1, 'withholding'), ('Withholding Tax', 2, 'withholding'),
  ('RENT', 5, 'withholding'), ('WITHHOLDING TAX RENT', 5, 'withholding'), ('VAT - EWT', 11, 'vat');
--> statement-breakpoint

-- A closed period: no document of the module dated on or before the day can be made, changed or
-- voided. 'all' closes every module at once. Opening it again is kept in the log.
create table book_lock (
  module text primary key check (module in ('all', 'sales', 'purchases', 'banking', 'accountant')),
  lock_date date not null,
  reason text,
  locked_by bigint references person (id),
  locked_at timestamptz not null default now()
);
--> statement-breakpoint
create table book_lock_event (
  id bigint generated always as identity primary key,
  module text not null,
  action text not null check (action in ('lock', 'unlock')),
  lock_date date,
  reason text,
  by_person bigint references person (id),
  at timestamptz not null default now()
);
--> statement-breakpoint

-- A manual journal that undoes itself on a day (Zoho's Reverse Journal Date), and the reversal's own
-- journal pointing back at it.
alter table book_doc add column reverse_on date;
--> statement-breakpoint
alter table book_doc add column reversal_of bigint references book_doc (id);
--> statement-breakpoint

-- Accounts added here.
alter table book_account add column created_by bigint references person (id);
--> statement-breakpoint
alter table book_account add column created_at timestamptz;
