// HR's own payroll register beside the CRM's month (docs/HR-PLAN.md step 4, "done when one period
// matches HR's register to the centavo"). HR uploads its register (.xlsx) on the Payroll month
// page; maps once which heading holds the employee ID, the name and each figure (kept and used
// again for the next month's file); the CRM matches each row to a person by employee ID (upper
// case, no spaces), else by the exact name, which HR confirms; then shows per person and per
// figure the CRM's amount, HR's and the difference, flagging any of ₱0.01 or more, and who is on
// one side only. Each file, each mapping, each confirmed name and each comparison is kept; nothing
// is deleted. HR and the Admin upload and map; the CEO reads. Taken from Automated-Excel's
// tests/payreg_compare.mjs (the register as the answer key), there read against its own engine.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { bytesOf, keepFile } from "../files/store";
import { allow, Refusal } from "../http";
import { iso, type Runner } from "../inventory/service";
import { readXlsxBytes, type Sheet } from "../reports/xlsx-read";
import type {
  Me,
  Payslip,
  PayRegisterPage,
  RegisterCompare,
  RegisterField,
  RegisterFigure,
  RegisterMapping,
} from "../types";
import { slipsOfMonth } from "./payroll";
import { HR_ROLES, HR_WRITE_ROLES } from "./people";

export const REGISTER_MAX_BYTES = 10 * 1024 * 1024;
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const REGISTER_FIELDS: RegisterField[] = [
  "code",
  "name",
  "basic",
  "ot",
  "gross",
  "deductions",
  "sss",
  "philhealth",
  "pagibig",
  "tax",
  "net",
];
export const REGISTER_FIGURES = REGISTER_FIELDS.filter(
  (one): one is RegisterFigure => one !== "code" && one !== "name",
);
/** Rows of a sheet sent for HR to pick the headings from. */
const PREVIEW_ROWS = 40;
const PREVIEW_COLUMNS = 80;

// ------------------------------------------------------------------ reading the register (pure)

const plain = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
/** An employee ID as both sides compare it: upper case, no spaces. */
export const codeKey = (code: string | null | undefined) =>
  (code ?? "").toUpperCase().replace(/\s+/g, "");

/** A register's amount in centavos: "1,234.50", "(100.00)" or "-100", "₱ 5"; blank or a dash is
 *  nothing (0); anything else can't be read (null). */
export function centavosOf(text: string | null | undefined): number | null {
  const raw = (text ?? "").replace(/[₱,\s]/g, "").replace(/^PHP/i, "");
  if (raw === "" || raw === "-" || raw === "–") return 0;
  const negative = /^\(.*\)$/.test(raw);
  const value = Number(negative ? raw.slice(1, -1) : raw);
  if (!Number.isFinite(value)) return null;
  return Math.round((negative ? -value : value) * 100);
}

/** The row most like a row of headings among the first rows: the most cells of text. */
export function guessHeaderRow(sheet: Sheet): number {
  let best = sheet.rows[0]?.number ?? 1;
  let most = -1;
  for (const row of sheet.rows.slice(0, 30)) {
    const words = row.cells.filter((one) => one && one.trim() && centavosOf(one) === null).length;
    if (words > most) {
      most = words;
      best = row.number;
    }
  }
  return best;
}

/** The headings of one row: by column, as written. */
const headingsOf = (sheet: Sheet, rowNumber: number) =>
  sheet.rows.find((row) => row.number === rowNumber)?.cells.map((one) => (one ?? "").trim()) ?? [];

/** Where a mapping's headings are in a workbook: its sheet (else any sheet holding them) and the
 *  row they are on (searched in the first 60 rows, the mapped row first); null when it doesn't fit. */
