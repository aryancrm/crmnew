// HR's forms, asked for by people and decided like leave (whom they report to, else HR; HR may
// decide any; the CEO reads): official business (away for work: those hours count as worked and
// the day isn't late or absent), work from home (the day counts as worked), overtime (hours outside
// work, counted as approved overtime), the daily accomplishment report and the incident report
// (both to HR). One form of a kind a day.
//
// Overtime keeps HR's rules (Automated-Excel's lib/overtimeRules.js, leave-rules.ts): its type is
// the kind of day (regular, rest day, holiday, both) or broken time; times on the hour or half
// hour; on a regular day the working hours never count; the night part (10 PM to 6 AM) is kept
// apart; a day with official business filed takes no overtime. A team lead or manager may file
// overtime for someone under them (Head Requisition): it goes straight to HR. The person (or the
// head) revokes a form until it is decided, kept as revoked with who, when and from which desk.
// HR may return a form to be fixed: the person sends it again or revokes it.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { Refusal } from "../http";
import { addDays, todayManila } from "../inventory/rules";
import { clean, iso, type Runner } from "../inventory/service";
import { notify, peopleIn } from "../notify/service";
import type {
  EodActivity,
  FormDetails,
  FormInput,
  FormKind,
  FormLine,
  FormList,
  IncidentDetails,
  IncidentType,
  Me,
  OtType,
} from "../types";
import { ATTENDANCE_ALL_ROLES, ATTENDANCE_WRITE_ROLES, formSpan, schedulesOf } from "./attendance";
import { approverOf, inTeamOf, LEAD_ROLES } from "./leave";
import { dayKindOf, OT_TYPES, onHalfHour, otTypesFor, overtimeOf } from "./leave-rules";
import { DEFAULT_SCHEDULE } from "./work-time";

const KINDS: FormKind[] = ["ob", "wfh", "ot", "eod", "incident"];
export const FORM_WORDS: Record<FormKind, string> = {
  ob: "official business",
  wfh: "work from home",
  ot: "overtime",
  eod: "daily accomplishment report",
  incident: "incident report",
};
export const INCIDENT_TYPES: IncidentType[] = [
  "Safety / Accident",
  "Misconduct",
  "Property Damage",
  "Security",
  "Other",
];
/** Incidents are reported within this many days, never ahead (Automated-Excel). */
export const INCIDENT_DAYS_BACK = 30;
/** Activities on one daily report, at most. */
const EOD_MAX = 30;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const dayWords = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-PH", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

type Row = Omit<
  FormLine,
  | "minutes"
  | "nightMinutes"
  | "canDecide"
  | "canCancel"
  | "canRevoke"
  | "canReturn"
  | "canResend"
  | "canPrint"
  | "person"
  | "revoked"
> & {
  personId: number;
  personName: string;
  team: string | null;
  approverId: number | null;
  headById: number | null;
  decidedById: number | null;
  otMinutes: number | null;
  otNight: number | null;
  revokedBy: string | null;
  revokedAt: string | null;
  revokedFrom: string | null;
  revokedStage: "approver" | "hr" | null;
};

const columns = (
  today: string,
) => sql`f.id::int as id, f.person_id::int as "personId", p.name as "personName",
  (select u.name from seat_holder h join seat s on s.id = h.seat_id and s.active join org_unit u on u.id = s.unit_id
    where h.person_id = p.id and h.kind = 'holder' and h.starts_on <= ${today}::date
      and (h.ends_on is null or h.ends_on >= ${today}::date) order by h.starts_on, h.id limit 1) as team,
  f.kind, to_char(f.day, 'YYYY-MM-DD') as day, to_char(f.from_time, 'HH24:MI') as "from",
  to_char(f.to_time, 'HH24:MI') as "to", f.place, f.reason, f.details, f.status, f.approver_id::int as "approverId",
  a.name as approver, f.head_by::int as "headById", hb.name as "headBy", f.decided_by::int as "decidedById",
  d.name as "decidedBy", f.decision_note as "decisionNote", f.return_note as "returnNote",
  f.ot_type as "otType", f.ot_minutes as "otMinutes", f.ot_night_minutes as "otNight",
  rv.name as "revokedBy", ${iso("f.revoked_at")} as "revokedAt", f.revoked_from as "revokedFrom",
  f.revoked_stage as "revokedStage"`;
