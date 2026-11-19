-- The order's Division is the sales tracker's channel (Aryan, 19 Nov: "we have 7 or 8 channels; why
-- so many Divisions?"; the tracker is God): RX Business, MD Telesales, B2B, BID, CLIDP, TeleSales,
-- HOSP and MT. The hub's finer words become their channel, where the November target sheet puts
-- their people: URO, B&B and STC are RX Business, B2C is MD Telesales, HOS is HOSP, TeleSales
-- Anesthesia is TeleSales (the hub's MSA and PS had nobody). This CRM's orders, channels and
-- approvers move; Zoho's own history (past_order, zoho_contact) keeps Zoho's words.
update sales_order set division = case division
    when 'HOS' then 'HOSP'
    when 'URO' then 'RX Business'
    when 'B&B' then 'RX Business'
    when 'STC' then 'RX Business'
    when 'B2C' then 'MD Telesales'
    when 'TeleSales Anesthesia' then 'TeleSales'
  end
  where division in ('HOS', 'URO', 'B&B', 'STC', 'B2C', 'TeleSales Anesthesia');
--> statement-breakpoint
update channel set division = case division
    when 'HOS' then 'HOSP'
    when 'URO' then 'RX Business'
    when 'B&B' then 'RX Business'
    when 'STC' then 'RX Business'
    when 'B2C' then 'MD Telesales'
    when 'TeleSales Anesthesia' then 'TeleSales'
  end
  where division in ('HOS', 'URO', 'B&B', 'STC', 'B2C', 'TeleSales Anesthesia');
--> statement-breakpoint
-- A Management person who approves only some Divisions approves their channels (none of MSA or PS).
update person set approves = coalesce(
    (select array_agg(distinct case one
        when 'HOS' then 'HOSP'
        when 'URO' then 'RX Business'
        when 'B&B' then 'RX Business'
        when 'STC' then 'RX Business'
        when 'B2C' then 'MD Telesales'
        when 'TeleSales Anesthesia' then 'TeleSales'
        else one end)
      from unnest(approves) as one where one not in ('MSA', 'PS')),
    '{}'::text[])
  where approves && array['HOS', 'URO', 'B&B', 'STC', 'B2C', 'TeleSales Anesthesia', 'MSA', 'PS']::text[];
--> statement-breakpoint
-- A seat's Division: the nearest box of the seat on the chart that names a channel its own channel
-- doesn't say (CLIDP sits in B2B; MD Telesales in Telesales; RX Business and its two lines in the
-- Prescription Business), else the Division of its nearest box's channel.
create or replace function seat_division(p_seat bigint) returns text
language sql stable as $$
  with recursive up as (
    select u.id, u.parent_id, u.name, u.channel_id, 0 as depth from org_unit u
      where u.id = (select s.unit_id from seat s where s.id = p_seat)
    union all
    select p.id, p.parent_id, p.name, p.channel_id, up.depth + 1 from org_unit p join up on p.id = up.parent_id
      where up.depth < 12
  )
  select coalesce(
    (select case
        when up.name ~* '^CLIDP\M' then 'CLIDP'
        when up.name ~* '^MD Telesales$' then 'MD Telesales'
        else 'RX Business' end
      from up where up.name ~* '^(CLIDP\M|MD Telesales$|RX Business$|Uro & Onco Care$|Blood & Bone Care$)'
      order by up.depth limit 1),
    (select c.division from up join channel c on c.id = up.channel_id where c.division is not null order by up.depth limit 1)
  )
$$;
