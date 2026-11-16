-- Government tenders (docs/PLAN.md 16.6, RA 12009 and its 2025 rules): each tender from the
-- PhilGEPS posting to the payment, with its mode, budget (ABC), deadlines, envelope papers, bid
-- security, our price per medicine, the result, the award and its delivery, acceptance (IAR),
-- billing and payment. Steps move forward and every move is kept; nothing is deleted (a tender
-- not pursued is dropped with its reason).
create table tender (
  id bigint generated always as identity primary key,
  code text not null unique,
  -- The buying agency or government hospital.
  agency_id bigint not null references customer (id),
  title text not null,
  philgeps_ref text,
  mode text not null default 'competitive_bidding' check (mode in ('competitive_bidding', 'limited_source', 'direct_contracting',
    'direct_acquisition', 'repeat_order', 'small_value', 'negotiated', 'direct_sales', 'other')),
  -- The approved budget for the contract, centavos.
  abc bigint check (abc >= 0),
  -- Who runs it, from their seat (the bidding team, or a Hospital CHC for their hospital).
  owner_id bigint not null references person (id),
  seat_id bigint references seat (id),
  step text not null default 'found' check (step in ('found', 'preparing', 'price_approved', 'submitted', 'won', 'lost',
    'contract', 'delivered', 'accepted', 'billed', 'paid', 'dropped')),
  posted_on date,
  prebid_on date,
  deadline_at timestamptz,
  opening_on date,
  -- Our bid, the winning bid when it was not ours, and why (rank, disqualified, over the ABC).
  our_bid bigint check (our_bid >= 0),
  winning_bid bigint check (winning_bid >= 0),
  result_note text,
  noa_on date,
  ntp_on date,
  deliver_by date,
  delivered_on date,
  -- The Inspection and Acceptance Report: the government owes from this day.
  accepted_on date,
  billed_on date,
  paid_on date,
  -- The call-off order the award became.
  order_id bigint references sales_order (id),
  bid_security_form text,
  bid_security_amount bigint check (bid_security_amount >= 0),
  bid_security_back_on date,
  price_approved_by bigint references person (id),
  -- The envelope checklist: [{ "paper": "PhilGEPS Platinum certificate", "done": true }].
  papers jsonb not null default '[]'::jsonb,
  dropped_reason text,
  created_by bigint not null references person (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
--> statement-breakpoint
create index tender_step on tender (step, deadline_at);
--> statement-breakpoint
create index tender_owner on tender (owner_id);
--> statement-breakpoint
-- What we bid, medicine by medicine.
create table tender_line (
  id bigint generated always as identity primary key,
  tender_id bigint not null references tender (id),
  medicine_id bigint not null references medicine (id),
  qty integer not null check (qty > 0),
  -- Our price for one piece, centavos, VAT in.
  unit_price integer not null check (unit_price >= 0)
);
--> statement-breakpoint
create index tender_line_tender on tender_line (tender_id);
--> statement-breakpoint
-- Every step a tender took, by whom, with a note.
create table tender_event (
  id bigint generated always as identity primary key,
  tender_id bigint not null references tender (id),
  step text not null,
  note text,
  by_person bigint not null references person (id),
  at timestamptz not null default now()
);
--> statement-breakpoint
create index tender_event_tender on tender_event (tender_id, at);
--> statement-breakpoint
-- The company's eligibility papers, each with its expiry (PhilGEPS Platinum certificate, mayor's
-- permit, tax clearance, audited statements, FDA LTO, CPRs). A newer copy is added; the old stays.
create table company_paper (
  id bigint generated always as identity primary key,
  name text not null,
  number text,
  expires_on date,
  note text,
  added_by bigint not null references person (id),
  added_at timestamptz not null default now()
);
