# The user book (Aryan, 19 Nov: "a playbook PDF that explains the software, every function, with
# who signs in with which login by the hierarchy at the end"). Builds book.html from the screens in
# img/ (taken from the local copy by shoot.mjs) and docs/LOGINS-LIVE.md; print.mjs turns it into
# the PDF. The company's common password is never written here.

import html
from pathlib import Path

HERE = Path(__file__).parent
LOGINS = HERE.parent / "LOGINS-LIVE.md"
URL = "https://crmnew-psi.vercel.app"
E = html.escape

rows = []
for line in LOGINS.read_text().splitlines():
    if not line.startswith("|") or "---" in line:
        continue
    cells = [c.strip() for c in line.strip().strip("|").split("|")]
    if cells[0] == "Team":
        continue
    rows.append(cells)


def slide(body: str, cls: str = "") -> str:
    return f'<section class="slide {cls}">{body}<footer><span>Bishnoi One · User book</span><span class="pg"></span></footer></section>'


def shot(name: str, caption: str = "", cls: str = "") -> str:
    cap = f"<figcaption>{E(caption)}</figcaption>" if caption else ""
    return f'<figure class="shot {cls}"><img src="img/{name}.jpg" alt="{E(caption or name)}">{cap}</figure>'


def points(items) -> str:
    return "<ul class='pts'>" + "".join(f"<li>{i}</li>" for i in items) + "</ul>"


def head(kicker: str, title: str, sub: str = "") -> str:
    s = f"<p class='sub'>{sub}</p>" if sub else ""
    return f"<header class='hd'><p class='kick'>{E(kicker)}</p><h2>{title}</h2>{s}</header>"


def grid(kicker: str, title: str, sub: str, cells) -> str:
    """A page of two or three screens, each with a few lines under it."""
    cls = "three" if len(cells) == 3 else "two"
    body = "".join(f"<div>{shot(img, cap)}{points(lines)}</div>" for img, cap, lines in cells)
    return slide(head(kicker, title, sub) + f"<div class='{cls}'>{body}</div>")


S = []

# 1 · Cover
S.append(
    slide(
        f"""<div class="cover">
  <div class="brand">Bishnoi One</div>
  <h1>User book</h1>
  <p class="lede">The company's one system for selling, orders, money, stock and people: how each of us uses it, step by step.</p>
  <p class="meta">2MG Inc. · GetMeds Philippines Inc. · November 2026</p>
  <p class="url">{URL}</p>
</div>""",
        "cover-slide",
    )
)

# 2 · What it is
tiles = [
    ("Sales & field", "MedReps, telesales, B2B, CLIDP, Bidding, PAP: Create New Order, call lists, visits, their numbers."),
    ("Online desk", "Messenger, website and e-mail enquiries worked into orders: quotation, papers, order, payment, refill."),
    ("Management", "One shared desk: every order checked by hand (papers, price, stock, customer) and approved."),
    ("Finance", "Checks the payment, makes the invoice, collects by terms (cash on delivery, 30, 45, x days)."),
    ("Dispatch", "Packs from the warehouse (first expiry first), ships by courier or rider, delivered with receipt."),
    ("Inventory", "Medicines and prices, stock by warehouse and batch, transfers, purchases and suppliers' bills."),
    ("HR & everyone", "Start my day, who's working, leave and forms, payslips, messages and announcements."),
    ("CEO & Admin", "The company at a glance, the target sheet and reports; the Admin sets up teams, seats and logins."),
]
S.append(
    slide(
        head("What it is", "One system for the whole company", "Every department works the same order, the same customer and the same stock, each from its own screen.")
        + "<div class='tiles'>"
        + "".join(f"<div class='tile'><h3>{E(t)}</h3><p>{E(d)}</p></div>" for t, d in tiles)
        + "</div>"
    )
)

# 3 · Signing in
S.append(
    slide(
        head("Signing in", "Your login ID and the company's password")
        + "<div class='cols'><div>"
        + points(
            [
                f"Open <b>{URL}</b> on your phone or computer.",
                "Type your <b>login ID</b> (the last pages of this book list everyone's: <i>hos1</i>, <i>rx1</i>, <i>b2b3</i>…) and the company's common password. HR or the Admin gives you the password; nobody is asked to change it.",
                "<b>Management, Finance and Dispatch</b> also have a shared desk screen: pick the desk's tile and type the password only. Each person then presses <b>Start</b> beside their name; the waiting orders are shared out among the people started.",
                "Your first sign-in of the day is your time in (HR's attendance). <b>End my day</b> in the top bar closes it.",
                "One person, one login. Never share yours: everything you do is kept in your name.",
            ]
        )
        + "</div><div>"
        + shot("login", "The sign-in page")
        + "</div></div>"
    )
)

