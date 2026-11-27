-- Every sale's amount without VAT beside its total (Aryan, 28 Nov: "one number everywhere", PLAN
-- 272). A target is measured against sales without VAT, as My KPIs, Sales performance and the hub
-- count them: each line's price before VAT, less what came back and was credited (the CRM's), each
-- line's amount (Zoho's). The Home's tree, Whole business and the CEO's figures read it, so they show
-- the very same sold as Headquarters and Sales vs target. What customers owe stays the total with
-- VAT. New columns go last.
create or replace view sale_invoice as
  select i.id, 'crm' as source, i.issued_on, i.due_on, i.total::bigint as total, i.paid::bigint as paid,
    i.status, i.customer_id, o.seat_id, o.medrep_id, o.channel_id, o.id as order_id, o.covered, o.cover_lead_id,
    (select coalesce(sum(round((oi.qty - coalesce((select sum(rl.qty) from sales_return_line rl join sales_return rr on rr.id = rl.return_id
          where rl.order_item_id = oi.id and rr.credited_at is not null and rl.outcome <> 'missing'), 0))::numeric * oi.unit_price
          / case when coalesce(oi.vat_then, m.vat) = 'vat12' then 1.12 else 1 end)), 0)
      from order_item oi join medicine m on m.id = oi.medicine_id where oi.order_id = o.id)::bigint as net
  from invoice i join sales_order o on o.id = i.order_id
  union all
  select d.id, 'zoho', d.doc_date, d.due_date, round(d.total * d.fx_rate)::bigint, round((d.total - d.balance) * d.fx_rate)::bigint,
    case when d.status = 'void' then 'cancelled' when d.balance <= 0 then 'paid' else 'open' end,
    d.customer_id, zs.seat_id, null::bigint, seat_channel_id(zs.seat_id), null::bigint, false, null::bigint,
    (select coalesce(sum(round(coalesce(l.amount, 0) * d.fx_rate)), 0) from book_line l where l.doc_id = d.id and coalesce(l.qty, 1) > 0)::bigint
  from book_doc d
    left join zoho_seller zs on zs.name = coalesce(d.fields->>'Sales Person', d.fields->>'salesperson_name')
  where d.kind = 'invoice' and d.zoho_id is not null and d.status not in ('draft');
