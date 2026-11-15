-- Field step 2: each doctor, hospital or drugstore has a visit class (A–D: how often it is
-- visited a month) and its clinic's pin (where a check-in is compared with). A MedRep's month of
-- planned visits is one plan, sent to their team lead, who approves it or sends it back (Aryan:
-- the team lead runs the field; the CEO reads all of it).
alter table customer add column visit_class text check (visit_class in ('A', 'B', 'C', 'D'));
--> statement-breakpoint
-- "lat,lng" of the clinic, set from a check-in there.
alter table customer add column pin text;
--> statement-breakpoint
alter table customer add column pinned_by bigint references person (id);
--> statement-breakpoint
-- How far the check-in was from the clinic's pin, in metres (null: no pin or no place shared).
alter table visit add column distance_m integer;
--> statement-breakpoint
create table visit_plan (
  id bigint generated always as identity primary key,
  person_id bigint not null references person (id),
  -- The month's first day.
  month date not null,
  status text not null default 'draft' check (status in ('draft', 'sent', 'approved', 'sent_back')),
  sent_at timestamptz,
  decided_by bigint references person (id),
  decided_at timestamptz,
  -- Why it was sent back (or a word with the approval).
  note text,
  unique (person_id, month),
  check (extract(day from month) = 1)
);
--> statement-breakpoint
-- What the field spends: petrol, fares, parking, tolls, food, lodging, other; on a day, with the
-- visit it was for when there is one. The team lead approves each line or sends it back.
create table field_expense (
  id bigint generated always as identity primary key,
  person_id bigint not null references person (id),
  seat_id bigint references seat (id),
  day date not null,
  kind text not null check (kind in ('petrol', 'fare', 'parking', 'toll', 'food', 'lodging', 'other')),
  -- Whole centavos.
  amount integer not null check (amount > 0),
  -- Kilometres driven (petrol).
  km integer check (km is null or km > 0),
  visit_id bigint references visit (id),
  note text,
  -- The bill or payment proof: a photo or PDF (a fare may have none).
  receipt_name text,
  receipt_mime text,
  receipt_size integer check (receipt_size is null or receipt_size > 0),
  receipt_data bytea,
  status text not null default 'pending' check (status in ('pending', 'approved', 'sent_back')),
  decided_by bigint references person (id),
  decided_at timestamptz,
  decision_note text,
  made_at timestamptz not null default now(),
  check (kind <> 'other' or note is not null),
  check (kind = 'fare' or receipt_data is not null)
);
--> statement-breakpoint
create index field_expense_person_day on field_expense (person_id, day);
