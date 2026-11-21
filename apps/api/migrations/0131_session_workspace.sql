-- A session keeps the department it was opened for (Aryan, 21 Nov: the token is the source of
-- truth for access). Sessions opened before this have none; they keep working until they end.
alter table session add column workspace text;
