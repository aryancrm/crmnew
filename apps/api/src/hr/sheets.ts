// HR's files in and out (docs/HR-PLAN.md, "Documents, imports and reports", 26 Nov), the way ovio
// does it: one list of columns per sheet, used both to export and to import, so HR can download
// the sheet, put it right in Excel and bring it back.
//
// An import goes: upload (.xlsx or .csv; read, never kept) → match each column to a heading (the
// CRM guesses from the headings) → a test run that changes nothing and says, row by row, what would
// change and what is wrong → save: the rows that pass are saved, the others listed with why.
//
// - People (the masterlist): updates the records of people already in the CRM, found by employee
//   ID and login email (both, when the row has both, must be the same person). An empty cell leaves
//   that detail as it is. A new person isn't added from a sheet: they need a seat and a login
//   (New joiner). Every change goes through the same checks and trail as HR's Edit record.
// - Leave balances: the days of vacation and sick leave left for a year, as the old system had
//   them; the CRM adds one adjustment line per kind to reach it (with the reason, in the trail).
// - Holidays: national (no province) or local (a province, and a town or the whole province).
//
// Who: HR and the Admin import; HR, the CEO and the Admin export.

import { sql } from "drizzle-orm";
import { COMPANIES, COMPANY_CODES, type CompanyCode } from "../companies";
import { type Database, rows } from "../db/index";
import { allow, Refusal } from "../http";
import { todayManila } from "../inventory/rules";
import type { Runner } from "../inventory/service";
import { type Cell, workbook } from "../reports/xlsx";
import { readXlsxBytes } from "../reports/xlsx-read";
import type { HrImportKind, HrImportRead, HrImportResult, HrImportRow, HrRecordInput, Me } from "../types";
import { addCredit } from "./credits";
import { addHoliday } from "./holidays";
import { balancesOf, classificationOf } from "./leave";
import { HR_ROLES, HR_WRITE_ROLES, updateRecord } from "./people";

/** One column of a sheet: its heading, other headings it is known by, and whether an import reads it. */
type Column = {
  key: string;
  label: string;
  aliases?: string[];
  /** Exported only (the status, the team): an import never changes it. */
  readOnly?: boolean;
  /** A line under the heading in the template, saying how to fill it. */
  note?: string;
};

export const IMPORT_FILE_MAX = 10 * 1024 * 1024;
const ROWS_MAX = 2000;

// ------------------------------------------------------------------ reading cells

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** A day from a cell: 2026-03-01, 3/1/2026 (month first, as Excel in the Philippines writes it),
 *  or Excel's day number (45717). Null when it isn't one. */
export function dayOf(text: string): string | null {
  const value = text.trim();
  if (DAY.test(value)) return value;
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (slash) return `${slash[3]}-${slash[1]?.padStart(2, "0")}-${slash[2]?.padStart(2, "0")}`;
  if (/^\d{5}(\.\d+)?$/.test(value)) {
    const at = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(value)) * 86_400_000);
    return at.toISOString().slice(0, 10);
  }
  return null;
}
/** Pesos from a cell (25,000.00 or ₱25000) as whole centavos; null when it isn't an amount. */
export function centavosOf(text: string): number | null {
  const value = text.replace(/[₱,\s]|PHP/gi, "");
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return null;
  return Math.round(Number(value) * 100);
}
const pesosWords = (centavos: number | null) => (centavos === null ? "" : (centavos / 100).toFixed(2));
const companyOf = (text: string): CompanyCode | null => {
  const value = text.trim().toLowerCase();
  return (
    COMPANY_CODES.find(
      (code) => code === value || COMPANIES[code].short.toLowerCase() === value || COMPANIES[code].name.toLowerCase() === value,
    ) ?? null
  );
};
const CLASS_WORDS: Record<string, string> = {
  regular: "Regular",
  probationary: "Probationary",
  part_time: "Part-time",
  intern: "Intern",
};
const classificationFrom = (text: string) =>
  Object.entries(CLASS_WORDS).find(
    ([key, words]) => key === text.trim().toLowerCase() || words.toLowerCase() === text.trim().toLowerCase().replace(/ /g, "-"),
  )?.[0] ?? null;

