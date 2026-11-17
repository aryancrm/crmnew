# The old hub, screen by screen (walked on localhost, 17 Nov 2026)

The old GetMeds hub (github.com/manila404/getmeds-system) run locally with its demo logins and a
mock Zoho (nothing reaches the real Zoho). Every screen opened in that role's own login, every
button pressed. This is the model for crmnew's order line (Aryan, 17 Nov: "simple, like the hub").

## MedRep (Juan dela Cruz)

- **Home** (`/medrep/dashboard`): four tiles (Total submissions, Pending & validation, In
  fulfillment, Completed), Refresh, **Create New Order**, Quick actions.
- **Create New Order**: first asks "Who is this order for?" (Myself / Another MedRep). The form:
  1. General MedRep: date, Division (list), Sub-division, Headquarter, Zoho Salesperson.
  2. Customer: search; Credit / Direct from the customer; TIN; Delivery address*, Receiver,
     Receiver contact; Payment terms* (typed with suggestions); Source* (13 choices); Is the
     customer the doctor; Doctor name; Invoicing from* (2mg / Getmeds); Delivery method*;
     Customer remarks*; Expected shipment date*.
  3. Order details: product search; per line Qty, **Price (one price per medicine, from Zoho; no
     hospital / patient / doctor lists)**, Discount, Tax (No tax / VAT 12% / Zero / Exempt),
     Invoicing from per line, price remark.
  4. Attachments: Proof of payment / GL / Prescription / Valid ID / Purchase order / Other, or
     "No proof of payment? Say why" (required).
  5. Terms & conditions.
  Submit → **Confirm Requisition Submission** summary → "Requisition Kicked Off!" with the
  tracking ID (GM-YYYYMMDD-NNNN) → Pending Management Approval.
- **My Orders**: one table (Order ID, Customer, Receiver, Status, Total, Payment, Date), status
  filter chips, search.
