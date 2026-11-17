-- A business customer's licence as Zoho kept it (docs/PLAN.md 19, step B): who holds the licence
-- to operate, what it is for (Hospital, Drugstore, Drug Wholesaler…), the day it was issued. With
-- the number, expiry and TIN already here, the hub's new-customer form is complete.
alter table customer add column licence_owner text;
--> statement-breakpoint
alter table customer add column lto_type text;
--> statement-breakpoint
alter table customer add column licence_issued date;
--> statement-breakpoint
-- A business customer's papers (the hub asked a hospital for all three before creating it): the
-- BIR 2303, the LTO permit, the business permit. Kept for good: one taken off stays, marked.
create table customer_file (
  id bigint generated always as identity primary key,
  customer_id bigint not null references customer (id),
  kind text not null check (kind in ('bir_2303', 'lto_permit', 'business_permit')),
  name text not null,
  mime text not null,
  size integer not null check (size > 0),
  data bytea,
  store_key text,
  by_person bigint not null references person (id),
  at timestamptz not null default now(),
  active boolean not null default true,
  check (data is not null or store_key is not null)
);
--> statement-breakpoint
create index customer_file_customer on customer_file (customer_id) where active;
