// The tender papers (docs/PLAN.md 24): the bid documents of the notices the team screened. The
// robot gets them from PhilGEPS with the company's own log-in (it "orders" them there at no cost
// and stops at anything that asks a payment), reads them (PDF, Word, Excel; scans by OCR) and hands
// in the files and the lines read. Here: which notices want their papers, the files kept (through
// the file store), the robot's log-ins (so it makes few and never repeats a refused password), and
// what the notice's page shows of all that.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { bytesOf, keepFile } from "../files/store";
import { Refusal } from "../http";
import type { FoundPapers, Me } from "../types";
import { finds, lookedFor, moleculeName } from "./finder";

/** Our medicines as the robot's paper reader wants its product list: one row per medicine, the
 *  molecule, the brand and the strength (it matches a line by molecule AND strength). */
export async function robotProducts(db: Database) {
  const medicines = await rows<{ id: number; name: string; generic: string; strength: string | null; form: string | null; pack: string | null }>(
    db,
    sql`select id::int as id, name, generic, strength, form, pack from medicine where active and coalesce(trim(generic), '') <> '' order by id`,
  );
  return medicines
    .filter((one) => lookedFor(moleculeName(one.generic)))
    .map((one) => ({
      id: one.id,
      generic_name: one.generic,
      brand_name: one.name,
      dosage: one.strength ?? "-",
      dosage_form: one.form,
      unit: null,
      pack_size: one.pack,
    }));
}

/** The notices whose papers the robot looks after: the ones the team screened on PhilGEPS that
 *  are still open (a person's choice decides what is ordered in the company's name). In the shape
 *  the robot keeps a notice in; it applies its own rules for what is still to fetch or to read. */
export async function papersWanted(db: Database) {
  return rows<Record<string, unknown>>(
    db,
    sql`select ref_no, title, agency_name as procuring_entity, to_char(published_on, 'YYYY-MM-DD') as publish_date,
        to_char(closing_at at time zone 'Asia/Manila', 'YYYY-MM-DD HH24:MI:SS') as closing_date, abc::float8 / 100 as abc_amount,
        molecules as matched_molecules, items_text, details,
        -- The papers the CRM itself keeps (the robot reads again only what it can ask back).
        coalesce((select array_agg(k.path) from tender_found_file k where k.found_id = tender_found.id), '{}') as kept
      from tender_found
      where source = 'philgeps' and screened_at is not null and (closing_at is null or closing_at >= now())
      order by closing_at nulls last, id
      limit 60`,
  );
}

const MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".zip": "application/zip",
  ".rar": "application/vnd.rar",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};
/** A file's type from its name: what the robot says is not taken on trust for what the browser is told. */
const mimeOf = (name: string) => MIME[(/\.[^.]+$/.exec(name)?.[0] ?? "").toLowerCase()] ?? "application/octet-stream";

