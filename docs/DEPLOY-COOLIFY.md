# The CRM on Coolify (bishnoi-one server)

Three resources in one Coolify project, all on the same server (so all on Coolify's `coolify`
Docker network):

| Resource | Kind | Port inside | Public? | Reached as |
|---|---|---|---|---|
| `crmnew-db` | PostgreSQL 17 (Coolify database) | 5432 | No | Coolify's "Postgres URL (internal)" |
| `crmnew-api` | Application, Dockerfile, `apps/api/Dockerfile` | **4100** | No (no domain) | `http://crmnew-api:4100` |
| `crmnew-web` | Application, Dockerfile, `apps/web/Dockerfile` | **80** | Yes: `https://crm.<domain>` | the browser, Meta, the websites |

The browser only talks to the web app. Its nginx passes `/api/*` and `/webhooks/*` to the API
over the internal network, so the sign-in cookie stays first-party (Vercel's rewrites do the
same today). The API needs no domain of its own.

## 1. Database: `crmnew-db`

1. Project → **+ New** → **Database** → **PostgreSQL** (17). Name it `crmnew-db`.
2. Leave **Make it publicly available** off.
3. Start it. Copy **Postgres URL (internal)**. That is the API's `DATABASE_URL`.
4. Turn on **Backups**: daily, kept 14 days, to S3 if the server has a bucket.

## 2. API: `crmnew-api`

1. **+ New** → **Application** → the GitHub repository (GitHub App or deploy key), branch `main`.
2. **Build pack:** Dockerfile.
   - **Base Directory:** `/` (the repository root: pnpm needs the workspace and the lockfile).
   - **Dockerfile Location:** `/apps/api/Dockerfile`.
3. **General:**
   - **Domains:** leave empty. The API is not published.
   - **Ports Exposes:** `4100`. **Ports Mappings:** empty.
4. **Advanced:**
   - **Custom container name:** `crmnew-api`. This keeps the name the same on every deploy, so the
     web app can find the API. Coolify then can't do rolling updates, so the API is down for
     a few seconds on each deploy.
   - **Custom Docker Options:** `--init` (Node then stops cleanly on redeploy).
   - **Watch paths** (optional, deploy only when these change): `apps/api/**`, `pnpm-lock.yaml`.
5. **Health check:** leave Coolify's off. The image has its own (`/api/health`, every 30 s). It
   has no curl or wget, so Coolify's own check would fail.
6. **Environment Variables:** every line of `apps/api/.env.production.example`, filled in.
   Each one should be **runtime only** ("Not available during build"). Most important:
   - `DATABASE_URL` = step 1's internal URL.
   - `WEB_URL` = `https://crm.<domain>` (the web app's domain from step 3).
   - `SECRETS_KEY` = the same value as on Render, if the live data moves over. Two-step sign-in seals
     its keys with it: without it nobody can turn it on; changed or lost, each who had it on must be
     reset (`pnpm --filter @2mg/api two-step-off --only=<login> --apply`, or the Admin on screen).
   - `JOIN_PASSWORD` is retired: it signs nobody in. Left set, its value is only refused as
     anyone's own password.
7. Deploy. The log shows `database: applied …` (the migrations), then
   `api: listening on http://localhost:4100`.

Run **one** API container only: the channel reading (Messenger, mailboxes) is not shared between
instances yet.

## 3. Web: `crmnew-web`

1. **+ New** → **Application** → the same repository, branch `main`.
2. **Build pack:** Dockerfile.
   - **Base Directory:** `/`.
   - **Dockerfile Location:** `/apps/web/Dockerfile`.
3. **General:**
   - **Domains:** `https://crm.<domain>` (Coolify's Traefik gets the Let's Encrypt certificate).
   - **Ports Exposes:** `80`.
4. **Environment Variables:** `API_UPSTREAM=http://crmnew-api:4100`, runtime only
   (`apps/web/.env.production.example`).
5. **Health check** (optional): path `/`, port `80`. The nginx image has wget.
6. **Watch paths** (optional): `apps/web/**`, `apps/api/src/**` (the web app reads the API's
   types), `pnpm-lock.yaml`.
7. Deploy. Open `https://crm.<domain>/api/health`. It should answer `{"ok":true}`. That reply
   has gone browser → web → API.

## 4. DNS and outside services

- DNS: an `A` record `crm.<domain>` → the server's IP. Before step 3's deploy, so the certificate
  is issued.
- Meta webhook: `https://crm.<domain>/webhooks/messenger` with `MESSENGER_VERIFY_TOKEN`.
- The websites' order webhook: `https://crm.<domain>/webhooks/store/2mg`.
- Mail (SMTP/IMAP for the connected mailboxes): the server must allow outgoing 465/587/993.
  Some hosts block them.

## 5. Checks after the first deploy

- Migration 0133 signs out everyone who was there before it, and none of them can sign in until
  given a one-time password. In the API's container, before telling anyone:
  `pnpm --filter @2mg/api passwords --role=admin --apply` (one Admin: shown on the screen), then
  the rest from Admin panel → Teams & people, or `--all --apply --out=<a file outside the repository>`.
- Sign in with that one-time password: it asks for a password of your own first.
- Admin panel → **Online pages & mail**: connect a mailbox, then accept a test sign-up. Acceptance
  emails go from the first connected mailbox; their link is built from `WEB_URL`.
- Admin panel → **Data checks**: all green.
- Upload a photo on an order. It should open again, so the bucket settings are right.
- Coolify → `crmnew-api` → Logs: no `couldn't` lines from automations, org or channels.

## If the web app says 502 on `/api`

- The API isn't running, or its container name isn't `crmnew-api`. On the server,
  `docker ps --format '{{.Names}}'` should list `crmnew-api`.
- Both must be on the `coolify` network: `docker network inspect coolify` lists both
  containers. Two resources on different Coolify servers or destinations can't see each other.
- After fixing, nothing needs a restart: nginx looks the name up again every 30 s.
