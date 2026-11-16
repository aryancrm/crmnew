-- The monthly scorecards (Phase 2). A month's card is worked out from the invoices, orders and
-- enquiries while it runs, and locked on the 1st of the next month: what is written here is
-- final, nobody changes it by hand. The 12-month average of the locked cards sets the increment.
create table score_month (
  person_id bigint not null references person (id),
  -- The first day of the month.
  month date not null check (extract(day from month) = 1),
  -- The playbook's card: 'hospital', 'b2c'.
  recipe text not null,
  seat_id bigint references seat (id),
  total integer not null check (total >= 0),
  -- The points of the KPIs that had something to measure.
  max integer not null check (max >= 0),
  capped boolean not null default false,
  -- [{ key, label, value, points, band, weight, unit }] as the month closed.
  kpis jsonb not null,
  locked_at timestamptz not null default now(),
  primary key (person_id, month)
);
--> statement-breakpoint
-- A person who thinks a locked figure is wrong says so; their lead answers. The answer is kept
-- with the card; a figure found wrong is put right at its source (the invoice, the order) and the
-- month locked again by the Admin.
create table score_dispute (
  id bigint generated always as identity primary key,
  person_id bigint not null references person (id),
  month date not null check (extract(day from month) = 1),
  kpi text not null,
  note text not null,
  raised_at timestamptz not null default now(),
  state text not null default 'open' check (state in ('open', 'upheld', 'turned_down')),
  answer text,
  answered_by bigint references person (id),
  answered_at timestamptz
);
--> statement-breakpoint
create index score_dispute_person on score_dispute (person_id, month);
