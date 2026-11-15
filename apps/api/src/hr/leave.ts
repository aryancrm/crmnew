// Leave asked for by people themselves. A request waits for whom the person reports to (HR when
// that is the CEO, the Admin or nobody), who approves it or refuses it with a word; HR may decide
// any (its backup). Vacation and sick leave come from the year's days (regular employees 10 VL and
// 10 SL; probationary staff, part-timers and interns ask for leave without pay); a request past
// what is left is refused with what is left. Overlapping leave is refused. The person cancels a
// request, or approved leave not started yet; HR cancels any. The approver and the person are told
// under Messages. What HR records itself (attendance.ts) is approved as recorded.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { Refusal } from "../http";
import { addDays, todayManila } from "../inventory/rules";
import { clean, iso, type Runner } from "../inventory/service";
import { notify, peopleIn } from "../notify/service";
import type { Role } from "../people/roles";
import type {
  Classification,
  LeaveBalance,
  LeaveKind,
  LeaveLine,
  LeaveList,
  LeaveStatus,
  Me,
  MyLeave,
} from "../types";
import {
  ATTENDANCE_ALL_ROLES,
  ATTENDANCE_WRITE_ROLES,
  holidaysBetween,
  leaveDays,
  schedulesOf,
} from "./attendance";
import { DEFAULT_SCHEDULE } from "./work-time";

const KINDS: LeaveKind[] = ["vl", "sl", "lwop", "other"];
/** Days a year by how a person is employed; leave without pay and other have no limit. */
export const LEAVE_DAYS: Record<Classification, { vl: number; sl: number }> = {
  regular: { vl: 10, sl: 10 },
  probationary: { vl: 0, sl: 0 },
  part_time: { vl: 0, sl: 0 },
  intern: { vl: 0, sl: 0 },
};
const LEAD_ROLES: Role[] = ["team_lead", "manager"];
const KIND_WORDS: Record<LeaveKind, string> = {
  vl: "vacation leave",
  sl: "sick leave",
  lwop: "leave without pay",
  other: "leave",
};
const FILE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
];
export const LEAVE_FILE_MAX_BYTES = 10 * 1024 * 1024;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export type LeaveFile = { name: string; mime: string; bytes: Uint8Array };

const dayWords = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-PH", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
const spanWords = (from: string, to: string) =>
  from === to ? dayWords(from) : `${dayWords(from)} – ${dayWords(to)}`;

/** Whom a person's request waits for: whom they report to, unless that is the CEO, the Admin,
 *  or nobody at work (then HR, null). */
export async function approverOf(
  db: Runner,
  personId: number,
): Promise<{ id: number; name: string } | null> {
  const [boss] = await rows<{ id: number; name: string }>(
    db,
    sql`select b.id::int as id, b.name from person p join person b on b.id = p.reports_to
      where p.id = ${personId} and b.active and b.role not in ('ceo', 'admin')`,
  );
  return boss ?? null;
}

/** The working days each line takes, in one go (each person's schedule, the holidays). */
async function withDays<T extends { personId: number; from: string; to: string; halfDay: boolean }>(
  db: Runner,
  lines: T[],
): Promise<(T & { days: number })[]> {
  if (!lines.length) return [];
  const first = lines.reduce((low, one) => (one.from < low ? one.from : low), lines[0]?.from ?? "");
  const last = lines.reduce((high, one) => (one.to > high ? one.to : high), lines[0]?.to ?? "");
  const [schedules, holidays] = await Promise.all([
    schedulesOf(db, [...new Set(lines.map((one) => one.personId))]),
    holidaysBetween(db, first, last),
  ]);
  const holidaySet = new Set(holidays.keys());
  return lines.map((one) => ({
    ...one,
    days: leaveDays(
      one.from,
      one.to,
      one.halfDay,
      schedules.get(one.personId) ?? DEFAULT_SCHEDULE,
      holidaySet,
    ),
  }));
}

