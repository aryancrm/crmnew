-- The hub's order form (docs/PLAN.md 19, step B): where the order came from (Source, one of the
-- hub's list), and the MedRep's word when they go on though a medicine is short on the shelf
-- ("Why are you proceeding?"). A missing proof of payment may also be "the customer is on
-- payment terms", the hub's first reason.
alter table sales_order add column source text;
--> statement-breakpoint
alter table sales_order add column stock_reason text;
--> statement-breakpoint
alter table sales_order drop constraint if exists sales_order_no_proof_reason_check;
--> statement-breakpoint
alter table sales_order add constraint sales_order_no_proof_reason_check
  check (no_proof_reason in ('on_terms', 'payment_to_follow', 'paid_no_slip', 'other'));
