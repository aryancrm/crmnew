-- A photo brought from the old CRM keeps its old id, so bringing them again adds only what is missing.
alter table lead_file add column legacy_id text;
--> statement-breakpoint
create unique index lead_file_legacy_once on lead_file (legacy_id) where legacy_id is not null;
