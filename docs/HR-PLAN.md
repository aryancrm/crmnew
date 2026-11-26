# HR plan: HR's own desk first

Plan written 24 Nov 2026 on the `hr` branch (from main `fc0dc5e`). It covers the work the HR team
does on its own desk. Company-wide features (a directory for everyone, announcements, performance,
learning, surveys, OKRs, benefit plans) come after it. Nothing here is a new business rule until
Aryan or HR agrees; once one is, it goes into [PLAN.md](PLAN.md) (its section and a change-log line).

## Where we start

Two HR systems exist today.

- **The CRM's HR** (`apps/api/src/hr`, `apps/web/src/hr`): the person's record, the org tree and
  seats, attendance by signing in, leave, the OB / WFH / OT forms with one approval, a monthly
  payroll with payslips under the Philippine rules, and the role checks (HR and the Admin write,
  the CEO reads; HR records stay private while looking as someone, except for the CEO and the Admin).
- **Automated-Excel** (hr.getmeds.ph, its own Supabase database and logins): what HR uses now.
  It turns the biometric Excel file into DTRs, keeps leave credits, runs seven forms through the
  supervisor and then HR with signatures and revoke, prints them as `.docx`, runs a semi-monthly
  payroll, knows local holidays by town, sends probation and pending-approval reminders, and keeps a
  field-level audit log.

**The direction:** HR lives inside the CRM (PLAN 12.7: one person is one login, one employee record,
one seat). Automated-Excel is the source of HR's real rules: we read its code and its compare tests,
bring the rules into the CRM, run both side by side, then leave Automated-Excel read-only as the
record of what came before (nothing with history is deleted).

## HR's desk: what we add

| # | HR's job | In the CRM today | What we add |
|---|---|---|---|
| 1 | **People records** | Record, search, edit (HR and the Admin); `employee` table; `/hr/people` | Each person's papers (contract, IDs, certificates); employment history; a list of positions (today free text); the fields Automated-Excel has and the CRM lacks; who changed what on every edit |
| 2 | **Joining** | New joiner into a vacant seat; Sign-ups (`/admin/sign-ups`) | A joining checklist (requirements in, orientation done, login given); reminders at probation months 3 and 5; regularization due |
| 3 | **Leaving** | Mark as left (`left_on`, `left_reason`): the login stops, the seat falls vacant, the record stays | Resignation received → clearance (each desk signs off: IT, Finance, Inventory, the team lead) → exit interview → final pay noted |
| 4 | **Attendance** | Signing in marks the day; HR puts a day right (`attendance`, `/hr/attendance`) | The biometric Excel imported into a DTR per cut-off; a *Needs review* list for days that can't be read; employees ask for a correction and HR decides; HR gives each person a schedule or shift (`work_schedule`, no screen yet) |
| 5 | **Leave and forms** | Leave (10 VL, 10 SL for regulars), OB / WFH / OT (`person_leave`, `hr_form`), one approval | Credits HR can adjust; the 7-day notice for VL; half of unused VL converted; a second approver; the overtime rules (night differential, rest day, holiday); revoke until HR decides, kept on record; printable forms with the signers' signatures; one queue of everything waiting for HR |
| 6 | **Payroll** | One run a month (`pay_run`, `payslip`, dated `pay_rule`) | The cadence decided below; local holidays by town; attendance, leave and overtime from 4 and 5 feeding in; checked against HR's own payroll register |
| 7 | **HR's Home and reports** | Attendance report (`/hr/report`) | What is due today (probation, regularization, birthdays, waiting approvals); headcount, joiners and leavers, attrition, late and absent trends |
| 8 | **Access and trail** | `HR_ROLES`, `HR_WRITE_ROLES`, the look-as guard (`hr/routes.ts`) | An audit trail for every HR change, sensitive values hidden; who in HR may see pay |

## Order of work

One feature per commit, each with its tests; `checks/integrity.ts` and `scale.test.ts` stay green.

