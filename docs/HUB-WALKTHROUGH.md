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

## What goes to Zoho (hub)

Nothing until Management approves. On approval the hub makes the Zoho **Sales Order** (draft):
customer, lines (item, qty, rate as given), salesperson ("DIVISION | Name"), doctor name, source,
invoicing from, payment terms, warehouse per line. Finance's Confirm moves it Draft → Confirmed;
invoice, package and shipment are then made in Zoho, and the hub follows Zoho's status by
webhook. An edit made in Zoho comes back into the order's timeline. (crmnew replaces Zoho: the
same records are crmnew's own sales order, invoice and stock moves.)

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