const fromForms = sql`from hr_form f join person p on p.id = f.person_id left join person a on a.id = f.approver_id
  left join person d on d.id = f.decided_by left join person hb on hb.id = f.head_by
  left join person rv on rv.id = f.revoked_by`;

type Who = { personId: number; approverId: number | null; headById: number | null };
/** Who files and manages a form: the person, or the head who filed overtime for them. */
const ownerOf = (row: Who) => row.headById ?? row.personId;

const mayDecide = (me: Me, row: Who & { status: string }) =>
  row.status === "asked" &&
  !me.viewedBy &&
  me.id !== row.personId &&
  me.id !== row.headById &&
  (row.approverId === me.id || ATTENDANCE_WRITE_ROLES.includes(me.role));
const mayCancel = (me: Me, row: Who & { status: string; day: string }, today: string) =>
  !me.viewedBy &&
  (ATTENDANCE_WRITE_ROLES.includes(me.role)
    ? row.status === "asked" || row.status === "approved"
    : me.id === ownerOf(row) &&
      (row.status === "asked" || (row.status === "approved" && row.day > today)));
/** Revoked by whoever filed it, until it is decided (or once returned to them). */
const mayRevoke = (me: Me, row: Who & { status: string }) =>
  !me.viewedBy && me.id === ownerOf(row) && (row.status === "asked" || row.status === "returned");
/** HR returns a form waiting or approved to whoever filed it, to fix (an incident report is not). */
const mayReturn = (me: Me, row: Who & { status: string; kind: FormKind }) =>
  !me.viewedBy &&
  ATTENDANCE_WRITE_ROLES.includes(me.role) &&
  row.kind !== "incident" &&
  me.id !== row.personId &&
  (row.status === "asked" || row.status === "approved");
const mayResend = (me: Me, row: Who & { status: string }) =>
  !me.viewedBy && row.status === "returned" && me.id === ownerOf(row);

/** Who opens a form's printout: the person, the head who filed it, whom it went to or who decided
 *  it, the leads above the person, HR, the CEO and the Admin. */
export async function mayReadForm(
  db: Runner,
  me: Me,
  row: Who & { decidedById: number | null },
): Promise<boolean> {
  if (
    [row.personId, row.headById, row.approverId, row.decidedById].includes(me.id) ||
    ATTENDANCE_ALL_ROLES.includes(me.role)
  )
    return true;
  return LEAD_ROLES.includes(me.role) && inTeamOf(db, me.id, row.personId);
}

function toLines(me: Me, found: Row[]): FormLine[] {
  const today = todayManila();
  return found.map(
    ({
      personId,
      personName,
      team,
      approverId,
      headById,
      decidedById,
      otMinutes,
      otNight,
      revokedBy,
      revokedAt,
      revokedFrom,
      revokedStage,
      ...one
    }) => {
      const who = { personId, approverId, headById };
      return {
        ...one,
        person: { id: personId, name: personName, team },
        minutes: one.kind === "ot" ? (otMinutes ?? formSpan(one)) : formSpan(one),
        nightMinutes: otNight ?? 0,
        revoked:
          one.status === "revoked" && revokedAt
            ? {
                by: revokedBy ?? "",
                at: revokedAt,
                from: revokedFrom ?? "asked",
                stage: revokedStage ?? "approver",
              }
            : null,
        canDecide: mayDecide(me, { ...who, status: one.status }),
        canCancel: mayCancel(me, { ...who, status: one.status, day: one.day }, today),
        canRevoke: mayRevoke(me, { ...who, status: one.status }),
        canReturn: mayReturn(me, { ...who, status: one.status, kind: one.kind }),
        canResend: mayResend(me, { ...who, status: one.status }),
        // Lists already hold only what this person may read (a lead's team, everyone for HR).
        canPrint:
          one.status === "approved" &&
          ([personId, headById, approverId, decidedById].includes(me.id) ||
            ATTENDANCE_ALL_ROLES.includes(me.role) ||
            LEAD_ROLES.includes(me.role)),
      };
    },
  );
}

