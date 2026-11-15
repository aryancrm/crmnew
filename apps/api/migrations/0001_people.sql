-- People, where they work and how they sign in.
-- Statements are separated by the marker line below; the migrator runs them one by one.

create table channel (
  id bigint generated always as identity primary key,
  code text not null unique,
  name text not null,
  sort integer not null default 0
);
--> statement-breakpoint

-- A MedRep's area: a named territory of a channel and the cities in it.
create table area (
  id bigint generated always as identity primary key,
  channel_id bigint not null references channel (id),
  name text not null,
  cities text[] not null default '{}',
  unique (channel_id, name)
);
--> statement-breakpoint

-- One row per person, one login per person. The role decides the screens.
create table person (
  id bigint generated always as identity primary key,
  name text not null,
  email text not null,
  phone text,
  title text,
  role text not null check (
    role in ('medrep', 'team_lead', 'manager', 'management', 'finance', 'dispatch', 'ceo', 'online', 'admin')
  ),
  channel_id bigint references channel (id),
  area_id bigint references area (id),
  reports_to bigint references person (id),
  password_hash text not null,
  must_change_password boolean not null default false,
  failed_logins integer not null default 0,
  locked_until timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (reports_to is null or reports_to <> id)
);
--> statement-breakpoint
create unique index person_email_once on person (lower(email));
--> statement-breakpoint
create index person_reports_to on person (reports_to);
--> statement-breakpoint
create index person_area on person (area_id);
--> statement-breakpoint

-- A signed-in browser. Only the hash of its token is kept.
create table session (
  id bigint generated always as identity primary key,
  token_hash text not null unique,
  person_id bigint not null references person (id),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null
);
--> statement-breakpoint
create index session_person on session (person_id);
