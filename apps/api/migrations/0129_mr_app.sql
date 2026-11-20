-- The MR App (docs/PLAN.md 22): SEFMED's work as its own app inside the CRM. Aryan, 20 Nov: "make
-- our own SEFMED as a separate app for now, every screen I shared working the same way; two sides,
-- what the MR fills and what the team lead sees; the MRs registered in it have one team lead who
-- sees everything; keep it simple, we tie it to the CRM later". Its own members, doctors (KOLs),
-- hospitals and firms (KBLs), days, visits, orders booked, follow-ups, tour plans and expenses.
-- It reads the CRM's logins and medicines; nothing else in the CRM changes.

-- Who is in the app: MRs, and one team lead who sees everyone's work.
create table mr_member (
  person_id bigint primary key references person (id),
  role text not null check (role in ('mr', 'lead')),
  active boolean not null default true,
  added_by bigint not null references person (id),
  added_at timestamptz not null default now(),
  left_at timestamptz,
  check (active or left_at is not null)
);
--> statement-breakpoint
create unique index mr_one_lead on mr_member ((true)) where role = 'lead' and active;
--> statement-breakpoint
-- Doctors (KOLs), hospitals and firms (KBLs: distributors, stockists, retailers), each once,
-- assigned to an MR (SEFMED's "Assign employees").
create table mr_client (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('doctor', 'hospital', 'firm')),
  code text not null unique,
  name text not null,
  specialty text,
  -- A doctor's category (A–E) and dispensing or not.
  category text check (category in ('A', 'B', 'C', 'D', 'E')),
  dispensing boolean,
  qualification text,
  registration_no text,
  gender text check (gender in ('male', 'female', 'other')),
  hospital_type text check (hospital_type in ('government', 'private')),
  hospital_class text check (hospital_class in ('general', 'specialty')),
  firm_type text check (firm_type in ('super_stockist', 'distributor', 'sub_distributor', 'stockist', 'retailer')),
  contact_person text,
  phone text,
  email text,
  address text,
  city text,
  -- SEFMED's zone: the region.
  zone text,
  -- "lat,lng" of the place, set from a check-in there.
  pin text,
  -- Best days ('mon'…'sun') and time to visit.
  pref_days text[] not null default '{}',
  pref_time text,
  -- A doctor's hospital, and the firm that serves them.
  works_at bigint references mr_client (id),
  firm_id bigint references mr_client (id),
  assigned_to bigint references person (id),
  -- SEFMED's visit frequency: visits a month.
  visits_a_month smallint check (visits_a_month between 0 and 31),
  note text,
  active boolean not null default true,
  added_by bigint not null references person (id),
  added_at timestamptz not null default now(),
  -- An MR's request to take it off the list (SEFMED's Delete request), for the team lead.
  delete_asked_by bigint references person (id),
  delete_asked_at timestamptz,
  delete_why text,
  -- The CRM customer it is, once the app is tied to the CRM (later).
  customer_id bigint references customer (id),
  check (works_at is null or works_at <> id),
  check (firm_id is null or firm_id <> id)
);
--> statement-breakpoint
create unique index mr_client_once on mr_client (kind, lower(name), lower(coalesce(city, ''))) where active;
--> statement-breakpoint
create index mr_client_assigned on mr_client (assigned_to, kind) where active;
--> statement-breakpoint
insert into counter (name, value) values ('mr_doctor', 0), ('mr_hospital', 0), ('mr_firm', 0), ('mr_order', 0)
  on conflict (name) do nothing;
