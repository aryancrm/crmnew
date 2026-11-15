-- Dispatch: packing an order by batch (the pieces leave the shelf when they go into the box),
-- shipping it with a courier or our own rider, and its delivery. Also who put an order on hold,
-- so each desk takes off its own holds.

-- Which batches went into the box, from which warehouse, and what one piece of each cost to
-- land then. A box unpacked (or an order cancelled before it left) puts them back: the row is
-- kept, marked returned.
create table order_pick (
  id bigint generated always as identity primary key,
  order_id bigint not null references sales_order (id),
  order_item_id bigint not null references order_item (id),
  batch_id bigint not null references batch (id),
  warehouse_id bigint not null references warehouse (id),
  qty integer not null check (qty > 0),
  unit_cost integer check (unit_cost >= 0),
  by_person bigint not null references person (id),
  at timestamptz not null default now(),
  active boolean not null default true,
  returned_at timestamptz
);
--> statement-breakpoint
create index order_pick_order on order_pick (order_id) where active;
--> statement-breakpoint

alter table sales_order add column packed_at timestamptz;
--> statement-breakpoint
alter table sales_order add column packed_by bigint references person (id);
--> statement-breakpoint
-- How it goes: a courier (with its tracking number), our own rider, or picked up at the warehouse.
alter table sales_order add column delivery_method text check (delivery_method in ('courier', 'rider', 'pickup'));
--> statement-breakpoint
alter table sales_order add column courier text;
--> statement-breakpoint
alter table sales_order add column tracking text;
--> statement-breakpoint
alter table sales_order add column rider text;
--> statement-breakpoint
alter table sales_order add column shipped_at timestamptz;
--> statement-breakpoint
alter table sales_order add column shipped_by bigint references person (id);
--> statement-breakpoint
alter table sales_order add column delivered_on date;
--> statement-breakpoint
alter table sales_order add column delivered_at timestamptz;
--> statement-breakpoint
alter table sales_order add column delivered_by bigint references person (id);
--> statement-breakpoint
-- The name of whoever received it and signed the delivery receipt.
alter table sales_order add column received_by text;
--> statement-breakpoint
-- Which desk put it on hold: Management, Finance or Dispatch.
alter table sales_order add column held_role text;
--> statement-breakpoint
update sales_order set held_role = case when held_from in ('finance_check', 'ready_for_invoice') then 'finance' else 'management' end
  where status in ('on_hold', 'exception');
--> statement-breakpoint

-- The signed delivery receipt is a paper on the order.
alter table order_file drop constraint order_file_kind_check;
--> statement-breakpoint
alter table order_file add constraint order_file_kind_check check (kind in ('po', 'payment_proof', 'prescription', 'gl', 'dr', 'other'));
--> statement-breakpoint
create index sales_order_shipped on sales_order (shipped_at desc) where shipped_at is not null;
