-- An invoice keeps its lines as they were billed (plan 18 step 3): the medicine's name, strength,
-- form and VAT are kept on the order's lines when the invoice is made (and made good again), so
-- renaming a medicine or changing its VAT in Inventory later never changes an old invoice. Lines
-- already billed keep what they show today.
alter table order_item add column name_then text;
--> statement-breakpoint
alter table order_item add column strength_then text;
--> statement-breakpoint
alter table order_item add column form_then text;
--> statement-breakpoint
alter table order_item add column vat_then text;
--> statement-breakpoint
update order_item i set name_then = m.name, strength_then = m.strength, form_then = m.form,
  vat_then = case when i.relief then 'exempt' else m.vat end
from medicine m, invoice v
where m.id = i.medicine_id and v.order_id = i.order_id;
