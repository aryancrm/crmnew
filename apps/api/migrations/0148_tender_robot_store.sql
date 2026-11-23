-- The tender finder's robots keep their own records here (docs/PLAN.md 25, step 6): the bidding
-- team's own modules, copied unchanged, were written against a database of their own; in the CRM
-- each of their rows is kept as it is, under the name of the table they call it and its key. What
-- people see of it (the notices, the papers, the lines) is copied onto the finder's own tables.
create table tender_robot_row (
  tbl text not null,
  key text not null,
  -- The row as the robot keeps it; null when it is sealed.
  value jsonb,
  -- A log-in session's cookies are never kept readable: sealed with the server's key.
  sealed text,
  updated_at timestamptz not null default now(),
  primary key (tbl, key),
  check (value is not null or sealed is not null)
);
