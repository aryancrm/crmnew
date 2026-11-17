# The old hub: every button and rule, from its code (17 Nov 2026)

The companion of docs/HUB-WALKTHROUGH.md (what was seen on localhost). This list is read from the
hub's code (github.com/manila404/getmeds-system) so nothing is missed; items marked ✅ were also
pressed on localhost, the rest are to press. Gaps the hub has are marked **Gap**.

## MedRep

- Menu: Create New Order, Dashboard, My Orders, Clients Directory, Announcements (unseen badge). ✅
- New order, before the form: "Who is this order for?" Myself / Another MedRep (Continue disabled
  until picked) ✅; a banner when the account has no Zoho Salesperson or Zoho does not know it.
- Section 1: date (today) ✅; MedRep (yours, or a search of active MedReps / Team Leads when for
  another); Zoho Salesperson (only the owner's; none → "cannot be submitted yet, an admin assigns
  one"; Change who this is for) ✅; Division (14 values, editable for this order; a second
  salesperson switches it) ✅; Sub-division / Headquarter fill by rule: B&B / URO / STC → MD
  Telesales + branch list, salesperson "DIV | HQ"; B2C → MD Telesales / B2C; HOS → Hospital / N/A;
  CLIDP → CLIDP / ON SITE; B2B → CRR or NBD / ON SITE; others free text.
- PAP tick "This order is from a Patient Assistance Program" (B&B, URO, STC, HOS, B2C): DSWD, PCSO,
  Office of the President, Other → sub-division / HQ Telesales, the program fills Source, a GL file
  becomes required; PAP-department accounts start ticked.
- Section 2: customer search, + Add new customer, Show inactive clients (greyed, cannot be picked)
  ✅; credit / direct from the customer (Zoho business / individual) ✅. **Gap**: the help text says
  credit "routes to Dispatch", but every order goes to Finance; credit vs direct only changes who
  is told after approval (direct → Finance "requires payment verification"; credit → Dispatch).
- Hospital customers only (tagged hospital): GL number, receiver (patient / representative), and
  a checklist GL, Prescription, Proof of payment, Valid ID — all optional; an untagged customer
  shows "not classified" ✅. TIN from Zoho, a typed TIN is saved to the customer ✅.
- Required: delivery address, payment terms ("Paid" refused), source (13), invoicing from,
  delivery method, customer remarks, expected shipment date ✅. Optional: receiver, contact,
  doctor (suggested from doctor customers), "is the customer the doctor" ✅.
- **New customer** (from the form): Patient / Doctor / Hospital / Distributor, required fields by
  type; a hospital also needs **BIR 2303, LTO permit and business permit** files; exact duplicate
  → "already exists — select them"; close match → "None of these — create anyway"; result "Created
  in Zoho" or "Saved — but not in Zoho yet" (goes to Management's Pending Customers; the order can't
  reach Zoho until the customer does).
