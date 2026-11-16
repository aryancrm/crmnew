// Zoho Inventory's documents into the books (docs/PLAN.md 17). Zoho's backup gives one CSV row per
// line (and per batch of a line) with the document's own fields repeated on each; this turns them
// back into documents with their lines, keeps every field that holds data (the ones without a
// column of their own under Zoho's name in `fields`), and writes them once: a document already
// here (same kind, same Zoho id) gets Zoho's newer status, balance and fields, its lines stay.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import type { Runner } from "../inventory/service";

export type BookKind =
  | "purchase_order"
  | "purchase_receive"
  | "bill"
  | "vendor_payment"
  | "vendor_credit"
  | "sales_order"
  | "invoice"
  | "customer_payment"
  | "sales_return"
  | "credit_note"
  | "package"
  | "shipment"
  | "transfer_order"
  | "adjustment";

export type Row = Record<string, string>;
type Fields = Record<string, string | number | boolean | null | unknown>;

export type BookLineInput = {
  itemName: string | null;
  sku: string | null;
  description: string | null;
  account: string | null;
  warehouse: string | null;
  unit: string | null;
  qty: number | null;
  rate: number | null;
  taxName: string | null;
  taxPct: number | null;
  /** Centavos. */
  taxAmount: number | null;
  amount: number | null;
  qtyDone: Record<string, number>;
  batches: Fields[];
  fields: Fields;
};

export type BookDocInput = {
  kind: BookKind;
  zohoId: string;
  number: string;
  reference: string | null;
  date: string;
  dueDate: string | null;
  status: string;
  /** The party as written: a vendor's or a customer's name. */
  party: string | null;
  partyZohoId: string | null;
  currency: string;
  fxRate: number;
  subTotal: number | null;
  total: number;
  balance: number;
  paymentTerms: string | null;
  notes: string | null;
  zohoCreated: string | null;
  zohoModified: string | null;
  fields: Fields;
  lines: BookLineInput[];
  /** Documents this one hangs on, by kind and number (a bill's purchase order), with the amount
   *  put on it when there is one (a payment on a bill). */
  links: { kind: BookKind; number: string; amount?: number | null; on?: string | null }[];
};

// ------------------------------------------------------------------ reading values

export const said = (value: string | undefined | null) => (value ?? "").trim();
const filled = (value: string | undefined | null) => {
  const text = said(value);
  return text === "" ? null : text;
};
export const num = (value: string | number | undefined | null): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = said(value).replace(/^[A-Z]{3}\s*/i, "").replace(/,/g, "");
  if (!text) return null;
  const found = Number(text);
  return Number.isFinite(found) ? found : null;
};
/** Whole centavos of a decimal amount. */
export const cents = (value: string | number | undefined | null): number | null => {
  const found = num(value);
  return found === null ? null : Math.round(found * 100);
};
const day = (value: string | undefined | null) => {
  const text = said(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
};
const time = (value: string | undefined | null) => {
  const text = said(value);
  if (!text) return null;
  const iso = text.includes("T") ? text : `${text.replace(" ", "T")}+08:00`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
};
/** Zoho's word for a status as a key: "Partially Billed" → partially_billed. */
export const statusKey = (value: string | undefined | null) =>
  said(value)
    // Zoho writes some in one word ("PartiallyPaid"): partially_paid.
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "") || "unknown";

/** The columns that change from one row of a document to the next are its lines' columns. */
export function lineColumns(groups: Row[][], columns: string[]): Set<string> {
  const line = new Set<string>();
  for (const group of groups) {
    if (group.length < 2) continue;
    const first = group[0] as Row;
    for (const column of columns) {
      if (line.has(column)) continue;
      if (group.some((row) => (row[column] ?? "") !== (first[column] ?? ""))) line.add(column);
    }
  }
  return line;
}

/** Every column with something in it that the typed fields did not take. */
function rest(row: Row, columns: string[], taken: Set<string>): Fields {
  const out: Fields = {};
  for (const column of columns) {
    if (taken.has(column)) continue;
    const value = filled(row[column]);
    if (value !== null) out[column] = value;
  }
  return out;
}

// ------------------------------------------------------------------ the CSV kinds

type LineSpec = {
  item?: string;
  sku?: string;
  description?: string;
  account?: string;
  warehouse?: string;
  unit?: string;
  qty?: string;
  rate?: string;
  taxName?: string;
  taxPct?: string;
  taxAmount?: string;
  amount?: string;
  /** Zoho's running counts, by our key. */
  done?: Record<string, string>;
  /** A line spread over batches: these columns are the batch's. */
  batch?: string[];
};

export type CsvSpec = {
  kind: BookKind;
  id: string;
  number: string;
  reference?: string;
  date: string;
  dueDate?: string;
  status: string;
  party?: string;
  partyId?: string;
  currency?: string;
  fx?: string;
  subTotal?: string;
  total?: string;
  balance?: string;
  paymentTerms?: string;
  notes?: string;
  created?: string;
  modified?: string;
  line: LineSpec;
  /** Line columns that name another document: kind and column. */
  linksFromLines?: { kind: BookKind; column: string; amount?: string; on?: string }[];
  linksFromHeader?: { kind: BookKind; column: string }[];
};

const BATCH = ["Batch ID", "Batch Reference#", "Manufacturer Batch#", "Manufactured Date", "Expiry Date", "Quantity In", "Quantity Out"];

