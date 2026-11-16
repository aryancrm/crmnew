-- A bid line changed while the bid is prepared is kept, marked replaced (nothing with history is
-- deleted).
alter table tender_line add column if not exists replaced_at timestamptz;
