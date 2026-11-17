-- An offer runs until someone ends it (Aryan, 17 Nov: "Christmas offer" is only a name, it has
-- no days of its own); an end day may still be set.
alter table offer alter column ends_on drop not null;
