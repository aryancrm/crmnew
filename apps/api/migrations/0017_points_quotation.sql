-- Customer points and the quotation the customer receives.
--
-- Points (the owner's rules): 1 point = ₱1. A patient earns 10% of what they actually paid for the
-- medicines, once the order is delivered and the money is in (never on the delivery fee, never on
-- what they paid with points); on a guarantee letter only the agency's money counts. Business
-- buyers never earn. Points never expire. A customer is their phone number.

-- The company's own settings: what its papers print, how its points work.
create table setting (
  key text primary key,
  value jsonb not null,
  updated_by bigint references person (id),
  updated_at timestamptz not null default now()
);
--> statement-breakpoint
insert into setting (key, value) values
  ('company', '{"name": "2MG Inc.", "address": "Unit 301 & 305, 17 Vatican Bldg., Vatican City Drive, BF Resort Village, Talon II, Las Piñas City, Metro Manila 1747", "phone": "+63 919 065 4463", "email": "info@2mginc.com", "tin": "", "vat": true, "licence": "CDRR-NCR-DI/E/W-31324", "footer": "Imports and distributes oncology and hematology medicines in the Philippines · www.2mginc.com", "signatory": "", "signatoryTitle": ""}'::jsonb),
  ('points', '{"enabled": false, "rateBps": 1000}'::jsonb);
--> statement-breakpoint

-- Who paid a receipt: the customer, or the agency on a guarantee letter. 'points' is paid with points.
alter table payment drop constraint payment_method_check;
--> statement-breakpoint
alter table payment add constraint payment_method_check check (method in ('cash', 'bank', 'check', 'ewallet', 'other', 'points'));
--> statement-breakpoint
alter table payment add column payer text not null default 'customer' check (payer in ('customer', 'agency'));
--> statement-breakpoint

-- Points the customer used on the order: paid with them on its invoice.
alter table sales_order add column points_used integer not null default 0 check (points_used >= 0);
--> statement-breakpoint
-- Points the agent will use when the case places its order.
alter table lead add column points_to_use integer not null default 0 check (points_to_use >= 0);
--> statement-breakpoint

-- One account per customer phone. The balance is its entries added up (kept for reading).
create table points_account (
  id bigint generated always as identity primary key,
  phone_key text not null unique,
  customer_id bigint references customer (id),
  name text not null,
  balance integer not null default 0,
  earned integer not null default 0,
  spent integer not null default 0,
  created_at timestamptz not null default now()
);
--> statement-breakpoint

-- Every change of points, never edited: earned on an order, used, given back, adjusted by hand.
create table points_entry (
  id bigint generated always as identity primary key,
  account_id bigint not null references points_account (id),
  kind text not null check (kind in ('earn', 'spend', 'release', 'adjust')),
  points integer not null,
  order_id bigint references sales_order (id),
  reference text,
  note text,
  -- What made it, once: "earn:<order>:<revision>", "spend:<order>", "adjust:<uuid>".
  origin text not null unique,
  by_person bigint references person (id),
  at timestamptz not null default now()
);
--> statement-breakpoint
create index points_entry_account on points_entry (account_id, at desc);
--> statement-breakpoint

-- What an order has earned so far, so a later receipt, refund or correction earns (or takes back)
-- only the difference.
create table points_settlement (
  order_id bigint primary key references sales_order (id),
  account_id bigint not null references points_account (id),
  rate_bps integer not null,
  paid integer not null default 0,
  credited integer not null default 0,
  revision integer not null default 0
);
--> statement-breakpoint

-- A quotation sent to a customer as a link: what it said then, frozen, for 30 days.
create table quotation_link (
  id bigint generated always as identity primary key,
  lead_id bigint not null references lead (id),
  token_hash text not null unique,
  snapshot jsonb not null,
  expires_at timestamptz not null,
  created_by bigint references person (id),
  created_at timestamptz not null default now(),
  opened_at timestamptz
);
