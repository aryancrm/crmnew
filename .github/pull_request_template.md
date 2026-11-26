## Summary & Vault Trace
- **What changed:**
- **Why / Vault or Plan reference:**

## Scope & Impact Check
- **Apps / Areas touched:** (e.g., `BIR`, `Books`, `Finance Hub` — confirm zero unintended edits to `Orders`, `HR`, `Field`, `Customers`, `Tenders`, `Dispatch`, `Inventory`, `Portal`)
- **Shared files touched:** (e.g., `app.ts`, `main.tsx`, `books/shell.tsx`, `decisions/service.ts`, `audit/trail.ts`)
- **Roles affected:** (`finance`, `ceo`, `admin`, or none)

## Out-of-Scope & Aryan Alert Check
- [ ] Zero edits to out-of-scope modules (`apps/web/src/customers/*`, `hr/*`, `field/*`, `mr/*`, `tenders/*`, `orders/*`, `dispatch/*`, `portal/*`)
- [ ] Any upstream blockers or cross-team notes for Aryan are listed below:
  - _None / describe here_

## Database Changes (Plain English)
- **Migration file(s):** _None / `apps/api/migrations/016X_....sql`_
- **Plain-English explanation:**
- [ ] Confirmed **additive-only** (no `DROP`, no `RENAME`, no edits to existing `0001`–`0159` migrations)
- [ ] Re-checked latest migration number against `origin/main` right before creating
- [ ] **Deploy note:** Take a PostgreSQL snapshot / `pg_dump` before deploying new migrations

## Verification Evidence
- [ ] `node scripts/ci/branch-report.ts`
- [ ] `node scripts/ci/migrations.ts origin/main`
- [ ] `node --test "scripts/ci/*.test.ts"`
- [ ] `corepack pnpm --filter @2mg/api typecheck`
- [ ] `corepack pnpm --filter @2mg/web typecheck`
- [ ] `corepack pnpm --filter @2mg/web build`
- [ ] `corepack pnpm --filter @2mg/api test`

## Rollback / Fallback Plan
1. **Runtime Kill-Switch:** Toggle `FINANCE_BIR_ENABLED` / `FINANCE_HUB_ENABLED` to `false` (instant disable without redeploy).
2. **Additive Schema:** Existing `main` code ignores new tables/nullable columns/new views; reverting app code requires no DB downgrade.
3. **Git Revert:** `git revert -m 1 <merge-sha>` via a revert PR (never force-push `main`).
4. **DB Snapshot:** Restore pre-deploy PostgreSQL snapshot if ever needed.
