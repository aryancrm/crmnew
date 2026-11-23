# 10. The database

Read-only audit, 22 Nov 2026. Everything here comes from the 130 SQL files in
`apps/api/migrations/` (5,472 lines), `apps/api/src/db/` and a search of `apps/api/src` and
`apps/api/scripts`. Nothing was run against any database; what a live database actually holds
(row counts, which migrations it has had) is not known from the repository.

Legend: **CONFIRMED** = read in a file, cited. **SUSPECTED** = follows from what was read but was
not proven (for example because it needs a running database to prove).

Contents: 1 Overview · 2 Every table · 3 Tables by domain · 4 Relationship diagrams ·
5 History and audit · 6 Views, functions, triggers, numbers · 7 Findings · 8 Inspection record

---

## 1. Overview

### 1.1 Engine

| Where | Engine | How it is chosen |
|---|---|---|
| A developer's computer | **PGlite** (`@electric-sql/pglite` 0.5.10): a Postgres compiled to run inside the Node process, data in the folder `.data/pg` | `DATABASE_URL` is empty (`apps/api/src/db/index.ts:62-82`, `apps/api/src/server.ts:38-41`) |
| Tests | PGlite in memory, one fresh database per test file | `openDatabase({ dir: "memory" })` (`db/index.ts:62`, `vitest.config.ts`) |
| Online | A real **PostgreSQL** reached with the `postgres` driver (postgres.js 3.4.9) | `DATABASE_URL` is set. With `NODE_ENV=production` and no `DATABASE_URL` the API refuses to start (`db/index.ts:75-76`) |

Details worth knowing (all CONFIRMED in `apps/api/src/db/index.ts`):

- One code path for both engines: Drizzle (`drizzle-orm` 0.45.4) wraps either driver, and the helper
  `rows(db, sql)` hides the difference in result shape (lines 37-45).
- Connection pool online: `DATABASE_POOL` connections (default 10), idle timeout 120 s, connect
  timeout 15 s, a connection is recycled after 30 minutes (lines 67-72).
- A pooler address (the text `pooler.`, `pgbouncer=true` or port `:6543` in the URL) switches
  prepared statements off automatically (lines 64-66).
- PGlite has no autovacuum. `freshenPlanner()` runs `ANALYZE` on tables never analysed or grown to
  twice their size (lines 47-60); the server calls it at start and every 15 minutes, only when
  `DATABASE_URL` is empty (`server.ts:47-53, 107`). The comment records a real case: one report took
  209 s before `ANALYZE` and under 1 s after.
- Every request counts its queries (an `AsyncLocalStorage` counter, lines 14-30) and reports them in
  the `Server-Timing` response header (`apps/api/src/app.ts:93`).
- One process per PGlite folder (CLAUDE.md): two processes opening `.data/pg` at once is not
  supported. This is why almost every script says "the API must be stopped".

### 1.2 How migrations are applied and tracked

`apps/api/src/db/migrate.ts` (37 lines) is the whole migrator:

1. It creates `schema_migration (name text primary key, applied_at timestamptz default now())` if
   missing (line 13). This table is the only one **not** created by a migration file.
2. It lists `apps/api/migrations/*.sql`, sorted by file name (`0001_people.sql` … `0130_field_and_lead_cards.sql`).
3. For each file not yet in `schema_migration`: split the text on the marker line
   `--> statement-breakpoint`, run each statement in order **inside one transaction**, then insert
   the file's name. A failing file rolls back whole.
4. It returns the names applied; the server prints `database: applied …`.

It runs on **every API start** (`server.ts:43`) and inside many scripts (`zoho-files.ts:125`,
`load-target-sheet.ts:28`, `align-org-to-sheet.ts:36`, `demo-live.ts:32`, `demo-channels.ts:31`…).

What the migrator does **not** do (CONFIRMED by reading it):

- No "down" migrations: there is no way to undo one except restoring a backup.
- No checksum: a migration file edited after it was applied is never noticed. The README's rule
  "Never edit a migration that has been applied anywhere" (README.md:76) is the only guard.
- No lock: two API processes starting at the same moment on the same Postgres would both try to
  apply the same new file (the second fails on the primary key of `schema_migration` or on the DDL
  itself and that process dies). SUSPECTED risk only when more than one API container starts at once.

### 1.3 The schema as code sees it

`apps/api/src/db/schema.ts` (58 lines) declares **only four tables** for Drizzle: `channel`,
`area`, `person`, `session`. It is imported by one file, `src/auth/sessions.ts:9`. Every other
table (149 of 153) is reached with hand-written SQL through Drizzle's `sql` template tag. So:

- The SQL files are the only complete description of the database. There is no generated schema,
  no ORM model and no type that would fail to compile if a column were renamed.
- README.md:75-76 says a schema change is "a new SQL file … plus the matching lines in
  `src/db/schema.ts`". That second half has not been followed since migration 0002 (see findings).

### 1.4 Conventions (CONFIRMED across the migrations)

| Convention | How it is done | Example |
|---|---|---|
| Primary keys | `id bigint generated always as identity primary key`; a few natural or composite keys | `stock (batch_id, warehouse_id)`, `setting (key)`, `points_reservation.id uuid` |
| Money | Whole **centavos** in `integer` (single documents) or `bigint` (totals, books). Prices are for one piece | `order_item.unit_price integer`, `book_doc.total bigint` |
| Money in another currency | Centavos of the document's currency plus `fx_rate numeric(14,6)` = pesos per unit | `purchase.fx_rate`, `book_doc.fx_rate` |
| Exceptions to integer money | `purchase_line.unit_cost numeric(14,4)` (supplier currency), `book_line.rate numeric(18,4)`, `book_doc.bank_charges` and `withheld numeric(18,2)` (they hold centavos) | 0003, 0069, 0080, 0082 |
| Rates | Basis points (`rate_bps`, `employeeBps`) | `points_settlement.rate_bps`, `pay_rule.rule` |
| Days and moments | `date` for a business day, `timestamptz` for a moment. A "day" is a **Manila** day: SQL functions convert with `at time zone 'Asia/Manila'` | `order_seat()` 0030, `work_minutes()` 0034 |
| Months | Either a `date` that must be the 1st (`check (extract(day from month) = 1)`) or text `YYYY-MM` | `sales_target.month` vs `pay_run.month` (two styles, see findings) |
| Enumerations | Plain `text` with a `CHECK (col in (...))`. No Postgres enum types. A new value = drop and re-add the constraint | `person_role_check` rebuilt in 0003, 0037, 0067, 0068 |
| Nothing deleted | A row is switched off, never removed: `active boolean`, or a time stamp (`closed_at`, `ended_at`, `cancelled_at`, `voided_at`, `replaced_at`, `removed_at`, `dropped_at`) | `payment.active` + `removed_reason/by/at` |
| Who and when | `by_person bigint references person` + `at timestamptz default now()`, or named pairs (`created_by/created_at`, `decided_by/decided_at`…) | every table |
| Snapshots | `jsonb` for things frozen as they were | `order_version.lines`, `payslip.slip`, `quotation_link.snapshot`, `plan_revision.days` |
| Imported data | The source's id is kept in a unique column so an import can run again | `zoho_id`, `legacy_id`, `web_id` |
| Zoho's extra fields | Kept whole in a `fields jsonb` column under Zoho's own names | `book_doc.fields`, `customer.zoho_fields` |
| Phone numbers | `phone_key` = the last ten digits, so `0917…`, `+63917…` and `63917…` match | `customer.phone_key`, `lead.phone_key`, `points_account.phone_key` |
| Files | A row holds the bytes (`data bytea`) **or** a bucket key (`store_key`), with a check that one is present | 0051; five file tables and four inline sets of columns |
| Secrets | A connected page's token or mailbox password is stored sealed (AES-GCM with `SECRETS_KEY`) in `channel_account.secret` | 0015 |
| Passwords and tokens | Only hashes are stored | `person.password_hash`, `session.token_hash`, `points_login.password_hash`, `quotation_link.token_hash` |

Not used anywhere: Postgres enum types, schemas other than `public`, row-level security,
partitioning, materialized views, database sequences other than identity columns, `ON DELETE`
actions (every foreign key is the default `NO ACTION`, which fits "nothing is deleted").

### 1.5 Size of the schema

| Thing | Count | Source |
|---|---|---|
| Migration files | 130 | `ls apps/api/migrations` |
| Tables created | 154 | `grep '^create table'` |
| Tables dropped | 1 (`incoming`, created 0002, dropped 0003) | 0003:12 |
| Tables that exist after 0130 | 153 + `schema_migration` | |
| Columns (about) | 1,800 | counted from `create table` bodies and `add column` |
| Widest tables | `sales_order` 92 columns, `lead` 56, `customer` 41, `tender` 41, `visit` 38, `book_doc` 36 | same count |
| Indexes created | 150 plain + 32 unique (besides primary keys and `unique` constraints) | `grep '^create (unique )?index'` |
| Views | 4 (`sale_invoice`, `book_entry_calc`, `crm_entry`, `book_entry`) | section 6 |
| Functions | 12 (5 of them trigger functions) | section 6 |
| Triggers | 5 | section 6 |

---

## 2. Every table

"Later touched in" lists every later migration that alters the table, adds an index or trigger on
it, or rewrites its data. Generated from the SQL files with a script, then checked by hand.

