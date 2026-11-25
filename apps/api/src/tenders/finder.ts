// The tender finder inside the CRM (docs/PLAN.md 24; Aryan, 23 Nov: "we keep one CRM, not two").
// The robot (workers/tender-finder: a browser that reads PhilGEPS and PS-PhilGEPS, a separate
// process) hands in what it found through its own door; here the notices are kept, matched to our
// customers (the agency) and our medicines (by molecule, then strength), shown to the seats that
// have Tenders, screened by them, and turned into a CRM tender in one press. From there the
// tender's own road goes on (tenders/service.ts).

import { createHash } from "node:crypto";
import { type SQL, sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { Refusal } from "../http";
import type { FindRun, FoundDetail, FoundDocs, FoundLine, FoundList, FoundSort, FoundTender, FoundView, Me, TenderMode } from "../types";
import { papersOf, robotLoginState } from "./papers";
import { robotReady } from "./robot-caller";
import { fetchState } from "./fetch-now";
import { psState } from "./robot-store";
import { createTender, recordsTenders, setLines } from "./service";

// ---------------------------------------------------------------- names

/** A name in capitals without accents or punctuation: the portals and our customer list spell
 *  the same hospital slightly differently ("Dr. Paulino J. Garcia Memorial Research & Medical…"). */
export const agencyKey = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’]/g, "")
    .replace(/&/g, " and ")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();

/** The region / DOH suffix the portals add ("… MEDICAL CENTER - REGION VII", "…-DOH R6"). */
const PORTAL_SUFFIX = / (?:DOH|CHD|REGION|R ?\d+)\b.*$/;

/** Finds the customer an agency name is: the same name, the name without the portal's suffix, or
 *  the portal's name starting with ours (three words or more). Two customers fitting: none. */
export function agencyMatcher(customers: { id: number; name: string }[]): (name: string | null | undefined) => number | null {
  const byKey = new Map<string, number | null>();
  for (const one of customers) {
    const key = agencyKey(one.name);
    if (key) byKey.set(key, byKey.has(key) ? null : one.id);
  }
  const long = [...byKey.entries()].filter(([key, id]) => id !== null && key.split(" ").length >= 3) as [string, number][];
  return (name) => {
    const key = agencyKey(name ?? "");
    if (!key) return null;
    const exact = byKey.get(key) ?? byKey.get(key.replace(PORTAL_SUFFIX, ""));
    if (exact) return exact;
    const starts = long.filter(([ours]) => key.startsWith(`${ours} `));
    return starts.length === 1 ? (starts[0] as [string, number])[1] : null;
  };
}

/** Salt and form words after the molecule ("Imatinib mesylate", "Palonosetron Hydrochloride"). */
const SALT = "(?:hydrochloride|hcl|sodium|potassium|carbonate|monohydrate|besilate|besylate|mesylate|citrate|phosphate|acetate|maleate|tartrate|trihydrate|dihydrate|olamine)";
const titleCase = (text: string) => text.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_all, gap: string, letter: string) => gap + letter.toUpperCase());

/** Words that say how a medicine comes, not what it is. A generic name that is only one of
 *  these (an item kept as "Syringe") is not looked for: it would claim every "pre-filled syringe". */
const FORM_WORDS = new Set(["syringe", "vial", "ampoule", "ampule", "tablet", "capsule", "bottle", "sachet", "solution", "suspension", "syrup", "cream", "ointment", "injection", "powder", "drops"]);
/** Whether a molecule name is looked for in tenders: four letters or more, and not a form word. */
export const lookedFor = (name: string) => name.length >= 4 && !FORM_WORDS.has(name.toLowerCase());

/** The molecule a medicine's generic name is matched by: "Abiraterone acetate" → Abiraterone,
 *  "Salbutamol (as sulfate)" → Salbutamol, "Iodine (as Iohexol)" → Iohexol. "+" joins a combination. */
export function moleculeName(generic: string | null | undefined): string {
  let text = String(generic ?? "")
    .replace(/\*/g, "")
    .replace(/\[[^\]]*\]/g, " ");
  // "(as X)" says the salt it comes as (Salbutamol (as sulfate), Clopidogrel (as bisulfate)): it
  // goes with the other brackets. Only an element kept as a compound is that compound.
  const as = /\(\s*as\s+([^)]+)\)/i.exec(text);
  if (as && /^\s*iodine\b/i.test(text)) text = as[1] as string;
  text = text
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s+(?:in|with)\s+.*$/i, "")
    .replace(/\s+RTU$/i, "");
  return titleCase(text.replace(new RegExp(`\\s+${SALT}$`, "i"), "").trim());
}

/** Other ways tenders write a molecule we keep (spellings, short names). Helpers only: a molecule
 *  we do not keep is never matched. */
const OTHER_NAMES: Record<string, string[]> = {
  amikacin: ["amikacide"],
  anastrozole: ["anastrazole"],
  "ferrous sulfate": ["ferrous sulphate"],
  fluorouracil: ["5-fu"],
  hydroxyurea: ["hydroxycarbamide"],
  "zoledronic acid": ["zoledronic"],
  "l-asparaginase": ["asparaginase"],
  "epoetin alfa": ["epoetin", "erythropoietin"],
  "polymyxin b": ["polymyxin", "polymixin"],
};

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const aliasesOf = (molecule: string) => [molecule.toLowerCase(), ...(OTHER_NAMES[molecule.toLowerCase()] ?? [])];

/** The amounts written in a text ("200 mg", "100mg/10 mL", "1 g"), as one unit each so that
 *  1 g = 1000 mg and 0.5 mg = 500 mcg compare equal. */
export function strengthsOf(text: string | null | undefined): string[] {
  const found: string[] = [];
  const clean = String(text ?? "")
    .toLowerCase()
    .replace(/,(?=\d{3}(?!\d))/g, "");
  for (const one of clean.matchAll(/(\d+(?:\.\d+)?)\s*(mcg|µg|ug|mg|g|iu|i\.u\.|ml|l|%|units?)(?![a-z])/g)) {
    const value = Number(one[1]);
    const unit = one[2] as string;
    const [amount, name] =
      unit === "g"
        ? [value * 1_000_000, "mcg"]
        : unit === "mg"
          ? [value * 1000, "mcg"]
          : unit === "mcg" || unit === "µg" || unit === "ug"
            ? [value, "mcg"]
            : unit === "l"
              ? [value * 1000, "ml"]
              : unit === "ml"
                ? [value, "ml"]
                : unit === "%"
                  ? [value, "%"]
                  : [value, "iu"];
    found.push(`${Math.round(amount * 1000) / 1000}${name}`);
  }
  return found;
}

