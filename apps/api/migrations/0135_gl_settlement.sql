-- A guarantee letter's agency often pays less than its letter (Aryan, 22 Nov): the patient pays
-- the rest, or the company lets it go. Letting it go is a deduction of its own kind, so the books
-- and the reports can tell it from a chain's deductions.
alter table payment drop constraint if exists payment_deduction_kind_check;
--> statement-breakpoint
alter table payment add constraint payment_deduction_kind_check
  check (deduction_kind in ('near_expiry', 'listing_fee', 'promo', 'penalty', 'other', 'gl_waived'));
