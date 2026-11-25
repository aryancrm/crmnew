-- The tender finder inside the CRM (docs/PLAN.md 24; Aryan, 23 Nov: "we keep one CRM, not two").
-- What the robot finds on PhilGEPS and PS-PhilGEPS: each notice with its agency, budget and dates
-- and the item lines read on it or in its papers; the bidding team's pick of the ones worth
-- bidding on (screened); and the CRM tender one becomes. The robot (a separate worker with its own
-- browser) writes through its own door (/webhooks/tender-finder), people through the CRM. Nothing
-- is deleted: a notice taken off the screened list keeps who did it and when, and lines read
-- again are kept, marked replaced.
create table tender_found (
  id bigint generated always as identity primary key,
  -- philgeps = notices.philgeps.gov.ph (public), ps = the new logged-in portal.
  source text not null check (source in ('philgeps', 'ps')),
  -- The portal's own reference number.
  ref_no text not null,
  title text not null,
  -- The procuring entity as the portal writes it, and the same name in capitals without
  -- punctuation (the portals and our customer list spell names slightly differently).
  agency_name text,
  agency_key text,
  -- The CRM customer it is (matched by name, or picked by a person and remembered).
  agency_id bigint references customer (id),
  notice_type text,
  procurement_mode text,
  -- The approved budget for the contract, centavos.
  abc bigint check (abc >= 0),
  published_on date,
  closing_at timestamptz,
  -- The notice's page on the portal.
  link text,
  -- The notice's own description and line items, as text.
  items_text text,
  -- What else the notice says: solicitation number, delivery area and period, the contact, the
  -- pre-bid and opening as written, the bid supplements, the papers' names.
  details jsonb not null default '{}'::jsonb,
  -- Our molecules it asks for.
  molecules text[] not null default '{}',
  -- Changes when the lines read change, so an unchanged notice is not written again.
  lines_key text,
  first_seen_at timestamptz not null default now(),
  seen_at timestamptz not null default now(),
  screened_at timestamptz,
  screened_by bigint references person (id),
  -- The CRM tender it became (one notice, one tender).
  tender_id bigint unique references tender (id),
  unique (source, ref_no)
);
--> statement-breakpoint
create index tender_found_closing on tender_found (closing_at);
--> statement-breakpoint
create index tender_found_agency on tender_found (agency_key);
--> statement-breakpoint
create index tender_found_screened on tender_found (screened_at) where screened_at is not null;
--> statement-breakpoint
-- A line the tender asks for, as read on the notice or in its papers.
create table tender_found_line (
  id bigint generated always as identity primary key,
  found_id bigint not null references tender_found (id),
  position integer not null,
  origin text not null check (origin in ('notice', 'papers')),
  item_no text,
  description text not null,
  qty numeric check (qty >= 0),
  unit text,
  -- The budget for one piece and for the line, centavos.
  abc_unit bigint check (abc_unit >= 0),
  abc_total bigint check (abc_total >= 0),
  molecules text[] not null default '{}',
  -- Our medicine it is: matched by molecule and strength, or picked by a person.
  medicine_id bigint references medicine (id),
  picked_by bigint references person (id),
  -- A line read again is kept, marked replaced.
  replaced_at timestamptz
);
--> statement-breakpoint
create index tender_found_line_found on tender_found_line (found_id) where replaced_at is null;
--> statement-breakpoint
-- What people did with a notice: screened, taken off, its agency picked, made a tender.
create table tender_found_event (
  id bigint generated always as identity primary key,
  found_id bigint not null references tender_found (id),
  what text not null check (what in ('screened', 'unscreened', 'agency', 'tender')),
  note text,
  by_person bigint not null references person (id),
  at timestamptz not null default now()
);
--> statement-breakpoint
create index tender_found_event_found on tender_found_event (found_id, at);
--> statement-breakpoint
-- Each run of the robot, as it reported it.
create table tender_find_run (
  id bigint generated always as identity primary key,
  source text not null check (source in ('philgeps', 'ps')),
  -- schedule | manual
  trigger text,
  status text not null check (status in ('success', 'failed')),
  summary text,
  found integer not null default 0,
  matched integer not null default 0,
  fresh integer not null default 0,
  at timestamptz not null default now()
);
--> statement-breakpoint
create index tender_find_run_at on tender_find_run (at desc);
