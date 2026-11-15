-- HR keeps people's leave (a day on leave is not an absence); the field's visits to doctors,
-- hospitals and drugstores (SEFMED's daily work): planned for a day, checked in on the spot,
-- reported (what was detailed and how the doctor took it) or skipped with a reason.
create table person_leave (
  id bigint generated always as identity primary key,
  person_id bigint not null references person (id),
  kind text not null check (kind in ('vl', 'sl', 'lwop', 'other')),
  from_day date not null,
  to_day date not null,
  half_day boolean not null default false,
  reason text,
  status text not null default 'approved' check (status in ('approved', 'cancelled')),
  made_by bigint not null references person (id),
  made_at timestamptz not null default now(),
  cancelled_by bigint references person (id),
  cancelled_at timestamptz,
  check (to_day >= from_day),
  check (not half_day or from_day = to_day)
);
--> statement-breakpoint
create index person_leave_days on person_leave (person_id, from_day, to_day) where status = 'approved';
--> statement-breakpoint
create table visit (
  id bigint generated always as identity primary key,
  -- Who visits, and the seat the visit belongs to (the work stays with the seat).
  person_id bigint not null references person (id),
  seat_id bigint references seat (id),
  customer_id bigint not null references customer (id),
  day date not null,
  status text not null default 'planned' check (status in ('planned', 'done', 'skipped')),
  checked_in_at timestamptz,
  -- "lat,lng" from the phone, when it shared its place.
  check_in_place text,
  done_at timestamptz,
  objective text,
  -- What was detailed: [{ "medicineId": 1, "reaction": "will_prescribe" }].
  detailed jsonb not null default '[]'::jsonb,
  notes text,
  next_day date,
  skip_reason text,
  -- The visit this one was planned from (a report's "next visit").
  from_visit bigint references visit (id),
  made_by bigint not null references person (id),
  made_at timestamptz not null default now(),
  check (status <> 'done' or (checked_in_at is not null and done_at is not null)),
  check (status <> 'skipped' or skip_reason is not null)
);
--> statement-breakpoint
-- One open visit to a customer a day per person.
create unique index visit_once on visit (person_id, customer_id, day) where status <> 'skipped';
--> statement-breakpoint
create index visit_person_day on visit (person_id, day);
--> statement-breakpoint
create index visit_customer_day on visit (customer_id, day desc);