--> statement-breakpoint
-- The MR's working day: Start working (where, the day's cities, with whom, the phone's place),
-- changes of place, breaks, the day report that ends it, the team lead's look.
create table mr_day (
  id bigint generated always as identity primary key,
  person_id bigint not null references person (id),
  day date not null,
  work_type text not null check (work_type in ('hq', 'ex_station', 'out_station', 'transit', 'other')),
  work_note text,
  cities text[] not null default '{}',
  working_with bigint[] not null default '{}',
  started_at timestamptz not null default now(),
  start_place text,
  start_accuracy_m integer,
  ended_at timestamptz,
  end_place text,
  report_status text not null default 'open' check (report_status in ('open', 'sent', 'seen')),
  report_note text,
  sent_at timestamptz,
  seen_by bigint references person (id),
  seen_at timestamptz,
  seen_note text,
  unique (person_id, day),
  check (work_type <> 'other' or work_note is not null),
  check (report_status = 'open' or (sent_at is not null and ended_at is not null)),
  check (report_status <> 'seen' or (seen_by is not null and seen_at is not null))
);
--> statement-breakpoint
create index mr_day_report on mr_day (report_status, day);
--> statement-breakpoint
create table mr_day_event (
  id bigint generated always as identity primary key,
  day_id bigint not null references mr_day (id),
  kind text not null check (kind in ('start', 'place', 'break', 'resume', 'stop')),
  at timestamptz not null default now(),
  place text,
  work_type text,
  cities text[],
  note text
);
--> statement-breakpoint
create index mr_day_event_day on mr_day_event (day_id, at);
--> statement-breakpoint
-- A visit: planned (from the tour plan, or added on the day with why), checked in (I'm here),
-- closed with its call, skipped, or missed at the day report (both with their reason).
create table mr_visit (
  id bigint generated always as identity primary key,
  person_id bigint not null references person (id),
  client_id bigint not null references mr_client (id),
  day date not null,
  status text not null default 'planned' check (status in ('planned', 'done', 'skipped', 'missed')),
  unplanned boolean not null default false,
  added_why text,
  priority smallint check (priority between 1 and 3),
  objectives text[] not null default '{}',
  -- SEFMED's call objective remark.
  objective_note text,
  working_with bigint[] not null default '{}',
  checked_in_at timestamptz,
  check_in_place text,
  distance_m integer,
  done_at timestamptz,
  closed_place text,
  closed_distance_m integer,
  meeting text check (meeting in ('met', 'not_met', 'unavailable', 'cancelled')),
  nature text check (nature in ('promotional', 'business', 'both')),
  outcome text check (outcome in ('business', 'opportunity', 'follow_up', 'none')),
  -- Said by the MR, never worked out; 'pending' waits for the team lead.
  productive text check (productive in ('yes', 'no', 'pending')),
  judged_by bigint references person (id),
  judged_at timestamptz,
  judge_note text,
  feedback text,
  -- Post-call information (remarks).
  notes text,
  chance_amount bigint check (chance_amount is null or chance_amount > 0),
  chance_on date,
  -- A hospital's or a firm's own answers.
  call jsonb not null default '{}'::jsonb,
  -- [{ medicineId, promoted, samples, prescribing, reaction, competitor, inStock, stock, sold, demand }].
  products jsonb not null default '[]'::jsonb,
  next_day date,
  skip_reason text,
  from_visit bigint references mr_visit (id),
  made_by bigint not null references person (id),
  made_at timestamptz not null default now(),
  check (status <> 'done' or (checked_in_at is not null and done_at is not null)),
  check (status not in ('skipped', 'missed') or skip_reason is not null)
);
--> statement-breakpoint
create unique index mr_visit_once on mr_visit (person_id, client_id, day) where status in ('planned', 'done');
--> statement-breakpoint
create index mr_visit_person_day on mr_visit (person_id, day);
--> statement-breakpoint
create index mr_visit_client on mr_visit (client_id, day desc);
--> statement-breakpoint
-- Every change to a visit, kept: added on the day, moved, skipped, missed, closed, reopened, judged.
create table mr_visit_change (
  id bigint generated always as identity primary key,
  visit_id bigint not null references mr_visit (id),
  what text not null check (what in ('added', 'moved', 'skipped', 'missed', 'closed', 'reopened', 'judged')),
  from_day date,
  to_day date,
  note text,
  by_person bigint not null references person (id),
  at timestamptz not null default now()
);
--> statement-breakpoint
create index mr_visit_change_visit on mr_visit_change (visit_id, at);
--> statement-breakpoint
create table mr_visit_file (
  id bigint generated always as identity primary key,
  visit_id bigint not null references mr_visit (id),
  name text not null,
  mime text not null,
  size integer not null check (size > 0),
  data bytea,
  store_key text,
  by_person bigint not null references person (id),
  at timestamptz not null default now(),
  check (data is not null or store_key is not null)
);
--> statement-breakpoint
create index mr_visit_file_visit on mr_visit_file (visit_id);
--> statement-breakpoint
-- The medicines a doctor prescribes as the MR last saw it (SEFMED's Prescribing drugs, top five).
create table mr_prescribing (
  client_id bigint not null references mr_client (id),
  medicine_id bigint not null references medicine (id),
  prescribing boolean not null default true,
  top5 boolean not null default false,
  by_person bigint not null references person (id),
  at timestamptz not null default now(),
  primary key (client_id, medicine_id)
);
--> statement-breakpoint
-- An order booked (SEFMED's POB): at a visit or from a firm's page. Booked business, not sales;
-- `order_id` waits for the later step that ties it to a CRM order.
create table mr_order (
  id bigint generated always as identity primary key,
  code text not null unique,
  person_id bigint not null references person (id),
  client_id bigint not null references mr_client (id),
  visit_id bigint references mr_visit (id),
  -- [{ medicineId, packs, qty (pieces), price (centavos a piece), amount }].
  lines jsonb not null,
  amount bigint not null check (amount >= 0),
  note text,
  file_name text,
  file_mime text,
  file_size integer,
  file_data bytea,
  file_key text,
  status text not null default 'booked' check (status in ('booked', 'cancelled')),
  made_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancel_note text,
  order_id bigint references sales_order (id),
  check (status <> 'cancelled' or cancel_note is not null)
);
--> statement-breakpoint
create unique index mr_order_visit on mr_order (visit_id) where status <> 'cancelled' and visit_id is not null;
--> statement-breakpoint
create index mr_order_person on mr_order (person_id, made_at);
--> statement-breakpoint
create index mr_order_client on mr_order (client_id, made_at);
--> statement-breakpoint
create table mr_follow_up (
  id bigint generated always as identity primary key,
  person_id bigint not null references person (id),
  client_id bigint not null references mr_client (id),
  visit_id bigint references mr_visit (id),
  due_on date not null,
  kind text not null check (kind in ('visit', 'order', 'payment', 'product', 'opportunity', 'other')),
  what text not null,
  status text not null default 'open' check (status in ('open', 'done', 'dropped')),
  done_at timestamptz,
  done_note text,
  made_at timestamptz not null default now(),
  check (status = 'open' or done_at is not null)
);
--> statement-breakpoint
create index mr_follow_up_person on mr_follow_up (person_id, status, due_on);
--> statement-breakpoint
-- The month's tour plan: made by the MR, sent to the team lead, approved or sent back. Each
-- sending is a revision; what was approved is kept as it was (the plan of record).
create table mr_plan (
  id bigint generated always as identity primary key,
  person_id bigint not null references person (id),
  month date not null,
  status text not null default 'draft' check (status in ('draft', 'sent', 'approved', 'sent_back')),
  revision integer not null default 0,
  sent_at timestamptz,
  decided_by bigint references person (id),
  decided_at timestamptz,
  note text,
  unique (person_id, month),
  check (extract(day from month) = 1)
);
--> statement-breakpoint
-- A planned day: where (work place) and the day's cities, with whom.
create table mr_plan_day (
  person_id bigint not null references person (id),
  day date not null,
  work_type text not null check (work_type in ('hq', 'ex_station', 'out_station', 'transit', 'other')),
  cities text[] not null default '{}',
  working_with bigint[] not null default '{}',
  note text,
  primary key (person_id, day)
);
--> statement-breakpoint
create table mr_plan_revision (
  id bigint generated always as identity primary key,
  plan_id bigint not null references mr_plan (id),
  revision integer not null,
  status text not null check (status in ('approved', 'sent_back')),
  decided_by bigint not null references person (id),
  decided_at timestamptz not null default now(),
  note text,
  -- The plan as it was: [{ day, workType, cities }] and [{ visitId, day, clientId }].
  days jsonb not null,
  visits jsonb not null,
  unique (plan_id, revision)
);
--> statement-breakpoint
-- A change to the approved plan, with the MR's reason; the team lead approves it or not.
create table mr_deviation (
  id bigint generated always as identity primary key,
  person_id bigint not null references person (id),
  day date not null,
  kind text not null check (kind in ('moved', 'added', 'dropped', 'place')),
  visit_id bigint references mr_visit (id),
  from_day date,
  to_day date,
  note text not null,
  status text not null default 'waiting' check (status in ('waiting', 'approved', 'rejected')),
  decided_by bigint references person (id),
  decided_at timestamptz,
  decision_note text,
  made_at timestamptz not null default now()
);
--> statement-breakpoint
create index mr_deviation_status on mr_deviation (status, person_id);
--> statement-breakpoint
-- Expense heads as GetMeds used them in SEFMED. Per diem and TA are worked out for each day
-- worked (their rates are the company's; 0 until set); the rest are added with the bill's photo.
create table mr_expense_head (
  code text primary key,
  name text not null,
  allowance text check (allowance in ('per_diem', 'ta')),
  needs_bill boolean not null default true,
  active boolean not null default true,
  sort integer not null
);
--> statement-breakpoint
insert into mr_expense_head (code, name, allowance, needs_bill, active, sort) values
  ('er_per_diem', 'ER Per Diem', 'per_diem', false, true, 1),
  ('er_ta', 'ER TA', 'ta', false, true, 2),
  ('er_car_plan', 'ER Car Plan Allowance', null, false, true, 3),
  ('er_lodging', 'ER Lodging', null, true, true, 4),
  ('er_fuel', 'ER Fuel', null, true, true, 5),
  ('courier', 'Courier', null, true, true, 6),
  ('er_parking', 'ER Parking Fees', null, true, true, 7),
  ('er_toll', 'ER Toll Fees', null, true, true, 8),
  ('load', 'Load', null, true, true, 9),
  ('mktg_snack', 'Mktg Activities Snack Attack', null, true, true, 10),
  ('mktg_breakfast', 'Mktg Activities Breakfast', null, true, true, 11),
  ('mktg_sponsorship', 'Mktg Activities Sponsorship', null, true, true, 12),
  ('country_mentor', 'Country Mentor', null, true, true, 13),
  ('er_expense_accounts', 'ER Expense Accounts', null, true, true, 14),
  ('er_meals', 'ER Meals', null, true, true, 15),
  ('er_hospital_ids', 'ER Hospital IDs', null, true, true, 16),
  ('er_communication', 'ER Communication Allowance', null, false, true, 17),
  ('sponsored_food', 'Sponsored Food', null, true, true, 18),
  ('misc', 'Misc', null, true, true, 19),
  ('other', 'Other', null, true, true, 20),
  ('er_per_diem_in_base', 'ER Per Diem In Base', null, false, false, 21),
  ('er_per_diem_out_base', 'ER Per Diem Out Base', null, false, false, 22),
  ('er_transport_in_base', 'ER Transport Allow In Base', null, false, false, 23),
  ('er_transport_out_base', 'ER Transport Allow Out Base', null, false, false, 24);
--> statement-breakpoint
-- The day's allowances by work place (centavos), set by the team lead or the Admin; 0 = not set.
create table mr_allowance (
  work_type text primary key check (work_type in ('hq', 'ex_station', 'out_station', 'transit', 'other')),
  per_diem bigint not null default 0 check (per_diem >= 0),
  ta bigint not null default 0 check (ta >= 0),
  set_by bigint references person (id),
  set_at timestamptz
);
--> statement-breakpoint
insert into mr_allowance (work_type) values ('hq'), ('ex_station'), ('out_station'), ('transit'), ('other');
--> statement-breakpoint
-- An expense line: worked out (an allowance for a day worked) and/or claimed by the MR, then
-- approved (the amount may be less) or rejected with why by the team lead.
create table mr_expense (
  id bigint generated always as identity primary key,
  person_id bigint not null references person (id),
  day date not null,
  head text not null references mr_expense_head (code),
  auto boolean not null default false,
  generated bigint not null default 0 check (generated >= 0),
  claimed bigint not null default 0 check (claimed >= 0),
  approved bigint check (approved is null or approved >= 0),
  note text,
  file_name text,
  file_mime text,
  file_size integer,
  file_data bytea,
  file_key text,
  status text not null default 'open' check (status in ('open', 'claimed', 'approved', 'rejected')),
  decided_by bigint references person (id),
  decided_at timestamptz,
  decision_note text,
  made_at timestamptz not null default now(),
  check (status <> 'approved' or approved is not null),
  check (status <> 'rejected' or decision_note is not null),
  check (approved is null or approved <= greatest(claimed, generated))
);
--> statement-breakpoint
create unique index mr_expense_auto on mr_expense (person_id, day, head) where auto;
--> statement-breakpoint
create index mr_expense_person on mr_expense (person_id, day);
