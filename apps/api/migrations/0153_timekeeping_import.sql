-- The biometric timekeeping workbook (docs/HR-PLAN.md, step 2): HR hands in the TIMEKEEPING sheet
-- each cut-off (any run of days it covers) and each person's days are kept beside the CRM's own
-- attendance, never over it. Nothing here is deleted: a mapping HR changes is archived, an import
-- of the same days again makes the older rows superseded (kept), a flag HR dismisses keeps its note.

-- Whose each device ID on the sheet is. Kept by HR: set once ("this is X") and used every import.
create table timekeeping_device (
  id bigint generated always as identity primary key,
  -- As compared: capitals, no spaces.
  device_id text not null check (device_id <> '' and device_id = upper(device_id)),
  person_id bigint not null references person (id),
  -- The name the sheet had when HR confirmed it.
  name_on_sheet text,
  set_by bigint not null references person (id),
  set_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by bigint references person (id),
  constraint timekeeping_device_archived_whole check ((archived_at is null) = (archived_by is null))
);
--> statement-breakpoint
create unique index timekeeping_device_current on timekeeping_device (device_id) where archived_at is null;
--> statement-breakpoint
-- One workbook handed in: who, when, the file (through files/store.ts), the days it covers, counts.
create table timekeeping_import (
  id bigint generated always as identity primary key,
  from_day date not null,
  to_day date not null,
  sheet text not null,
  file_name text not null,
  file_mime text not null,
  file_size integer not null,
  file_data bytea,
  file_key text,
  -- People imported, day rows kept, of them needing review, and people on the sheet left out.
  people integer not null check (people >= 0),
  days integer not null check (days >= 0),
  needs_review integer not null check (needs_review >= 0),
  skipped integer not null check (skipped >= 0),
  made_by bigint not null references person (id),
  made_at timestamptz not null default now(),
  constraint timekeeping_import_has_bytes check (file_data is not null or file_key is not null),
  check (to_day >= from_day)
);
--> statement-breakpoint
-- Each person's day as the sheet had it. The latest import's row is the current one; an older
-- one is kept with the import that superseded it.
create table biometric_day (
  id bigint generated always as identity primary key,
  import_id bigint not null references timekeeping_import (id),
  person_id bigint not null references person (id),
  day date not null,
  device_id text not null,
  sheet_column text not null,
  raw text not null,
  kind text not null check (kind in ('punch', 'code', 'empty', 'unreadable')),
  code text,
  first_in time,
  last_out time,
  punches integer not null default 0 check (punches >= 0),
  -- Why the cell needs HR's eye (one punch, a mistyped time, TRAINING …), or null.
  review_reason text,
  superseded_by bigint references timekeeping_import (id),
  -- HR's answer to its flag: used its times for the day, or dismissed with a note.
  resolution text check (resolution in ('applied', 'dismissed')),
  resolved_by bigint references person (id),
  resolved_at timestamptz,
  resolved_note text,
  check ((kind = 'punch') = (first_in is not null)),
  check (last_out is null or last_out > first_in),
  check (superseded_by is null or superseded_by > import_id),
  constraint biometric_day_resolved_whole check (
    (resolution is null and resolved_by is null and resolved_at is null)
    or (resolution is not null and resolved_by is not null and resolved_at is not null)
  )
);
--> statement-breakpoint
create unique index biometric_day_current on biometric_day (person_id, day) where superseded_by is null;
--> statement-breakpoint
create index biometric_day_import on biometric_day (import_id);
--> statement-breakpoint
create index biometric_day_range on biometric_day (day) where superseded_by is null;
--> statement-breakpoint
-- A day set from the biometrics says so (biometric), apart from HR's own (hr) and a request's.
alter table attendance drop constraint attendance_in_source_check;
--> statement-breakpoint
alter table attendance add constraint attendance_in_source_check
  check (in_source in ('sign_in', 'button', 'field', 'hr', 'request', 'biometric'));
--> statement-breakpoint
alter table attendance drop constraint attendance_out_source_check;
--> statement-breakpoint
alter table attendance add constraint attendance_out_source_check
  check (out_source in ('button', 'last_seen', 'field', 'hr', 'request', 'biometric'));
