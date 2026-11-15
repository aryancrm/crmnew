-- Conversations on the Online desk: a connected Facebook page or email mailbox brings each
-- person's messages onto their case, and the agent answers from the case or the Inbox.

-- A connected channel: a Facebook page (key = the page id) or a mailbox (key = the address).
-- Its token or password is sealed (AES-GCM) and never sent to a browser.
create table channel_account (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('messenger', 'email')),
  key text not null,
  name text not null,
  secret text not null,
  -- Email only: who opens a case. 'screen' holds a new sender for the agent, 'all' lets everyone in.
  intake text not null default 'screen' check (intake in ('screen', 'all')),
  -- Where reading stopped (the Messenger pull's time, the mailbox's UID).
  cursor jsonb,
  synced_at timestamptz,
  sync_error text,
  active boolean not null default true,
  connected_by bigint references person (id),
  connected_at timestamptz not null default now(),
  unique (kind, key)
);
--> statement-breakpoint

-- The case's conversation: what they wrote and what we answered, on Messenger or by email.
alter table lead add column chat_channel text check (chat_channel in ('messenger', 'email'));
--> statement-breakpoint
alter table lead add column chat_account_id bigint references channel_account (id);
--> statement-breakpoint
-- Who the conversation is with: their Messenger id on that page, or their email address.
alter table lead add column chat_key text;
--> statement-breakpoint
alter table lead add column awaiting_reply boolean not null default false;
--> statement-breakpoint
alter table lead add column last_message text;
--> statement-breakpoint
alter table lead add column last_message_at timestamptz;
--> statement-breakpoint
alter table lead add column last_inbound_at timestamptz;
--> statement-breakpoint
-- They read our messages up to this time (Messenger's read receipt).
alter table lead add column read_at timestamptz;
--> statement-breakpoint
-- Someone on the desk opened the conversation: newer messages show it unread.
alter table lead add column seen_at timestamptz;
--> statement-breakpoint
create index lead_chat on lead (chat_account_id, chat_key) where chat_key is not null;
--> statement-breakpoint
create index lead_last_message on lead (last_message_at desc) where chat_key is not null;
--> statement-breakpoint

-- A case Messenger or email opened has no person who made it; a paper they sent, no person
-- who filed it; a line the system wrote, no person.
alter table lead alter column created_by drop not null;
--> statement-breakpoint
alter table lead_file alter column by_person drop not null;
--> statement-breakpoint
alter table lead_event alter column by_person drop not null;
--> statement-breakpoint
-- A photo that came in the chat waits as "unsorted" until the agent files it as a paper.
alter table lead_file drop constraint lead_file_kind_check;
--> statement-breakpoint
alter table lead_file add constraint lead_file_kind_check
  check (kind in ('rx', 'osca_id', 'pwd_id', 'pwd_booklet', 'valid_id', 'med_cert', 'gl_letter', 'other', 'unsorted'));
--> statement-breakpoint

create table lead_message (
  id bigint generated always as identity primary key,
  lead_id bigint not null references lead (id),
  channel text not null check (channel in ('messenger', 'email')),
  account_id bigint not null references channel_account (id),
  direction text not null check (direction in ('in', 'out')),
  -- Messenger's message id or the email's Message-ID: each is kept once.
  external_id text,
  subject text,
  text text not null default '',
  -- [{ fileId, name, mime }] for files kept on the case; [{ missing: true }] for one not fetched yet.
  files jsonb not null default '[]'::jsonb,
  -- Their reaction to one of our messages.
  reaction text,
  -- Who on the desk sent ours; null for what came from Facebook's own inbox.
  by_person bigint references person (id),
  at timestamptz not null,
  created_at timestamptz not null default now()
);
--> statement-breakpoint
create unique index lead_message_once on lead_message (account_id, external_id) where external_id is not null;
--> statement-breakpoint
create index lead_message_lead on lead_message (lead_id, at);
--> statement-breakpoint

-- Every Messenger event is kept first, then worked: one that fails is tried again later, never
-- lost. An event for a page no one has connected yet waits as 'unrouted'.
create table inbox_event (
  id bigint generated always as identity primary key,
  page_key text not null,
  account_id bigint references channel_account (id),
  event_key text not null,
  payload jsonb not null,
  state text not null default 'pending' check (state in ('pending', 'done', 'failed', 'skipped', 'unrouted')),
  attempts integer not null default 0,
  next_at timestamptz not null default now(),
  error text,
  created_at timestamptz not null default now(),
  done_at timestamptz,
  unique (page_key, event_key)
);
--> statement-breakpoint
create index inbox_event_due on inbox_event (next_at) where state = 'pending';
--> statement-breakpoint

-- Email from someone new, held until the agent says it is an enquiry (or not a customer).
create table email_held (
  id bigint generated always as identity primary key,
  account_id bigint not null references channel_account (id),
  address text not null,
  name text,
  subject text not null default '',
  snippet text not null default '',
  files integer not null default 0,
  message_id text not null,
  source bytea not null,
  at timestamptz not null,
  state text not null default 'held' check (state in ('held', 'let_in', 'ignored')),
  decided_by bigint references person (id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (account_id, message_id)
);
--> statement-breakpoint
create index email_held_open on email_held (account_id, address) where state = 'held';
--> statement-breakpoint

-- What the desk said about a sender: let in (their mail opens a case) or not a customer.
create table email_sender (
  account_id bigint not null references channel_account (id),
  address text not null,
  verdict text not null check (verdict in ('allowed', 'ignored')),
  by_person bigint references person (id),
  at timestamptz not null default now(),
  primary key (account_id, address)
);
