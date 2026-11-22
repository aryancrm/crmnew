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

## What happened to each finding (22 Nov)

Fixed and committed (tests green, not yet tried by hand except the Approve block):

| Finding | Fix |
|---|---|
| Approve ignored the check ticks | Approve is refused until Documents and every flagged check is approved |
| An Admin's own order skipped Management | Every order waits for Management |
| Editing an order that was ever packed failed | Migration 0131 |
| A payment proof lifted Management's hold | Lifts Finance's own hold only |
| A shipped order could be cancelled through Exception | Refused while the parcel is on the road |
| Checks stayed ticked when an order came back to Management (resume, restore) | Cleared, as after a take-back |
| Finance's undo wiped every payment and sent a credit order to the wrong step | Takes off only the money of that check; a credit or COD order goes back to its own step |
| The PAP head was never told of a new order | Told once per order |
| A website prescription or enquiry could land on a PAP case | Joins an Online desk case only |
| The Online channel's MedRep couldn't own a case | Can |
| "Seen" marked any desk's chat | Online desk chats only |
| Stock bought on a bill was counted as cost twice | Migration 0132: a medicine's bill line goes to Inventory Asset |
| Past cost of goods moved when a batch's cost changed | Migration 0133: each move keeps its cost; later changes post on their own day |
| Period locks didn't cover CRM money | A payment or refund in a locked period is refused |
| A customer's credit could be used twice | The CRM invoices' use is counted |
| A reconciled CRM payment could be taken off or moved | Refused until the reconciliation is undone |
| Finance board failed above ₱21.47M a month; the API accepted amounts the database can't hold | Sums widened; a plain "too large" above the limit |
| The stock desk could read customers' invoices and payments through the Books lists | Refused |
| A return restocked, then not credited, could be returned again | Counted as returned |
| Unpack or a restocked return didn't wake orders waiting for stock | They are told |
| Batch trace showed cost to Dispatch and Regulatory | Cost roles only |
| A sample acknowledgement could be any file type | Photo or PDF only |
| Desk report "Rejected" counted cancellations | Named "Cancelled" |

Looked at and left as it is, with why:

| Finding | Why left |
|---|---|
| Desk actions recorded in the order owner's name | Aryan's rule of 19 Nov |
| Credit limit and "owed before" only flagged | Aryan, 22 Nov: flag, never block |
| A stock count needs no approval | Aryan, 22 Nov |
| A question to a lead can't be asked twice until answered | A sensible rule, not a fault |
| `GET /api/website-order` has no role check | Gives two numbers only; each page checks who may open it |
| Returned pieces go back into one batch | A return line holds one batch; splitting needs a new table |
| Website order webhook has no timestamp | The websites would have to send one first |
| Points passwords of 4 characters | Marked in the code as the owner's choice |

Still open (not built, each is new work rather than a fault):

- No rate limit on addresses that need no sign-in.
- The Leads screen loads every case on each refresh; every save re-shares the desks' orders (speed, at volume).
- The chart of accounts is not made on an empty database (the own server needs the live data copied in first).
- Amount columns are 32-bit: one invoice above about ₱21.4M cannot be stored.
- "Customers owe", "collected" and "sales" are worked out differently on different pages (finance file, section 8.8).
- Two buying systems side by side; warehouses can't be added in the app; no history on purchase edits.
- No reminder for a CPR running out or a complaint's due day; no notice of a new online enquiry.
- Held emails, website calls and quotation links are never cleaned up.
- Never read: sales channels and field, sign-in and roles, customers and KPIs, scripts and deployment.
