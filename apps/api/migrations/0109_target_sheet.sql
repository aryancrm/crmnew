-- The company's monthly target sheet (Aryan, 18 Nov 2026: "can this come out of the software in
-- one click"): each row as the sheet has it — head, channel, manager, the salesperson as the sheet
-- names them, the Zoho name(s) their sales are invoiced under, HQ and the month's target — and the
-- seat it is for here, when there is one. What each row achieved is worked out from the invoices.
create table target_sheet_row (
  id bigint generated always as identity primary key,
  month date not null check (extract(day from month) = 1),
  sort integer not null,
  head text not null,
  channel text not null,
  manager text not null,
  salesperson text not null,
  zoho_names text[] not null default '{}',
  hq text,
  -- Centavos.
  target bigint not null default 0 check (target >= 0),
  seat_id bigint references seat (id),
  set_by bigint references person (id),
  set_at timestamptz not null default now(),
  unique (month, sort)
);
