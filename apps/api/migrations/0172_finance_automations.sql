-- Phase 2 Finance automations (28 Nov 2026):
-- 1. MedRep approved field_expense -> Finance reimbursement payout (`reimbursed_doc_id`)
-- 2. HR released pay_run -> Books balanced GL journal (`journal_doc_id`)
-- 3. Bank matching rules (`bank_rule`) for recurring CSV statement lines

alter table field_expense_head
  add column if not exists account_name text;
--> statement-breakpoint

alter table field_expense
  add column if not exists reimbursed_doc_id bigint references book_doc (id),
  add column if not exists reimbursed_at timestamptz,
  add column if not exists reimbursed_by bigint references person (id);
--> statement-breakpoint

create index if not exists field_expense_reimburse_idx
  on field_expense (status, reimbursed_doc_id)
  where status = 'approved' and reimbursed_doc_id is null;
--> statement-breakpoint

alter table pay_run
  add column if not exists journal_doc_id bigint references book_doc (id);
--> statement-breakpoint

create table if not exists bank_rule (
  id bigint generated always as identity primary key,
  name text not null,
  pattern text not null,
  direction text not null check (direction in ('out', 'in')),
  account_name text not null,
  note text,
  active boolean not null default true,
  created_by bigint references person (id),
  created_at timestamptz not null default now()
);
