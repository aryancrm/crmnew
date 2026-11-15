-- Where each field person was last, sent by their phone every few minutes while their working day
-- runs and the app is open (one row a person: the latest place only, no trail).
create table live_location (
  person_id bigint primary key references person (id),
  -- "lat,lng".
  place text not null,
  accuracy_m integer,
  at timestamptz not null default now()
);
