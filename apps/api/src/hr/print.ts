// Signatures and printouts (docs/HR-PLAN.md, step 3). Each person draws their signature once (a
// PNG kept through files/store.ts); drawing a new one archives the old, never deletes it, so a
// printout shows the signature in force when its signer signed. An approved leave or form prints
// as the paper form HR's portal made (Automated-Excel's templates): the person's details, what the
// form carries, and the boxes of the employee, the immediate superior and HR, each filled only once
// that person signed (filed) or decided. Who opens a printout: the person, whoever filed it for
// them, whom it went to or who decided it, the leads above the person, HR, the CEO, the Admin.

import { sql } from "drizzle-orm";
import { companyName, type CompanyCode } from "../companies";
import { letterheadOf } from "../settings/service";
import { bytesOf, keepFile } from "../files/store";
import { type Database, rows } from "../db/index";
import { Refusal } from "../http";
import { iso, type Runner } from "../inventory/service";
import type {
  EodActivity,
  FormDetails,
  FormKind,
  IncidentDetails,
  LeaveKind,
  Me,
  MySignature,
  OtType,
  Printout,
} from "../types";
import { leaveDays, schedulesOf } from "./attendance";
import { holidayNamesOf } from "./holidays";
import { mayReadForm } from "./forms";
import { KIND_WORDS, mayReadLeave } from "./leave";
import { OT_TYPES } from "./leave-rules";
import { DEFAULT_SCHEDULE } from "./work-time";

/** A drawn signature: a PNG, at most 1 MB (Automated-Excel's SIGNATURE_MAX_BYTES). */
export const SIGNATURE_MAX_BYTES = 1024 * 1024;

const dataUrl = (mime: string, bytes: Uint8Array) =>
  `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;

/** The person's signature now (to show on their own page). */
export async function mySignature(db: Database, me: Me): Promise<MySignature> {
  const [found] = await rows<{
    id: number;
    at: string;
    mime: string;
    data: Uint8Array | null;
    key: string | null;
  }>(
    db,
    sql`select id::int as id, ${iso("made_at")} as at, mime, data, key from person_signature
      where person_id = ${me.id} and archived_at is null`,
  );
  if (!found) return { signature: null };
  return {
    signature: { id: found.id, at: found.at, image: dataUrl(found.mime, await bytesOf(found)) },
  };
}

/** The person draws their signature (again): the new one is kept, the old one archived. */
export async function saveSignature(
  db: Database,
  me: Me,
  file: { name: string; mime: string; bytes: Uint8Array } | null,
): Promise<{ id: number }> {
  if (me.viewedBy) throw new Refusal(403, "not_allowed", "Look-only: nothing changes.");
  if (!file || file.mime !== "image/png" || file.bytes.byteLength < 25)
    throw new Refusal(400, "invalid", "Draw your signature first.", "file");
  if (file.bytes[0] !== 0x89 || file.bytes[1] !== 0x50 || file.bytes[2] !== 0x4e || file.bytes[3] !== 0x47)
    throw new Refusal(400, "invalid", "The signature must be a PNG image.", "file");
  if (file.bytes.byteLength > SIGNATURE_MAX_BYTES)
    throw new Refusal(400, "invalid", "The signature image is over 1 MB.", "file");
  const kept = await keepFile("signature", { ...file, name: "signature.png" });
  return db.transaction(async (tx) => {
    await tx.execute(sql`select id from person where id = ${me.id} for update`);
    await tx.execute(
      sql`update person_signature set archived_at = now() where person_id = ${me.id} and archived_at is null`,
    );
    const [made] = await rows<{ id: number }>(
      tx,
      sql`insert into person_signature (person_id, name, mime, size, data, key)
        values (${me.id}, ${kept.name}, ${kept.mime}, ${kept.size}, ${kept.data}, ${kept.key}) returning id::int as id`,
    );
    return { id: made?.id as number };
  });
}

/** A person's signature as it stood at a moment: the last drawn by then, else the first drawn
 *  after it (someone who drew theirs only when first asked to sign). */
async function signatureAt(db: Runner, personId: number | null, at: string | null) {
  if (personId === null || at === null) return null;
  const [found] = await rows<{ mime: string; data: Uint8Array | null; key: string | null }>(
    db,
    sql`select mime, data, key from person_signature where person_id = ${personId}
      order by case when made_at <= ${at}::timestamptz then 0 else 1 end,
        case when made_at <= ${at}::timestamptz then made_at end desc nulls last, made_at, id limit 1`,
  );
  return found ? dataUrl(found.mime, await bytesOf(found)) : null;
}

export type Signer = { box: string; id: number | null; name: string | null; at: string | null };
/** Each signer's box with the signature they had when they signed (none until they sign). */
export async function signed(db: Runner, signers: Signer[]): Promise<Printout["signers"]> {
  return Promise.all(
    signers.map(async (one) => ({
      box: one.box,
      name: one.name,
      at: one.at,
      image: one.at ? await signatureAt(db, one.id, one.at) : null,
    })),
  );
}

type Person = {
  name: string;
  employeeCode: string | null;
  position: string | null;
  department: string | null;
  company: string | null;
};
const personColumns = sql`p.name, e.employee_code as "employeeCode", e.position, e.department, e.company`;

export const dayWords = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-PH", {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
export const momentDay = (at: string) =>
  new Date(at).toLocaleDateString("en-PH", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Manila" });
const clockWords = (clock: string) => {
  const [h, m] = clock.split(":").map(Number) as [number, number];
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};
const hoursWords = (minutes: number) =>
  minutes % 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes / 60}h`;

