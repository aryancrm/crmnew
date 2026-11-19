-- A business can buy through the Online desk (Aryan, 19 Nov: "B2B orders that come in through
-- Online should count as Online's entries"). The case says who buys: a patient (none here), or a
-- business of this kind, priced from its own list (a drugstore at the drugstore price). The
-- quotation keeps the buyer it was priced for, so a change of buyer asks for it again.
alter table lead add column buyer_kind text check (buyer_kind in ('hospital', 'doctor', 'drugstore', 'distributor', 'government'));
--> statement-breakpoint
alter table lead add column quote_buyer text;