/** A heading made plain to compare: "Employee ID #" → "employeeid". */
const plain = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");

// ------------------------------------------------------------------ the people sheet

const PEOPLE: Column[] = [
  { key: "employeeCode", label: "Employee ID", aliases: ["Employee No", "Employee Number", "ID No"], note: "Finds the person (with the login email)" },
  { key: "loginEmail", label: "Login email", aliases: ["Email", "Work email", "Company email"], note: "Finds the person; never changed here" },
  { key: "name", label: "Name", aliases: ["Full name", "Employee name"], readOnly: true },
  { key: "company", label: "Company", note: "2MG or GPI" },
  { key: "classification", label: "Employment", aliases: ["Classification", "Employment status", "Status of employment"], note: "Regular, Probationary, Part-time or Intern" },
  { key: "position", label: "Position", aliases: ["Job title", "Designation"], note: "As on HR's list of positions" },
  { key: "department", label: "Department" },
  { key: "hireDate", label: "Hire date", aliases: ["Date hired", "Start date"], note: "2026-03-01 or 3/1/2026" },
  { key: "regularizedOn", label: "Regularized on", aliases: ["Date regularized", "Regularization date"] },
  { key: "mobile", label: "Mobile", aliases: ["Mobile number", "Contact number", "Phone"] },
  { key: "personalEmail", label: "Personal email" },
  { key: "birthDate", label: "Birth date", aliases: ["Birthday", "Date of birth"] },
  { key: "address", label: "Address", aliases: ["Home address"] },
  { key: "emergencyName", label: "Emergency contact", aliases: ["Emergency contact name"] },
  { key: "emergencyPhone", label: "Emergency phone", aliases: ["Emergency contact number"] },
  { key: "emergencyRelation", label: "Emergency relation", aliases: ["Relationship"] },
  { key: "salary", label: "Monthly salary", aliases: ["Basic salary", "Monthly basic", "Salary"], note: "Pesos, like 25,000.00" },
  { key: "allowance", label: "Monthly allowance", aliases: ["Allowance"], note: "Pesos" },
  { key: "bankName", label: "Bank" },
  { key: "bankAccount", label: "Bank account", aliases: ["Account number", "Account no"] },
  { key: "sss", label: "SSS", aliases: ["SSS number", "SSS no"] },
  { key: "philhealth", label: "PhilHealth", aliases: ["PhilHealth number", "PhilHealth no"] },
  { key: "pagibig", label: "Pag-IBIG", aliases: ["HDMF", "Pag-IBIG number", "Pag-IBIG no"] },
  { key: "tin", label: "TIN", aliases: ["TIN number", "Tax ID"] },
  { key: "status", label: "Status", readOnly: true },
  { key: "leftOn", label: "Left on", readOnly: true },
  { key: "team", label: "Team", readOnly: true },
];
/** The record's fields an import may change, and how each reads from a cell. */
const PERSON_FIELDS = PEOPLE.filter((one) => !one.readOnly && one.key !== "loginEmail").map((one) => one.key);
const DATE_KEYS = new Set(["hireDate", "regularizedOn", "birthDate"]);
const MONEY_KEYS = new Set(["salary", "allowance"]);

type PersonNow = Record<string, string | number | null> & { personId: number; name: string; email: string | null; company: CompanyCode };