const head = (person: Person) => ({
  name: person.name,
  employeeCode: person.employeeCode,
  position: person.position,
  department: person.department,
});

/** The printout of an approved leave. */
export async function leavePrintout(db: Database, me: Me, leaveId: number): Promise<Printout> {
  const [line] = await rows<
    Person & {
      personId: number;
      approverId: number | null;
      approver: string | null;
      secondApproverId: number | null;
      decidedById: number | null;
      decidedBy: string | null;
      decidedRole: string | null;
      decidedAt: string | null;
      madeById: number;
      madeAt: string;
      kind: LeaveKind;
      from: string;
      to: string;
      halfDay: boolean;
      reason: string | null;
      status: string;
      note: string | null;
      files: number;
    }
  >(
    db,
    sql`select ${personColumns}, l.person_id::int as "personId", l.approver_id::int as "approverId", a.name as approver,
        l.second_approver_id::int as "secondApproverId", l.decided_by::int as "decidedById", d.name as "decidedBy",
        d.role as "decidedRole", ${iso("l.decided_at")} as "decidedAt", l.made_by::int as "madeById", ${iso("l.made_at")} as "madeAt",
        l.kind, to_char(l.from_day, 'YYYY-MM-DD') as "from", to_char(l.to_day, 'YYYY-MM-DD') as "to", l.half_day as "halfDay",
        l.reason, l.status, l.decision_note as note,
        (select count(*)::int from leave_file f where f.leave_id = l.id) + case when l.file_name is null then 0 else 1 end as files
      from person_leave l join person p on p.id = l.person_id left join employee e on e.person_id = p.id
        left join person a on a.id = l.approver_id left join person d on d.id = l.decided_by
      where l.id = ${leaveId}`,
  );
  if (!line) throw new Refusal(404, "not_found", "No such leave.");
  if (!(await mayReadLeave(db, me, line)))
    throw new Refusal(403, "not_allowed", "That leave isn't yours to print.");
  if (line.status !== "approved")
    throw new Refusal(409, "invalid", "Only approved leave is printed.");
  const [schedules, holidays] = await Promise.all([
    schedulesOf(db, [line.personId]),
    holidayNamesOf(db, line.personId, line.from, line.to),
  ]);
  const days = leaveDays(
    line.from,
    line.to,
    line.halfDay,
    schedules.get(line.personId) ?? DEFAULT_SCHEDULE,
    new Set(holidays.keys()),
  );
  // Decided by whom it went to (first or second approver): the superior's box; by HR: HR's.
  const byApprover =
    line.decidedById !== null &&
    (line.decidedById === line.approverId || line.decidedById === line.secondApproverId);
  const byHr = line.decidedById !== null && !byApprover;
  const ownFiling = line.madeById === line.personId;
  return {
    kind: "leave",
    title: "Application for Leave",
    company: companyName(line.company ?? "2mg"),
    code: paperCode("LV", leaveId),
    letterhead: await letterheadOf(db, (line.company ?? "2mg") as CompanyCode),
    person: head(line),
    filedOn: momentDay(line.madeAt),
    status: "Approved",
    fields: [
      { label: "Kind of leave", value: KIND_WORDS[line.kind].replace(/^./, (c) => c.toUpperCase()) },
      {
        label: "Dates",
        value: line.from === line.to ? dayWords(line.from) : `${dayWords(line.from)} to ${dayWords(line.to)}`,
      },
      { label: "Working days", value: line.halfDay ? "Half a day" : String(days) },
      { label: "Reason", value: line.reason ?? "—" },
      ...(line.files ? [{ label: "Proof attached", value: `${line.files} file${line.files === 1 ? "" : "s"}` }] : []),
      ...(ownFiling ? [] : [{ label: "Recorded by", value: "HR, for the employee" }]),
      ...(line.note ? [{ label: "Note", value: line.note }] : []),
    ],
    table: null,
    signers: await signed(db, [
      { box: "Employee", id: line.personId, name: line.name, at: ownFiling ? line.madeAt : null },
      {
        box: "Immediate superior",
        id: byApprover ? line.decidedById : line.approverId,
        name: byApprover ? line.decidedBy : line.approver,
        at: byApprover ? line.decidedAt : null,
      },
      {
        box: "Human Resources",
        id: byHr ? line.decidedById : null,
        name: byHr ? line.decidedBy : null,
        at: byHr ? line.decidedAt : null,
      },
    ]),
  };
}

