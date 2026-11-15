# The hub's roles as CRM modules (14 November 2026)

Aryan's direction (14 Nov): don't copy the hub page by page. Make each hub role a
**module**, give a module to whoever does that work, and they sit in it and work. The flow
stays the hub's: the MedRep sends the order, the person above checks it.

Source: the hub's own code (`manila404/getmeds-system`, commit `344d5c0`, 14 Nov 09:42 Manila),
its `Sidebar.jsx` and `App.jsx` route guards, read-only, plus `hub-inventory.md` (12 Nov).

## How it works now

- **People → a person → Login & powers → Modules**: tick MedRep, Team Lead, Management,
  Finance, Dispatch & pharmacy, Admin (CEO view), or one of the CRM's own (Channel head,
  Office sales, Online desk, Tenders, HR, Office). Only owners and admins give modules, and
  only an owner changes an owner's. Each module fits certain roles: Management and Team Lead
  need Manager+, Admin needs Admin/Owner, and a Field rep can only be a MedRep. The person's
  timeline records who gave the modules.
- The **first ticked module opens** at sign-in. With two or more, the top bar has a module
  switch; the choice is kept in this browser (`crm_module` cookie). Someone with no module
  keeps the workspace their role and departments give, as before.
- **A module also brings its work**, so it isn't just a menu:
  - **Management** approves every channel's orders (gate 1), together with the channel's
    head and named approvers. An order whose channel has no head goes to Management before
    the owners. Management also sees every order on its Dashboard and Exceptions.
  - **Finance** verifies orders (gate 2), together with the Finance department. Whoever
    approved an order never verifies it, and whoever placed it never approves it.
  - **Team Lead** creates orders only for their own team's reps (the hub's rule). Management,
    the office and owners can create orders for any rep.
- Data: setting `access.modules` (user id → modules). It is written only through
  `people.setModules`; `settings.set` refuses it. No migration.

## The order desk: one screen for Management, Finance and Dispatch (14 Nov, later)

Built after reading the hub's Finance screen while signed in as Finance (read only). `/desk/management`,
`/desk/finance` and `/desk/dispatch` are the first link of each module. Each one has:
- the title, the period (this month / last month / this year / all time) and what was placed and
  delivered;
- six stage cards, with the module's own work first ("Awaiting you", a blue dot when something
  waits);
- one table: Order #, Customer, MedRep, Amount (with "+N free"), Stage, In stage. Search,
  25 rows a page, refreshed every 30 s;
- a **Details** panel on the right: Order, Payment & terms, Delivery, Items ("Free" on ₱0 lines)
  and Remarks, with the module's buttons. Management: Approve / Send back / Hold. Finance:
  Confirm payment / Hold. Dispatch: Mark as packed, then Mark shipped (courier and tracking),
  then Mark delivered. "Full order" opens the order's page.
- Stages are read from the order itself (`deskStageOf` in `server/src/order-desk.ts`): not
  submitted → waiting approval → waiting finance → to pack → to ship → on the way → delivered
  unpaid → completed. Needs attention means on hold, waiting for stock, or cancelled.
- Only people given the module (or owners and admins) open a desk; field reps never.

Walked on the local copy: Sarla (Finance) confirmed 2MG-500012's payment. A minute later it
showed in the warehouse lead's Dispatch desk under To pack, with "Approved by Vanessa ·
Verified by Sarla Devi". It was packed and moved to To ship.

**Free items (Buy 1 Take 1, a free box):** Create order's medicine search has a **+ Free**
button beside each medicine. It adds a ₱0 line, described "(Free)", with no discount. The same
medicine may sit on one paid line and one free line, but an order must have at least one paid
medicine. The order page, the approval card ("Free: AnnaGet 1 × 30") and the desk say "Free".

## The flow, hub vs CRM

| Step | Hub | CRM |
|---|---|---|
| 1. Order raised | MedRep (or Team Lead / Management for a rep): Create New Order, five sections | Same form at `/orders/new` (rep, division, customer, medicines, papers, terms). Reps also order from their doctor's or hospital's page |
| 2. Approval | Management's Approval Queue: Approve (stock check) / Send back / Reject | Gate 1: Management module + channel head. Approve shows stock per warehouse; Send back / Hold / Wait for stock |
| 3. Finance | Finance confirms the payment proof, or holds it | Gate 2: Finance module + Finance department. Verify / Send back / Hold |
| 4. Zoho SO, invoice | Approval writes the Zoho Sales Order; invoice from Zoho | No Zoho. The order is the sales order; the invoice is issued on delivery (on account) or with the payment |
| 5. Dispatch | Pharmacy Rx check, pack, ship, tracking | Rx checks, To pack, To deliver, Tracking log, Return checks |
| 6. Paid / completed | Shipped and paid in Zoho | Payment recorded on the order; journey: Paid |

## Module by module

✅ = same work in the CRM · 🟡 = partly · ❌ = not built

