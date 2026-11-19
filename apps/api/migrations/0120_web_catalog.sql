-- The stock link to a website, as the old CRM had it (its catalogue push, 19 Nov): each medicine
-- with its prices and what is on the shelf goes to the website, only what changed since it last
-- took it. The website (2MG) knows each medicine by the old CRM's id: web_id keeps it (brought
-- over by scripts/import-web-ids.ts); a medicine new here gets a new one when it is first sent.
alter table medicine add column web_id uuid unique;
--> statement-breakpoint
create table web_catalog_sent (
  account_id bigint not null references channel_account (id),
  medicine_id bigint not null references medicine (id),
  -- What the website was last sent of it (a hash of the whole entry).
  hash text not null,
  sent_at timestamptz not null default now(),
  primary key (account_id, medicine_id)
);
--> statement-breakpoint
-- The old CRM's medicines with no match here (scripts/import-old-website.ts): the website may still
-- link to them, so each goes once to each website as no longer sold, and stops showing stock.
create table web_retired_product (
  web_id uuid primary key,
  code text,
  name text not null,
  strength text,
  sent_to bigint[] not null default '{}'
);