/** A form as it will be kept: checked, with whom it goes to and the overtime worked out. */
type Ready = {
  kind: FormKind;
  personId: number;
  personName: string;
  headBy: number | null;
  day: string;
  fromTime: string | null;
  toTime: string | null;
  place: string | null;
  reason: string;
  details: FormDetails | null;
  otType: OtType | null;
  otMinutes: number | null;
  otNight: number | null;
  approverId: number | null;
  approverName: string | null;
};

const text = (value: string | null | undefined, max: number) => {
  const out = clean(value);
  return out ? out.slice(0, max) : null;
};

/** The daily report's activities, checked (Automated-Excel: each with its times and details). */
function activitiesOf(raw: FormInput["activities"]): EodActivity[] {
  const list = (raw ?? []).slice(0, EOD_MAX + 1);
  if (!list.length) throw new Refusal(400, "invalid", "Add at least one activity.", "activities");
  if (list.length > EOD_MAX)
    throw new Refusal(400, "invalid", `Put at most ${EOD_MAX} activities on a day.`, "activities");
  return list.map((one) => {
    const details = text(one.details, 2000);
    if (!details) throw new Refusal(400, "invalid", "Every activity needs what was done.", "activities");
    if (!CLOCK.test(one.timeIn ?? "") || !CLOCK.test(one.timeOut ?? ""))
      throw new Refusal(400, "invalid", "Type the time in and out of every activity.", "activities");
    return {
      timeIn: one.timeIn,
      timeOut: one.timeOut,
      location: text(one.location, 200),
      details,
      deadline: text(one.deadline, 200),
      remarks: text(one.remarks, 500),
    };
  });
}

/** The incident report's fields, checked (Automated-Excel's readFormDetails). */
function incidentOf(raw: FormInput["incident"]): IncidentDetails {
  if (!raw) throw new Refusal(400, "invalid", "Fill in the incident.", "incident");
  if (!CLOCK.test(raw.time ?? "")) throw new Refusal(400, "invalid", "Type when it happened.", "time");
  const location = text(raw.location, 200);
  if (!location) throw new Refusal(400, "invalid", "Say where it happened.", "location");
  if (!INCIDENT_TYPES.includes(raw.type))
    throw new Refusal(400, "invalid", "Pick the kind of incident.", "type");
  const otherText = raw.type === "Other" ? text(raw.otherText, 120) : null;
  if (raw.type === "Other" && !otherText)
    throw new Refusal(400, "invalid", "Say what kind of incident it was.", "otherText");
  const persons = text(raw.persons, 5000);
  if (!persons)
    throw new Refusal(400, "invalid", 'List who was involved (write "None" if no one else).', "persons");
  const action = text(raw.action, 5000);
  if (!action)
    throw new Refusal(400, "invalid", 'Say what was done at once (write "None" if nothing).', "action");
  return { time: raw.time, location, type: raw.type, otherText, persons, action };
}

/** Checks a form and works out whom it goes to; `fixed` keeps the kind and the person of a
 *  returned form sent again. */
