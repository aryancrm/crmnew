-- Sales calls for everyone and the daily sales performance (18 Nov 2026; the B2B team's request,
-- Aryan: "every person logs their calls on their own screen, and it shows up the team"). The team
-- kept calls in a Google Form and added each caller's name and channel by hand in Excel; here a
-- call is logged by the person under their own login, in their seat and its channel.

-- A call: to a customer in the CRM or to one named as typed, in the seat the caller held then.
alter table account_call alter column customer_id drop not null;
--> statement-breakpoint
alter table account_call add column customer_text text;
--> statement-breakpoint
alter table account_call add column seat_id bigint references seat (id);
--> statement-breakpoint
alter table account_call add constraint account_call_whom check (customer_id is not null or customer_text is not null);
--> statement-breakpoint
create index account_call_person on account_call (by_person, at desc);
--> statement-breakpoint
create index account_call_at on account_call (at);
--> statement-breakpoint

-- Beside the peso target: TLB (how many different SKUs) and billing efficiency (how many different
-- customers billed), each month.
alter table sales_target add column tlb integer check (tlb >= 0);
--> statement-breakpoint
alter table sales_target add column billed integer check (billed >= 0);
--> statement-breakpoint
alter table seat_target add column tlb integer check (tlb >= 0);
--> statement-breakpoint
alter table seat_target add column billed integer check (billed >= 0);
--> statement-breakpoint

-- The business line a team's sales are reported under (B2B, RX, HOSP, BID, CLIDP, TELESALES, B2C,
-- MT): a team inside a channel can be its own line (CLIDP sits in B2B). Unset: the channel's.
alter table org_unit add column report_channel text;
--> statement-breakpoint
update org_unit set report_channel = 'CLIDP' where lower(name) = 'clidp';
--> statement-breakpoint
-- A seat's business line: the nearest team up its tree that names one, else its channel's (the
-- Telesales channel reports as TELESALES, Online as B2C, the others under their own code).
create or replace function seat_report_channel(p_seat bigint) returns text
language sql stable as $$
  with recursive up as (
    select u.id, u.parent_id, u.report_channel, u.channel_id, 0 as depth from org_unit u where u.id = (select s.unit_id from seat s where s.id = p_seat)
    union all
    select p.id, p.parent_id, p.report_channel, p.channel_id, up.depth + 1 from org_unit p join up on p.id = up.parent_id
  )
  select coalesce(
    (select report_channel from up where report_channel is not null order by depth limit 1),
    (select case c.code when 'TS' then 'TELESALES' when 'ONLINE' then 'B2C' else c.code end
      from up join channel c on c.id = up.channel_id order by up.depth limit 1))
$$;
