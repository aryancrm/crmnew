# Role-by-role audit of the new CRM (15 Nov 2026)

Aryan asked to go through every role's every page as that person would, and to fix the gaps.
Four read-only audits looked at the pages and the local demo data. Status: **open** unless marked.

## Dispatch and Inventory

| # | Kind | Where | Finding (short) | Status |
|---|---|---|---|---|
| D1 | BUG | inventory service, stock pages | "Free" ignores pieces promised to placed, not-packed orders (sold twice). Add Promised and Free = shelf − promised; Overview "orders waiting for stock". | done |
| D2 | DATA | overview | No sales velocity, days of cover, dead stock, value at cost, value expiring in 90 days; replace "Top stocked". | open |
| D3 | BUG | overview / stock / medicines | Expired tile links to an unfiltered list; low panel lacks on hand / reorder / coming; "Out of stock" opens Low. | done |
| D4 | ACTION | inventory | No reorder suggestions (free + coming < reorder level) with supplier, last cost, Create PO. | partly (To reorder panel; no per-supplier PO yet) |
| D5 | DATA | medicine page | Batch received date and purchase/supplier; moves "See all"; sales history; open requests. | open |
| D6 | BUG | medicine page | Margin compares VAT-inclusive price with cost. | done |
| D7 | ACTION | moves | No write-off / quarantine of expired or damaged stock; no ₱ value or approval on adjustments. | open |
| D8 | ACTION | transfers | No New button; one batch, instant, no in-transit. | open |
| D9 | CONFUSING | receives | Raw ledger; no "POs to receive"; no filters/search/export on moves. | open |
| D10 | ACTION | purchases | One batch per line; no partial receipts / backorder. | open |
| D11 | BUG | purchases | Landed cost breaks when a PO lands in an existing batch. | done (each receipt keeps the shelf and cost it landed on; the batch is worked out again from every purchase in it) |
| D12 | ACTION | purchases | Cancel with no confirm/reason; no PO print; no supplier filter/paging. | partly (cancel asks why) |
| D13 | DATA | suppliers | No supplier page (POs, spend, medicines, lead time, on-time, terms). | open |
| D14 | ACTION | medicine requests | Answers not linked to a PO/medicine; no "in stock now"; bell link to the list. | open |
| D15 | BUG | dispatch cards | Sorted newest first; should be wanted-today / oldest first, grouped by step. | done |
| D16 | ACTION | dispatch tabs | Web lacks To pack / To ship / On the road / Came back / Mine tabs (API has them). | done |
| D17 | DATA | dispatch home | /api/dispatch/kpis unused; side column shows Management's panels; title "Orders to check". | done |
| D18 | CONFUSING | dispatch cards | Show total ₱ and Management/Finance facts; not COD to collect, Rx, short; DR paper blank. | done |
| D19 | BUG | delivered today | Counts by updated_at; use delivered_on everywhere. | done |
| D20 | DATA | dispatch | No warehouse filter (Main vs Cebu). | done |
| D21 | BUG | board | "N more" links reopen the Board. | done |
| D22 | BUG | board | Courier parcel without tracking can't be marked came back. | done |
| D23 | DATA | board / pack | Short lines not shown before the dialog; no Move button. | open |
| D24 | BUG | deliver | Delivery proof optional; failed upload can't be retried. | done (no signed-receipt photo, not delivered; the photo goes on first and a failed upload retries) |
| D25 | DATA | pack | No short-dated batch warning / customer minimum shelf life. | open |
| D26 | ACTION | pack | No prescription (Rx) check before packing. | open |
| D27 | CONFUSING | order page | "Mark as delivered" on a packed order records a pick-up. | done |
| D28 | DATA | ship | No ship fee, boxes, ETA, tracking link; courier list hard-coded. | open |
| D29 | DATA | shipments | No courier performance (days on road, came-back rate). | partly: Speed page shows road time by courier |
| D30 | DATA | shipments | No courier/date filters, COD column, DR-missing flag, export. | open |
| D31 | DATA | finance/dispatch | COD cash to remit by courier not followed. | open |
| D32 | ACTION | came back / returns | Reason codes, attempts, customer returns with checks. | open |
| D33 | BUG | ship / deliver | Ship and deliver without a pick; demo orders never left the shelf. | done |
| D34 | ACTION | dispatch | No batch pick list to print. | open |

## Management and Finance

