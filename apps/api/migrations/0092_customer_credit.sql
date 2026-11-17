-- A customer's credit (17 Nov, step C3): what Zoho's open credit notes still hold for them, and
-- money paid beyond a bill that Finance keeps for their next one instead of giving it back. Used
-- on an invoice as a payment of its own (method credit, pointing at the credit note or the kept
-- refund), never counted as cash in, and given back to the customer if that invoice is cancelled.
alter table payment drop constraint if exists payment_method_check;
--> statement-breakpoint
alter table payment add constraint payment_method_check
  check (method in ('cash', 'bank', 'check', 'ewallet', 'other', 'points', 'withholding', 'credit'));
--> statement-breakpoint
alter table payment add column credit_doc_id bigint references book_doc (id);
--> statement-breakpoint
alter table payment add column credit_refund_id bigint references refund (id);
--> statement-breakpoint
alter table refund drop constraint if exists refund_method_check;
--> statement-breakpoint
alter table refund add constraint refund_method_check
  check (method in ('cash', 'bank', 'check', 'ewallet', 'other', 'credit'));
