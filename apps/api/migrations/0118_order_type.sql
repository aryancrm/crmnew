-- An order's type, picked first on the order form (Aryan, 19 Nov: "the MedRep knows whose order
-- it is; pick it first, as the Online case's GL, PWD and Regular, and the whole order follows
-- it"): a patient's (regular), a senior citizen's or PWD's (20% off, no VAT), one paid by a
-- guarantee letter, a business's with their PO, or a business's without one. It says which papers
-- the order carries. Orders placed before it have none and keep the old rules.
alter table sales_order add column order_type text check (order_type in ('patient', 'senior_pwd', 'gl', 'po', 'no_po'));
