// Reads the TIMEKEEPING sheet of the biometric workbook HR hands in each cut-off (ported from
// Automated-Excel's lib/timekeepingParser.js, docs/HR-PLAN.md step 2). A pure function on the
// sheet's cells: no database, no file.
//
// The sheet, as HR's timekeeping workbook lays it out:
//   row 1        the totals' headings ("Regular Working Hours" …) after the day columns;
//   row 3        "Att. Time" in A, the dates in C ("2026-08-11~ 2026-08-25");
//   row 5 (or 4) the day of the month over each day column, from column A;
//   then two rows a person: "ID:" in A, the device ID in B or C, "Name:" then the name (K
//   usually); the next row one cell a day under the day numbers (punches "07:0216:01" jammed
//   together, or a code: OB, OFF, A, VL …) and the totals after.
// Any run of days the sheet covers is read (11th–25th, 26th–10th, a whole month): the dates come
// from row 3 and the day numbers, never from a fixed cut-off. The totals are not read: the CRM
// works the hours out from the days.
//
// Nothing is assumed (Automated-Excel learned it the hard way): a cell that can't be read, one
// punch with no second, an odd number of punches, a time out before the time in, and codes that
// don't say how the day counts (TRAINING, LEAVE, LWOP, anything else) all go to Needs review.

import type { Sheet } from "../reports/xlsx-read";

export const TIMEKEEPING_SHEET = "TIMEKEEPING";

/** Codes the sheet uses that say what the day was. */
export const DAY_CODES: Record<string, string> = {
  OB: "Official business",
  OFF: "Rest day",
  H: "Holiday",
  VL: "Vacation leave",
  SL: "Sick leave",
  ML: "Other leave",
  HDVL: "Half-day vacation leave",
  HDSL: "Half-day sick leave",
  A: "Absent",
};
/** Codes seen on the sheet that don't say how the day counts: HR says. */
export const REVIEW_CODES: Record<string, string> = {
  TRAINING: "Training",
  LEAVE: "Leave (which kind?)",
  LWOP: "Leave without pay",
};

export type SheetDayKind = "punch" | "code" | "empty" | "unreadable";

export type SheetDay = {
  /** "YYYY-MM-DD". */
  day: string;
  /** The sheet's column ("A"…). */
  column: string;
  /** The cell as written. */
  raw: string;
  kind: SheetDayKind;
  code: string | null;
  /** "HH:MM". */
  firstIn: string | null;
  lastOut: string | null;
  punches: number;
  /** Why HR must look at it, or null when it reads clean. */
  review: string | null;
};

export type SheetPerson = {
  /** The Excel row of the person's "ID:" line. */
  row: number;
  /** The device ID as written ("" when the sheet has none). */
  deviceId: string;
  name: string;
  /** An employee ID (2MG-228) when the sheet carries one ("Emp No:" on the ID line). */
  employeeCode: string | null;
  days: SheetDay[];
};

export type Timekeeping = {
  sheet: string;
  from: string;
  to: string;
  people: SheetPerson[];
  warnings: string[];
};

/** A device ID or employee ID as compared: capitals, no spaces. */
export const idKey = (value: string | null | undefined) =>
  (value ?? "").toUpperCase().replace(/\s+/g, "");

const cellText = (cells: string[] | undefined, column: number) => (cells?.[column] ?? "").trim();

/** 0 → "A", 26 → "AA". */
export function columnName(index: number): string {
  let out = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
  return out;
}

