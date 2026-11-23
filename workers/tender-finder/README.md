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
npm ci                               # downloads Puppeteer's Chrome (about 300 MB)
npm run find                         # one run
node scraper.js --dry-run            # first page only, nothing sent, prints what matched
node scraper.js --from-file=sample-notices.json   # no browser: hands a saved list to the CRM
npm test                             # the line and date readings (no browser, no CRM)
```

## Not here yet

- The tender papers (PDF, Word, Excel, scans by OCR): they need the company's PhilGEPS log-in.
  The CRM's door already takes their lines (`details.documents_items`).
- PS-PhilGEPS (the new portal: Bid Match, My Opportunities, Award Notices): it needs the merchant
  log-in and a person to tick its captcha. The CRM already takes its notices (`source: "ps"`).

## State (23 Nov 2026)

`--from-file` was run against a local CRM and the notices arrived. The first browser run is the
workflow's own, on GitHub, watched from its log (see docs/PLAN.md, change log 174).
