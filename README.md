# 2MG: the new system

A complete new project (new code, new database, new screens). The plan, the business rules and
what is built so far are in [docs/PLAN.md](docs/PLAN.md): read that first.
Nothing here imports from the old CRM in `../backend` and `../frontend`.

## Layout

```
apps/api   The API: Node, Hono, Drizzle, Postgres.
  migrations/   The database, as SQL files applied in name order on start.
  src/db/       Opening the database, the tables as the code sees them, the migrator.
  src/auth/     Passwords (scrypt) and sessions (a cookie; only the token's hash is stored).
  src/people/   Roles.
  src/inventory/ Medicines, prices, stock by warehouse and batch: rules.ts (no database),
                service.ts (reads and writes), routes.ts (addresses and who may), seed.ts.
  src/purchases/ Suppliers and purchases from abroad; landed.ts works out what a batch cost
                to land (shared with the web app's purchase form).
  src/customers/ Hospitals, doctors, patients and business buyers: who sees which, the
                old-customer check, adding from the field, Management's review.
  src/overview/ Home's figures, the stock ledger as lists (adjustments, transfers, receives)
                and the top bar's search.
  src/http.ts   What every route shares: the refusal, reading a body, who is asking, who may.
  src/app.ts    Sign-in routes, and where each area's routes are added.
  src/types.ts  What the API sends and takes; the web app imports these types.
apps/web   The web app: React, Vite, Tailwind. Screens only.
  src/menus.ts  Each role's menu.
  src/shell.tsx The frame: top bar, menu (a tab bar on a phone).
  src/ui.tsx    The pieces every screen uses, and how money and days are written.
  src/pages/    The screens.
  src/inventory/ Inventory's forms (dialogs) and the stock news list.
  src/customers/ The add / edit customer form.
```

## Run it

```bash
pnpm install
```

```bash
SEED_DEMO=1 SEED_PASSWORD=<your choice> pnpm dev:api
```

```bash
pnpm dev:web
```

The API listens on http://localhost:4100 and the web app on http://localhost:5180. With no
`DATABASE_URL` the database is an embedded Postgres in `.data/pg` (delete that folder to start
again). `SEED_DEMO=1` makes one demo person per role the first time: naresh (CEO), admin, sarla
(Management), fiona (Finance), marco (Dispatch), irene (Inventory), vanessa (Manager), daniel (Team lead), ryan
(MedRep), jane (Online desk), each `<name>@2mg.test` with the password you gave. In the Claude
desktop app the same two servers are `new-api` and `new-web` in `../.claude/launch.json`.

## Check it

```bash
pnpm test
```

```bash
pnpm typecheck
```

## Rules for anyone building here

- One API call per screen, about 15 database queries at most. Every response reports its time
  and query count in the `Server-Timing` header.
- Every rule lives in the API and has a test; a screen hiding a button is never the only guard.
- A schema change is a new SQL file in `apps/api/migrations` plus the matching lines in
  `src/db/schema.ts`. Never edit a migration that has been applied anywhere.
- Money is whole centavos. Days are Manila days.
- A refusal says what is wrong in plain words and names the field.
