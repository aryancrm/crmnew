// Customers the Zoho import joined from two or more different Zoho contacts (src/zoho/split.ts):
// lists every customer whose joined contacts go by different names, how different (0 the same
// once titles, case and punctuation are set aside, 100 nothing alike), and for each clear
// mismatch what a split moves: the contacts that are someone else become a customer of their own
// with their Zoho sales orders, invoices, payments, credit notes, returns, past orders and people.
//
// Which document is whose comes from Zoho's own files: its lists (.data/zoho-api/list_*.jsonl,
// read 18 Nov 2026) and its backup (.data/zoho-backup: payments' shares, contact persons).
//
// Dry run by default: prints the summary and the clear mismatches, and writes the whole list to
// --out (default .data/zoho-splits/plan-<day>.tsv). --apply splits the cases of the kinds given
// (--kinds business,test by default; "people" is different people on one phone, a patient's
// family: only when Aryan says), or only the customers given (--only 87360,117).
//
//   TEST_PGLITE_DIR=<a local database>   (the API must be stopped: one process per folder)
//   npx tsx scripts/split-zoho-contacts.ts [--apply] [--kinds business,test,people] [--only 87360,117] [--out file]
//   npx tsx scripts/split-zoho-contacts.ts --live [--apply]   (the live database: only on Aryan's word)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { sql } from "drizzle-orm";
import { customerOpenings } from "../src/books/zoho";
import { rows } from "../src/db/index";
import { applySplit, planSplits, type SplitCase, type SplitKind, type SplitSources } from "../src/zoho/split";
import { openTarget, ROOT, rowsOf, ZOHO_DIR } from "./zoho-files";

const argv = process.argv;
const option = (name: string) => {
  const at = argv.indexOf(name);
  return at > 0 ? argv[at + 1] : undefined;
};
const apply = argv.includes("--apply");
if (!process.env.TEST_PGLITE_DIR && !argv.includes("--live")) {
  console.log("Give TEST_PGLITE_DIR (a local database), or --live (the live database: only on Aryan's word).");
  process.exit(1);
}
const only = option("--only")
  ?.split(",")
  .map((one) => Number(one.trim().replace(/^CUS-0*/i, "")))
  .filter((one) => Number.isInteger(one) && one > 0);
const kinds = new Set((option("--kinds") ?? "business,test").split(",").map((one) => one.trim()) as SplitKind[]);
const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
const out = option("--out") ?? join(ROOT, `.data/zoho-splits/plan-${today}.tsv`);
const API_DIR = join(ROOT, ".data/zoho-api");
const began = Date.now();
const step = (what: string) => console.error(`  ${what} (${Math.round((Date.now() - began) / 1000)}s)`);

// ---------------------------------------------------------------- Zoho's files: whose is what

function* jsonl(name: string): Generator<Record<string, unknown>> {
  const path = join(API_DIR, `${name}.jsonl`);
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) if (line.trim()) yield JSON.parse(line) as Record<string, unknown>;
}
const text = (value: unknown) => (value === null || value === undefined ? "" : String(value).trim());

const sources: SplitSources = { docContact: new Map(), contactName: new Map(), contactRecord: new Map() };
const tie = (key: string, contact: string) => {
  if (key.endsWith(":") || !contact) return;
  sources.docContact.set(key, contact);
};
for (const [file, kind, id] of [
  ["list_salesorders", "sales_order", "salesorder_id"],
  ["salesorders_new", "sales_order", "salesorder_id"],
  ["list_invoices", "invoice", "invoice_id"],
  ["invoices_new", "invoice", "invoice_id"],
  ["list_customerpayments", "customer_payment", "payment_id"],
  ["customerpayments_new", "customer_payment", "payment_id"],
  ["list_creditnotes", "credit_note", "creditnote_id"],
  ["creditnotes", "credit_note", "creditnote_id"],
  ["list_salesreturns", "sales_return", "salesreturn_id"],
  ["salesreturns", "sales_return", "salesreturn_id"],
  ["list_packages", "package", "package_id"],
  ["packages_new", "package", "package_id"],
  ["list_shipments", "shipment", "shipment_id"],
  ["shipments_new", "shipment", "shipment_id"],
] as const)
  for (const doc of jsonl(file)) tie(`${kind}:${text(doc[id])}`, text(doc.customer_id));