async function readForm(
  db: Runner,
  me: Me,
  input: FormInput,
  fixed: { kind: FormKind; personId: number; headBy: number | null; id: number } | null = null,
): Promise<Ready> {
  const kind = fixed?.kind ?? input.kind;
  if (!KINDS.includes(kind)) throw new Refusal(400, "invalid", "Pick the form.", "kind");
  // Head Requisition: overtime a team lead or manager files for someone under them.
  let person = { id: me.id, name: me.name };
  let headBy: number | null = null;
  const forId = fixed ? (fixed.headBy !== null ? fixed.personId : null) : (input.forPersonId ?? null);
  if (forId !== null && forId !== me.id) {
    if (kind !== "ot")
      throw new Refusal(400, "invalid", "Only overtime is filed for someone else.", "forPersonId");
    if (!LEAD_ROLES.includes(me.role) || !(await inTeamOf(db, me.id, forId)))
      throw new Refusal(
        403,
        "not_allowed",
        "A team lead or manager files overtime for someone under them.",
        "forPersonId",
      );
    const [found] = await rows<{ id: number; name: string }>(
      db,
      sql`select id::int as id, name from person where id = ${forId} and active`,
    );
    if (!found) throw new Refusal(404, "not_found", "No such person at work.", "forPersonId");
    person = found;
    headBy = me.id;
  } else if (me.role === "ceo" || me.role === "admin")
    throw new Refusal(403, "not_allowed", "The CEO's and the Admin's forms are kept by HR.");
  const today = todayManila();
  if (kind === "incident") {
    if (!DAY.test(input.day) || input.day > today || input.day < addDays(today, -INCIDENT_DAYS_BACK))
      throw new Refusal(
        400,
        "invalid",
        `Report an incident within ${INCIDENT_DAYS_BACK} days, never ahead.`,
        "day",
      );
  } else if (!DAY.test(input.day) || input.day < addDays(today, -30) || input.day > addDays(today, 60))
    throw new Refusal(400, "invalid", "Pick a day from a month back to two months ahead.", "day");
  const reason = text(input.reason, 5000);
  if (!reason)
    throw new Refusal(
      400,
      "invalid",
      kind === "eod"
        ? "Say the day's purpose or project."
        : kind === "incident"
          ? "Describe what happened."
          : "Say what it was for.",
      "reason",
    );
  let fromTime: string | null = null;
  let toTime: string | null = null;
  if (kind === "ob" || kind === "ot") {
    if (!input.from || !CLOCK.test(input.from) || !input.to || !CLOCK.test(input.to))
      throw new Refusal(400, "invalid", "Pick when it started and when it ended.", "to");
    if (kind === "ob" && input.to <= input.from)
      throw new Refusal(400, "invalid", "Pick when it started and when it ended.", "to");
    fromTime = input.from;
    toTime = input.to;
  }
  const place = kind === "ob" ? text(input.place, 200) : null;
  if (kind === "ob" && !place) throw new Refusal(400, "invalid", "Say where you were.", "place");
  let otType: OtType | null = null;
  let otMinutes: number | null = null;
  let otNight: number | null = null;
  if (kind === "ot" && fromTime && toTime) {
    if (!onHalfHour(fromTime) || !onHalfHour(toTime))
      throw new Refusal(400, "invalid", "Overtime starts and ends on the hour or the half hour.", "to");
    const schedule = (await schedulesOf(db, [person.id])).get(person.id) ?? DEFAULT_SCHEDULE;
    const [holiday] = await rows<{ kind: "regular" | "special" }>(
      db,
      sql`select kind from holiday where active and day = ${input.day}::date limit 1`,
    );
    const dayKind = dayKindOf(input.day, schedule.days, holiday?.kind ?? null);
    otType = input.otType ?? dayKind;
    if (!otTypesFor(dayKind).includes(otType))
      throw new Refusal(
        400,
        "invalid",
        `That day is a ${OT_TYPES[dayKind].toLowerCase()}: pick ${OT_TYPES[dayKind].toLowerCase()} or broken time.`,
        "otType",
      );
    const worked = overtimeOf({
      from: fromTime,
      to: toTime,
      dayKind,
      workStart: schedule.start,
      workEnd: schedule.end,
    });
    if ("error" in worked) throw new Refusal(400, "invalid", worked.error, "to");
    otMinutes = worked.minutes;
    otNight = worked.nightMinutes;
    // A day with official business filed takes no overtime (Automated-Excel, 31 Oct).
    const [ob] = await rows<{ id: number }>(
      db,
      sql`select id::int as id from hr_form where person_id = ${person.id} and kind = 'ob'
        and day = ${input.day}::date and status in ('asked', 'approved') limit 1`,
    );
    if (ob)
      throw new Refusal(
        409,
        "taken",
        `${person.id === me.id ? "You have" : `${person.name} has`} official business filed on ${dayWords(input.day)}, so no overtime is filed for it.`,
        "day",
      );
  }
  let details: FormDetails | null = null;
  if (kind === "eod") details = { activities: activitiesOf(input.activities) };
  if (kind === "incident") details = incidentOf(input.incident);
  // Head Requisition, the daily report and the incident report go straight to HR.
  const approver =
    headBy !== null || kind === "eod" || kind === "incident" ? null : await approverOf(db, person.id);
  return {
    kind,
    personId: person.id,
    personName: person.name,
    headBy,
    day: input.day,
    fromTime,
    toTime,
    place,
    reason,
    details,
    otType,
    otMinutes,
    otNight,
    approverId: approver?.id ?? null,
    approverName: approver?.name ?? null,
  };
}