type Row = Omit<LeaveLine, "days" | "canDecide" | "canCancel" | "person"> & {
  personId: number;
  personName: string;
  team: string | null;
  approverId: number | null;
};

const lineColumns = (
  today: string,
) => sql`l.id::int as id, l.person_id::int as "personId", p.name as "personName",
  (select u.name from seat_holder h join seat s on s.id = h.seat_id and s.active join org_unit u on u.id = s.unit_id
    where h.person_id = p.id and h.kind = 'holder' and h.starts_on <= ${today}::date
      and (h.ends_on is null or h.ends_on >= ${today}::date) order by h.starts_on limit 1) as team,
  l.kind, to_char(l.from_day, 'YYYY-MM-DD') as "from", to_char(l.to_day, 'YYYY-MM-DD') as "to",
  l.half_day as "halfDay", l.reason, l.status, l.approver_id::int as "approverId", a.name as approver,
  d.name as "decidedBy", ${iso("l.decided_at")} as "decidedAt", l.decision_note as "decisionNote",
  m.name as "madeBy", ${iso("l.made_at")} as "madeAt",
  case when l.file_data is null then null else json_build_object('name', l.file_name, 'mime', l.file_mime) end as file`;

const fromLines = sql`from person_leave l join person p on p.id = l.person_id join person m on m.id = l.made_by
  left join person a on a.id = l.approver_id left join person d on d.id = l.decided_by`;

function mayDecide(me: Me, line: { personId: number; approverId: number | null; status: string }) {
  if (line.status !== "asked" || me.viewedBy || me.id === line.personId) return false;
  return line.approverId === me.id || ATTENDANCE_WRITE_ROLES.includes(me.role);
}
function mayCancel(
  me: Me,
  line: { personId: number; status: string; from: string },
  today: string,
) {
  if (me.viewedBy) return false;
  if (ATTENDANCE_WRITE_ROLES.includes(me.role))
    return line.status === "asked" || line.status === "approved";
  return (
    me.id === line.personId &&
    (line.status === "asked" || (line.status === "approved" && line.from > today))
  );
}

async function toLines(db: Runner, me: Me, found: Row[]): Promise<LeaveLine[]> {
  const today = todayManila();
  return (await withDays(db, found)).map(({ personId, personName, team, approverId, ...one }) => ({
    ...one,
    person: { id: personId, name: personName, team },
    canDecide: mayDecide(me, { personId, approverId, status: one.status }),
    canCancel: mayCancel(me, { personId, status: one.status, from: one.from }, today),
  }));
}

/** A year's VL and SL for a person: allotted, used (approved), asked, left. */
async function balancesOf(
  db: Runner,
  personId: number,
  year: number,
  classification: Classification,
  except: number | null = null,
) {
  const found = await rows<{
    kind: LeaveKind;
    status: LeaveStatus;
    personId: number;
    from: string;
    to: string;
    halfDay: boolean;
  }>(
    db,
    sql`select kind, status, person_id::int as "personId", to_char(from_day, 'YYYY-MM-DD') as "from",
        to_char(to_day, 'YYYY-MM-DD') as "to", half_day as "halfDay"
      from person_leave where person_id = ${personId} and status in ('asked', 'approved')
        and extract(year from from_day) = ${year} ${except ? sql`and id <> ${except}` : sql``}`,
  );
  const counted = await withDays(db, found);
  const sum = (kind: LeaveKind, status: LeaveStatus) =>
    counted
      .filter((one) => one.kind === kind && one.status === status)
      .reduce((total, one) => total + one.days, 0);
  const balance = (kind: "vl" | "sl"): LeaveBalance => {
    const allotted = LEAVE_DAYS[classification][kind];
    const used = sum(kind, "approved");
    const asked = sum(kind, "asked");
    return { allotted, used, asked, left: Math.max(0, allotted - used - asked) };
  };
  return {
    vl: balance("vl"),
    sl: balance("sl"),
    lwop: { used: sum("lwop", "approved"), asked: sum("lwop", "asked") },
  };
}