# 4 · The order line
steps = [
    ("1", "Seller", "Create New Order: the customer, the medicines at their list price, the papers."),
    ("2", "Management", "Checks the papers by hand, the price (and the last price given), stock, the customer. Approves, holds or sends back."),
    ("3", "Finance", "Checks the payment or what they owe, makes the invoice."),
    ("4", "Dispatch", "Packs from the right warehouse (first expiry first), ships, marks it delivered with the signed receipt."),
    ("5", "Paid", "The money comes in by its terms: cash on delivery, 30 / 45 / x days, or in advance."),
]
S.append(
    slide(
        head("The order line", "Every order goes the same way", "A MedRep's, a team lead's, the Online desk's: Management → Finance → Dispatch.")
        + "<div class='flow'>"
        + "".join(f"<div class='step'><span class='n'>{n}</span><h3>{E(t)}</h3><p>{E(d)}</p></div>" for n, t, d in steps)
        + "</div>"
        + "<div class='rules'><h3>Rules everyone keeps</h3>"
        + points(
            [
                "A <b>prescription</b> for every patient's purchase, and the patient's ID; Management checks both.",
                "<b>Management approves every order</b>. Papers turn green only when a person has read them.",
                "<b>One seat, one Division</b>: your order carries your own Division and counts on your target, with your team lead and head.",
                "<b>Nothing is deleted</b>: an order is cancelled, a customer archived, a payment reversed, each with its reason.",
            ]
        )
        + "</div>"
    )
)

# 5 · Your screen
S.append(
    slide(
        head("Your screen", "Your own work on top")
        + "<div class='cols'><div>"
        + points(
            [
                "<b>Create New Order</b> is the green button at the top of the menu for every seller (a seat's own action, like <i>Log a call</i>, sits under it).",
                "Then your day's work: <b>Home</b>, your orders, your customers and the list to call; related links sit together in one folder (<i>Hospitals</i>, <i>Visits</i>, <i>My numbers</i>).",
                "<b>Look up</b> holds what you only look at (Medicines & stock). <b>Me</b> (leave, payslips) and <b>Messages</b> are at the foot.",
                "The search in the top bar finds medicines, customers, orders and people.",
                "On the phone the menu is the bar at the bottom, with <b>+ New order</b> raised in the middle.",
            ]
        )
        + "</div><div>"
        + shot("hos-home", "A Hospital CHC's Home and menu")
        + "</div></div>"
    )
)

# 6 · Seller's Home
S.append(
    slide(
        head("Sales & field", "A seller's Home: the day at a glance")
        + "<div class='cols c-wide'><div>"
        + points(
            [
                "<b>Today's pulse</b>: sales against the target on the month's pace, days to collect, customers not reordering, an invoice on the last working day; each green, amber or red.",
                "<b>Go here first</b>: the hospitals due to reorder (biggest buyers first) with <i>Call</i> and <i>New order</i>, then at most two whose money is 60 days overdue (<i>they owe us: collect on the visit</i>).",
                "<b>My orders today</b>: placed, waiting for Management or Finance, being packed, delivered.",
                "<b>Tonight's huddle</b> (7 PM): the day's invoices, payments and visits filled in; declared to your coach.",
            ]
        )
        + "</div><div class='phone'>"
        + shot("phone-home", "On the phone", "tall")
        + "</div></div>"
    )
)

# 7 · Create New Order
S.append(
    slide(
        head("Create New Order", "Five parts, top to bottom", "Missing items are counted on each part; Place order lights up when nothing is missing.")
        + "<div class='cols'><div>"
        + points(
            [
                "<b>1 · General</b>: the day, you as the MedRep, and your <b>Division</b> (your seat's; one with two seats picks between the two).",
                "<b>2 · Customer</b>: pick one (the list opens on your Division's usual buyers) or add a new one; delivery address, receiver, payment terms, source.",
                "<b>3 · Medicines</b>: the price comes from Inventory for this buyer; a lower price needs a reason (Management reads it). Promos add their free lines.",
                "<b>4 · Documents</b>: the hospital's PO; a patient's prescription and ID; proof of payment for an advance order (or why there is none).",
                "<b>5 · Review and place</b>: the total and what Management will look at.",
            ]
        )
        + "</div><div class='stack'>"
        + shot("order-new", "1 · General: your own Division")
        + shot("order-new-customer", "2 · Customer: the list opens on your Division's buyers")
        + "</div></div>"
    )
)

# 8 · An order waiting: who sees what
S.append(
    slide(
        head("An order waiting", "Ryan's hospital order, from each chair", "2MG-500058, St. Clare's Medical Center, ₱19,500, placed by a Hospital CHC: waiting for Management.")
        + "<div class='three'>"
        + "<div>"
        + shot("hos-order-rep", "The MedRep: where the order is")
        + points(["<b>Where the order is</b>: placed ✓, <i>Now · Management</i>, then Finance, pack & ship, delivered, paid.", "Management's four checks, read-only; sent back? the reason, and Fix."])
        + "</div><div>"
        + shot("mgmt-hosp", "Management: the Hospital orders waiting")
        + points(["The shared desk hands it to a person started; <b>Late</b> after hours waiting.", "Approve, send back, reject from the card."])
        + "</div><div>"
        + shot("hos-order-mgmt", "Management: the price check, with the last price")
        + points(["Price against the list and <b>the customer's last price</b> (13 Nov: ₱3,500).", "Then Finance invoices it; Dispatch packs it."])
        + "</div></div>"
    )
)

