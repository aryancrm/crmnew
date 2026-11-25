-- The bidding team's own system (built apart, to be moved into the CRM; docs/PLAN.md 25) hands
-- its tenders over while its work moves in piece by piece. A notice it screened is screened here
-- too; who screened it there is no person of the CRM's, so the name is kept as written.
alter table tender_found add column screened_as text;
