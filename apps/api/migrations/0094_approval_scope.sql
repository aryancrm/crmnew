-- Who approves what (the hub's Management (Approval) access, set by the Admin): a Management
-- person approves every division (null, as before) or only the ones listed; an order with no
-- division is only for those who approve everything.
alter table person add column approves text[];