async function classificationOf(db: Runner, personId: number): Promise<Classification> {
  const [found] = await rows<{ classification: Classification }>(
    db,
    sql`select classification from employee where person_id = ${personId}`,
  );
  return found?.classification ?? "probationary";
}

export async function myLeave(db: Database, me: Me, askedYear?: number | null): Promise<MyLeave> {
  const today = todayManila();
  const year =
    askedYear && askedYear > 2000 && askedYear < 2100 ? askedYear : Number(today.slice(0, 4));
  const classification = await classificationOf(db, me.id);
  const [balances, approver, found] = await Promise.all([
    balancesOf(db, me.id, year, classification),
    approverOf(db, me.id),
    rows<Row>(
      db,
      sql`select ${lineColumns(today)} ${fromLines}
        where l.person_id = ${me.id} and (extract(year from l.from_day) = ${year} or l.to_day >= ${today}::date)
        order by l.from_day desc, l.id desc`,
    ),
  ]);
  return {
    year,
    classification,
    balances,
    approver: approver?.name ?? "HR",
    lines: await toLines(db, me, found),
  };
}

/** A person asks for leave. */
export async function requestLeave(
  db: Database,
  me: Me,
  input: { kind: LeaveKind; from: string; to: string; halfDay?: boolean; reason?: string | null },
  file: LeaveFile | null,
): Promise<{ id: number }> {
  if (me.viewedBy) throw new Refusal(403, "not_allowed", "Look-only: nothing changes.");
  if (me.role === "ceo" || me.role === "admin")
    throw new Refusal(403, "not_allowed", "The CEO's and the Admin's leave is recorded by HR.");
  if (!KINDS.includes(input.kind))
    throw new Refusal(400, "invalid", "Pick the kind of leave.", "kind");
  const today = todayManila();
  if (!DAY.test(input.from)) throw new Refusal(400, "invalid", "Pick the first day.", "from");
  const to = input.halfDay ? input.from : input.to;
  if (!DAY.test(to) || to < input.from)
    throw new Refusal(400, "invalid", "The last day comes on or after the first.", "to");
  if (input.from < addDays(today, -30) || to > addDays(today, 180))
    throw new Refusal(
      400,
      "invalid",
      "Ask for days from a month back to six months ahead.",
      "from",
    );
  if (input.from.slice(0, 4) !== to.slice(0, 4))
    throw new Refusal(400, "invalid", "Ask for each year's days on their own.", "to");
  const reason = clean(input.reason) ?? null;
  if (input.kind === "other" && !reason)
    throw new Refusal(400, "invalid", "Say what the leave is for.", "reason");
  if (file) {
    if (!FILE_TYPES.includes(file.mime))
      throw new Refusal(400, "invalid", "Attach a photo or a PDF.", "file");
    if (file.bytes.byteLength === 0 || file.bytes.byteLength > LEAVE_FILE_MAX_BYTES)
      throw new Refusal(400, "invalid", "That file is empty or over 10 MB.", "file");
  }
  const classification = await classificationOf(db, me.id);
  const [days] = await withDays(db, [
    { personId: me.id, from: input.from, to, halfDay: Boolean(input.halfDay) },
  ]);
  if (!days?.days)
    throw new Refusal(
      400,
      "invalid",
      "Those days are rest days or holidays: no leave needed.",
      "from",
    );
  const approver = await approverOf(db, me.id);
  const made = await db.transaction(async (tx) => {
    await tx.execute(sql`select id from person where id = ${me.id} for update`);
    const [overlap] = await rows<{ from: string; to: string }>(
      tx,
      sql`select to_char(from_day, 'YYYY-MM-DD') as "from", to_char(to_day, 'YYYY-MM-DD') as "to"
        from person_leave where person_id = ${me.id} and status in ('asked', 'approved')
          and from_day <= ${to}::date and to_day >= ${input.from}::date limit 1`,
    );
    if (overlap)
      throw new Refusal(
        409,
        "taken",
        `You already have leave on ${spanWords(overlap.from, overlap.to)}.`,
        "from",
      );
    if (input.kind === "vl" || input.kind === "sl") {
      const balance = (await balancesOf(tx, me.id, Number(input.from.slice(0, 4)), classification))[
        input.kind
      ];
      if (!balance.allotted)
        throw new Refusal(
          400,
          "invalid",
          `${classification === "probationary" ? "On probation" : "As you are employed"} there is no ${KIND_WORDS[input.kind]}: ask for leave without pay.`,
          "kind",
        );
      if (days.days > balance.left)
        throw new Refusal(
          400,
          "invalid",
          `Only ${balance.left} days of ${KIND_WORDS[input.kind]} are left this year: ask for the rest as leave without pay.`,
          "kind",
        );
    }
    const [line] = await rows<{ id: number }>(
      tx,
      sql`insert into person_leave (person_id, kind, from_day, to_day, half_day, reason, status, approver_id, made_by,
          file_name, file_mime, file_data)
        values (${me.id}, ${input.kind}, ${input.from}::date, ${to}::date, ${Boolean(input.halfDay)}, ${reason},
          'asked', ${approver?.id ?? null}, ${me.id}, ${file ? file.name.trim().slice(0, 120) || "paper" : null},
          ${file?.mime ?? null}, ${file ? Buffer.from(file.bytes) : null})
        returning id::int as id`,
    );
    const id = line?.id as number;
    await notify(tx, {
      to: approver ? [approver.id] : await peopleIn(tx, ["hr"]),
      kind: "leave_request",
      title: `${me.name} asks for ${KIND_WORDS[input.kind]}: ${spanWords(input.from, to)}`,
      body: reason,
      link: "/hr/leave?view=waiting",
      key: `leave:${id}:asked`,
    });
    return { id };
  });
  return made;
}