export const CSV_SPECS: Record<string, CsvSpec> = {
  "Purchase_Order.csv": {
    kind: "purchase_order",
    id: "Purchase Order ID",
    number: "Purchase Order Number",
    reference: "Reference#",
    date: "Purchase Order Date",
    dueDate: "Delivery Date",
    status: "Purchase Order Status",
    party: "Vendor Name",
    currency: "Currency Code",
    fx: "Exchange Rate",
    total: "Total",
    paymentTerms: "Payment Terms Label",
    notes: "Delivery Instructions",
    line: {
      item: "Item Name",
      sku: "SKU",
      description: "Item Desc",
      account: "Account",
      warehouse: "Warehouse Name",
      unit: "Usage unit",
      qty: "QuantityOrdered",
      rate: "Item Price",
      taxName: "Item Tax",
      taxPct: "Item Tax %",
      taxAmount: "Item Tax Amount",
      amount: "Item Total",
      done: { received: "QuantityReceived", billed: "QuantityBilled", cancelled: "QuantityCancelled" },
    },
  },
  "Purchase_Receive.csv": {
    kind: "purchase_receive",
    id: "Purchase Receive ID",
    number: "Receive Number",
    reference: "PO Number",
    date: "Receive Date",
    status: "Status",
    party: "Vendor Name",
    notes: "Notes",
    created: "CreatedTime",
    modified: "Last Modified Time",
    line: { item: "Item Name", sku: "SKU", description: "Item Description", unit: "Item unit", qty: "Quantity Received", warehouse: "Warehouse Name", batch: BATCH },
    linksFromHeader: [{ kind: "purchase_order", column: "PO Number" }],
  },
  "Bill.csv": {
    kind: "bill",
    id: "PayInvoice ID",
    number: "Bill Number",
    reference: "PurchaseOrder",
    date: "Bill Date",
    dueDate: "Due Date",
    status: "Bill Status",
    party: "Vendor Name",
    currency: "Currency Code",
    fx: "Exchange Rate",
    subTotal: "SubTotal",
    total: "Total",
    balance: "Balance",
    notes: "Vendor Notes",
    line: {
      item: "Item Name",
      sku: "SKU",
      description: "Description",
      account: "Account",
      warehouse: "Warehouse Name",
      unit: "Usage unit",
      qty: "Quantity",
      rate: "Rate",
      taxName: "Tax Name",
      taxPct: "Tax Percentage",
      taxAmount: "Tax Amount",
      amount: "Item Total",
      batch: BATCH,
    },
    linksFromLines: [
      { kind: "purchase_order", column: "Purchase Order Number" },
      { kind: "purchase_receive", column: "Purchase Receive Number" },
    ],
  },
  "Vendor_Payment.csv": {
    kind: "vendor_payment",
    id: "VendorPayment ID",
    number: "Payment Number",
    reference: "Reference Number",
    date: "Date",
    status: "Payment Status",
    party: "Vendor Name",
    currency: "Currency Code",
    fx: "Exchange Rate",
    total: "Amount",
    notes: "Description",
    // A payment has no item lines: each row is a bill it was put on.
    line: {},
    linksFromLines: [{ kind: "bill", column: "Bill Number", on: "Bill Date" }],
  },
  "Sales_Order": {
    kind: "sales_order",
    id: "SalesOrder ID",
    number: "SalesOrder Number",
    reference: "PurchaseOrder",
    date: "Order Date",
    dueDate: "Expected Shipment Date",
    status: "Status",
    party: "Customer Name",
    partyId: "Customer ID",
    currency: "Currency Code",
    fx: "Exchange Rate",
    subTotal: "SubTotal",
    total: "Total",
    paymentTerms: "Payment Terms Label",
    notes: "Notes",
    line: {
      item: "Item Name",
      sku: "SKU",
      description: "Item Desc",
      warehouse: "Warehouse Name",
      unit: "Usage unit",
      qty: "QuantityOrdered",
      rate: "Item Price",
      taxName: "Item Tax",
      taxPct: "Item Tax %",
      taxAmount: "Item Tax Amount",
      amount: "Item Total",
      done: { invoiced: "QuantityInvoiced", packed: "QuantityPacked", cancelled: "QuantityCancelled" },
    },
  },
  "Invoice": {
    kind: "invoice",
    id: "Invoice ID",
    number: "Invoice Number",
    reference: "PurchaseOrder",
    date: "Invoice Date",
    dueDate: "Due Date",
    status: "Invoice Status",
    party: "Customer Name",
    partyId: "Customer ID",
    currency: "Currency Code",
    fx: "Exchange Rate",
    subTotal: "SubTotal",
    total: "Total",
    balance: "Balance",
    paymentTerms: "Payment Terms Label",
    notes: "Notes",
    line: {
      item: "Item Name",
      sku: "SKU",
      description: "Item Desc",
      warehouse: "Warehouse Name",
      unit: "Usage unit",
      qty: "Quantity",
      rate: "Item Price",
      taxName: "Item Tax",
      taxPct: "Item Tax %",
      taxAmount: "Item Tax Amount",
      amount: "Item Total",
      batch: BATCH,
    },
    linksFromLines: [{ kind: "sales_order", column: "Sales Order Number" }],
  },
  "Customer_Payment": {
    kind: "customer_payment",
    id: "CustomerPayment ID",
    number: "Payment Number Suffix",
    reference: "Reference Number",
    date: "Date",
    status: "Payment Status",
    party: "Customer Name",
    partyId: "CustomerID",
    currency: "Currency Code",
    fx: "Exchange Rate",
    total: "Amount",
    notes: "Description",
    created: "Created Time",
    // A payment has no item lines: each row is an invoice it was put on, with the amount.
    line: {},
    linksFromLines: [{ kind: "invoice", column: "Invoice Number", amount: "Invoice Amount", on: "Date" }],
  },
  "Inventory_Adjustment": {
    kind: "adjustment",
    id: "InventoryAdjustment ID",
    number: "CF.Adjustment Number",
    reference: "Reference#",
    date: "Date",
    status: "Status",
    notes: "Description",
    line: {
      item: "Item Name",
      sku: "SKU",
      description: "Item Desc",
      account: "Account",
      warehouse: "Warehouse Name",
      unit: "Usage unit",
      qty: "Quantity Adjusted",
      rate: "Cost Price",
      batch: BATCH,
    },
  },
  "Package": {
    kind: "package",
    id: "Packing Number",
    number: "Packing Number",
    reference: "SO Number",
    date: "Packing Date",
    status: "Status",
    party: "Customer Name",
    notes: "Notes",
    line: { item: "Item Name", sku: "SKU", qty: "Quantity Packed", rate: "Item Price", batch: BATCH },
    linksFromHeader: [{ kind: "sales_order", column: "SO Number" }],
  },
  "Shipment_Order": {
    kind: "shipment",
    id: "Shipment ID",
    number: "Shipment Number",
    reference: "Tracking Number",
    date: "Shipment Date",
    dueDate: "Delivery Date",
    status: "Status",
    party: "Customer Name",
    total: "Shipping Charge",
    notes: "Notes",
    created: "Created Time",
    modified: "Last Modified Time",
    line: {},
    linksFromHeader: [
      { kind: "sales_order", column: "SO Number" },
      { kind: "package", column: "Packing Number" },
    ],
  },
  "Transfer_Order.csv": {
    kind: "transfer_order",
    id: "InventoryAdjustment ID",
    number: "Transfer Order#",
    date: "Date",
    status: "Status",
    notes: "Reason",
    line: { item: "Item Name", sku: "SKU", description: "Item Desc", unit: "Usage unit", qty: "Quantity Transferred", rate: "Cost Price", batch: ["Source Batch Reference#", "Destination Batch Reference#", "Quantity Out"] },
  },
};