1. **People records (about 1 week).** The audit trail first (everything after writes to it), then
   the papers (through `files/store.ts`), employment history, the positions list, the missing fields.
   *Done when* HR opens a person and sees their papers, their jobs over time and who changed what.
   - [x] **HR's trail** (24 Nov): migration 0149 `hr_event`, `hr/events.ts`; a joiner added, each
     record change field by field (pay, bank, government numbers and the birth date only as
     "changed"), a login email changed or a one-time password given, marked as left, back at work.
     *Changes* on the person's page (HR, the CEO, the Admin; never while looking as someone), and
     *HR records* in the Audit. Test: `hr/events.test.ts`.
   - [x] **Each person's papers** (24 Nov): migration 0150 `hr_paper`, `hr/papers.ts`; contract,
     government ID, certificate, clearance, medical, other; a PDF, photo or Word file up to 10 MB
     through `files/store.ts`; a "good until" day, marked expired or within 30 days. HR and the
     Admin add and take off (archived with a reason, never deleted); HR, the CEO, the Admin and the
     person read; never while looking as someone. Both written in HR's trail. Test: `hr/papers.test.ts`.
   - [x] **Job history** (24 Nov): from HR's trail, on the person's page with the seats held:
     joined, position, department, employment, company, regularized, pay changed (never how much),
     left, back. The person sees their own. Test: `hr/events.test.ts`.
   - [x] **Positions** (24 Nov): migration 0151 `hr_position`, `hr/positions.ts`, HR's *Positions*
     page. Started from the positions, titles and seat titles the CRM had; a record's position is one
     of the list (or a seat's title HR hasn't archived), so a typo never becomes a job title. HR and
     the Admin add and archive (never delete; records keep an archived one). Test: `hr/positions.test.ts`.
   - [x] **The fields HR's portal kept** (24 Nov, migration 0151): gender, civil status, citizenship,
     spouse, father, mother, highest education, school, course, work arrangement (office, field,
     hybrid, remote), company phone, issued equipment, job description. On the record, in the edit
     form and in the trail. Left out for now (to confirm with HR): nickname, territory (the CRM's
     area does it), position category, contract status, training date, company rules.