| # | Kind | Where | Finding (short) | Status |
|---|---|---|---|---|
| M1 | BUG | orders findings | A cheaper price type (distributor price for a hospital) raises no finding; compare with the customer's own type. | done |
| M2 | BUG | Management / Finance queue | Newest first; late ones at the bottom. Sort the work tab by time at step, "Late" group first. | done |
| M3 | CONFUSING | Board view | Columns count every status but show only the tab's cards. | open |
| M4 | ACTION | Table view | No wait time, findings, terms, row actions or tick-to-approve. | open |
| M5 | ACTION | approve | One click with findings, no acknowledgement/note; bulk approve no confirm. | open |
| M6 | ACTION | orders | "Wait for stock" (hold until stock arrives, then tell). | done: *Wait for stock* (only when short; holder and MedRep told once when it comes in) |
| M7 | CONFUSING | orders | Reject only holds; Exception undefined. | done |
| M8 | CONFUSING | Management home | Figures open lists that don't match (no date filter, pending tab). | open |
| M9 | DATA | Management home | Orders stuck downstream over 48h not shown. | done |
| M10 | ACTION | hold | Holds have no owner, follow-up date or reminder; resume asks no reason. | open |
| M11 | BUG | order page | Changing payment terms at Finance leaves the wrong Finance step. | done |
| M12 | DATA | order page | Warehouse picked blind; stock not net of promised; "Stock short" company-wide. | done |
| M13 | DATA | order page | No last price paid, no margin. | partly (last price paid on each line) |
| M14 | ACTION | order page | Management can't change lines (only send back). | done: *Change the order* (same form, a reason, the MedRep told) |
| M15 | ACTION | order page | No "ask / note" on the order to a named person. | open |
| M16 | ACTION | Finance step | No invoice preview, VAT split, company; no void invoice. | open |
| F17 | BUG | finance | Credit invoice due from invoice day even before delivery (fake overdue). | done |
| F18 | ACTION | invoice | Risky credit invoiced with no reason; bulk invoice no confirm. | open |
| F19 | ACTION | confirm payment | Reused bank reference not checked; part-paid advance leaves. | open |
| F20 | ACTION | proof | No reject-one-proof; no hold evidence. | open |
| F21 | CONFUSING | Finance tabs | On hold shows Management's holds; Delivered today isn't Finance's; uses updated_at. | done |
| F22 | DATA | Finance cards | No customer history button; no slip preview. | open |
| F23 | CONFUSING | cards | "Late" is 4h everywhere; Finance's limit is 24h. One shared limit table. | done |
| F24 | BUG | money | Points counted as money in refunds owed / payments. | done |
| F25 | ACTION | COD / checks | COD cash collected by whom; checks not cleared / bounced. | open |
| F26 | ACTION | Customers owe | No statement, reminder, promise-to-pay; wrong MedRep column; customer terms not invoice terms. | partly (right MedRep and terms on owed; statement of account) |
| F27 | DATA | invoices / payments | No date range, company, MedRep filters; no CSV export; totals by method. | open |
| F28 | ACTION | refunds | Only for cancelled orders; no returns/credit notes/request flow. | open |
| C29 | ACTION | Not checked yet | No checklist / "needs papers"; patients listed; orders waiting not shown. | open |
| C30 | DATA | customer lists | No owed / overdue / credit columns or sort. | done |
| C31 | ACTION | credit | Finance can't set credit limits/terms; no credit hold. | done |
| X32 | DATA | both desks | No personal speed / compare / "What I did". | partly: Speed page built |
| X33 | ACTION | bell | Finance not told of COD delivered / overdue; Management not told of late/stuck. | open |

## Team lead, Head and CEO

