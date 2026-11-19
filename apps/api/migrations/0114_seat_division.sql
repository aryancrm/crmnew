-- The Division a seat's orders carry (Aryan, 19 Nov: "a MedRep comes under one Division; why so
-- many on the order?"). Each seat has one: the nearest box of the seat on the chart that is one of
-- the hub's Divisions by name (CLIDP; Uro & Onco Care is URO; Blood & Bone Care is B&B), else the
-- channel of its nearest box that has one (the Division set on the channel in the Admin panel). A
-- person's orders carry their own seat's Division; one with two seats picks between the two.
create or replace function seat_division(p_seat bigint) returns text
language sql stable as $$
  with recursive up as (
    select u.id, u.parent_id, u.name, u.channel_id, 0 as depth from org_unit u
      where u.id = (select s.unit_id from seat s where s.id = p_seat)
    union all
    select p.id, p.parent_id, p.name, p.channel_id, up.depth + 1 from org_unit p join up on p.id = up.parent_id
      where up.depth < 12
  )
  select coalesce(
    (select case
        when up.name ~* '^CLIDP\M' then 'CLIDP'
        when up.name ~* '^Uro & Onco Care$' then 'URO'
        else 'B&B' end
      from up where up.name ~* '^(CLIDP\M|Uro & Onco Care$|Blood & Bone Care$)' order by up.depth limit 1),
    (select c.division from up join channel c on c.id = up.channel_id where c.division is not null order by up.depth limit 1)
  )
$$;
