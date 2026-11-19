-- Finance approves what the system found on an order check by check too, as Management does
-- (Aryan, 19 Nov: "no approve here, like Management's?"): its papers, what the customer owed from
-- before, and its credit limit. Its payment check is approved by Confirm payment (paid in advance)
-- or by sending the order on to Dispatch (cash on delivery, credit), as before.
alter table order_check drop constraint order_check_check_key_check;
--> statement-breakpoint
alter table order_check add constraint order_check_check_key_check check (
  check_key in ('papers', 'price', 'stock', 'customer', 'finance_papers', 'finance_dues', 'finance_credit')
);
