-- Which screens are slow, as the people using them meet it (Aryan, 22 Nov: "every page is slow"):
-- every answer that took the server more than 800 ms is noted here with its address, the time and
-- how many questions it asked the database. Kept two weeks. Read on Admin panel → Slow screens.
create table slow_request (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  method text not null,
  path text not null,
  ms integer not null,
  queries integer not null default 0,
  role text
);
--> statement-breakpoint
create index slow_request_at on slow_request (at desc);
