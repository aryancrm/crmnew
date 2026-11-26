-- HR's documents (docs/HR-PLAN.md, "Documents, imports and reports", 26 Nov): papers HR makes in
-- the CRM on the company's letterhead, each with its own number (COE-2026-00001), never deleted.
--
-- 1. hr_document: a certificate of employment (with or without pay), a clearance, a memo or a
--    notice to explain. `content` keeps what the paper said the day it was issued (position, dates,
--    pay), so a printout made later reads the same. A wrong one is voided with the reason.
--    A memo or notice is acknowledged by the person (their signature at that moment); a notice to
--    explain is answered by them in writing by the reply-by day.
-- 2. hr_clearance_sign: a clearance's sign-offs, one line per desk (the team lead, Finance,
--    Inventory, the Admin for logins and equipment, then HR), each with who, when and a note.
-- 3. HR's trail gets 'document'.

create table hr_document (
  id bigint generated always as identity primary key,
  code text not null unique,
  kind text not null check (kind in ('coe', 'coe_pay', 'clearance', 'memo', 'nte')),
  person_id bigint not null references person (id),
  company text not null check (company in ('2mg', 'gpi')),
  -- A certificate's purpose, a memo's or notice's subject.
  subject text,
  -- A memo's or notice's text.
  body text,
  reply_by date,
  content jsonb not null default '{}',
  issued_by bigint not null references person (id),
  issued_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  reply text,
  replied_at timestamptz,
  voided_at timestamptz,
  voided_by bigint references person (id),
  void_reason text
);
--> statement-breakpoint
create index hr_document_person on hr_document (person_id, issued_at desc);
--> statement-breakpoint
create table hr_clearance_sign (
  id bigint generated always as identity primary key,
  document_id bigint not null references hr_document (id),
  desk text not null check (desk in ('lead', 'finance', 'inventory', 'admin', 'hr')),
  signed_by bigint references person (id),
  signed_at timestamptz,
  note text,
  unique (document_id, desk)
);
--> statement-breakpoint
alter table hr_event drop constraint hr_event_kind_check;
--> statement-breakpoint
alter table hr_event add constraint hr_event_kind_check
  check (kind in ('joined', 'record', 'login', 'left', 'back', 'paper', 'attendance', 'leave', 'move', 'document'));
