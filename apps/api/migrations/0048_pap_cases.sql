-- PAP (patient assistance) cases: the Online desk's guarantee-letter case, opened and worked
-- by a PAP MedRep. A case belongs to one desk; the PAP MedRep sees only their own.
alter table lead add column desk text not null default 'online' check (desk in ('online', 'pap'));
--> statement-breakpoint
create index lead_by_desk on lead (desk, assigned_to);
--> statement-breakpoint
-- The letter's last day: an expired letter places no order.
alter table lead add column gl_expires_on date;
--> statement-breakpoint
-- The claim after delivery: when it went to the agency and its reference.
alter table lead add column claim_sent_on date;
--> statement-breakpoint
alter table lead add column claim_ref text;
--> statement-breakpoint
-- PCSO asks for three quotations: ours and two other vendors' (each from their written quote).
alter table lead add column canvass jsonb not null default '[]'::jsonb;
--> statement-breakpoint
alter table lead_file drop constraint lead_file_kind_check;
--> statement-breakpoint
alter table lead_file add constraint lead_file_kind_check
  check (kind in ('rx', 'osca_id', 'pwd_id', 'pwd_booklet', 'valid_id', 'med_cert', 'gl_letter', 'pickup_photo', 'other', 'unsorted'));