# 9 · Call lists and refills
S.append(
    slide(
        head("Customers to call", "Who is due to reorder, and the next refill")
        + "<div class='cols'><div>"
        + points(
            [
                "Each customer against <b>their own usual gap</b> between orders: <i>in 2 days</i>, <i>due now</i>, <i>late</i>, <i>at risk</i>, <i>lost</i>.",
                "<b>Next refill</b>: whoever took the order sets the day the medicines run out (on the customer's page, or the Online case's last step). It counts until the next order; the menu shows how many are due.",
                "<b>Visits</b>: the last visit done there, by whom, and the next one planned.",
                "Named for each seat: <i>Hospitals to call</i>, <i>Accounts to call</i>, <i>Refills due</i>, <i>Patients to call</i>.",
            ]
        )
        + "</div><div>"
        + shot("hos-tocall", "Hospitals to call")
        + "</div></div>"
    )
)

S.append(grid("Sales & field", "Field work: visits, expenses, samples", "Plan the month, check in at each visit, claim what was spent, count the samples.", [
    ("visit-plan", "My visit plan", ["Each customer's visits a month by their class (A, B, C)", "Done against planned, the month's coverage"]),
    ("expenses", "My expenses", ["Fares, meals, parking: a photo of the receipt", "Approved by the team lead, paid with the salary"]),
    ("samples", "My samples & gifts", ["What was given to whom, and what is left", "Asked from the warehouse; counted each month"]),
]))
S.append(grid("Sales & field", "Money owed, my score, tonight's huddle", "What a seller watches every day.", [
    ("collections", "Collections", ["Each customer's money owed, by its oldest unpaid invoice", "60, 75 and 90 days flagged: collect on the visit"]),
    ("score", "My score", ["The month's scorecard: sales, collections, coverage, new customers", "The same card the coach and the head read"]),
    ("huddle", "Tonight's huddle", ["At 7 PM: the day's invoices, payments and visits, filled in", "No invoice? Say the blocker; tomorrow's first stop"]),
]))

# 10 · A hospital's history
S.append(
    slide(
        head("A customer's whole story", "Every order, medicine, price and peso, old and new", "Jose R. Reyes Memorial Medical Center: 2 orders here + 33 earlier (₱2.95M), ₱144K owed.")
        + "<div class='cols c-even'><div class='stack'>"
        + shot("hospital-history", "Their buying, orders, money, next refill")
        + "</div><div class='stack'>"
        + shot("hospital-prices", "Prices given: every time, at what price")
        + shot("hospital-old", "Metropolitan Medical Center: 30 orders from before this CRM")
        + "</div></div>"
    )
)