const peopleNow = (db: Runner) =>
  rows<PersonNow>(
    db,
    sql`select p.id::int as "personId", p.name, lower(p.email) as email, e.company, e.employee_code as "employeeCode",
        e.classification, e.position, e.department, to_char(e.hire_date, 'YYYY-MM-DD') as "hireDate",
        to_char(e.regularized_on, 'YYYY-MM-DD') as "regularizedOn", e.mobile, e.personal_email as "personalEmail",
        to_char(e.birth_date, 'YYYY-MM-DD') as "birthDate", e.address, e.emergency_name as "emergencyName",
        e.emergency_phone as "emergencyPhone", e.emergency_relation as "emergencyRelation", e.salary, e.allowance,
        e.bank_name as "bankName", e.bank_account as "bankAccount", e.sss, e.philhealth, e.pagibig, e.tin,
        case when p.active then 'Active' else 'Left' end as status, to_char(e.left_on, 'YYYY-MM-DD') as "leftOn",
        (select u.name from seat_holder h join seat s on s.id = h.seat_id join org_unit u on u.id = s.unit_id
          where h.person_id = p.id and h.kind = 'holder' and h.starts_on <= current_date
            and (h.ends_on is null or h.ends_on >= current_date) order by s.lead desc limit 1) as team
      from person p join employee e on e.person_id = p.id where p.role <> 'admin' order by p.active desc, p.name`,
  );

/** A record's value as the sheet shows it. */
function shown(person: PersonNow, key: string): string {
  if (key === "loginEmail") return person.email ?? "";
  const value = person[key];
  if (value === null || value === undefined) return "";
  if (MONEY_KEYS.has(key)) return pesosWords(value as number);
  if (key === "company") return COMPANIES[value as CompanyCode]?.short ?? String(value);
  if (key === "classification") return CLASS_WORDS[String(value)] ?? String(value);
  return String(value);
}

/** A cell read into what Edit record takes, or why it can't be. */
function fieldFrom(key: string, text: string): { value: unknown } | { problem: string } {
  if (DATE_KEYS.has(key)) {
    const day = dayOf(text);
    return day ? { value: day } : { problem: `"${text}" isn't a day (2026-03-01 or 3/1/2026)` };
  }
  if (MONEY_KEYS.has(key)) {
    const centavos = centavosOf(text);
    return centavos === null ? { problem: `"${text}" isn't an amount in pesos` } : { value: centavos };
  }
  if (key === "company") {
    const code = companyOf(text);
    return code ? { value: code } : { problem: `"${text}" isn't 2MG or GPI` };
  }
  if (key === "classification") {
    const found = classificationFrom(text);
    return found ? { value: found } : { problem: `"${text}" isn't Regular, Probationary, Part-time or Intern` };
  }
  if (key === "employeeCode") return { value: text.trim().toUpperCase() };
  if (key === "personalEmail") return { value: text.trim().toLowerCase() };
  return { value: text.trim() };
}

// ------------------------------------------------------------------ the kinds

type Kind = {
  key: HrImportKind;
  title: string;
  what: string;
  columns: Column[];
  /** The current data as rows of the sheet (the export; the template has none). */
  current: (db: Runner, year: number) => Promise<string[][]>;
  /** One row checked, and saved unless it is a test run. */
  row: (db: Database, me: Me, cells: Record<string, string>, save: boolean, cache: Map<string, unknown>) => Promise<Omit<HrImportRow, "line">>;
};

/** Runs work and undoes it (a test run: the same checks as saving, nothing kept). */
class Undo extends Error {}
async function trial(db: Database, work: (tx: Database) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await work(tx as unknown as Database);
      throw new Undo();
    });
  } catch (error) {
    if (!(error instanceof Undo)) throw error;
  }
}
const why = (error: unknown) => {
  if (error instanceof Refusal) {
    const field = PEOPLE.find((one) => one.key === error.field)?.label;
    return field && !error.message.includes(field) ? `${field}: ${error.message}` : error.message;
  }
  throw error;
};

