# CLAUDE.md

The new CRM for 2MG / GetMeds (moved out of the old `crm` repository's `new/` folder on
16 November 2026, with its history). The old CRM (`~/Projects/crm`) is reference only and is
to be shut down once this one is live and everything has moved over.

- **The plan is [docs/PLAN.md](docs/PLAN.md)**: business rules, roles, the order line, what is
  built, the questions still open and the change log. Keep it current whenever Aryan gives a
  new rule (edit the section, add a change-log line).
- Talk to Aryan in Hinglish (Hindi in Latin script), short. Code, comments and docs in plain English.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commit
  locally; push or deploy only when Aryan says.

## Layout

| Path | What |
|---|---|
| `apps/api` | Hono + Zod + Drizzle API. `src/` code, `migrations/` hand-written SQL applied in order on start, tests beside the code. |
| `apps/web` | React (Vite) app. Screens only, each area in its own folder (`orders/`, `sellers/`, `hr/`…, see the README); menus are data in `src/menus.ts`. |
| `workers/tender-finder` | The tender finder's robot (PLAN 24): a browser that reads PhilGEPS and hands in to the CRM through `/webhooks/tender-finder`. Own `package.json`, not in the pnpm workspace (it needs Chrome). |
| `docs/` | The plan, the role audit, the hub's inventory and modules. |

## Commands

```
pnpm install
pnpm --filter @2mg/api test        # vitest, embedded Postgres in memory
pnpm --filter @2mg/api dev         # API on :4100 (PGlite in .data/pg unless DATABASE_URL is set)
pnpm --filter @2mg/web dev         # web on :5180
```

Local: `.claude/launch.json` (`crmnew-api`, `crmnew-web`). Since 17 Nov the local database holds
the real company (the 2026 chart's people, `docs/PEOPLE-2026.md`; the demo people left, their orders,
customers and desk work closed by `scripts/close-demo.ts`, the Admin login stays): everyone signs in with their seat's login ID (`hos1`…) and their own password,
first a one-time one (`pnpm --filter @2mg/api passwords`, or the Admin's "Give a new password"), then
one they choose. This replaces Aryan's 17 Nov rule (`JOIN_PASSWORD` for all, never forced to change)
and waits for Aryan's approval before it is merged to main or deployed (PLAN, change log 164); keep
passwords out of code and docs. Tests still seed their own demo company. One process per PGlite folder: check nothing
listens on :4100 before starting the API.

## Rules worth knowing

- Money is whole centavos. Nothing with history is deleted: cancel, reverse, archive.
- The API checks the role on every call; a hidden button is never the only guard.
- Every file's bytes go through `src/files/store.ts` (`keepFile` before the transaction,
  `bytesOf` to read): it makes photos smaller and puts them in the bucket online. Never insert
  raw bytes into a file table directly.
- `src/checks/integrity.ts` checks the data against itself (Admin panel → Data checks); the
  130-person test (`src/checks/scale.test.ts`) checks who sees what. Keep both green.
