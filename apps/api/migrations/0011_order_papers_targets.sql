-- Which of the two companies bills the order, the doctor behind it, its papers, gapless
-- order numbers, and each person's monthly sales target.

alter table sales_order add column invoice_from text not null default '2mg' check (invoice_from in ('2mg', 'getmeds'));
--> statement-breakpoint
alter table sales_order add column doctor_id bigint references customer (id);
--> statement-breakpoint

-- A paper on an order: the hospital's PO, a proof of payment, a prescription or guarantee
-- letter. The bytes are kept in the row for now; a removed paper is kept, marked inactive.
create table order_file (
  id bigint generated always as identity primary key,
  order_id bigint not null references sales_order (id),
  kind text not null check (kind in ('po', 'payment_proof', 'prescription', 'gl', 'other')),
  name text not null,
  mime text not null,
  size integer not null check (size > 0),
  data bytea not null,
  by_person bigint not null references person (id),
  at timestamptz not null default now(),
  active boolean not null default true
);
--> statement-breakpoint
create index order_file_order on order_file (order_id) where active;
--> statement-breakpoint

-- Numbers handed out one after another inside the transaction that uses them, so an order
-- number never skips (a database sequence can jump after a restart).
create table counter (
  name text primary key,
  value bigint not null
);
--> statement-breakpoint
insert into counter (name, value)
  values ('order', coalesce((select max(substring(code from 5)::bigint) - 500000 from sales_order where code like '2MG-5%'), 0));
--> statement-breakpoint

create table sales_target (
  person_id bigint not null references person (id),
  -- The first day of the month.
  month date not null check (extract(day from month) = 1),
  amount bigint not null check (amount >= 0),
  set_by bigint not null references person (id),
  set_at timestamptz not null default now(),
  primary key (person_id, month)
);
