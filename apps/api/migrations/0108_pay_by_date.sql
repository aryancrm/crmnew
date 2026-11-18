-- Payment terms of any length, or by a particular date (Aryan, 18 Nov: "30, 45, 60 days, three
-- months, different dates"): an order agreed to be paid by a date keeps that date as its due day,
-- whenever it is invoiced or delivered.
alter table sales_order add column pay_by date;
