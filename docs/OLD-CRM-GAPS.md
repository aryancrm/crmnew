# What the old CRM had that crmnew doesn't yet (18 Nov 2026)

Aryan, 17 Nov night: the old CRM's company tree and territory map had never come into crmnew
("tune hataye hi kyu"). They are back (`/company/sales`, `/company/map`, PLAN change log 98).
This is the check of every other page of the old CRM (`~/Projects/crm/frontend/app`, 97 pages;
88 counted after leaving out sign-in and system pages): **56 fully in crmnew, 20 partly, 12
missing.** Read only; nothing built yet. Each needs Aryan's word before it is built.

## Missing or partial

| Old page | What it did | In crmnew |
|---|---|---|
| `/` CEO Home | Month figures and 8 boxes, Insights among them | Partial: no gross profit / margin %, company DSO, approvals waiting, visit plans waiting, tenders figure |
| `/ceo/money` | Owed by age, DSO, RX doctors overdue, gates, supplier bills | Partial: no company DSO (only per seller), RX doctors overdue, supplier bills overdue |
| `/ceo/field` | Field today, month rep by rep, slipping, samples, expenses | Partial: no samples and gifts given, no uncounted sample stock |
| `/calendar` | Sales calendar: daily revenue, visits, cost of goods, gross profit, margin | Partial: day-by-day sales only; no profit, cost, margin, per-medicine profit, no calendar grid |
| `/revenue` | Delivered orders: gross, discounts, points, est. profit, received, balance; filters; CSV | Partial: invoice list only |
| `/finance` | Sales sheet, Who pays, Receivables / Payables by age, Cash flow, Income & expense, Top expenses, Bank | Partial: no Cash flow, Income & expense, Top expenses, Payables by age, Who pays |
| `/reports` | 33 reports, each with chart, table, CSV | Partial: 4 here. Missing P&L, Balance sheet, Trial balance, Cash flow, General ledger, VAT summary, Senior/PWD discounts, Payables ageing, Order profitability, Inventory ageing/turnover, FIFO lots, Purchases by vendor/item, ABC, Source conversion, Leads by person, Sales by channel over 6 months, Top medicines vs before, Assistance claims |
| `/r/[key]` | One report: period, chart, table, CSV, scheduled email | Partial: no CSV (but payroll), no scheduled emails, no month-on-month trends |
| `/field/kpis/scorecards` | Edit scorecard weights, bands, caps, who gets which card | Partial: cards read only; rules in code |
| `/field/stock` | Each rep's stock and samples, given per doctor, count differences | Missing |
| `/my/stock` | Goods a rep carries, coming to them, monthly count | Missing |
| `/my/samples` | Rep's samples and gifts, receive, monthly reconcile | Missing (PLAN lists it) |
| `/field/rebates` | Doctor / hospital rebates earned, approved, paid | Missing (PLAN: lawyer first) |
| `/field/review` | RX weekly strategic report, monthly self-assessment | Missing |
| `/crm/team` | Leads per person, where each stands, how many became orders | Missing |
| `/flow` | The whole business as one chart with live counts | Missing |
| `/approvals` | One inbox of every decision waiting, and "what I asked for" | Partial: Messages → Needs you is a notice list |
| `/my/stuck` | A lead's one page: stuck orders, unclosed visits, class A not seen, overdue | Partial: pieces on separate pages |
| `/exceptions` | Failed syncs, stuck points, unmatched website items, cases waiting on papers | Partial: Data checks, retry per order |
| `/activities` | My to-dos (overdue, today, later), snooze, refills | Partial: refills only |
| `/assistance` | GL tracker per patient: agency, letter expected, days waiting, amount, papers | Partial: on the lead page, no tracker table |
| `/accounts/[kind]/[id]` | Hospital / doctor page with visits by rep, tenders, referred patients | Partial: none of those three |
| `/pharmacy` | Pharmacist's Rx queue | Missing (Management checks Rx at approval) |
| `/statement/[id]` | Statement print or email as PDF | Partial: print only |
| `/m/[model]/import` | Import a CSV into any list | Missing (scripts only) |
| `/settings/replies` | Saved inbox replies | Missing |
| `/settings/messenger` | Messenger and auto-reply | Partial: no auto-reply |
| `/settings/crm` | Fares, visit rules per class, calls a day | Partial: visit rules in code |
| `/settings/store` | Delivery partners, points, website | Partial: couriers fixed in code |
| `/settings/fields`, `/settings/roles` | Custom fields, role permissions | Missing (roles fixed by design) |

## First five, by use to the CEO and heads

1. Gross profit and margin (Home, by medicine, order, channel): landed cost is already kept.
2. Accounting reports: P&L, Balance sheet, Cash flow, Payables ageing, VAT; Income & expense, Top expenses.
3. CSV export on every report, trends over months, scheduled report emails.
4. Lead conversion by person and by source.
5. Reps' stock and samples.

Cheap: company DSO on the money view (the per-seller formula exists).
