-- The piece is the unit. Medicines are sold by the tablet as well as by the box: a strip of
-- ten is cut when someone needs four. Stock, costs and prices are all for ONE piece (a tablet,
-- a capsule, a vial); `pack_size` says how many pieces a pack holds, and a pack may carry its
-- own price when a whole box is cheaper than its tablets one by one.

alter table medicine add column pack_size integer not null default 1 check (pack_size >= 1);
--> statement-breakpoint
alter table medicine_price add column pack_amount integer check (pack_amount >= 0);