/** One CSV kind's rows (in any order) as documents. */
export function docsFromCsv(spec: CsvSpec, all: Row[], knownLineCols?: Set<string>): BookDocInput[] {
  if (!all.length) return [];
  const columns = Object.keys(all[0] as Row);
  const groups = new Map<string, Row[]>();
  for (const row of all) {
    const id = said(row[spec.id]);
    if (!id) continue;
    const group = groups.get(id);
    if (group) group.push(row);
    else groups.set(id, [row]);
  }
  const lineCols = knownLineCols ?? lineColumns([...groups.values()], columns);
  const headerTaken = new Set(
    [spec.id, spec.number, spec.reference, spec.date, spec.dueDate, spec.status, spec.party, spec.partyId, spec.currency, spec.fx, spec.subTotal, spec.total, spec.balance, spec.paymentTerms, spec.notes, spec.created, spec.modified].filter(Boolean) as string[],
  );
  const l = spec.line;
  const batchCols = new Set(l.batch ?? []);
  const lineTaken = new Set(
    [l.item, l.sku, l.description, l.account, l.warehouse, l.unit, l.qty, l.rate, l.taxName, l.taxPct, l.taxAmount, l.amount, ...Object.values(l.done ?? {}), ...(l.batch ?? []), ...(spec.linksFromLines ?? []).map((link) => link.column)].filter(Boolean) as string[],
  );
  const headerCols = columns.filter((column) => !lineCols.has(column) || headerTaken.has(column));
  const lineOnly = columns.filter((column) => lineCols.has(column) && !headerTaken.has(column));
  const hasItems = Boolean(l.item || l.account || l.qty);
  const out: BookDocInput[] = [];
  for (const [zohoId, group] of groups) {
    const head = group[0] as Row;
    const lines: BookLineInput[] = [];
    if (hasItems) {
      // Rows that differ only in their batch are one line received or billed from several batches.
      const byLine = new Map<string, BookLineInput>();
      for (const row of group) {
        const key = lineOnly.filter((column) => !batchCols.has(column)).map((column) => row[column] ?? "").join("\u0001");
        const batch = rest(row, [...batchCols], new Set());
        const found = byLine.get(key);
        if (found) {
          if (Object.keys(batch).length) found.batches.push(batch);
          continue;
        }
        const done: Record<string, number> = {};
        for (const [name, column] of Object.entries(l.done ?? {})) {
          const value = num(row[column]);
          if (value) done[name] = value;
        }
        const line: BookLineInput = {
          itemName: l.item ? filled(row[l.item]) : null,
          sku: l.sku ? filled(row[l.sku]) : null,
          description: l.description ? filled(row[l.description]) : null,
          account: l.account ? filled(row[l.account]) : null,
          warehouse: l.warehouse ? filled(row[l.warehouse]) : null,
          unit: l.unit ? filled(row[l.unit]) : null,
          qty: l.qty ? num(row[l.qty]) : null,
          rate: l.rate ? num(row[l.rate]) : null,
          taxName: l.taxName ? filled(row[l.taxName]) : null,
          taxPct: l.taxPct ? num(row[l.taxPct]) : null,
          taxAmount: l.taxAmount ? cents(row[l.taxAmount]) : null,
          amount: l.amount ? cents(row[l.amount]) : null,
          qtyDone: done,
          batches: Object.keys(batch).length ? [batch] : [],
          fields: rest(row, lineOnly, lineTaken),
        };
        byLine.set(key, line);
        lines.push(line);
      }
    }
    const links: BookDocInput["links"] = [];
    for (const link of spec.linksFromHeader ?? []) {
      const number = filled(head[link.column]);
      if (number) links.push({ kind: link.kind, number });
    }
    for (const link of spec.linksFromLines ?? [])
      for (const row of group) {
        const number = filled(row[link.column]);
        if (number && !links.some((have) => have.kind === link.kind && have.number === number))
          links.push({ kind: link.kind, number, amount: link.amount ? cents(row[link.amount]) : null, on: link.on ? day(row[link.on]) : null });
      }
    const total = cents(spec.total ? head[spec.total] : null) ?? lines.reduce((sum, line) => sum + (line.amount ?? 0), 0);
    const rawStatus = said(head[spec.status]);
    // A payment's balance is what it was not put on any invoice or bill for (its unused amount).
    const applied = links.reduce((sum, link) => sum + (link.amount ?? 0), 0);
    const balance = spec.kind === "customer_payment" ? Math.max(0, (cents(spec.total ? head[spec.total] : null) ?? 0) - applied) : (cents(spec.balance ? head[spec.balance] : null) ?? 0);
    out.push({
      kind: spec.kind,
      zohoId,
      number: said(head[spec.number]) || zohoId,
      reference: spec.reference ? filled(head[spec.reference]) : null,
      date: day(head[spec.date]) ?? "1970-01-01",
      dueDate: spec.dueDate ? day(head[spec.dueDate]) : null,
      // A few of Zoho's rows carry a number for a status: read it from the balance.
      status: /^\d+$/.test(rawStatus) ? (balance > 0 ? "open" : "paid") : statusKey(rawStatus),
      party: spec.party ? filled(head[spec.party]) : null,
      partyZohoId: spec.partyId ? filled(head[spec.partyId]) : null,
      currency: (spec.currency ? filled(head[spec.currency]) : null) ?? "PHP",
      fxRate: (spec.fx ? num(head[spec.fx]) : null) || 1,
      subTotal: spec.subTotal ? cents(head[spec.subTotal]) : null,
      total,
      balance,
      paymentTerms: spec.paymentTerms ? filled(head[spec.paymentTerms]) : null,
      notes: spec.notes ? filled(head[spec.notes]) : null,
      zohoCreated: spec.created ? time(head[spec.created]) : null,
      zohoModified: spec.modified ? time(head[spec.modified]) : null,
      fields: {
        ...rest(head, headerCols, headerTaken),
        ...(/^\d+$/.test(rawStatus) ? { "Bill Status": rawStatus } : {}),
      },
      lines,
      links,
    });
  }
  return out;
}

// ------------------------------------------------------------------ Zoho's API (JSON) kinds

type Json = Record<string, unknown>;
const str = (value: unknown) => (value === null || value === undefined || value === "" ? null : String(value));
const SKIP_JSON = new Set(["line_items", "bills_credited", "invoices_credited", "creditnote_refunds", "salesreturnreceives", "creditnotes", "comments", "documents", "contact_persons_details", "custom_fields", "custom_field_hash", "taxes", "template_id", "template_name", "template_type", "color_code", "current_sub_status_id", "price_precision", "currency_id", "currency_symbol", "page_width", "page_height", "orientation"]);

/** A document read from Zoho's API: its own fields (every one with something in it) and lines. */
function fromJson(kind: BookKind, doc: Json, keys: { id: string; number: string; party: string; partyId: string }): BookDocInput {
  const fields: Fields = {};
  for (const [key, value] of Object.entries(doc)) {
    if (SKIP_JSON.has(key) || value === null || value === "" || value === false) continue;
    if (Array.isArray(value) && !value.length) continue;
    fields[key] = value;
  }
  for (const custom of (doc.custom_fields as Json[] | undefined) ?? [])
    if (str(custom.value)) fields[`CF.${str(custom.label)}`] = custom.value;
  const lines: BookLineInput[] = ((doc.line_items as Json[] | undefined) ?? []).map((item) => {
    const lineFields: Fields = {};
    for (const [key, value] of Object.entries(item)) {
      if (["name", "sku", "description", "account_name", "warehouse_name", "unit", "quantity", "rate", "tax_name", "tax_percentage", "item_total", "batches", "line_item_id"].includes(key)) continue;
      if (value === null || value === "" || value === false || (Array.isArray(value) && !value.length)) continue;
      lineFields[key] = value;
    }
    return {
      itemName: str(item.name),
      sku: str(item.sku),
      description: str(item.description),
      account: str(item.account_name),
      warehouse: str(item.warehouse_name),
      unit: str(item.unit),
      qty: num(item.quantity as number),
      rate: num(item.rate as number),
      taxName: str(item.tax_name),
      taxPct: num(item.tax_percentage as number),
      taxAmount: null,
      amount: cents(item.item_total as number),
      qtyDone: Object.fromEntries(
        ["quantity_received", "quantity_refunded", "quantity_credited", "quantity_returned"]
          .filter((key) => num(item[key] as number))
          .map((key) => [key.replace("quantity_", ""), num(item[key] as number) as number]),
      ),
      batches: ((item.batches as Json[] | undefined) ?? []) as Fields[],
      fields: { ...lineFields, line_item_id: item.line_item_id },
    };
  });
  return {
    kind,
    zohoId: String(doc[keys.id]),
    number: str(doc[keys.number]) ?? String(doc[keys.id]),
    reference: str(doc.reference_number),
    date: str(doc.date) ?? "1970-01-01",
    dueDate: null,
    status: statusKey(str(doc.status) ?? str(doc.salesreturn_status)),
    party: str(doc[keys.party]),
    partyZohoId: str(doc[keys.partyId]),
    currency: str(doc.currency_code) ?? "PHP",
    fxRate: num(doc.exchange_rate as number) || 1,
    subTotal: cents(doc.sub_total as number),
    total: cents((doc.total ?? doc.return_amount ?? doc.bcy_total) as number) ?? 0,
    balance: cents(doc.balance as number) ?? 0,
    paymentTerms: null,
    notes: str(doc.notes),
    zohoCreated: str(doc.created_time),
    zohoModified: str(doc.last_modified_time),
    fields,
    lines,
    links: [],
  };
}