step("Zoho's lists read");
// The backup: what the lists do not say (a payment's share on each invoice, contact persons),
// and documents gone from Zoho's lists since.
for (const row of rowsOf("Customer_Payment", ZOHO_DIR)) {
  tie(`payment_share:${text(row["InvoicePayment ID"])}`, text(row.CustomerID));
  if (!sources.docContact.has(`customer_payment:${text(row["CustomerPayment ID"])}`)) tie(`customer_payment:${text(row["CustomerPayment ID"])}`, text(row.CustomerID));
}
for (const row of rowsOf("Contact_Persons.csv", ZOHO_DIR)) tie(`person:${text(row["Contact Person ID"])}`, text(row["Contact ID"]) || text(row["Customer ID"]));
for (const [file, kind, id] of [
  ["Sales_Order", "sales_order", "SalesOrder ID"],
  ["Invoice", "invoice", "Invoice ID"],
] as const)
  for (const row of rowsOf(file, ZOHO_DIR)) {
    const key = `${kind}:${text(row[id])}`;
    if (!sources.docContact.has(key)) tie(key, text(row["Customer ID"]));
  }
step("Zoho's backup read");
const zohoTime = (value: string) => value.replace(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2}).*$/, "$1 $2");
const listed = [...jsonl("list_contacts")];
for (const contact of listed) {
  const id = text(contact.contact_id);
  if (!id || contact.contact_type === "vendor") continue;
  sources.contactName.set(id, text(contact.contact_name));
  sources.contactRecord?.set(id, {
    "Contact ID": id,
    "Display Name": text(contact.contact_name),
    "Company Name": text(contact.company_name),
    "Customer Sub Type": text(contact.customer_sub_type),
    Phone: text(contact.phone),
    MobilePhone: text(contact.mobile),
    EmailID: text(contact.email),
    "Created Time": zohoTime(text(contact.created_time)),
  });
}

// ---------------------------------------------------------------- the plan

const target = await openTarget(false);
if (!target) process.exit(1);
const { db } = target;
console.log(`${apply ? "Splitting on" : "Dry run on"} ${target.where}.`);
step("Zoho's contacts read");
const report = await planSplits(db, sources, only, step);
step("planned");

const peso = (centavos: number) => `₱${Math.round(centavos / 100).toLocaleString("en-PH")}`;
const what = (counts: Record<string, number>) =>
  [
    ["invoice", "invoices"],
    ["sales_order", "sales orders"],
    ["customer_payment", "payments"],
    ["credit_note", "credit notes"],
    ["sales_return", "returns"],
    ["past_order", "past orders"],
    ["person", "people"],
  ]
    .filter(([key]) => counts[key as string])
    .map(([key, label]) => `${counts[key as string]} ${label}`)
    .join(", ") || "no history";
