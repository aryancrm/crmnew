-- A customer's whole story is read on their page (orders, payments, enquiries on their number),
-- and every list says who they are under: these reads stay quick with 130 people working.
create index if not exists lead_customer on lead (customer_id) where customer_id is not null;
--> statement-breakpoint
create index if not exists payment_customer on payment (customer_id, paid_on desc) where active;
--> statement-breakpoint
create index if not exists sales_order_lead on sales_order (lead_id) where lead_id is not null;
