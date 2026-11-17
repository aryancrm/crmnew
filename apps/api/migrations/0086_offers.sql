-- Offers on a medicine (docs/PLAN.md 18 step 2 and 19 step B): the hub's Buy 1 Take 1 and
-- Aryan's Christmas offers file — for one kind of buyer (or every buyer), Buy X Take Y (the free
-- pieces added to an order by the server, never typed), and / or a price per piece bought
-- ("Special price"), between two days. An offer ended early keeps its record.
create table offer (
  id bigint generated always as identity primary key,
  medicine_id bigint not null references medicine (id),
  -- The customer kind it is for; none: every buyer.
  buyer_kind text check (buyer_kind in ('hospital', 'doctor', 'patient', 'drugstore', 'distributor', 'government')),
  buy integer not null default 1 check (buy >= 1),
  take integer not null default 0 check (take >= 0),
  -- Centavos for each piece bought while it runs; none: the buyer's own price.
  price integer check (price >= 0),
  name text not null,
  note text,
  starts_on date not null,
  ends_on date not null,
  created_by bigint not null references person (id),
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_by bigint references person (id),
  check (ends_on >= starts_on),
  check (take > 0 or price is not null)
);
--> statement-breakpoint
create index offer_medicine on offer (medicine_id, ends_on) where ended_at is null;
--> statement-breakpoint
-- A line priced by an offer, or the free pieces an offer added.
alter table order_item add column offer_id bigint references offer (id);
