-- More of what is known about a medicine, as the company's item list keeps it: its own SKU,
-- who makes it, under which of our brands it is sold, its category and the unit it is counted in.

alter table medicine add column sku text;
--> statement-breakpoint
alter table medicine add column unit text;
--> statement-breakpoint
alter table medicine add column manufacturer text;
--> statement-breakpoint
alter table medicine add column brand text;
--> statement-breakpoint
alter table medicine add column category text;
--> statement-breakpoint
-- A SKU names one medicine only, whatever the capitals.
create unique index medicine_sku_once on medicine (lower(sku)) where sku is not null;
