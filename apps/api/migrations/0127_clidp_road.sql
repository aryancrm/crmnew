-- CLIDP's road with each distributor or pharmacy (Aryan, 19 Nov: "how many pharmacies we went to,
-- did they approve us, at what rate"; the FDA's CLIDP needs a notarized distributorship agreement
-- with 2MG, both LTOs and the labels, and takes 30 working days): approached → interested → agreed
-- (the agreement signed, the rate per medicine agreed) → listing filed with the FDA → listed (the
-- certificate, clidp_listing) → ordering; or declined, with why. Every move is kept. An account
-- already buying is on the road at "ordering" without a row here (its orders say so).
create table clidp_account (
  id bigint generated always as identity primary key,
  customer_id bigint not null unique references customer (id),
  -- The CLIDP Sales Coach who works it.
  coach_id bigint not null references person (id),
  stage text not null default 'approached'
    check (stage in ('approached', 'interested', 'agreed', 'filed', 'listed', 'ordering', 'declined')),
  approached_on date not null,
  interested_on date,
  agreed_on date,
  filed_on date,
  listed_on date,
  declined_on date,
  declined_reason text,
  -- The distributorship agreement's last day.
  agreement_until date,
  next_step text,
  next_on date,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
--> statement-breakpoint
create index clidp_account_coach on clidp_account (coach_id, stage);
--> statement-breakpoint
create table clidp_account_event (
  id bigint generated always as identity primary key,
  account_id bigint not null references clidp_account (id),
  stage text not null,
  note text,
  by_person bigint not null references person (id),
  at timestamptz not null default now()
);
--> statement-breakpoint
create index clidp_account_event_account on clidp_account_event (account_id, at);
--> statement-breakpoint
-- The rate agreed with the distributor, medicine by medicine (one piece, centavos, VAT in), with its
-- minimum order; a new rate replaces the old, which is kept.
create table clidp_rate (
  id bigint generated always as identity primary key,
  customer_id bigint not null references customer (id),
  medicine_id bigint not null references medicine (id),
  unit_price bigint not null check (unit_price >= 0),
  moq integer check (moq > 0),
  agreed_on date not null,
  by_person bigint not null references person (id),
  at timestamptz not null default now(),
  replaced_at timestamptz
);
--> statement-breakpoint
create index clidp_rate_customer on clidp_rate (customer_id);
