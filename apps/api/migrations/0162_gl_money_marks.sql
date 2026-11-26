-- A guarantee letter's money (Aryan, 26 Nov 2026): the medicine goes to the patient first; the
-- agency pays later, often months later and often less than its letter, and the patient may pay
-- the rest. The PAP person follows it up and marks what came in, with its proof; Finance confirms
-- each mark against the bank, and only then it is a payment on the invoice (or refuses it, with
-- why). Finance may still record a payment itself, and alone lets the rest go.

create table gl_money_mark (
  id bigint generated always as identity primary key,
  order_id bigint not null references sales_order (id),
  payer text not null check (payer in ('agency', 'patient')),
  -- Centavos.
  amount integer not null check (amount > 0),
  paid_on date not null,
  reference text,
  note text,
  proof_id bigint references order_file (id),
  by_person bigint not null references person (id),
  at timestamptz not null default now(),
  state text not null default 'waiting' check (state in ('waiting', 'confirmed', 'refused')),
  decided_by bigint references person (id),
  decided_at timestamptz,
  reason text,
  payment_id bigint references payment (id)
);
--> statement-breakpoint
create index gl_money_mark_order on gl_money_mark (order_id);
--> statement-breakpoint
create index gl_money_mark_waiting on gl_money_mark (order_id) where state = 'waiting';
