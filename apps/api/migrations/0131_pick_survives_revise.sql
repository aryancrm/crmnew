-- An order packed, then unpacked and changed: its lines are written again (order_item rows are
-- replaced, the old ones kept in order_version), but the unpacked picks still pointed at the old
-- lines and the database refused the change. A pick that was put back keeps its order, batch and
-- warehouse; its line may go.
alter table order_pick alter column order_item_id drop not null;
--> statement-breakpoint
alter table order_pick drop constraint order_pick_order_item_id_fkey;
--> statement-breakpoint
alter table order_pick add constraint order_pick_order_item_id_fkey
  foreign key (order_item_id) references order_item (id) on delete set null;
--> statement-breakpoint
-- A pick still in the box always names its line.
alter table order_pick add constraint order_pick_active_has_line check (not active or order_item_id is not null);
