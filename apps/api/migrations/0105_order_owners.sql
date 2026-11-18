-- Every order waiting at Management or Finance carries the name of who has it (Aryan, 18 Nov):
-- the waiting orders are shared out among that desk's people on the company chart, whoever has
-- the fewest open first (someone on leave is skipped); anyone may still take one over. Who has it
-- at Management is manage_by; this is Finance's.
alter table sales_order add column finance_by bigint references person (id);
--> statement-breakpoint
alter table sales_order add column finance_by_at timestamptz;
