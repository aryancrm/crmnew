-- Payroll: each cut-off's payslips are worked out from the DTR (attendance, leave, forms), HR adds
-- its own lines (a loan, a cash advance, an adjustment) and releases them; a released cut-off is
-- frozen and each person reads their own payslip. The CEO reads the register. The law-set rates
-- (SSS, PhilHealth, Pag-IBIG, BIR's table) are dated rows: a new one starts on its day.

-- Who a scheme doesn't cover (a foreign national, Pag-IBIG waived) or who isn't taxed.
alter table employee add column no_sss boolean not null default false;
--> statement-breakpoint
alter table employee add column no_philhealth boolean not null default false;
--> statement-breakpoint
alter table employee add column no_pagibig boolean not null default false;
--> statement-breakpoint
alter table employee add column no_tax boolean not null default false;
--> statement-breakpoint
create table pay_rule (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('sss', 'philhealth', 'pagibig', 'tax')),
  starts_on date not null,
  -- Money in centavos, rates in basis points (src/hr/pay-rules.ts reads them).
  rule jsonb not null,
  source text,
  made_at timestamptz not null default now()
);
--> statement-breakpoint
create unique index pay_rule_once on pay_rule (kind, starts_on);
--> statement-breakpoint
insert into pay_rule (kind, starts_on, rule, source) values
  ('sss', '2025-01-01',
    '{"mscMin":500000,"mscMax":3500000,"step":50000,"employeeBps":500,"employerBps":1000,"ecLow":1000,"ecHigh":3000,"ecBreak":1500000}',
    'SSS 2025 schedule (RA 11199): 15% of the monthly salary credit (₱5,000 to ₱35,000), employee 5%, employer 10% plus EC ₱10 below a ₱15,000 credit, ₱30 from it'),
  ('philhealth', '2024-01-01',
    '{"rateBps":500,"floor":1000000,"ceiling":10000000}',
    'PhilHealth 2024 onward: 5% of the monthly basic salary (₱10,000 to ₱100,000), shared equally'),
  ('pagibig', '2024-02-01',
    '{"employeeBps":200,"employerBps":200,"maxBase":1000000}',
    'Pag-IBIG from February 2024: 2% each of up to ₱10,000 (₱200 a month)'),
  ('tax', '2023-01-01',
    '{"rows":[{"over":0,"base":0,"rateBps":0},{"over":1041700,"base":0,"rateBps":1500},{"over":1666700,"base":93750,"rateBps":2000},{"over":3333300,"base":427070,"rateBps":2500},{"over":8333300,"base":1677070,"rateBps":3000},{"over":33333300,"base":9177070,"rateBps":3500}]}',
    'BIR withholding tax table, semi-monthly, from 1 January 2023 (TRAIN law)');
--> statement-breakpoint
-- HR's own lines on a cut-off's payslip, kept while the cut-off is a draft.
create table pay_adjustment (
  id bigint generated always as identity primary key,
  cutoff text not null check (cutoff ~ '^[0-9]{4}-[0-9]{2}-[ab]$'),
  person_id bigint not null references person (id),
  label text not null,
  kind text not null check (kind in ('earning', 'deduction')),
  taxable boolean not null default true,
  amount integer not null check (amount > 0),
  note text,
  made_by bigint not null references person (id),
  made_at timestamptz not null default now(),
  removed_by bigint references person (id),
  removed_at timestamptz
);
--> statement-breakpoint
create index pay_adjustment_cutoff on pay_adjustment (cutoff) where removed_at is null;
--> statement-breakpoint
-- A released cut-off: its payslips are frozen as they were released.
create table pay_run (
  id bigint generated always as identity primary key,
  cutoff text not null unique check (cutoff ~ '^[0-9]{4}-[0-9]{2}-[ab]$'),
  period_from date not null,
  period_to date not null,
  pay_day date not null,
  people integer not null,
  gross bigint not null,
  deductions bigint not null,
  net bigint not null,
  employer bigint not null,
  released_by bigint not null references person (id),
  released_at timestamptz not null default now()
);
--> statement-breakpoint
create table payslip (
  id bigint generated always as identity primary key,
  run_id bigint not null references pay_run (id),
  cutoff text not null,
  person_id bigint not null references person (id),
  company text not null,
  gross integer not null,
  net integer not null,
  tax integer not null,
  slip jsonb not null,
  unique (run_id, person_id)
);
--> statement-breakpoint
create index payslip_person on payslip (person_id, cutoff);
