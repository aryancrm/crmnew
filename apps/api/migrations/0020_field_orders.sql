-- What a field order carries as the MedRep fills it in (the hub's fields): its Division, its
-- Sub-division and the Payment Terms agreed with the customer; Management completes them. A
-- line can be free (a Buy 1 Take 1, a sample): the same medicine again at no charge.
alter table sales_order add column division text;
--> statement-breakpoint
alter table sales_order add column sub_division text;
--> statement-breakpoint
alter table sales_order add column payment_term text;
--> statement-breakpoint
alter table order_item add column free boolean not null default false;
