// Asking for a day of one's own attendance to be put right (docs/HR-PLAN.md, step 2): a missed time
// in or out, a wrong time, forgot to sign in. A day of the last 31 days, not ahead; one open request
// a person a day. It goes to whom they report to (HR when that is the CEO, the Admin or nobody), as
// leave does; HR may decide any. Approved, the day is set as HR puts a day right, marked as coming
// from a request, and HR's trail says so; refused, with a word why. The person cancels one still
// waiting. Nothing is deleted: a cancelled or refused request stays.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { Refusal } from "../http";
import { addDays, todayManila } from "../inventory/rules";
import { clean, iso, type Runner } from "../inventory/service";
import { notify, peopleIn } from "../notify/service";
import type { Role } from "../people/roles";
import type { FixInput, FixLine, FixList, Me } from "../types";
import { ATTENDANCE_ALL_ROLES, ATTENDANCE_WRITE_ROLES, checkDay, setDay } from "./attendance";
import { hrEvent } from "./events";
import { approverOf } from "./leave";

const LEAD_ROLES: Role[] = ["team_lead", "manager"];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
/** How far back a day may be asked for. */
export const FIX_DAYS_BACK = 31;
const dayWords = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-PH", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
const timesWords = (timeIn: string, timeOut: string | null) =>
  `${timeIn}–${timeOut ?? "no time out"}`;

type Row = Omit<FixLine, "canDecide" | "canCancel" | "person"> & {
  personId: number;
  personName: string;
  team: string | null;
  approverId: number | null;
};

const columns = (
  today: string,
) => sql`f.id::int as id, f.person_id::int as "personId", p.name as "personName",
  (select u.name from seat_holder h join seat s on s.id = h.seat_id and s.active join org_unit u on u.id = s.unit_id
    where h.person_id = p.id and h.kind = 'holder' and h.starts_on <= ${today}::date
      and (h.ends_on is null or h.ends_on >= ${today}::date) order by h.starts_on, h.id limit 1) as team,
  to_char(f.day, 'YYYY-MM-DD') as day, to_char(f.time_in, 'HH24:MI') as "timeIn",
  to_char(f.time_out, 'HH24:MI') as "timeOut", f.reason, f.status, f.approver_id::int as "approverId",
  a.name as approver, d.name as "decidedBy", f.decision_note as "decisionNote", ${iso("f.made_at")} as "madeAt"`;
const fromFixes = sql`from attendance_fix f join person p on p.id = f.person_id
  left join person a on a.id = f.approver_id left join person d on d.id = f.decided_by`;

/** Whom it waits for decides it (never the person themselves, never while looking as someone);
 *  HR and the Admin decide any. */
const mayDecide = (me: Me, row: { personId: number; approverId: number | null; status: string }) =>
  row.status === "asked" &&
  !me.viewedBy &&
  me.id !== row.personId &&
  (row.approverId === me.id || ATTENDANCE_WRITE_ROLES.includes(me.role));
/** The person takes back one still waiting; HR may too. */
const mayCancel = (me: Me, row: { personId: number; status: string }) =>
  row.status === "asked" &&
  !me.viewedBy &&
  (me.id === row.personId || ATTENDANCE_WRITE_ROLES.includes(me.role));

function toLines(me: Me, found: Row[]): FixLine[] {
  return found.map(({ personId, personName, team, approverId, ...one }) => ({
    ...one,
    person: { id: personId, name: personName, team },
    canDecide: mayDecide(me, { personId, approverId, status: one.status }),
    canCancel: mayCancel(me, { personId, status: one.status }),
  }));
}

/** Whether a person may ask for their own days to be put right (the CEO's and the Admin's are kept
 *  by HR, as their forms are). */
export const mayAskFix = (me: Me) => !me.viewedBy && me.role !== "ceo" && me.role !== "admin";

