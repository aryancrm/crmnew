-- A monthly target belongs to the seat as well as the person in it: when the person leaves, the
-- next one in the seat takes the seat's target, and an empty seat's target still counts in its
-- team's and the company's. The person's own target (sales_target) is what every figure reads;
-- it is written from the seat's when someone takes the seat.
create table seat_target (
  seat_id bigint not null references seat (id),
  -- The first day of the month.
  month date not null check (extract(day from month) = 1),
  amount bigint not null check (amount >= 0),
  set_by bigint not null references person (id),
  set_at timestamptz not null default now(),
  primary key (seat_id, month)
);
--> statement-breakpoint
-- Targets set so far stay with the seats their people hold today.
insert into seat_target (seat_id, month, amount, set_by, set_at)
select distinct on (h.seat_id, t.month) h.seat_id, t.month, t.amount, t.set_by, t.set_at
from sales_target t
join seat_holder h on h.person_id = t.person_id and h.kind = 'holder'
  and h.starts_on <= (t.month + interval '1 month' - interval '1 day')::date and (h.ends_on is null or h.ends_on >= t.month)
join seat s on s.id = h.seat_id and s.active
order by h.seat_id, t.month, h.starts_on desc;
