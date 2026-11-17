-- Tax a customer withholds on paying (EWT, 1–2%, with BIR Form 2307): Zoho recorded it on the
-- payment ("Withholding Tax Amount"). Here it is a payment of its own, method 'withholding', its
-- reference the 2307: it settles the invoice like money, but it is no cash in hand and is never
-- given back as cash.
alter table payment drop constraint if exists payment_method_check;
--> statement-breakpoint
alter table payment add constraint payment_method_check
  check (method in ('cash', 'bank', 'check', 'ewallet', 'other', 'points', 'withholding'));
