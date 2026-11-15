-- Customers: every hospital, doctor, patient and business buyer, each kept once.

create table customer (
  id bigint generated always as identity primary key,
  code text unique,
  kind text not null check (kind in ('hospital', 'doctor', 'patient', 'drugstore', 'distributor', 'government')),
  name text not null,
  phone text,
  -- The phone's last ten digits, so 0917…, +63917… and 63917… are one number.
  phone_key text,
  email text,
  address text,
  city text,
  -- The area it sits in: whoever holds that area looks after it.
  area_id bigint references area (id),
  -- Doctors: what they treat and the hospital they work at.
  specialty text,
  works_at bigint references customer (id),
  -- The licence that lets them buy (a hospital's or drugstore's LTO, a doctor's PRC) and their TIN.
  licence_no text,
  licence_expires date,
  tin text,
  -- How they pay: in advance, cash on delivery, or so many days after delivery.
  payment_terms text not null default 'advance' check (payment_terms in ('advance', 'cod', 'days')),
  payment_days integer check (payment_days between 1 and 365),
  credit_limit integer check (credit_limit >= 0),
  note text,
  -- A customer added from the field can be sold to at once; Management looks it over after.
  review text not null default 'ok' check (review in ('ok', 'to_review')),
  reviewed_by bigint references person (id),
  reviewed_at timestamptz,
  -- Who first brought this customer in.
  added_by bigint not null references person (id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (works_at is null or works_at <> id),
  check ((payment_terms = 'days') = (payment_days is not null))
);
--> statement-breakpoint
-- A hospital, doctor or business is listed once per city, whatever the capitals.
create unique index customer_once on customer (kind, lower(name), lower(coalesce(city, ''))) where kind <> 'patient';
--> statement-breakpoint
create index customer_phone on customer (phone_key) where phone_key is not null;
--> statement-breakpoint
create index customer_area on customer (area_id, kind);
--> statement-breakpoint
create index customer_kind_name on customer (kind, lower(name));
--> statement-breakpoint
create index customer_added_by on customer (added_by);
--> statement-breakpoint
create index customer_works_at on customer (works_at) where works_at is not null;
