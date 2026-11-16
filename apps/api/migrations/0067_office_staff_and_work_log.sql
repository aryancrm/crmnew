-- Office staff (17 Nov): the departments that neither sell nor run the order line (Digital
-- Marketing, IT…) sign in as 'staff'. Their desk is their own work log, their leave and messages.
alter table person drop constraint person_role_check;
--> statement-breakpoint
alter table person add constraint person_role_check check (
  role in ('medrep', 'team_lead', 'manager', 'management', 'finance', 'dispatch', 'inventory', 'ceo', 'online', 'admin', 'hr', 'staff')
);
--> statement-breakpoint
alter table seat drop constraint seat_module_check;
--> statement-breakpoint
alter table seat add constraint seat_module_check check (
  module in ('medrep', 'team_lead', 'manager', 'management', 'finance', 'dispatch', 'inventory', 'ceo', 'online', 'admin', 'hr', 'staff')
);
--> statement-breakpoint
-- A person's day in their own words (optional): what they did, what they do today, what tomorrow.
-- One entry a day, changed during the day; the Founder and their head read it.
create table work_log (
  person_id bigint not null references person (id),
  day date not null,
  done text,
  today text,
  tomorrow text,
  updated_at timestamptz not null default now(),
  primary key (person_id, day)
);
