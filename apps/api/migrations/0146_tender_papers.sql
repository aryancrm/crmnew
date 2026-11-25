-- The tender papers (docs/PLAN.md 24): the bid documents of the notices the team screened, which
-- the robot gets from PhilGEPS with the company's own log-in (it "orders" them there at no cost and
-- never pays) and reads into lines. The files are kept here, through the file store (bytes in the
-- row on this computer, in the bucket online); what was read goes on the notice as its lines.
create table tender_found_file (
  id bigint generated always as identity primary key,
  found_id bigint not null references tender_found (id),
  -- paper = a bid document of the notice, bulletin = a bid bulletin's or addendum's attachment.
  kind text not null default 'paper' check (kind in ('paper', 'bulletin')),
  -- The robot's own name for the file ("<reference>/<file name>"): it asks for it back by this.
  path text not null,
  name text not null,
  mime text not null,
  size integer not null check (size > 0),
  data bytea,
  store_key text,
  at timestamptz not null default now(),
  check (data is not null or store_key is not null),
  -- The same file handed in again takes the place of the earlier copy.
  unique (found_id, path)
);
--> statement-breakpoint
-- Every log-in the robot makes to a portal, so it makes few: a refused password is never tried
-- again by itself (three refusals lock a PhilGEPS account), and a person can see what happened.
-- outcome: started | ok | rejected | busy | error | cancelled.
create table tender_find_login (
  id bigint generated always as identity primary key,
  site text not null,
  outcome text not null,
  detail text,
  source text,
  at timestamptz not null default now()
);
--> statement-breakpoint
create index tender_find_login_site on tender_find_login (site, at desc);
