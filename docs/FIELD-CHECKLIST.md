# SEFMED, every screen and rule, and where it is in the MedRep's pages (20 Nov 2026)

Aryan, 20 Nov: "all of SEFMED's features, same to same"; first as its own app, then the same day
"integrate it into our MR pages as options of their own; MRs made orders in the hub and kept records
on SEFMED, we join both; same hierarchy: team lead approves, the head above, then the CEO". This
list keeps every SEFMED feature in sight, the way docs/HUB-CHECKLIST.md does for the hub. Sources: Aryan's phone screenshots
(20 Nov), SEFMED's brochure (26 pages, app and web portal), GetMeds' SEFMED web portal opened in the
browser pane (read only, 20 Nov), and the 12 Nov read of GetMeds' account (old repo
`docs/architecture/sefmed-inventory.md`, `sefmed-reports.md`, `docs/data/sefmed-masters-2026-11-12.json`).
Plan and decisions: docs/PLAN.md section 22.

Marks: ✅ built in the MedRep's pages (20 Nov, local) · ◐ partly · ⬜ to build.

## GetMeds' own SEFMED lists (the starting values)

- Call statuses: Open, Reschedule, Skipped, Closed ✅ (+ Missed: a planned visit not done by the day report).
- Call objectives: Business Call, Thank You Call ✅ (+ Aryan's list of 20 Nov ✅).
- Skip reasons: Out of town, Not available, Busy, Others ✅ (+ clinic / office closed, moved to another day).
- Doctor categories A–E ✅; dispensing / non-dispensing ✅.
- Hospital categories Government / Private ✅; classes General / Specialty ✅.
- Firm types: super stockist, distributor, sub-distributor, stockist, retailer ✅ (SEFMED's Company / Hospital / Doctor / Patient levels are other masters here).
- Expense heads: the 24 of GetMeds' SEFMED, 20 in use ✅.
- Designations: not copied: the company tree's people and seats (MedRep → team lead → head → CEO).

## The MR's side (the MedRep's Visits folder: My day, Today's visits, Tour plan, KOLs / hospitals / KBLs…)

### Home
- ✅ Big circle: *Start working* → *Since 4:55 PM · Head quarter-Angeles City · Stop working*; on a break, *Back to work*; after the report, *Day closed*.
- ✅ Tiles: Visits, KOLs, KBLs, Hospitals, Tour plan, My orders (the CRM's), Expenses, Leaves, Holidays, Follow-ups, Day report, Reports. ⬜ Presentation, App tutorial (with e-detailing); Admin is the lead's side.
- ✅ Today's numbers (planned, closed, left, ordered at visits) and the next visit.
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
- ✅ Drugs promoted and how each was taken. ✅ Samples and gifts from the rep's own sample stock (the samples module, the doctor's signed acknowledgement), shown on the call.
- ✅ *Add order* on the call opens the CRM's own *Create New Order* for that customer, keeps the call as typed, and comes back; the order joins the visit and goes to Management, Finance and Dispatch as every order (the hub's order + SEFMED's record, one place). *Business generated* needs one.
- ✅ Close the call: met / not met / unavailable / cancelled, promotional / business / both, outcome, chance, productive / not / not sure yet, feedback, remarks, follow-up, next visit, photos, place at closing, time at the call.
- ✅ Hospital call: people met, pharmacy, purchase department, institutional chance. ✅ Firm call: stock, sold, demand per product, chemist met, outstanding payment, market feedback, competitors.
- ✅ Skip (reason), Reschedule (why, once approved); ✅ missed with reason at the day report.
- ⬜ Back-dated visit with a deadline; ⬜ group call; ⬜ campaign tag.

### Doctors, firms, hospitals
- ✅ KOLs / Hospitals / KBLs are the CRM's own customers (doctors; hospitals; drugstores and distributors): *For me* / *Team* with counts (the team switch), Refresh, search by name, city, hospital or code, "ALL (n)", cards with code (CUS-…), category, specialty, hospital, city, looked after by, last / next visit, *Pref day/time*; + Add opens the CRM's own Add customer.
- ✅ A customer's actions: Open, Get directions, Add visit, Add order (CRM), View last five visits, Call history, Ask to take off the list (the team lead answers; nothing erased). ⬜ Stock tally (firm), ⬜ Payment (firm).
- ✅ The field's details beside the customer: category (the visit class A–D, the lead's), the firm that serves a doctor, gender, qualification, dispensing, contact person, zone, preferred days and time, visits a month. The customer itself (name, address, licence, phone) stays the CRM's, edited on its own page; what it owes and its orders show on the field page. ⬜ Marital status, ⬜ attachments tab, ⬜ up to 3 practice places.
- ✅ Duplicates refused (the CRM's rule: same kind, name and city; a hospital comes with its papers). ⬜ Hospital beds / ICU / OT / key persons; ⬜ firm hierarchy (distributor → chemist).

### Tour plan
- ✅ Calendar with marks (tour plan, pending leave, cancelled / rejected leave, approved leave, holiday, back-dated), list view, working days with no plan.
- ✅ A day's *Select action*: view / reschedule visits, work place and city, add visits to KOLs / firm / hospital, working with, open the day's visits.
- ✅ Cities, then clients ("Please select city to add visits") → visits added. ⬜ Zone before city.
- ✅ *Create tour plan* → the lead approves or sends back with a word; each decision kept as a revision.
- ✅ After approval: a visit moved / added / dropped or a day's place changed is a deviation with why; the lead approves or rejects.

### Expenses
- ✅ Per diem and TA lines for each day worked (rates per work place, 0 until Management or the Admin set them), claimed by the MR. Older lines (petrol, fares…) show by their kind.
- ✅ Add expense: date (31 days back), head (GetMeds' list), amount, remark, attach or camera; the bill required where the head needs one.
- ✅ Head · Date · Claimed · Amount, ⋮ to claim or change; totals Claimed / Approved.
- ✅ The person's team lead approves (the amount may be less) or rejects with why (the head may stand in); *Expenses to approve* follows the team switch.
- ⬜ Fare chart by km, the approval above the lead, Finance paying (PLAN Q29); ⬜ expense report by day status; ⬜ month lock.

### Leave and holidays
- ✅ Leaves: the CRM's own page (balance, half / full / several days, kind, reason, approval) from the tile.
- ✅ Holidays: the year's list; on the tour plan calendar too.

### Reports (in the app)
- ✅ Call reports (from–to, MR, status; Total visits; Visit details: employee, client, client no, visit date, last visit, check-in / check-out, objective and remark, working with, feedback, follow-up date).
- ✅ Missed call report, ✅ Attendance report (month: present / absent / leave / weekly off / holiday with totals), ✅ orders: the CRM's My orders / Team orders.
- ⬜ Coverage, call objective report, KPI.

### Business, e-detailing
- ◐ Sales, subordinates' sales, area / hospital sales: the CRM's own pages (My team, Scorecards, Hospitals). ⬜ Doctor business planning, product business.
- ⬜ Presentations (e-detailing), visual aids, quizzes.

## The team lead's side (Team visits folder; the head and the CEO the same, from higher up)

- ✅ Team today: each MedRep Present / Absent with work place, cities and start time, closed of the day's visits, missed, ordered, at which customer now, the day report; ✅ what waits (day reports, calls to judge, tour plans, deviations, expenses, off-list asks), also on *To decide*. ✅ The team switch (each box under the lead; the head's whole division; the CEO's company).
- ✅ SEFMED's dashboard figures: field employees, doctors, firms, hospitals; closed visits this month / week / today; attendance %; Call Champion; Field activities ("X checked in / closed the visit of Y"). ⬜ Doctor business by employee; ⬜ zone-wise visit chart.
- ✅ An MR's actions: View visits, View expenses, View location on map, Manage tour plan, View attendance, Day report, Orders. ⬜ Put employee on hold (a lock: needs Aryan's yes), ⬜ Feedback to the MR.
- ✅ Approve tour plan (each MR's month: status, whole month planned or the missing days). ⬜ Add a monthly plan for an MR, ⬜ block / unblock.
- ✅ Deviation approval. ✅ Team visits (anyone / everyone, a day or a month). ⬜ Export, zone / city filters.
- ✅ Day reports: mark seen with a word. ✅ Calls left "not sure yet": productive or not. ✅ Reopen a closed call with why (kept, the MR told).
- ✅ Expenses: the team's, approve / reject. ✅ Today's places on the map (and the CRM's Where the team is). ✅ The people: the company tree (no list of its own).

## Joined to the CRM (20 Nov)

- ✅ Customers are the CRM's; ✅ an order at a visit is a CRM order (Management approves as every order); ✅ samples from the samples module; ✅ visits, month plans and expenses on the CRM's own records (the older Visit plan, Calendar and Visits report read them too).
- ⬜ SEFMED's export loaded (5,729 doctors, 2,067 hospitals, 313 firms, matched to CRM customers); ⬜ secondary sales and stock tally; ⬜ rate master doctor-wise (a price rule: Aryan's word).