2. **Attendance (about 1.5 weeks).** The biometric Excel import into a DTR, *Needs review*,
   correction requests, schedules. *Done when* one real cut-off's DTR matches HR's own sheet.
   - [x] **Correction requests** (24 Nov): migration 0152 `attendance_fix`, `hr/corrections.ts`. A
     person asks for a day of the last 31 (not ahead) to be put right: time in, time out if any, what
     happened; one open a day. It goes to whom they report to (HR when that is the CEO, the Admin or
     nobody), HR may decide any, never while looking as someone; refusing needs a word; the person
     cancels one still waiting (kept). Approved, the day is set as HR's "put a day right" does,
     marked *request* (in/out source), and HR's trail says "Attendance of … put right (request)".
     The person: *Ask to fix a day* on My leave & forms and on their attendance month; leads and HR
     decide under Leave & forms › Attendance and on *To decide*; HR sees them on the person's month.
     Test: `hr/corrections.test.ts`.
   - [x] **Schedules** (24 Nov): migration 0152, `hr/schedules.ts`, HR's *Schedules* page. HR and the
     Admin add a schedule (name, days, start and end on the same day, break, grace), archive one
     nobody is on (never the default, never deleted), and give a person one on their page (Job ›
     Change schedule) or put them back on the company's default; written in HR's trail. Late,
     undertime, rest days and leave days count on the person's own schedule. Test: `hr/schedules.test.ts`.
   - [x] **Biometric import** (24 Nov): migration 0153 `timekeeping_device`, `timekeeping_import`,
     `biometric_day`; `hr/timekeeping-sheet.ts` (the sheet, a pure function) and `hr/timekeeping.ts`;
     HR's *Timekeeping* page. HR picks the workbook (.xlsx, 10 MB) and it is read first, nothing kept:
     the days it covers (any run, from C3 and the day numbers: 11th–25th, 26th–10th or a month),
     each row's device ID and name, who it is in the CRM, and each day read (first in, last out, or a
     code). A row is matched by the device ID HR set before, else by the employee ID; a name that looks
     like someone's is only a suggestion HR confirms (*This is …*, which keeps the device ID for next
     time). Rows matched to nobody are listed and left out. The import keeps the file (through
     `files/store.ts`) and each person's days beside the CRM's attendance, never over it; the same days
     imported again make the new rows current and keep the old ones. *Needs review*, on the page across
     everyone and on the person's attendance month (a *Biometrics* column): one punch, an odd number
     of punches, a mistyped time, TRAINING, LEAVE, LWOP or any code it can't read, and days where the
     biometrics and the CRM differ by over 15 minutes or only one of them has the day. HR uses the
     biometric times for a day (set as *biometric*, written in HR's trail) or dismisses the flag with a
     note (kept, and kept on a re-import of the same cell). HR and the Admin work; the CEO reads; never
     while looking as someone. Data check: each import's day count is its rows. Test: `hr/timekeeping.test.ts`.
     *Taken from Automated-Excel:* the sheet's layout and the cell rules of `lib/timekeepingParser.js`
     (two rows a person, device ID in B or C, the name after "Name:", punches jammed together, the
     codes OB, OFF, H, VL, SL, ML, HDVL, HDSL, A, the sheet found by "Att. Time" in A3 in older
     exports, a mistyped end date read from the day columns), and the name rules of
     `lib/employeeNameMatch.js`, here only as a suggestion. *Not taken:* the totals columns (regular
     hours, overtime, late; the CRM works them out from the days) and its leave/OB reconcile.
     *To confirm with HR:* one real cut-off's workbook, to read side by side with HR's own DTR (the
     answer-key idea of `tests/dtr_compare.mjs`); whether the sheet carries an employee ID anywhere
     ("Emp No:" on the ID row is read when there); how TRAINING, LEAVE and LWOP days count; whether
     the 15 minutes is the right tolerance.
3. **Leave and forms (about 1.5 weeks).** Credits, the leave rules, the overtime rules, revoke,
   printable forms, HR's one queue.
   - [x] **Credits HR adjusts** (24 Nov): migration 0154 `leave_credit`, `hr/credits.ts`. A person's
     VL and SL for a year read as a ledger: the opening days by the rule (regular 10 + 10, others
     none), HR's adjustments (+ or -, half days, a reason each), used (approved) and waiting; what is
     left never goes below nothing. A line is never changed or deleted: a wrong one is reversed once
     by another naming it. HR and the Admin adjust, the CEO reads; each line in HR's trail (kind
     `leave`). *Leave credits* on the person's page (with the year), HR's changes on *My leave &
     forms*; every balance reads the ledger, and someone on probation can use days HR gave.
   - [x] **The leave rules** (24 Nov, `hr/leave-rules.ts`, `hr/leave.ts`): vacation leave 7 days
     ahead (HR recording leave for someone is not held to it, as Automated-Excel's filing on
     someone's behalf); sick leave of 2 working days or more needs a medical certificate; up to 5
     proof files a leave (photos or PDFs, 10 MB each, through `files/store.ts`, table `leave_file`;
     the old single paper still opens, and `/file` is the first paper); a **second approver** HR names
     on the record (*Leave credits* › Second approver, in the trail) also decides the person's leave
     and sees it on Leave & forms, the first of the two to decide closes it; **revoke**: the person
     takes back approved leave until its first day, HR any time, kept as `revoked` with who, when and
     why, its days back in the credits, the approvers told. **Year-end VL** (`/hr/leave/conversion`,
     HR, the CEO, the Admin): each person's unused VL, half of it to convert, at monthly × 12 ÷ 313 a
     day, in pesos; a report only, nothing paid (PLAN 12.16).
   - [x] **Forms** (24 Nov, `hr/forms.ts`): the **daily accomplishment report** (purpose, activities
     with time in and out, place, details, deadline, remarks) and the **incident report** (day within
     30 days and never ahead, time, place, kind: safety, misconduct, property damage, security or
     other, what happened, who was involved, what was done), both straight to HR; HR takes an
     incident in (never refuses it). **Overtime**: its type (regular day, rest day, regular holiday,
     special day, rest day on either, broken time; the day's own kind or broken time), times on the
     hour or half hour, past midnight allowed; the hours counted by Automated-Excel's rules (on a
     regular day the person's working hours never count, the first hour whole then half hours, an
     hour's lunch off from 9 hours, the night part 10 PM to 6 AM kept apart as night differential);
     refused on a day with official business filed (waiting or approved). Attendance and payroll
     count overtime by those minutes (rows from before keep from–to). **Head Requisition**: a team
     lead or manager files overtime for someone under them; it goes straight to HR, the person is
     told, the lead (not the person) revokes it. **Revoke**: whoever filed a form takes it back until
     it is decided, kept as `revoked` with who, when, the status it had and the desk it was at.
     **Returned**: HR sends a waiting or approved form back with what to fix; the person sends it
     again (checked again) or revokes it; *To decide* shows "Forms returned to you to fix".
   - [x] **Signatures and printouts** (24 Nov, `hr/print.ts`, table `person_signature`): each person
     draws their signature on *My leave & forms* (a PNG through `files/store.ts`); drawing again
     archives the old one, never deletes it. An approved leave or form prints at `/hr/print/leave/:id`
     and `/hr/print/form/:id` (a clean page; the browser prints or saves a PDF) with what HR's
     templates carry and the boxes of the employee, the immediate superior and HR, each with the
     signature in force when that person filed or decided (for Head Requisition the lead signs the
     employee's and the superior's boxes). Opened by the person, whoever filed it, whom it went to or
     who decided it, the leads above, HR, the CEO and the Admin; never while looking as someone.
   - [x] **HR's one queue** (24 Nov, `hr/queue.ts`, `/api/hr/queue`): Leave & forms shows each
     switch's waiting count and *All waiting* (leave, forms, attendance days together); for HR it
     says how many came to HR itself. The counts come from the same lists *To decide* reads.
     Tests: `hr/leave-rules.test.ts`, `hr/leave-credits.test.ts`, `hr/forms-rules.test.ts`,
     `hr/print.test.ts`.
   - *Not done:* Automated-Excel's two-stage overtime (the supervisor signs, then HR): overtime here
     is decided once, like every form (whom the person reports to, else HR); its OB "stops" (several
     places a day; the CRM's OB keeps one place and from–to); editing a waiting form (revoke and file
     again); Automated-Excel's revoke of approved leave needing the approver's yes (here it is
     immediate, before the first day); the leave picker's chosen dates (here from–to and half a day);
     the offsetting credit (Parts I–III); accrual by month; night differential pay.
   - *To confirm with HR* (numbers and rules taken from Automated-Excel, not in PLAN.md): the 7
     days' notice for VL; sick leave after the fact (Automated-Excel 2 days back; PLAN 12.13 says a
     month back for all leave, and that is kept); a medical certificate from 2 days of sick leave;
     5 proof files of 10 MB; half of unused VL converted at year-end, at monthly × 12 ÷ 313 a day,
     rounded down to the half day; whether days HR gives someone on probation are usable at once
     (Automated-Excel waits for regularization); the second approver named on the record (and only
     for leave, not forms); the overtime rules (whole first hour, half-hour steps, lunch from 9
     hours, 10 PM–6 AM night differential, rest day from the person's schedule rather than Sunday
     only) and how night differential is paid; no overtime on a day with OB; overtime filed a month
     back here (Automated-Excel: a week after, as an emergency); Head Requisition open to any lead
     for their own team (Automated-Excel: three named people); the daily report to HR (Automated-
     Excel also names three reviewers) and filed a month back (Automated-Excel: that day or later);
     incident reports within 30 days; a signature of at most 1 MB.
4. **Payroll (about 1.5 weeks).** The decided cadence, holidays by town, the inputs from 2 and 3,
   the compare with HR's register. *Done when* one period matches HR's register to the centavo.
   - [x] **The cadence** (Aryan, PLAN 12.16): one payroll a month, the 1st to the last day. Not
     built (parked by Aryan): semi-monthly cut-offs, 13th month, final pay, bank files, remittances.
   - [x] **Holidays by town** (24 Nov): migration 0155 `local_holiday`, `hr/holidays.ts`, HR's
     *Holidays* page (`/hr/holidays`, next to Schedules; the CEO's and the Admin's Apps › HR). A
     holiday is national (`holiday`, the company's calendar: desks' clocks stay on it) or local to a
     province or one city or municipality, by the names of the CRM's town list (PSGC). Seeded with
     Automated-Excel's 2026 Lawphil proclamations (354 entries, 390 rows: a region's become its
     provinces, NCR as Metro Manila, CAR's six, BARMM's; a list of towns one row each; Sawata read as
     San Isidro, Davao del Norte, Baliwag as Baliuag, Pio V. Corpus as Corpuz; the three that fall
     on a national holiday left out). HR and the Admin add one (nationwide, a province, a town) and
     archive one with a note (never deleted); HR, the CEO and the Admin read the year, by province
     or town. **Whose:** a person's work town on their record (`employee.work_town` +
     `work_province`, picked from the list in the edit form, in HR's trail), else the first city of
     their seat's area (their own area with no seat), read against the list (a city before towns of
     the same name; none when several towns fit); nobody's local holiday when neither gives a town.
     A person's holidays (national + their province + their town) now drive attendance (working
     day, absent, late; the person's month, Who's working, the report, *My day*, the day not starting
     by itself), leave days, the overtime form's kind of day, the printouts and payroll. Test:
     `hr/holidays.test.ts`.
   - [x] **The inputs on the payslip** (24 Nov, `hr/pay-rules.ts`, `hr/payroll.ts`), checked one by
     one in `hr/payroll-inputs.test.ts`: absent and leave without pay at monthly × 12 ÷ 313 a day
     (PLAN 12.16; was already so); late and undertime by the person's own schedule in 15-minute
     blocks (was already so); a local holiday not worked is never absent; **approved overtime by its
     type** (fixed: payroll read the day's kind from the national list only and ignored the form's
     type and the 8-hour split): its first 8 hours and past them (table below); a holiday worked
     with no overtime form +100% / +30% of the day (PLAN), only on a working day of their schedule,
     never on top of a holiday overtime form for the same day (fixed: it was paid twice); **night
     differential** shown on the payslip with what 10% would come to, **not paid** (HR-PLAN step 3);
     the local holidays of the month noted on the slip. Released payslips stay frozen (`payslip`),
     never recomputed.
   - [x] **HR's register beside the CRM** (24 Nov, migration 0155 `pay_register`,
     `pay_register_map`, `pay_register_match`, `pay_register_compare`; `hr/pay-register.ts`; on the
     Payroll month page). HR uploads its register (.xlsx, 10 MB, read by `reports/xlsx-read.ts`, kept
     through `files/store.ts`); maps once which heading holds the employee ID, the name, basic,
     overtime, gross, total deductions, SSS, PhilHealth, Pag-IBIG, tax and net (kept; the newest
     mapping is used for the next files wherever the headings sit); rows matched by employee ID
     (upper case, no spaces), else an exact name HR confirms (*This is …*), or HR picks who a row is;
     per person and per figure the CRM's amount, HR's and the difference, any ₱0.01 flagged; people
     on HR's side only and on the CRM's only. Each file, mapping, confirmation and comparison kept
     (nothing deleted); *Compare again* after the draft changes. HR and the Admin work; the CEO
     reads; never while looking as someone (under `/api/hr/payroll/*`). The CRM's "overtime" is its
     overtime lines (not the holiday-worked premium). Test: `hr/pay-register.test.ts`.
   - *Overtime rates used* (basis points of the hourly rate = monthly × 12 ÷ 313 ÷ 8; first 8 hours
     / past 8): working day and broken time 125% / 125%; rest day 130% / 169%; special day +30% /
     169%; regular holiday +100% / 260%; special day on a rest day 150% / 195%; regular holiday on a
     rest day 260% / 338%. PLAN 12.16 gives 125, 130, 169 (special) and 260 (regular holiday) and the
     +100% / +30%; the rest are the Labor Code's (DOLE handbook). A holiday's first 8 hours are a
     premium because the monthly pay at 313 days already carries the day's 100%. Automated-Excel
     pays no overtime at all ("rules not settled") and its holiday pay differs (below).
   - *Not done:* the period that matches HR's register to the centavo: it needs HR's real register
     for one month (and the DTR of that month in the CRM) to upload and read side by side.
   - *To confirm with HR:* every overtime rate above not in PLAN (rest day past 8 hours, rest day on
     a special day or a regular holiday, broken time at 125%); a holiday's first 8 hours paid as
     +100% / +30% by the hour on an overtime form, and a full day's premium for a holiday worked with
     no form (even a short day); a rest-day holiday worked with no form paid nothing (approved
     overtime only); Automated-Excel's holiday pay (a regular holiday worked 200%, unworked 100% if
     present the day before, a special day 130% or 150% on a rest day, each on top of the cut-off's
     half salary) against the CRM's monthly premium-only rule; whether a special day not worked is
     docked ("no work, no pay"; the CRM docks nothing, as the 313-day monthly carries it); night
     differential's 10% (shown only); a work town falling back to the seat's area's first city;
     local holidays for province-wide and region-wide proclamations taken as every town of the
     province; which register columns HR's "OT Amount" and "DEDUCTION" mean (OT with holiday pay or
     not; all deductions or only HR's own).
