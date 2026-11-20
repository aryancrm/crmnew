-- A KPI card for every seat (docs/PLAN.md 23, Aryan 20 Nov): a MedRep in the field keeps two cards
-- a month, their channel's and Field work, so a locked month is kept per card.
alter table score_month drop constraint score_month_pkey;
--> statement-breakpoint
alter table score_month add primary key (person_id, month, recipe);