export type FinderMedicine = { id: number; name: string; generic: string | null; strength: string | null };
export type LineMatch = { molecules: string[]; medicineId: number | null; candidates: number[] };

/** Matches a line of a tender to our medicines: by molecule (every part of a combination must be
 *  on the line), then by strength. One medicine fitting: that one. None or several (two brands
 *  of one strength, a strength we do not keep): the person picks among the candidates. */
export function medicineMatcher(medicines: FinderMedicine[]): (text: string) => LineMatch {
  const groups = new Map<string, { name: string; parts: string[]; alternatives: RegExp[][]; medicines: FinderMedicine[] }>();
  for (const one of medicines) {
    const name = moleculeName(one.generic);
    if (!lookedFor(name)) continue;
    const key = name.toLowerCase();
    const group = groups.get(key) ?? {
      name,
      parts: key.split("+").map((part) => part.trim()),
      alternatives: aliasesOf(name).map((alias) =>
        alias.split("+").map((part) => new RegExp(`(?<![a-z0-9])${escapeRegex(part.trim()).replace(/\s+/g, "[\\s-]+")}(?![a-z0-9])`, "i")),
      ),
      medicines: [],
    };
    group.medicines.push(one);
    groups.set(key, group);
  }
  const list = [...groups.values()];
  return (text) => {
    let hits = list.filter((group) => group.alternatives.some((parts) => parts.every((part) => part.test(text))));
    // A combination on the line is the combination, not also each of its parts.
    const inCombination = new Set(hits.filter((group) => group.parts.length > 1).flatMap((group) => group.parts));
    hits = hits.filter((group) => group.parts.length > 1 || !inCombination.has(group.parts[0] as string));
    const candidates = hits.flatMap((group) => group.medicines);
    const written = new Set(strengthsOf(text));
    // A medicine fits when an amount of its strength (not only a volume) is written on the line:
    // ours are kept as "10mg/ml (50 mg/5 ml)", tenders write "50mg/5ml" or "10 mg/mL, 5 mL".
    const fits = candidates.filter((one) => strengthsOf(one.strength).some((amount) => !amount.endsWith("ml") && written.has(amount)));
    // "10 mg/mL" alone is a concentration, shared by vials of several sizes: it settles the
    // medicine only when we keep one medicine of that molecule.
    const perMl = /(?:mcg|µg|ug|mg|g|iu)\s*\/\s*ml/i.test(text);
    const sure = written.size === 0 ? candidates.length === 1 : perMl ? candidates.length === 1 && fits.length === 1 : fits.length === 1;
    const picked = !sure ? null : written.size === 0 ? candidates[0] : fits[0];
    return {
      molecules: hits.map((group) => group.name),
      medicineId: picked?.id ?? null,
      candidates: candidates.map((one) => one.id),
    };
  };
}

async function ourMedicines(db: Pick<Database, "execute">): Promise<FinderMedicine[]> {
  // Interim (PLAN 24, question 33): every active medicine with a generic name.
  return rows<FinderMedicine>(
    db,
    sql`select id::int as id, name, generic, strength from medicine where active and coalesce(trim(generic), '') <> '' order by id`,
  );
}

// ---------------------------------------------------------------- reading what the robot sends

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = (value: number | string) => String(value).padStart(2, "0");

/** The first day written in a passage ("27/10/2026 2:00 PM", "October 27, 2026 at 10:00am",
 *  "28 OCTOBER 2026"), as YYYY-MM-DD; null when none is. */
export function dayIn(text: string | null | undefined): string | null {
  const passage = String(text ?? "");
  const numbers = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(passage);
  if (numbers) return validDay(Number(numbers[3]), Number(numbers[2]), Number(numbers[1]));
  const monthFirst = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})\s*,?\s+(\d{4})\b/.exec(passage);
  if (monthFirst && MONTHS[(monthFirst[1] as string).slice(0, 3).toLowerCase()])
    return validDay(Number(monthFirst[3]), MONTHS[(monthFirst[1] as string).slice(0, 3).toLowerCase()] as number, Number(monthFirst[2]));
  const dayFirst = /\b(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})\b/.exec(passage);
  if (dayFirst && MONTHS[(dayFirst[2] as string).slice(0, 3).toLowerCase()])
    return validDay(Number(dayFirst[3]), MONTHS[(dayFirst[2] as string).slice(0, 3).toLowerCase()] as number, Number(dayFirst[1]));
  return null;
}
function validDay(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  const real = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return real && year >= 2000 && year <= 2100 ? `${year}-${pad(month)}-${pad(day)}` : null;
}

