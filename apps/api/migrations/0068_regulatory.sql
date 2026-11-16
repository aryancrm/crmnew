-- In-licensing & Regulatory (docs/PLAN.md 16.9). Its people sign in as 'regulatory': the In-licensing
-- team brings products in from partners abroad (the pipeline), Regulatory Affairs gets and keeps
-- their FDA Philippines registrations (CPRs). Nothing is deleted: a dropped product or a withdrawn
-- registration keeps its row, and every change is a line in reg_event.
alter table person drop constraint person_role_check;
--> statement-breakpoint
alter table person add constraint person_role_check check (
  role in ('medrep', 'team_lead', 'manager', 'management', 'finance', 'dispatch', 'inventory', 'ceo', 'online', 'admin', 'hr', 'staff', 'regulatory')
);
--> statement-breakpoint
alter table seat drop constraint seat_module_check;
--> statement-breakpoint
alter table seat add constraint seat_module_check check (
  module in ('medrep', 'team_lead', 'manager', 'management', 'finance', 'dispatch', 'inventory', 'ceo', 'online', 'admin', 'hr', 'staff', 'regulatory')
);
--> statement-breakpoint
-- A product the In-licensing team is bringing in, from first look to launch.
create table pipeline_product (
  id bigint generated always as identity primary key,
  name text not null,
  generic text,
  strength text,
  partner text,
  country text,
  stage text not null default 'identified' check (
    stage in ('identified', 'talks', 'agreement', 'dossier', 'filed', 'registered', 'launched', 'dropped')
  ),
  handled_by bigint references person (id),
  next_step text,
  next_on date,
  note text,
  added_by bigint not null references person (id),
  added_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
--> statement-breakpoint
-- A registration with the FDA (a CPR): for a medicine we sell, or a pipeline product being filed.
create table product_registration (
  id bigint generated always as identity primary key,
  medicine_id bigint references medicine (id),
  pipeline_id bigint references pipeline_product (id),
  product text not null,
  number text,
  status text not null default 'preparing' check (
    status in ('preparing', 'filed', 'approved', 'renewal_filed', 'expired', 'withdrawn')
  ),
  filed_on date,
  valid_until date,
  handled_by bigint references person (id),
  note text,
  added_by bigint not null references person (id),
  added_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
--> statement-breakpoint
create table reg_event (
  id bigint generated always as identity primary key,
  pipeline_id bigint references pipeline_product (id),
  registration_id bigint references product_registration (id),
  what text not null,
  by_person bigint not null references person (id),
  at timestamptz not null default now(),
  check (pipeline_id is not null or registration_id is not null)
);
