// Brings Zoho's customers, sales orders, invoices and payments (history from before this CRM)
// in from Zoho's own backup: Settings → Data Backup in Zoho Inventory gives a zip of CSVs; unpack
// it (and the zips inside it) into .data/zoho-backup/. Every Zoho customer comes over (--ordered:
// only those who ever ordered). Medicines come from the price list (import-medicines.ts); a past
// order's line keeps its name and Zoho's SKU and finds its medicine through the SKU.
//
// Dry run by default; --apply writes. Safe to run again with a newer backup: every row keeps
// Zoho's id, so a rerun adds what is new, brings each order's and invoice's latest status and
// balance, and fills only what a customer here is missing.
//
//   ZOHO_DIR=<the unpacked backup>            (default: crmnew/.data/zoho-backup)
//   DATABASE_URL=<this CRM's database>        (or in crmnew/.env.live)
//   TEST_PGLITE_DIR=<a copy of a local database>   try it there first
//   npx tsx scripts/import-zoho.ts [--apply] [--ordered] [--memory]
//
// With no database it only counts what the backup holds. --memory tries the whole import in a
// fresh demo database that lasts as long as the run.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CustomerKind } from "../src/types";
import {
  importZohoCustomers,
  importZohoInvoices,
  importZohoOrders,
  importZohoPayments,
  kindOf,
  type ZohoCustomer,
  type ZohoCustomersResult,
  type ZohoInvoice,
  type ZohoInvoicesResult,
  type ZohoOrder,
  type ZohoOrdersResult,
  type ZohoPayment,
  type ZohoPaymentsResult,
  zohoCustomer,
  zohoInvoice,
  zohoOrder,
  zohoPayment,
} from "../src/zoho/import";
import {
  addUp,
  cut,
  isDay,
  numberOf,
  openTarget,
  parseCsv,
  rowsOf,
  said,
  ZOHO_DIR,
} from "./zoho-files";

const apply = process.argv.includes("--apply");
const orderedOnly = process.argv.includes("--ordered");
const memory = process.argv.includes("--memory");
if (!existsSync(join(ZOHO_DIR, "Contacts")) || !existsSync(join(ZOHO_DIR, "Sales_Order")))
  throw new Error(`No Contacts/ and Sales_Order/ in ${ZOHO_DIR}: unpack Zoho's backup there.`);

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
if (existsSync(join(ZOHO_DIR, "Item.csv"))) {
  const [head, ...lines] = parseCsv(readFileSync(join(ZOHO_DIR, "Item.csv"), "utf8"));
  const at = (name: string) => (head ?? []).indexOf(name);
  for (const line of lines)
    if (said(line[at("CF.Product Type")]) === "PM" || said(line[at("Product Type")]) === "service")
      notMedicine.add(said(line[at("SKU")]).toLowerCase());
}
let leftOut = 0;

