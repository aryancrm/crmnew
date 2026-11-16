// The files on Zoho's invoices and bills still open when Zoho was closed (read from Zoho in the
// browser into .data/zoho-api/open_files.jsonl), kept on the books' documents (docs/PLAN.md 17).
// Older files stay in Zoho's backup archive. Safe to run again: a file already here is skipped.
//
//   TEST_PGLITE_DIR=<a local database>   (the API must be stopped)
//   npx tsx scripts/import-zoho-files.ts [--apply]

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { rows } from "../src/db/index";
import { keepFile } from "../src/files/store";
import { openTarget, ROOT } from "./zoho-files";

const apply = process.argv.includes("--apply");
if (!process.env.TEST_PGLITE_DIR) throw new Error("Give TEST_PGLITE_DIR (a local database); the live database needs Aryan's word.");
const path = join(ROOT, ".data/zoho-api/open_files.jsonl");
if (!existsSync(path)) throw new Error(`No ${path}: read the files from Zoho first.`);
const target = await openTarget(false);
if (!target) throw new Error("No database.");
const { db } = target;
let kept = 0;
let here = 0;
let noDoc = 0;
for (const line of readFileSync(path, "utf8").split("\n")) {
  if (!line.trim()) continue;
  const file = JSON.parse(line) as { kind: string; zoho_id: string; document_id: string; name: string; type: string | null; uploaded_by?: string; uploaded_on?: string; b64: string };
  const [doc] = await rows<{ id: number }>(db, sql`select id::int as id from book_doc where kind = ${file.kind} and zoho_id = ${file.zoho_id}`);
  if (!doc) {
    noDoc++;
    continue;
  }
  const [have] = await rows<{ id: number }>(db, sql`select id::int as id from book_file where zoho_id = ${file.document_id}`);
  if (have) {
    here++;
    continue;
  }
  kept++;
  if (!apply) continue;
  const bytes = Buffer.from(file.b64, "base64");
  const mime = (file.type ?? "application/octet-stream").split(";")[0] ?? "application/octet-stream";
  const stored = await keepFile("books", { name: file.name, mime, bytes });
  await db.execute(
    sql`insert into book_file (doc_id, zoho_id, name, mime, size, data, key, uploaded_by, uploaded_on)
      values (${doc.id}, ${file.document_id}, ${stored.name}, ${stored.mime}, ${stored.size}, ${stored.data}, ${stored.key}, ${file.uploaded_by ?? null}, ${file.uploaded_on ?? null})`,
  );
}
console.log({ kept, alreadyHere: here, noDocument: noDoc, applied: apply });
process.exit(0);
