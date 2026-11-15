-- HR's forms, asked for by people and decided like leave (whom they report to, else HR): official
-- business (away for work, those hours count as worked), work from home (the day counts as worked)
-- and overtime (hours after work, counted as approved overtime).
create table hr_form (
  id bigint generated always as identity primary key,
  person_id bigint not null references person (id),
  kind text not null check (kind in ('ob', 'wfh', 'ot')),
  day date not null,
  from_time time,
  to_time time,
  -- Where they were (official business).
  place text,
  reason text not null,
  status text not null default 'asked' check (status in ('asked', 'approved', 'refused', 'cancelled')),
  approver_id bigint references person (id),
  decided_by bigint references person (id),
  decided_at timestamptz,
  decision_note text,
  made_by bigint not null references person (id),
  made_at timestamptz not null default now(),
  cancelled_by bigint references person (id),
  cancelled_at timestamptz,
  check (kind = 'wfh' or (from_time is not null and to_time is not null and to_time > from_time))
);
--> statement-breakpoint
create unique index hr_form_once on hr_form (person_id, kind, day) where status in ('asked', 'approved');
--> statement-breakpoint
create index hr_form_waiting on hr_form (approver_id) where status = 'asked';
