-- Fetch now (docs/PLAN.md 25): a person of the bidding team starts the tender finder's robot at
-- once, as the bidding team's own system had its Sync button, instead of waiting for the next
-- hourly run. Each press is kept: who, when, how the robot was started, and whether it started.
create table tender_find_ask (
  id bigint generated always as identity primary key,
  by_person bigint not null references person (id),
  -- github: GitHub was asked to run the robot's workflow now; local: the robot was started on the
  -- API's own computer (a developer's, or an office server with Chrome).
  via text not null check (via in ('github', 'local')),
  status text not null default 'asked' check (status in ('asked', 'failed')),
  -- Why it could not start, in words for the page.
  note text,
  at timestamptz not null default now()
);
--> statement-breakpoint
create index tender_find_ask_at on tender_find_ask (at desc);