/** A paper the robot downloaded, kept on its notice. The same path again takes the earlier copy's place. */
export async function keepPaper(db: Database, input: { source?: "philgeps" | "ps"; ref: string; path: string; name: string; bulletin: boolean; bytes: Uint8Array }): Promise<{ id: number }> {
  const [found] = await rows<{ id: number }>(db, sql`select id::int as id from tender_found where source = ${input.source ?? "philgeps"} and ref_no = ${input.ref}`);
  if (!found) throw new Refusal(404, "not_found", "No such notice.");
  if (!input.bytes.byteLength) throw new Refusal(400, "invalid", "The file is empty.");
  const name = input.name.replace(/[\u0000-\u001f<>:"/\\|?*]/g, "_").trim().slice(0, 200) || "paper";
  // A paper is kept as it came: only photos are made smaller by the store, and these are not photos to shrink.
  const kept = await keepFile("tender-papers", { name, mime: mimeOf(name) === "image/jpeg" || mimeOf(name) === "image/png" ? "application/octet-stream" : mimeOf(name), bytes: input.bytes });
  const [made] = await rows<{ id: number }>(
    db,
    sql`insert into tender_found_file (found_id, kind, path, name, mime, size, data, store_key)
      values (${found.id}, ${input.bulletin ? "bulletin" : "paper"}, ${input.path.slice(0, 400)}, ${name}, ${mimeOf(name)}, ${kept.size}, ${kept.data}, ${kept.key})
      on conflict (found_id, path) do update set name = excluded.name, mime = excluded.mime, size = excluded.size, data = excluded.data,
        store_key = excluded.store_key, kind = excluded.kind, at = now()
      returning id::int as id`,
  );
  return made as { id: number };
}

type FileRow = { id: number; name: string; mime: string; data: Uint8Array | null; key: string | null };
const fileSelect = sql`select f.id::int as id, f.name, f.mime, f.data, f.store_key as key from tender_found_file f`;

/** A kept paper back to the robot (a scan it could not finish reading is read again without a new log-in). */
export async function paperForRobot(db: Database, ref: string, path: string): Promise<Uint8Array | null> {
  const [file] = await rows<FileRow>(db, sql`${fileSelect} join tender_found t on t.id = f.found_id where t.source = 'philgeps' and t.ref_no = ${ref} and f.path = ${path}`);
  return file ? bytesOf(file) : null;
}

/** A kept paper for a person: the seats that have the finder. */
export async function foundFile(db: Database, me: Me, id: number): Promise<{ name: string; mime: string; bytes: Uint8Array }> {
  if (!(await finds(db, me))) throw new Refusal(403, "not_allowed", "The tender finder is the bidding team's.");
  const [file] = await rows<FileRow>(db, sql`${fileSelect} where f.id = ${id}`);
  if (!file) throw new Refusal(404, "not_found", "No such paper.");
  return { name: file.name, mime: file.mime, bytes: await bytesOf(file) };
}

const SHEET: [string, string][] = [
  ["Pre-bid conference", "prebid_conference"],
  ["Bid opening", "bid_opening"],
  ["Deadline for bids", "bid_submission_deadline"],
  ["Delivery", "delivery_period"],
  ["Bid validity", "bid_validity"],
  ["Bid security", "bid_security"],
];

/** What the notice's page shows of its papers: the files kept, and what the robot said of them. */
export async function papersOf(db: Database, foundId: number, details: Record<string, unknown>): Promise<FoundPapers> {
  const files = await rows<FoundPapers["files"][number]>(
    db,
    sql`select id::int as id, kind, name, size from tender_found_file where found_id = ${foundId} order by kind desc, id`,
  );
  const text = (value: unknown, max = 600) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null);
  const sheet = details.documents_bid_data_sheet && typeof details.documents_bid_data_sheet === "object" ? (details.documents_bid_data_sheet as Record<string, unknown>) : {};
  const read = Array.isArray(details.documents_read) ? (details.documents_read as Record<string, unknown>[]) : [];
  const accuracy = details.documents_accuracy && typeof details.documents_accuracy === "object" ? (details.documents_accuracy as { percent?: unknown }).percent : null;
  return {
    files,
    status: text(details.documents_status, 40),
    remark: text(details.documents_remark),
    checkedAt: text(details.documents_checked_at, 40),
    readNote: text(details.documents_read_note),
    // Scanned pages still waiting for their reading (OCR).
    reading: read.some((one) => one.ocr_waiting === true || one.kind === "scanned"),
    accuracy: typeof accuracy === "number" ? Math.round(accuracy) : null,
    sheet: SHEET.flatMap(([label, key]) => {
      const said = text(sheet[key], 400);
      return said ? [{ label, said }] : [];
    }),
  };
}

// ---------------------------------------------------------------- the robot's log-ins

/** The robot's log-ins to a portal since a day, newest first (its guard counts them before a new one). */
export async function robotLogins(db: Database, site: string, since: string | null) {
  const from = since && !Number.isNaN(Date.parse(since)) ? new Date(Date.parse(since)).toISOString() : new Date(Date.now() - 86_400_000).toISOString();
  return rows<{ at: string; outcome: string; detail: string | null }>(
    db,
    sql`select to_char(at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as at, outcome, detail from tender_find_login
      where site = ${site} and at >= ${from}::timestamptz order by at desc, id desc limit 200`,
  );
}

export async function noteRobotLogin(db: Database, input: { site: string; outcome: string; detail?: string | null; source?: string | null }): Promise<void> {
  await db.execute(
    sql`insert into tender_find_login (site, outcome, detail, source) values (${input.site.slice(0, 40)}, ${input.outcome.slice(0, 40)}, ${input.detail?.slice(0, 300) ?? null}, ${input.source?.slice(0, 40) ?? null})`,
  );
}

/** Where the robot's PhilGEPS log-in stands, for the finder's page: the last time it was let in
 *  or turned away. "refused" stops the robot until a person, having put the password right, says
 *  to try again (a refused password sent again and again locks the account). */
export async function robotLoginState(db: Database): Promise<{ state: "never" | "ok" | "refused" | "busy" | "trouble"; at: string | null; said: string | null }> {
  const [last] = await rows<{ outcome: string; detail: string | null; at: string }>(
    db,
    sql`select outcome, detail, to_char(at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as at from tender_find_login
      where site = 'philgeps' and outcome in ('ok', 'rejected', 'busy', 'error', 'cleared', 'unset') order by at desc, id desc limit 1`,
  );
  if (!last || last.outcome === "unset") return { state: "never", at: last?.at ?? null, said: null };
  const state = last.outcome === "ok" || last.outcome === "cleared" ? "ok" : last.outcome === "rejected" ? "refused" : last.outcome === "busy" ? "busy" : "trouble";
  return { state, at: last.at, said: last.outcome === "cleared" ? "A person said to try the log-in again." : last.detail };
}

/** A person, having put the password right where the robot keeps it, lets the robot log in again. */
export async function tryLoginAgain(db: Database, me: Me): Promise<void> {
  if (!(await finds(db, me))) throw new Refusal(403, "not_allowed", "The tender finder is the bidding team's.");
  const { state } = await robotLoginState(db);
  if (state !== "refused") throw new Refusal(409, "not_now", "The robot's log-in is not stopped.");
  await db.execute(sql`insert into tender_find_login (site, outcome, detail, source) values ('philgeps', 'cleared', ${`By ${me.name}`.slice(0, 300)}, 'crm')`);
}
