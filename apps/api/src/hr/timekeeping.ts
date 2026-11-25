// The biometric timekeeping workbook in the CRM (docs/HR-PLAN.md, step 2), in place of
// Automated-Excel's /api/payroll-dtr/preview-timekeeping and /from-timekeeping. HR hands in the
// TIMEKEEPING sheet each cut-off (any run of days): first a preview (nothing kept), then the import.
//
// Who a sheet row is: the device ID HR set before ("this is X", kept for next time), else the
// employee ID when the sheet carries one. A name that looks like someone's is only a suggestion HR
// confirms: a row is never imported on a name alone. Rows matched to nobody are listed and left out.
//
// The import keeps each person's days beside the CRM's attendance and never writes over it (sign-in
// times, HR's fixes, approved requests stay). Importing the same days again makes the newer rows
// current and keeps the older ones (superseded). Where the two disagree (over 15 minutes, or one has
// the day and the other hasn't), or the sheet's cell can't be read, the day is on Needs review: HR
// uses the biometric times for it (the day is set, marked biometric, and HR's trail says so) or
// dismisses the flag with a note (kept). HR and the Admin do the work; the CEO reads.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { bytesOf, keepFile } from "../files/store";
import { allow, Refusal } from "../http";
import { todayManila } from "../inventory/rules";
import { clean, iso, type Runner } from "../inventory/service";
import { readXlsxBytes } from "../reports/xlsx-read";
import type {
  AttendanceDay,
  BiometricDay,
  BiometricKind,
  Me,
  TimekeepingPage,
  TimekeepingPreview,
} from "../types";
import { attendanceDays, checkDay, setDay } from "./attendance";
import { hrEvent } from "./events";
import { HR_ROLES, HR_WRITE_ROLES } from "./people";
import { DAY_CODES, idKey, readTimekeeping, REVIEW_CODES, type SheetPerson, type Timekeeping } from "./timekeeping-sheet";
import { manilaMoment } from "./work-time";

export const TIMEKEEPING_MAX_BYTES = 10 * 1024 * 1024;
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
/** Minutes the biometrics and the CRM may differ before a day is flagged. */
export const DISAGREE_MINUTES = 15;
/** Codes that sit well with a time in on the CRM (out on business, half a day on leave). */
const QUIET_CODES = new Set(["OB", "HDVL", "HDSL"]);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export type TimekeepingFile = { name: string; mime: string; bytes: Uint8Array };

// ------------------------------------------------------------------ names (a suggestion only)

