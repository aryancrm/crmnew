-- Samples and gifts with the reps (docs/ERP-PLAN.md phase 3), as the old CRM ran them: a rep asks
-- for samples or gifts, their lead approves (the Admin too), the stock desk issues them from the
-- shelf (the batches expiring first) and they leave the company's stock; the rep marks them
-- received; the rep gives them to a doctor at a visit with the doctor's signed acknowledgement;
-- each month the rep counts what they hold and says why it differs. Samples and gifts are never
-- sold, and a medicine marked "no samples" (antimicrobials) is never given as a sample.
alter table medicine add column no_samples boolean not null default false;
--> statement-breakpoint
alter table stock_move drop constraint stock_move_kind_check;
--> statement-breakpoint
alter table stock_move add constraint stock_move_kind_check
  check (kind in ('receive', 'move_out', 'move_in', 'count', 'deliver', 'return', 'sample_out'));
--> statement-breakpoint
create table sample_request (
  id bigint generated always as identity primary key,
  code text not null unique,
  person_id bigint not null references person (id),
  kind text not null check (kind in ('samples', 'gifts')),
  -- [{ medicineId, qty }] as asked; issued_lines: [{ medicineId, batchId, qty }] as issued.
  lines jsonb not null,
  note text,
  status text not null default 'submitted'
    check (status in ('submitted', 'approved', 'rejected', 'withdrawn', 'issued', 'received')),
  asked_by bigint not null references person (id),
  asked_at timestamptz not null default now(),
  decided_by bigint references person (id),
  decided_at timestamptz,
  reject_reason text,
  issued_by bigint references person (id),
  issued_at timestamptz,
  issued_from bigint references warehouse (id),
  issued_lines jsonb,
  received_at timestamptz
);
--> statement-breakpoint
create index sample_request_person on sample_request (person_id, status);
--> statement-breakpoint
-- What each rep holds, by kind and batch.
create table sample_stock (
  person_id bigint not null references person (id),
  kind text not null check (kind in ('samples', 'gifts')),
  batch_id bigint not null references batch (id),
  qty integer not null check (qty >= 0),
  primary key (person_id, kind, batch_id)
);
--> statement-breakpoint
-- Every piece in or out of a rep's hands: received from an issue, given to a doctor, put back when a
-- visit is reopened, or a count's difference (with its reason).
create table sample_move (
  id bigint generated always as identity primary key,
  person_id bigint not null references person (id),
  kind text not null check (kind in ('samples', 'gifts')),
  batch_id bigint references batch (id),
  medicine_id bigint not null references medicine (id),
  qty integer not null,
  what text not null check (what in ('received', 'given', 'counted')),
  request_id bigint references sample_request (id),
  visit_id bigint references visit (id),
  customer_id bigint references customer (id),
  reason text,
  -- The doctor's signed acknowledgement (through the file store), on a gift or sample given.
  ack_key text,
  ack_data bytea,
  ack_name text,
  ack_mime text,
  by_person bigint not null references person (id),
  at timestamptz not null default now(),
  -- A count with no difference is kept (0) so the month shows it was counted.
  check (qty <> 0 or what = 'counted')
);
--> statement-breakpoint
create index sample_move_person on sample_move (person_id, at);
--> statement-breakpoint
create index sample_move_customer on sample_move (customer_id) where customer_id is not null;
--> statement-breakpoint
insert into counter (name, value) values ('sample_request', 0) on conflict (name) do nothing;