# 11-17 · Each channel's order line
CH = [
    (
        "Hospital Division (HOS)",
        "Hospitals, their doctors, a patient through them",
        "Hospital CHCs <span class=mono>hos1–hos24</span>",
        "District Sales Coaches (NCR 1 Daniel Cruz <span class=mono>tl3</span>, NCR 2 Jim Lord Palomares <span class=mono>tl4</span>, North & Central Luzon Julius Abucay <span class=mono>tl5</span>, South Luzon Kindred Malauan <span class=mono>tl6</span>, Mindanao Saurav Kumar <span class=mono>tl7</span> and Claire Gallana <span class=mono>tl13</span>) → Business Mentor Vanessa Escalderon <span class=mono>tl2</span>",
        ["Placed with the hospital's <b>PO</b> (a patient through it: prescription + ID), usually <b>30 days</b> after delivery", "Management checks price and last price, stock, the hospital's licence and what it owes", "Finance invoices; Dispatch delivers with the signed receipt; the 30 days count from delivery"],
        "hos-order-rep", "The CHC's order, waiting for Management",
    ),
    (
        "Prescription Business: Rx CHC (RX)",
        "Doctors (Uro & Onco Care: URO · Blood & Bone Care: B&B)",
        "Rx CHCs <span class=mono>rx1–rx11</span>",
        "Sales Coach – RX Business Honey Cordero <span class=mono>tl15</span> → PH Country Mentor Javed Shaikh <span class=mono>tl8</span>",
        ["Most of the day is doctors' calls (<i>Log a call</i>); a doctor's order goes the same line", "Patients from the doctors go to MD Telesales as care groups", "Management checks the prescription for any patient on it"],
        "rx-order", "An Rx CHC's doctor order at Management",
    ),
    (
        "MD Telesales (TS)",
        "Oncology patients' refills (Prescription Business) · Anesthesia hospitals and doctors (Hospital Division)",
        "Oncology <span class=mono>ts6–ts9</span> · Anesthesia <span class=mono>ts1–ts5</span>",
        "Oncology: Sales Coach Honey Cordero <span class=mono>tl9</span> → Javed Shaikh · Anesthesia: Sales Coach – TeleSales Reynan Cuenca <span class=mono>tl16</span> → Vanessa Escalderon",
        ["Refills due and care groups first; Create New Order on the call", "A patient's order: prescription + ID; terms: cash on delivery or in advance", "Finance checks the proof of an advance payment before Dispatch"],
        "ts-finance", "A telesales order at Finance",
    ),
    (
        "B2B Telesales: NBD & CRR",
        "Drugstores and distributors",
        "NBD (new accounts) <span class=mono>b2b4–b2b7</span> · CRR (reorders) <span class=mono>b2b3</span>",
        "B2B Sales Coach Jessa Domino <span class=mono>tl12</span> · District Sales Coach Mindanao Claire Gallana <span class=mono>b2b8</span> → Sales and Marketing Mentor Subir Dey <span class=mono>tl10</span>",
        ["NBD finds the account and hands it over; the CRR keeps it reordering (<i>Accounts to call</i>)", "A new account's papers (BIR 2303, LTO, business permit) are checked by Management once", "Terms as agreed (PDC / NET 30, 45…); Finance collects by them"],
        "nbd-pack", "A B2B order being packed at Dispatch",
    ),
    (
        "CLIDP",
        "Distributors, in bulk, under their listings",
        "CLIDP Sales Coaches <span class=mono>b2b1</span>, <span class=mono>b2b2</span>",
        "Sales and Marketing Mentor Subir Dey <span class=mono>tl10</span>",
        ["Orders carry the CLIDP Division; the listing says what each distributor takes", "Management checks the distributor's papers, price and credit", "Usually on terms; Finance invoices and collects"],
        "clidp-order", "A CLIDP distributor order at Management",
    ),
    (
        "Government Bidding (BID)",
        "Government hospitals and agencies, by tender",
        "Bidding coachees <span class=mono>bid1</span>, <span class=mono>bid2</span> · CHC <span class=mono>bid3</span> · Government Account <span class=mono>hos25</span>",
        "Government Bidding Admin Jimmy Boy Saturinas <span class=mono>tl11</span> → Government Bidding Manager Subir Dey <span class=mono>tl17</span>",
        ["<i>Record a tender</i> from its posting; the company's documents kept in one place", "Awarded: the order at the bidding price, to the government buyer", "Management approves; Finance bills; payment as the agency pays"],
        "bid-order", "A government order at Management",
    ),
]
for title, sells, places, heads, road, img, cap in CH:
    S.append(
        slide(
            head("Each channel's order line", E(title), f"Sells to: {E(sells)}")
            + "<div class='cols c-even'><div class='chan'>"
            + f"<div class='row'><span>Places the order</span><p>{places}</p></div>"
            + f"<div class='row'><span>Leads and heads</span><p>{heads}</p></div>"
            + "<div class='row'><span>The road</span>" + points(road) + "</div>"
            + "<div class='row'><span>Who sees it</span><p>The seller, their own team lead and head, Management, Finance, Dispatch and the CEO; never another head's team.</p></div>"
            + "</div><div>"
            + shot(img, cap)
            + "</div></div>"
        )
    )

# PAP and Modern Trade
S.append(
    slide(
        head("Each channel's order line", "Patient Assistance (PAP) · Modern Trade")
        + "<div class='cols c-even'><div class='chan'>"
        + "<div class='row'><span>PAP</span><p>The PAP officer <span class=mono>pap1</span> (Hospital Division) works each patient's guarantee letter (PCSO, DSWD, OVP) as a case: <i>New PAP case</i> → the papers (prescription, ID, medical certificate, the letter) → the order. <b>The PAP head approves PAP orders</b>, not Management; the agency is billed and pays on its claim.</p></div>"
        + "<div class='row'><span>Modern Trade</span><p>The COO – Modern Trade Malou Jagonoy <span class=mono>tl14</span> looks after the pharmacy chains herself (Chains, Listings); the sales seats <span class=mono>mt1</span>, <span class=mono>mt2</span> are vacant. Orders go Management → Finance → Dispatch.</p></div>"
        + "</div><div>"
        + shot("pap-cases", "PAP cases")
        + "</div></div>"
    )
)

# Online desk
S.append(
    slide(
        head("Each channel's order line", "Online desk", "Patients (and businesses) from Messenger, the websites and e-mail.")
        + "<div class='cols'><div class='chan'>"
        + "<div class='row'><span>Places the order</span><p>Online agents <span class=mono>online1</span> Mary Jane Viñas, <span class=mono>online2</span> Rachelle Upao; head: ONLINE head <span class=mono>tl1</span></p></div>"
        + "<div class='row'><span>The road</span>"
        + points(
            [
                "Every enquiry is a case: <b>Enquiry & quotation</b> → <b>Rx & documents</b> → <b>Order & delivery</b> → <b>Payment & follow-up</b>; answered within 15 minutes.",
                "<b>Who's buying</b>: a patient (patient price; senior / PWD; guarantee letters) or a business at its own price list: both count as Online's.",
                "The order goes Management → Finance → Dispatch, marked <i>Online · Messenger</i> on every desk; the agent records the money and sets the <b>next refill</b>.",
            ]
        )
        + "</div></div><div class='stack'>"
        + shot("online-leads", "Leads & enquiries")
        + shot("online-b2b", "Who's buying: a business, at its own price")
        + "</div></div>"
    )
)

