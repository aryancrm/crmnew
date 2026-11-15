-- Files can live in a bucket (Supabase Storage) instead of the row: the row then keeps the
-- bucket's key and no bytes. Files already in rows stay there and keep working.
alter table lead_file add column store_key text;
--> statement-breakpoint
alter table lead_file alter column data drop not null;
--> statement-breakpoint
alter table lead_file add constraint lead_file_has_bytes check (data is not null or store_key is not null);
--> statement-breakpoint
alter table order_file add column store_key text;
--> statement-breakpoint
alter table order_file alter column data drop not null;
--> statement-breakpoint
alter table order_file add constraint order_file_has_bytes check (data is not null or store_key is not null);
--> statement-breakpoint
alter table field_expense add column receipt_key text;
--> statement-breakpoint
do $$
declare found text;
begin
  for found in
    select conname from pg_constraint
    where conrelid = 'field_expense'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%receipt_data IS NOT NULL%'
  loop
    execute format('alter table field_expense drop constraint %I', found);
  end loop;
end $$;
--> statement-breakpoint
alter table field_expense add constraint field_expense_receipt check (kind = 'fare' or receipt_data is not null or receipt_key is not null);
--> statement-breakpoint
alter table person_leave add column file_key text;
