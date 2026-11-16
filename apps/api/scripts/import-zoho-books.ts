// Brings Zoho Inventory's Purchases (and, as each part is built, its other documents) into the
// books (docs/PLAN.md 17): vendors and their people, purchase orders, purchase receives, bills,
// payments made from Zoho's backup (.data/zoho-backup), and vendor credits read from Zoho's API
// into .data/zoho-api/*.jsonl. Every field with data comes over. Dry run by default; --apply
// writes. Safe to run again: a document already here gets Zoho's newer status and balance.
//
//   TEST_PGLITE_DIR=<a local database>   (the API must be stopped: one process per folder)
//   npx tsx scripts/import-zoho-books.ts [--apply] [--memory]
//
// Never point it at the live database without Aryan's word.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type BookDocInput,
  CSV_SPECS,
  creditNoteFromJson,
  docsFromCsv,
  importVendorPeople,
  importVendors,
  linkDocs,
  refreshFromList,
  type Row,
  saveDocs,
  salesReturnFromJson,
  vendorCreditFromJson,
} from "../src/books/zoho";
import { openTarget, ROOT, rowsOf, ZOHO_DIR } from "./zoho-files";

const apply = process.argv.includes("--apply");
const memory = process.argv.includes("--memory");
if (!process.env.TEST_PGLITE_DIR && !memory) throw new Error("Give TEST_PGLITE_DIR (a local database) or --memory; the live database needs Aryan's word.");
const API_DIR = join(ROOT, ".data/zoho-api");

const jsonl = (name: string) => {
  const path = join(API_DIR, `${name}.jsonl`);
  if (!existsSync(path)) return [];
  const seen = new Map<string, Record<string, unknown>>();
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const doc = JSON.parse(line) as Record<string, unknown>;
    seen.set(String(doc.vendor_credit_id ?? doc.creditnote_id ?? doc.salesreturn_id), doc);
  }
  return [...seen.values()];
};

/** Every line of a .jsonl file Zoho's tab sent, newest copy of each document last. */
function jsonlRaw(name: string): Record<string, unknown>[] {
  const path = join(API_DIR, `${name}.jsonl`);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line) as Record<string, unknown>);
}

const target = await openTarget(memory);
if (!target) throw new Error("No database.");
const { db, where } = target;
console.log(`into ${where}${apply ? "" : " (dry run)"}`);

const t0 = Date.now();
const vendors = await importVendors(db, [...rowsOf("Vendors.csv", ZOHO_DIR)], apply);
console.log("vendors", vendors);
console.log("vendor people", await importVendorPeople(db, [...rowsOf("Vendor_Contact_Persons.csv", ZOHO_DIR)], apply));

const kinds: BookDocInput[][] = [];
for (const file of ["Purchase_Order.csv", "Purchase_Receive.csv", "Bill.csv", "Vendor_Payment.csv"]) {
  const spec = CSV_SPECS[file];
  if (!spec) continue;
  const docs = docsFromCsv(spec, [...rowsOf(file, ZOHO_DIR)] as Row[]);
  kinds.push(docs);
  console.log(file, await saveDocs(db, docs, apply), `${Math.round((Date.now() - t0) / 1000)}s`);
}
for (const [name, read] of [
  ["vendorcredits", vendorCreditFromJson],
  ["salesreturns", salesReturnFromJson],
  ["creditnotes", creditNoteFromJson],
] as const) {
  const docs = jsonl(name).map((doc) => read(doc));
  if (!docs.length) continue;
  kinds.push(docs);
  console.log(name, await saveDocs(db, docs, apply));
}
for (const docs of kinds) console.log("links", docs[0]?.kind, await linkDocs(db, docs, apply));
// Today's state from Zoho's lists (read after the backup): statuses, balances, payments' unused amounts.
for (const [name, kind] of [
  ["list_purchaseorders", "purchase_order"],
  ["list_purchasereceives", "purchase_receive"],
  ["list_bills", "bill"],
  ["list_vendorpayments", "vendor_payment"],
] as const) {
  const items = jsonlRaw(name);
  if (!items.length) continue;
  const result = await refreshFromList(db, kind, items, apply);
  console.log(name, { seen: result.seen, updated: result.updated, notHere: result.notHere.length });
  if (result.notHere.length) writeFileSync(join(API_DIR, `missing_${kind}.json`), JSON.stringify(result.notHere));
}
console.log(`done in ${Math.round((Date.now() - t0) / 1000)}s`);
process.exit(0);
