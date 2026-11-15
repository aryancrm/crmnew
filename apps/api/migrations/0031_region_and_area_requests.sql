-- A team lead may also ask for a new region (a team under theirs, with who leads it) or a new
-- area (its cities, and which seat of theirs gets it). The CEO or the Admin approves; then it is
-- made and the team is told on Messages.
alter table seat_request add column kind text not null default 'seat' check (kind in ('seat', 'region', 'area'));
--> statement-breakpoint
alter table seat_request alter column module drop not null;
--> statement-breakpoint
alter table seat_request add column lead_person_id bigint references person (id);
--> statement-breakpoint
alter table seat_request add column for_seat_id bigint references seat (id);
--> statement-breakpoint
alter table seat_request add column made_unit_id bigint references org_unit (id);
--> statement-breakpoint
alter table seat_request add column made_area_id bigint references area (id);
