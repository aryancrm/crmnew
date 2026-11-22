# New CRM: the plan

**Read this first.** It is the one plan for the rebuild Aryan asked for on 14 November 2026.
It is kept current: when Aryan gives a new business rule, change the section it belongs to and
add a line to the change log at the bottom. Nothing here is built yet unless section 12 says so.

Status on 14 November 2026: designs shown and mostly accepted, no code written.
Designs: https://claude.ai/artifact/TrWdUqaHXmxZrKpkmCrAmR (private to Aryan; sample data).

---

## 1. Why a rebuild

The CRM in this repository works (the Online desk runs on it live), but the plan changed many
times and the screens piled up. Aryan's words: "you can't tell what is happening where", "too
many useless things", "the UI is very bad". Five overlapping layers decide who sees what
(roles, departments, workspaces, modules, positions), and whole modules (HR, scorecards,
rebates, field expenses) were built before the basic order line was used by anyone.

The rebuild replaces three tools the company uses today:

| Tool | What it does today | In the new CRM |
|---|---|---|
| GetMeds hub (hub.getmeds.ph) | MedReps place orders; Management approves; Finance verifies; Dispatch ships | The order line (section 4) |
| Zoho Books / Inventory | Sales orders, stock, invoices, payments, reports | Inventory (5), invoices and money (4.6) |
| SEFMED | Field visits, attendance, expenses | Not in version 1 (section 11) |

The rule for every screen: **only what that person needs, shown clearly, and every button
works.** If the hub did not have it and Aryan did not ask for it, it is not in version 1.

## 2. The business in one page

- The company sells medicines (oncology first) through about eight **channels**: HOSP
  (hospitals), RX (doctors: referral and dispensing), B2B (distributors, drugstores), BID
  (government tenders), PAP, TS, MT, and Online (Messenger, Facebook, the two websites).
- **MedReps** work under a channel, in an **area** (territory). They visit hospitals, doctors
  and patients and bring back orders. A MedRep reports to a manager or team lead, who reports to
  the channel head, who reports to the CEO.
- An order goes: **MedRep places it → Management checks it → Finance checks it → Dispatch
  packs and delivers it**. Management and Finance can each put it on hold. The CEO sees the
  totals: sales today, by channel, money collected, money owed.
- **An order's type is picked first** (Aryan, 19 Nov), as the Online case's road: **Patient**
  (prescription and the patient's ID), **Senior / PWD** (the same and their senior or PWD ID:
  20% off, no VAT), **Guarantee letter** (the same and the agency's letter, which pays), **With
  their PO** (the PO's number, on the invoice, and the paper) or **No PO**. The order's papers
  follow it; a patient's type for a hospital or a doctor is an order for one patient. Only the
  prescription stops the form; the rest show as needed on Management's Documents check, which
  decides (`orders/divisions.ts` ORDER_TYPES, `paperList` in `orders/rules.ts`).
- **Stock is the centre of it**: which medicine, how many, which batch, which expiry, which
  warehouse, and what it costs each kind of buyer.

## 3. People and what each one sees

One login per person. A person has one **role**; the role decides the screens. No departments,
workspaces, modules or positions as separate layers in version 1.

| Role | Sees | Does |
|---|---|---|
| MedRep | Home (my area, my sales against target, my orders, stock news), New order, My orders, My area (my hospitals / doctors / patients), Inventory | Places **his own** orders only |
| Team lead / Manager | Their people's orders and sales against target | Watches; decides nothing on an order |
| Management | Orders to check, On hold, All orders, New accounts, Inventory, masters | Approve, hold, wait for stock, send back; picks the warehouse; may edit an order |
| Finance | Payments to confirm, Customers owe, Invoices, All orders, Inventory, masters | Confirms money received; holds; records payments |
| Dispatch | Orders to pack, On the way, Delivered, Inventory | Picks the courier, packs, ships, marks delivered; moves and counts stock; posts stock news |
| Inventory | Inventory, Purchases, Suppliers | Runs the stock: buys from suppliers abroad, records every cost on the way in, receives by batch, adds and edits medicines, moves and counts stock |
| CEO | Home (kept from the old CRM), Sales, Orders, Money, Inventory, Company tree | Reads everything |
| Online desk | Leads & enquiries (kept from the old CRM), Inbox | Works a chat or website order into an order |

Rules Aryan fixed on 14 November:

- **A MedRep only makes the order.** He never chooses the delivery method or courier (Dispatch
  does) and never places an order for another MedRep.
- **A MedRep sees his area**: channel, territory, the cities in it, how many hospitals and
  doctors, who he reports to. Customers in his area are marked when he picks one.
- **Inventory is common**: every role can open it.
- **Management has a small Medicine box** at the top right of its queue: search a medicine, see
  stock per warehouse, batch, expiry and every price.
- The MedRep's own orders show on his Home as the **same cards** Management sees.

## 4. The order line

### 4.1 Stages

`Placed → Management → Finance → Packed → Shipped → Delivered → Paid`

Every order shows this as a strip on its card and as a road on its page, with who did each step
and when. An order can also be **On hold** (by Management, Finance or Dispatch, always with a
reason), **Waiting for stock**, **Sent back** to the MedRep, or **Cancelled**.

### 4.2 The MedRep places it

Customer (from his area, or a new one) → medicines → payment terms → address and receiver →
papers (PO, prescription, proof of payment, guarantee letter) → note → place.

For each medicine he sees the stock (per warehouse, nearest expiry) and **every price Inventory
holds for it** (patient, hospital, doctor, promo, …). He taps the price he is giving. If he
gives **less** than those, he types the price and **why**. The form tells him before he places
it whether Management will have something to decide.

- **Create New Order** (19 Nov, Aryan: "the hub shows Create New Order on top; in ours I can't
  find it"): the same green button at the top of the menu for every seller (every kind of MedRep,
  telesales, CLIDP, Bidding, PAP, Modern Trade, the leads and heads) and on My orders; a seat's own
  action (an Rx CHC's Log a call, Bidding's Record a tender, PAP's New PAP case) sits under it.
  The Online desk's orders start as cases (New lead).
- **The Divisions are the sales tracker's eight channels** (19 Nov, night, Aryan: "we have 7 or 8
  channels; why so many Divisions?"; the tracker is God): RX Business and MD Telesales (Javed),
  B2B, BID and CLIDP (Subir), TeleSales and HOSP (Vanessa), MT (Mhalou). The hub's fourteen are
  gone from every screen; its finer words are read as their channel where the November target sheet
  puts their people (URO, B&B and STC are RX Business; B2C is MD Telesales; HOS is HOSP; TeleSales
  Anesthesia is TeleSales; MSA and PS had nobody). This CRM's orders, channels and approvers moved
  with migration 0124; Zoho's own history keeps Zoho's words. The prescription Divisions are
  Javed's two; a guarantee letter is taken in RX Business, MD Telesales and HOSP (the hub's five).
- **The order's Division: their own first, any other a pick away** (19 Nov, evening, Aryan: "a
  hospital MedRep who gets a prescription order can't change it; make the MedRep's screen
  universal, as the hub's"; it replaces "one seat, one Division" of the morning). The form opens on
  the Division of the person whose order it is (their seat's box on the chart, else their channel's,
  `seat_division`, migrations 0114 and 0124); the eight show as one row, theirs marked, any other
  one press away, and the sub-division, the
  order types, the customer list (the Division's usual buyers first) and the papers follow it.
  Whatever its Division, the order stays its MedRep's: their own lead and head see it, it counts on
  their seat and their target. Their Home and My orders show this month's orders by Division (what
  came from which), each a press away. "Another MedRep" stays out (Aryan, 19 Nov).
- **No "Another MedRep"** (19 Nov, Aryan): a MedRep places orders for themselves only (the hub's
  "covering for a colleague" is not copied). A lead places for one of their people; Management
  for anyone.

### 4.3 Management checks it

The system checks each order first and writes what it found on the card: price below the
list price (by how much, and the MedRep's reason), stock short, the customer owes or is overdue,
a new account without papers, a missing prescription. Management then: **Approve**, **Hold**,
**Wait for stock**, or **Send back**, and picks **which warehouse it ships from**.

### 4.4 Finance checks it

Built 14 Nov (step 5). Every approved order passes Finance once, because Finance makes the
invoice before the goods leave (as in the hub, invoice first, then packing):

- **Pays in advance**: Finance looks at the slip (photo on the order) and its own bank account,
  types what came in (amount, how, reference, day), ticks "I have checked the proof, and this
  money is in our account" and presses **Confirm payment**. In one step the payment is
  recorded, the invoice is made and the order goes to Dispatch. With no slip on the order a
  bank reference must be typed. Less than the total is allowed: the rest stays owed.
- **Credit (so many days) and cash on delivery**: Finance looks at what the customer owes (the
  card says "Overdue 45 days" or "Over credit limit") and presses **Make invoice**; the order
  goes to Dispatch and the money comes later. "Invoice the N with nothing found" does them
  together.
- **Hold** with a reason, only at Finance's own step. A Finance hold for want of the slip ends by
  itself when the MedRep (or anyone) attaches the proof of payment: the order goes back to
  Finance. Finance takes off only its own holds; Management can take off any.
- Management's own order skips the approval queue, ships from the default warehouse and still
  goes to Finance.

### 4.5 Dispatch delivers it

Built 14 Nov (step 6), after the hub's Dispatch steps (ready to pack → ready to ship → awaiting
delivery) and Zoho Inventory's packages and shipments:

- **Pack**: for each line Dispatch picks the batches from the warehouse Management chose; the
  batch that expires first is filled in (never an expired one) and can be changed when a
  customer needs a longer expiry. **The pieces leave the shelf when they go into the box**
  (changed from "at delivery": a packed box can't be sold again, and the stock on the shelf is
  what is really there). Each batch's landed cost is kept on the pick for the margin reports. A
  warehouse without enough says so by name; nothing is half packed. **Unpack** puts the pieces
  back where they came from.
- **Ship**: a courier (LBC, J&T Express, Lalamove, Grab Express, 2GO, AP Cargo, Ninja Van, Flash
  Express or another) with its tracking number (which can follow later), or our own rider by
  name. **Picked up here** hands a packed order over at the warehouse.
- **Delivered**: who received it, the day, and a photo of the signed delivery receipt (a paper
  on the order). A cash-on-delivery invoice falls due that day. **Came back**: the parcel didn't
  reach the customer; it is back with Dispatch, still packed, to ship again or unpack.
- **Delivery receipt** to print: the company, what is in the box batch by batch with expiry,
  how it goes, and lines for the customer to sign.
- **Hold** at Dispatch's own step (a wrong address, say); each desk takes off only its own holds
  (`held_role` on the order), Management any. A parcel on the road can't be cancelled; it must
  come back first. Cancelling a packed order puts its pieces back on the shelf.
- **Completed** on the order's road means delivered *and* paid.

### 4.6 Money

- **One invoice per order**, made by Finance at its step, under the company the order names, in
  that company's own series without gaps: 2MG Inc. `2MG-SI-000001`, GetMeds Philippines Inc.
  `INV-000001`. Its VAT is split from the VAT-inclusive prices (VATable sales, VAT 12%,
  VAT-exempt, zero-rated). Due: credit, its days after the invoice; cash on delivery, on
  delivery (never late before the goods arrive); advance, at once.
- **Payments**: amount, how (bank transfer, cash, check, GCash / Maya, other), reference, day,
  the slip (an order paper). Never more than is owed. A payment recorded by mistake is taken off
  with why, kept in the history, and the invoice is owed again.
- **Paid is a fact of the invoice**, not a step the goods wait on: a credit order is packed and
  delivered before it is paid. The order's road marks "Paid" only while its invoice is paid.
- **Customers owe**: each customer's unpaid invoices by how late (not due yet, 1–30, 31–60,
  61–90, over 90 days, cash on delivery not delivered yet), with the oldest's days. Management
  sees the same on its cards before approving the next order.
- **Refunds owed**: an order cancelled after the customer paid cancels its invoice and lists the
  money to give back, with how many days it has waited, until Finance records the refund.

### 4.7 Open point

In the hub every MedRep order waited for Management. My proposal is that Management still sees
every MedRep order, with the system's findings on the card and one button to approve all the
orders on which nothing was found. Aryan has not confirmed this yet.

## 5. Inventory (built first)

- One record per medicine: name, strength, pack, prescription or not, VAT.
- **Stock by warehouse and by batch**: quantity, expiry, when and on which purchase it came.
- **Promised to orders** and **free to sell** (on hand less promised).
- **Coming**: quantity and date from open purchase orders.
- **Prices**, one per buyer type (patient, hospital, doctor, distributor, bidding, …) and dated
  promos. Only named people change prices.
- Alerts: out of stock, low, batches expiring in 90 days.
- The Inventory person and Dispatch move stock between warehouses and count it, and post
  **stock news** (out, low, back) that MedReps see on Home and in the order form.

### 5.0 The piece is the unit

Aryan, 14 Nov: in the Philippines medicines are sold by the tablet as well as by the box. A
strip holds ten; someone needs four; the strip is cut and four are given. A patient may ask for
a whole box or for so many tablets. **The tablet is the main unit.**

- Every medicine names what **one piece** is (tablet, capsule, vial) and how many pieces a
  **pack** holds (`pack_size`; 1 when it is only sold whole, like a vial).
- **Stock, batch costs and purchases are counted in pieces.** Screens show the packs beside
  them ("1,050 · 35 packs", "34 packs + 12").
- **Every price is for one piece**, per kind of buyer. A pack may carry **its own price** when a
  whole box is cheaper than its tablets one by one; left empty, a pack is its pieces added up.
  A pack price typed alone sets the piece price from it.
- The order form (step 3) will take a quantity in pieces or in packs for each line.
- Zoho Inventory keeps it the same way (seen 14 Nov, read only): unit "pcs", "Unit of
  Measure 120" for a bottle of 120, cost and selling price per piece. It also keeps, per batch,
  the manufacturer's batch number and the manufactured date, and has warehouses for each
  rep's "home stock" and for expired stock. Those are not built yet.
- **The real price list** (the company's sheet) is still to be loaded; Aryan is sending the link.

### 5.1 Buying, and what a batch cost to land

Aryan, 14 Nov: a separate person runs inventory. Medicines are bought from India, China and
other countries and flown to the Philippines; the flight, the packaging, customs and the rest
are part of what a medicine cost. The same medicine can land at ₱100 in one batch and ₱102 in
the next while both sell at the same ₱110.

- **Suppliers**: name, country, the currency they bill in.
- **A purchase** (PO-…): the supplier, the warehouse it comes into, the dates, the currency
  and the peso rate, each medicine with its quantity and price in that currency, and the
  **other costs in pesos** (freight, packaging, customs, insurance, local transport, other).
- **Landed cost**: goods in pesos (pieces × price × rate) plus that line's share of the other
  costs, divided by the pieces. The other costs are shared between the medicines by the value
  of their goods, to the centavo (`new/apps/api/src/purchases/landed.ts`, used by the API and
  shown live in the form).
- **Receiving** a purchase asks, for each medicine, how many arrived, the batch number and the
  expiry. The costs are shared over what actually arrived; each batch keeps its landed cost;
  the shelf grows. More of a batch already on the shelf averages its cost.
- A freight bill that comes later: the costs and the rate of a received purchase can still be
  changed and its batches' costs follow. The medicines and quantities can't.
- **Who sees costs and margins**: Inventory, Management, Finance, the CEO and Admin. MedReps,
  team leads, managers, Dispatch and the Online desk never do. The medicine's page shows each
  batch's cost, the range and the average on the shelf, and the margin beside every price.
- Stock put in without a purchase (opening stock, a correction) is "Add stock", with an
  optional cost.

## 6. Masters (each exists once)

- **Hospitals, Doctors, Patients** (and other business buyers). Each belongs to an area, and so
  to the MedRep of that area; whoever first brings a customer is recorded.
- Picking a customer by name or number says at once if it is an **old customer**: last order,
  how many orders, what they owe.
- A new customer added by a MedRep can be used at once and is reviewed by Management.

### 6.1 As built (step 2)

One table, `customer`, holds hospitals, doctors, patients, drugstores, distributors and
government buyers (`kind`), each with a code (CUS-00001), phone, city, address, the area it
belongs to, who added it and whether Management has looked it over.

- **Who sees which customers.** A MedRep: the customers of his area and the ones he added. A
  team lead or manager: their team's. Management, Finance, Dispatch, Inventory, Online, CEO,
  Admin: all. The API decides this, never the screen.
- **Area.** A customer added by a MedRep goes into his area. Only Management or Admin moves a
  customer to another area; the MedRep of that area then looks after it.
- **Old customer.** While a name or number is typed in Add customer, the app says who is
  already on file: name, kind, city, the last four digits of the number, who looks after them,
  and "same number" when the phone matched (the last 10 digits are compared, so 0917…, +63917…
  and 917… are one number). The check looks across every customer, so a MedRep learns a
  hospital already belongs to another MedRep without seeing its details. A hospital, doctor or
  business with the same name in the same city is refused, naming who holds it; two patients
  may share a name or a number (a family).
- **Terms.** How a customer pays (in advance, cash on delivery, on credit with days and a
  credit limit) is set only by Management or Admin. A customer starts as "in advance".
- **Review.** A customer added from the field or the Online desk is marked "New, to review";
  Management's **New accounts** lists them and one button marks one reviewed. Nothing is
  blocked meanwhile.
- **Screens.** Hospitals, Doctors, Patients (Management, Dispatch…), Customers (everyone else
  who needs them), **My area** for the MedRep (his area, its cities, counts, his customers) and
  one page per customer (details, who looks after them, how they buy, a hospital's doctors).
  Orders, what they owe and the last order join that page in step 3.
- Not built yet: a customer's papers (licence photo, 2303), visits, a patient's prescriptions,
  loading the real hospitals and doctors, several contact persons per hospital.

## 7. Online leads

Messenger, Facebook and website enquiries and orders stay in **Leads & enquiries**, which Aryan
likes as it is. When the agent turns a case into an order, it joins the **same order line** as a
MedRep's order. The agent is the "MedRep" of the Online channel.

### 7.1 As built (step 8a)

- **Every enquiry is a case** (`lead`): who is writing and the patient when it is someone else,
  phone (its last ten digits find the patient on file: **the number is the customer**, as the old
  CRM decided), email, city, delivery address, where it came in, who works it, and how the
  patient pays: Regular, Senior citizen, PWD or a guarantee letter (DSWD, PCSO, OVP, OP).
- **Where a case stands is worked out on every read**, never typed: the old CRM's road steps
  (`apps/api/src/online/journey.ts` is the old `journey.ts` as it was) from its quotation, its
  papers, its letter and its order. So the desk, the case and the chart can't disagree.
- **Papers** each road asks for before the order: the prescription (until the quotation shows
  every medicine is over the counter), one ID for a senior citizen or a PWD (one road since
  18 Nov: either card, marked which for the books), and for a guarantee letter the patient's valid ID, the medical certificate or abstract and the
  letter itself. Filed means checked (the agent reads a paper before filing it). Photos are made
  smaller before they go; a removed paper is kept, marked inactive.
- **Quotation**: catalogue medicines only, pieces and the price of a piece (the patient price,
  shown with its stock); a lower price needs its reason. Senior / PWD: VAT taken out of a 12%
  medicine, then 20% off, shown as two lines; that relief is the law, so Management isn't asked
  about it. Saved for its road: changing the road asks for it again. "Sent by" Messenger, Viber,
  WhatsApp, SMS, Email or printed is noted.
- **Guarantee letter** (2.1 application, 2.2 letter): the day they applied, the letter's number,
  the amount and its day, its photo, then "Mark the letter verified".
- **The order**: when the case is ready, "Place the order" asks how they pay (cash on delivery,
  or paid in advance: then the agent adds the payment proof on the order and Finance checks it);
  a GL order is billed to the agency, 60 days. The patient is found by number or made; the
  case's papers go onto the order; the order goes to Management like any MedRep's, with the agent
  as the Online channel's MedRep. From there the case shows the order's step in words.
- **Screens**: the Online desk's sidebar is Leads & enquiries, My orders, Customers, Medicines &
  stock, with New lead on top. The desk is the old one (title and count, queues All · Active · To
  deliver · Payment · Completed · Lost, the step line New → Rx → Quote → Papers / GL → Ready →
  Ordered → Delivered, unpaid → Done, search, source / road / mine, cards by the day they came in,
  each the old card). The case page: who is asking with how they pay, the next step in one line,
  the old journey chart, then the steps (Rx & documents, Enquiry & quotation with 2.1 / 2.2 on a
  GL, Order & delivery, Payment & follow-up) with the money and the activity. The CEO and the
  Admin open it from the Online app, read-only.
- Not yet: refills (see 7.4 for points and the quotation PDF).

### 7.2 As built (step 8b: Messenger and email)

- **Channels** (`/channels`, the Admin and the CEO): a Facebook page is connected with its page
  token (checked with Meta, subscribed to the webhook); a mailbox with its app password (Gmail /
  Google Workspace, Zoho, Zoho India, or any IMAP + SMTP host; IMAP and SMTP both checked first,
  only public mail servers). Tokens and passwords are sealed with `SECRETS_KEY` (AES-GCM) and never
  sent back to a screen. Each shows when it was last read, what failed (Retry), Read now and
  Disconnect; a mailbox chooses whether new senders wait for the desk or open a case at once.
- **Who a person is, is their conversation** (their Messenger id on that page, or their email
  address), never their name. Their first message opens a case (source Messenger or Email, named
  from Meta's profile or the conversation, else "Facebook user"); later ones land on their newest
  case; a lost case opens again when they write; the same message from the webhook and from the
  history pull is one line.
- **Messenger**: Meta's webhook (`/webhooks/messenger`, signed with `MESSENGER_APP_SECRET`,
  checked with `MESSENGER_VERIFY_TOKEN`) keeps every event first, then works it; one that fails is
  tried again with a growing wait, never lost; an event for a page nobody connected waits and comes
  in when it is connected. Every two minutes each page's conversations since the last read come in
  the same way, so a missed webhook still lands. Photos and PDFs they send are kept on the case
  ("From the chat, not filed yet", filed as a paper in one click); our replies sent from Facebook's
  own inbox show too; their reactions and "Seen" show on our messages. Meta takes a reply only
  within 24 hours of their last message: past that the reply is refused with what to do instead.
- **Email**: the INBOX is read every two minutes from where it stopped. Lists and automatic mail
  never open a case. A new sender waits in the Inbox's "New email senders" for **Make enquiry**
  (their emails land on a new case) or **Not a customer** (their mail stays out); a sender with a
  case, a customer on that address, or someone answering a thread we wrote in comes straight in.
  What they quoted from earlier mail is left out. The agent's reply goes threaded ("Re: …",
  In-Reply-To) from the mailbox.
- **Inbox** (`/inbox`, the Online desk's first link with the count waiting): like Messenger, the
  chats down the left (needs reply first, then the newest), the conversation in the middle (theirs
  grey, ours blue, the team's notes in amber), and who they are with their case on the right; on a
  phone one pane at a time. The reply box answers on the channel they wrote on, or writes a note
  for the team. The case page has a Messenger / Email button (a red dot while they wait) that opens
  the same conversation down the right; the desk's cards say "Needs reply". A lost case is reopened
  before it is answered.
- On a developer's computer `MESSENGER_SINK=1` and `MAIL_SINK=1` answer Meta and the mail servers
  locally (replies are logged, emails written to `.data/mail-sink`), with `/api/dev/messenger` and
  `/api/dev/email` to send a test message in; both refuse online.
- Not yet: our own photos and files sent in the chat, the Messenger auto-reply, saved replies,
  automatic customer emails, renaming a "Facebook user" later, fetching a photo again when Meta's
  link expired, undoing "Not a customer", several API servers sharing the reading (one runs it
  now). Online needs `SECRETS_KEY`, `MESSENGER_APP_SECRET`, `MESSENGER_VERIFY_TOKEN` set, and a
  host that allows SMTP (the old CRM's Render free plan blocked it).

### 7.3 As built (step 8c: the websites)

- **Any number of websites**, each a channel under Channels (the Admin and the CEO): its name and
  address, and its own secret, shown once with the two settings the website needs
  (`CRM_WEBHOOK_URL` = `/webhooks/store/2mg` on the CRM's address, `CRM_WEBHOOK_SECRET`). The
  website's calls follow the old CRM's contract (the same events, the same `x-crm-signature`), so
  2MG and Caps & Pills switch over by changing those two settings. A new secret stops the old one.
- **A website order opens a case** (a "Website order" card on the desk, named after its website):
  who ordered, their phone and address, how they pay (senior / PWD from the benefit, a guarantee
  letter from the agency), and the medicines matched to the catalogue (by name, name with strength
  or brand, then SKU; the doses must agree; only one match counts) as the case's quotation in
  pieces at the website's price, less its share of a coupon. An item the catalogue doesn't have
  leaves the quotation for the agent to check and save. The documents the customer uploaded come
  onto the case to be filed; a link that fails answers "retry" and the website's retry (with fresh
  links) finishes them, up to six tries, then the case says to open it in the website's admin.
- **The order from that case** carries the website's delivery fee (on the order, its total and its
  invoice) and the way the customer chose to pay (cash on delivery, else paid in advance). The case
  shows "Website order …" folded: what the customer saw, item by item, the website's total, their
  documents, and what the CRM last told the website.
- **The website's own changes** come in forward only (an older snapshot never writes over a newer
  one); a cancel on the website closes a case not ordered yet, or tells the agent to cancel the
  order here. An order that arrives days late, or already moved on, opens no case by itself: it
  waits under Channels for "Open a case".
- **The status goes back**: approved and checked by Finance → "confirmed", shipped → "shipped"
  with the tracking, delivered → "delivered", cancelled (or a case closed before its order) →
  "cancelled", signed with the website's secret to the address the website gave, every 30 seconds
  until it takes it (backing off), stopped when the website refuses it (the case and Channels show
  why, with "Try again").
- **Prescriptions and enquiries** sent through a website land on the person's open case (by their
  number) or open one.
- **The website's admin** reads its order's progress (`/webhooks/store/2mg/order-progress`): the
  road, the step and the next one, the journey's stops, the order's number, delivery and money.
- On a developer's computer `/dev/website-status` stands in for a website taking the status.
- **Made whole from the old CRM's link (19 Nov)**: the progress answer in the website's own shape
  (`{found, progress}`: road, step, next step, stops, delivery, payment, the GL letter); "shipped"
  sent again when the tracking is typed after shipping; "quotation_sent" once a GL customer's
  quotation went out or the application is on record (the order's `letter`); a GL letter sent
  later filed as the letter; the Admin may paste a website's present secret when connecting it (it
  then keeps working unchanged: only its CRM address changes); the website admin's "Open in the
  CRM" link (`/website-order?site=&ref=`) opens the case.
- **The stock link** (`online/catalog.ts`, the old catalogue push, the same call and fields): each
  medicine with its SRP and patient price (per piece and per pack, pesos), the pieces sellable on
  the shelf in every warehouse (expired batches left out; the website divides by its pack and takes
  off its own open orders), only what changed, every ten minutes and with Send updates now; off
  until the website's catalogue address is set on its Channels card. The website knows each
  medicine by the old CRM's id (`medicine.web_id`); the old CRM's medicines with no match go once
  as no longer sold. The GL price sent is the patient price, as this CRM quotes a GL case (a
  separate GL price list waits for Aryan).
- **Points on website orders as the old CRM checked them**: a checkout's hold must be the order's
  (its website, number, points and the customer's own number), else the order is refused; points
  never ride on a business order or with Senior / PWD, a guarantee letter or a coupon: they go back
  to the customer and the case says so.
- **The confirmed message** carries the points the order earns ("about ₱N off your next order, N
  points, added once it is paid") and the customer's points link (the website's sign-in with their
  number filled in), as the old CRM's email did.
- **Bringing the old CRM's website data over** (`scripts/import-old-website.ts`, read-only on the old
  database, dry run by default): the medicines' website ids, every wallet with its whole history
  (a carried entry where it differs from the old balance), the points sign-ins with the same
  passwords and open sessions, website accounts tied to a wallet, checkout holds, and the website
  orders still open. Order at the switch: run it, then set the stock link, then switch points on.
- Not yet: the delivery options sent to the website (this CRM keeps none yet).

### 7.4 As built (step 8d: points and the quotation PDF)

- **Points** (the owner's rules): 1 point = ₱1. A patient earns 10% (Points page: on / off and the
  rate, the Admin and the CEO) of what they actually paid for the medicines, once the order is
  delivered and the money is in; never on the delivery fee, never on what they paid with points; on
  a guarantee letter only the agency's money counts (each receipt says who paid). Business buyers
  never earn. Points never expire. A customer is their phone number: one account per number.
- Every receipt, a receipt taken off, the delivery and a cancel bring the order's points to what its
  money earns now, the difference only, once (`points_settlement`, each entry with its origin); a
  program switched off earns nothing new but corrections can take points back.
- **Using points**: on the case's Order & delivery step (the regular road only: never with the
  senior / PWD discount or a guarantee letter) the agent sets how many; placing the order takes them
  from the balance, the order shows them, its invoice is paid that much "by points" at once, and
  the rest is what the customer pays (COD or in advance). A cancelled order gives them back as
  points, never as money. A payment by points can't be taken off by hand.
- **Points page** (Online desk, CEO, Admin): every customer's balance by name or phone (the phone
  shows its last four digits), one customer's history (earned on which order, used, given back,
  adjusted, by whom), and adjusting by hand with why (the Admin and the CEO; never below zero).
- **Quotation PDF**: the company's letterhead (Company details: name, address, phone, email, TIN,
  VAT, FDA licence, the foot line, who signs), the patient, each medicine (pieces, price, amount),
  the senior / PWD VAT and 20% off, the website's delivery fee, points, the total, 30 days'
  validity. On the case: Open the PDF, Copy its link (frozen as it is, open for 30 days, no sign-in),
  Send on Messenger (the link, within Meta's 24 hours), Email the PDF (attached, threaded; a case
  with an address and no conversation starts one); sending marks the quotation sent.
- Not yet: PCSO's three canvass quotations, refills.

### 7.5 As built (step 8e: points on the 2MG website)

The 2MG website keeps its "My rewards" page, its sign-in and its checkout exactly as they are: the
new CRM answers the old CRM's points calls (`POST /webhooks/store/2mg/points/manage`, signed with the
website's own secret, `site` and `sentAt` within five minutes), so the switch needs no change on the
website. Caps & Pills has no points (removed 6 Nov 2026).

- **The member's own sign-in opens their points** (`auth_member`): when a customer signs in or joins
  on the website, it relays the number and password; the points login is made or checked (wrong
  passwords relayed this way never lock the customer out; five pause the relay a day). With 2MG's
  `claimByNumber` the number's points account is connected to that login the first time (noted on
  the account). A typed number alone never reads or spends anyone's points.
- **A website account proves its points** by a delivered order on its own number that earned
  (bound then, once); before that it reads its points through the points session. "My rewards"
  lists the member's own orders (`member_rewards`, at most 50, an order placed before signing in
  linked by `order_account`) with each order's total, money in, points earned and points used.
- **Points at checkout** (`reserve`, only with the points session): held once per checkout (a retry
  gets the same hold, its id a UUID), never past the balance; the website commits them when the
  order is saved or releases them (`site_reservation_read / settle`). The order comes in with
  `rewards: { reservation, points }`: placing its case's order takes exactly those points (no second
  deduction), cancelling that order gives them back once, and the website cancelling an order the
  CRM hadn't placed gives them back once too.
- **The website's admin** looks a number up and adjusts it with why and who (`admin_lookup`,
  `admin_adjust`, once per request key).
- The points page's own sign-in (`auth_login`, `auth_register`, `auth_logout`) works as before; five
  wrong passwords pause that number 15 minutes. Old private points links aren't used any more.
- Code: `apps/api/src/points/website.ts` (logins, sessions, bindings, holds),
  `points/website-calls.ts` (the calls), migration 0018.

### 7.6 The Online desk takes its order to Paid; every order page looks like the case (15 Nov)

Aryan saw that in the old CRM one Online agent (Mary Jane) worked a case from the enquiry to the
money, while the new line split it between Management, Finance and Dispatch. He asked me to choose;
he wants every department's order page laid out like the Leads & enquiries case.

- **An Online case's order** (`sales_order.lead_id` set): placed by the agent, it goes
  **Management → Finance → Dispatch** like every other order (17 Nov: Management approves every
  order; 18 Nov: "the Online desk's work goes to Management and to Finance"). Management sees what
  `caseChecksOf` (`orders/rules.ts`) finds on it: a price below the list (the agent's discount,
  beyond the senior / PWD relief), or for a business buyer an unchecked account, an expired
  licence, money owed or a sale on credit. The invoice is made at the approval. Finance then checks
  the payment (paid in advance) or what is owed (cash on delivery, an agency's bill) and lets it go
  to Dispatch; Management may still switch Finance off on approving. *(Until 18 Nov a case's order
  skipped Finance.)*
- Dispatch packs and ships as before. **The agent marks it delivered** (the Online desk role, on a
  case's order only) and **records the money** (cash on delivery after the handover; paid in advance
  as soon as the invoice exists, so Finance finds it on the invoice and confirms). The Online desk
  sees every case's order.
- **The case** shows the order's trail in Order & delivery: Management's check (not needed /
  waiting with why / approved by whom), packed (who, warehouse, batch), shipped (courier, tracking),
  delivered, then "Mark as delivered"; Payment & follow-up shows the invoice, the payments and
  "Record payment received" (`LeadCase.order.trail`, `can.deliver`, `can.pay`).
- **The order page** (`/orders/:id`, every department) is laid out like the case: who it is for
  at the top, the order's journey with who and when (Placed → Management check → Finance check →
  Pack & ship → Delivered → Paid; "Not needed" where a step was skipped), the six steps on the left
  with whose step each is ("Your step"), Money and Activity under them, and the open step's work on
  the right (`?step=`; each person opens on their own step). Hold, exception, cancel and place again
  sit under the steps.
- The Leads & enquiries list stays as it was (a redesign was tried and taken back at Aryan's word).
- **A business buying through the Online desk** (19 Nov: "B2B orders that come through Online are
  Online's entries"): the case's quotation step says who is buying, the patient or a business
  (drugstore, hospital, doctor / clinic, distributor, government). A business is picked from the
  file or added with the order as that kind (Management checks a new customer); its quotation is
  priced from its own list (government: the bidding price), no prescription is asked, it pays on
  the regular road (cash on delivery, in advance, or its own terms on file). The order is the
  agent's, on the Online channel: Online's entry.
- **Every desk sees an Online order as one**: "Online · Messenger" (the case's source) on the
  cards, the lists and the order page; Management's price step links to the case's quotation.
- **The next refill** (19 Nov: "who fills it, and where does it show?"): the one who took the order
  sets the day the customer's medicines run out (the case's Payment & follow-up, or the customer's
  page; the system suggests the last order plus their usual gap, 28 days with one order). The day
  counts until the customer's next order; Refills due / Customers to call list them by it, with a
  count beside the link in the menu.

### 7.7 The switch on the order, and the invoice as Zoho prints it (15 Nov)

Aryan wants Management and Finance taken out of the line little by little, decided where the order
is made (not on a settings page nobody opens), and automatic: an order that matches its quotation
and has nothing wrong goes straight on.

- **The switch at the top of every order form** (MedRep's New order, the case's Order & delivery):
  "Send to Management" and (MedRep orders) "Send to Finance", both off by default. Something wrong
  on the order (a price below the list, a new business customer, an expired licence, paid in advance
  without a proof while Finance is off) locks Management on and says why. The server checks again
  (`routeOrder` in `orders/service.ts`; credit over the limit and money overdue too) and sends it to
  Management whatever was picked. Nothing wrong and both off: the invoice is made at once and the
  order goes straight to Dispatch. Finance's choice is kept on the order (`sales_order.finance_check`,
  migration 0019), so Management's approval sends a "no Finance" order straight to Dispatch too.
  An API caller that sends no choice gets the old line (Management, then Finance).
- **The invoice** (`/invoices/:id`) is drawn as Zoho Books prints it: the status ribbon across the
  corner (Paid, Due, Partially Paid, Overdue, Void), the logo, the company (name, address, VAT Reg.
  TIN, phone), "Invoice", its number and Balance Due on the right; Bill To and Ship To with Invoice
  Date, Terms, Due Date, P.O.#, S.O.# and Sales person; the lines under a dark heading; Sub Total,
  Shipping charge, Total, the VAT included, Payment Made (in red), Refunded and the shaded Balance
  Due, amounts with their centavos; the company's foot line as Notes.

### 7.8 Field orders the hub's way, free goods, and the customer told at every step (15 Nov)

Aryan: the MedRep sends a little, Management fills the rest; Mary Jane, in the office, does much of
Management's work herself. Every order, not only Online's, tells the customer each step, as the old
CRM did.

- **Division, sub-division and payment terms on every order** (migration 0020: `sales_order.division`,
  `sub_division`, `payment_term`). The MedRep picks them on New order (the hub's lists, in
  `orders/divisions.ts`: B&B, B2B, B2C, BID, CLIDP, HOS, MSA, STC, TeleSales Anesthesia, URO,
  TeleSales, MD Telesales, PS, MT; HOS's sub-divisions GENSAN … ZAMBOANGA; PDC 15 … Donation/Charity),
  started from their own channel and area (HOSP → HOS, "HOS | Pasay" → PASAY). The term is free text
  with suggestions; the days to pay follow from it (PDC 30 / NET 30 → 30 days, COD → cash on
  delivery, Samples → advance). Management's step has **Complete the order** (division, sub-division,
  terms, expected date, receiver and contact, address, PO, invoicing company, remarks), until the
  order is invoiced or packed; each change is written on the order.
- **Free goods** (`order_item.free`): "+ Free (Buy 1 Take 1)" under a medicine adds the same medicine
  again at ₱0 with the promo named (Buy 1 Take 1, Buy 10 Get 1, Sample…). One paid and one free line
  per medicine, never only free lines. A free line always shows Management ("Free goods"); the total,
  the invoice, the emails and the order page say "Free".
- **The phone's raised +**: a MedRep's tab bar has New order as a round button raised in the middle;
  on the order form itself it lies flat so it never covers Place order.
- **The email is asked every time**: a new enquiry and a new customer both ask for it, with a "No
  email" tick when they truly have none.
- **The customer hears each step by email, on its own, once** (`online/tell.ts`, after the old CRM's
  `customer-mail.ts`): order confirmed (when it reaches Dispatch), on the way (with the courier and
  tracking, and the money to prepare on COD), delivered (with the balance and due date), and each
  payment received (an advance too). A patient is greeted by first name, a hospital or business by
  its name; the medicines, free lines, total, points, address and agreed terms are listed; the
  company's foot line closes it. A case's emails go on its own email conversation; anyone else's from
  the first connected mailbox. Each is written on the order (and the case); a failure is written
  there too and never stops the step.
- **Send to customer** on every order page and on the case's Order & delivery and Payment steps: the
  newest step's words with Email (sends it again), WhatsApp, Viber (copies the words first), SMS
  (mobile numbers only), Messenger (when the case talks there) and Copy. Each send is noted on the
  order ("Sent to the customer by WhatsApp: On the way").

### 7.9 The old case page's look on every page; customers' whole story; the MedRep's Home (15 Nov)

Aryan: the old CRM's lead (case) page is the design: its text sizes, borders, radius, shadows and
form fields go on every page. Design only: no feature is taken away.

- **The look, everywhere** (`ui.tsx`, `styles.css`, `record.tsx`): boxes are
  `rounded-2xl border-slate-200/90 shadow-2xs`, panels have the case's grey head band with an icon
  tile, small grey capital headings ("CASE JOURNEY"), fields 40px with a slate-300 border and a
  green focus ring, dialogs as the old Case details (title, a line, the form, Later / Save under a
  thin line). The top bar shows the company's "2mg Inc." logo and the workspace's name (no icon).
  Black is never used; a picked tab is white on grey.
- **The case page** (`/leads/:id`) is the old one: avatar, ENQ chip, Enquiry and source pills,
  Case details (amber while details are missing), Intake time, Owner select, Add email, Edit
  details, the three-button payment road (Regular / Senior-PWD / GL) on the right, the journey
  inside the head, "Orders on <number>" (every order and enquiry on the same number or customer,
  `online/case-history.ts`), Steps with icons and the GL sub-steps, Case actions, Money, Activity.
  Case details is the old pop-up (relation list, four "How will they pay?" choices, agencies).
- **Hospital, doctor and patient pages** (`/customers/:id`, `customers/page.ts`): the head (CUS
  number, kind, area, checked, licence; "Looked after by Ryan › Daniel › Vanessa"; pays / credit
  limit / credit left, or a patient's points), a glance (orders, bought, paid, owed, overdue,
  medicines), then everything on one page: orders, medicines bought (times, pieces, free, last
  price), invoices, payments, enquiries on their number; money, details, doctors there, activity.
  Lists show who each is under (MedRep › manager, or the desk agent) and their orders; a MedRep
  sees only their own. Migration 0021 adds the indexes these reads use.
- **One customer per phone number**: adding or changing a customer to a number that is already a
  customer of that kind is refused naming them (CUS number), under a lock on the number so two
  people adding it at once make one. Phones are written the Philippine way (`phone.ts`: +63,
  63 and 0 all become "0917 555 1234"; "(02) 8825 5236"); who someone is stays the last ten digits.
- **All orders** (`/orders` for Management, Finance, Dispatch, the CEO) is the Orders to check
  design with an "All orders" tab and Cards / Table / Board (lanes Waiting → Delivered), Load
  more; Medicine check opens as a pop-up there and on On hold. The Leads desk has Cards / Table /
  Board too.
- **Documents as Zoho prints them**: the invoice (no logo for 2MG, Zoho's totals only) and a new
  Sales order page (`/orders/:id/sales-order`) with Strength, Medicine Form, SC/PWD-Discount,
  More Information and Custom Fields.
- **The field only places the order**: the Management / Finance switch shows only to the office;
  Management says on approving whether Finance checks it too ("Finance checks it too").
- **The MedRep**: New order puts New customer first (a small form: kind, phone first, name, city,
  email; the rest under More details; an existing number offers "Use this one"), then Division,
  Sub-division and Payment terms as their own step 2 (dropdowns, the hub's lists). Home shows
  orders today and this month, sales against the target, the scorecard, My orders for Today /
  Yesterday / This month / a picked day (submitted, pending validation, in fulfilment, completed,
  cancelled, new customers), My KPIs (the old CRM's Hospital CHC card: IST 50, DSO 20, HRR 15,
  NZSD 15; no data is left out of the maximum; IST at 60% or less caps at 40; `orders/my-kpis.ts`),
  the period's orders and every hospital, doctor and patient they look after.

### 7.10 Management's Home, its orders told apart by MedRep, and its sidebar (15 Nov)

- **Management's Home** (`pages/management-home.tsx`, `GET /api/orders/company-kpis`): who and
  when; four figures (Waiting for you with the oldest wait, amber past 4 hours; Orders today; Orders
  this month; Sales this month against the targets); the company's orders for Today / Yesterday /
  This month / a picked day (Total submitted, Pending validation, In fulfilment, Completed,
  Cancelled, New customers); pills for on hold, with Dispatch to pack and on the way; then the queue
  to approve ("Waiting for you", the Orders to check board with all its tabs) with MedReps and
  Channels by what they sold beside it. "Waiting for you" and "on hold" open that queue on the Home
  (`/#queue`, `/?tab=hold#queue`), scrolled to.
- **Orders told apart by MedRep.** The board (`GET /api/orders/board`) returns `byRep` (every MedRep
  with orders in the open tab or step: their own channel and area, how many, how much, the oldest),
  counted in every filter but the MedRep, and each card its `medrepId`. Every orders board draws a
  MedRep strip under its search (`rep-strip.tsx`: Every MedRep, then one chip per MedRep with their
  count; a chip shows only theirs, again shows everyone) in place of the MedRep dropdown.
  Management's queue opens **grouped by MedRep** (one section per MedRep: who, channel · area, how
  many, how much, how long the oldest has waited, "Only theirs"); "By day" groups by the day placed,
  as before, and is All orders' default. A card outside a MedRep's section names the MedRep with
  their initials.
- **The customer lists** (Hospitals, Doctors, Patients, New customers; `GET /api/customers`) show
  four figures for the kind (how many, not checked yet, ordered this month, no order yet) and the
  same MedRep strip: whom each customer is under (their area's MedRep, else for a patient with no
  area whoever works their latest enquiry), `?medrep=` to see one person's.
- **Management's sidebar** is Home (the waiting count on it), All orders, New customers, and Look
  up: Medicines & stock, Hospitals, Doctors, Patients. "Orders to check" and "On hold" are gone from
  it: the Home holds that queue and its On hold tab (the pages still open for old links). A page a
  person's own sidebar lists keeps that sidebar (Medicines & stock no longer swaps Management's menu
  for Inventory's); the CEO's and admin's app links still open their apps. Long names have a short
  one for the phone's tab bar (Orders, To check, Stock).
- **Medicines & stock** opens with what is in stock: figures (medicines, low, out, promos running,
  each a filter) and the stock and its state as the table's first columns after the name.
- A local computer's demo also has Mia (HOS | Makati), Carlo (HOS | Davao) and Joy (RX | Cebu) with
  their customers and orders (`orders/seed-team.ts`, once), so Management's queue holds several
  MedReps' orders.

### 7.11 Sent back and fixed, approvals taken back, step times, medicine requests (15 Nov, night)

- **Sent back, fixed, sent again.** Management's Send back keeps its reason on the order
  (`sent_back_reason`, `sent_back_by`, `sent_back_at`, `sent_back_count`; migration 0022). The
  MedRep has **Sent back to me** in the sidebar (count on it) and on My orders; each card has
  **Fix and send again** (`/orders/:id/fix`: the New order form filled from the order, the customer
  locked, Management's reason on top, **Your answer to Management** required). `POST
  /api/orders/:id/revise` (`reviseOrder`) checks the lines with the same rule as a new order
  (`checkedLines`), replaces them, keeps the answer (`reply`) and writes every change on the
  timeline ("Changed: Anastrozole: ₱41.00 → ₱43.50 each"). "It's right as it is" sends it again
  unchanged, but only with an answer. Management sees the reason and the answer on the card and the
  order page, and has **Sent back** in the sidebar (orders waiting for a MedRep's fix).
- **Take back an approval** (`take_back`): Management may take back an approval given by mistake
  for 30 minutes (`TAKE_BACK_MINUTES`), only while the next desk hasn't acted on it (Finance hasn't
  checked the payment or made the invoice itself, no money on it, Dispatch hasn't packed). An invoice
  made with the approval is cancelled; the order is back with Management and leaves Finance's and
  Dispatch's lists. The card shows "Take back approval · N min left"; it needs a reason.
- **The approval card** keeps its one medicine line and adds one price line when the order isn't at
  the list price ("Price: list ₱13,050 → offered ₱12,300 −6%", free goods named), so a card stays
  the same height however many medicines. **History** on the card opens the customer's history
  (bought, owes, overdue with the oldest days late, invoices past due, last orders, what they take)
  with **Put this order on hold**, the amount owed already written as the reason.
- **Each step's own clock** (migration 0023): `sales_order.status_since` is when the order reached
  its current step, and `order_step` keeps every step with when it came and left, both kept by
  database triggers on every change of status. Cards count from the step ("1m", "29m", "1h", "3d",
  `shortSpan`); the order page's journey says how long each step took ("took 23m", "waiting 1h").
  This is the data team leads, managers and the CEO will read where orders wait.
- **Management's sidebar** (Aryan's choice): Home (the queue to approve), Sent back, On hold, All
  orders, Not checked yet (amber, Aryan likes it); Look up: Medicines & stock, Hospitals, Doctors,
  Patients. The MedRep-by-MedRep sections were taken out at his word: the MedRep view belongs on the
  team lead's and manager's pages (to build). The MedRep strip filter stays.
- **Medicines & stock:** adding medicines is Inventory's alone (`CATALOGUE_ROLES`); everyone else
  has **Medicine not available** (name, strength, pieces, for which customer, note). One open request
  per name and strength gathers every ask (`medicine_request`, `medicine_request_ask`); Inventory
  answers it once under **Medicine requests** (Ordered / Added to the list / Can't be had, a reason
  needed for the last), and whoever asked sees the answer under "What I asked for". An **A to Z**
  bar picks medicines by first letter, as the old CRM had.
- **Hospitals, Doctors, Patients** are cards like the Leads desk's (name, number, kind, place,
  under whom, orders, checked or not), Table kept as the other view; no initials tile beside a name,
  on the lists or the customer's page.
- Hub check (read-only, `docs/reviews/HUB-VS-NEW-CRM-2026-11-15.md`): 162 hub features, 59 present,
  43 partial, 43 missing before tonight; the fix of a sent-back order was the first gap and is done.

### 7.12 Dispatch's desk and the bell (15 Nov, night)

- **Dispatch's sidebar:** Home (the warehouse queue; to pack + to ship counted), On the road (count),
  On hold (Dispatch's own holds: held by Dispatch or stopped at one of its steps), All orders; Look
  up: Medicines & stock, Customers. Phone tabs: Home, Road, On hold, Orders, Stock.
- **Dispatch's Home** (`pages/dispatch-home.tsx`, `GET /api/dispatch/kpis`): four figures (To pack,
  Packed · to ship, On the road, Delivered today) with how long the oldest has waited (amber past 4
  hours; on the road past 3 days); pills for "wanted today or late", "came back, to send again" and
  "in your hands"; **Warehouse work** for Today / Yesterday / This month / a day (packed, shipped,
  delivered, came back, pieces out, time to ship = reaching Dispatch to leaving, from `order_step`);
  then the queue with the warehouse's own tabs (To pack, To ship, On the road, Came back, Delivered
  today, On hold, Coming to you) and "Shipped" by courier beside it. Couriers are kept on each step
  (`order_step.how`, migration 0025), so a parcel that came back still counts for its courier.
- **Dispatch's cards** carry the warehouse's facts, not prices: deliver to (receiver and address),
  pieces, the receiver's phone (tap to call), "Wanted today" / "Late · wanted …" from the delivery
  day, and **Take it / You have it · Let go / Marco has it · Take over** (`dispatch_by`, migration
  0024; packing or shipping takes it too), so two people don't pack the same order. A parcel that
  came back shows why (`came_back_reason`, `came_back_count`) and sits in Came back until it goes out
  again. No MedRep strip or step line on Dispatch's board; its search finds an address or tracking.
- **On the road** (`/shipments`): the longest out first, how long each has been out (amber past 3
  days), and Delivered / Came back / Add tracking on the row.
- **The bell** (top bar, every role; `notification`, migration 0024; `GET /api/notifications`,
  read one, read all): an order reaching Finance (payment to check, invoice to make) or Dispatch (new
  order to pack) tells everyone at that desk, written by the database trigger whichever code moved
  it; the MedRep hears when it is approved, sent back (with the reason), held, taken off hold,
  cancelled, taken back, on the way (courier and tracking), delivered, came back; Management hears a
  fixed order sent again (the one who sent it back), a hold by Finance or Dispatch, a parcel that came
  back; Finance or Dispatch hear an approval taken back; Inventory hears each "medicine not available"
  ask, and whoever asked hears the answer. Unread lines are bold with a coloured dot; opening one
  marks it read and goes to the order. Read every 30 seconds while the page is in front; no email or
  SMS. A new order placed by Management itself skips the bell for Finance (it has no number yet when
  it reaches them).

### 7.13 Three looks on every order list, the usual one first (15 Nov, night, Aryan's word)

- Aryan didn't like a new Dispatch Home or a new Finance Home replacing the board: **the board stays
  as it was** (Orders to check, its tabs, step line, MedRep strip, cards, side boxes), and every
  order list (Management's Home queue, Finance, Dispatch, All orders, On hold) has the Leads desk's
  switch at the top: **Cards** (the usual look, the default), **Table**, **Board**. The pick is the
  person's own, kept on their device per desk (`crm:view:<desk>`), and in the address (`?view=`).
- **Board** is each desk's work in columns: Dispatch 1 Pack → 2 Ship → 3 On the road (+ Delivered
  today) from `GET /api/dispatch/board` (`pages/dispatch-lanes.tsx`); Finance 1 Check payment → 2 Make
  invoice → 3 Collect with the money figures above from `GET /api/finance/board`
  (`pages/finance-lanes.tsx`); Management's Board is the orders by status (`OrdersLanes`).
- **Light by design:** the two Board views are their own code chunks (`React.lazy`), downloaded only
  when someone picks Board; while Board is open the cards aren't fetched behind it (the board query is
  switched off), so each look reads only its own data. Table is the cards' data drawn as rows.
- Dispatch's cards keep the warehouse's facts (deliver to, pieces, wanted by, who has it in hand,
  came back with why) instead of prices; Dispatch's tabs are as before (Needs you, Not yet with
  Dispatch, On hold, Delivered today). `GET /api/dispatch/kpis` stays for a later supervisor view.

## 8. Kept from the old CRM exactly as it is

Aryan compared my redesigns with these and prefers the old ones:

- **Company tree and map** (zoom, background, animation): `frontend/lib/company-tree.ts`,
  `frontend/components/company-tree.tsx`, the Philippines map under `/company/map`.
- **CEO Home**: `frontend/components/ceo-home.tsx`.
- **Leads & enquiries desk and the case page** (cards, journey chart).
- Behind the screens: Messenger (two pages), both websites, points, email, the quotation PDFs.

## 9. Look and where each screen lives

**Look (Aryan, 14 Nov night, final):** no look of our own. **The old CRM's look is the look**:
Inter, its quiet green, slate greys, soft white cards with 16px corners, its top bar (2MG logo,
the desk's or app's tile and name, search, the person) and its left menu (a tile and name on
top, 13px links, the open one on pale green with a green bar). **Inventory's screens copy Zoho
Inventory** the way the old CRM did: the menu grouped Items / Inventory / Purchases, tables
with small grey capital headings and blue links, a list's views as tabs with counts. Purple
and the SAP Fiori look were tried on 14 Nov and rejected. The tokens are in
`apps/web/src/styles.css`, lifted from the old `frontend/app/globals.css`; the pieces are in
`apps/web/src/ui.tsx`. Aryan judges by the rendered screen: render and look before showing.

**Desks and apps (Aryan, 14 Nov night).** A person's left menu holds **only their own work**;
nobody's menu is a list of everything.

| Who | Their menu |
|---|---|
| MedRep | New order (button on top), Home, My orders, My area, Medicines & stock |
| Management | As designed on the canvas: **Orders to check** (its Home), On hold, All orders, New customers (to check); under "Look up": Inventory, Hospitals, Doctors, Patients |
| Team lead, Manager | New order, **Home = the team's month** (what the team sold against its target with the pace, today, placed, stopped; each person under them by who reports to whom against their own target; the team's orders on hold or sent back), Team orders, Targets, Customers |
| Finance | **Orders to check** (its Home: Needs you = payments to confirm and orders to invoice; Not yet with Finance; With Dispatch; On hold; Delivered today; on the right what customers owe and what came in this month), Customers owe, Invoices, Payments received, Refunds owed, All orders; under "Look up": Inventory, Customers |
| Online desk | New lead (button on top), **Leads & enquiries** (its Home), My orders, Customers, Medicines & stock |
| Dispatch | **Orders to check** (its Home: Needs you = to pack, packed, on the way; Not yet with Dispatch; On hold; Delivered today; Medicine check and Stock to watch on the right), Shipments, All orders; under "Look up": Inventory, Customers |
| Inventory officer | The Inventory app itself |
| Admin | **Home = the Admin panel's Channels** (`/`, also `/admin/channels`): every sales channel as a card (code, Division, head, teams, team leads and MedReps with the vacant seats, areas and those with no MedRep), Add channel (code, name, Division from the list; its box at the top of the company is made with it), channels out of use folded below. A channel opens its structure (`/admin/channels/:id`): 1 its head, 2 its teams each with the team lead and MedReps (Add team, Add team lead, + MedRep, a vacant seat, close an empty team), 3 its areas with who holds each; Name & Division, Take out of use (only once nobody works in it) / Bring back. The sidebar is the Admin panel: Channels, Teams & people, Areas, Asks for people, Targets, Company details, Online pages & mail, and the apps as folders to look. |
| CEO | **Home = the old CRM's CEO Home**, brought over (greeting and month picker; sales against target with the pace, collected against the same days of the month before, what customers owe, orders waiting; "Your company": Sales, Orders, Money, Dispatch, Stock, Customers, People, Targets, each opening its app; channels against target; Needs you). Company tree. The apps: Orders, Finance, Dispatch, Inventory, Customers, Reports, each with its own menu and "Home" to come back |

- **An app has its own menu**, shown while one of its pages is open. Inventory: Overview;
  Items → All medicines; Inventory → Stock, Adjustments, Transfers; Purchases → Suppliers,
  Purchase orders, Receives. Customers: All, Hospitals, Doctors, Patients. Reports: its reports.
- Every desk has one link, **Medicines & stock**, into the Inventory app (to look; only
  Inventory and Dispatch change stock), with "Back to <desk>" on top. Management, Finance and
  the CEO also see suppliers and purchase orders there; a MedRep does not.
- The code: `apps/web/src/menus.ts` (`spaceFor`, `appsFor`).

**The sales line is the sales tracker's** (Aryan, 19 Nov: "treat the tracker as God"): **Head**
(Javed, Subir, Vanessa, Mhalou) → **Channel** (RX Business, MD Telesales · B2B, BID, CLIDP ·
TeleSales, HOSP · MT) → **Manager** (a team lead: Honey, Jessa, Subir, Reynan, Julius, Daniel,
Claire, Ken, Jim Lord, Mhalou) → **Sales person** (a MedRep, with their Zoho name and HQ). On the
chart: a head leads a business box; a channel is the box right under it; a manager leads a box in
the channel (HOSP holds Julius', Daniel's, Claire's, Ken's and Jim Lord's teams); a box with no
lead of its own belongs to the manager above. Seats with no target and no sales (admins,
coachees) stay on the chart but out of the sales views.

**Channels and their heads.** There are eight channels (HOSP, RX, B2B, BID, PAP, TS, MT,
ONLINE). The old CRM worked a channel's head and team out from several places and got it
wrong (Aryan). Here it is one fact each: **a channel's head is one person named on the
channel** (`channel.head_id`, set by the Admin, never guessed from roles), **a person belongs
to one channel** (`person.channel_id`) and **reports to one person** (`person.reports_to`).
The channel's team is drawn from those: the head, who reports to the head, who reports to
them. A channel with no head named says "No head named".

**Reports** (Admin and CEO). **Sales by channel**: each channel's sales against its people's
targets with the pace, its head, people, MedReps, areas, customers and its team as a tree, by
month. **Sales by person**: every seller against their target. **Company tree**: the old CRM's
tree as it was (Org chart and Tree views, search, zoom, details), on the new data: CEO → heads
→ channels → each area's MedRep under the person he reports to, the month's figures on each.

**What a sale is** (14 Nov, step 7): what Finance invoiced (not cancelled), on the Manila day
it was invoiced, counted for the order's MedRep and channel: what Zoho's "Sales by salesperson"
and the CEO's sheet count. A target counts the same; the MedRep's Home bar, Targets, the team
pages, the channel report, the CEO Home and the tree all read it. Orders placed but not yet
invoiced show beside it as "placed".

## 9.1 What the hub, Zoho Inventory and the old CRM have, and where each lands here

Looked at closely on 14 Nov (hub as Management, Zoho Inventory as the CEO, both read only).
This is the checklist for the steps ahead: nothing here may be forgotten.

**The hub, Management's screens**

| Hub screen | What it holds | Here |
|---|---|---|
| Global Dashboard | Stock news; "Needs your attention" (awaiting approval, on hold / exceptions, stuck over 48h); tiles Orders today (and this week), Pending payment, Ready for dispatch, In transit, Exceptions / on hold, Processing time (median); orders by status as chips that filter the table; the orders table (order, customer, MedRep, status, total, date) with search, MedRep and date filters, total orders and value, CSV | Home has the attention strips, tiles and stock news today; the order tiles, status chips and table join in step 4 |
| Approval Queue | One card per order waiting: number, customer, MedRep, credit or not, amount, how long it has waited; Approve, Send back, Reject | Step 4, with what the system found on each card |
| Exception Hub | Orders on hold, critical exceptions, cancelled; a table with the flagged state and the reason | Step 4 ("On hold") |
| All Orders Log | Every order with filters | Step 4 |
| Refunds owed | Paid orders that were cancelled: amount held, who cancelled and why, days waiting; pending / done / none due | **Built** (step 5): Refunds owed and Given back |
| Refund requests | A MedRep asks a refund on a paid order: needs decision → waiting for returned goods → ready to refund → done | With returns, in step 6 (Dispatch takes the goods back) |
| Pending Customers | New customers with details missing (email, licence number, dates, TIN) | Built in step 2 as **New accounts**; the "what is missing" line is still to add |
| Not yet with Finance | Stage tiles (awaiting you, not yet with Finance, invoicing, in fulfilment, completed, needs attention), the month's forecast, sales and today | **Built** (step 5) as Finance's Orders to check tabs; the month's sales figures join the reports in step 7 |
| Create New Order | Management raises an order itself (it skips the queue) | Step 3 / 4 |
| Announcements & promos | Stock news and promos, posted by Dispatch | Stock news built; promos are on the medicine |

**One order in the hub** (the model for our order page): number, customer and whether it is
on credit, MedRep and who raised it, when; status and amount; delivery address and handling
note; details (division, salesperson, doctor, receiver and contact, source, delivery method,
payment terms, invoicing company, expected shipment, TIN, terms); the buttons for the stage
(Approve, Send back, Reject, Put on hold, Mark exception, Request refund, Edit details); tabs
**Audit timeline** (10 stages: Created → Management approved → Confirmed → Finance verified →
Invoiced → Paid → Packed → Shipped → Delivered → Completed, each with its updates: who did
what and when, a stock warning the MedRep acknowledged and his note, files attached), **Order
items** (medicine, SKU, unit, qty, price, tax, warehouse, amount; Edit items), **Payment**,
**Dispatch**, **Attachments**.

**Zoho Inventory, section by section**

| Zoho section | What it holds | Here |
|---|---|---|
| Home | Top selling, top stocked, sales by channel, sales order summary, top vendors, receive history; Pending actions: to be packed / shipped / delivered / invoiced, to be received, receive in progress, below reorder level, transfer in progress | Home: stock tiles, to be received, top stocked, activity. The sales figures join as orders are built |
| Items · Items | Every medicine: SKU, unit pcs, pack, cost and selling price per piece, batches, warehouses | **All medicines** and the medicine page (built) |
| Items · Price Lists | Named price lists (one exists) | Prices per kind of buyer on the medicine (built) |
| Items · Composite Items, Assemblies | Not used by the company | Not built |
| Inventory · Adjustments | Reason (given as sample, donation, damaged), reference, who, warehouse | **Adjustments** list (built); a reason picked from a list is still to add |
| Inventory · Packages | A board: packages not shipped, shipped, delivered | **Built** (step 6) as Dispatch's Orders to check |
| Inventory · Shipments | Shipment, customer, sales order, package, carrier, tracking, status | **Built** (step 6): Shipments |
| Inventory · Transfer Orders | Number, reason, quantity, from and to warehouse (Main → Davao, Cebu, Consignment) | **Transfers** list (built) |
| Inventory · Move Orders, Putaways | Bins inside a warehouse | Not built |
| Sales · Customers | The customer master | Hospitals, Doctors, Patients (built) |
| Sales · Sales Orders | Date, number, the hub's reference, customer, status, invoiced, payment, packed, shipped, amount, delivery method; one order shows its invoices and packages, salesperson, division, headquarter, source | Steps 3 to 6: the order is ours, not a copy |
| Sales · Invoices, Payments Received, Sales Returns, Credit Notes | The money after an order | **Invoices and Payments received built** (step 5); sales returns and credit notes come with returns in step 6 |
| Purchases · Vendors | Suppliers | **Suppliers** (built) |
| Purchases · Purchase Orders | Date, number, reference, vendor, status, received, billed, amount, delivery date; one order shows Order / Receive / Bill status, "What's next", each line's received and billed | **Purchase orders** (built: list with tabs, status, What's next, landed cost). Billed is step 5 |
| Purchases · Purchase Receives | Date, receive number, purchase order, vendor, quantity | **Receives** list (built) |
| Purchases · Bills, Payments Made, Vendor Credits | Paying suppliers | Later, with Finance |
| Reports; custom: sales target, batch details, salesperson item sale, city sale, CEO dashboard | Reports the CEO uses | Step 7 |

**The old CRM** already drew Zoho Inventory's screens (lists with views, a record as a
document with a status ribbon, a packages board, the item page with Overview / Warehouses /
Batches / Transactions / History). Its code is tied to the old kernel and can't be lifted as
it is; its screens are the reference for the same pages here, on the new API.

## 10. Technology

### 10.1 Decisions

| Question | Answer | Why |
|---|---|---|
| Scope | **Everything is new**: code, database, screens | Aryan's decision, 14 Nov: a complete new project with a free hand on every choice. The old CRM is reference only. |
| Language | **TypeScript**, frontend and backend | The work is database reads and writes, so the language does not set the speed; the database design and the number of queries do. One language means the frontend and backend share the same types and one person or AI can work on all of it. |
| Company | **One company** | The old CRM was built to be sold to many businesses, so every table and query carried a company. This one is for 2MG / GetMeds only: simpler tables, faster queries. The two invoicing companies are a field on the order. |
| Frontend and backend | **Separate apps, one repository** | The API also serves the two websites, Messenger and later a phone app. Each can be deployed and scaled on its own. Sharing one repository keeps the API contract in one place. |
| Frontend | **React single-page app (Vite)**, installable on a phone | Everyone is signed in, so nothing needs to be rendered on a server. The browser loads the app once from a CDN and then only asks the API for data: moving between screens is instant. This is how the hub is built. The old CRM renders every page on Vercel, which then calls the API, which then calls the database: three hops per page. |
| Backend | **Node.js, Hono, Zod, Drizzle** | Small, fast, well understood. Plain routes: one call per screen. |
| Database | **A new PostgreSQL database**, designed for this business | Plain tables with strict rules in the database itself (foreign keys, checks, unique keys), money in whole centavos, an index for every list. On a developer's computer and in tests it is an embedded Postgres (PGlite): nothing to install. |
| Schema changes | Hand-written SQL files in `new/apps/api/migrations`, applied in order on start | Every table, index and rule is readable in one place. |
| Sign-in | Our own: one login per person, password hashed with scrypt, a session cookie the browser's scripts cannot read, only the token's hash stored, lock after 5 wrong passwords | One query says who is asking. No auth library to work around. |
| Files | `src/files/store.ts`: in the row on a developer's computer (`STORAGE_DRIVER=db`), in a private Supabase Storage bucket online (`STORAGE_DRIVER=s3`, the row keeps only the key) | Photos never sit in the live database. Every photo, whatever sent it (browser, Messenger, email, a website), is made 1600 px WebP 60 on the server too. |
| Live updates | Server-sent events | Added with the order line (step 3). |

### 10.2 The old systems while this is built

- The old CRM (this repository's `backend/` and `frontend/`), the hub and Zoho **keep running**
  as they are. The live Online desk, Messenger, the two websites and points stay on the old CRM
  until step 8 rebuilds them here.
- The new code imports **nothing** from the old code. The old code is read for how a rule works
  (stock by batch, pricing, relief, Messenger, the websites' contract) and the rule is written
  again, cleanly, with its tests.
- **Data comes over by import scripts at the switch**: medicines and prices, stock by batch,
  customers, people and areas, open orders, leads. Each import is a dry run first.

### 10.3 Layout

```
new/                 The new project. Self-contained: it can move to its own repository as it is.
  apps/api           The API. src/ (code), migrations/ (SQL), tests beside the code.
  apps/web           The React app. Screens only.
backend/, frontend/  The old CRM. Reference, and still running live.
```

### 10.4 Deployment

| Piece | Where | Note |
|---|---|---|
| Web app | Static files on a CDN (Cloudflare Pages or Vercel) at `app.<domain>` | No server to keep warm |
| API | Render (or Fly.io), Singapore, always-on paid plan, 2 instances | Nothing is kept in a server's memory that another server needs, so any number of instances can run |
| Database | A new Postgres in Singapore (a new Supabase project, or Neon), paid plan with daily backups | Same region as the API |
| Domain | Web on `app.<domain>`, API on `api.<domain>` | One parent domain keeps the sign-in cookie first-party without a proxy hop |

**Own server (Docker on Coolify, 20 Nov):** for the company's own server (bishnoi-one) each
app has its own image, built from the repository root: `apps/api/Dockerfile` (Node 24 slim, runs
the TypeScript with tsx, port 4100, `/api/health`; production needs a Postgres in `DATABASE_URL`)
and `apps/web/Dockerfile` (Vite build served by nginx on port 80, which passes `/api` and
`/webhooks` to `API_UPSTREAM`, so the cookie stays first-party as with Vercel's rewrites).
Settings: `apps/api/.env.production.example`, `apps/web/.env.production.example`. On Coolify,
three resources: a PostgreSQL, the API with no domain and the container name `crmnew-api`,
the web app on `https://crm.<domain>`. The steps are in docs/DEPLOY-COOLIFY.md.
`docker-compose.yml` does the same without Coolify. Vercel Analytics records nothing off Vercel.

### 10.5 Speed and size

- Size to plan for: 130 people today, 300 later, about 250 requests a minute at the busy hour.
  One Node instance handles that; two give safety and deploys with no downtime.
- **Budget:** a screen's data in under 300 ms, an action (place, approve, deliver) in under
  1 second, measured in Manila.
- **How:** one API call per screen; at most about 15 database queries per call (the old CRM
  uses 100 to 260 for one action); an index for every list filter; lists come in pages.
- Every response reports its time and query count (`Server-Timing`); a screen that goes over
  the budget is fixed before the next one is built.
- To verify before going live: round-trip time between the API and the database in Singapore,
  and a load test against a staging copy.

### 10.6 Safety

- The API checks the role on every call; the screen hiding a button is never the only guard.
- Every change to an order, a price or stock is written to the audit log with who and when.
- Nothing with history is deleted: archive, cancel, or reverse.

## 11. Not in version 1

Decide each one with Aryan when version 1 is in use: field visits, attendance and expenses
(SEFMED); HR, leave, payslips; scorecards and KPIs beyond sales against target; doctor rebates;
samples; tenders as their own module; the accounting ledger and statements. (The Zoho history
import was brought forward: 12.18.)

## 12. Build order

Each step is finished only when it has been walked in the browser as the real role, on real
data, and Aryan has seen it.

| # | Step | Done when |
|---|---|---|
| 0 | New app skeleton: sign-in, role decides the menu, the look | A MedRep, Management, Finance, Dispatch and CEO login each open their own empty home |
| 1 | **Inventory** | Stock by warehouse and batch, prices per buyer type, receive, move, alerts, stock news; all roles can open it |
| 2 | Masters (**built**, 14 Nov) | Hospitals, doctors, patients with area and MedRep; old-customer check by name or number |
| 3 | MedRep: Home and New order (**built**, 14 Nov, as the canvas "Main" and "NewOrder") | A MedRep places an order from his phone with price picking and a reason for a lower price |
| 4 | Management (**built**, 14 Nov: Orders to check, On hold, All orders, New customers, the order page) | Queue with the system's findings, Medicine box, approve / hold / wait for stock / send back, warehouse choice, order page |
| 5 | Finance (**built**, 14 Nov) | Payments to confirm, hold, invoices, payments, customers owe |
| 6 | Dispatch (**built**, 14 Nov) | Pack, courier, ship, deliver; stock leaves by batch |
| 7 | Team lead / Manager, CEO (**built**, 14 Nov; the tree's map not yet) | Team orders and sales; CEO Home and Company tree brought over as they are |
| 8 | Online (8a **built** 14 Nov: Leads & enquiries desk and case; 8b **built** 15 Nov: Messenger, email and the Inbox; 8c **built** 15 Nov: any number of websites; 8d **built** 15 Nov: points and the quotation PDF; 8e **built** 15 Nov: points on the 2MG website) | Leads & enquiries, Messenger, the two websites and points rebuilt here; their orders join the same line |
| 9 | Switch | Data imported, staging load test, then people move channel by channel; hub, Zoho and the old CRM stop being used |

How to run it: [new/README.md](../new/README.md).

Built so far: see the change log.

## 12.1 Next: people, teams, desks and SaaS (plan, 15 Nov)

Before the Team lead page: the job (seat) is kept apart from the person, so people can join,
leave, move and cover without moving any work by hand; Management, Finance, Dispatch and Inventory
are desks (pools of seats) of any size; a team lead's and a head's reach is their unit of the
tree; the tree is also the CEO's report. Then the SaaS layer (company on every record, setup,
sign-in, landing page). The plan, the order of work and the questions:
[architecture/new-crm-people-teams-saas.md](architecture/new-crm-people-teams-saas.md).

### 12.2 As built: teams and seats, and the CEO adds people (15 Nov, Aryan's go)

Aryan's answers: any Management person approves any order; Team lead, Manager and Head are one kind
of work whose reach is their part of the tree; one person may hold two seats; an empty MedRep
seat's customers wait with the team lead; the CEO and the Admin add and remove people.

- **Data** (migration 0026): `org_unit` (the company, businesses, lines, teams, departments; a
  channel on the box that sells), `seat` (a job in a unit: its title, the work it does (one of the
  modules), lead or not, the area it covers, whom it reports to when not the unit's lead) and
  `seat_holder` (who sits in it from a day to a day; `acting` = covering until a day). One holder
  per seat, one seat per area. Orders keep the seat they were sold from (`sales_order.seat_id`: the
  seat of the customer's area, else the MedRep's seat).
- **The tree writes the people** (`projectOrg`): each person's role, title, channel, area and boss
  come from their first seat; a seat's boss is its unit's lead (a lead's: the lead above), a vacant
  boss seat is skipped upwards and a cover counts as its occupant; each channel's head is whoever
  leads its top box. So every screen built before keeps working. It runs after every change and
  every 15 minutes (a cover ends by itself after its last day).
- **What follows the seat:** a MedRep sees the customers of the areas of the seats they sit in or
  cover and every order sold from their seat (the person before them's too); a team lead sees the
  customers of every seat under them, empty ones included.
- **Teams & people** (`/people`, CEO and Admin, in their sidebar): the tree on the left (a list to
  pick from on a phone), the box picked on the right with its lead, its seats by work (MedReps, Team
  leads, …) and its boxes under it. **Add person** (or "+ Add MedRep" on a group) makes the login
  (email as the login ID, a password typed or made and shown once with Copy), the seat, whom they
  report to and their area (an existing free one or a new one with its cities) in one step. A vacant
  seat shows amber with **Fill** (a new person, or someone already here, moving or keeping their
  seat). Per person: **Leaves** (the login stops at once, the seat stays with its customers and open
  orders), cover (until a day), change the seat, a new password. Boxes: add a team under, rename,
  close when empty; a vacant seat to fill later.
- Demo: the tree is shaped like HR's chart (Hospital Division → NCR 1 / Mindanao / Patient
  Assistance; Prescription Business → Doctor dispensing / referral / MD Telesales; Sales &
  Marketing; Modern Trade; Online; Management; Supply Chain, Ops & Finance). The RX head's and
  Mindanao lead's seats are vacant; Daniel covers Mindanao, so Carlo reports to him; one MedRep seat
  in NCR 1 (HOS | Quezon City) is empty and its customer waits with Daniel.
- Not built yet: the Team lead / Head page, the tree as the sales report, HR adding people, a
  later start or last day (both are today or earlier for now), turning an existing company's people
  into seats in one step (the demo builds its tree; the real switch will need that import).

### 12.3 As built: the team lead's and head's My team (15 Nov, night)

`/my-team` (sidebar "My team" for team leads and managers; the CEO and the Admin open any box from
Teams & people → "Its work", `?unit=`). Read from the seats under the person in the tree, so a head
sees every team under them, a cover brings the covered team in, and an empty seat is a card too.

- **Top:** sold this month against the team's targets with the pace, orders moving (and the oldest
  wait at its step), Needs you (sent back, on hold, late, unpaid, empty seats), what customers owe
  (and how much is past due).
- **Needs you:** sent back first, then on hold, then late at a step (Management after 4 hours,
  Finance and packing after a day, the road after 3 days), payments past due, and an empty seat
  whose customers or orders wait with the lead. Each opens its order (or the seat).
- **One card per seat**, grouped by team: the person (or Vacant), the area, sold against target,
  where the open orders stand (Management, Finance, Packing, On the road, On hold, Sent back),
  customers, orders this month, the last order, the oldest wait, owed and late.
- **A seat's page** (`/my-team/seat/:id`): the person, phone and email, in the seat since; the
  month; its orders as the usual cards by stage; its customers. Orders count for the seat they were
  sold from (`?seat=` on the orders and customers lists), so the history stays with the area when
  its MedRep changes; a lead also sees every order sold from a seat under them.
- Home for team leads is still the team's sales month as before; My team is a separate link until
  Aryan picks which is the Home.

### 12.4 As built: Team lead = Mentor + Coach, seat login IDs, My team with pictures, Targets, Messages (15 Nov, late)

- **Team lead** covers the chart's Mentor (head) and Coach (district lead): same work, reach =
  their part of the tree. "Manager" is no longer offered (it reads as Team lead).
- **Login IDs belong to seats** (migration 0027): `hos1`, `rx1`, `tl1`, `fin1`, `ceo`…, typed with
  or without `@2mginc.com`; the seat's current holder signs in with it. A person's email is optional.
- **Desktop sidebar hides and shows** from the menu button; the choice is kept per browser.
- **My team** for any days picked (Today, This week, This month, Last month, Last 30 days, This
  year, or two dates): six figures with icons (sold with a ring against the target, collected,
  placed, delivered, new customers, owed), sales day by day, orders right now as a donut, the team
  as a chart (lead → seats → teams under, each box clickable), a card per team and per person (the
  customer cards' look: ring, sold / orders / collected, a sparkline, where orders stand), who sold
  most against target, Needs you, medicines sold, customers by kind, time at each step. Monthly
  targets are shared out over the days picked.
- **Targets** as cards: the team's target and sold with the pace, sold against target per person,
  each team's people with the target typed in place, "same as last month" per person and for all
  the empty ones (`POST /api/targets/copy`), and what is left a day.
- **Messages** (migration 0028): one person to another, to a team (everyone under it), to a few
  people, and announcements (one way) to a team (its lead) or to everyone (the CEO, the Admin), with
  who has seen them. Announcements and team messages ring the bell; Messages has its own count in
  every sidebar.
- The 8 channels in plain words, BID step by step, and the plan for the SaaS apps page:
  [architecture/new-crm-channels-and-apps.md](architecture/new-crm-channels-and-apps.md).

### 12.5 As built: who does what, areas, asks for people, the CEO looks anywhere (15 Nov, late)

- **Team lead vs Management:** a team lead never approves, sends back, holds or takes back an
  order (only Management does). The team lead's list is "Stuck in your team (you chase, the desk
  decides)" and each line says whose step it is ("Management sent it back to Ryan: …"). A team
  lead places orders for any MedRep of theirs (and an empty seat's customers), and works the
  team's orders as their MedRep would (change log 95).
- **Areas** (Teams & people → Areas): every channel's areas with their cities, the seat holding
  each (or vacant / none) and their customers; the CEO and the Admin add and change them. Customers
  of an area's cities who have no area yet join it.
- **Asks for people** (migration 0029): a team lead asks from My team → "Ask for a new person"
  (their team, MedRep or team lead, a free area or a new one with its cities, a name and phone or
  just an empty seat, why). The CEO and the Admin see "Asks for people" (and the bell): Approve
  makes the area, the seat and, with a name, the login (shown once); Decline needs a reason. The
  team lead hears either way.
- **The CEO's Company view** (`/my-team` in their sidebar): the whole company's figures, charts,
  medicines, customers, who sold most; then its teams as cards and as a boxes-only chart, each
  opening that team (Company › Hospital Division › NCR 1 › a person › their orders and
  customers), with the dates kept. A head drills into the teams under them the same way.
- **See as** (migration 0029): the CEO or the Admin opens anyone's screens exactly as they see them
  (from their page on My team, or the seat's menu in Teams & people), with an amber bar "You are
  looking as Ryan … Back to Naresh". Nothing can be changed while looking (the API refuses every
  write), the session ends after two hours, and the session row keeps who looked.

## 12.6 Sidebar folders, Messages boxes, regions and areas, desk work (15 Nov, late)

- **No sidebar swaps.** A link with pages under it is a folder that opens in place (Orders,
  Company, Finance, Dispatch, Inventory, Customers, Reports for the CEO; My orders / Team orders
  by stage for MedReps and leads; My team with its teams). Under Company the divisions are listed,
  and the open division's teams under it (`GET /api/org/menu`). Speed is its own link.
- **One Back button** in the top bar on every page (the page before, else Home); teams keep a
  small "up one level" arrow in their breadcrumb. No other back buttons.
- **No bell.** Messages has three boxes: Needs you (what waits on the person: sent back, to pack,
  to finance, requests, holds, announcements), Updates (the news of what moved) and Chats; the
  sidebar counts each.
- **Regions and areas by request.** A team lead asks (My team → Ask for: Person · Region · Area):
  a region is a new team under theirs, optionally led by one of their people (who keeps their own
  seat); an area is its cities, optionally given to a seat of theirs with no area. The CEO/Admin
  approves under Teams & people → Requests (counted in the sidebar); then it is made and the team
  gets an announcement on Messages ("New region: Visayas, under Hospital Division. Daniel leads
  it."). Hospitals are added by MedReps (they bring them) and checked by Management (Not checked
  yet); no CEO approval.
- **Desk work, not sales, for desks.** A team with no sellers, target or sale (Supply Chain, Ops &
  Finance; Management) shows each person's orders moved on, average time against the step's
  limit and late ones (from Speed), instead of Sold / Collected.
- **Speed:** a step card opens that step's people (who takes how long, average, late); the list of
  slowest orders is gone.
- **CEO Home** takes any days (Today, This week, from–to; targets shared out by days) and shows
  money at a glance: To come in (customers owe, past due, COD with couriers, collected) and To go
  out (refunds owed, supplier orders not received). Supplier bills aren't kept yet.
- **Rule fixes:** COD money is recorded only after delivery; changing payment terms at Finance
  moves the order to that terms' Finance step; credit counts its days from delivery (owed still
  counts it); a MedRep / lead / Online reads the invoice of an order they may read; a lead's order
  in a MedRep's name takes that MedRep's division and area; the CEO doesn't see New order; a lead
  fixes only his own sent-back orders; team threads take in newcomers.
- **Look:** cards like Speed's (ring, bar, small stat tiles), donuts and ranked bars wherever data
  is shown: the owner's direction for the whole product.

## 12.7 Next: HR, the field (SEFMED), the SaaS look (plan, 15 Nov night)

Aryan's order: attendance and a working-hours clock first, then the SaaS look, then SEFMED's work,
then the whole HR portal. What the HR portal and SEFMED do, what we have and where each goes:
[reviews/HR-PORTAL-AND-SEFMED-2026-11-15.md](reviews/HR-PORTAL-AND-SEFMED-2026-11-15.md).

- **HR app** (teal): everyone's *My day* in the top bar and *My attendance*; an HR desk (new role)
  with Who's working, each person's DTR, leave, forms (OB, WFH, overtime), holidays and hours,
  payroll and employees; team leads see and approve their team's; the CEO sees it in the apps and
  *At work today* on the Home. Hours and holidays are HR's setup, not the Admin panel's.
- **Field app** (SEFMED's daily use, not a copy of SEFMED): the MedRep's day with its start (=
  attendance), visits with the call report, the month plan the lead approves, doctors to see by
  class; masters stay in Customers.
- **The system, drafted for Aryan (15 Nov night):** one person = login + employee record + seat;
  HR is an app inside the CRM (everyone's "Me", the team lead's team, an HR desk, the CEO's view),
  not a second website; **joining**: HR adds the joiner into a vacant seat and types the login
  email and password it made for them (Aryan, 15 Nov: no invite link, no email from the system;
  HR hands them over); leaving keeps the record. The SaaS look waits until HR and the field are done.
  [architecture/hr-and-field-system.md](architecture/hr-and-field-system.md).

### 12.8 As built: working hours, attendance, and desks timed in working hours (15 Nov, step 1)

- **Hours** (`work_schedule`, migrations 0034–0035): the company's as HR keeps them, Monday to
  Saturday 7:00–16:00, an hour's lunch, no grace; a person may have another (a shift). **Holidays**
  (`holiday`, 0036): the 2026 national ones from Proclamation 1006.
- **Attendance** (`attendance`, one row a person a day): the day starts with the first thing a
  person does in working hours (or *Start my day*, any day), ends with *End my day*, else at the
  last thing they did. Late and undertime in 15-minute blocks rounded up, after hours rounded
  down, lunch off a day over five hours (`src/hr/work-time.ts`, shared with the web). HR (the
  Admin as backup; 12.10) puts a day right with a note; a team lead sees their team; anyone their own.
  Screens: the top bar's *My day*, Who's working (`/hr/attendance`, a day's people, counts that
  filter, their month so far), a person's month (`/hr/attendance/:id`), *At work today* on the CEO
  Home. Demo databases get two weeks of attendance.
- **Desks timed in working hours** (Aryan: people stop at four or five; an order left overnight
  isn't late): Management 4 working hours, Finance, Dispatch and a sent-back fix one working day,
  the road three days on the clock (`orders/late.ts`, `orders/clock.ts`, the database's
  `work_minutes()`); Speed, the team pages, Stuck (two working days), the CEO's counts and every
  desk card use it.

### 12.9 As built: HR's people and joining (15 Nov, step 2)

- **The HR role and desk** (migration 0037): HR's Home is **People** (`/`, also `/hr/people`):
  everyone with their job, company (2MG Inc. or Getmeds Philippines, one roster), first day, the
  login they sign in with, and what is missing on their record; tabs Working · Joining · Details
  missing · Left. Sidebar: People, Joining, Who's working. The CEO sees the same under Apps › HR.
  Demo: Helen, HR officer, in the HR department.
- **The employee record** (`employee`, one per person, kept when they leave): employee ID
  (unique per company), classification, position, department, hire and regular dates, mobile,
  personal email, birthday, address, emergency contact, monthly salary and allowance, bank, SSS,
  PhilHealth, Pag-IBIG, TIN. HR, the CEO and the Admin edit it (`Edit record`); pay, bank and IDs
  are seen only by them and the person; a person opens their own record.
- **New joiner**: name, mobile, a vacant seat (grouped by team), first day (up to three months
  ahead: the seat is kept for them, nobody else can be put in it), company, classification,
  employee ID, position, pay, and the **login email and password HR made** ("Make one" offers a
  readable password). Then HR sees both once more with Copy, and hands them over. The person signs
  in straight into their seat's desk; no forced change. The login email can't be someone else's or
  another seat's login ID.
- **Change login** (HR): a new login email or a new password typed by HR; a new password signs
  them out everywhere. **Last signed in** (`person.last_sign_in_at`, 0038) shows whether the
  handed-over login has been used.
- **Mark as left** (HR): last day and why; the login stops, the seat falls vacant, the record and
  the seats held stay. Never deleted.

### 12.10 Who does what: HR works, the CEO reads (15 Nov, Aryan)

Aryan: the HR work had gone into the CEO's screens; the CEO needs the full report (who worked how
long, who less, who took leave), and HR needs its own work.

| Who | What they do | Screens |
|---|---|---|
| **HR** (desk) | Adds joiners and their logins, keeps records, puts a day's times right (with a note), **records leave** (VL, SL, without pay, other; a half day), marks people as left | People (Home), Joining, Who's working, a person's month (Record leave, put a day right), Attendance report |
| **CEO** | Reads only: no button changes a person or a day | Home's *At work today* (now with *On leave*), Apps › HR › **Attendance report** and People (no New joiner, no edits), Apps › Field › **Visits report** |
| **Team lead** | Sees the team | Team attendance (with its Report), Team visits |
| **Admin** | Setup; HR's backup when there is no HR person | Admin panel |

- **Leave** (`person_leave`, 0039): recorded by HR from the person's form or message, approved as
  recorded; overlapping leave refused; only working days count. A day on leave is never absent; a
  half day isn't counted late or short. Cancelling keeps the row. (People filing their own leave
  and the team lead approving it come with HR's leave step.)
- **Attendance report** (`/hr/report`, any days, This month by default): came in against the
  working days (leave left out), hours worked against what the days ask for, late, absent and
  leave by kind; per person ordered by *Fewest hours* (against their own days, so leave doesn't
  rank someone short), *Most late*, *Most absent*, *Most leave*. A person opens their month.
- Days before someone joined (their hire date, from their first seat) are never absences.

### 12.11 Field app, step 1: visits (15 Nov)

SEFMED's daily use, inside the MedRep's desk (not a copy of SEFMED): `visit` (0039), owned by the
person and their seat.

- **MedRep** (*Visits*, `/visits`): a day's visits (To visit · Done · Skipped). *Plan a visit* to a
  doctor, hospital or drugstore they look after (today to two months ahead; one open visit a
  customer a day), with a call objective. On the day: **Check in** (time and the phone's place;
  none shared is allowed and said), then **Report the call**: medicines detailed with how the
  doctor took each (will prescribe, already prescribes, wants more information, not interested),
  notes, the next visit (planned by itself). No empty call. **Skip** with a reason (doctor not
  available, busy, clinic closed, out of town, moved, other with a word); **Move** one not started.
- **Team lead** (*Team visits*) and the **CEO** (Apps › Field › *Visits report*): any days; done,
  skipped, still planned, customers covered, field days and calls a day per person; *Most* /
  *Fewest visits*, *Most skipped*; a person opens their day to look. Management sees everyone too.
- Next (field step 2): the month's visit plan the lead approves, doctors to see by class (A–D),
  the clinic's pin and the place check at check-in, the SEFMED import of doctors and hospitals.

### 12.12 Field step 2: the month plan, classes, the clinic pin, field expenses (15 Nov)

Aryan: the **team lead runs the team's field** (as in SEFMED) and the **CEO reads all of it**;
expenses (petrol and the rest) go with the visits, each with the photo of its bill.

- **Class** (`customer.visit_class`, 0040): A 4 visits a month, B 2, C 1, D 1, none yet once. Set by
  the team lead (for the customers their team looks after), Management or the Admin.
- **Visit plan** (`visit_plan`, *Visits › Visit plan*): *Make my plan* gives every customer the
  visits its class asks for, less those planned or done, over the working days left (leave and
  holidays off), each on the least busy day near its share of the month, never twice a day;
  nothing planned moves. *Send to my team lead*; the lead approves or sends it back with a word
  (then the MedRep changes and sends again). The plan never stops the day's work. The page shows
  each customer's class, a month's need, planned, done and last visit, and visits by day.
- **Clinic pin** (`customer.pin`): the MedRep pins a clinic from a check-in there when it has none;
  only the team lead (Management, the Admin) moves a pin. Each check-in is compared with it
  (`visit.distance_m`): over 300 m is *Away from the clinic (1.1 km)*, said, never refused.
- **Field expenses** (`field_expense`, *Visits › My expenses*): petrol (with km), fare, parking,
  toll, food, lodging, other (with a word); a day up to 31 back, optionally for a visit that day;
  **the bill's or payment proof's photo is required** (made smaller before it goes; a fare may
  have none). The team lead approves each line or sends it back with a word (*Team visits ›
  Expenses to approve*); a sent-back line is put right and waits again; an approved one is fixed.
  The bill opens for the person, their team lead and those who read everyone's.
- **What the CEO reads** (*Apps › Field › Visits report*, also the team lead's for the team):
  per person done, skipped, planned, covered, field days, calls a day, **customers seen as their
  class asks this month**, **check-ins away from the clinic**, **this month's plan** (no plan, not
  sent, with the team lead, approved, sent back) and **spent** (approved, plus what waits), with
  spent a visit. A person's plan and expenses open from their row.

### 12.13 HR step 3: people ask for their own leave (15 Nov)

- **My leave** (`/me/leave`, every desk's sidebar except the CEO's and the Admin's): vacation and
  sick leave left this year as rings, leave without pay taken, every request with where it stands
  and who decided it. **Ask for leave**: kind, from–to or half a day, reason, an optional paper
  (a medical certificate, photo made smaller). Days from a month back to six months ahead, one
  year at a time; rest days and holidays don't count; overlapping leave is refused.
- **Days a year** by classification: regular 10 VL + 10 SL; probationary, part-time and interns
  none (they ask for leave without pay). Asking past what is left says what is left.
- **Who decides**: whom the person reports to; HR when that is the CEO, the Admin or nobody. HR
  may decide any (backup); the CEO never (reads). Refusing needs a word. The approver is told
  under Messages › *Needs you*; the person under *Updates*. Approved leave counts in attendance
  and the CEO's attendance report; refused or cancelled never does.
- **Cancel**: the person cancels a request, or approved leave not started yet; HR any.
- **Leave** list (`/hr/leave`): *Waiting for you* (a badge on the team lead's *Team leave* and
  HR's *Leave*), Asked, Approved, Not approved, Cancelled; any month or every month; a person
  opens their month. The CEO reads it under Apps › HR › Leave. Migration 0041.
- Not yet: accrual by month, carrying days into next year, HR changing someone's days a year,
  forms (OB, WFH, overtime).

### 12.14 Field: the calendar and where the team is (15 Nov)

- **Calendar** (`/visits/calendar`; MedRep *Visits › Calendar*, team lead *Team visits › Team
  calendar*, CEO *Apps › Field › Calendar*): a month grid. A person's month shows on each day whom
  they visit (green done, blue planned, grey skipped) and their leave; the whole team's (a team
  lead's team, everyone for the CEO, Management and the Admin) shows counts a day and how many are
  out on leave; *Whole team* or one person; a day opens its visits by person.
- **Where the team is** (`/field/live`; team lead, CEO): each field person's last place (*Open on
  the map*, how long ago, how accurate), the visit they are at, working or not. The phone sends
  its place every five minutes (sooner after moving 150 m) only while the person's day is started
  and the app is open; nothing before *Start my day* or after *End my day*; a place older than
  half an hour isn't shown as where they are. Only the latest place is kept (`live_location`,
  0042), no trail. A browser can't share a closed page's place: a phone app would be needed for
  that.

### 12.15 HR step 4: forms (official business, work from home, overtime) (15 Nov)

- **File a form** on *Leave & forms* (`/me/leave`): official business (a day, from–to, where,
  what for), work from home (a day, what for), overtime (a day, from–to, what for). A month back
  to two months ahead; one form of a kind a day. Decided like leave: whom the person reports to
  (HR when that is the CEO), HR may decide any, refusing needs a word, the CEO reads; the
  approver is told under *Needs you*, the person under *Updates* (`hr_form`, 0043).
- **What an approved form does**: an official business or work-from-home day is never absent and
  isn't late or short; it counts its hours as worked (official business its hours, work from
  home a full day) when more than the day's own. Overtime counts as **approved overtime** (apart
  from unapproved time after hours). The DTR shows *Official business*, *Work from home*,
  *Overtime 2h*; the attendance report has an Overtime column.
- **Leave & forms** list (`/hr/leave`, a Leave | Forms switch): waiting for you, asked, approved,
  not approved, cancelled. The sidebar badge counts both. The person cancels before the day; HR any.

### 12.16 HR step 5: payroll and payslips (15 Nov)

Computed in the CRM, **one payroll a month, the 1st to the month's last day** (Aryan, 15 Nov: not
the HR portal's two cut-offs; keep it small). Rates as 2MG's register uses them
(`src/hr/pay-rules.ts`):

- **The month** is paid on its last day (a Saturday, Sunday or holiday moves it to the working day
  before).
- **Pay**: the monthly salary and allowance; a day = monthly × 12 ÷ 313, an hour = a day ÷ 8.
  Absent, leave without pay, late and undertime (15-minute blocks) come off at those rates; days
  before joining or after leaving too. Approved overtime is paid (125% working day, 130% rest day,
  169% special day, 260% regular holiday) and a holiday worked adds 100% (regular) or 30% (special)
  of the day.
- **The law's shares** are dated rows HR reads at *Payroll → Rates* (`pay_rule`, 0044): SSS 2025 on
  what was earned in the month, PhilHealth 5% of the salary (₱10,000–₱100,000) half each, Pag-IBIG
  ₱200, BIR's monthly withholding table. A person not covered by a scheme, or not taxed, is ticked
  on their record. Deductions never take more than was earned; what can't be taken is said.
- **HR works it** (*Payroll*, `/hr/payroll`): each month is a draft from the DTR as it stands; HR
  adds its own lines (cash advance, loan, bonus) and, once the month has ended, **releases** it: the
  payslips freeze (`pay_run`, `payslip`) and each person is told under *Updates*. *Sheet* downloads
  the register.
- **The CEO reads** the same pages; **everyone else** has *My payslips* (`/me/payslips`).
- Parked (Aryan, 15 Nov: "payment baad mein"): 13th month, final pay, bank file, remittances.

### 12.17 Management's page, less clutter (15 Nov, night)

Aryan reviewed Management's page and asked for less clutter and the main checks on top:

- **Sidebars fold** what isn't daily: every desk has *Me* (leave and forms, payslips) and
  *Messages*; Management: Home, All orders, *Stopped orders* (sent back, on hold, stuck over two
  days), Customers to check, and under Look up *Customers* (hospitals, doctors, patients) and
  Speed; Finance: Orders to check, All orders, *Money* (owed, invoices, payments, refunds);
  Dispatch: Home, All orders, On the road, On hold; the team lead's *Team attendance*. A folder
  shows the sum of what waits inside.
- **Checks on every card** (and a Checks column in the table, only what needs a look): price
  against the buyer's list, stock, the buyer's paper, the customer (new, licence, owing), as words
  with a dot (green fine, yellow to look at, grey for information), no boxes.
- **The PO** is the customer's own purchase order (a hospital's paper asking us for the
  medicines). Nobody here makes it: the MedRep attaches a photo when the hospital gave one. It is
  optional (as in the hub), so a missing one is grey information, not a problem.
- **Management's step** shows the buyer's licence (LTO number and expiry, a doctor's PRC) and
  TIN, what is missing with a link to fill it, and the order's papers (PO, payment proof,
  prescription, GL) with Add photo.
- **Ships from** lists every warehouse with "Can fill every line" or what it is short of, as the
  hub's approve-and-check-stock did; the default is picked unless only another can fill it.
- **A medicine opens as a popup** from the order: each buyer's price, stock per warehouse,
  batches with expiry, what is coming in.
- **Change the order** (Management, before approving: same form, a reason, the MedRep told);
  **Wait for stock** (only when short; the holder and the MedRep are told once it comes in);
  **I'll handle it** on a card (everyone sees every order, one person takes it, Take over / Let
  go).
- Payment terms and Sub-division are plain dropdowns; the term says what it means (paid first,
  cash on delivery, credit for N days). Every popup closes on a tap outside.
- Walked as Sarla and Ryan: send back → fixed and sent again, hold → resume, reject → resume,
  approve (ships from Main, Finance invoices).

### 12.18 History from Zoho: customers, past orders and the price given before (16 Nov)

Aryan: Management approving a MedRep's order must see what this customer was given before
(today they open Zoho → Sales orders → search the hospital). Bring Zoho's customers, hospitals
and old sales with their prices now; **the medicine list is not Zoho's 3,588 items and comes
later**.

- **What Zoho holds** (org 714292728, seen 16 Nov, read only): 3,588 items, 50,000+ customers,
  67,361 sales orders from SO-00575 (15 Mar 2021) to SO-70094 (44,256 closed, 18,033 confirmed,
  5,042 void, 30 draft). Zoho says only "business" or "individual" for a customer. A
  buy-one-get-one is two lines of the same item, one paid and one at ₱0. Most orders are typed
  with tax in; Zoho's line total is before tax.
- **Tables** (migration 0054): `past_order` and `past_order_item` hold Zoho's orders as history
  only (no stock move, invoice, points, message or to-do; they are not `sales_order`, so no
  list, KPI, target or check counts them). A line keeps the medicine's **name and Zoho's SKU as
  text** and what one piece cost the customer in centavos, VAT in, after discounts (`free` when
  ₱0). It joins a medicine here **through the SKU**, so the history lights up on a medicine the
  day it is listed with Zoho's SKU; nothing has to be imported again. `zoho_contact` maps every
  Zoho contact to its customer here (`customer.zoho_id` for the one that made it).
- **One buyer, one customer**: a hospital, doctor or business is one customer per name and city
  (the existing rule), and the same name with the same phone number is one customer; a second
  Zoho contact of the same buyer joins the first and its orders land on the same page. The
  same number under another name stays its own customer.
- **Kind** (`kindOf`): an individual is a patient, or a doctor when Zoho's "Is Doctor" is ticked,
  the name starts with Dr./Dra., or their orders were "Doctor order"; a business is government
  when it bought by bidding, else by its name (hospital / medical center / clinic → hospital;
  pharmacy / drug / botica → drugstore; DSWD, PCSO, city of… → government), else what its orders
  say, else distributor. **Terms** (`termsOf`): "Net 30" → 30 days, COD / due on receipt → cash
  on delivery, anything else → advance. Imported customers are `review = ok`, added by the Admin,
  **in no area** (Zoho does not say whose customer it is; a city alone put a hospital under
  the wrong channel when tried), and carry their licence number and expiry and TIN.
- **Import** (`src/zoho/import.ts`): `POST /api/admin/import/zoho-customers` and
  `/zoho-orders`, Admin only, in batches, dry run unless `apply`; every row keeps Zoho's id, so
  sending again adds only what is missing. Drafts are left behind; void orders come as
  cancelled and are left out of the prices. An order whose customer is not here yet is counted
  (`noCustomer`) and skipped: customers first.
- **Where it shows** (`customers/prices.ts`, web `customers/prices.tsx`): this CRM's orders and
  Zoho's are read as one history.
  - Under **each line of an order**: "Last time ₱66.80 · 36 pcs + 36 free · 12 Oct 2026 ·
    SO-67227 · 4 more ▾"; it opens that medicine's every order for this customer (date, order,
    pieces, free, price). **Amber when the price now is below the last one**, with how much
    lower. (`GET /api/orders/:id/prices`: whoever may open the order.)
  - On **Management's Medicines & price step**, a box about the customer: orders before, the last
    one, buying since, the medicines they take most with the last price.
  - On the **customer's page**: Prices given (every medicine, opening its history) and Orders
    before this CRM (Zoho). (`GET /api/customers/:id/prices`: whoever may see the customer.)
- **Getting the data out of Zoho**: the in-app browser does not let a web page hand data to this
  computer, and one call per order would be 62,000 calls on Aryan's sign-in. Zoho's own
  **Settings → Data Backup → Backup Your Data** exports everything as CSV (customers, and sales
  orders one row per line) and emails a download link. Next: Aryan makes the backup and puts
  the zip on this computer; `scripts/import-zoho.ts` (to write once the files' columns are
  seen) reads it, tries it on a local copy, then sends it to the live CRM.
- The demo has a little invented history (`zoho/seed.ts`) for San Juan de Dios, Olivarez and one
  patient. 10 new tests (`zoho/import.test.ts`).

## 15. Build plan: the whole company in the CRM (16 Nov 2026)

The company map (docs/company-map.html) is the target: every seat of the 2026 chart, its screen, its
scorecard, its reports and rhythm. Of its 27 needs, 5 are built, 6 partly, 16 to build. Nothing built
so far is thrown away: the order line, inventory, customers, finance, dispatch, HR and the field app are
what every role stands on. Aryan, 16 Nov: the doctor rebates and Patient Care Groups are cleared with
the lawyer; build them as the playbooks write them.

Each phase ends with tests, the data checks and the 130-person test green, the change log updated, and
a short note for the next session. A phase starts by reading this section, the map and the change log.

| Phase | What | Sessions | Needs from Aryan / heads |
|---|---|---|---|
| 0 | Live: push, import Zoho and the medicine list into the live database | 1 | Supabase address in .env.live |
| 1 | Seats from the chart; Zoho salespeople tied to seats, customers under them; monthly targets per seat (peso and count) | 2–3 | Which RX names are which seat; who takes leavers' customers |
| 2 | Scorecard engine: one engine, a recipe per role (Hospital, Rx, B2C, MD Telesales, DSC, Mentor, Training); computed daily, locked on the 1st, disputes, 12-month average → increment band, PIP flags. Fix NZSD to invoice days without holidays | 3–4 | Weights where playbooks disagree; telesales KPIs; CTAR/TTAR |
| 3 | The coaches' rhythm: morning pulse, 7 PM huddle, Monday sync, Saturday report, 15th rescue, self-assessment, joint-call form, coaching notices and PIP | 2–3 | — |
| 4 | B2B: NBD pipeline with licence papers, hand-over at the 3rd order or day 90, CRR account health (late 1.5×, at risk 2.5× or 90 days, lost 180) | 2 | NBD / CRR targets |
| 5 | Rx field: 80 doctors in tiers, Red / Yellow / Green route, call log with brands, Patient Care Groups with the 15-minute clock, prescriber attribution, formulary tracker, doctor rebates | 3–4 | Focus and reminder brands |
| 6 | Desks and prices: B2C refill list and reply timer, PAP report, tender desk, CLIDP and Modern Trade accounts, special prices (tiers, CLIDP, CSP, bundles), cold-chain charge, pharmacist check, samples and home stock, Zoho's owed money in the order checks | 3–4 | Cold-chain charge; who approves deals |
| 7 | Training calendar and exams, regulatory and in-licensing registers, reports (SEFMED's), incentives | 2–3 | Incentive policy IP-2026-001 |
| 8 | Switch: last Zoho import, SEFMED off, people moved channel by channel | 1–2 | Dates |

About 19–26 sessions. Phases 1 and 2 first: every screen and report after them counts per seat and
per scorecard.

## 16. Each person's screen, one channel at a time (16 Nov 2026)

Aryan, 16 Nov: "pick one channel, build every seat's screen in it, write it here as done, then the
next; don't build for everyone at once." A page made for everyone ends up wrong for someone (it
opened under the Management desk, with Management's menu and "Management" on top).

**How each seat is built and checked** (all of these, for every seat, before it is ticked):
1. Who signs in to it (role, channel, the demo person who checks it).
2. The top bar: the desk's name is the seat's work ("Hospital CHC", "District Sales Coach"), not a role code.
3. The left menu: only that seat's work, in the order of its day; words of that channel
   ("My hospitals", "Hospitals to call"); nothing that leads to a screen not built.
4. Home, top to bottom: the blocks of the company map's screen for the seat, each with its data
   (whose: my area / my team / my division, said on the page) and its buttons.
5. What it sends up, and where that lands on the head's screen.
6. What it must never see; a page that isn't theirs refuses clearly ("Not part of your desk").
7. Tests for who sees what; a look in the browser with the seat's demo person.

**Order of channels** (the biggest and the one with the most data first):
1. Hospital Division: Hospital CHC → District Sales Coach → Business Mentor.
2. Prescription (Rx): Rx CHC → MD Telesales (Oncology) → DSC → Mentor.
3. Online B2C: B2C CHC → coach.
4. B2B: NBD, CRR, B2B telesales → coach.
5. PAP; Government bidding; CLIDP; Modern Trade.
6. The office: Management, Finance, Dispatch / Pharmacy, Inventory, HR, Training.
7. The Founder (CEO) and the Admin last: their screens are the roll-up of all the above.

### 16.0 Audit of 16.1–16.4 against the chart (17 Nov 2026)

Aryan caught the Hospital Division's Government Account box being pulled into Sales and Marketing's
bidding. Every rule that picks a seat's desk, Home, card or list was then read against the chart's
boxes (cropped one business at a time). What was wrong, and what was done:

| What was wrong | Why | Fixed |
|---|---|---|
| The Hospital Division's MD Telesales Anesthesia got the Prescription Business's telesales desk (care groups, patients' refills, "MD Telesales") | Seats were told apart by channel (TS) only, not by the box they sit in | Each person now carries their business box (seat_business_channel, migration 0062, read in the one sign-in query); anesthesia telesales get their own desk "MD Telesales – Anesthesia" (pulse, go here first, customers to call, orders, collections, score), the Hospital CHC card, no care groups; oncology telesales keep theirs |
| The Hospital Mentor's and coaches' District now counted every MedRep seat under them on the Hospital CHC card (it would have counted the PAP officer and the government bidding coachee) | No filter by box | District now: the Hospital Division's sellers to hospitals only (its CHCs and its anesthesia telesales) |
| The Government Account's bidding coachee would get the 7 PM huddle and the Hospital CHC card, and the desk said "Hospital CHC" | Same: by channel (HOSP) | No huddle, no card until the bidding card, desk named "Government Account"; the tender desk comes with 16.5, then back in 16.1 |
| The 7 PM team huddle listed every MedRep under a Hospital lead | No filter | The Hospital Division's CHCs only |
| Care groups' heads: any TS or RX lead | By channel | The Prescription Business's leads only |
| The chart code had MD Telesales Oncology beside the Onco-Hema Division | Read too fast | Inside Onco-Hema, as the chart draws it (the Onco-Hema seats were checked one by one: 1, 2, 1, 2, 2, 1, and Blood & Bone 2) |

Checked and right: Hospital CHC / DSC / Mentor desks (HOSP seats), Rx CHC and Country Mentor (RX),
B2C CHC (online), NBD and CRR (by the chart's titles), B2B coach and Sales & Marketing Mentor (B2B
leads), every refusal for a seat that isn't theirs.

Not built yet, and said so (no screen pretends to be theirs): the Sales Admins (Kate Cagoyong under
the Country Mentor, Sheila Mae Bazar in MD Telesales, Aljean Carno in Bidding: no seat in the CRM's
chart yet; their order work is the order line's Management step); the Patient Assistance Program
department of the Hospital Division (its officer uses the existing PAP desk); CLIDP, Government
Bidding (16.5), Modern Trade, the office departments, the Founder. The demo company still differs
from the chart (PAP as its own business with a head, an "Online" business, "Doctor dispensing /
referral" lines); the screens are checked on demo people placed as the chart places them.

### 16.1 Hospital Division (done 16 Nov; Tenders, the weekly report, Monday sync and route approval come with their phases)

Still to add in 16.1 (after the bidding line is done): the Government Account box on the chart
(Reynan Cuenca, Government Bidding Coachee for government hospitals) and the Hospital CHC's "Tenders
open" block (a government posting quoted within 24 hours), on the tender record 16.5 builds.

Checked up the line: a CHC sees only their hospitals (not another area's, no team views, no costs);
their huddle, score and money reach their coach and the head; a covering coach shows as "(covering)";
the CEO and the Admin reach the same views from Reports (Scorecards, Customers to call, Collections,
Evening huddles). The Founder's own Home is built last, from every channel.

| Seat | Menu | Home | Sends up | State |
|---|---|---|---|---|
| Hospital CHC (MedRep, HOSP) | Home, My hospitals, New order, My orders, Collections, Hospitals to call, Visits, Huddle, My score (Tenders and the weekly report when built) | Today's pulse (sales vs target, DSO, hospitals not reordered, invoice yesterday: green/amber/red); go here first (money first: overdue, due to reorder); to collect (60/75/90 days); tonight's huddle; my scorecard | 7 PM huddle → DSC; orders → Management | Done 16 Nov: desk "Hospital CHC", its menu; Home with the pulse, go here first (Call / Collect / New order), huddle card, KPIs; Collections (60/75/90 days from the oldest unpaid invoice); Hospitals to call; Tonight's huddle (prefilled, blocker required with no invoice, named coach); My hospitals opens on hospitals. Checked in the browser as Ryan. Tenders and the weekly report: later phases |
| District Sales Coach (team lead, HOSP) | Home, My team, Huddle, Hospitals to call, Collections, Approvals, Visits, Scorecards, Targets | District now (each CHC worst first); needs you today (3 evenings without an invoice, DSO over 90, approvals); tonight's huddle (who declared, who is red, blockers); 15th rescue (IST below 40%, DSO over 75, lapsed over 20%, NZSD under 80%) | District roll-up, rescue list → Mentor | Done 16 Nov: desk "District Sales Coach", its menu (Home, My team, Team huddle, Hospitals to call, Collections, Team orders, Team visits, Targets, Team attendance, Hospitals & doctors, My score); Home: the team's totals, Needs you today (one line per CHC: three days without an invoice, DSO over 90, huddle not declared after 7 PM), District now (sales vs target on pace, DSO, lapsed, zero-sales days, tonight; worst first), the huddle in one line with blockers, the 15th rescue, stopped orders. Checked in the browser as Daniel. Monday sync and route approval: later |
| Business Mentor (head, HOSP) | Home, Teams, People, Targets, Scorecards, Collections, Disputes | Division vs target by team, pace; each DSC's district; people at risk (below 60, improvement plan); money owed by age; disputes | Division review → Founder | Done 16 Nov: desk "Business Mentor", its menu (Home, Teams, Scorecards, Targets, Collections, Hospitals to call, Division orders, Visits, Attendance, Hospitals & doctors); Home: the division's totals, Division vs target team by team (coach, sales, on pace, DSO, lapsed, zero-sales days, in rescue; worst pace first), People at risk, Money owed by age with the biggest owers, Score questions, stopped orders. Checked in the browser as Vanessa |

### 16.2 Prescription (Rx) (done 16 Nov)

How the channel works (Rx Team & Training Playbook and the 2026 chart): the Country Mentor heads
the Prescription business. (Zoomed again on 16 Nov: on the chart MD Telesales Oncology sits inside
the Onco-Hema Division, beside Uro & Onco Care and Blood & Bone Care; the Sales Admin, Kate
Cagoyong, reports straight to the Country Mentor.) The Rx CHCs (field) build the doctors and carry no sales target; they
report straight to the Mentor (the chart has no field coach). MD Telesales Oncology, under their
Sales Coach, hold the sales target, answer every Patient Care Group within 15 minutes of the CHC's
enrolment and turn it into orders. The Patient Care Group is the bridge between the two.

| Seat | Menu | Home | Sends up | State |
|---|---|---|---|---|
| Rx CHC (MedRep, RX) | Home, My doctors, Calls (today's calls, route plan, calendar, expenses), My orders, My score; "Log a call" on top (telesales take the orders) | My doctors at a glance (each tier's doctors and visits done of due; PAP approved and waiting), today's route (eight calls: refill due, missing this month, Tier 1 behind), my scorecard (NBD, CRR, PAP, HIT, coverage gate). No sales target (telesales hold them) | Calls → DSC (visits report) | Done 16 Nov, checked as Joy. Patient Care Groups, brands per call and the formulary tracker: Phase 5 |
| MD Telesales (Oncology, TS) | Home, Care groups, Refills due, My orders, My patients, My score; New order on top | Pulse (sales vs target on pace, refills due, groups waiting, invoice on the last working day); new groups waiting with the 15-minute clock and "Contacted"; refills due (today and the next two days) with what they took last, Call and New order; orders; scorecard (the B2C card for now) | Orders and sales → Sales Coach; first contacts → the groups' 15-minute record | Done 16 Nov, checked as Kim |
| Sales Coach, MD Telesales (team lead, TS) | Home, My team, Care groups, Refills due, Team orders, Targets, Collections, Team attendance, Patients & doctors, My score | Team's totals; care groups at a glance (waiting now, 15 minutes kept this month, enrolled, quiet 14+ days); groups waiting; each telesales against their target | → Country Mentor | Done 16 Nov, checked as Lara |
| Country Mentor (head, RX) | Home, Field team, Whole business, Care groups, Scorecards, Targets, Collections, Business orders, Field visits, Attendance, Doctors & patients | Business totals; field team (each Rx CHC: doctors listed, coverage against the 80% gate, visits, new doctors, PAP letters, groups enrolled and quiet; lowest coverage first); care groups; people at risk; money owed; score questions; each seller against their target | → Founder (Reports: Care groups, Rx field team) | Done 16 Nov, checked as Rosa |

### 16.3 Online B2C (B2C Sales Coaching) (done 16 Nov)

Read again from the chart (zoomed, 16 Nov): the B2C Sales Coaching Department hangs under MD
Telesales Oncology, which sits inside the Onco-Hema Division of the Prescription Business. So the
line is: B2C CHC (Mary Jane Viñas, Rachelle Upao) → Sales Coach, MD Telesales (Honey Cordero) →
PX Country Mentor (Javed Shaikh) → Founder. (Also on the chart: Sales Admin Kate Cagoyong straight
under the Country Mentor, and Sales Admin Sheila Mae Bazar in MD Telesales.) The B2C CHC works the
Online desk (enquiries from Messenger, the websites, email, phone), as the B2C CHC Playbook v1.3
runs it: every new enquiry answered within 15 minutes (three late in a day: the coach is told the
same day); the morning pulse at 8:00 (overnight enquiries answered by 8:30, new prospects first,
the refill-due list worked before noon, yesterday zero-sales or not, cancellations coded, care team
groups for yesterday's first orders); at least one invoice by 2:30 PM or tell the coach; day-3
check-in after each delivery; the end-of-day close.

| Seat | Menu | Home | Sends up | State |
|---|---|---|---|---|
| B2C CHC (online, ONLINE) | Home, Leads & enquiries, Inbox, Refills due, My orders, Patients (the shared look-up, to search before adding), Points, My score; New lead on top | Morning pulse (enquiries waiting, new prospects not answered, refills due, invoice on the last working day, uncoded cancellations, late replies today: green / red each, with the playbook's action); waiting for a reply (oldest first, the 15-minute clock, open the case); refills due (by each patient's own rhythm; Call, New order); orders (quoted not ordered, at Finance, to ship, day-3 check-ins due); my scorecard (B2C card) | Late replies and zero-sales days → Sales Coach | Done 16 Nov, checked as Mae: desk "B2C CHC"; Home is the pulse, Reply opens the case, refills are their own patients only (2, not the company's 227) |
| Sales Coach (Onco-Hema): MD Telesales and B2C | desk named "Sales Coach" as the chart has it | B2C desk now: each B2C CHC's enquiries waiting, late replies today (three or more: red), today's invoices, none on the last working day, none by 2:30 PM | → Country Mentor | Done 16 Nov, checked as Lara |
| Country Mentor | — | B2C desk now on the Home too; the B2C CHCs in people at risk and in the business totals; an Rx field CHC shows "no sales target" instead of "set it on Targets" | → Founder | Done 16 Nov, checked as Rosa |

### 16.4 B2B Telesales (done 16 Nov)

Read from the zoomed chart (16 Nov): Sales and Marketing Mentor (Subir Dey) heads CLIDP, Government
Bidding and B2B Telesales. B2B Telesales has the B2B Sales Coach (Jessa Domino) and the B2B
District Sales Coach – Mindanao (Claire Gallana); under them Client Retention & Reorder (CRR:
Fritzie Mier) and New Business Development (NBD: Floremel Medina, Lonie Ann Neri, Winbelle Faith
Gomez, Benjie Dan Lacebal). There is no B2B playbook; the work is the company map's, from Zoho's
B2B orders 2021–26 (840 accounts; 23% never reorder; after the 3rd order 88% keep buying): NBD
hunts drugstores, distributors and clinics, collects their papers (FDA licence, business permit,
BIR), gets the first order and hands the account to CRR at its 3rd order or day 90, whichever
first; an account with no 2nd order by day 45 is flagged. CRR watches every handed-over account
against its own usual gap (due, late past 1.5 times, at risk past 2.5 times or 90 days, lost past
180), and whether it buys less than its 3-month average.

| Seat | Menu | Home | Sends up | State |
|---|---|---|---|---|
| NBD (MedRep, B2B, seat "NBD") | Home, Prospects, My orders, Handed over, My score; New order on top | Calls today (prospects due a call, by stage); papers missing (licence, permit, BIR, each prospect); first orders this month and conversion; ready to hand over (3rd order or day 90) and flagged (no 2nd order by day 45) | Prospects worked, first orders, hand-overs → B2B Sales Coach | Done 16 Nov, checked as Flor (a call logged in the browser) |
| CRR (MedRep, B2B, seat "CRR") | Home, Accounts, My orders, My score; New order on top | Due to reorder this week; late (call today); down (less than their 3-month average); stopped (90 days: win back); this month (retention %, up / flat / down); each with Call logged and New order | Late, won back, lost → B2B Sales Coach | Done 16 Nov, checked as Fritz; an account shows in one list only |
| B2B Sales Coach / District Coach Mindanao (team lead, B2B) | Home, My team, Hand-overs, Accounts, Team orders, Targets, Collections, Scorecards | Pipeline per NBD (prospects, calls, first orders, ready to hand over), hand-overs waiting (pick the CRR), CRR accounts late / at risk / stopped, retention | → Sales & Marketing Mentor | Done 16 Nov, checked as Jess |
| Sales & Marketing Mentor (head) | Home, B2B, (Bidding and CLIDP in their own sections) | New accounts this month, accounts at risk, retention, each team against target | → Founder (Reports: B2B team) | Done 16 Nov, checked as Sam; adds people at risk, money owed, score questions |

### 16.5 CLIDP (done 17 Nov)

Read from the chart (CLIDP box cropped alone, 17 Nov): two Sales Coaches straight under the Sales
and Marketing Mentor, Ma. Anicia D. Maglatang (Annie) and Nicka Angelene Masusi; nobody under them,
so each is a seller. CLIDP is the FDA's Certificate of Listing of Identical Drug Product: a
distributor lists our product under its own brand (Zoho shows sugammadex sold as Aemadex,
Godagamet, Sugamacen… to one buyer each). From Zoho: 173 CLIDP customers, 83% of orders to
distributors and wholesalers, bulk lines (median 50 units, up to 5,000), mostly Net 30, DSO 153 days
from big open balances; the CLIDP price list has an MOQ on each line. No CLIDP playbook.

| Seat | Menu | Home | Sends up | State |
|---|---|---|---|---|
| CLIDP Sales Coach (MedRep, B2B, seat "CLIDP…") | Home, Accounts, Listings, My orders, Collections; New order on top | Volume against target on pace; money owed (biggest balances first); accounts due to reorder and late (each against its own gap); listings expiring (each account's brand of our medicine with its certificate and validity) | Volume, owed, listings → Sales & Marketing Mentor | Done 17 Nov, checked as Annie |
| Sales & Marketing Mentor | adds CLIDP | Each CLIDP coach: volume against target, owed, accounts late, listings expiring | → Founder (Reports: CLIDP) | Done 17 Nov |

### 16.6 Government Bidding (done 17 Nov)

Read from the zoomed chart (16 Nov): under the Sales and Marketing Mentor, Government Bidding is one
line: Jimmy Boy Saturinas (Government Bidding Admin), Angelica Gollena and Hazel Marie Balano
(Government Bidding Coachees), Arron Tongcua (Customer Happiness Coachee) and Aljean Carno (Sales
Admin). This section is only Subir Dey's line; the Hospital Division's own Government Account box
(Reynan Cuenca) belongs to 16.1 and waits there. The work (company map, Hospital CHC Playbook, the old
CRM's 9 steps, RA 12009 and its 2025 rules from the web research): a tender goes Found on PhilGEPS →
Preparing → Price approved (by the Bidding Admin) → Submitted → Won or Lost (our price against the
winning one, the reason) → Contract / NTP → Delivered → Accepted (IAR: the government pays only after
inspection and acceptance; money owed counts from acceptance) → Billed → Paid. Each tender has its
mode (competitive bidding, small value, direct acquisition, repeat order, negotiated…), ABC, PhilGEPS
reference, deadlines, envelope papers (PhilGEPS Platinum certificate, Omnibus Sworn Statement, bid
security, technical specs and stock availability, FDA LTO, CPR for each medicine, NFCC, SLCC), the
bid security and the bid price per medicine. The company's eligibility papers have expiry dates
watched by the Admin.

| Seat | Menu | Home | Sends up | State |
|---|---|---|---|---|
| Government Bidding Admin (team lead, BID) | Home, Tenders, Documents, Collections, Team orders, My team, Scorecards | Deadlines this week (papers still missing), prices to approve, awaiting award, awarded (to deliver, waiting acceptance, to bill, to collect), this month's results (won, lost, win rate), company papers expiring | Pipeline (bid, won, lost) → Sales & Marketing Mentor | Done 17 Nov, checked as Jimmy (a price approved and a paper ticked in the browser) |
| Government Bidding Coachee / Bidding CHC (MedRep, BID) | Home, Tenders, My orders, Collections, My score | My tenders by step, deadlines this week, papers missing, awarded deliveries and acceptance to follow | → Bidding Admin | Done 17 Nov |
| Sales Admin (Prescription, Bidding) | — | Not a CRM seat yet: their work (order → Finance → dispatch) is the order line's Management step | — | Note |
| Sales & Marketing Mentor | adds Tenders | Bidding pipeline: active, submitted, won / lost this month and win rate, awarded value to deliver, government money owed from acceptance | → Founder (Reports: Tenders) | Done 17 Nov |

### 16.7 Modern Trade (done 17 Nov, partly: deductions and returns wait for Finance)

Read from the chart (Modern Trade box cropped alone, 17 Nov): one person, Ms. Malou Jagonoy, Chief
Operating Officer (COO), straight under the Founder, nobody under her. (docs/ORG-CHART-2026.md said
"Mohan Jagessy" here: wrong, corrected.) Zoho has one Modern Trade seller ("MT | 1") with two
customers, both buying lately. Modern Trade is the pharmacy chains (web research; the old CRM's MT
road): the chain lists our medicines (which ones, in how many branches), its head office sends the
purchase orders, it pays in about 60 days net of its deductions, near-expiry stock comes back. No
Modern Trade playbook.

| Seat | Menu | Home | Sends up | State |
|---|---|---|---|---|
| Chief Operating Officer – Modern Trade (head, MT) | Home, Chains, Listings, Orders, Collections, Targets | Sales against target on pace; each chain: last order, due to reorder or late against its own gap, money owed and its age; listings (our medicines each chain carries, in how many branches); deductions and near-expiry returns are not in the CRM yet (they need Finance's short-payment record) | → Founder | Done 17 Nov, checked as Malou |

### 16.8 Digital Marketing and IT (done 17 Nov): the work log

Read from the chart (the two boxes cropped alone, 17 Nov): the Digital Marketing Coaching Department
has Ms. Kriscel Calbayar (Digital Marketing Coach) and Mr. Arnel Catome (Multimedia Artist); the IT
Division has five Employee Happiness Coachees (Mr. Jade Atyla Madigal, Mr. Linus Aurin, Mr. Cendric
Angelo Gencianos, Mr. Aaron Manila, Mr. Zildian Bermas). No head is drawn in either box: they report
to the Founder. They sell nothing. Aryan (17 Nov): they may write their day in the CRM, what they did,
what they are doing today and tomorrow; optional, nothing is chased. A "Leads by source" screen for
Digital Marketing was declined.

New work "Office staff" (role `staff`); the chart's two boxes are departments with staff seats.

| Seat | Menu | Home | Sends up | State |
|---|---|---|---|---|
| Digital Marketing Coach, Multimedia Artist, Employee Happiness Coachee (staff) | My work log, Me, Messages (no stock, no customers) | My work log: today's three boxes (what I did, today, tomorrow), saved and changed until midnight; earlier days | → Founder: Reports → Work logs (everyone's day, any day); a head reads the people under them | Done 17 Nov; API checked as Kriscel and the Founder |

## 17. Zoho Inventory moved into the CRM (from 17 Nov 2026, the main work)

Aryan, 17 Nov: the whole of Zoho Inventory comes into this CRM, every section and every row of
data. On the outside it looks like Zoho, screen for screen; inside, the data is shown better; no
data is left behind. Each screen links with the CRM's own orders, stock and customers.

**Where the data comes from.** Zoho's full backup (Settings → Data Backup, 15 Nov 2026, in
`.data/zoho-backup`) holds Items, Vendors, Contacts, Purchase Orders, Purchase Receives, Bills,
Vendor Payments, Sales Orders, Invoices, Customer Payments, Packages, Shipments, Transfer Orders and
Inventory Adjustments, with their lines and batches. It has no Sales Returns, Credit Notes or
Vendor Credits: those are read from Zoho's own API in Aryan's signed-in Zoho tab (the browser
pane) into `.data/zoho-api/*.jsonl`. `scripts/import-zoho-books.ts` brings them in (dry run by
default; never against the live database without Aryan's word). Measured: of the backup's columns,
only the ones always empty are dropped; every other value is kept.

**The books.** One set of tables for every Zoho document (`book_doc`, `book_line`, `book_link`,
migration 0069): the document's own columns (number, date, status, party, money in centavos of its
currency with the rate), every other Zoho field in `fields` under Zoho's own name, lines matched to
a medicine through the SKU, batches with expiry on the line, and the links between documents (a
bill's purchase order and receive, a payment's bills, a vendor credit's bills, a credit note's
invoices, a return's sales order and credit notes). Vendors are the suppliers with Zoho's fields
and contact persons. A document already here is refreshed with Zoho's newer status and balance.

**The screens** (`/books/...`, Zoho's frame: the dark menu, "Search in Bills ( / )"):

| Zoho section | Screen | State |
|---|---|---|
| Purchases → Vendors | list (Active/Inactive/All, NAME, COMPANY NAME, EMAIL, WORK PHONE, PAYABLES), vendor with Overview and Transactions | Read, done 17 Nov |
| Purchase Orders | list (views by status, RECEIVED/BILLED dots), split view: status steps, vendor and delivery address, lines, receives and bills, terms, every other field | Read, done 17 Nov |
| Purchase Receives, Bills (payables band as Zoho's), Payments Made, Vendor Credits | lists and documents as above | Read, done 17 Nov |
| Sales → Sales Returns, Credit Notes | lists and documents (data from Zoho's API) | Read, done 17 Nov |
| Making documents | Zoho's forms: New Purchase Order (draft or issued, next number in Zoho's series), Receive (each medicine onto the shelf in its batch with expiry, the batch costed at the order's rate in pesos, waiting orders told), Convert to Bill (from the order or from a receive), a bill on its own (rent, utilities, freight), Record Payment (on one or more bills; the rest stays unused), Vendor Credit, Apply to Bills (a credit's or a payment's unused amount), Void (a bill nothing was paid on; a payment or credit, its money goes back on the bills), Cancel Order (nothing received or billed), Mark as Issued, New Vendor | Done 17 Nov, checked in the browser as Inventory (Irene) and Finance (Fiona) |
| Sales → Customers | one view per kind (Hospitals, Doctors, Patients, Drugstores, Distributors, Government) and "Customers who owe"; NAME, COMPANY NAME, EMAIL, WORK PHONE, CITY, RECEIVABLES; a customer: what matters for its kind (licence, permit, TIN, terms, credit limit; a doctor's specialty and hospital; a hospital's doctors; a patient's details from their latest order: disease, age, sex, doctor, senior / PWD ID, prescription), Zoho's billing and shipping address, every Zoho field (and the records of Zoho contacts merged into it), people, receivables and unused credits, every document (Zoho's and the CRM's) | Done 17 Nov |
| Sales Orders, Invoices, Payments Received | Zoho's lists with Zoho's columns (a sales order's INVOICED, PAYMENT, PACKED, SHIPPED dots and DELIVERY METHOD as Zoho's list says them), Zoho's 67,371 orders, 69,222 invoices (lines with batch and expiry) and 63,245 payments beside the CRM's own; the CRM's open on the order line ("Open on the order line ↗"); + New sales order is the CRM's order form | Done 17 Nov |
| Record Payment on Zoho's open invoices, Apply credits (a credit note's, a payment's unused amount) to invoices, Void a payment | Finance and the Admin; the CRM's own invoices still take payments on the order line | Done 17 Nov |
| Items | every Zoho item (3,588: the 117 that are this CRM's medicines and the pharmacy's other products) and the medicines Zoho never had; "Active Items ▾" (Inactive, All, Low Stock, Out of Stock, Our Medicines), NAME, SKU, STOCK ON HAND, RATE, REORDER LEVEL; an item: Overview (Zoho's every field, purchase and sales price, the stock: a medicine's is this CRM's own, beside Zoho's figures when read), Warehouses, Batch Details (the CRM's batches and expiry, Zoho's batch records), Transactions (every document with it) | Done 17 Nov |
| Price Lists | Zoho's one list (IMMUNPRO, 10% markup) | Done 17 Nov |
| Inventory Adjustments (12,153), Packages (49,611: Zoho's board of Not Shipped / Shipped / Delivered), Shipments (49,585), Transfer Orders (364) | Zoho's columns (reason, type, created by, warehouses, carrier, tracking, package, shipping rate), each linked to its sales order and package, beside the CRM's own (counts, moves between warehouses, orders packed and shipped by Dispatch) | Done 17 Nov |
| Zoho's Composite Items, Assemblies, Move Orders, Putaways | empty in Zoho: nothing to bring | — |
| Making stock documents here (adjust, transfer, pack, ship) | stays on the CRM's own pages (a medicine's page for counts and moves, Dispatch for packing and shipping), which these lists show | — |

Checked against Zoho on 17 Nov: after bringing each document's state from Zoho's lists (statuses,
balances, payments' unused amounts) and keeping what only Zoho Books explains as each vendor's
opening credits and payables, the Bills band (Total, Due Today, Due Within 30 Days, Overdue) and
every vendor's Payables and Unused Credits match Zoho to the centavo. Sales the same way: what
customers owe (PHP111,293,889.85) and their unused credits (PHP5,744,382.25) match Zoho's totals to the
centavo, once Zoho's contacts merged into one customer here are counted together (zoho_contact).
`scripts/books-check.ts` lays the books' four totals beside Zoho's.

Who makes what (interim, until Aryan says otherwise): purchase orders and receives — Inventory and
the Admin; bills — Inventory, Finance and the Admin; payments made and vendor credits — Finance and
the Admin; Management, the Founder read. The Inventory menu's Purchases now opens these screens; the
CRM's earlier purchase pages (/purchases, /suppliers) stay reachable but are no longer in the menu.
Stock is counted in Zoho's own units (pieces), as the opening stock was.

**One stock, not two (17 Nov).** Only the CRM's shelves move: warehouse → batch → pieces, changed
the moment an order is packed, a purchase received, stock moved or counted, each change in the stock
log. Zoho's copy (the items' stock on hand, Zoho's adjustments, packages and transfers) is history
and the figure to compare with; it never changes the shelves. Zoho's opening stock came in by
warehouse: Getmeds Philippines Inc. (about 3.0 million pieces, the default warehouse since 17 Nov:
Approve picks it first), Consignment, Cebu (Zoho's Cebu warehouse, the Cebu pharmacist's), Davao,
the homestocks, Expired stocks, Gloria Diaz. The demo stock is off the local shelves
(`scripts/go-live-stock.ts --demo-out`: 21,770 pieces taken off by stock counts with their reason,
the demo-only "Main warehouse" closed; backup in .data/pg.before-stock-2026-11-17). Now 207 of the
280 medicines tied to Zoho items hold exactly Zoho's figure; of the 73 that differ, 54 have no batch
in Zoho's backup (packaging, Zoho's test items, a few medicines) and the rest are short by a few
hundred pieces Zoho holds without a batch.

On the switch day: read Zoho's stock once more (the opening stock import refreshes what changed),
count the medicines that still differ, then Zoho's stock stops and only the CRM's moves.
Books the same way: Zoho's documents stay as history beside the CRM's own (the CEO, team,
Collections and We owe read both, nothing counted twice); new sales invoices come only from the order
line, purchases and bills from the Books screens, and Zoho's open invoices are paid here.

**Zoho Books moved in (17 Nov).** Books' own backup (16 Nov 12:51, `.data/zoho-books-backup`,
never committed) brought what Inventory's had not: the chart of accounts (244 accounts, `book_account`;
Zoho's API list adds the system ones), 8,717 expenses (10,399 lines, with Zoho's status, who made them
and the expense report from Zoho's list), 2,493 manual journals (8,869 lines), 106 transfers between
accounts, 22 deposits, 39 credit-note refunds, 390 credit notes put on invoices, 5 recurring bills,
6 recurring expenses, 2 fixed assets and Zoho's activity log (25,000 lines, 29 Oct–16 Nov). The
documents already here got Books' extra columns (each one's accounts, payment numbers, withholding
tax, bank charges, salesperson; Books calls a bill's id "Bill ID"). Zoho's bank accounts gave 15
refunds of customers' payments the backup lacks. `scripts/import-zoho-ledger.ts` brings all of it
(dry run by default), then `import-zoho-books.ts` with `ZOHO_DIR=.data/zoho-books-backup`.

Every document's debits and credits are worked out from the document itself (`book_entry_calc`):
payments into or out of their bank (less or plus the bank's charge, which goes to Bank Fees and
Charges), expenses line by line with their tax, journals line by line, transfers, deposits, refunds,
bills and invoices against payables and receivables. Zoho's documents' are written down once
(`book_ledger`, refreshed by every import; a void here takes a document out) and this CRM's own are
worked out as they are read (`book_entry`): the whole chart adds up in about a second. The whole
ledger balances (debits = credits to 3 centavos of ₱3.85 billion), and every expense, journal,
transfer, deposit and refund balances on its own. A balance counts documents up to today, as Zoho's
(next year's rent journals wait for their day).

Checked against Zoho Books' own Banking on 17 Nov: 35 of the 44 bank, cash and card accounts are the
same to the centavo; each of the other 9 differs only by what was entered in Zoho after its backup
(16 Nov payments, 17 Nov journals), a USD transfer's 12 centavos, and one Zoho deposit dated in the
year 6889 (BDO - Getmeds 6889, ₱7,800: a typo in Zoho, which leaves it out of today's balance).
Tied to Zoho's Balance Sheet as of 15 Nov (the day before its backup): 27 of its 36 other accounts
are the same to the centavo (Advance Tax, Withholding Tax Payable, Accrued Expense, Employee
Reimbursements, Opening Balance Adjustments, the fixed assets and their depreciation, the payroll
payables, the advances…), once a payment's withheld tax was added up from every invoice or bill it
was put on (a customer's on Advance Tax, ours on the account the payment names) and Zoho's opening
balances (2 May 2020, read from Zoho's settings) came in as a journal. Still apart: Accounts
Receivable (₱248,672 lower here) and Unearned Revenue (₱3.21M in Zoho: it keeps some payments not yet
put on an invoice there, this CRM takes them off receivables), Accounts Payable (₱2.87M higher here),
Tax Payable (Zoho's own split of each invoice's and bill's tax, discount, shipping and adjustment),
Prepaid Expenses, and the stock accounts (Zoho never exported its cost of goods sold). Making these
exact needs Zoho's own general ledger (its Account Transactions report, readable only from Zoho
Books' page).

Screens, in Zoho's frame, for Finance, the CEO and the Admin (the API checks it; Inventory and
Management keep the purchases without the accounts): Banking (Overview with Cash In Hand, Bank and
Card balances, each account's transactions; Transfers; Deposits), Accountant (Manual Journals, Chart
of Accounts with every account's balance and transactions, Fixed Assets), Purchases → Expenses,
Recurring Expenses, Recurring Bills, Sales → Credit Note Refunds. Every document shows its
"Journal" (what it put on each account). Making expenses, journals, transfers and deposits here comes
with the switch; until then they come over with each backup.

## 17.1 Where each thing is entered: one road, nothing twice (18 Nov 2026)

Aryan, 18 Nov: "Zoho Inventory is in here and Inventory has its own sections too: where does the
Inventory person enter things, so nothing doubles? Same with the books." The answer is one place
for each piece of work; every other screen only shows it.

| Work | Who | The one place | What it moves by itself |
|---|---|---|---|
| A new medicine, its details | Inventory | All medicines → Add medicine / the medicine → Edit → Details | the order form's list |
| Its prices (patient, hospital, doctor, distributor, drugstore, bidding; piece and pack) | Management, CEO, Admin | the medicine → Edit → Prices | every new order's price |
| A promo (one price for all, dated) or an offer (Buy X Take Y, a buyer's own price) | Management, CEO, Admin | the medicine → Edit → Promo / Buy X Take Y | the order form offers it; free pieces added by themselves |
| A vendor | Inventory | Purchases → Vendors → New vendor | — |
| What we buy | Inventory | Purchases → Purchase orders → New (also "Order" on a medicine in To do & buy again, and the Stock page's "New purchase order"); the last price paid fills in | "coming" on Stock, the medicine and Overview |
| Goods arrive | Inventory | the purchase order → step 2 Received → Put on the shelf (batch, expiry, quantity) | the shelf, the batch's cost (order rate × exchange rate) |
| The vendor's invoice | Inventory or Finance | the purchase order → step 3 Billed → Save the bill | Accounts Payable / Inventory Asset |
| Extra costs on those goods: freight, airfare, travel, customs, insurance, packaging | Inventory or Finance | the purchase order → Add extra cost (a bill: Is it an extra cost on goods we ordered? → the order) | shared over the order's goods by value: the part for goods already in goes on their cost now, the part for goods still to come waits and goes on each delivery; kept in Inventory Asset, it reaches Cost of Goods Sold as they sell; void takes it back. Travel or costs not for goods: a bill of its own |
| Paying the vendor | Finance | the order → step 4 Paid → Record payment, or Purchases → Payments made (on one or more bills; the rest stays an advance) | the bank, Accounts Payable |
| Vendor credit | Finance | Purchases → Vendor credits → New, then Use on bills | what we owe the vendor goes down |
| A partly received order whose rest won't come | Inventory | the order → Close the rest (Reopen undoes it) | stops counting as coming |
| A count, damage, expired stock | Inventory | the medicine → Stock count (Adjustments lists them) | the shelf; the difference to Cost of Goods Sold |
| Moving stock between warehouses | Inventory | the medicine → Transfer | the shelves |
| Stock that was not bought (opening stock, found in a count) | Inventory | Stock → Add stock (not bought) | the shelf only; says to use a purchase order for anything bought |
| Selling | MedRep → Management → Finance → Dispatch | the order line | invoice, payment, stock out, Cost of Goods Sold, all posted to the books |

**A vendor credit** (Zoho's, checked 18 Nov): what the vendor owes us back — goods returned to them,
a short or damaged delivery already billed, an overcharge, a discount after the bill. It lowers what
we owe: put on their next bills (Apply to bills) or refunded. A payment made larger than the bills
(an advance) is not a vendor credit: it stays as the payment's unused amount and is applied the same
way.

**Purchases in this CRM's own look** (18 Nov, Aryan: "move Purchases out of Zoho's style into our
Inventory style, better than Zoho; keep the Zoho screens to show both"): Inventory's menu, in the
order the work goes — Vendors, Purchase orders, Receives, Bills, Payments made, Vendor credits, To do
& buy again, Zoho view. Same records as Zoho's screens (`/books/…`, kept as they are, a "Zoho view"
on every page). Better than Zoho: **To do & buy again** (to receive, received and not billed, bills to
pay and overdue, unused credits; medicines under their low-stock level with how many sold in 30 days,
how long they last, what is coming, who sold them last at what price, and an Order button); an
order's page with its **steps and ticks** (Ordered → Received → Billed → Paid) and the step's work
beside them; **what each delivery landed at** (order price and cost now, with the extra costs); a
vendor's page with **what we buy from them and the price last time**; the new order **fills the last
price** and shows each medicine's free stock, low level and what is coming. Inventory's two
medicine screens say what each is: **Medicines & prices** (each medicine, what every buyer pays,
promos and offers) and **Stock by warehouse** (how many sit where, what is coming, what expires).

**Zoho's lists** (Items, Inventory Adjustments, Packages, Shipments, Transfer Orders, Sales) are
Zoho's history beside this CRM's own work, read only: nothing is entered there. The first purchase
pages (`/purchases`, `/suppliers`, 3 demo orders) now open Purchases; their 3 orders stay readable by
number. Tested in `books/one-road.test.ts`.

## 18. One price book, one order line (plan, 17 Nov 2026)

Aryan, 17 Nov: Inventory is where medicines and every price live, and the whole company reads them
from there: change a price once and every screen has it. Prices change often: the selling price,
a discounted price, the SC/PWD price, promo prices, offers (Christmas, Buy 1 Take 1, Buy 2 Take 1).
The MedRep picks a medicine and its price comes by itself; if he changes it or writes a note, it
goes to Management, which sees on that line what the price was and what he put, and approves or
not; Management can add medicines, give free goods and add the cold-packaging fee (an Inventory
item, "Cold Management", its fee as set there, on every cold delivery). The MedRep sees what
Management changed. Finance checks what the hospital or patient already owes (Zoho's too) before
it goes on. Dispatch checks the delivery address and that the invoice is attached, then ships by
Lalamove, LBC… A return is Finance's to decide (refund or replace), and Management is told
(changed by Aryan the same day: returns go the hub's way — Management decides, Dispatch checks
what came back, Finance refunds; change log 90). "No mistakes": every link from the top to the
bottom.

**What the order line has today** (audited 17 Nov, file by file): one price per buyer kind and a
pack price per medicine, dated promos, a price-change log; the order form fills the price and asks
a reason for a lower one (flagged "Below price" for Management); Management's price check (list
against given, what this customer paid before) and its line editor (add, free, price); Finance's
cards with what the customer owes in this CRM and the credit limit; Dispatch packing by batch and
shipping by courier (LBC, Lalamove…) with the signed receipt; returns credited and refunds owed.

**Wrong today (to fix first)**
1. The API lets a MedRep send his order past Management and Finance (the form doesn't, the API
   does; a test even expects it). Only Management may decide that.
2. Management's change deletes the order's lines and writes them again: the MedRep's own lines are
   gone, and an SC/PWD line loses its relief.
3. SC/PWD exists only on Online/PAP cases, and its invoice still splits VAT as if it were charged.
4. What a customer owes in Zoho (and their opening balance) is missing from every check at order
   time: Finance's cards, the credit limit, the customer's page.
5. A price above the list goes through unseen, and the MedRep's note is not on Management's cards.

**The plan, in three steps (each checked end to end, MedRep → Management → Finance → Dispatch →
return, as the people who will do it, before the next)**
1. *Safe line.* The API sends every field order to Management and every approved order to Finance
   (only Management decides otherwise, and it is shown); an order's lines are never deleted: each
   change is a version, the MedRep sees before → after line by line (price kind, list, given,
   free, reason) on the order and a "changed" mark on his list; SC/PWD on any order (ID number and
   name kept, 20% off and no VAT, the higher of SC/PWD or a promo, never both) with the invoice,
   sales order and return credit right; Finance's checks count Zoho's unpaid invoices and opening
   balances; any price changed (up or down) and any note are on Management's card.
2. *Price book.* Inventory holds, per medicine and buyer kind: the list price, the pack price, and
   offers with a name and dates (special price, Buy X Take Y) for the channels they are for; the
   Christmas 2026 list (`GetMeds_Christmas_Offers_Team_Price_List_CORRECTED.xlsx`, 110 medicines ×
   doctor / hospital-drugstore / patient / distributor) comes in as the first offers. The order form
   offers the running offer by itself (Buy 1 Take 1 adds its free piece), Management's editor offers
   the same, and the order keeps which offer it used.
3. *Fees, Dispatch, returns.* "Cold Management" is an Inventory item that is a fee, not stock (no
   batch, no packing), with its price per buyer kind; a medicine's cold-chain mark is kept in
   Inventory, an order with a cold medicine gets the fee line (Management can take it off with a
   reason) and Dispatch sees "cold pack". Dispatch confirms the address against the printed slip
   (the hub's "Confirm for delivery"), sees the invoice on the card, keeps the tracking (the
   courier's cost is not kept: neither the hub nor Aryan asked for it). A return goes the hub's
   way (Aryan, 17 Nov, change log 90): Management decides, Dispatch checks what came back, Finance
   refunds; refunds from returns counted on Finance's badge. Old invoices keep the medicine's name
   and VAT as they were. Dispatch marks an order delivered (with the signed receipt), as now.

**Rules Aryan gave on 17 Nov (answers)**
- *SC/PWD* goes on any order whose buyer shows a senior citizen's or PWD's ID, not only a
  patient's. It is worked from the **patient price**: VAT out, then 20% off, by the system (or the
  promo without VAT when that is lower, never both). The OSCA / PWD ID number and the name on it
  are typed on the order and printed on the invoice; a photo of the ID goes under Papers and
  Management checks it.
- *Prices* Aryan named: patient, hospital, drugstore, and an "Extra" price (some rupees more).
  Inventory has today patient, hospital, doctor, distributor, drugstore, bidding (question 10).
- *VAT* is in Inventory on every medicine (12% or exempt) and shows wherever a medicine is picked
  or checked (MedRep's form, Management's lines), so nobody looks it up by hand.
- *Management sees the customer's past* on its customer check: first order or not, orders here
  and in Zoho, what they take, what they owe now (Zoho's too), and a link to the whole history.
- *Guarantee-letter cases go to PAP* (the PAP person), not the Online desk (question 11: today an
  Online case turned GL stays with the Online agent).
- *Approvals.* Management approves every MedRep order. When something is an exception, the
  approval is taken from the MedRep's Team Lead; when Management itself needs a yes, from its
  Business Mentor. Approval is a button in the CRM (name and time kept on the order), not a
  screenshot or a mail. (The ask-up step for the Team Lead and the Business Mentor is not built
  yet: its shape waits for Aryan's yes, question 9.)

**Step 1 as built (17 Nov, local)**: a MedRep's order always waits for Management and an approved
one goes to Finance unless Management switches it off on approving (the API refuses otherwise);
every version of an order's lines is kept (`order_version`: placed, fixed by the MedRep, changed
by Management, with who, when and why), the order shows Management's last change line by line
(before → after, total before → after) and every version behind a toggle, and the MedRep's list
marks "Changed by Mgmt"; Management must say why it changed an order; the MedRep's note is a check
on Management's card; a price above the list needs a reason and shows "Above … price" (below as
before); SC/PWD on the order form (No / Senior citizen / PWD, ID number, name), priced by the API
(a typed price is not taken; a changed order's SC/PWD price is kept, never VAT-stripped twice),
"No SC/PWD ID" until the ID is attached, the invoice VAT-exempt for those lines with "OSCA ID No." /
"PWD ID No." printed, the sales order and a return's credit the same; Finance's cards, the
Customers owe list, the customer list's "owes" and the customer's history count Zoho's unpaid
invoices and opening balance with this CRM's (`src/finance/dues.ts`).

## 19. Simple like the hub: the plan (17 Nov 2026, night)

Aryan, 17 Nov: crmnew got complicated; make it as simple and clean as the old hub, every step in
its own person's login, nothing done from the Admin panel. The hub was run locally and walked role
by role, button by button (docs/HUB-WALKTHROUGH.md, docs/HUB-CHECKLIST.md). This plan copies the
hub's line and look, keeps what crmnew already does better, fixes what the hub got wrong, and
puts in crmnew what people did by hand in Zoho (crmnew replaces Zoho).

**Keep from crmnew (the hub lacks it)**: prices per kind of buyer from Inventory with the list
price beside the given price; SC/PWD from the patient price; VAT per medicine shown; the
customer's dues (Zoho's too) in front of Management and Finance; every version of an order;
returns line by line; invoice, packing, shipping, payments and credit notes inside crmnew (no
Zoho, no webhooks, no manual steps).

**Fix what the hub got wrong**: a price below or above the list is flagged to Management (and
needs a reason); Management's changes (price, quantity, added or free medicines) are written on
the timeline old → new and the MedRep is told; a discount is never lost; Finance's Undo really
undoes; an advance-pay order needs its proof (or Management's word) before Finance confirms; a
partial return refunds only what came back; the Team Lead is told about the team's orders;
"needs approval" goes only to the managers of that division.

**The line, screen by screen (each step checked in that person's own login before the next)**
1. *MedRep's order form* — the hub's five sections: (1) who it is for, division, sub-division,
   salesperson; (2) customer (credit / direct shown), address, receiver, payment terms, source,
   doctor, invoicing from, delivery method, remarks, date wanted; (3) medicines: price comes from
   Inventory by the buyer's kind, VAT shown, discount, Buy 1 Take 1 added by itself, Dispatch's
   stock notes shown, an out-of-stock item asks "why are you proceeding?"; (4) documents: proof of
   payment or "no proof? say why", prescription or "no prescription? say why" (by channel),
   hospital papers; (5) terms. A "Missing: …" list keeps Submit off; a Confirm summary before it
   goes. New customer from the form as in the hub (a hospital needs TIN, LTO details and BIR 2303,
   LTO permit, business permit; a distributor may follow up; Management reviews what is missing).
2. *Order page* (one page for everyone, the buttons by role) — header (number, customer, status,
   total, Order overview, Request refund), details with Edit Details, the step's band (Management
   approval, sent back, on hold, waiting for stock, cancelled), tabs **Timeline · Items · Payment ·
   Dispatch · Documents**.
3. *Management* — Approval Queue rows (Approve / Send back / Reject); the order page; Approve and
   check stock (every warehouse, tick to approve short) — **approving makes the invoice** (Aryan,
   17 Nov: the invoice is made when Management approves, not after Finance); Edit Items with Confirm changes; Hold,
   Exception, Resume ("continue from" + why); drafts: Wait for stock / Stock is back, Cancel draft
   (delete for good, or keep record when paid), Restore; Exception Hub; Refund requests;
   Pending customers.
4. *Finance* — Orders with stage tiles; Details drawer with the customer's dues and history;
   the **proof of payment is an attachment on the order** (Aryan: the MedRep attaches it, or says
   why there is none, as in the hub) and Finance checks it there; Confirm (tick, note, Undo that
   works); Hold with screenshots; Bring back; Refunds (pending → done) and payments recorded in
   crmnew.
5. *Prescriptions* — **Management checks the prescription when it approves** (Aryan, 17 Nov: the
   hub has no Pharmacy login of its own — its Pharmacy page sits in the Operation / Dispatch login
   — so Management does it): Verify / Reject and tell the MedRep / Ask for one / Not needed on the
   approval step; an order with a prescription medicine is not approved without it.
6. *Dispatch* — to pack / to ship / on the road; Cater and Release, Print address, Confirm for
   delivery against the printed slip, courier and tracking (or "not ready yet"), proof photo,
   Hold, Mark delivered; packing and the invoice made in crmnew.
7. *Returns* — Request refund (where the goods are, how much); Management decides; Dispatch checks
   what came back (good / damaged); Finance refunds or credits; only those lines.
8. *Team Lead* — My team (orders and activity of the people who report to them, at any depth),
   team performance, raise an order for a team member; told about the team's orders.
9. *Admin* — one "People & structure" page like the hub's User Management: departments, divisions
   with their head, team leads, seats / territories with targets; Management (Approval): which
   divisions each manager approves; create / edit / move a person. The menu in a few folding
   groups; the rest of today's admin pages folded in or reached from there.
10. *Look* — the hub's calm layout: a title and one line saying what the page is for, white cards
    with room, small windows for actions, a toast when done, folding menu groups.

**Order of work** (Aryan, 17 Nov: start with A — done 17 Nov, change log 82–83): A) the order page and Management (steps 2–3), B) the
MedRep form (1), C) Finance, Pharmacy, Dispatch, Returns (4–7), D) Team Lead and Admin (8–9), the
look (10) going along with each. Each part: built, tested, then walked in every login it touches
on the local copy (database copied first, put back after), with what was seen written here.

## 20. Finish every seat's screens and tie them together, before the money (plan, 17 Nov 2026)

Aryan, 17 Nov: before the real-money work (one ledger, section 17 / change log 96), finish the
seats whose screens are not complete and join them up, the chart's way; look at the live hub as
Subir Dey (Sales and Marketing Mentor), who runs CLIDP, B2B and Bidding, and follow its hierarchy.

**What the live hub shows Subir** (hub.getmeds.ph, looked at only, 17 Nov):
- *One switch at the top of every team page*: **All (13) · My team: CLIDP (2) · Jessa Domino's team ·
  Team Leader (7) · Jimmy Boy Saturinas's team · Leader (3)**. All = everyone under him; "My team" =
  the people straight under him who have no lead of their own (CLIDP: Maria Anicia Maglatang, Nicka
  Masusi); then one tab per lead under him with that lead's whole team (Jessa: Fritzie, Floremel,
  Ma. Lonie, Benjamin Dan Lacebal, Jeremy Regulasyon, Claire Gallana, Jessa; Jimmy: Angelica, Hazel,
  Jimmy). One press turns the whole page to that team: its KPIs, statuses, orders, activity.
- *My Team page*: Today / Yesterday / a day / This month; My own KPI and the team's (invoiced
  without VAT against target, %, orders invoiced, new customers, raised, held, "verified, waiting for
  invoice — not counted yet"); today's sales; Needs your attention (stuck over 48 h: 402); Current
  operations (orders today, pending payment, ready for dispatch, in transit, on hold, processing
  time); Orders by status (press one to filter); the orders table by MedRep and dates, Export CSV;
  recent activity. Stock news and promos on top.
- *Team performance*: the same switch and days; the team KPI with "4 flagged"; today's sales;
  salespeople with sales "2 of 13"; a table per salesperson: today, orders, **month so far, % of the
  month's target**, Dashboard →; a member's own dashboard, read-only, with ‹ Previous / Next ›
  through the team, and **"For the coaching talk"**: needs ₱X more in N days, orders on hold, drafts
  not sent, new customers.
- *Tracking Shared* (Aryan asked): the hub's status when Zoho's shipment with a tracking number came
  in — the parcel left and its tracking went to the MedRep. It stays there until someone presses
  "Mark delivery complete"; nobody does, so Subir's team has **363 orders "Tracking Shared" against
  156 completed**, and 402 "stuck over 48 h". crmnew has no such pile: Dispatch marks it delivered
  with the signed receipt (Aryan, 17 Nov), and "On the road" counts only what is on the road.
- *The CEO's (Admin's) hub pages*, read from its code: **Sales Performance** — the sales team's own
  sheet as a page: one row per territory, grouped **Head › channel › manager**, Target, Achieved,
  Balance to target, today's invoicing and %, a total at every level and a grand total, vacant
  territories in red; **KPI Scorecard** (NZSD and HRR per salesperson); Sales KPIs (targets).
- Targets: the hub has November's targets (Subir's 13: ₱31.5M; 26.2% reached); crmnew has none yet.

**crmnew today for Subir** (local, as Subir): Home with NBD, CRR (hand-overs), CLIDP, Government
Bidding, people at risk, money owed (₱69.1M, biggest owers), your people; My team (15 people in 6
boxes: CLIDP, B2B Telesales — Jessa, CRR, NBD, Government Bidding — Jimmy; drill in by box). Missing
against the hub: the switch at the top (crmnew drills in page by page instead), the month's targets
and % on every person, today's sales per person, the member's read-only dashboard with Previous /
Next and the coaching talk, and the CEO's Head › channel › manager sheet.

**The plan, in this order (each built, tested, walked in the seat's own login, then the next):**
1. *The team switch, everywhere a lead looks* (the hub's hierarchy, read from crmnew's chart: the
   seats under the lead): **All · My team (seats straight under me without a lead of their own) ·
   one tab per lead under me ("Jessa Domino's team · B2B Sales Coach")**, a lead's tab opening that
   lead's own switch one level down. On My team, the lead's Home figures, Scorecards / Team
   performance, Collections, Business orders and Targets; the CEO's company view the same from the
   top (All · each head's division). One press turns the whole page, kept in the address.
2. *Team performance like the hub's*: per person today, orders, month so far, **% of the month's
   target**, flagged; a member's own dashboard read-only with ‹ Previous / Next › and "For the
   coaching talk" (to target in N days, holds, drafts, new customers). crmnew's scorecards stay
   beside it.
3. *The sales sheet for the CEO and the heads*: Head › channel › team lead › seat rows, Target,
   Achieved, Balance, Today, %, totals at each level, vacant seats in red, Export CSV.
4. *Targets in place*: November's targets typed by the heads on Targets (or brought from the hub's
   own if Aryan says so), so every % above means something.
5. *The seats still short*:
   - Hospital Division's **Government Account** (Reynan Cuenca): the tender desk of 16.6 for the
     division's government hospitals, and the Hospital CHC's "Tenders open" block (a government
     posting quoted within 24 hours); the CHC's **weekly report**, the **Monday sync** and **route
     approval** (16.1's phases).
   - **Modern Trade**: the chains' deductions and near-expiry returns (they use the returns of step
     C3 and Finance's short-payment).
   - **Training Coach** (a vacant seat): its seat's screen once someone sits in it.
   - The two people in the hub but not on HR's chart: **Jeremy Regulasyon** (in Jessa's team in the
     hub; not in crmnew) — Aryan / HR to say where he sits (Benjamin Dan Lacebal is in crmnew as
     "Benjie Dan Lacebal", NBD).
6. *Tied together*: NBD → CRR hand-over (built) shown on both and on the lead's switch; CLIDP
   listings and Bidding tenders reaching the orders they make; every lead's "stuck" list the same;
   every page's people from the one chart.

*The old CRM's reports, back* (Aryan's screenshots, change log 98): Company › Sales organisation (the
tree) and Company › Map, live from the chart; Tree and Map on every lead's My team.

Then the money (one ledger): every invoice, payment, 2307, refund, credit and return posted to the
books, with the bank each payment went into.

## 21. crmnew as the company's ERP (plan, 18 Nov 2026)

Aryan asked for crmnew to become a complete ERP (SAP / Odoo / Salesforce class) without breaking
what works. The plan, what exists today, the phases and his questions: [ERP-PLAN.md](ERP-PLAN.md).
Nothing built until he picks a phase.

## 22. SEFMED's work in the MedRep's pages (20 Nov 2026)

Aryan, 20 Nov: SEFMED's app is very good, every step shows (where I will go, where I am, what
happened at the doctor); build all of it into the CRM. He showed its phone screens (Home with the
*Since 10:20 AM · HQ-Manila · Stop Working* circle and tiles; the tour plan calendar with a day's
actions and its cities; Visits in tabs KOLs · Hospitals · KBLs; Add Order; the KOL list and its
actions; Expenses; Leave; Call reports; Attendance; the manager's team list) and opened its web
portal in the browser pane (read only). First as a separate app so every screen got built properly
(commit d848ee39, never pushed); then, the same day: **"now integrate it into our MR pages, as
options of their own.** MRs made orders in the hub and kept records on SEFMED: we join both. Same
hierarchy: the team lead / manager approves, above them the head, above that the CEO."

**As built (20 Nov, local, not pushed).** Every SEFMED screen and rule, and its state:
[FIELD-CHECKLIST.md](FIELD-CHECKLIST.md). Code in `apps/api/src/mr` (addresses `/api/mr/*`) and
`apps/web/src/mr`; migration 0129 (`field_work`). The separate app's own people, clients and order
booking are gone.

- **One record of everything.** A visit is the CRM's own `visit` (12.11), with SEFMED's call on it
  (objectives, I'm here, the call, the business, close; *missed* added for a planned visit the day
  report closes with its reason). Customers are the CRM's own: doctors are the KOLs, hospitals the
  hospitals, drugstores and distributors the KBLs; the field's profile (best days and time, zone,
  contact person, qualification, firm type, the pharmacy that serves a doctor) sits beside the
  customer; the category is the customer's visit class A–D, set by the team lead. New customers come
  through the CRM's own Add customer (one per city, a hospital's papers, as everywhere). Asking to
  take one off the list goes to the team lead; nothing is erased.
- **Add order = the CRM's own order.** On a call, *Add order* keeps the call as typed, opens *Create
  New Order* for that customer and comes back to the call; the order joins the visit (`visit_order`)
  and goes to Management, Finance and Dispatch like every order. The call shows its orders and their
  step; *Business generated* needs one. Samples and gifts go through the samples module (a doctor's
  signed acknowledgement); the tour plan is the CRM's month plan (`visit_plan`) with days, cities,
  revisions and deviations; expenses are the CRM's field expense lines with SEFMED's heads and the
  day's per diem and TA; *Start working* starts the CRM's attendance day and the day report ends it.
- **The company tree is the hierarchy.** A MedRep works their own day; their team lead (whom they
  report to) sees the team, gets the tour plans, changes, expenses, day reports and *not sure yet*
  calls, and decides them; the head above sees everything under them and may stand in; the CEO reads
  everything and decides nothing; Management and the Admin stand in. Every lead page has the team
  switch. The person's lead is told (plans, changes, expenses, off-list asks); the lead's waiting
  items are on *To decide* too.

**Where it is.** The MedRep's *Visits* folder: My day (the circle, today's numbers, the next visit,
the tiles), Today's visits (tabs, a day or a month, New / At the place / Closed / Skipped / Missed),
Tour plan, KOLs / hospitals / KBLs, the Visit plan by class, Calendar, My calls, My expenses, My
samples & gifts; from My day's tiles: Follow-ups, Day report, Reports, Holidays, Leaves. A lead's
*Team visits* folder: Team today, Team visits, Approve tour plans, Expenses to approve, Team's
customers, Call reports, Visits report, (Team calendar,) Where the team is, Today's places, Team
samples & gifts, My own day. The CEO's and the Admin's *Field* app: the same, read from the top.
The older Visit plan page sends and decides the month through the tour plan's own path.
**One way in, one Start** (Aryan, 20 Nov: "a MedRep comes, clicks here, the day starts, goes to the
hospital; an order, and he is in Create order; don't make two pages"): the Rx CHC's *Log a call*
opens My day itself (no page of its own). For a MedRep whose menu has My day (Hospital, Rx, PAP and
the like; not TeleSales, B2B, Bidding or the Online office), the top bar's *Start my day* is Start
working itself (the same dialog: the field day and attendance together), and its *End my day*
while the field day runs opens the day report (Stop working). A call opened before the day started
shows *Start working* in its step 2, then *I'm here*.

**The MR's call, step by step**: 1 call objective(s) with remark, working with, priority; 2 *I'm
here*: time, place, distance from the pin; 3 the call: met or not, drugs promoted and how they were
taken, samples and gifts, the doctor's prescribing list with top five, a hospital's or a firm's own
answers, competitors, feedback; 4 business: *Add order*, promotional / business / both, the
outcome, a chance in pesos, **productive / not / not sure yet, never worked out**; 5 close:
follow-up, next visit, remarks, photos, the place again; time at the call shown.

**Rules kept** (Aryan's list): a planned visit and the call are two records (the plan as approved is
kept per revision); a call is never productive by itself; a meeting without an order isn't a failed
call; a planned visit not done needs a reason (missed); a closed call keeps its check-in and close;
only the lead reopens it, with why, kept; an order placed at a visit is an order like any other,
not sales until Finance invoices it; worked-out allowances, claims and approvals stay apart, nothing
approved because it was worked out; a change after approval is a deviation with why; the plan never
stops the day's work; nothing is deleted. The older visits report counts *missed* with skipped and
spends the approved amount.

**Interim defaults (to change on Aryan's word):** objectives = GetMeds' two from SEFMED + Aryan's
list; skip reasons = SEFMED's + two of the CRM's; the expense heads = GetMeds' SEFMED list; a bill
photo needed for every head but the day's allowances and the communication / car-plan allowances;
expenses up to 31 days back; per diem and TA rates 0 until Management or the Admin types them (they
are the company's, the same for everyone); *Put employee on hold* and tour-plan blocking not built.

**Later:** SEFMED's data loaded (its clients matched to CRM customers, its visits), e-detailing,
stock tally and secondary sales, payment from a firm, working offline.

## 23. A KPI card for every seat, the field's too, on the CEO's Home (20 Nov 2026)

Aryan, 20 Nov: "make the KPIs of everything, each person's, whoever has one; the MR app's KPIs, the
team lead's and the manager's too; the KPI data must show on the CEO's Home; integrate it well and
deploy live." His answers: **every seller and every lead** gets a card, a lead **their own card**
(not only the team's average); the field's KPIs on **interim weights, marked interim**.

The cards (the scorecard engine of change log 42–44, `apps/api/src/scores`): the playbooks' cards
stay as they are (Hospital CHC, Rx CHC, B2C CHC, TeleSales on the B2C card). New, **interim** until
HR publishes the real ones (each card says so; weights to change on Aryan's or HR's word):

| Card | Who | KPIs (weight) |
|---|---|---|
| Field work | every MedRep who works the field days (Start working) | Calls a field day 30 (8 or more full) · Coverage 25 (classed customers seen this month) · Frequency 20 (seen as often as the class asks: A 4, B 2, C/D 1) · Tour plan kept 15 (planned visits done) · Day reports sent 10 |
| B2B NBD | the NBD seats | IST 40 · New accounts with a first order 30 (count) · NZSD 15 · OCR 15 |
| B2B CRR | the CRR seats | IST 40 · Accounts reordering 30 · DSO 15 · NZSD 15 |
| CLIDP | the CLIDP seats | IST 50 · DSO 20 · Distributors reordering 15 · NZSD 15 |
| Modern Trade | the MT seats | IST 50 · DSO 20 · Chains reordering 15 · NZSD 15 |
| Government Bidding | BID seats and the Hospital Division's bidding coachee | IST 40 · Win rate 30 (won ÷ decided tenders this month) · DSO 15 · NZSD 15 |
| PAP | the PAP seats | Guarantee letters 40 (count) · IST 30 · OCR 15 · NZSD 15 |
| Team lead / manager / head | every lead seat | Team's cards 40 (their average) · Team sales vs target 30 · Day reports seen 15 · Joint field work 15 (days worked with their people) |

**The hub's KPI** (Aryan, 20 Nov, with screenshots of the hub's My Team page and its formula: "a KPI
comes out of a formula in the hub's code"; read from the hub's `services/kpiService.js` and
`controllers/kpi.controller.js`). No points or bands: **My KPIs** shows a person's month as sales
without VAT against target, and counts. Sales without VAT = each invoiced line ÷ 1.12 when it carries
12% VAT (Zoho's history by its line totals), the same lines as Sales performance; with VAT = the
invoices' totals; VAT the difference; % of target = without VAT ÷ target, one decimal. Orders
invoiced; new customers (an invoiced order that is its customer's first ever, Zoho's orders and
invoices counting as earlier; counted on this ERP's orders); orders raised; orders held (put on hold
or flagged in the month). The hub's "verified, waiting for invoice" is here "waiting for approval,
not invoiced yet" (the invoice is made at Management's approval): shown, not counted. A sale counts
for the seat's holder on the invoice's day (the territory's owner); typed for someone else shows as
"entered for others". A lead's **My Team KPI**: their own plus everyone in the seats under them (or
the box on the team switch); team target = everyone's targets + the empty seats' targets. The CEO's
and the Admin's: the company (every sale, every target, as the CEO Home counts them). Today ·
Yesterday · Pick a date · This month: a day adds that day's sales and its invoices. Shown on the
MedRep's, the lead's, the online desk's, the PAP desk's and the CEO's Home (`GET /api/kpis/me`).

A MedRep in the field has two cards: their channel's and Field work. The 12-month average and the
increment band read the channel's card only. Each card is locked on the 1st as before. The CEO's
Home shows the month's KPI picture: the company's average, people below 60, the best and the
lowest, each division's average; Scorecards opens every card.

## 13. Questions waiting for Aryan

1. Does Management check **every** MedRep order (as in the hub), or only the ones on which the
   system found something? (4.7)
2. Does Finance check only advance payments, or every order? (Built for now: every order passes
   Finance once, because Finance makes the invoice; only advance orders need the money first.)
3. How do a Team lead and a Manager differ in what they see?
4. Do field visits (SEFMED) wait for version 2?
5. Which domain will the new app use?
6. Order numbers that say what they are (`HOSP-2611-0042`, `ONL-2611-0007`, per channel per
   month; website orders keep their own)? Today `2MG-500001…`. Waiting for Aryan's yes.
7. The medicine list: which list is the real one (Zoho has 3,588 items; Aryan: ours is
   different), and should Zoho's SKU stay the medicine's SKU so old prices join by themselves?
8. Zoho's customers come over as they are (50,000+, patients included). Kinds are read from
   names and orders (12.18): look over the hospitals / drugstores / distributors after the import.
9. ~~Asking up for an exception~~ Answered 17 Nov: **both** — the automatic price check on every
   line, and Management's "Ask Team Lead" (the MedRep's) / "Ask Business Mentor" on the order with
   what it is asking; that person answers Yes / No with a word on their screen; it comes back to
   Management, which approves. Management decides when to ask. Built with step D (the Team Lead's
   screen).
10. Price kinds (18): keep doctor, distributor and bidding beside patient, hospital and drugstore?
    And "Extra": one more price per medicine set in Inventory (higher), that the MedRep can pick?
11. A guarantee-letter case (18): when an Online case becomes GL, does it move to the PAP head (who
    gives it to a PAP MedRep) or straight to one PAP person?
12. ~~Pharmacy~~ Answered 17 Nov: Management checks prescriptions on approving (no separate
    Pharmacy login); a prescription is required whenever a patient buys (a patient customer, or
    an order for one patient), whatever the channel.
13. ~~Advance-pay proof~~ Answered 17 Nov: the proof is an attachment on the order (or the
    MedRep's reason), and Finance checks it there.
14. ~~Approvals~~ Answered 17 Nov: Management approves every order that comes in, of every
    channel (B2B, B2C, Government, hospitals…); nothing skips it.
15. ~~The invoice~~ Answered 17 Nov: made when Management approves.
16. ~~Look~~ Answered 17 Nov: the hub's look — its text style, sizes, colours and background.
17. **Medicines with no price** (17 Nov check): 22 of 280 have no price for any buyer, 15 of them
    in stock (FinaGet 5 mg, SevelaMed, Cizigla, TemoGet-20…; list in `.data/lists/medicines-without-price.csv`).
    Who sets them, and from which list?
18. **One price for everyone**: on 151 medicines the hospital, doctor, distributor and drugstore
    prices equal the patient price (as the 2026 price list gave them). Right, or do they need their own?
19. **VAT, crmnew vs Zoho**: crmnew takes VAT from the 2026 price list's Tax column (VAT / VE); on
    33 medicines Zoho says otherwise (AmloGet, Anastrozole, Letrozole, OndaGet: VE in the list, 12%
    in Zoho; AmioGet, CefazoGet…: 12% in the list, no tax in Zoho). List in
    `.data/lists/vat-crm-vs-zoho.csv`. Zoho's own taxes: 12% or none on 143,158 invoice lines; no 15%.
20. **Demo prices left on real medicines**: HydroxyGet has a bidding (Government) price of ₱9,200 a
    piece from the demo (its patient price is ₱31.25; it is the only bidding price there is), and
    Anastrozole / Letrozole carry demo prices and a demo "November promo". Clear them? And where do
    Government (bidding) prices come from?
21. **Billing company changed after the invoice**: the invoice keeps its row and takes a number in
    the other company's series (the old number stays only on the timeline). Allow that, or refuse
    changing the company once the invoice is made?
22. ~~Withholding tax~~ Built 17 Nov (step C1, as Zoho kept it): Finance types the tax withheld and
    its Form 2307 number with the money; it settles the invoice, is no cash in, never given back.
23. **Businesses filed as patients**: 93 customers named like businesses (pharma, trading,
    medical…) are kind "patient" from the Zoho import; with the Rx rule their orders would wait
    for a prescription. List in `.data/lists/patients-that-look-like-businesses.csv` for the heads.
24. **Delivery method on the order form**: the hub's MedRep picks it (Lalamove, pick-up…); crmnew
    keeps your 14 Nov rule that the MedRep doesn't choose delivery and Dispatch picks it when it
    ships. Keep it with Dispatch? (Likewise the hub let a MedRep raise an order for another MedRep;
    crmnew keeps "a MedRep places only his own".)
25. **Price check made automatic**: each line now shows how far it is from the list ("−5.9% vs
    list") and Management sees the order's own % and the customer's past prices. To let the system
    say "fine to approve" by itself, what counts as fine? (e.g. up to N% below the list, or not below
    the price this customer paid last time.)
26. **Christmas offers, the patient ones** (Aryan, 17 Nov: "Christmas offer" is only a name, no
    days — loaded, running until ended). The file says a patient promo on a
    prescription medicine needs Regulatory clearance: 92 such are held back — load them once
    cleared? 11 SKUs in the file aren't in our list (GM-4313, GM-4640, GM-4340, GM-4539, GM-4316,
    GM-3185, GM-4283, GM-3398, GM-3690, GM-1752, GM-3545): add them, or leave them out?
27. ~~Cold packaging~~ Answered 17 Nov (Aryan): the styro box is an item in stock like a medicine,
    any price on it in Inventory, and **Management types what the cold chain costs on the order**.
    Built (change log 92). **Still open: the shipping charge** below.
    The question as asked: **The cold-packaging fee and the shipping charge** (plan 18 step 3; neither is in the hub,
    both were typed in Zoho). Cold: Zoho's 2026 invoices carry "Packaging : Cake Roll with
    Cover-Styro" or "Split Box Styro" on 607 of 11,552 invoices, at a price typed each time (Cake
    Roll ₱89 most often, ₱0 on 104, also ₱54, ₱44, ₱154…; Split Box mostly ₱0), and the old price
    list said Docetaxel's price "incl. of cold chain pack". You said "Cold Management" is an
    Inventory item with its fee set there, on every cold delivery. How much is it (one fee, or by
    box size), is it charged on top of the price or already in it, and is the styro box kept as
    stock (Zoho counted 441 Cake Roll, 462 Split Box) or only a fee? Shipping: Zoho put a shipping
    charge on 120 of this year's invoices (₱150–₱300): does Management add it when approving?
    Until then the cold medicines are marked and packed cold, and the fee is not added.
28. **A credit memo for each credited return**: Zoho made a credit note with its own number
    (CN-00893…) for every return; crmnew takes the credit off the invoice and keeps the return's
    RET- number, with no printable credit memo. Does the BIR need one (a "credit memo" with its own
    series per company, like the invoices: GetMeds going on from Zoho's CN-00893, 2MG its own)?
29. **Field expenses** (22): the per diem and TA a day for Head quarter / Ex-station /
    Out-station (or the fare chart by km), and the fixed allowances (communication, car plan): who
    gives the numbers? Who approves after the team lead, above what amount, and does Finance pay
    them with payroll or apart? Until then: rates 0 (Management or the Admin type them), the team
    lead approves each line.
30. **The phone's place in the field** (22): keep a trail every few minutes while the day runs
    (SEFMED's track report), or only at start, I'm here, close and stop, as built?
31. ~~The app's name and its people~~ Answered 20 Nov: no separate app; it lives in the MedRep's
    pages, with the company tree's people.

32. **The real KPI cards** (23): the field's, B2B's, CLIDP's, MT's, Bidding's, PAP's and the leads'
    KPIs and weights are interim (section 23). HR or Aryan to give the real ones; they change in
    `scores/recipes.ts` without touching the data.

## 14. Change log

- **14 Nov 2026** Plan written. Decided by Aryan: rebuild with an all-new UI; follow the hub's
  flow; MedRep only places his own orders and does not choose delivery; Inventory first, by
  batch and warehouse, with all prices; MedRep taps a price and gives a reason for a lower one;
  Management sees list price against given price; Medicine box on Management's screen; MedRep
  sees his area and his orders as cards; purple look with Leads-style cards; Company tree and
  CEO Home kept from the old CRM as they are.
- **14 Nov 2026 (later)** Aryan: everything is new, the database too; Claude has a free hand on
  the technology; build it in phases. Section 10 rewritten: nothing is imported from the old
  code, one company, a new database, our own sign-in.
- **14 Nov 2026 (evening)** **Step 0 built** in `new/`: the API (Hono, Drizzle, embedded
  Postgres locally) with tables `channel`, `area`, `person`, `session`; sign-in, sign-out, change
  password, lock after 5 wrong passwords; the web app (React, Vite, Tailwind) with the sign-in
  page, the frame and each role's menu, a Home showing the person's area, channel and who they
  report to, and an honest "not built yet, comes in step N" page behind every menu link not yet
  made. Checked: 8 API tests, typecheck, a production build; walked in the browser as the MedRep
  and Management on a desk and a phone; all nine demo roles sign in; "who is asking" is one
  query, about 2 ms on this computer. Not done: nothing is deployed and nothing is committed.
  **Next: step 1, Inventory.**
- **14 Nov 2026 (night)** **Step 1, Inventory, built.** Tables (migration `0002_inventory.sql`):
  `warehouse`, `medicine`, `medicine_price` (one per buyer type: patient, hospital, doctor,
  distributor, drugstore, bidding), `promo` (dated), `price_change` (history), `batch`, `stock`
  (what is on the shelf per batch per warehouse; can never go below zero), `stock_move` (every
  change, kept for good), `incoming` (expected deliveries), `stock_news`. Screens: **Inventory**
  (every medicine with stock per warehouse, free to sell, coming, nearest expiry, status; tiles
  for out / low / expiring that filter; search), **the medicine's page** (batches by warehouse
  with expiry, all prices and promos, what is coming, what moved, price history), **Stock coming
  in** (expected deliveries, received with one button), stock news on everyone's Home. Who may:
  everyone reads; Dispatch, Management and Admin receive, move, count and post news; Management
  and Admin add or edit a medicine; Management, the CEO and Admin change prices and promos.
  Rules: receiving asks the batch and expiry and refuses an expired batch or a batch number
  already on file with another expiry; a stock count that differs needs its reason; a move
  can't take more than is there; the same medicine (name + strength) is never listed twice;
  one open stock notice per medicine. Checked: 20 API tests, typecheck, production build; in
  the browser as Dispatch (received stock: 35 → 135), Management (changed a price, history
  kept) and the MedRep on a phone (reads only). The list is 7 queries, a medicine's page 10.
  **Not in this step, on purpose:** "promised to orders" (comes with orders, step 3), and the
  real medicines, prices and stock (imported from Zoho at the switch; what is there now is six
  demo medicines). Not tested against a real Postgres server yet (only the embedded one).
  **Next: step 2, hospitals, doctors and patients.**
- **14 Nov 2026 (late night)** Aryan: a separate person runs inventory, and imports have costs
  on the way in (section 5.1). Built: the **Inventory role** (demo login irene); migration
  `0003_purchasing.sql` (`supplier`, `purchase`, `purchase_line`, `purchase_cost`, the batch's
  `unit_cost`; the first "expected delivery" list is gone, purchases replace it); screens
  **Purchases** (list, new / edit, the purchase page, Receive, Change costs) and **Suppliers**;
  each batch's cost and the margin on the medicine's page for those who may see them.
  Management no longer receives or counts stock (Inventory and Dispatch do); it still adds
  medicines and sets prices. Checked: 25 API tests (the landed-cost sums were worked out by
  hand first), typecheck, production build; in the browser as Inventory: received 180 of 200
  boxes on PO-00002, the batch landed at ₱915.11 beside the older batch at ₱905, same selling
  prices, margin shown. Not done: partial receipts in several deliveries (one receipt per
  purchase for now), paying suppliers, and the real suppliers and purchases.
- **14 Nov 2026 (later still)** Aryan: Inventory needs an **All medicines** list, in the left
  menu (not a tab on top), with everything about each medicine. Looked at the company's Zoho
  Inventory item page (read only) for what an item carries: SKU, unit, manufacturer, brand,
  strength, product type, molecule, packing, category, form. Built: migration
  `0004_medicine_details.sql` (the medicine's `sku`, `unit`, `manufacturer`, `brand`,
  `category`; a SKU names one medicine only); the **All medicines** screen in every role's left
  menu: name, SKU, molecule, form and pack, category, maker, Rx / VAT, every price, the running
  promo, stock, and the average landed cost for those who may see costs; search by name,
  molecule, SKU or maker; a category filter; a Details card on the medicine's page. The stock
  list's menu link is now "Stock". 27 API tests. Zoho also keeps front / rear photos of a
  medicine, a product status and the senior / PWD discount flag: not built yet.
- **14 Nov 2026 (night, last)** Aryan: sold by the tablet, so the tablet is the main unit and
  every buyer's price is per tablet (section 5.0). Built: migration `0005_pieces.sql`
  (`medicine.pack_size`, `medicine_price.pack_amount`); prices per piece and per pack in the
  Prices form; packs shown beside pieces on Stock, All medicines and the medicine's page; the
  purchase form counts pieces and shows the packs. The demo data is now by the tablet (the
  tests keep their own fixed stock in `fixture.ts`). 28 API tests.
- **14 Nov 2026 (step 2)** Built the masters (section 6.1): migration `0006_customers.sql`, the
  customers API (`apps/api/src/customers`), the screens Hospitals, Doctors, Patients,
  Customers, My area, the customer page, Add / Edit customer with the old-customer check, and
  Management's New accounts. The MedRep's Home shows how many hospitals, doctors and patients
  his area has. 37 API tests, typecheck, production build. Walked in the browser: as the MedRep
  (sees only his area; "Chong Hua" typed in Add shows it is already on file elsewhere; a
  patient typed with a number on file shows the old patient; added a patient), as Management
  (New accounts, Mark reviewed, payment terms refused without days, then saved), and at phone
  width. Still awaited from Aryan: the price list link. Next: step 3, the MedRep's Home and
  New order.
- **14 Nov 2026 (late night)** Aryan: the screens looked poor and the hub and Zoho had not been
  studied properly. Studied the hub as Management (every menu, one order with its tabs and
  timeline), every section of Zoho Inventory, SAP Fiori's real theme and the old CRM's Zoho
  screens; the findings are section 9.1. Rebuilt the look on SAP Fiori Horizon with our purple
  (section 9): new frame with a working search and a grouped menu, Home as a dashboard
  (`/api/overview`), the stock ledger as **Adjustments**, **Transfers** and **Receives**
  (`/api/moves`), Purchase orders as a table with tabs and a "What's next" strip, tables on
  Customers, page heads with facts on the medicine, purchase and customer pages. 41 API tests,
  typecheck, build; every screen opened in the browser at desk and phone width. Not done yet:
  the medicine page as tabs (Overview / Batches / Prices / History), adjustment reasons, and the
  order screens themselves (steps 3 to 6), which follow section 9.1.
- **14 Nov 2026 (night, after Aryan's review)** Aryan: the new look was worse than the old
  CRM's; purple rejected; Management's menu was full of things that are not its work; an Admin
  page of apps was missing; channels and their reports had no place. Changed: the look is now
  the old CRM's (section 9), Inventory copies Zoho the way the old CRM did; menus are desks
  and apps (section 9); the Admin and CEO start on a page of apps; Management's menu is Home
  and New accounts; migration `0007_channel_head.sql` names each channel's head on the channel;
  Reports → Sales channels (`/api/reports/channels`). 42 API tests, typecheck, build; opened as
  Admin and Management, desk and phone width. Aryan also said the old CRM's channel head and
  team logic had errors: it is not copied (section 9).
- **14 Nov 2026 (night, Management)** Aryan: Management's screen must be the hub's work
  (approve what the MedRep placed, see everything about it), as designed on the canvas
  (artboard "Checks"). Built: migration `0008_orders.sql` (`sales_order`, `order_item` with the
  price picked, the list price and the reason, `order_event` = the timeline); `apps/api/src/orders`
  (placing, the board, the dashboard, the list, the order page, Approve / Send back / Reject /
  Hold / Exception / Take off hold / Cancel / Place again, each written to the timeline under
  a row lock). Statuses and tile groups after the hub's state machine; "stuck" = no move in 48
  hours. Screens: **Orders to check** (cards: avatar, customer, code and amount, New and the
  wait, channel, kind, terms, city, medicines, MedRep and area, what the system found as pills,
  Next action, the six-step strip, Approve / Hold / Send back; tabs Needs you, With Finance,
  With Dispatch, On hold, Delivered today; channel and MedRep filters; "Approve the N with
  nothing found"; Medicine check and Stock to watch on the right), **On hold** (the hub's
  Exception Hub), **All orders** (the hub's log with search, status, MedRep and dates),
  **Dashboard** (the hub's Global Dashboard), the **order page** (header, details, findings,
  the stage's buttons, tabs Audit timeline / Order items / Payment / Dispatch) and **New order**
  (customer, medicines with the price tapped, a reason below the price, delivery). An order by
  Management skips the queue, as in the hub. Credit customers go from approval to invoicing,
  others to Finance. 53 API tests; walked as Management (hold with a reason, approve the clean
  ones, place an order below price: refused without a reason, then placed). Not walked yet as
  the MedRep in the browser (covered by the tests). Not built: Finance's and Dispatch's steps
  (the orders stop at "With Finance"), the MedRep's own Home, refunds, attachments on an order.
- **14 Nov 2026 (night, Aryan's review of Management)** The order cards weren't premium:
  **Orders to check is now drawn exactly like the old CRM's Leads & enquiries desk**
  (`frontend/components/lead-desk.tsx`, its classes lifted as they are): title with a count
  pill, one toolbar card (work tabs with counts, the step line Waiting > Payment check > To
  invoice > Awaiting payment > To pack > Packing > On the way > Delivered | On hold, Cancelled,
  search, channel and MedRep), cards grouped by the day placed, each card the Leads card
  (avatar, name, order number and amount, type pill, channel, terms, city, medicine, MedRep,
  what the system found, Next action, the strip: done green, current blue with a ring, held
  red). The hub-copied **Dashboard and Exception Hub pages are removed**; On hold is the same
  board on its hold tab. **Order numbers are 2MG-500001…** (the company's style, migration
  0009) instead of GM-YYYYMMDD-NNNN. **"New accounts" is now "New customers (to check)"**: the
  hospitals, doctors and patients a MedRep added that Management hasn't checked; their orders
  still go through. When the old CRM's orders are imported, their numbers are kept and the
  series continues after the highest.
- **14 Nov 2026 (night, MedRep from the start)** Aryan: start the line from its start, the
  MedRep. Built as the canvas artboards "Main" and "NewOrder", in the old CRM's look:
  **MedRep Home**: my area (channel, cities, hospitals, doctors, customers not ordered in 60
  days, who I report to up the line), one big New order button, my sales this month (orders
  placed, value, today, days left; the target shows once Management sets one: not built),
  where my orders stand (with Management / Finance / packing or on the way / delivered this
  month, each opening My orders), each order sent back or on hold with its reason, stock news,
  my latest orders as the same cards Management sees, worded for the MedRep ("Management is
  checking it: below hospital price", "Sent back to you: … Fix it and place it again").
  **My orders**: those cards with tabs, grouped by day. **New order**: the MedRep's band (his
  order, his area), the customer as a card (kind, city, last order, in / not in his area, terms,
  licence, new and not checked), "New customer"; medicines added by search, each with its stock
  by warehouse, what is coming or the nearest expiry, the prices to tap (the customer's own kind
  first, then the promo), a quantity stepper (starts at one pack), "Give a lower price" (the
  price given, why, how far below: Management decides); payment terms as set by Management,
  needed-by day, deliver to, receiver and number, the customer's PO number (migration 0010);
  a note; subtotal, lower price given, total; what Management will see; a bar with the total
  and Place order. API: `/api/orders/mine`, `/api/my/area` (quiet customers, reporting line),
  the customer's last order day. 55 API tests; walked as Ryan (desk and phone width): placed
  300 Anastrozole at ₱41 with a reason, and it showed at the top of Sarla's Orders to check
  with "Below hospital price". Not built from the design yet: papers (PO photo, payment proof),
  "Invoice from" (2MG / GetMeds), a doctor on the order, saving a draft, the monthly target.
- **14 Nov 2026 (night, the rest of the MedRep design)** Built what the canvas "NewOrder" and
  "Main" still had: **Papers** on an order (purchase order, proof of payment, prescription,
  guarantee letter; photos made smaller to WebP on the phone, PDFs as they are, 10 MB at most;
  migration 0011 `order_file`, kept in the database for now; removing one keeps it, marked
  removed; the timeline says who attached or removed what). A customer who pays in advance with
  no proof of payment is a finding Management sees ("No payment proof"); the proof is "Not
  needed" for credit and COD customers. The order page has a **Papers** tab (view, add, remove)
  and the card shows the papers on file. **Invoice from** 2MG Inc. or GetMeds Philippines Inc.
  **Doctor (if any)** on the order (a hospital's own doctors offered first). **Save draft**
  keeps the form on that device (not the photos) and brings it back when New order is opened
  again; placing the order clears it. **Monthly targets** (`sales_target`): the Admin and the
  CEO set anyone's, a head or team lead their own team's, on **Targets** (in the head's and
  team lead's menu, and in Reports); the MedRep's Home shows the bar with a mark where the month
  is ("44% · should be 47% today"); a target counts the orders the person placed in the month.
  **Order numbers no longer skip**: they come from a counter inside the order's own
  transaction. 58 API tests; walked as Ryan (draft saved and brought back, an order with a PO
  photo, GetMeds and a doctor), Vanessa (set Ryan's target) and Sarla (the card shows "PO").
- **14 Nov 2026 (late night, step 5: Finance)** Built Finance's desk after the hub's Finance
  screens, on the Leads-style board Management has: **Orders to check** with Needs you
  (payments to confirm and orders to invoice), Not yet with Finance, With Dispatch, On hold and
  Delivered today, the step line, and on the right what customers owe (overdue first) and what
  came in this month. **Confirm payment** (advance: look at the slip, type what came in, tick,
  confirm: payment, invoice and the move to Dispatch in one transaction), **Make invoice**
  (credit and COD; several at once when nothing was found), **Hold** at Finance's step (the slip
  attached sends it back by itself). **Invoices** (Zoho Books' list and document: company, bill
  to, terms, due date, VAT split, payments, balance, print), **Payments received** (by month and
  way), **Customers owe** (by age), **Refunds owed** (cancelled after paying, until given back).
  The order page shows the invoice's state beside the order's, and its Payment tab the invoice,
  payments and Record payment. Management's cards now say when a customer is overdue or over
  the credit limit. The `invoiced` order status is gone (migration 0012 moved such orders to
  Ready for Dispatch): paid is a fact of the invoice. Admin and CEO have a **Finance** app. 71
  API tests; walked as Fiona: made an invoice, held an advance order for want of the slip, the
  slip attached by Sarla sent it back, confirmed the ₱1,500 with the slip in the dialog (invoice
  2MG-SI-000007, paid), recorded the rest of a partly paid invoice by GCash, gave back the money
  of an order Sarla then cancelled; Customers owe, Payments, the phone width and the Admin's
  Finance app checked. Not built: refund requests with returned goods and credit notes (step 6),
  paying suppliers (bills), BIR forms (2307), the month's sales figures (step 7).
- **14 Nov 2026 (late night, step 6: Dispatch)** Built Dispatch's desk on the same board:
  **Pack** (each line's batches from the order's warehouse, the first to expire filled in and
  changeable, never an expired one; the pieces leave the shelf into the box, logged as "Packed
  for an order" with the order number; migration 0013 `order_pick` keeps the batches and their
  landed cost), **Unpack**, **Ship** (courier with tracking now or later, our rider, or picked
  up at the warehouse), **Delivered** (who received it, the day, the signed receipt's photo;
  a COD invoice falls due that day), **Came back** (back with Dispatch, still packed), **Hold**
  at Dispatch's step, a printable **Delivery receipt**, and **Shipments** (on the way,
  delivered). The order page shows what is in the box, how it went and the tracking; MedReps'
  cards say "On the way with J&T Express · JT0045…". Each desk takes off only its own holds; a
  parcel on the road can't be cancelled; cancelling a packed order puts its pieces back.
  "Completed" now means delivered and paid. Fixed on the way: a cash-on-delivery order went to
  "Confirm payment" instead of "Make invoice"; Management's own orders had no warehouse. 79 API
  tests; walked as Marco: packed Olivarez's 150 Letrozole from batch LT2407 (Main 3,100 → 2,950),
  shipped with J&T and its tracking, printed the delivery receipt, marked it delivered, and
  brought back a parcel the hospital didn't receive. Not built: sales returns and credit notes
  (goods coming back after delivery), refund requests, the hub's pharmacy check before packing.
- **14 Nov 2026 (late night, step 7: team leads, managers and the CEO)** One sales rule for every
  page: a sale is what Finance invoiced, counted for the order's MedRep and channel
  (`apps/api/src/sales`). **Team lead and manager Home**: the team's month (sold against the
  team's targets with the pace marked, today, placed, stopped), each person under them by who
  reports to whom against their own target, and the team's orders on hold or sent back; a head
  sees the whole branch. **CEO Home** brought over from the old CRM in its approved shape and
  look (the four figures, "Your company" as the eight apps with their figures, channels against
  target, Needs you), for the CEO and the Admin; the separate page of apps is gone into it.
  **Company tree** brought over unchanged (`apps/web/src/company/tree.ts` is the old
  `frontend/lib/company-tree.ts` as it was), fed by `/api/company/tree`. **Reports**: Sales by
  channel now with sold, target and the pace bar by month; Sales by person. The MedRep's Home
  bar and Targets now count sold (invoiced), with placed shown beside it. 86 API tests; walked as
  Naresh (Home, tree, channel report), Daniel and Vanessa (their teams, phone width). Not built:
  the tree's map (it needs each area's places), a channel head seeing only their channel's
  report, the Online desk (step 8).
- **15 Nov 2026 (step 8a: the Online desk)** Leads & enquiries and the case page rebuilt on the
  new order line (`apps/api/src/online`, `apps/web/src/pages/leads.tsx`, `lead.tsx`,
  `apps/web/src/online/`): the old desk's cards, queues and step line; the old journey chart;
  papers per road; the quotation with the senior / PWD relief; the GL application and letter;
  "Place the order" asking cash on delivery or paid in advance, then the order goes to
  Management with the agent as the Online channel's MedRep. Seven demo cases at every step.
  93 API tests; walked as Jane (filed an OSCA ID, placed a senior order at ₱6,960 after the
  relief and a COD order, added an enquiry on a number already on file, quoted below the patient
  price with its reason, marked it sent by Viber), as Sarla (the orders in her queue as ONLINE)
  and as Naresh (read-only), and at phone width. Fixed on the way: the next step said "osca id";
  a new case showed the prescription as not needed before its quotation; the new-customer finding
  said "a MedRep added it" for the Online desk too. Next: 8b Messenger and email.
- **15 Nov 2026 (step 8b: Messenger, email and the Inbox)** Facebook pages and mailboxes are
  connected under Channels (tokens and passwords sealed); Meta's webhook and a two-minute pull
  bring each person's messages and photos onto their case; email is read from the INBOX with new
  senders held for "Make enquiry"; the agent answers from the new Inbox or the case's chat panel,
  on Messenger within Meta's 24 hours or by threaded email (`apps/api/src/online/messenger.ts`,
  `email.ts`, `conversation.ts`, `inbox.ts`; `apps/web/src/pages/inbox.tsx`, `channels.tsx`,
  `online/chat.tsx`; migration 0015). 103 API tests (10 new: the signature, a page connected
  late, photos, echoes, reads, reactions, the 24 hours, a lost case reopening, the history pull,
  holding and letting in senders, threading, setting a sender aside). Walked locally with Meta and
  mail answered on this computer: Naresh connected a page and a mailbox; Jane answered Rosa on
  Messenger, made Liza's email an enquiry and answered it, opened Ben's chat from his case and
  filed his chat photo as the prescription; the Inbox at phone width. Fixed on the way: the
  Inbox's column grew wider than a phone; the lost dialog said its reason was optional. Next: 8c,
  the two websites.
- **15 Nov 2026 (step 8c: the websites)** Websites are channels, as many as the company has, each
  with its own secret, on the old CRM's contract. A website order opens a "Website order" case with
  its road, its medicines matched as the quotation and its documents to file; the order carries the
  website's delivery fee and payment; its status goes back to the website, signed, until taken;
  prescriptions and enquiries land on the person's case; the website's admin reads the progress
  (`apps/api/src/online/websites.ts`, migration 0016; `apps/web/src/online/website.tsx`, Channels).
  Orders now carry a delivery fee (in the total and on the invoice, VAT-able). 111 API tests (8 new).
  Walked locally: Naresh connected "2MG website" and got its secret; a signed senior order with a
  coupon and ₱150 delivery came in, the case quoted Imatinib at the website's price less 20% and
  matched the website's ₱2,670 to the centavo; Jane filed the Rx and OSCA ID and placed it (COD);
  Sarla approved, Fiona invoiced, and the stand-in website was told "confirmed". Fixed on the way:
  a case's money hid the delivery fee once the order was placed. Next: 8d, points and the
  quotation PDF.
- **15 Nov 2026 (step 8d: points and the quotation PDF)** Points on the owner's rules: 10% of what a
  patient actually paid for the medicines once delivered (never the delivery fee or points; the
  agency's money on a GL), by phone, never expiring, business buyers never; reconciled on every
  receipt, removal, delivery and cancel, the difference only; used on the case's order (regular
  road) and paid on its invoice by points, given back on a cancel. Points page and Company details
  (`apps/api/src/points`, `settings`; migration 0017; receipts now say who paid). The quotation as a
  PDF on the letterhead (pdf-lib), a 30-day link, sent on Messenger or emailed attached
  (`apps/api/src/online/quotation.ts`). 116 API tests (5 new). Walked locally: Naresh switched the
  program on; Teresa's website order was packed, shipped, delivered and paid in cash, and she
  earned 252 points (10% of ₱2,520, not the ₱150 delivery); Jane used 100 of them on her next
  order (₱1,500 → ₱1,400 to pay, 152 left); Ben's quotation went out on Messenger as a link that
  opens without signing in. Fixed on the way: a zero VAT line on the PDF. Next: 8e, points on the
  websites, then the switch.
- **15 Nov 2026 (step 8e: points on the 2MG website)** Aryan: 2MG only. The new CRM answers the old
  CRM's points calls unchanged (`/webhooks/store/2mg/points/manage`): the member's own sign-in opens
  their points (claim by number), My rewards with their orders, points held at checkout and taken by
  the case's order exactly once, given back on a cancel (the CRM's or the website's), the website
  admin's lookup and adjustment (`apps/api/src/points/website.ts`, `website-calls.ts`; migration
  0018). 125 API tests (9 new, each call sent as the website sends it). Fixed on the way: a website
  cancel before the CRM's order kept the checkout's points. Not walked against the real website
  (it would need the live secret). Next: the switch.
- **15 Nov 2026 (the Online desk's order, and every order page like the case)** Aryan noticed the
  old CRM's agent worked a case to the money while the new line split it, and asked me to choose:
  an Online case's order goes straight to Dispatch with its invoice unless it carries a discount, or
  a business buyer's credit / unchecked account (then Management checks it first); Finance is no
  step for it; the agent marks it delivered and records the money. MedReps' orders keep the full
  line. The order page for Management, Finance and Dispatch is now laid out like the case (journey,
  steps on the left with Money and Activity, the step's work on the right). A Leads list redesign
  was tried and put back at his word. 127 API tests (2 new). Walked locally: Sarla approved
  2MG-500074, Marco packed (batch AN2291) and shipped it (LBC), Jane marked it delivered and
  recorded ₱1,400 cash: the case is Done; Fiona opened Ryan's hospital order on Finance check.
- **15 Nov 2026 (the switch on the order; the invoice as Zoho prints it)** Aryan: no settings page
  for who checks orders; put the switch on the order form and make it automatic. Every order form
  now starts with "Send to Management" / "Send to Finance", off unless something is wrong on the
  order (then Management is locked on with the reason); the server checks again. Migration 0019
  keeps Finance's choice on the order. The invoice page is drawn as Zoho Books' invoice (looked at in
  Zoho, read only). 132 API tests (5 new). Walked locally: Ryan's New order showed "Goes straight to
  Dispatch", and picking a new drugstore that pays in advance locked Management on; Fiona opened
  2MG-SI-000009 as the Zoho-style invoice.
- 15 Nov: Field orders as the hub takes them: the MedRep picks division, sub-division and payment
  terms (migration 0020), Management completes the rest on the order; free goods as a ₱0 line of the
  same medicine; the MedRep's phone has a raised + for New order; the email is asked on every new
  enquiry and customer. Every order (hospital, doctor, B2B, BID, Online) emails the customer when it
  is confirmed, on the way, delivered and paid, once each, and "Send to customer" sends the newest
  step by email, WhatsApp, Viber, SMS, Messenger or copied text. 141 API tests (14 new). Walked
  locally: Ryan placed a HOS / PASAY / PDC 30 order with a Buy 1 Take 1 line from the phone; Sarla
  saw his details, approved it, and the hospital got "Your order 2MG-500075 is confirmed"; Marco
  shipped it and "is on the way" went with the LBC tracking; Jane re-sent Teresa's payment email
  from her case.
- 15 Nov (later): the old case page's look on every page (boxes, fields, dialogs, the top bar's
  2mg Inc. logo, no workspace icons, no black); the case page rebuilt as the old one (road picker,
  Intake, Owner, Add email, Orders on the number, Steps); hospital / doctor / patient pages with
  their whole story and who they are under; one customer per phone number (locked) and the
  Philippine phone format; All orders and the Leads desk with Cards / Table / Board; the invoice
  and a Sales order page as Zoho prints them; the Management / Finance switch for the office only
  (Management decides Finance on approving); the MedRep's New order (New customer first, Division
  and payment terms step) and Home (figures by period, the Hospital CHC scorecard, customers).
  Migration 0021 (indexes). 141 API tests pass. Medicine page kept as before at Aryan's word, with
  Prices & promos moved up and the case page's boxes.
- 15 Nov (night): Management's Home (figures by period, the queue to approve on it, sales by MedRep
  and channel); every orders board and customer list tells the MedReps apart (a strip with each
  one's count, Management's queue grouped by MedRep); Management's sidebar trimmed to Home, All
  orders, New customers and Look up (Orders to check and On hold live on the Home); a desk keeps its
  own sidebar on pages it lists; Medicines & stock shows the stock first. Three more demo MedReps on
  a local computer. 144 API tests pass.
- 15 Nov (late night): sent-back orders fixed by the MedRep with an answer (Sent back tabs for the
  MedRep and Management), Management takes back an approval within 30 minutes while the next desk
  hasn't acted, a price line and History on the approval card, each step's own clock and time
  record (migrations 0022, 0023), Medicine not available requests to Inventory, the A to Z bar,
  customer lists as cards with no initials tile; the MedRep sections on Management's queue removed.
  148 API tests pass.
- 15 Nov (night, later): Dispatch's desk (sidebar, Home with figures and the warehouse's work, the
  warehouse's own tabs, cards with where it goes, pieces, wanted-by and who has it in hand, came back
  with why, On the road with time out and row actions) and the bell for every role (migrations 0024,
  0025). 149 API tests pass.
- 15 Nov (night, last): Dispatch's and Finance's Homes back to the usual board at Aryan's word; every
  order list gets Cards / Table / Board (picked per person, remembered), with Dispatch's and
  Finance's work columns as their Board, loaded only when picked. 149 API tests pass.
- 15 Nov (night): plan for people, teams, desks and the SaaS shape written
  (`docs/architecture/new-crm-people-teams-saas.md`); nothing built yet, waiting for Aryan's answers.
- 15 Nov (night, after the plan): teams and seats built at Aryan's go (migration 0026): units, seats
  and who sits in them write each person's role, boss, channel and area; the CEO's Teams & people
  page adds a person with their login and place in one step, fills empty seats, covers, marks
  someone as left with their seat kept. 157 API tests pass.
- 15 Nov (night, last): My team for team leads and heads (seats under them, Needs you, a card per
  seat, a seat's own page); orders and customers filter by seat; a lead sees orders sold from any
  seat under them. 161 API tests pass.
- 15 Nov (late): Team lead covers Mentor and Coach; login IDs belong to seats (0027); My team with
  dates, charts, team chart and cards; Targets as cards; Messages and announcements (0028);
  sidebar hide on desktop; channels explained and the SaaS apps page planned.
- 15 Nov (late, after): stuck orders say whose step it is; Areas tab; team leads ask for people
  and the CEO approves (0029); the CEO's Company view drills company → team → person; See as
  (read only, 0029). 169 API tests pass.
- 15 Nov (late): sidebar folders and division list; one Back; Messages boxes replace the bell; region/area requests with team announcements; desk work for non-selling teams; Speed by person; CEO Home date range and money in/out; audit fixes T3 T5 T6 T20 T34 R2 M11 O33.
- 15 Nov (night): audit batch — cheaper buyer price flagged (M1); MedRep answers a hold or cancels a held order before Finance (R1); nothing ships unpicked (D33); stock shows On the shelf · Promised · Free and the order form and "Stock short" count earlier orders first (D1, M12); customers show owed, past due, credit used and days quiet, with sort and filter (C30, R21, T14) and a New order button (R22); the order form warns of past-due money and the credit limit (R8); the Online desk sees only its own customers (O30); search finds orders and people (T35); one late-limit table for Speed and the cards (F23, T31); DR paper named, Board "more" opens cards (D18, D21). 177 API tests.
- 15 Nov (night, 2): MedRep home "To collect" with ageing (`GET /api/my/collect`, R11); Who sold most counts selling leads and shows placed (T28); order form asks Inventory for a medicine we don't list (R9); Dispatch board titled "Warehouse: to pack and ship" with To pack / To ship / Came back / On the road tabs (D16, D17). 178 API tests.
- 15 Nov (night, 3): stuck counts time at the step (status_since), on lists, the dashboard and the CEO Home; a MedRep's sent-back order opens in its fix form; "haven't ordered in 60 days" opens those customers; the medicine page's margin takes VAT out of a VAT-inclusive price; the stock list has an Expired filter and the overview's tile opens it. Marked done what earlier batches had fixed (F17, F24, M2, R7, D15, D19). 178 API tests.
- 15 Nov (night, 4): a city belongs to one area of a channel (refused by name otherwise, T19); a courier parcel without tracking can still be marked came back (D22). 179 API tests.
- 15 Nov (night, 5): Stuck over 2 days (`/orders?stuck=1`, any desk) for the CEO's link and Management's sidebar (T30, M9); Finance and Management set a customer's terms and credit limit from its page (`POST /api/customers/:id/credit`, C31); a packed order handed over reads "Picked up by the customer" (D27); Finance's holds and delivered-today confirmed its own (F21). Whole-flow test kept passing; 183 API tests.
- 15 Nov (night, 6): cancelling a supplier order asks why and keeps it on the PO's note (D12, part); the stock list filters by warehouse (D20); Reject and Exception say what they do (M7). Whole-flow test and 183 API tests pass.
- 15 Nov (night, 7): Customers owe shows the MedReps and terms of the open invoices themselves ("Mixed" when they differ), not the customer's area MedRep or today's terms (F26, part); each order line shows what this customer paid last time when the price moved (M13, part). Whole-flow test and 183 API tests pass.
- 15 Nov (night, 8): Inventory overview has To reorder: medicines whose free stock plus what is coming falls short of the reorder level, the furthest short first, with New purchase order; it says so when nothing is short (D4, part). 183 API tests, whole flow passing.
- 15 Nov (night, 9): statement of account per customer (`GET /api/finance/statement/:id?from&to`, `/customers/:id/statement`, printable): brought forward, every invoice, payment and refund with the running balance, balance due and what is open by how late; linked from the customer's Money card; the whole-flow test checks it adds up (F26, part). 183 API tests.
- 15 Nov (night, 10), Aryan's direction: every role's Home shows its own work's data open, in the My team / Speed card look (`team/glance.tsx`): CEO — desk speed cards, orders right now, placed to delivered, who sold most, teams ahead, medicines, customers, then money and channels; team lead — his team's sellers, orders, medicines, customers and desk speed; Management, Finance, Dispatch — their own step card and who takes how long; MedRep — his orders right now. Setup (Teams & people, Areas, Requests) moved to a separate Admin panel; the CEO's sidebar keeps the figures. The way back is in the page (a small round ‹ and where you are), never in the top bar.
- 15 Nov (night, 11): CEO Home opens what its figures led to: Sales by channel (each channel against its target with head, people, customers, today) right under the figures; Customers owe us big (by how late, who owes most); Collected (by method, day by day, the latest payments). Every card has See all, opening its rows in place, and Open ↗ for its page. Payments received has the month at a glance on top. "Has left" moved off every seat row into its menu. The Admin panel link is the Admin login's only; the CEO's sidebar has none (the Admin panel will be designed apart). Channels stay fixed; their data (heads, people) will be edited in that Admin panel.
- 15 Nov (night, 12), Aryan's correction: the CEO Home's own four boxes open big and hold what their click leads to (Sales this month with its channels; Collected by method and day; Customers owe us by how late and who, cash on delivery apart; Orders right now with where they stand), no separate repeat cards, no number twice (the "To come in" side, the company tiles and the donut's middle went). Then desk speed; delivery time, what we owe, stock; who sells, teams, medicines, customers; Needs you. Customers owe is a full report (`GET /api/finance/owed/invoices`): every unpaid invoice with customer, MedRep, team, made and pay-by dates, days late, by customer / MedRep / team, cash on delivery apart. Sales by channel has no company tree: a channel opens its sellers, customers and medicines (`GET /api/channel-sales/:code`). Finance's and Dispatch's homes are their boards again.
- 15 Nov (night, 13): the Admin panel, the Admin login's own desk, apart from the CEO: Channels as Home (each channel's head, teams, team leads, MedReps, areas, vacancies at a glance), Add channel in one step (`POST /api/org/channels`: code, name, Division; its top box comes with it), each channel's structure page with the same seat dialogs as Teams & people, rename / Division / out of use (`PATCH /api/org/channels/:id`, refused while people work in it). Migration 0032 gives channels `division` and `active`; an order without a Division takes its channel's own, on the server and in the order form (`Me.channel.division`, the order-for list's `division`; the hard-coded code→Division map is no longer read), a new channel's MedReps, customers, orders and figures work like every other's; a channel out of use leaves the CEO's channels, the team menu and the company counts (its past sales still show in a period that has them). The CEO's sidebar has no setup. 186 API tests (new: `org/channels.test.ts`), whole flow passing.
- 15 Nov (night, 14), Aryan: the Patient Assistance Program stays a channel of its own, never inside Hospitals. The demo company puts it straight under the company; a box moved straight under the company becomes a business; the Admin panel never counts another channel's box as a channel's team, and flags a channel sitting inside another ("inside Hospital Division") with "Make it a channel of its own". MD Telesales (TS) still sits inside Prescription Business, waiting for Aryan's word. 187 API tests.
- 15 Nov (night, 15), the audit's open bugs: D11 a batch's cost when two purchases land in it (each received line keeps the pieces on the shelf and the cost it landed on, migration 0033; a later freight bill on either purchase works the batch out again, never wiping the other's share); D24 delivery needs the photo of the signed receipt (the API refuses without one on the order, field `proof`; the dialogs upload it first, so a failed upload is tried again and nothing is marked delivered without it); T1 one rule for whose a sale is (`creditedTo`: its seat's holder today, the newcomer on a handover day, else its MedRep) on team sales, targets, a channel's people and the KPIs, as My team counts by seat; R19 demo invoices are never dated before their orders (a completed order's story moves back with its overdue invoice; an open order's invoice is dated when Finance made it; old demo databases are put right on start); O27 the Leads desk has "Waiting on you" (unanswered messages, orders held or sent back). 189 API tests.
- 15 Nov (night, 16): HR step 1 (12.8): working hours (Mon–Sat 7:00–16:00, as HR keeps them), 2026 holidays, attendance from the first activity or Start / End my day with HR's 15-minute rules, Who's working, a person's month, the CEO's *At work today*; every desk's clock counts working hours only. The HR portal and SEFMED studied and placed (12.7). 197 API tests.
- 15 Nov (night, 17), Aryan: the SaaS look later; first the system for HR and SEFMED's work. Drafted `architecture/hr-and-field-system.md` (one person = login + employee record + seat; HR inside the CRM; joining with an invite; SEFMED's daily use → the Field app; build order; five questions).
- 15 Nov (night, 18), Aryan: "build it", then: no invite or email system, HR makes the login email and password and gives them. Built HR step 2 (12.9): the HR role and desk, the employee record, New joiner with the login HR typed, Change login, Last signed in, Mark as left keeping the record. 203 API tests.
- 15 Nov (night, 19), Aryan: HR's work out of the CEO's screens; the CEO gets the full report. HR does the work (joiners, records, putting days right, leave), the CEO reads (Attendance report, People, At work today), the Admin is HR's backup (12.10). Field app step 1: visits with check in, call report, skip and move; the visits report for team leads and the CEO (12.11).
- 15 Nov (night, 20), Aryan: the team lead runs the field (approves the month plan), the CEO reads all of it; visit expenses with the bill's photo. Field step 2 (12.12): classes A–D, the month plan made by class and approved by the team lead, the clinic pin and the away-from-clinic check, field expenses approved by the team lead; the CEO's visits report gains coverage, away, plan and spent.
- 15 Nov (night, 21), Aryan: leave filing. People ask for their own leave (10 VL + 10 SL a year for regular staff, leave without pay on probation), whom they report to decides (HR when that is the CEO), the CEO reads (12.13).
- 15 Nov (night, 22), Aryan: a calendar of who went where, for the MedRep, team lead and CEO, and live location if light. Built both (12.14). Then the remaining HR work: forms for official business, work from home and overtime (12.15).
- 15 Nov (night, 23), Aryan: payroll first (before the SEFMED import). Built HR step 5 (12.16): cut-offs and payslips computed from the DTR on 2MG's register rules and the law's dated rates, HR's own lines, release (frozen, each person told), the CEO reads the register, everyone reads their own payslips. 250 API tests.
- 15 Nov (night, 24), Aryan: payroll is one a month, the 1st to the 30th, not two cut-offs; keep it small; the rest of payment later. Payroll switched to monthly (12.16). 248 API tests.
- 15 Nov (night, 25), Aryan: order gaps first, then less clutter on Management's page. Built 12.17: Change the order, Wait for stock, checks on cards and the table, licence and papers on Management's step, ships-from with each warehouse's stock, the medicine popup, I'll handle it, folded sidebars for every desk, popups that close on a tap outside. 251 API tests.
- 16 Nov (26), Aryan: order cards like the old CRM's Leads card, Management's checks as clickable steps (card and order page); then Finance's hub pieces in the Finance section: the MedRep's reason when an advance order has no slip, Undo within 90 s of confirming (same invoice kept), Finance's hold screenshots shown to the MedRep, My confirmations (/finance/mine) with a date range. Migration 0047. 254 API tests.
- 16 Nov (27), Aryan: PAP like the old CRM's GL case. A PAP MedRep (role medrep, channel PAP) opens and works their own patient-assistance cases on the Online desk's case (`lead.desk` = pap): only theirs, Management and the CEO read them, the Online desk doesn't see them. The case keeps the old GL road: quotation (PCSO: two other vendors' totals, printed one page each after ours), 2.1 application, 2.2 letter with its expiry (an expired letter, or one for less than the quotation, holds the order), then the order goes the MedRep's way (Management → Finance → Dispatch, channel PAP), then 4.1 pick-up photo, 4.2 claim sent (day, reference), 4.3 the agency's money, recorded by Finance. The order form sends a PAP MedRep's patient to "Start a PAP case". Migration 0048; demo PAP MedRep Paula. 256 API tests.
- 16 Nov (28), Aryan: each desk's own steps on the order page (Management: RX & documents / Documents, Medicines & price, Stock & warehouse, Customer & licence, Approve; Finance: Payment proof, Finance check, Paid; Dispatch: Pack & ship, Delivered). Documents by buyer: a patient's order (or a hospital order for one patient, a new "Is this order for one patient?" option) carries the prescription and the patient's ID, which Management checks (finding kind rx), with senior/PWD ID, GL and medical certificate; a hospital its PO and its own papers; the next paper is suggested. Management edits medicines on the order (quick search & add, a line given free at ₱0 with its remark, price, quantity, take off). Approving opens one window: pick the warehouse (each says can fill every line / short on N), each medicine ordered against what is free there, Finance too or not. PAP orders are approved by the PAP head (the channel's head), not Management. Migration 0049; demo PAP head Pia. 256 API tests.
- 16 Nov (29), Aryan: "sab bigad raha hai" after the audit. Walked every role and fixed what got worse: a MedRep's card no longer shows Management's checks; the order page's side shows only a desk's own steps (no second journey for a MedRep or the CEO); the order lists have two filter rows instead of five (no duplicate step line or chips; MedRep as a dropdown); Management's card leaves out the proof of payment; Finance's cards use the whole width; Dispatch's table drops the checks; Dispatch's order page has no money box and numbers its own steps; the MedRep's Home notices are calm; a PAP order names the PAP head and Pia has "PAP orders to approve"; Management approves one by one through the warehouse window (no bulk approve); a hospital order's form lists the PO first.
- 16 Nov (30), Aryan: returns and refunds before the checks. Built returns (migration 0050): who sold it (or Management) asks on a delivered order (medicines, how many, why: expired, damaged, wrong item, not needed, other); Management approves or says why not (its own request is approved as made); Dispatch checks what came back line by line (good back on the shelf into the batch it left from, damaged written off, not received not credited); the bill is credited by what came back (the invoice's total comes down, so owed, sales, targets and points follow); money paid beyond the new bill shows in Finance's Refunds owed and is given back there. /returns for every desk (Management: Returns to approve; Dispatch: Returns to check; Finance: Returns; MedRep: Returns), and the order shows its returns and "Returned" in its money. 260 API tests.
- 16 Nov (31), Aryan: "ensure everything and all the data is right, 130 people". Added the data checked against itself (`checks/integrity.ts`, GET /api/admin/data-checks for the CEO and the Admin): 17 checks (order total = lines + fee; bill = order less returns; paid = payments; refunded = refunds; paid status; nothing paid beyond the bill; no shelf below zero; shelf = sum of its moves; every placed order has its MedRep and channel; every delivered order billed; packed goods picked; returns credit what came back and never more than delivered; points balance = entries; no reporting loops; every MedRep reports to someone; nobody reports to someone who left). On the local copy 16 of 17 were clean; two demo orders (500006, 500007) were seeded as packed/shipped without picks (a seed shortcut, not something the app allows). And a 130-person company test (`checks/scale.test.ts`: two channels of four teams, team leads, 13 MedReps each, four HR, more Management, Finance and Dispatch): a MedRep sees only their own orders and customers, a team lead their team and not the next, a channel head their channel and not the other, Management/Finance/CEO/Admin everything, only Management approves, HR every person and no order; the CEO's, channel head's, team lead's and MedRep's sales all equal the bills; the data checks come out clean. 269 API tests.
- 16 Nov (32), Aryan: before going live, photos as in the old CRM. `src/files/store.ts` keeps every photo and paper (case files, order papers and Finance's hold screenshots, field expense bills, leave papers, Messenger / email / website files) through one door: made smaller on the server with sharp (1600 px, WebP 60, also in the browser: a 1.4 MB prescription photo is kept as about 70 KB, still readable; PDFs and small photos as they are), then into a Supabase Storage bucket by its content hash (the same photo once) with only the key in the row, or into the row when no bucket is set. Files already in rows keep opening. Migration 0051 (store_key / receipt_key / file_key; data may be empty when the key is set). 274 API tests.
- 16 Nov (33), Aryan: bring Zoho's customers, hospitals and old sales with their prices now, medicines later; Management must see what a customer was given before without opening Zoho. Built 12.18: `past_order` / `past_order_item` / `zoho_contact` (migration 0054), Admin-only batch imports (`/api/admin/import/zoho-customers`, `/zoho-orders`, rerun-safe by Zoho's id, history only), one price history across this CRM's orders and Zoho's joined by SKU, shown under every order line (amber when lower than last time), in a customer box on Management's price step, and on the customer's page. Nothing imported into the live CRM yet: the data comes out of Zoho through its own Data Backup (CSV), which Aryan has to make. 290 API tests (10 new).
- 16 Nov (34), Aryan: the screen first, the data later; and keep every look with a switch, to pick the best one afterwards. The price strip under an order line shows the trend and how much lower (amber) or higher (green) the price is now; the customer box on Management's price step has orders, bought, last order, buying since and what they take most. Prices given on the customer's page has three looks (Table, Cards, Steps: the last prices side by side with which way each moved), remembered on the computer (`crm:prices-look`). Aryan to say which stays, or all three.
- 16 Nov (35), Aryan: the same switch on the order page. Above an order's lines, "What they paid before" has three looks, remembered on the computer (`crm:order-prices-look`): Strip (last price, trend, how much lower or higher), Steps (the price now, then the last prices side by side with which way each moved), Open (every earlier order shown without a click). Aryan to say which stays.
- 16 Nov (36), Aryan: Management's order page feels complicated; keep it, and beside it a simpler look with a switch on top, the useful things first, and the steps done for them where they can be. A switch on the order's first line (Steps / One page, remembered on the computer, `crm:order-look`) for whoever approves it. **One page**: right under the customer, how many things need a look ("2 things to look at: price 3% below list · overdue 46 days. The rest is fine.") with Approve, Send back and Reject, which stay in sight while the page is read; then each check as a chip and the rarer actions (hold, exception, cancel); then one part per check, where **the parts the system found fine stay folded to a line and only the ones that need a look are open** (Medicines & price with the customer's earlier prices, Stock & warehouse, Customer & licence, Documents); money and activity at the side; the order's road last. Steps stays as it was. The look switch lives in the shared kit (`ui.tsx` LookSwitch, useLook). Aryan to say which stays.
- 16 Nov (37): Zoho's backup arrived (unpacked in `.data/zoho-backup/`, never committed) and SEFMED was looked at in the browser (read only). **Zoho**: 93,929 customers (57,942 individual, 35,987 "business", most of those really people; 736 ticked Is Doctor; 752 with an LTO number; only 23,609 with a city), of whom **27,908 ever ordered**; 67,366 sales orders (62,206 invoiced, 5,042 void, 77 confirmed, 30 draft) as 130,408 line rows, 3,661 of them free, every line's SKU in the item list; invoices (143,158 rows), customer payments (64,720), 202 salespeople; 3,588 items, of which 2,302 ever sold, 260 sold in the last 12 months and **272 in stock now**. The CSVs carry what the import needs: Contact ID, sub type, Is Doctor, LTO number / type / expiry, TIN, credit limit, payment terms, billing city; per order line Item Price, Item Total, Item Tax %, Is Inclusive Tax, Entity Discount Percent, Sales Person, CF.Division, CF.Source, CF.Invoicing From. **SEFMED** (cuztomiseapp.com/safmed) is the field side, not sales: 63 field employees, 5,731 doctors (code, hospital, MedRep, speciality, division, class, zone), 2,176 hospitals (category, class, contact person, city, MedRep, beds), 315 firms (type, customer code, drug licence, MedRep), visits, expenses; each list has its own Export. The two overlap only in who the hospitals, doctors and firms are, and are written differently (of ten SEFMED hospitals tried, two were found in Zoho; SEFMED itself lists one hospital three ways). Aryan: "medicines" means what we have in stock; his own list comes later.
- 16 Nov (38), Aryan: Zoho's data is the main one; SEFMED is only read for the plan (who is under whom, how a visit goes), not imported. `scripts/import-zoho.ts` reads the unpacked backup (its own CSV reader) and brings **the customers who ever ordered and all their orders** (`--all` for every Zoho customer), dry run unless `--apply`, counting only when no database is given, `--memory` to try the whole of it in a throwaway database. What the real data taught: 28,060 of Zoho's "businesses" are people (no company name, no licence), so a business is read from its licence type first (hospital / drugstore / wholesaler, importer, distributor), then its name, then what its orders say (Source, else the salesperson's channel), and with none of those it is a patient or doctor; payment terms come from how they paid on their last order (Zoho's own "60 days" on 13,563 contacts is a default, not a term); the city and address fall back to the last order's; lines of packing material, giveaways and services (599) are left out of the history; no area is given. Tried in memory and then **applied to the local demo copy only** (`.data/pg`, the copy before it kept as `.data/pg.before-zoho-2026-11-16`): 25,452 customers made (22,916 patients, 1,004 doctors, 930 distributors, 291 hospitals, 267 drugstores, 44 government), 303 twins joined, 64,380 orders with 123,036 lines (3,497 free), in 5 seconds. Tondo Medical Center shows 94 orders and 27 medicines with their prices. Prices are VAT in (a line typed before tax is shown with its 12%). Nothing is in the live CRM yet. 290 API tests.
- 16 Nov (39), Aryan: all of Zoho's customers, not only those who ordered; a customer is known by the phone number; whose customer it is (MedRep, team, division) must come too; the medicines from Finance's price list now, with the inventory, prices and batches live in the warehouses, cold chain marked. Built (migration 0055, `zoho/medicines.ts`, `scripts/import-medicines.ts`, `scripts/import-zoho.ts`, 295 API tests) and **applied to the local demo copy only**:
  - **Customers**: 93,929 Zoho contacts → 91,576 customers (82,400 patients, 3,831 drugstores, 3,636 distributors, 1,075 doctors, 589 hospitals, 45 government); 2,353 twins joined. 86,797 have a phone number. **The same number and kind is one customer** (the CRM's own rule); a number three or more different names share (415 contacts: 0000000000, an office line) or a placeholder says nothing about who they are.
  - **Whose customer**: Zoho names the salesperson on each order, not on the customer. Each Zoho contact keeps the salesperson of its latest order, its day, and that order's Division, Sub-division and Headquarter (`zoho_contact`); 8,452 customers have one (all but one of the 5,889 who ordered since 2025). `zoho_seller` is where the Admin ties each Zoho salesperson to a seat (screen not built yet). The 2026 chart and each seat's Zoho name are in [ORG-CHART-2026.md](ORG-CHART-2026.md): the Hospital Division's 24 seats match Zoho's names one to one.
  - **Money**: Zoho's invoices (69,219) and payments (64,714 rows) as history (`past_invoice`, `past_payment`); ₱111.6M still owed on 1,971 invoices. Shown on the customer's page (who sold to them in Zoho, what Zoho says they owe). Not yet counted in an order's "customer owes" finding or Finance's owed report: Zoho is still where these are paid until the switch, and a rerun with a newer backup brings the balances up to date.
  - **Medicines**: Finance's price list (sheet Pricelist02.2026) has **107 medicines**, each tied to its Zoho item (26 by hand where a name alone did not settle it, e.g. SuperFlora's two rows, DoseGet with solvent and RTU): SKU, the other SKUs it went by (`medicine_sku`: 25, so old orders under an old SKU find it), prices for doctor, patient, distributor, drugstore and hospital (the list's one Drugstore/Hospital column), SRP, pack prices, VAT or exempt, shelf life, who sells it (2MG / GETMEDS), **cold chain** (7). One has no price yet (MidaGet).
  - **The shelf**: Zoho's batches as of 16 Nov, fetched from Zoho per item: 370 batch lines, 2,889,700 pieces, in 10 warehouses (Getmeds Philippines Inc. 2.71M, Consignment 115k, Cebu 45k, Davao 15k, the home stocks, Expired stocks), each batch with its expiry and what a piece cost. Put on the shelf once; from then on the shelf is this CRM's.
  - Old prices now join the list: Tondo Medical Center's 23 medicines, 20 of them medicines in the list with today's prices beside what they paid.
  - Open: the cold-chain charge (how much, per order or per medicine); building the chart's teams and seats here and tying Zoho's salespeople to them; Zoho's owed money in the order's checks; SEFMED read for the field side.
- 16 Nov (40), Aryan: the whole company as a system: every seat of the 2026 chart, each role's work, reports, scorecard and screen. Built docs/company-map.html (published as an artifact) from the five playbooks, SEFMED, Zoho CRM, Zoho's numbers, the price workbook, the old systems and web research (notes in .data/research/). Key findings: NBD/CRR thresholds from data (usual reorder gap 28 days; late at 1.5x, at risk at 2.5x or 90 days, lost at 180; hand-over to CRR at the 3rd order or day 90); DSO by channel (PAP 254 days, CLIDP 153, bidding 115, hospital 96, B2B 67, Rx 58); the price ladder (SRP anchor, patient SRP -20% for oncology, distributor floor ~0.47 SRP); legal points the CRM must enforce (senior/PWD price / 1.12 x 0.8, pharmacist release, LTO/CPR, 72-hour breach, 15-day adverse events, RA 12009 tenders). Flagged for a lawyer before building: the Rx playbook's doctor rebates (prescription-linked rebates are barred by DOH AO 2015-0053 / PHAP Code) and reps inside patient groups.
- 16 Nov (41), Phase 1 (section 15) built locally: the chart's selling side as units and empty seats (org/chart-2026.ts, importChart, Admin → Zoho salespeople → "Set them up"), each selling seat with its own area; Zoho's salespeople tied to seats with their customers moved under the seat's area (suggested for the Hospital names; re-tie moves them, hand-placed customers stay); a new area claims only its channel's kinds of customer; targets on seats (migration 0056 seat_target, copied from today's holders): setting a person's target sets their seat's, an empty seat's target is set on the Targets page and counts in the company target, and whoever takes the seat carries it. 299 API tests. Left for Aryan: which RX Zoho names are which seats, who takes the customers of people who left; live needs .env.live.
- 16 Nov (42), Phase 2 (section 15), first part, built locally. Aryan: Zoho is not integrated; its seller names are read once, from the old orders, to put old customers under seats (the Admin page is now "Old customers to seats"). The scorecard engine (src/scores/): the Hospital CHC (IST 50, DSO 20, HRR 15, NZSD 15) and B2C CHC (IST 45, CRR 15, NBD 15, NZSD 15, OCR 10) cards with the playbooks' bands; IST at 0 points caps the total at 40; a KPI with nothing to measure is left out of the maximum. Figures from invoices (issued, not cancelled), payments, orders and enquiries; NZSD is working days with an invoice over working days (Monday to Saturday, less holidays); DSO is credit owed over the last 90 days' credit sales; the running month's IST is on the working-day pace. Months are locked on the 1st (migration 0057 score_month, run at start and every 15 minutes; a month with no target, sale, order or enquiry is not locked); nobody edits a locked card, the Admin can lock a month again after a figure is put right at its source. The 12-month average of locked cards gives the increment band (0/3/6/10/20/35%); below 60 two locked months running flags the improvement plan. A locked figure can be questioned; the lead answers (score_dispute). Screens: My score (MedRep, online desk) and Scorecards (leads' My team, Reports, CEO, Admin). 305 API tests. Next in Phase 2: Rx, MD Telesales, DSC, Mentor and Training cards (weights where playbooks disagree, telesales KPIs and CTAR/TTAR from Aryan), and the Home scorecard to read this engine instead of the old card.
- 16 Nov (43), Phase 2, second part. The Rx CHC card (Rx CHC Play Book p. 32-33): NBD 30 (doctors invoiced for the first time, by count: 1-2 → 12 … 9+ → 30), CRR 30 (last month's doctors invoiced again: 50% → 12 … 90% → 30), PAP 25 (guarantee letters received on the person's PAP cases: 1-2 → 10 … 11+ → 25), HIT 15 (left out until the formulary tracker, Phase 5), CCF gate (doctors visited ÷ the 80 on the list; below 80% the total is capped at 70; the lowest cap governs). The Home's scorecard now reads the engine (the old weekday-delivery NZSD is gone) and links to My score. Not built, waiting for Aryan: the Rx Team & Training Playbook moves NBD and CRR to MD Telesales with no new weights; the MD Telesales KPI framework, the DSC and Mentor cards and CTAR/TTAR are not published in any playbook; the Training Coach card (SEI, CAP, TCA, VAC, GOV) needs the training calendar and exams (Phase 7). 307 API tests.
- 16 Nov (44), Aryan: "every person in the company has their own screen with the data relevant to them, and their head gets the relevant data"; he does not have the missing scorecard definitions, so interim rules (to change when HR publishes the cards): MD Telesales (seats in the TS channel) are scored on the B2C card; a lead (DSC, Mentor, head, any lead seat) on their team's average (the month's score of each scored person under them, leads not counted twice), locked after their people. A month with nothing to score (no target, sale, order, enquiry; for a lead, no one carded) has no card, running or locked. A lead's "needs you now" on My team adds the scorecards: below 60 with a week of the month gone, a coverage gate failing from the 15th, an improvement plan due (below 60 two locked months running). Leads have My score in their My team folder.
- 16 Nov (45), Customers to call (/to-call; the CRR account health and the refill-due list of the company map): each customer's usual gap is the median of their last six gaps between orders, this CRM's and the old system's together (28 days with one order, at least 7); due once it has passed, late past 1.5 times, at risk past 2.5 times or 90 days and late, lost past 180 days (last two years only). A seller sees their own customers (the online desk its patients, everyone else the buying businesses and doctors), biggest last order first, with the phone to call; a lead, the CEO and the Admin also see per area whose customers are slipping, and open one area. Links: MedRep and online desks, leads' My team, Reports. Most old customers still have no area, so they show under "No area" until the old sellers are placed on seats.
- 16 Nov (46), Aryan: "Customers to call" opened under the Management desk with Management's menu: build screens one channel at a time, every seat of it, and tick them in the plan (new section 16 with the method, the order of channels and the Hospital checklist). Fixed at once: the list says whose customers it is (my area, my team, the company) and is the sellers' and their heads' only; a refusal shows at once as "Not part of your desk" with a way home (no retries); the logo no longer runs under the desk name.
- 16 Nov (47), Section 16.1, the Hospital CHC seat done: the desk says "Hospital CHC" (seat-words.ts: a seat's own words by channel), its own menu in the order of its day (Home, My hospitals, My orders, Collections, Hospitals to call, Visits, Tonight's huddle, My score); Home starts with Today's pulse (sales vs target on the working-day pace, days to collect, hospitals not reordered, an invoice on the last working day; each green/amber/red and a link), then Go here first (owed 60 days and more, then hospitals due or late to reorder; Call, Collect, New order), and a huddle card; the old figures row and the second target card (which disagreed with the pace) are gone from this Home. New: Collections (/collections: each customer's owed money, oldest unpaid invoice and its age, flagged 60/75/90), the 7 PM huddle (migration 0058 huddle; /huddle: prefilled from the day's invoices, payments and visits, a blocker required when there was no invoice, tomorrow's first stop, declared to the named coach; a lead sees the team's evening: who declared, who is red, three working days without an invoice). 312 API tests.
- 16 Nov (48), Section 16.1, the District Sales Coach seat done: its own desk and menu; Home with Needs you today, District now (/api/team/district), tonight's huddle and the 15th rescue; Team huddle (who declared, who is red, three working days without an invoice); Collections and Hospitals to call show the team's, with each line's seller.
- 16 Nov (49), Section 16.1, the Business Mentor seat done (desk, menu, Home with the division team by team, people at risk, money by age, score questions). Tested up the line: a CHC's huddle reaches their coach and the head, each CHC row carries its coach.
- 16 Nov (50), Section 16.1 Hospital Division done and checked up the line (CHC → DSC → Mentor → Reports for the CEO and Admin). Next: 16.2 Prescription (Rx).
- 16 Nov (51), Section 16.2 Rx CHC done: desk "Rx CHC", its own menu (no New order: "Log a call"); My 80 doctors (migration 0059 doctor_list, the seat's list in tiers 20/40/20 with visits 4/2/1 a month; moving or taking a doctor off keeps the history; a full tier refuses); Home with the tiers, PAP applications and today's route of eight (red: refill due within 48 hours by the doctor's usual gap; yellow: bought last month, not this; then Tier 1 behind on visits); no sales target on this Home; Doctors to call lists doctors. Found while clicking through: the web's api() already turns the body into JSON, and five screens sent it turned twice (huddle Declare, score questions and answers, Old customers to seats, the doctor tiers): fixed, and the huddle declared in the browser.
- 16 Nov (52), Aryan: "why 80 doctors? doctors can be more or fewer; think it through". The doctor list has no fixed size and no tier limits (the playbook's 80 and 20/40/20 are a guide only); the coverage gate counts the doctors on the CHC's own list (no list: not measured). The Rx CHC's menu loses "Doctors to call" (today's route already has the refills due). Taking a doctor off the list is its own "Remove" button (clicking the tier again no longer removes). The 7 PM huddle is the Hospital CHCs' only (an Rx CHC opening it is told so).
- 16 Nov (53), Section 16.2 Prescription done, bottom to top. New: Patient Care Groups (migration 0060 care_group; the Rx CHC enrols a doctor's group with the patients' consent, one open group a doctor; MD Telesales see the groups waiting with the 15-minute clock, the first to press Contacted takes the group; the CHC or the group's telesales logs activity; quiet 14 days goes back to the CHC; closed with a reason, never deleted; the Sales Coach, the Country Mentor, the CEO and the Admin see every group and the share answered within 15 minutes). Customers to call gains "In 2 days" (a refill falling in the next two days) and what each customer took last time; MD Telesales' list is their patients and doctors and opens on the refills coming due. MD Telesales' pulse: sales vs target, refills due, groups waiting, the last working day's invoice. The Country Mentor's field team (/rx/field). Demo people for the channel (rx/seed.ts): Rosa (Country Mentor), Lara (Sales Coach), Kim (MD Telesales) with patients whose refills come due and two of Joy's groups. The desk name in the top bar no longer gets cut ("MD T…"). 317 API tests.
- 16 Nov (54), Checked up the line for 16.2: a care group belongs to the business of the CHC who enrolled it, so the Hospital Division's anesthesia telesales (also TS) never see the oncology groups; the Sales Coach and the Country Mentor see their business's groups, the CEO and the Admin all. Reports (CEO, Admin) gain Care groups and Rx field team.
- 16 Nov (55), Section 16.3 Online B2C done. Read again from the zoomed chart first (B2C Sales Coaching under MD Telesales Oncology inside Onco-Hema; the Sales Admin under the Country Mentor). The B2C CHC's Home (/ for the Online desk, instead of jumping to the leads): the playbook's 8:00 pulse (enquiries waiting, new prospects not answered, the refill-due list, the last working day's invoice, cancellations without a reason, replies past 15 minutes today, each green or red with the playbook's action), waiting for a reply oldest first with the clock and Reply, refills due by each patient's own rhythm, orders by where they stand with the day-3 check-ins due (a check-in is kept on the order). A late reply: a turn's first inbound message in working hours answered after 15 minutes (or still waiting). A B2C CHC's refill list is their own patients (added, ordered for, or their enquiry), as the playbook's ownership rule says. The coach's and the Country Mentor's Homes show the B2C desk now (/api/b2c/team). Demo: the B2C Sales Coaching team under MD Telesales with Mae, an inactive demo Messenger page, three enquiries and two patients. 319 API tests.
- 16 Nov (56), Section 16.4 B2B Telesales done, read first from the zoomed chart. New: migration 0061 (the business permit beside the FDA licence and the BIR TIN; b2b_account: the NBD who brought an account in, the CRR it is handed to, the next call, dropped; account_call: each call's outcome and next call). NBD (seat "NBD"): calls today, papers missing, first orders this month and conversion, ready to hand to CRR (3rd order or day 90) and flagged (no 2nd order by day 45); Prospects (working / handed over), Add a prospect (a drugstore, distributor or clinic; duplicates refused), Call (outcome, note, next call), Papers. CRR (seat "CRR"): retention this month, buying more / steady / less; late (call today), due this week, buying less than their 3-month average (still on time), stopped 90 days (win back); Accounts with tabs. An NBD hands an account over once ready; the coach any time, to a CRR. The B2B Sales Coach and the Sales & Marketing Mentor: new business per NBD, accounts per CRR, hand-overs waiting (the Mentor also people at risk, money, score questions). Reports: B2B team. The NBD or CRR sees the accounts they work. Demo (b2b/seed.ts): Sam, Jess, Fritz, Flor with prospects and accounts. 322 API tests.
- 17 Nov (57), Aryan: "you pulled the Hospital Division's Government Account into Subir Dey's bidding; how do I know there is nothing else". Audit of everything built in 16.1–16.4 against the chart (section 16.0): seats are now told apart by their business box as well as their channel (migration 0062 seat_business_channel; Me.business, read in the one sign-in query); MD Telesales Anesthesia get the Hospital Division's own telesales desk (not the Prescription telesales' care groups and refills); District now and the team huddle count only the Hospital Division's sellers to hospitals / CHCs; the Government Account's bidding coachee gets no CHC card or huddle and his desk says "Government Account"; care groups' heads are the Prescription Business's only; MD Telesales Oncology moved inside Onco-Hema in the chart code. Demo: Ana (anesthesia telesales) and Rey (Government Account) in the Hospital Division. 323 API tests, the one-query sign-in kept.
- 17 Nov (58), Aryan: build the company chart in the Admin panel as each business is done, so he can match it with his chart and write the functions; re-check the Hospital Division and the Prescription Business; then Subir Dey's three lines one by one. Admin panel → Company chart (as built): every box from the Founder down, who heads it, the people in each seat, their work, their desk in the CRM, built / partly / not yet, and when each box was checked against the chart. Re-check found and fixed: NCR 2's fourth seat (Jomari Esguerra, Customer Happiness Coachee without a territory) was missing from the chart code; the Prescription head's title is "PX Country Mentor". The Prescription Business's seats matched seat by seat. 16.5 CLIDP built (migration 0063 clidp_listing: a distributor's own brand of our medicine, its certificate and validity; renewals are new lines): the CLIDP Sales Coach's desk and Home (volume on pace, money owed biggest first, accounts due / late / stopped with Order, listings ending), Listings page, the Mentor's CLIDP card, Reports: CLIDP. Demo: the CLIDP line with Annie and three distributors.
- 17 Nov (59), Section 16.6 Government Bidding done (Subir Dey's three lines now all built: CLIDP, Government Bidding, B2B Telesales). Migrations 0064 (tender, tender_line, tender_event, company_paper) and 0065 (a bid line changed while preparing is kept, marked replaced). The tender's steps with what each needs: the Admin alone approves the bid price, never above the ABC; a tender is submitted only with every envelope paper ticked; lost needs the winning bid or the reason; dropped needs the reason; every move kept. The bidding desk's Home (Admin and coachees): deadlines this week, prices to approve (Admin), awaiting award, awards to deliver / waiting for acceptance (IAR) / to bill / to collect (days since acceptance), won this month and win rate, company papers ending. Tenders (bidding / awarded / closed), a tender's page (details, envelope checklist, bid lines, step buttons, history), Documents (company papers with expiry). The Mentor's Government Bidding card; Reports: Tenders. Demo: Jimmy, Hazel, Arron, two agencies, five tenders at different steps, four company papers. The bidding CHC's chart title. Admin chart: Subir Dey's part filled. 328 API tests.
- 17 Nov (60), Section 16.7 Modern Trade, read from the chart box alone: one person, Ms. Malou Jagonoy, Chief Operating Officer (docs/ORG-CHART-2026.md said Mohan Jagessy: corrected). Migration 0066 mt_listing (which of our medicines a chain carries and in how many branches; changes are new lines). Her desk "Modern Trade · COO": Home with the chains against their own reorder gap (Order), money owed by chain, the listings; Listings page; her seat has the chains' area so Zoho's "MT | 1" customers can be placed under it. Not built and said on the page: the chains' deductions and near-expiry returns (they need Finance's short-payment record). Admin chart filled. Demo: Malou, two chains. 329 API tests.
- 17 Nov (61), 16.1's waiting item done: the Government Account's bidding coachee (Rey in the demo) has Tenders and Documents on his desk and the bidding desk on his Home (his own tenders only); the Hospital Division's Business Mentor sees the tenders run from her division (Government tenders in her menu, a Government Account card on her Home).
- 17 Nov (62), 16.8: Digital Marketing and IT get the work "Office staff" and a work log (what I did, today, tomorrow; optional, one entry a day, changed during the day). Their Home is the log; the Founder and the Admin read everyone's under Reports → Work logs, a head the people under them, nobody else. The chart's two boxes are added as departments under the Founder (no head drawn); demo: Kriscel, Arnel, Jade, Linus. The Admin panel's company chart has both boxes.
- 17 Nov (63), 16.9 In-licensing & Regulatory built (the pipeline, the FDA registrations with renewal flags from 180/90 days, the CPRs on the bidding desk's Documents, heads read their people's work logs). Aryan, 17 Nov: the main work now is moving the whole of Zoho Inventory into this CRM, every section and every row of data, looking like Zoho on the outside with the data shown better inside (section 17).
- 17 Nov (64), section 17: the books. Zoho's Purchases (1,716 vendors, 4,208 purchase orders, 4,704 receives, 8,878 bills, 7,420 payments made, 46 vendor credits) and its Sales Returns and Credit Notes in, every field kept, linked to each other; Zoho's own screens for them under /books, checked side by side with Zoho.
- 17 Nov (65), section 17: Purchases are made in the books now, as in Zoho: purchase orders, receives into stock by batch and expiry, bills, payments made, vendor credits, void and cancel; payables and credits match Zoho to the centavo. The Inventory menu's Purchases opens them.
- 17 Nov (66), section 17: Sales in the books — Zoho's sales orders, invoices, payments received, returns and credit notes in whole beside the CRM's own; customers by kind with every Zoho field; payments taken on Zoho's open invoices; customers' and vendors' money matches Zoho to the centavo.
- 17 Nov (67), section 17: Items and Inventory in the books — every Zoho item with its fields and Zoho's stock figures, the CRM's stock for its medicines, Zoho's adjustments, packages (as Zoho's board), shipments and transfer orders, linked to their orders, beside the CRM's own; price lists.
- 17 Nov (68), Aryan: less clutter. The orders link in every seller's and lead's menu is one link to all their orders (sent-back count on it); the stages and Returns are tabs on the page. The order line walked in the browser (Ryan placed, Sarla approved, Fiona invoiced, Marco packed, shipped, delivered): a delivered order now says "Delivered" (complete only once paid); Approve shows only the warehouses that can fill the order (the short ones behind "more"); Dispatch's order page drops the earlier prices; the CEO's "We owe" counts the suppliers' unpaid bills (PHP 331M, as Zoho). Zoho's salespeople wait to be tied until the real people's seats are in (the demo has 16 seats).
- 17 Nov (69), Aryan: an order placed in every channel and taken to the end (HOSP, RX, TS, B2B, BID, PAP, MT, Online: approve, invoice or payment, pack, ship, deliver; two credit orders paid). Fixed: the medicine search finds "letrozole 2.5" (the strength is kept apart from the name); a PAP patient's button says "Start a PAP case" (a guarantee-letter patient never was a plain order); a delivered order reads Completed only once paid. Rule from Aryan: less clutter never removes anything useful. The leads' and heads' long menus now sit under three headings (the day's work, Team, Look up), every link kept, the phone's tab bar as it was.
- 17 Nov (70), Aryan: onboard the chart's people with one common password. `scripts/onboard-company.ts` puts every person of HR's 2026 chart (docs/company-map.units.js) into the CRM: 9 boxes added (NCR 2, North & Central Luzon, South Luzon, Visayas, Onco-Hema Division, Executive and Admin, Supply Chain, Pharmacy Operations, Finance Department), 117 people in their seats with the seat's login ID, 2 vacant seats, the demo company's people left (local database; backup in .data/pg.before-onboard-2026-11-17). Zoho's salespeople tied to the seats that are the same person (2,963 customers now under them); 102 Zoho names wait for the heads (Rx districts, Blood & Bone, MD Telesales regions, people who left): docs/PEOPLE-2026.md. The password is the server's JOIN_PASSWORD (never in code), the same for everyone, never forced to change; HR's New joiner and Admin's Add person ask only the login and the employee ID. No employee IDs exist yet (not on the chart, not in the old CRM). SEFMED was not imported (Aryan, 16 Nov: read for the plan only). Phase 1 of section 15 done locally, monthly targets per seat still to type.
- 17 Nov (71), Aryan: one stock before going live. `scripts/go-live-stock.ts` makes Getmeds Philippines Inc. the default warehouse (Approve picks it first) and, with --demo-out, takes the demo people's stock off the shelves by stock counts with their reason (19,710 pieces from the demo "Main warehouse", now closed; 2,060 from Cebu, whose 47,815 pieces from Zoho stay). Local database; backup in .data/pg.before-stock-2026-11-17. Data checks: shelves equal their moves, none below zero; the one failing check (two demo orders packed without picks) was there before. Section 17 says how the stock and the books run as one.
- 17 Nov (72), Aryan: the demo company's leftovers closed in the local database, nothing deleted (`scripts/close-demo.ts`; backup in .data/pg.before-demo-close-2026-11-17). The demo people's 29 orders cancelled with their 16 invoices (the 8 payments recorded on them taken off first, so Finance owes no refund for money that never came; the 18 not yet gone through the desk's own Cancel); their 38 customers archived (none was a Zoho customer); the 2 medicines Zoho never had (Imatinib 400 mg, Capecitabine 500 mg, no stock) archived; 11 enquiries closed as lost, 5 tenders dropped, 2 purchase orders cancelled, 4 pipeline products dropped, 5 registrations withdrawn, 2 care groups closed, 7 B2B accounts dropped, 2 stock notices closed, 1 promo ended, 4 targets cleared from seats the real people hold now. Kept for Bidding to replace: 4 company papers the demo added (PhilGEPS, Mayor's permit, BIR clearance, FDA LTO). Every desk's queue is empty now for the real people; the 17 data checks pass.
- 17 Nov (73), Aryan: Zoho Books' backup moved in (section 17): the chart of accounts, expenses, manual journals, transfers, deposits, refunds, recurring bills and expenses, fixed assets and the activity log; the documents already here got Books' columns; Banking and the Chart of Accounts read each account's balance from the documents' debits and credits (migrations 0077–0081). Checked against Zoho Books' Banking: 35 of 44 accounts to the centavo, the rest only by what Zoho got after its backup. The demo people's four Books test documents (a purchase order, its receive, a bill and a payment) voided by `scripts/close-demo.ts`. Local database; backup in .data/pg.before-books-2026-11-17.
- 17 Nov (74), Aryan: the books tied to Zoho's Balance Sheet (section 17): a payment's withheld tax (Advance Tax, Withholding Tax Payable), Zoho's opening balances as a journal, balances as of a day (`?asOf=`); 27 of 36 balance-sheet accounts and 35 of 44 banks to the centavo; what is still apart and why is in section 17 (migration 0082).
- 17 Nov (75), Aryan: people are added, moved and taken off on a chart before the company tests the CRM. Admin panel → Teams & people opens on a Chart: every seat a box under the seat it reports to (the CEO on top, branches folded until opened, a search that opens the way to whoever it finds, zoom). Each box: + adds someone under that person (their boss already picked, their work guessed from the boss's other people), ✎ changes the job, the team (moving across), the boss (moving up or down) and the area, ⋯ shows their login, their screens, a cover, or "no longer with us"; an empty seat says Fill. Adding a person takes their employee ID (refused if someone else has it). The Teams list, Areas and Asks for people stay as tabs. Code pushed to GitHub main (Vercel and Render redeploy); Zoho's data stays local until Aryan says.
- 17 Nov (76), Aryan: the company on the live CRM for testing, no Zoho data. `onboard-company.ts --live --no-zoho --apply`: the fresh CRM's boxes taken over as the chart's (Hospitals → Hospital Division, Doctors → Prescription Business, Telesales → MD Telesales, Government tenders → Government Bidding, Distributors and drugstores → B2B Telesales), every box with its channel, a CEO's seat at the top; 117 people and 2 vacant seats, the early accounts Mary Jane and Saroj taken as Mary Jane Viñas and Saroj Kumar (their seats moved to their chart places, their logins kept), Aryan & Saurav and Veronica left as they were. Checked on live: 120 of 121 sign in with the common password (Aryan & Saurav keep their own), JOIN_PASSWORD is set on Render, and every person's role, channel, business and boss is the local one's. Login IDs are numbered afresh on live: docs/LOGINS-LIVE.md (`scripts/list-logins.ts --live`).
- 17 Nov (77), Aryan ("check the chart, you often get things wrong"): the CRM's tree read box by box against HR's 2026 chart PDF. Three places differed and are put right on live and locally (`scripts/fix-chart-17nov.ts`): the Patient Assistance Program sits in the Hospital Division (Fhaye Norella now reports to Vanessa Escalderon, not the CEO); MD Telesales Oncology sits inside the Onco-Hema Division, beside its two lines Uro & Onco Care (9 Rx CHCs) and Blood & Bone Care (2), which were missing; Claire Gallana sits beside Jessa Domino under B2B Telesales (reports to Subir Dey). Nobody's work, channel or desk changed, only those bosses and boxes. Everything else (Hospital's six regions, Government Account, MD Telesales Anesthesia, Sales & Marketing, Modern Trade, Executive and Admin, Digital Marketing, IT, In-licensing & Regulatory, HR, Supply Chain, Pharmacy, Finance) matches the PDF name by name. The chart file and onboarding now put a box found elsewhere where the chart has it.
- 17 Nov (78), Aryan (plan 18, step 1 "safe line", and his answers: SC/PWD on any order with the ID, 20% off and no VAT; Management approves, an exception goes to the Team Lead, Management's own to the Business Mentor, all by a CRM button): a MedRep can't skip Management or Finance through the API; every version of an order is kept and the MedRep sees Management's change before → after with its reason ("Changed by Mgmt" on his list); the MedRep's note and any price above the list are on Management's card; SC/PWD on any order, from the patient price (VAT out, 20% off), priced by the API, VAT-exempt on the invoice with the ID number printed; VAT and "Prescription" shown on every line of the MedRep's form and Management's order; Management's customer check shows first order or not, orders here and in Zoho, what they owe now (Zoho's too) and a link to the whole history; Finance's checks, Customers owe, the customer list and history count Zoho's unpaid invoices and opening balances (`src/finance/dues.ts`). Tests: `src/orders/safe-line.test.ts`. The ask-up step for exceptions waits for Aryan (question 9).
- 17 Nov (79), Aryan ("crmnew is too complicated; make it simple like the hub, see every screen in each login"): the hub was run locally and walked role by role, button by button, with its Zoho link read from the code (docs/HUB-WALKTHROUGH.md, docs/HUB-CHECKLIST.md); section 19 is the plan: the hub's line and look, crmnew's prices, dues, versions and line returns kept, the hub's gaps fixed (unflagged prices, silent changes, lost discounts, dead Undo, advance orders without proof, whole-order refunds, silent Team Leads, approval alerts to every manager), Zoho's manual steps inside crmnew; questions 12–16 wait for Aryan.
- 17 Nov (80), Aryan's answers to 19: start with the order page and Management; prescriptions checked by Management on approving (the hub has no Pharmacy login of its own); the proof of payment is an attachment on the order and Finance checks it there; the invoice is made when Management approves.
- 17 Nov (81), Aryan: a prescription is required whenever a patient buys; Management approves every order of every channel; the hub's look (text, sizes, colours, background); crmnew itself is reshaped to the plan (no new project), the hub and Zoho brought together, nothing extra.
- 17 Nov (82), plan 19 step A begun: the hub's look in crmnew (Poppins, the GetMeds blue for what you press, the pharmacy green for what is fine, the pale blue-grey ground; the old green accents follow the blue); every order of every channel now waits for Management (Online and PAP case orders too; only Management's own goes on); the order page in the hub's shape (Order ID, customer, MedRep, status and total; delivery address, invoice, order details; this person's step under it — Management's approval with Approve / Send back / Reject; then the tabs Timeline · Items · Payment · Dispatch · Documents); **the invoice is made when Management approves** (Finance's step is now "Check what they owe and send it on", status "Finance Check"; details changed before Finance's check update the unpaid invoice's terms, due day and company); **a patient's order is approved only with its prescription**; Management's cards Approve / Send back / Reject. Sold figures count from the invoice, so from approval. All 354 tests green; walked as MedRep (via API), Management and Finance on a copy of the local database (put back after).
- 17 Nov (83), plan 19 step A finished (Management's tools from the hub): **Take off hold** asks Management "Why can it go on?" and **Continue from** — where it stopped, or back to an earlier desk (Finance's check, or Management's approval to change it and approve afresh); never further than it was, and once money is on its invoice or it was packed it goes on only from where it stopped; Finance and Dispatch still lift their own holds with one press; the MedRep and the desk it goes to are told. **Restore**: Management brings a cancelled order back to its approval with a reason (not when money was given back, points were used, or it is an Online case's); the cancel stays on the timeline. **An order keeps one invoice**: approved again after a take-back, a move back to approval or a restore, its cancelled invoice is made good again with the same number and the order's lines as they stand (fixes a bug from (82): approving again after taking an approval back failed); a restored order's money is off Finance's "Refunds owed" until then. **Waiting for stock** shows since when and who held it, and "Stock is back… take it off hold" once the shelf covers it (crmnew watches the shelf and tells the holder and the MedRep). **Edit medicines** now shows **Confirm changes** (each line old → new, total old → new, "the MedRep is told") before saving. Management's board gets a **Cancelled** tab (the hub's Exception Hub lists cancelled with held). Management's hold no longer offers Finance's screenshots. 355 tests green; walked as Kate (Management): approve → hold → back to approval → approve (same invoice) → cancel → restore → edit 100 → 120 at ₱8 with Confirm changes → approve (invoice ₱960) and wait for stock → Dispatch receives → "Stock is back", with Ryan's notices checked; on a copy of the local database (put back after).
- 17 Nov (84), step A checked again (Aryan: check it all before going on), by an independent review
  of the two commits and a walk of the whole line in each login (MedRep places, Management approves,
  Finance checks, Dispatch packs / ships / delivers with the signed receipt, Finance records the
  money, a return of 50 credited ₱425 with VAT worked again and refunded, a paid order cancelled →
  Refunds owed → restored → approved again with the same invoice, paid). Fixed: **an advance-pay
  invoice is not owed or late until Finance checks the money** (it no longer shows on Collect, and
  recording a payment on it is refused: the money is taken in once, with the payment check);
  **Confirm payment asks only what the invoice still lacks** (an order brought back already paid is
  confirmed with ₱0); **Finance and Management weigh an order against what the customer owed
  before it** (its own invoice no longer counted twice into "over credit limit"), and the order
  page shows the money checks until the order is past Finance; any invoice paid beyond its bill is
  listed in Refunds owed; the refunds badge counts only cancelled orders' money; **Management's own
  order for a patient waits for its prescription**, and Management's own order gets its invoice as
  it goes on; Online cases always ask for the prescription and their cards show it missing;
  Restore skips Online and PAP case orders; points paid on an invoice don't block taking an approval
  back; Admin's Take off hold asks why on every board; a customer's page counts their Zoho orders
  in its tiles. Checked and fine: prices come from the 2026 price list (cost hidden from MedRep and
  Dispatch, the same prices for every other role), the history of a hospital from Zoho (orders,
  prices given, dues). Questions 17–23 written for Aryan. 359 tests green.
- 17 Nov (85), plan 19 step B, part 1 (Aryan: start B): **the order form in the hub's five parts**,
  each a white card with its icon — 1 General (order date, MedRep, Division, Sub-division),
  2 Customer details (customer, delivery address, receiver, payment terms, **Source** from the
  hub's list of 13, invoicing from, PO, date needed, doctor, **Customer remarks**), 3 Medicines
  (price by the buyer's kind, VAT and Rx shown, SC/PWD, Dispatch's stock notes on each line),
  4 Documents (a patient's **prescription marked Needed**; **no proof of payment → say why** on
  every order the field places, a credit or COD customer starting as "Customer is on payment
  terms"), 5 Review and place (**"Missing: …"** keeps Place order off: customer, Division, address,
  Source, remarks, date, a medicine, a different price's reason, the patient's name, the SC/PWD ID,
  the prescription, the proof or why; then the hub's **Confirm window** with everything that goes,
  and "**Why are you proceeding?**" when a medicine is short). The order keeps its Source and the
  short-stock answer (migration 0084); the order page shows Source, Customer remarks and "Goes on
  though short". Walked as Ryan (DE OCAMPO, AmiGet 3,500 with 552 short → Confirm → placed, the order
  page showing it all; a patient order missing its prescription) on a copy of the local database.
  Next (B part 2): Buy 1 Take 1 added by itself (with the price book's promos) and the new-customer
  form with a hospital's TIN, LTO and BIR 2303 / LTO / business permit papers. Question 24 written.
- 17 Nov (86), Aryan: work with the hub, crmnew and Zoho side by side and make crmnew better than
  both, checks automatic (memory). Step B part 2 begun: the sent-back Fix form checked as Ryan (the
  form fills from the order; only "your answer" missing; sent again, versions kept); every line
  shows **"−x% vs list"** for Management (question 25 asks what counts as fine to approve). **The
  hub's new-customer form**: a hospital, distributor or drugstore gets a "Licence and papers" part —
  TIN, licence owner, LTO number, LTO type (Zoho's kinds offered), issued, valid until, and the
  **BIR 2303, LTO permit and business permit** (customer_file, migration 0085, kept by the file
  store); from the field **a hospital is added only with its licence whole** (the hub's "Hospital
  Creation Restricted"; the API refuses it too) and its papers attached on the same screen; a
  distributor or drugstore may follow up ("I'll follow up… Management reviews it"); Management may
  add one and complete it later; a B2B Telesales prospect (a clinic or hospital it starts to work)
  is not held by it either, since B2B's papers make the account's stage as it grows. The customer page shows the licence and a **Licence and papers**
  card (open a paper, add a newer one, what is missing); Management's order check shows the whole
  missing list. Zoho kept the licence owner, LTO type and issue day (CF.License Owner / LTO Type /
  Issuance Date): the importer keeps them now, and `scripts/backfill-licence.ts` filled 768 local
  customers from the Zoho backup (local only; a safety copy at .data/pg.before-licence-2026-11-17).
  Walked as Ryan and Kate on a copy of the local database.
- 17 Nov (87), plan 19 step B part 2b (and plan 18 step 2's offers): **offers on a medicine** — the
  hub's Buy 1 Take 1 grown into what Aryan's Christmas offers file needs: for a kind of buyer or
  every buyer, **Buy X Take Y** and / or **a price per piece bought** ("Special price"), between two
  days (table offer, migration 0086; one running per medicine and buyer at a time). Set in Inventory
  on the medicine's page ("Offers": add, end; Management, the CEO and Admin, as prices) and written
  in its price history. **An order takes them by itself**: the offer's price is offered first, and
  **the free pieces are worked out by the server** (Y for every X bought, the hub's rule: a free line
  typed by hand for that medicine is replaced), following the order when it is fixed or changed; not
  with an SC/PWD price (the law: never both); an ended offer is not taken. The order form shows
  "Christmas: Buy 1 Take 1 · +N free, added by itself" (and in the Confirm window); the order page
  marks such lines "Offer", and Management isn't asked about an offer's free pieces or price.
  `scripts/import-offers.ts` loads the file (dry run: 410 offers; patient offers on prescription
  medicines held back as the file says; needs the promo's days to apply) — waiting for question 26.
  Walked on a copy (offers loaded there only): Kate saw AbiraGet's four offers; Ryan's order of 120
  got 120 free by itself; Kate saw the free line marked Offer, not as a question.
- 17 Nov (88), Aryan: "Christmas offer" is only a name — an offer has no days unless one is set; it
  runs until someone ends it (migration 0087). The aim restated: the hub and Zoho did the work, the
  trouble was going to Zoho and to the price sheet again and again — so the MedRep sees every price
  where he orders, Management sees whether a price is right there (prices and offers in Inventory,
  checked by the system), Finance sees the customer's old dues there (Zoho's history in the CRM),
  and the orders, invoices and the rest are made in crmnew: no Zoho. **The Christmas offers sheet is
  loaded on the local database** (410 offers from today, until ended; 92 patient offers on
  prescription medicines held back as the sheet says; 11 SKUs not in the list left out; a safety
  copy at .data/pg.before-offers-2026-11-17). Not on live yet.
- 17 Nov (89), plan 19 step C part 1 (Finance), Aryan: Finance used to look in Zoho for what a
  hospital or patient still owed — now the order shows it, worked out: Finance's check on the order
  page has a box **"what they owed before this order"** (this CRM's invoices, Zoho's and its opening
  balance; the order's own invoice left out) with its verdict — green "Nothing owed from before:
  clear to send on", amber "owes ₱X, nothing late", red "₱X overdue, the oldest N days late (₱Y of it
  from Zoho): collect it first, or ask Management", and over the credit limit — and a link to the
  whole history; the same lines are no longer repeated below it. **Tax withheld (EWT, Form 2307)**
  on a payment, as Zoho kept it: Finance types it and the 2307's number with the money (refused
  without the number); it is a payment of its own ("Tax withheld (2307)", migration 0088) that
  settles the invoice, is not counted as money in, and is never given back as cash. Walked on a
  copy as Sarla: DE OCAMPO's order showed "₱4,800 overdue, the oldest 11 days late, all from Zoho";
  ₱833 by bank and ₱17 withheld paid the ₱850 invoice; money in today ₱833; data checks clean.
- 17 Nov (90), Aryan: the earlier pending steps checked against the new aim (the hub's way, no
  trips to Zoho or the price sheet, nothing extra); three clashes put to him and answered:
  **returns go the hub's way** (Management decides, Dispatch checks, Finance refunds — not
  "Finance decides" as plan 18 said); **Dispatch marks an order delivered** (with the signed
  receipt, as crmnew does; not the MedRep as in the hub); **asking up (question 9): both** the
  automatic price check and Management's Ask Team Lead / Ask Business Mentor, built with step D.
  Dropped as extra: the courier's cost (plan 18 step 3). Plan 18 step 3's "address checked" is the
  hub's Confirm for delivery against the printed slip (one, not two). Order of work kept: C2
  Dispatch (with plan 18 step 3's cold fee), C3 Returns, D Team Lead + ask-up + Admin; then the
  Zoho ledger import, targets, going live on Aryan's word.
- 17 Nov (91), plan 19 step C part 2 (Dispatch), the hub, crmnew and Zoho side by side: crmnew
  already packed by batch, shipped, tracked and delivered inside itself (the hub sent Dispatch to
  Zoho to make the package and shipment), and had Take / Let go (the hub's Cater / Release), the
  delivery receipt, Came back and Hold. Added from the hub: **Print address** (a slip for the
  parcel: receiver, customer, address, phone, order and invoice number, KEEP COLD) from Ready for
  dispatch on; **Confirm against the printed slip** — the Ship window shows Deliver to and asks a
  tick "I checked the address slip on the parcel against this", refused without it (who and when
  kept, the address written on the timeline); **Not ready yet** — a courier parcel shipped without
  its tracking number says why (waiting for the waybill / the courier to pick it up / courier not
  assigned / other), shown on the order and On the road, cleared when the number is added;
  **Dispatch's hold reasons** as one-press choices (out of stock, not enough stock, wrong item or
  quantity, address or receiver problem). **Cold chain** (plan 18 step 3): Inventory's cold mark
  (from the price list's "[COLD CHAIN]") shown and set in Inventory (Storage), "Cold chain" on the
  order's lines, "Keep cold" on Dispatch's cards, the order's Pack & ship step, the Pack window and
  the slip. Migration 0089. The fee itself waits for question 27. Walked as Glyssa on a copy: Ryan's
  order for De Ocampo (GetFil with the Christmas Buy 1 Take 1, RocuGet) approved by Kate, passed by
  Sarla; card "Keep cold"; slip printed; packed; Ship refused without the tick, then shipped with
  LBC "waiting for the waybill"; tracking added, the wait gone; hold choices fill the reason; data
  checks clean; the copy put back.
- 17 Nov (92), Aryan on question 27 (cold packaging): the styro box is an item in stock like a
  medicine, with any price in Inventory, and Management types what the cold chain costs on the
  order. Built: Inventory's Storage has a third choice, **"A cold-chain box (styro): Management
  types its price on each order"** (migration 0090; the three Zoho styro items marked on the local
  database); a box line takes whatever price Management types, with no "below/above the list"
  finding; an order with a cold medicine and no box tells Management **"No cold box"** (the check
  done by hand before); the box is packed from the shelf by batch like any item (its stock comes
  with the switch-day count: Zoho held 441 Cake Roll and 462 Split Box). Inventory's SKU limit
  raised to 80 (5 imported Zoho SKUs were too long to save). Shipping charge still open (27).
- 17 Nov (93), plan 19 step C part 3 (returns and refunds), the hub's refund requests, crmnew's
  returns and Zoho's sales returns, credit notes and refunds side by side, then built the hub's way
  (Aryan: "hub wale jaise h waisa kro"). **Where the goods are** decides the road (migration 0091):
  coming back (Management approves, Dispatch checks good / damaged / not received, then
  **Management presses Credit ₱X or Don't credit with why** — the hub's Refund after the goods
  check); the customer keeps them (credited on approval); **not shipped yet** (the MedRep asks,
  Management approving cancels the order; what was paid goes on Refunds owed). "Request refund"
  in the order's header (the hub's place), the Returns & refunds page with a "Checked: to credit"
  tab. Kept from crmnew: line by line, a partial return credits only those lines. **The customer's
  credit** (migration 0092): Zoho left 508 credit notes open (₱2.54M over 443 customers, e.g. East
  Avenue Medical Center ₱96,655 on CN-00724) that Finance applied in Zoho; now Finance sees the
  credit on the order's money check and the customer's page and **uses it on an invoice** (a
  payment "Customer's credit · CN-…", no cash in, back with the customer if the invoice is
  cancelled), and money owed back can be **kept as their credit** for the next invoice instead of
  given back (as Zoho's open credit notes were). Walked on a copy: Ryan asked "the customer keeps
  them" on De Ocampo's RocuGet, Kate approved → ₱680 credited; "coming back" × 3 → Glyssa checked
  → Kate credited ₱1,020 (bill ₱3,400 → ₱1,700); "not shipped yet" → order cancelled; Sarla saw East
  Avenue's ₱5.37M Zoho dues and ₱96,655 credit, used ₱6,800 of CN-00724 → paid in full, money in
  ₱0, credit left ₱89,855; data checks clean; the copy put back. Still to come with step D: a Team
  Lead asking on the team's orders (the hub lets them). Not built: a credit memo document of its
  own (Zoho numbered CN-…; question 28).
- 17 Nov (94), question 28 added: the credit memo.
- 17 Nov (95), plan 19 step D (Aryan: "Haan, D kar"), the hub's Team Lead and Admin against
  crmnew's. crmnew already had My team, Targets, Messages, asks for people and orders for any of
  the lead's own MedReps (the "empty seats only" line in 12.5 was out of date). Added from the hub:
  **the Team Lead works the team's orders as their MedRep would** — fixes and sends again a
  sent-back order, answers a hold, cancels a draft, adds papers, asks a refund ("Request refund",
  any road) — and still approves nothing; and, fixing the hub's gap, **the Team Lead hears about
  the team's orders**: a stop (sent back, on hold, rejected, cancelled, came back) under Needs you,
  the rest (approved, taken off hold, restored, approval taken back) under Updates, "Ryan Aninon's
  order sent back: …". **Asking up (question 9, "dono chahiye")** (migration 0093): on the order
  Management presses "Ask Daniel Cruz (Team Lead)" — the MedRep's first lead up the line — or "Ask
  Vanessa Escalderon (Business Mentor)" — the top lead of the division — with what it asks; the
  one asked sees it under Needs you and on the order, answers Yes or No (a No says why); it comes
  back to Management under Needs you and stays on the order and its timeline; one open question to
  a person at a time; it doesn't stop the approval (Management decides). **Who approves what**
  (the hub's Management (Approval) access, migration 0094): Admin → Teams & people → Who approves
  what: each Management person approves every division (as now) or only the ones ticked; their
  piles and queue hold only those, approving another division's order is refused; an order with no
  division is for "every division". Left at "every division" for all three (Aljean, Kate, Sheila):
  which division each approves is the heads' call. Walked on a copy: Kate asked Daniel on Ryan's
  12%-below order, Daniel answered Yes from Needs you, Kate saw it and approved; Kate sent back
  another, Daniel heard and sent it again; Kate set to BID lost Ryan's HOS order from her pile and
  approving it was refused; data checks clean; the copy put back.
- 17 Nov (97), plan 20 step 1 for Subir Dey's branch (Aryan sent the chart: Subir › CLIDP (2),
  Government Bidding (5), B2B Telesales › Jessa Domino › CRR (1), NBD (4); "Claire Gallana ko hata
  de, wo nahi hai"). The code's chart matched it but for Claire: marked left and her seat closed on
  the local database (her record stays; her 5 Zoho customers wait for a seat), and taken out of
  the chart's sources (company-map.units.js, chart-2026.ts) so onboarding never brings her back;
  live waits for Aryan's word. Every seat of the branch walked in its own login (Subir, Jessa,
  Fritzie CRR, Floremel NBD, Ma. Anicia CLIDP, Jimmy, Angelica, Arron, Aljean): each already has its
  own desk. Built: **the hub's team switch** on My team for every lead and the CEO, read from the
  chart (`/api/org/menu` now gives every level, the box above and its lead): Subir "All · Sales &
  Marketing (14) · CLIDP (2) · B2B Telesales · Jessa Domino (6) · Government Bidding · Jimmy Boy
  Saturinas (5)", B2B Telesales opening "All of B2B Telesales · CRR (1) · NBD (4)"; Jessa "All ·
  CRR · NBD"; the CEO every division by its head; one press turns the whole page. **Team
  performance** on My team (the hub's table): person, team, today, sold, target, % of target,
  orders, stopped, owed, Dashboard →. A member's page: **‹ Previous / Next ›** through the team and
  **For the coaching talk** (to target in N days, stopped orders, new customers, owed and past due).
  Targets are still empty (step 4).
- 17 Nov (96), Aryan: "sab kaam ho gaya? kuch bacha dekh le" before pushing. Plan 19 parts 1–10,
  plan 18 step 3 and the hub's gaps checked again; four left over, built: **Finance's Refunds
  badge** now counts money paid beyond a bill a return lowered, as its Refunds list does (plan 18
  step 3; it counted only cancelled orders); **an invoice keeps its lines as billed** — the
  medicine's name, strength, form and VAT kept on the lines when the invoice is made (migration
  0095; lines already billed keep what they show today), so the invoice, the sales order and a
  return's credit never change when Inventory renames a medicine or changes its VAT (plan 18 step
  3); **the hub's toast** — a short word at the bottom when something is done ("Approved", "Payment
  recorded", "Shipped", "Saved"…, plan 19 part 10); **Back at work** on HR's person page for
  someone marked as left (a mistake, or rehired: the login works again, a seat from Teams & people;
  the hub couldn't reactivate anyone). Checked and already so: the prescription is checked by
  Management's approval (a patient's order isn't approved without it; Send back is the hub's
  "reject and tell the MedRep" / "ask for one").
- 17 Nov (98), Aryan sent seven screenshots of the old CRM's reports ("pehle kitne acche tarah se
  report banti thi… functional honi chahiye", and "kuch bigaad mat diyo existing… modular… koi
  channel juda to uska data apne aap aa jaye… bande aate jaate rahenge"). Brought back, live and
  built only from the chart, the seats, Targets and the invoices (nothing typed for them, so a new
  channel or team, a person joining, leaving or moving shows by itself and rolls up):
  **Company › Sales organisation** (`/company/sales`) — the old company tree: the company, each
  head's division, its teams by their lead, the people, every box with achieved, % of the month's
  target and the pace mark (day N of the month), On pace / Behind / Far behind / No target /
  VACANT, Open all, Heads only, Every team (the non-selling teams too), search, zoom and Fit; a box
  opens its details: Target, Achieved, Balance to do, Today, People under, Territories, "Under X ·
  best first", and the seat's page. **Company › Map** (`/company/map`) — the old territory map:
  every province and city an area's cities name (read as PSGC codes by the API, `GET
  /api/team/territories`, scoped like My team; aliases for Zoho's "Gen San", "Davao North/South",
  "Cebu North/South"), coloured by how its seat is doing, a Metro Manila inset, a hover with the
  place, who covers it, under whom and sold of target, a channel filter, and the areas whose cities
  aren't read listed apart; a click opens the seat. Both have the team switch and the days, and
  every lead's My team has **Tree** and **Map** beside Targets (a head sees only their own
  division). Checked as the CEO and as Vanessa Escalderon. Customers owe us (By customer / MedRep /
  team, the aging), Sales by channel and the CEO's Home were already there; **Customers owe us took
  over two minutes on the real data** (the embedded database had never analysed its tables, so its
  planner guessed: 209 s for Zoho's unpaid invoices) — the API now analyses the tables at start
  and every 15 minutes when one has grown (`freshenPlanner`; Postgres online does it itself):
  0.9 s. Open: no November targets are typed yet (the 10 Nov sheet's first names match only 27 of
  57 people, so they weren't loaded), so the boxes show what was sold until the heads type the
  month on Targets; and ₱5.4M of November is Zoho's ten "RX | …" salespeople (RX | TAFT, CEBU NORTH,
  SL NORTH, EAST AVE…) not yet tied to a seat (Admin panel → Zoho's salespeople), which the
  Home's total counts but no channel, team or person does.
- 18 Nov (99), Aryan: the ERP plan written (docs/ERP-PLAN.md, section 21): crmnew today area by area, one-system shape, navigation, dashboards, flows, enterprise features, architecture, six phases and seven questions. Live the same day: 278 medicines with prices and stock, 410 offers, styro cold boxes; customers wait for his word.
- 18 Nov (100), ERP phase 1, money core (Aryan: "Phase 1: money core"): the CRM's invoices, payments, refunds, return credits and stock costs post to the books by themselves on Zoho's accounts (migration 0096); the bank picked on every payment and refund; Books → Reports with Profit and Loss, Balance Sheet, Cash Flow, Gross Profit, Payables Aging, VAT Summary and Trial Balance (Print, Export CSV); gross profit, margin and DSO on the CEO's Home. Details in ERP-PLAN.md 7.1.
- 18 Nov (101), ERP phases 2–4 (Aryan: "complete all phases first, then push to live"): To decide, Audit, eight more reports with CSV, Batch trace, samples and gifts (old CRM's rules, migration 0097), customer import from a sheet, a customer's files in one place. All local; the questions that block the rest are in ERP-PLAN.md 7.2.
- 18 Nov (102), Aryan: "what you think is most accurate, valuable, correct to the business, do that yourself" for the open ERP questions. Decided and built (ERP-PLAN.md 7.3): samples and gifts posted to Zoho's own expense accounts (0098); branch = warehouse with sales and profit by branch; automations that only tell (stuck orders, expiring licences and stock, late customers, sample counts, the CEO's 8 AM summary); chain deductions on payments (0099); a complaints and side-effects desk (0100). Not built: bag selling (Dispatch delivers), outside email/SMS, rebates (lawyer), manufacturing/projects.
- 18 Nov (103), Aryan: explore all of Zoho Books (read only) and rebuild it in crmnew, logic not only screens. Walkthrough and plan in docs/BOOKS-PLAN.md. Built (local, not pushed): expenses, manual journals (draft, publish, reverse), transfers, deposits, credit notes and refunds, customer advances as credit, new / inactive accounts, transaction locking, recurring expenses and bills (taken over from a day), bank statements (import, match, categorize, exclude) and reconciliation, Zoho's 193 uncategorized statement lines, twelve more Zoho reports, and the history tied to Zoho's month-end trial balances (every account to 3 centavos). Migrations 0101–0102.
- 18 Nov (104), Aryan: a separate Books app like Zoho Books, reusing Finance, removing nothing (docs/BOOKS-PLAN.md 7): Books frame and menu for Finance, the CEO and the Admin, Books Home dashboard, Finance's own pages inside Books, a quick-create "+", a Books tile on the portal; checked role by role on a demo copy.
- 18 Nov (105), the B2B team's end-of-day report (Zoho export + Google Form + Excel pivots), now from the ERP itself (Aryan: "everyone logs their calls on their own screen and it shows up the team; no emails; fixed 7-day weeks; load November's targets under the right people"): **Calls** (`/calls`, migration 0103: a call to a CRM customer or a typed name, in the caller's seat; seen by the person, up their reporting line, by Management, the CEO and the Admin) and **Sales performance** (`/sales-performance`, `src/sales/performance.ts`): revenue before VAT against target, 110% and BTD; TLB (different SKUs) and billing efficiency (different customers), counted once for the team too; calls by day; channels ranked with their share; daily by salesperson and channel; W1 = 1st–7th …; Excel download (`/api/sales-performance/xlsx`, own .xlsx writer). Targets got TLB and billing counts. A team can carry its own report channel (CLIDP inside B2B). Checked on the real local data for 1–14 Nov against the team's sheets: equal to the peso except two invoices Zoho holds that their export missed (2MG-SI000004962 ₱60,000 Lonie, INV-12843903 ₱14,910.71 Fritzie). November targets loaded locally for Fritzie, Faith, Lonie and Floremel (`scripts/load-b2b-targets-nov-2026.ts`); Khayzee and Darsh are not in the ERP yet. Found: some CRM customers join two different Zoho contacts (e.g. Los Medicinas and Lucky 8), so the report counts Zoho's customers by Zoho's own name.
- 18 Nov (106), Aryan: "in the Admin panel drag a person under any team; their modules follow the channel": Teams & people → Teams: drag a seat (its person, customers and orders go with it) or a whole team onto another team in the tree; a bar asks before moving. Each team can carry a report channel ("Reports as", e.g. CLIDP inside B2B) for Sales performance.
- 18 Nov (107), Aryan: "the Online desk's work must go to Management and to Finance; the medicine select isn't proper; mind every section's small details": an Online case's order now goes **Management → Finance → Dispatch** like every other (`routeOrder`, the approval, Finance's "awaiting payment" list; migration 0104 puts the case orders not yet approved on that road). The case shows a **Finance check** row in its order trail (later / waiting / done by whom / held), "With Finance" in its heading, and the next step says what the agent does meanwhile ("record the advance payment received"). The old "Goes straight to Dispatch / Send to Management" switch on the case's order step (it did nothing: Management approves every order) is now one line: *Once placed, it goes 1 Management approves › 2 Finance checks the payment (or what they owe, or the agency's bill) › 3 Dispatch packs and ships*, with what Management will see. **Select medicine** on the quotation: a labelled box whose list opens on a click (it was clipped by the step's card before), narrows by name, generic, strength, brand or code, moves with ↑ ↓ and Enter, shows price a piece, stock, Rx and Promo, puts the medicine the patient asked for first ("Asked for"), and says why one can't be added. Below 1280 px the step being worked on now comes right after the steps (Money and Activity under it). Finance's confirm dialog names who adds the proof and the invoice the money goes on. Walked on the demo copy: Jane quotes and places → Sarla approves → Fiona confirms the payment → the case shows both checks done and Packing next.
- 18 Nov (108), Aryan: "why are senior citizen and PWD separate when the work is the same; keep three roads; the medicine select still isn't good (pack, every price, no stock numbers for sellers); the quotation line looks bad; who marks the payments that come later; what comes where in the steps; the customer's messages at the right steps": **Three roads** — Regular, Senior citizen / PWD, Guarantee letter (new enquiry, case head, filters); one ID paper for both (either card, a small "Senior citizen | PWD" chip on the file says which, for the books' SC/PWD discount; the PWD booklet is no longer asked); old "pwd" cases read as the same road. **Select medicine** is one finder for the Online quotation and a MedRep's order (`orders/medicine-finder.tsx`): the list opens on a click, each row its pack ("box of 30") and the buyer's price per piece and per box (the hospital's for a hospital, the patient's for a case), the row in focus shows every buyer's price, VAT, Rx, promo and offers; sellers see "Out of stock" only, never the shelf's numbers (the order lines too). Orders charge by the piece, so a box shows its pieces added up; Inventory's own box price (from Zoho) is shown apart — *whether orders should use box prices is Aryan's call*. **Quotation lines**: a table (Medicine · Quantity with − / + a box and "2 boxes" · Price each ₱ / tablet · Amount). **Payments to collect** (Finance, `/collect`): every cash-on-delivery and credit order still owing — Late, Due now, Not delivered yet — with Mark paid on the row; paid in full it moves to Collected (who marked it, 30 days); Zoho's open invoices apart (recorded in Books). **Case steps** in the journey's order with who does each: 1 Enquiry & quotation (you) → 1.1/1.2 the agency's on a GL → 2 Rx & documents (you) → 3 Order & delivery (Management approves · Finance checks · Dispatch ships) → 4 Payment & follow-up; the case opens on the step its next action is in. **Order cards** name the steps under their strip (Placed · Mgmt · Finance · Packed · On way · Delivered), so a MedRep follows every order from My orders. **The customer hears**: *Order confirmed* when Management approves (with how to pay: the advance and its proof, on delivery, or the credit terms), *Payment received* whenever money is recorded (Finance's check of an advance, or a later payment), *On the way* when Dispatch ships (with tracking), *Delivered* at the hand-over; the websites hear "confirmed" at the approval too.
- 18 Nov (109), Aryan (with a mock-up): "a click on a department's tile shows that department first, the same ID and password box with it; content all round, only the good news, and the team's structure": the portal's tiles open `/login?dept=<key>`: the department (its mark, what it is for), four **highlights** of its last 30 days, counted from Bishnoi One and the Zoho history in the books (Finance: invoices made, payments received, suppliers paid; Dispatch: packed, shipped, order to shipment; Sales: orders taken, customers served, sellers…; plus team members), **Key functions** (its menu) on the left, the **sign-in** in the middle (the same box for every department, login unchanged), the **team structure** on the right (the head's seat, the seats and teams under it, how many people, what each kind of seat does; "See the whole team" opens it as a proper top-down tree in a pop-up on the same page: the head on top, the teams under them side by side, and so on down; many teams with nobody under them stack in one column) and the **workflow** along the bottom. Only good news there (nothing late or short); before signing in only counts and seat titles go out (`GET /api/portal/departments/:key`, no money, no names, worked out at most every 5 minutes). The sign-in is raised above the page (deeper shadow, a soft glow of the department's colour) so the eye lands there; a click into the ID or password brings it forward where it stands (a little bigger, a deeper shadow) with the page blurred behind (a click outside or Esc puts it back); the whole page fits one screen; "Back to departments" (a plain link) or Esc goes back.
- 18 Nov (110), Aryan: "Management's page is one common screen for all its people (one seat); on the right each Management person from the admin panel, a small Start; orders then go to them automatically; what's done on an order goes in that person's name; only Management's own data on it" (and the same for Finance): Management's and Finance's Home is now a **common desk screen** ("Management desk", no personal greeting): Management's own figures (waiting for approval, on hold, customers to check, orders today), the same order cards, and on the right **the desk's people** (everyone with that role on the chart), each with **Start / Stop**, since when, open now and done today; a name shows just their orders. The waiting orders are shared out only among the people started (fewest open first, oldest order first, a Management person's divisions respected, a PAP order left with its PAP head), whenever an order moves and when the screen opens; Stop puts that person's open orders back to be shared. Each card names its person ("Sarla · Let go", or "<name> · Take over"; Finance has it too: `finance_by`). Anything done on an order from the common screen (approve, send back, hold, Finance's confirm…) is written in the name of the person it was given to, if they are started; taking over and letting go stay the account's own. Each start is kept (`desk_shift`: who, desk, from–to, who pressed). The people with their Start / Stop sit in the **left menu** under the desk's work (not beside the cards, which keep the full width); the top bar shows the desk, not the initial of whoever signed in. The menu: Orders to approve (Finance: Orders to check), **Team figures**, Stopped orders, Customers to check (Finance: Payments to collect, Money, Books), then Look up (All orders, stock, customers). **Team figures** (`/desk/team`, today / this week / this month): each person's hours started, orders given, taken over, approved (Finance: let go to Dispatch), sent back, held, rejected, time per order from when it was theirs (working time), late (over the desk's limit) and open now; from the order steps and a log of every give / take / let go (`order_assignment`). Migrations 0105–0107.
- 18 Nov (111), Aryan: "the order page's top is too big; keep only what's useful on top; below, make it like the Leads case (steps at the side with what to check, a tick as each is fine, the picked one opens beside), for Management and Finance": for Management and Finance the order page now has a **short top** (code, customer, status, amount, one line: address, ships from, invoice, division, PO, doctor; customer remarks if any; **More details** opens the rest) and, below, **the desk's steps on the left** as on the Leads case — Management: RX & documents (or Documents), Medicines & price, Stock & warehouse, Customer & licence, Approve, each ticked green when fine or amber with what to look at; Finance: Payment proof, Finance check, Paid — with hold / cancel under them, then Money and Activity; **the picked step opens on the right** (Approve has the findings, the warehouse and Approve / Send back / Reject), the tabs (Items, Timeline, Payment, Dispatch, Documents) under it. Everyone else keeps the page as it was.
- 18 Nov (112), Aryan: "Finance's main bars: Orders to check; the prepaid orders in a tab of their own; the payments that come later each by their terms (30 days, 45 days, cash on delivery) in a bar of their own": Finance's menu now starts with **Orders to check**, **Prepaid orders** (`/finance/prepaid`: Finance's board of the orders paid in advance only — to check, not yet with Finance, with Dispatch, on hold, delivered; the board takes `terms`) and **Due payments** (`/collect`, renamed from Payments to collect: one tab per terms — Cash on delivery, 30 days, 45 days… — then From Zoho and Collected; each row says late / due / not delivered yet, late first, with Mark paid). Aryan's check of Management's cards: the "Last time" price is that customer's own last order; the green / blue / amber on the checks follows whether each is fine.
- 18 Nov (113), Aryan: "test it properly with 2–3 people each; terms can be any length (60 days, 3 months, a date); does what the MedRep enters reach every desk; what else belongs in Finance's menu; where does each Management / Finance person see their own orders": **Terms of any length**: the order form keeps the hub's list and adds **Other: number of days…** (any number, "75 days") and **By a date…** ("Pays by 2027-01-15", due on that day: `pay_by`, migration 0108); "3 months" reads as 90 days. The days are counted from delivery (as the due date always was), so the screens now say "after delivery", not "after the invoice". The terms reach the card ("75 days", "by 7 Jan"), the invoice's due day, Finance's next action, Due payments (a tab per terms, "By a date" apart) and the customer's email. **Even sharing**: someone pressing Start later gets a fair share of what is already waiting (the newest of the busiest's, never one taken by hand); "Given" counts what stayed with them. **Each person's page** (`/desk/person/:id`, from a name in the left menu's People or in Team figures): their figures, what they have now, and every order they approved (Finance: let go), sent back, held or rejected, with the time each took and late marked. **Finance's menu**: Orders to check, Prepaid orders, Due payments, Refunds owed, Supplier bills to pay, Team figures, then Money and Books. Tested end to end with three at Management and three at Finance (`desks/flow.test.ts`): six orders on six different terms shared two each, approved and checked from one account each in its person's name, the by-date invoice due on its date, Due payments grouped by terms, each person's figures and page, and Stop.
- 18 Nov (114), Aryan: "the medicine list is stretched (AbiraGet, then a big gap); Edit has no doctor, hospital, patient, distributor, drugstore price and nowhere to run a promo; the MedRep's form doesn't look premium; Zoho Inventory and Inventory's own sections: where does he enter things, so nothing doubles?": **All medicines**: one long molecule or maker made the table 3,642px wide; each text column now has a set width and wraps (2,347px, the name no longer floats far from its stock). **One Edit** on a medicine with tabs: Details · Prices (one table: each buyer, a piece and the whole pack) · Promo · Buy X Take Y; the Inventory person sees the price tabs greyed with who sets them (Management, the CEO, the Admin: rule unchanged). **One road for buying** (section 17.1): Purchases (Zoho's road, with Zoho's history) is the only place to buy; the Stock page's "New purchase order", Overview's "to be received" and a medicine's "Coming" now open and count Purchases' open orders; **landed cost** came over from the first purchase pages onto Bills (freight, customs… shared over the order's goods by value, kept in Inventory Asset, void takes it back); "Add stock" says "not bought"; Vendor credits in the Inventory menu; the Purchases frame links Medicines & Prices and Stock on the Shelf. **The MedRep's order form**: steps across the top with a tick per part done and what is left, each part a card with what it is for and "N to fill", taller fields, the bottom bar shows "N to fill" (a press goes to it) or "Ready". 418 API tests.
- 18 Nov (115), Aryan: "move Purchases out of Zoho's style into our Inventory style, every feature, better than Zoho; keep the Zoho screens to show my boss both", then "vendors first, then in order; where do extra costs go (travel, airfare, anything); check what is received reaches stock; what is the difference between Stock and All medicines": **Purchases in our own look** (section 17.1): To do & buy again, Vendors (list, a vendor's page with what we buy from them and the last price, their orders, bills, payments, credits; new and edit), Purchase orders (by where they stand: to receive, received and not billed, drafts, closed, cancelled; an order's page with steps and ticks; Receive, Bill, Pay from the step; Close the rest / Reopen; new order with last price, free stock, low level, coming), Receives, Bills, Payments made, Vendor credits (lists by state, each one's page, Use on bills, Void); "Zoho view" on every page; the menu in the order the work goes. **Extra costs** on an order's goods (freight, airfare, travel, customs…) can be added before the goods come: shared by value, the part for goods still to come waits and goes on each delivery as it is received; the form warns when a cost is more than the goods. Checked on the real data copy: an order of 300 Letrozole received on the shelf (batch, expiry, ₱283 a piece, "PR-04874 · PO-04370" in its history, Stock by warehouse 300), ₱3,000 airfare made each piece ₱293, void put it back. Late counts only an expected day passed. 419 API tests.
- 18 Nov (116), Aryan: "what do Zoho Books and Inventory have that our ERP doesn't — are they important" → "yes": **Papers on purchase documents**: Attach (a photo or PDF, 10 MB, photos made smaller) on every purchase order, receive, bill, payment and vendor credit; the vendor's invoice kept with its bill; never removed. **Print / PDF** on a purchase order: the company, PO number and date, vendor, deliver to, lines, total, payment terms, notes, terms, Prepared by / Approved by. **Website stock** (read in Zoho, nothing changed there): 12 of Zoho's 26 workflow rules run a function that sends each item's stock (name, SKU, stock, purchase price, strength, molecule, category, maker) to getmeds.ph's `.../zoho-inventory/insert-or-update-product-in-db`; the new getmeds.ph answers every call "Page Not Found", so the site gets no stock from Zoho today and switching Zoho off breaks nothing. A stock feed from this ERP waits on getmeds.ph's side (who builds it, what address). The 2MG website keeps its own stock (not from Zoho). Not built (never used in Zoho): approvals (no order or bill ever waited for one), quotes, recurring invoices, projects, budgets, bank feeds, barcodes, serials, bins, kits.

- 18 Nov (117), Aryan: "my boss is a fan of the Zoho CRM reports; can we make them; put them on the CEO page in a left section" → "no heavy work for now, just their names, no not-built label": the CEO's sidebar has **Zoho CRM reports** (Leads, Customers, Orders & deals, Products, Calls & tasks, Meetings & check-ins, Emails, Sales metrics, Website campaigns & cases, Vendors & purchases), each listing Zoho CRM's reports by name (115, read in Zoho CRM, nothing changed there), the company's own first. Building them needs Zoho CRM's data (128,635 leads, 210,924 customer-product rows, deals, calls) brought in first.
- 18 Nov (118), Aryan: "keep the 115 names as they are; are the apps under the CEO the desks' full screens (Orders: to check, on hold…; Online; Finance); the most important report is customers, all kinds; the second is every channel; first tell me how many channels there are": **Key reports** on the CEO's menu: **Customers** (everyone who ever bought, every kind, tabs by kind: channel, who looks after them, bought in the days, this year, all time, owes now, last bought; 25,624 buyers, 65,952 more on file never bought) and **Channels** (9: Hospitals, Doctors (RX), Distributors and drugstores (B2B), Government tenders, Patient assistance, Telesales, Modern trade, Online, Uro & Onco Care; people, customers, buyers, invoices, sales in the days and this year, owed; Zoho's sales by salespeople not tied to a seat apart: PHP 160M this year), Print and CSV. **The CEO's apps now hold each desk's full screens**: Orders (Management: to check, on hold, all, sent back, stuck, returns to approve, customers to check, team figures), Finance (adds supplier bills, team figures), Dispatch (on hold, returns to check), Online (refills due, patients); team figures and a person's page take ?desk=finance for the CEO.
- 18 Nov (119), Aryan: "the key reports look like Zoho; Sales performance has no work in the Admin panel; Uro & Onco Care is under Javed (Rx), there are 8 channels; in the Admin panel each of the 8: who heads it, who are team leads, how many teams under whom, modular": **Key reports in our own look** (`pages/key-report.tsx`: days, kinds, search, sort any column, totals, Print, CSV; customers show 300 at a time). **Channels: 8** (the old Uro & Onco Care channel was already out of use; it is a team inside Rx's Onco-Hema Division) with head, team leads, teams and MedReps read from the org tree. **Admin panel**: Sales performance taken off; a channel's page reads Head → team leads → teams → MedReps in one line and draws its teams as a tree (a team's teams inside it, any depth), each with its lead and MedReps; a team's menu adds "Move under…" (with everything under it; never into itself). Org chart against Zoho and the hub: Rx's 9 RX | names, STC and B&B, TeleSales Anesthesia and MD Telesales by region, B2B | RENROSE and B2C | JM BULAN are not tied to seats (PHP 160M this year untied); Onco-Hema and Uro & Onco Care have no team lead; Telesales has no teams; PAP and Online have no head; Reynan Cuenca (BID) sits in Hospitals' Government Account; Modern trade has no MedRep.
- 18 Nov (120), Aryan: "a team may have more than one team lead"; "do not tie the Zoho salespeople yourself: first show me who was under whom in the salespeople and in the org; I decide": **More than one team lead** in a team (a team's menu: Add another team lead, reporting to the lead above; each MedRep shown under the lead they report to, "MedRep under them"). **Admin → Old customers to seats → Who was under whom**: every Zoho salesperson name grouped as the old hub's Sep 2026 target sheet grouped it (channel, head, manager, person, place; `zoho/hub-sheet.ts`), with this year's Zoho sales, beside where that person sits in this CRM's org today (tied, or by name, not tied) and "same lead / different lead". Nothing tied: Aryan decides.
- 18 Nov (121), Aryan: "this is the latest target sheet (Nov 2026); can it come out of the software in one click" → "yes, build it": **Target sheet** (CEO → Key reports, `/key-reports/target-sheet`): the sheet row for row (Head · Channel · Manager · Sales Person · Zoho name · HQ · target · achieved · BTD · the day's invoicing · 
- 18 Nov (121), Aryan: "this is the latest target sheet (Nov 2026); can it come out of the software in one click" -> "yes, build it": **Target sheet** (CEO -> Key reports, `/key-reports/target-sheet`): the sheet row for row (Head, Channel, Manager, Sales Person, Zoho name, HQ, target, achieved, BTD, the day's invoicing, percentage; a total under each manager, channel and head; the grand total; the sheet's colours; Print; CSV). Achieved is read from the invoices as Sales performance reads them (VAT out): a Zoho invoice by its Zoho name, this ERP's by the seat; sales under no row are shown apart. Table `target_sheet_row` (migration 0109); the November rows in `sales/target-sheet-2026-11.ts` (57 rows, PHP 57,642,166 as the sheet), loaded by `scripts/load-target-sheet.ts` (dry run first) on the local database (backup .data/pg.before-target-sheet-2026-11-18): the rows; each row's Zoho names tied to its person's seat (the 10 Rx names, Khayzee to Faith: 1,092 customers moved); November targets on the seats (a 0 on the sheet keeps a target already set: Faith's PHP 2,350,771 from the B2B team); reporting as the sheet's managers say (Rx MedReps -> Honey, Telesales -> Reynan, Kris and Andy -> Daniel, Jessa -> Jim Lord, BID Hazel and Angel -> Subir). Left as they are: Mindanao (the sheet says Claire; Claire Gallana left 17 Nov), Rx Yza, B2B Dhon, Pillow, Charle, Mani Mishra, Claire, MT Arlene and Jasper (not in the ERP). Checked against the sheet: every row with no invoice after 16 Nov (Zoho's copy) is the same to the peso. Live: not loaded (on Aryan's word).
- 19 Nov (122), Aryan: "what is in the sheet is right": **Claire Gallana back** (`scripts/claire-back-19nov.ts`, undoing claire-left-17nov.ts): active, District Sales Coach in Hospitals' Mindanao team beside Saurav Kumar (a team may have two leads), reporting to Vanessa; Mindanao's MedReps (Mel, Ruby, Welmar, Queen, the Zamboanga seat) report to her as the sheet says. **Faith's November target 0**, as the sheet (the loader now writes the sheet's targets as they are). A manager's own sales row (B2B | CLAIRE) doesn't move whom the manager reports to. Local database only (backup .data/pg.before-claire-2026-11-19); live on Aryan's word. Still to settle: the sheet calls Zamboanga vacant, the ERP has Maycarl Degamo in it; Yza, Dhon, Pillow, Charle, Mani Mishra, Arlene and Jasper are not in the ERP (their full names are needed to add them).
- 19 Nov (123), Aryan: "align our ERP completely to this sheet, every person, in the Admin panel where teams are decided": **the teams are the November target sheet** (`scripts/align-org-to-sheet.ts`, safe to run again). The sheet's columns on the tree: Head = the business's lead seat, Channel = a team box, Manager = that box's lead seat (a manager is a team lead), Sales Person = a seat in it, Zoho name = the name the seat's sales are invoiced under. **One person leading two teams holds two lead seats** (their first seat keeps deciding their screens): Honey leads RX Business (was Onco-Hema Division, with Uro & Onco Care and Blood & Bone Care) and MD Telesales (was MD Telesales Oncology, now straight under Javed beside RX Business); Subir leads Sales & Marketing and Government Bidding (Jimmy keeps his Bidding Admin seat and tenders desk, no longer its lead); Reynan leads TeleSales (was MD Telesales Anesthesia) beside his Government Account seat. Hospitals: Kris and Andy in Daniel's NCR 1, Jessa (Iloilo) in Jim Lord's NCR 2, Visayas closed; Mindanao led by Claire, Saurav Kumar another team lead in it under Vanessa. Claire also has her B2B seat (B2B | CLAIRE) under Jessa. Vacant seats with their areas for the sheet's people not yet in the ERP: B2B Dhon, Pillow (127 customers), Charle, Mani Mishra; MT Arlene (MT | 1), Jasper (MT | 2); their targets on the seats. MedReps follow their box's lead, none named by hand. Admin -> Channels: a channel with boxes in two businesses (Telesales: Vanessa's TeleSales, Javed's MD Telesales) shows both, the other one said where it sits. The loader matches Zoho's spelling ("B2B | Pillow") and puts a manager's reports under their lead seat. Local database only (backup .data/pg.before-sheet-align-2026-11-19); live on Aryan's word. Still to settle: Yza (Eloisa Villanda?), Zamboanga (the sheet says vacant, the ERP has Maycarl Degamo), Saurav Kumar's work (on no row of the sheet).
- 19 Nov (124), Aryan: "Subir looks after CLIDP and BID: how does he see each one's data? Many lead in two places, one may look after two channels; the Admin panel's tree decides it; Javed has two under him": **every lead page follows the tree** (`org/scope.ts`). The team switch (All · each box under the person, by its lead; a box with boxes under it opens the next row) is now on My team, Scorecards, Targets, Sales performance, Collections, Team orders, Calls, the Visits report and Who's working; the box picked rides as `?unit=`, checked once when the request signs in (the CEO and the Admin any box; a lead one they lead or under it; else refused), and every page then counts the seats in that box and under it: orders and sales by the seat they were sold from, customers by its areas, people by who sits there today. "All" is everything the person leads: Honey "All · my 2 teams · RX Business · MD Telesales"; Javed "All · Prescription Business · RX Business · Honey · MD Telesales · Honey"; Subir "All · Sales & Marketing · CLIDP · B2B Telesales · Jessa · Government Bidding · Subir" (BID PHP 1,519,700 of the month on its own). **A lead seat decides the screens** of someone holding two seats (else the first given): Reynan works as TeleSales's lead (his Government Account seat stays his); the sign-in reads the person's business from that same seat (it read the newest one).
- 19 Nov (125), Aryan: "Management, Finance and Dispatch have one screen and sign in beside it: no password, or one password everyone uses"; "why order moves in the IT Division? IT does IT's work and a little co-selling"; "put the real people, and data (dummy or a little) for tomorrow's demo; all of Zoho's once the server is set up; push to live": **the desk's sign-in** (Management, Finance, Dispatch on the portal): the company's password alone, no ID, opens the desk's common screen as its first seat; "Sign in with my own ID instead" stays (one password, not none: the live site is on the internet). **An office team** (IT, HR, Digital Marketing, Regulatory, Executive office) in the Company view shows its people's work logs for the day, not order speed; what they co-sell shows as sales like any team's. **Live**: pushed; Claire back, the teams as the November sheet and its targets (`claire-back-19nov.ts`, `align-org-to-sheet.ts`, `load-target-sheet.ts`, each --live); **demo data** (`scripts/demo-live.ts --live`): two real customers per area (their names from Zoho's, no patients) in 13 areas across Hospitals, Rx, B2B, BID, CLIDP and TeleSales, and 29 orders made by the real people through every desk (waiting at Management, at Finance, invoiced, packing, on the road, delivered, part and fully paid, one sent back, one on hold), each customer and order noted "Demo · 20 Nov walkthrough" to be closed (cancelled, archived) before the real go-live. Zoho's history (2 GB here) waits for the server: the free database holds 500 MB.
- 19 Nov (126), Aryan, walking the live demo: "the demo data is all blue: put some wrong"; "the timeline is at the foot, and Timeline · Items · Payment · Dispatch · Documents repeat what Management's checks cover"; "Customers to check shows nothing"; "a Me section and My payslip on Management's common screen are wrong"; "the People list looks odd: up top"; "did you take away their own logins? each keeps their own ID for their own things"; "make Dispatch's like Management's"; "Finance's cards need the same bars: papers, payment proof, Finance's check, the oldest the customer owes us, on the strip"; "show the money properly"; "the Rx CHC's My orders right under Log a call"; "don't write Zoho, just whole history". Built: **a desk's common screen is a session of its own** (migration 0110, `session.desk`): opened at its tile with the company's password it has no "Me", no payslips, no one person's messages; **"Desk screen | My own login"** on the tile's sign-in, and each person's own login keeps their own things. **"On the desk today"** at the top of the menu (those started; the rest one press away). **Dispatch is a desk like Management and Finance**: its people press Start, the orders to pack are shared out among them (`dispatch_by`), what is done is written in its person's name; its Home is a "Dispatch desk" with four figures (to pack, to ship, on the road, on hold) over the queue; its menu: Orders to pack & ship, Team figures, All orders, On the road, On hold, Returns to check. **The order page at Management and Finance**: the timeline up beside the checks; the tabs only once the order has left that desk. **Finance's cards**: a "Finance check" strip (Payment proof, Papers, Dues: the customer's oldest overdue, Credit) in place of the road strip, amber what needs a look. **Money** on the order: each medicine whole (pieces × price, free goods, below-list marked), the total, the invoice with its due day, received, still owed. **Customers to check** says what it is when empty. **Rx CHC menu**: Home, My orders, My doctors, Calls, Patient care groups, My score. "Zoho" taken off the screens' words (whole history, earlier orders, credit notes, from before). **Demo data**: the order notes no longer carry the demo mark (the customers do); added a price 15% below list, an order beyond the shelf, an expired licence, a customer over the credit limit (one at Management, one at Finance), advance pay with no proof at Finance, a MedRep's note, and three new customers a MedRep added for Management to check. Not built: the hub's GL tracker view on PAP (agency chips, the nine papers in a row, claims ageing); PAP cases walk the GL road (application, letter, claim, paid) today.
- 19 Nov (127), Aryan: "the apps on the front page in the line's order: Sales and field, Management, Finance, then Dispatch"; done. "How long to make the whole blue green?": one file (the theme's brand, blue, sky and emerald scales); a preview was made (.data/previews/green-management-desk.jpg) and put back to blue: "show me the design first; not that important".
- 19 Nov (128), Aryan: "the shared Management screen says Signed in as Veronica"; "Sign out takes time"; "give the IDs of the people added"; "the CEO Home shows so little: it was colourful, put everything about the company on it"; "nobody in Customers owe owes much that is long overdue". Built: the desk's shared screen says "Management desk · Shared desk screen", no person; signing out goes to the sign-in at once (the old screen's boxes no longer read again first; the server took 0.35 s); docs/LOGINS-LIVE.md read again from live (133 seats: Claire tl13 and b2b8, Honey tl15, Reynan tl16, Subir tl17, the empty B2B and MT seats); the CEO Home opens with "The company at a glance" (`/api/ceo/company`): six coloured figures, sales day by day, people by department, each channel against its target, orders by step, top sellers, customers and medicines, Online enquiries by source, stock by warehouse, customers by kind. Live demo data: the delivered orders spread over November, and four delivered and unpaid, billed 45, 70, 95 and 125 days ago. The CEO Home had lost nothing: live has no history yet (Zoho's waits for the server).
- 19 Nov (129), Aryan: "papers turn green by themselves: a prescription is read by a person, don't do it automatically"; "the customer's last price (we gave it at 400 last time) must show"; "test everything A to Z: the MedRep's form, Management (each person's own screen, I'll handle it, sent back and fixed), Finance, Dispatch (every way, the warehouse it picks from), the inventory, the team lead, the CEO, the Admin; no error anywhere"; "each seat's screen and menu by its own work (hospital, patient, NBD, CRR, BID)". Built: **papers checked by hand** (migration 0111, `papers_checked_by/at`; "Papers are right" in Management's Documents step, kept with who and when, Take back; a new paper asks again; the card's Papers bar and the step stay amber until then). **Fixed: Dispatch couldn't pack an order with a promo's free line** when the batch that expires first held less than both lines (each line picked as if the other weren't there; the box was refused as short, and the Pack screen's plan asked a batch for more than it held): each line now picks from what the lines before it left. **`scripts/a-to-z.ts`**: the whole line on a copy of the real company, 41 steps, all passing (Ryan's order at St. Clare's, its last price ₱3,500 of 13 Nov against ₱3,900, papers by hand, the two Management people, I'll handle it, sent back, fixed, held, answered, approved; Finance invoices, holds for proof, the proof sends it back, payment; Dispatch packs first-expiry from the warehouse it ships from, courier, failed delivery, rider, signed receipt; a return back on the shelf and credited; a cancellation; the team lead, the head, the CEO and the target sheet count it, another head doesn't; data checks 17/17). Every menu page of 33 logins (CEO, Admin, the three desks' shared screens and their people's own logins, Inventory, HR, Regulatory, IT, the Executive office, the Online desk, the ten kinds of MedRep, the team leads and the heads) opened in the browser: no failed read, no page error, no blank page. Each seat by its work: MD Telesales and the PAP officer open on their patients; the PAP officer's Home is their cases, their desk named "Patient Assistance (PAP)", "My patients", "Patients to call"; the Rx CHC's phone log is "My phone calls" (their "Calls" are doctor visits); under a seller's or lead's name their own job (PH Country Mentor, Business Mentor, Hospital CHC), not the role's word. 428 API tests pass.
- 19 Nov (130), Aryan: "you found not one shortcoming"; "the follow-up reminder: who fills it, and where does it show?"; "Online desk orders: will they say they came through Online?"; "B2B orders that come through Online should be Online's entries"; "Mary Jane's Online desk says B2C CHC at the top: she works in Online"; "what does Management see on an Online order: papers, the price we gave, its quotation?"; "Finance's 30, 45, x-day orders in the sidebar, measured right; the strip's data relevant". Built: **the next refill** (migration 0112, `customer.next_refill_on`, note, who, when; set on the case's step 4 or the customer's page, quick 15/30/60/90 days; Refills due reads it until the next order, "Set by …" on each row, a count beside the menu link). **"Online · Messenger"** on every desk's cards, lists and the order page; Management's price step opens the case's quotation. **A business buying through Online** (migration 0113, `lead.buyer_kind`, `quote_buyer`): picked from the file or added as its kind, priced from its own list, no prescription, its own terms; the agent's order on the Online channel. The Online desk's header and Home say "Online desk". Finance's strip says what each check means for the money (how it pays, the PO, what is overdue, the credit limit, grey "no limit set" for a credit sale); a count of late payments beside Due payments (credit's days count from delivery, cash on delivery falls due on delivery: checked). Found: Management's check wants the patient's ID on a patient's order (16 Nov) but the case never asked for it: the case now lists it as needed (not blocking yet: Aryan to say). A promo's free line is added on top of a price given below the list: Aryan to say whether both may stand.
- 19 Nov (131), Aryan, with the hub's MedRep open beside ours: "the hub shows Create New Order on top, then For myself, then the Division; in ours I can't find it"; "don't put Another MedRep"; "a MedRep comes under one Division: why so many? A Hospital MedRep brings a CLIDP order: under which head does it go?"; "the data must go to the right team lead, everyone's screen relevant". Found: the Rx CHC's top button was Log a call (the IDs he opened were right); Bidding's was Record a tender, PAP's New PAP case, and six leads' and heads' menus had none; the Rx channel had no Division (13 Rx CHCs opened on "Not set"), CLIDP opened as B2B, B2B's sub-division filled with the person's name. Built: Create New Order on top for every seller (their own action under it) and on My orders; `seat_division` (migration 0114) and `Me.divisions`; the form shows the person's own Division (two seats: those two; Management: any), refuses another in the API, the B2B sub-division from the seat (CRR / NBD), the customer list opening on the Division's buyers, a new customer starting as that kind. Test `orders/division.test.ts`; the A-to-Z checks another Division is refused and the B2B coach doesn't see a Hospital MedRep's order.
- 19 Nov (132), Aryan: "the CRR can change every Division: why?"; "what is the CRR's work: their delivered orders, whether each ordered again, and a call to those who didn't; its menu isn't by that"; "the Hospital CHC has so many Divisions?"; "My hospitals says Checked: who checks, why?"; "Hospitals to call: where does it show which hospitals he visited?"; "the side menu is cluttered: bundle what belongs together"; then "not only the CHC's and the CRR's: everyone's menu A to Z, each one's own things on top, with their data". What the CRR saw was the step before (every Division as a button); the form now shows only their own (B2B, CRR). Built: **every menu by its person's work** (each login's menu printed and reviewed): a seller's day first (their list to call, their orders, their customers), what belongs together in one folder (Hospitals: My hospitals, Hospitals to call, Collections; Visits or Calls: the day's visits, the plan, the calendar, the phone log, expenses, samples; My numbers: the huddle, the score, sales performance; an Rx CHC's Doctors with the care groups; the NBD's Prospects with Handed over; Tenders with the company's documents; the Oncology telesales' Patients with the care groups); the stock under Look up; Me and Messages at the foot under a line, for everyone but the CEO and the Admin. The **CRR**: Accounts to call first (their accounts due to reorder), My accounts, My orders with Delivered, My calls, Collections. **CLIDP** and **Bidding** got their call list and phone log; the **TeleSales coach** is named "Sales Coach – TeleSales" (it said "Team lead"); a generic lead's call list and team orders come first. The **CEO**: Home, the Target sheet, Company, Messages; Reports (customers, channels, calls, sales performance, speed); the old system's ten reports in one folder, "Before this CRM" (no "Zoho"); the apps. The Admin's calls under Company; Inventory's "Zoho view" is "Books view". **My hospitals**: a new customer says "New: Management checks it" (their papers, once) until Management has; nothing after. **Hospitals to call** (and every call list) shows the last visit done there, by whom, and the next one planned. Every link of 12 logins opened in the browser (the CEO, the Admin, Inventory, a Hospital CHC, an Rx CHC, CLIDP, CRR, NBD, Bidding, Oncology telesales, PAP, the TeleSales coach): 330 pages, no failed read, no page error, no blank page.
- 19 Nov (133), Aryan: "Messages is cut off at the top on every screen: what checking did you do?"; "Go here first: why do the ones who owe money come first?"; "the demo data: some people in, some not, someone in Management late, someone early: a colourful CEO Home"; "a user book (a playbook) as a PDF, with each person's login by the hierarchy at the end; then make it live". Found: the Messages page (and the company tree) pulled itself up over the "‹ Messages › Needs you" trail the shell draws above every page; the walk had looked for errors and blank pages, not for one thing covering another. Fixed (those two pages draw their own heading, no trail), and the page walk now measures each page too (covering what is above it, under the top bar, wider than the screen, a button cut off), at the desktop and the phone's width (a Hospital CHC, an Rx CHC, CLIDP, CRR at the phone's width: no problem). Go here first: the hospitals due to reorder first, the biggest buyers first; then at most two whose money is 60 days and more overdue ("they owe us: collect on the visit"). The phone's bottom bar says "New order" under the + (it said "Create Ne…"); Go here first's buttons go under the name on a phone. The CEO's company at a glance: **Who's in today** (on time, late, not in, on leave, each its colour, as HR reads the day: start, grace, leave, rest days), each department as one coloured bar, the first in, the late ones with their minutes, Management's, Finance's and Dispatch's people started at their desks, and this week day by day. `scripts/demo-attendance.ts`: this week (16 to 20 Nov) for every active person but the CEO and the Admin, most in on time, some late, some not in, the same each run; a day the person signed in themselves is kept; every row marked "Demo · 20 Nov walkthrough"; `--remove` takes them off before going live.
- 19 Nov (134), Aryan: "tidy the code's folders; if there's even a 0.1% chance something breaks, don't": the web app's screens moved from one `pages/` folder into their area's folder (orders/, sellers/, hr/…), only paths changed; three files nothing used removed. Checked byte for byte (the same JavaScript built), 457 pages on 20 logins before and after, API 433/433, A-to-Z 43/43.
- 19 Nov (135), Aryan, after signing out of someone's screens: "Management shows Leads & enquiries, the Online desk's whole screen; Management sees only what comes to it"; "why would Management create an order? Veronica places no orders"; "the menu's scroll runs on into the page"; "Dispatch: what to pack, what to ship isn't clear; who marks delivered, who marks the COD money; at the top the orders come for dispatch, then what was packed and sent, then delivered, with filters for COD, prepaid, 30/45 days; and what does Finance do then"; "for speed, never make a report wrong: slow is fine, wrong is not". Done: **Leads & enquiries and the Inbox are the Online desk's** (with the CEO and the Admin): Management reads the case of an order that came to it, not the desk; **Management places no orders** (the API refuses; no New order anywhere for it); a sign-in after someone else's lands on the new person's Home, not on the page the last one had open; the menu keeps its scroll to itself. **Dispatch**: three stages, 1 To pack & ship, 2 On the road, 3 Delivered (30 days), each order with how it is paid (cash on delivery, prepaid, on terms) and filters by it; Dispatch marks an order delivered only with the photo of the signed receipt; on a cash-on-delivery order it notes how much the rider or courier collected and who has it (on delivering, or later from Delivered); **Finance** sees that note on its due payments and records the payment once the money is in the bank, and collects the orders on terms when they fall due. Migration 0115 (the cash note on the order).
- 19 Nov (136), Aryan: "the order page is 3,000 lines: make it so a change doesn't break it": split into the page and one file per desk's step (orders/steps/), code moved word for word; the built app's 2,356 pieces the same before and after. Then: "Approve beside each check, inside the column, not on another page"; "each of the four its own approve: Documents, Medicines & price, Stock & warehouse, Customer & licence"; "what the system finds fine is ticked by itself"; "Undo for about 60 seconds"; "send back per check: a price problem goes back as a price problem"; "Finance's checks with short details, like Management's"; "Dispatch's old design was fine"; "why are Online orders a system of their own? make them like every channel"; "Takes most is clutter". Done: **Management's column**: a check the system finds fine is ticked by itself; one it found something on has its own **Approve** and **Send back** in its row (the send back starts with the check's name and what was found); approving the last one approves the order (each approval kept with who and when, migration 0116; cleared when the order is sent back, taken back or changed); with nothing found, the last row is the one **Approve order**; **Undo** for 60 seconds after (the existing take-back: only while Finance hasn't checked, nothing is packed and no money is on it). **Finance's column**: its four checks (payment, papers, dues, credit) with a few words each, Hold on one with a problem, and its button. Dispatch's order page as it was. **Online orders like every channel's**: Management sees all the checks (a case's label isn't read as a MedRep's note), Finance checks them and records their money, Dispatch marks them delivered (and notes cash on delivery); the Online desk keeps the case, the quotation, the papers, placing the order and the follow-up.
- 19 Nov (137), Aryan: "on Finance's page, on top only what is Finance's: papers not complete, payment not right; Not yet with Finance, With Dispatch are All orders' in Look up; same for Management and Dispatch; keep the old look (the dot, the tick)"; "All channels shows only six: why?". Done: each desk's top row is its own: **Management** Needs you · Documents · Medicines & price · Stock · Customer & licence · Sent back · On hold · ✓ Approved today; **Finance** Needs you · Payment · Papers · Dues · Credit · On hold · ✓ Sent on today; **Dispatch** its piles · ✓ Delivered today. A check's tab shows the orders waiting on the desk with something on that check. All orders keeps every stage. The channel list now has every channel (it showed only those with orders).
- 19 Nov (138), Aryan, on the order page: "Medicines & price has a free-stock column: it is the stock check's"; "why an Approve row at the end?"; "Finance: Payment, Papers, Dues, Credit, I don't understand; no Approve here like Management's? Where do I click Payment? Payment proof, Finance check, Paid listed again, too big"; "under each of Management's checks, the main facts, as Finance has"; "does an Online customer give a PO?"; then "the MedRep knows whose order it is: pick it first, as the Online case's GL, PWD and Regular, and the whole order follows it". Done: **Management's column** is its four checks only (no fifth Approve row): each says what it found ("2 medicines at list price · ₱12,400", "In stock · ships from Main", "Licence till 3 Mar · owes nothing"); what the system finds fine ticks itself, Documents always waits for Management's own look; Approve and Send back sit in the row; the last Approve approves the order; Undo for a minute above the checks. Free stock moved from Medicines & price to Stock & warehouse. **Finance's column** is one list like Management's: Payment (its button in the row: Confirm payment when paid first, Approve for cash on delivery or credit, which makes the invoice and sends it to Dispatch), Papers, Owed before, Credit limit, then Paid after delivery; each row opens its part on the right; what the system found gets Approve or Hold in its row (kept with who approved, migration 0117), and Payment's button works once the rest is fine. The separate box and the second list are gone; the board says the same words. **Order type, picked first** (migration 0118): Patient · Senior / PWD · Guarantee letter · With their PO · No PO, offered in the Division's order (a hospital Division's business types first, a patients' Division's patient types first). It decides the papers: a patient's type asks the prescription and the patient's ID (for a hospital or a doctor it is an order for one patient, so the old "for one patient?" question is gone); Senior / PWD asks Senior or PWD with their ID number and gives the law's price (no other type has it); Guarantee letter asks the letter; With their PO asks the PO number (it goes on the invoice) and the PO paper; No PO asks nothing more. Only the prescription stops the form (as before); the type's other papers show as needed on Management's Documents check, which decides. A patient never orders as a business; a patient's own order never shows a PO (so no PO for Online customers). The Online desk's orders take their case's road as their type. Orders placed before types keep the old rules (a PO needed only when Zoho says it came as a Hospital PO or a bidding order).
- 19 Nov (139), Aryan: "the old CRM's link to the 2MG website: stock, points; study it and make whole what is missing"; "does the website's stock come from our Inventory, and its price: a separate field?"; "an Add points option: we type the points and they are theirs". Done (section 7.3): the website's progress answer in its own shape (it showed "Progress unavailable"); the stock link (the old catalogue push: SRP, patient price, pieces sellable on the shelf, only what changed, every ten minutes; the website's old medicine ids kept); points on website orders checked as the old CRM checked them; the confirmed message with the points earned and the points link; "quotation_sent" for GL customers; "shipped" again with a late tracking number; a website's present secret kept when connecting; "Open in the CRM"; a script to bring the old wallets, histories, sign-ins (same passwords), holds and open website orders over (read-only on the old database; to run at the switch on Aryan's word). **Add points** (Points page, the Admin and the CEO): a mobile number and the points; a number with no points yet gets its account. Stock comes from this Inventory, prices from Finance's list (SRP, patient); no new field, except a GL price if the agencies pay another price (asked).
- 19 Nov (140), Aryan, with the hub's MedRep screen: "a hospital MedRep who gets a prescription order can't change the Division; make it universal as the hub's, then better"; "a B2B order: the hospital gives a PO, we map its prices against ours, keep it as proof, then deliver; the MedRep should make the PO on the phone, print it there, the hospital signs, he takes its photo into the order"; "every MedRep's screen: what came from which channel"; "the right data to the head and manager"; "the CEO's Sales this month: no 3 more, all of them; Orders right now has empty space". Done: the Division opens on their own and any other is a pick away (the API no longer refuses it; the order stays theirs); the order types and the customer list follow it; **Purchase order** on a business's order: printed from the order (buyer, supplier, their PO number, the lines and prices, the total, signature over printed name, position, date, the buyer's stamp), its photo added on the order as their PO; on an order With their PO and no PO yet, the order says so with Print and Add photo; a line's other price reads "Their PO price" against ours, Management decides. The hub's own rule for what a Division brings (run locally from Aryan's copy, 19 Nov; its OrderForm divisionRule): HOS Hospital / N/A; B2C MD Telesales / B2C; CLIDP CLIDP / ON SITE; B2B CRR or NBD / ON SITE; B&B, URO, STC MD Telesales with their location as the Headquarter; a guarantee letter's order in those five is Telesales / Telesales, asks its programme (DSWD, PCSO, Office of the President, Other: the Source) and the letter itself; the prescription Divisions (B2C, STC, URO, B&B) carry the prescription or say why (Management reads it in Documents). A Headquarter on every order (migration 0122), on the order and its Sales Order. Their Home and My orders: this month's orders by Division. The A-to-Z walks an order With their PO to its invoice (the PO's number on it) and checks an order under another Division stays the MedRep's (his lead and head see it). CEO Home: every channel and the whole Collected list, open; "Orders right now" adds how long each desk takes, under the donut.
- 19 Nov (141), Aryan: "the GL price isn't known before: the agency writes on the letter how much it pays for our quotation; at the end we write that we got this much"; "a MedRep picks CLIDP: does Management see CLIDP and the papers that go with it, and Finance?"; "is the data reaching every team lead, head and manager from the people under them?"; "the company tree: make it as the photo I sent (the old one: its colours, its size, zoom, hover shows its data) and open it full screen". Done: **a guarantee letter's order** keeps the quotation's prices, and the letter's number and the amount it approves are written on the order when the letter is in (the MedRep, Management or Finance; migration 0123); the order and Finance's Payment show what the letter pays against the order; there is no GL price list (the website's GL price is the patient price, the quotation's). **The Division** shows as a chip on Management's and Finance's cards and on the order, and the papers it asks for follow it (a CLIDP order from a Hospital MedRep checked on Management's page: CLIDP, CLIDP / ON SITE, its papers). **Who sees what**: a new data check, "Everyone reports to the lead the chart gives them" (every lead's and head's screens read that line), 0 problems on the real data, with the other 17. **The sales organisation** opens full screen (Esc or × to leave, ⛶ for the browser's whole screen): the old tree's look (the CEO dark green, the heads, the channels in mint, each coach, the people; % of the month's target in green, amber or red, the pace mark), Open all, Heads only, Every team, drag to move, the wheel or − / + to zoom, Fit, a hover card with the figures, a press opens the side panel (target, achieved, balance, today, people, territories, best first); and an **Org chart** look, top down, each head's channels as coloured rings, each coach's ring, their people listed with their territory and %.
- 19 Nov (142), Aryan, with the sales tracker: "treat it as God: the company is exactly as it is written"; "put the Admin panel's Channels in the CEO's"; "the sign-in page: where do team leads sign in, where do heads?"; "an app per division: Hospital, RX, every channel, a press opens all of its data"; the stock report made in Zoho today: "ours should have this and more, downloaded in one click". Done: **HOSP** as a channel box under Vanessa over the five hospital teams, in the tracker's order (scripts/align-org-to-sheet.ts; applied on the local data, and on live on Aryan's word the same night); the **sales organisation** reads in the tracker's levels (Head → Channel → Manager → Sales person; boxes without a lead fold into their manager; CLIDP shows Subir, MT Mhalou; only seats with a target or a sale); **Channels** in the CEO's Company folder; the **sign-in page** has MedReps, Team leads and Heads as their own doors; **Divisions** (CEO): each head's channels as tiles with manager, people, sold of target, a press opens the channel's page; the **stock report** (Inventory): every batch with the Zoho report's columns and more, downloadable as Excel in one click.
- 19 Nov (143), Aryan, with the order form's Division list: "I thought we had 7 or 8 channels; how did so many Divisions come? why did you make so many?"; "in Heads put the heads, in Team leads the team leads, by name: one password, then all the heads come, press one and their page opens with their team's data"; "wasn't the data under each head already built?" (yes: each head's and lead's own login shows their people, the Admin tree decides; only the door was new). Done: the **Divisions are the tracker's eight channels** everywhere (order form as one row, Management, Admin's Channels, who approves what); older orders, channels and approvers moved to their channel (migration 0124); each seat's own Division read from its box (Honey's MD Telesales people now MD Telesales, not TeleSales). The **Heads** and **Team leads** doors: the company's password once, then the names (team leads under their head, in the chart's order); a press signs that person in with their own login, so they see what their own sign-in shows; someone with a password of their own isn't listed and uses My own login; five wrong passwords close the door for 15 minutes. Their portal pages show their seats and counts (titles only before sign-in). Checked: 458 API tests, A-to-Z 43/43 on the real data's copy, data checks 18/18.
- 19 Nov (144), Aryan: "Team leads: Under Vanessa, under Javed, under Subir; there was no Under Mhalou"; "when the head signs in they see it right there, big: hover on RX and its details show, press it and Honey shows, her team, what it does and where; Subir: B2B and Domino's team, BID (which hospitals they bid at, the next target), CLIDP (which pharmacies we went to, who agreed); Vanessa: HOSP and its five team leads; Mhalou: MT and her two"; "B2B is CRR and NBD: put one or two in CRR, the rest in NBD, we decide later"; "no icons (the B2B chip, JD before Domino), for everyone"; "only numbers show: the CLIDP page with the pharmacies, who approved us and the rate; the bid report: where they bid, what the others quoted, ours approved or not, why, how low it went"; "do it with full research and a fitting left menu for each". Done: the **Team leads door** lists the tracker's managers under their head, a head who leads sellers with a target first under their own name (Under Malou: Malou, Modern Trade; Subir for CLIDP and BID). The **heads' and team leads' Home**: each channel a big tile in the tracker's order (sold against target on pace, manager, people, orders, owed), hover for the details, a press opens its managers (a press narrows to one team), each person's month and the channel's own work for that box; under it the **team's customers** (where it sells, due, late, stopped against each account's own gap, owed, the last call); "Whole tree" shows every level. The channel cards (B2B, CLIDP, Rx field, district, B2C, tenders) narrow to the box picked. Heads are named "Head". **B2B sides**: Claire's B2B seat into CRR ("CRR – Mindanao"), the four new seats into NBD (scripts/align-org-to-sheet.ts; local; live on Aryan's word). No chips or initials on these screens. The research is in docs/CHANNEL-WORK.md. Next: the CLIDP page (approached → agreed → listed, the rate, the certificate), the bid report (every bidder's price, the reason, the lowest), then each team lead's and MedRep's screen and left menu, channel by channel.
- 19 Nov (145), Aryan: "the not-done list was the main thing; the hospital one too, RX Business too; the MedRep's screen: as he selects, the relevant things come; build it, researched, nothing wrong or missing." Done, channel by channel (docs/CHANNEL-WORK.md): **a press on a person** on a lead's Home opens what that person sees (read only, back to the lead; a lead only over their own people). **BID**: the bid report (/tenders/report): every bidder's price read at the opening (a total or per medicine), the lowest, our place and gap, won/lost/failed with the reason in fixed words, by agency, why we lost, securities still out (bid, performance, 1% retention), late deliveries with the 0.1% a day penalty, bids coming up; on the tender, the bids read and the securities; this month's losses counted right (migration 0126). **CLIDP**: the road with each pharmacy or distributor (approached → interested → agreed with the rate per medicine and the agreement → listing filed → listed → ordering, or declined with why), the price each really pays, listings, reorder state and money owed (migration 0127); the coach's volume on pace and the team card's owed now count Zoho's invoices too (they showed ₱39 and ₱0). **HOSP**: the hospitals board (/hospital-board): 2MG's accreditation at each hospital and its end, our medicines on its formulary (asked by a doctor, decided by the P&T committee), buying against its own gap, open orders, money owed, visits and calls (migration 0128). **RX**: prescriptions and letters (/rx/business): each person's day and month (prescriptions, doctors, first-time ones, value; this CRM's orders and Zoho's history), the doctors prescribing most, guarantee letters by agency from received to paid. Each on the seller's Home, the lead's and head's channel panel, and the menus. Checked: 465 API tests, A-to-Z 43/43, data checks 18/18. Next: MD Telesales, TeleSales, B2B, MT; each Division's own fields on the order form; each seat's left menu.

- 19 Nov (146), the rest of 145's list. Done: **TeleSales and MD Telesales** (Reynan's and Honey's panels): each seller's calls today and this month, those that reached someone and ended in an order, callbacks due (folded into one note until anyone logs calls), orders this month from this CRM and Zoho, new customers against repeat ones. **B2B**: each NBD and CRR seat's real accounts from the invoices (this CRM's and Zoho's), vacant seats with customers too (Pillow's still has 41 buying): buying in 90 days, opened (first order this month), activated (second order this month), one order only, no FDA licence on file; CRR against NBD sold; what the accounts owe by days past due (the part on vacant seats said); the pipeline's columns only once it is used. **MT**: the chains are Modern Trade's areas' customers and every customer its seats invoiced (Arlene's Mercury branches); each chain's money with MT (this month, 12 months, owed and how old), what it deducted from its payments by why (Finance records it with the payment since 18 Nov; the old note said it wasn't in the CRM) and sent back; Malou's "Chains" opens them (it opened her own area's two). **A lead's or head's four figures** (sold, today, orders placed, stopped) are now their boxes' as the target sheet counts (vacant seats and their own included), so they add up to the channels under them (Malou ₱0 against ₱9,100; Vanessa ₱5.29M against ₱5.80M; Jessa's and Subir's targets ₱0.5M short before). **The order form** shows, once the customer is picked, what its channel keeps on it: no FDA licence on file, a hospital's accreditation and our medicines on its formulary, a chain's listings, a pharmacy's agreed CLIDP prices; for an agency or hospital with a tender won and no order yet, which award the order delivers (the tender keeps the order). Facts only, nothing stops an order. **Menus**: Reynan (TeleSales by phone, beside his Government Bidding Coachee seat): no field visits, Tenders, Bid report, Documents, and he may record tenders (anyone holding a bidding seat may); Honey (leads RX Business's field CHCs too): the Rx field team and its visits. The account cities read as one however typed. Checked: 470 API tests, web build, A-to-Z 43/43 and data checks 18/18 on a fresh copy of the real data. Local only; live on Aryan's word.
- 20 Nov (147), Aryan: "push live", then "run it on live". Live = 0bec0255 (migrations to 0128 ran on deploy). The **B2B sides** on live (scripts/align-org-to-sheet.ts --live --apply, after a dry run that showed only them): Claire's B2B seat into Client Retention & Reorder as "CRR – Mindanao"; the Dhon, Pillow, Charle and Mani Mishra seats into New Business Development as "NBD". The dry run after says nothing to change; live data checks 18/18.
- 20 Nov (148), Aryan, with the CEO's Divisions and the sales tree on live: "where is Mhalou's department; she is missing in many places"; "one place where I finalise who is under whom and who reports to whom, where I remove someone or put them under another, and the whole software uses it; make the tree with the zoom the main one"; "Jimmy shows under Subir but you say he approves: your own words contradict". Done: the **Company tree** (was Sales organisation, `/company/sales`; first in the CEO's and the Admin's menu) is the one place: press a box and its panel says the seat, whom it reports to, the team it leads or sits in and the screens its login gets, and the CEO and the Admin change it there (move or change the job, add someone under, fill or close a seat, no longer with us, see their screens; a team's name and place, a team under it) with Teams & people's own windows; saved, the tree writes each person's boss, role and channel as before (org/service.ts projectOrg), which every screen reads. **Every selling seat shows** (a MedRep's, the Online desk's, a lead's, a head's), an empty one as VACANT, with or without a target or a sale: Mhalou's Modern Trade and her two empty seats are on the tree, Divisions and the heads' Homes (they were hidden: no target, no sale on live). A seat with a team lead's or head's screens that leads no team says so on its panel (Jimmy's Government Bidding Admin, Saurav's second coach seat in Mindanao). The CEO's Reports "Channels" is named Sales by channel (Company → Channels is the Admin's page). Open: who approves a bid price (Jimmy by his seat's work today; Subir leads BID on the tree). Local only.
- 20 Nov (149), Aryan, with the November target sheet again: "forget the organisational chart: this sheet is the master of the company, who is under whom and what work they do"; "one Edit button on top of the tree, the panel shows the normal data otherwise"; "one place must decide who gets which module: I change a person's place, the module follows"; "the Jimmy question: the sheet answers it". Rules: **the target sheet is the master** (Head → Channel → Manager → Sales person); **the screens follow the place on the Company tree**: a team lead's or head's work goes only with the seat that leads its team, and a seat that leads a team is never a MedRep's (org/service.ts checkLeadWork, on adding a seat and when a seat's work or lead changes). **A bid price is approved by whoever leads a Government Bidding box on the tree** (the sheet's BID manager, Subir) and the Admin, no longer by a seat's work and channel; the bidding team keeps the company's papers. **Jimmy** is a sales person of BID as the sheet's row (scripts/align-org-to-sheet.ts, a new step; local; live on Aryan's word): a seller's screens, his tenders as before. The Company tree has **Edit positions** on top: off, a box's panel is its figures; on, the changes. Open: the sellers on the tree who are on no row of the sheet (Benjie, Arron, Jomari, Saurav, Fhaye, Eloisa/Yza, Reynan's Government Account seat, MD Telesales' Ailyn, Emmanuel, Khalygen, Mitzi); a B2B seller's NBD / CRR / CLIDP desk and a bidding coachee's still read the seat's title, to be read from the box next.
- 20 Nov (150), an outside review Aryan asked for (ChatGPT) found three bugs; each checked in the code, fixed and kept by a test (`src/checks/review-fixes.test.ts`, each fails without its fix): **money totals** over ₱21.47M stopped the company dashboard (sums of centavos cast to a 32-bit number): every total over many orders, invoices or payments is now read as a wide number (company and team KPIs, a customer's lifetime, Finance's aging buckets, today's collections). **Manila's date** for "who holds which seat today" everywhere (the session, a lead's team, look-as, tenders, attendance, the portal, the company overview): the database's own date (UTC) is Manila's yesterday from midnight to 8 AM. **Look as is strictly read only**: opening a desk's team no longer gives its waiting orders out in the looked-at person's name, and opening an Online case no longer marks it opened (it counts for reply time); a scan of every GET found no other write. Also true from the review, not changed (a proposal each, on Aryan's word): one 2.5 MB web bundle (600 KB compressed) loaded whole on the first visit; three files of 2,800 to 3,200 lines; no web tests and no CI; the books' reconciliation with Zoho waiting on its Account Transactions report. Found beside it: a single order, invoice or payment is stored as a 32-bit number, so one can't pass ₱21,474,836.47 (Zoho's biggest ever: ₱12.5M). Checked: 473 API tests, both apps type-check, A-to-Z 43/43 and data checks 18/18 on a fresh copy of the real data. Local only.
- 20 Nov (151), Aryan: "slow load is no problem; nothing you change may go wrong in reports or data, many things are interconnected." So no page-by-page loading. Checked instead: every report screen (179 with the 8 biggest customers' pages and statements) for 24 people, old code (d36b2a76) against new (f717157e) on two copies of the same real data: 739,323 numbers, every one the same; the only line that moved is the CEO's attendance glance counting Malou (two lead seats given the same day) under Modern Trade instead of Finance: the pick had no tie-breaker and could come out either way. Every "which seat" lookup now breaks a tie by the seat given first (the seat that decides their screens). 473 tests.
- 20 Nov (152), Aryan: Vercel Analytics, and "put dummy data on live too, in all of them; the real data when we properly go live". **Vercel Web Analytics** on the web app (`@vercel/analytics`, the SPA rewrite leaves `/_vercel/` alone); live. **Demo data on live for every channel**: `scripts/demo-live.ts` now also gives TeleSales (Aila, Sheena), B2B (Floremel, Faith), BID (Angel), CLIDP (Nicka), RX (Antonette, Kevin), MD Telesales (Ailyn, Mitzi: demo doctor names) and Modern Trade (Arlene's empty seat, placed by Malou) their orders through every desk; `scripts/demo-channels.ts` (new) adds each channel's own records: calls with callbacks due, four BID tenders with the other bids read (lost, won, opened, coming up), CLIDP's road with rates (approached, interested, agreed, declined, ordering), hospital accreditation and formulary, MT listings and a listing fee deducted from a payment, prescriptions. Tried first on a local copy made to look like live; on live: 70 demo orders, 53 demo customers, data checks 18/18. All of it is marked ("Demo · 20 Nov walkthrough" on the customers, "Demo · " on the tenders, "Demo" on calls) and must be closed (cancelled, dropped, archived; nothing deleted) before the real go-live; the closing script is still to write. RX NCR 1 has no area on live (skipped).
- 20 Nov (153), Aryan: "setup its Dockerfile to live into our bishnoi-one-server; api and web their own Dockerfile". `apps/api/Dockerfile`, `apps/web/Dockerfile` (+ `apps/web/docker/nginx.conf.template`), `docker-compose.yml`, `.dockerignore` (section 10.4). Not built here yet (no Docker on this computer); Render and Vercel unchanged.
- 20 Nov (154), Aryan: "production-ready .env of both, their ports, and the setup for the Coolify server". `apps/api/.env.production.example` (every setting the API reads, what it is, which are required), `apps/web/.env.production.example` (`API_UPSTREAM`), docs/DEPLOY-COOLIFY.md: Postgres, the API (port 4100, no domain, container name `crmnew-api`), the web app (port 80, the domain). nginx now finds the API through Docker's DNS each 30 s (starts while the API is down) and sends the upstream's own Host. Production refuses the embedded database, so the compose file gets its own Postgres. `SECRETS_KEY` must stay Render's if the live data moves. One API container only (channel reading isn't shared).
- 20 Nov (155), Aryan: "SEFMED's app is very good; make our own as a separate app for now, every screen working the same way, two sides (the MR's, the team lead's), one team lead who sees everything; keep it simple, tie it to the CRM later." **The MR App** (section 22, docs/FIELD-CHECKLIST.md): its own people, clients, days, visits with the five steps, orders booked, follow-ups, tour plan with revisions and deviations, expenses with SEFMED's heads, day report, the lead's team, approvals, call reports, attendance, map; migration 0129, `apps/api/src/mr`, `apps/web/src/mr`. Nothing else in the CRM changed. Checked: 12 new API tests (485 in all pass), the web build, and the whole day in the browser on a demo copy (start working, add visits, I'm here, Add order, close the call, day report with a missed reason, the lead's team and Mark seen). Questions 29–31.
- 20 Nov (156), Aryan, the same day: "build MR properly first, then integrate it into our existing MR pages as options of their own. MRs made orders in the hub and kept records on SEFMED: we join both. Same hierarchy: their team lead / manager approves, above that the head, above that the CEO." **SEFMED's work in the MedRep's pages** (section 22, docs/FIELD-CHECKLIST.md): the separate app's own people, clients and order booking are gone (migration 0129_mr_app replaced by 0129_field_work, never applied outside demo copies). Visits are the CRM's `visit` (+ *missed*), customers the CRM's (doctors = KOLs, hospitals, drugstores and distributors = KBLs) with a field profile beside them, *Add order* opens the CRM's Create New Order and the order joins the visit (`visit_order`, in the same step as the order), samples through the samples module, the tour plan is the CRM's `visit_plan`, expenses the CRM's field expense lines with SEFMED's heads. The company tree is the hierarchy: the person's team lead decides, the head may stand in, the CEO reads only; the lead's waiting items are on *To decide* too. Pages in the MedRep's *Visits* folder, the leads' *Team visits* folder and the CEO's and the Admin's *Field* app. The older visits report counts *missed* with skipped and spends the approved amount. Checked: 487 API tests, the web build, the A-to-Z walk on a fresh copy of the real data, and every field page in the browser as the MedRep, team lead, head, CEO and Admin on a demo copy (no errors; the CEO sees no decide buttons). Local, not pushed. Questions 29–30; 31 answered.
- 20 Nov (157), Aryan: "a MedRep comes, clicks here, the day starts; an order and he is in Create order; the Start up top must be the Start below; don't make two separate pages, Log a call just opens that one." **One way in, one Start** (section 22): *Log a call* opens My day; for a MedRep with My day in their menu the top bar's Start is Start working (field day + attendance in one) and End my day opens the day report while the field day runs; a call opened before the day started offers Start working in step 2. TeleSales, B2B, Bidding and the Online office keep the plain attendance Start. A bigger rework (everything on one Log a call page) was started from a side chat and dropped on Aryan's word: the pages stay as he liked them. Checked: web typecheck; in the browser on a demo copy as Joy (Rx CHC: Log a call → My day, top-bar Start → Start working → "In since" and the circle together, End my day → day report), Carlo (Hospital: a call before the day → Start working in step 2 → I'M HERE) and Ana (TeleSales: Start stays attendance only). Local, not pushed.
- 20 Nov (158), Aryan: "make KPIs of everything, each person's; the MR app's, the team lead's, the manager's; the KPI data on the CEO's Home; integrate, check, deploy live" (answers: every seller and lead, a lead their own card, the field on interim weights marked). **A KPI card for every seat** (section 23, question 32): new interim cards for B2B NBD and CRR, CLIDP, Modern Trade, Government Bidding (now also the Hospital Division's bidding coachee) and PAP; a lead's own card (team's cards 40, team sales vs target 30, day reports seen 15, joint field days 15) instead of only the team's average; **Field work** (calls a field day 30, coverage 25, frequency by class 20, tour plan kept 15, day reports sent 10) for every MedRep beside their channel's card, from the field's own records (Start working, visits, classes, the tour plan, day reports). Migration 0130 keeps a locked month per card; the 12-month average and the increment read the channel's card only; questions work on either card. Screens: My score shows both cards (interim marked), Scorecards lists each card's kind, its KPI points and the Field score; the CEO's Home has the month's **KPIs** card (sellers' average, below 60, each card kind's average, the field, the leads, best and lowest; Scorecards opens all); My day has a My KPIs tile. The playbook cards are unchanged. Checked: score tests (12), the whole API suite, both type-checks, the web build, and in the browser on a demo copy as the CEO, a MedRep and a team lead.
- 20 Nov (159), Aryan, with the hub's My Team screenshots and its formula: "what is a KPI? it comes out of some formula in the hub's code". **My KPIs, the hub's way** (section 23): My Own KPI and My Team KPI (sales without VAT line by line against target with the bar, with VAT and VAT, orders invoiced, new customers, orders raised, orders held, waiting for approval not counted, entered for others), Today · Yesterday · Pick a date · This month with the day's sales and invoices; on the MedRep's, lead's, online desk's, PAP desk's and CEO's (company) Home. `apps/api/src/kpis`, `apps/web/src/kpis/my-kpis.tsx`. Checked: 4 new tests (494 in all), the web build, the browser as a MedRep, a lead and the CEO; on a copy of the real data the company's November without VAT equals Sales performance's lines to the centavo (₱20,230,156.48), with VAT equals the CEO Home's sold (₱20,667,621.21) and the target the CEO Home's (₱57,269,136; 35.3%). The scorecards (158) stay beside it.
- **22 Nov 2026** Audit fixes (problems found reading the code, `docs/system/README.md`): a
  payment proof lifts only Finance's own hold, not one Management placed at that step; an order
  packed, unpacked and then changed no longer fails (migration 0131: an unpacked pick lets go of
  its line); pieces checked back onto the shelf by Dispatch and then not credited can't be returned
  a second time; a return goes back to the batch still picked; unpack and a restocked return tell
  orders waiting for stock; a website prescription or enquiry joins an Online desk case only (never
  a PAP case); the Online channel's MedRep can own a case; "seen" marks Online desk chats only;
  batch trace shows cost to the cost roles only; Finance's board no longer fails above ₱21.47M in a
  month; a sample acknowledgement must be a photo or a PDF. No business rule changed.
- **22 Nov 2026 (Aryan's rules)** Approve is blocked until every check is done: Documents read by
  hand always, and Medicines & price, Stock, Customer & licence whenever the system found something
  on them (the API refuses with "Check first: …"; what the system finds fine still ticks itself).
  Nothing skips Management: the Admin's own order waits for approval like every other. Over the
  credit limit stays a flag, never a block. A stock count needs no approval. An order stopped as an
  exception after it shipped can't be cancelled (the parcel is on the road: it comes back through
  Dispatch or as a return). The desk report's "Rejected" column is named "Cancelled", which is what
  it counts.
- **22 Nov 2026 (Books, Aryan's go)** A bill's line for a medicine with no account typed posts to
  Inventory Asset, not Cost of Goods Sold (migration 0132): the cost is counted once, when the
  pieces are delivered. Only bills made in the CRM change; Zoho's own bills keep Zoho's lines. Still
  open in the Books: past cost follows the batch's cost today; period locks don't cover the CRM's
  own invoices and payments.
- **22 Nov 2026 (Books, Aryan's go)** What stock cost is kept as it was on the day it moved
  (migration 0133: `stock_move.unit_cost`, set by the database on every move). When a batch's cost
  changes later (a landed-cost bill, more received at another cost), the difference on the pieces
  already gone is posted on the day of the change (`batch_cost_change`), so closed months stay as
  they were; the ledger and Gross Profit read the kept cost. No figure changed on the day of the
  migration. Transaction locking now covers the CRM's own money too: a payment or refund dated in a
  locked period is refused, and a payment of a locked period can't be taken off.
- **22 Nov 2026 (audit, second pass)** Checks are cleared when an order comes back to Management
  (resume, restore); Finance's undo takes off only that check's money and sends a credit or COD
  order back to its own step; the PAP head is told of each new PAP order; a customer's credit
  already used on a CRM invoice can't be put on a Zoho invoice again; a payment in a finished bank
  reconciliation can't be taken off or moved; the stock desk no longer reads customers' invoices and
  payments through the Books lists; an amount beyond what the database holds is refused plainly.
  Every finding and what became of it: `docs/system/README.md`.
- **22 Nov 2026 (Aryan: "a custom report on the CEO's page: anything about any person, the old
  history too")** Custom report, at `/custom-report` (the CEO's sidebar under Reports, and the
  Reports app): pick a person (those who left are in the list), any days, and tick the parts: orders
  placed, invoices, money received on their orders, visits, attendance, leave, the old system's
  invoices on the seats they held, and everything they did (the audit's list). Each part shows its
  totals and downloads as CSV; "Download all" gives one file. CEO and Admin only
  (`/api/reports/person`, `reports/person.ts`). Interim choices of mine: sales are the invoices of
  orders where they are the MedRep, with VAT; a part shows the newest 500 rows.
- **22 Nov 2026 (the order line run by hand on a demo copy)** One order from the MedRep to delivered
  and paid; holds by Management, Finance and Dispatch; send-back and fix; unpack; a shipped parcel's
  exception; cancel after approval; two returns (restocked, damaged on a paid bill) and the refund;
  the MedRep's day start, a doctor visit and an order from it; what the team lead and the head see.
  All behaved as the plan says. Two figures were wrong after a return and are put right: My KPIs and
  Sales performance now leave out pieces that came back and were credited (they showed sales
  without VAT above sales with VAT, and above By person, the CEO's Home and Finance's board); the
  Invoices page's balance no longer counts a refunded overpayment as owed to the customer. Known
  and left: the demo seed's two shipped orders have no picks (Data checks names them; demo only).
- **22 Nov 2026 (second hand run on the demo copy)** A patient's prepaid order (prescription rule,
  Finance's hold for proof, the proof bringing it back, confirm, undo, a failed delivery), cash on
  delivery, an Online desk case to a delivered order, a PAP case, one order from CLIDP, B2B, Rx,
  MD Telesales, Bidding, Modern Trade and Mindanao, leave and overtime, who sees payroll, and stock
  received, transferred and counted: all as the plan says. One gap put right: an order priced as
  another kind of buyer because Inventory has no price for the customer's own kind (a drugstore
  given the hospital price) is now a price finding for Management ("No drugstore price set"); a
  government buyer at the bidding price is not. Left for Aryan: Finance can confirm a prepaid
  order with less than its total (it goes to Dispatch with the rest "still to pay").
- **22 Nov 2026 (Aryan: "this sheet is the hierarchy; leave the organisational chart; build by
  the seat, not by the name; no confusion left")** Checked the Company tree against the November
  target sheet with a new read-only script, `scripts/sheet-check.ts` (the tree as Head → Channel →
  Manager → Sales person, each seat with its holder and its row; rows with no seat; selling seats
  on no row). The local data was 17 steps behind the sheet (the HOSP box over the five hospital
  teams, B2B's sellers in CRR or NBD, Jimmy as a seller of BID): applied with
  `scripts/align-org-to-sheet.ts` after a backup (`.data/pg.before-sheet-hierarchy-2026-11-22`).
  The one row with no seat, **RX | YZA** (E. Rodriguez, ₱823,030), is now the Rx seat of NCR 2
  (held by Eloisa Villanda; the holder is changed on the Company tree if Yza is someone else), so
  all 57 rows have a seat and the targets add to the sheet's ₱57,642,166. `scripts/a-to-z.ts`
  approves as the screen does since today (each check, then the order): 43 of 43 and data checks
  18 of 18 on a copy of the real data. Local only; live on Aryan's word. Open, for Aryan: the
  sellers on the tree who are on no row (Fhaye, Reynan's Government Account seat, Saurav, Jomari,
  Mitzi, Emmanuel, Ailyn, Khalygen, Benjie, Arron) keep their seats under their manager with no
  target; six seats the sheet names are vacant here (Dhon, Pillow, Charle, Mani Mishra, Arlene,
  Jasper); the sheet's Zamboanga row says VACANT while Maycarl Degamo holds the seat.
- **22 Nov 2026 (Aryan: "the business's name big, its head or manager smaller; the same thing is
  repeated in many places, it must be in one")** On the **Company tree** each box is named by what
  it is: the company, a business (Hospital Division), a channel (RX Business) or a team (NCR 1)
  big, with who heads or manages it small under it (`face()` in sales-tree.tsx: only how it is
  written; the tree's data, and the heads' Homes that share it, are as they were). **Divisions**
  names each business first the same way. The CEO's Company folder no longer lists the Admin
  panel's Channels or the second Company chart (the tree has "Org chart" and "Every team"; both
  pages stay at their addresses, Channels in the Admin panel); the Reports app's "By channel"
  opens the same page as the CEO's "Sales by channel". Found and left for Aryan's word, because
  it changes figures: the CEO's Home, Sales by channel and the Admin's Channels still count by the
  first eight channels (HOSP, RX, B2B, BID, PAP, TS, MT, ONLINE: CLIDP inside B2B, both telesales
  as one), not by the sheet's (RX Business, MD Telesales, B2B, BID, CLIDP, TeleSales, HOSP, MT),
  which the tree, Divisions and the Target sheet use.
- **22 Nov 2026 (Aryan: "move them": one list of channels, the sheet's)** The CEO's Home ("Sales
  this month") and the **Sales by channel** report now count by the target sheet's channels: the
  box straight under a business on the Company tree (HOSP, TeleSales, RX Business, MD Telesales,
  CLIDP, B2B Telesales, Government Bidding, Modern Trade's own), each with its manager and its
  business (`sheetChannelSales` and `SHEET_PLACE` in sales/service.ts; the report in
  books/insights.ts with Business, Head, Channel, Manager, people, vacant seats, customers, sales
  and what is owed). They counted by the first eight channels (CLIDP inside B2B, both telesales as
  one, PAP and ONLINE of their own). Sales by a seller tied to no seat are a last row, so the rows
  add up to the company's figure: checked on a copy of the real data against the invoices
  themselves (November ₱20,667,621.21, the year, what is owed and 619 invoices: the same to the
  centavo). Targets are the seats' (the sheet's, vacant seats too): each channel's equals the
  sheet's and the Home's headline is their sum, ₱57,642,166 (it read ₱52.8M: its people's targets,
  without the vacant seats'). The loader takes a target off a seat that is on no row of the sheet
  (Claire's ₱500,000 sat on her Mindanao coach seat as well as on her B2B seat and made HOSP's
  target too high). The first eight channels still decide each seat's screens and an order's
  channel; only these two lists changed. Local only.
