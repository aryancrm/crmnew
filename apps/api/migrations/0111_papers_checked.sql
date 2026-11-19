-- Management checks an order's papers by hand (Aryan, 19 Nov: "papers turn green by themselves,
-- but a prescription has to be looked at, right or wrong: don't do it automatically"): who said
-- its papers are right, and when. Nothing else turns them green; a new paper asks for a new look.
alter table sales_order add column papers_checked_by bigint references person (id);
--> statement-breakpoint
alter table sales_order add column papers_checked_at timestamptz;
