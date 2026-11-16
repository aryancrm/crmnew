// What the import scripts share: reading Zoho's backup (CSV files), and opening the database to
// bring it into (the live one, a copy of a local one, or one that lasts only for the run).

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { type Database, openDatabase, rows } from "../src/db/index";
import { migrate } from "../src/db/migrate";
import { seedDemo } from "../src/seed";

export const ROOT = join(import.meta.dirname, "../../..");
/** Where Zoho's backup is unpacked (its inner zips too). */
export const ZOHO_DIR = process.env.ZOHO_DIR ?? join(ROOT, ".data/zoho-backup");

/** One CSV as rows of text (quotes, commas and line breaks inside a quoted cell kept). */
export function parseCsv(text: string): string[][] {
  const found: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let at = text.charCodeAt(0) === 0xfeff ? 1 : 0; at < text.length; at++) {
    const char = text[at];
    if (quoted) {
      if (char === '"') {
        if (text[at + 1] === '"') {
          cell += '"';
          at++;
        } else quoted = false;
      } else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[at + 1] === "\n") at++;
      row.push(cell);
      cell = "";
      found.push(row);
      row = [];
    } else cell += char;
  }
  if (cell || row.length) {
    row.push(cell);
    found.push(row);
  }
  return found;
}

export type Row = Record<string, string>;

/** Every row of one of the backup's files, by column name. A folder (Contacts/) is its files
 *  (Contacts00.csv, Contacts01.csv…) one after another. */
export function* rowsOf(name: string, dir = ZOHO_DIR): Generator<Row> {
  const path = join(dir, name);
  if (!existsSync(path)) return;
  const files = statSync(path).isDirectory()
    ? readdirSync(path)
        .filter((file) => file.endsWith(".csv"))
        .sort()
        .map((file) => join(path, file))
    : [path];
  for (const file of files) {
    const [first, ...lines] = parseCsv(readFileSync(file, "utf8"));
    if (!first) continue;
    // A column named twice (Packages have two "Billing Address" columns) keeps both: "(2)".
    const head = first.map((column, at) => (first.indexOf(column) === at ? column : `${column} (2)`));
    for (const line of lines) {
      if (line.length === 1 && !line[0]) continue;
      const row: Row = {};
      head.forEach((column, index) => {
        row[column] = line[index] ?? "";
      });
      yield row;
    }
  }
}

export const said = (value: string | undefined) => (value ?? "").trim();
export const numberOf = (value: string | undefined) => {
  const found = Number(said(value).replace(/^PHP\s*/i, "").replace(/,/g, ""));
  return Number.isFinite(found) ? found : 0;
};
export const cut = (value: string, max: number) =>
  (value.length > max ? value.slice(0, max) : value) || null;
export const isDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

function envFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => /^[A-Z_]+=/.test(line))
      .map((line) => {
        const at = line.indexOf("=");
        return [line.slice(0, at), line.slice(at + 1).trim().replace(/^"|"$/g, "")];
      }),
  );
}

/**
 * The database to bring the data into: `--memory` one that lasts as long as the run (with the
 * demo people, to try the whole of it), TEST_PGLITE_DIR a local one (a copy, to try it there
 * first), else the live one: DATABASE_URL, or crmnew/.env.live (never committed; the API itself
 * does not read it), or crmnew/.env. None given: null (the script only counts).
 */
export async function openTarget(memory: boolean): Promise<{ db: Database; where: string } | null> {
  const url =
    process.env.DATABASE_URL ||
    envFile(join(ROOT, ".env.live")).DATABASE_URL ||
    envFile(join(ROOT, ".env")).DATABASE_URL;
  const testDir = process.env.TEST_PGLITE_DIR;
  if (!memory && !testDir && !url) return null;
  const db = memory
    ? openDatabase({ dir: "memory" })
    : testDir
      ? openDatabase({ dir: testDir })
      : openDatabase({ url });
  if (memory || testDir) await migrate(db);
  if (memory) await seedDemo(db, "not-a-real-password-1");
  // A database that has not had this change's migration yet (the live API still starting).
  const [here] = await rows<{ here: string | null }>(
    db,
    sql`select to_regclass('past_invoice')::text as here`,
  );
  if (!here?.here) {
    console.log(
      "This database has not had the latest migration yet: let the API start once on the new code (it migrates), then run this again.",
    );
    process.exit(1);
  }
  return { db, where: memory ? "a database for this run only" : testDir ? testDir : "the live database" };
}

/** Adds up the summaries of several batches. */
export function addUp<T extends Record<string, unknown>>(sum: T | null, part: T): T {
  if (!sum) return structuredClone(part);
  const next: Record<string, unknown> = { ...sum };
  for (const [key, value] of Object.entries(part)) {
    if (typeof value === "number") next[key] = ((next[key] as number) ?? 0) + value;
    else if (Array.isArray(value)) next[key] = [...((next[key] as unknown[]) ?? []), ...value];
    else if (value && typeof value === "object")
      next[key] = addUp((next[key] as Record<string, unknown>) ?? null, value as Record<string, unknown>);
  }
  return next as T;
}
