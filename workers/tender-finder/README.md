# The tender finder's robot

The part of the tender finder that cannot live inside the CRM's web app: a browser (Chrome, driven
by Puppeteer) that reads PhilGEPS by itself. Everything a person sees is in the CRM
(**Tenders → Tender finder**); this worker only finds and hands in. The plan is
`docs/PLAN.md` section 24.

It comes from the bidding team's own tender finder
(`github.com/kenshiiir0/Hospital-Bidding-System`). The reading of PhilGEPS (`scraper.js`,
`parse.js`, `schedule.js`) is that code unchanged; what changed is where things go: nothing is
written to Supabase, the CRM keeps it.

## What a run does

1. Asks the CRM which molecules are ours (the CRM's active medicines with a generic name).
2. Opens the public PhilGEPS list of open "Drugs and Medicines" tenders (no log-in).
3. Asks the CRM which of them it has already read, and opens the notice page of the others only.
4. Keeps the item lines that ask for our molecules, the pre-bid and opening as written, and the
   list of bid bulletins of the tenders that are ours.
5. Hands every tender in to the CRM, then tells the CRM how the run went (shown as **Robot** on
   the Tender finder page).

## Where it runs

**On GitHub's computers** (`.github/workflows/tender-finder.yml`): every hour from 6 am to 5 pm
Manila, and once whenever this folder changes. No office PC has to stay on and no server has to
carry a browser. Nothing is set anywhere: GitHub signs a short-lived token for that workflow and
the CRM's door lets in only that workflow on this repository's main branch
(`apps/api/src/tenders/robot-caller.ts`). The run's log is under the repository's **Actions** tab;
its result is the **Robot** line on the Tender finder page.

It can also run on any computer with Chrome and Node 20 or newer (the company's own server, the
office PC), with a key in place of GitHub's token:

| Setting | What |
|---|---|
| `CRM_URL` | The CRM's API address |
| `TENDER_FINDER_KEY` | Any long random text (24 characters or more), the same value set on the CRM's API server |

```
npm ci                               # Puppeteer (its Chrome: npx puppeteer browsers install chrome) and the paper reader
npm run find                         # one run
node scraper.js --dry-run            # first page only, nothing sent, prints what matched
node scraper.js --from-file=sample-notices.json   # no browser: hands a saved list to the CRM
npm test                             # every check: readings, matching, the papers run against stand-ins
```

## The tender papers (`papers/`)

After the public reading, the same run gets the papers of the notices the team **screened** in
the CRM (PLAN 24, "The papers' rules"): it logs in to PhilGEPS with the company's account, orders
each notice's bid documents at no cost (it stops at anything that asks a payment), downloads them
and their bid bulletins, logs out, reads them (PDF, Word, Excel; scans by OCR) and hands the
files and the lines to the CRM.

- `papers/lib/`: the bidding team's own modules, **unchanged**. Do not edit them here; a newer
  copy from their repository replaces them whole.
- `papers/supabase-shim/`: what those modules get when they import `@supabase/supabase-js` (it is
  installed under that name from this folder): their tables and files are the CRM's.
- `papers/papers.mjs`: one run.
- `papers/checks/`: their three checks (run by `npm test`), and a stand-in PhilGEPS for this
  computer (`stand-in-philgeps.mjs`), which `papers.test.mjs` runs the whole thing against.

The log-in is two **repository secrets** on GitHub (Settings → Secrets and variables → Actions →
New repository secret), typed by whoever holds the account, never written in a file:
`PHILGEPS_USERNAME` and `PHILGEPS_PASSWORD`. With none set the step logs in nowhere. If PhilGEPS
refuses the password, the robot stops trying and the Tender finder page says so; once the secret
is put right, someone presses *let it try again* there.

To try it on this computer without the real PhilGEPS:

```
node papers/checks/stand-in-philgeps.mjs papers/checks/price-schedule.pdf   # prints its address
PHILGEPS_TEST_HOST=http://127.0.0.1:<port> PHILGEPS_USERNAME=company PHILGEPS_PASSWORD=right-password \
  CRM_URL=http://localhost:4100 TENDER_FINDER_KEY=<the local key> node papers/papers.mjs
```

## Not here yet

- PS-PhilGEPS (the new portal: Bid Match, My Opportunities, Award Notices): it needs the merchant
  log-in and a person to tick its captcha. The CRM already takes its notices (`source: "ps"`).

## State (23 Nov 2026)

Live. The first real run was the workflow's own, on GitHub (docs/PLAN.md, change log 175): 93
open tenders read from PhilGEPS and kept in the CRM, 21 of them asking for our medicines, in 80
seconds. `--from-file` was run against a local CRM before that.
