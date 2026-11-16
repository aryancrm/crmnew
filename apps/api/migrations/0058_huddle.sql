-- The 7 PM huddle (Hospital CHC Playbook): each seller declares the day's four numbers to their
-- coach, prefilled from the day's invoices, payments and visits; a day without an invoice needs
-- a blocker note. One declaration per person per day; declaring again replaces it until the day
-- is over. The coach's screen reads who declared, who is red and the blockers.
create table huddle (
  person_id bigint not null references person (id),
  day date not null,
  seat_id bigint references seat (id),
  -- Centavos invoiced and collected that day, and doctor / hospital visits done.
  sales bigint not null default 0 check (sales >= 0),
  collected bigint not null default 0 check (collected >= 0),
  visits integer not null default 0 check (visits >= 0),
  invoiced boolean not null default false,
  -- Why no invoice, or what stands in the way.
  blocker text,
  -- Tomorrow's first stop.
  tomorrow text,
  declared_at timestamptz not null default now(),
  primary key (person_id, day)
);
