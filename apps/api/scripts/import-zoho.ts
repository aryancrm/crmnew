// Brings Zoho's customers and sales orders (history from before this CRM) in from Zoho's own
// backup: Settings → Data Backup in Zoho Inventory gives a zip of CSVs; unpack it (and the zips
// inside it) into .data/zoho-backup/. Only the customers who ever ordered are brought, with
// every order and its lines; --all brings every Zoho customer. Medicines are not touched: a line
// keeps its name and Zoho's SKU. Dry run by default; --apply writes. Safe to run again: every
// row keeps Zoho's id, so a second run adds only what is missing.
//
//   ZOHO_DIR=<the unpacked backup>            (default: crmnew/.data/zoho-backup)
//   DATABASE_URL=<this CRM's database>        (or in crmnew/.env)
//   TEST_PGLITE_DIR=<a copy of a local database>   try it there first
//   npx tsx scripts/import-zoho.ts [--apply] [--all] [--memory]
//
// With no database it only counts what the backup holds. --memory tries the whole import in a
// fresh demo database that lasts as long as the run.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { openDatabase } from "../src/db/index";
import { migrate } from "../src/db/migrate";
import { seedDemo } from "../src/seed";
import type { CustomerKind } from "../src/types";
import {
  importZohoCustomers,
  importZohoOrders,
  kindOf,
  type ZohoCustomer,
  type ZohoCustomersResult,
  type ZohoOrder,
  type ZohoOrdersResult,
  zohoCustomer,
  zohoOrder,
} from "../src/zoho/import";

const apply = process.argv.includes("--apply");
const everyone = process.argv.includes("--all");
const memory = process.argv.includes("--memory");
const dir = process.env.ZOHO_DIR ?? join(import.meta.dirname, "../../../.data/zoho-backup");
if (!existsSync(join(dir, "Contacts")) || !existsSync(join(dir, "Sales_Order")))
  throw new Error(`No Contacts/ and Sales_Order/ in ${dir}: unpack Zoho's backup there.`);

// ---------------------------------------------------------------- reading the CSVs

/** One CSV as rows of text (quotes, commas and line breaks inside a quoted cell kept). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
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
      rows.push(row);
      row = [];
    } else cell += char;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

type Row = Record<string, string>;
/** Every row of a backup folder's files (Contacts00.csv, Contacts01.csv…), by column name. */
function* rowsOf(folder: string): Generator<Row> {
  for (const file of readdirSync(join(dir, folder)).filter((name) => name.endsWith(".csv")).sort()) {
    const [head, ...lines] = parseCsv(readFileSync(join(dir, folder, file), "utf8"));
    if (!head) continue;
    for (const line of lines) {
      if (line.length === 1 && !line[0]) continue;
      const row: Row = {};
      head.forEach((name, index) => {
        row[name] = line[index] ?? "";
      });
      yield row;
    }
  }
}
const said = (value: string | undefined) => (value ?? "").trim();
const numberOf = (value: string | undefined) => {
  const found = Number(said(value));
  return Number.isFinite(found) ? found : 0;
};
const cut = (value: string, max: number) => (value.length > max ? value.slice(0, max) : value) || null;

// ---------------------------------------------------------------- the orders

/** What an order says its buyer is: Zoho's "Source", else the salesperson's channel. */
const SOURCE_KIND: Record<string, CustomerKind> = {
  "Hospital PO": "hospital",
  "Bidding Order": "government",
  "Doctor order": "doctor",
  "Distributor order": "distributor",
  "Patient order referred by doctor": "patient",
  "Patient order referred by patient": "patient",
  "B2C Order": "patient",
  DSWD: "patient",
  PCSO: "patient",
  "Office of the President": "patient",
};
const CHANNEL_KIND: Record<string, CustomerKind> = {
  HOS: "hospital",
  BID: "government",
  B2B: "distributor",
  MT: "distributor",
  B2C: "patient",
  TeleSales: "patient",
};

// What is not a medicine (packing material, giveaways, services): its lines are left out of
// the history, though the order's total still counts them.
const notMedicine = new Set<string>();
if (existsSync(join(dir, "Item.csv"))) {
  const [head, ...lines] = parseCsv(readFileSync(join(dir, "Item.csv"), "utf8"));
  const at = (name: string) => (head ?? []).indexOf(name);
  for (const line of lines)
    if (said(line[at("CF.Product Type")]) === "PM" || said(line[at("Product Type")]) === "service")
      notMedicine.add(said(line[at("SKU")]).toLowerCase());
}
let leftOut = 0;

