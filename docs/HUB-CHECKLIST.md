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
  (Go back / Proceed anyway; Dispatch and Management told); **Buy 1 Take 1** badge "+N free" and a
  locked ₱0 line (added by the server).
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
