-- Every time an order at Management or Finance is given to someone, taken over, let go or put back
-- (Aryan, 18 Nov: "each person's data, all of it"): when each person had which order, so the time
-- each took is counted from when it was theirs.
create table order_assignment (
  id bigint generated always as identity primary key,
  order_id bigint not null references sales_order (id),
  desk text not null check (desk in ('management', 'finance')),
  person_id bigint references person (id),
  -- given: shared out automatically; took: taken (or taken over); released: let go; stopped: put
  -- back when its person stopped.
  how text not null check (how in ('given', 'took', 'released', 'stopped')),
  at timestamptz not null default now(),
  by_person bigint references person (id)
);
--> statement-breakpoint
create index order_assignment_order on order_assignment (order_id, desk, at);
--> statement-breakpoint
create index order_assignment_person on order_assignment (person_id, at);
