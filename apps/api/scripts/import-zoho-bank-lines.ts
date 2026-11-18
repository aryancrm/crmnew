// Zoho Books' bank statement lines never categorized there (193 on 18 Nov 2026, read from Zoho's
// Banking → Uncategorized, read only) into the CRM's statements (docs/BOOKS-PLAN.md C), each with
// Zoho's id so a rerun adds nothing. Dry run by default; --apply writes.
//
//   TEST_PGLITE_DIR=<a local database>   (the API must be stopped: one process per folder)
//   npx tsx scripts/import-zoho-bank-lines.ts [--apply] [--file .data/zoho-api/uncategorized-bank-lines.json]

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { addStatementLines, type StatementRow } from "../src/books/bank";
import { openDatabase, rows } from "../src/db/index";
import { migrate } from "../src/db/migrate";

const ROOT = join(import.meta.dirname, "../../..");
const apply = process.argv.includes("--apply");
const at = process.argv.indexOf("--file");
const file = at > 0 ? (process.argv[at + 1] as string) : join(ROOT, ".data/zoho-api/uncategorized-bank-lines.json");
if (!process.env.TEST_PGLITE_DIR) throw new Error("Give TEST_PGLITE_DIR (a local database); the live database needs Aryan's word.");

const lines = JSON.parse(readFileSync(file, "utf8")) as (StatementRow & { account: string })[];
const db = openDatabase({ dir: process.env.TEST_PGLITE_DIR });
await migrate(db);
const byAccount = new Map<string, StatementRow[]>();
for (const { account, ...line } of lines) byAccount.set(account, [...(byAccount.get(account) ?? []), line]);
let added = 0;
let skipped = 0;
await db
  .transaction(async (tx) => {
    for (const [account, list] of byAccount) {
      const result = await addStatementLines(tx, account, { fileName: "Zoho Books: uncategorized", rows: list }, null);
      added += result.added;
      skipped += result.skipped;
      console.log(`${account}: ${result.added} added, ${result.skipped} already here`);
    }
    if (!apply) throw new Error("dry run");
  })
  .catch((error: Error) => {
    if (error.message !== "dry run") throw error;
  });
const [count] = await rows<{ n: number }>(db, sql`select count(*)::int as n from bank_line`);
console.log(`${apply ? "Applied" : "Dry run"}: ${added} added, ${skipped} already here; ${count?.n ?? 0} statement lines in all.`);
process.exit(0);
