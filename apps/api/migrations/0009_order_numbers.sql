-- Order numbers in the company's own style (2MG-500001, as the old CRM and the website use),
-- in place of the dated GM-YYYYMMDD-NNNN ones.
update sales_order set code = '2MG-' || (500000 + id)::text;