export function fitMapping(
  sheets: Sheet[],
  mapping: RegisterMapping,
): { sheet: Sheet; headerRow: number; index: Partial<Record<RegisterField, number>> } | null {
  const wanted = Object.entries(mapping.columns).filter(
    (one): one is [RegisterField, string] => typeof one[1] === "string" && one[1].trim() !== "",
  );
  if (!wanted.length) return null;
  const ordered = [
    ...sheets.filter((one) => one.name === mapping.sheet),
    ...sheets.filter((one) => one.name !== mapping.sheet),
  ];
  for (const sheet of ordered) {
    const candidates = [
      ...sheet.rows.filter((row) => row.number === mapping.headerRow),
      ...sheet.rows.slice(0, 60).filter((row) => row.number !== mapping.headerRow),
    ];
    for (const row of candidates) {
      const heads = row.cells.map((one) => plain(one ?? ""));
      const index: Partial<Record<RegisterField, number>> = {};
      let all = true;
      for (const [field, heading] of wanted) {
        const at = heads.indexOf(plain(heading));
        if (at < 0) {
          all = false;
          break;
        }
        index[field] = at;
      }
      if (all) return { sheet, headerRow: row.number, index };
    }
  }
  return null;
}

export type RegisterRow = {
  row: number;
  code: string | null;
  name: string | null;
  figures: Partial<Record<RegisterFigure, number | null>>;
};

/** The register's people: each row after the headings with an employee ID or a name (a totals row
 *  is left out). */
export function registerRows(
  sheet: Sheet,
  headerRow: number,
  index: Partial<Record<RegisterField, number>>,
): RegisterRow[] {
  const out: RegisterRow[] = [];
  const cell = (cells: string[], field: RegisterField) => {
    const at = index[field];
    return at === undefined ? null : (cells[at] ?? "").trim() || null;
  };
  for (const row of sheet.rows) {
    if (row.number <= headerRow) continue;
    const code = cell(row.cells, "code");
    const name = cell(row.cells, "name");
    if (!code && !name) continue;
    if (/^(grand\s+)?totals?\b/i.test(name ?? "") || /^(grand\s+)?totals?\b/i.test(code ?? ""))
      continue;
    const figures: RegisterRow["figures"] = {};
    for (const field of REGISTER_FIGURES)
      if (index[field] !== undefined) figures[field] = centavosOf(cell(row.cells, field));
    out.push({ row: row.number, code, name, figures });
  }
  return out;
}

/** The CRM's figure for a payslip, as a register's column means it. */
export function crmFigure(slip: Payslip, field: RegisterFigure): number {
  const deduction = (key: string) => slip.deductions.find((one) => one.key === key)?.amount ?? 0;
  switch (field) {
    case "basic":
      return slip.earnings.find((one) => one.key === "basic")?.amount ?? 0;
    case "ot":
      return slip.earnings
        .filter((one) => one.key.startsWith("ot_"))
        .reduce((sum, one) => sum + one.amount, 0);
    case "gross":
      return slip.gross;
    case "deductions":
      return slip.totalDeductions;
    case "net":
      return slip.net;
    default:
      return deduction(field);
  }
}

/** The register against the CRM's payslips: rows matched by employee ID, else by a name HR
 *  confirmed (an exact name not yet confirmed waits); each figure CRM − HR. */
