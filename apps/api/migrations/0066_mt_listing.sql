-- Modern Trade (docs/PLAN.md 16.7): which of our medicines a pharmacy chain carries and in how many
-- of its branches. A change (more branches, delisted) is a new line; the old one stays.
create table mt_listing (
  id bigint generated always as identity primary key,
  customer_id bigint not null references customer (id),
  medicine_id bigint not null references medicine (id),
  branches integer not null default 0 check (branches >= 0),
  listed boolean not null default true,
  note text,
  added_by bigint not null references person (id),
  added_at timestamptz not null default now()
);
--> statement-breakpoint
create index mt_listing_customer on mt_listing (customer_id);
