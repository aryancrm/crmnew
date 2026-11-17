-- Dispatch the hub way (plan 19 step C2): a courier parcel shipped before its waybill is ready
-- keeps why there is no tracking number yet (waiting for the waybill...), until the number is
-- added; and the printed address slip on the parcel is checked against the order before it leaves.
alter table sales_order add column tracking_wait text;
--> statement-breakpoint
alter table sales_order add column address_checked_at timestamptz;
--> statement-breakpoint
alter table sales_order add column address_checked_by bigint references person (id);