export function compareRegister(input: {
  rows: RegisterRow[];
  slips: Payslip[];
  fields: RegisterFigure[];
  /** Rows HR confirmed: row number → person. */
  confirmed: Map<number, number>;
}): Omit<RegisterCompare, "id" | "at" | "by" | "crmStatus"> {
  const byCode = new Map<string, Payslip>();
  for (const slip of input.slips) {
    const key = codeKey(slip.person.employeeCode);
    if (key) byCode.set(key, slip);
  }
  const taken = new Set<number>();
  const matched: { row: RegisterRow; slip: Payslip; match: "code" | "name" }[] = [];
  const waiting: RegisterRow[] = [];
  // By employee ID first, then the names HR confirmed, then exact names to confirm.
  for (const row of input.rows) {
    const slip = row.code ? byCode.get(codeKey(row.code)) : undefined;
    if (slip && !taken.has(slip.person.id)) {
      taken.add(slip.person.id);
      matched.push({ row, slip, match: "code" });
    } else waiting.push(row);
  }
  const rest: RegisterRow[] = [];
  for (const row of waiting) {
    const personId = input.confirmed.get(row.row);
    const slip = input.slips.find((one) => one.person.id === personId);
    if (slip && !taken.has(slip.person.id)) {
      taken.add(slip.person.id);
      matched.push({ row, slip, match: "name" });
    } else rest.push(row);
  }
  const toConfirm: RegisterCompare["toConfirm"] = [];
  const onlyHr: RegisterCompare["onlyHr"] = [];
  for (const row of rest) {
    const same = row.name
      ? input.slips.filter((one) => !taken.has(one.person.id) && plain(one.person.name) === plain(row.name as string))
      : [];
    if (same.length === 1 && row.name)
      toConfirm.push({
        row: row.row,
        hrName: row.name,
        code: row.code,
        personId: same[0]?.person.id as number,
        name: same[0]?.person.name as string,
      });
    else onlyHr.push({ row: row.row, hrName: row.name, code: row.code });
  }
  const waitingFor = new Set(toConfirm.map((one) => one.personId));
  const onlyCrm = input.slips
    .filter((one) => !taken.has(one.person.id) && !waitingFor.has(one.person.id))
    .map((one) => ({ personId: one.person.id, name: one.person.name, code: one.person.employeeCode }));
  const rows = matched
    .map(({ row, slip, match }) => {
      const figures = input.fields.map((field) => {
        const crm = crmFigure(slip, field);
        const hr = row.figures[field] ?? null;
        return { field, crm, hr, diff: hr === null ? null : crm - hr };
      });
      return {
        row: row.row,
        personId: slip.person.id,
        name: slip.person.name,
        hrName: row.name,
        code: row.code,
        match,
        figures,
        // ₱0.01 or more either way, or a figure that can't be read.
        differs: figures.some((one) => one.diff !== 0),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const differences =
    rows.reduce((sum, one) => sum + one.figures.filter((f) => f.diff !== 0).length, 0) +
    toConfirm.length +
    onlyHr.length +
    onlyCrm.length;
  return { differences, fields: input.fields, rows, toConfirm, onlyHr, onlyCrm };
}

// ------------------------------------------------------------------ the database

const MONTH = /^\d{4}-\d{2}$/;
function monthOrRefuse(key: string): string {
  if (!MONTH.test(key)) throw new Refusal(404, "not_found", "No such month.");
  return key;
}

async function mappingInForce(db: Runner): Promise<(RegisterMapping & { id: number }) | null> {
  const [found] = await rows<{ id: number; sheet: string; headerRow: number; columns: unknown }>(
    db,
    sql`select id::int as id, sheet, header_row as "headerRow", columns from pay_register_map order by id desc limit 1`,
  );
  if (!found) return null;
  const columns = (typeof found.columns === "string" ? JSON.parse(found.columns) : found.columns) as RegisterMapping["columns"];
  return { id: found.id, sheet: found.sheet, headerRow: found.headerRow, columns };
}

type RegisterFile = { id: number; month: string; name: string; data: Uint8Array | null; key: string | null };

async function registerOf(db: Runner, id: number): Promise<RegisterFile> {
  const [found] = await rows<RegisterFile>(
    db,
    sql`select id::int as id, month, file_name as name, file_data as data, file_key as key
      from pay_register where id = ${id}`,
  );
  if (!found) throw new Refusal(404, "not_found", "No such register.");
  return found;
}

async function sheetsOf(file: RegisterFile): Promise<Sheet[]> {
  try {
    return readXlsxBytes(await bytesOf(file));
  } catch {
    throw new Refusal(400, "invalid", "That file isn't an Excel workbook (.xlsx).", "file");
  }
}

/** Compares a kept register with the CRM's month by the mapping in force, and keeps the result. */
async function compareNow(db: Database, me: Me, registerId: number): Promise<void> {
  const file = await registerOf(db, registerId);
  const mapping = await mappingInForce(db);
  if (!mapping) return;
  const fit = fitMapping(await sheetsOf(file), mapping);
  if (!fit) return;
  const fields = REGISTER_FIGURES.filter((one) => fit.index[one] !== undefined);
  const { slips, status } = await slipsOfMonth(db, file.month);
  const confirmed = new Map(
    (
      await rows<{ row: number; personId: number }>(
        db,
        sql`select row_number as row, person_id::int as "personId" from pay_register_match where register_id = ${registerId}`,
      )
    ).map((one) => [one.row, one.personId]),
  );
  const result = compareRegister({
    rows: registerRows(fit.sheet, fit.headerRow, fit.index),
    slips,
    fields,
    confirmed,
  });
  await db.execute(
    sql`insert into pay_register_compare (register_id, map_id, crm_status, result, differences, made_by)
      values (${registerId}, ${mapping.id}, ${status}, ${JSON.stringify(result)}::jsonb, ${result.differences}, ${me.id})`,
  );
}

/** The month's registers and the one asked for (else the newest) with its latest comparison. */
export async function registerPage(
  db: Database,
  me: Me,
  key: string,
  asked?: number | null,
): Promise<PayRegisterPage> {
  allow(me, HR_ROLES, "read payroll");
  const month = monthOrRefuse(key);
  const registers = await rows<{ id: number; fileName: string; by: string; at: string }>(
    db,
    sql`select r.id::int as id, r.file_name as "fileName", p.name as by, ${iso("r.made_at")} as at
      from pay_register r join person p on p.id = r.made_by where r.month = ${month} order by r.id desc`,
  );
  const pick = registers.find((one) => one.id === asked) ?? registers[0];
  const { slips } = await slipsOfMonth(db, month);
  const people = slips
    .map((one) => ({ id: one.person.id, name: one.person.name, code: one.person.employeeCode }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const can = { upload: HR_WRITE_ROLES.includes(me.role) && !me.viewedBy };
  if (!pick) return { month, registers, current: null, people, can };
  const file = await registerOf(db, pick.id);
  const sheets = await sheetsOf(file);
  const mapping = await mappingInForce(db);
  const fits = mapping ? fitMapping(sheets, mapping) !== null : false;
  const [last] = await rows<{
    id: number;
    at: string;
    by: string;
    crmStatus: "released" | "draft";
    result: unknown;
  }>(
    db,
    sql`select c.id::int as id, ${iso("c.made_at")} as at, p.name as by, c.crm_status as "crmStatus", c.result
      from pay_register_compare c join person p on p.id = c.made_by
      where c.register_id = ${pick.id} order by c.id desc limit 1`,
  );
  const compare: RegisterCompare | null = last
    ? {
        id: last.id,
        at: last.at,
        by: last.by,
        crmStatus: last.crmStatus,
        ...((typeof last.result === "string" ? JSON.parse(last.result) : last.result) as Omit<
          RegisterCompare,
          "id" | "at" | "by" | "crmStatus"
        >),
      }
    : null;
  return {
    month,
    registers,
    current: {
      ...pick,
      sheets: sheets
        .filter((one) => !one.hidden)
        .map((one) => ({
          name: one.name,
          guessedRow: guessHeaderRow(one),
          rows: one.rows
            .slice(0, PREVIEW_ROWS)
            .map((row) => ({ number: row.number, cells: row.cells.slice(0, PREVIEW_COLUMNS).map((c) => c ?? "") })),
        })),
      mapping: mapping ? { sheet: mapping.sheet, headerRow: mapping.headerRow, columns: mapping.columns } : null,
      fits,
      compare,
    },
    people,
    can,
  };
}

function writer(me: Me) {
  allow(me, HR_WRITE_ROLES, "compare payroll registers");
  if (me.viewedBy) throw new Refusal(403, "not_allowed", "Look-only: nothing changes.");
}

/** HR uploads its register for a month; compared at once when the mapping in force fits it. */
export async function uploadRegister(
  db: Database,
  me: Me,
  key: string,
  incoming: { name: string; mime: string; bytes: Uint8Array } | null,
): Promise<{ id: number; compared: boolean }> {
  writer(me);
  const month = monthOrRefuse(key);
  if (!incoming) throw new Refusal(400, "invalid", "Pick HR's payroll register (.xlsx).", "file");
  if (incoming.bytes.byteLength > REGISTER_MAX_BYTES)
    throw new Refusal(400, "invalid", "That file is over 10 MB.", "file");
  let sheets: Sheet[];
  try {
    sheets = readXlsxBytes(incoming.bytes);
  } catch {
    throw new Refusal(400, "invalid", "That file isn't an Excel workbook (.xlsx).", "file");
  }
  if (!sheets.some((one) => one.rows.length > 1))
    throw new Refusal(400, "invalid", "That workbook has no rows.", "file");
  // The bytes are kept before the transaction (a bucket can't roll back).
  const kept = await keepFile("hr-payroll-register", {
    name: incoming.name.trim().slice(0, 120) || "register.xlsx",
    mime: XLSX_MIME,
    bytes: incoming.bytes,
  });
  const [made] = await rows<{ id: number }>(
    db,
    sql`insert into pay_register (month, file_name, file_mime, file_size, file_data, file_key, made_by)
      values (${month}, ${kept.name}, ${kept.mime}, ${kept.size}, ${kept.data}, ${kept.key}, ${me.id})
      returning id::int as id`,
  );
  const id = made?.id as number;
  await compareNow(db, me, id);
  const [done] = await rows<{ n: number }>(
    db,
    sql`select count(*)::int as n from pay_register_compare where register_id = ${id}`,
  );
  return { id, compared: (done?.n ?? 0) > 0 };
}

/** HR maps the headings (kept as the mapping in force, used for the next files too) and compares. */
export async function mapRegister(
  db: Database,
  me: Me,
  registerId: number,
  input: RegisterMapping,
): Promise<void> {
  writer(me);
  const file = await registerOf(db, registerId);
  const sheets = await sheetsOf(file);
  const sheet = sheets.find((one) => one.name === input.sheet);
  if (!sheet) throw new Refusal(400, "invalid", "Pick a sheet of the file.", "sheet");
  const headings = headingsOf(sheet, input.headerRow).map(plain);
  if (!headings.some(Boolean))
    throw new Refusal(400, "invalid", "That row has no headings: pick the row the headings are on.", "headerRow");
  const columns: RegisterMapping["columns"] = {};
  for (const field of REGISTER_FIELDS) {
    const heading = input.columns[field]?.trim();
    if (!heading) continue;
    if (!headings.includes(plain(heading)))
      throw new Refusal(400, "invalid", `"${heading}" isn't a heading on row ${input.headerRow}.`, field);
    columns[field] = heading;
  }
  if (!columns.code && !columns.name)
    throw new Refusal(400, "invalid", "Map the employee ID or the name column.", "code");
  if (!REGISTER_FIGURES.some((one) => columns[one]))
    throw new Refusal(400, "invalid", "Map at least one figure to compare (net pay, tax…).", "net");
  await db.execute(
    sql`insert into pay_register_map (sheet, header_row, columns, made_by)
      values (${sheet.name}, ${input.headerRow}, ${JSON.stringify(columns)}::jsonb, ${me.id})`,
  );
  await compareNow(db, me, registerId);
}

/** HR says a register's row is this person (an exact name, or one HR picks), and compares again. */
export async function confirmRow(
  db: Database,
  me: Me,
  registerId: number,
  input: { row: number; personId: number },
): Promise<void> {
  writer(me);
  const file = await registerOf(db, registerId);
  const { slips } = await slipsOfMonth(db, file.month);
  if (!slips.some((one) => one.person.id === input.personId))
    throw new Refusal(404, "not_found", "That person has no payslip this month.", "personId");
  const [same] = await rows<{ id: number }>(
    db,
    sql`select id::int as id from pay_register_match where register_id = ${registerId}
      and (row_number = ${input.row} or person_id = ${input.personId})`,
  );
  if (same) throw new Refusal(409, "taken", "That row or that person is matched already.", "row");
  await db.execute(
    sql`insert into pay_register_match (register_id, row_number, person_id, confirmed_by)
      values (${registerId}, ${input.row}, ${input.personId}, ${me.id})`,
  );
  await compareNow(db, me, registerId);
}

/** HR compares a register again (a draft month changed since). */
export async function compareAgain(db: Database, me: Me, registerId: number): Promise<void> {
  writer(me);
  await registerOf(db, registerId);
  if (!(await mappingInForce(db)))
    throw new Refusal(409, "invalid", "Map the register's headings first.");
  await compareNow(db, me, registerId);
}

/** The kept file: HR, the CEO and the Admin. */
export async function registerFile(
  db: Database,
  me: Me,
  registerId: number,
): Promise<{ name: string; mime: string; bytes: Uint8Array }> {
  allow(me, HR_ROLES, "read payroll");
  const file = await registerOf(db, registerId);
  return { name: file.name, mime: XLSX_MIME, bytes: await bytesOf(file) };
}