| # | Table | Domain group | Purpose | Created in | Later touched in (alter, index, trigger, data) |
|---|---|---|---|---|---|
| 1 | `channel` | people/org | A sales channel (HOSP, RX, B2B, BID, MT, TS, PAP, ONLINE): code, name, head, the Division its orders carry, active | 0001 | 0007, 0032, 0124 |
| 2 | `area` | people/org | A MedRep territory inside a channel: a name and its list of cities | 0001 | - |
| 3 | `person` | people/org | One row per person and login: name, role, channel/area/boss (written from the seat), password hash, lock state | 0001 | 0003, 0027, 0034, 0037, 0038, 0067, 0068, 0094, 0124 |
| 4 | `session` | people/org | A signed-in browser (token hash only); also a "viewed as" session and a desk's common screen | 0001 | 0029, 0110 |
| 5 | `org_unit` | people/org | A box on the org chart (company, business, line, team, department) in a tree | 0026 | 0103 |
| 6 | `seat` | people/org | One job in a unit that stays when its person leaves: title, module (role), lead flag, area, login ID | 0026 | 0027, 0037, 0067, 0068 |
| 7 | `seat_holder` | people/org | Who sits in a seat from a day to a day (holder or acting cover) | 0026 | - |
| 8 | `seat_request` | people/org | A team lead's ask for a new seat, region or area; CEO/Admin approves or declines | 0029 | 0031 |
| 9 | `sales_target` | people/org | A person's monthly target (pesos in centavos, plus TLB and billed-customer counts) | 0011 | 0103 |
| 10 | `seat_target` | people/org | The same monthly target kept on the seat, so it survives a change of person | 0056 | 0103 |
| 11 | `target_sheet_row` | people/org | The company's monthly target sheet, row by row as the sheet names people | 0109 | - |
| 12 | `message_thread` | people/org | An internal message thread: direct, group or announcement | 0028 | - |
| 13 | `message_member` | people/org | Who is on a thread and when they last read it | 0028 | - |
| 14 | `message` | people/org | One message in a thread | 0028 | - |
| 15 | `notification` | people/org | The bell: one line per person per event, with read time | 0024 | - |
| 16 | `score_month` | people/org | A locked monthly scorecard (KPI card) per person, month and recipe | 0057 | 0130 |
| 17 | `score_dispute` | people/org | A person's objection to a locked scorecard figure and the lead's answer | 0057 | - |
| 18 | `huddle` | people/org | The 7 PM daily declaration per seller: sales, collected, visits, blocker | 0058 | - |
| 19 | `work_log` | people/org | An office person's optional daily log (done / today / tomorrow) | 0067 | - |
| 20 | `customer` | customers | Every hospital, doctor, patient, drugstore, distributor and government buyer, kept once | 0006 | 0040, 0054, 0061, 0073, 0085, 0112 |
| 21 | `customer_person` | customers | A customer's contact people (from Zoho's contact persons) | 0073 | - |
| 22 | `customer_field` | customers | A customer's field profile (SEFMED's KOL / hospital / firm fields), one row per customer | 0129 | - |
| 23 | `zoho_contact` | customers | Every Zoho contact id and the customer it became here, with Zoho's last salesperson and division | 0054 | 0055 |
| 24 | `zoho_seller` | customers | Each Zoho salesperson name and the seat it is tied to here | 0055 | - |
| 25 | `past_order` | customers | A Zoho sales order kept as history (no stock, no invoice) | 0054 | 0055 |
| 26 | `past_order_item` | customers | A line of a Zoho sales order (name and SKU as text) | 0054 | - |
| 27 | `past_invoice` | customers | A Zoho invoice kept as history, with what is still owed on it | 0055 | - |
| 28 | `past_payment` | customers | A Zoho payment, one row per invoice it settled | 0055 | - |
| 29 | `warehouse` | inventory | A stock location; at most one default | 0002 | - |
| 30 | `medicine` | inventory | The item master: a medicine (or cold box / pharmacy item) with SKU, VAT class, pack size, SRP, flags | 0002 | 0004, 0005, 0055, 0090, 0097, 0120 |
| 31 | `medicine_price` | inventory | One price per medicine per buyer type (per piece, optional pack price) | 0002 | 0005 |
| 32 | `medicine_sku` | inventory | Every SKU a medicine has gone by (Zoho duplicates), each SKU unique | 0055 | - |
| 33 | `promo` | inventory | A dated promo price on a medicine | 0002 | - |
| 34 | `offer` | inventory | A Buy X Take Y and/or special price on a medicine, optionally for one buyer kind | 0086 | 0087 |
| 35 | `price_change` | inventory | Append-only log of every price or promo change | 0002 | - |
| 36 | `batch` | inventory | A batch of a medicine: batch number, expiry, landed unit cost | 0002 | 0003 |
| 37 | `stock` | inventory | What is on the shelf now: one row per batch per warehouse, never below zero | 0002 | - |
| 38 | `stock_move` | inventory | Append-only log of every change to the shelf (receive, move, count, deliver, return, sample_out) | 0002 | 0097 |
| 39 | `stock_news` | inventory | Dispatch's notices to sellers about a medicine (out, low, back, note) | 0002 | - |
| 40 | `medicine_request` | inventory | "Medicine not available": one open request per medicine name and strength | 0022 | - |
| 41 | `medicine_request_ask` | inventory | Each ask under a medicine request (who, for which customer, how many) | 0022 | - |
| 42 | `sample_request` | inventory | A rep's request for samples or gifts, approved, issued and received | 0097 | - |
| 43 | `sample_stock` | inventory | What each rep holds, by kind and batch | 0097 | - |
| 44 | `sample_move` | inventory | Every piece into or out of a rep's hands (received, given, counted) | 0097 | - |
| 45 | `supplier` | purchasing | A vendor, with Zoho's fields and opening credits / payables | 0003 | 0069, 0070, 0071 |
| 46 | `supplier_person` | purchasing | A vendor's contact people | 0069 | - |
| 47 | `purchase` | purchasing | One order to a supplier in its currency with FX rate and landed totals | 0003 | - |
| 48 | `purchase_line` | purchasing | A medicine on a purchase: qty, unit cost, received qty, batch, landed cost | 0003 | 0033 |
| 49 | `purchase_cost` | purchasing | A peso cost on the way in (freight, customs...) spread over the lines | 0003 | - |
| 50 | `sales_order` | orders | The order: customer, MedRep, seat, status, terms, delivery, holds, checks, GL, COD, relief (92 columns) | 0008 | 0009, 0010, 0011, 0012, 0013, 0014, 0016, 0017, 0019, 0020, 0021, 0022, 0023, 0024, 0026, 0030, 0045, 0046, 0047, 0049, 0083, 0084, 0089, 0104, 0105, 0108, 0111, 0115, 0118, 0122, 0123, 0124 |
| 51 | `order_item` | orders | A line of an order: medicine, pieces, price kind, list and unit price, free / relief / offer, name as billed | 0008 | 0014, 0020, 0086, 0095 |
| 52 | `order_event` | orders | The order's timeline: who did what, when (append-only) | 0008 | - |
| 53 | `order_step` | orders | Every status an order passed with when it came and left (kept by trigger) | 0023 | 0025 |
| 54 | `order_version` | orders | Every version of an order's lines as JSON (placed, fixed, changed) | 0083 | - |
| 55 | `order_ask` | orders | Management asking a team lead or business mentor for a yes/no on an order | 0093 | - |
| 56 | `order_check` | orders | Management's and Finance's per-check approvals on an order | 0116 | 0117 |
| 57 | `order_assignment` | orders | Log of each time an order was given to, taken by, released by or put back from a desk person | 0107 | 0110 |
| 58 | `desk_shift` | orders | A desk person's Start and Stop on the Management, Finance or Dispatch desk | 0106 | 0110 |
| 59 | `invoice` | finance | One sales invoice per order, with VAT split, paid, refunded and credited running totals | 0012 | 0050 |
| 60 | `payment` | finance | Money (or a non-cash settlement) received against an invoice; removed ones stay, marked inactive | 0012 | 0017, 0021, 0088, 0092, 0096, 0099 |
| 61 | `refund` | finance | Money given back to a customer against an invoice | 0012 | 0092, 0096 |
| 62 | `book_doc` | books/ledger | Every accounting document (22 kinds), Zoho's and this CRM's, with status, totals and Zoho's raw fields | 0069 | 0072, 0077, 0078, 0080, 0081, 0082, 0101 |
| 63 | `book_line` | books/ledger | A line of a book document: item or account, qty, rate, tax, amount | 0069 | 0072, 0078 |
| 64 | `book_link` | books/ledger | How documents hang together (receive to PO, payment to bill, credit note to invoice) with the amount applied | 0069 | - |
| 65 | `book_item` | books/ledger | Zoho Inventory's items as Zoho kept them, tied to a medicine by SKU | 0074 | - |
| 66 | `book_price_list` | books/ledger | Zoho's price lists as Zoho kept them | 0074 | - |
| 67 | `book_account` | books/ledger | The chart of accounts | 0077 | 0101 |
| 68 | `book_activity` | books/ledger | Zoho's own activity log, imported | 0077 | - |
| 69 | `book_ledger` | books/ledger | Zoho documents' debits and credits, written down once by refresh_book_ledger() | 0079 | - |
| 70 | `book_option` | books/ledger | Choices for a document's custom fields (Cost Centre, Type, Company, Department) | 0101 | - |
| 71 | `book_tax` | books/ledger | Zoho's tax names and percentages | 0101 | - |
| 72 | `book_lock` | books/ledger | A closed accounting period per module | 0101 | - |
| 73 | `book_lock_event` | books/ledger | Log of every lock and unlock of a period | 0101 | - |
| 74 | `bank_import` | books/ledger | One imported bank statement file | 0102 | - |
| 75 | `bank_line` | books/ledger | One line of a bank statement, matched / categorized / excluded | 0102 | - |
| 76 | `bank_reconciliation` | books/ledger | A bank reconciliation of an account for a period | 0102 | - |
| 77 | `bank_cleared` | books/ledger | The ledger entries ticked as cleared in a reconciliation | 0102 | - |
| 78 | `order_pick` | dispatch | Which batch from which warehouse went into an order's box, at what unit cost; unpacked rows stay, marked | 0013 | - |
| 79 | `sales_return` | returns | A return of delivered goods: requested, approved, checked, received, credited | 0050 | 0091 |
| 80 | `sales_return_line` | returns | A returned line with what Dispatch found (restocked, damaged, missing, kept) | 0050 | 0091 |
| 81 | `lead` | online | An Online or PAP case (enquiry or website order) from first message to order | 0014 | 0015, 0016, 0017, 0021, 0048, 0052, 0113 |
| 82 | `lead_event` | online | A case's timeline | 0014 | 0015 |
| 83 | `lead_message` | online | A Messenger or email message on a case | 0015 | - |
| 84 | `channel_account` | online | A connected Facebook page, mailbox or website with its sealed secret | 0015 | 0016 |
| 85 | `inbox_event` | online | Queue of raw Messenger webhook events to work (retried, never lost) | 0015 | - |
| 86 | `email_held` | online | Email from an unknown sender held for the agent's decision | 0015 | - |
| 87 | `email_sender` | online | The desk's verdict on an email sender (allowed / ignored) | 0015 | - |
| 88 | `web_order` | online | An order as a website sent it, and the status pushed back to the website | 0016 | 0018, 0119, 0121 |
| 89 | `web_request` | online | A prescription or enquiry sent through a website | 0016 | - |
| 90 | `web_call` | online | Log of every call a website made to the CRM | 0016 | - |
| 91 | `web_catalog_sent` | online | What catalogue entry each website was last sent per medicine (hash) | 0120 | - |
| 92 | `web_retired_product` | online | Old-CRM products with no match here, sent once to websites as no longer sold | 0120 | - |
| 93 | `quotation_link` | online | A frozen quotation sent to a customer as a 30-day link | 0017 | - |
| 94 | `points_account` | online | One loyalty points account per customer phone | 0017 | - |
| 95 | `points_entry` | online | Append-only ledger of points earned, spent, released, adjusted | 0017 | - |
| 96 | `points_settlement` | online | What an order has earned so far, so later changes earn only the difference | 0017 | - |
| 97 | `points_login` | online | A customer's own points login (phone + password hash) | 0018 | - |
| 98 | `points_session` | online | A signed-in points customer session | 0018 | - |
| 99 | `points_web_account` | online | A website member account proved to own a points account | 0018 | - |
| 100 | `points_reservation` | online | Points held at a website checkout until spent or released | 0018 | - |
| 101 | `visit` | field | A field visit to a customer: planned, done, skipped or missed, with the call report | 0039 | 0040, 0129 |
| 102 | `visit_plan` | field | A MedRep's month plan of visits, sent to the team lead | 0040 | 0129 |
| 103 | `visit_change` | field | Append-only log of every change to a visit | 0129 | - |
| 104 | `visit_order` | field | The CRM order placed at a visit | 0129 | - |
| 105 | `plan_day` | field | A planned day's work place, cities and who works along | 0129 | - |
| 106 | `plan_revision` | field | Each decided revision of a month plan, frozen as JSON | 0129 | - |
| 107 | `plan_deviation` | field | A change after plan approval, waiting for the lead's decision | 0129 | - |
| 108 | `field_day` | field | A field person's working day: start, place, breaks, day report | 0129 | - |
| 109 | `field_day_event` | field | Start / place / break / resume / stop events of a field day | 0129 | - |
| 110 | `field_expense` | field | A field expense claim or a generated daily allowance | 0040 | 0051, 0129 |
| 111 | `field_expense_head` | field | The expense heads as GetMeds used them in SEFMED | 0129 | - |
| 112 | `field_allowance` | field | Per diem and TA rates per work place | 0129 | - |
| 113 | `field_follow_up` | field | A follow-up to do for a customer | 0129 | - |
| 114 | `field_prescribing` | field | What a doctor prescribes, as the MedRep last saw it | 0129 | - |
| 115 | `live_location` | field | Latest known place of each field person (one row, no trail) | 0042 | - |
| 116 | `employee` | HR | HR's record per person: company, code, classification, pay, government numbers, bank | 0037 | 0044 |
| 117 | `work_schedule` | HR | Working days and hours; one default | 0034 | 0035 |
| 118 | `holiday` | HR | Public holidays | 0034 | 0036 |
| 119 | `attendance` | HR | One row per person per day: time in, time out, sources, last seen | 0034 | - |
| 120 | `person_leave` | HR | Leave asked, approved, refused or cancelled, with an optional paper | 0039 | 0041, 0051 |
| 121 | `hr_form` | HR | Official business, work-from-home and overtime forms | 0043 | - |
| 122 | `pay_rule` | HR | Dated statutory rates (SSS, PhilHealth, Pag-IBIG, BIR tax table) | 0044 | - |
| 123 | `pay_adjustment` | HR | HR's own earning / deduction lines on a month's payslip | 0044 | - |
| 124 | `pay_run` | HR | A released payroll month, frozen totals | 0044 | - |
| 125 | `payslip` | HR | A person's frozen payslip in a released run | 0044 | - |
| 126 | `doctor_list` | channels | An Rx seat's tiered doctor list | 0059 | - |
| 127 | `care_group` | channels | A patient care group (Viber) enrolled by an Rx CHC and worked by MD Telesales | 0060 | - |
| 128 | `b2b_account` | channels | A business account's road through B2B (NBD, CRR, handover, dropped) | 0061 | - |
| 129 | `account_call` | channels | A logged sales call to a customer (or a typed name) | 0061 | 0103 |
| 130 | `clidp_listing` | channels | A distributor's CLIDP certificate for one of our medicines | 0063 | - |
| 131 | `clidp_account` | channels | CLIDP's road with a distributor (approached to ordering / declined) | 0127 | - |
| 132 | `clidp_account_event` | channels | Log of each CLIDP stage move | 0127 | - |
| 133 | `clidp_rate` | channels | The rate agreed with a distributor per medicine | 0127 | - |
| 134 | `tender` | channels | A government tender from posting to payment | 0064 | 0126 |
| 135 | `tender_line` | channels | Our bid price per medicine on a tender | 0064 | 0065 |
| 136 | `tender_event` | channels | Log of every step a tender took | 0064 | - |
| 137 | `tender_bidder` | channels | Every bidder's price read at the bid opening | 0126 | - |
| 138 | `company_paper` | channels | The company's eligibility papers with expiry | 0064 | - |
| 139 | `mt_listing` | channels | Which medicines a Modern Trade chain carries and in how many branches | 0066 | - |
| 140 | `hospital_accreditation` | channels | 2MG's accreditation status at a hospital, line per change | 0128 | - |
| 141 | `hospital_formulary` | channels | Each medicine's formulary status at a hospital, line per change | 0128 | - |
| 142 | `pipeline_product` | regulatory | A product In-licensing is bringing in, by stage | 0068 | - |
| 143 | `product_registration` | regulatory | An FDA registration (CPR) for a medicine or pipeline product | 0068 | - |
| 144 | `reg_event` | regulatory | Log of every change to a pipeline product or registration | 0068 | - |
| 145 | `complaint` | regulatory | A complaint or side-effect report handled by Regulatory to a due day | 0100 | - |
| 146 | `complaint_event` | regulatory | Notes on a complaint | 0100 | - |
| 147 | `order_file` | files | A paper on an order (PO, prescription, proof of payment, DR...), bytes or bucket key | 0011 | 0013, 0047, 0049, 0051 |
| 148 | `lead_file` | files | A photo or PDF on a case | 0014 | 0015, 0048, 0051, 0053 |
| 149 | `customer_file` | files | A business customer's papers (BIR 2303, LTO, business permit) | 0085 | - |
| 150 | `book_file` | files | A file attached to a book document | 0075 | - |
| 151 | `visit_file` | files | A photo on a visit | 0129 | - |
| 152 | `counter` | system | Gapless number counters handed out inside the transaction | 0011 | 0012, 0014, 0050, 0097, 0100 |
| 153 | `setting` | system | Key/value company settings (company letterhead, points) | 0017 | - |