const whenWords = (form: Ready) =>
  `${dayWords(form.day)}${form.fromTime ? ` ${form.fromTime}–${form.toTime}` : ""}`;

export async function requestForm(db: Database, me: Me, input: FormInput): Promise<{ id: number }> {
  if (me.viewedBy) throw new Refusal(403, "not_allowed", "Look-only: nothing changes.");
  const form = await readForm(db, me, input);
  return db.transaction(async (tx) => {
    const [taken] = await rows<{ id: number }>(
      tx,
      sql`select id::int as id from hr_form where person_id = ${form.personId} and kind = ${form.kind}
        and day = ${form.day}::date and status in ('asked', 'approved', 'returned')`,
    );
    if (taken)
      throw new Refusal(
        409,
        "taken",
        `${form.headBy ? `${form.personName} already has` : "You already have"} a ${FORM_WORDS[form.kind]} form on ${dayWords(form.day)}.`,
        "day",
      );
    const [made] = await rows<{ id: number }>(
      tx,
      sql`insert into hr_form (person_id, kind, day, from_time, to_time, place, reason, approver_id, made_by,
          ot_type, ot_minutes, ot_night_minutes, head_by, details)
        values (${form.personId}, ${form.kind}, ${form.day}::date, ${form.fromTime}::time, ${form.toTime}::time,
          ${form.place}, ${form.reason}, ${form.approverId}, ${me.id}, ${form.otType}, ${form.otMinutes},
          ${form.otNight}, ${form.headBy}, ${form.details ? JSON.stringify(form.details) : null}::jsonb)
        returning id::int as id`,
    );
    const id = made?.id as number;
    await notify(tx, {
      to: form.approverId ? [form.approverId] : (await peopleIn(tx, ["hr"])).filter((one) => one !== me.id),
      kind: "form_request",
      title: form.headBy
        ? `${me.name} files overtime for ${form.personName}: ${whenWords(form)}`
        : `${me.name} files ${FORM_WORDS[form.kind]}: ${whenWords(form)}`,
      body: form.reason,
      link: "/hr/leave?of=forms&view=waiting",
      key: `form:${id}:asked`,
    });
    if (form.headBy)
      await notify(tx, {
        to: [form.personId],
        kind: "form_filed_for_you",
        title: `${me.name} filed overtime for you: ${whenWords(form)}`,
        body: form.reason,
        link: "/me/leave",
        key: `form:${id}:for`,
      });
    return { id };
  });
}

type Held = Who & {
  status: string;
  kind: FormKind;
  day: string;
  decidedById: number | null;
};
const heldColumns = sql`person_id::int as "personId", approver_id::int as "approverId", head_by::int as "headById",
  decided_by::int as "decidedById", status, kind, to_char(day, 'YYYY-MM-DD') as day`;

export async function decideForm(
  db: Database,
  me: Me,
  formId: number,
  input: { approve: boolean; note?: string | null },
): Promise<void> {
  const note = clean(input.note) ?? null;
  await db.transaction(async (tx) => {
    const [row] = await rows<Held>(tx, sql`select ${heldColumns} from hr_form where id = ${formId} for update`);
    if (!row) throw new Refusal(404, "not_found", "No such form.");
    if (row.status !== "asked")
      throw new Refusal(409, "invalid", "That form isn't waiting for a decision.");
    if (!mayDecide(me, row))
      throw new Refusal(
        403,
        "not_allowed",
        "Forms are decided by whom the person reports to, or HR.",
      );
    if (row.kind === "incident" && !input.approve)
      throw new Refusal(400, "invalid", "An incident report is taken in, not refused: mark it handled.", "note");
    if (!input.approve && !note)
      throw new Refusal(400, "invalid", "Say why it can't be given.", "note");
    await tx.execute(
      sql`update hr_form set status = ${input.approve ? "approved" : "refused"}, decided_by = ${me.id},
          decided_at = now(), decision_note = ${note} where id = ${formId}`,
    );
    await notify(tx, {
      to: [...new Set([ownerOf(row), row.personId])],
      kind: input.approve ? "form_approved" : "form_refused",
      title:
        row.kind === "incident"
          ? `Your incident report (${dayWords(row.day)}) was taken in by ${me.name}`
          : `Your ${FORM_WORDS[row.kind]} (${dayWords(row.day)}) was ${input.approve ? "approved" : "not approved"} by ${me.name}`,
      body: note,
      link: "/me/leave",
      key: `form:${formId}:decided`,
    });
  });
}