export function vendorCreditFromJson(doc: Json): BookDocInput {
  const out = fromJson("vendor_credit", doc, { id: "vendor_credit_id", number: "vendor_credit_number", party: "vendor_name", partyId: "vendor_id" });
  for (const bill of (doc.bills_credited as Json[] | undefined) ?? [])
    if (str(bill.bill_number)) out.links.push({ kind: "bill", number: String(bill.bill_number), amount: cents(bill.amount as number), on: str(bill.date) });
  return out;
}

export function creditNoteFromJson(doc: Json): BookDocInput {
  const out = fromJson("credit_note", doc, { id: "creditnote_id", number: "creditnote_number", party: "customer_name", partyId: "customer_id" });
  for (const invoice of (doc.invoices_credited as Json[] | undefined) ?? [])
    if (str(invoice.invoice_number))
      out.links.push({ kind: "invoice", number: String(invoice.invoice_number), amount: cents(invoice.amount_applied as number), on: str(invoice.date) });
  return out;
}

export function salesReturnFromJson(doc: Json): BookDocInput {
  const out = fromJson("sales_return", doc, { id: "salesreturn_id", number: "salesreturn_number", party: "customer_name", partyId: "customer_id" });
  if (str(doc.salesorder_number)) out.links.push({ kind: "sales_order", number: String(doc.salesorder_number) });
  for (const note of (doc.creditnotes as Json[] | undefined) ?? [])
    if (str(note.creditnote_number)) out.links.push({ kind: "credit_note", number: String(note.creditnote_number) });
  return out;
}

// ------------------------------------------------------------------ writing

export type BooksResult = { kind: BookKind; docs: number; made: number; updated: number; lines: number; links: number; noParty: number; medicines: number };

/** Vendors from Zoho's Vendors.csv: matched by Zoho's id, else by name; new ones added. */
export async function importVendors(db: Database, all: Row[], apply: boolean): Promise<{ vendors: number; made: number; matched: number }> {
  const said2 = (row: Row, column: string) => filled(row[column]);
  const address = (row: Row, side: "Billing" | "Shipping") =>
    [`${side} Attention`, `${side} Address`, `${side} Street2`, `${side} City`, `${side} State`, `${side} Code`, `${side} Country`]
      .map((column) => said2(row, column))
      .filter(Boolean)
      .join(", ") || null;
  const typed = new Set(["Contact ID", "Display Name", "Company Name", "EmailID", "Phone", "MobilePhone", "Website", "Currency Code", "CF.TIN", "Status", "Created Time"]);
  let made = 0;
  let matched = 0;
  for (const row of all) {
    const zohoId = said2(row, "Contact ID");
    const name = said2(row, "Display Name") ?? said2(row, "Contact Name");
    if (!zohoId || !name) continue;
    const columns = Object.keys(row);
    const fields = rest(row, columns, typed);
    const [have] = await rows<{ id: number }>(
      db,
      sql`select id::int as id from supplier where zoho_id = ${zohoId} or (zoho_id is null and lower(name) = lower(${name})) order by (zoho_id = ${zohoId}) desc nulls last limit 1`,
    );
    if (have) matched++;
    else made++;
    if (!apply) continue;
    // Zoho has a few vendors twice under one name: the second record's data is kept on the first.
    if (!have) {
      const [twin] = await rows<{ id: number }>(db, sql`select id::int as id from supplier where lower(name) = lower(${name}) and zoho_id is not null and zoho_id <> ${zohoId}`);
      if (twin) {
        const record = { "Contact ID": zohoId, ...rest(row, columns, new Set()) };
        await db.execute(
          sql`update supplier set fields = jsonb_set(fields, '{Other Zoho records}',
              coalesce(fields->'Other Zoho records', '[]'::jsonb) || ${JSON.stringify([record])}::jsonb)
            where id = ${twin.id} and not coalesce(fields->'Other Zoho records', '[]'::jsonb) @> ${JSON.stringify([{ "Contact ID": zohoId }])}::jsonb`,
        );
        continue;
      }
    }
    const values = {
      company: said2(row, "Company Name"),
      email: said2(row, "EmailID"),
      phone: said2(row, "Phone"),
      mobile: said2(row, "MobilePhone"),
      website: said2(row, "Website"),
      currency: said2(row, "Currency Code") ?? "PHP",
      tin: said2(row, "CF.TIN"),
      active: said2(row, "Status") !== "Inactive",
      created: time(row["Created Time"]),
    };
    if (have)
      await db.execute(
        sql`update supplier set zoho_id = ${zohoId}, company_name = ${values.company}, email = ${values.email}, phone = ${values.phone},
          mobile = ${values.mobile}, website = ${values.website}, tin = ${values.tin}, billing_address = ${address(row, "Billing")},
          shipping_address = ${address(row, "Shipping")}, fields = ${JSON.stringify(fields)}::jsonb, zoho_created = ${values.created}::timestamptz
          where id = ${have.id}`,
      );
    else
      await db.execute(
        sql`insert into supplier (name, currency, contact, active, zoho_id, company_name, email, phone, mobile, website, tin, billing_address, shipping_address, fields, zoho_created)
          values (${name}, ${values.currency}, ${said2(row, "Contact Name")}, ${values.active}, ${zohoId}, ${values.company}, ${values.email}, ${values.phone},
            ${values.mobile}, ${values.website}, ${values.tin}, ${address(row, "Billing")}, ${address(row, "Shipping")}, ${JSON.stringify(fields)}::jsonb,
            ${values.created}::timestamptz)
          on conflict (lower(name)) do update set zoho_id = coalesce(supplier.zoho_id, excluded.zoho_id)`,
      );
  }
  return { vendors: all.length, made, matched };
}

