-- How each parcel left (the courier, our rider, picked up), kept on its step: a parcel that comes
-- back loses its courier on the order, but the warehouse's count by courier keeps it.
alter table order_step add column how text;
--> statement-breakpoint
create function order_step_how() returns trigger language plpgsql as $$
begin
  if new.status in ('shipped', 'completed') then
    select case when o.delivery_method = 'rider' then 'Our rider'
        when o.delivery_method = 'pickup' then 'Picked up'
        when o.delivery_method = 'courier' then coalesce(o.courier, 'Courier') end
      into new.how from sales_order o where o.id = new.order_id;
  end if;
  return new;
end
$$;
--> statement-breakpoint
create trigger order_step_how before insert on order_step for each row execute function order_step_how();
--> statement-breakpoint
update order_step s set how = case when o.delivery_method = 'rider' then 'Our rider'
    when o.delivery_method = 'pickup' then 'Picked up'
    when o.delivery_method = 'courier' then coalesce(o.courier, 'Courier') end
  from sales_order o where o.id = s.order_id and s.status in ('shipped', 'completed');
