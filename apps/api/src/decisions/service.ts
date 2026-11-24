// To decide (docs/ERP-PLAN.md phase 2, SAP's "My Inbox"): every decision waiting on the person in
// one place, each with how many and the page where it is made, and what the person asked others
// for that is still open. Nothing new is decided here: each line is read from the desk's own list
// (the orders board, leave, forms, expenses, returns…), under the same rules as that desk, so the
// numbers always agree with the pages they open.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { fieldExpenses } from "../field/expenses";
import { LEAD_ROLES } from "../field/visits";
import { offRequests } from "../mr/clients";
import { deviationList } from "../mr/plan";
import { leadQueue } from "../mr/team";
import { fixList } from "../hr/corrections";
import { formList } from "../hr/forms";
import { leaveList } from "../hr/leave";
import { Refusal } from "../http";
import { orderDashboard } from "../orders/service";
import { listReturns } from "../returns/service";
import { teamSamples } from "../samples/service";
import { COMPLAINT_ROLES } from "../complaints/service";
import type { Decisions, DecisionLine, Me, Role } from "../types";

/** A desk's list the person may not open counts as nothing waiting there. */
async function ifAllowed<T>(work: () => Promise<T>): Promise<T | null> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof Refusal) return null;
    throw error;
  }
}

/** The orders board's own counts, each for the desk that acts on it (as the sidebar's badges). */
const ORDER_LINES: { key: string; label: string; to: string; roles: Role[] }[] = [
  { key: "awaiting", label: "Orders to approve", to: "/orders/check", roles: ["management", "admin"] },
  { key: "flagged", label: "Orders on hold", to: "/on-hold", roles: ["management", "admin"] },
  { key: "customers", label: "New customers to check", to: "/customers?review=1", roles: ["management", "admin"] },
  { key: "toConfirm", label: "Payments to confirm", to: "/finance", roles: ["finance", "admin"] },
  { key: "toInvoice", label: "Orders to invoice", to: "/finance", roles: ["finance", "admin"] },
  { key: "refunds", label: "Money owed back", to: "/refunds", roles: ["finance", "admin"] },
  { key: "toPack", label: "Orders to pack", to: "/dispatch", roles: ["dispatch", "admin"] },
  { key: "toShip", label: "Orders to ship", to: "/dispatch", roles: ["dispatch", "admin"] },
  { key: "heldByDispatch", label: "Held by Dispatch", to: "/dispatch", roles: ["dispatch", "admin"] },
  { key: "requests", label: "Medicines asked for", to: "/inventory/requests", roles: ["inventory", "admin"] },
  { key: "sentBack", label: "Orders sent back to you", to: "/orders/sent-back", roles: ["medrep", "team_lead", "manager", "online"] },
];