S.append(grid("Online desk", "The Inbox, a case, and points", "Every conversation in one place; each patient's points for the next order.", [
    ("inbox", "Inbox: Messenger and e-mail", ["Conversations waiting for a reply first", "A message opens its case"]),
    ("online-case", "A case's last step", ["The money received, the receipt sent", "The next refill day"]),
    ("points", "Points", ["Each customer's balance by name or number", "Used on an order like money (when the program is on)"]),
]))

# Team leads and heads
S.append(
    slide(
        head("Team leads and heads", "Your team, seat by seat")
        + "<div class='cols'><div>"
        + points(
            [
                "<b>Home</b>: the team now: each person against their target on pace, days to collect, lapsed customers, tonight's huddle.",
                "Lead two teams? The <b>team switch</b> shows each team, or both together.",
                "<b>Team orders</b>, the team's call list, collections and <b>Create New Order</b> for one of your people.",
                "<b>Team</b>: my team, scorecards, targets, team visits (report, where the team is, expenses to approve), attendance and leave.",
                "You see your own boxes on the chart (the Admin's tree); another head's teams are not shown.",
            ]
        )
        + "</div><div class='stack'>"
        + shot("tl-home", "A District Sales Coach's Home")
        + shot("team-orders", "Team orders")
        + "</div></div>"
    )
)

S.append(grid("Team leads and heads", "The team in the field", "", [
    ("field-report", "Visits report", ["Each person's visits done against planned", "Coverage of the month"]),
    ("field-live", "Where the team is", ["Who is checked in at a customer now", "Who hasn't started"]),
    ("scorecards", "Scorecards", ["Every person's card, worst first", "Questions on a score go to the coach"]),
]))

# Management
S.append(
    slide(
        head("Management", "One desk: every order checked, then approved")
        + "<div class='cols'><div>"
        + points(
            [
                "Press <b>Start</b> beside your name: the orders to approve are shared out among the people started (<i>I'll handle it</i> takes one over).",
                "Each order's four checks: <b>Price</b> (below the list, and the customer's last price), <b>Stock</b>, <b>Customer</b> (licence, money owed, credit) and <b>Papers</b>, read by a person: <i>Papers are right</i>.",
                "<b>Approve</b> (pick the warehouse), <b>Send back</b> with the reason, <b>Hold</b> with a question, or <b>Reject</b>.",
                "<b>Customers to check</b>: a new customer's papers, once. <b>Stopped orders</b>: sent back, on hold, stuck two days.",
            ]
        )
        + "</div><div class='stack'>"
        + shot("mgmt-desk", "The Management desk")
        + shot("order-papers", "An order's papers, read by a person")
        + "</div></div>"
    )
)

# Finance
S.append(
    slide(
        head("Finance", "The money of every order")
        + "<div class='cols'><div>"
        + points(
            [
                "<b>Orders to check</b>: each card's strip says how it pays, its papers, what the customer owes overdue, and its credit against the limit.",
                "<b>Prepaid orders</b>: match the proof of payment with the bank.",
                "<b>Due payments</b>: every order paid later, one card per terms (cash on delivery, 30 days, 45 days…); credit counts its days from delivery; the late ones are counted in the menu. <i>Mark paid</i> on the row.",
                "<b>Refunds owed</b>, <b>Supplier bills to pay</b>, Money ▸ and Books ▸.",
            ]
        )
        + "</div><div class='stack'>"
        + shot("fin-board", "Orders to check")
        + shot("fin-due", "Due payments by terms")
        + "</div></div>"
    )
)

S.append(grid("Finance", "Invoices, prepaid orders, reports", "Read live from every order: nothing is typed twice.", [
    ("invoices", "Invoices", ["Every invoice: due day, paid, owed, overdue", "Made when Management approves; paid from Due payments"]),
    ("fin-prepaid", "Prepaid orders", ["Advance payments: the proof matched with the bank", "Then the order goes to Dispatch"]),
    ("books-reports", "Reports", ["Profit and loss, balance sheet, cash flow", "Gross profit, sales by channel, receivables by age"]),
]))

# Dispatch
S.append(
    slide(
        head("Dispatch", "Pack, ship, delivered")
        + "<div class='cols'><div>"
        + points(
            [
                "<b>Orders to pack & ship</b>: shared among the people started, like Management's.",
                "Pack: the batches come from the warehouse Management picked, the one that expires first first; a promo's free line from what its paid line left.",
                "Ship by courier (with its tracking) or our rider; a failed delivery comes back with the box kept.",
                "<b>Delivered</b> with the signed receipt; cash on delivery is collected then. <b>Returns to check</b> go back on the shelf.",
            ]
        )
        + "</div><div>"
        + shot("dispatch", "Dispatch's desk")
        + "</div></div>"
    )
)

