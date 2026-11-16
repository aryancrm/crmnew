-- Every sale in one place (docs/PLAN.md 17): this CRM's invoices and Zoho's (the books), so the CEO's
-- and the team pages count Zoho's months too. A Zoho invoice is credited to the seat its Zoho
-- salesperson was tied to (Admin panel → Zoho's salespeople), in that seat's channel.
create or replace function seat_channel_id(p_seat bigint) returns bigint
language sql stable as $$
  with recursive up as (
    select u.id, u.parent_id, u.channel_id, 0 as depth from org_unit u where u.id = (select s.unit_id from seat s where s.id = p_seat)
    union all
    select p.id, p.parent_id, p.channel_id, up.depth + 1 from org_unit p join up on p.id = up.parent_id
  )
  select channel_id from up where channel_id is not null order by depth limit 1
$$;
--> statement-breakpoint
create or replace view sale_invoice as
  select i.id, 'crm' as source, i.issued_on, i.due_on, i.total::bigint as total, i.paid::bigint as paid,
    i.status, i.customer_id, o.seat_id, o.medrep_id, o.channel_id, o.id as order_id
  from invoice i join sales_order o on o.id = i.order_id
  union all
  select d.id, 'zoho', d.doc_date, d.due_date, round(d.total * d.fx_rate)::bigint, round((d.total - d.balance) * d.fx_rate)::bigint,
    case when d.status = 'void' then 'cancelled' when d.balance <= 0 then 'paid' else 'open' end,
    d.customer_id, zs.seat_id, null::bigint, seat_channel_id(zs.seat_id), null::bigint
  from book_doc d
    left join zoho_seller zs on zs.name = coalesce(d.fields->>'Sales Person', d.fields->>'salesperson_name')
  where d.kind = 'invoice' and d.zoho_id is not null and d.status not in ('draft');
