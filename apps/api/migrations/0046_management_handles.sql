-- Who in Management is handling an order (Aryan: with two to four people in Management, one
-- says "I'll handle it" and the others see it). Everyone still sees every order.
alter table sales_order add column manage_by bigint references person (id);
--> statement-breakpoint
alter table sales_order add column manage_by_at timestamptz;
