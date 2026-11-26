-- HR's trail (docs/HR-PLAN.md, step 1): who changed what on a person's HR record, and when.
-- One line per change: a joiner added, fields of the record changed (each field's old and new
-- value; pay, bank, government numbers and the birth date only as "changed", never their values),
-- a login given, marked as left, back at work. Never updated or deleted.
create table hr_event (
  id bigint generated always as identity primary key,
  person_id bigint not null references person (id),
  by_person bigint not null references person (id),
  at timestamptz not null default now(),
  kind text not null check (kind in ('joined', 'record', 'login', 'left', 'back')),
  what text not null,
  -- [{ "field": "position", "label": "Position", "from": "…", "to": "…", "hidden": false }]
  changes jsonb not null default '[]'
);
--> statement-breakpoint
create index hr_event_person on hr_event (person_id, at desc);
