-- Goods that come back after delivery (Aryan): the MedRep (or Management) asks, Management
-- approves, Dispatch checks what came back (good goes back on the shelf, damaged is written
-- off), and the bill is credited by what came back. Money already paid beyond the new bill is
-- given back from Finance's Refunds owed.
create table sales_return (
  id bigint generated always as identity primary key,
  code text unique,
  order_id bigint not null references sales_order (id),
  status text not null default 'requested'
    check (status in ('requested', 'approved', 'received', 'rejected', 'cancelled')),
  reason text not null check (reason in ('expired', 'damaged', 'wrong_item', 'not_needed', 'other')),
  note text,
  requested_by bigint not null references person (id),
  requested_at timestamptz not null default now(),
  decided_by bigint references person (id),
  decided_at timestamptz,
  decided_note text,
  received_by bigint references person (id),
  received_at timestamptz,
  credit integer not null default 0 check (credit >= 0)
);
--> statement-breakpoint
create index sales_return_order on sales_return (order_id);
--> statement-breakpoint
create index sales_return_status on sales_return (status, requested_at);
--> statement-breakpoint
create table sales_return_line (
  id bigint generated always as identity primary key,
  return_id bigint not null references sales_return (id),
  order_item_id bigint not null references order_item (id),
  medicine_id bigint not null references medicine (id),
  qty integer not null check (qty > 0),
  unit_price integer not null check (unit_price >= 0),
  -- What Dispatch found: back on the shelf, damaged (written off), or not received.
  outcome text check (outcome in ('restocked', 'damaged', 'missing')),
  batch_id bigint references batch (id),
  warehouse_id bigint references warehouse (id)
);
--> statement-breakpoint
create index sales_return_line_return on sales_return_line (return_id);
--> statement-breakpoint
-- What the returns took off the bill: the invoice's total is what the customer owes now;
-- total + credited is what it was made for.
alter table invoice add column credited integer not null default 0 check (credited >= 0);
--> statement-breakpoint
insert into counter (name, value) values ('return', 0) on conflict do nothing;