export async function requestFix(db: Database, me: Me, input: FixInput): Promise<{ id: number }> {
  if (me.viewedBy) throw new Refusal(403, "not_allowed", "Look-only: nothing changes.");
  if (!mayAskFix(me))
    throw new Refusal(403, "not_allowed", "The CEO's and the Admin's attendance is kept by HR.");
  const today = todayManila();
  if (!DAY.test(input.day) || input.day < addDays(today, -FIX_DAYS_BACK) || input.day > today)
    throw new Refusal(400, "invalid", `Pick a day of the last ${FIX_DAYS_BACK} days, today at the latest.`, "day");
  if (!CLOCK.test(input.timeIn))
    throw new Refusal(400, "invalid", "Type the time in as 08:30.", "timeIn");
  const timeOut = clean(input.timeOut) ?? null;
  if (timeOut !== null && !CLOCK.test(timeOut))
    throw new Refusal(400, "invalid", "Type the time out as 17:30.", "timeOut");
  if (timeOut !== null && timeOut <= input.timeIn)
    throw new Refusal(400, "invalid", "Time out comes after time in.", "timeOut");
  checkDay({ day: input.day, timeIn: input.timeIn, timeOut });
  const reason = clean(input.reason);
  if (!reason) throw new Refusal(400, "invalid", "Say what happened that day.", "reason");
  const approver = await approverOf(db, me.id);
  return db.transaction(async (tx) => {
    const [taken] = await rows<{ id: number }>(
      tx,
      sql`select id::int as id from attendance_fix where person_id = ${me.id} and day = ${input.day}::date
        and status = 'asked' for update`,
    );
    if (taken)
      throw new Refusal(
        409,
        "taken",
        `You already asked for ${dayWords(input.day)} to be put right: cancel that one first.`,
        "day",
      );
    const [made] = await rows<{ id: number }>(
      tx,
      sql`insert into attendance_fix (person_id, day, time_in, time_out, reason, approver_id)
        values (${me.id}, ${input.day}::date, ${input.timeIn}::time, ${timeOut}::time, ${reason}, ${approver?.id ?? null})
        returning id::int as id`,
    );
    const id = made?.id as number;
    await notify(tx, {
      to: approver ? [approver.id] : await peopleIn(tx, ["hr"]),
      kind: "fix_request",
      title: `${me.name} asks to put ${dayWords(input.day)} right: ${timesWords(input.timeIn, timeOut)}`,
      body: reason,
      link: "/hr/leave?of=fixes&view=waiting",
      key: `fix:${id}:asked`,
    });
    return { id };
  });
}

export async function decideFix(
  db: Database,
  me: Me,
  fixId: number,
  input: { approve: boolean; note?: string | null },
): Promise<void> {
  const note = clean(input.note) ?? null;
  if (!input.approve && !note)
    throw new Refusal(400, "invalid", "Say why it can't be put right.", "note");
  await db.transaction(async (tx) => {
    const [row] = await rows<{
      personId: number;
      approverId: number | null;
      status: string;
      day: string;
      timeIn: string;
      timeOut: string | null;
      reason: string;
    }>(
      tx,
      sql`select person_id::int as "personId", approver_id::int as "approverId", status,
          to_char(day, 'YYYY-MM-DD') as day, to_char(time_in, 'HH24:MI') as "timeIn",
          to_char(time_out, 'HH24:MI') as "timeOut", reason
        from attendance_fix where id = ${fixId} for update`,
    );
    if (!row) throw new Refusal(404, "not_found", "No such request.");
    if (row.status !== "asked")
      throw new Refusal(409, "invalid", "That request isn't waiting for a decision.");
    if (!mayDecide(me, row))
      throw new Refusal(
        403,
        "not_allowed",
        "A day is put right by whom the person reports to, or HR.",
      );
    await tx.execute(
      sql`update attendance_fix set status = ${input.approve ? "approved" : "refused"}, decided_by = ${me.id},
          decided_at = now(), decision_note = ${note} where id = ${fixId}`,
    );
    if (input.approve) {
      await setDay(
        tx,
        row.personId,
        me.id,
        {
          day: row.day,
          timeIn: row.timeIn,
          timeOut: row.timeOut,
          note: `Correction request: ${row.reason}`.slice(0, 300),
        },
        "request",
      );
      await hrEvent(
        tx,
        row.personId,
        me.id,
        "attendance",
        `Attendance of ${row.day} put right: ${timesWords(row.timeIn, row.timeOut)} (request)`,
      );
    }
    await notify(tx, {
      to: [row.personId],
      kind: input.approve ? "fix_approved" : "fix_refused",
      title: `Your ${dayWords(row.day)} ${input.approve ? "was put right" : "wasn't put right"} by ${me.name}`,
      body: note,
      link: "/me/leave",
      key: `fix:${fixId}:decided`,
    });
  });
}

