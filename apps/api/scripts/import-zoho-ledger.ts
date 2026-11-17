// Brings Zoho Books' own part into the books (docs/PLAN.md 17): the chart of accounts, expenses,
// manual journals, money moved between accounts, deposits, credit notes' refunds and the invoices
// credit notes were put on, recurring bills and expenses, fixed assets, and Zoho's activity log,
// from Books' backup (.data/zoho-books-backup, 16 Nov 2026) and the lists read from Zoho's API
// (.data/zoho-api: the accounts, the expenses' status and reports). Every field with data comes
// over. Dry run by default; --apply writes. Safe to run again. Then each document's debits and
// credits are in book_entry, and accounts named there that the chart lacks are listed.
//
// The documents Inventory's backup had get Books' extra columns (accounts, payment numbers,
// withholding tax) and the few made since by running scripts/import-zoho-books.ts with
// ZOHO_DIR=.data/zoho-books-backup.
//
//   TEST_PGLITE_DIR=<a local database>   (the API must be stopped: one process per folder)
//   npx tsx scripts/import-zoho-ledger.ts [--apply] [--memory]
//
// Never point it at the live database without Aryan's word.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { rows } from "../src/db/index";
import { bankOtherDocs, creditsApplied, expenseExtras, importAccounts, importActivity, LEDGER_SPECS, ledgerDocs, refreshLedger } from "../src/books/ledger";
import { linkDocs, type Row, saveDocs } from "../src/books/zoho";
import { openTarget, ROOT, rowsOf } from "./zoho-files";

const apply = process.argv.includes("--apply");
const memory = process.argv.includes("--memory");
if (!process.env.TEST_PGLITE_DIR && !memory) throw new Error("Give TEST_PGLITE_DIR (a local database) or --memory; the live database needs Aryan's word.");
const BOOKS_DIR = process.env.ZOHO_BOOKS_DIR ?? join(ROOT, ".data/zoho-books-backup");
const API_DIR = join(ROOT, ".data/zoho-api");
const jsonl = (name: string): Record<string, unknown>[] => {
  const path = join(API_DIR, `${name}.jsonl`);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line) as Record<string, unknown>);
};
const csv = (name: string) => [...rowsOf(name, BOOKS_DIR)] as Row[];

const target = await openTarget(memory);
if (!target) throw new Error("No database.");
const { db, where } = target;
console.log(`into ${where}${apply ? "" : " (dry run)"}`);
const t0 = Date.now();

console.log("accounts", await importAccounts(db, csv("Chart_of_Accounts.csv"), jsonl("books_accounts"), apply));
const expenseStatus = new Map(jsonl("books_expenses").map((item) => [String(item.expense_id), String(item.status ?? "")]));
const linked: Parameters<typeof linkDocs>[1][] = [];
for (const file of Object.keys(LEDGER_SPECS)) {
  const docs = ledgerDocs(file, csv(file), expenseStatus);
  if (!docs.length) {
    console.log(file, "nothing");
    continue;
  }
  console.log(file, await saveDocs(db, docs, apply), `${Math.round((Date.now() - t0) / 1000)}s`);
  if (docs.some((doc) => doc.links.length)) linked.push(docs);
}
// What Zoho's bank accounts hold that the backup has not (payment refunds, interest, other income).
const otherPath = join(API_DIR, "books_bank_other.tsv");
if (existsSync(otherPath)) {
  const [head, ...lines] = readFileSync(otherPath, "utf8").split("\n").filter((line) => line.trim());
  const cols = (head ?? "").split("\t");
  const other = bankOtherDocs(lines.map((line) => Object.fromEntries(line.split("\t").map((value, at) => [cols[at] ?? String(at), value])) as Row));
  for (const kind of ["refund", "deposit"] as const) {
    const docs = other.filter((doc) => doc.kind === kind);
    if (docs.length) console.log(`bank ${kind}s not in the backup`, await saveDocs(db, docs, apply));
  }
}
console.log("expenses from Zoho's list", await expenseExtras(db, jsonl("books_expenses"), apply));
linked.push(await creditsApplied(db, csv("Creditnotes_Invoice.csv")));
for (const docs of linked) console.log("links", docs[0]?.kind, await linkDocs(db, docs, apply));
console.log("activity log", await importActivity(db, csv("Activity Logs.csv"), apply));

if (apply) {
  console.log("ledger written down", await refreshLedger(db), `${Math.round((Date.now() - t0) / 1000)}s`);
  console.log(`checking the ledger (${Math.round((Date.now() - t0) / 1000)}s)`);
  const unknown = await rows<{ account: string; n: number }>(
    db,
    sql`select e.account, count(*)::int as n from book_entry e where not exists (select 1 from book_account a where lower(a.name) = lower(e.account))
      group by 1 order by 2 desc limit 20`,
  );
  console.log("accounts the documents name that the chart lacks", unknown);
  // Each document's debits equal its credits; one that doesn't is listed with the difference.
  const off = await rows<{ kind: string; docs: number; unbalanced: number; sample: string | null }>(
    db,
    sql`select kind, count(*)::int as docs, count(*) filter (where off <> 0)::int as unbalanced,
        string_agg(case when off <> 0 then number || ' ' || off end, ', ') filter (where off <> 0) as sample
      from (select e.kind, e.doc_id, (select number from book_doc where id = e.doc_id) as number, (sum(e.debit) - sum(e.credit))::bigint as off
        from book_entry e where e.kind in ('expense', 'journal', 'transfer_fund', 'deposit', 'refund') group by 1, 2) x group by kind`,
  );
  console.log("debits = credits", off.map((row) => ({ ...row, sample: row.sample?.slice(0, 300) ?? null })));
}
console.log(`done in ${Math.round((Date.now() - t0) / 1000)}s`);
process.exit(0);
