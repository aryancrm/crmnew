-- A hospital's standing for us (docs/CHANNEL-WORK.md, HOSP; Aryan, 19 Nov: "which hospitals each
-- has, whom to call, every relevant thing"): 2MG's accreditation as its supplier (our papers filed
-- with it: SEC/DTI, BIR 2303, the mayor's permit, the FDA LTO, the CPRs) and how long it holds; and
-- each of our medicines on its formulary (asked for by its doctors, decided by its Pharmacy and
-- Therapeutics Committee). Each change is a new line with its day; the latest one stands.
create table hospital_accreditation (
  id bigint generated always as identity primary key,
  customer_id bigint not null references customer (id),
  status text not null check (status in ('applied', 'accredited', 'refused')),
  on_day date not null,
  valid_until date,
  note text,
  by_person bigint not null references person (id),
  at timestamptz not null default now()
);
--> statement-breakpoint
create index hospital_accreditation_customer on hospital_accreditation (customer_id, id);
--> statement-breakpoint
create table hospital_formulary (
  id bigint generated always as identity primary key,
  customer_id bigint not null references customer (id),
  medicine_id bigint not null references medicine (id),
  status text not null check (status in ('requested', 'approved', 'not_approved', 'removed')),
  on_day date not null,
  -- The doctor who asked for it, when one did.
  doctor text,
  note text,
  by_person bigint not null references person (id),
  at timestamptz not null default now()
);
--> statement-breakpoint
create index hospital_formulary_customer on hospital_formulary (customer_id, medicine_id, id);
