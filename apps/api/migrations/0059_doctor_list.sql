-- An Rx CHC's doctor list (Rx CHC Play Book): 80 doctors in three tiers, 20 Tier 1 (seen four
-- times a month), 40 Tier 2 (twice), 20 Tier 3 (once). The list belongs to the seat, so the next
-- person in the seat keeps it. Taking a doctor off the list ends the line; it is not deleted.
create table doctor_list (
  id bigint generated always as identity primary key,
  seat_id bigint not null references seat (id),
  customer_id bigint not null references customer (id),
  tier smallint not null check (tier in (1, 2, 3)),
  set_by bigint not null references person (id),
  set_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_by bigint references person (id)
);
--> statement-breakpoint
create unique index doctor_list_open on doctor_list (seat_id, customer_id) where ended_at is null;
