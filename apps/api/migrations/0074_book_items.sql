-- Zoho Inventory's Items (docs/PLAN.md 17): every item Zoho had (3,588: the company's own medicines
-- and the pharmacy's other products), with every field that holds data, its batches as Zoho kept
-- them, Zoho's stock figures on the day it was read, and the medicine it is in this CRM (by SKU).
create table book_item (
  id bigint generated always as identity primary key,
  zoho_id text not null unique,
  name text not null,
  sku text,
  status text not null default 'active',
  item_type text,
  unit text,
  -- Centavos.
  rate bigint,
  purchase_rate bigint,
  reorder_level numeric(16, 3),
  -- Zoho's own stock figures when it was read (stock is this CRM's own for its medicines).
  zoho_stock jsonb not null default '{}'::jsonb,
  batches jsonb not null default '[]'::jsonb,
  fields jsonb not null default '{}'::jsonb,
  medicine_id bigint references medicine (id),
  zoho_created timestamptz,
  zoho_modified timestamptz
);
--> statement-breakpoint
create index book_item_sku on book_item (lower(sku));
--> statement-breakpoint
create index book_item_medicine on book_item (medicine_id);
--> statement-breakpoint
-- Zoho's price lists (one: IMMUNPRO, 10% markup), as Zoho keeps them.
create table book_price_list (
  id bigint generated always as identity primary key,
  zoho_id text not null unique,
  name text not null,
  currency text,
  kind text,
  details text,
  scheme text,
  rounding text,
  status text,
  fields jsonb not null default '{}'::jsonb
);
