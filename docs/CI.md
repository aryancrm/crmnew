# CI: the checks on every branch

`.github/workflows/ci.yml` runs on every push to any branch, every pull request, nightly at 2 am
Manila (everything) and by hand (Actions → CI → Run workflow).

## What changed decides what runs

The first job, **What changed**, compares the branch with where it left `main`
(`scripts/ci/detect.ts`) and switches on only the groups the change needs. A file no rule knows,
or a change to the CI itself, switches everything on. The run's summary says which group is on
because of which file.

| Group | Switched on by | Runs |
|---|---|---|
| Always | any change | Secrets scan (gitleaks), migration numbers and no applied migration edited, the detection's own tests |
| Web | `apps/web/**`, API types the web imports, dependencies | Web type-check, build, bundle size |
| API | `apps/api/src/**` | API type-check; the tests the change reaches (`vitest related`), or every test when shared code (`app.ts`, `http.ts`, `types.ts`, `db/`, roles, `checks/`…) changed |
| Database | `apps/api/migrations/**`, `db/schema.ts` | Every migration on a real Postgres 17, twice; demo company in; data checks green |
| Dependencies | any `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` | Lockfile matches; `pnpm audit` (reported); every test; Docker |
| Docker | Dockerfiles, nginx template, `docker-compose.yml`, `server.ts`, env examples | Both images built, the stack started, smoke test (health, the app, `/api/me` refused), image scan (reported) |
| Security | `auth/`, `http.ts`, `app.ts`, `files/`, `messages/`, `org/`; or a change adding a route, `sql.raw(` or `dangerouslySetInnerHTML` | Semgrep: our rules (`.semgrep/rules.yml`: raw SQL from a value, queries joined by hand, HTML from a value, secrets in code) and the TypeScript and React sets; only what the change adds blocks |
| Scripts | `apps/api/scripts/**` | Type-check (reported: two old scripts don't pass yet) |
| Docs only | `docs/**`, `*.md` | Nothing but the always-checks |

**CI passed** waits for all of them; a group skipped on purpose doesn't block it.

## Protecting main (once, in GitHub)

Settings → Branches → Add rule for `main`: require a pull request, require status checks to pass,
pick **CI passed**, require branches to be up to date. Pushing straight to `main` is then refused.

## Run the detection locally

```
node scripts/ci/detect.ts origin/main     # which groups this branch switches on
node --test "scripts/ci/*.test.ts"        # the rules' own tests
node scripts/ci/migrations.ts origin/main # migration numbers
```

## Next

The security test suite (sign-in, sessions, access by role, other people's records, extra fields,
injection payloads, uploads, webhooks), rate limits across the API, the header and cookie check, ZAP
and sqlmap against the Docker stack, and the scheduled Strix pentest against a staging copy.