### MedRep
| Hub menu | CRM | |
|---|---|---|
| Create New Order (primary) | Home's **+ New order**, the account page's order form | ✅ |
| Dashboard | Home (`/field`): my sales ring, order tiles, recent orders | ✅ |
| My Orders | My orders (`/my/orders`), each with where it waits and for whom | ✅ |
| Clients Directory (read-only) | My doctors / My hospitals / My buyers | ✅ |
| Announcements (stock news) | — | ❌ |
| (not in hub) | Visits, month plan, samples, expenses, Inventory with channel prices | extra |

### Team Lead
| Hub menu | CRM | |
|---|---|---|
| Create New Order (self or own team) | **Create order** (rep list = own team) | ✅ |
| My Team (dashboard, read-only) | My team (`/my/orders?scope=team`): each rep, journey counts | ✅ |
| Team performance (KPIs) | Team sales (`/field/kpis`) | ✅ |
| Clients Directory | Team doctors / Team hospitals | ✅ |
| Announcements | — | ❌ |
| (not in hub) | Approvals of their reps' plans and leave, Visits, Who's in | extra |

### Management (new module)
| Hub menu | CRM | |
|---|---|---|
| Create New Order | Create order (`/orders/new`), any rep | ✅ |
| Global Dashboard | **Orders** desk + **By MedRep**: every order by person + journey (Not approved yet → With finance → To deliver → Delivered → Paid) | ✅ |
| Approval Queue | **Approval queue** (`/orders/gates?view=approve`, the landing page) | ✅ |
| Exception Hub (hold, exceptions, cancelled) | **Exceptions** (`/my/stuck`): orders late or held at a gate, missed visits, overdue | 🟡 cancelled orders aren't listed there |
| All Orders Log | **All orders** (`/m/sales.order`) with filters, export | ✅ |
| Refund requests / Refunds owed | **Refund requests** (`sales.refund_request`) | ✅ |
| Pending Customers (rep-made) | **New accounts** (accounts added from the field, "New, to review") | ✅ |
| Not yet with Finance | Dashboard's "Not approved yet" queue | ✅ |
| Announcements & promos (Buy 1 Take 1) | — | ❌ |

### Finance
| Hub menu | CRM | |
|---|---|---|
| Dashboard (stages: awaiting / not yet with finance / invoicing / fulfilment / completed / on hold) | **Check orders** (awaiting), **Not yet with finance**, Invoices, To collect | 🟡 no single stage board |
| My Confirmations | — (orders I verified) | ❌ |
| Reports | **Finance reports** (`/finance`: sales sheet, receivables, cash) | ✅ |
| Payment History | **Payments** | ✅ |
| Refunds | **Refunds** (refund requests; finance records the money) | ✅ |
| Hold with screenshots | Hold with a reason and the order's remarks thread | 🟡 no screenshot upload on the hold itself |
| Announcements & promos | — | ❌ |
| (not in hub) | Agency (GL) claims, Bank | extra |

### Dispatch (Operation) → "Dispatch & pharmacy"
| Hub menu | CRM | |
|---|---|---|
| Dispatch queue | **To pack**, **To deliver** | ✅ |
| Pharmacy | **Rx checks** (`/pharmacy`) | ✅ |
| Return checks | **Return checks** (refund requests, goods to check) | ✅ |
| Dispatched / Tracking Log | **Tracking log** (`/inventory/shipments`) | ✅ |
| My Catered Orders | — (the order's handler sees them in My orders) | 🟡 |
| Inventory & Stock | Medicines & stock, Receiving | ✅ |
| Clients Directory | — (search) | 🟡 |
| Announcements & promos (posts stock news) | — | ❌ |

### Admin
| Hub menu | CRM | |
|---|---|---|
| User Management | People (logins, roles, **modules**) | ✅ |
| Sales KPIs / Scorecard / Sales Performance | Sales & channels, Sales KPIs, scorecards | ✅ |
| Order Ownership (move orders between reps) | Order's handler ("Take it") and sale labels | 🟡 no bulk re-owner page |
| Zoho Sync Health | not needed (no Zoho) | — |

## Not built yet (the hub has it)

1. **Announcements & promos**: stock news from Dispatch / Management, Buy 1 Take 1 promos
   posted by Finance / Management, with an unseen badge for MedReps. This is the one hub
   feature every module has.
2. **Finance stage board** and **My Confirmations**.
3. Cancelled orders in **Exceptions**; screenshot evidence on a Finance hold.
4. **Order Ownership** bulk page (move a rep's orders to another rep).
5. Dispatch's **My Catered Orders** and a read-only **Clients** link.

## Fixed along the way

The order journey counted orders confirmed while the gates were off, and shipped orders, as
"Waiting approval", so Management's dashboard showed approvals that weren't in its queue.
Now only drafts and orders at gate 1 count as "Not approved yet". Orders past the gates, or
on the way, count as "To deliver".
