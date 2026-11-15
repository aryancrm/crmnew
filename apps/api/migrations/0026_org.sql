-- The company as boxes and jobs, apart from the people in them (docs/architecture/
-- new-crm-people-teams-saas.md). A unit is a box on the org chart (the company, a business, a
-- line, a team, a department); a seat is one job in a unit that stays when its person leaves; a
-- holding says who sits in a seat from a day to a day ("acting" for cover while someone is away
-- or the seat is empty). The person's role, channel, area and boss are written from their seat
-- (projectOrg), so every screen that reads them keeps working.

create table org_unit (
  id bigint generated always as identity primary key,
  name text not null,
  kind text not null check (kind in ('company', 'business', 'line', 'team', 'department')),
  parent_id bigint references org_unit (id),
  channel_id bigint references channel (id),
  sort integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (parent_id is null or parent_id <> id),
  check ((kind = 'company') = (parent_id is null))
);
--> statement-breakpoint
create unique index org_unit_one_company on org_unit ((true)) where kind = 'company';
--> statement-breakpoint
create index org_unit_parent on org_unit (parent_id);
--> statement-breakpoint
create unique index org_unit_name_once on org_unit (parent_id, lower(name)) where active;
--> statement-breakpoint

create table seat (
  id bigint generated always as identity primary key,
  unit_id bigint not null references org_unit (id),
  title text not null,
  module text not null check (
    module in ('medrep', 'team_lead', 'manager', 'management', 'finance', 'dispatch', 'inventory', 'ceo', 'online', 'admin')
  ),
  -- The unit's lead: the people of the unit report to this seat, and the leads of the units
  -- under it too.
  lead boolean not null default false,
  -- Reports somewhere other than the unit's lead (rare: a seat named on the chart beside a box).
  reports_to_seat_id bigint references seat (id),
  area_id bigint references area (id),
  sort integer not null default 0,
  active boolean not null default true,
  -- Worked out by projectOrg: whom this seat reports to today (a vacant boss seat is skipped).
  boss_id bigint references person (id),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  check (reports_to_seat_id is null or reports_to_seat_id <> id)
);
--> statement-breakpoint
create index seat_unit on seat (unit_id);
--> statement-breakpoint
create index seat_boss on seat (boss_id);
--> statement-breakpoint
-- One seat holds an area.
create unique index seat_area_once on seat (area_id) where active and area_id is not null;
--> statement-breakpoint

create table seat_holder (
  id bigint generated always as identity primary key,
  seat_id bigint not null references seat (id),
  person_id bigint not null references person (id),
  kind text not null default 'holder' check (kind in ('holder', 'acting')),
  starts_on date not null,
  -- The last day held; empty while still held.
  ends_on date,
  reason text,
  by_person bigint references person (id),
  at timestamptz not null default now(),
  ended_by bigint references person (id),
  end_reason text,
  check (ends_on is null or ends_on >= starts_on - 1)
);
--> statement-breakpoint
create index seat_holder_seat on seat_holder (seat_id);
--> statement-breakpoint
create index seat_holder_person on seat_holder (person_id);
--> statement-breakpoint
-- One holder at a time (an acting cover sits beside the holder, never in place of the record).
create unique index seat_holder_one on seat_holder (seat_id) where ends_on is null and kind = 'holder';
--> statement-breakpoint

-- Whose seat an order was sold from, so the seat's next person sees its history.
alter table sales_order add column seat_id bigint references seat (id);
--> statement-breakpoint
create index sales_order_seat on sales_order (seat_id);
--> statement-breakpoint
create or replace function order_seat() returns trigger language plpgsql as $$
begin
  -- The seat whose area the customer is in (an empty seat too: the sale is its area's), else
  -- the seat its MedRep sits in.
  if new.seat_id is null then
    select s.id into new.seat_id from customer c join seat s on s.area_id = c.area_id and s.active
      where c.id = new.customer_id limit 1;
  end if;
  if new.seat_id is null then
    select h.seat_id into new.seat_id
      from seat_holder h join seat s on s.id = h.seat_id
      where h.person_id = new.medrep_id and h.kind = 'holder' and s.active
        and h.starts_on <= (now() at time zone 'Asia/Manila')::date
        and (h.ends_on is null or h.ends_on >= (now() at time zone 'Asia/Manila')::date)
      order by (s.area_id is not null) desc, h.starts_on, h.id
      limit 1;
  end if;
  return new;
end $$;
--> statement-breakpoint
create trigger order_seat before insert on sales_order for each row execute function order_seat();
