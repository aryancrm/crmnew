-- A channel's head is named on the channel itself: one person, set by the Admin. It is never
-- worked out from roles or from who reports to whom.
alter table channel add column head_id bigint references person (id);