export async function cancelForm(db: Database, me: Me, formId: number): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await rows<Held>(tx, sql`select ${heldColumns} from hr_form where id = ${formId} for update`);
    if (!row) throw new Refusal(404, "not_found", "No such form.");
    if (!mayCancel(me, row, todayManila()))
      throw new Refusal(
        403,
        "not_allowed",
        "Only the person (before the day) or HR cancels a form.",
      );
    await tx.execute(
      sql`update hr_form set status = 'cancelled', cancelled_by = ${me.id}, cancelled_at = now() where id = ${formId}`,
    );
  });
}

/** Whoever filed a form takes it back until it is decided (or once returned to them): kept as
 *  revoked, with who, when, the status it had and the desk it was at. Whom it waited for is told. */
export async function revokeForm(db: Database, me: Me, formId: number): Promise<void> {
  if (me.viewedBy) throw new Refusal(403, "not_allowed", "Look-only: nothing changes.");
  await db.transaction(async (tx) => {
    const [row] = await rows<Held & { name: string }>(
      tx,
      sql`select ${heldColumns}, (select name from person where id = hr_form.person_id) as name
        from hr_form where id = ${formId} for update`,
    );
    if (!row) throw new Refusal(404, "not_found", "No such form.");
    if (row.status !== "asked" && row.status !== "returned")
      throw new Refusal(409, "invalid", `That form is ${row.status === "approved" ? "already approved" : row.status}: it can't be revoked.`);
    if (!mayRevoke(me, row))
      throw new Refusal(403, "not_allowed", "Only who filed a form revokes it.");
    const stage = row.approverId === null ? "hr" : "approver";
    await tx.execute(
      sql`update hr_form set status = 'revoked', revoked_by = ${me.id}, revoked_at = now(),
          revoked_from = ${row.status}, revoked_stage = ${stage} where id = ${formId}`,
    );
    if (row.status === "asked")
      await notify(tx, {
        to: row.approverId ? [row.approverId] : (await peopleIn(tx, ["hr"])).filter((one) => one !== me.id),
        kind: "form_revoked",
        title: `${me.name} revoked ${row.headById ? `the overtime filed for ${row.name}` : `a ${FORM_WORDS[row.kind]} form`} (${dayWords(row.day)}): nothing to decide`,
        link: "/hr/leave?of=forms&view=revoked",
        key: `form:${formId}:revoked`,
      });
  });
}

/** HR returns a form (waiting or approved) to whoever filed it, saying what to fix. */
export async function returnForm(
  db: Database,
  me: Me,
  formId: number,
  input: { note?: string | null },
): Promise<void> {
  const note = clean(input.note) ?? null;
  if (!note) throw new Refusal(400, "invalid", "Say what to fix.", "note");
  await db.transaction(async (tx) => {
    const [row] = await rows<Held>(tx, sql`select ${heldColumns} from hr_form where id = ${formId} for update`);
    if (!row) throw new Refusal(404, "not_found", "No such form.");
    if (!mayReturn(me, row))
      throw new Refusal(
        row.status === "asked" || row.status === "approved" ? 403 : 409,
        "not_allowed",
        "HR returns a form waiting or approved (never an incident report, never one's own).",
      );
    await tx.execute(
      sql`update hr_form set status = 'returned', returned_by = ${me.id}, returned_at = now(), return_note = ${note},
          decided_by = null, decided_at = null, decision_note = null where id = ${formId}`,
    );
    await notify(tx, {
      to: [ownerOf(row)],
      kind: "form_returned",
      title: `Your ${FORM_WORDS[row.kind]} (${dayWords(row.day)}) came back from ${me.name} to fix`,
      body: note,
      link: "/me/leave",
      key: `form:${formId}:returned:${Date.now()}`,
    });
  });
}

