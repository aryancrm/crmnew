-- Patient Care Groups (Rx Team & Training Playbook, the CHC-to-Telesales bridge): the Rx CHC
-- enrols a doctor (and, with their consent, the doctor's patients) in a care group on Viber;
-- MD Telesales makes first contact within 15 minutes of the enrolment and owns turning it into
-- orders. The group itself lives on Viber; the CRM keeps who enrolled it, when, who made first
-- contact and when, and when it last had activity (quiet 14 days: the CHC follows up). Closed,
-- never deleted.
create table care_group (
  id bigint generated always as identity primary key,
  doctor_id bigint not null references customer (id),
  -- "[Doctor] — GetMeds Prescription Care", as the playbook names them.
  name text not null,
  enrolled_by bigint not null references person (id),
  seat_id bigint references seat (id),
  -- The patients' consent was asked and given before anyone was added.
  consent boolean not null check (consent),
  patients integer not null default 0 check (patients >= 0),
  note text,
  enrolled_at timestamptz not null default now(),
  telesales_id bigint references person (id),
  first_contact_at timestamptz,
  last_activity_at timestamptz,
  closed_at timestamptz,
  closed_by bigint references person (id),
  close_reason text
);
--> statement-breakpoint
create index care_group_open on care_group (enrolled_at desc) where closed_at is null;
--> statement-breakpoint
create index care_group_doctor on care_group (doctor_id);