/** Finds the row's person by employee ID and login email. */
function findPerson(people: PersonNow[], cells: Record<string, string>): { person: PersonNow } | { problem: string; status: "problem" | "not_found" } {
  const code = cells.employeeCode?.trim().toUpperCase() || null;
  const email = cells.loginEmail?.trim().toLowerCase() || null;
  const company = cells.company ? companyOf(cells.company) : null;
  if (!code && !email) return { status: "problem", problem: "No employee ID and no login email: nothing to find the person by" };
  const byCode = code
    ? people.filter((one) => String(one.employeeCode ?? "").toUpperCase() === code && (!company || one.company === company))
    : [];
  const byEmail = email ? people.filter((one) => one.email === email) : [];
  if (byCode.length > 1) return { status: "problem", problem: `Employee ID ${code} is in both companies: fill in the Company` };
  const [a] = byCode;
  const [b] = byEmail;
  if (a && b && a.personId !== b.personId)
    return { status: "problem", problem: `Employee ID ${code} is ${a.name}'s but ${email} is ${b.name}'s` };
  const person = a ?? b;
  if (!person)
    return {
      status: "not_found",
      problem: "No one with this employee ID or login email. Add a new person with New joiner (they need a seat and a login).",
    };
  return { person };
}

const people: Kind = {
  key: "people",
  title: "People (masterlist)",
  what: "Everyone's HR record: employment, contact, pay and government numbers. Updates people already here, found by employee ID and login email; an empty cell leaves that detail as it is.",
  columns: PEOPLE,
  current: async (db) => (await peopleNow(db)).map((person) => PEOPLE.map((column) => shown(person, column.key))),
  row: async (db, me, cells, save, cache) => {
    const list = (cache.get("people") as PersonNow[] | undefined) ?? (await peopleNow(db));
    cache.set("people", list);
    const found = findPerson(list, cells);
    if ("problem" in found) return { status: found.status, who: cells.name || cells.employeeCode || cells.loginEmail || "", changes: [], problem: found.problem };
    const person = found.person;
    const input: Record<string, unknown> = {};
    const changes: string[] = [];
    const problems: string[] = [];
    for (const key of PERSON_FIELDS) {
      const text = cells[key]?.trim();
      if (!text) continue;
      const read = fieldFrom(key, text);
      if ("problem" in read) {
        problems.push(`${PEOPLE.find((one) => one.key === key)?.label}: ${read.problem}`);
        continue;
      }
      const before = person[key] ?? null;
      if (String(before ?? "") === String(read.value)) continue;
      input[key] = read.value;
      const label = PEOPLE.find((one) => one.key === key)?.label ?? key;
      // Pay and government numbers are said as changed, not shown (as HR's trail hides them).
      changes.push(
        MONEY_KEYS.has(key) || ["bankAccount", "sss", "philhealth", "pagibig", "tin"].includes(key)
          ? `${label} changed`
          : `${label}: ${shown(person, key) || "—"} → ${shown({ ...person, [key]: read.value as string }, key)}`,
      );
    }
    if (problems.length) return { status: "problem", who: person.name, changes, problem: problems.join("; ") };
    if (!changes.length) return { status: "same", who: person.name, changes: [] };
    try {
      if (save) {
        await updateRecord(db, me, person.personId, input as HrRecordInput);
        Object.assign(person, input);
      } else await trial(db, (tx) => updateRecord(tx, me, person.personId, input as HrRecordInput));
    } catch (error) {
      return { status: "problem", who: person.name, changes, problem: why(error) };
    }
    return { status: "update", who: person.name, changes };
  },
};

const BALANCE_COLUMNS: Column[] = [
  { key: "employeeCode", label: "Employee ID", aliases: ["Employee No"] },
  { key: "loginEmail", label: "Login email", aliases: ["Email"] },
  { key: "name", label: "Name", readOnly: true },
  { key: "year", label: "Year", note: "Blank: this year" },
  { key: "vl", label: "Vacation leave left", aliases: ["VL", "VL left", "VL balance"], note: "Days, in half-day steps" },
  { key: "sl", label: "Sick leave left", aliases: ["SL", "SL left", "SL balance"], note: "Days, in half-day steps" },
  { key: "reason", label: "Reason", note: "Blank: \"Balance brought over from the old system\"" },
];

