-- Finance: one invoice per order, the payments against it, and the refunds of money taken for
-- an order that was then cancelled. An order no longer stops at "invoiced": whether it is
-- paid is a fact of its invoice, not a step the goods wait on.

update sales_order set status = 'ready_for_dispatch' where status = 'invoiced';
--> statement-breakpoint
alter table sales_order drop constraint sales_order_status_check;
--> statement-breakpoint
alter table sales_order add constraint sales_order_status_check check (
  status in (
    'draft', 'pending_approval', 'finance_check', 'ready_for_invoice',
    'ready_for_dispatch', 'packing', 'shipped', 'completed', 'on_hold', 'exception', 'cancelled'
  )
);
--> statement-breakpoint
-- Who in Finance let the order go on, and when.
alter table sales_order add column finance_checked_at timestamptz;
--> statement-breakpoint
alter table sales_order add column finance_checked_by bigint references person (id);
--> statement-breakpoint

-- The sales invoice, under the company the order names. Its money figures are frozen when it
-- is made; `paid` and `refunded` follow its payments and refunds.
create table invoice (
  id bigint generated always as identity primary key,
  code text not null unique,
  order_id bigint not null unique references sales_order (id),
  customer_id bigint not null references customer (id),
  invoice_from text not null check (invoice_from in ('2mg', 'getmeds')),
  -- How the customer pays, copied from the order: 'cod' is due when the goods arrive.
  terms text not null check (terms in ('advance', 'cod', 'days')),
  issued_on date not null,
  due_on date not null,
  total integer not null check (total >= 0),
  -- VAT inside the total: 12% lines split into their net and their VAT, exempt and zero-rated.
  vatable integer not null default 0 check (vatable >= 0),
  vat integer not null default 0 check (vat >= 0),
  exempt integer not null default 0 check (exempt >= 0),
  zero_rated integer not null default 0 check (zero_rated >= 0),
  paid integer not null default 0 check (paid >= 0),
  refunded integer not null default 0 check (refunded >= 0),
  status text not null default 'open' check (status in ('open', 'paid', 'cancelled')),
  cancelled_reason text,
  cancelled_at timestamptz,
  by_person bigint not null references person (id),
  at timestamptz not null default now()
);
--> statement-breakpoint
create index invoice_status on invoice (status, due_on);
--> statement-breakpoint
create index invoice_customer on invoice (customer_id, status);
--> statement-breakpoint

-- Money received against an invoice. A payment recorded by mistake is taken off (kept,
-- marked inactive, with why), never deleted.
create table payment (
  id bigint generated always as identity primary key,
  invoice_id bigint not null references invoice (id),
  customer_id bigint not null references customer (id),
  amount integer not null check (amount > 0),
  method text not null check (method in ('cash', 'bank', 'check', 'ewallet', 'other')),
  reference text,
  paid_on date not null,
  -- The photo of the slip, kept as a paper on the order.
  proof_id bigint references order_file (id),
  note text,
  by_person bigint not null references person (id),
  at timestamptz not null default now(),
  active boolean not null default true,
  removed_reason text,
  removed_by bigint references person (id),
  removed_at timestamptz
);
--> statement-breakpoint
create index payment_invoice on payment (invoice_id) where active;
--> statement-breakpoint
create index payment_day on payment (paid_on desc, id desc) where active;
--> statement-breakpoint

-- Money given back to a customer whose order was cancelled after it paid.
create table refund (
  id bigint generated always as identity primary key,
  invoice_id bigint not null references invoice (id),
  amount integer not null check (amount > 0),
  method text not null check (method in ('cash', 'bank', 'check', 'ewallet', 'other')),
  reference text,
  refunded_on date not null,
  note text,
  by_person bigint not null references person (id),
  at timestamptz not null default now()
);
--> statement-breakpoint
create index refund_invoice on refund (invoice_id);
--> statement-breakpoint

-- One invoice series per company: 2MG Inc. 2MG-SI-000001, GetMeds Philippines Inc. INV-000001.
insert into counter (name, value) values ('invoice:2mg', 0), ('invoice:getmeds', 0);
