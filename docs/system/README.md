# System audit, 22 Nov 2026 (partial)

Read-only audit of crmnew. Nothing in the software was changed. Stopped early to save cost.

## What was covered

| Area | File | State |
|---|---|---|
| Order line, desks, checks | [areas/01-orders.md](areas/01-orders.md) | complete |
| Online desk, Messenger, mail, websites, points | [areas/02-online.md](areas/02-online.md) | complete |
| Finance, Books, Zoho history | [areas/03-finance-books.md](areas/03-finance-books.md) | complete |
| Stock, buying, dispatch, returns, samples, complaints, regulatory | [areas/04-stock-buying-dispatch.md](areas/04-stock-buying-dispatch.md) | complete |
| HR, team leads | [areas/07-hr-team.md](areas/07-hr-team.md) | cut off, unfinished |
| Database | [10-database.md](10-database.md) | cut off, unfinished |

Not covered: sales channels and field, sign-in / roles / company tree / admin, customers / KPIs / the
report inventory, scripts and deployment.

## What was run

- API tests: 100 files, 494 tests, all pass. Typecheck clean.
- On a separate demo database, every menu screen opened without a failed call for: CEO, Admin,
  Management, Finance, Dispatch, Inventory, HR, Online desk lead, Head, Team lead, Hospital MedRep.
  Other seats were not opened. No order was pushed through the line by hand.

## Problems, checked against the code by a second read

| # | Problem | Where |
|---|---|---|
| 1 | Approve never looks at Management's or Finance's check ticks: an order can be approved with none ticked | `orders/service.ts:2215` |
| 2 | Revising an order that was ever packed deletes its lines while packing records still point at them: the database will refuse (not run) | `orders/service.ts:2671`, migration 0013 |
| 3 | A payment proof lifts any hold at the Finance step, Management's too | `orders/service.ts:3053` |
| 4 | On the desks, an action on a colleague's order is recorded in the colleague's name, for personal logins too | `desks/service.ts:244` |
| 5 | Exception is allowed on a shipped order (reader: it can then be cancelled and the stock returns to the shelf; second half not checked) | `orders/rules.ts:181` |
| 6 | A website prescription or enquiry joins the customer's newest open case on any desk, so it can land on a PAP case the Online desk cannot open | `online/websites.ts:1004` |
| 7 | The Online channel's MedRep can work cases but cannot own one: their new leads stay unassigned | `online/service.ts:300` |
| 8 | "Mark as seen" on a chat checks the role only, not the desk or owner | `online/inbox.ts:159` |

## Problems reported by the readers, not yet checked a second time

Money:
- A bill line with no account posts to Cost of Goods Sold, and delivery posts cost again: stock bought through a purchase order is counted twice unless "Inventory Asset" is typed on each line.
- Past cost of goods moves when a batch's cost changes later; closed months can change.
- The chart of accounts is not made by any migration; an empty database (the own server) has no accounts for the payment forms.
- Period locks do not cover the CRM's own invoices, payments, refunds or stock.
- A customer's credit can be used twice (once on a Zoho invoice, once on a CRM invoice).
- Amounts are 32-bit: the Finance board fails in a month above about ₱21.47M.
- Credit limit and "owed before" are shown, never enforced.
- "Customers owe", "collected" and "sales" are worked out differently on different pages (finance file, section 8.8).

Stock and dispatch:
- A return restocked by Dispatch and then refused by Management can be returned and restocked again.
- Batch trace shows landed cost to Dispatch and Regulatory.
- The sample acknowledgement upload has no file-type check.
- Returned pieces all go into one batch even if packed from several.
- A stock count can set any number with a typed reason, no approval; damaged returns write no stock line.
- Two buying systems exist (first pages and the Books' purchases); warehouses cannot be added or closed in the app.
- Nothing reminds anyone of a CPR running out or a complaint's due day.

Orders and desks:
- An Admin's own order skips Management.
- Nobody is told of a new order until a desk person has pressed Start; the PAP head never is.
- Stock put back by unpack or a return does not wake orders waiting for stock.
- The desk report counts cancellations as "Rejected" and rejects as "Held".
- Every successful save anywhere re-shares the desks' waiting orders.

Online:
- No rate limit on any address, including those needing no sign-in.
- The Leads screen loads every case on each refresh (every 60 seconds).
- `GET /api/website-order` has no role check.
- Held emails, website calls and quotation links are never cleaned up.
