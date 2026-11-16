-- Customers as Zoho kept them (docs/PLAN.md 17): every field of Zoho's contact that holds data and
-- has no column of its own here, under Zoho's name, and the customer's people (Zoho's contact
-- persons). Customers that Zoho Books says owed money or held credits no document here explains
-- keep those as opening figures (centavos of pesos), as vendors do.
alter table customer add column zoho_fields jsonb not null default '{}'::jsonb;
--> statement-breakpoint
alter table customer add column opening_receivables bigint not null default 0 check (opening_receivables >= 0);
--> statement-breakpoint
alter table customer add column opening_credits bigint not null default 0 check (opening_credits >= 0);
--> statement-breakpoint
create table customer_person (
  id bigint generated always as identity primary key,
  customer_id bigint not null references customer (id),
  zoho_id text unique,
  name text not null,
  email text,
  phone text,
  mobile text,
  designation text,
  fields jsonb not null default '{}'::jsonb
);
--> statement-breakpoint
create index customer_person_customer on customer_person (customer_id);
