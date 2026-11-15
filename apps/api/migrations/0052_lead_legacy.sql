-- A case brought over from the old CRM keeps the old record's id, so the import can run again
-- (after a Facebook page is connected) without making it twice.
alter table lead add column legacy_id text;
--> statement-breakpoint
create unique index lead_legacy_once on lead (legacy_id) where legacy_id is not null;
