-- Sent back and answered: Management's reason stays on the order after the MedRep fixes it and
-- sends it again, with the MedRep's answer, so the next look at it has both.
alter table sales_order add column sent_back_count integer not null default 0;
--> statement-breakpoint
alter table sales_order add column sent_back_reason text;
--> statement-breakpoint
alter table sales_order add column sent_back_at timestamptz;
--> statement-breakpoint
alter table sales_order add column sent_back_by bigint references person (id);
--> statement-breakpoint
alter table sales_order add column reply text;
--> statement-breakpoint
-- Orders sent back before this column existed: once, with the reason they were sent back with.
update sales_order set sent_back_count = 1, sent_back_reason = flag_reason, sent_back_at = updated_at
  where status = 'draft' and flag_reason is not null;
--> statement-breakpoint

-- "Medicine not available": someone outside Inventory asks for a medicine we don't have (or
-- don't list). One open request per medicine name and strength; each ask is kept under it
-- (who, for which customer, how many), so Inventory sees how often and for whom it is wanted.
create table medicine_request (
  id bigint generated always as identity primary key,
  code text,
  medicine_id bigint references medicine (id),
  name text not null,
  strength text,
  times integer not null default 1,
  qty integer not null default 0,
  status text not null default 'open' check (status in ('open', 'ordered', 'added', 'declined')),
  asked_by bigint not null references person (id),
  asked_at timestamptz not null default now(),
  last_asked_at timestamptz not null default now(),
  answer text,
  answered_by bigint references person (id),
  answered_at timestamptz
);
--> statement-breakpoint
create unique index medicine_request_open_once on medicine_request (lower(name), lower(coalesce(strength, '')))
  where status = 'open';
--> statement-breakpoint
create index medicine_request_status on medicine_request (status, last_asked_at desc);
--> statement-breakpoint
create table medicine_request_ask (
  id bigint generated always as identity primary key,
  request_id bigint not null references medicine_request (id),
  person_id bigint not null references person (id),
  customer_id bigint references customer (id),
  qty integer,
  note text,
  at timestamptz not null default now()
);
--> statement-breakpoint
create index medicine_request_ask_request on medicine_request_ask (request_id, at desc);
--> statement-breakpoint
create index medicine_request_ask_person on medicine_request_ask (person_id, at desc);
