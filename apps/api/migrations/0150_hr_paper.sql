-- Each person's papers on their HR record (docs/HR-PLAN.md, step 1): the contract, government IDs,
-- certificates, clearance, medical papers. The bytes go through files/store.ts (in the row on this
-- computer, in the bucket online). A paper is never deleted: taken off the record, it is archived
-- with who did it and why.
create table hr_paper (
  id bigint generated always as identity primary key,
  person_id bigint not null references person (id),
  kind text not null check (kind in ('contract', 'government_id', 'certificate', 'clearance', 'medical', 'other')),
  title text not null,
  -- The day it stops being good (an ID, a contract's end), when it has one.
  expires_on date,
  file_name text not null,
  file_mime text not null,
  file_size integer not null,
  file_data bytea,
  file_key text,
  added_by bigint not null references person (id),
  added_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by bigint references person (id),
  archived_reason text,
  constraint hr_paper_has_bytes check (file_data is not null or file_key is not null),
  constraint hr_paper_archived_whole check (
    (archived_at is null and archived_by is null and archived_reason is null)
    or (archived_at is not null and archived_by is not null and archived_reason is not null)
  )
);
--> statement-breakpoint
create index hr_paper_person on hr_paper (person_id, added_at desc);
--> statement-breakpoint
-- HR's trail writes down papers added and taken off too.
alter table hr_event drop constraint hr_event_kind_check;
--> statement-breakpoint
alter table hr_event add constraint hr_event_kind_check
  check (kind in ('joined', 'record', 'login', 'left', 'back', 'paper'));
