-- Management's and Finance's common screen (Aryan, 18 Nov): one screen for the whole desk; beside
-- it each of the desk's people (from the chart) presses Start when they begin and Stop when they
-- end; the waiting orders are shared out among the people started, whoever has the fewest open
-- first, and what is done on an order is written in the name of the person it was given to. Each
-- start is kept (who, which desk, from when to when, who pressed it).
create table desk_shift (
  id bigint generated always as identity primary key,
  person_id bigint not null references person (id),
  desk text not null check (desk in ('management', 'finance')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  started_by bigint references person (id),
  ended_by bigint references person (id),
  end_reason text
);
--> statement-breakpoint
create index desk_shift_open on desk_shift (desk, person_id) where ended_at is null;
