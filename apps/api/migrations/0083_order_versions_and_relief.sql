-- The order line kept safe (docs/PLAN.md 18, Aryan 17 Nov).
--
-- Every version of an order's lines: as it was placed, each time the MedRep fixed it, each time
-- Management changed it before approving. The order's lines (order_item) are its newest version;
-- what was there before is never lost, and the MedRep sees what changed line by line.
create table order_version (
  id bigint generated always as identity primary key,
  order_id bigint not null references sales_order (id),
  n integer not null,
  kind text not null check (kind in ('placed', 'fixed', 'changed')),
  by_person bigint references person (id),
  at timestamptz not null default now(),
  -- The MedRep's answer, or Management's reason.
  why text,
  -- [{medicineId, name, qty, priceKind, listPrice, unitPrice, reason, free, relief}], centavos.
  lines jsonb not null,
  total bigint not null,
  unique (order_id, n)
);
--> statement-breakpoint
create index order_version_order on order_version (order_id, n desc);
--> statement-breakpoint
-- Orders placed before versions were kept: their lines as they stand now, as their first version.
insert into order_version (order_id, n, kind, by_person, at, why, lines, total)
select o.id, 1, 'placed', o.raised_by, o.created_at, 'As it stood when versions began (17 Nov 2026)',
  coalesce((
    select jsonb_agg(jsonb_build_object(
        'medicineId', i.medicine_id, 'name', m.name || coalesce(' ' || m.strength, ''), 'qty', i.qty,
        'priceKind', i.price_kind, 'listPrice', i.list_price, 'unitPrice', i.unit_price, 'reason', i.price_reason,
        'free', i.free, 'relief', i.relief) order by i.id)
    from order_item i join medicine m on m.id = i.medicine_id where i.order_id = o.id), '[]'::jsonb),
  o.total
from sales_order o;
--> statement-breakpoint

-- A senior citizen's or a PWD's order (RA 9994, RA 10754): 20% off and no VAT on what they buy for
-- themselves, or a promo instead when it is lower, never both. The order keeps who: their kind,
-- their OSCA or PWD ID number and their name, as the invoice must show them.
alter table sales_order add column relief_kind text check (relief_kind in ('senior', 'pwd'));
--> statement-breakpoint
alter table sales_order add column relief_id_no text;
--> statement-breakpoint
alter table sales_order add column relief_name text;
--> statement-breakpoint
-- Orders already placed with relief (Online and PAP cases): their kind from the case.
update sales_order o set relief_kind = l.road
from lead l
where l.order_id = o.id and l.road in ('senior', 'pwd') and o.relief_kind is null
  and exists (select 1 from order_item i where i.order_id = o.id and i.relief);