/** A vendor's people (Vendor_Contact_Persons.csv). */
export async function importVendorPeople(db: Database, all: Row[], apply: boolean): Promise<number> {
  let made = 0;
  for (const row of all) {
    const name = [filled(row["Salutation"]), filled(row["First Name"]), filled(row["Last Name"])].filter(Boolean).join(" ");
    const vendorZoho = filled(row["Vendor ID"]) ?? filled(row["Contact ID"]);
    const personZoho = filled(row["Contact Person ID"]) ?? `${vendorZoho}:${name}`;
    if (!vendorZoho || !name) continue;
    const [vendor] = await rows<{ id: number }>(db, sql`select id::int as id from supplier where zoho_id = ${vendorZoho}`);
    if (!vendor) continue;
    made++;
    if (!apply) continue;
    const fields = rest(row, Object.keys(row), new Set(["Vendor ID", "Contact ID", "Contact Person ID", "Salutation", "First Name", "Last Name", "EmailID", "Phone", "MobilePhone", "Designation"]));
    await db.execute(
      sql`insert into supplier_person (supplier_id, zoho_id, name, email, phone, mobile, designation, fields)
        values (${vendor.id}, ${personZoho}, ${name}, ${filled(row.EmailID)}, ${filled(row.Phone)}, ${filled(row.MobilePhone)}, ${filled(row.Designation)}, ${JSON.stringify(fields)}::jsonb)
        on conflict (zoho_id) do nothing`,
    );
  }
  return made;
}

/** Writes documents of one kind; links are made afterwards by `linkDocs`, once every kind is in. */
export async function saveDocs(db: Database, docs: BookDocInput[], apply: boolean): Promise<BooksResult> {
  const kind = docs[0]?.kind ?? "bill";
  const result: BooksResult = { kind, docs: docs.length, made: 0, updated: 0, lines: 0, links: 0, noParty: 0, medicines: 0 };
  const skus = new Map(
    (await rows<{ sku: string; id: number }>(db, sql`select lower(sku) as sku, medicine_id::int as id from medicine_sku`)).map((row) => [row.sku, row.id]),
  );
  const vendor = kind === "purchase_order" || kind === "purchase_receive" || kind === "bill" || kind === "vendor_payment" || kind === "vendor_credit";
  const parties = new Map<string, number>(
    vendor
      ? (await rows<{ key: string; id: number }>(db, sql`select lower(name) as key, id::int as id from supplier union all select zoho_id, id::int from supplier where zoho_id is not null`)).map((row) => [row.key, row.id])
      : // Every Zoho contact, also those merged into one customer here (zoho_contact).
        (await rows<{ key: string; id: number }>(db, sql`select zoho_id as key, id::int as id from customer where zoho_id is not null
            union all select zoho_id, customer_id::int from zoho_contact`)).map((row) => [row.key, row.id]),
  );
  const have = new Map(
    (await rows<{ zohoId: string; id: number }>(db, sql`select zoho_id as "zohoId", id::int as id from book_doc where kind = ${kind} and zoho_id is not null`)).map((row) => [row.zohoId, row.id]),
  );
  for (const doc of docs) {
    const partyId = (doc.partyZohoId && parties.get(doc.partyZohoId)) || (doc.party && parties.get(doc.party.toLowerCase())) || null;
    if (!partyId) result.noParty++;
    const existing = have.get(doc.zohoId);
    if (existing) {
      result.updated++;
      if (apply)
        await db.execute(
          sql`update book_doc set status = ${doc.status}, total = ${doc.total}, balance = ${doc.balance}, due_date = ${doc.dueDate}::date,
            fields = fields || ${JSON.stringify(doc.fields)}::jsonb, zoho_modified = ${doc.zohoModified}::timestamptz,
            supplier_id = coalesce(supplier_id, ${vendor ? partyId : null}), customer_id = coalesce(customer_id, ${vendor ? null : partyId})
            where id = ${existing}`,
        );
      continue;
    }
    result.made++;
    result.lines += doc.lines.length;
    const matched = doc.lines.filter((line) => line.sku && skus.has(line.sku.toLowerCase())).length;
    result.medicines += matched;
    if (!apply) continue;
    const [made] = await rows<{ id: number }>(
      db,
      sql`insert into book_doc (kind, zoho_id, number, reference, doc_date, due_date, status, supplier_id, customer_id, party_name, currency, fx_rate,
          sub_total, total, balance, payment_terms, notes, fields, zoho_created, zoho_modified)
        values (${doc.kind}, ${doc.zohoId}, ${doc.number}, ${doc.reference}, ${doc.date}::date, ${doc.dueDate}::date, ${doc.status},
          ${vendor ? partyId : null}, ${vendor ? null : partyId}, ${doc.party}, ${doc.currency}, ${doc.fxRate}, ${doc.subTotal}, ${doc.total}, ${doc.balance},
          ${doc.paymentTerms}, ${doc.notes}, ${JSON.stringify(doc.fields)}::jsonb, ${doc.zohoCreated}::timestamptz, ${doc.zohoModified}::timestamptz)
        returning id::int as id`,
    );
    if (!made) continue;
    if (doc.lines.length)
      await db.execute(
        sql`insert into book_line (doc_id, n, medicine_id, item_name, sku, description, account, warehouse, unit, qty, rate, tax_name, tax_pct, tax_amount, amount, qty_done, batches, fields)
          values ${sql.join(
            doc.lines.map(
              (line, n) =>
                sql`(${made.id}, ${n + 1}, ${(line.sku && skus.get(line.sku.toLowerCase())) ?? null}, ${line.itemName}, ${line.sku}, ${line.description}, ${line.account},
                  ${line.warehouse}, ${line.unit}, ${line.qty}, ${line.rate}, ${line.taxName}, ${line.taxPct}, ${line.taxAmount}, ${line.amount},
                  ${JSON.stringify(line.qtyDone)}::jsonb, ${JSON.stringify(line.batches)}::jsonb, ${JSON.stringify(line.fields)}::jsonb)`,
            ),
            sql`, `,
          )}`,
      );
  }
  return result;
}

/** Ties documents together by the numbers they name (a bill's purchase order, a payment's bills). */
export async function linkDocs(db: Runner, docs: Pick<BookDocInput, "kind" | "zohoId" | "links">[], apply: boolean): Promise<{ links: number; missing: number }> {
  let links = 0;
  let missing = 0;
  const kind = docs[0]?.kind;
  if (!kind) return { links, missing };
  const ids = new Map(
    (await rows<{ zohoId: string; id: number }>(db, sql`select zoho_id as "zohoId", id::int as id from book_doc where kind = ${kind} and zoho_id is not null`)).map((row) => [row.zohoId, row.id]),
  );
  const byNumber = new Map<string, number>();
  for (const target of new Set(docs.flatMap((doc) => doc.links.map((link) => link.kind))))
    for (const row of await rows<{ number: string; id: number }>(db, sql`select lower(number) as number, id::int as id from book_doc where kind = ${target}`))
      byNumber.set(`${target}:${row.number}`, row.id);
  for (const doc of docs) {
    const from = ids.get(doc.zohoId);
    if (!from) continue;
    for (const link of doc.links) {
      const to = byNumber.get(`${link.kind}:${link.number.toLowerCase()}`);
      if (!to) {
        missing++;
        continue;
      }
      links++;
      if (apply)
        await db.execute(
          sql`insert into book_link (from_doc, to_doc, amount, on_date) values (${from}, ${to}, ${link.amount ?? null}, ${link.on ?? null}::date)
            on conflict (from_doc, to_doc) do update set amount = coalesce(excluded.amount, book_link.amount)`,
        );
    }
  }
  return { links, missing };
}

