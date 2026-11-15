-- Dispatch: who in the warehouse has an order in hand (so two people don't pack the same one),
-- and a parcel that came back undelivered, with why, until it goes out again.
alter table sales_order add column dispatch_by bigint references person (id);
--> statement-breakpoint
alter table sales_order add column dispatch_by_at timestamptz;
--> statement-breakpoint
alter table sales_order add column came_back_count integer not null default 0;
--> statement-breakpoint
alter table sales_order add column came_back_reason text;
--> statement-breakpoint
alter table sales_order add column came_back_at timestamptz;
--> statement-breakpoint

-- The bell: what each person is told about their work. `key` keeps one line per event and
-- person (an action retried tells once).
create table notification (
  id bigint generated always as identity primary key,
  person_id bigint not null references person (id),
  kind text not null,
  title text not null,
  body text,
  link text,
  order_id bigint references sales_order (id),
  key text not null,
  at timestamptz not null default now(),
  read_at timestamptz
);
--> statement-breakpoint
create unique index notification_once on notification (person_id, key);
--> statement-breakpoint
create index notification_person on notification (person_id, at desc);
--> statement-breakpoint
create index notification_unread on notification (person_id) where read_at is null;
--> statement-breakpoint

-- An order arriving at a desk tells everyone at that desk, whichever code moved it there: a
-- payment to check (Finance), an invoice to make (Finance), an order to pack (Dispatch). Its
-- MedRep hears when it is on the way and when it is delivered.
create or replace function order_step_moved() returns trigger language plpgsql as $$
declare
  who text;
  label text;
begin
  if tg_op = 'INSERT' then
    -- A new order has no number yet (it is given just after); its desk hears of it on its next move.
    insert into order_step (order_id, status, entered_at) values (new.id, new.status, now());
    return null;
  elsif new.status is distinct from old.status then
    update order_step set left_at = now() where order_id = new.id and left_at is null;
    insert into order_step (order_id, status, entered_at) values (new.id, new.status, now());
  else
    return null;
  end if;
  select c.name into who from customer c where c.id = new.customer_id;
  label := coalesce(new.code, 'An order') || ' · ' || coalesce(who, '');
  if new.status in ('finance_check', 'ready_for_invoice') then
    insert into notification (person_id, kind, title, body, link, order_id, key)
      select p.id, 'to_finance',
        case when new.status = 'finance_check' then 'Payment to check: ' else 'Invoice to make: ' end || label,
        'It reached Finance.', '/orders/' || new.id, new.id,
        'arrived:' || new.status || ':' || new.id || ':' || extract(epoch from now())::bigint
      from person p where p.role = 'finance' and p.active
      on conflict do nothing;
  elsif new.status = 'ready_for_dispatch' then
    insert into notification (person_id, kind, title, body, link, order_id, key)
      select p.id, 'to_pack', 'New order to pack: ' || label, 'It is approved and invoiced.',
        '/orders/' || new.id, new.id, 'arrived:ready_for_dispatch:' || new.id || ':' || extract(epoch from now())::bigint
      from person p where p.role = 'dispatch' and p.active
      on conflict do nothing;
  elsif new.status = 'shipped' then
    insert into notification (person_id, kind, title, body, link, order_id, key)
      select distinct p.id, 'shipped', 'On the way: ' || label,
        case when new.delivery_method = 'courier' then 'With ' || coalesce(new.courier, 'the courier')
             || coalesce(' · tracking ' || new.tracking, '')
             when new.delivery_method = 'rider' then 'With our rider ' || coalesce(new.rider, '')
             else null end,
        '/orders/' || new.id, new.id, 'shipped:' || new.id || ':' || extract(epoch from now())::bigint
      from person p where p.id in (new.medrep_id, new.raised_by) and p.active
      on conflict do nothing;
  elsif new.status = 'completed' and old.status in ('shipped', 'packing') then
    insert into notification (person_id, kind, title, body, link, order_id, key)
      select distinct p.id, 'delivered', 'Delivered: ' || label,
        coalesce('Received by ' || new.received_by, null), '/orders/' || new.id, new.id, 'delivered:' || new.id
      from person p where p.id in (new.medrep_id, new.raised_by) and p.active
      on conflict do nothing;
  end if;
  return null;
end
$$;
