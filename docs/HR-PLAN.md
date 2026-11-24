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
   - [ ] Each person's papers.
   - [ ] Employment history beyond seats (position and pay changes over time).
   - [ ] A list of positions.
   - [ ] The fields Automated-Excel has and the CRM lacks.
2. **Attendance (about 1.5 weeks).** The biometric Excel import into a DTR, *Needs review*,
   correction requests, schedules. *Done when* one real cut-off's DTR matches HR's own sheet.
3. **Leave and forms (about 1.5 weeks).** Credits, the leave rules, the overtime rules, revoke,
   printable forms, HR's one queue.
4. **Payroll (about 1.5 weeks).** The decided cadence, holidays by town, the inputs from 2 and 3,
   the compare with HR's register. *Done when* one period matches HR's register to the centavo.
5. **Joining and leaving (about 1 week).** The checklist with its reminders; resignation, clearance,
   exit interview.
6. **HR's Home (about half a week).** What is due today, the figures, the reports.

About seven weeks in all. Then HR and Automated-Excel run side by side for one or two pay periods;
HR moves over once the DTR and the payroll match.

## Decisions needed

Step 1 needs none of these; step 2 onward does.

1. **Payroll cadence:** monthly (the CRM, PLAN 12.16) or semi-monthly (15th and month-end, what HR
   runs today in Automated-Excel)?
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
