-- The next refill, set by a person (Aryan, 19 Nov: "who fills in when this patient needs medicine
-- again, and where does it show?"). The one who took the order (the Online agent, the MedRep, the
-- telesales) types the day the customer's medicines run out; the usual gap between their orders is
-- only the suggestion. It counts until the customer's next order. Kept with who set it and when.
alter table customer add column next_refill_on date;
--> statement-breakpoint
alter table customer add column refill_note text;
--> statement-breakpoint
alter table customer add column refill_set_by bigint references person (id);
--> statement-breakpoint
alter table customer add column refill_set_at timestamptz;
