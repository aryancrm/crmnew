-- A login ID belongs to the seat, not to the person: hos1, rx2, tl1, fin1. When someone leaves,
-- the next person in the seat signs in with the same ID and a new password of their own. A
-- person's own email is kept only as a way to reach them, so it may be empty.
alter table seat add column login text;
--> statement-breakpoint
create unique index seat_login_once on seat (lower(login)) where active and login is not null;
--> statement-breakpoint
alter table person alter column email drop not null;