/** The approver (or HR) approves a request or refuses it with a word. */
export async function decideLeave(
  db: Database,
  me: Me,
  leaveId: number,
  input: { approve: boolean; note?: string | null },
): Promise<void> {
  const note = clean(input.note) ?? null;
  if (!input.approve && !note)
    throw new Refusal(400, "invalid", "Say why it can't be given.", "note");
  await db.transaction(async (tx) => {
    const [line] = await rows<{
      personId: number;
      approverId: number | null;
      status: string;
      kind: LeaveKind;
      from: string;
      to: string;
    }>(
      tx,
      sql`select person_id::int as "personId", approver_id::int as "approverId", status, kind,
          to_char(from_day, 'YYYY-MM-DD') as "from", to_char(to_day, 'YYYY-MM-DD') as "to"
        from person_leave where id = ${leaveId} for update`,
    );
    if (!line) throw new Refusal(404, "not_found", "No such leave.");
    if (line.status !== "asked")
      throw new Refusal(409, "invalid", "That leave isn't waiting for a decision.");
    if (!mayDecide(me, line))
      throw new Refusal(
        403,
        "not_allowed",
        "Leave is decided by whom the person reports to, or HR.",
      );
    await tx.execute(
      sql`update person_leave set status = ${input.approve ? "approved" : "refused"}, decided_by = ${me.id},
          decided_at = now(), decision_note = ${note}
        where id = ${leaveId}`,
    );
    await notify(tx, {
      to: [line.personId],
      kind: input.approve ? "leave_approved" : "leave_refused",
      title: `Your ${KIND_WORDS[line.kind]} (${spanWords(line.from, line.to)}) was ${input.approve ? "approved" : "not approved"} by ${me.name}`,
      body: note,
      link: "/me/leave",
      key: `leave:${leaveId}:decided`,
    });
  });
}