// ------------------------------------------------------------------ Zoho's lists, for today's state

const LIST_KEYS: Partial<Record<BookKind, { id: string; balance?: string; total?: string }>> = {
  purchase_order: { id: "purchaseorder_id", total: "total" },
  purchase_receive: { id: "purchasereceive_id" },
  bill: { id: "bill_id", balance: "balance", total: "total" },
  // A payment's balance is what is not put on any bill yet (Zoho's "Unused Amount").
  vendor_payment: { id: "payment_id", balance: "balance", total: "amount" },
  sales_order: { id: "salesorder_id", total: "total" },
  invoice: { id: "invoice_id", balance: "balance", total: "total" },
  customer_payment: { id: "payment_id", balance: "unused_amount", total: "amount" },
  credit_note: { id: "creditnote_id", balance: "balance", total: "total" },
  sales_return: { id: "salesreturn_id" },
  package: { id: "package_number" },
  shipment: { id: "shipment_id" },
  adjustment: { id: "inventory_adjustment_id" },
};
/** What Zoho's list says of a document that is not on the document itself (a sales order's
 *  invoiced, paid, packed and shipped states, its delivery method), kept in its fields. */
const LIST_FIELDS: Partial<Record<BookKind, string[]>> = {
  sales_order: ["invoiced_status", "paid_status", "shipped_status", "order_status", "delivery_method", "salesperson_name", "is_backorder"],
  invoice: ["salesperson_name", "due_days", "is_viewed_by_client"],
  sales_return: ["receive_status", "refund_status", "salesreturn_status"],
  adjustment: ["created_by_name", "created_time", "last_modified_by_name", "last_modified_time", "reason"],
  shipment: ["carrier", "tracking_number", "delivery_date"],
};

/** Zoho writes a time as text ("2026-11-13T08:35:46+0800") or, in some lists, as milliseconds. */
const zohoTime = (value: unknown) => (typeof value === "number" ? new Date(value).toISOString() : /^\d{12,}$/.test(String(value ?? "")) ? new Date(Number(value)).toISOString() : str(value));

/** Brings each document's state as Zoho's list shows it today (status, balance, a payment's unused
 *  amount); says which of Zoho's documents are not here yet (made after the backup). */
export async function refreshFromList(db: Database, kind: BookKind, items: Record<string, unknown>[], apply: boolean): Promise<{ seen: number; updated: number; notHere: string[] }> {
  const keys = LIST_KEYS[kind];
  if (!keys) return { seen: 0, updated: 0, notHere: [] };
  const have = new Map(
    (await rows<{ zohoId: string; id: number }>(db, sql`select zoho_id as "zohoId", id::int as id from book_doc where kind = ${kind} and zoho_id is not null`)).map((row) => [row.zohoId, row.id]),
  );
  let updated = 0;
  const notHere: string[] = [];
  for (const item of items) {
    const zohoId = str(item[keys.id]);
    if (!zohoId) continue;
    const id = have.get(zohoId);
    if (!id) {
      notHere.push(zohoId);
      continue;
    }
    updated++;
    if (!apply) continue;
    // A receive's own status is whether it was received (Zoho's list says "billed" once billed).
    const word = kind === "purchase_receive" ? (item.received_status ?? item.status) : kind === "sales_return" ? item.salesreturn_status : kind === "customer_payment" ? item.payment_status : kind === "sales_order" ? (item.order_status ?? item.status) : item.status;
    const status = statusKey(str(word));
    const extra = Object.fromEntries((LIST_FIELDS[kind] ?? []).filter((key) => str(item[key]) !== null).map((key) => [key, item[key]]));
    const balance = keys.balance ? cents(item[keys.balance] as number) : null;
    const total = keys.total ? cents(item[keys.total] as number) : null;
    await db.execute(
      sql`update book_doc set status = ${status}, balance = coalesce(${balance}, balance), total = coalesce(${total}, total),
        fields = fields || ${JSON.stringify(extra)}::jsonb,
        zoho_modified = coalesce(${zohoTime(item.last_modified_time)}::timestamptz, zoho_modified) where id = ${id}`,
    );
  }
  return { seen: items.length, updated, notHere };
}

/** Each vendor's unused credits and payables that no document here explains (advances and opening
 *  balances kept in Zoho Books), from Zoho's vendor list in pesos: kept as the vendor's opening
 *  credits and payables, so each vendor's figures stay Zoho's own. */
export async function openingCredits(db: Database, listed: Record<string, unknown>[], apply: boolean): Promise<{ vendors: number; credits: number; payables: number }> {
  let vendors = 0;
  let credits = 0;
  let payables = 0;
  if (apply) await db.execute(sql`update supplier set opening_credits = 0, opening_payables = 0 where opening_credits <> 0 or opening_payables <> 0`);
  for (const v of listed) {
    const zohoId = str(v.contact_id);
    if (!zohoId) continue;
    const unused = cents((v.unused_credits_payable_amount_bcy ?? v.unused_credits_payable_amount) as number) ?? 0;
    const owed = cents((v.outstanding_payable_amount_bcy ?? v.outstanding_payable_amount) as number) ?? 0;
    const [found] = await rows<{ id: number; credits: number; payables: number }>(
      db,
      sql`select s.id::int as id,
          coalesce((select sum(round(d.balance * d.fx_rate)) from book_doc d where d.supplier_id = s.id and d.zoho_id is not null and d.kind in ('vendor_credit', 'vendor_payment') and d.status not in ('void', 'draft', 'pending_approval')), 0)::float8 as credits,
          coalesce((select sum(round(d.balance * d.fx_rate)) from book_doc d where d.supplier_id = s.id and d.zoho_id is not null and d.kind = 'bill' and d.status not in ('void', 'draft', 'pending_approval')), 0)::float8 as payables
        from supplier s where s.zoho_id = ${zohoId}`,
    );
    if (!found) continue;
    const openCredits = Math.max(0, unused - found.credits);
    const openPayables = Math.max(0, owed - found.payables);
    if (!openCredits && !openPayables) continue;
    vendors++;
    credits += openCredits;
    payables += openPayables;
    if (apply) await db.execute(sql`update supplier set opening_credits = ${openCredits}, opening_payables = ${openPayables} where id = ${found.id}`);
  }
  return { vendors, credits, payables };
}

