-- A guarantee letter's order (Aryan, 19 Nov: "the GL price isn't known before: the agency writes
-- on the letter how much it pays for our quotation; at the end we write what we got"): the letter's
-- number and the amount it approves, with who wrote them and when. The order's own prices stay
-- the quotation's; the letter's amount is what the agency pays.
alter table sales_order add column gl_number text;
--> statement-breakpoint
alter table sales_order add column gl_amount integer check (gl_amount >= 0);
--> statement-breakpoint
alter table sales_order add column gl_set_by bigint references person (id);
--> statement-breakpoint
alter table sales_order add column gl_set_at timestamptz;
