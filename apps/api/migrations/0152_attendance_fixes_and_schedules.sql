-- Attendance, step 2 of docs/HR-PLAN.md. A person asks for a day of their own attendance to be put
-- right (a missed clock-in or out, a wrong time, forgot to sign in); it goes to whom they report to
-- (HR when that is the CEO, the Admin or nobody), HR may decide any. Approved, the day is set as HR
-- would put it right, marked as coming from a request. Never deleted: cancelled or refused, it stays.
create table attendance_fix (
  id bigint generated always as identity primary key,
  person_id bigint not null references person (id),
  day date not null,
  time_in time not null,
  time_out time,
  reason text not null,
  status text not null default 'asked' check (status in ('asked', 'approved', 'refused', 'cancelled')),
  approver_id bigint references person (id),
  decided_by bigint references person (id),
  decided_at timestamptz,
  decision_note text,
  made_at timestamptz not null default now(),
  cancelled_by bigint references person (id),
  cancelled_at timestamptz,
  check (time_out is null or time_out > time_in)
);
--> statement-breakpoint
-- One open request a person a day.
create unique index attendance_fix_once on attendance_fix (person_id, day) where status = 'asked';
--> statement-breakpoint
create index attendance_fix_waiting on attendance_fix (approver_id) where status = 'asked';
--> statement-breakpoint
-- A day set from an approved request says so (request), apart from one HR put right itself (hr).
alter table attendance drop constraint attendance_in_source_check;
--> statement-breakpoint
alter table attendance add constraint attendance_in_source_check
  check (in_source in ('sign_in', 'button', 'field', 'hr', 'request'));
--> statement-breakpoint
alter table attendance drop constraint attendance_out_source_check;
--> statement-breakpoint
alter table attendance add constraint attendance_out_source_check
  check (out_source in ('button', 'last_seen', 'field', 'hr', 'request'));
--> statement-breakpoint
-- HR's trail writes down a day put right from a request too.
alter table hr_event drop constraint hr_event_kind_check;
--> statement-breakpoint
alter table hr_event add constraint hr_event_kind_check
  check (kind in ('joined', 'record', 'login', 'left', 'back', 'paper', 'attendance'));
--> statement-breakpoint
-- Work schedules HR gives people (a shift): who added one and who archived it. A schedule is never
-- deleted; archived (active false), it isn't given any more.
alter table work_schedule
  add column created_at timestamptz,
  add column created_by bigint references person (id),
  add column archived_at timestamptz,
  add column archived_by bigint references person (id);
--> statement-breakpoint
create unique index work_schedule_name on work_schedule (lower(name)) where active;
