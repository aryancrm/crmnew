-- Inventory: medicines, their prices, and stock by warehouse and batch.

create table warehouse (
  id bigint generated always as identity primary key,
  code text not null unique,
  name text not null,
  is_default boolean not null default false,
  active boolean not null default true
);
--> statement-breakpoint
-- At most one default warehouse.
create unique index warehouse_one_default on warehouse (is_default) where is_default;
--> statement-breakpoint

create table medicine (
  id bigint generated always as identity primary key,
  code text unique,
  name text not null,
  generic text,
  strength text,
  form text,
  pack text,
  rx boolean not null default true,
  vat text not null default 'exempt' check (vat in ('exempt', 'vat12', 'zero')),
  reorder_level integer not null default 0 check (reorder_level >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
--> statement-breakpoint
-- The same medicine is never listed twice: same name and strength, whatever the capitals.
create unique index medicine_once on medicine (lower(name), lower(coalesce(strength, '')));
--> statement-breakpoint

-- One price per kind of buyer, in whole centavos.
create table medicine_price (
  medicine_id bigint not null references medicine (id),
  buyer_type text not null check (
    buyer_type in ('patient', 'hospital', 'doctor', 'distributor', 'drugstore', 'bidding')
  ),
  amount integer not null check (amount >= 0),
  primary key (medicine_id, buyer_type)
);
--> statement-breakpoint

-- A dated promo price a MedRep may give to any buyer.
create table promo (
  id bigint generated always as identity primary key,
  medicine_id bigint not null references medicine (id),
  name text not null,
  amount integer not null check (amount >= 0),
  starts_on date not null,
  ends_on date not null,
  created_by bigint not null references person (id),
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);
--> statement-breakpoint
create index promo_medicine on promo (medicine_id, ends_on);
--> statement-breakpoint

-- Every price or promo change, kept for good.
create table price_change (
  id bigint generated always as identity primary key,
  medicine_id bigint not null references medicine (id),
  what text not null,
  old_amount integer,
  new_amount integer,
  by_person bigint not null references person (id),
  at timestamptz not null default now()
);
--> statement-breakpoint
create index price_change_medicine on price_change (medicine_id, at desc);
--> statement-breakpoint

create table batch (
  id bigint generated always as identity primary key,
  medicine_id bigint not null references medicine (id),
  batch_no text not null,
  expires_on date not null,
  created_at timestamptz not null default now(),
  unique (medicine_id, batch_no)
);
--> statement-breakpoint
create index batch_expiry on batch (expires_on);
--> statement-breakpoint

-- What is on the shelf now: one row per batch per warehouse. It can never go below zero.
create table stock (
  batch_id bigint not null references batch (id),
  warehouse_id bigint not null references warehouse (id),
  qty integer not null check (qty >= 0),
  primary key (batch_id, warehouse_id)
);
--> statement-breakpoint
create index stock_warehouse on stock (warehouse_id);
--> statement-breakpoint

-- Every change to the shelf, kept for good. `stock` is the sum of these.
create table stock_move (
  id bigint generated always as identity primary key,
  medicine_id bigint not null references medicine (id),
  batch_id bigint not null references batch (id),
  warehouse_id bigint not null references warehouse (id),
  qty integer not null check (qty <> 0),
  kind text not null check (kind in ('receive', 'move_out', 'move_in', 'count', 'deliver', 'return')),
  ref text,
  note text,
  by_person bigint not null references person (id),
  at timestamptz not null default now()
);
--> statement-breakpoint
create index stock_move_medicine on stock_move (medicine_id, at desc);
--> statement-breakpoint

-- Stock a supplier is expected to deliver.
create table incoming (
  id bigint generated always as identity primary key,
  medicine_id bigint not null references medicine (id),
  warehouse_id bigint not null references warehouse (id),
  qty integer not null check (qty > 0),
  expected_on date not null,
  supplier text,
  ref text,
  state text not null default 'expected' check (state in ('expected', 'received', 'cancelled')),
  received_qty integer,
  received_at timestamptz,
  created_by bigint not null references person (id),
  created_at timestamptz not null default now()
);
--> statement-breakpoint
create index incoming_open on incoming (medicine_id) where state = 'expected';
--> statement-breakpoint

-- What Dispatch tells the sellers about a medicine: out, low, back, or a note.
create table stock_news (
  id bigint generated always as identity primary key,
  medicine_id bigint not null references medicine (id),
  kind text not null check (kind in ('out', 'low', 'back', 'note')),
  message text,
  by_person bigint not null references person (id),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
--> statement-breakpoint
create index stock_news_open on stock_news (created_at desc) where closed_at is null;
