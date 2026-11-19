-- The tracking number a website was last told for an order (as the old CRM did: "shipped" goes
-- again, with the tracking, when it is typed after shipping). Orders already shown as shipped or
-- delivered start from what they have, so nothing is sent twice.
alter table web_order add column pushed_tracking text;
--> statement-breakpoint
update web_order w set pushed_tracking = nullif(trim(o.tracking), '')
  from lead l join sales_order o on o.id = l.order_id
  where l.id = w.lead_id and w.status in ('shipped', 'delivered');
