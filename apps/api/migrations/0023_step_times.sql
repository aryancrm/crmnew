-- How long each order stood at each step. `status_since` is when the order reached the status
-- it is at now (Management's wait starts when it comes to Management, Finance's when it comes to
-- Finance); `order_step` keeps every step it passed with when it came and when it left, so team
-- leads, managers and the CEO can see where orders wait. Both are kept by the database itself on
-- every change of status, whichever code makes it.
alter table sales_order add column status_since timestamptz;
--> statement-breakpoint
update sales_order set status_since = coalesce(updated_at, created_at);
--> statement-breakpoint
alter table sales_order alter column status_since set default now();
--> statement-breakpoint
alter table sales_order alter column status_since set not null;
--> statement-breakpoint
create table order_step (
  id bigint generated always as identity primary key,
  order_id bigint not null references sales_order (id),
  status text not null,
  entered_at timestamptz not null default now(),
  left_at timestamptz
);
--> statement-breakpoint
create index order_step_order on order_step (order_id, entered_at);
--> statement-breakpoint
create index order_step_open on order_step (status) where left_at is null;
--> statement-breakpoint
-- Orders from before: one open step each, from their last change (the earlier steps aren't known).
insert into order_step (order_id, status, entered_at) select id, status, status_since from sales_order;
--> statement-breakpoint
create function order_status_since() returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status then
    new.status_since := now();
  end if;
  return new;
end
$$;
--> statement-breakpoint
create trigger order_status_since before update of status on sales_order
  for each row execute function order_status_since();
--> statement-breakpoint
create function order_step_moved() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    insert into order_step (order_id, status, entered_at) values (new.id, new.status, now());
  elsif new.status is distinct from old.status then
    update order_step set left_at = now() where order_id = new.id and left_at is null;
    insert into order_step (order_id, status, entered_at) values (new.id, new.status, now());
  end if;
  return null;
end
$$;
--> statement-breakpoint
create trigger order_step_moved after insert or update of status on sales_order
  for each row execute function order_step_moved();
