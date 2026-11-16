-- B2B Telesales (docs/PLAN.md 16.4). A business account's papers: the FDA licence (licence_no,
-- licence_expires) and the BIR TIN were there already; the business permit joins them.
alter table customer add column permit_no text;
--> statement-breakpoint
alter table customer add column permit_expires date;
--> statement-breakpoint
-- A business account's way through B2B: the NBD who brought it in (a prospect until its first
-- order), the CRR it is handed to (at its 3rd order or day 90), the next call planned, or why it
-- was dropped. Its stage is read from the papers, the calls and the orders, not kept here.
create table b2b_account (
  customer_id bigint primary key references customer (id),
  nbd_id bigint references person (id),
  crr_id bigint references person (id),
  next_call_on date,
  handed_over_at timestamptz,
  handed_over_by bigint references person (id),
  dropped_at timestamptz,
  dropped_reason text,
  created_at timestamptz not null default now()
);
--> statement-breakpoint
create index b2b_account_nbd on b2b_account (nbd_id) where handed_over_at is null and dropped_at is null;
--> statement-breakpoint
create index b2b_account_crr on b2b_account (crr_id);
--> statement-breakpoint
-- Each call to an account: what came of it and when to call next.
create table account_call (
  id bigint generated always as identity primary key,
  customer_id bigint not null references customer (id),
  by_person bigint not null references person (id),
  at timestamptz not null default now(),
  outcome text not null check (outcome in ('reached', 'no_answer', 'call_back', 'ordered', 'not_interested', 'won_back')),
  note text,
  next_on date
);
--> statement-breakpoint
create index account_call_customer on account_call (customer_id, at desc);
