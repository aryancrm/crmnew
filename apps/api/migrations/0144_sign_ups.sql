-- People ask for their account themselves; the Admin accepts (gives the seat, so the role) or
-- declines; the acceptance is emailed with a link that works once to set their password. Nothing
-- here is deleted: a request keeps who decided it and when.
create table sign_up (
  id bigint generated always as identity primary key,
  first_name text not null,
  middle_name text,
  last_name text not null,
  name_suffix text,
  email text not null,
  phone text not null,
  -- What they said they work in. It grants nothing: the seat the Admin gives does.
  department text not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by bigint references person (id),
  decline_reason text,
  person_id bigint unique references person (id),
  -- Only the link's hash. It is tied to the password the account had when it was made, so a
  -- password given meanwhile ends it.
  link_hash text unique,
  link_password text,
  link_expires_at timestamptz,
  link_used_at timestamptz,
  emailed_at timestamptz,
  email_problem text,
  constraint sign_up_accepted_has_person check (status <> 'accepted' or person_id is not null)
);
--> statement-breakpoint
create unique index sign_up_one_waiting on sign_up (email) where status = 'pending';
--> statement-breakpoint
create index sign_up_created on sign_up (created_at);
