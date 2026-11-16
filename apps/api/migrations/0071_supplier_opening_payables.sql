-- What was owed to a vendor when the books came over that no bill here explains (Zoho's opening
-- balances), the same way as 0070's credits. Centavos of pesos.
alter table supplier add column opening_payables bigint not null default 0 check (opening_payables >= 0);
