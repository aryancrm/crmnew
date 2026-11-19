-- A website order whose customer applies for a guarantee letter with our quotation (the old CRM's
-- `letter`, 19 Nov): "needed" when the website said so; once the case's quotation went out or the
-- application is on record, the website is told "quotation_sent" (it then tells the customer to
-- apply at the agency with it), and the letter is "quoted".
alter table web_order add column letter text check (letter in ('needed', 'quoted'));
--> statement-breakpoint
alter table web_order drop constraint web_order_push_status_check;
--> statement-breakpoint
alter table web_order add constraint web_order_push_status_check
  check (push_status in ('confirmed', 'shipped', 'delivered', 'cancelled', 'quotation_sent'));
