-- HR's record gets the fields HR keeps in its own portal (Automated-Excel) and the CRM lacked
-- (docs/HR-PLAN.md, step 1), and positions become one list HR keeps instead of free text.
alter table employee
  add column gender text check (gender in ('female', 'male')),
  add column civil_status text check (civil_status in ('single', 'married', 'widowed', 'separated')),
  add column citizenship text,
  add column spouse_name text,
  add column father_name text,
  add column mother_name text,
  add column education text,
  add column school text,
  add column course text,
  add column work_arrangement text check (work_arrangement in ('office', 'field', 'hybrid', 'remote')),
  add column company_phone text,
  add column issued_equipment text,
  add column job_description text;
--> statement-breakpoint
-- The positions a record may say. Never deleted: one no longer used is archived (records that
-- say it keep it).
create table hr_position (
  id bigint generated always as identity primary key,
  name text not null,
  created_at timestamptz not null default now(),
  created_by bigint references person (id),
  archived_at timestamptz,
  archived_by bigint references person (id)
);
--> statement-breakpoint
create unique index hr_position_name on hr_position (lower(name));
--> statement-breakpoint
-- Started from what the CRM says today: every record's position, every person's title, every seat.
insert into hr_position (name)
select distinct on (lower(trim(name))) trim(name) from (
  select position as name from employee where position is not null
  union all select title from person where title is not null
  union all select title from seat where title is not null
) t where trim(name) <> ''
order by lower(trim(name)), trim(name);