4b. **Moves and vacant seats (25 Nov, asked by the backend department).** Someone moves (B2C to B2B,
   another role, area, team or division), or a seat stands empty, and every change keeps its trail.
   *Rules given:* the **employee ID** is the person's own key (never changes, never reused: unique
   per company, kept after they leave); the **email ID** belongs to the seat and is handed to whoever
   sits there next, so people keep signing in with it; every move and every sale keeps the email ID
   used at the time, so a later cross-check can tell whose sale it was and move the credit. A team
   lead gives a vacant area to one of their own people as **added work with no KPI** (Aryan agreed, 25 Nov): that person is
   credited only for their own main area, the vacant area's quota stays on its seat and the team
   handles it. Empty 7 days with nobody covering: the lead is reminded; 14 days: the head and HR.
   - [x] **The sale made covering** (migration 0156, `order_seat`): an order a MedRep places for a
     customer of a seat they cover counts for that seat (`covered`), per person for the lead above it
     that day (`cover_lead_id`), never the MedRep's own seat, KPI or score (`soldFor`, `creditedTo`,
     My KPIs, scores, KPIs, Sales performance; `sale_invoice` carries both). Every order keeps
     `sold_as`, its seller's email ID that day (orders already made: the one held when placed), shown
     on the order as *Sold as*.
   - [x] **Moves in HR's trail** (kind `move`): a seat taken (with the seat and the email ID before
     and after), a second seat, a cover given and ended, someone stepping out of a seat, a seat changed
     under its holder (team, title, work), and leaving (now written whoever marks it, HR or Teams &
     people, with the seats left vacant). In *Changes* and *Job history*.
   - [x] **HR's Move** (`POST /api/hr/people/:id/move`, *Move* on the person's page; HR and the
     Admin): to a vacant seat, as a transfer, promotion, demotion or lateral move, from a day (up to
     three months ahead: the tree switches by itself that morning), keeping the old seat too or not,
     and why. A position HR typed follows the new seat's title again.
   - [x] **Vacant seats** (`/vacant-seats`, `org/vacancies.ts`): the team lead's boxes (in their My
     team folder), every seat for HR (its desk), the CEO and the Admin (Admin panel). Each seat: days
     empty, the lead it waits with, who covers it and until when, a joiner or move planned into it,
     customers, open orders, this month's sales against its quota and how much was sold covering. The
     lead gives it to one of their own people until a day (*Give to one of my people*) or takes it
     back; HR and the Admin may too. My team's *Needs you* says how many days it has been empty and,
     past 7 days with nobody covering, to give it out or ask for a person.
   - Test: `org/vacancies.test.ts`.
   - **Scenarios and how each is checked.** "Auto" = the test in `org/vacancies.test.ts` (run:
     `pnpm --filter @2mg/api exec vitest run src/org/vacancies.test.ts`); "By hand" = try it in the
     app (local demo: Daniel leads NCR 1, Ryan is his MedRep, Helen is HR).

     | # | Scenario | Expected | Auto | By hand |
     |---|---|---|---|---|
     | 1 | TL1 has 5 areas, 2 vacant: who sees them | The lead sees the vacant seats of their own team; HR, the CEO and the Admin see every one; a MedRep is refused | "are the lead's in their boxes…" | Sign in as the lead → My team → *Vacant seats*; as HR → *Vacant seats* |
     | 2 | A seat empty 7 days, nobody covering | Flagged to the lead; My team's *Needs you* says "Vacant N days… Give it to one of your people" | "reminds the lead after 7 days…" | — (needs a seat empty 7 days) |
     | 3 | Empty 14 days, nobody covering | Flagged red: the head and HR told | partly (the flag; the head's view not tested) | — |
     | 4 | The lead gives a vacant area to one of their MedReps | Allowed for their own people only, until a day; written in the MedRep's HR trail ("Covers … added work") | "the lead gives it to one of their people…" | *Give to one of my people* → pick → *Give it*; open the MedRep in HR → *Changes* |
     | 5 | The lead tries to give it to someone outside the team, or a MedRep tries to give covers | Refused | same test | — |
     | 6 | The covering MedRep sells to the vacant area's customer | The sale counts for the vacant seat (the team's), per person for the lead; not the MedRep's own KPI or score | "a sale made covering counts for the vacant seat…" | Place the order as the MedRep; the order shows *Sold as … · covering a vacant area*; their own KPIs don't move |
     | 7 | The same MedRep sells in their own area | Still their own sale | same test | — |
     | 8 | Cross-check later: whose sale was it | Each order keeps the email ID it was sold as (`sold_as`) and whether it was covering | same test | The order's *Sold as* line |
     | 9 | The lead takes the cover back | The cover ends today; written in the trail ("Cover of … ended") | "the lead takes the cover back" | *Take the cover back* |
     | 10 | HR moves someone (B2C to B2B) as a transfer | Needs a reason; at most 3 months ahead; only HR and the Admin; the trail shows "Transferred to …, from …" with the seat and the email ID before and after; the seat is no longer vacant | "moves someone to a vacant seat as a transfer…" | HR → the person → *Move* → seat, kind, day, why |
     | 11 | After the move, their old sales | Stay with the old seat, each with the email ID it was sold as | same test | The old seat's page (`/my-team/seat/:id`) still lists them |
     | 12 | A move planned for a later day | The tree switches that morning by itself | not tested | Plan one for tomorrow; check the next day |
     | 13 | Someone is marked as left from Teams & people (not HR) | HR's trail still writes it, with the seats now vacant | `hr/events.test.ts` (the HR path) | — |

     Also kept green after this change: `org/org.test.ts`, `hr/events.test.ts`, `team/team.test.ts`,
     `orders/orders.test.ts`, `sales/sales.test.ts`, `sales/performance.test.ts`, `kpis/kpis.test.ts`,
     `scores/scores.test.ts`, `checks/scale.test.ts` (the 130-person check). The screens (Move,
     Vacant seats, *Sold as*) are type-checked but not yet clicked through in a browser.
   - *Not done:* the employee ID made compulsory (HR's *Missing* view already lists who lacks one;
     the IDs are still to be filled in, decision 4 below); moving the credit of past covered sales
     to someone (the data is kept for it; a screen when HR asks).
