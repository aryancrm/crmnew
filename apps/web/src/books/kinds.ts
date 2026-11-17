// The books' lists as Zoho Inventory names and draws them (docs/PLAN.md 17): the address of each
// list, its title, its columns (Zoho's own headings, in Zoho's order) and how money, days and
// statuses are written ("PHP765,450.00", "13 Nov 2026", "OVERDUE BY 3 DAYS").

import type { BookKind, BookRow } from "@2mg/api/types";

export type Column = {
  key: string;
  label: string;
  /** Sort key on the API, when the column sorts. */
  sort?: string;
  align?: "right" | "center";
  cell: (row: BookRow, today: string) => React.ReactNode | string;
};

export type KindInfo = {
  kind: BookKind;
  /** The address under /books, as Zoho's (#/purchaseorders). */
  path: string;
  /** "Purchase Orders" (the list), "Purchase Order" (one). */
  plural: string;
  one: string;
  /** What the number column is called. */
  numberLabel: string;
  section: "Sales" | "Purchases" | "Inventory" | "Banking" | "Accountant";
};

export const KINDS: KindInfo[] = [
  { kind: "purchase_order", path: "purchaseorders", plural: "Purchase Orders", one: "Purchase Order", numberLabel: "Purchase Order#", section: "Purchases" },
  { kind: "purchase_receive", path: "purchasereceives", plural: "Purchase Receives", one: "Purchase Receive", numberLabel: "Purchase Receive#", section: "Purchases" },
  { kind: "bill", path: "bills", plural: "Bills", one: "Bill", numberLabel: "Bill#", section: "Purchases" },
  { kind: "vendor_payment", path: "paymentsmade", plural: "Payments Made", one: "Payment Made", numberLabel: "Payment #", section: "Purchases" },
  { kind: "vendor_credit", path: "vendorcredits", plural: "Vendor Credits", one: "Vendor Credit", numberLabel: "Credit Note#", section: "Purchases" },
  { kind: "adjustment", path: "inventoryadjustments", plural: "Inventory Adjustments", one: "Inventory Adjustment", numberLabel: "Reference Number", section: "Inventory" },
  { kind: "package", path: "packages", plural: "Packages", one: "Package", numberLabel: "Package#", section: "Inventory" },
  { kind: "shipment", path: "shipments", plural: "Shipments", one: "Shipment", numberLabel: "Shipment Order#", section: "Inventory" },
  { kind: "transfer_order", path: "transferorders", plural: "Transfer Orders", one: "Transfer Order", numberLabel: "Transfer Order#", section: "Inventory" },
  { kind: "sales_order", path: "salesorders", plural: "Sales Orders", one: "Sales Order", numberLabel: "Sales Order#", section: "Sales" },
  { kind: "invoice", path: "invoices", plural: "Invoices", one: "Invoice", numberLabel: "Invoice#", section: "Sales" },
  { kind: "customer_payment", path: "paymentsreceived", plural: "Payments Received", one: "Payment Received", numberLabel: "Payment #", section: "Sales" },
  { kind: "sales_return", path: "salesreturns", plural: "Sales Returns", one: "Sales Return", numberLabel: "RMA#", section: "Sales" },
  { kind: "credit_note", path: "creditnotes", plural: "Credit Notes", one: "Credit Note", numberLabel: "Credit Note#", section: "Sales" },
  // Zoho Books' own (docs/PLAN.md 17).
  { kind: "refund", path: "refunds", plural: "Credit Note Refunds", one: "Refund", numberLabel: "Reference#", section: "Sales" },
  { kind: "expense", path: "expenses", plural: "Expenses", one: "Expense", numberLabel: "Expense#", section: "Purchases" },
  { kind: "recurring_expense", path: "recurringexpenses", plural: "Recurring Expenses", one: "Recurring Expense", numberLabel: "Profile Name", section: "Purchases" },
  { kind: "recurring_bill", path: "recurringbills", plural: "Recurring Bills", one: "Recurring Bill", numberLabel: "Profile Name", section: "Purchases" },
  { kind: "transfer_fund", path: "transfers", plural: "Transfers", one: "Transfer Fund", numberLabel: "Reference#", section: "Banking" },
  { kind: "deposit", path: "deposits", plural: "Deposits", one: "Deposit", numberLabel: "Reference#", section: "Banking" },
  { kind: "journal", path: "journals", plural: "Manual Journals", one: "Journal", numberLabel: "Journal#", section: "Accountant" },
  { kind: "fixed_asset", path: "fixedassets", plural: "Fixed Assets", one: "Fixed Asset", numberLabel: "Asset#", section: "Accountant" },
];
/** Books' own money lists: Finance, the CEO and the Admin read them. */
export const LEDGER_ROLES = ["finance", "ceo", "admin"];
export const kindByPath = (path: string | undefined) => KINDS.find((k) => k.path === path);
export const kindInfo = (kind: BookKind) => KINDS.find((k) => k.kind === kind);

