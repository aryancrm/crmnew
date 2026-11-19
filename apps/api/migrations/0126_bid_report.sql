-- The bid report (Aryan, 19 Nov: "where they went to bid, how much the others quoted, was ours
-- approved or not, why not, how low the price went"; the abstract of bids read at the opening,
-- RA 12009's IRR): every bidder's price (a price per medicine when the tender has several items),
-- disqualified or not; the result in fixed words and its day; the securities an award ties up
-- (the performance security, the 1% retention on medicines) and the day each comes back.
create table tender_bidder (
  id bigint generated always as identity primary key,
  tender_id bigint not null references tender (id),
  name text not null,
  -- Their bid for the whole tender, centavos.
  price bigint check (price >= 0),
  -- Their price for one piece of our medicines, item by item: [{ "medicineId": 12, "unitPrice": 1850 }].
  lines jsonb not null default '[]'::jsonb,
  -- Out at the opening or at the post-qualification.
  disqualified boolean not null default false,
  note text,
  by_person bigint not null references person (id),
  at timestamptz not null default now(),
  -- A row put right is kept, marked replaced (nothing with history is deleted).
  replaced_at timestamptz
);
--> statement-breakpoint
create index tender_bidder_tender on tender_bidder (tender_id);
--> statement-breakpoint
alter table tender add column result_reason text check (result_reason in
  ('lowest', 'lower_price', 'above_abc', 'documents', 'post_disqualified', 'failed_bidding', 'other'));
--> statement-breakpoint
alter table tender add column result_on date;
--> statement-breakpoint
alter table tender add column performance_security_form text;
--> statement-breakpoint
alter table tender add column performance_security_amount bigint check (performance_security_amount >= 0);
--> statement-breakpoint
alter table tender add column performance_security_back_on date;
--> statement-breakpoint
alter table tender add column retention_amount bigint check (retention_amount >= 0);
--> statement-breakpoint
alter table tender add column retention_back_on date;
--> statement-breakpoint
-- The results already in: their day from the step's own record, the winners' reason.
update tender t set result_on = coalesce(t.noa_on,
    (select max(e.at at time zone 'Asia/Manila')::date from tender_event e where e.tender_id = t.id and e.step in ('won', 'lost')))
  where t.step in ('won', 'lost', 'contract', 'delivered', 'accepted', 'billed', 'paid') and t.result_on is null;
--> statement-breakpoint
update tender set result_reason = 'lowest'
  where step in ('won', 'contract', 'delivered', 'accepted', 'billed', 'paid') and result_reason is null;
