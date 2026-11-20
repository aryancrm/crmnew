# SEFMED, every screen and rule, and where it is in the MR App (20 Nov 2026)

Aryan, 20 Nov: "all of SEFMED's features, same to same, as its own app; two sides (the MR's and the
team lead's); one team lead who sees everything; integration later". This list keeps every SEFMED
feature in sight, the way docs/HUB-CHECKLIST.md does for the hub. Sources: Aryan's phone screenshots
(20 Nov), SEFMED's brochure (26 pages, app and web portal), GetMeds' SEFMED web portal opened in the
browser pane (read only, 20 Nov), and the 12 Nov read of GetMeds' account (old repo
`docs/architecture/sefmed-inventory.md`, `sefmed-reports.md`, `docs/data/sefmed-masters-2026-11-12.json`).
Plan and decisions: docs/PLAN.md section 22.

Marks: ✅ built in the MR App (20 Nov, local) · ◐ partly · ⬜ to build. "Later" = the tie to the CRM.

## GetMeds' own SEFMED lists (the starting values)

- Call statuses: Open, Reschedule, Skipped, Closed ✅ (+ Missed: a planned visit not done by the day report).
- Call objectives: Business Call, Thank You Call ✅ (+ Aryan's list of 20 Nov ✅).
- Skip reasons: Out of town, Not available, Busy, Others ✅ (+ clinic / office closed, moved to another day).
- Doctor categories A–E ✅; dispensing / non-dispensing ✅.
- Hospital categories Government / Private ✅; classes General / Specialty ✅.
- Firm types: super stockist, distributor, sub-distributor, stockist, retailer ✅ (SEFMED's Company / Hospital / Doctor / Patient levels are other masters here).
- Expense heads: the 24 of GetMeds' SEFMED, 20 in use ✅.
- Designations: not copied: the app keeps MRs and one team lead (Aryan, 20 Nov).

## The MR's side (the app)

### Home
- ✅ Big circle: *Start working* → *Since 4:55 PM · Head quarter-Angeles City · Stop working*; on a break, *Back to work*; after the report, *Day closed*.
- ✅ Tiles: Visits, KOLs, KBLs, Hospitals, Tour plan, Order details, Expenses, Leaves, Holidays, Follow-ups, Day report, Reports. ⬜ Presentation, App tutorial (with e-detailing); Admin is the lead's side.
- ✅ Today's numbers (planned, closed, left, booked) and the next visit.
- ⬜ Synchronize / working offline. Support / chat: not copied (the CRM's Messages).

### Start work and the work place
- ✅ Start with the time and the phone's place; starts the CRM's attendance day too.
- ✅ Work place: Head quarter, Ex-station, Out-station, In transit, Other (a word), Return to HQ; Cancel / Update / Stop.
- ✅ "Your work city for the day is …" from the tour plan's day; ✅ working with (joint work); ✅ breaks.
- ✅ The manager's map: the places taken at start, change of place, break, I'm here, close, stop. ⬜ A trail every few minutes (PLAN Q30).

### Visits
- ✅ Tabs KOLs · Hospitals · KBLs with counts; a day or a whole month; New, At the place, Closed, Skipped, Missed; cards with name, Government / Private or firm type, city, state, date; Add visit (on the day with why).
- ✅ The visit: client, hospital, specialty, priority, best day / time, directions; call objective(s) with remark; working with.
- ✅ *I'M HERE*: time, place, distance from the pin (away over 300 m said, never refused); pin the place from a check-in.
- ✅ Prescribing drugs: the doctor's list with *prescribing* and *top 5*, kept per doctor, editable in each call.
- ✅ Drugs promoted with the sample quantity and how each was taken. ◐ Samples from the rep's sample stock: later (the samples module).
- ✅ Order booking over the visit: products with MRP, rate incl. tax, tax, quantity in packs, amount, PO photo, Submit.
- ✅ Close the call: met / not met / unavailable / cancelled, promotional / business / both, outcome, chance, productive / not / not sure yet, feedback, remarks, follow-up, next visit, photos, place at closing, time at the call.
- ✅ Hospital call: people met, pharmacy, purchase department, institutional chance. ✅ Firm call: stock, sold, demand per product, chemist met, outstanding payment, market feedback, competitors.
- ✅ Skip (reason), Reschedule (why, once approved); ✅ missed with reason at the day report.
- ⬜ Back-dated visit with a deadline; ⬜ group call; ⬜ campaign tag.

### Doctors, firms, hospitals
- ✅ KOLs / Hospitals / KBLs: *For me* / *Team* with counts, Refresh, search by name, city, hospital or code, "ALL (n)", cards with code, category, specialty, hospital, city, assigned to, last / next visit, *Pref day/time*; + Add.
- ✅ A client's actions: View / edit, Get directions, Add visit, View last five visits, Call history, View / add order (firm), Delete (a request the lead answers). ⬜ Stock tally (firm), ⬜ Payment (firm).
- ✅ Add / edit: name, assign employee (lead), hospital, firm selection, gender, category, specialty, qualification, registration no., dispensing, contact, address, city, zone, preferred days and time, visits a month, note. ⬜ Marital status, ⬜ attachments tab, ⬜ up to 3 practice places.
- ✅ Duplicates refused (same kind, name and city). ⬜ Hospital beds / ICU / OT / key persons; ⬜ firm hierarchy (distributor → chemist).

### Tour plan
- ✅ Calendar with marks (tour plan, pending leave, cancelled / rejected leave, approved leave, holiday, back-dated), list view, working days with no plan.
- ✅ A day's *Select action*: view / reschedule visits, work place and city, add visits to KOLs / firm / hospital, working with, open the day's visits.
- ✅ Cities, then clients ("Please select city to add visits") → visits added. ⬜ Zone before city.
- ✅ *Create tour plan* → the lead approves or sends back with a word; each decision kept as a revision.
- ✅ After approval: a visit moved / added / dropped or a day's place changed is a deviation with why; the lead approves or rejects.

### Expenses
- ✅ Per diem and TA lines for each day worked (rates per work place, 0 until set), claimed by the MR.
- ✅ Add expense: date (31 days back), head (GetMeds' list), amount, remark, attach or camera; the bill required where the head needs one.
- ✅ Head · Date · Claimed · Amount, ⋮ to claim or change; totals Claimed / Approved.
- ✅ The lead approves (the amount may be less) or rejects with why; sets the rates.
- ⬜ Fare chart by km, the approval above the lead, Finance paying (PLAN Q29); ⬜ expense report by day status; ⬜ month lock.

### Leave and holidays
- ✅ Leaves: the CRM's own page (balance, half / full / several days, kind, reason, approval) from the tile.
- ✅ Holidays: the year's list; on the tour plan calendar too.

### Reports (in the app)
- ✅ Call reports (from–to, MR, status; Total visits; Visit details: employee, client, client no, visit date, last visit, check-in / check-out, objective and remark, working with, feedback, follow-up date).
- ✅ Missed call report, ✅ Attendance report (month: present / absent / leave / weekly off / holiday with totals), ✅ Order booking report (Order details).
- ⬜ Coverage, call objective report, KPI.

### Business, e-detailing
- ⬜ Sales, subordinates' sales, doctor business planning, product business, area / hospital sales (later, with the CRM's orders).
- ⬜ Presentations (e-detailing), visual aids, quizzes.

## The team lead's side

- ✅ My team: each MR Present / Absent with work place, cities and start time, closed of the day's visits, missed, booked, at which client now, the day report; ✅ what waits (day reports, calls to judge, tour plans, deviations, expenses, delete requests).
- ✅ SEFMED's dashboard figures: field employees, doctors, firms, hospitals; closed visits this month / week / today; attendance %; Call Champion; Field activities ("X checked in / closed the visit of Y"). ⬜ Doctor business by employee; ⬜ zone-wise visit chart.
- ✅ An MR's actions: View visits, View expenses, View location on map, Manage tour plan, View attendance, Day report, Orders. ⬜ Put employee on hold (a lock: needs Aryan's yes), ⬜ Feedback to the MR.
- ✅ Approve tour plan (each MR's month: status, whole month planned or the missing days). ⬜ Add a monthly plan for an MR, ⬜ block / unblock.
- ✅ Deviation approval. ✅ Team visits (anyone / everyone, a day or a month). ⬜ Export, zone / city filters.
- ✅ Day reports: mark seen with a word. ✅ Calls left "not sure yet": productive or not. ✅ Reopen a closed call with why (kept, the MR told).
- ✅ Expenses: everyone's, approve / reject, rates. ✅ All on map. ✅ The app's people (the Admin names the lead; the lead adds and takes out MRs).

## Later: the tie to the CRM

- ⬜ A client ↔ CRM customer; ⬜ a booked order → a CRM order with its lines (Management approves as every order); ⬜ SEFMED's export loaded (5,729 doctors, 2,067 hospitals, 313 firms); ⬜ samples from the samples module; ⬜ secondary sales and stock tally; ⬜ rate master doctor-wise (a price rule: Aryan's word).
