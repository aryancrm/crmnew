-- Cash on delivery, handed over (Aryan, 19 Nov: "a COD order went out: who marks it delivered,
-- who marks the cash?"). Dispatch marks the order delivered with the signed receipt and notes the
-- cash the rider or courier collected and who has it; Finance records the payment once the money
-- is in the bank. What Dispatch noted, with who noted it and when.
alter table sales_order add column cod_collected integer check (cod_collected > 0);
--> statement-breakpoint
alter table sales_order add column cod_collected_by text;
--> statement-breakpoint
alter table sales_order add column cod_noted_by bigint references person (id);
--> statement-breakpoint
alter table sales_order add column cod_noted_at timestamptz;