| # | Kind | Where | Finding (short) | Status |
|---|---|---|---|---|
| T1 | BUG | all sales pages | One sale credited differently: My team counts by seat, Home/Targets/tree by medrep_id. Count by seat everywhere; picking a MedRep sets the seat. | done (a sale counts for its seat's holder today, else its MedRep, on team sales, targets, channels and KPIs) |
| T2 | ACTION | create order | "For whom" should be step 0, by seat (vacant seats too); ?seat= from My team; narrow customers to that seat. | partly: "Whose order" picker built |
| T3 | BUG | create order | Division / sub-division from the lead's own area, blank for leads. | done |
| T4 | CONFUSING | customer picker | Rows don't show area · MedRep. | open |
| T5 | BUG | team orders | "Fix and send again" offered to the lead on a MedRep's order (409). | done |
| T6 | CONFUSING | team orders | Tab says "Sent back to me" on the team view. | done |
| T7 | ACTION | team orders | No MedRep/team/text/date filters, no table. | open |
| T8 | CONFUSING | Home vs My team | Two pages, different numbers; month pace lost on My team. Make My team the lead's Home. | open |
| T9 | ACTION | Home people rows | Not links; empty seats and covers missing. | open |
| T10 | ACTION | My team tiles | Tiles open nothing. | open |
| T11 | DATA | dues | Lead can't list what customers owe (403); team owed-by-age list with phones. | open |
| T12 | CONFUSING | Needs you | Overdue lines by invoice; group per customer with total and phone. | open |
| T13 | CONFUSING | vacant wording | "wait with you" for CEO; lead-seat wording. | open |
| T14 | DATA | customers | Customers who stopped ordering / never ordered; owed and sold on rows. | done |
| T15 | CONFUSING | seat page | Orders tab ignores the dates; daily chart zeroes placed/collected. | open |
| T16 | ACTION | seat page | No Message / Call / Ask to fill; lead seat shows own ₱0. | open |
| T17 | DATA | targets | Targets per person, not per seat. | open |
| T18 | CONFUSING | targets | Lead's own target double-counted in team sums. | open |
| T19 | ACTION/BUG | asks / areas | Ask can't fill an existing empty seat; same city allowed in two areas. | partly (one city, one area) |
| T20 | BUG | messages | Team thread members frozen at first send. | done |
| T21 | CONFUSING/DATA | head | Menu titled "Team lead"; no side-by-side team table. | open |
| T22 | CONFUSING | CEO structure | Five structure pages on three sources; names don't match. | partly: Company chart now on seats |
| T23 | BUG | sidebar | /company and /targets swap the CEO's sidebar to Reports. | partly: /company fixed |
| T24 | ACTION | old tree | Details sheet with no way onward, old words. | done: old tree replaced |
| T25 | ACTION | team chart | No zoom/fit; unclear where you are after a click. | done: zoom, Fit, Back button |
| T26 | CONFUSING | Company view | Heading, empty "its own people", departments counted as sales teams, desks as sellers. | open |
| T27 | DATA | desks | Desk time per person, who is late. | done: Speed page |
| T28 | DATA | who sold most | Leaves out selling lead seats (Jane); placed beside sold. | done |
| T29 | CONFUSING | owed | Two definitions of "customers owe" (COD not delivered). | open |
| T30 | BUG | CEO home | "Stuck" link not read by /orders. | done |
| T31 | CONFUSING | late rules | Three rules for late; one on status_since. | done |
| T32 | DATA | CEO channels | No path channel → team → person → orders. | open |
| T33 | DATA | CEO | Top customers, owed by age, medicines with margin, new vs repeat, orders today by channel. | open |
| T34 | BUG | CEO new order | CEO sees New order but may not place it. | done |
| T35 | ACTION | search | Search finds no people, logins or order codes. | done |
| T36 | DATA | reports | Only three reports. | open |
| T37 | DATA | Teams & people | Seat rows lack sales/target/owed/last order. | open |

## MedRep and Online desk

| # | Kind | Where | Finding (short) | Status |
|---|---|---|---|---|
| R1 | ACTION | held order | MedRep can't answer a hold or cancel his held order. | done |
| R2 | BUG | invoices | Invoice links 403 for the MedRep and Online desk on their own orders. | done |
| R3 | ACTION | own order | Can't withdraw/edit while waiting for Management. | open |
| R4 | ACTION | papers | Can't attach a collected cheque/slip after delivery; Finance not told. | open |
| R5 | ACTION | stock / returns | No wait-for-stock; no return/refund request. | open |
| R6 | ACTION | My orders | No search, dates, Cancelled tab; top search finds no orders. | open |
| R7 | BUG | My orders | "Delivered this month" by updated_at. | done |
| R8 | DATA | new order | Form doesn't warn the customer is overdue / over credit. | done |
| R9 | ACTION | new order / quote | No "not in our list? ask Inventory" when a medicine isn't found. | done |
| R10 | ACTION | new order | No-Rx / no-proof reasons, source, valid ID, LTO/BIR uploads. | open |
| R11 | DATA | MedRep home | No "to collect" list with ageing. | done |
| R12 | CONFUSING | MedRep home | Placed vs invoiced vs target figures contradict; IST 78% vs 39%. | open |
| R13 | BUG | MedRep home | Period cells open tabs with other numbers; Fix opens the order not the fix form. | done |
| R14 | DATA | scorecard | Money waiting in the line not shown (red "Review" on day 15). | open |
| R15 | DATA | scorecard | Rows can't be opened (which customers, which bills, which days). | open |
| R16 | DATA | MedRep home | No month-by-month history against target. | open |
| R17 | DATA | incentive | No incentive rule or estimate (needs Aryan's rule). | needs decision |
| R18 | CONFUSING | words | Status words differ between Home and My orders. | open |
| R19 | BUG | demo data | Invoices dated before their orders. | done (demo invoices dated after their orders; older demo databases put right on start) |
| R20 | BUG | My area | "Haven't ordered in 60 days" link has no filter. | done |
| R21 | DATA | customers | Cards lack owed / overdue / days since order; no sort. | done |
| R22 | ACTION | customer page | No "New order" button. | done |
| R23 | CONFUSING | kinds | Drugstores can't be reached from Home / My area tabs. | open |
| R24 | DECISION | field | No visit log / plan / map (SEFMED question). | needs decision |
| R25 | CONFUSING | phone tabs | Phone tab bar shows no counts. | open |
| O26 | DATA | Online home | No figures: enquiries, replies waiting, conversion, sales vs target. | open |
| O27 | BUG | leads desk | API's "attention" queue not shown. | done ("Waiting on you" tab on the Leads desk) |
| O28 | ACTION | case | Sent-back/held case order has no fix on the case; revise doesn't resync quotation. | open |
| O29 | CONFUSING | Online My orders | MedRep's tabs; cards open the order not the case. | open |
| O30 | BUG | Online customers | Sees every hospital's money and orders. | done |
| O31 | ACTION | follow-up | No refill / repeat / follow-up to-dos. | open |
| O32 | ACTION | inbox | No saved replies. | open |
| O33 | CONFUSING | order page | COD payment recordable before delivery. | done |
| O34 | CONFUSING | points | Points link shown while the program is off. | open |