const pad = (n: number) => String(n).padStart(2, "0");
const clockOf = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
const plusDays = (day: string, days: number) => {
  const at = new Date(`${day}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
};
const realDay = (day: string) => {
  const at = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 10) === day;
};

/** What one day's cell says. */
export function readDayCell(raw: string): Omit<SheetDay, "day" | "column"> {
  const shown = raw.trim();
  const none = { raw: shown, code: null, firstIn: null, lastOut: null, punches: 0 };
  if (!shown) return { ...none, kind: "empty", review: null };
  // A time typed as an Excel time (a fraction of a day): one punch.
  if (/^0?\.\d+$/.test(shown)) {
    const minutes = Math.round(Number(shown) * 24 * 60);
    if (minutes > 0 && minutes < 24 * 60)
      return {
        ...none,
        kind: "punch",
        firstIn: clockOf(minutes),
        punches: 1,
        review: "Only one punch: no time out",
      };
  }
  // Punches jammed together ("07:0216:01"), or with spaces, dashes or new lines between them.
  const joined = shown.replace(/[\s\-–—,;/|]+/g, "");
  if (/^(?:\d{1,2}:\d{2})+$/.test(joined) && /\d:\d/.test(joined)) {
    const stamps = joined.match(/\d{2}:\d{2}/g) ?? [];
    if (!/^(?:\d{2}:\d{2})+$/.test(joined))
      return { ...none, kind: "unreadable", review: "A mistyped time (write 07:05, not 7:05)" };
    const minutes: number[] = [];
    for (const stamp of stamps) {
      const hour = Number(stamp.slice(0, 2));
      const minute = Number(stamp.slice(3, 5));
      if (hour > 23 || minute > 59)
        return { ...none, kind: "unreadable", review: `A mistyped time (${stamp})` };
      minutes.push(hour * 60 + minute);
    }
    const first = minutes[0] as number;
    const last = minutes[minutes.length - 1] as number;
    const punch = { ...none, kind: "punch" as const, firstIn: clockOf(first), punches: minutes.length };
    if (minutes.length === 1) return { ...punch, review: "Only one punch: no time out" };
    if (last <= first) return { ...punch, review: "The last punch isn't after the first" };
    return {
      ...punch,
      lastOut: clockOf(last),
      review: minutes.length % 2 === 1 ? `An odd number of punches (${minutes.length})` : null,
    };
  }
  const code = shown.toUpperCase().replace(/\s+/g, " ");
  if (code in DAY_CODES) return { ...none, kind: "code", code, review: null };
  if (code in REVIEW_CODES)
    return { ...none, kind: "code", code, review: `${REVIEW_CODES[code]}: say how the day counts` };
  return { ...none, kind: "unreadable", review: `Can't read "${shown.slice(0, 40)}"` };
}

/** The sheet itself: named TIMEKEEPING, or (older exports, named after the period) the one whose
 *  A3 reads "Att. Time". */
function timekeepingSheet(sheets: Sheet[]): Sheet {
  const named = sheets.find((one) => one.name.trim().toUpperCase() === TIMEKEEPING_SHEET);
  if (named) return named;
  const byLook = sheets.find((one) =>
    /^att\.?\s*time/i.test(cellText(one.rows.find((row) => row.number === 3)?.cells, 0)),
  );
  if (byLook) return byLook;
  throw new Error(
    `This workbook has no ${TIMEKEEPING_SHEET} sheet (it has ${sheets.map((one) => one.name).join(", ") || "no sheets"}). Hand in the timekeeping workbook, not the raw biometric export.`,
  );
}

const DAY_NUMBER = /^\d{1,2}$/;

/** The name after the "Name:" label (which column varies), else K, else L. */
function nameOn(cells: string[]): string {
  for (let at = 1; at < Math.min(cells.length, 30); at++) {
    if (!/^name\s*:?$/i.test(cellText(cells, at))) continue;
    for (let next = at + 1; next <= at + 4; next++) {
      const value = cellText(cells, next);
      if (value) return value;
    }
    return "";
  }
  return cellText(cells, 10) || cellText(cells, 11);
}

/** An employee ID after an "Emp No:" / "Employee ID:" label, when the sheet has one. */
function employeeCodeOn(cells: string[]): string | null {
  for (let at = 1; at < Math.min(cells.length, 40); at++) {
    if (!/^(emp(loyee)?\.?\s*(no|id|#|code|number)\.?|empno)\s*:?$/i.test(cellText(cells, at))) continue;
    for (let next = at + 1; next <= at + 4; next++) {
      const value = cellText(cells, next);
      if (value) return value;
    }
  }
  return null;
}

/** Reads the timekeeping sheet: its dates, its people and each day's cell. Throws (with words for
 *  HR) when the sheet or its dates can't be found. */
export function readTimekeeping(sheets: Sheet[]): Timekeeping {
  const sheet = timekeepingSheet(sheets);
  const byNumber = new Map(sheet.rows.map((row) => [row.number, row.cells]));
  const warnings: string[] = [];

  // The day numbers: row 5, or 4 in older exports (6 at a push), starting in column A.
  const dayRow = [5, 4, 6, 3, 7].find((number) => DAY_NUMBER.test(cellText(byNumber.get(number), 0)));
  if (dayRow === undefined)
    throw new Error("Can't find the day numbers (row 5, from column A) on the timekeeping sheet.");
  const dayCells = byNumber.get(dayRow) ?? [];
  const dayNumbers: number[] = [];
  for (let at = 0; at < 62 && DAY_NUMBER.test(cellText(dayCells, at)); at++)
    dayNumbers.push(Number(cellText(dayCells, at)));

  // The dates: "2026-08-11~ 2026-08-25" in C3, else anywhere in the first rows.
  const PERIOD = /(\d{4}-\d{2}-\d{2})\s*(?:~|to|–|-)\s*(\d{4}-\d{2}-\d{2})/i;
  let period = PERIOD.exec(cellText(byNumber.get(3), 2));
  for (let number = 1; !period && number < dayRow; number++)
    for (const value of byNumber.get(number) ?? []) {
      period = PERIOD.exec(value ?? "");
      if (period) break;
    }
  if (!period || !realDay(period[1] as string))
    throw new Error('Can\'t find the dates on the timekeeping sheet (C3 reads like "2026-08-11~ 2026-08-25").');
  const from = period[1] as string;

  // Each day column's date: the next date on or after the one before whose day of the month is
  // the column's number (so a run over a month's end reads right).
  const dates: (string | null)[] = [];
  let cursor = from;
  for (const [at, number] of dayNumbers.entries()) {
    let found: string | null = null;
    for (let step = 0; step < 31; step++) {
      const candidate = plusDays(cursor, step);
      if (Number(candidate.slice(8, 10)) === number) {
        found = candidate;
        break;
      }
    }
    if (!found) warnings.push(`Column ${columnName(at)}'s day (${number}) doesn't follow the dates: left out.`);
    else cursor = plusDays(found, 1);
    dates.push(found);
  }
  if (dates[0] !== from && dates[0])
    warnings.push(`The sheet says it starts on ${from} but its first day column is ${dates[0]}.`);
  const read = dates.filter((one): one is string => one !== null);
  if (!read.length) throw new Error("None of the day columns could be dated.");
  const to = read[read.length - 1] as string;
  const said = period[2] as string;
  if (said !== to)
    warnings.push(`The sheet says it ends on ${said}; its day columns end on ${to} (read as ${to}).`);

  const people: SheetPerson[] = [];
  for (const row of sheet.rows) {
    if (!/^id\s*:?$/i.test(cellText(row.cells, 0))) continue;
    // The device ID sits in B for some blocks and C for others (the sheet is put together from
    // more than one source).
    const deviceId = cellText(row.cells, 1) || cellText(row.cells, 2);
    const name = nameOn(row.cells);
    if (!deviceId && !name) {
      warnings.push(`Row ${row.number}: a person with neither a device ID nor a name: left out.`);
      continue;
    }
    if (!deviceId) warnings.push(`Row ${row.number}: ${name} has no device ID (B or C).`);
    const values = byNumber.get(row.number + 1) ?? [];
    const days: SheetDay[] = [];
    for (const [at, day] of dates.entries()) {
      if (!day) continue;
      days.push({ day, column: columnName(at), ...readDayCell(values[at] ?? "") });
    }
    people.push({ row: row.number, deviceId, name, employeeCode: employeeCodeOn(row.cells), days });
  }
  if (!people.length) warnings.push('No one found on the sheet ("ID:" in column A): has its layout changed?');
  const seen = new Map<string, number>();
  for (const person of people) {
    const key = idKey(person.deviceId);
    if (!key) continue;
    const before = seen.get(key);
    if (before !== undefined)
      warnings.push(`Device ID ${person.deviceId} is on rows ${before} and ${person.row}.`);
    else seen.set(key, person.row);
  }
  return { sheet: sheet.name, from, to, people, warnings };
}
