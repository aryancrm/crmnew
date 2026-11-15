-- The customer's own purchase order number (a hospital's PO), typed by the MedRep.
alter table sales_order add column customer_po text;
