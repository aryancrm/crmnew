-- Every customer has its number (26 Nov): only the app's Add customer gave one (CUS-00017); the
-- demo seeds, Zoho's imports and other inserts left it empty, and the customer page showed a blank
-- chip and "Customer no." with nothing after it. Every empty one is numbered now, and any customer
-- added without one gets it on the way in. Safe to run again (it was 0162).
update customer set code = 'CUS-' || lpad(id::text, 5, '0') where code is null or code = '';
--> statement-breakpoint
create or replace function customer_code_default() returns trigger
language plpgsql as $$
begin
  if new.code is null or new.code = '' then
    new.code := 'CUS-' || lpad(new.id::text, 5, '0');
  end if;
  return new;
end
$$;
--> statement-breakpoint
drop trigger if exists customer_code_default on customer;
--> statement-breakpoint
create trigger customer_code_default before insert on customer
  for each row execute function customer_code_default();