export async function cancelFix(db: Database, me: Me, fixId: number): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await rows<{ personId: number; status: string }>(
      tx,
      sql`select person_id::int as "personId", status from attendance_fix where id = ${fixId} for update`,
    );
    if (!row) throw new Refusal(404, "not_found", "No such request.");
    if (row.status !== "asked")
      throw new Refusal(409, "invalid", "That request isn't waiting any more.");
    if (!mayCancel(me, row))
      throw new Refusal(403, "not_allowed", "Only the person who asked (or HR) cancels a request.");
    await tx.execute(
      sql`update attendance_fix set status = 'cancelled', cancelled_by = ${me.id}, cancelled_at = now()
        where id = ${fixId}`,
    );
  });
}

/** A person's own requests: this year's. */
export async function myFixes(db: Database, me: Me): Promise<FixLine[]> {
  const today = todayManila();
  return toLines(
    me,
    await rows<Row>(
      db,
      sql`select ${columns(today)} ${fromFixes}
        where f.person_id = ${me.id} and f.day >= ${`${today.slice(0, 4)}-01-01`}::date
        order by f.day desc, f.id desc`,
    ),
  );
}

/** One person's requests for days of a month: for their attendance month (whoever may see it). */
export async function fixesOf(db: Runner, me: Me, personId: number, month: string): Promise<FixLine[]> {
  const today = todayManila();
  return toLines(
    me,
    await rows<Row>(
      db,
      sql`select ${columns(today)} ${fromFixes}
        where f.person_id = ${personId} and to_char(f.day, 'YYYY-MM') = ${month}
        order by f.day desc, f.id desc`,
    ),
  );
}

/** Requests for HR (everyone), the CEO and Management (to read) and a team lead (their team). */
export async function fixList(
  db: Database,
  me: Me,
  asked: { view?: string | null; month?: string | null },
): Promise<FixList> {
  const everyone = ATTENDANCE_ALL_ROLES.includes(me.role) || me.role === "management";
  if (!everyone && !LEAD_ROLES.includes(me.role))
    throw new Refusal(403, "not_allowed", "Attendance requests are for HR, team leads and the CEO.");
  const today = todayManila();
  const scope = everyone
    ? sql`true`
    : sql`f.person_id in (with recursive team as (select id from person where id = ${me.id}
        union all select q.id from person q join team t on q.reports_to = t.id) select id from team where id <> ${me.id})`;
  const month = asked.month && /^\d{4}-\d{2}$/.test(asked.month) ? asked.month : null;
  const inMonth = month ? sql`and to_char(f.day, 'YYYY-MM') = ${month}` : sql``;
  const lines = toLines(
    me,
    await rows<Row>(
      db,
      sql`select ${columns(today)} ${fromFixes} where ${scope} ${inMonth} order by f.day desc, f.id desc limit 500`,
    ),
  );
  const view = asked.view ?? "waiting";
  return {
    lines:
      view === "waiting"
        ? lines.filter((one) => one.canDecide)
        : ["asked", "approved", "refused", "cancelled"].includes(view)
          ? lines.filter((one) => one.status === view)
          : lines,
    counts: {
      waiting: lines.filter((one) => one.canDecide).length,
      asked: lines.filter((one) => one.status === "asked").length,
      approved: lines.filter((one) => one.status === "approved").length,
      refused: lines.filter((one) => one.status === "refused").length,
      cancelled: lines.filter((one) => one.status === "cancelled").length,
    },
  };
}
