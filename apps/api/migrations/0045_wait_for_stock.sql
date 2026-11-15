-- Waiting for stock: an order held until what it needs is on the shelf. When stock comes in
-- (received, counted up, put back) the person who held it and the MedRep are told once.
alter table sales_order add column waiting_stock_at timestamptz;
--> statement-breakpoint
alter table sales_order add column waiting_stock_by bigint references person (id);