// ------------------------------------------------------------------ writing

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-11-13" → "13 Nov 2026". */
export const zDate = (day: string | null | undefined) => {
  if (!day) return "";
  const [y, m, d] = day.slice(0, 10).split("-");
  return `${d} ${MONTHS[Number(m) - 1] ?? ""} ${y}`;
};
const twoPlaces = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Centavos as Zoho writes money: "PHP765,450.00". */
export const zMoney = (centavos: number | null | undefined, currency = "PHP") =>
  centavos === null || centavos === undefined ? "" : `${currency}${twoPlaces.format(centavos / 100)}`;
export const zQty = (qty: number | null | undefined) => (qty === null || qty === undefined ? "" : twoPlaces.format(qty));

/** Zoho's colour for each status word. */
export const STATUS_COLOR: Record<string, string> = {
  draft: "text-[#6c718a]",
  void: "text-[#6c718a]",
  cancelled: "text-[#6c718a]",
  closed: "text-[#22b378]",
  paid: "text-[#22b378]",
  billed: "text-[#22b378]",
  received: "text-[#22b378]",
  applied: "text-[#22b378]",
  refunded: "text-[#22b378]",
  overdue: "text-[#f76831]",
  invoiced: "text-[#22b378]",
  adjusted: "text-[#22b378]",
  transferred: "text-[#22b378]",
  delivered: "text-[#22b378]",
  not_shipped: "text-[#f76831]",
  completed: "text-[#22b378]",
  shipped: "text-[#22b378]",
  on_hold: "text-[#f76831]",
  exception: "text-[#f76831]",
  pending_approval: "text-[#f76831]",
  partially_paid: "text-[#f76831]",
  pending: "text-[#f76831]",
  in_transit: "text-[#f76831]",
  published: "text-[#22b378]",
  posted: "text-[#22b378]",
  nonbillable: "text-[#6c718a]",
  unbilled: "text-[#f76831]",
  reimbursed: "text-[#22b378]",
  active: "text-[#22b378]",
  stopped: "text-[#6c718a]",
  expired: "text-[#6c718a]",
};
/** "partially_billed" → "PARTIALLY BILLED"; an overdue bill "OVERDUE BY 3 DAYS". */
export function statusText(status: string, overdueDays?: number | null) {
  if (status === "overdue" && overdueDays) return `OVERDUE BY ${overdueDays} DAY${overdueDays === 1 ? "" : "S"}`;
  return status.replace(/_/g, " ").toUpperCase();
}
export const statusClass = (status: string) => STATUS_COLOR[status] ?? "text-[#408dfb]";
/** A view's name in the title menu: "All Purchase Orders", "Partially Billed". */
export const viewLabel = (key: string, plural: string) => (key === "all" ? `All ${plural}` : key === "zoho_to_finish" ? "Zoho's open orders to finish" : key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()));
