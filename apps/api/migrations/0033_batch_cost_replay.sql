-- A batch's cost when a purchase lands in a batch already on the shelf: each received line keeps
-- the pieces on the shelf and the batch's cost just before it landed, so the batch's average can
-- be worked out again when a purchase's costs change later (a freight bill coming in after).
alter table purchase_line add column shelf_before integer;
--> statement-breakpoint
alter table purchase_line add column cost_before integer;
--> statement-breakpoint
-- A line that made its batch had nothing before it.
update purchase_line l set shelf_before = 0 from batch b where b.id = l.batch_id and b.purchase_line_id = l.id;
