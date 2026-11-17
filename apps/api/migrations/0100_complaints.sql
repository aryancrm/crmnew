-- Complaints and side-effects (docs/ERP-PLAN.md 7.3, decided 18 Nov on Aryan's word: "do what's
-- right"): anyone at work reports what a customer told them (a product's quality, a side-effect, a
-- wrong or damaged delivery, the service); Regulatory handles it to a due day (a serious
-- side-effect within 15 days, the FDA's window; anything else within 30, changeable), notes what
-- it did, reports it to the FDA when it must, and closes it with the outcome. Nothing is deleted.
create table complaint (
  id bigint generated always as identity primary key,
  code text not null unique,
  kind text not null check (kind in ('quality', 'side_effect', 'delivery', 'service', 'other')),
  serious boolean not null default false,
  customer_id bigint references customer (id),
  patient_name text,
  medicine_id bigint references medicine (id),
  batch_no text,
  order_id bigint references sales_order (id),
  description text not null,
  received_on date not null,
  due_on date not null,
  status text not null default 'open' check (status in ('open', 'investigating', 'closed')),
  owner_id bigint references person (id),
  fda_ref text,
  outcome text,
  reported_by bigint not null references person (id),
  reported_at timestamptz not null default now(),
  closed_by bigint references person (id),
  closed_at timestamptz
);
--> statement-breakpoint
create index complaint_open on complaint (status, due_on) where status <> 'closed';
--> statement-breakpoint
create table complaint_event (
  id bigint generated always as identity primary key,
  complaint_id bigint not null references complaint (id),
  message text not null,
  by_person bigint not null references person (id),
  at timestamptz not null default now()
);
--> statement-breakpoint
create index complaint_event_complaint on complaint_event (complaint_id, at);
--> statement-breakpoint
insert into counter (name, value) values ('complaint', 0) on conflict (name) do nothing;
