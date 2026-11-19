-- What the hub's MedRep form carries with the Division (Aryan, 19 Nov, evening: "the MedRep's
-- screen universal, as the hub's"): the Headquarter (HOS N/A, B2C B2C, CLIDP and B2B ON SITE,
-- B&B / URO / STC the location, a patient-assistance order Telesales), and, for a prescription
-- Division's order with no prescription yet, why (the hub's "No prescription? Say why").
alter table sales_order add column headquarter text;
--> statement-breakpoint
alter table sales_order add column no_rx_reason text;