type Seen = { kinds: Map<CustomerKind, number>; last: string; terms: string; city: string; address: string };
const orders = new Map<string, ZohoOrder>();
const seenOf = new Map<string, Seen>();
let lineRows = 0;
for (const row of rowsOf("Sales_Order")) {
  lineRows += 1;
  const id = said(row["SalesOrder ID"]);
  if (!id) continue;
  let order = orders.get(id);
  if (!order) {
    const seller = said(row["Sales Person"]);
    order = {
      id,
      code: said(row["SalesOrder Number"]) || id,
      customerId: said(row["Customer ID"]),
      date: said(row["Order Date"]),
      status: said(row.Status).toLowerCase() || "confirmed",
      total: numberOf(row.Total),
      seller: cut(seller, 200),
      division: cut(said(row["CF.Division"]), 120),
      source: cut(said(row["CF.Source"]), 200),
      invoicedFrom: cut(said(row["CF.Invoicing From"]), 200),
      reference: cut(said(row.PurchaseOrder), 200),
      inclusiveTax: said(row["Is Inclusive Tax"]) === "true",
      discountPercent: Math.min(100, Math.max(0, numberOf(row["Entity Discount Percent"]))),
      lines: [],
    };
    orders.set(id, order);
    if (order.status !== "void" && order.status !== "draft") {
      const seen = seenOf.get(order.customerId) ?? { kinds: new Map(), last: "", terms: "", city: "", address: "" };
      const kind = SOURCE_KIND[order.source ?? ""] ?? CHANNEL_KIND[seller.includes("|") ? said(seller.split("|")[0]) : ""];
      if (kind) seen.kinds.set(kind, (seen.kinds.get(kind) ?? 0) + 1);
      if (order.date >= seen.last) {
        seen.last = order.date;
        // How they paid last: cash on delivery, so many days, or up front.
        const days = numberOf(row["Payment Terms"]);
        seen.terms = /cod/i.test(said(row["Payment Terms Label"])) ? "COD" : days >= 7 ? `Net ${days}` : "Paid";
        seen.city = said(row["Shipping City"]) || said(row["Billing City"]) || seen.city;
        seen.address =
          [said(row["Shipping Address"]), said(row["Shipping Street2"])].filter(Boolean).join(", ") ||
          [said(row["Billing Address"]), said(row["Billing Street2"])].filter(Boolean).join(", ") ||
          seen.address;
      }
      seenOf.set(order.customerId, seen);
    }
  }
  const name = said(row["Item Name"]) || said(row.SKU);
  if (!name || order.lines.length >= 500) continue;
  if (notMedicine.has(said(row.SKU).toLowerCase())) {
    leftOut += 1;
    continue;
  }
  order.lines.push({
    sku: cut(said(row.SKU), 80),
    name: name.slice(0, 400),
    unit: cut(said(row["Usage unit"]), 40),
    qty: numberOf(row.QuantityOrdered),
    rate: Math.max(0, numberOf(row["Item Price"])),
    itemTotal: Math.max(0, numberOf(row["Item Total"])),
    taxPercent: Math.min(100, Math.max(0, numberOf(row["Item Tax %"]))),
  });
}

// ---------------------------------------------------------------- the customers

const customers: ZohoCustomer[] = [];
let contacts = 0;
for (const row of rowsOf("Contacts")) {
  if (said(row["Contact Type"]) !== "customer") continue;
  contacts += 1;
  const id = said(row["Contact ID"]);
  const seen = seenOf.get(id);
  if (!id || (!everyone && !seen)) continue;
  const hint = seen ? [...seen.kinds].sort((a, b) => b[1] - a[1])[0]?.[0] : undefined;
  const created = said(row["Created Time"]);
  const expires = said(row["CF.License Expiry Date"]);
  customers.push({
    id,
    name: (said(row["Display Name"]) || said(row["Contact Name"]) || said(row["Company Name"]) || "Unnamed").slice(0, 300),
    business: said(row["Customer Sub Type"]) === "business",
    doctor: said(row["CF.Is Doctor"]) === "true",
    hint: hint ?? null,
    phone: cut(said(row.Phone), 80),
    mobile: cut(said(row.MobilePhone) || said(row["CF.Contact Number"]), 80),
    email: cut(said(row.EmailID), 200),
    address: cut(
      [said(row["Billing Address"]), said(row["Billing Street2"])].filter(Boolean).join(", ") || (seen?.address ?? ""),
      600,
    ),
    city: cut(said(row["Billing City"]) || said(row["Shipping City"]) || (seen?.city ?? ""), 120),
    tin: cut(said(row["CF.TIN"]), 60),
    terms: seen?.terms || "Paid",
    createdAt: /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(created) ? `${created.replace(" ", "T")}+08:00` : null,
    company: Boolean(said(row["Company Name"])),
    licenceNo: cut(said(row["CF.LTO License Number"]), 80),
    licenceType: cut(said(row["CF.LTO Type"]), 80),
    licenceExpires: /^\d{4}-\d{2}-\d{2}$/.test(expires) ? expires : null,
  });
}

