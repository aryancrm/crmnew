-- A channel is set up in the Admin panel: its own Division (what its orders are booked under) and
-- whether it is still in use. The Division was read from the channel's code until now.
alter table channel add column division text;
--> statement-breakpoint
alter table channel add column active boolean not null default true;
--> statement-breakpoint
update channel set division = case code
  when 'HOSP' then 'HOS' when 'B2B' then 'B2B' when 'BID' then 'BID' when 'MT' then 'MT'
  when 'TS' then 'TeleSales' when 'PAP' then 'MD Telesales' when 'ONLINE' then 'B2C' else null end;