/** Customers' own fields from Zoho's Contacts (every column with data), and their people. */
export async function customerFields(db: Database, all: Iterable<Row>, apply: boolean): Promise<{ seen: number; matched: number }> {
  let seen = 0;
  let matched = 0;
  const primary = new Map(
    (await rows<{ zohoId: string; id: number }>(db, sql`select zoho_id as "zohoId", id::int as id from customer where zoho_id is not null`)).map((row) => [row.zohoId, row.id]),
  );
  const merged = new Map(
    (await rows<{ zohoId: string; id: number }>(db, sql`select zoho_id as "zohoId", customer_id::int as id from zoho_contact`)).map((row) => [row.zohoId, row.id]),
  );
  for (const row of all) {
    seen++;
    const zohoId = said(row["Contact ID"]);
    const id = primary.get(zohoId) ?? merged.get(zohoId);
    if (!id) continue;
    matched++;
    if (!apply) continue;
    if (primary.has(zohoId)) {
      const fields = rest(row, Object.keys(row), new Set(["Contact ID"]));
      await db.execute(sql`update customer set zoho_fields = ${JSON.stringify(fields)}::jsonb || jsonb_strip_nulls(jsonb_build_object('Other Zoho records', zoho_fields->'Other Zoho records')) where id = ${id}`);
    } else {
      // A Zoho contact merged into this customer here: its own record is kept beside the main one.
      const record = { "Contact ID": zohoId, ...rest(row, Object.keys(row), new Set(["Contact ID"])) };
      await db.execute(
        sql`update customer set zoho_fields = jsonb_set(zoho_fields, '{Other Zoho records}', coalesce(zoho_fields->'Other Zoho records', '[]'::jsonb) || ${JSON.stringify([record])}::jsonb)
          where id = ${id} and not coalesce(zoho_fields->'Other Zoho records', '[]'::jsonb) @> ${JSON.stringify([{ "Contact ID": zohoId }])}::jsonb`,
      );
    }
  }
  return { seen, matched };
}

export async function importCustomerPeople(db: Database, all: Row[], apply: boolean): Promise<number> {
  let made = 0;
  for (const row of all) {
    const name = [filled(row.Salutation), filled(row["First Name"]), filled(row["Last Name"])].filter(Boolean).join(" ");
    const owner = filled(row["Contact ID"]) ?? filled(row["Customer ID"]);
    if (!owner || !name) continue;
    const [customer] = await rows<{ id: number }>(db, sql`select id::int as id from customer where zoho_id = ${owner} union all select customer_id::int from zoho_contact where zoho_id = ${owner} limit 1`);
    if (!customer) continue;
    made++;
    if (!apply) continue;
    const fields = rest(row, Object.keys(row), new Set(["Contact ID", "Customer ID", "Contact Person ID", "Salutation", "First Name", "Last Name", "EmailID", "Phone", "MobilePhone", "Designation"]));
    await db.execute(
      sql`insert into customer_person (customer_id, zoho_id, name, email, phone, mobile, designation, fields)
        values (${customer.id}, ${filled(row["Contact Person ID"]) ?? `${owner}:${name}`}, ${name}, ${filled(row.EmailID)}, ${filled(row.Phone)}, ${filled(row.MobilePhone)},
          ${filled(row.Designation)}, ${JSON.stringify(fields)}::jsonb)
        on conflict (zoho_id) do nothing`,
    );
  }
  return made;
}

/** Each customer's receivables and unused credits that no Zoho document here explains (opening
 *  balances and advances in Zoho Books), from Zoho's customer list: kept as opening figures. Zoho
 *  contacts merged into one customer here add up. */
export async function customerOpenings(db: Database, listed: Record<string, unknown>[], apply: boolean): Promise<{ customers: number; receivables: number; credits: number; notHere: number }> {
  const customerOf = new Map(
    (await rows<{ zohoId: string; id: number }>(db, sql`select zoho_id as "zohoId", id::int as id from customer where zoho_id is not null union all select zoho_id, customer_id::int from zoho_contact`)).map(
      (row) => [row.zohoId, row.id],
    ),
  );
  const zoho = new Map<number, { owed: number; unused: number }>();
  let notHere = 0;
  for (const v of listed) {
    const zohoId = str(v.contact_id);
    if (!zohoId) continue;
    const owed = cents((v.outstanding_receivable_amount_bcy ?? v.outstanding_receivable_amount) as number) ?? 0;
    const unused = cents((v.unused_credits_receivable_amount_bcy ?? v.unused_credits_receivable_amount) as number) ?? 0;
    if (!owed && !unused) continue;
    const id = customerOf.get(zohoId);
    if (!id) {
      notHere++;
      continue;
    }
    const have = zoho.get(id) ?? { owed: 0, unused: 0 };
    zoho.set(id, { owed: have.owed + owed, unused: have.unused + unused });
  }
  const explained = new Map(
    (
      await rows<{ id: number; owed: number; unused: number }>(
        db,
        sql`select d.customer_id::int as id,
            coalesce(sum(round(d.balance * d.fx_rate)) filter (where d.kind = 'invoice' and d.status not in ('void', 'draft')), 0)::float8 as owed,
            coalesce(sum(round(d.balance * d.fx_rate)) filter (where d.kind in ('credit_note', 'customer_payment') and d.status not in ('void', 'draft')), 0)::float8 as unused
          from book_doc d where d.zoho_id is not null and d.customer_id is not null group by d.customer_id`,
      )
    ).map((row) => [row.id, row]),
  );
  let customers = 0;
  let receivables = 0;
  let credits = 0;
  // Worked out afresh each time: what an earlier run kept and Zoho no longer says goes.
  if (apply) await db.execute(sql`update customer set opening_receivables = 0, opening_credits = 0 where opening_receivables <> 0 or opening_credits <> 0`);
  for (const [id, total] of zoho) {
    const here = explained.get(id) ?? { owed: 0, unused: 0 };
    const openOwed = Math.max(0, total.owed - here.owed);
    const openCredits = Math.max(0, total.unused - here.unused);
    if (!openOwed && !openCredits) continue;
    customers++;
    receivables += openOwed;
    credits += openCredits;
    if (apply) await db.execute(sql`update customer set opening_receivables = ${openOwed}, opening_credits = ${openCredits} where id = ${id}`);
  }
  return { customers, receivables, credits, notHere };
}

// ------------------------------------------------------------------ sales documents made after the backup, from Zoho's API

export function salesOrderFromJson(doc: Json): BookDocInput {
  const out = fromJson("sales_order", doc, { id: "salesorder_id", number: "salesorder_number", party: "customer_name", partyId: "customer_id" });
  out.status = statusKey(str(doc.order_status) ?? str(doc.status));
  out.dueDate = str(doc.shipment_date);
  for (const [at, item] of ((doc.line_items as Json[] | undefined) ?? []).entries()) {
    const line = out.lines[at];
    if (!line) continue;
    for (const [key, name] of [["quantity_invoiced", "invoiced"], ["quantity_packed", "packed"], ["quantity_cancelled", "cancelled"], ["quantity_shipped", "shipped"]] as const) {
      const value = num(item[key] as number);
      if (value) line.qtyDone[name] = value;
    }
  }
  for (const key of ["invoiced_status", "paid_status", "shipped_status", "delivery_method"]) if (str(doc[key])) out.fields[key] = doc[key];
  return out;
}

export function invoiceFromJson(doc: Json): BookDocInput {
  const out = fromJson("invoice", doc, { id: "invoice_id", number: "invoice_number", party: "customer_name", partyId: "customer_id" });
  out.dueDate = str(doc.due_date);
  const orders = new Set<string>();
  for (const item of (doc.line_items as Json[] | undefined) ?? []) if (str(item.salesorder_number)) orders.add(String(item.salesorder_number));
  for (const so of (doc.salesorders as Json[] | undefined) ?? []) if (str(so.salesorder_number)) orders.add(String(so.salesorder_number));
  if (str(doc.salesorder_number)) orders.add(String(doc.salesorder_number));
  for (const number of orders) out.links.push({ kind: "sales_order", number });
  return out;
}

