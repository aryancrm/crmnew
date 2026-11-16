-- Making documents in the books (docs/PLAN.md 17): the warehouse a purchase order delivers to, a
-- receive's or bill's line pointing at the order line it came from, the batch a received line went
-- into, and who voided a document and why (a voided document stays, its money no longer counts).
alter table book_doc add column warehouse_id bigint references warehouse (id);
--> statement-breakpoint
alter table book_doc add column voided_by bigint references person (id);
--> statement-breakpoint
alter table book_doc add column voided_at timestamptz;
--> statement-breakpoint
alter table book_doc add column void_reason text;
--> statement-breakpoint
alter table book_line add column from_line bigint references book_line (id);
--> statement-breakpoint
create index book_line_from on book_line (from_line);
--> statement-breakpoint
alter table book_line add column batch_id bigint references batch (id);
