-- Every Online case's order goes Management → Finance → Dispatch like every other order (Aryan,
-- 18 Nov 2026: "the Online desk's work goes to Management and to Finance"). Case orders placed
-- before this were saved to skip Finance; the ones Management has not approved yet now go to
-- Finance after the approval too. Orders already approved keep the road they were on.
update sales_order
set finance_check = true, updated_at = now()
where lead_id is not null
  and not finance_check
  and approved_at is null
  and status in ('draft', 'pending_approval', 'on_hold', 'exception');
