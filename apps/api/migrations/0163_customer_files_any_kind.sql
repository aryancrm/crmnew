-- A customer's files (26 Nov: "walang upload files dito?"): a patient's prescription and valid ID,
-- and any other file for any customer, beside a business's three papers (BIR 2303, LTO permit,
-- business permit).
alter table customer_file drop constraint customer_file_kind_check;
--> statement-breakpoint
alter table customer_file add constraint customer_file_kind_check
  check (kind in ('bir_2303', 'lto_permit', 'business_permit', 'prescription', 'valid_id', 'other'));