/** The portals write closing times as Philippine time without a zone ("2026-10-23 13:00:00"). */
function manilaInstant(value: string | null | undefined): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const zoned = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(text);
  const local = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2}))?/.exec(text);
  const iso = zoned ? text.replace(" ", "T") : local ? `${local[1]}T${local[2]}:${local[3] ?? "00"}+08:00` : /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T23:59:00+08:00` : "";
  const at = iso ? Date.parse(iso) : Number.NaN;
  return Number.isNaN(at) ? null : new Date(at).toISOString();
}

const isoDay = (value: string | null | undefined) => {
  const found = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ""));
  return found ? validDay(Number(found[1]), Number(found[2]), Number(found[3])) : null;
};

/** Pesos as the portal writes them → whole centavos; null when it is not an amount. */
const centavos = (pesos: unknown): number | null => {
  const value = typeof pesos === "number" ? pesos : Number.NaN;
  return Number.isFinite(value) && value >= 0 && value < 1e12 ? Math.round(value * 100) : null;
};

const short = (value: unknown, max: number): string | null => {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : typeof value === "number" ? String(value) : "";
  return text ? text.slice(0, max) : null;
};

/** Only a link to the portals themselves is kept (it is shown as a link to press). */
function portalLink(value: unknown): string | null {
  try {
    const url = new URL(String(value ?? ""));
    const ok = (url.protocol === "https:" || url.protocol === "http:") && (url.hostname === "philgeps.gov.ph" || url.hostname.endsWith(".philgeps.gov.ph"));
    return ok ? url.toString().slice(0, 600) : null;
  } catch {
    return null;
  }
}

/** The mode a notice is, in the CRM's words; "other" when it does not say. */
export function modeOf(noticeType: string | null, procurementMode: string | null): TenderMode {
  const text = `${procurementMode ?? ""} ${noticeType ?? ""}`;
  if (/small value|shopping|request for quotation|\(rfq\)/i.test(text)) return "small_value";
  if (/direct contracting/i.test(text)) return "direct_contracting";
  if (/direct acquisition/i.test(text)) return "direct_acquisition";
  if (/limited source/i.test(text)) return "limited_source";
  if (/repeat order/i.test(text)) return "repeat_order";
  if (/negotiated/i.test(text)) return "negotiated";
  if (/public bidding|competitive bidding|invitation to bid|\(itb\)/i.test(text)) return "competitive_bidding";
  return "other";
}

/** A notice as the robot sends it: the shape its own table had (philgeps_opportunities), so its
 *  code changes in one place only. Amounts in pesos, times in Philippine time. */
export type RobotNotice = {
  source?: "philgeps" | "ps";
  ref_no: string;
  title: string;
  procuring_entity?: string | null;
  publish_date?: string | null;
  closing_date?: string | null;
  abc_amount?: number | null;
  detail_link?: string | null;
  items_text?: string | null;
  details?: Record<string, unknown> | null;
};
type RobotItem = { line?: unknown; description?: unknown; item_no?: unknown; quantity?: unknown; unit?: unknown; unit_price?: unknown; total?: unknown };

/** What of a notice's details is kept (and given back to the robot, which re-reads only what is new). */
const KEPT = [
  "notice_type", "solicitation_no", "procurement_mode", "classification", "area_of_delivery", "delivery_period", "client_agency",
  "contact_name", "status", "last_updated", "pre_bid", "bid_opening", "supplements_checked_at",
] as const;
function keptDetails(details: Record<string, unknown>): Record<string, unknown> {
  const kept: Record<string, unknown> = {};
  for (const key of KEPT) {
    const value = short(details[key], 400);
    if (value) kept[key] = value;
  }
  if (Array.isArray(details.contact_info)) kept.contact_info = details.contact_info.map((one) => short(one, 200)).filter(Boolean).slice(0, 10);
  if (Array.isArray(details.supplements))
    kept.supplements = (details.supplements as Record<string, unknown>[]).slice(0, 60).map((one) => ({
      no: short(one?.no, 40) ?? "",
      title: short(one?.title, 300) ?? "",
      type: short(one?.type, 80) ?? "",
      published: isoDay(short(one?.published, 20)),
    }));
  // The papers' own record (which files, what was read in them, what is still to read), kept as
  // the robot hands it in: it reads it back to know what is done. Its lines too, and the notice's
  // own (matched_items), so a later hand-in of only one of the two does not lose the other.
  for (const [key, value] of Object.entries(details)) {
    if (!/^documents(?:_|$)/.test(key) && key !== "package" && key !== "matched_items") continue;
    if (key === "documents_outside_table" || value === undefined) continue;
    const size = JSON.stringify(value ?? null).length;
    if (size <= 400_000) kept[key] = value;
  }
  if (Array.isArray(details.documents))
    kept.documents = (details.documents as Record<string, unknown>[])
      .slice(0, 80)
      .map((one) => ({ ...one, name: short(one?.name, 200) ?? "" }))
      .filter((one) => one.name);
  return kept;
}

type ReadLine = { origin: "notice" | "papers"; itemNo: string | null; description: string; qty: number | null; unit: string | null; abcUnit: number | null; abcTotal: number | null; match: LineMatch };

/** PhilGEPS's own table on a notice page, under "Line Items":
 *  Item No. | Product/Service Name | Description | Quantity | UOM | Budget (PHP), one row a line,
 *  the budget being the whole line's: "14 Rocuronium Bromide 10mg/ml, 5ml injection 2500 Ampule 287,225.00". */
const LINE_TABLE = /^Item No\.?\s+Product\/Service Name\s+Description\s+Quantity\s+UOM\s+Budget.*$/im;
const TABLE_ROW = /^(\d+)[.)]?\s+(.+?)\s+([\d,]+(?:\.\d+)?)\s+([A-Za-z][A-Za-z.'’/-]*)\s+([\d,]+\.\d{2})$/;
const amount = (text: string) => Number(text.replace(/,/g, ""));

/** The rows of that table that name a molecule of ours, each with its quantity, unit and budget
 *  (the budget for one piece worked out); null when the notice has no such table. What stands
 *  above the table is the notice's own words about the tender, not lines. */
function tableLines(itemsText: string | null | undefined, match: (text: string) => LineMatch): ReadLine[] | null {
  const text = String(itemsText ?? "");
  const head = LINE_TABLE.exec(text);
  if (!head) return null;
  const lines: ReadLine[] = [];
  for (const raw of text.slice(head.index + head[0].length).split("\n")) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (line.length < 3) continue;
    const hit = match(line);
    if (!hit.molecules.length) continue;
    const row = TABLE_ROW.exec(line);
    const qty = row ? amount(row[3] as string) : null;
    const abcTotal = row ? centavos(amount(row[5] as string)) : null;
    lines.push({
      origin: "notice",
      itemNo: row ? (row[1] as string) : null,
      description: (row ? (row[2] as string) : line).slice(0, 500),
      qty: qty !== null && qty > 0 && qty < 1e9 ? qty : null,
      unit: row ? (row[4] as string).slice(0, 30) : null,
      abcUnit: qty && abcTotal !== null ? Math.round(abcTotal / qty) : null,
      abcTotal,
      match: hit,
    });
    if (lines.length >= 400) break;
  }
  return lines;
}

/** The lines a notice asks for: those read in its papers (with a quantity) first, then the
 *  notice's own lines for the molecules the papers give no line for (PhilGEPS's own line table
 *  when the notice has one, else the lines the robot kept); with neither, each line of the
 *  notice's text that names a molecule of ours. */
function linesOf(notice: RobotNotice, match: (text: string) => LineMatch): ReadLine[] {
  const details = notice.details ?? {};
  const read = (item: RobotItem, origin: "notice" | "papers"): ReadLine | null => {
    const description = short(item.description, 500) ?? short(item.line, 500);
    if (!description) return null;
    const qty = typeof item.quantity === "number" && item.quantity >= 0 && item.quantity < 1e9 ? item.quantity : null;
    let abcUnit = centavos(item.unit_price);
    let abcTotal = centavos(item.total);
    // The missing one worked out as the team's sheet does: total ÷ quantity, quantity × a piece.
    if (abcUnit === null && abcTotal !== null && qty) abcUnit = Math.round(abcTotal / qty);
    if (abcTotal === null && abcUnit !== null && qty) abcTotal = Math.round(abcUnit * qty);
    return { origin, itemNo: short(item.item_no, 30), description, qty, unit: short(item.unit, 30), abcUnit, abcTotal, match: match(`${description} ${short(item.line, 500) ?? ""}`) };
  };
  const list = (value: unknown) => (Array.isArray(value) ? (value as RobotItem[]).slice(0, 400) : []);
  const papers = list(details.documents_items).map((item) => read(item, "papers")).filter((line): line is ReadLine => line !== null && line.qty !== null);
  const inPapers = new Set(papers.flatMap((line) => line.match.molecules));
  const table = tableLines(notice.items_text, match);
  // With no table of PhilGEPS's own and no lines kept by the robot: each line of the notice's
  // text that names a molecule of ours, as written.
  const named = (): ReadLine[] =>
    String(notice.items_text ?? "")
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter((line) => line.length >= 3)
      .map((line) => ({ line, hit: match(line) }))
      .filter(({ hit }) => hit.molecules.length > 0)
      .slice(0, 400)
      .map(({ line, hit }) => ({ origin: "notice" as const, itemNo: null, description: line.slice(0, 500), qty: null, unit: null, abcUnit: null, abcTotal: null, match: hit }));
  const kept = list(details.matched_items);
  const onNotice = (table ?? (kept.length ? kept.map((item) => read(item, "notice")) : named()))
    .filter((line): line is ReadLine => line !== null && !(line.match.molecules.length > 0 && line.match.molecules.every((name) => inPapers.has(name))));
  return [...papers, ...onNotice].slice(0, 400);
}

/** What the robot found, kept: a notice seen before is brought up to date (what a later run does
 *  not send again stays), its lines are written again only when they changed (the old ones kept,
 *  marked replaced; a medicine a person picked stays picked). */
export async function takeFound(db: Database, notices: RobotNotice[]): Promise<{ taken: number; fresh: number; matched: number }> {
  const match = medicineMatcher(await ourMedicines(db));
  const agencyOf = agencyMatcher(await rows<{ id: number; name: string }>(db, sql`select id::int as id, name from customer where active and kind in ('government', 'hospital')`));
  let fresh = 0;
  let matched = 0;
  for (const notice of notices) {
    const source = notice.source === "ps" ? "ps" : "philgeps";
    const refNo = notice.ref_no.trim().slice(0, 60);
    const title = short(notice.title, 500) ?? "(no title)";
    const agency = short(notice.procuring_entity, 300);
    const sent = notice.details ? keptDetails(notice.details) : null;
    const itemsText = typeof notice.items_text === "string" && notice.items_text.trim() ? notice.items_text.slice(0, 60_000) : null;
    await db.transaction(async (tx) => {
      const [known] = await rows<{ id: number; linesKey: string | null; itemsText: string | null }>(
        tx,
        sql`select id::int as id, lines_key as "linesKey", items_text as "itemsText" from tender_found where source = ${source} and ref_no = ${refNo} for update`,
      );
      // A run that does not read the notice's page again sends neither its text nor its details:
      // the lines stay as they are.
      const reread = itemsText !== null || notice.details != null;
      const lines = reread ? linesOf({ ...notice, items_text: itemsText }, match) : [];
      const text = `${title}\n${itemsText ?? known?.itemsText ?? ""}`;
      const molecules = [...new Set([...match(text).molecules, ...lines.flatMap((line) => line.match.molecules)])].sort();
      if (molecules.length) matched += 1;
      const values = {
        agencyKey: agency ? agencyKey(agency) : null,
        agencyId: agencyOf(agency),
        noticeType: short(sent?.notice_type, 200),
        mode: short(sent?.procurement_mode, 200),
        abc: centavos(notice.abc_amount),
        publishedOn: isoDay(notice.publish_date),
        closingAt: manilaInstant(notice.closing_date),
        link: portalLink(notice.detail_link),
      };
      let id = known?.id;
      if (!id) {
        const [made] = await rows<{ id: number }>(
          tx,
          sql`insert into tender_found (source, ref_no, title, agency_name, agency_key, agency_id, notice_type, procurement_mode, abc, published_on, closing_at, link, items_text, details, molecules)
            values (${source}, ${refNo}, ${title}, ${agency}, ${values.agencyKey}, ${values.agencyId}, ${values.noticeType}, ${values.mode}, ${values.abc},
              ${values.publishedOn}::date, ${values.closingAt}::timestamptz, ${values.link}, ${itemsText}, ${JSON.stringify(sent ?? {})}::jsonb, ${`{${molecules.map((name) => JSON.stringify(name)).join(",")}}`}::text[])
            returning id::int as id`,
        );
        id = made?.id as number;
        fresh += 1;
      } else
        await tx.execute(
          sql`update tender_found set title = ${title}, agency_name = coalesce(${agency}, agency_name), agency_key = coalesce(${values.agencyKey}, agency_key),
              agency_id = coalesce(agency_id, ${values.agencyId}), notice_type = coalesce(${values.noticeType}, notice_type),
              procurement_mode = coalesce(${values.mode}, procurement_mode), abc = coalesce(${values.abc}, abc),
              published_on = coalesce(${values.publishedOn}::date, published_on), closing_at = coalesce(${values.closingAt}::timestamptz, closing_at),
              link = coalesce(${values.link}, link), items_text = coalesce(${itemsText}, items_text), details = details || ${JSON.stringify(sent ?? {})}::jsonb,
              molecules = ${`{${molecules.map((name) => JSON.stringify(name)).join(",")}}`}::text[], seen_at = now()
            where id = ${id}`,
        );
      if (!reread) return;
      const key = createHash("sha1")
        .update(JSON.stringify(lines.map((line) => [line.origin, line.itemNo, line.description, line.qty, line.unit, line.abcUnit, line.abcTotal, line.match.medicineId, line.match.molecules])))
        .digest("hex");
      if (key === known?.linesKey) return;
      const picked = await rows<{ description: string; medicineId: number; pickedBy: number }>(
        tx,
        sql`select description, medicine_id::int as "medicineId", picked_by::int as "pickedBy" from tender_found_line
          where found_id = ${id} and replaced_at is null and picked_by is not null and medicine_id is not null`,
      );
      await tx.execute(sql`update tender_found_line set replaced_at = now() where found_id = ${id} and replaced_at is null`);
      for (const [position, line] of lines.entries()) {
        const pick = picked.find((one) => one.description === line.description);
        await tx.execute(
          sql`insert into tender_found_line (found_id, position, origin, item_no, description, qty, unit, abc_unit, abc_total, molecules, medicine_id, picked_by)
            values (${id}, ${position}, ${line.origin}, ${line.itemNo}, ${line.description}, ${line.qty}, ${line.unit}, ${line.abcUnit}, ${line.abcTotal},
              ${`{${line.match.molecules.map((name) => JSON.stringify(name)).join(",")}}`}::text[], ${pick?.medicineId ?? line.match.medicineId}, ${pick?.pickedBy ?? null})`,
        );
      }
      await tx.execute(sql`update tender_found set lines_key = ${key} where id = ${id}`);
    });
  }
  return { taken: notices.length, fresh, matched };
}

/** A run of the robot, as it reports it. */
export async function noteRun(
  db: Database,
  run: { source?: "philgeps" | "ps"; trigger?: string | null; status: "success" | "failed"; summary?: string | null; found?: number; matched?: number; fresh?: number },
): Promise<void> {
  await db.execute(
    sql`insert into tender_find_run (source, trigger, status, summary, found, matched, fresh)
      values (${run.source ?? "philgeps"}, ${short(run.trigger, 40)}, ${run.status}, ${short(run.summary, 600)}, ${run.found ?? 0}, ${run.matched ?? 0}, ${run.fresh ?? 0})`,
  );
}

/** Notices screened in the bidding team's own system, screened here too (only ones not screened
 *  here yet; taking one off there does not take it off here: a person of the CRM does that). */
export async function takeScreened(db: Database, marks: { source: "philgeps" | "ps"; ref: string; by?: string | null; at?: string | null }[]): Promise<{ screened: number }> {
  let screened = 0;
  for (const mark of marks) {
    const at = mark.at && !Number.isNaN(Date.parse(mark.at)) ? new Date(Date.parse(mark.at)).toISOString() : null;
    const done = await rows<{ id: number }>(
      db,
      sql`update tender_found set screened_at = coalesce(${at}::timestamptz, now()), screened_as = ${short(mark.by, 80) ? `${short(mark.by, 80)} (in the bidding system)` : "In the bidding system"}
        where source = ${mark.source} and ref_no = ${mark.ref} and screened_at is null returning id::int as id`,
    );
    screened += done.length;
  }
  return { screened };
}

/** When the bidding team's own system last handed its tenders over without a problem: the next
 *  hand-over sends only what changed since. */
export async function feedSince(db: Database): Promise<{ since: string | null }> {
  const [last] = await rows<{ at: string }>(
    db,
    sql`select to_char(at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as at from tender_find_run where trigger = 'feed' and status = 'success' order by at desc limit 1`,
  );
  return { since: last?.at ?? null };
}

/** Our molecules for the robot, in the shape of its own list: [{ name, match: [spellings] }]. */
export async function robotMolecules(db: Database): Promise<{ name: string; match: string[] }[]> {
  const names = new Map<string, string>();
  for (const one of await ourMedicines(db)) {
    const name = moleculeName(one.generic);
    if (lookedFor(name)) names.set(name.toLowerCase(), name);
  }
  return [...names.values()].sort().map((name) => ({ name, match: aliasesOf(name) }));
}

/** Which of these notices are kept with their page already read, with what was read: the robot
 *  opens only the pages of the others. Amounts back in pesos, as it sent them. */
export async function robotKnown(db: Database, source: "philgeps" | "ps", refs: string[]) {
  if (!refs.length) return [];
  const found = await rows<{ ref_no: string; items_text: string; abc: number | null; details: Record<string, unknown> }>(
    db,
    sql`select ref_no, items_text, abc::float8 as abc, details from tender_found
      where source = ${source} and items_text is not null and ref_no in (${sql.join(refs.map((ref) => sql`${ref}`), sql`, `)})`,
  );
  return found.map((one) => ({ ref_no: one.ref_no, items_text: one.items_text, abc_amount: one.abc === null ? null : one.abc / 100, details: one.details }));
}

// ---------------------------------------------------------------- the team's pages

/** The seats that have the finder: the ones that record tenders (the bidding line, the mentor
 *  above it, the CEO, the Admin, a government bidding coachee). */
export const finds = recordsTenders;
async function mustFind(db: Database, me: Me): Promise<void> {
  if (!(await finds(db, me))) throw new Refusal(403, "not_allowed", "The tender finder is the bidding team's.");
}

/** A found tender's type as the bidding system shows it (its tenderType.js): on PhilGEPS the short form at
 *  the end of the notice type ("Invitation to Bid (ITB)" → ITB), on PS-PhilGEPS from the mode
 *  (competitive/public bidding → ITB, small value/shopping → RFQ, negotiated → Negotiated), else as written. */
const TYPE = sql`(case when f.source = 'ps' then (case
      when f.procurement_mode ~* 'public bidding|competitive bidding' then 'ITB'
      when f.procurement_mode ~* 'small value|shopping' then 'RFQ'
      when f.procurement_mode ~* 'negotiated' then 'Negotiated'
      else coalesce(f.procurement_mode, '') end)
    else coalesce(substring(f.notice_type from '\\(([A-Za-z0-9]+)\\)\\s*$'), case when f.notice_type ~* 'negotiated' then 'Negotiated' end, f.notice_type, '') end)`;
/** Its papers: the files kept here, or (from the bidding system's hand-over) the ones its reading names. */
const FILES = sql`greatest((select count(*) from tender_found_file x where x.found_id = f.id),
    case when jsonb_typeof(f.details->'documents') = 'array' then jsonb_array_length(f.details->'documents') else 0 end)`;
/** The bidding system's document chips: with papers, pick-up only (the papers are only given at the office), none yet. */
const DOCS = {
  with: sql`${FILES} > 0`,
  pickup: sql`${FILES} = 0 and f.details->>'documents_status' = 'pick-up'`,
  none: sql`${FILES} = 0 and coalesce(f.details->>'documents_status', '') <> 'pick-up'`,
} as const;

const foundSelect = sql`select f.id::int as id, f.source, f.ref_no as "refNo", f.title, f.agency_name as agency, f.agency_id::int as "agencyId", c.name as customer,
    f.notice_type as "noticeType", f.procurement_mode as "procurementMode", f.abc::float8 as abc, to_char(f.published_on, 'YYYY-MM-DD') as "publishedOn",
    to_char(f.closing_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "closingAt", f.link, f.molecules,
    to_char(f.first_seen_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "firstSeenAt", to_char(f.screened_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "screenedAt", coalesce(p.name, f.screened_as) as "screenedBy",
    f.tender_id::int as "tenderId", t.code as "tenderCode", (f.closing_at is null or f.closing_at >= now()) as open,
    (select count(*) from tender_found_line l where l.found_id = f.id and l.replaced_at is null)::int as lines,
    ${TYPE} as type, ${FILES}::int as files, f.details->>'documents_status' as "docsStatus"
  from tender_found f left join customer c on c.id = f.agency_id left join person p on p.id = f.screened_by left join tender t on t.id = f.tender_id`;

const VIEW: Record<FoundView, SQL> = {
  // Opportunities: every tender found that is ours, whatever its state (open or closed, screened, made a
  // tender): one asking for one of our molecules, or any PS-PhilGEPS tender (the robot reads PS-PhilGEPS's
  // Bid Match, which the portal itself matched to the company's registered products, as the bidding
  // system's Bid Match page shows them; most have no lines yet until their papers are read).
  // "Everything found" adds PhilGEPS's medicine notices that ask for none of ours.
  opportunities: sql`(cardinality(f.molecules) > 0 or f.source = 'ps')`,
  screened: sql`f.screened_at is not null and f.tender_id is null`,
  tenders: sql`f.tender_id is not null`,
  all: sql`true`,
};
/** The bidding system's sorts. Tenders first fetched in the last 24 hours (the New pill) come first in each. */
const SORT: Record<FoundSort, SQL> = {
  latest: sql`f.published_on desc nulls last, f.id desc`,
  oldest: sql`f.published_on asc nulls last, f.ref_no`,
  closing: sql`f.closing_at asc nulls last, f.published_on desc nulls last, f.id desc`,
  budget: sql`f.abc desc nulls last, f.published_on desc nulls last, f.id desc`,
};
const FRESH = sql`(f.first_seen_at > now() - interval '24 hours')`;
const PAGE_SIZES = [25, 50, 100] as const;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export type FoundAsk = {
  view?: string | null;
  q?: string | null;
  source?: string | null;
  molecule?: string | null;
  type?: string | null;
  /** Our medicines to leave out, comma-separated: a tender asking for any of them is hidden. */
  exclude?: string | null;
  docs?: string | null;
  sort?: string | null;
  /** The date range: on the published day or the closing day, from and to (YYYY-MM-DD, both inclusive). */
  dateOn?: string | null;
  from?: string | null;
  to?: string | null;
  page?: string | null;
  size?: string | null;
};

/** The finder's list, as the bidding system's Bid Match page: the tab, then search (every word), portal,
 *  our medicine, type, medicines left out and a date range; the document chips on top of those; the
 *  summary cards over what is listed; one page at a time. */
export async function listFound(db: Database, me: Me, asked: FoundAsk): Promise<FoundList> {
  await mustFind(db, me);
  const view: FoundView = asked.view === "screened" || asked.view === "tenders" || asked.view === "all" ? asked.view : "opportunities";
  const docs: FoundDocs = asked.docs === "with" || asked.docs === "pickup" || asked.docs === "none" ? asked.docs : "all";
  const sort: FoundSort = asked.sort === "oldest" || asked.sort === "closing" || asked.sort === "budget" ? asked.sort : "latest";
  const size = PAGE_SIZES.find((one) => String(one) === asked.size) ?? 25;
  const page = Math.max(1, Math.min(10_000, Math.floor(Number(asked.page)) || 1));

  // The filters the tabs, chips and cards all follow (the bidding system: search, dates, portal, product, type, left out).
  const filters: SQL[] = [];
  for (const word of (asked.q ?? "").trim().slice(0, 120).split(/\s+/).filter(Boolean).slice(0, 8)) {
    const like = `%${word.replace(/[\\%_]/g, "\\$&")}%`;
    filters.push(sql`(f.title ilike ${like} or f.agency_name ilike ${like} or f.ref_no ilike ${like} or array_to_string(f.molecules, ' ') ilike ${like})`);
  }
  if (asked.source === "philgeps" || asked.source === "ps") filters.push(sql`f.source = ${asked.source}`);
  if (asked.molecule?.trim()) filters.push(sql`${asked.molecule.trim()} = any(f.molecules)`);
  if (asked.type?.trim()) filters.push(sql`${TYPE} = ${asked.type.trim().slice(0, 80)}`);
  const leftOut = (asked.exclude ?? "").split(",").map((one) => one.trim()).filter(Boolean).slice(0, 200);
  if (leftOut.length) filters.push(sql`not (f.molecules && ${`{${leftOut.map((name) => JSON.stringify(name)).join(",")}}`}::text[])`);
  const day = asked.dateOn === "closing" ? sql`(f.closing_at at time zone 'Asia/Manila')::date` : sql`f.published_on`;
  if (asked.from && DAY.test(asked.from)) filters.push(sql`${day} >= ${asked.from}::date`);
  if (asked.to && DAY.test(asked.to)) filters.push(sql`${day} <= ${asked.to}::date`);
  const where = filters.length ? sql.join(filters, sql` and `) : sql`true`;
  const listed = sql`${VIEW[view]} and ${where} and ${docs === "all" ? sql`true` : DOCS[docs]}`;

  const [found, [counts], [docCounts], [stats], products, types, runs, login, ps, fetch] = await Promise.all([
    rows<FoundTender>(db, sql`${foundSelect} where ${listed} order by ${FRESH} desc, ${SORT[sort]} limit ${size} offset ${(page - 1) * size}`),
    rows<Record<FoundView, number>>(
      db,
      sql`select count(*) filter (where ${VIEW.opportunities})::int as opportunities, count(*) filter (where ${VIEW.screened})::int as screened,
          count(*) filter (where ${VIEW.tenders})::int as tenders, count(*)::int as all
        from tender_found f where ${where} and ${docs === "all" ? sql`true` : DOCS[docs]}`,
    ),
    rows<Record<FoundDocs, number>>(
      db,
      sql`select count(*)::int as all, count(*) filter (where ${DOCS.with})::int as with, count(*) filter (where ${DOCS.pickup})::int as pickup,
          count(*) filter (where ${DOCS.none})::int as none
        from tender_found f where ${VIEW[view]} and ${where}`,
    ),
    rows<FoundList["stats"]>(
      db,
      sql`select count(*)::int as listed, coalesce(sum(f.abc), 0)::float8 as abc, coalesce(sum(${FILES}), 0)::int as files,
          count(*) filter (where ${FILES} > 0)::int as "withFiles",
          (select count(distinct m) from tender_found f, unnest(f.molecules) m where ${listed})::int as products,
          (select count(*) from tender_found f where ${VIEW.opportunities} and not (f.molecules && ${`{${leftOut.map((name) => JSON.stringify(name)).join(",")}}`}::text[]))::int as ours,
          (select count(distinct m) from tender_found f, unnest(f.molecules) m where ${VIEW[view]})::int as "productsAll"
        from tender_found f where ${listed}`,
    ),
    // Our medicines in this tab, most asked for first, for "Our product" and "Exclude products".
    rows<{ name: string; n: number }>(db, sql`select m as name, count(*)::int as n from tender_found f, unnest(f.molecules) m where ${VIEW[view]} group by m order by n desc, m`),
    rows<{ code: string; n: number }>(db, sql`select ${TYPE} as code, count(*)::int as n from tender_found f where ${VIEW[view]} and ${where} group by 1 having ${TYPE} <> '' order by n desc, 1`),
    lastRuns(db),
    robotLoginState(db),
    psState(db),
    fetchState(db),
  ]);
  return {
    view,
    docs,
    sort,
    page,
    pageSize: size,
    total: docCounts?.[docs] ?? 0,
    rows: found,
    counts: counts ?? { opportunities: 0, screened: 0, tenders: 0, all: 0 },
    docCounts: docCounts ?? { all: 0, with: 0, pickup: 0, none: 0 },
    stats: stats ?? { listed: 0, ours: 0, products: 0, productsAll: 0, abc: 0, files: 0, withFiles: 0 },
    products,
    types,
    molecules: products.map((one) => one.name).sort((a, b) => a.localeCompare(b)),
    robot: { ready: robotReady(), runs, login, ps, fetch },
  };
}

/** The robot's last runs: six of each portal, and six of the bridge's hand-overs from the bidding
 *  system (trigger "feed", which hands over both portals), so each portal's card has its own. */
const lastRuns = (db: Database) =>
  rows<FindRun>(
    db,
    sql`select id, source, trigger, status, summary, found, matched, fresh, at from (
        select id::int as id, source, trigger, status, summary, found, matched, fresh, to_char(at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as at, at as moment,
          row_number() over (partition by source, coalesce(trigger, '') = 'feed' order by at desc, id desc) as n
        from tender_find_run
      ) runs where n <= 6 order by moment desc, id desc`,
  );

/** For the Tenders page's button: whether this seat has the finder, and how many Opportunities the robot
 *  first fetched in the last 24 hours (the finder's New pill). */
export async function foundCount(db: Database, me: Me): Promise<{ allowed: boolean; fresh: number }> {
  if (!(await finds(db, me))) return { allowed: false, fresh: 0 };
  const [count] = await rows<{ n: number }>(db, sql`select count(*)::int as n from tender_found f where ${VIEW.opportunities} and f.first_seen_at > now() - interval '24 hours'`);
  return { allowed: true, fresh: count?.n ?? 0 };
}

export async function foundDetail(db: Database, me: Me, id: number): Promise<FoundDetail> {
  await mustFind(db, me);
  const [found] = await rows<FoundTender & { itemsText: string | null; raw: Record<string, unknown>; agencyKey: string | null }>(
    db,
    sql`select one.*, f.items_text as "itemsText", f.details as raw, f.agency_key as "agencyKey"
      from (${foundSelect} where f.id = ${id}) one join tender_found f on f.id = one.id`,
  );
  if (!found) throw new Refusal(404, "not_found", "No such notice.");
  const { raw, agencyKey: key, ...rest } = found;
  const [lineRows, events, medicines, prices] = await Promise.all([
    rows<Omit<FoundLine, "candidates" | "medicine">>(
      db,
      sql`select id::int as id, origin, item_no as "itemNo", description, qty::float8 as qty, unit, abc_unit::float8 as "abcUnit", abc_total::float8 as "abcTotal",
          molecules, medicine_id::int as "medicineId"
        from tender_found_line where found_id = ${id} and replaced_at is null order by position, id`,
    ),
    rows<{ what: string; note: string | null; by: string; at: string }>(
      db,
      sql`select e.what, e.note, p.name as by, to_char(e.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as at from tender_found_event e join person p on p.id = e.by_person where e.found_id = ${id} order by e.at, e.id`,
    ),
    ourMedicines(db),
    // Our price starts from the price book's Bidding price.
    rows<{ id: number; amount: number }>(db, sql`select medicine_id::int as id, amount from medicine_price where buyer_type = 'bidding'`),
  ]);
  const priceOf = new Map(prices.map((one) => [one.id, one.amount]));
  const label = (one: FinderMedicine) => `${one.name}${one.strength ? ` ${one.strength}` : ""}`;
  const byMolecule = new Map<string, FinderMedicine[]>();
  for (const one of medicines) {
    const name = moleculeName(one.generic);
    byMolecule.set(name, [...(byMolecule.get(name) ?? []), one]);
  }
  const byId = new Map(medicines.map((one) => [one.id, one]));
  const lines: FoundLine[] = lineRows.map((line) => {
    const could = line.molecules.flatMap((name) => byMolecule.get(name) ?? []);
    const picked = line.medicineId !== null ? byId.get(line.medicineId) : undefined;
    const list = picked && !could.some((one) => one.id === picked.id) ? [picked, ...could] : could;
    return {
      ...line,
      medicine: picked ? label(picked) : null,
      candidates: list.map((one) => ({ id: one.id, name: label(one), price: priceOf.get(one.id) ?? null })),
    };
  });
  // The customers the agency could be: the one matched, then the names sharing its first words.
  const words = (key ?? "").split(" ").filter((word) => word.length >= 4).slice(0, 2);
  const agencies = await rows<{ id: number; name: string; city: string | null }>(
    db,
    sql`select id::int as id, name, city from customer
      where active and kind in ('government', 'hospital')
        and (id = ${rest.agencyId ?? 0} or ${words.length ? sql.join(words.map((word) => sql`name ilike ${`%${word}%`}`), sql` and `) : sql`false`})
      order by (id = ${rest.agencyId ?? 0}) desc, name limit 8`,
  );
  const text = (name: string) => short(raw[name], 400);
  return {
    found: {
      ...rest,
      itemsText: found.itemsText,
      details: {
        solicitationNo: text("solicitation_no"),
        classification: text("classification"),
        areaOfDelivery: text("area_of_delivery"),
        deliveryPeriod: text("delivery_period"),
        contactName: text("contact_name"),
        contactInfo: Array.isArray(raw.contact_info) ? (raw.contact_info as unknown[]).map((one) => short(one, 200)).filter((one): one is string => one !== null) : [],
        preBid: text("pre_bid"),
        bidOpening: text("bid_opening"),
        status: text("status"),
        supplements: Array.isArray(raw.supplements) ? (raw.supplements as FoundDetail["found"]["details"]["supplements"]) : [],
        documents: Array.isArray(raw.documents) ? (raw.documents as { name: string }[]).map((one) => one.name) : [],
      },
    },
    lines,
    papers: await papersOf(db, id, raw),
    events,
    agencies,
    mode: modeOf(rest.noticeType, rest.procurementMode),
    prebidOn: dayIn(text("pre_bid")),
    openingOn: dayIn(text("bid_opening")),
  };
}

/** Onto the team's screened list, or off it (kept: who and when). */
export async function screenFound(db: Database, me: Me, id: number, on: boolean): Promise<void> {
  await mustFind(db, me);
  const [found] = await rows<{ screened: boolean; tenderId: number | null }>(
    db,
    sql`select screened_at is not null as screened, tender_id::int as "tenderId" from tender_found where id = ${id}`,
  );
  if (!found) throw new Refusal(404, "not_found", "No such notice.");
  if (found.screened === on) return;
  if (!on && found.tenderId) throw new Refusal(409, "is_tender", "It is a tender already: drop the tender itself if it is not pursued.");
  await db.transaction(async (tx) => {
    await tx.execute(sql`update tender_found set screened_at = ${on ? sql`now()` : sql`null`}, screened_by = ${on ? me.id : null} where id = ${id}`);
    await tx.execute(sql`insert into tender_found_event (found_id, what, by_person) values (${id}, ${on ? "screened" : "unscreened"}, ${me.id})`);
  });
}

export type MakeTenderInput = {
  agencyId: number;
  mode: TenderMode;
  title?: string | null;
  /** The lines bid: the notice's line, our medicine for it, how many pieces, our price for one. */
  lines: { lineId: number; medicineId: number; qty: number; unitPrice: number }[];
};

/** The join: a found notice becomes a CRM tender, with its agency, budget, dates, reference and
 *  the lines matched to our medicines. One notice, one tender; from here the tender's own road. */
export async function makeTender(db: Database, me: Me, id: number, input: MakeTenderInput): Promise<{ id: number }> {
  await mustFind(db, me);
  const detail = await foundDetail(db, me, id);
  const found = detail.found;
  if (found.tenderId) throw new Refusal(409, "is_tender", `It is tender ${found.tenderCode} already.`);
  const known = new Map(detail.lines.map((line) => [line.id, line]));
  for (const line of input.lines) if (!known.has(line.lineId)) throw new Refusal(400, "invalid", "A line is not this notice's any more. Open the notice again.", "lines");
  const medicineIds = [...new Set(input.lines.map((line) => line.medicineId))];
  if (medicineIds.length) {
    const active = await rows<{ id: number }>(
      db,
      sql`select id::int as id from medicine where active and id in (${sql.join(medicineIds.map((one) => sql`${one}`), sql`, `)})`,
    );
    if (active.length !== medicineIds.length) throw new Refusal(400, "invalid", "Pick a medicine we keep for each line.", "lines");
  }
  return db.transaction(async (tx) => {
    const inside = tx as unknown as Database;
    const [held] = await rows<{ tenderId: number | null; agencyKey: string | null; agencyId: number | null }>(
      tx,
      sql`select tender_id::int as "tenderId", agency_key as "agencyKey", agency_id::int as "agencyId" from tender_found where id = ${id} for update`,
    );
    if (!held || held.tenderId) throw new Refusal(409, "is_tender", "It was made a tender a moment ago.");
    const made = await createTender(inside, me, {
      agencyId: input.agencyId,
      title: (input.title?.trim() || found.title).slice(0, 300),
      philgepsRef: found.refNo,
      mode: input.mode,
      abc: found.abc,
      postedOn: found.publishedOn,
      prebidOn: detail.prebidOn,
      deadlineAt: found.closingAt,
      openingOn: detail.openingOn,
    });
    if (input.lines.length)
      await setLines(inside, me, made.id, input.lines.map((line) => ({ medicineId: line.medicineId, qty: line.qty, unitPrice: line.unitPrice })));
    // A medicine picked by hand stays on the notice's line.
    for (const line of input.lines)
      if (known.get(line.lineId)?.medicineId !== line.medicineId)
        await tx.execute(sql`update tender_found_line set medicine_id = ${line.medicineId}, picked_by = ${me.id} where id = ${line.lineId} and found_id = ${id}`);
    await tx.execute(
      sql`update tender_found set tender_id = ${made.id}, agency_id = ${input.agencyId},
          screened_at = coalesce(screened_at, now()), screened_by = coalesce(screened_by, ${me.id})
        where id = ${id}`,
    );
    // The agency picked by hand is remembered for its other notices.
    if (held.agencyId !== input.agencyId) {
      if (held.agencyKey) await tx.execute(sql`update tender_found set agency_id = ${input.agencyId} where agency_key = ${held.agencyKey} and tender_id is null`);
      await tx.execute(sql`insert into tender_found_event (found_id, what, note, by_person) values (${id}, 'agency', (select name from customer where id = ${input.agencyId}), ${me.id})`);
    }
    const [code] = await rows<{ code: string }>(tx, sql`select code from tender where id = ${made.id}`);
    await tx.execute(sql`insert into tender_found_event (found_id, what, note, by_person) values (${id}, 'tender', ${code?.code ?? null}, ${me.id})`);
    // The tender's first line of history says where it came from.
    await tx.execute(
      sql`update tender_event set note = ${`From the tender finder: ${found.source === "ps" ? "PS-PhilGEPS" : "PhilGEPS"} ${found.refNo}`}
        where tender_id = ${made.id} and step = 'found'`,
    );
    return made;
  });
}
