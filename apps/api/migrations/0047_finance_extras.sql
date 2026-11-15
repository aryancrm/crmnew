-- What the hub's Finance had that the CRM lacked: the MedRep's reason when an order paid in
-- advance has no proof of payment yet, and Finance's screenshots with a hold (shown to the MedRep
-- with the reason).
alter table sales_order add column no_proof_reason text
  check (no_proof_reason in ('payment_to_follow', 'paid_no_slip', 'other'));
--> statement-breakpoint
alter table sales_order add column no_proof_note text;
--> statement-breakpoint
alter table order_file add column hold_event_id bigint references order_event (id);
