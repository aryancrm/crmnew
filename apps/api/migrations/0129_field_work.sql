-- SEFMED's work inside the MedRep's own pages (docs/PLAN.md 22). Aryan, 20 Nov: the MRs made orders
-- on the hub and kept their records on SEFMED; join the two in the CRM, in the MR's existing pages,
-- with the company's own hierarchy (the team lead approves, the head and the CEO above see it all).
-- So on the CRM's own visits, customers, visit plan and field expenses: the field day (Start
-- working, place, breaks, the day report), the call's full record on the visit, the CRM order placed
-- at a visit, a customer's field profile (SEFMED's KOL fields), the doctor's prescribing list,
-- follow-ups, the tour plan's days, revisions and deviations, and expenses with GetMeds' SEFMED heads
-- and the day's allowances.

create table field_day (
  id bigint generated always as identity primary key,
  person_id bigint not null references person (id),
  seat_id bigint references seat (id),
  day date not null,
  -- Where the day's work is: Head quarter, Ex-station, Out-station, In transit, Other (a word).
  work_type text not null check (work_type in ('hq', 'ex_station', 'out_station', 'transit', 'other')),
  work_note text,
  cities text[] not null default '{}',
  working_with bigint[] not null default '{}',
  started_at timestamptz not null default now(),
  -- "lat,lng" from the phone, when it shared its place.
  start_place text,
  start_accuracy_m integer,
  ended_at timestamptz,
  end_place text,
  -- The day report: open while the day runs, sent with Stop working, seen by the team lead.
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
create index field_day_report on field_day (report_status, day);
--> statement-breakpoint
create table field_day_event (
  id bigint generated always as identity primary key,
  day_id bigint not null references field_day (id),
  kind text not null check (kind in ('start', 'place', 'break', 'resume', 'stop')),
  at timestamptz not null default now(),
  place text,
  work_type text,
  cities text[],
  note text
);
--> statement-breakpoint
create index field_day_event_day on field_day_event (day_id, at);
--> statement-breakpoint
-- A planned visit not done by the day report is missed, with its reason.
do $$
declare found text;
begin
  for found in
    select conname from pg_constraint
    where conrelid = 'visit'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%''planned''::text, ''done''::text, ''skipped''::text%'
  loop
    execute format('alter table visit drop constraint %I', found);
  end loop;
end $$;
--> statement-breakpoint
alter table visit add constraint visit_status check (status in ('planned', 'done', 'skipped', 'missed'));
--> statement-breakpoint
alter table visit add constraint visit_missed_reason check (status <> 'missed' or skip_reason is not null);
--> statement-breakpoint
drop index visit_once;
--> statement-breakpoint
create unique index visit_once on visit (person_id, customer_id, day) where status in ('planned', 'done');
--> statement-breakpoint
-- The call objective(s) and the objective's remark; who came along; how high it stands.
alter table visit add column objectives text[] not null default '{}';
--> statement-breakpoint
alter table visit add column objective_note text;
--> statement-breakpoint
alter table visit add column working_with bigint[] not null default '{}';
--> statement-breakpoint
alter table visit add column priority smallint check (priority between 1 and 3);
--> statement-breakpoint
-- Added on the day itself (not in the plan), with why.
alter table visit add column unplanned boolean not null default false;
--> statement-breakpoint
alter table visit add column added_why text;
--> statement-breakpoint
-- How the call went: met or not, promotional or business, what came of it, productive or not
-- (said by the MR, never worked out; "pending" waits for the team lead, who judges it).
alter table visit add column meeting text check (meeting in ('met', 'not_met', 'unavailable', 'cancelled'));
--> statement-breakpoint
alter table visit add column nature text check (nature in ('promotional', 'business', 'both'));
--> statement-breakpoint
alter table visit add column outcome text check (outcome in ('business', 'opportunity', 'follow_up', 'none'));
--> statement-breakpoint
alter table visit add column productive text check (productive in ('yes', 'no', 'pending'));
--> statement-breakpoint
alter table visit add column judged_by bigint references person (id);
--> statement-breakpoint
alter table visit add column judged_at timestamptz;
--> statement-breakpoint
alter table visit add column judge_note text;
--> statement-breakpoint
alter table visit add column feedback text;
--> statement-breakpoint
-- A chance of business (centavos) and when it may come.
alter table visit add column chance_amount bigint check (chance_amount is null or chance_amount > 0);
--> statement-breakpoint
alter table visit add column chance_on date;
--> statement-breakpoint
-- A hospital's or a firm's own answers: { met: [names], pharmacy, purchasing, institutional,
-- chemist, money, market, competitors }. The products of the call stay in `detailed`, each line
-- now also promoted, prescribing, competitor, stock, sold, demand.
alter table visit add column call jsonb not null default '{}'::jsonb;
--> statement-breakpoint
alter table visit add column closed_place text;
--> statement-breakpoint
alter table visit add column closed_distance_m integer;
--> statement-breakpoint
-- The call's form as typed so far (kept while the MR steps out to place the order).
alter table visit add column draft jsonb;
--> statement-breakpoint
-- Every change to a visit, kept: added on the day, moved, skipped, missed, closed, reopened, judged.
create table visit_change (
  id bigint generated always as identity primary key,
  visit_id bigint not null references visit (id),
  what text not null check (what in ('added', 'moved', 'skipped', 'missed', 'closed', 'reopened', 'judged')),
  from_day date,
  to_day date,
  note text,
  by_person bigint not null references person (id),
  at timestamptz not null default now()
);
--> statement-breakpoint
create index visit_change_visit on visit_change (visit_id, at);
--> statement-breakpoint
-- A call's photos (through the file store).
create table visit_file (
  id bigint generated always as identity primary key,
  visit_id bigint not null references visit (id),
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
create index visit_file_visit on visit_file (visit_id);
--> statement-breakpoint
-- The CRM order placed at a visit (the hub's order and SEFMED's record, joined).
create table visit_order (
  order_id bigint primary key references sales_order (id),
  visit_id bigint not null references visit (id),
  at timestamptz not null default now()
);
--> statement-breakpoint
create index visit_order_visit on visit_order (visit_id);
--> statement-breakpoint
-- A customer's field profile (SEFMED's KOL / hospital / firm fields that the order line doesn't
-- need): kept apart from the customer record, which stays as it is.
create table customer_field (
  customer_id bigint primary key references customer (id),
  dispensing boolean,
  qualification text,
  gender text check (gender in ('male', 'female', 'other')),
  hospital_type text check (hospital_type in ('government', 'private')),
  hospital_class text check (hospital_class in ('general', 'specialty')),
  firm_type text check (firm_type in ('super_stockist', 'distributor', 'sub_distributor', 'stockist', 'retailer')),
  contact_person text,
  zone text,
  pref_days text[] not null default '{}',
  pref_time text,
  -- The firm that serves a doctor.
  firm_id bigint references customer (id),
  visits_a_month smallint check (visits_a_month between 0 and 31),
  -- Off the field's lists (SEFMED's Delete): asked by an MR with why, answered by the team lead.
  off_list boolean not null default false,
  off_asked_by bigint references person (id),
  off_asked_at timestamptz,
  off_why text,
  changed_by bigint references person (id),
  changed_at timestamptz not null default now(),
  check (firm_id is null or firm_id <> customer_id)
);
--> statement-breakpoint
-- The medicines a doctor prescribes as the MR last saw it (SEFMED's Prescribing drugs, top five).
create table field_prescribing (
  customer_id bigint not null references customer (id),
  medicine_id bigint not null references medicine (id),
  prescribing boolean not null default true,
  top5 boolean not null default false,
  by_person bigint not null references person (id),
  at timestamptz not null default now(),
  primary key (customer_id, medicine_id)
);
--> statement-breakpoint
-- What to do next for a customer: visit again, an order, a payment, a product, a chance.
create table field_follow_up (
  id bigint generated always as identity primary key,
  person_id bigint not null references person (id),
  customer_id bigint not null references customer (id),
  visit_id bigint references visit (id),
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
create index field_follow_up_person on field_follow_up (person_id, status, due_on);
--> statement-breakpoint
-- The tour plan: each sending of the month is a revision; what the team lead decided is kept as
-- it was (the plan of record); a planned day has its work place, cities and who works along; a
-- change after approval is a deviation with the MR's reason, for the lead.
alter table visit_plan add column revision integer not null default 0;
--> statement-breakpoint
create table plan_day (
  person_id bigint not null references person (id),
  day date not null,
  work_type text not null check (work_type in ('hq', 'ex_station', 'out_station', 'transit', 'other')),
  cities text[] not null default '{}',
  working_with bigint[] not null default '{}',
  note text,
  primary key (person_id, day)
);
--> statement-breakpoint
create table plan_revision (
  id bigint generated always as identity primary key,
  plan_id bigint not null references visit_plan (id),
  revision integer not null,
  status text not null check (status in ('approved', 'sent_back')),
  decided_by bigint not null references person (id),
  decided_at timestamptz not null default now(),
  note text,
  -- The plan as it was: [{ day, workType, cities }] and [{ visitId, day, customerId }].
  days jsonb not null,
  visits jsonb not null,
  unique (plan_id, revision)
);
--> statement-breakpoint
create table plan_deviation (
  id bigint generated always as identity primary key,
  person_id bigint not null references person (id),
  day date not null,
  kind text not null check (kind in ('moved', 'added', 'dropped', 'place')),
  visit_id bigint references visit (id),
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
create index plan_deviation_status on plan_deviation (status, person_id);
--> statement-breakpoint
-- Expense heads as GetMeds used them in SEFMED. Per diem and TA are worked out for each day
-- worked (their rates are the company's; 0 until set); the rest are claimed with the bill.
create table field_expense_head (
  code text primary key,
  name text not null,
  allowance text check (allowance in ('per_diem', 'ta')),
  needs_bill boolean not null default true,
  active boolean not null default true,
  sort integer not null
);
--> statement-breakpoint
insert into field_expense_head (code, name, allowance, needs_bill, active, sort) values
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
-- The day's allowances by work place (centavos), set by a team lead or the Admin; 0 = not set.
create table field_allowance (
  work_type text primary key check (work_type in ('hq', 'ex_station', 'out_station', 'transit', 'other')),
  per_diem bigint not null default 0 check (per_diem >= 0),
  ta bigint not null default 0 check (ta >= 0),
  set_by bigint references person (id),
  set_at timestamptz
);
--> statement-breakpoint
insert into field_allowance (work_type) values ('hq'), ('ex_station'), ('out_station'), ('transit'), ('other');
--> statement-breakpoint
-- Field expenses take a head (the old kinds stay on old lines), a day's allowance worked out
-- (`generated`, an `auto` line, `open` until claimed) and the amount the lead approved (it may be
-- less than claimed). `amount` stays the amount claimed; `pending` is claimed and waiting.
alter table field_expense add column head text references field_expense_head (code);
--> statement-breakpoint
alter table field_expense add column auto boolean not null default false;
--> statement-breakpoint
alter table field_expense add column generated bigint not null default 0 check (generated >= 0);
--> statement-breakpoint
alter table field_expense add column approved_amount bigint check (approved_amount is null or approved_amount >= 0);
--> statement-breakpoint
alter table field_expense alter column kind drop not null;
--> statement-breakpoint
do $$
declare found text;
begin
  for found in
    select conname from pg_constraint
    where conrelid = 'field_expense'::regclass and contype = 'c'
      and (pg_get_constraintdef(oid) like '%note IS NOT NULL%'
        or pg_get_constraintdef(oid) like '%receipt_data IS NOT NULL%'
        or pg_get_constraintdef(oid) like '%amount > 0%'
        or pg_get_constraintdef(oid) like '%''pending''::text, ''approved''::text, ''sent_back''::text%')
  loop
    execute format('alter table field_expense drop constraint %I', found);
  end loop;
end $$;
--> statement-breakpoint
alter table field_expense add constraint field_expense_status check (status in ('open', 'pending', 'approved', 'sent_back'));
--> statement-breakpoint
alter table field_expense add constraint field_expense_what check (kind is not null or head is not null);
--> statement-breakpoint
alter table field_expense add constraint field_expense_other_note check (kind is null or kind <> 'other' or note is not null);
--> statement-breakpoint
alter table field_expense add constraint field_expense_receipt check (
  head is not null or kind = 'fare' or receipt_data is not null or receipt_key is not null);
--> statement-breakpoint
alter table field_expense add constraint field_expense_amount check (amount >= 0 and (amount > 0 or status = 'open'));
--> statement-breakpoint
create unique index field_expense_auto on field_expense (person_id, day, head) where auto;