- Section 3: product search; same product again = a new line; Qty, **Price (MedRep may change
  it, no check)** ✅, Discount (flat ₱, never sent to Zoho) ✅, Tax per line ✅, price remark
  (optional, 300 chars) ✅; tax inclusive / exclusive ✅; per-line Invoicing From → "split order:
  two Zoho Sales Orders"; Dispatch's stock announcements shown on the items; submitting with a
  flagged item opens "Dispatch has flagged an item…" with a required "Why are you proceeding?"
  (Go back / Proceed anyway; Dispatch and Management told) ✅; **Buy 1 Take 1** ✅ (posted from
  Announcements by Dispatch / Management / Finance: "every new order with this product gets the
  same quantity again, free (₱0) until you end it"): the form shows "📢 Announcements about items
  in this order", the line "🎁 Buy 1 Take 1 · +N free" and a locked ₱0 line marked "auto".
- Section 4: files by drag, paste, camera; type per file ✅; "No proof of payment? Say why" (not
  for Management) ✅; "No prescription? Say why" required for URO, STC, B&B, B2C (HOS only a nudge).
  **Gap**: Pharmacy also covers TeleSales, TeleSales Anesthesia, MD Telesales, which the form does
  not ask.
- Submit: "Missing: …" list, Submit disabled until empty ✅; Confirm window ✅; success with the
  GM number ✅. MedRep's order → Pending Management Approval; owner and **all** Management told.
- My Orders: search, chips, 15 per page, "for X" / "raised by X" ✅. **Gap**: no chip for the two
  statuses new orders land in. Dashboard tiles also miss them ✅ (seen: "0 pending").
- Order page: tabs ✅, Order overview ✅; before the Zoho SO: Edit Details ✅ and Edit Items (MedRep
  can't change the price) ✅; after: hidden. Retry Zoho Sync ✅ / Sync from Zoho ✅. Sent back →
  Resubmit + corrected document ✅. On hold / exception → **Re-submit to {stage}** (Finance hold
  back to Finance; owner, raiser, Management and that stage told) ✅ seen. **Cancel & Archive**
  (reason, refund yes / no → Finance and Admin told). Prescription → Re-submit / Upload for
  Pharmacy. **Stock is back** ✅. **Mark Delivery Complete** (receiver, date; owner, raiser,
  Management told). **Request refund** / Withdraw ✅. Attachments: upload, Request deletion ✅.

### New customer from the order form ✅ (all four types opened)

"This creates the customer in Zoho straight away, and selects them for this order." Type buttons
Patient / Doctor / Hospital / Distributor.
- **Patient** (Zoho individual): salutation, first*, last*, display name*, email, phone*, TIN,
  street address*, city, country, shipping same as address.
- **Doctor** (individual, "Dr." pre-filled): first*, last*, display name*, hospital / clinic,
  email, phone*, TIN, licence owner, LTO number, LTO type, address*.
- **Hospital** (Zoho business): display name*, company, email, phone*, primary contact; **TIN*,
  licence owner*, LTO number* (unique in Zoho), LTO type*, licence issue date*, expiry date***;
  **documents BIR 2303*, LTO permit*, business permit*** (PDF or image, 10 MB); "Hospital Creation
  Restricted" lists what is missing and blocks Create.
- **Distributor** (business): the same fields and three documents, but optional, with "I'll
  follow up on the missing documents — submit anyway"; anything missing → Management reviews the
  customer before it goes to Zoho (the order can still be raised).
- An email left blank → Management reviews the customer before Zoho.

## Order statuses and Management (from the code; ✅ = pressed)

- Statuses: draft, pending_management_approval, (submitted, validating, so_pending, so_created —
  logged only), ready_for_finance_verified, ready_for_draft_invoice, ready_for_invoice_sent,
  ready_for_dispatch, picking_packing, dispatched, tracking_shared, on_hold, exception, completed,
  cancelled, deleted.
- Who goes to approval: a MedRep's or Team Lead's order, and **every B2B order** ✅; Management /
  Admin non-B2B orders skip approval and go to Zoho at once (only the raiser told). **Trap**: if
  Management presses Submit / Resubmit on a non-B2B draft, it skips approval and gets a new GM id.
- **No "save draft" button** on the form (drafts come only from send back or the API).
- Approve ✅ → Finance stage; told: MedRep, then Finance (direct) or Dispatch (credit); not the
  raiser or other managers. Send back ✅ / Reject ✅ → MedRep only.
- **Hold ✅ / Exception ✅** on every open status (browser prompt). Hold works from pending, Finance
  stages, ready for dispatch, picking; refused from draft, dispatched, tracking shared. Exception
  works only from dispatched, tracking shared, on hold. Told: MedRep + all Management.
- **Resume ✅** writes the chosen stage directly; **Re-submit to <stage>** (MedRep / Team Lead /
  Management) offers "Proof of payment uploaded", "Customer has settled the overdue balance",
  "Missing document attached", "Order details corrected", Other + note + file; a hold placed at the
  Finance stage goes back to Finance.
- **Cancel & Archive** (on hold / exception): reason + refund needed or not → cancelled, kept.
- Drafts ✅: Wait for stock (item ≤ 200, reason ≤ 500; reminders every 3 days by a nightly job),
  Stock is back, Cancel draft (Delete permanently disabled when paid; **Gap**: keep-record allowed
  on an unpaid draft makes a false refund-pending), Restore (refused once refunded).
- Exception Hub ✅ reads only the newest 100 orders (**Gap**: an older held order disappears).
- **Price ✅**: anyone may change price, discount, tax on the form; the only check is ≥ 0; no
  catalog comparison anywhere; Management sees total only in the queue and no catalog column on
  the order; MedRep's Edit Items locks price and discount (screen only — the API accepts any).
  Buy 1 Take 1 is added on create only, not when lines are edited.
- **Management Edit Items ✅** (search & add, qty, price, discount, tax, warehouse per line,
  Invoicing From split, remark, remove): Confirm changes old → new, "Already in Zoho — confirming
  updates the real Sales Order"; **nobody told** ✅. Edit Details: Division and Salesperson for
  Management only; nobody told.
- **Approval scope ✅**: per manager Everything / Only these divisions (none = sees nothing); orders
  with no division only for full-access managers; enforced on the queue, dashboard and order pages,
  not on the All Orders list (rows show, opening gives 403); "needs your approval" still goes to
  **all** managers; nothing stops approving your own order.
- Stock at approval ✅: per warehouse "Can fill every line" / "Short on N", per line "N held for
  other orders", "Switch to X", tick to approve anyway ✅; if Zoho can't be reached: "Stock could
  not be checked" and approval goes ahead.
- Management menu ✅ (+ by address only: Clients, Inventory, Order Ownership). Dashboard ✅ (Sync
  from Zoho: Quick / Retrieve all; Needs your attention incl. Stuck 48h, Customers pending). All
  Orders Log is titled "My Orders" with old status filters (**Gap**). Pending Customers: Push N to
  Zoho, Same customer — use Zoho's, Different — push as new, Update details, Link to existing,
  Delete. Not yet with Finance: Management can press Finance's Verify there (not role-gated).
- Order page header: Order overview ✅, Request refund ✅, Retry Zoho Sync ✅, **Fix customer
  link** (sync failed, no SO), Sync from Zoho ✅.

## Finance (from the code; ✅ = pressed)

- Orders page: stage tiles ✅, period, GetMeds / Zoho / All ✅, search ✅, Refresh ✅; Export CSV
  ("coming soon"); **Refunds pending badge** (red after 3 days).
- Details drawer ✅: hold and re-submission history, a hospital's missing-documents warning, the
  price remark under each line, no-proof reason, customer type. **No customer history** (Finance
  cannot open customers; the account is checked in Zoho Books) ✅.
- **Confirm payment…** ✅ only with a Zoho SO (else "Not in Zoho yet"); one tick ✅; → Ready for
  draft invoice, pending proofs marked verified, SO confirmed in Zoho; MedRep + Management told.
  **Gap**: the second "I checked the prices" tick is shown but not enforced; **Undo** ✅ (toast 8 s)
  **does nothing** (server bug); no screen to reject a payment proof.
- **Hold** ✅ (reason, up to 5 screenshots) → On hold; **Bring back for verification** (only a
  Finance hold; also automatic when the MedRep attaches a file).
- Split orders: Verify / Hold per company; any hold holds the whole order.
- Direct vs credit: the same buttons ✅; direct adds a payment row and tells Finance; credit tells
  Dispatch.
- My Confirmations ✅, Reports ✅, Payment History ✅ (**Gap**: a confirmed order shows "Awaiting
  Zoho"), Refunds ✅, Announcements (Finance may post Buy 1 Take 1 promos only).

## Pharmacy (Dispatch login)

- Channels HOS, Telesales, B&B, STC, URO, B2C ✅; an order appears from Finance verification to
  packing when it has a prescription or is marked not needed; tabs Awaiting review / Needs
  attention / Rejected / Verified / All ✅. Only Dispatch / Admin decide.
- **Verify prescription** (pushed to the Zoho SO; nobody told); **Reject and tell the MedRep**
  (reason; MedRep + raiser told); **Re-review**: override to verified / edit the reason / back to
  awaiting; **Undo verification**; **Decide on this** (no file): **Request prescription** (blocks
  Dispatch; MedRep told) or **Mark not required**; **Mark as Prescription** on a mislabelled file.
- The MedRep then sees "💊 Pharmacy rejected the prescription" → **Re-submit prescription to
  Pharmacy** / **Upload prescription for Pharmacy** (note required) → Dispatch told.
- Dispatch is blocked (confirm delivery, tracking, invoice, pack, ship…) while a prescription is
  pending, rejected or requested.

## Dispatch / Operation

- Pages ✅: Zoho Dispatch Status, Return checks, Pharmacy, Clients (click a client → their orders
  with prescription state), My Catered Orders (mine / all), Tracking Log, Inventory (Refresh, Quick
  Sync, Full Resync; read-only), Announcements.
- Low Stock Checker: **Announce Out of Stock / Low Stock**; announcements: Post, **Resolved — take
  down**, **End promo**.
- Buttons ✅: Cater / Take over, Release, Print address, **Confirm for delivery** (if no tracking:
  Add it now, or Not ready yet — waiting for waybill / courier pickup / courier not assigned /
  other), Add / Update tracking, **Hold tracking number**, **Hold order** (out of stock / not
  enough stock / wrong item or quantity / address or receiver / other; MedRep, raiser, Management
  told), Lift hold, **Upload proof photo** (attached to the Zoho SO).
- Couriers (free text, suggested): Own Rider, LBC Express, Grab, J&T, Lalamove, Air Asia, Victory
  Liner, Partas, Homestocks, AO Freight, Daily Overland, AP Cargo, Customer pick-up, Distributor
  delivery.
- Behind switches (off): DR workflow (batches, delivery receipt, Oojeema SI, convert to Zoho
  invoice) and V2 (Create & send invoice, Mark packed, Ship, Mark delivered in the hub).
- **Gaps**: "Tracking ready" has no button; stock adjust removed from the screen.

## Delivery and completion

- **Mark Delivery Complete** (MedRep owner / raiser, Team Lead, Management, Admin; not Dispatch or
  Finance), only after dispatch: received date, received by, notes, proof file → Completed;
  MedRep, raiser, Management told.
- Auto-complete when shipped **and** paid (paid = Zoho's payment webhook; Finance's Confirm does
  not count).

## Refunds and returns ✅ (walked)

- Request refund (owner, Team Lead, Management, Admin; one open per order): where the goods are,
  amount ≤ total; Withdraw.
- Management: not shipped / customer keeps → **Approve & refund** (order cancelled at once, even if
  completed; Finance told); coming back / returned → **Approve** (Dispatch told) → Return check
  (good / damaged + note) → **Refund** (order cancelled); **Reject** (reason).
- Finance Refunds: Refund pending / **Zoho steps** ("Payment is in Zoho, check", "Credit note is
  in Zoho, check" with number) / Refund done / No refund due / All; **Record refund**: outcome
  done / still pending / no refund due, amount received, refunded, reference, date, note; "done"
  only after the Zoho step. **Gap** ✅: a partial refund cancels the whole order.
- Cancelled with payment also lands here (Management's cancel with payment; Cancel & Archive with
  "refund required").

## Team Lead

- Menu: Create New Order, My Team, Team performance, Clients Directory, Announcements ✅
  (**Gap**: the Announcements badge always 0).
- Team = people whose account names them Team Lead (6 levels), people under a channel they head,
  a shared team ("shares team with"), and their own orders ✅. Not by division.
- My Team = the Management dashboard, view only ✅; Team performance (KPI switch) ✅.
- Can raise orders for team members only ("X is not on your team"); those wait for Management.
- On team orders: submit / resubmit, Mark Delivery Complete, Cancel & Archive, Request refund,
  attach files — yes; Edit Details / Items and Stock is back — own orders only.
- Approves nothing (approve, reject, send back, Finance verify, refunds, pending customers) ✅.
- Notifications only as owner or raiser — **not** for the team's orders ✅ (bell empty).

## Admin

- Menu: Global Dashboard, Reports; Customers & stock (Clients, Pending Customers, Inventory);
  KPI Scorecard group (switch); Administration (User Management, Sales KPIs, Sales Performance,
  Order Ownership, Refunds, Zoho Sync Health) ✅ partly.
- User Management: Refresh from Zoho, Refresh, Create account ✅, Accounts / Team Structure ✅, By
  team / All accounts ✅. By team: departments Admin, Finance, Sales (CHC), Operation, added ones;
  inside Sales **Management (Approval)** and "Team leads not in a division"; buttons + Team lead,
  + Manager, Edit, Change head, Move, Add person, Add / Remove department, Remove.
- **Management (Approval) → Edit access**: Everything / Only these divisions (tick) / Match the
  structure → Save. This is who approves what.
- Create account ✅. Account panel: Edit (name, username, email, role, sales title, Team Lead,
  salespersons ★) ✅, Delete, Deactivate, Approve / Reject (new accounts), Move / change role.
  **Gap**: no editing division after creation, no reactivate, no password reset by Admin.
- Order Ownership: each Zoho salesperson name → decide later / person / territory / channel /
  vacant → Preview → Assign N orders.
- Sales KPIs: People, Team leads, Heads, Channels, Raised for others, No territory, Checks, Set
  targets (pre-fill from the sales sheet, copy last month, save), Target changes; turn on for
  sales teams; CSV.
- Zoho Sync Health: pending / succeeded / failed, Retry Now.

## Notifications

- In-app bell for each recipient ✅; refreshes every 30–60 s; Mark all ✅; clicking opens the order.
- **"Management" = every Management account**, not only the order's division.
- Email: one internal email per event to the order's MedRep only (**Gap**); customer emails on
  submitted, payment verified, dispatched, completed (**Gap**: a made-up fallback address).
- Google Chat webhook for every event; Discord mirrors the audit trail (off).
- Who is told: submitted → owner + all Management; approved → owner, then Finance (direct) or
  Dispatch (credit); sent back / rejected → owner only; Finance verified / held → owner + all
  Management; resumed → owner, raiser, Management, the stage's role; hold / exception → owner +
  Management; wait for stock → owner, raiser (reminders also Management, Admin); stock is back →
  Management, owner, raiser; draft cancelled → owner, raiser (+ Finance, Admin if paid); Cancel &
  Archive / completed → owner, raiser, Management (+ Finance, Admin if refund); stock warning
  → Dispatch + Management; proof uploaded → Finance; prescription uploaded / re-submitted →
  Dispatch; proof or prescription rejected → MedRep; deletion request → Management, decision →
  requester; tracking / holds → owner, raiser (Dispatch hold also Management); Zoho webhooks →
  MedRep / Finance / Dispatch by event; refunds → Management, Admin, requester, Dispatch, Finance by
  step; Zoho sync failed → Management, Admin. **Gap** ✅ seen: Management's line edits (price, qty,
  added free goods) tell nobody.

## Search and Clients Directory

- Search (2+ letters): orders by ID, SO, customer, receiver, contact, within the role's reach;
  clients and products listed but not clickable.
- Clients Directory: My customers / All customers; chips All, Patients, Hospitals, Doctors, With
  prescription; Type Credit / Direct; Category Doctor, Hospital, Distributor, **PWD**, Patient,
  Uncategorized ✅. Read-only for sales; only Management / Admin set a category (PWD included).

## Zoho

See docs/HUB-WALKTHROUGH.md, "The hub and Zoho".
