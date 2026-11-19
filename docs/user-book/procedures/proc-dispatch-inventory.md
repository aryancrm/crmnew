# Dispatch, Inventory and Buying: how to

Each task below is one procedure. Words in **bold** or "quotes" are exactly what the screen shows.

---

## Dispatch (the warehouse: pack, ship, deliver, returns)

### Sign in to the shared Dispatch desk and press Start

- **Who**: Pharmacy Operations: the Pharmacy Happiness Coach, the Company Pharmacists (Main, Cebu, Davao) and the Coachees.
- **When**: At the start of every working day, on the warehouse's shared computer.
- **Steps**:
  1. Open Bishnoi One and press the **Dispatch** tile ("Packing and delivery").
  2. In the box **Sign in to Dispatch**, keep the tab **Desk screen** picked.
  3. Type the company's password in "Enter the company's password" (no login ID) and press **Enter Dispatch**.
  4. The **Dispatch desk** opens. At the top of the left menu is **On the desk today · X of Y** with the desk's people.
  5. Find your name and press **Start** beside it. Your circle turns green and shows "since 8:02 AM · 0 open".
  6. If others have already started, only they are listed: press **+ N not started: Start someone** to see everyone, then **Start** beside your name. **Only those started** folds the list again.
  7. When you leave, press **Stop** beside your name.
- **What happens next**: The orders to pack and to ship are shared out at once among the people started, whoever has the fewest open first. Each card then says "<name> has it", and you get a message "<order> is yours to pack". When you press **Stop**, your open orders go back to the queue and are shared among those still started.
- **Good to know**:
  - A Start lasts for today only. One left on overnight is closed the next day.
  - Packing and shipping done on the shared screen is written in the name of the person the order was given to, so press Start before you work.
  - For your own things (payslips, leave), use the tab **My own login** with your login ID (disp2 to disp10) and password.
  - Press a name in the list to see that person's work. **Team figures** in the menu shows each person's hours, orders given, orders packed and time per order.
  - Not in the app yet: on the shared screen, **Delivered**, **It came back** and **Goods checked** (returns) are not written in a started person's name. They are written under the desk's own account. To keep your name on them, use your own login.
- **Screen**: `/` · login: Dispatch desk · scroll to: "On the desk today"

### See the orders to pack and ship