type Seen = {
  kinds: Map<CustomerKind, number>;
  last: string;
  terms: string;
  city: string;
  address: string;
  /** Whose customer it was: the salesperson of the latest order that names one, and the latest
   *  Division, Sub-division and Headquarter written on an order. */
  seller: string;
  sellerOn: string;
  division: string;
  subDivision: string;
  headquarter: string;
  dividedOn: string;
};
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
      customerName: cut(said(row["Customer Name"]), 300),
      doctor: cut(said(row["CF.Doctor Name"]), 200),
      patient: cut(said(row["CF.PX Name"]), 200),
      inclusiveTax: said(row["Is Inclusive Tax"]) === "true",
      discountPercent: Math.min(100, Math.max(0, numberOf(row["Entity Discount Percent"]))),
      lines: [],
    };
    orders.set(id, order);
    if (order.status !== "void" && order.status !== "draft") {
      const seen: Seen = seenOf.get(order.customerId) ?? {
        kinds: new Map(),
        last: "",
        terms: "",
        city: "",
        address: "",
        seller: "",
        sellerOn: "",
        division: "",
        subDivision: "",
        headquarter: "",
        dividedOn: "",
      };
      if (seller && order.date >= seen.sellerOn) {
        seen.seller = seller;
        seen.sellerOn = order.date;
      }
      const division = said(row["CF.Division"]);
      if (division && order.date >= seen.dividedOn) {
        seen.division = division;
        seen.subDivision = said(row["CF.Sub-division"]);
        seen.headquarter = said(row["CF.Headquarter"]).replace(/^n\/?a$/i, "");
        seen.dividedOn = order.date;
      }
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

// A number three or more different names use is an office line or a placeholder: it is kept on
// the customer but does not say who they are.
const digits = (row: Record<string, string>) => {
  const found = (said(row.MobilePhone) || said(row["CF.Contact Number"]) || said(row.Phone)).replace(/\D/g, "");
  return found.length >= 7 ? found.slice(-10) : "";
};
const namesOn = new Map<string, Set<string>>();
for (const row of rowsOf("Contacts")) {
  const key = digits(row);
  if (!key) continue;
  const names = namesOn.get(key) ?? new Set<string>();
  names.add(said(row["Display Name"]).toLowerCase().replace(/\s+/g, " "));
  namesOn.set(key, names);
}

const customers: ZohoCustomer[] = [];
let contacts = 0;
let withPhone = 0;
let sharedLines = 0;
for (const row of rowsOf("Contacts")) {
  if (said(row["Contact Type"]) !== "customer") continue;
  contacts += 1;
  const id = said(row["Contact ID"]);
  const seen = seenOf.get(id);
  if (!id || (orderedOnly && !seen)) continue;
  const hint = seen ? [...seen.kinds].sort((a, b) => b[1] - a[1])[0]?.[0] : undefined;
  const created = said(row["Created Time"]);
  const expires = said(row["CF.License Expiry Date"]);
  const shared = (namesOn.get(digits(row))?.size ?? 0) >= 3;
  if (digits(row)) withPhone += 1;
  if (shared) sharedLines += 1;
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
    licenceExpires: isDay(expires) ? expires : null,
    seller: cut(seen?.seller ?? "", 200),
    sellerOn: seen && isDay(seen.sellerOn) ? seen.sellerOn : null,
    division: cut(seen?.division ?? "", 120),
    subDivision: cut(seen?.subDivision ?? "", 120),
    headquarter: cut(seen?.headquarter ?? "", 120),
    sharedPhone: shared,
  });
}

// ---------------------------------------------------------------- invoices and payments

const invoices = new Map<string, ZohoInvoice>();
for (const row of rowsOf("Invoice")) {
  const id = said(row["Invoice ID"]);
  if (!id || invoices.has(id)) continue;
  const due = said(row["Due Date"]);
  invoices.set(id, {
    id,
    code: said(row["Invoice Number"]) || id,
    customerId: said(row["Customer ID"]),
    orderCode: cut(said(row["Sales Order Number"]), 60),
    date: said(row["Invoice Date"]),
    dueOn: isDay(due) ? due : null,
    status: said(row["Invoice Status"]).toLowerCase() || "open",
    total: Math.max(0, numberOf(row.Total)),
    balance: Math.max(0, numberOf(row.Balance)),
    terms: cut(said(row["Payment Terms Label"]), 120),
    seller: cut(said(row["Sales Person"]), 200),
    invoicedFrom: cut(said(row["CF.Invoicing From"]), 200),
  });
}
const payments: ZohoPayment[] = [];
for (const row of rowsOf("Customer_Payment")) {
  const status = said(row["Payment Status"]).toLowerCase();
  if (status === "void" || status === "draft") continue;
  const share = said(row["InvoicePayment ID"]);
  const whole = said(row["CustomerPayment ID"]);
  if (!share && !whole) continue;
  payments.push({
    id: share || `payment-${whole}`,
    paymentNo: cut(said(row["Payment Number Suffix"]), 60),
    customerId: said(row.CustomerID),
    invoiceCode: cut(said(row["Invoice Number"]), 60),
    date: said(row.Date),
    mode: cut(said(row.Mode), 80),
    reference: cut(said(row["Reference Number"]), 200),
    amount: Math.max(0, share ? numberOf(row["Invoice Amount"]) : numberOf(row.Amount)),
    paymentTotal: Math.max(0, numberOf(row.Amount)),
  });
}

// ---------------------------------------------------------------- what the backup holds