S.append(grid("After delivery", "Returns, refunds, complaints", "Nothing is deleted: a return is checked and credited, a refund is owed and paid, a complaint is answered.", [
    ("returns", "Returns & refunds", ["The MedRep asks; Management approves; Dispatch checks what comes back", "Back on the shelf; the bill credited"]),
    ("refunds", "Refunds owed", ["A cancelled order whose money came: ₱15,600 to give back", "Finance pays it back (Give back) and records how"]),
    ("complaints", "Complaints & side-effects", ["Anyone reports one from the customer's page", "Kept open until it is closed with the answer"]),
]))

# Inventory: buying
S.append(
    slide(
        head("Inventory", "Buying medicines: from the vendor to the shelf")
        + "<div class='cols'><div>"
        + "<ol class='pts'>"
        + "<li><b>To do & buy again</b> shows what runs out (at or under its low level), how long it lasts, and <b>who we bought it from last, at what price</b>: <i>Order</i> starts the purchase order.</li>"
        + "<li><b>Choose the vendor</b>: type their name (each vendor's page lists what they sold us and their prices), or <i>+ New vendor</i>; where it is delivered, the expected day, the payment terms.</li>"
        + "<li><b>What we buy</b>: medicine, pieces, price a piece (the last price paid fills in by itself), tax. <i>Save and send</i>.</li>"
        + "<li><b>Receive</b> it into the warehouse with each batch's number and expiry (it shows <i>To receive</i> until then).</li>"
        + "<li>Record the vendor's <b>bill</b>; Finance <b>pays</b> it (Bills to pay; payments made).</li>"
        + "</ol>"
        + "</div><div class='stack'>"
        + shot("buy-board", "Purchases: what to receive, bill, pay, buy again")
        + shot("po-new", "A new purchase order")
        + "</div></div>"
    )
)

S.append(grid("Inventory", "Medicines, stock moves and requests", "", [
    ("medicines", "Medicines & prices", ["Each medicine's price for each kind of buyer", "Stock free on the shelf, nearest expiry"]),
    ("transfers", "Transfers", ["Stock moved between warehouses (Main, Cebu, Davao)", "Each batch with its expiry"]),
    ("requests", "Medicine requests", ["Asked for by a MedRep or the Online desk when it isn't in the list", "Answered by Inventory"]),
]))

# HR
S.append(grid("HR", "People, attendance, leave, payroll", "", [
    ("hr-people", "People", ["Everyone working, joining or left, with their seat", "A new person joins from here"]),
    ("hr-working", "Who's working", ["Today: in on time, late, not in, on leave", "Each day put right by HR when needed"]),
    ("payroll", "Payroll", ["The month worked out from the attendance: days in, time off, SSS, PhilHealth, Pag-IBIG, tax", "HR adds a loan or an advance, then releases; each person reads their payslip"]),
]))
S.append(grid("Everyone", "Regulatory, office staff, Me and Messages", "", [
    ("regulatory", "In-licensing & Regulatory", ["The product pipeline and the FDA registrations (CPRs)", "Each one's stage and expiry"]),
    ("worklog", "My work log (office staff)", ["What I did today, what is next", "Read by the coach"]),
    ("messages", "Messages", ["Needs you, updates, chats", "Leave & forms and payslips under Me"]),
]))

# CEO and Admin
S.append(
    slide(
        head("CEO and Admin", "The company at a glance; the company set up")
        + "<div class='cols'><div class='stack'>"
        + shot("ceo-home", "The CEO's Home: sales, collected, owed, orders first")
        + shot("ceo-attendance", "Who's in today: on time, late, not in")
        + "</div><div>"
        + points(
            [
                "<b>CEO</b>: sales this month by channel, collected, customers owe, orders now, gross profit; the month's sales by day, top sellers, customers and medicines; the <b>Target sheet</b>; reports; the old system's history (<i>Before this CRM</i>); every app as a folder; the people and who's in today at the foot.",
                "<b>Admin</b>: <b>Teams & people</b> (the chart: boxes, seats, who sits where, login IDs), channels and their Divisions, areas, who approves what, targets, company details and data checks.",
            ]
        )
        + shot("admin-people", "Admin: teams & people")
        + "</div></div>"
    )
)

S.append(grid("CEO", "Reports", "Each report opens from the CEO's menu: the target sheet first.", [
    ("target-sheet", "Target sheet", ["Each seat's target and what it sold, by channel and head", "Today's invoicing, the month to date"]),
    ("key-channels", "Channels", ["Each channel's people, customers, sales and money owed", "Click a channel for its teams"]),
    ("old-history", "Before this CRM", ["The old system's leads, customers, orders, calls", "Kept to read; nothing new is written there"]),
]))
S.append(grid("Admin", "Setting the company up", "", [
    ("admin-people", "Teams & people", ["The chart: each box, its seats and who holds them", "Login IDs stay with the seat"]),
    ("admin-channels", "Channels", ["Each channel, its head and its Division", "Areas belong to channels"]),
    ("data-checks", "Data checks", ["The data checked against itself: bills, payments, stock", "All 17 should pass"]),
]))

