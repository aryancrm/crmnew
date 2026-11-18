-- A bank's own statement and the reconciliation (docs/BOOKS-PLAN.md C, 18 Nov 2026). Zoho Books held
-- imported statements (193 lines never categorized) and never reconciled an account; here a
-- statement's lines are imported per account, each one matched to what the books already hold
-- (a payment, expense, transfer, journal, a CRM payment…), categorized into a new document, or
-- excluded; and a reconciliation ticks what cleared up to the statement's last day until its
-- difference is nil. A cleared entry can't be voided while its reconciliation stands.

create table bank_import (
  id bigint generated always as identity primary key,
  account text not null,
  file_name text,
  lines integer not null default 0,
  by_person bigint references person (id),
  at timestamptz not null default now()
);
--> statement-breakpoint
create table bank_line (
  id bigint generated always as identity primary key,
  account text not null,
  on_date date not null,
  description text,
  reference text,
  -- Centavos into the bank (a deposit) positive, out of it (a withdrawal) negative.
  amount bigint not null check (amount <> 0),
  -- The same line imported twice is the same line: account, day, amount, words, reference.
  fingerprint text not null unique,
  status text not null default 'uncategorized' check (status in ('uncategorized', 'matched', 'categorized', 'excluded')),
  -- What it stands for in the books: a book document's entries ('books:<doc>') or the CRM's
  -- ('crm:<kind>:<id>'), as book_entry names them.
  entry_key text,
  import_id bigint references bank_import (id),
  zoho_id text unique,
  done_by bigint references person (id),
  done_at timestamptz,
  created_at timestamptz not null default now()
);
--> statement-breakpoint
create index bank_line_account on bank_line (lower(account), status, on_date);
--> statement-breakpoint
create unique index bank_line_entry on bank_line (entry_key) where entry_key is not null and status in ('matched', 'categorized');
--> statement-breakpoint
create table bank_reconciliation (
  id bigint generated always as identity primary key,
  account text not null,
  start_date date not null,
  end_date date not null,
  opening bigint not null,
  closing bigint not null,
  status text not null default 'done' check (status in ('done', 'undone')),
  by_person bigint references person (id),
  at timestamptz not null default now(),
  undone_by bigint references person (id),
  undone_at timestamptz
);
--> statement-breakpoint
create table bank_cleared (
  reconciliation_id bigint not null references bank_reconciliation (id),
  entry_key text not null,
  amount bigint not null,
  primary key (reconciliation_id, entry_key)
);
--> statement-breakpoint
create index bank_cleared_key on bank_cleared (entry_key);
