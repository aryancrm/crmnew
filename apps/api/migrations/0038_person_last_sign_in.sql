-- When a person last signed in, kept on the person (sessions end at sign-out): HR sees whether the
-- login it handed over has been used.
alter table person add column last_sign_in_at timestamptz;
--> statement-breakpoint
update person p set last_sign_in_at = (select max(s.created_at) from session s where s.person_id = p.id and s.viewed_by is null);
