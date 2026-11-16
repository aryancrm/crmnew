-- What was sold before this CRM, brought from Zoho: the customers and every sales order with its
-- lines, so "what did we give this hospital before" is answered here. It is history only: no
-- stock moves, no invoices, no points, no to-dos. A line keeps the medicine's name and Zoho's SKU
-- as text (the medicine list comes later); it joins a medicine here through that SKU.

-- The customer first made from a Zoho contact keeps that contact's id.
alter table customer add column zoho_id text;
--> statement-breakpoint
create unique index customer_zoho_once on customer (zoho_id) where zoho_id is not null;
--> statement-breakpoint

-- Every Zoho contact and the customer it is here. The same buyer typed twice in Zoho is one
-- customer here, so both contacts point to it and its history is in one place.
create table zoho_contact (
  zoho_id text primary key,
  customer_id bigint not null references customer (id)
);
--> statement-breakpoint
create index zoho_contact_customer on zoho_contact (customer_id);
--> statement-breakpoint

create table past_order (
  id bigint generated always as identity primary key,
  -- Zoho's own id for the order: bringing it again adds nothing.
  zoho_id text not null unique,
  -- Zoho's number, as staff know it (SO-67227).
  code text not null,
  customer_id bigint not null references customer (id),
  ordered_on date not null,
  -- Zoho's word for where it stood (confirmed, closed, void…). A void order was cancelled.
  status text not null,
  -- Centavos.
  total bigint not null default 0 check (total >= 0),
  -- Zoho's salesperson ("HOS | Name"), division, where the order came from, who invoiced it.
  seller text,
  division text,
  source text,
  invoiced_from text,
  reference text
);
--> statement-breakpoint
create index past_order_customer on past_order (customer_id, ordered_on desc);
--> statement-breakpoint

create table past_order_item (
  id bigint generated always as identity primary key,
  past_order_id bigint not null references past_order (id),
  sku text,
  name text not null,
  unit text,
  qty integer not null check (qty > 0),
  -- Centavos for one piece, as the customer was charged: VAT in, after any discount. Zero when free.
  unit_price integer not null check (unit_price >= 0),
  free boolean not null default false
);
--> statement-breakpoint
create index past_order_item_order on past_order_item (past_order_id);
--> statement-breakpoint
create index past_order_item_sku on past_order_item (lower(sku)) where sku is not null;
