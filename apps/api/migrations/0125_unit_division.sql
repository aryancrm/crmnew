-- A box's Division, the sales tracker's channel it is part of (19 Nov: a head's Home shows each
-- channel's own work under it): the nearest box from it upwards that names a channel its own
-- channel doesn't say (CLIDP sits in B2B; MD Telesales in Telesales; RX Business and its two lines
-- in the Prescription Business), else the Division of its nearest box's channel. The same rule as
-- seat_division (migration 0124), from the box.
create or replace function unit_division(p_unit bigint) returns text
language sql stable as $$
  with recursive up as (
    select u.id, u.parent_id, u.name, u.channel_id, 0 as depth from org_unit u where u.id = p_unit
    union all
    select p.id, p.parent_id, p.name, p.channel_id, up.depth + 1 from org_unit p join up on p.id = up.parent_id
      where up.depth < 12
  )
  select coalesce(
    (select case
        when up.name ~* '^CLIDP\M' then 'CLIDP'
        when up.name ~* '^MD Telesales$' then 'MD Telesales'
        else 'RX Business' end
      from up where up.name ~* '^(CLIDP\M|MD Telesales$|RX Business$|Uro & Onco Care$|Blood & Bone Care$)'
      order by up.depth limit 1),
    (select c.division from up join channel c on c.id = up.channel_id where c.division is not null order by up.depth limit 1)
  )
$$;