// ---------------------------------------------------------------- what the backup holds

const wanted = new Set(customers.map((one) => one.id));
const toSend = [...orders.values()].filter((order) => wanted.has(order.customerId));
const badCustomers = customers.filter((one) => !zohoCustomer.safeParse(one).success);
const badOrders = toSend.filter((order) => !zohoOrder.safeParse(order).success);
const byKind: Record<string, number> = {};
for (const one of customers) byKind[kindOf(one)] = (byKind[kindOf(one)] ?? 0) + 1;
const status: Record<string, number> = {};
for (const order of toSend) status[order.status] = (status[order.status] ?? 0) + 1;
console.log(`Zoho's backup in ${dir}`);
console.log(`  customers in Zoho: ${contacts}; to bring (${everyone ? "everyone" : "those who ordered"}): ${customers.length}`);
console.log("  by kind, before twins are joined:", byKind);
console.log(`  sales orders: ${orders.size} (${lineRows} line rows); to bring: ${toSend.length}`, status);
console.log(`  lines left out as not a medicine (packing, giveaways, services): ${leftOut}`);
if (badCustomers.length || badOrders.length) {
  console.log(`  not as expected: ${badCustomers.length} customers, ${badOrders.length} orders, for example:`);
  const first = badCustomers[0] ? zohoCustomer.safeParse(badCustomers[0]) : zohoOrder.safeParse(badOrders[0]);
  if (!first.success) console.log("   ", first.error.issues[0]?.path.join("."), first.error.issues[0]?.message);
}

// ---------------------------------------------------------------- into the CRM

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
const url = process.env.DATABASE_URL ?? envFile(join(import.meta.dirname, "../../../.env")).DATABASE_URL;
const testDir = process.env.TEST_PGLITE_DIR;
if (!memory && !testDir && !url) {
  console.log("No database given: counted only. (DATABASE_URL, TEST_PGLITE_DIR or --memory to go on.)");
  process.exit(0);
}
const db = memory ? openDatabase({ dir: "memory" }) : testDir ? openDatabase({ dir: testDir }) : openDatabase({ url });
if (memory || testDir) await migrate(db);
if (memory) await seedDemo(db, "not-a-real-password-1");
const writes = apply || memory;
{
  // A database that has not had this change's migration yet (the live API still starting).
  const found = (await db.execute(sql`select to_regclass('past_order') as here`)) as unknown;
  const first = (Array.isArray(found) ? found : ((found as { rows?: unknown[] }).rows ?? []))[0] as
    | { here: string | null }
    | undefined;
  if (!first?.here) {
    console.log("This database has no past_order table yet: let the API start once on the new code (it migrates), then run this again.");
    process.exit(1);
  }
}

const add = <T extends Record<string, unknown>>(sum: T | null, part: T): T => {
  if (!sum) return { ...part };
  const next: Record<string, unknown> = { ...sum };
  for (const [key, value] of Object.entries(part)) {
    if (typeof value === "number") next[key] = ((next[key] as number) ?? 0) + value;
    else if (value && typeof value === "object") next[key] = add((next[key] as Record<string, unknown>) ?? null, value as Record<string, unknown>);
  }
  return next as T;
};
const good = customers.filter((one) => !badCustomers.includes(one));
let customersSaid: ZohoCustomersResult | null = null;
const began = Date.now();
for (let at = 0; at < good.length; at += 1000)
  customersSaid = add(customersSaid, await importZohoCustomers(db, good.slice(at, at + 1000), writes));
let ordersSaid: ZohoOrdersResult | null = null;
const goodOrders = toSend.filter((order) => !badOrders.includes(order));
for (let at = 0; at < goodOrders.length; at += 500)
  ordersSaid = add(ordersSaid, await importZohoOrders(db, goodOrders.slice(at, at + 500), writes));
console.log(writes ? (memory ? "In a database for this run only:" : "Applied:") : "Dry run (nothing written; add --apply):");
console.log("  customers", customersSaid);
console.log("  orders", ordersSaid);
if (!writes) console.log("  (a dry run finds no customer for an order until the customers are written)");
console.log(`  took ${Math.round((Date.now() - began) / 1000)}s`);
process.exit(0);