const balances: Kind = {
  key: "leave-balances",
  title: "Leave balances",
  what: "The vacation and sick leave days each person has left for a year (from the old system). The CRM adds one adjustment per kind to reach it, with the reason, in HR's trail.",
  columns: BALANCE_COLUMNS,
  current: async (db, year) => {
    const list = await peopleNow(db);
    const out: string[][] = [];
    for (const person of list.filter((one) => one.status === "Active")) {
      const left = await balancesOf(db, person.personId, year, await classificationOf(db, person.personId));
      out.push([String(person.employeeCode ?? ""), person.email ?? "", person.name, String(year), String(left.vl.left), String(left.sl.left), ""]);
    }
    return out;
  },
  row: async (db, me, cells, save, cache) => {
    const list = (cache.get("people") as PersonNow[] | undefined) ?? (await peopleNow(db));
    cache.set("people", list);
    const found = findPerson(list, cells);
    if ("problem" in found) return { status: found.status, who: cells.name || "", changes: [], problem: found.problem };
    const person = found.person;
    const year = cells.year?.trim() ? Number(cells.year.trim()) : Number(todayManila().slice(0, 4));
    if (!Number.isInteger(year) || year < 2000 || year > 2100)
      return { status: "problem", who: person.name, changes: [], problem: `"${cells.year}" isn't a year` };
    const left = await balancesOf(db, person.personId, year, await classificationOf(db, person.personId));
    const reason = cells.reason?.trim() || "Balance brought over from the old system";
    const steps: { kind: "vl" | "sl"; days: number; words: string }[] = [];
    for (const kind of ["vl", "sl"] as const) {
      const text = cells[kind]?.trim();
      if (!text) continue;
      const target = Number(text);
      if (!Number.isFinite(target) || target < 0 || Math.round(target * 2) !== target * 2)
        return { status: "problem", who: person.name, changes: [], problem: `${kind === "vl" ? "Vacation" : "Sick"} leave: "${text}" isn't days in half-day steps` };
      const days = target - left[kind].left;
      if (days !== 0)
        steps.push({ kind, days, words: `${year} ${kind === "vl" ? "vacation" : "sick"} leave left: ${left[kind].left} → ${target}` });
    }
    if (!steps.length) return { status: "same", who: person.name, changes: [] };
    const work = async (tx: Database) => {
      for (const step of steps) await addCredit(tx, me, person.personId, { year, kind: step.kind, days: step.days, reason });
    };
    try {
      if (save) await work(db);
      else await trial(db, work);
    } catch (error) {
      return { status: "problem", who: person.name, changes: steps.map((one) => one.words), problem: why(error) };
    }
    return { status: "update", who: person.name, changes: steps.map((one) => one.words) };
  },
};

const HOLIDAY_COLUMNS: Column[] = [
  { key: "day", label: "Date", aliases: ["Day", "Holiday date"], note: "2026-12-25 or 12/25/2026" },
  { key: "name", label: "Holiday", aliases: ["Name", "Holiday name"] },
  { key: "kind", label: "Kind", aliases: ["Type"], note: "Regular or Special" },
  { key: "province", label: "Province", note: "Blank: a national holiday" },
  { key: "town", label: "Town", aliases: ["City", "Municipality"], note: "Blank: the whole province" },
];