const wanted = new Set(customers.map((one) => one.id));
const keep = <T extends { customerId: string }>(list: T[]) => list.filter((one) => wanted.has(one.customerId));
const checked = <T>(list: T[], schema: { safeParse: (value: unknown) => { success: boolean } }) => {
  const good = list.filter((one) => schema.safeParse(one).success);
  if (good.length < list.length) {
    const bad = list.find((one) => !schema.safeParse(one).success);
    const why = (schema.safeParse(bad) as { error?: { issues: { path: PropertyKey[]; message: string }[] } }).error?.issues[0];
    console.log(`  ${list.length - good.length} not as expected and left behind, for example: ${why?.path.join(".")} ${why?.message}`);
  }
  return good;
};
const goodCustomers = checked(customers, zohoCustomer);
const goodOrders = checked(keep([...orders.values()]), zohoOrder);
const goodInvoices = checked(keep([...invoices.values()]), zohoInvoice);
const goodPayments = checked(keep(payments), zohoPayment);
const byKind: Record<string, number> = {};
for (const one of goodCustomers) byKind[kindOf(one)] = (byKind[kindOf(one)] ?? 0) + 1;
const status: Record<string, number> = {};
for (const order of goodOrders) status[order.status] = (status[order.status] ?? 0) + 1;
const open = goodInvoices.filter((one) => one.balance > 0 && one.status !== "void" && one.status !== "draft");
console.log(`Zoho's backup in ${ZOHO_DIR}`);
console.log(`  customers in Zoho: ${contacts}; to bring (${orderedOnly ? "those who ordered" : "everyone"}): ${goodCustomers.length}`);
console.log("  by kind, before twins are joined:", byKind);
console.log(
  `  with a phone number: ${withPhone} (${sharedLines} on a line three or more names share); with a salesperson from their orders: ${goodCustomers.filter((one) => one.seller).length}`,
);
console.log(`  sales orders: ${orders.size} (${lineRows} line rows); to bring: ${goodOrders.length}`, status);
console.log(`  lines left out as not a medicine (packing, giveaways, services): ${leftOut}`);
console.log(
  `  invoices: ${goodInvoices.length}; still owed on ${open.length} of them: ₱${Math.round(open.reduce((sum, one) => sum + one.balance, 0)).toLocaleString("en-PH")}`,
);
console.log(`  payments (one row per invoice paid): ${goodPayments.length}`);

// ---------------------------------------------------------------- into the CRM

const target = await openTarget(memory);
if (!target) {
  console.log("No database given: counted only. (DATABASE_URL, .env.live, TEST_PGLITE_DIR or --memory to go on.)");
  process.exit(0);
}
const { db } = target;
const writes = apply || memory;
const began = Date.now();
let customersSaid: ZohoCustomersResult | null = null;
for (let at = 0; at < goodCustomers.length; at += 2000)
  customersSaid = addUp(customersSaid, await importZohoCustomers(db, goodCustomers.slice(at, at + 2000), writes));
let ordersSaid: ZohoOrdersResult | null = null;
for (let at = 0; at < goodOrders.length; at += 1000)
  ordersSaid = addUp(ordersSaid, await importZohoOrders(db, goodOrders.slice(at, at + 1000), writes));
let invoicesSaid: ZohoInvoicesResult | null = null;
for (let at = 0; at < goodInvoices.length; at += 2000)
  invoicesSaid = addUp(invoicesSaid, await importZohoInvoices(db, goodInvoices.slice(at, at + 2000), writes));
let paymentsSaid: ZohoPaymentsResult | null = null;
for (let at = 0; at < goodPayments.length; at += 2000)
  paymentsSaid = addUp(paymentsSaid, await importZohoPayments(db, goodPayments.slice(at, at + 2000), writes));
console.log(writes ? `Written to ${target.where}:` : "Dry run (nothing written; add --apply):");
console.log("  customers", customersSaid);
console.log("  orders", ordersSaid);
console.log("  invoices", invoicesSaid);
console.log("  payments", paymentsSaid);
if (!writes) console.log("  (a dry run finds no customer for an order until the customers are written)");
console.log(`  took ${Math.round((Date.now() - began) / 1000)}s`);
process.exit(0);
