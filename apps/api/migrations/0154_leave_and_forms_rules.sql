-- Leave and forms, step 3 of docs/HR-PLAN.md. Credits HR adjusts (a ledger: never edited, a wrong
-- line is reversed by another), several proof files a leave, a second approver, revoke (kept), the
-- overtime types and their hours, a form returned to be fixed, the daily accomplishment report and
-- the incident report, Head Requisition, and each person's drawn signature for the printouts.

-- HR's adjustments to a person's VL or SL for a year, in half days (+ adds, - takes off). The
-- year's opening days come from the rule (leave.ts LEAVE_DAYS) and the days used from approved
-- leave; only HR's own lines are kept here. A line is reversed by another that names it.
create table leave_credit (
  id bigint generated always as identity primary key,
  person_id bigint not null references person (id),
  year integer not null check (year between 2000 and 2100),
  kind text not null check (kind in ('vl', 'sl')),
  half_days integer not null check (half_days <> 0 and half_days between -200 and 200),
  reason text not null,
  reverses bigint references leave_credit (id),
  made_by bigint not null references person (id),
  made_at timestamptz not null default now()
);
--> statement-breakpoint
create index leave_credit_person on leave_credit (person_id, year);
--> statement-breakpoint
-- A line is reversed once at most.
create unique index leave_credit_reversed_once on leave_credit (reverses) where reverses is not null;
--> statement-breakpoint
-- Proof with a leave (a medical certificate, up to five files). The single file on person_leave
-- stays for the rows that had one before.
create table leave_file (
  id bigint generated always as identity primary key,
  leave_id bigint not null references person_leave (id),
  name text not null,
  mime text not null,
  size integer not null,
  data bytea,
  key text,
  made_at timestamptz not null default now()
);
--> statement-breakpoint
create index leave_file_leave on leave_file (leave_id);
--> statement-breakpoint
-- Approved leave the person takes back before it starts (or HR any): kept, marked revoked; its
-- days come back to the year's credits.
alter table person_leave drop constraint person_leave_status_check;
--> statement-breakpoint
alter table person_leave add constraint person_leave_status_check
  check (status in ('asked', 'approved', 'refused', 'cancelled', 'revoked'));
--> statement-breakpoint
alter table person_leave
  add column second_approver_id bigint references person (id),
  add column revoked_by bigint references person (id),
  add column revoked_at timestamptz,
  add column revoke_reason text;
--> statement-breakpoint
create index person_leave_second on person_leave (second_approver_id) where status = 'asked';
--> statement-breakpoint
-- A second approver HR names on a person's record: they also decide the person's leave; the
-- first of the two to decide closes it.
alter table employee add column second_approver_id bigint references person (id);
--> statement-breakpoint
-- Forms: the daily accomplishment report (eod) and the incident report; returned to the person to
-- fix, and revoked (kept) by them before HR decides.
alter table hr_form drop constraint hr_form_kind_check;
--> statement-breakpoint
alter table hr_form add constraint hr_form_kind_check
  check (kind in ('ob', 'wfh', 'ot', 'eod', 'incident'));
--> statement-breakpoint
alter table hr_form drop constraint hr_form_status_check;
--> statement-breakpoint
alter table hr_form add constraint hr_form_status_check
  check (status in ('asked', 'approved', 'refused', 'cancelled', 'returned', 'revoked'));
--> statement-breakpoint
alter table hr_form drop constraint hr_form_check;
--> statement-breakpoint
-- Official business has its hours in one day; overtime may run past midnight (to before from).
alter table hr_form add constraint hr_form_times_check
  check (kind in ('wfh', 'eod', 'incident') or (from_time is not null and to_time is not null
    and (kind = 'ot' or to_time > from_time)));
--> statement-breakpoint
alter table hr_form
  -- Overtime: the kind of day (regular, rest, legal, special, rest_legal, rest_special, broken),
  -- the hours that count and the night part of them (10 PM to 6 AM).
  add column ot_type text check (ot_type in ('regular', 'rest', 'legal', 'special', 'rest_legal', 'rest_special', 'broken')),
  add column ot_minutes integer check (ot_minutes >= 0),
  add column ot_night_minutes integer check (ot_night_minutes >= 0),
  -- Head Requisition: the team lead or manager who filed overtime for someone under them.
  add column head_by bigint references person (id),
  -- What the daily accomplishment report and the incident report carry.
  add column details jsonb,
  add column returned_by bigint references person (id),
  add column returned_at timestamptz,
  add column return_note text,
  add column revoked_by bigint references person (id),
  add column revoked_at timestamptz,
  -- The status and the desk it was at when revoked ('approver' or 'hr').
  add column revoked_from text,
  add column revoked_stage text check (revoked_stage in ('approver', 'hr'));
--> statement-breakpoint
drop index hr_form_once;
--> statement-breakpoint
create unique index hr_form_once on hr_form (person_id, kind, day) where status in ('asked', 'approved', 'returned');
--> statement-breakpoint
-- Each person's drawn signature (a PNG through files/store.ts). A new one archives the old: never
-- deleted, so a printout shows the signature in force when its signer signed.
create table person_signature (
  id bigint generated always as identity primary key,
  person_id bigint not null references person (id),
  name text not null,
  mime text not null,
  size integer not null,
  data bytea,
  key text,
  made_at timestamptz not null default now(),
  archived_at timestamptz
);
--> statement-breakpoint
create unique index person_signature_current on person_signature (person_id) where archived_at is null;
--> statement-breakpoint
-- HR's trail writes down a credit adjustment and its reversal, and the second approver named.
alter table hr_event drop constraint hr_event_kind_check;
--> statement-breakpoint
alter table hr_event add constraint hr_event_kind_check
  check (kind in ('joined', 'record', 'login', 'left', 'back', 'paper', 'attendance', 'leave'));
