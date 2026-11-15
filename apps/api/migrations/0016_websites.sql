-- Websites on the Online desk, as many as the company has: each is a channel (its own webhook
-- secret, where its order statuses go). An order placed on a website opens a case like an
-- enquiry; the case's order sends its status back to the website.

alter table channel_account drop constraint channel_account_kind_check;
--> statement-breakpoint
alter table channel_account add constraint channel_account_kind_check check (kind in ('messenger', 'email', 'website'));
--> statement-breakpoint
-- What isn't secret about a channel (a website's label).
alter table channel_account add column config jsonb not null default '{}'::jsonb;
--> statement-breakpoint

alter table lead drop constraint lead_source_check;
--> statement-breakpoint
alter table lead add constraint lead_source_check
  check (source in ('messenger', 'facebook', 'instagram', 'website', 'website_2mg', 'website_capsandpills', 'phone', 'walk_in', 'referral', 'email', 'other'));
--> statement-breakpoint
-- The website a case came from (its order, its prescription, its enquiry).
alter table lead add column site_account_id bigint references channel_account (id);
--> statement-breakpoint
-- An enquiry, or an order the customer placed on a website.
alter table lead add column case_type text not null default 'enquiry' check (case_type in ('enquiry', 'website_order'));
--> statement-breakpoint

-- What the customer pays for delivery, on top of the medicines (a website order's fee).
alter table sales_order add column delivery_fee integer not null default 0 check (delivery_fee >= 0);
--> statement-breakpoint

-- An order as the website sent it: what the customer saw and paid, its documents, the case it
-- opened, and the status the CRM is telling the website.
create table web_order (
  id bigint generated always as identity primary key,
  account_id bigint not null references channel_account (id),
  ref text not null,
  status text not null,
  placed_at timestamptz,
  -- The website's own time for what it sent last: an older snapshot never writes over a newer one.
  source_at timestamptz,
  customer jsonb not null default '{}'::jsonb,
  items jsonb not null default '[]'::jsonb,
  -- Centavos: subtotal, vatExempted, discount, deliveryFee, total.
  money jsonb not null default '{}'::jsonb,
  payment_method text,
  benefit text,
  assistance text,
  is_b2b boolean not null default false,
  account_ref text,
  account_phone text,
  admin_url text,
  status_url text,
  -- [{ key, kind, name, fetched, attempts, gaveUp }]: the website's documents (their links aren't kept).
  files jsonb not null default '[]'::jsonb,
  lead_id bigint references lead (id),
  -- Why it has no case (it came late, or was cancelled before one opened).
  card_note text,
  push_status text check (push_status in ('confirmed', 'shipped', 'delivered', 'cancelled')),
  push_reason text,
  push_error text,
  push_attempts integer not null default 0,
  push_next_at timestamptz,
  pushed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, ref)
);
--> statement-breakpoint
create index web_order_lead on web_order (lead_id) where lead_id is not null;
--> statement-breakpoint
create index web_order_push on web_order (push_next_at) where push_status is not null;
--> statement-breakpoint

-- A prescription or an enquiry sent through a website, on the person's case.
create table web_request (
  id bigint generated always as identity primary key,
  account_id bigint not null references channel_account (id),
  kind text not null check (kind in ('prescription', 'enquiry')),
  ref text not null,
  customer jsonb not null default '{}'::jsonb,
  message text,
  file jsonb,
  lead_id bigint references lead (id),
  created_at timestamptz not null default now(),
  unique (account_id, kind, ref)
);
--> statement-breakpoint

-- Every call a website made: what came, what was done, a refusal's reason.
create table web_call (
  id bigint generated always as identity primary key,
  account_id bigint references channel_account (id),
  site text not null,
  event text not null,
  ref text,
  outcome text not null,
  error text,
  at timestamptz not null default now()
);
--> statement-breakpoint
create index web_call_account on web_call (account_id, at desc);
