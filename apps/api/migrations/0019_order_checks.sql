-- Whether Finance checks an order before Dispatch, chosen on the order when it is placed (the
-- switch at the top of the order form). Orders placed before keep Finance's check; an Online
-- case's order never had it.
alter table sales_order add column finance_check boolean not null default true;
--> statement-breakpoint
update sales_order set finance_check = false where lead_id is not null;
