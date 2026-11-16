-- An Rx CHC's doctor list (Rx CHC Play Book): doctors in three tiers, Tier 1 seen four times a
-- month, Tier 2 twice, Tier 3 once. As many as the CHC's work has (the playbook's 80 is a guide). The list belongs to the seat, so the next
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
