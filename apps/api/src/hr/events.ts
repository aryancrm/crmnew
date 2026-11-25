// HR's trail (docs/HR-PLAN.md, step 1): every change to a person's HR record, who made it and
// when, kept for good (never updated or deleted). Pay, bank, government numbers and the birth date
// are written down only as "changed": the trail is read by more eyes than the record itself.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { allow, Refusal } from "../http";
import type { Runner } from "../inventory/service";
import type { HrChange, HrEventKind, HrHistory, Me } from "../types";
import type { Role } from "../people/roles";

/** Who reads a person's trail: whoever reads their record (HR, the CEO, the Admin). */
const TRAIL_ROLES: Role[] = ["hr", "ceo", "admin"];

/** Each field of the record, as HR's form names it. */
export const FIELD_LABEL: Record<string, string> = {
  company: "Company",
  employeeCode: "Employee ID",
  classification: "Employment",
  position: "Position",
  department: "Department",
  hireDate: "Hire date",
  regularizedOn: "Regular since",
  mobile: "Mobile",
  personalEmail: "Personal email",
  birthDate: "Birth date",
  address: "Address",
  emergencyName: "Emergency contact",
  emergencyPhone: "Emergency contact's phone",
  emergencyRelation: "Emergency contact's relation",
  gender: "Gender",
  civilStatus: "Civil status",
  citizenship: "Citizenship",
  spouseName: "Spouse",
  fatherName: "Father",
  motherName: "Mother",
  education: "Highest education",
  school: "School",
  course: "Course",
  workArrangement: "Work arrangement",
  workTown: "Work town",
  workProvince: "Work town's province",
  companyPhone: "Company phone",
  issuedEquipment: "Issued equipment",
  jobDescription: "Job description",
  salary: "Monthly salary",
  allowance: "Monthly allowance",
  bankName: "Bank",
  bankAccount: "Bank account",
  sss: "SSS",
  philhealth: "PhilHealth",
  pagibig: "Pag-IBIG",
  tin: "TIN",
  noSss: "Not under SSS",
  noPhilhealth: "Not under PhilHealth",
  noPagibig: "Not under Pag-IBIG",
  noTax: "Not taxed",
};

/** Said changed, never shown. */
export const HIDDEN_FIELDS = new Set([
  "salary",
  "allowance",
  "bankName",
  "bankAccount",
  "sss",
  "philhealth",
  "pagibig",
  "tin",
  "birthDate",
]);

type Value = string | number | boolean | null | undefined;

const shown = (value: Value): string | null =>
  value === null || value === undefined || value === ""
    ? null
    : typeof value === "boolean"
      ? value
        ? "Yes"
        : "No"
      : String(value);

/** Fields kept as a code, said as the form says them. */
const VALUE_WORDS: Record<string, Record<string, string>> = {
  company: { "2mg": "2MG Inc.", gpi: "Getmeds Philippines" },
  classification: { probationary: "Probationary", regular: "Regular", part_time: "Part-time", intern: "Intern" },
  gender: { female: "Female", male: "Male" },
  civilStatus: { single: "Single", married: "Married", widowed: "Widowed", separated: "Separated" },
  workArrangement: { office: "Office", field: "Field", hybrid: "Hybrid", remote: "Remote" },
};

/** The fields that really changed between the record before and after, in the form's order. */
export function changesOf(before: Record<string, Value>, after: Record<string, Value>): HrChange[] {
  const out: HrChange[] = [];
  for (const field of Object.keys(FIELD_LABEL)) {
    if (!(field in after)) continue;
    const words = (value: string | null) => (value === null ? null : (VALUE_WORDS[field]?.[value] ?? value));
    const from = words(shown(before[field]));
    const to = words(shown(after[field]));
    if (from === to) continue;
    const hidden = HIDDEN_FIELDS.has(field);
    out.push({
      field,
      label: FIELD_LABEL[field] as string,
      from: hidden ? null : from,
      to: hidden ? null : to,
      hidden,
    });
  }
  return out;
}

/** One sentence for a record's changes: "Position, Department changed". */
export function changeSentence(changes: HrChange[]): string {
  const labels = changes.map((one) => one.label);
  if (labels.length <= 3) return `${labels.join(", ")} changed`;
  return `${labels.slice(0, 3).join(", ")} and ${labels.length - 3} more changed`;
}

/** Writes one line of the trail. */
export async function hrEvent(
  db: Runner,
  personId: number,
  by: number,
  kind: HrEventKind,
  what: string,
  changes: HrChange[] = [],
): Promise<void> {
  await db.execute(
    sql`insert into hr_event (person_id, by_person, kind, what, changes)
      values (${personId}, ${by}, ${kind}, ${what}, ${JSON.stringify(changes)}::jsonb)`,
  );
}

/** The fields that make someone's working life (the rest of a record is contact and papers). */
const CAREER_FIELDS = new Set(["position", "department", "classification", "company", "regularizedOn", "salary", "allowance"]);
/** Their working life from HR's trail, newest first: joined, a new position or department,
 *  employment or company, regularized, pay changed (never how much), left, back. */
export async function careerOf(db: Runner, personId: number): Promise<{ at: string; what: string }[]> {
  const lines = await rows<{ at: string; kind: HrEventKind; what: string; changes: HrChange[] }>(
    db,
    sql`select to_char(at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as at, kind, what, changes
      from hr_event where person_id = ${personId} and kind in ('joined', 'record', 'left', 'back')
      order by at desc, id desc limit 200`,
  );
  const out: { at: string; what: string }[] = [];
  for (const line of lines) {
    if (line.kind !== "record") {
      out.push({ at: line.at, what: line.what });
      continue;
    }
    const parts = line.changes
      .filter((one) => CAREER_FIELDS.has(one.field))
      .map((one) => {
        if (one.hidden) return `${one.label} changed`;
        if (one.field === "regularizedOn") return one.to ? `Regular from ${one.to}` : "Regularization taken back";
        const words = (value: string | null) => value ?? "none";

        return `${one.label}: ${words(one.from)} → ${words(one.to)}`;
      });
    if (parts.length) out.push({ at: line.at, what: parts.join("; ") });
  }
  return out;
}

/** A person's trail, newest first. */
export async function hrHistory(db: Database, me: Me, personId: number): Promise<HrHistory> {
  allow(me, TRAIL_ROLES, "read people's HR history");
  const [found] = await rows<{ id: number }>(
    db,
    sql`select person_id::int as id from employee where person_id = ${personId}`,
  );
  if (!found) throw new Refusal(404, "not_found", "No such person.");
  const lines = await rows<HrHistory["lines"][number]>(
    db,
    sql`select to_char(e.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as at, p.name as by,
        e.kind, e.what, e.changes
      from hr_event e join person p on p.id = e.by_person
      where e.person_id = ${personId} order by e.at desc, e.id desc limit 500`,
  );
  return { lines };
}
