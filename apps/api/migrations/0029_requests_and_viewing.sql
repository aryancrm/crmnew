-- A team lead asks for a new person (or an empty seat) in their team, in an area that exists or a
-- new one; the CEO or the Admin approves (the seat, its area and the login are made then) or
-- declines with a reason. And the CEO or the Admin may look at the CRM as someone else sees it:
-- such a session says who is looking, and it can't change anything.
create table seat_request (
  id bigint generated always as identity primary key,
  unit_id bigint not null references org_unit (id),
  module text not null check (module in ('medrep', 'team_lead')),
  title text not null,
  area_id bigint references area (id),
  new_area_name text,
  new_area_cities text[],
  person_name text,
  person_phone text,
  reason text,
  status text not null default 'open' check (status in ('open', 'approved', 'declined')),
  asked_by bigint not null references person (id),
  asked_at timestamptz not null default now(),
  decided_by bigint references person (id),
  decided_at timestamptz,
  answer text,
  seat_id bigint references seat (id),
  person_id bigint references person (id)
);
--> statement-breakpoint
create index seat_request_open on seat_request (status, asked_at);
--> statement-breakpoint
alter table session add column viewed_by bigint references person (id);
