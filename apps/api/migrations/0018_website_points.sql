-- Points on the 2MG website, on the old CRM's contract (`/webhooks/store/<company>/points/manage`),
-- so the website keeps its "My rewards" page, its sign-in and its checkout unchanged.

-- A customer's own points login (their mobile number and a password), the same on every website.
create table points_login (
  id bigint generated always as identity primary key,
  phone_key text not null unique,
  name text not null,
  password_hash text not null,
  -- The points account the login reaches (none until it is connected).
  account_id bigint references points_account (id),
  failures integer not null default 0,
  blocked_until timestamptz,
  -- Wrong passwords a website's own sign-in relayed, counted apart (they never lock the customer out).
  quiet_failures integer not null default 0,
  quiet_blocked_until timestamptz,
  created_at timestamptz not null default now()
);
--> statement-breakpoint
create table points_session (
  id bigint generated always as identity primary key,
  login_id bigint not null references points_login (id),
  token_hash text not null unique,
  expires_at timestamptz not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
--> statement-breakpoint

-- A website's member account proved to own a points account: one of its delivered orders, on its
-- own number, earned into it. A typed number alone never reads or spends anyone's points.
create table points_web_account (
  site text not null,
  account_ref text not null,
  phone_key text not null,
  account_id bigint not null references points_account (id),
  order_ref text,
  bound_at timestamptz not null default now(),
  primary key (site, account_ref)
);
--> statement-breakpoint

-- Points held at a website checkout until its order is placed (spent) or given back (released).
create table points_reservation (
  id uuid primary key default gen_random_uuid(),
  account_id bigint not null references points_account (id),
  site text not null,
  request_key text not null,
  reference text not null,
  points integer not null check (points > 0),
  state text not null default 'reserved' check (state in ('reserved', 'spent', 'released')),
  order_id bigint references sales_order (id),
  created_at timestamptz not null default now(),
  unique (account_id, request_key)
);
--> statement-breakpoint
create index points_reservation_site on points_reservation (site, request_key);
--> statement-breakpoint

-- The points a website order was paid with at its checkout.
alter table web_order add column points_reservation uuid;
--> statement-breakpoint
alter table web_order add column points_redeemed integer not null default 0 check (points_redeemed >= 0);