/** Cancels a request, or approved leave not started yet; HR cancels any. Kept, marked cancelled. */
export async function cancelLeave(db: Database, me: Me, leaveId: number): Promise<void> {
  await db.transaction(async (tx) => {
    const [line] = await rows<{ personId: number; status: string; from: string }>(
      tx,
      sql`select person_id::int as "personId", status, to_char(from_day, 'YYYY-MM-DD') as "from"
        from person_leave where id = ${leaveId} for update`,
    );
    if (!line) throw new Refusal(404, "not_found", "That leave isn't on record.");
    if (!mayCancel(me, line, todayManila()))
      throw new Refusal(
        403,
        "not_allowed",
        me.id === line.personId
          ? "Leave that has started is cancelled by HR."
          : "Only the person or HR cancels leave.",
      );
    await tx.execute(
      sql`update person_leave set status = 'cancelled', cancelled_by = ${me.id}, cancelled_at = now()
        where id = ${leaveId}`,
    );
  });
}

/**
 * Leave for HR (everyone), the CEO and Management (everyone, to read) and a team lead (their
 * team, down the line). `view` waiting: what this person decides; else every line of a status,
 * newest first; `month` narrows to leave touching that month.
 */
export async function leaveList(
  db: Database,
  me: Me,
  asked: { view?: string | null; month?: string | null },
): Promise<LeaveList> {
  const everyone = ATTENDANCE_ALL_ROLES.includes(me.role) || me.role === "management";
  if (!everyone && !LEAD_ROLES.includes(me.role))
    throw new Refusal(403, "not_allowed", "Leave lists are for HR, team leads and the CEO.");
  const today = todayManila();
  const scope = everyone
    ? sql`true`
    : sql`l.person_id in (with recursive team as (select id from person where id = ${me.id}
        union all select q.id from person q join team t on q.reports_to = t.id) select id from team where id <> ${me.id})`;
  const month = asked.month && /^\d{4}-\d{2}$/.test(asked.month) ? asked.month : null;
  const inMonth = month
    ? sql`and l.from_day <= (${`${month}-01`}::date + interval '1 month' - interval '1 day') and l.to_day >= ${`${month}-01`}::date`
    : sql``;
  const found = await rows<Row>(
    db,
    sql`select ${lineColumns(today)} ${fromLines}
      where ${scope} ${inMonth} order by l.from_day desc, l.id desc limit 500`,
  );
  const lines = await toLines(db, me, found);
  const view = asked.view ?? "waiting";
  const shown =
    view === "waiting"
      ? lines.filter((one) => one.canDecide)
      : ["asked", "approved", "refused", "cancelled"].includes(view)
        ? lines.filter((one) => one.status === view)
        : lines;
  return {
    lines: shown,
    counts: {
      waiting: lines.filter((one) => one.canDecide).length,
      asked: lines.filter((one) => one.status === "asked").length,
      approved: lines.filter((one) => one.status === "approved").length,
      refused: lines.filter((one) => one.status === "refused").length,
      cancelled: lines.filter((one) => one.status === "cancelled").length,
    },
    mine: lines.filter((one) => one.canDecide).length,
  };
}

/** The paper with a leave, for the person, whoever decides it, HR and the CEO. */
export async function leaveFile(db: Database, me: Me, leaveId: number): Promise<LeaveFile> {
  const [line] = await rows<{
    personId: number;
    approverId: number | null;
    name: string;
    mime: string;
    data: Uint8Array | null;
  }>(
    db,
    sql`select person_id::int as "personId", approver_id::int as "approverId", file_name as name, file_mime as mime,
        file_data as data from person_leave where id = ${leaveId}`,
  );
  if (!line?.data) throw new Refusal(404, "not_found", "No paper with this leave.");
  const lead =
    LEAD_ROLES.includes(me.role) &&
    (
      await rows<{ id: number }>(
        db,
        sql`with recursive team as (select id from person where id = ${me.id}
            union all select q.id from person q join team t on q.reports_to = t.id)
          select id::int as id from team where id = ${line.personId}`,
      )
    ).length > 0;
  if (
    me.id !== line.personId &&
    line.approverId !== me.id &&
    !lead &&
    !ATTENDANCE_ALL_ROLES.includes(me.role) &&
    me.role !== "management"
  )
    throw new Refusal(403, "not_allowed", "That paper isn't yours to see.");
  return { name: line.name, mime: line.mime, bytes: line.data };
}