5. **Joining and leaving (about 1 week).** The checklist with its reminders; resignation, clearance,
   exit interview.
6. **HR's Home (about half a week).** What is due today, the figures, the reports.

About seven weeks in all. Then HR and Automated-Excel run side by side for one or two pay periods;
HR moves over once the DTR and the payroll match.

## Decisions needed

Step 1 needs none of these; step 2 onward does.

1. **Payroll cadence:** monthly (the CRM, PLAN 12.16) or semi-monthly (15th and month-end, what HR
   runs today in Automated-Excel)? *Decided:* monthly (Aryan, PLAN 12.16).
2. **Attendance source:** the biometric Excel stays the source and signing in is a check, or signing
   in replaces it?
3. **Who checks the rules:** HR (or Automated-Excel's developer) confirms leave credits, overtime
   rates, the clearance desks and the forms HR still uses.
4. **People across the two systems:** matched by employee ID (`2MG-228`), never by name. Who fills in
   the IDs the CRM has not got yet (PEOPLE-2026: none were found on 17 Nov)?

## Later, after HR's desk

A directory for everyone, HR announcements, employee self-service gaps, an HR help desk,
multi-level approvals, performance and goals, benefits and salary structures, learning, surveys,
a form builder.

## Where Automated-Excel's rules live (to read, not to copy blindly)

| Rule | File in Automated-Excel |
|---|---|
| Biometric sheet reader | `lib/timekeepingParser.js` |
| Leave, OB and offset applied to the days | `lib/attendanceReconcile.js` |
| Matching names to people | `lib/employeeNameMatch.js` (we match by employee ID instead) |
| Leave types and credits | `lib/leavePolicy.js` |
| Overtime rules | `lib/overtimeRules.js` |
| Semi-monthly pay, SSS, PhilHealth, Pag-IBIG, tax | `lib/payrollCalculator.js` |
| Holidays by town (2026 proclamations) | `lib/holidays.js`, `lib/data/proclamations2026.js` |
| Forms and their approval steps | `controllers/formRequestsController.js` |
| Probation reminders | `lib/probationNotify.js` |
| Answer keys against HR's own sheets | `tests/dtr_compare.mjs`, `tests/payreg_compare.mjs` |
