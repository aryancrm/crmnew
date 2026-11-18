-- The desk's common screen (Aryan, 19 Nov): a session opened at Management's, Finance's or
-- Dispatch's tile with the company's password is that desk's screen, not a person's own (no "Me",
-- no payslips on it); each person's own login stays theirs. Dispatch is a desk like Management and
-- Finance: its people press Start, the orders to pack are shared out among them.
alter table session add column desk text check (desk in ('management', 'finance', 'dispatch'));
--> statement-breakpoint
alter table desk_shift drop constraint desk_shift_desk_check;
--> statement-breakpoint
alter table desk_shift add constraint desk_shift_desk_check check (desk in ('management', 'finance', 'dispatch'));
--> statement-breakpoint
alter table order_assignment drop constraint order_assignment_desk_check;
--> statement-breakpoint
alter table order_assignment add constraint order_assignment_desk_check check (desk in ('management', 'finance', 'dispatch'));