const TITLES = /^(mr|ms|mrs|miss|dr|engr|atty|sir|maam|ma'am)\.?\s+/i;

/** A name's words as compared: no titles, accents, punctuation or initials. */
export function nameWords(name: string): string[] {
  return name
    .trim()
    .replace(TITLES, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1);
}

/** Whether two words are one letter apart (Romel, Rommel). */
function oneLetterOff(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let previous = Array.from({ length: b.length + 1 }, (_, at) => at);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++)
      current[j] = Math.min(
        (previous[j] as number) + 1,
        (current[j - 1] as number) + 1,
        (previous[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    previous = current;
  }
  return previous[b.length] === 1;
}

/** Whether a sheet's name looks like a person's: the same words in any order ("Dela Cruz, Juan"),
 *  a middle name left out, or one word one letter off. */
export function looksLike(sheetName: string, personName: string): boolean {
  const a = new Set(nameWords(sheetName));
  const b = new Set(nameWords(personName));
  if (!a.size || !b.size) return false;
  const onlyA = [...a].filter((word) => !b.has(word));
  const onlyB = [...b].filter((word) => !a.has(word));
  if (!onlyA.length && !onlyB.length) return true;
  const shorter = a.size <= b.size ? onlyA : onlyB;
  if (Math.min(a.size, b.size) >= 2 && shorter.length === 0) return true;
  return (
    a.size === b.size &&
    a.size >= 2 &&
    onlyA.length === 1 &&
    onlyB.length === 1 &&
    (onlyA[0] as string).length >= 4 &&
    oneLetterOff(onlyA[0] as string, onlyB[0] as string)
  );
}

// ------------------------------------------------------------------ reading and matching

type Person = { id: number; name: string; employeeCode: string | null };

/** Everyone at work who may be on the sheet (not the Admin's login). */
async function peopleAtWork(db: Runner): Promise<Person[]> {
  return rows<Person>(
    db,
    sql`select p.id::int as id, p.name, e.employee_code as "employeeCode"
      from person p join employee e on e.person_id = p.id
      where p.active and p.role <> 'admin' order by p.name`,
  );
}

function readWorkbook(file: TimekeepingFile | null): Timekeeping {
  if (!file) throw new Refusal(400, "invalid", "Attach the timekeeping workbook (.xlsx).", "file");
  if (file.bytes.byteLength === 0 || file.bytes.byteLength > TIMEKEEPING_MAX_BYTES)
    throw new Refusal(400, "invalid", "That file is empty or over 10 MB.", "file");
  if (!/\.xlsx$/i.test(file.name) && file.mime !== XLSX_MIME)
    throw new Refusal(400, "invalid", "Attach the workbook as .xlsx (Excel), not .xls or .csv.", "file");
  try {
    return readTimekeeping(readXlsxBytes(file.bytes));
  } catch (error) {
    throw new Refusal(400, "invalid", (error as Error).message || "Can't read that workbook.", "file");
  }
}

type Matched = {
  person: SheetPerson;
  match: { how: "device" | "employee_id"; personId: number; name: string } | null;
  suggestion: { personId: number; name: string } | null;
  problem: string | null;
};

/** Who each sheet row is: by device ID, else employee ID; else a name suggestion (not a match). */
async function matchRows(db: Runner, sheet: Timekeeping, people: Person[]): Promise<Matched[]> {
  const devices = await rows<{ deviceId: string; personId: number }>(
    db,
    sql`select device_id as "deviceId", person_id::int as "personId" from timekeeping_device where archived_at is null`,
  );
  const byDevice = new Map(devices.map((one) => [one.deviceId, one.personId]));
  const byId = new Map(people.map((one) => [one.id, one]));
  const byCode = new Map(
    people.filter((one) => one.employeeCode).map((one) => [idKey(one.employeeCode), one]),
  );
  const out: Matched[] = sheet.people.map((person) => {
    const device = idKey(person.deviceId);
    const mapped = device ? byId.get(byDevice.get(device) ?? 0) : undefined;
    if (mapped) return { person, match: { how: "device", personId: mapped.id, name: mapped.name }, suggestion: null, problem: null };
    const coded = byCode.get(idKey(person.employeeCode)) ?? (device ? byCode.get(device) : undefined);
    if (coded)
      return { person, match: { how: "employee_id", personId: coded.id, name: coded.name }, suggestion: null, problem: null };
    const alike = person.name ? people.filter((one) => looksLike(person.name, one.name)) : [];
    const suggestion = alike.length === 1 ? { personId: (alike[0] as Person).id, name: (alike[0] as Person).name } : null;
    return {
      person,
      match: null,
      suggestion,
      problem: !device && suggestion ? "No device ID on the sheet: give the row one, or put the employee ID on it" : null,
    };
  });
  // Two rows for one person can't both be theirs.
  const rowsOf = new Map<number, number[]>();
  for (const one of out)
    if (one.match) rowsOf.set(one.match.personId, [...(rowsOf.get(one.match.personId) ?? []), one.person.row]);
  for (const one of out) {
    const twice = one.match ? (rowsOf.get(one.match.personId) ?? []) : [];
    if (twice.length > 1) one.problem = `${one.match?.name} is on rows ${twice.join(" and ")}: set the device IDs right`;
  }
  return out;
}

const importable = (one: Matched) => one.match !== null && one.problem === null;

/** HR reads a workbook: what would be imported, nothing kept. */
export async function previewTimekeeping(
  db: Database,
  me: Me,
  file: TimekeepingFile | null,
): Promise<TimekeepingPreview> {
  allow(me, HR_WRITE_ROLES, "import the timekeeping workbook");
  const sheet = readWorkbook(file);
  const people = await peopleAtWork(db);
  const matched = await matchRows(db, sheet, people);
  const lines = matched.map((one) => ({
    row: one.person.row,
    deviceId: one.person.deviceId,
    name: one.person.name,
    employeeCode: one.person.employeeCode,
    match: one.match,
    suggestion: one.suggestion,
    problem: one.problem,
    days: one.person.days,
    counts: {
      punched: one.person.days.filter((day) => day.kind === "punch").length,
      review: one.person.days.filter((day) => day.review).length,
    },
  }));
  const going = lines.filter((_, at) => importable(matched[at] as Matched));
  return {
    sheet: sheet.sheet,
    from: sheet.from,
    to: sheet.to,
    fileName: (file as TimekeepingFile).name,
    warnings: sheet.warnings,
    people: lines,
    counts: {
      people: lines.length,
      matched: going.length,
      suggested: lines.filter((one) => !one.match && one.suggestion).length,
      unmatched: lines.length - going.length,
      days: going.reduce((sum, one) => sum + one.days.length, 0),
      review: going.reduce((sum, one) => sum + one.counts.review, 0),
    },
    choices: people,
  };
}

/** HR imports the workbook: the matched rows' days are kept (the older import's of the same days
 *  become superseded, kept); rows matched to nobody are left out. The CRM's attendance is not touched. */
export async function importTimekeeping(
  db: Database,
  me: Me,
  file: TimekeepingFile | null,
): Promise<{ id: number; people: number; days: number; needsReview: number; skipped: number }> {
  allow(me, HR_WRITE_ROLES, "import the timekeeping workbook");
  const sheet = readWorkbook(file);
  const incoming = file as TimekeepingFile;
  const today = todayManila();
  if (sheet.from > today) throw new Refusal(400, "invalid", "That sheet's days haven't come yet.", "file");
  const matched = (await matchRows(db, sheet, await peopleAtWork(db))).filter(importable);
  if (!matched.length)
    throw new Refusal(
      400,
      "invalid",
      "Nobody on the sheet is matched yet: confirm who they are first (This is …).",
      "file",
    );
  const lines = matched.flatMap((one) =>
    one.person.days
      // A day still to come isn't kept (a sheet made mid cut-off).
      .filter((day) => day.day <= today)
      .map((day) => ({ ...day, personId: one.match?.personId as number, deviceId: idKey(one.person.deviceId) })),
  );
  const needsReview = lines.filter((one) => one.review).length;
  const skipped = sheet.people.length - matched.length;
  // The bytes are kept before the transaction (a bucket can't roll back).
  const kept = await keepFile("hr-timekeeping", {
    name: incoming.name.trim().slice(0, 120) || "timekeeping.xlsx",
    mime: XLSX_MIME,
    bytes: incoming.bytes,
  });
  return db.transaction(async (tx) => {
    // One import at a time: two at once would both try to be the current one.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('timekeeping-import'))`);
    const [made] = await rows<{ id: number }>(
      tx,
      sql`insert into timekeeping_import (from_day, to_day, sheet, file_name, file_mime, file_size, file_data, file_key,
          people, days, needs_review, skipped, made_by)
        values (${sheet.from}::date, ${sheet.to}::date, ${sheet.sheet}, ${kept.name}, ${kept.mime}, ${kept.size},
          ${kept.data}, ${kept.key}, ${matched.length}, ${lines.length}, ${needsReview}, ${skipped}, ${me.id})
        returning id::int as id`,
    );
    const id = made?.id as number;
    const people = sql.join(
      matched.map((one) => sql`${one.match?.personId}`),
      sql`, `,
    );
    const days = [...new Set(lines.map((one) => one.day))];
    if (days.length)
      await tx.execute(
        sql`update biometric_day set superseded_by = ${id}
          where superseded_by is null and person_id in (${people})
            and day in (${sql.join(
              days.map((day) => sql`${day}::date`),
              sql`, `,
            )})`,
      );
    for (let at = 0; at < lines.length; at += 300) {
      const chunk = lines.slice(at, at + 300);
      await tx.execute(
        sql`insert into biometric_day (import_id, person_id, day, device_id, sheet_column, raw, kind, code,
            first_in, last_out, punches, review_reason)
          values ${sql.join(
            chunk.map(
              (one) =>
                sql`(${id}, ${one.personId}, ${one.day}::date, ${one.deviceId}, ${one.column}, ${one.raw}, ${one.kind},
                  ${one.code}, ${one.firstIn}::time, ${one.lastOut}::time, ${one.punches}, ${one.review})`,
            ),
            sql`, `,
          )}`,
      );
    }
    // A flag HR answered stays answered when the cell is the same as before.
    await tx.execute(
      sql`update biometric_day n set resolution = o.resolution, resolved_by = o.resolved_by,
          resolved_at = o.resolved_at, resolved_note = o.resolved_note
        from biometric_day o
        where n.import_id = ${id} and o.superseded_by = ${id} and o.person_id = n.person_id
          and o.day = n.day and o.raw = n.raw and o.resolution is not null`,
    );
    return { id, people: matched.length, days: lines.length, needsReview, skipped };
  });
}

// ------------------------------------------------------------------ device IDs (HR keeps them)

/** HR says whose a device ID is ("This is …"): kept for every import after. A device ID given to
 *  someone else archives the old mapping (never deleted). */
export async function setDevice(
  db: Database,
  me: Me,
  input: { deviceId: string; personId: number; nameOnSheet?: string | null },
): Promise<{ id: number }> {
  allow(me, HR_WRITE_ROLES, "match the timekeeping sheet's people");
  const deviceId = idKey(input.deviceId);
  if (!deviceId || deviceId.length > 40)
    throw new Refusal(400, "invalid", "The row needs its device ID.", "deviceId");
  const [person] = await rows<{ id: number; name: string }>(
    db,
    sql`select p.id::int as id, p.name from person p join employee e on e.person_id = p.id
      where p.id = ${input.personId} and p.role <> 'admin'`,
  );
  if (!person) throw new Refusal(404, "not_found", "No such person.", "personId");
  const nameOnSheet = clean(input.nameOnSheet)?.slice(0, 120) ?? null;
  return db.transaction(async (tx) => {
    const [current] = await rows<{ id: number; personId: number }>(
      tx,
      sql`select id::int as id, person_id::int as "personId" from timekeeping_device
        where device_id = ${deviceId} and archived_at is null for update`,
    );
    if (current?.personId === person.id) return { id: current.id };
    if (current) {
      await tx.execute(
        sql`update timekeeping_device set archived_at = now(), archived_by = ${me.id} where id = ${current.id}`,
      );
      await hrEvent(tx, current.personId, me.id, "attendance", `Biometric device ID ${deviceId} given to ${person.name}`);
    }
    const [made] = await rows<{ id: number }>(
      tx,
      sql`insert into timekeeping_device (device_id, person_id, name_on_sheet, set_by)
        values (${deviceId}, ${person.id}, ${nameOnSheet}, ${me.id}) returning id::int as id`,
    );
    await hrEvent(
      tx,
      person.id,
      me.id,
      "attendance",
      `Biometric device ID ${deviceId} is theirs${nameOnSheet ? ` (on the sheet as ${nameOnSheet})` : ""}`,
    );
    return { id: made?.id as number };
  });
}

/** HR takes a device ID off a person (a wrong match): archived, kept. */
export async function archiveDevice(db: Database, me: Me, id: number): Promise<void> {
  allow(me, HR_WRITE_ROLES, "match the timekeeping sheet's people");
  await db.transaction(async (tx) => {
    const [gone] = await rows<{ personId: number; deviceId: string }>(
      tx,
      sql`update timekeeping_device set archived_at = now(), archived_by = ${me.id}
        where id = ${id} and archived_at is null returning person_id::int as "personId", device_id as "deviceId"`,
    );
    if (!gone) throw new Refusal(404, "not_found", "That device ID isn't matched to anyone (taken off already?).");
    await hrEvent(tx, gone.personId, me.id, "attendance", `Biometric device ID ${gone.deviceId} taken off`);
  });
}

// ------------------------------------------------------------------ the days, against the CRM's

type DayRow = {
  id: number;
  importId: number;
  personId: number;
  day: string;
  column: string;
  raw: string;
  kind: BiometricKind;
  code: string | null;
  firstIn: string | null;
  lastOut: string | null;
  punches: number;
  review: string | null;
  resolution: "applied" | "dismissed" | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolvedNote: string | null;
};

const dayColumns = sql`b.id::int as id, b.import_id::int as "importId", b.person_id::int as "personId",
  to_char(b.day, 'YYYY-MM-DD') as day, b.sheet_column as "column", b.raw, b.kind, b.code,
  to_char(b.first_in, 'HH24:MI') as "firstIn", to_char(b.last_out, 'HH24:MI') as "lastOut", b.punches::int as punches,
  b.review_reason as review, b.resolution, r.name as "resolvedBy", ${iso("b.resolved_at")} as "resolvedAt",
  b.resolved_note as "resolvedNote"`;

/** The current biometric days of some people (or everyone) between two days. */
async function currentDays(db: Runner, from: string, to: string, personId?: number): Promise<DayRow[]> {
  return rows<DayRow>(
    db,
    sql`select ${dayColumns} from biometric_day b left join person r on r.id = b.resolved_by
      where b.superseded_by is null and b.day between ${from}::date and ${to}::date
        ${personId ? sql`and b.person_id = ${personId}` : sql``}
      order by b.day, b.person_id`,
  );
}

const manilaClock = (moment: string) =>
  new Date(Date.parse(moment) + 8 * 3_600_000).toISOString().slice(11, 16);
const minutesWords = (minutes: number) =>
  minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;

/** Where the biometric day and the CRM's day disagree, in words, or null. */
export function flagOf(
  bio: Pick<DayRow, "day" | "kind" | "code" | "raw" | "firstIn" | "lastOut">,
  crm: Pick<AttendanceDay, "timeIn" | "timeOut" | "working" | "inFrom"> | undefined,
  today = todayManila(),
): string | null {
  if (bio.day > today) return null;
  const crmIn = crm?.timeIn ?? null;
  if (bio.kind === "punch" && bio.firstIn) {
    if (!crm || !crmIn) return "On the biometrics, not on the CRM";
    const apart = (clock: string, moment: string) =>
      Math.round(Math.abs(manilaMoment(bio.day, clock) - Date.parse(moment)) / 60_000);
    const inApart = apart(bio.firstIn, crmIn);
    if (inApart > DISAGREE_MINUTES)
      return `Time in differs by ${minutesWords(inApart)} (CRM ${manilaClock(crmIn)})`;
    if (bio.lastOut && crm.timeOut && !crm.working) {
      const outApart = apart(bio.lastOut, crm.timeOut);
      if (outApart > DISAGREE_MINUTES)
        return `Time out differs by ${minutesWords(outApart)} (CRM ${manilaClock(crm.timeOut)})`;
    }
    return null;
  }
  if (!crmIn || (bio.code && QUIET_CODES.has(bio.code))) return null;
  return bio.kind === "empty"
    ? "On the CRM, not on the biometrics"
    : `On the CRM, but the sheet says ${bio.code ?? `"${bio.raw}"`}`;
}

function toBiometric(row: DayRow, crm: AttendanceDay | undefined, today: string): BiometricDay {
  return {
    id: row.id,
    importId: row.importId,
    day: row.day,
    column: row.column,
    raw: row.raw,
    kind: row.kind,
    code: row.code,
    codeWords: row.code ? (DAY_CODES[row.code] ?? REVIEW_CODES[row.code] ?? null) : null,
    firstIn: row.firstIn,
    lastOut: row.lastOut,
    punches: row.punches,
    review: row.review,
    flag: flagOf(row, crm, today),
    resolution:
      row.resolution && row.resolvedBy && row.resolvedAt
        ? { kind: row.resolution, by: row.resolvedBy, at: row.resolvedAt, note: row.resolvedNote }
        : null,
  };
}

/** Whether someone reads the biometric days: HR, the CEO and the Admin, never while someone else
 *  looks as them (bar the CEO and the Admin, who read them anyway). */
export const seesBiometric = (me: Me) =>
  HR_ROLES.includes(me.role) &&
  (!me.viewedBy || me.viewedBy.role === "ceo" || me.viewedBy.role === "admin");

/** A person's month of biometric days beside their CRM days (their attendance month). */
export async function biometricMonth(
  db: Runner,
  personId: number,
  from: string,
  to: string,
  days: AttendanceDay[],
): Promise<BiometricDay[]> {
  const today = todayManila();
  const crm = new Map(days.map((one) => [one.day, one]));
  return (await currentDays(db, from, to, personId)).map((row) => toBiometric(row, crm.get(row.day), today));
}

/** HR's Timekeeping page: the imports, the device IDs, and Needs review across everyone for the
 *  latest import's days (or the days asked). */
export async function timekeepingPage(
  db: Database,
  me: Me,
  asked: { from?: string | null; to?: string | null },
): Promise<TimekeepingPage> {
  allow(me, HR_ROLES, "see the timekeeping imports");
  const [imports, devices] = await Promise.all([
    rows<TimekeepingPage["imports"][number]>(
      db,
      sql`select i.id::int as id, to_char(i.from_day, 'YYYY-MM-DD') as "from", to_char(i.to_day, 'YYYY-MM-DD') as "to",
          i.sheet, i.file_name as "fileName", i.people::int as people, i.days::int as days,
          i.needs_review::int as "needsReview", i.skipped::int as skipped, m.name as "madeBy", ${iso("i.made_at")} as "madeAt",
          not exists (select 1 from biometric_day b where b.import_id = i.id and b.superseded_by is null) as superseded
        from timekeeping_import i join person m on m.id = i.made_by order by i.id desc limit 30`,
    ),
    rows<{ id: number; deviceId: string; personId: number; personName: string; nameOnSheet: string | null; setBy: string; setAt: string }>(
      db,
      sql`select d.id::int as id, d.device_id as "deviceId", d.person_id::int as "personId", p.name as "personName",
          d.name_on_sheet as "nameOnSheet", s.name as "setBy", ${iso("d.set_at")} as "setAt"
        from timekeeping_device d join person p on p.id = d.person_id join person s on s.id = d.set_by
        where d.archived_at is null order by p.name`,
    ),
  ]);
  const latest = imports.find((one) => !one.superseded) ?? imports[0];
  const from = asked.from && DAY.test(asked.from) ? asked.from : (latest?.from ?? null);
  const to = asked.to && DAY.test(asked.to) && from && asked.to >= from ? asked.to : (latest?.to ?? null);
  let review: TimekeepingPage["review"] = [];
  if (from && to && to >= from) {
    const found = await currentDays(db, from, to);
    const ids = [...new Set(found.map((one) => one.personId))];
    const people = ids.length
      ? await rows<{ id: number; name: string; hiredOn: string | null }>(
          db,
          sql`select p.id::int as id, p.name, to_char(e.hire_date, 'YYYY-MM-DD') as "hiredOn"
            from person p left join employee e on e.person_id = p.id
            where p.id in (${sql.join(
              ids.map((id) => sql`${id}`),
              sql`, `,
            )})`,
        )
      : [];
    const names = new Map(people.map((one) => [one.id, one.name]));
    const crm = await attendanceDays(db, people, from, to);
    const today = todayManila();
    for (const row of found) {
      const day = crm.get(row.personId)?.days.find((one) => one.day === row.day);
      const biometric = toBiometric(row, day, today);
      if (biometric.resolution || (!biometric.review && !biometric.flag)) continue;
      review.push({
        person: { id: row.personId, name: names.get(row.personId) ?? "" },
        biometric,
        crm: day?.timeIn ? { timeIn: day.timeIn, timeOut: day.timeOut, inFrom: day.inFrom } : null,
      });
    }
    review = review.sort((a, b) => a.person.name.localeCompare(b.person.name) || a.biometric.day.localeCompare(b.biometric.day));
  }
  return {
    imports,
    devices: devices.map((one) => ({
      id: one.id,
      deviceId: one.deviceId,
      person: { id: one.personId, name: one.personName },
      nameOnSheet: one.nameOnSheet,
      setBy: one.setBy,
      setAt: one.setAt,
    })),
    range: from && to ? { from, to } : null,
    review,
    can: { upload: HR_WRITE_ROLES.includes(me.role) },
  };
}

type HeldDay = {
  personId: number;
  day: string;
  kind: BiometricKind;
  firstIn: string | null;
  lastOut: string | null;
  raw: string;
  superseded: boolean;
  resolution: string | null;
  from: string;
  to: string;
};

async function heldDay(tx: Runner, dayId: number): Promise<HeldDay> {
  const [row] = await rows<HeldDay>(
    tx,
    sql`select b.person_id::int as "personId", to_char(b.day, 'YYYY-MM-DD') as day, b.kind,
        to_char(b.first_in, 'HH24:MI') as "firstIn", to_char(b.last_out, 'HH24:MI') as "lastOut", b.raw,
        b.superseded_by is not null as superseded, b.resolution,
        to_char(i.from_day, 'YYYY-MM-DD') as "from", to_char(i.to_day, 'YYYY-MM-DD') as "to"
      from biometric_day b join timekeeping_import i on i.id = b.import_id where b.id = ${dayId} for update of b`,
  );
  if (!row) throw new Refusal(404, "not_found", "No such biometric day.");
  if (row.superseded) throw new Refusal(409, "invalid", "A newer import has this day: use that one.");
  if (row.resolution)
    throw new Refusal(409, "invalid", `That day was ${row.resolution === "applied" ? "set from the biometrics" : "dismissed"} already.`);
  return row;
}

/** HR uses the biometric times for a day: the CRM's day is set to them, marked biometric, with a
 *  note saying which import; HR's trail says so. */
export async function useBiometric(
  db: Database,
  me: Me,
  dayId: number,
  input: { note?: string | null },
): Promise<void> {
  allow(me, HR_WRITE_ROLES, "use the biometric times");
  const extra = clean(input.note)?.slice(0, 200) ?? null;
  await db.transaction(async (tx) => {
    const row = await heldDay(tx, dayId);
    if (row.kind !== "punch" || !row.firstIn || !row.lastOut)
      throw new Refusal(
        409,
        "invalid",
        "The sheet hasn't both a time in and a time out that day: put the day right by hand.",
      );
    checkDay({ day: row.day, timeIn: row.firstIn, timeOut: row.lastOut });
    const note = `From the biometric import of ${row.from} to ${row.to} (sheet: ${row.raw})${extra ? `: ${extra}` : ""}`;
    await setDay(tx, row.personId, me.id, { day: row.day, timeIn: row.firstIn, timeOut: row.lastOut, note: note.slice(0, 300) }, "biometric");
    await tx.execute(
      sql`update biometric_day set resolution = 'applied', resolved_by = ${me.id}, resolved_at = now(),
          resolved_note = ${extra} where id = ${dayId}`,
    );
    await hrEvent(
      tx,
      row.personId,
      me.id,
      "attendance",
      `Attendance of ${row.day} set from the biometrics: ${row.firstIn}–${row.lastOut}`,
    );
  });
}

/** HR dismisses a day's flag, saying why (kept on the day). */
export async function dismissBiometric(
  db: Database,
  me: Me,
  dayId: number,
  input: { note?: string | null },
): Promise<void> {
  allow(me, HR_WRITE_ROLES, "dismiss a biometric flag");
  const note = clean(input.note)?.slice(0, 300);
  if (!note) throw new Refusal(400, "invalid", "Say why the flag is dismissed.", "note");
  await db.transaction(async (tx) => {
    await heldDay(tx, dayId);
    await tx.execute(
      sql`update biometric_day set resolution = 'dismissed', resolved_by = ${me.id}, resolved_at = now(),
          resolved_note = ${note} where id = ${dayId}`,
    );
  });
}

/** The workbook an import was made from. */
export async function importFile(db: Database, me: Me, id: number): Promise<TimekeepingFile> {
  allow(me, HR_ROLES, "see the timekeeping imports");
  const [found] = await rows<{ name: string; mime: string; data: Uint8Array | null; key: string | null }>(
    db,
    sql`select file_name as name, file_mime as mime, file_data as data, file_key as key from timekeeping_import where id = ${id}`,
  );
  if (!found) throw new Refusal(404, "not_found", "No such import.");
  return { name: found.name, mime: found.mime, bytes: await bytesOf(found) };
}