export function customerPaymentFromJson(doc: Json): BookDocInput {
  const out = fromJson("customer_payment", doc, { id: "payment_id", number: "payment_number", party: "customer_name", partyId: "customer_id" });
  out.total = cents(doc.amount as number) ?? 0;
  out.balance = cents(doc.unused_amount as number) ?? 0;
  out.status = statusKey(str(doc.payment_status) ?? "paid");
  if (str(doc.payment_mode)) out.fields.Mode = doc.payment_mode;
  for (const invoice of (doc.invoices as Json[] | undefined) ?? [])
    if (str(invoice.invoice_number))
      out.links.push({ kind: "invoice", number: String(invoice.invoice_number), amount: cents(invoice.amount_applied as number), on: str(doc.date) });
  return out;
}

// ------------------------------------------------------------------ items and price lists

/** Every Zoho item (Item.csv: one row per item and batch), with Zoho's stock figures from its list
 *  when read, matched to a medicine through its SKU. */
export async function importItems(db: Database, all: Row[], listed: Record<string, unknown>[], apply: boolean): Promise<{ items: number; made: number; medicines: number }> {
  const groups = new Map<string, Row[]>();
  for (const row of all) {
    const id = said(row["Item ID"]);
    if (id) groups.set(id, [...(groups.get(id) ?? []), row]);
  }
  const stock = new Map(listed.map((item) => [String(item.item_id), item]));
  const skus = new Map(
    (await rows<{ sku: string; id: number }>(db, sql`select lower(sku) as sku, medicine_id::int as id from medicine_sku`)).map((row) => [row.sku, row.id]),
  );
  const batchCols = ["Batch ID", "Batch Reference#", "Manufacturer Batch#", "Manufactured Date", "Expiry Date", "Quantity In", "Warehouse Name", "Opening Stock", "Opening Stock Value", "Stock On Hand"];
  const typed = new Set(["Item ID", "Item Name", "SKU", "Status", "Item Type", "Unit", "Selling Price", "Purchase Price", "Reorder Level", "Created Time", "Last Modified Time", ...batchCols]);
  let made = 0;
  let medicines = 0;
  for (const [zohoId, group] of groups) {
    const head = group[0] as Row;
    const sku = filled(head.SKU);
    const medicineId = sku ? (skus.get(sku.toLowerCase()) ?? null) : null;
    if (medicineId) medicines++;
    made++;
    if (!apply) continue;
    const listItem = stock.get(zohoId) ?? {};
    const zohoStock = Object.fromEntries(
      ["stock_on_hand", "available_stock", "actual_available_stock", "committed_stock", "actual_committed_stock", "available_for_sale_stock", "actual_available_for_sale_stock", "reorder_level"]
        .filter((key) => listItem[key] !== undefined && listItem[key] !== null && listItem[key] !== "")
        .map((key) => [key, listItem[key]]),
    );
    const batches = group.map((row) => rest(row, batchCols, new Set())).filter((batch) => Object.keys(batch).length);
    await db.execute(
      sql`insert into book_item (zoho_id, name, sku, status, item_type, unit, rate, purchase_rate, reorder_level, zoho_stock, batches, fields, medicine_id, zoho_created, zoho_modified)
        values (${zohoId}, ${said(head["Item Name"])}, ${sku}, ${statusKey(head.Status)}, ${filled(head["Item Type"])}, ${filled(head.Unit)}, ${cents(head["Selling Price"])},
          ${cents(head["Purchase Price"])}, ${num(head["Reorder Level"])}, ${JSON.stringify(zohoStock)}::jsonb, ${JSON.stringify(batches)}::jsonb,
          ${JSON.stringify(rest(head, Object.keys(head), typed))}::jsonb, ${medicineId}, ${time(head["Created Time"])}::timestamptz, ${time(head["Last Modified Time"])}::timestamptz)
        on conflict (zoho_id) do update set name = excluded.name, sku = excluded.sku, status = excluded.status, rate = excluded.rate, purchase_rate = excluded.purchase_rate,
          reorder_level = excluded.reorder_level, zoho_stock = excluded.zoho_stock, batches = excluded.batches, fields = excluded.fields,
          medicine_id = coalesce(excluded.medicine_id, book_item.medicine_id), zoho_modified = excluded.zoho_modified`,
    );
  }
  return { items: groups.size, made, medicines };
}

export async function importPriceLists(db: Database, all: Row[], apply: boolean): Promise<number> {
  let made = 0;
  for (const row of all) {
    const zohoId = filled(row["PriceList ID"]);
    if (!zohoId) continue;
    made++;
    if (!apply) continue;
    const pct = filled(row.Percentage);
    const details = pct ? `${pct}% ${row["Is Increase"] === "true" ? "Markup" : "Markdown"}` : null;
    await db.execute(
      sql`insert into book_price_list (zoho_id, name, currency, kind, details, scheme, rounding, status, fields)
        values (${zohoId}, ${said(row["PriceList Name"])}, ${filled(row["Currency Code"])}, ${filled(row.Type)}, ${details}, ${filled(row["Pricing Scheme"])},
          ${filled(row["Rounding Type"])}, ${filled(row["PriceList Status"])}, ${JSON.stringify(rest(row, Object.keys(row), new Set(["PriceList ID", "PriceList Name"])))}::jsonb)
        on conflict (zoho_id) do update set name = excluded.name, details = excluded.details, status = excluded.status, fields = excluded.fields`,
    );
  }
  return made;
}

export function packageFromJson(doc: Json): BookDocInput {
  // Zoho's backup has no package id: packages are kept by their number, from the API too.
  const out = fromJson("package", { ...doc, package_key: doc.package_number }, { id: "package_key", number: "package_number", party: "customer_name", partyId: "customer_id" });
  out.reference = str(doc.salesorder_number);
  out.fields.carrier = doc.carrier ?? doc.delivery_method;
  if (str(doc.salesorder_number)) out.links.push({ kind: "sales_order", number: String(doc.salesorder_number) });
  return out;
}

export function shipmentFromJson(doc: Json): BookDocInput {
  const out = fromJson("shipment", doc, { id: "shipment_id", number: "shipment_number", party: "customer_name", partyId: "customer_id" });
  out.reference = str(doc.tracking_number);
  out.total = cents(doc.shipping_charge as number) ?? 0;
  out.status = statusKey(str(doc.status) ?? str(doc.shipment_status));
  out.fields["SO Number"] = doc.salesorder_number;
  out.fields["Carrier Name"] = doc.carrier ?? doc.delivery_method;
  const packages = ((doc.packages as Json[] | undefined) ?? []).map((p) => str(p.package_number)).filter(Boolean) as string[];
  if (packages[0]) out.fields["Packing Number"] = packages[0];
  if (str(doc.salesorder_number)) out.links.push({ kind: "sales_order", number: String(doc.salesorder_number) });
  for (const number of packages) out.links.push({ kind: "package", number });
  return out;
}
