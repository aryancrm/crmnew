-- Credits a vendor already had when the books came over that no Zoho Inventory document explains
-- (advances kept in Zoho Books): Zoho's "Unused Credits" for the vendor less what the vendor credits
-- and payments brought in already account for. Centavos of pesos.
alter table supplier add column opening_credits bigint not null default 0 check (opening_credits >= 0);