- **Sent back**: the order page shows a yellow band "Sent back by Management · name — What To
  Fix: …", **↩ Resubmit to Management**, and "attach the corrected document". Order Items →
  **Edit Items**: Qty, Discount, Tax, remark (the MedRep can't change the price). Saving shows
  **Confirm changes**: old line struck through → new line in green.

## Management (Carlo Tan)

- **Dashboard**: "Needs your attention" (Awaiting approval, On hold / exceptions, Stuck over
  48h), Zoho connection and Sync from Zoho, Current / Imported / All, tiles (Orders today,
  Pending payment, Ready for dispatch…).
- **Approval Queue**: one row per order (ID, customer, MedRep · terms, total, waiting) with
  **Approve — sync to Zoho / Send Back / Reject**. Send back asks "What does the MedRep need to
  fix?".
- **Order page** (click the ID): all order details with Edit Details; "Management approval" band
  (a resubmitted order says what it was sent back for: "check it was fixed"); **Approve — check
  stock & sync to Zoho / Resubmit (Send Back) / Reject / Put on Hold / Mark Exception**; tabs
  Audit Timeline, Order Items, Payment, Dispatch, Attachments.
- **Edit Items** (Management): product search adds a medicine; **price, discount and tax are
  open to Management**; a free line is a price of 0 with a remark; Confirm changes shows
  "added → Qty 10 · ₱0.00 · Free sample".
- **Approve and check stock**: every warehouse as a card ("Can fill every line" / "Short on N
  lines"), table Item / Ordered / On hand here / Stock (Enough / Short); a line opens to the
  stock in each warehouse. Approve → the Zoho Sales Order is made (SO-00001), each line gets the
  warehouse, status Ready For Finance Verified.

## Order page tabs (seen as Finance)

- **Audit Timeline**: remarks from MedRep / Management; progress 10 stages (Created, Management
  approved, Confirmed, Finance verified, Invoiced, Paid, Packed, Shipped, Delivered, Completed)
  with who and when; raw log.
- **Order Items**: lines with qty, price, tax, warehouse, amount, remark.
- **Payment**: for a credit customer "no payment verification required"; otherwise the proof.
- **Dispatch**: status (Queued), courier, tracking number, dispatched at, notes.
- **Attachments**: files by kind; "only the MedRep, their Team Leader or Management can attach";
  the no-proof reason given.

## Finance (Rosa Reyes)

- **Orders** (`/finance`): month figures; stage tiles (Awaiting you, Not yet with Finance,
  Invoicing in Zoho, In fulfilment, Completed, Needs attention); table (Order #, Customer,
  MedRep, Amount, Stage, Waiting, Details); GetMeds / Zoho / All; Export CSV.

- **Details** drawer: Order (status, total, customer type, dates, division, salesperson), Payment
  & terms (Zoho SO, no-proof reason), Delivery, Patient & hospital, Items with remarks,
  Attachments. **The customer's earlier dues are not shown** (Finance looks them up in Zoho).
  Buttons Close / **Hold** (reason the MedRep sees, add or paste a screenshot) / **Confirm
  payment…** (tick "I have checked the proof of payment", optional note; moves the Zoho SO from
  Draft to Confirmed) → toast with **Undo**.
- **My Confirmations** (what I confirmed, date range), **Reports** (sales by salesperson: count
  and total), **Payment History** (direct-order payments verified / rejected), **Refunds**
  (cancelled with payment: pending, over 3 days, done, none due).

## Dispatch / Operation (Ben Ramos; Pharmacy is the same login)

- **Zoho Dispatch Status**: Low stock checker (Check Stock), Stock announcements & promos
  (announce), filters Warehouse / Time, three columns **New draft SOs / Confirmed by Finance /
  Catered Orders**, then **Confirmed Orders** (who confirmed, tracking, total).
- Order card: **View the receipt**, **Cater this order**, **Hold order** (MedRep and Management
  told), **More info** (stage, when Finance confirmed).
- Order drawer buttons: Cater this order → "You are catering this" + **Release**; **Print
  address**; **Add tracking number** (courier + number; "the MedRep was told") → Update
  tracking; **Confirm for delivery** (shows the Deliver-to name, address, phone: "check this
  against the printed slip first"); **Hold order**; **Upload proof photo**.
- Packing and shipment themselves are made in Zoho Inventory; the page follows Zoho.
- **Pharmacy**: tabs Awaiting review / Needs attention / Rejected / Verified / All orders, channel
  filter HOS, Telesales, B&B, STC, URO, B2C; an order with a prescription appears once Management
  approves (in parallel with Finance).
- **Return checks** (goods coming back on an approved refund: good or damaged), **Clients
  Directory** (read-only; Type Credit / Direct; Category Doctor, Hospital, Distributor, **PWD**,
  Patient, Uncategorized), **Dispatched / Tracking Log** (by courier: LBC, J&T, NinjaVan,
  GrabExpress, Lalamove), **Inventory & Stock** (one unit price per medicine, GetMeds stock vs
  Zoho stock, Quick Sync / Full Resync).

## Management, the rest of its menu

Create New Order, Announcements & promos, Global Dashboard (tiles, orders by status, a table of
every order with MedRep filter and dates, Export CSV, recent activity), Approval Queue, **Exception
Hub** (on hold, critical exceptions, cancelled), All Orders Log, Refunds owed, **Refund requests**
(Needs decision → Waiting for returned goods → Ready to refund → Done: if goods come back, Dispatch
checks them, Management presses Refund, Finance makes the credit note), Pending Customers
(customers Zoho has not accepted yet), Not yet with Finance. **Announcements**: Dispatch or
Management post stock news (out of stock, low, back in stock) and Buy 1 Take 1 promos to MedReps.

## Admin (the CEO's view)

Global Dashboard and Reports; Customers & stock (Clients Directory, Pending Customers, Inventory);
Administration (**User Management**, Order Ownership, Refunds, Zoho Sync Health).
- **User Management → Accounts, by department**: Admin; Finance; **Sales (CHC)**: Management
  (Approval) "approve the orders of the divisions they hold", then each Division with its Head
  (HOS · Vanessa, RX · Javed, B2B / BID / CLIDP · Subir, MT · Mhalou, Online), its sub-divisions
  and territories; Team leads; **Operation** (Pharmacy and Dispatcher). "Add department".
- **Team Structure** (loaded from the September sales sheet): GetMeds Sales → Head → Channel →
  Team Lead → Territory, each territory with its target and marked held / vacant / named but no
  account (68 territories, 17 vacant).
- **Create account**: first, last, middle, display name, email, role (MedRep, Finance, Operation,
  Management, Admin, Team Lead), division, sub-division, starting password (or Generate); shows
  the login details once to pass on.

## Team Lead (a test account made for the walk)

My Team (the team's orders and figures, **view only**), Team performance (per person; "KPIs are
not open to the sales teams yet"), Clients Directory, Announcements, Create New Order. A Team
Lead approves nothing.
- **Whose team**: the MedReps whose account names this person as **Team Lead** (Admin → User
  Management → the account → Edit → Team Lead: "who this person reports to; their orders show on
  that person's team dashboard, and on everyone above them"), at any depth; a Channel Head sees the
  whole channel. With nobody assigned the Team Lead sees nothing.
- After Juan was put under the test Team Lead: My Team showed his open order (status, total) and
  the team's **Recent activity** (Sent back, Marked exception, Approved, Finance verified, with
  who). The Team Lead's bell stayed **empty** (no messages about the team's orders). On the order
  the Team Lead has Order overview, Request refund, Edit Details and the tabs; no approve, hold or
  send back.
- The account panel (Admin): first / last name, username, email, role, Team Lead, Zoho
  salesperson(s) (several, one starred), **Move / change role**, Edit, Delete, Deactivate.

## Order page, every button (walked again as Management)

- **Order overview**: a summary card (customer, credit / direct, status, date, MedRep, salesperson,
  division, invoicing from, address, remarks, then the additional details).
- **Request refund** (also the MedRep's): why; **where are the goods** (Not shipped / Shipped,
  coming back to us / Delivered, customer returns them / Customer keeps them); amount (less for a
  partial refund). The order then shows "Refund requested: waiting for Management · ₱… ·
  Withdraw this request".
- **Edit Details**: delivery address, delivery notes, division, sub-division, headquarter,
  salesperson (from Zoho's list), doctor, receiver, receiver contact, source, delivery method,
  payment terms, invoicing from, TIN, terms; Cancel / Save Changes. Once in Zoho: "an edit here
  updates the real Sales Order too".
- **Put on Hold / Mark Exception** (and Send back / Reject on the order page): a plain browser
  prompt asking the reason (the queue's Send back has a proper box).
- **Attachments** (Management, MedRep and their Team Lead may attach; Finance only reads): each
  file is a card with its kind and who checks it ("Prescription — reviewed by Pharmacy"; "Valid
  ID / Purchase Order — informational only, not reviewed by Finance"), file, size, uploaded by,
  uploaded at, the document shown, Open / Download / Refresh link, **Request deletion** (why;
  "Management sees this and decides — the file stays until they approve") → Management sees
  "Deletion requested — awaiting Management · Reason · **Approve — delete it / Decline**"
  (Decline asks Confirm decline) and the card keeps "Deletion request declined · asked because …".
  The upload box: "Attach File(s) to Sales Order", **Attach as** Proof of Payment / Guarantee
  Letter / Prescription / Valid ID / Purchase Order / Other, drag & drop, browse or paste a copied
  image (Ctrl+V), up to 15 MB, several pages as one PDF.
- **Notifications** (the bell): e.g. Finance gets "Refund to arrange: … first create the credit
  note in Zoho", and an edit made in Zoho shows field by field (Doctor → blank…).

## Returns, walked end to end

MedRep (or Management) **Request refund** → Management **Refund requests: Needs decision →
Approve** ("Dispatch was told to check the goods when they are back") → Dispatch **Return checks:
Good condition / Damaged — Record the check, send to Management** → Management **Ready to refund →
Refund** ("Sent to Finance's refund list. The order is cancelled.") → Finance **Refunds: Refund
pending → Zoho steps (credit note) → Refund done**.
Flaw seen: a partial refund (₱312.50 of ₱937.50, 10 boxes back) cancelled the **whole** order and
Finance shows ₱937.50 held. crmnew must return part of an order without cancelling it.

## The Admin page: the hub's against crmnew's

- Hub: the menu is three folding groups (Operations, Customers & stock, Administration) with about
  eight links; the company's structure lives in **one** place (User Management: Accounts by
  department, and Team Structure as one tree with territories, vacancies and targets); each page is
  a title, one line saying what it is for, and white cards with room around them; actions open a
  small window; a toast confirms.
- crmnew: eleven links for the Admin, and the structure is spread over four (Channels, Teams &
  people, Areas, Company chart as built), with dense cards (Channels: head, teams, team leads,
  MedReps, every team as a chip, areas). To do: one "People & structure" page like the hub's
  (Department → Division → Head → Team Lead → Territory with targets), folding menu groups, less on
  each card.

## Conditions walked one by one

**A MedRep puts a wrong price (order GM-20261117-0002, a direct patient):** Amoxicillin's catalog
price ₱8.50 changed to ₱1.00, Losartan given a ₱5 discount and VAT 12%.
- The form takes it with **no warning** (the price remark is optional); the bottom shows Total
  Discount −₱5.00 and "Tax (included in the rates above) ₱2.04".
- The Confirm window lists the lines with price, discount and tax, but marks nothing as off.
- Management's order page shows ₱1.00 like any price: **no catalog price beside it, no flag**,
  and the Order Items table has **no Discount column** (the ₱5 shows only in the amount, ₱19).
- Management fixes it with Edit Items (price back to ₱8.50 → Confirm changes). The timeline then
  says "Order items changed … was: 5x Amoxicillin, 2x Losartan; now: 5x Amoxicillin, 2x Losartan.
  New total ₱61.50": **the price change itself is not written down**, only quantities and total.
- A direct (advance-pay) customer's order still goes to Management first; the form says "requires
  Finance payment verification before picking".

**Hold, exception, resume (Management, same order):**
- **Put on Hold** asks "Reason for hold?" (a browser prompt) → status **On Hold**; the reason is
  posted under "Remarks from MedRep / Management". The order then shows **▶ Resume order, Put on
  Hold, Mark Exception**, "Exception/Hold Reason: …", **↩ Re-submit to Management approval** and
  **🚫 Cancel & Archive**.
- **Exception Hub** counts it (Orders on hold / Critical exceptions / Cancelled) and lists it with
  the reason, **▶ Resume order** and View.
- **Mark Exception** asks "Exception reason?" → status **Exception**, the same buttons.
- **Resume order** opens a proper window: "Takes the order off Exception so it can be processed
  again. Nothing is changed in Zoho", Held for: reason, **Continue from** (where it was before —
  Management approval, Finance verification, Draft invoice, Invoice to send, Ready for dispatch,
  Picking & packing, Dispatched, Tracking shared), **Why can it continue?** (required); "The
  MedRep, Management and the team at that stage are notified". Resumed → Pending Management
  Approval.
- A direct order not yet in Zoho shows **Retry Zoho Sync** in the Zoho box.

**What the MedRep was told (the bell, 19 messages for the two test orders):** submitted and
waiting for Management; submitted with the Sales Order drafted in Zoho; sent back with the reason;
now on_hold / now exception with the reason; taken off Exception "continues at
pending_management_approval" with the reason; waiting for stock (item, reason, "you can also
press Stock is back"); released, stock is back; draft cancelled ("payment is on record — Finance
will arrange the refund"); restored ("back with Management for approval"); passed finance
verification; tracking number and courier; refund request approved; refund with Finance; and
"Invoicing From → (blank)…" when a field changed in Zoho. **Not told:** Management's own line
edits — the price ₱1 → ₱8.50, the quantity 5 → 6,000, and the free Paracetamol added on the first
order reached the MedRep only by opening the order.

**Stock short, line warehouse, drafts (Management, same order):**
- Edit Items: each line has **"see the stock in every warehouse and choose one"** → a Warehouses
  window like Zoho's: View Stock on Hand / Committed Stock / Available for Sale, **Accounting
  Stock / Physical Stock**, a row per warehouse marked "short", a radio to pick the line's
  warehouse, Done. Raising a quantity to 6,000 (5,000 on hand) gives **no warning** while editing.
- Approve and check stock: every warehouse "Short on 1 line / 2 lines", the line "Short by 1,000",
  and "Getmeds Philippines Inc. cannot fill 1 line of this order. Choose another warehouse above,
  or tick this to approve anyway" (approve only after the tick).
- **Send back** (order page) asks "What does the MedRep need to fix?" → **Draft**. Management then
  sees **⏳ Wait for stock, 🚫 Cancel draft, Put on Hold, Mark Exception**, and the sent-back band
  with **Resubmit to Management** (Management can resubmit it too) and "attach the corrected
  document".
- **Wait for stock?**: "not cancelled and no refund starts; stays a draft with its payment on
  record, marked Waiting for stock; the MedRep is told and you are reminded every 3 days; when the
  stock is back press Stock is back"; Item out of stock (optional), Reason. The order then shows
  "⏳ Waiting for stock: item · Reason · since date (n days) · not cancelled" and **✓ Stock is
  back, send for approval** → straight to Pending Management Approval.
- **Cancel this draft?**: choose **Delete permanently** ("no money involved; draft, items,
  attachments and history removed for good; the MedRep is told"; type the order number to
  confirm) or **Cancel and keep record** ("the customer paid in advance; kept permanently;
  Finance is told; shows Refund pending until Finance records the refund"); Reason required.
  Kept: "This draft was cancelled — kept on record · Reason · **↩ Restore order** · Refund
  pending: Finance has been told".
- **Restore this order?**: "goes back to Management approval with its items, customer and payment
  proof as they were; the cancellation stays on the timeline; restoring closes the pending refund
  and tells Finance not to pay it out"; Why is it being restored? → Pending Management Approval.

## The hub and Zoho (from the code; one Zoho Inventory org, OAuth, every call through one gateway)

crmnew replaces Zoho, so every record below becomes crmnew's own; this is what must not be lost.

**Written to Zoho, step by step**
- *Management Approve* (also a non-B2B order placed by Management/Admin; MedRep, Team Lead and
  every B2B order wait for approval): **Sales Order as Draft**. Header: customer, date today,
  reference "GM-…", notes "Order No.: GM-…". Lines: item, quantity, **rate as given**, warehouse
  (line's own, else the order's), tax only for 12% or 0%. Also tax-inclusive flag, delivery
  method, terms, payment terms (days + label), **salesperson** (must already exist in Zoho), and
  custom fields **doctor name, source, invoicing from, division, sub-division, headquarter, lead
  id**; the PDF template follows Invoicing From; shipment date if today or later. Before it: the
  customer's TIN is written to the contact. Stored back: SO id, number, status draft.
- A line with a different Invoicing From makes a **second Sales Order** for that company.
- *Attachments* (proof, PO…) are attached to the SO; a prescription only once Pharmacy verifies.
- *Finance Verify*: the SO is **confirmed** in Zoho (Draft → Confirmed).
- *Edit Items / Edit Details after the SO exists*: the SO is rewritten from the hub's data (date
  never changes).
- *New customer* from the order form: a Zoho contact (name, business / individual, email, phone,
  contact person, billing and shipping address; custom fields licence owner, **LTO number**
  (unique), LTO type, licence issue and expiry, is doctor, contact number, TIN).
- *Retry Zoho Sync*: creates or confirms the SO again through a retry queue (never a second SO).
- With the V2 switch on (off in the live settings): Create invoice (+ mark sent), Mark packed
  (package), Ship (shipment with courier and tracking), Mark delivered — all in Zoho from the hub.
- **Never sent**: the line discount, delivery address, remarks, receiver; stock adjustments; new
  salespersons; payments, credit notes, refunds, voids.

**Read from Zoho**
- Contacts (Quick by last change / Full): name, business = **credit**, individual = **direct**,
  phone, address, active, TIN, **outstanding receivable** (pulled, not shown at ordering).
- Items: **rate** (one selling price), stock on hand, tax, SKU, unit; stock per warehouse and
  batches at approval.
- Salespersons (every 5 min); Sales Orders for "Imported history" (with their comments as
  timeline entries); each open order re-checked every 5 minutes and when opened (status, invoices,
  packages, shipments, lines, total); invoices and credit notes copied every 15 min for reports.

**Webhooks from Zoho** (Zoho Workflow Rules call the hub): payment / invoice paid → payment
recorded; invoice created → Invoice to send; invoice sent → Ready for dispatch; SO confirmed →
Finance verified stage; package created → Picking & packing; shipment created → Dispatched /
Tracking shared; SO cancelled / deleted → cancelled / deleted; **SO edited** → 7 fields compared
(Invoicing From, Doctor, Source, Delivery Method, Terms, Payment Terms, Salesperson), written to
the timeline ("Payment Terms: net → 30 days"), lines and total replaced from Zoho, MedRep and
Finance told. An order completes when it is both shipped and paid.

**Done by hand in Zoho today (V2 off):** invoice and mark sent, package, shipment with courier and
tracking, mark delivered; and always: payments received, refunds and credit notes, voids and
cancels, changing an SO's customer, fixing a raised invoice, stock adjustments, items / taxes /
warehouses / salespersons set-up, and **Finance's look at the customer's account in Zoho Books
before Verify**.

**Safety:** mock / live mode (live only for the allowed org), dry run (a made-up SO), test
customers only, a write lock (no deletes), a retry queue with a Zoho Sync Health page.

## Not walked on localhost (needs the hub's Supabase file storage, read from the code instead)

File uploads (proof, prescription, ID, GL): the browser uploads straight to Supabase. Pharmacy:
an order of HOS, Telesales, B&B, STC, URO or B2C with a prescription appears once approved;
Verify / Reject and tell the MedRep / "Confirm — not required"; Dispatch can't ship while a
prescription is pending or rejected. Delivery complete (MedRep, Team Lead or Management, after
dispatch) and the refund request (MedRep asks → Management decides → Dispatch checks returned
goods → Management presses Refund → Finance records it) are in the code and on the pages above.

## Seen so far: what the hub does better, what crmnew does better

- Hub better: a confirm summary before an order is submitted; the order page with tabs (Timeline,
  Items, Payment, Dispatch, Attachments); a sent-back order shows the reason in a yellow band with
  Resubmit right there; Confirm changes shows old line struck through → new; the approve window
  lists every warehouse as a card; Finance ticks "I checked the proof" and can Undo; Dispatch
  confirms the address against the printed slip; clean, calm look.
- crmnew better: prices per kind of buyer from Inventory (hospital, patient, doctor…) with the list
  price beside the given price; the hub has one price per medicine and the MedRep's order went in
  at ₱31.25 against an Inventory price of ₱8.50 with nothing shown to Management. crmnew also shows
  Finance the customer's earlier dues (Zoho's too); the hub does not.

(continued below as the walk goes on)
