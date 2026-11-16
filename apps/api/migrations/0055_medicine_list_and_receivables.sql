-- The company's medicine list (Finance's price list) brought in with Zoho's SKUs, and what
-- customers were billed, paid and still owe in Zoho.

-- A medicine's suggested retail price (SRP): the printed price a senior citizen's or PWD's
-- discount is taken from. Centavos for one piece, and for a whole pack where the list gives one.
alter table medicine add column srp integer check (srp >= 0);
--> statement-breakpoint
alter table medicine add column srp_pack integer check (srp_pack >= 0);
--> statement-breakpoint
-- How long it keeps from when it is made, in months (the list's "Shelf Life").
alter table medicine add column shelf_life_months integer check (shelf_life_months between 1 and 240);
--> statement-breakpoint
-- The price list's word on it besides its prices ("New Med", "For B2B and bidding").
alter table medicine add column list_note text;
--> statement-breakpoint
-- Kept cold from the shelf to the customer (the list's "[COLD CHAIN]"): Dispatch packs it so.
alter table medicine add column cold_chain boolean not null default false;
--> statement-breakpoint

-- Every SKU a medicine has gone by. Zoho kept some medicines under two or three SKUs over the
-- years (an old code, a duplicate); a past order's line finds its medicine through any of them.
-- A medicine's own SKU is always one of them.
create table medicine_sku (
  id bigint generated always as identity primary key,
  medicine_id bigint not null references medicine (id),
  sku text not null
);
--> statement-breakpoint
create unique index medicine_sku_any_once on medicine_sku (lower(sku));
--> statement-breakpoint
create index medicine_sku_medicine on medicine_sku (medicine_id);
--> statement-breakpoint
insert into medicine_sku (medicine_id, sku) select id, sku from medicine where sku is not null;
--> statement-breakpoint

-- Zoho's invoices: what each customer was billed before this CRM, and what is still owed on it.
-- History, not this CRM's own invoices: Finance's own invoices stay in `invoice`. Bringing them
-- again brings the latest balance (Zoho is still where these are paid until the switch).
create table past_invoice (
  id bigint generated always as identity primary key,
  zoho_id text not null unique,
  code text not null,
  customer_id bigint not null references customer (id),
  -- The sales order it bills, when it came over too.
  past_order_id bigint references past_order (id),
  order_code text,
  issued_on date not null,
  due_on date,
  -- Zoho's word: closed, open, overdue, partiallypaid, void, draft.
  status text not null,
  -- Centavos.
  total bigint not null default 0 check (total >= 0),
  balance bigint not null default 0 check (balance >= 0),
  terms text,
  seller text,
  invoiced_from text
);
--> statement-breakpoint
create index past_invoice_customer on past_invoice (customer_id, issued_on desc);
--> statement-breakpoint
create index past_invoice_code on past_invoice (code);
--> statement-breakpoint
create index past_order_code on past_order (code);
--> statement-breakpoint
create index past_invoice_owed on past_invoice (customer_id) where balance > 0 and status not in ('void', 'draft');
--> statement-breakpoint

-- Zoho's payments, one row per invoice a payment went to (a payment can settle several).
create table past_payment (
  id bigint generated always as identity primary key,
  -- Zoho's id for this payment's share on one invoice (or the payment's own id when it went to none).
  zoho_id text not null unique,
  payment_no text,
  customer_id bigint not null references customer (id),
  past_invoice_id bigint references past_invoice (id),
  invoice_code text,
  paid_on date not null,
  mode text,
  reference text,
  -- Centavos put on this invoice, and the whole payment it was part of.
  amount bigint not null check (amount >= 0),
  payment_total bigint not null check (payment_total >= 0)
);
--> statement-breakpoint
create index past_payment_customer on past_payment (customer_id, paid_on desc);
--> statement-breakpoint
create index past_payment_invoice on past_payment (past_invoice_id) where past_invoice_id is not null;
--> statement-breakpoint

-- Whose customer it was in Zoho. Zoho names a salesperson on each order ("HOS | Juan"), not on the
-- customer: each Zoho contact keeps the salesperson of its latest order, and that order's
-- Division, Sub-division and Headquarter.
alter table zoho_contact add column seller text;
--> statement-breakpoint
alter table zoho_contact add column seller_on date;
--> statement-breakpoint
alter table zoho_contact add column division text;
--> statement-breakpoint
alter table zoho_contact add column sub_division text;
--> statement-breakpoint
alter table zoho_contact add column headquarter text;
--> statement-breakpoint
create index zoho_contact_seller on zoho_contact (seller) where seller is not null;
--> statement-breakpoint

-- Each Zoho salesperson and the seat they are in this CRM (set by the Admin): the customers
-- they last sold to come under that seat's area, so its MedRep, team lead and channel see them.
create table zoho_seller (
  name text primary key,
  seat_id bigint references seat (id),
  set_by bigint references person (id),
  set_at timestamptz
);
--> statement-breakpoint

-- A past order as Zoho had it: the name it was under (a customer joined from two Zoho contacts
-- still shows who ordered), the doctor who referred it and the patient it was for.
alter table past_order add column customer_name text;
--> statement-breakpoint
alter table past_order add column doctor text;
--> statement-breakpoint
alter table past_order add column patient text;