/** A leave's or a form's number on paper: its kind and its row, LV-000123 (never reused). */
const paperCode = (prefix: string, id: number) => `${prefix}-${String(id).padStart(6, "0")}`;
const FORM_PREFIX: Record<FormKind, string> = { ob: "OB", wfh: "WFH", ot: "OT", eod: "DAR", incident: "IR" };

const FORM_TITLES: Record<FormKind, string> = {
  ob: "Official Business Form",
  wfh: "Work From Home Form",
  ot: "Overtime Requisition Form",
  eod: "Daily Accomplishment Report",
  incident: "Incident Report",
};

/** The printout of an approved form (an incident report taken in). */
export async function formPrintout(db: Database, me: Me, formId: number): Promise<Printout> {
  const [row] = await rows<
    Person & {
      personId: number;
      approverId: number | null;
      approver: string | null;
      headById: number | null;
      headBy: string | null;
      decidedById: number | null;
      decidedBy: string | null;
      decidedAt: string | null;
      madeAt: string;
      kind: FormKind;
      day: string;
      from: string | null;
      to: string | null;
      place: string | null;
      reason: string;
      details: FormDetails | null;
      otType: OtType | null;
      otMinutes: number | null;
      otNight: number | null;
      status: string;
      note: string | null;
    }
  >(
    db,
    sql`select ${personColumns}, f.person_id::int as "personId", f.approver_id::int as "approverId", a.name as approver,
        f.head_by::int as "headById", hb.name as "headBy", f.decided_by::int as "decidedById", d.name as "decidedBy",
        ${iso("f.decided_at")} as "decidedAt", ${iso("f.made_at")} as "madeAt", f.kind, to_char(f.day, 'YYYY-MM-DD') as day,
        to_char(f.from_time, 'HH24:MI') as "from", to_char(f.to_time, 'HH24:MI') as "to", f.place, f.reason, f.details,
        f.ot_type as "otType", f.ot_minutes as "otMinutes", f.ot_night_minutes as "otNight", f.status,
        f.decision_note as note
      from hr_form f join person p on p.id = f.person_id left join employee e on e.person_id = p.id
        left join person a on a.id = f.approver_id left join person d on d.id = f.decided_by
        left join person hb on hb.id = f.head_by
      where f.id = ${formId}`,
  );
  if (!row) throw new Refusal(404, "not_found", "No such form.");
  if (!(await mayReadForm(db, me, row)))
    throw new Refusal(403, "not_allowed", "That form isn't yours to print.");
  if (row.status !== "approved")
    throw new Refusal(409, "invalid", "Only an approved form is printed.");
  const fields: Printout["fields"] = [{ label: "Date", value: dayWords(row.day) }];
  let table: Printout["table"] = null;
  const times = row.from && row.to ? `${clockWords(row.from)} – ${clockWords(row.to)}` : null;
  if (row.kind === "ob") {
    fields.push({ label: "Time", value: times ?? "—" }, { label: "Where", value: row.place ?? "—" });
    fields.push({ label: "Purpose", value: row.reason });
  } else if (row.kind === "wfh") {
    fields.push({ label: "Purpose", value: row.reason });
  } else if (row.kind === "ot") {
    const minutes = row.otMinutes ?? 0;
    const night = row.otNight ?? 0;
    fields.push(
      { label: "Type of overtime", value: row.otType ? OT_TYPES[row.otType] : "—" },
      { label: "Time in – time out", value: times ?? "—" },
      {
        label: "Total hours",
        value: `${hoursWords(minutes)}${night ? ` (${hoursWords(minutes - night)} regular, ${hoursWords(night)} night differential)` : ""}`,
      },
      { label: "Reason", value: row.reason },
    );
    if (row.headBy) fields.push({ label: "Filed by (Head Requisition)", value: row.headBy });
  } else if (row.kind === "eod") {
    fields.push({ label: "Purpose or project", value: row.reason });
    const activities = (row.details as { activities?: EodActivity[] } | null)?.activities ?? [];
    table = {
      head: ["Time in", "Time out", "Location", "Details", "Deadline", "Remarks"],
      rows: activities.map((one) => [
        clockWords(one.timeIn),
        clockWords(one.timeOut),
        one.location ?? "",
        one.details,
        one.deadline ?? "",
        one.remarks ?? "",
      ]),
    };
  } else {
    const incident = row.details as IncidentDetails | null;
    fields.push(
      { label: "Time", value: incident ? clockWords(incident.time) : "—" },
      { label: "Location", value: incident?.location ?? "—" },
      {
        label: "Type of incident",
        value: incident ? `${incident.type}${incident.otherText ? `: ${incident.otherText}` : ""}` : "—",
      },
      { label: "Description", value: row.reason },
      { label: "Persons involved", value: incident?.persons ?? "—" },
      { label: "Immediate action taken", value: incident?.action ?? "—" },
    );
  }
  if (row.note) fields.push({ label: "Note", value: row.note });
  // Head Requisition: the head signs the employee's and the superior's boxes when filing.
  const byApprover = row.decidedById !== null && row.decidedById === row.approverId;
  const byHr = row.decidedById !== null && !byApprover;
  const head = row.headById !== null;
  return {
    kind: row.kind,
    title: FORM_TITLES[row.kind],
    company: companyName(row.company ?? "2mg"),
    code: paperCode(FORM_PREFIX[row.kind], formId),
    letterhead: await letterheadOf(db, (row.company ?? "2mg") as CompanyCode),
    person: { name: row.name, employeeCode: row.employeeCode, position: row.position, department: row.department },
    filedOn: momentDay(row.madeAt),
    status: row.kind === "incident" ? "Taken in" : "Approved",
    fields,
    table,
    signers: await signed(db, [
      {
        box: row.kind === "incident" ? "Reported by" : "Employee",
        id: head ? row.headById : row.personId,
        name: head ? row.headBy : row.name,
        at: row.madeAt,
      },
      ...(row.kind === "incident" || row.kind === "eod"
        ? []
        : [
            {
              box: "Immediate superior",
              id: head ? row.headById : byApprover ? row.decidedById : row.approverId,
              name: head ? row.headBy : byApprover ? row.decidedBy : row.approver,
              at: head ? row.madeAt : byApprover ? row.decidedAt : null,
            },
          ]),
      {
        box: "Human Resources",
        id: byHr ? row.decidedById : null,
        name: byHr ? row.decidedBy : null,
        at: byHr ? row.decidedAt : null,
      },
    ]),
  };
}