const holidays: Kind = {
  key: "holidays",
  title: "Holidays",
  what: "National holidays (no province) and local ones (a province, and a town or the whole province). A day already on the list with the same name is left as it is.",
  columns: HOLIDAY_COLUMNS,
  current: async (db, year) => {
    const found = await rows<{ day: string; name: string; kind: string; province: string | null; town: string | null }>(
      db,
      sql`select to_char(day, 'YYYY-MM-DD') as day, name, kind, null as province, null as town from holiday
          where active and extract(year from day) = ${year}
        union all
        select to_char(day, 'YYYY-MM-DD'), name, kind, province, town from local_holiday
          where active and extract(year from day) = ${year}
        order by 1, 4 nulls first`,
    );
    return found.map((one) => [one.day, one.name, one.kind === "regular" ? "Regular" : "Special", one.province ?? "", one.town ?? ""]);
  },
  row: async (db, me, cells, save) => {
    const day = dayOf(cells.day ?? "");
    const name = cells.name?.trim() ?? "";
    const who = `${cells.day ?? ""} ${name}`.trim();
    if (!day) return { status: "problem", who, changes: [], problem: `"${cells.day ?? ""}" isn't a day` };
    const kindText = (cells.kind ?? "").trim().toLowerCase();
    const kind = kindText.startsWith("reg") ? "regular" : kindText.startsWith("spe") || !kindText ? "special" : null;
    if (!kind) return { status: "problem", who, changes: [], problem: `"${cells.kind}" isn't Regular or Special` };
    const province = cells.province?.trim() || null;
    const town = cells.town?.trim() || null;
    const [same] = await rows<{ name: string }>(
      db,
      province
        ? sql`select name from local_holiday where active and day = ${day}::date
            and lower(province) = lower(${province}) and coalesce(lower(town), '') = coalesce(lower(${town}), '')`
        : sql`select name from holiday where active and day = ${day}::date`,
    );
    if (same && same.name.toLowerCase() === name.toLowerCase()) return { status: "same", who, changes: [] };
    const input = { day, name, kind, province, town } as const;
    try {
      if (save) await addHoliday(db, me, input);
      else await trial(db, async (tx) => void (await addHoliday(tx, me, input)));
    } catch (error) {
      return { status: "problem", who, changes: [], problem: why(error) };
    }
    return { status: "new", who, changes: [`${kind === "regular" ? "Regular holiday" : "Special day"}${province ? ` in ${town ? `${town}, ` : ""}${province}` : ", national"}`] };
  },
};

export const IMPORT_KINDS: Record<HrImportKind, Kind> = { people, "leave-balances": balances, holidays };
const kindOf = (key: string): Kind => {
  const found = IMPORT_KINDS[key as HrImportKind];
  if (!found) throw new Refusal(404, "not_found", "No such sheet.");
  return found;
};

/** The sheets HR imports and exports, with their columns (the Import & export page). */
export function importKinds(me: Me) {
  allow(me, HR_ROLES, "see HR's sheets");
  return {
    kinds: Object.values(IMPORT_KINDS).map((one) => ({
      key: one.key,
      title: one.title,
      what: one.what,
      columns: one.columns.map((column) => ({ label: column.label, readOnly: Boolean(column.readOnly), note: column.note ?? null })),
    })),
    can: { import: HR_WRITE_ROLES.includes(me.role) && !me.viewedBy },
  };
}

/** A sheet as an Excel file: the current data, or a blank template (headings, how to fill each). */
export async function sheetFile(db: Database, me: Me, key: string, asked: { template?: boolean; year?: number | null }) {
  allow(me, HR_ROLES, "download HR's sheets");
  const kind = kindOf(key);
  const year = asked.year && asked.year > 2000 && asked.year < 2100 ? asked.year : Number(todayManila().slice(0, 4));
  const head: Cell[] = kind.columns.map((column) => ({ v: column.label, s: "head" }));
  const data = asked.template ? [] : await kind.current(db, year);
  const notes: Cell[][] = [
    [{ v: `${kind.title}: how to fill it`, s: "title" }],
    [kind.what],
    [""],
    [{ v: "Column", s: "head" }, { v: "How", s: "head" }],
    ...kind.columns.map((column) => [column.label, column.readOnly ? "Shown only: an import doesn't change it" : (column.note ?? "")]),
  ];
  const bytes = workbook([
    { name: kind.title.replace(/ \(.*\)$/, ""), rows: [head, ...data], widths: kind.columns.map((column) => Math.max(12, column.label.length + 4)) },
    { name: "How to fill it", rows: notes, widths: [24, 90] },
  ]);
  const name = `${kind.key}${asked.template ? "-template" : `-${todayManila()}`}.xlsx`;
  return { name, bytes };
}

