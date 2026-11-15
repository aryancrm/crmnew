-- Orders, after the hub's (hub.getmeds.ph): a MedRep places one, Management approves it,
-- then Finance, then Dispatch. Every step is written to the order's timeline.

create table sales_order (
  id bigint generated always as identity primary key,
  code text unique,
  customer_id bigint not null references customer (id),
  -- Whose order it is, and who typed it in (the same person for a MedRep).
  medrep_id bigint not null references person (id),
  raised_by bigint not null references person (id),
  channel_id bigint references channel (id),
  status text not null check (
    status in (
      'draft', 'pending_approval', 'finance_check', 'ready_for_invoice', 'invoiced',
      'ready_for_dispatch', 'packing', 'shipped', 'completed', 'on_hold', 'exception', 'cancelled'
    )
  ),
  -- Where the order stood before it was put on hold or marked an exception.
  held_from text,
  flag_reason text,
  -- How the customer pays, as it stood when the order was placed.
  payment_terms text not null check (payment_terms in ('advance', 'cod', 'days')),
  payment_days integer,
  delivery_address text,
  receiver text,
  receiver_phone text,
  note text,
  expected_on date,
  -- Which warehouse it ships from. Management picks it on approval.
  warehouse_id bigint references warehouse (id),
  total integer not null default 0 check (total >= 0),
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  approved_at timestamptz,
  approved_by bigint references person (id),
  updated_at timestamptz not null default now()
);
--> statement-breakpoint
create index sales_order_status on sales_order (status, updated_at);
--> statement-breakpoint
create index sales_order_medrep on sales_order (medrep_id, created_at desc);
--> statement-breakpoint
create index sales_order_customer on sales_order (customer_id, created_at desc);
--> statement-breakpoint

create table order_item (
  id bigint generated always as identity primary key,
  order_id bigint not null references sales_order (id),
  medicine_id bigint not null references medicine (id),
  -- Pieces (tablets, vials).
  qty integer not null check (qty > 0),
  -- Which of the medicine's prices the MedRep picked, what that price was, what he gave,
  -- and why when he gave less. Centavos for one piece.
  price_kind text not null,
  list_price integer not null check (list_price >= 0),
  unit_price integer not null check (unit_price >= 0),
  price_reason text
);
--> statement-breakpoint
create index order_item_order on order_item (order_id);
--> statement-breakpoint

-- The order's timeline: who did what, when. `stage` is set on the lines that move the order
-- one stage on (created, approved, finance_verified, invoiced, paid, packed, shipped,
-- delivered, completed).
create table order_event (
  id bigint generated always as identity primary key,
  order_id bigint not null references sales_order (id),
  kind text not null,
  stage text,
  message text not null,
  by_person bigint not null references person (id),
  at timestamptz not null default now()
);
--> statement-breakpoint
create index order_event_order on order_event (order_id, at);
