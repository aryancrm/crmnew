-- HR: the HR role and every person's employee record (what HR knows about them, kept when they
-- leave). One person = their login (person) + their employee record + their seat. HR types the
-- login email and password a joiner is given; nothing is sent by the system.
alter table person drop constraint person_role_check;
--> statement-breakpoint
alter table person add constraint person_role_check check (
  role in ('medrep', 'team_lead', 'manager', 'management', 'finance', 'dispatch', 'inventory', 'ceo', 'online', 'admin', 'hr')
);
--> statement-breakpoint
alter table seat drop constraint seat_module_check;
--> statement-breakpoint
alter table seat add constraint seat_module_check check (
  module in ('medrep', 'team_lead', 'manager', 'management', 'finance', 'dispatch', 'inventory', 'ceo', 'online', 'admin', 'hr')
);
--> statement-breakpoint
create table employee (
  person_id bigint primary key references person (id),
  -- The company they are employed by: 2MG Incorporated or Getmeds Philippines Inc.
  company text not null default '2mg' check (company in ('2mg', 'gpi')),
  employee_code text,
  status text not null default 'active' check (status in ('active', 'left')),
  classification text not null default 'probationary'
    check (classification in ('probationary', 'regular', 'part_time', 'intern')),
  position text,
  department text,
  hire_date date not null,
  regularized_on date,
  left_on date,
  left_reason text,
  mobile text,
  personal_email text,
  birth_date date,
  address text,
  emergency_name text,
  emergency_phone text,
  emergency_relation text,
  -- Pay, monthly, in centavos; seen only by HR, the CEO and the Admin.
  salary integer check (salary is null or salary >= 0),
  allowance integer check (allowance is null or allowance >= 0),
  bank_name text,
  bank_account text,
  sss text,
  philhealth text,
  pagibig text,
  tin text,
  -- When the person finished their own profile at their first sign-in.
  profile_done_at timestamptz,
  created_at timestamptz not null default now(),
  created_by bigint references person (id),
  updated_at timestamptz,
  updated_by bigint references person (id)
);
--> statement-breakpoint
create unique index employee_code_once on employee (company, upper(employee_code)) where employee_code is not null;
--> statement-breakpoint
-- Everyone already here has a record: active or left as their login is, hired the day they were added.
insert into employee (person_id, status, hire_date, position, mobile)
select p.id, case when p.active then 'active' else 'left' end,
  (p.created_at at time zone 'Asia/Manila')::date, p.title, p.phone
from person p
where not exists (select 1 from employee e where e.person_id = p.id);