Also present: `schema_migration` (system; created by `src/db/migrate.ts:13`, not by a migration).
Dropped: `incoming` ("stock a supplier is expected to deliver", 0002) was replaced by `purchase` in 0003.

Tables per group: online 20, people/org 19, inventory 16, books/ledger 16, channels 16, field 15,
HR 10, customers 9, orders 9, purchasing 5, regulatory 5, files 5, finance 3, returns 2, system 2
(+1), dispatch 1.

---

## 3. Tables by domain

Notation: **PK** primary key, **FK →** foreign key, **UQ** unique, **CK** check constraint,
`(NNNN)` the migration that added a column after the table was created. Every status or enum
column lists **all** its allowed values as the latest migration leaves them. "free text" means the
column has no check constraint.

### 3.1 People and organisation

**`channel`** (0001) — PK `id`. `code` UQ, `name`, `sort`, `head_id` FK → person (0007: the head is
named on the channel, never worked out), `division` (0032; the Division its orders carry; values
rewritten in 0124), `active` (0032).

**`area`** (0001) — `channel_id` FK → channel NOT NULL, `name`, `cities text[]`. UQ `(channel_id, name)`.

**`person`** (0001) — one row per person, one login.

| Column | Type | Meaning |
|---|---|---|
| `name`, `phone`, `title` | text | |
| `email` | text, nullable since 0027 | A way to reach them; UQ index `person_email_once` on `lower(email)` |
| `role` | text NOT NULL, CK | `medrep`, `team_lead`, `manager`, `management`, `finance`, `dispatch`, `inventory` (0003), `ceo`, `online`, `admin`, `hr` (0037), `staff` (0067), `regulatory` (0068) |
| `channel_id`, `area_id`, `reports_to` | FK → channel, area, person | Written from the person's seat by `projectOrg` (comment in 0026). CK `reports_to <> id` |
| `password_hash` | text NOT NULL | scrypt hash (README) |
| `must_change_password`, `failed_logins`, `locked_until` | | Sign-in state |
| `last_sign_in_at` | timestamptz (0038) | |
| `schedule_id` | FK → work_schedule (0034) | None = the company's default hours |
| `approves` | `text[]` (0094) | Which Divisions a Management person approves; null = all |
| `active`, `created_at` | | |

