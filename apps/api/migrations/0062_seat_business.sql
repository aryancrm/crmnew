-- Which business a seat sits in, as the chart draws it (Hospital Division, Prescription Business,
-- Sales and Marketing…), by that business box's channel. A seat's own channel is not enough: MD
-- Telesales Anesthesia (inside the Hospital Division) and MD Telesales Oncology (inside the
-- Prescription Business) are both telesales, and their work differs.
create or replace function seat_business_channel(p_seat bigint) returns text
language sql stable as $$
  with recursive up as (
    select u.id, u.parent_id, u.kind, u.channel_id from org_unit u
      where u.id = (select s.unit_id from seat s where s.id = p_seat)
    union all
    select p.id, p.parent_id, p.kind, p.channel_id from org_unit p join up on p.id = up.parent_id
  )
  select c.code from up join channel c on c.id = up.channel_id where up.kind = 'business' limit 1
$$;