const verdicts = { same: 0, close: 0, different: 0 };
for (const one of report.listed) verdicts[one.verdict] += 1;
const byKind: Record<string, SplitCase[]> = { business: [], test: [], people: [] };
for (const one of report.cases) byKind[one.moves[0]?.kind ?? "people"]?.push(one);
console.log(`Customers made of two or more Zoho contacts: ${report.joined}.`);
console.log(
  `With names that differ: ${report.listed.length}: the same buyer written differently ${verdicts.same}, alike in part (kept, for a look) ${verdicts.close}, nothing in common ${verdicts.different}.`,
);
console.log(
  `To split: ${report.cases.length} customers: businesses and doctors ${byKind.business?.length}, test contacts ${byKind.test?.length}, different people on one phone ${byKind.people?.length}.`,
);
const line = (one: SplitCase) =>
  `  ${one.code} ${one.name} (${one.kind}) keeps ${one.stays.contacts.map((c) => c.name).filter((n, at, all) => all.indexOf(n) === at).join(" / ")}: ${what(one.stays.counts)}, billed ${peso(one.stays.billed)}` +
  one.moves
    .map(
      (move) =>
        `\n      → new customer ${move.contacts.map((c) => c.name).filter((n, at, all) => all.indexOf(n) === at).join(" / ")} [${move.score}]: ${what(move.counts)}, billed ${peso(move.billed)}, owing ${peso(move.owed)}` +
        `${move.contacts[0]?.seller ? `, Zoho seller ${move.contacts[0]?.seller}` : ""}`,
    )
    .join("") +
  `${one.phones.length ? `\n      phone ${one.phones.join(", ")}` : ""}${one.unknown ? `; ${one.unknown} documents not tied to a contact (stay)` : ""}${one.crmOwn ? `; ${one.crmOwn} of this CRM's own records (stay)` : ""}${one.crossLinks ? `; ${one.crossLinks} links across: NOT split, needs a look` : ""}`;
for (const kind of ["business", "test"] as const) {
  if (!byKind[kind]?.length) continue;
  console.log(`\n${kind === "business" ? "Businesses and doctors" : "Test contacts on real customers"}:`);
  for (const one of byKind[kind] ?? []) console.log(line(one));
}
if (byKind.people?.length)
  console.log(`\nDifferent people on one phone: ${byKind.people.length} customers (in ${out}); split only on Aryan's word (--kinds people).`);

// The whole list, for a look.
mkdirSync(dirname(out), { recursive: true });
const plan = new Map(report.cases.map((one) => [one.customerId, one]));
writeFileSync(
  out,
  [
    ["customer", "kind", "name", "verdict", "score", "names", "split", "stays", "moves"].join("\t"),
    ...report.listed.map((one) => {
      const found = plan.get(one.customerId);
      return [
        one.code,
        one.kind,
        one.name,
        one.verdict,
        one.score,
        one.names.join(" | "),
        found?.moves.map((move) => move.kind).join(",") ?? "",
        found ? `${what(found.stays.counts)}; billed ${peso(found.stays.billed)}` : "",
        found?.moves.map((move) => `${move.contacts.map((c) => c.name).join(" / ")} [${move.score}]: ${what(move.counts)}; billed ${peso(move.billed)}; owing ${peso(move.owed)}`).join(" || ") ?? "",
      ].join("\t");
    }),
  ].join("\n") + "\n",
);
console.log(`\nThe whole list: ${out}`);

// ---------------------------------------------------------------- the split

if (apply) {
  const [admin] = await rows<{ id: number }>(db, sql`select id::int as id from person where role = 'admin' and active order by id limit 1`);
  if (!admin) throw new Error("No admin in this CRM.");
  const touched: number[] = [];
  let made = 0;
  for (const one of report.cases) {
    const moves = one.moves.filter((move) => kinds.has(move.kind));
    if (!moves.length) continue;
    const done = await applySplit(db, { ...one, moves }, sources, admin.id, today);
    if (done.skipped) {
      console.log(`  ${one.code}: not split (${done.skipped})`);
      continue;
    }
    touched.push(one.customerId, ...done.made.map((m) => m.id));
    made += done.made.length;
    for (const m of done.made) console.log(`  ${one.code} → ${m.code} ${m.name} (${m.kind}): ${Object.entries(m.moved).map(([table, n]) => `${n} ${table}`).join(", ")}`);
  }
  // What each still owes or holds that no Zoho document here explains, worked out again for both sides.
  if (touched.length) console.log("opening figures", await customerOpenings(db, listed, true, touched));
  console.log(`Split ${new Set(touched).size - made} customers into ${made} new ones.`);
}
process.exit(0);