export async function decisions(db: Database, me: Me): Promise<Decisions> {
  const forMe: DecisionLine[] = [];
  const add = (list: DecisionLine[], line: DecisionLine) => {
    if (line.count > 0) list.push(line);
  };

  const board = await ifAllowed(() => orderDashboard(db, me));
  if (board)
    for (const one of ORDER_LINES)
      if (one.roles.includes(me.role))
        add(forMe, { key: one.key, label: one.label, count: (board.attention as Record<string, number>)[one.key] ?? 0, to: one.to, kind: "orders" });

  const leave = await ifAllowed(() => leaveList(db, me, { view: "waiting" }));
  if (leave) add(forMe, { key: "leave", label: "Leave to approve", count: leave.counts.waiting, to: "/hr/leave", kind: "people" });
  const forms = await ifAllowed(() => formList(db, me, { view: "waiting" }));
  if (forms) add(forMe, { key: "forms", label: "Forms to approve (OB, WFH, overtime)", count: forms.counts.waiting, to: "/hr/leave", kind: "people" });
  const fixes = await ifAllowed(() => fixList(db, me, { view: "waiting" }));
  if (fixes) add(forMe, { key: "fixes", label: "Attendance days to put right", count: fixes.counts.waiting, to: "/hr/leave?of=fixes", kind: "people" });
  const expenses = await ifAllowed(() => fieldExpenses(db, me, { waiting: true }));
  if (expenses) add(forMe, { key: "expenses", label: "Field expenses to approve", count: expenses.rows.length, to: "/visits/expenses?waiting=1", kind: "people" });

  // Month plans sent to their team lead (the person's own team, the way the plan page decides).
  if (["team_lead", "manager", "management", "admin"].includes(me.role)) {
    const plans = await rows<{ personId: number; name: string; month: string }>(
      db,
      sql`with recursive team as (select id from person where id = ${me.id}
          union all select q.id from person q join team t on q.reports_to = t.id)
        select p.id::int as "personId", p.name, to_char(v.month, 'YYYY-MM') as month
        from visit_plan v join person p on p.id = v.person_id
        where v.status = 'sent' and v.person_id <> ${me.id}
          ${["management", "admin"].includes(me.role) ? sql`` : sql`and v.person_id in (select id from team)`}
        order by v.month, p.name`,
    );
    for (const plan of plans)
      forMe.push({ key: `plan:${plan.personId}:${plan.month}`, label: `${plan.name}'s tour plan for ${plan.month}`, count: 1, to: `/field/plan?person=${plan.personId}&month=${plan.month}`, kind: "people" });
  }

  // The field's day (docs/PLAN.md 22), from the lead's own pages: day reports to see, calls left
  // "not sure yet" to judge, changes to an approved tour plan, customers asked off the list.
  if (LEAD_ROLES.includes(me.role)) {
    const queue = await ifAllowed(() => leadQueue(db, me));
    if (queue) {
      add(forMe, { key: "field:reports", label: "Day reports to see", count: queue.reports.length, to: "/field/reports?view=day-reports", kind: "people" });
      add(forMe, { key: "field:judge", label: "Calls to judge (productive or not)", count: queue.judge.length, to: "/field/reports?view=judge", kind: "people" });
    }
    const changes = await ifAllowed(() => deviationList(db, me, {}));
    if (changes) add(forMe, { key: "field:deviations", label: "Tour plan changes to approve", count: changes.length, to: "/field/plan?view=deviations", kind: "people" });
    const off = await ifAllowed(() => offRequests(db, me));
    if (off) add(forMe, { key: "field:off", label: "Customers to take off the field's list", count: off.length, to: "/field/clients?view=off", kind: "people" });
  }

  const returns = await ifAllowed(() => listReturns(db, me, {}));
  if (returns) {
    const decide = returns.rows.filter((row) => row.can.decide).length;
    const receive = returns.rows.filter((row) => row.can.receive).length;
    const credit = returns.rows.filter((row) => row.can.credit).length;
    add(forMe, { key: "returns:decide", label: "Returns to decide", count: decide, to: "/returns?status=requested", kind: "orders" });
    add(forMe, { key: "returns:receive", label: "Returns to check in", count: receive, to: "/returns?status=approved", kind: "orders" });
    add(forMe, { key: "returns:credit", label: "Returns to credit", count: credit, to: "/returns?status=checked", kind: "orders" });
  }

  // Samples and gifts asked for: the lead approves, the stock desk issues (ERP phase 3).
  const samples = await ifAllowed(() => teamSamples(db, me, {}));
  if (samples) {
    add(forMe, { key: "samples:decide", label: "Samples & gifts to approve", count: samples.requests.filter((one) => one.canDecide).length, to: "/field/samples", kind: "people" });
    add(forMe, { key: "samples:issue", label: "Samples & gifts to issue", count: samples.requests.filter((one) => one.canIssue).length, to: "/field/samples", kind: "orders" });
  }

  // Management asked this person (a team lead, a Business Mentor) for a yes on an order.
  const asks = await rows<{ orderId: number; code: string; by: string; at: string }>(
    db,
    sql`select o.id::int as "orderId", o.code, p.name as by, a.asked_at::text as at from order_ask a
      join sales_order o on o.id = a.order_id join person p on p.id = a.asked_by
      where a.asked_to = ${me.id} and a.answered_at is null and a.withdrawn_at is null order by a.asked_at`,
  );
  for (const ask of asks)
    forMe.push({ key: `ask:${ask.orderId}`, label: `${ask.by} asks your yes on ${ask.code}`, count: 1, to: `/orders/${ask.orderId}`, kind: "orders", since: ask.at });

  // Complaints and side-effects open (Regulatory's, with Management, the CEO, the Admin).
  if (COMPLAINT_ROLES.includes(me.role)) {
    const [open] = await rows<{ n: number; late: number }>(
      db,
      sql`select count(*)::int as n, count(*) filter (where due_on < (now() at time zone 'Asia/Manila')::date)::int as late from complaint where status <> 'closed'`,
    );
    add(forMe, { key: "complaints", label: `Complaints and side-effects open${open?.late ? ` (${open.late} past due)` : ""}`, count: open?.n ?? 0, to: "/complaints", kind: "people" });
  }

  // Asks for people, regions and areas: the CEO's and the Admin's to decide.
  if (["ceo", "admin"].includes(me.role)) {
    const [open] = await rows<{ n: number }>(db, sql`select count(*)::int as n from seat_request where status = 'open'`);
    add(forMe, { key: "seat-requests", label: "Asks for people, regions, areas", count: open?.n ?? 0, to: "/people?tab=requests", kind: "people" });
  }

  // What this person asked others for, still open.
  const [own] = await rows<{ leave: number; forms: number; fixes: number; asks: number; returns: number; expenses: number; plans: number; seats: number; samplesAsked: number; samplesComing: number }>(
    db,
    sql`select
        (select count(*) from person_leave where person_id = ${me.id} and status = 'asked')::int as leave,
        (select count(*) from hr_form where person_id = ${me.id} and status = 'asked')::int as forms,
        (select count(*) from attendance_fix where person_id = ${me.id} and status = 'asked')::int as fixes,
        (select count(*) from order_ask where asked_by = ${me.id} and answered_at is null and withdrawn_at is null)::int as asks,
        (select count(*) from sales_return where requested_by = ${me.id} and status in ('requested', 'approved', 'checked'))::int as returns,
        (select count(*) from field_expense where person_id = ${me.id} and status = 'pending')::int as expenses,
        (select count(*) from visit_plan where person_id = ${me.id} and status = 'sent')::int as plans,
        (select count(*) from seat_request where asked_by = ${me.id} and status = 'open')::int as seats,
        (select count(*) from sample_request where person_id = ${me.id} and status in ('submitted', 'approved'))::int as "samplesAsked",
        (select count(*) from sample_request where person_id = ${me.id} and status = 'issued')::int as "samplesComing"`,
  );
  const mine: DecisionLine[] = [];
  if (own) {
    add(mine, { key: "my-leave", label: "Your leave waiting for a yes", count: own.leave, to: "/me/leave", kind: "people" });
    add(mine, { key: "my-forms", label: "Your forms waiting for a yes", count: own.forms, to: "/me/leave", kind: "people" });
    add(mine, { key: "my-fixes", label: "Your attendance days asked to put right", count: own.fixes, to: "/me/leave", kind: "people" });
    add(mine, { key: "my-asks", label: "Orders you asked a lead about", count: own.asks, to: "/orders/check", kind: "orders" });
    add(mine, { key: "my-returns", label: "Returns you asked for, not done", count: own.returns, to: "/returns", kind: "orders" });
    add(mine, { key: "my-expenses", label: "Your field expenses waiting", count: own.expenses, to: "/visits/expenses", kind: "people" });
    add(mine, { key: "my-plan", label: "Your tour plan waiting", count: own.plans, to: "/field/plan", kind: "people" });
    add(mine, { key: "my-seats", label: "Your asks for people", count: own.seats, to: "/people?tab=requests", kind: "people" });
    add(mine, { key: "my-samples", label: "Samples & gifts you asked for", count: own.samplesAsked, to: "/me/samples", kind: "people" });
    // On the way to the rep: theirs to mark received.
    add(forMe, { key: "samples:receive", label: "Samples & gifts to mark received", count: own.samplesComing, to: "/me/samples", kind: "people" });
  }
  return { forMe, mine, total: forMe.reduce((sum, line) => sum + line.count, 0) };
}
