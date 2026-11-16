// Lays the books' totals beside Zoho's own (docs/PLAN.md 17): what customers owe and hold unused,
// what is owed to vendors and held unused with them, from Zoho's lists read into .data/zoho-api.
// Read only.
//
//   TEST_PGLITE_DIR=<a local database>   (the API must be stopped)
//   npx tsx scripts/books-check.ts

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { rows } from "../src/db/index";
import { openTarget, ROOT } from "./zoho-files";

const list = (name: string) => {
  const path = join(ROOT, ".data/zoho-api", `${name}.jsonl`);
  const seen = new Map<string, Record<string, number>>();
  if (!existsSync(path)) return seen;
  for (const line of readFileSync(path, "utf8").split("\n")) if (line.trim()) {
    const doc = JSON.parse(line) as Record<string, number> & { contact_id: string };
    seen.set(doc.contact_id, doc);
  }
  return seen;
};
const sum = (docs: Map<string, Record<string, number>>, key: string) => Math.round([...docs.values()].reduce((total, doc) => total + (doc[`${key}_bcy`] ?? doc[key] ?? 0), 0) * 100) / 100;

const target = await openTarget(false);
if (!target) throw new Error("Give TEST_PGLITE_DIR.");
const [ours] = await rows<Record<string, number>>(
  target.db,
  sql`select
    ((select coalesce(sum(opening_receivables), 0) from customer) + coalesce((select sum(round(balance * fx_rate)) from book_doc where kind = 'invoice' and zoho_id is not null and balance > 0 and status not in ('void', 'draft') and customer_id is not null), 0))::float8 / 100 as "customers owe",
    ((select coalesce(sum(opening_credits), 0) from customer) + coalesce((select sum(round(balance * fx_rate)) from book_doc where kind in ('credit_note', 'customer_payment') and zoho_id is not null and balance > 0 and status not in ('void', 'draft') and customer_id is not null), 0))::float8 / 100 as "customers' unused credits",
    ((select coalesce(sum(opening_payables), 0) from supplier) + coalesce((select sum(round(balance * fx_rate)) from book_doc where kind = 'bill' and zoho_id is not null and status not in ('void', 'draft', 'pending_approval')), 0))::float8 / 100 as "owed to vendors",
    ((select coalesce(sum(opening_credits), 0) from supplier) + coalesce((select sum(round(balance * fx_rate)) from book_doc where kind in ('vendor_credit', 'vendor_payment') and zoho_id is not null and status not in ('void', 'draft', 'pending_approval')), 0))::float8 / 100 as "vendors' unused credits",
    (select count(*) from book_doc where kind in ('sales_order', 'invoice', 'customer_payment', 'credit_note', 'sales_return') and customer_id is null)::int as "sales documents with no customer here"`,
);
const customers = list("list_contacts");
const vendors = list("list_vendors");
console.table({
  "customers owe": { books: ours?.["customers owe"], zoho: sum(customers, "outstanding_receivable_amount") },
  "customers' unused credits": { books: ours?.["customers' unused credits"], zoho: sum(customers, "unused_credits_receivable_amount") },
  "owed to vendors": { books: ours?.["owed to vendors"], zoho: sum(vendors, "outstanding_payable_amount") },
  "vendors' unused credits": { books: ours?.["vendors' unused credits"], zoho: sum(vendors, "unused_credits_payable_amount") },
});
console.log("sales documents with no customer here:", ours?.["sales documents with no customer here"]);
process.exit(0);
