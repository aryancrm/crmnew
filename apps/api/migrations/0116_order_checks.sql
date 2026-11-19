-- Management approves an order check by check (Aryan, 19 Nov: "each of the four with its own
-- approve: inside Documents an approve, inside Medicines & price an approve"): Documents,
-- Medicines & price, Stock & warehouse, Customer & licence. The order is approved when all four
-- are. Each kept with who approved it and when; sending the order back, taking its approval back
-- or changing it clears them, so it is looked at afresh.
create table order_check (
  order_id bigint not null references sales_order (id),
  check_key text not null check (check_key in ('papers', 'price', 'stock', 'customer')),
  by_person bigint not null references person (id),
  at timestamptz not null default now(),
  primary key (order_id, check_key)
);
