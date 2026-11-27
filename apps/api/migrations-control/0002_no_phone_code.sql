-- The control panel signs in with the login ID and the password alone (Aryan, 26 Nov 2026: "remove
-- the phone code"); its authenticator key is no longer kept. Five wrong tries still lock a login
-- for 15 minutes.

alter table control_person alter column totp_sealed drop not null;
--> statement-breakpoint
update control_person set totp_sealed = null, totp_step = null;
