-- Each person has a password of their own. Whoever is here already has none yet: no sign-in and no
-- open session works for them until they are given a one-time password (scripts/give-passwords.ts,
-- or "Give a new password" in Teams & people). People added from now on are given one as they join.
-- Nothing is deleted or rewritten here.
alter table person add column password_pending boolean not null default true;
--> statement-breakpoint
alter table person alter column password_pending set default false;
