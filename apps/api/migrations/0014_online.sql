-- The Online desk: each enquiry is a case (Leads & enquiries), worked by an agent from the first
-- message to the order. Its papers and its timeline are kept with it; its order joins the same
-- order line as a MedRep's, with the agent as the Online channel's MedRep.

create table lead (
  id bigint generated always as identity primary key,
  code text unique,
  -- Where it came in. Messenger, the websites and email are typed in by hand until they connect.
  source text not null check (source in ('messenger', 'facebook', 'instagram', 'website_2mg', 'website_capsandpills', 'phone', 'walk_in', 'referral', 'email', 'other')),
  -- Who is writing, and the patient when it is someone else (a daughter for her father).
  name text not null,
  relation text,
  patient_name text,
  phone text,
  -- The phone's last ten digits, so 0917…, +63917… and 917… are one number.
  phone_key text,
  email text,
  city text,
  address text,
  -- The patient once on file (made when the order is placed, or found by the number).
  customer_id bigint references customer (id),
  assigned_to bigint references person (id),
  -- How the patient pays: a regular sale, the senior citizen or PWD discount, or a guarantee letter.
  road text not null default 'regular' check (road in ('regular', 'senior', 'pwd', 'gl')),
  agency text check (agency in ('dswd', 'pcso', 'ovp', 'op')),
  request text,
  -- The quotation: [{ medicineId, medicine, qty, listPrice, unitPrice, reason, vat, rx }], pesos as centavos.
  quote_lines jsonb not null default '[]'::jsonb,
  -- The road (and agency) the quotation was saved for: changing the road asks for it again.
  quote_road text,
  quote_agency text,
  quote_saved_at timestamptz,
  quote_sent_via text,
  quote_sent_at timestamptz,
  -- The guarantee letter's road: applied, the letter in, checked.
  gl_applied_on date,
  gl_letter_no text,
  gl_amount integer check (gl_amount >= 0),
  gl_letter_on date,
  gl_verified_at timestamptz,
  gl_verified_by bigint references person (id),
  state text not null default 'open' check (state in ('open', 'lost')),
  lost_reason text,
  order_id bigint references sales_order (id),
  first_contact_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  -- Someone opened the case: until then its card stays light blue.
  opened_at timestamptz,
  created_by bigint not null references person (id),
  created_at timestamptz not null default now()
);
--> statement-breakpoint
create index lead_desk on lead (state, first_contact_at desc);
--> statement-breakpoint
create index lead_phone on lead (phone_key) where phone_key is not null;
--> statement-breakpoint
create index lead_assigned on lead (assigned_to);
--> statement-breakpoint
create index lead_order on lead (order_id) where order_id is not null;
--> statement-breakpoint

-- A photo or PDF on a case: a prescription, an ID, the guarantee letter. Filed means checked:
-- the agent reads a paper before filing it. A removed one is kept, marked inactive.
create table lead_file (
  id bigint generated always as identity primary key,
  lead_id bigint not null references lead (id),
  kind text not null check (kind in ('rx', 'osca_id', 'pwd_id', 'pwd_booklet', 'valid_id', 'med_cert', 'gl_letter', 'other')),
  name text not null,
  mime text not null,
  size integer not null check (size > 0),
  data bytea not null,
  by_person bigint not null references person (id),
  at timestamptz not null default now(),
  active boolean not null default true
);
--> statement-breakpoint
create index lead_file_lead on lead_file (lead_id) where active;
--> statement-breakpoint

-- The case's timeline: notes, what changed, and (once Messenger connects) the conversation.
create table lead_event (
  id bigint generated always as identity primary key,
  lead_id bigint not null references lead (id),
  kind text not null,
  message text not null,
  by_person bigint not null references person (id),
  at timestamptz not null default now()
);
--> statement-breakpoint
create index lead_event_lead on lead_event (lead_id, at);
--> statement-breakpoint

-- The order a case became, and its lines' statutory relief (senior / PWD: 20% off and no VAT,
-- which is the law, not a price Management decides on).
alter table sales_order add column lead_id bigint references lead (id);
--> statement-breakpoint
alter table order_item add column relief boolean not null default false;
--> statement-breakpoint
insert into counter (name, value) values ('lead', 0);
