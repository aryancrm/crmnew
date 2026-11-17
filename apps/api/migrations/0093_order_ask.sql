-- Asking up for an exception (Aryan, 17 Nov, question 9: both the automatic price check and this):
-- Management asks the MedRep's Team Lead, or the Business Mentor (the head of the division), on the
-- order with what it is asking; that person answers Yes or No with a word on their own screen; it
-- comes back to Management, which decides. A button in the CRM, kept on the order, not a
-- screenshot or a mail.
create table order_ask (
  id bigint generated always as identity primary key,
  order_id bigint not null references sales_order (id),
  asked_by bigint not null references person (id),
  asked_to bigint not null references person (id),
  as_who text not null check (as_who in ('team_lead', 'business_mentor')),
  question text not null,
  asked_at timestamptz not null default now(),
  answer boolean,
  answer_note text,
  answered_at timestamptz,
  withdrawn_at timestamptz
);
--> statement-breakpoint
create index order_ask_order on order_ask (order_id);
--> statement-breakpoint
create index order_ask_open on order_ask (asked_to) where answer is null and withdrawn_at is null;
