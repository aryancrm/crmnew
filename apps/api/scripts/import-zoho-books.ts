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
  packageFromJson,
  shipmentFromJson,
  importItems,
  importPriceLists,
  salesOrderFromJson,
  invoiceFromJson,
  customerPaymentFromJson,
  customerOpenings,
  customerFields,
  importCustomerPeople,
  openingCredits,
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
    seen.set(String(doc.vendor_credit_id ?? doc.creditnote_id ?? doc.salesreturn_id ?? doc.package_id ?? doc.shipment_id ?? doc.salesorder_id ?? doc.invoice_id ?? doc.payment_id), doc);
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

// Vendors added in Zoho after the backup, from Zoho's list.
const listed = jsonlRaw("list_vendors").map((v) => ({
  "Contact ID": String(v.contact_id ?? ""),
  "Display Name": String(v.contact_name ?? ""),
  "Contact Name": String(v.contact_name ?? ""),
  "Company Name": String(v.company_name ?? ""),
  EmailID: String(v.email ?? ""),
  Phone: String(v.phone ?? ""),
  MobilePhone: String(v.mobile ?? ""),
  "Currency Code": String(v.currency_code ?? "PHP"),
  Status: v.status === "inactive" ? "Inactive" : "Active",
  "Created Time": String(v.created_time ?? ""),
}));
const known = new Set([...rowsOf("Vendors.csv", ZOHO_DIR)].map((row) => row["Contact ID"]));
const newer = listed.filter((v) => v["Contact ID"] && !known.has(v["Contact ID"]));
if (newer.length) console.log("vendors since the backup", await importVendors(db, newer, apply));

const kinds: BookDocInput[][] = [];
for (const file of ["Purchase_Order.csv", "Purchase_Receive.csv", "Bill.csv", "Vendor_Payment.csv"]) {
  const spec = CSV_SPECS[file];
  if (!spec) continue;
  const docs = docsFromCsv(spec, [...rowsOf(file, ZOHO_DIR)] as Row[]);
  kinds.push(docs);
  console.log(file, await saveDocs(db, docs, apply), `${Math.round((Date.now() - t0) / 1000)}s`);
}
// Sales: the big files go a few thousand documents at a time (a document's rows sit together).
const sales = process.argv.includes("--no-sales") ? [] : (["Sales_Order", "Invoice", "Customer_Payment", "Inventory_Adjustment", "Package", "Shipment_Order", "Transfer_Order.csv"] as const);
for (const name of sales) {
  const spec = CSV_SPECS[name];
  if (!spec) continue;
  // First pass: every column that changes within any document is a line's column (so nothing a
  // line holds is taken for the document's own and lost).
  const lineCols = new Set<string>();
  {
    let first: Row | null = null;
    for (const row of rowsOf(name, ZOHO_DIR) as Iterable<Row>) {
      if (!first || row[spec.id] !== first[spec.id]) {
        first = row;
        continue;
      }
      for (const column of Object.keys(row)) if (!lineCols.has(column) && row[column] !== first[column]) lineCols.add(column);
    }
  }
  const slim: Pick<BookDocInput, "kind" | "zohoId" | "links">[] = [];
  const total = { docs: 0, made: 0, updated: 0, lines: 0, noParty: 0, medicines: 0 };
  let batch: Row[][] = [];
  const flush = async () => {
    const rows = batch.flat();
    batch = [];
    if (!rows.length) return;
    const docs = docsFromCsv(spec, rows, lineCols);
    const result = await saveDocs(db, docs, apply);
    for (const key of Object.keys(total) as (keyof typeof total)[]) total[key] += result[key];
    for (const doc of docs) if (doc.links.length) slim.push({ kind: doc.kind, zohoId: doc.zohoId, links: doc.links });
  };
  let group: Row[] = [];
  for (const row of rowsOf(name, ZOHO_DIR)) {
    if (group.length && row[spec.id] !== group[0]?.[spec.id]) {
      batch.push(group);
      group = [];
      if (batch.length >= 3000) await flush();
    }
    group.push(row as Row);
  }
  if (group.length) batch.push(group);
  await flush();
  console.log(name, total, `${Math.round((Date.now() - t0) / 1000)}s`);
  kinds.push(slim as BookDocInput[]);
}
console.log("items", await importItems(db, [...rowsOf("Item.csv", ZOHO_DIR)] as Row[], jsonlRaw("list_items"), apply));
console.log("price lists", await importPriceLists(db, [...rowsOf("Price_lists.csv", ZOHO_DIR)] as Row[], apply));
if (sales.length) {
  console.log("customers' Zoho fields", await customerFields(db, rowsOf("Contacts", ZOHO_DIR) as Iterable<Row>, apply));
  console.log("customers' people", await importCustomerPeople(db, [...rowsOf("Contact_Persons.csv", ZOHO_DIR)] as Row[], apply));
}

for (const [name, read] of [
  ["salesorders_new", salesOrderFromJson],
  ["invoices_new", invoiceFromJson],
  ["customerpayments_new", customerPaymentFromJson],
  ["packages_new", packageFromJson],
  ["shipments_new", shipmentFromJson],
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
  ["list_salesorders", "sales_order"],
  ["list_invoices", "invoice"],
  ["list_customerpayments", "customer_payment"],
  ["list_creditnotes", "credit_note"],
  ["list_salesreturns", "sales_return"],
  ["list_packages", "package"],
  ["list_shipments", "shipment"],
  ["list_adjustments", "adjustment"],
] as const) {
  const items = jsonlRaw(name);
  if (!items.length) continue;
  const result = await refreshFromList(db, kind, items, apply);
  console.log(name, { seen: result.seen, updated: result.updated, notHere: result.notHere.length });
  if (result.notHere.length) writeFileSync(join(API_DIR, `missing_${kind}.json`), JSON.stringify(result.notHere));
}
console.log("vendors' opening credits", await openingCredits(db, jsonlRaw("list_vendors"), apply));
console.log("customers' opening figures", await customerOpenings(db, jsonlRaw("list_contacts"), apply));
console.log(`done in ${Math.round((Date.now() - t0) / 1000)}s`);
process.exit(0);
