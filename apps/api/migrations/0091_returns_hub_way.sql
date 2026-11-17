-- Returns the hub way (Aryan, 17 Nov): where the goods are decides the road. Coming back: Dispatch
-- checks them, then Management credits the bill (or not). The customer keeps them: credited when
-- Management approves. Not shipped yet: Management approving cancels the order (what was paid goes
-- on Finance's refunds).
alter table sales_return drop constraint sales_return_status_check;
--> statement-breakpoint
alter table sales_return add constraint sales_return_status_check
  check (status in ('requested', 'approved', 'checked', 'received', 'rejected', 'cancelled'));
--> statement-breakpoint
alter table sales_return add column goods text not null default 'coming_back'
  check (goods in ('coming_back', 'customer_keeps', 'not_shipped'));
--> statement-breakpoint
alter table sales_return add column credited_by bigint references person (id);
--> statement-breakpoint
alter table sales_return add column credited_at timestamptz;
--> statement-breakpoint
alter table sales_return_line drop constraint sales_return_line_outcome_check;
--> statement-breakpoint
alter table sales_return_line add constraint sales_return_line_outcome_check
  check (outcome in ('restocked', 'damaged', 'missing', 'kept'));
