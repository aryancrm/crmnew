// Leave asked for by people themselves. A request waits for whom the person reports to (HR when
// that is the CEO, the Admin or nobody), and for the second approver HR may name on the record:
// the first of them to decide closes it. HR may decide any (its backup). Vacation and sick leave
// come from the year's credits: the opening days (regular employees 10 VL and 10 SL; probationary
// staff, part-timers and interns ask for leave without pay) plus HR's adjustments (credits.ts),
// less what was used; a request past what is left is refused with what is left. Vacation leave
// needs 7 days' notice; sick leave of two days or more needs a medical certificate; a request
// carries up to five proof files. Overlapping leave is refused. The person cancels a request; an
// approved leave not started yet they revoke (kept, its days come back); HR cancels or revokes
// any. The approvers and the person are told under Messages. What HR records itself
// (attendance.ts) is approved as recorded and not held to the notice.

import { bytesOf, type KeptFile, keepFile } from "../files/store";
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
  LeaveCreditLine,
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
import {
  earliestVl,
  LEAVE_FILES_MAX,
  leaveStartRefusal,
  ledger,
  SL_PROOF_FROM_DAYS,
  VL_NOTICE_DAYS,
} from "./leave-rules";
import { DEFAULT_SCHEDULE } from "./work-time";

const KINDS: LeaveKind[] = ["vl", "sl", "lwop", "other"];
/** Days a year by how a person is employed; leave without pay and other have no limit. */
export const LEAVE_DAYS: Record<Classification, { vl: number; sl: number }> = {
  regular: { vl: 10, sl: 10 },
  probationary: { vl: 0, sl: 0 },
  part_time: { vl: 0, sl: 0 },
  intern: { vl: 0, sl: 0 },
};
export const LEAD_ROLES: Role[] = ["team_lead", "manager"];
export const KIND_WORDS: Record<LeaveKind, string> = {
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
export const spanWords = (from: string, to: string) =>
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

/** The second approver HR named on a person's record, when they are at work (never the person,
 *  never the first approver again). */
export async function secondApproverOf(
  db: Runner,
  personId: number,
  firstId: number | null,
): Promise<{ id: number; name: string } | null> {
  const [second] = await rows<{ id: number; name: string }>(
    db,
    sql`select s.id::int as id, s.name from employee e join person s on s.id = e.second_approver_id
      where e.person_id = ${personId} and s.active and s.id <> ${personId}`,
  );
  return second && second.id !== firstId ? second : null;
}

/** Whether `personId` is in `leadId`'s team, down the line. */
export async function inTeamOf(db: Runner, leadId: number, personId: number): Promise<boolean> {
  return (
    (
      await rows<{ id: number }>(
        db,
        sql`with recursive team as (select id from person where id = ${leadId}
            union all select q.id from person q join team t on q.reports_to = t.id)
          select id::int as id from team where id = ${personId} and id <> ${leadId}`,
      )
    ).length > 0
  );
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

type Row = Omit<
  LeaveLine,
  "days" | "canDecide" | "canCancel" | "canRevoke" | "canPrint" | "person"
> & {
  personId: number;
  personName: string;
  team: string | null;
  approverId: number | null;
  secondApproverId: number | null;
  decidedById: number | null;
};

const lineColumns = (
  today: string,
) => sql`l.id::int as id, l.person_id::int as "personId", p.name as "personName",
  (select u.name from seat_holder h join seat s on s.id = h.seat_id and s.active join org_unit u on u.id = s.unit_id
    where h.person_id = p.id and h.kind = 'holder' and h.starts_on <= ${today}::date
      and (h.ends_on is null or h.ends_on >= ${today}::date) order by h.starts_on, h.id limit 1) as team,
  l.kind, to_char(l.from_day, 'YYYY-MM-DD') as "from", to_char(l.to_day, 'YYYY-MM-DD') as "to",
  l.half_day as "halfDay", l.reason, l.status, l.approver_id::int as "approverId", a.name as approver,
  l.second_approver_id::int as "secondApproverId", s2.name as "secondApprover",
  l.decided_by::int as "decidedById", d.name as "decidedBy", ${iso("l.decided_at")} as "decidedAt", l.decision_note as "decisionNote",
  m.name as "madeBy", ${iso("l.made_at")} as "madeAt",
  rv.name as "revokedBy", ${iso("l.revoked_at")} as "revokedAt", l.revoke_reason as "revokeReason",
  case when l.file_data is null and l.file_key is null
    then (select json_build_object('name', f.name, 'mime', f.mime) from leave_file f where f.leave_id = l.id order by f.id limit 1)
    else json_build_object('name', l.file_name, 'mime', l.file_mime) end as file,
  coalesce((select json_agg(json_build_object('id', f.id::int, 'name', f.name, 'mime', f.mime) order by f.id)
    from leave_file f where f.leave_id = l.id), '[]'::json) as files`;

const fromLines = sql`from person_leave l join person p on p.id = l.person_id join person m on m.id = l.made_by
  left join person a on a.id = l.approver_id left join person d on d.id = l.decided_by
  left join person s2 on s2.id = l.second_approver_id left join person rv on rv.id = l.revoked_by`;

type Deciders = { personId: number; approverId: number | null; secondApproverId: number | null };

/** Whom it waits for decides it (the first approver or the second, whoever is first), never the
 *  person themselves, never while looking as someone; HR and the Admin decide any. */
function mayDecide(me: Me, line: Deciders & { status: string }) {
  if (line.status !== "asked" || me.viewedBy || me.id === line.personId) return false;
  return (
    line.approverId === me.id ||
    line.secondApproverId === me.id ||
    ATTENDANCE_WRITE_ROLES.includes(me.role)
  );
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
/** Approved leave is revoked by the person until its first day, by HR any time. */
function mayRevoke(
  me: Me,
  line: { personId: number; status: string; from: string },
  today: string,
) {
  if (me.viewedBy || line.status !== "approved") return false;
  return ATTENDANCE_WRITE_ROLES.includes(me.role) || (me.id === line.personId && line.from > today);
}

/** Who opens a leave's papers and its printout: the person, whom it went to or who decided it,
 *  the leads above the person, HR, the CEO and the Admin. */
export async function mayReadLeave(
  db: Runner,
  me: Me,
  line: Deciders & { decidedById: number | null },
): Promise<boolean> {
  if (
    me.id === line.personId ||
    me.id === line.approverId ||
    me.id === line.secondApproverId ||
    me.id === line.decidedById ||
    ATTENDANCE_ALL_ROLES.includes(me.role)
  )
    return true;
  return LEAD_ROLES.includes(me.role) && inTeamOf(db, me.id, line.personId);
}

async function toLines(db: Runner, me: Me, found: Row[]): Promise<LeaveLine[]> {
  const today = todayManila();
  return (await withDays(db, found)).map(
    ({ personId, personName, team, approverId, secondApproverId, decidedById, ...one }) => ({
      ...one,
      person: { id: personId, name: personName, team },
      canDecide: mayDecide(me, { personId, approverId, secondApproverId, status: one.status }),
      canCancel: mayCancel(me, { personId, status: one.status, from: one.from }, today),
      canRevoke: mayRevoke(me, { personId, status: one.status, from: one.from }, today),
      // The lists already hold only what this person may read (a lead's team, everyone for HR).
      canPrint:
        one.status === "approved" &&
        (me.id === personId ||
          me.id === approverId ||
          me.id === secondApproverId ||
          me.id === decidedById ||
          ATTENDANCE_ALL_ROLES.includes(me.role) ||
          LEAD_ROLES.includes(me.role)),
    }),
  );
}

/** HR's adjustments to a person's credits for a year, by kind, in half days. */
async function adjustmentsOf(db: Runner, personId: number, year: number) {
  const found = await rows<{ kind: "vl" | "sl"; halves: number }>(
    db,
    sql`select kind, half_days::int as halves from leave_credit where person_id = ${personId} and year = ${year}`,
  );
  return {
    vl: found.filter((one) => one.kind === "vl").map((one) => one.halves / 2),
    sl: found.filter((one) => one.kind === "sl").map((one) => one.halves / 2),
  };
}

/** HR's lines on a person's credits for a year, newest first. */
export async function creditLines(db: Runner, personId: number, year: number): Promise<LeaveCreditLine[]> {
  return rows<LeaveCreditLine>(
    db,
    sql`select c.id::int as id, c.year, c.kind, c.half_days::float / 2 as days, c.reason, p.name as by,
        ${iso("c.made_at")} as at, c.reverses::int as reverses,
        (select r.id::int from leave_credit r where r.reverses = c.id) as "reversedBy"
      from leave_credit c join person p on p.id = c.made_by
      where c.person_id = ${personId} and c.year = ${year} order by c.made_at desc, c.id desc`,
  );
}

/** A year's VL and SL for a person, as a ledger: the opening days, HR's adjustments, used
 *  (approved), asked, left; and leave without pay taken. */
export async function balancesOf(
  db: Runner,
  personId: number,
  year: number,
  classification: Classification,
  except: number | null = null,
) {
  const [found, adjustments] = await Promise.all([
    rows<{
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
    ),
    adjustmentsOf(db, personId, year),
  ]);
  const counted = await withDays(db, found);
  const sum = (kind: LeaveKind, status: LeaveStatus) =>
    counted
      .filter((one) => one.kind === kind && one.status === status)
      .reduce((total, one) => total + one.days, 0);
  const balance = (kind: "vl" | "sl"): LeaveBalance => {
    const line = ledger({
      opening: LEAVE_DAYS[classification][kind],
      adjustments: adjustments[kind],
      used: sum(kind, "approved"),
      asked: sum(kind, "asked"),
    });
    return {
      allotted: line.total,
      opening: line.opening,
      adjusted: line.adjusted,
      used: line.used,
      asked: line.asked,
      left: line.left,
    };
  };
  return {
    vl: balance("vl"),
    sl: balance("sl"),
    lwop: { used: sum("lwop", "approved"), asked: sum("lwop", "asked") },
  };
}

export async function classificationOf(db: Runner, personId: number): Promise<Classification> {
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
  const approver = await approverOf(db, me.id);
  const [balances, second, credits, found] = await Promise.all([
    balancesOf(db, me.id, year, classification),
    secondApproverOf(db, me.id, approver?.id ?? null),
    creditLines(db, me.id, year),
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
    secondApprover: second?.name ?? null,
    credits,
    rules: {
      vlNoticeDays: VL_NOTICE_DAYS,
      earliestVl: earliestVl(today),
      slProofFromDays: SL_PROOF_FROM_DAYS,
      filesMax: LEAVE_FILES_MAX,
    },
    lines: await toLines(db, me, found),
  };
}

/** A person asks for leave, with up to five proof files. */
export async function requestLeave(
  db: Database,
  me: Me,
  input: { kind: LeaveKind; from: string; to: string; halfDay?: boolean; reason?: string | null },
  incoming: LeaveFile | LeaveFile[] | null,
): Promise<{ id: number }> {
  if (me.viewedBy) throw new Refusal(403, "not_allowed", "Look-only: nothing changes.");
  if (me.role === "ceo" || me.role === "admin")
    throw new Refusal(403, "not_allowed", "The CEO's and the Admin's leave is recorded by HR.");
  if (!KINDS.includes(input.kind))
    throw new Refusal(400, "invalid", "Pick the kind of leave.", "kind");
  const files = incoming === null ? [] : Array.isArray(incoming) ? incoming : [incoming];
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
  const late = leaveStartRefusal(input.kind, input.from, today);
  if (late) throw new Refusal(400, "invalid", late, "from");
  if (input.from.slice(0, 4) !== to.slice(0, 4))
    throw new Refusal(400, "invalid", "Ask for each year's days on their own.", "to");
  const reason = clean(input.reason) ?? null;
  if (input.kind === "other" && !reason)
    throw new Refusal(400, "invalid", "Say what the leave is for.", "reason");
  if (files.length > LEAVE_FILES_MAX)
    throw new Refusal(400, "invalid", `Attach at most ${LEAVE_FILES_MAX} files.`, "file");
  for (const file of files) {
    if (!FILE_TYPES.includes(file.mime))
      throw new Refusal(400, "invalid", "Attach photos or PDFs.", "file");
    if (file.bytes.byteLength === 0 || file.bytes.byteLength > LEAVE_FILE_MAX_BYTES)
      throw new Refusal(400, "invalid", "A file is empty or over 10 MB.", "file");
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
  if (input.kind === "sl" && days.days >= SL_PROOF_FROM_DAYS && !files.length)
    throw new Refusal(
      400,
      "invalid",
      `Sick leave of ${SL_PROOF_FROM_DAYS} days or more needs a medical certificate (a photo or a PDF).`,
      "file",
    );
  const approver = await approverOf(db, me.id);
  const second = await secondApproverOf(db, me.id, approver?.id ?? null);
  // Kept before the transaction, so a slow upload never holds a lock.
  const kept: KeptFile[] = [];
  for (const file of files)
    kept.push(await keepFile("leave", { ...file, name: file.name.trim().slice(0, 120) || "paper" }));
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
      sql`insert into person_leave (person_id, kind, from_day, to_day, half_day, reason, status, approver_id,
          second_approver_id, made_by)
        values (${me.id}, ${input.kind}, ${input.from}::date, ${to}::date, ${Boolean(input.halfDay)}, ${reason},
          'asked', ${approver?.id ?? null}, ${second?.id ?? null}, ${me.id})
        returning id::int as id`,
    );
    const id = line?.id as number;
    for (const file of kept)
      await tx.execute(
        sql`insert into leave_file (leave_id, name, mime, size, data, key)
          values (${id}, ${file.name}, ${file.mime}, ${file.size}, ${file.data}, ${file.key})`,
      );
    await notify(tx, {
      to: [
        ...(approver ? [approver.id] : await peopleIn(tx, ["hr"])),
        ...(second ? [second.id] : []),
      ],
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

/** An approver (the first, the second, or HR) approves a request or refuses it with a word; the
 *  first of them to decide closes it. */
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
    const [line] = await rows<
      Deciders & { status: string; kind: LeaveKind; from: string; to: string }
    >(
      tx,
      sql`select person_id::int as "personId", approver_id::int as "approverId",
          second_approver_id::int as "secondApproverId", status, kind,
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
        "Leave is decided by whom the person reports to, the second approver, or HR.",
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

/** Takes back approved leave: the person until its first day, HR any time. Kept, marked revoked
 *  with who, when and why; its days come back to the year's credits. Whom it went to is told. */
export async function revokeLeave(
  db: Database,
  me: Me,
  leaveId: number,
  input: { reason?: string | null },
): Promise<void> {
  if (me.viewedBy) throw new Refusal(403, "not_allowed", "Look-only: nothing changes.");
  const reason = clean(input.reason) ?? null;
  await db.transaction(async (tx) => {
    const [line] = await rows<
      Deciders & { status: string; kind: LeaveKind; from: string; to: string; name: string }
    >(
      tx,
      sql`select l.person_id::int as "personId", l.approver_id::int as "approverId",
          l.second_approver_id::int as "secondApproverId", l.status, l.kind, p.name,
          to_char(l.from_day, 'YYYY-MM-DD') as "from", to_char(l.to_day, 'YYYY-MM-DD') as "to"
        from person_leave l join person p on p.id = l.person_id where l.id = ${leaveId} for update of l`,
    );
    if (!line) throw new Refusal(404, "not_found", "That leave isn't on record.");
    if (line.status !== "approved")
      throw new Refusal(409, "invalid", "Only approved leave is revoked: cancel a request instead.");
    if (!mayRevoke(me, line, todayManila()))
      throw new Refusal(
        403,
        "not_allowed",
        me.id === line.personId
          ? "Leave that has started is revoked by HR."
          : "Only the person or HR revokes leave.",
      );
    await tx.execute(
      sql`update person_leave set status = 'revoked', revoked_by = ${me.id}, revoked_at = now(),
          revoke_reason = ${reason} where id = ${leaveId}`,
    );
    const told = [line.approverId, line.secondApproverId, line.personId].filter(
      (id): id is number => id !== null && id !== me.id,
    );
    if (told.length)
      await notify(tx, {
        to: told,
        kind: "leave_revoked",
        title: `${line.name}'s ${KIND_WORDS[line.kind]} (${spanWords(line.from, line.to)}) was revoked by ${me.name}`,
        body: reason,
        link: told.includes(line.personId) ? "/me/leave" : "/hr/leave?view=revoked",
        key: `leave:${leaveId}:revoked`,
      });
  });
}

/** Whether this person is named anyone's second approver (so they see those people's leave). */
async function isSecondApprover(db: Runner, me: Me) {
  return (
    (
      await rows<{ id: number }>(
        db,
        sql`select person_id::int as id from employee where second_approver_id = ${me.id} limit 1`,
      )
    ).length > 0
  );
}

/**
 * Leave for HR (everyone), the CEO and Management (everyone, to read), a team lead (their team,
 * down the line) and a second approver (the people who name them). `view` waiting: what this
 * person decides; else every line of a status, newest first; `month` narrows to that month.
 */
export async function leaveList(
  db: Database,
  me: Me,
  asked: { view?: string | null; month?: string | null },
): Promise<LeaveList> {
  const everyone = ATTENDANCE_ALL_ROLES.includes(me.role) || me.role === "management";
  const lead = LEAD_ROLES.includes(me.role);
  const second = !everyone && (await isSecondApprover(db, me));
  if (!everyone && !lead && !second)
    throw new Refusal(403, "not_allowed", "Leave lists are for HR, team leads and the CEO.");
  const today = todayManila();
  const team = lead
    ? sql`l.person_id in (with recursive team as (select id from person where id = ${me.id}
        union all select q.id from person q join team t on q.reports_to = t.id) select id from team where id <> ${me.id})`
    : sql`false`;
  const scope = everyone
    ? sql`true`
    : sql`(${team} or l.second_approver_id = ${me.id} or l.approver_id = ${me.id})`;
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
      : ["asked", "approved", "refused", "cancelled", "revoked"].includes(view)
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
      revoked: lines.filter((one) => one.status === "revoked").length,
    },
    mine: lines.filter((one) => one.canDecide).length,
  };
}

type LeaveReaders = Deciders & { decidedById: number | null };
const readersColumns = sql`l.person_id::int as "personId", l.approver_id::int as "approverId",
  l.second_approver_id::int as "secondApproverId", l.decided_by::int as "decidedById"`;

/** A leave's first paper: the one kept on the leave itself (rows from before several files), else
 *  the first proof file; for whoever may read it (the person, whom it went to, their leads, HR,
 *  the CEO, Management). */
export async function leaveFile(db: Database, me: Me, leaveId: number): Promise<LeaveFile> {
  const [line] = await rows<
    LeaveReaders & { name: string; mime: string; data: Uint8Array | null; key: string | null }
  >(
    db,
    sql`select ${readersColumns}, coalesce(l.file_name, f.name) as name, coalesce(l.file_mime, f.mime) as mime,
        case when l.file_data is null and l.file_key is null then f.data else l.file_data end as data,
        case when l.file_data is null and l.file_key is null then f.key else l.file_key end as key
      from person_leave l left join lateral (select name, mime, data, key from leave_file
        where leave_id = l.id order by id limit 1) f on true
      where l.id = ${leaveId}`,
  );
  if (!line || (!line.data && !line.key)) throw new Refusal(404, "not_found", "No paper with this leave.");
  if (!(await mayReadLeave(db, me, line)) && me.role !== "management")
    throw new Refusal(403, "not_allowed", "That paper isn't yours to see.");
  return { name: line.name, mime: line.mime, bytes: await bytesOf(line) };
}

/** One of a leave's proof files, for whoever may read the leave. */
export async function leaveProof(
  db: Database,
  me: Me,
  leaveId: number,
  fileId: number,
): Promise<LeaveFile> {
  const [line] = await rows<
    LeaveReaders & { name: string; mime: string; data: Uint8Array | null; key: string | null }
  >(
    db,
    sql`select ${readersColumns}, f.name, f.mime, f.data, f.key
      from leave_file f join person_leave l on l.id = f.leave_id where f.id = ${fileId} and f.leave_id = ${leaveId}`,
  );
  if (!line) throw new Refusal(404, "not_found", "No such file with this leave.");
  if (!(await mayReadLeave(db, me, line)) && me.role !== "management")
    throw new Refusal(403, "not_allowed", "That paper isn't yours to see.");
  return { name: line.name, mime: line.mime, bytes: await bytesOf(line) };
}
