-- PCSO's three quotations (Aryan, 26 Nov 2026, as the old CRM did: "PCSO gets three quotations,
-- automatically; the others one"): ours and two other vendors'. Each medicine keeps the two other
-- vendors' price for one piece, typed once by whoever sets prices; a PCSO case's quotations 2 and
-- 3 then fill themselves from the medicines it quotes (the old CRM's canvass_2 / canvass_3 on each
-- product). A vendor that is one of the group's companies gets its quotation on its own letterhead.

create table medicine_canvass (
  medicine_id bigint not null references medicine (id),
  slot smallint not null check (slot in (2, 3)),
  vendor text not null check (length(btrim(vendor)) between 1 and 120),
  -- Centavos, one piece.
  amount integer not null check (amount > 0),
  updated_by bigint references person (id),
  updated_at timestamptz not null default now(),
  primary key (medicine_id, slot)
);
