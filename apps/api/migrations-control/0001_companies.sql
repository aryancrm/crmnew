-- Bishnoi One's own list (Aryan, 26 Nov 2026): the companies on it and the people who run it (our
-- control panel, /control). Each company's data is in a database of its own; this one only says
-- which companies there are, where each one's data is, and who may change the list.

create table company (
  id bigint generated always as identity primary key,
  -- The company's account number with us: six digits, made at random, never changed.
  org_id text not null unique check (org_id ~ '^[1-9][0-9]{5}$'),
  name text not null check (length(btrim(name)) between 1 and 120),
  -- Its short code, for documents: 2MG, GM.
  code text not null unique check (code ~ '^[A-Z0-9]{2,8}$'),
  -- What its people type after the @ to sign in: its email domain (2mginc.com, getmeds.ph).
  login_domain text not null unique
    check (login_domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  -- Where its data is: null = the server's own database (the first company); else the name of its
  -- database on the same Postgres server (a folder, on a developer's computer).
  database text unique,
  -- Paused: nobody of it can sign in or work until it is resumed. Nothing of it is deleted.
  paused_at timestamptz,
  paused_reason text,
  created_at timestamptz not null default now()
);
--> statement-breakpoint
create table control_person (
  id bigint generated always as identity primary key,
  -- Short, no email: 1001, aryan.
  login_id text not null unique check (login_id ~ '^[a-z0-9][a-z0-9._-]{1,31}$'),
  name text not null check (length(btrim(name)) between 1 and 80),
  password_hash text not null,
  -- The authenticator app's key, sealed with the server's SECRETS_KEY.
  totp_sealed text not null,
  -- The time step of the last code used: a code never works twice.
  totp_step bigint,
  -- Turned on once the first code from the phone was right.
  active boolean not null default false,
  failed_tries integer not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  last_sign_in_at timestamptz
);
--> statement-breakpoint
create table control_session (
  id bigint generated always as identity primary key,
  token_hash text not null unique,
  person_id bigint not null references control_person (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
--> statement-breakpoint
-- What was done in the panel and by whom: never changed or removed.
create table control_event (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  person_id bigint references control_person (id),
  company_id bigint references company (id),
  what text not null,
  detail jsonb not null default '{}'
);
--> statement-breakpoint
create index control_event_company on control_event (company_id, at desc);
