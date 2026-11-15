-- Whose seat a sale counts for: the seat its MedRep sits in, when that seat covers an area (the
-- MedRep sold it, wherever the customer is). An order placed by someone with no such seat (a team
-- lead for an empty seat's customer, Management, the Online desk) counts for the seat of the
-- customer's area; failing both, whatever seat the person holds. Every page counts by this seat.
create or replace function order_seat() returns trigger language plpgsql as $$
declare today date := (now() at time zone 'Asia/Manila')::date;
begin
  if new.seat_id is null then
    select h.seat_id into new.seat_id
      from seat_holder h join seat s on s.id = h.seat_id
      where h.person_id = new.medrep_id and h.kind = 'holder' and s.active and s.area_id is not null
        and h.starts_on <= today and (h.ends_on is null or h.ends_on >= today)
      order by h.starts_on, h.id limit 1;
  end if;
  if new.seat_id is null then
    select s.id into new.seat_id from customer c join seat s on s.area_id = c.area_id and s.active
      where c.id = new.customer_id limit 1;
  end if;
  if new.seat_id is null then
    select h.seat_id into new.seat_id
      from seat_holder h join seat s on s.id = h.seat_id
      where h.person_id = new.medrep_id and h.kind = 'holder' and s.active
        and h.starts_on <= today and (h.ends_on is null or h.ends_on >= today)
      order by h.starts_on, h.id limit 1;
  end if;
  return new;
end $$;
--> statement-breakpoint
-- Orders already made follow the same rule: the seat their MedRep held when they were placed.
update sales_order o set seat_id = coalesce(
  (select h.seat_id from seat_holder h join seat s on s.id = h.seat_id
    where h.person_id = o.medrep_id and h.kind = 'holder' and s.area_id is not null
      and h.starts_on <= (o.created_at at time zone 'Asia/Manila')::date
      and (h.ends_on is null or h.ends_on >= (o.created_at at time zone 'Asia/Manila')::date)
    order by h.starts_on, h.id limit 1),
  o.seat_id)
where exists (select 1 from seat_holder h where h.person_id = o.medrep_id);