# 17 · The logins, by hierarchy
groups = {}
for team, name, job, login in rows:
    top = team.split(" › ")[0]
    rest = " › ".join(team.split(" › ")[1:]) or "—"
    groups.setdefault(top, []).append((rest, name, job, login))
order = [
    "2MG Inc.", "Hospital Division", "Prescription Business", "Sales & Marketing", "Modern trade", "Online",
    "Supply Chain, Ops & Finance", "In-licensing & Regulatory Department", "HR", "IT Division",
    "Digital Marketing Coaching Department", "Executive and Admin",
]
order += [g for g in groups if g not in order]
# The list in two even columns a page: a department's name as a row of its own, then its people.
lines = []
for g in order:
    if g not in groups:
        continue
    lines.append(("dept", g, len(groups[g])))
    for t, n, j, l in groups[g]:
        lines.append(("row", t, n, j, l))
PER_COLUMN = 19


def column(chunk) -> str:
    body = ""
    for line in chunk:
        if line[0] == "dept":
            body += f"<tr class='dh'><td colspan='4'>{E(line[1])} <span>{line[2]}</span></td></tr>"
        else:
            _, t, n, j, l = line
            who = E(n) if n != "(vacant)" else "<span class='vac'>vacant</span>"
            body += f"<tr><td>{E(t)}</td><td>{who}</td><td>{E(j)}</td><td class='mono'><b>{E(l)}</b></td></tr>"
    return f"<table class='logins'><thead><tr><th>Team</th><th>Name</th><th>Job</th><th>Login ID</th></tr></thead><tbody>{body}</tbody></table>"


S.append(
    slide(
        head("Logins", "Who signs in with which ID", f"By department and team, as the 2026 chart and the Admin panel have them ({len(rows)} seats). Password: the company's common one, from HR or the Admin.")
        + "<div class='how'>"
        + points(
            [
                "Open the address, type the <b>Login ID</b> from the list, then the company's password.",
                "A seat marked <i>vacant</i> has no one yet: the Admin gives it to the new person (Teams & people), and the login ID stays the seat's.",
                "Someone moves to another seat? The Admin moves them on the chart; their screen and data follow the seat.",
            ]
        )
        + "</div>"
    )
)
# the people, two columns a page
chunks = [lines[i : i + PER_COLUMN] for i in range(0, len(lines), PER_COLUMN)]
for i in range(0, len(chunks), 2):
    S.append(slide("<div class='login-page'>" + "".join(f"<div>{column(c)}</div>" for c in chunks[i : i + 2]) + "</div>", "logins-slide"))