Indexes: `person_reports_to`, `person_area`.

**`session`** (0001) — `token_hash` UQ, `person_id` FK, `created_at`, `last_seen_at`, `expires_at`,
`viewed_by` FK → person (0029: the CEO or Admin looking as this person, read only), `desk` CK
`management` / `finance` / `dispatch` (0110: a desk's common screen). Index `session_person`.

**`org_unit`** (0026) — a box on the chart. `name`, `kind` CK `company` / `business` / `line` /
`team` / `department`, `parent_id` FK → org_unit, `channel_id` FK, `sort`, `active`, `created_at`,
`report_channel` (0103, free text: the business line sales are reported under). CK parent ≠ self;
CK `(kind = 'company') = (parent_id is null)`. UQ: exactly one company (`org_unit_one_company`);
`(parent_id, lower(name))` among active units.

**`seat`** (0026) — one job. `unit_id` FK NOT NULL, `title`, `module` CK (same 13 values as
`person.role`), `lead` boolean, `reports_to_seat_id` FK → seat (CK ≠ self), `area_id` FK,
`sort`, `active`, `boss_id` FK → person (derived by `projectOrg`), `created_at`, `closed_at`,
`login` (0027: `hos1`, `fin1`…). UQ: one active seat per area (`seat_area_once`); login unique
among active seats, case-insensitive (`seat_login_once`).

**`seat_holder`** (0026) — who sits in a seat. `seat_id`, `person_id` FKs, `kind` CK `holder` /
`acting`, `starts_on`, `ends_on` (empty while held), `reason`, `by_person`, `at`, `ended_by`,
`end_reason`. CK `ends_on >= starts_on - 1`. UQ `seat_holder_one`: one open `holder` per seat.

**`seat_request`** (0029) — `unit_id` FK, `kind` CK `seat` / `region` / `area` (0031), `module`
CK `medrep` / `team_lead` (nullable since 0031), `title`, `area_id`, `new_area_name`,
`new_area_cities text[]`, `person_name`, `person_phone`, `reason`, `status` CK `open` / `approved`
/ `declined`, `asked_by`, `asked_at`, `decided_by`, `decided_at`, `answer`, `seat_id`,
`person_id`, `lead_person_id`, `for_seat_id`, `made_unit_id`, `made_area_id` (0031).

**`sales_target`** (0011) — PK `(person_id, month)`; `month` CK day = 1; `amount bigint` centavos;
`set_by`, `set_at`; `tlb`, `billed` (0103: SKU count and customers-billed targets).

**`seat_target`** (0056) — PK `(seat_id, month)`, same columns. The comment says the person's row
is what every figure reads; it is written from the seat's when someone takes the seat.

**`target_sheet_row`** (0109) — `month` (1st), `sort`, `head`, `channel`, `manager`,
`salesperson`, `zoho_names text[]`, `hq`, `target bigint`, `seat_id` FK, `set_by`, `set_at`.
UQ `(month, sort)`. All the name columns are free text as the sheet writes them.

**`message_thread`** (0028) — `kind` CK `direct` / `group` / `announcement`, `title`, `unit_id`
FK → org_unit, `everyone`, `direct_key` UQ (two person ids, smaller first), `created_by`,
`created_at`, `last_at`. **`message_member`** PK `(thread_id, person_id)`, `read_at`.
**`message`** `thread_id`, `by_person`, `body`, `at`.

**`notification`** (0024) — `person_id`, `kind` (free text; the trigger writes `to_finance`,
`to_pack`, `shipped`, `delivered`), `title`, `body`, `link`, `order_id` FK, `key`, `at`,
`read_at`. UQ `(person_id, key)`: an action retried tells once.

**`score_month`** (0057) — PK `(person_id, month, recipe)` since 0130 (was `(person_id, month)`).
`recipe` (free text: `hospital`, `b2c`…), `seat_id`, `total`, `max`, `capped`, `kpis jsonb`,
`locked_at`. **`score_dispute`** — `person_id`, `month`, `kpi`, `note`, `raised_at`, `state` CK
`open` / `upheld` / `turned_down`, `answer`, `answered_by`, `answered_at`.

**`huddle`** (0058) — PK `(person_id, day)`; `seat_id`, `sales`, `collected` (bigint centavos),
`visits`, `invoiced`, `blocker`, `tomorrow`, `declared_at`.

**`work_log`** (0067) — PK `(person_id, day)`; `done`, `today`, `tomorrow`, `updated_at`.

### 3.2 Customers and their history

**`customer`** (0006) — 41 columns.

| Column | Type | Meaning |
|---|---|---|
| `code` | text UQ | `CUS-00001`, made from `id` after insert |
| `kind` | text CK | `hospital`, `doctor`, `patient`, `drugstore`, `distributor`, `government` |
| `name`, `phone`, `phone_key`, `email`, `address`, `city` | | |
| `area_id` | FK → area | Whoever holds the area looks after the customer |
| `specialty`, `works_at` | text, FK → customer | Doctors: what they treat and their hospital (CK ≠ self) |
| `licence_no`, `licence_expires`, `tin` | | LTO / PRC licence and TIN |
| `licence_owner`, `lto_type`, `licence_issued` | (0085) | As Zoho kept them |
| `permit_no`, `permit_expires` | (0061) | Business permit |
| `payment_terms` | text CK | `advance`, `cod`, `days` |
| `payment_days` | integer CK 1–365 | CK: set exactly when terms = `days` |
| `credit_limit` | integer ≥ 0 | |
| `review` | text CK | `ok`, `to_review` (+ `reviewed_by`, `reviewed_at`) |
| `added_by` | FK → person NOT NULL | |
| `visit_class` | text CK (0040) | `A`, `B`, `C`, `D` |
| `pin`, `pinned_by` | (0040) | Clinic's "lat,lng" |
| `zoho_id` | text (0054) | UQ where present |
| `zoho_fields` | jsonb (0073) | Zoho's other fields |
| `opening_receivables`, `opening_credits` | bigint ≥ 0 (0073) | What Zoho Books says they owed / held that no document here explains |
| `next_refill_on`, `refill_note`, `refill_set_by`, `refill_set_at` | (0112) | |
| `note`, `active`, `created_at` | | |

UQ `customer_once`: `(kind, lower(name), lower(coalesce(city,'')))` for everyone except patients.
Indexes: phone_key, `(area_id, kind)`, `(kind, lower(name))`, added_by, works_at.

**`customer_person`** (0073) — `customer_id` FK, `zoho_id` UQ, `name`, `email`, `phone`, `mobile`,
`designation`, `fields jsonb`.

**`customer_field`** (0129) — PK `customer_id`. `dispensing`, `qualification`, `gender` CK `male`
/ `female` / `other`, `hospital_type` CK `government` / `private`, `hospital_class` CK `general` /
`specialty`, `firm_type` CK `super_stockist` / `distributor` / `sub_distributor` / `stockist` /
`retailer`, `contact_person`, `zone`, `pref_days text[]`, `pref_time`, `firm_id` FK → customer
(CK ≠ self), `visits_a_month` 0–31, `off_list`, `off_asked_by`, `off_asked_at`, `off_why`,
`changed_by`, `changed_at`.

**`zoho_contact`** (0054) — PK `zoho_id` text; `customer_id` FK NOT NULL; `seller`, `seller_on`,
`division`, `sub_division`, `headquarter` (0055). Two Zoho contacts may point to one customer.

**`zoho_seller`** (0055) — PK `name` (Zoho's salesperson text, e.g. "HOS | Name"); `seat_id` FK,
`set_by`, `set_at`.

**`past_order`** (0054) — `zoho_id` UQ, `code`, `customer_id` FK, `ordered_on`, `status` (Zoho's
word, free text; "void" = cancelled), `total bigint`, `seller`, `division`, `source`,
`invoiced_from`, `reference`, `customer_name`, `doctor`, `patient` (0055).
**`past_order_item`** — `past_order_id` FK, `sku`, `name`, `unit`, `qty > 0`, `unit_price`, `free`.

**`past_invoice`** (0055) — `zoho_id` UQ, `code`, `customer_id`, `past_order_id` FK, `order_code`,
`issued_on`, `due_on`, `status` (Zoho's word: closed, open, overdue, partiallypaid, void, draft —
free text), `total`, `balance`, `terms`, `seller`, `invoiced_from`.
**`past_payment`** — `zoho_id` UQ, `payment_no`, `customer_id`, `past_invoice_id` FK,
`invoice_code`, `paid_on`, `mode`, `reference`, `amount`, `payment_total`.

### 3.3 Inventory

**`warehouse`** (0002) — `code` UQ, `name`, `is_default` (UQ partial index: at most one default), `active`.

**`medicine`** (0002) — 26 columns.

| Column | Type | Meaning |
|---|---|---|
| `code` | text UQ | `MED-00001`, from `id` |
| `name`, `generic`, `strength`, `form`, `pack` | | UQ `medicine_once`: `(lower(name), lower(coalesce(strength,'')))` |
| `sku` | text (0004) | UQ on `lower(sku)` where present |
| `unit`, `manufacturer`, `brand`, `category` | (0004) | |
| `pack_size` | integer ≥ 1 (0005) | The piece is the unit; a pack holds this many |
| `rx` | boolean default true | Prescription medicine |
| `vat` | text CK | `exempt`, `vat12`, `zero` |
| `reorder_level` | integer ≥ 0 | |
| `srp`, `srp_pack` | integer (0055) | Printed price a senior/PWD discount is taken from |
| `shelf_life_months` | 1–240 (0055) | |
| `list_note`, `cold_chain` | (0055) | |
| `cold_box` | boolean (0090) | The styro box is itself a stock item |
| `no_samples` | boolean (0097) | Never given as a sample |
| `web_id` | uuid UQ (0120) | The id the 2MG website knows it by |
| `active`, `created_at` | | |

**`medicine_price`** (0002) — PK `(medicine_id, buyer_type)`; `buyer_type` CK `patient` /
`hospital` / `doctor` / `distributor` / `drugstore` / `bidding`; `amount`; `pack_amount` (0005).

**`medicine_sku`** (0055) — `medicine_id` FK, `sku`; UQ on `lower(sku)`.

**`promo`** (0002) — `medicine_id`, `name`, `amount`, `starts_on`, `ends_on` (CK ≥ start), `created_by`, `created_at`.

**`offer`** (0086) — `medicine_id`, `buyer_kind` CK `hospital` / `doctor` / `patient` /
`drugstore` / `distributor` / `government` (null = every buyer), `buy ≥ 1`, `take ≥ 0`, `price`,
`name`, `note`, `starts_on`, `ends_on` (nullable since 0087), `created_by`, `created_at`,
`ended_at`, `ended_by`. CK `take > 0 or price is not null`.

**`price_change`** (0002) — `medicine_id`, `what` (free text), `old_amount`, `new_amount`, `by_person`, `at`.

**`batch`** (0002) — `medicine_id`, `batch_no`, `expires_on`, `created_at`; UQ `(medicine_id,
batch_no)`; `unit_cost` (landed centavos per piece) and `purchase_line_id` FK (0003).

**`stock`** (0002) — PK `(batch_id, warehouse_id)`; `qty` CK ≥ 0.

**`stock_move`** (0002) — `medicine_id`, `batch_id`, `warehouse_id`, `qty` CK ≠ 0, `kind` CK
`receive` / `move_out` / `move_in` / `count` / `deliver` / `return` / `sample_out` (0097), `ref`
(free text: an order code, a sample request code, `ZOHO`, `GO-LIVE`), `note`, `by_person`, `at`.

**`stock_news`** (0002) — `medicine_id`, `kind` CK `out` / `low` / `back` / `note`, `message`,
`by_person`, `created_at`, `closed_at`.

**`medicine_request`** (0022) — `code` (`MRQ-00001`), `medicine_id` FK, `name`, `strength`,
`times`, `qty`, `status` CK `open` / `ordered` / `added` / `declined`, `asked_by`, `asked_at`,
`last_asked_at`, `answer`, `answered_by`, `answered_at`. UQ: one open request per
`(lower(name), lower(strength))`. **`medicine_request_ask`** — `request_id`, `person_id`,
`customer_id`, `qty`, `note`, `at`.

**`sample_request`** (0097) — `code` UQ (`SRQ-00001`), `person_id`, `kind` CK `samples` / `gifts`,
`lines jsonb`, `note`, `status` CK `submitted` / `approved` / `rejected` / `withdrawn` / `issued`
/ `received`, `asked_by`, `asked_at`, `decided_by`, `decided_at`, `reject_reason`, `issued_by`,
`issued_at`, `issued_from` FK → warehouse, `issued_lines jsonb`, `received_at`.
**`sample_stock`** — PK `(person_id, kind, batch_id)`, `qty ≥ 0`.
**`sample_move`** — `person_id`, `kind`, `batch_id`, `medicine_id`, `qty`, `what` CK `received` /
`given` / `counted`, `request_id`, `visit_id`, `customer_id`, `reason`, `ack_key`, `ack_data`,
`ack_name`, `ack_mime` (the doctor's signed acknowledgement), `by_person`, `at`.

### 3.4 Purchasing

**`supplier`** (0003) — `name` (UQ on `lower(name)`), `country`, `currency` CK three capitals
(default `USD`), `contact`, `active`, `created_at`; from 0069: `zoho_id` (UQ where present),
`company_name`, `email`, `phone`, `mobile`, `website`, `payment_terms`, `tin`, `billing_address`,
`shipping_address`, `fields jsonb`, `zoho_created`; `opening_credits` (0070), `opening_payables` (0071).

**`supplier_person`** (0069) — `supplier_id` FK, `zoho_id` UQ, `name`, `email`, `phone`, `mobile`, `designation`, `fields`.

**`purchase`** (0003) — `code` UQ (`PO-00001` from `id`), `supplier_id`, `warehouse_id`, `state`
CK `ordered` / `received` / `cancelled`, `ordered_on`, `expected_on`, `currency`, `fx_rate`,
`supplier_ref`, `note`, `goods_total`, `extras_total`, `created_by`, `created_at`, `received_by`, `received_at`.

**`purchase_line`** — `purchase_id`, `medicine_id`, `qty > 0`, `unit_cost numeric(14,4)`,
`received_qty`, `batch_id`, `goods`, `extras`, `landed_unit`; UQ `(purchase_id, medicine_id)`;
`shelf_before`, `cost_before` (0033: so a batch's average cost can be replayed).

**`purchase_cost`** — `purchase_id`, `kind` CK `freight` / `packaging` / `customs` / `insurance` /
`transport` / `other`, `amount`, `note`.

### 3.5 Orders

**`sales_order`** (0008) — 92 columns, added to by 27 later migrations. Grouped:

| Group | Columns |
|---|---|
| What it is | `id`, `code` UQ (`2MG-5xxxxx`), `customer_id` FK, `medrep_id` FK, `raised_by` FK, `channel_id` FK, `seat_id` FK (0026, set by trigger), `lead_id` FK (0014), `doctor_id` FK → customer (0011), `invoice_from` CK `2mg` / `getmeds` (0011), `order_type` CK `patient` / `senior_pwd` / `gl` / `po` / `no_po` (0118), `source` (0084, free text), `division`, `sub_division` (0020, free text), `headquarter` (0122), `patient_order`, `patient_name` (0049), `customer_po` (0010) |
| Status | `status` CK: `draft`, `pending_approval`, `finance_check`, `ready_for_invoice`, `ready_for_dispatch`, `packing`, `shipped`, `completed`, `on_hold`, `exception`, `cancelled` (0008 also had `invoiced`, removed in 0012). `status_since` (0023, trigger), `held_from`, `held_role` (0013, free text), `flag_reason`, `sent_back_count/reason/at/by`, `reply` (0022), `waiting_stock_at/by` (0045), `came_back_count/reason/at` (0024) |
| Money and terms | `total`, `delivery_fee` (0016), `points_used` (0017), `payment_terms` CK `advance` / `cod` / `days`, `payment_days`, `payment_term` (0020, free text as the hub's form), `pay_by` (0108), `finance_check` boolean (0019), `no_proof_reason` CK `on_terms` / `payment_to_follow` / `paid_no_slip` / `other` (0047, 0084), `no_proof_note`, `relief_kind` CK `senior` / `pwd`, `relief_id_no`, `relief_name` (0083), `gl_number`, `gl_amount`, `gl_set_by`, `gl_set_at` (0123), `cod_collected`, `cod_collected_by`, `cod_noted_by`, `cod_noted_at` (0115) |
| Delivery | `delivery_address`, `receiver`, `receiver_phone`, `note`, `expected_on`, `warehouse_id` FK, `delivery_method` CK `courier` / `rider` / `pickup`, `courier`, `tracking`, `tracking_wait` (0089), `rider`, `packed_at/by`, `shipped_at/by`, `delivered_on`, `delivered_at/by`, `received_by` (text: who signed), `address_checked_at/by` (0089) |
| Who has it | `approved_at/by`, `finance_checked_at/by` (0012), `manage_by`, `manage_by_at` (0046), `finance_by`, `finance_by_at` (0105), `dispatch_by`, `dispatch_by_at` (0024), `papers_checked_by/at` (0111), `stock_reason` (0084), `no_rx_reason` (0122) |
| Times | `created_at`, `submitted_at`, `updated_at` |

Indexes: `(status, updated_at)`, `(medrep_id, created_at desc)`, `(customer_id, created_at desc)`,
`shipped_at` (partial), `seat_id`, `lead_id` (partial).

**`order_item`** (0008) — `order_id`, `medicine_id` FKs, `qty > 0` (pieces), `price_kind` (free
text: which of the medicine's prices), `list_price`, `unit_price`, `price_reason`, `relief`
(0014), `free` (0020), `offer_id` FK (0086), `name_then`, `strength_then`, `form_then`,
`vat_then` (0095: frozen when the invoice is made). Index on `order_id` only.

**`order_event`** (0008) — `order_id`, `kind` (free text), `stage` (free text; the comment names
created, approved, finance_verified, invoiced, paid, packed, shipped, delivered, completed),
`message`, `by_person` NOT NULL, `at`.

**`order_step`** (0023) — `order_id`, `status`, `entered_at`, `left_at`, `how` (0025: courier
name / "Our rider" / "Picked up"). Written only by triggers.

**`order_version`** (0083) — `order_id`, `n`, `kind` CK `placed` / `fixed` / `changed`,
`by_person`, `at`, `why`, `lines jsonb`, `total`. UQ `(order_id, n)`.

**`order_ask`** (0093) — `order_id`, `asked_by`, `asked_to`, `as_who` CK `team_lead` /
`business_mentor`, `question`, `asked_at`, `answer` boolean, `answer_note`, `answered_at`, `withdrawn_at`.

**`order_check`** (0116) — PK `(order_id, check_key)`; `check_key` CK `papers` / `price` / `stock`
/ `customer` / `finance_papers` / `finance_dues` / `finance_credit` (last three 0117); `by_person`, `at`.

**`order_assignment`** (0107) — `order_id`, `desk` CK `management` / `finance` / `dispatch`,
`person_id`, `how` CK `given` / `took` / `released` / `stopped`, `at`, `by_person`.

**`desk_shift`** (0106) — `person_id`, `desk` CK `management` / `finance` / `dispatch`,
`started_at`, `ended_at`, `started_by`, `ended_by`, `end_reason`.

### 3.6 Finance (this CRM's own invoices and money)

**`invoice`** (0012) — `code` UQ NOT NULL, `order_id` UQ NOT NULL (one invoice per order),
`customer_id`, `invoice_from` CK `2mg` / `getmeds`, `terms` CK `advance` / `cod` / `days`,
`issued_on`, `due_on`, `total`, `vatable`, `vat`, `exempt`, `zero_rated`, `paid`, `refunded`,
`credited` (0050: what returns took off), `status` CK `open` / `paid` / `cancelled`,
`cancelled_reason`, `cancelled_at`, `by_person`, `at`. `total + credited` = what it was made for.

**`payment`** (0012) — `invoice_id`, `customer_id`, `amount > 0`, `method` CK `cash` / `bank` /
`check` / `ewallet` / `other` / `points` (0017) / `withholding` (0088) / `credit` (0092) /
`deduction` (0099), `reference`, `paid_on`, `proof_id` FK → order_file, `note`, `by_person`,
`at`, `active`, `removed_reason`, `removed_by`, `removed_at`, `payer` CK `customer` / `agency`
(0017), `credit_doc_id` FK → book_doc, `credit_refund_id` FK → refund (0092), `money_account`
(0096, free text: the ledger account it went into), `deduction_kind` CK `near_expiry` /
`listing_fee` / `promo` / `penalty` / `other` (0099).

**`refund`** (0012) — `invoice_id`, `amount > 0`, `method` CK `cash` / `bank` / `check` /
`ewallet` / `other` / `credit` (0092), `reference`, `refunded_on`, `note`, `by_person`, `at`,
`money_account` (0096).

### 3.7 Books and ledger

**`book_doc`** (0069) — every accounting document, Zoho's and the CRM's.

| Column | Meaning |
|---|---|
| `kind` CK (22 values) | `purchase_order`, `purchase_receive`, `bill`, `vendor_payment`, `vendor_credit`, `sales_order`, `invoice`, `customer_payment`, `sales_return`, `credit_note`, `package`, `shipment`, `transfer_order`, `adjustment`, and from 0077: `expense`, `journal`, `transfer_fund`, `deposit`, `refund`, `recurring_bill`, `recurring_expense`, `fixed_asset` |
| `zoho_id` | Zoho's id; UQ `(kind, zoho_id)` where present. Null = made here |
| `number`, `reference`, `doc_date`, `due_date` | |
| `status` | Zoho's own word, free text (`issued`, `paid`, `void`, `draft`, `pending_approval`, `published`…). The ledger views ignore `void`, `draft`, `pending_approval` |
| `supplier_id`, `customer_id`, `party_name` | The party; the name is kept even when matched |
| `currency`, `fx_rate`, `sub_total`, `total`, `balance` | Centavos of the document's currency |
| `payment_terms`, `notes`, `fields jsonb` | `fields` holds every other Zoho field |
| `purchase_id` | FK → purchase: this CRM's own record behind it |
| `warehouse_id`, `voided_by`, `voided_at`, `void_reason` | (0072) |
| `money_account`, `from_account`, `party_account` | (0078) Copied out of `fields` by a trigger |
| `bank_charges`, `withheld`, `tax_account` | (0080, 0082) Same trigger |
| `reverse_on`, `reversal_of` | (0101) Self-reversing journals |
| `created_by`, `created_at`, `zoho_created`, `zoho_modified` | |

Indexes: `(kind, doc_date desc, id desc)`, `(kind, lower(number))`, `(supplier_id, kind)`,
`(customer_id, kind)`, `lower(money_account)`.

**`book_line`** — `doc_id`, `n`, `medicine_id`, `item_name`, `sku`, `description`, `account`
(free text: an account's name), `warehouse` (text), `unit`, `qty numeric(16,3)`, `rate
numeric(18,4)`, `tax_name`, `tax_pct`, `tax_amount`, `amount`, `qty_done jsonb`, `batches jsonb`,
`fields jsonb`, `from_line` FK → book_line, `batch_id` FK (0072).

**`book_link`** — `from_doc`, `to_doc` FKs, `amount`, `on_date`; UQ `(from_doc, to_doc)`.

**`book_item`** (0074) — `zoho_id` UQ, `name`, `sku`, `status`, `item_type`, `unit`, `rate`,
`purchase_rate`, `reorder_level`, `zoho_stock jsonb`, `batches jsonb`, `fields`, `medicine_id` FK,
`zoho_created`, `zoho_modified`. **`book_price_list`** — `zoho_id` UQ, `name`, `currency`, `kind`,
`details`, `scheme`, `rounding`, `status`, `fields`.

**`book_account`** (0077) — `zoho_id` UQ, `name` (UQ on `lower(name)`), `code`, `type` (free text
key: bank, cash, expense, income, other_current_asset…), `parent_id` FK → book_account,
`description`, `currency`, `active`, `fields`, `created_by`, `created_at` (0101).

**`book_activity`** (0077) — Zoho's log: `zoho_id` UQ, `at`, `user_name`, `role_name`,
`operation`, `transaction_type`, `transaction_id`, `transaction_name`, `customer_name`,
`description`, `fields`.

**`book_ledger`** (0079) — `doc_id` FK, `kind`, `on_date`, `account` (text, nullable), `debit`,
`credit`. **No primary key.** Emptied and refilled by `refresh_book_ledger()`.

**`book_option`** (0101) — PK `(field, value)`, `sort`, `active`. Seeded: Cost Centre (3), Type
(4), Company (2), Department (22). **`book_tax`** — `name` UQ, `pct`, `kind` CK `vat` /
`withholding` / `other`, `active`; 7 seeded.

**`book_lock`** (0101) — PK `module` CK `all` / `sales` / `purchases` / `banking` / `accountant`;
`lock_date`, `reason`, `locked_by`, `locked_at`. **`book_lock_event`** — `module`, `action` CK
`lock` / `unlock`, `lock_date`, `reason`, `by_person`, `at`.

**`bank_import`** (0102) — `account`, `file_name`, `lines`, `by_person`, `at`.
**`bank_line`** — `account`, `on_date`, `description`, `reference`, `amount` CK ≠ 0 (+ in, − out),
`fingerprint` UQ, `status` CK `uncategorized` / `matched` / `categorized` / `excluded`,
`entry_key` (`books:<doc>` or `crm:<kind>:<id>`; UQ among matched/categorized lines), `import_id`
FK, `zoho_id` UQ, `done_by`, `done_at`, `created_at`.
**`bank_reconciliation`** — `account`, `start_date`, `end_date`, `opening`, `closing`, `status` CK
`done` / `undone`, `by_person`, `at`, `undone_by`, `undone_at`.
**`bank_cleared`** — PK `(reconciliation_id, entry_key)`, `amount`.

### 3.8 Dispatch

Dispatch has one table of its own; the rest of its state is columns on `sales_order` (3.5).

**`order_pick`** (0013) — `order_id`, `order_item_id`, `batch_id`, `warehouse_id` FKs, `qty > 0`,
`unit_cost` (what a piece cost to land then), `by_person`, `at`, `active`, `returned_at`. A box
unpacked keeps its rows, marked inactive.

### 3.9 Returns

**`sales_return`** (0050) — `code` UQ (`RET-00001`), `order_id` FK, `status` CK `requested` /
`approved` / `checked` (0091) / `received` / `rejected` / `cancelled`, `reason` CK `expired` /
`damaged` / `wrong_item` / `not_needed` / `other`, `goods` CK `coming_back` / `customer_keeps` /
`not_shipped` (0091), `note`, `requested_by/at`, `decided_by/at`, `decided_note`,
`received_by/at`, `credit ≥ 0`, `credited_by`, `credited_at` (0091).

**`sales_return_line`** — `return_id`, `order_item_id`, `medicine_id`, `qty > 0`, `unit_price`,
`outcome` CK `restocked` / `damaged` / `missing` / `kept` (0091), `batch_id`, `warehouse_id`.

### 3.10 Online desk, websites and points

**`lead`** (0014) — a case; 56 columns.

| Group | Columns |
|---|---|
| Who | `code` UQ (`ENQ-00001`), `name`, `relation`, `patient_name`, `phone`, `phone_key`, `email`, `city`, `address`, `customer_id` FK, `assigned_to` FK, `created_by` (nullable since 0015), `created_at`, `legacy_id` UQ (0052) |
| Where from | `source` CK `messenger` / `facebook` / `instagram` / `website` (0016) / `website_2mg` / `website_capsandpills` / `phone` / `walk_in` / `referral` / `email` / `other`; `site_account_id` FK; `case_type` CK `enquiry` / `website_order` (0016); `desk` CK `online` / `pap` (0048) |
| How they pay | `road` CK `regular` / `senior` / `pwd` / `gl`; `agency` CK `dswd` / `pcso` / `ovp` / `op`; `buyer_kind` CK `hospital` / `doctor` / `drugstore` / `distributor` / `government` (0113); `points_to_use` (0017) |
| Quotation | `request`, `quote_lines jsonb`, `quote_road`, `quote_agency`, `quote_buyer` (0113), `quote_saved_at`, `quote_sent_via`, `quote_sent_at`, `canvass jsonb` (0048) |
| Guarantee letter | `gl_applied_on`, `gl_letter_no`, `gl_amount`, `gl_letter_on`, `gl_expires_on` (0048), `gl_verified_at/by`, `claim_sent_on`, `claim_ref` (0048) |
| State | `state` CK `open` / `lost`, `lost_reason`, `order_id` FK, `first_contact_at`, `last_activity_at`, `opened_at` |
| Conversation (0015) | `chat_channel` CK `messenger` / `email`, `chat_account_id` FK, `chat_key`, `awaiting_reply`, `last_message`, `last_message_at`, `last_inbound_at`, `read_at`, `seen_at` |

**`lead_event`** — `lead_id`, `kind`, `message`, `by_person` (nullable), `at`.
**`lead_message`** (0015) — `lead_id`, `channel` CK `messenger` / `email`, `account_id` FK,
`direction` CK `in` / `out`, `external_id` (UQ per account), `subject`, `text`, `files jsonb`,
`reaction`, `by_person`, `at`, `created_at`.

**`channel_account`** (0015) — `kind` CK `messenger` / `email` / `website` (0016), `key`, `name`,
`secret` (sealed), `intake` CK `screen` / `all`, `cursor jsonb`, `synced_at`, `sync_error`,
`active`, `connected_by`, `connected_at`, `config jsonb` (0016). UQ `(kind, key)`.

**`inbox_event`** (0015) — `page_key`, `account_id`, `event_key`, `payload jsonb`, `state` CK
`pending` / `done` / `failed` / `skipped` / `unrouted`, `attempts`, `next_at`, `error`,
`created_at`, `done_at`. UQ `(page_key, event_key)`.

**`email_held`** — `account_id`, `address`, `name`, `subject`, `snippet`, `files`, `message_id`,
`source bytea` (the raw email), `at`, `state` CK `held` / `let_in` / `ignored`, `decided_by/at`.
UQ `(account_id, message_id)`. **`email_sender`** — PK `(account_id, address)`, `verdict` CK
`allowed` / `ignored`, `by_person`, `at`.

**`web_order`** (0016) — `account_id`, `ref` (UQ together), `status` (the website's word, free
text), `placed_at`, `source_at`, `customer jsonb`, `items jsonb`, `money jsonb`,
`payment_method`, `benefit`, `assistance`, `is_b2b`, `account_ref`, `account_phone`, `admin_url`,
`status_url`, `files jsonb`, `lead_id` FK, `card_note`, `push_status` CK `confirmed` / `shipped` /
`delivered` / `cancelled` / `quotation_sent` (0121), `push_reason`, `push_error`,
`push_attempts`, `push_next_at`, `pushed_at`, `points_reservation uuid`, `points_redeemed`
(0018), `pushed_tracking` (0119), `letter` CK `needed` / `quoted` (0121), `created_at`, `updated_at`.

**`web_request`** — `account_id`, `kind` CK `prescription` / `enquiry`, `ref`, `customer jsonb`,
`message`, `file jsonb`, `lead_id`; UQ `(account_id, kind, ref)`. **`web_call`** — `account_id`,
`site`, `event`, `ref`, `outcome`, `error`, `at`. **`web_catalog_sent`** (0120) — PK
`(account_id, medicine_id)`, `hash`, `sent_at`. **`web_retired_product`** — PK `web_id uuid`,
`code`, `name`, `strength`, `sent_to bigint[]`.

**`quotation_link`** (0017) — `lead_id`, `token_hash` UQ, `snapshot jsonb`, `expires_at`, `created_by`, `created_at`, `opened_at`.

**Points** (0017, 0018): **`points_account`** `phone_key` UQ, `customer_id`, `name`, `balance`,
`earned`, `spent`. **`points_entry`** `account_id`, `kind` CK `earn` / `spend` / `release` /
`adjust`, `points`, `order_id`, `reference`, `note`, `origin` UQ (what made it, once),
`by_person`, `at`. **`points_settlement`** PK `order_id`; `account_id`, `rate_bps`, `paid`,
`credited`, `revision`. **`points_login`** `phone_key` UQ, `name`, `password_hash`, `account_id`,
`failures`, `blocked_until`, `quiet_failures`, `quiet_blocked_until`. **`points_session`**
`login_id`, `token_hash` UQ, `expires_at`, `active`. **`points_web_account`** PK `(site,
account_ref)`; `phone_key`, `account_id`, `order_ref`, `bound_at`. **`points_reservation`** `id
uuid` PK (`gen_random_uuid()`), `account_id`, `site`, `request_key`, `reference`, `points > 0`,
`state` CK `reserved` / `spent` / `released`, `order_id`; UQ `(account_id, request_key)`.

### 3.11 Field work

**`visit`** (0039; 38 columns after 0129) — `person_id`, `seat_id`, `customer_id`, `day`,
`status` CK `planned` / `done` / `skipped` / `missed` (0129), `checked_in_at`, `check_in_place`,
`distance_m` (0040), `done_at`, `objective` (old single text), `objectives text[]`,
`objective_note`, `detailed jsonb`, `notes`, `next_day`, `skip_reason`, `from_visit` FK → visit,
`made_by`, `made_at`, and from 0129: `working_with bigint[]`, `priority` 1–3, `unplanned`,
`added_why`, `meeting` CK `met` / `not_met` / `unavailable` / `cancelled`, `nature` CK
`promotional` / `business` / `both`, `outcome` CK `business` / `opportunity` / `follow_up` /
`none`, `productive` CK `yes` / `no` / `pending`, `judged_by`, `judged_at`, `judge_note`,
`feedback`, `chance_amount`, `chance_on`, `call jsonb`, `closed_place`, `closed_distance_m`,
`draft jsonb`. CK: `done` needs `checked_in_at` and `done_at`; `skipped` and `missed` need
`skip_reason`. UQ `visit_once`: one planned-or-done visit per person, customer and day.

**`visit_plan`** (0040) — `person_id`, `month` (1st), `status` CK `draft` / `sent` / `approved` /
`sent_back`, `sent_at`, `decided_by`, `decided_at`, `note`, `revision` (0129). UQ `(person_id, month)`.

**`visit_change`** (0129) — `visit_id`, `what` CK `added` / `moved` / `skipped` / `missed` /
`closed` / `reopened` / `judged`, `from_day`, `to_day`, `note`, `by_person`, `at`.
**`visit_order`** — PK `order_id`; `visit_id`, `at`.

**`plan_day`** (0129) — PK `(person_id, day)`; `work_type` CK `hq` / `ex_station` / `out_station`
/ `transit` / `other`; `cities text[]`, `working_with bigint[]`, `note`.
**`plan_revision`** — `plan_id`, `revision` (UQ together), `status` CK `approved` / `sent_back`,
`decided_by`, `decided_at`, `note`, `days jsonb`, `visits jsonb`.
**`plan_deviation`** — `person_id`, `day`, `kind` CK `moved` / `added` / `dropped` / `place`,
`visit_id`, `from_day`, `to_day`, `note`, `status` CK `waiting` / `approved` / `rejected`,
`decided_by`, `decided_at`, `decision_note`, `made_at`.

**`field_day`** (0129) — `person_id`, `seat_id`, `day` (UQ per person), `work_type` (same 5
values), `work_note`, `cities`, `working_with`, `started_at`, `start_place`, `start_accuracy_m`,
`ended_at`, `end_place`, `report_status` CK `open` / `sent` / `seen`, `report_note`, `sent_at`,
`seen_by`, `seen_at`, `seen_note`. **`field_day_event`** — `day_id`, `kind` CK `start` / `place` /
`break` / `resume` / `stop`, `at`, `place`, `work_type`, `cities`, `note`.

**`field_expense`** (0040, reshaped 0129) — `person_id`, `seat_id`, `day`, `kind` CK `petrol` /
`fare` / `parking` / `toll` / `food` / `lodging` / `other` (the old kinds; nullable since 0129),
`head` FK → field_expense_head (0129), `amount`, `km`, `visit_id`, `note`, `receipt_name`,
`receipt_mime`, `receipt_size`, `receipt_data bytea`, `receipt_key` (0051), `status` CK `open` /
`pending` / `approved` / `sent_back`, `decided_by`, `decided_at`, `decision_note`, `made_at`,
`auto`, `generated`, `approved_amount` (0129). CK: a kind or a head is set; `amount ≥ 0` and
`> 0` unless `open`; a receipt unless it has a head or is a fare. UQ one automatic line per
`(person_id, day, head)`.

**`field_expense_head`** (0129) — PK `code`; `name`, `allowance` CK `per_diem` / `ta`,
`needs_bill`, `active`, `sort`. 24 heads seeded. **`field_allowance`** — PK `work_type` (5
values), `per_diem`, `ta`, `set_by`, `set_at`; 5 rows seeded at zero.

**`field_follow_up`** — `person_id`, `customer_id`, `visit_id`, `due_on`, `kind` CK `visit` /
`order` / `payment` / `product` / `opportunity` / `other`, `what`, `status` CK `open` / `done` /
`dropped`, `done_at`, `done_note`, `made_at`. **`field_prescribing`** — PK `(customer_id,
medicine_id)`; `prescribing`, `top5`, `by_person`, `at`. **`live_location`** (0042) — PK
`person_id`; `place`, `accuracy_m`, `at` (latest only, no trail).

### 3.12 HR

**`employee`** (0037) — PK `person_id`. `company` CK `2mg` / `gpi`, `employee_code` (UQ per
company, upper-cased), `status` CK `active` / `left`, `classification` CK `probationary` /
`regular` / `part_time` / `intern`, `position`, `department`, `hire_date` NOT NULL,
`regularized_on`, `left_on`, `left_reason`, `mobile`, `personal_email`, `birth_date`, `address`,
`emergency_name/phone/relation`, `salary`, `allowance` (monthly centavos), `bank_name`,
`bank_account`, `sss`, `philhealth`, `pagibig`, `tin`, `profile_done_at`, `created_at/by`,
`updated_at/by`, `no_sss`, `no_philhealth`, `no_pagibig`, `no_tax` (0044). This is the most
sensitive table in the database (pay, bank account, government numbers) and none of it is
encrypted at column level (CONFIRMED: plain `text` / `integer`).

**`work_schedule`** (0034) — `name`, `days integer[]` (0 Sunday … 6 Saturday), `starts`, `ends`
(CK ends > starts), `grace_minutes` 0–120, `break_minutes` 0–240, `is_default` (UQ: one active
default), `active`. 0035 set the default to Monday–Saturday 07:00–16:00, no grace.

**`holiday`** (0034) — `day` (UQ among active), `name`, `kind` CK `regular` / `special`, `active`.
0036 seeds the 20 national holidays of 2026. Nothing seeds 2027 (see findings).

**`attendance`** (0034) — `person_id`, `day` (UQ together), `time_in`, `in_source` CK `sign_in` /
`button` / `field` / `hr`, `time_out`, `out_source` CK `button` / `last_seen` / `field` / `hr`,
`last_seen`, `in_place`, `out_place`, `note`, `changed_by`.

**`person_leave`** (0039) — `person_id`, `kind` CK `vl` / `sl` / `lwop` / `other`, `from_day`,
`to_day`, `half_day`, `reason`, `status` CK `asked` / `approved` / `refused` / `cancelled` (0041),
`made_by`, `made_at`, `cancelled_by/at`, `approver_id`, `decided_by/at`, `decision_note`,
`file_name`, `file_mime`, `file_data` (0041), `file_key` (0051).

**`hr_form`** (0043) — `person_id`, `kind` CK `ob` / `wfh` / `ot`, `day`, `from_time`, `to_time`,
`place`, `reason`, `status` CK `asked` / `approved` / `refused` / `cancelled`, `approver_id`,
`decided_by/at`, `decision_note`, `made_by/at`, `cancelled_by/at`. UQ one live form per person,
kind and day.

**`pay_rule`** (0044) — `kind` CK `sss` / `philhealth` / `pagibig` / `tax`, `starts_on` (UQ with
kind), `rule jsonb`, `source`, `made_at`. Four rules seeded in the migration.
**`pay_adjustment`** — `month` text `YYYY-MM`, `person_id`, `label`, `kind` CK `earning` /
`deduction`, `taxable`, `amount > 0`, `note`, `made_by/at`, `removed_by/at`.
**`pay_run`** — `month` UQ, `period_from`, `period_to`, `pay_day`, `people`, `gross`,
`deductions`, `net`, `employer`, `released_by`, `released_at`.
**`payslip`** — `run_id`, `month`, `person_id` (UQ with run), `company`, `gross`, `net`, `tax`, `slip jsonb`.

### 3.13 The sales channels' own work

**`doctor_list`** (0059) — `seat_id`, `customer_id`, `tier` CK 1 / 2 / 3, `set_by`, `set_at`,
`ended_at`, `ended_by`. UQ one open line per seat and doctor.

**`care_group`** (0060) — `doctor_id` FK → customer, `name`, `enrolled_by`, `seat_id`, `consent`
(CK must be true), `patients`, `note`, `enrolled_at`, `telesales_id`, `first_contact_at`,
`last_activity_at`, `closed_at`, `closed_by`, `close_reason`.

**`b2b_account`** (0061) — PK `customer_id`; `nbd_id`, `crr_id` FKs → person, `next_call_on`,
`handed_over_at/by`, `dropped_at`, `dropped_reason`, `created_at`.

**`account_call`** (0061) — `customer_id` (nullable since 0103), `customer_text`, `seat_id`
(0103), `by_person`, `at`, `outcome` CK `reached` / `no_answer` / `call_back` / `ordered` /
`not_interested` / `won_back`, `note`, `next_on`. CK a customer or a typed name.

**`clidp_listing`** (0063) — `customer_id`, `medicine_id`, `brand`, `certificate_no`,
`valid_until`, `added_by`, `added_at`. **`clidp_account`** (0127) — `customer_id` UQ, `coach_id`,
`stage` CK `approached` / `interested` / `agreed` / `filed` / `listed` / `ordering` / `declined`,
one date per stage, `declined_reason`, `agreement_until`, `next_step`, `next_on`, `note`.
**`clidp_account_event`** — `account_id`, `stage`, `note`, `by_person`, `at`. **`clidp_rate`** —
`customer_id`, `medicine_id`, `unit_price`, `moq`, `agreed_on`, `by_person`, `at`, `replaced_at`.

**`tender`** (0064; 41 columns) — `code` UQ (`TND-YYYY-NNNN`), `agency_id` FK → customer, `title`,
`philgeps_ref`, `mode` CK `competitive_bidding` / `limited_source` / `direct_contracting` /
`direct_acquisition` / `repeat_order` / `small_value` / `negotiated` / `direct_sales` / `other`,
`abc`, `owner_id`, `seat_id`, `step` CK `found` / `preparing` / `price_approved` / `submitted` /
`won` / `lost` / `contract` / `delivered` / `accepted` / `billed` / `paid` / `dropped`, the dates
(`posted_on`, `prebid_on`, `deadline_at`, `opening_on`, `noa_on`, `ntp_on`, `deliver_by`,
`delivered_on`, `accepted_on`, `billed_on`, `paid_on`), `our_bid`, `winning_bid`, `result_note`,
`order_id` FK → sales_order, `bid_security_form/amount/back_on`, `price_approved_by`, `papers
jsonb`, `dropped_reason`, and from 0126: `result_reason` CK `lowest` / `lower_price` /
`above_abc` / `documents` / `post_disqualified` / `failed_bidding` / `other`, `result_on`,
`performance_security_form/amount/back_on`, `retention_amount`, `retention_back_on`.
**`tender_line`** — `tender_id`, `medicine_id`, `qty`, `unit_price`, `replaced_at` (0065).
**`tender_event`** — `tender_id`, `step`, `note`, `by_person`, `at`. **`tender_bidder`** (0126) —
`tender_id`, `name`, `price`, `lines jsonb`, `disqualified`, `note`, `by_person`, `at`, `replaced_at`.
**`company_paper`** — `name`, `number`, `expires_on`, `note`, `added_by`, `added_at`.

**`mt_listing`** (0066) — `customer_id`, `medicine_id`, `branches`, `listed`, `note`, `added_by`, `added_at`.

**`hospital_accreditation`** (0128) — `customer_id`, `status` CK `applied` / `accredited` /
`refused`, `on_day`, `valid_until`, `note`, `by_person`, `at`. **`hospital_formulary`** —
`customer_id`, `medicine_id`, `status` CK `requested` / `approved` / `not_approved` / `removed`,
`on_day`, `doctor`, `note`, `by_person`, `at`. In both, the latest line stands.

### 3.14 Regulatory

**`pipeline_product`** (0068) — `name`, `generic`, `strength`, `partner`, `country`, `stage` CK
`identified` / `talks` / `agreement` / `dossier` / `filed` / `registered` / `launched` /
`dropped`, `handled_by`, `next_step`, `next_on`, `note`, `added_by`, `added_at`, `updated_at`.

**`product_registration`** — `medicine_id`, `pipeline_id` FKs, `product`, `number`, `status` CK
`preparing` / `filed` / `approved` / `renewal_filed` / `expired` / `withdrawn`, `filed_on`,
`valid_until`, `handled_by`, `note`, `added_by`, `added_at`, `updated_at`.

**`reg_event`** — `pipeline_id`, `registration_id` (CK one is set), `what`, `by_person`, `at`.

**`complaint`** (0100) — `code` UQ (`CMP-00001`), `kind` CK `quality` / `side_effect` / `delivery`
/ `service` / `other`, `serious`, `customer_id`, `patient_name`, `medicine_id`, `batch_no`
(text), `order_id`, `description`, `received_on`, `due_on`, `status` CK `open` / `investigating`
/ `closed`, `owner_id`, `fda_ref`, `outcome`, `reported_by`, `reported_at`, `closed_by`,
`closed_at`. **`complaint_event`** — `complaint_id`, `message`, `by_person`, `at`.

### 3.15 Files

Rule (CLAUDE.md): every file's bytes go through `src/files/store.ts`. The row keeps the bytes
(`STORAGE_DRIVER=db`) or only a bucket key (`s3`).

| Table | Belongs to | `kind` values | Bytes / key columns | Check "bytes or key" |
|---|---|---|---|---|
| `order_file` (0011) | sales_order | `po`, `hospital_doc`, `payment_proof`, `prescription`, `valid_id`, `senior_id`, `med_cert`, `gl`, `dr`, `other` (0049) | `data`, `store_key` | yes (0051) |
| `lead_file` (0014) | lead | `rx`, `osca_id`, `pwd_id`, `pwd_booklet`, `valid_id`, `med_cert`, `gl_letter`, `pickup_photo`, `other`, `unsorted` (0048) | `data`, `store_key`; `legacy_id` UQ | yes (0051) |
| `customer_file` (0085) | customer | `bir_2303`, `lto_permit`, `business_permit` | `data`, `store_key` | yes |
| `book_file` (0075) | book_doc | none | `data`, `key` | **no** |
| `visit_file` (0129) | visit | none | `data`, `store_key` | yes |

Other columns: `name`, `mime`, `size`, `by_person`, `at`, `active` (order, lead, customer files);
`order_file.hold_event_id` FK → order_event (0047: Finance's screenshot with a hold);
`book_file.zoho_id` UQ, `uploaded_by`, `uploaded_on` (text, as Zoho wrote them).

Files kept as columns of another table: `field_expense.receipt_*`, `person_leave.file_*`,
`sample_move.ack_*`, `email_held.source` (a raw email, always in the row).

### 3.16 System

**`counter`** (0011) — PK `name`, `value bigint`. Rows: `order`, `invoice:2mg`,
`invoice:getmeds`, `lead`, `return`, `sample_request`, `complaint` (section 6.4).

**`setting`** (0017) — PK `key`, `value jsonb`, `updated_by`, `updated_at`. Seeded keys:
`company` (the letterhead: name, address, phone, email, TIN, licence, footer, signatory) and
`points` (`enabled`, `rateBps`).

**`schema_migration`** — PK `name`, `applied_at`.

---