/** Parses a .csv's text into rows (quotes, commas and line breaks inside quotes). */
export function csvRows(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const body = text.replace(/^﻿/, "");
  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (quoted) {
      if (char === '"' && body[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && body[i + 1] === "\n") i++;
      row.push(cell);
      out.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (cell || row.length) {
    row.push(cell);
    out.push(row);
  }
  return out;
}

/** Step 1: the uploaded file read (never kept), with each column matched to a heading where the
 *  CRM can tell. The first sheet with rows; its first row with text is the headings. */
export function readImport(me: Me, key: string, file: { name: string; bytes: Uint8Array } | null): HrImportRead {
  allow(me, HR_WRITE_ROLES, "import HR's sheets");
  const kind = kindOf(key);
  if (!file) throw new Refusal(400, "invalid", "Choose the file (.xlsx or .csv).", "file");
  if (file.bytes.byteLength > IMPORT_FILE_MAX) throw new Refusal(400, "invalid", "That file is over 10 MB.", "file");
  let table: string[][];
  if (/\.csv$/i.test(file.name)) table = csvRows(new TextDecoder().decode(file.bytes));
  else {
    let sheets: ReturnType<typeof readXlsxBytes>;
    try {
      sheets = readXlsxBytes(file.bytes);
    } catch {
      throw new Refusal(400, "invalid", "That isn't an Excel file (.xlsx) or a .csv.", "file");
    }
    const sheet = sheets.find((one) => !one.hidden && one.rows.some((row) => row.cells.some((cell) => cell.trim())));
    table = (sheet?.rows ?? []).map((row) => row.cells);
  }
  const filled = table.filter((row) => row.some((cell) => cell?.trim()));
  const [headers = [], ...body] = filled;
  if (!headers.length) throw new Refusal(400, "invalid", "The file has no headings: put them in the first row.", "file");
  if (body.length > ROWS_MAX) throw new Refusal(400, "invalid", `Up to ${ROWS_MAX} rows at a time: split the file.`, "file");
  const width = Math.max(headers.length, ...body.map((row) => row.length));
  const heads = Array.from({ length: width }, (_, at) => (headers[at] ?? "").trim());
  const mapping: Record<string, number | null> = {};
  for (const column of kind.columns.filter((one) => !one.readOnly || one.key === "name")) {
    const names = [column.label, ...(column.aliases ?? [])].map(plain);
    const at = heads.findIndex((head) => names.includes(plain(head)));
    mapping[column.key] = at >= 0 ? at : null;
  }
  return {
    kind: kind.key,
    headers: heads,
    rows: body.map((row) => Array.from({ length: width }, (_, at) => (row[at] ?? "").trim())),
    columns: kind.columns.filter((one) => !one.readOnly || one.key === "name").map((one) => ({ key: one.key, label: one.label, note: one.note ?? null })),
    mapping,
  };
}

/** Steps 2 and 3: every row checked (a test run changes nothing), then saved; each says what
 *  changed or what is wrong, with its line in the file. */
export async function runImport(
  db: Database,
  me: Me,
  key: string,
  input: { mapping: Record<string, number | null>; rows: string[][]; save: boolean },
): Promise<HrImportResult> {
  allow(me, HR_WRITE_ROLES, "import HR's sheets");
  if (me.viewedBy) throw new Refusal(403, "not_allowed", "Look-only: nothing changes.");
  const kind = kindOf(key);
  if (input.rows.length > ROWS_MAX) throw new Refusal(400, "invalid", `Up to ${ROWS_MAX} rows at a time.`);
  const used = Object.entries(input.mapping).filter(([, at]) => at !== null && at !== undefined);
  if (!used.length) throw new Refusal(400, "invalid", "Match at least one column to a heading.", "mapping");
  const cache = new Map<string, unknown>();
  const out: HrImportRow[] = [];
  for (const [index, row] of input.rows.entries()) {
    const cells: Record<string, string> = {};
    for (const [field, at] of used) cells[field] = String(row[at as number] ?? "").slice(0, 2000);
    if (!Object.values(cells).some((cell) => cell.trim())) continue;
    out.push({ line: index + 2, ...(await kind.row(db, me, cells, input.save, cache)) });
  }
  const counts = { new: 0, update: 0, same: 0, problem: 0, not_found: 0 };
  for (const one of out) counts[one.status]++;
  return { saved: input.save, rows: out, counts };
}