CSS = """
@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap');
@page { size: 13.333in 7.5in; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: 'Poppins', -apple-system, 'Segoe UI', sans-serif; color: #0f172a; -webkit-print-color-adjust: exact; print-color-adjust: exact; counter-reset: pg; }
.slide { width: 13.333in; height: 7.5in; padding: 0.5in 0.6in 0.55in; position: relative; overflow: hidden; page-break-after: always; background: #f7faf8; counter-increment: pg; }
.slide footer { position: absolute; left: 0.6in; right: 0.6in; bottom: 0.22in; display: flex; justify-content: space-between; font-size: 9pt; color: #94a3b8; }
.slide footer .pg::after { content: counter(pg); }
.hd { margin-bottom: 0.22in; }
.kick { margin: 0; font-size: 10pt; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: #1f9d55; }
.hd h2 { margin: 2px 0 0; font-size: 25pt; line-height: 1.15; font-weight: 800; letter-spacing: -0.01em; }
.sub { margin: 6px 0 0; font-size: 11.5pt; color: #475569; }
.pts { margin: 0; padding-left: 1.1em; font-size: 11.5pt; line-height: 1.5; color: #1e293b; }
.pts li { margin: 0 0 7px; }
.pts li::marker { color: #1f9d55; }
.cols { display: grid; grid-template-columns: 1fr 1.25fr; gap: 0.35in; align-items: start; }
.cols.c-wide { grid-template-columns: 1.4fr 1fr; }
.cols.c-even { grid-template-columns: 1fr 1fr; }
.chan .row { display: grid; grid-template-columns: 1.35in 1fr; gap: 12px; padding: 9px 0; border-bottom: 1px solid #e2e8f0; font-size: 11pt; line-height: 1.45; }
.chan .row:last-child { border-bottom: 0; }
.chan .row > span { font-size: 9pt; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #1f9d55; padding-top: 3px; }
.chan .row p { margin: 0; color: #1e293b; }
.chan .row .pts { font-size: 10.5pt; }
ol.pts { padding-left: 1.3em; }
.three { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.25in; }
.two { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.3in; }
.two .pts { font-size: 10.5pt; margin-top: 8px; }
.two .shot img { height: 3.2in; object-fit: cover; object-position: top left; }
.three .pts { font-size: 10.5pt; margin-top: 8px; }
.stack { display: grid; gap: 0.16in; }
.shot { margin: 0; background: #fff; border-radius: 14px; border: 1px solid #e2e8f0; box-shadow: 0 8px 24px rgba(15,23,42,.08); overflow: hidden; }
.shot img { display: block; width: 100%; height: auto; }
.shot figcaption { padding: 6px 10px; font-size: 9pt; color: #64748b; border-top: 1px solid #f1f5f9; }
.stack .shot img { max-height: 2.55in; object-fit: cover; object-position: top; }
.cols > div > .shot img { max-height: 5.4in; object-fit: cover; object-position: top; }
.three .shot img { height: 2.2in; object-fit: cover; object-position: top left; }
.phone { display: flex; justify-content: center; }
.phone .shot { width: 2.75in; border-radius: 26px; border: 6px solid #0f172a; }
.phone .shot img { max-height: 5.7in; object-fit: cover; object-position: top; }
.cover-slide { background: linear-gradient(135deg, #14532d 0%, #1f9d55 60%, #34d399 100%); color: #fff; }
.cover-slide footer { color: rgba(255,255,255,.7); }
.cover { position: absolute; left: 0.9in; top: 1.3in; right: 0.9in; }
.brand { font-size: 16pt; font-weight: 700; letter-spacing: .02em; opacity: .9; }
.cover h1 { margin: 8px 0 0; font-size: 64pt; line-height: 1; font-weight: 800; letter-spacing: -0.02em; }
.lede { margin: 22px 0 0; font-size: 17pt; max-width: 8.5in; line-height: 1.4; }
.meta { margin: 30px 0 0; font-size: 12pt; opacity: .85; }
.url { display: inline-block; margin: 10px 0 0; padding: 6px 14px; border-radius: 999px; background: rgba(255,255,255,.18); font-size: 12pt; font-weight: 600; }
.tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.2in; }
.tile { background: #fff; border-radius: 16px; border: 1px solid #e2e8f0; padding: 16px 16px 14px; border-top: 5px solid #1f9d55; }
.tile:nth-child(2) { border-top-color: #0ea5e9; } .tile:nth-child(3) { border-top-color: #7c3aed; } .tile:nth-child(4) { border-top-color: #f59e0b; }
.tile:nth-child(5) { border-top-color: #e11d48; } .tile:nth-child(6) { border-top-color: #0d9488; } .tile:nth-child(7) { border-top-color: #ea580c; } .tile:nth-child(8) { border-top-color: #334155; }
.tile h3 { margin: 0 0 6px; font-size: 14pt; }
.tile p { margin: 0; font-size: 10.5pt; color: #475569; line-height: 1.45; }
.flow { display: grid; grid-template-columns: repeat(5, 1fr); gap: 0.14in; margin-top: 0.05in; }
.step { position: relative; background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 16px 14px; }
.step .n { display: inline-grid; place-items: center; width: 30px; height: 30px; border-radius: 999px; background: #1f9d55; color: #fff; font-weight: 700; font-size: 12pt; }
.step h3 { margin: 8px 0 4px; font-size: 14pt; }
.step p { margin: 0; font-size: 10pt; color: #475569; line-height: 1.45; }
.step:not(:last-child)::after { content: '→'; position: absolute; right: -0.13in; top: 40%; color: #1f9d55; font-weight: 800; font-size: 16pt; }
.rules { margin-top: 0.25in; background: #ecfdf5; border: 1px solid #bbf7d0; border-radius: 16px; padding: 14px 18px; }
.rules h3 { margin: 0 0 8px; font-size: 13pt; color: #14532d; }
.rules .pts { font-size: 11pt; columns: 2; column-gap: 0.4in; }
table { border-collapse: collapse; width: 100%; }
.kinds { background: #fff; border-radius: 14px; overflow: hidden; font-size: 10pt; }
.kinds th { text-align: left; background: #14532d; color: #fff; padding: 7px 10px; font-weight: 600; }
.kinds td { padding: 6px 10px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
.mono { font-family: 'SF Mono', Menlo, monospace; font-size: 9.5pt; }
.how .pts { font-size: 12.5pt; max-width: 10in; }
.login-page { display: grid; grid-template-columns: 1fr 1fr; gap: 0.3in; align-items: start; }
.logins .dh td { background: #14532d; color: #fff; font-weight: 700; font-size: 9pt; padding: 5px 6px; }
.logins .dh td span { font-weight: 500; opacity: .8; }
.dept { break-inside: avoid; margin-bottom: 0.14in; }
.dept h3 { margin: 0 0 4px; font-size: 12pt; color: #14532d; }
.dept h3 span { font-size: 9pt; color: #64748b; font-weight: 500; }
.logins { background: #fff; font-size: 8.4pt; border-radius: 10px; overflow: hidden; }
.logins th { text-align: left; background: #e7f6ee; color: #14532d; padding: 4px 6px; font-weight: 600; }
.logins td { padding: 3px 6px; border-bottom: 1px solid #f1f5f9; }
.vac { color: #94a3b8; font-style: italic; }
"""

doc = f"<!doctype html><html><head><meta charset='utf-8'><title>Bishnoi One · User book</title><style>{CSS}</style></head><body>{''.join(S)}</body></html>"
(HERE / "book.html").write_text(doc)
print(f"book.html: {len(S)} pages, {len(rows)} logins")
