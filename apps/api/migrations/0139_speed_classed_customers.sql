-- Speed only: no data and no figure changes. A field person's scorecard counts their customers
-- that have a visit class (A, B, C) three times; very few customers have one, and each count read
-- every customer of theirs. This index holds only the classed ones.
create index if not exists customer_classed on customer (area_id) where visit_class is not null;
