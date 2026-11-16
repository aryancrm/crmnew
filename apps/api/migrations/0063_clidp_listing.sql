-- CLIDP (docs/PLAN.md 16.5): a distributor's Certificate of Listing of Identical Drug Product, its
-- own brand name for one of our medicines, the certificate's number and how long it is valid. A
-- renewed certificate is a new line; the old one stays.
create table clidp_listing (
  id bigint generated always as identity primary key,
  customer_id bigint not null references customer (id),
  medicine_id bigint not null references medicine (id),
  brand text not null,
  certificate_no text,
  valid_until date,
  added_by bigint not null references person (id),
  added_at timestamptz not null default now()
);
--> statement-breakpoint
create index clidp_listing_customer on clidp_listing (customer_id);
