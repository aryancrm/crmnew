-- Fetch now on each portal's card (docs/PLAN.md 25): a press starts only that portal's part of the
-- robot (PhilGEPS: its public list and the screened tenders' papers; PS-PhilGEPS: its Sync). Presses
-- made before this change ran both portals.
alter table tender_find_ask add column portal text not null default 'both' check (portal in ('philgeps', 'ps', 'both'));
