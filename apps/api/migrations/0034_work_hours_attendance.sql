-- Working hours, holidays and attendance: the first piece of the HR app. A desk's clock runs only in
-- working hours (an order left at 6 pm isn't late by morning), and every person's day has a time in
-- and a time out (their first sign-in, their "End my day", or a field rep's day), for HR and the CEO.

create table work_schedule (
  id bigint generated always as identity primary key,
  name text not null,
  -- Working days, 0 Sunday … 6 Saturday.
  days integer[] not null default '{1,2,3,4,5}',
  starts time not null default '08:00',
  ends time not null default '17:00',
  grace_minutes integer not null default 15 check (grace_minutes between 0 and 120),
  break_minutes integer not null default 60 check (break_minutes between 0 and 240),
  is_default boolean not null default false,
  active boolean not null default true,
  check (ends > starts)
);
--> statement-breakpoint
create unique index work_schedule_one_default on work_schedule ((true)) where is_default and active;
--> statement-breakpoint
insert into work_schedule (name, is_default) values ('Office hours', true);
--> statement-breakpoint
-- A person on another schedule (a shift); none means the company's default.
alter table person add column schedule_id bigint references work_schedule (id);
--> statement-breakpoint
create table holiday (
  id bigint generated always as identity primary key,
  day date not null,
  name text not null,
  kind text not null default 'regular' check (kind in ('regular', 'special')),
  active boolean not null default true
);
--> statement-breakpoint
create unique index holiday_day_once on holiday (day) where active;
--> statement-breakpoint
create table attendance (
  id bigint generated always as identity primary key,
  person_id bigint not null references person (id),
  day date not null,
  time_in timestamptz not null,
  -- sign_in: their first sign-in that day; button: "Start my day"; field: a field rep's day start;
  -- hr: put right by HR.
  in_source text not null check (in_source in ('sign_in', 'button', 'field', 'hr')),
  time_out timestamptz,
  out_source text check (out_source in ('button', 'last_seen', 'field', 'hr')),
  -- The last time they did anything that day: their day's end when they never pressed it.
  last_seen timestamptz not null,
  in_place text,
  out_place text,
  note text,
  changed_by bigint references person (id),
  check (time_out is null or time_out >= time_in)
);
--> statement-breakpoint
create unique index attendance_once_a_day on attendance (person_id, day);
--> statement-breakpoint
create index attendance_day on attendance (day);
--> statement-breakpoint
-- Working minutes between two moments on the company's default schedule (Manila time), never on
-- holidays: the same rule as src/hr/work-time.ts, for queries that time a desk.
create or replace function work_minutes(a timestamptz, b timestamptz) returns integer
language plpgsql stable as $$
declare
  s work_schedule%rowtype;
  d date;
  last date;
  opens timestamptz;
  closes timestamptz;
  total double precision := 0;
begin
  if a is null or b is null or b <= a then return 0; end if;
  select * into s from work_schedule where is_default and active limit 1;
  if not found then
    s.days := '{1,2,3,4,5}'; s.starts := '08:00'; s.ends := '17:00';
  end if;
  d := (a at time zone 'Asia/Manila')::date;
  last := (b at time zone 'Asia/Manila')::date;
  while d <= last loop
    if extract(dow from d)::int = any (s.days)
      and not exists (select 1 from holiday h where h.day = d and h.active) then
      opens := (d + s.starts) at time zone 'Asia/Manila';
      closes := (d + s.ends) at time zone 'Asia/Manila';
      if least(b, closes) > greatest(a, opens) then
        total := total + extract(epoch from least(b, closes) - greatest(a, opens));
      end if;
    end if;
    d := d + 1;
  end loop;
  return floor(total / 60)::int;
end $$;
