-- Buying from abroad: suppliers, purchases with every cost on the way in, and what each batch
-- cost to land. Also the Inventory role: the person who runs all of this.

alter table person drop constraint person_role_check;
--> statement-breakpoint
alter table person add constraint person_role_check check (
  role in ('medrep', 'team_lead', 'manager', 'management', 'finance', 'dispatch', 'inventory', 'ceo', 'online', 'admin')
);
--> statement-breakpoint

-- Purchases replace the plain "expected delivery" list.
drop table incoming;
--> statement-breakpoint

create table supplier (
  id bigint generated always as identity primary key,
  name text not null,
  country text,
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  contact text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
--> statement-breakpoint
create unique index supplier_once on supplier (lower(name));
--> statement-breakpoint

-- One order to a supplier. Goods are priced in the supplier's currency; `fx_rate` is how many
-- pesos one unit of that currency cost. Totals are whole centavos.
create table purchase (
  id bigint generated always as identity primary key,
  code text unique,
  supplier_id bigint not null references supplier (id),
  warehouse_id bigint not null references warehouse (id),
  state text not null default 'ordered' check (state in ('ordered', 'received', 'cancelled')),
  ordered_on date not null,
  expected_on date not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  fx_rate numeric(14, 6) not null check (fx_rate > 0),
  supplier_ref text,
  note text,
  goods_total integer not null default 0 check (goods_total >= 0),
  extras_total integer not null default 0 check (extras_total >= 0),
  created_by bigint not null references person (id),
  created_at timestamptz not null default now(),
  received_by bigint references person (id),
  received_at timestamptz
);
--> statement-breakpoint
create index purchase_state on purchase (state, expected_on);
--> statement-breakpoint

-- A medicine on a purchase. `goods`, `extras` and `landed_unit` are worked out by the API:
-- what the goods cost in pesos, this line's share of the other costs, and the cost per piece.
create table purchase_line (
  id bigint generated always as identity primary key,
  purchase_id bigint not null references purchase (id),
  medicine_id bigint not null references medicine (id),
  qty integer not null check (qty > 0),
  unit_cost numeric(14, 4) not null check (unit_cost >= 0),
  received_qty integer check (received_qty >= 0),
  batch_id bigint references batch (id),
  goods integer not null default 0 check (goods >= 0),
  extras integer not null default 0 check (extras >= 0),
  landed_unit integer not null default 0 check (landed_unit >= 0),
  unique (purchase_id, medicine_id)
);
--> statement-breakpoint
create index purchase_line_medicine on purchase_line (medicine_id);
--> statement-breakpoint

-- A cost on the way in, in pesos: the flight, packaging, customs and so on.
create table purchase_cost (
  id bigint generated always as identity primary key,
  purchase_id bigint not null references purchase (id),
  kind text not null check (kind in ('freight', 'packaging', 'customs', 'insurance', 'transport', 'other')),
  amount integer not null check (amount >= 0),
  note text
);
--> statement-breakpoint
create index purchase_cost_purchase on purchase_cost (purchase_id);
--> statement-breakpoint

-- What one piece of this batch cost to land, in centavos. Two batches of the same medicine
-- can cost differently while selling at the same price.
alter table batch add column unit_cost integer check (unit_cost >= 0);
--> statement-breakpoint
alter table batch add column purchase_line_id bigint references purchase_line (id);
