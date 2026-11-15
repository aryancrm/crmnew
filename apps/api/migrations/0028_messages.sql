-- Messages between the people of the company: one person to another, to a team (everyone in a
-- box of the tree and under it, as it is when sent), to a few people picked, and announcements
-- (one way: they read, they don't reply) to a team or to everyone. Who was on a thread is kept on
-- it, with when they last read it, so an announcement says who has seen it.
create table message_thread (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('direct', 'group', 'announcement')),
  title text,
  -- The team it went to, when it went to a team; empty for everyone or people picked.
  unit_id bigint references org_unit (id),
  everyone boolean not null default false,
  -- One thread per two people: their ids, the smaller first.
  direct_key text unique,
  created_by bigint not null references person (id),
  created_at timestamptz not null default now(),
  last_at timestamptz not null default now()
);
--> statement-breakpoint
create table message_member (
  thread_id bigint not null references message_thread (id),
  person_id bigint not null references person (id),
  read_at timestamptz,
  primary key (thread_id, person_id)
);
--> statement-breakpoint
create index message_member_person on message_member (person_id);
--> statement-breakpoint
create table message (
  id bigint generated always as identity primary key,
  thread_id bigint not null references message_thread (id),
  by_person bigint not null references person (id),
  body text not null,
  at timestamptz not null default now()
);
--> statement-breakpoint
create index message_thread_at on message (thread_id, at);
