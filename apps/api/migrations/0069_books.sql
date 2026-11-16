-- The books (docs/PLAN.md 17): every document of Zoho Inventory's Sales and Purchases, in one
-- place, laid out as Zoho files them. Zoho's own rows come over with their id and every field that
-- holds data (the ones without a column of their own go in `fields`, under Zoho's own name), so
-- nothing is left behind; this CRM's documents are added to the same tables. Money is whole
-- centavos of the document's currency (`fx_rate` pesos to one unit of it). Nothing is deleted: a
-- document is voided or cancelled by its status.

-- Vendors are the suppliers, with what Zoho keeps about them.
alter table supplier add column zoho_id text;
--> statement-breakpoint
create unique index supplier_zoho on supplier (zoho_id) where zoho_id is not null;
--> statement-breakpoint
alter table supplier add column company_name text;
--> statement-breakpoint
alter table supplier add column email text;
--> statement-breakpoint
alter table supplier add column phone text;
--> statement-breakpoint
alter table supplier add column mobile text;
--> statement-breakpoint
alter table supplier add column website text;
--> statement-breakpoint
alter table supplier add column payment_terms text;
--> statement-breakpoint
alter table supplier add column tin text;
--> statement-breakpoint
alter table supplier add column billing_address text;
--> statement-breakpoint
alter table supplier add column shipping_address text;
--> statement-breakpoint
alter table supplier add column fields jsonb not null default '{}'::jsonb;
--> statement-breakpoint
alter table supplier add column zoho_created timestamptz;
--> statement-breakpoint

-- A vendor's people (Zoho's contact persons).
create table supplier_person (
  id bigint generated always as identity primary key,
  supplier_id bigint not null references supplier (id),
  zoho_id text unique,
  name text not null,
  email text,
  phone text,
  mobile text,
  designation text,
  fields jsonb not null default '{}'::jsonb
);
--> statement-breakpoint

create table book_doc (
  id bigint generated always as identity primary key,
  kind text not null check (kind in (
    'purchase_order', 'purchase_receive', 'bill', 'vendor_payment', 'vendor_credit',
    'sales_order', 'invoice', 'customer_payment', 'sales_return', 'credit_note',
    'package', 'shipment', 'transfer_order', 'adjustment'
  )),
  zoho_id text,
  number text not null,
  reference text,
  doc_date date not null,
  due_date date,
  -- Zoho's own word for where it stands (issued, partially_received, overdue, paid, void…).
  status text not null,
  supplier_id bigint references supplier (id),
  customer_id bigint references customer (id),
  -- The party as the document names it (kept even when it is matched to a vendor or customer).
  party_name text,
  currency text not null default 'PHP' check (currency ~ '^[A-Z]{3}$'),
  fx_rate numeric(14, 6) not null default 1 check (fx_rate > 0),
  sub_total bigint,
  total bigint not null default 0,
  balance bigint not null default 0,
  payment_terms text,
  notes text,
  fields jsonb not null default '{}'::jsonb,
  -- This CRM's own record behind it, when there is one.
  purchase_id bigint references purchase (id),
  created_by bigint references person (id),
  created_at timestamptz not null default now(),
  zoho_created timestamptz,
  zoho_modified timestamptz
);
--> statement-breakpoint
create unique index book_doc_zoho on book_doc (kind, zoho_id) where zoho_id is not null;
--> statement-breakpoint
create index book_doc_list on book_doc (kind, doc_date desc, id desc);
--> statement-breakpoint
create index book_doc_number on book_doc (kind, lower(number));
--> statement-breakpoint
create index book_doc_supplier on book_doc (supplier_id, kind);
--> statement-breakpoint
create index book_doc_customer on book_doc (customer_id, kind);
--> statement-breakpoint

-- A line of a document: an item (matched to a medicine through its SKU when it is one) or an
-- account line (a utility bill's, a freight charge's). A line received or sold from several
-- batches keeps them all in `batches`.
create table book_line (
  id bigint generated always as identity primary key,
  doc_id bigint not null references book_doc (id),
  n integer not null,
  medicine_id bigint references medicine (id),
  item_name text,
  sku text,
  description text,
  account text,
  warehouse text,
  unit text,
  qty numeric(16, 3),
  rate numeric(18, 4),
  tax_name text,
  tax_pct numeric(7, 3),
  tax_amount bigint,
  amount bigint,
  -- Zoho's running counts on an order line: received, billed, invoiced, packed, cancelled.
  qty_done jsonb not null default '{}'::jsonb,
  batches jsonb not null default '[]'::jsonb,
  fields jsonb not null default '{}'::jsonb
);
--> statement-breakpoint
create index book_line_doc on book_line (doc_id, n);
--> statement-breakpoint
create index book_line_medicine on book_line (medicine_id);
--> statement-breakpoint

-- How documents hang together: a receive and a bill of a purchase order, a payment or a vendor
-- credit put on a bill (with the amount), a credit note on an invoice, and so on.
create table book_link (
  id bigint generated always as identity primary key,
  from_doc bigint not null references book_doc (id),
  to_doc bigint not null references book_doc (id),
  amount bigint,
  on_date date,
  unique (from_doc, to_doc)
);
--> statement-breakpoint
create index book_link_to on book_link (to_doc);
