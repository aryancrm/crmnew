-- People ask for their own leave: it waits for whom they report to (HR when that is the CEO or
-- nobody), who approves it or refuses it with a word; HR may decide any. What HR records itself is
-- approved as recorded. A leave may carry a paper (a medical certificate).
alter table person_leave drop constraint person_leave_status_check;
--> statement-breakpoint
alter table person_leave add constraint person_leave_status_check
  check (status in ('asked', 'approved', 'refused', 'cancelled'));
--> statement-breakpoint
-- Who decides an asked leave (null: HR).
alter table person_leave add column approver_id bigint references person (id);
--> statement-breakpoint
alter table person_leave add column decided_by bigint references person (id);
--> statement-breakpoint
alter table person_leave add column decided_at timestamptz;
--> statement-breakpoint
alter table person_leave add column decision_note text;
--> statement-breakpoint
alter table person_leave add column file_name text;
--> statement-breakpoint
alter table person_leave add column file_mime text;
--> statement-breakpoint
alter table person_leave add column file_data bytea;
--> statement-breakpoint
-- What HR recorded was decided by HR when it was made.
update person_leave set decided_by = made_by, decided_at = made_at where status in ('approved', 'cancelled');
--> statement-breakpoint
create index person_leave_waiting on person_leave (approver_id) where status = 'asked';
