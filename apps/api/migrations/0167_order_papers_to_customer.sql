-- An order's papers that are the customer's own (27 Nov: "all those documents that they attach ...
-- will be added to their customer informations"): a business's BIR 2303, LTO permit and business
-- permit, picked on the order instead of one "their papers"; a patient's prescription, valid ID and
-- senior / PWD ID. Each one attached to an order is kept on the customer too, as the same file,
-- with the order paper it came from. Safe to run again.
alter table order_file drop constraint if exists order_file_kind_check;
--> statement-breakpoint
alter table order_file add constraint order_file_kind_check check (kind in
  ('po', 'hospital_doc', 'bir_2303', 'lto_permit', 'business_permit', 'payment_proof', 'prescription',
   'valid_id', 'senior_id', 'med_cert', 'gl', 'dr', 'other'));
--> statement-breakpoint
alter table customer_file drop constraint if exists customer_file_kind_check;
--> statement-breakpoint
alter table customer_file add constraint customer_file_kind_check
  check (kind in ('bir_2303', 'lto_permit', 'business_permit', 'prescription', 'valid_id', 'senior_id', 'other'));
--> statement-breakpoint
alter table customer_file add column if not exists order_file_id bigint references order_file (id);
--> statement-breakpoint
create unique index if not exists customer_file_from_order on customer_file (order_file_id) where order_file_id is not null;
