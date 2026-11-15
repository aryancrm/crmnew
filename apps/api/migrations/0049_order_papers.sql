-- The papers an order carries, by who it is for (Aryan): a hospital sends its PO and its own
-- papers; a patient's order carries the prescription and the patient's ID (a senior / PWD ID,
-- a medical certificate, a guarantee letter when one pays).
alter table order_file drop constraint order_file_kind_check;
--> statement-breakpoint
alter table order_file add constraint order_file_kind_check check (kind in
  ('po', 'hospital_doc', 'payment_proof', 'prescription', 'valid_id', 'senior_id', 'med_cert', 'gl', 'dr', 'other'));
--> statement-breakpoint
-- An order for one patient, placed through a hospital or a doctor: the MedRep says so, and
-- Management then checks the prescription and the ID as on a patient's own order.
alter table sales_order add column patient_order boolean not null default false;
--> statement-breakpoint
alter table sales_order add column patient_name text;