/** Whoever filed a returned form sends it again, fixed: checked again, it waits as before. */
export async function resendForm(
  db: Database,
  me: Me,
  formId: number,
  input: FormInput,
): Promise<void> {
  if (me.viewedBy) throw new Refusal(403, "not_allowed", "Look-only: nothing changes.");
  const [row] = await rows<Held>(db, sql`select ${heldColumns} from hr_form where id = ${formId}`);
  if (!row) throw new Refusal(404, "not_found", "No such form.");
  if (!mayResend(me, row))
    throw new Refusal(row.status === "returned" ? 403 : 409, "not_allowed", "Only a returned form is sent again, by who filed it.");
  const form = await readForm(db, me, input, {
    kind: row.kind,
    personId: row.personId,
    headBy: row.headById,
    id: formId,
  });
  await db.transaction(async (tx) => {
    const [still] = await rows<{ status: string }>(tx, sql`select status from hr_form where id = ${formId} for update`);
    if (still?.status !== "returned") throw new Refusal(409, "invalid", "That form changed a moment ago.");
    const [taken] = await rows<{ id: number }>(
      tx,
      sql`select id::int as id from hr_form where person_id = ${form.personId} and kind = ${form.kind} and id <> ${formId}
        and day = ${form.day}::date and status in ('asked', 'approved', 'returned')`,
    );
    if (taken)
      throw new Refusal(409, "taken", `There is already a ${FORM_WORDS[form.kind]} form on ${dayWords(form.day)}.`, "day");
    await tx.execute(
      sql`update hr_form set status = 'asked', day = ${form.day}::date, from_time = ${form.fromTime}::time,
          to_time = ${form.toTime}::time, place = ${form.place}, reason = ${form.reason}, approver_id = ${form.approverId},
          ot_type = ${form.otType}, ot_minutes = ${form.otMinutes}, ot_night_minutes = ${form.otNight},
          details = ${form.details ? JSON.stringify(form.details) : null}::jsonb where id = ${formId}`,
    );
    await notify(tx, {
      to: form.approverId ? [form.approverId] : (await peopleIn(tx, ["hr"])).filter((one) => one !== me.id),
      kind: "form_request",
      title: `${me.name} sent ${FORM_WORDS[form.kind]} again, fixed: ${whenWords(form)}`,
      body: form.reason,
      link: "/hr/leave?of=forms&view=waiting",
      key: `form:${formId}:asked:${Date.now()}`,
    });
  });
}

/** A person's own forms (and the overtime they filed for others): this year's, and any ahead. */
export async function myForms(db: Database, me: Me): Promise<FormLine[]> {
  const today = todayManila();
  return toLines(
    me,
    await rows<Row>(
      db,
      sql`select ${columns(today)} ${fromForms}
        where (f.person_id = ${me.id} or f.head_by = ${me.id})
          and (extract(year from f.day) = ${Number(today.slice(0, 4))} or f.day >= ${today}::date)
        order by f.day desc, f.id desc`,
    ),
  );
}

/** Forms for HR (everyone), the CEO and Management (to read) and a team lead (their team). */
export async function formList(
  db: Database,
  me: Me,
  asked: { view?: string | null; month?: string | null },
): Promise<FormList> {
  const everyone = ATTENDANCE_ALL_ROLES.includes(me.role) || me.role === "management";
  if (!everyone && !LEAD_ROLES.includes(me.role))
    throw new Refusal(403, "not_allowed", "Forms are for HR, team leads and the CEO.");
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
      sql`select ${columns(today)} ${fromForms} where ${scope} ${inMonth} order by f.day desc, f.id desc limit 500`,
    ),
  );
  const view = asked.view ?? "waiting";
  const statuses = ["asked", "approved", "refused", "cancelled", "returned", "revoked"];
  const count = (status: string) => lines.filter((one) => one.status === status).length;
  return {
    lines:
      view === "waiting"
        ? lines.filter((one) => one.canDecide)
        : statuses.includes(view)
          ? lines.filter((one) => one.status === view)
          : lines,
    counts: {
      waiting: lines.filter((one) => one.canDecide).length,
      asked: count("asked"),
      approved: count("approved"),
      refused: count("refused"),
      cancelled: count("cancelled"),
      returned: count("returned"),
      revoked: count("revoked"),
    },
  };
}
