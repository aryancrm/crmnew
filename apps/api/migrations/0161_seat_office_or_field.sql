-- Office or field (docs/PLAN.md 29, 26 Nov): every seller's seat is one or the other, never both.
-- Office seats work by phone, Messenger and email; field seats visit doctors and hospitals. The
-- CEO or the Admin sets it on the seat; whoever sits in it gets its screens. A person changes kind
-- only by moving to a seat of the other kind.

-- How a channel works today: the Hospital Division, the Rx field, PAP and Modern Trade go out;
-- Online, telesales, B2B, Bidding and CLIDP work from the office.
create or replace function works_of_channel(p_code text) returns text
language sql immutable as $$
  select case
    when p_code is null then null
    when p_code in ('HOSP', 'RX', 'PAP', 'MT') then 'field'
    else 'office' end
$$;
--> statement-breakpoint

-- The channel of a seat: the nearest team up its tree that names one.
create or replace function seat_channel(p_seat bigint) returns text
language sql stable as $$
  with recursive up as (
    select u.id, u.parent_id, u.channel_id, 0 as depth from org_unit u
      where u.id = (select s.unit_id from seat s where s.id = p_seat)
    union all
    select p.id, p.parent_id, p.channel_id, up.depth + 1 from org_unit p join up on p.id = up.parent_id
      where up.depth < 12
  )
  select c.code from up join channel c on c.id = up.channel_id order by up.depth limit 1
$$;
--> statement-breakpoint

alter table seat add column works text check (works in ('office', 'field'));
--> statement-breakpoint

-- Only a MedRep's seat is office or field (a lead's follows the team they lead).
alter table seat add constraint seat_works_medrep check (works is null or module = 'medrep');
--> statement-breakpoint

-- Every MedRep seat as its channel works today (its holder's channel when the tree names none).
update seat s set works = coalesce(
    works_of_channel(seat_channel(s.id)),
    works_of_channel((select c.code from seat_holder h join person p on p.id = h.person_id
      join channel c on c.id = p.channel_id where h.seat_id = s.id order by h.starts_on desc, h.id desc limit 1)))
  where s.module = 'medrep';
--> statement-breakpoint

-- How a person works today: their main seat's kind (the one that decides their screens), else
-- their channel's. Null for anyone who isn't a MedRep.
create or replace function person_works(p_person bigint) returns text
language sql stable as $$
  select case when p.role <> 'medrep' then null else coalesce(
    (select s.works from seat_holder h join seat s on s.id = h.seat_id and s.active
      where h.person_id = p.id and h.starts_on <= (now() at time zone 'Asia/Manila')::date
        and (h.ends_on is null or h.ends_on >= (now() at time zone 'Asia/Manila')::date)
      order by (h.kind = 'holder') desc, s.lead desc, h.starts_on, h.id limit 1),
    works_of_channel((select c.code from channel c where c.id = p.channel_id))) end
  from person p where p.id = p_person
$$;
