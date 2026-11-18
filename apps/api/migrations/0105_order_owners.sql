-- Who in Finance has an order (Management's is manage_by): every order waiting at Management or
-- Finance carries the name of who has it (Aryan, 18 Nov).
alter table sales_order add column finance_by bigint references person (id);
--> statement-breakpoint
alter table sales_order add column finance_by_at timestamptz;
