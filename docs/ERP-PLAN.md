# crmnew as the company's ERP: the plan (18 Nov 2026)

Aryan, 18 Nov: turn crmnew into one system that runs the whole company, as SAP, Odoo, Salesforce
and Dynamics do, without copying them and without breaking what works. This is the plan; nothing
here is built until Aryan picks a phase. Business rules stay his: every open choice is a question
at the end, never a guess.

## 1. Where crmnew stands today

crmnew is already most of an ERP for a medicine importer and distributor. 46 API areas, 84 screens,
95 migrations, 378 tests, one database, one login, role-based screens.

| ERP area | What runs today | State |
|---|---|---|
| Sales & CRM | Customers (one per phone and kind), areas, the order line MedRep → Management → Finance → Dispatch, price book and offers, asks up, NBD/CRR, online leads, inbox (Messenger, mail, websites), tenders, CLIDP, Modern Trade | Strong |
| Inventory & warehouse | Medicines, batches with expiry, 10 warehouses, picks by batch, transfers, counts, cold chain, stock news | Strong |
| Purchasing | Suppliers, POs, receives, bills, vendor payments and credits, landed cost (Zoho's moved in) | Built, needs one ledger |
| Finance | Invoices (two companies' series), payments, 2307, refunds, credit, returns, Customers owe, collections | Strong |
| Accounting | Chart of accounts, Zoho Books' journals, banking, expenses (moved in) | **Gap: crmnew's own money is not posted to the ledger; no P&L, balance sheet, cash flow** |
| HR & payroll | People, joining, attendance, leave, forms, payroll and payslips, back at work | Built |
| Field | Visits, month plan, clinic pin, fares, field expenses, field report | Built; samples and rep stock missing |
| Management | Org chart, seats, covers, targets, scorecards, team switch, tree, map, data checks (17) | Strong |
| Reports | By channel, by person, tree, map, owed, CEO Home | **Thin: 4 reports, no CSV, no trends, no profit** (the old CRM had 33) |
| Regulatory | Licences, registrations, regulatory desk | Built |
| Platform | Roles fixed per seat, order/lead/tender/reg event logs, files through one store, notifications, toast | Partial: no one audit screen, no approvals inbox, no CSV import, no automations |

Full list of what the old CRM had and crmnew doesn't: [OLD-CRM-GAPS.md](OLD-CRM-GAPS.md).

## 2. The shape: one system, not a box of apps

What the big ones teach, and what we take:

- **One record, many views** (Salesforce, Dynamics): a customer, order, medicine or person is one
  page with tabs (money, orders, stock, files, history). crmnew's `record.tsx` already does this;
  make every record use it.
- **Every document moves the books** (SAP, Odoo): an invoice, payment, receive, return or payroll
  run posts its journal by itself. Nobody types a journal for daily work.
- **A home per role** (all of them): each person opens on what they must do today, then figures.
  crmnew has this; keep it.
- **One inbox for decisions** (SAP Fiori "My Inbox", Odoo Activities): every approval waiting on
  me, with counts by kind, and what I asked for.
- **Simple over powerful** (where we beat SAP): the hub's plain look, few clicks, no setup screens
  a pharmacy doesn't need. Aryan's rule: simple like the hub, nothing removed.

**Navigation** (keeps today's sidebar and menus-as-data):

```
Home (role's own)          Inbox (decisions + messages)          Search (anything, ⌘K)
Sell        customers · orders · offers · tenders · online · field
Stock       medicines · warehouses · transfers · counts · purchases · suppliers
Money       invoices · payments · owed · bills · banking · expenses · ledger
People      chart · team · targets · scores · HR · payroll
Reports     company tree · map · sales · profit · money · stock · people · statements
Admin       seats & logins · settings · data checks · audit · imports
```

A person sees only the parts their seat opens, as now.

## 3. Dashboards

- **CEO**: sales vs target with pace, **gross profit and margin**, cash in bank, owed (aging, DSO),
  we owe, stock value and expiring, orders stuck, people at work. Each tile opens its report.
- **Head / lead**: their branch only (the team switch), the tree, the map, stuck orders, who is
  behind, collections.
- **Finance**: today's money in and out, payments to confirm, owed by age, bills due, bank balances.
- **Inventory / Dispatch**: to pack, on the road, low and expiring stock, receives due.
- **HR**: at work today, leave, forms, payroll due.

Every figure is one query with one meaning, the same on every page (Home's sales = the sum of the
channels; today ₱5.4M of Zoho's history isn't on any seat yet, see question 2).

## 4. How the modules join (the flows)

| Flow | Today | To add |
|---|---|---|
| Order → stock → invoice → delivery → payment | Built end to end | **Post to the ledger** (sales, VAT, COGS, AR, bank) |
| Return → stock back → credit / refund | Built | Ledger posting |
| PO → receive (batch, cost) → bill → pay | Built (Zoho's data) | crmnew's own POs post to the ledger; landed cost into COGS |
| Transfer between warehouses | Built | Stock in transit value |
| Payroll → payslips | Built | Payroll journal, bank payout file |
| Field expense → approval → pay | Built | Expense journal |
| Tender → award → orders | Built | Tender profit report |

## 5. Enterprise features

| Feature | Today | Plan |
|---|---|---|
| Roles and access | 13 roles, checked on every API call; seat decides screens | Keep. Per-seat extras ("who approves what") exist. Custom permission screens only if Aryan wants (question 4) |
| Audit | Event logs per order, lead, tender, regulatory, books | One **Audit** screen: who changed what, when, before → after, for every record |
| Approvals | Order steps, asks up, leave, forms, expenses | One **Inbox** with all of them |
| Notifications | In-app, toast, messages | Email / SMS digest per person (choose) |
| Documents | One file store (smaller photos, bucket) | A **Files** tab on every record; expiring licences warned |
| Multi-company | 2MG Inc. and GetMeds Philippines Inc. invoice series | Books per company, consolidated reports |
| Multi-branch | Warehouses (Main, Cebu, Davao…) | Branch on documents and reports |
| Reports | 4 screens | **Report engine**: period, chart, table, CSV, compare to before, scheduled email |
| Imports | Scripts | CSV import screen with dry run |
| Automation | Timers (scores, org) | Simple rules: "when X, notify / create Y" |

## 6. Architecture and scale

- Keep: Hono + Zod + Drizzle API, React web, Postgres, hand-written migrations, tests beside code.
  It is a sound base; no rewrite.
- **Hosting**: Supabase free (500 MB) can't hold the history (Zoho Books alone is ~1.6 GB). Move to
  the company's own server or a paid Postgres before the full data goes live.
- Heavy pages (the team board makes ~300 queries) get batched queries; reports read summary
  tables refreshed nightly.
- Background jobs (emails, reports, imports) on a queue, not in the request.
- Daily backups with a restore test; read replica for reports when needed.
- A `company_id` on every money and stock document for clean multi-company books.

## 7. The order to build (each phase: built, tested, walked in each seat's own login)

| Phase | What | Why first |
|---|---|---|
| **0. Go live** | Customers on live (on Aryan's word), own server, backups | Nothing else is real until this |
| **1. Money core** | Every crmnew document posts to the ledger; bank on each payment; **P&L, balance sheet, trial balance, cash flow, GL, VAT, AR/AP aging**; **gross profit and margin** on Home, by medicine, order and channel; company DSO | Zoho closes only when the books close here |
| **2. Command centre** | One **Inbox** for approvals; **report engine** (CSV, trends, compare, scheduled email); the old CRM's 33 reports brought back; one **Audit** screen | The CEO and heads run the company from here |
| **3. Field and stock control** | Rep stock and samples, batch recall, near-expiry returns, rebates (after the lawyer) | Stock leaving with reps is not controlled today |
| **4. Platform** | Files tab everywhere, CSV import screen, simple automations, per-branch reports, notifications by mail/SMS | Fewer scripts, less hand work |
| **5. Only if the business needs it** | Repacking / manufacturing, projects, fixed assets, support tickets and complaints, pharmacovigilance | Ask first; don't build what nobody uses |

## 7.1 Phase 1, as built (18 Nov 2026)

- **Every CRM document posts itself** (migration 0096, view `crm_entry` inside `book_entry`):
  invoice → Accounts Receivable / Sales / Shipping Charge / Tax Payable; payment → the bank Finance
  picks (Undeposited Funds if none) / AR, 2307 → Advance Tax, points → Discount, customer credit →
  nothing (already off AR); refund → AR / the bank (Petty Cash if none); return credited → Sales and
  VAT back / AR on the day credited; stock out → Cost of Goods Sold / Inventory Asset at the batch's
  cost (back from a return the other way; a count's difference on COGS, Zoho's default). Same
  accounts Zoho used; Zoho kept both companies in one set of books, so this does too.
- **Bank on each payment and refund**: "Into account" / "Out of account" on Confirm payment, Record
  payment and Money owed back (the books' bank, cash and e-wallet accounts, remembered per way of
  paying); Finance can move a payment to the right account later (`/api/payments/:id/account`).
- **Books → Reports**: Profit and Loss (with the days before), Balance Sheet, Cash Flow, Gross
  Profit (by medicine, channel, customer, order), Payables Aging, VAT Summary, Trial Balance; each
  with Print and Export CSV; every account opens its transactions; CRM entries open their invoice
  or order.
- **CEO Home**: gross profit and margin this month (CRM orders whose goods left), company DSO.
- Checked on the real local data: trial balance off by 3 centavos (Zoho's own currency rounding);
  P&L says Zoho's invoices carry no cost of goods yet (Zoho's Account Transactions file brings it).
- Open for Aryan: points paid on an order are posted to **Discount** — say if another account.

## 7.2 Phases 2–4, as built (18 Nov 2026, all local until everything is done)

- **To decide** (Messages → To decide, with a count): every decision waiting on the person, read
  from each desk's own list (orders to approve / confirm / invoice / pack / ship, held, refunds,
  medicine requests, leave, forms, field expenses, visit plans, returns to decide / check in /
  credit, asks up, asks for people, samples to approve / issue / receive), and what they asked
  others for. Same rules as each desk, so the numbers match the pages.
- **Audit** (CEO and Admin; Company → Audit, Admin panel → Audit): who did what, when — order
  steps, cases, tenders, registrations, stock moves, payments, refunds, seat changes, Zoho's log.
- **Reports** (Books → Reports and More reports on the CRM's Reports page, each for its desks):
  sales by channel month by month, top medicines vs before, ABC classes, senior/PWD sales, stock
  by age and expiry, days of stock left, purchases by supplier / item, online cases by source /
  person; Print and Export CSV on all.
- **Batch trace** (Inventory → Batch trace): for a recall, a batch's customers with phone and
  address, every move; print or CSV.
- **Samples and gifts** (the old CRM's rules, migration 0097): ask → lead approves → stock desk
  issues (unexpired, expiring first; pieces leave company stock) → rep marks received → given to a
  doctor at a visit with the signed acknowledgement → monthly count with reasons. My samples &
  gifts, Team samples & gifts, Give on a doctor's visit; Inventory can mark a medicine "never a
  sample". Not copied: selling from the rep's bag (crmnew's rule: Dispatch delivers).
- **Import customers from a sheet** (Management, Admin): checked row by row as if typed, then kept.
- **Files on the customer page**: their papers, their orders' papers, cases' files, sample
  acknowledgements.

Waiting on Aryan before building (nothing guessed):
- Samples issued leave the stock but post nothing to the books yet: which expense account
  (e.g. "Samples and Promotions")?
- Selling from a rep's bag (the old CRM had it): wanted, given Dispatch delivers in crmnew?
- Automations ("when X, notify / do Y"): which ones?
- Report emails and notifications by mail/SMS: who gets what, and which mail/SMS service?
- Branches: is a branch a warehouse (Main, Cebu, Davao), or something else?
- Modern Trade near-expiry returns and deductions; doctor rebates (after the lawyer).
- Phase 5 modules: repacking/manufacturing, projects, fixed assets, a complaints desk.

## 8. Questions for Aryan (nothing assumed)

1. Which phase first? (Suggested: 0, then 1.)
2. The untied Zoho history (₱5.4M in November, mostly RX): which seats does it belong to?
3. Own server: where, and when? Until then live stays small.
4. Roles: keep fixed per seat (simple, as now), or a screen to edit permissions?
5. Do you repack or make anything (manufacturing), run projects, or track company assets?
6. Customer complaints and adverse events: a ticket desk in crmnew?
7. Report emails: who gets which, how often?
