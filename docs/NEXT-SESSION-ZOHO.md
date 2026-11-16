# Next session: bring Zoho's data into the new CRM (written 16 Nov 2026)

Talk to Aryan in short Hinglish. Free plans only. One step at a time; show settings before
creating anything. Never type or repeat his passwords/tokens. Never delete ~/Projects/crm.
crmnew commits are authored as aryancrm (already set in this repo's git config) and end with
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Push to `origin` (aryancrm/crmnew);
Render (crmnew-api) and Vercel (crmnew-psi.vercel.app) deploy from it.

## Done on 16 Nov (afternoon) and what is next

Built and tested locally, not pushed (see docs/PLAN.md 12.18): `past_order` / `past_order_item` /
`zoho_contact` (migration 0054); Admin-only `POST /api/admin/import/zoho-customers` and
`/zoho-orders` (`src/zoho/import.ts`); the price history under every order line, the customer
box on Management's price step, Prices given and Zoho's orders on the customer's page.
Aryan (16 Nov): **medicines later** (our list is not Zoho's 3,588 items); customers, hospitals
and old prices now. A past line keeps the name and Zoho's SKU as text and joins a medicine by
SKU when it is listed.

Getting the data out: the page-API route below does not work from here (the in-app browser
blocks a web page from reaching this computer, and the item-wise order list hides the free
line of a buy-one-get-one, so it would be one call per order, 62,000 calls). Use Zoho's own
**Settings → Data Backup → Backup Your Data** (CSV; Zoho emails a download link). Next:
1. Done 16 Nov: the backup is unpacked in `.data/zoho-backup/` (Contacts/, Sales_Order/, Item.csv…;
   see the plan's change log (37) for the counts and the columns).
2. Write `apps/api/scripts/import-zoho.ts`: read Contacts and Sales Orders CSVs (one row per
   line), build the `zohoCustomer` / `zohoOrder` shapes (hint = what the customer's orders say:
   "Hospital PO" → hospital, "Bidding Order" → government, "Doctor order" → doctor), try on a
   copy of the local database, show Aryan the counts by kind.
3. On Aryan's word: push, let Render migrate, then send the batches to the live CRM.

## Where things stand

- Live: web https://crmnew-psi.vercel.app, API https://crmnew-api.onrender.com, Supabase
  `crmnew` (Singapore), photos in its bucket `files`. Messenger (2MG Inc. and Capsandpills pages),
  both websites (2MG, capsandpills), mailbox info@2mginc.com (Google script relay) are connected.
- Old CRM's 963 enquiries, their chats and 405 photos are imported (admin-only import calls
  `/api/admin/import/old-leads` and `/api/admin/import/old-files`).
- People: Admin (admin@2mginc.com); Online channel head "Aryan & Saurav" (tl1); Mary Jane,
  Online MedRep (online1 / jane@2mginc.com) — the Online channel's MedRep works in the office:
  a MedRep (orders go Management → Finance → Dispatch) who also gets Leads & enquiries, Inbox,
  Customers, Points (`officeMedrep` in api `http.ts` and web `auth.ts`); Veronica, Management
  (mgmt1 / veronica@2mginc.com); Saroj, Finance (fin1 / saroj@2mginc.com).
- Admin panel holds setup only now. The company box offers Management, Finance, Dispatch,
  Inventory, HR in one click. Known snag: the add-person form ticks "Leads 2MG Inc." by default
  (makes everyone report to the new person) — untick it by default for office work.
- The new CRM has **0 medicines and 0 customers**. That is the gap.

## The problem to solve (Aryan's words, summarised)

Management approves a MedRep's order. The MedRep writes "we gave this hospital this price
before"; today Management goes to Zoho → Sales orders → searches the hospital → finds the old
price. In the new CRM, opening the order (or the customer) must show, per medicine, what this
customer was given before: date, order number, qty, unit price, free / buy-1-get-1 — so nobody
opens Zoho. An order has several medicines: each line gets its own strip
("Pichhli baar ₱66.80 · 36 pcs · 12 Oct · SO-67227 · aur 4 baar ▾") that opens that medicine's
full history for this customer; a customer box on top (orders, last order, top medicines).
Price below last time shows amber. It must look good. Code already has a bare `lastPrice` on
order lines (api `orders/service.ts` ~line 335, web `pages/order.tsx` ~1060) from new-CRM
orders only; build on it.

## Data to bring from Zoho (Aryan wants ALL of it)

Zoho org 714292728 (one org holds 2MG and GetMeds). Aryan is signed in to Zoho Inventory in the
in-app browser pane. Read-only through the page's own API (headers
`X-ZB-SOURCE: zbclient`, `X-Requested-With: XMLHttpRequest`, `organization_id=714292728`):
- `/api/v1/items` → medicines (keep Zoho's SKU, e.g. GM-3485 = CapeGet 500; the new CRM's
  `medicine.sku` is unique).
- `/api/v1/contacts` → customers (kind: hospital / doctor / patient / drugstore / distributor /
  government; Zoho's salesperson name is "CHANNEL | Name", e.g. HOS…, RX…, B2B…, BID…, MT…).
- `/api/v1/salesorders` (list, 200 a page, ~70,000 orders, newest SO-70091) and
  `/api/v1/salesorders/{id}` for line items (`name, sku, rate, quantity, discount, item_id,
  unit`). Detail is one call per order: run it in the page in the background with retries and
  modest concurrency; start with business customers, then everyone.
Keep every imported row's Zoho id (unique) so a rerun adds only what is missing. Imported
history is history: no stock moves, no emails, no points, no to-dos. Move data into the API the
same way the lead import did (admin-only batch endpoint; the browser hands the data over).

## Decision waiting for Aryan's yes

Order numbers that say what they are: `<CHANNEL>-<YYMM>-<NNNN>`, e.g. `HOSP-2611-0042`,
`ONL-2611-0007` (channels HOSP, RX, B2B, BID, MT = B2B; ONL, PAP, TS = B2C), running per
channel per month. Website orders keep their website number. Today: `2MG-500001…`
(`orders/service.ts` ~1569). Medicine SKU stays Zoho's. Ask before changing.

## Old CRM to look at

`~/Projects/crm` runs locally on a copy of real data: launch `api-real` + `web-local`
(check port 4000 is free first), http://localhost:3000, logins in `~/Projects/crm/.data/LOCAL-TEST-LOGINS.txt`.
