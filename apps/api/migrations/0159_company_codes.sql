-- One code per company everywhere (26 Nov 2026, src/companies.ts): 2mg = 2MG Incorporated, gpi =
-- Getmeds Philippines Incorporated. Orders and invoices said "getmeds" for the company HR and
-- payroll already call "gpi". Moved here before more finance documents are made under two codes.
-- Nothing else changes: an invoice keeps its number, and Getmeds Philippines' series (INV-) goes
-- on from the same counter, renamed with the code.

alter table sales_order drop constraint if exists sales_order_invoice_from_check;
--> statement-breakpoint
alter table invoice drop constraint if exists invoice_invoice_from_check;
--> statement-breakpoint
update sales_order set invoice_from = 'gpi' where invoice_from = 'getmeds';
--> statement-breakpoint
update invoice set invoice_from = 'gpi' where invoice_from = 'getmeds';
--> statement-breakpoint
alter table sales_order add constraint sales_order_invoice_from_check check (invoice_from in ('2mg', 'gpi'));
--> statement-breakpoint
alter table invoice add constraint invoice_invoice_from_check check (invoice_from in ('2mg', 'gpi'));
--> statement-breakpoint
-- The invoice counter is named after the code: renamed, so the next number follows the last one.
update counter set name = 'invoice:gpi' where name = 'invoice:getmeds';
--> statement-breakpoint
insert into counter (name, value) values ('invoice:gpi', 0) on conflict (name) do nothing;
