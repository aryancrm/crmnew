-- Each person's own profile (their name in parts, their picture) and two-step sign-in with an
-- authenticator app, as Bishnoi One has it. Birth date, contact and emergency contact stay where
-- they are, on the employee's record: HR and the person read and write the same fields.
-- `person.name` stays the one name every screen reads; saving a profile makes it from the parts.
alter table person
  add column first_name text,
  add column middle_name text,
  add column last_name text,
  add column name_suffix text;
--> statement-breakpoint
-- A picture replaced or removed is archived, never deleted.
create table person_photo (
  id bigint generated always as identity primary key,
  person_id bigint not null references person (id),
  mime text not null,
  size integer not null,
  data bytea,
  store_key text,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint person_photo_has_bytes check (data is not null or store_key is not null)
);
--> statement-breakpoint
create unique index person_photo_one_shown on person_photo (person_id) where archived_at is null;
--> statement-breakpoint
create table person_two_step (
  person_id bigint primary key references person (id),
  -- Sealed (AES-256-GCM, SECRETS_KEY). `pending` is one shown but not yet confirmed with a code.
  secret text,
  pending text,
  pending_at timestamptz,
  on_at timestamptz,
  -- Only hashes: each recovery code works once.
  recovery text[] not null default '{}',
  -- The newest time step used: the same six digits never work twice.
  last_step bigint,
  -- Wrong codes, counted apart from wrong passwords: a right password doesn't clear them.
  failed integer not null default 0,
  locked_until timestamptz,
  constraint person_two_step_on_has_secret check (on_at is null or secret is not null)
);
--> statement-breakpoint
-- A sign-in whose password was right, waiting for its code (five minutes, once).
create table sign_in_ticket (
  token_hash text primary key,
  person_id bigint not null references person (id),
  -- The password it was made with: a new password ends it.
  password_hash text not null,
  workspace text,
  expires_at timestamptz not null
);
--> statement-breakpoint
create index sign_in_ticket_person on sign_in_ticket (person_id);
--> statement-breakpoint
-- What was done to an account, and by whom. Never a secret, a code or a private value.
create table account_event (
  id bigint generated always as identity primary key,
  person_id bigint not null references person (id),
  by_person bigint references person (id),
  kind text not null,
  detail text,
  created_at timestamptz not null default now()
);
--> statement-breakpoint
create index account_event_person on account_event (person_id, id desc);
