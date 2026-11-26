-- Moves, covers and vacant seats (docs/HR-PLAN.md, "Moves and vacant seats", 25 Nov).
--
-- 1. Who sold an order and as whom. An email ID (a seat's login, hos3@…) is handed from one person
--    to the next, so each order keeps the login its seller used that day (`sold_as`) beside the
--    person (`medrep_id`, whose employee ID never changes): a cross-check later can tell whose sale
--    it was and move the credit.
-- 2. A sale made while covering a vacant area counts for that area's seat, never for the covering
--    MedRep's own seat or KPI: the quota stays on the vacant seat and the team handles it. Per
--    person it counts for the team lead above the seat that day (`cover_lead_id`), as an order the
--    lead places for an empty seat's customer always has.
-- 3. HR's trail gets moves: a seat taken, left, covered, a cover ended, a seat changed.

alter table sales_order add column sold_as text;
--> statement-breakpoint
alter table sales_order add column covered boolean not null default false;
--> statement-breakpoint
alter table sales_order add column cover_lead_id bigint references person (id);
--> statement-breakpoint
create or replace function order_seat() returns trigger language plpgsql as $$
declare today date := (now() at time zone 'Asia/Manila')::date;
begin
  -- The seller covers the seat of the customer's area: the sale is that seat's, the team's.
  if new.seat_id is null then
    select s.id into new.seat_id
      from customer c join seat s on s.area_id = c.area_id and s.active
        join seat_holder h on h.seat_id = s.id and h.kind = 'acting' and h.person_id = new.medrep_id
      where c.id = new.customer_id and h.starts_on <= today and (h.ends_on is null or h.ends_on >= today)
      limit 1;
    if new.seat_id is not null then
      new.covered := true;
      select s.boss_id into new.cover_lead_id from seat s where s.id = new.seat_id;
    end if;
  end if;
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
  -- The login the seller used that day: their own seat's (a lead seat first), else their email.
  if new.sold_as is null then
    select coalesce(
        (select s.login from seat_holder h join seat s on s.id = h.seat_id
          where h.person_id = new.medrep_id and h.kind = 'holder' and s.login is not null
            and h.starts_on <= today and (h.ends_on is null or h.ends_on >= today)
          order by s.lead desc, h.starts_on, h.id limit 1),
        (select p.email from person p where p.id = new.medrep_id))
      into new.sold_as;
  end if;
  return new;
end $$;
--> statement-breakpoint
-- Orders already made: the login their seller held when they were placed (best known).
update sales_order o set sold_as = coalesce(
  (select s.login from seat_holder h join seat s on s.id = h.seat_id
    where h.person_id = o.medrep_id and h.kind = 'holder' and s.login is not null
      and h.starts_on <= (o.created_at at time zone 'Asia/Manila')::date
      and (h.ends_on is null or h.ends_on >= (o.created_at at time zone 'Asia/Manila')::date)
    order by s.lead desc, h.starts_on, h.id limit 1),
  (select p.email from person p where p.id = o.medrep_id))
where o.sold_as is null;
--> statement-breakpoint
alter table hr_event drop constraint hr_event_kind_check;
--> statement-breakpoint
alter table hr_event add constraint hr_event_kind_check
  check (kind in ('joined', 'record', 'login', 'left', 'back', 'paper', 'attendance', 'leave', 'move'));
--> statement-breakpoint
-- What kind of move a seat holding was (HR's Move: a transfer, a promotion, a demotion, a lateral
-- move); empty for the ones made before and for covers.
alter table seat_holder add column move_kind text check (move_kind in ('transfer', 'promotion', 'demotion', 'lateral'));
--> statement-breakpoint
-- Every sale (the CRM's and Zoho's) says whether it was made covering a vacant area and for which
-- lead, so pages reading this view credit it as the order tables do (new columns go last).
create or replace view sale_invoice as
  select i.id, 'crm' as source, i.issued_on, i.due_on, i.total::bigint as total, i.paid::bigint as paid,
    i.status, i.customer_id, o.seat_id, o.medrep_id, o.channel_id, o.id as order_id, o.covered, o.cover_lead_id
  from invoice i join sales_order o on o.id = i.order_id
  union all
  select d.id, 'zoho', d.doc_date, d.due_date, round(d.total * d.fx_rate)::bigint, round((d.total - d.balance) * d.fx_rate)::bigint,
    case when d.status = 'void' then 'cancelled' when d.balance <= 0 then 'paid' else 'open' end,
    d.customer_id, zs.seat_id, null::bigint, seat_channel_id(zs.seat_id), null::bigint, false, null::bigint
  from book_doc d
    left join zoho_seller zs on zs.name = coalesce(d.fields->>'Sales Person', d.fields->>'salesperson_name')
  where d.kind = 'invoice' and d.zoho_id is not null and d.status not in ('draft');