- **Who**: Dispatch desk.
- **When**: All day. The page refreshes by itself every minute.
- **Steps**:
  1. Press **Orders to pack & ship** (the desk's Home) in the menu.
  2. Read the four figures at the top: **To pack** (approved and invoiced), **To ship** (packed, waiting for the courier), **On the road**, **On hold**.
  3. Below, under **To pack and ship**, pick a tab: **Needs you** (everything at Dispatch), **To pack**, **To ship**, **Came back**, **On the road**, **Not yet with Dispatch** (still with Management or Finance), **On hold**, **Delivered today**.
  4. To find one order, type in "Search customer, medicine, order or address…". Use **All channels** to narrow by channel.
  5. Pick a look on the right: **Cards** (one card per order), **Table**, or **Board** (three columns, **1. Pack**, **2. Ship**, **3. On the road**, with **Delivered today** under them).
  6. Press a card to open the order. The buttons on the card do the next step: **Pack**, **Ship**, **Delivered**, **Hold** or **Came back**.
- **What happens next**: Each order moves to the next tab as you work it: To pack, then To ship, then On the road, then Delivered today.
- **Good to know**:
  - A "Keep cold" tag means a cold-chain medicine: pack it in a styro box with ice packs.
  - **Take it** puts an order in your hands so two people don't pack the same box. "You have it" shows on your cards. **Let go** frees it. **Take over** takes it from someone else, and the order's timeline records it.
  - In the **Board** look, cash-on-delivery orders show "Collect ₱… cash on delivery".
- **Screen**: `/` · login: Dispatch desk · scroll to: "To pack and ship"

### Pack an order (batches, warehouse, nearest expiry first)

- **Who**: Dispatch desk.
- **When**: An order is in **To pack**: Management has approved it and Finance has made its invoice.
- **Steps**:
  1. On the card press **Pack**. You can also open the order, go to step **Pack & ship** and press **Pack**.
  2. The window **Pack · <order>** says which warehouse it comes from: "From <warehouse>". Management chose the warehouse when it approved the order.
  3. For each medicine, the batch that expires first is already filled in, with its pieces: "<batch> · expires <month year> · <n> on the shelf".
  4. If the customer needs a longer expiry, pick another batch in the list. To split a line over two batches, press **+ Another batch** and type the pieces for each. Remove a batch with the bin icon.
  5. Check each line says "<n> of <n> picked" in green.
  6. If a "Keep cold" note shows, put those medicines in a styro box with ice packs.
  7. Press **Packed**. Under the button: "These pieces come off the shelf now."
- **What happens next**: The pieces leave the shelf by batch. The order moves to **To ship**, and the order's **Pack & ship** step lists "In the box" with each batch, its expiry, its warehouse and its pieces. The same batches print on the delivery receipt.
- **Good to know**:
  - Expired batches are never offered, and every line must be picked in full: nothing is half packed.
  - Packed by mistake, or the box must be opened again? Open the order and press **Unpack** under **Pack & ship**. Type a reason if you want ("Why (optional)") and press **Unpack**. The pieces go back on the shelf they came from, and the order returns to **To pack**.
- **Screen**: `/orders/208?step=dispatch` · login: Dispatch desk · scroll to: "Pack & ship"

### When there isn't enough stock to pack

- **Who**: Dispatch desk. Inventory moves stock if needed.
- **When**: In the **Pack** window a line shows in red: "Only N in <warehouse> that haven't expired. Move stock there first, or ask Management to ship it from another warehouse." The **Packed** button stays grey.
- **Steps**:
  1. Press **Close**.
  2. Check **Medicines & stock** (menu, under Look up) to see whether another warehouse has the medicine.
  3. If it does, move it there (see "Move stock between warehouses"). Then press **Pack** again.
  4. If no warehouse has it, open the order. At the foot of the steps on the side, press **Wait for stock** ("Hold it until what it needs is on the shelf; you are told when it comes in").
  5. Or press **Hold** on the card and pick **Out of stock** or **Not enough stock** (see "Put an order on hold").
  6. If it should go from another warehouse, tell Management: Dispatch cannot change the order's warehouse.
- **What happens next**: With **Wait for stock**, the order waits on hold with "Waiting for stock: …". You and the MedRep are told when the stock comes in.
- **Good to know**: Only Management changes the warehouse an order ships from.
- **Screen**: `/orders/208?step=dispatch` · login: Dispatch desk · scroll to: "Wait for stock"

### Ship by courier (tracking number now or later)

- **Who**: Dispatch desk.
- **When**: The order is packed (**To ship**) and the courier is taking it.
- **Steps**:
  1. Print the slip for the parcel: open the order, under **Pack & ship** press **Print address**, then **Print**. Stick it on the parcel.
  2. If the customer signs a receipt, print it too: **Delivery receipt**, then **Print** (in the Board look, **Receipt** on the card).
  3. On the card press **Ship** (on the order, **Ship** under **Pack & ship**).
  4. In **Ship · <order>**, keep **Courier** picked.
  5. Pick the **Courier**: LBC, J&T Express, Lalamove, Grab Express, 2GO, AP Cargo, Ninja Van, Flash Express, or **Other** and type it in "Which courier".
  6. Type the **Tracking number**. If you don't have it yet, leave it empty and pick why in **Not ready yet? Why**: "Waiting for the waybill", "Waiting for the courier to pick it up", "Courier not assigned yet", or **Other** (type it in "What is it waiting for").
  7. Read the **Deliver to** box (name, address, phone, "Keep cold" if needed) against the slip on the parcel. Tick "I checked the address slip on the parcel against this: name, address and phone match."
  8. Press **Shipped**.
- **What happens next**: The order moves to **On the road**. Its timeline says how it went and that the address slip was checked.
- **Good to know**:
  - The box can't be shipped until the address is ticked as checked, and until every piece was packed by batch.
  - Add the tracking number later with **Add tracking** (see below).
- **Screen**: `/orders/220?step=dispatch` · login: Dispatch desk · scroll to: "Pack & ship"

### Ship with our own rider

- **Who**: Dispatch desk.
- **When**: The order is packed and our rider takes it.
- **Steps**:
  1. Print the address slip and the delivery receipt as above.
  2. Press **Ship** and pick **Our rider**.
  3. Type the **Rider's name**.
  4. Check the **Deliver to** box against the parcel and tick the address check.
  5. Press **Shipped**.
- **What happens next**: The order moves to **On the road** with "Our rider · <name>".
- **Screen**: `/orders/220?step=dispatch` · login: Dispatch desk · scroll to: "Pack & ship"

### Hand an order over at the warehouse (customer picks it up)

- **Who**: Dispatch desk.
- **When**: The customer or their messenger collects a packed order at the warehouse.
- **Steps**:
  1. Have them sign the printed **Delivery receipt**, then take a photo of it.
  2. Press **Ship** and pick **Picked up here**. (On the order, **Picked up by the customer** under **Delivered** opens the **Delivered** window instead; fill it in the same way.)
  3. Press **Photo of the signed receipt \*** and choose the photo.
  4. Type **Picked up by** (the name on the receipt) and the day in **On**.
  5. Press **Picked up**.
- **What happens next**: The order is delivered at once ("Picked up at the warehouse"). It does not go on the road.
- **Screen**: `/orders/220?step=delivered` · login: Dispatch desk · scroll to: "Delivered"

### Add or change a tracking number later

- **Who**: Dispatch desk.
- **When**: A courier parcel left "tracking to follow", or the number was wrong.
- **Steps**:
  1. Press **On the road** in the menu.
  2. In the parcel's row press **Add tracking**. It shows only while a courier parcel has no number. On the order itself, **Add tracking** or **Change tracking** is under **Pack & ship**.
  3. Type the **Tracking number** and press **Save**.
- **What happens next**: The number shows on the order and in **On the road**, and the order's timeline records it.
- **Screen**: `/shipments` · login: Dispatch desk · scroll to: "On the road"

### A delivery failed (the parcel came back)

- **Who**: Dispatch desk.
- **When**: The courier or rider brings the parcel back undelivered.
- **Steps**:
  1. Find the order in **On the road** (menu), or the **On the road** tab on Home.
  2. Press **Came back**. On the order, press **Didn't reach the customer**.
  3. In **Didn't reach the customer · <order>**, type **What happened** (for example "Nobody at the address").
  4. Press **It came back**.
- **What happens next**: The order goes back to packed, still in its box, under the **Came back** tab, with "Came back: <reason>" in red on its card. Then either:
  - fix the problem and press **Ship** again (in the Board look, **Ship again**), or
  - open the order and press **Unpack** to put the pieces back on the shelf.
- **Good to know**: The courier, tracking and rider are cleared, so they are typed fresh when it ships again. The order counts how many times it came back.
- **Screen**: `/shipments` · login: Dispatch desk · scroll to: "Came back"

### Mark an order delivered with the signed receipt (and cash on delivery)

- **Who**: Dispatch desk. For an Online desk order, its agent may also mark it.
- **When**: The customer has the parcel and the signed delivery receipt is back.
- **Steps**:
  1. Take a clear photo of the signed delivery receipt.
  2. Find the order in **On the road** (menu) and press **Delivered**. On the order, press **Mark as delivered** under the **Delivered** step.
  3. In **Delivered · <order>**, type **Received by** (the "Name on the signed receipt").
  4. Set **Delivered on**. A future day is refused.
  5. Press **Photo of the signed receipt \*** and choose the photo.
  6. Add a **Note (optional)** if needed.
  7. Press **Delivered**. The photo uploads first; if it fails, press again to retry.
- **What happens next**: The order is delivered and shows under **Delivered** on **On the road** (and **Delivered today** when it was today). The photo is kept on the order as its signed delivery receipt. A credit invoice starts counting its days from the delivery day.
- **Good to know**:
  - No photo, no delivery: the app refuses until the signed receipt is on the order.
  - Cash on delivery: the Board look shows "Collect ₱… cash on delivery", and the **Delivered** step shows "How it pays: Cash on delivery". When you mark it delivered, the invoice falls due that day and the timeline says "Cash on delivery: ₱… to collect; Finance records it" (the Online desk, for its own orders).
  - Not in the app yet: Dispatch cannot type the cash it collected, and the **Delivered** window does not show the amount. How the cash and its proof reach Finance is not set in the app; follow the desk's practice.
- **Screen**: `/shipments` · login: Dispatch desk · scroll to: "Delivered"

### Put an order on hold, and take it off hold

- **Who**: Dispatch desk.
- **When**: An order to pack or to ship can't go on: out of stock, wrong item or quantity, an address or receiver problem.
- **Steps**:
  1. On the card press **Hold**. On the order, press **Put on hold** at the foot of the steps on the side.
  2. In **Put on hold · <order>**, press a ready reason (**Out of stock**, **Not enough stock**, **Wrong item or quantity**, **Address or receiver problem**) or type your own in **Reason**.
  3. Press **Put on hold**.
  4. To lift it later: press **On hold** in the menu, find the card and press **Take off hold**. The order's page has the same button.
- **What happens next**: The order stops where it is and shows under **On hold** ("Put on hold by Dispatch. Reason: …" on its timeline). Taken off hold, it goes on from where it stopped.
- **Good to know**:
  - Dispatch lifts only its own holds. An order held by Management or Finance shows under **On hold** too, but only that desk can lift it.
  - A parcel already on the road can't be held. Use **Came back** when it returns.
- **Screen**: `/dispatch/hold` · login: Dispatch desk · scroll to: "On hold"

### Check goods that came back on a return

- **Who**: Dispatch desk.
- **When**: Management approved a return whose goods are coming back. Dispatch gets the message "Return RET-… on <order> approved". The goods arrive at the warehouse.
- **Steps**:
  1. Press **Returns to check** in the menu (the tab **Goods to check** on **Returns & refunds**).
  2. On the return's card, press **Check the goods**.
  3. In **Goods back · RET-…**, for each medicine pick what came back:
     - **Good: back on the shelf**
     - **Damaged: write off**
     - **Not received**
  4. Read "To credit on the bill (Management decides)" and press **Goods checked**.
- **What happens next**: Good pieces go back on the shelf, into the same batch and warehouse they left from. Damaged ones are written off and do not go back. Management gets "goods checked, credit ₱…?" and decides **Credit** or **Don't credit**.
- **Good to know**:
  - Not received pieces are not credited. Damaged ones are credited, because they came back.
  - Check the expiry of what comes back: a good piece goes back into its old batch even if that batch has expired, and it then shows as expired on the shelf.
- **Screen**: `/returns?status=approved` · login: Dispatch desk · scroll to: "Goods to check"

---

## Inventory (medicines, prices, stock, samples)

### Add a new medicine

- **Who**: Inventory (the Supply Chain seat, login inv2). Others press **Medicine not available** to ask Inventory instead.
- **When**: The company starts selling a medicine that isn't on the list yet.
- **Steps**:
  1. Press **Medicines & prices** in the Inventory menu. The page is **Medicines & stock**.
  2. Search first, so you don't add it twice.
  3. Press **Add medicine**.
  4. Fill in **Name** (required) and **Strength**, **Molecule (generic name)**, **SKU**, **Form**, **One piece is a** (tablet, capsule, vial), **Pieces in a pack** (1 if only sold whole), **The pack is called** ("Box of 30"), **Category**, **Maker** and **Our brand**.
  5. Pick **Prescription** ("Needs a prescription" or "Over the counter") and **VAT** ("VAT exempt", "VAT 12%", "Zero-rated").
  6. Pick **Storage**: "Room temperature", "Cold chain: kept cold to the customer…", or "A cold-chain box (styro): Management types its price on each order".
  7. Tick "Never given as a sample (antimicrobials)" if it applies.
  8. Type the **Low-stock level, in pieces** (0 = never flag as low).
  9. Press **Add medicine**.
- **What happens next**: The medicine's own page opens. It has no stock and no prices yet. Stock comes in on a purchase order. Prices are set by Management (next procedure).
- **Good to know**:
  - Stock, costs and prices are all kept per piece.
  - The same name and strength, or the same SKU, is refused as already on the list.
  - To change details later, open the medicine and press **Edit**.
- **Screen**: `/medicines` · login: Inventory (inv2) · scroll to: "Add medicine"

### Set a medicine's price for each kind of buyer

- **Who**: Management, the CEO or the Admin only. Inventory sees the prices but can't change them ("Prices, promos and offers are set by Management, the CEO or the Admin").
- **When**: A new medicine is added, or a price changes.
- **Steps**:
  1. Open the medicine from **Medicines & stock**.
  2. In the box **Prices & promos**, press **Edit prices**. Or press **Edit · prices · promos** at the top, then the **Prices** tab.
  3. For each buyer (**Patient**, **Hospital**, **Doctor**, **Distributor**, **Drugstore**, **Bidding**), type the price in pesos for one piece.
  4. If a whole pack has its own price, type it in the **Whole <pack>** column. Left empty, a pack is its pieces added up.
  5. Leave a buyer empty ("Not sold") if that kind of buyer isn't sold to.
  6. Press **Save prices**.
- **What happens next**: Every new order takes its price from here, by the kind of customer. Promos and "Buy X Take Y" offers are on the next tabs.
- **Screen**: `/medicines/81` · login: Management (mgmt) · scroll to: "Prices & promos"

### Read stock by warehouse and by batch

- **Who**: Inventory and Dispatch. Management and Finance can read it too.
- **When**: Before buying, before packing, or when someone asks "do we have it?".
- **Steps**:
  1. Press **Stock by warehouse** in the Inventory menu.
  2. Use the tabs to narrow: **Medicines**, **Out of stock**, **Low stock**, **Batches expiring in 90 days**, **Expired on the shelf**.
  3. Press **All warehouses** or one warehouse's name to see only that one.
  4. Read each row: one column per warehouse, then **On the shelf**, **Promised** (on placed orders, not packed yet), **Free to sell**, **Coming** (on open purchase orders), **Nearest expiry** and **Status**.
  5. Press a medicine to open its page. There, **Free to sell** and each warehouse's figure are at the top, and **Batches** lists every batch: **Batch**, **Warehouse**, **Quantity**, **Expiry** ("In N days" when near, "Expired"), and the cost of one piece for those allowed to see costs.
  6. **Coming** (under Batches) shows what is on order, from whom and when it is due. **What moved** lists every receive, move, count, pack and return.
- **What happens next**: Nothing changes; this is reading only.
- **Good to know**:
  - To tell the sellers a medicine is out, low or back, press **Post stock news**, pick **What** ("Out of stock", "Low stock", "Back in stock"), add a **Message (optional)** and press **Post**.
  - Dispatch reaches the same pages from **Medicines & stock** in its menu.
- **Screen**: `/inventory` · login: Inventory (inv2) · scroll to: "Stock by warehouse"; and `/medicines/81` · scroll to: "Batches"

### Move stock between warehouses (transfer)

- **Who**: Inventory or Dispatch.
- **When**: A warehouse needs stock another one holds (for example, an order to pack from Cebu).
- **Steps**:
  1. Open the medicine (from **Stock by warehouse** or **Medicines & stock**).
  2. Press **Transfer** at the top.
  3. In **Move between warehouses**, pick **Batch, and where it is now** ("<batch> · <warehouse> · <pieces> · expires <date>").
  4. Pick **Move to** (the other warehouse) and type the **Quantity** in pieces.
  5. Press **Move**.
- **What happens next**: The pieces leave one warehouse and arrive in the other at once, in the same batch. The move shows under **Transfers** in the Inventory menu ("From", "To", "Pieces", "By").
- **Good to know**:
  - **Transfers** is a list only; moves are made from a medicine's page.
  - There is no "in transit" step: the stock counts in the new warehouse as soon as you press **Move**.
  - **Transfer** is grey when the medicine has no stock.
- **Screen**: `/medicines/81` · login: Inventory (inv2) · scroll to: "Transfer"; list at `/transfers`

### Correct a count; write off damaged or expired stock (adjustment)

- **Who**: Inventory or Dispatch.
- **When**: A shelf count differs from the system, or pieces are damaged or expired and must come off.
- **Steps**:
  1. Open the medicine and go to **Batches**.
  2. Press **Stock count**.
  3. Pick **Batch, and where it is**.
  4. Type what is really on the shelf in **You counted (the system has N)**. For damaged or expired pieces, type the count without them.
  5. When the number differs, **Why it differs** appears. Type the reason (for example "3 damaged in storage" or "Expired, taken off the shelf").
  6. Press **Save count**.
- **What happens next**: The shelf is set to what you counted. The difference, with your reason and name, shows under **Adjustments** in the Inventory menu.
- **Good to know**:
  - **Adjustments** is a list only; counts are made from a medicine's page.
  - Not in the app yet: there is no separate "damaged" or "expired" write-off. Both are done as a stock count with the reason. The warehouse list also has an "EXPIRED STOCKS" warehouse. Whether expired pieces are counted off or moved there is the Inventory head's call; the app doesn't decide it.
- **Screen**: `/medicines/81` · login: Inventory (inv2) · scroll to: "Stock count"; list at `/adjustments`

### Add stock that was not bought (opening stock, goods found)

- **Who**: Inventory or Dispatch.
- **When**: Opening stock, goods found in a count, a correction. **Not** for goods bought from a vendor: those are received on their purchase order.
- **Steps**:
  1. On **Stock by warehouse** (or a medicine's page) press **Add stock (not bought)**.
  2. In **Add stock without a purchase**, pick the **Medicine**, the warehouse in **Into warehouse** and the **Quantity**.
  3. Type the **Batch number on the box** and the **Expiry date**.
  4. Type **Why (optional)** ("Opening stock"). Inventory may also type **Cost of one, landed (₱, optional)**.
  5. Press **Add stock**.
- **What happens next**: The pieces are on the shelf in that batch and show under **Receives**.
- **Good to know**: An expired batch is refused. A batch number already on file with a different expiry is refused with "Check the box".
- **Screen**: `/inventory` · login: Inventory (inv2) · scroll to: "Add stock (not bought)"

### Trace a batch for a complaint or recall

- **Who**: Inventory, Dispatch, Management, Regulatory.
- **When**: A customer complains about a batch, or a maker recalls one.
- **Steps**:
  1. Press **Batch trace** in the Inventory menu.
  2. Type the **Batch number** from the box and press **Trace**.
  3. Read the top line: the medicine, its expiry, how many are still on the shelves and in which warehouse.
  4. **Customers it reached (N)** lists each customer with **Phone**, **Address**, **Orders**, **Pieces**, **Came back** and **When**.
  5. Press **Print** for a paper list, or **CSV** for a file to call from.
  6. **Every move (N)** shows every receive, move, pack and return of the batch, with the order and who did it.
- **What happens next**: Nothing changes. To stop the batch going out, count it off or move it (see the procedures above), and post stock news.
- **Screen**: `/inventory/trace?batch=BT25633A` · login: Inventory (inv2) · scroll to: "Customers it reached"

### Answer a medicine request

- **Who**: Inventory (the CEO and Admin can too).
- **When**: Someone pressed **Medicine not available** and asked for a medicine we don't have. The menu's **Medicine requests** shows a count.
- **Steps**:
  1. Press **Medicine requests** in the Inventory menu. **To answer** is open. The most asked come first.
  2. Each card shows the medicine, "we list it · N in stock" or "not on our list", how many times it was asked ("3×"), and who asked for which customer.
  3. Press one answer:
     - **Ordered**: ordered from a supplier ("Ordered from Hetero, here by the 25th").
     - **Added**: now in Medicines & stock ("Added as Tagrisso 80 mg").
     - **Can't get**: say why ("Not registered with the FDA here"). Required.
  4. Type the **Answer** and press **Send the answer**.
- **What happens next**: Everyone who asked is told, and sees the answer under "What I asked for". The request moves to **Answered**.
- **Good to know**: **Ordered** doesn't make a purchase order, and **Added** doesn't add the medicine. Do those first (see "Make and send a purchase order" and "Add a new medicine").
- **Screen**: `/inventory/requests` · login: Inventory (inv2) · scroll to: "Medicine requests"

### Send samples and gifts to reps

- **Who**: Inventory or Dispatch send them out. The rep's lead approves first.
- **When**: A rep asked for samples or gifts and their lead approved it.
- **Steps**:
  1. Press **Samples to reps** in the Inventory menu. The page is **Samples & gifts**.
  2. Under **Requests open (N)**, find the approved request ("Approved, to be sent").
  3. Press **Issue it**.
- **What happens next**: The pieces leave the default warehouse, unexpired, nearest expiry first. The rep is told "your samples are on the way" and marks them received. The **Reps** table shows each rep's samples and gifts held, received, given, doctors, and whether they counted.
- **Good to know**:
  - Medicines marked "Never given as a sample" are refused as samples.
  - If the warehouse is short, it says "Not enough unexpired … in that warehouse".
  - Not in the app yet: you can't pick which warehouse samples go from (always the default one), and there is no button to send samples to a rep without a request.
- **Screen**: `/field/samples` · login: Inventory (inv2) · scroll to: "Requests open"

---

## Buying (vendors, purchase orders, receiving, bills, payments)

### See what to buy again

- **Who**: Inventory.
- **When**: Every morning, or before placing orders.
- **Steps**:
  1. Press **To do & buy again** in the Inventory menu. The page is **Purchases**.
  2. Read the four tiles: **To receive** (orders still to come, late ones counted), **Received, not billed**, **Bills to pay**, **Vendor credits & advances**. Each opens its list.
  3. Under **Buy again before it runs out**, each medicine at or under its low-stock level shows **Free on the shelf**, **Low at**, **Sold, 30 days**, **Lasts** (days left), **Coming**, and **Bought last from** (vendor, price a piece, when).
  4. Press **Order** on a row to start a purchase order with that medicine and its last vendor filled in.
- **What happens next**: The new purchase order opens (see "Make and send a purchase order").
- **Good to know**: A medicine shows here only if it has a low-stock level. Set the level on its page (**Edit**, then **Details**).
- **Screen**: `/purchases` · login: Inventory (inv2) · scroll to: "Buy again before it runs out"

### Choose the vendor (compare last prices)

- **Who**: Inventory.
- **When**: Before making a purchase order.
- **Steps**:
  1. Press **Vendors** in the Inventory menu. Search by name, company, email or phone.
  2. Open a vendor. **What we buy from them** lists each item with **Orders**, **Pieces in all**, **Price last time** and **Last** ("The price last time, to compare before ordering").
  3. Do the same for the other vendors of that medicine and compare their last prices and dates.
  4. **We owe them** and **Their credits** show at the top; **Their records** has their purchase orders, bills, payments and credits.
  5. On the new purchase order, each line also shows "Last bought at ₱… from <vendor> · <date>".
- **What happens next**: Press **New purchase order** on the chosen vendor's page.
- **Good to know**: Not in the app yet: no one screen lists every vendor's price for one medicine side by side. Compare vendor by vendor.
- **Screen**: `/purchases/vendors/56` · login: Inventory (inv2) · scroll to: "What we buy from them"

### Add a new vendor

- **Who**: Inventory.
- **When**: Buying from someone new.
- **Steps**:
  1. On **Vendors** press **New vendor**. While making a purchase order, **New vendor** is beside the Vendor box.
  2. Type **Name \*** ("As on their invoices"), and if known **Company**, **Email**, **Phone**, **Mobile**.
  3. Pick **Currency they bill in** (PHP, USD, INR, EUR, CNY, SGD). Type **Payment terms** ("Net 30, advance…"), **TIN**, **Country**, **Website** and **Address**.
  4. Press **Add vendor**.
- **What happens next**: The vendor can be picked on purchase orders and bills at once.
- **Screen**: `/purchases/vendors` · login: Inventory (inv2) · scroll to: "New vendor"

### Make and send a purchase order

- **Who**: Inventory.
- **When**: Stock is low, a request needs ordering, or a tender needs stock.
- **Steps**:
  1. Press **New purchase order** (on **Purchase orders**, **Stock by warehouse**, the vendor's page, or **Order** on the buy-again list).
  2. **1 Vendor and delivery**: type the **Vendor \*** (or press **New vendor**). Under it: "Bills in <currency> · usually pays <terms> · what we buy from them".
  3. Pick **Deliver to \*** (the warehouse). Type **Their reference (optional)** (proforma or quotation number), check **Order date**, and set **Expected** (when it should arrive).
  4. Type **Payment terms** (the vendor's usual terms show as a hint). For a foreign-currency vendor, type **Pesos for one <currency> \***.
  5. **2 What we buy**: in each line type the **Medicine or item**, **Pieces**, **Price a piece** (the last price paid fills in by itself), and **Tax %** if any. Under each line: "Free on the shelf", "Low at", "already coming" and "Last bought at…".
  6. Press **Add a line** for more. An item that is not a medicine (packaging, a styro box) is bought, but no stock moves for it.
  7. **3 Notes and terms**: **Notes** ("Ship by air, cold chain…") and **Terms & conditions** ("Shelf life at least 18 months on arrival…"). Both print on the order.
  8. Press **Save and send**, or **Save as draft** to finish it later.
- **What happens next**: The purchase order opens (PO-…). **Ordered** is ticked and its **Coming** quantity shows on the medicines. Press **Print / PDF** to print it or save it as a PDF, then send it to the vendor yourself.
- **Good to know**:
  - **Save and send** does not email the vendor. It only marks the order as sent.
  - A draft is sent later with **Send it (issued)**.
  - **Cancel order** works only while nothing came or was billed. **Close the rest** stops counting pieces that will never come. **Reopen** undoes it.
- **Screen**: `/purchases/orders/new` · login: Inventory (inv2) · scroll to: "Vendor and delivery"

### Receive a purchase order (batch, expiry, warehouse)

- **Who**: Inventory. Dispatch can't receive purchase orders in the app.
- **When**: The vendor's goods arrive.
- **Steps**:
  1. Press **Purchase orders** and pick the **To receive** tab, or the **To receive** tile on **Purchases**. Open the order.
  2. Press the step **Received** on the left ("The order's steps").
  3. In **Receive what came**, check **Received on**. **Into warehouse** is the one on the order; if the order has none, pick it.
  4. For each line, type the pieces in **Came now** (**All** fills in everything still to come).
  5. Type the **Batch no.** exactly as on the box and pick the **Expiry**.
  6. Add a **Note (optional)** ("Two boxes dented, courier's waybill…").
  7. Press **Put on the shelf**.
- **What happens next**: The pieces are on the shelf in their batches and the receive (PR-…) shows under **What came in** and in **Receives**. Orders waiting for that stock are told. A part delivery leaves the rest "to come".
- **Good to know**:
  - An expired batch is refused. A batch number already on file with another expiry is refused: "Check the box".
  - Medicines come in whole pieces.
  - **What came in** shows each batch's cost at the order's price and "Landed now", once freight and other extra costs are added.
- **Screen**: `/purchases/orders/4208` · login: Inventory (inv2) · scroll to: "Receive what came"

### Record the vendor's bill (and extra costs like freight)

- **Who**: Inventory or Finance.
- **When**: The vendor's invoice for goods received arrives, or a freight, customs or airfare bill comes for those goods.
- **Steps**:
  1. Open the purchase order and press the step **Billed**. The tile **Received, not billed** on **Purchases** lists the orders waiting.
  2. In **Enter the vendor's bill**, type **Their bill number \*** (as on their invoice), check **Bill date** and set **Due**.
  3. For each line, check **Bill** (pieces, filled with what was received and not billed) and **Rate**.
  4. Check **Bill total** against their invoice and press **Save the bill**.
  5. For freight, airfare, customs, insurance and the like: on the same order press **Add extra cost** (box **Extra costs on these goods**). Fill in the **Vendor \***, **Their bill number \***, **Date**, **Due**, and lines (**Item or service**, **Account**, **Qty**, **Rate**, **Tax %**), then **Save the bill**.
  6. A bill not for goods (rent, a utility, a service): **Bills**, then **New bill**, and answer "No: a bill of its own".
- **What happens next**: The bill shows under **Bills** ("To pay", "Overdue") and on the order's **Paid** step. An extra cost is shared over the order's goods by value, so each piece's landed cost goes up.
- **Good to know**: The same bill number twice for one vendor is refused. A bill not yet paid can be voided with a reason (**Void**); it stays on the list, marked void.
- **Screen**: `/purchases/orders/4208` · login: Inventory (inv2) · scroll to: "Enter the vendor's bill"

### Pay the vendor

- **Who**: Finance (and the Admin). Inventory sees "Finance records each payment".
- **When**: A bill is due (tile **Bills to pay**, or **Bills**, then **Overdue**).
- **Steps**:
  1. Open the bill and press **Record payment**. Or use **Payments made**, then **Record payment**.
  2. In **Record a payment to a vendor**, check the **Vendor \***.
  3. Under **Their unpaid bills**, type what goes on each bill in **Put on it** (**All** pays it in full).
  4. Type **Amount paid (₱)** (empty means the sum put on the bills), **Paid on**, **How** ("Bank Transfer"…), **Paid from (account)** and **Reference** (bank reference, cheque no.).
  5. Add **Notes (for us only)** if needed.
  6. Press **Save the payment**.
- **What happens next**: The bills show part paid or paid, and the order's **Paid** step ticks when all its bills are paid. Anything paid over the bills shows as "Left as an advance", to use on their next bills.
- **Screen**: `/purchases/payments/new` · login: Finance (fin) · scroll to: "Their unpaid bills"

### Record and use a vendor credit

- **Who**: Finance (and the Admin). Inventory reads **Vendor credits** but can't add one.
- **When**: A vendor owes us back: goods returned, short or damaged, or overcharged.
- **Steps**:
  1. Press **Vendor credits**, then **New vendor credit**.
  2. Type the **Vendor \***, **Reference** (their credit memo, the return), **Date**, and for a foreign vendor **Pesos for one <currency> \***.
  3. Add the lines: **Item or service**, **Account**, **Qty**, **Rate**, **Tax %**. Add **Notes** if needed.
  4. Press **Save the credit**.
  5. To use it: open the credit, press **Use on bills**, type the amount in **Put on it** for each of their unpaid bills, then press **Save**.
- **What happens next**: The bills' balances go down and the credit's "Not used yet" goes down. A credit fully used shows as "Used". Unused credits show on the **Vendor credits & advances** tile.
- **Good to know**: Not in the app yet: a vendor credit does not take returned goods off the shelf. If goods went back to the vendor, Inventory also counts them off (see "Correct a count") with the reason.
- **Screen**: `/purchases/credits/25211` · login: Finance (fin) · scroll to: "Use on bills"
