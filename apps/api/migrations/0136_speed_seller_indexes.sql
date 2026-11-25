-- Speed only: no data and no figure changes (Aryan, 22 Nov: "every page is slow"). Zoho's invoices
-- and old orders find their seat through the salesperson's name; asking "this seat's invoices"
-- read every one of them each time (the Telesales team screen took 30 seconds). With these the
-- database goes straight from a seat's salesperson names to their invoices and orders.
create index if not exists book_doc_invoice_seller
  on book_doc ((coalesce(fields->>'Sales Person', fields->>'salesperson_name')))
  where kind = 'invoice' and zoho_id is not null;
--> statement-breakpoint
create index if not exists past_order_seller on past_order (seller);
--> statement-breakpoint
create index if not exists zoho_seller_seat on zoho_seller (seat_id) where seat_id is not null;
