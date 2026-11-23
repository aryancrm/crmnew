-- Each person's own PIN (Aryan, 21 Nov): the one secret that is only theirs, since the password is
-- the company's. Asked after the password on a personal login and at the doors, and on a desk's
-- common screen before anything is done in their name. Its own wrong tries lock only the PIN.
alter table person
  add column pin_hash text,
  add column pin_set_at timestamptz,
  add column pin_failed integer not null default 0,
  add column pin_locked_until timestamptz;
