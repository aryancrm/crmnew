// Finance's words and rules, with no database: who may act, how an invoice is numbered and
// split for VAT, when it falls due, and how an unpaid one reads ("Overdue by 12 days").

import type { Role } from "../people/roles";
import type { InvoiceFrom, InvoiceState, PaymentMethod, PaymentTerms, Vat } from "../types";

/** Who confirms payments, makes invoices and records money. */
export const FINANCE_ROLES: readonly Role[] = ["finance", "admin"];
/** Who reads Finance's lists. */
export const FINANCE_READ_ROLES: readonly Role[] = ["finance", "admin", "ceo", "management"];

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  bank: "Bank transfer",
  cash: "Cash",
  check: "Check",
  ewallet: "GCash / Maya",
  other: "Other",
  points: "Points",
  withholding: "Tax withheld (2307)",
  credit: "Customer's credit",
};
export const METHODS = Object.keys(METHOD_LABEL) as PaymentMethod[];
/** What a person records by hand: points are paid only by the points the order used; tax withheld
 *  comes with the money it was withheld from. */
export const STAFF_METHODS = METHODS.filter(
  (method) => method !== "points" && method !== "withholding" && method !== "credit",
);
/** Settled without cash: never counted as money in, never given back as money. */
export const NOT_CASH = ["points", "withholding", "credit"] as const;

/** Each company's own invoice series. */
const SERIES: Record<InvoiceFrom, string> = { "2mg": "2MG-SI-", getmeds: "INV-" };
export const invoiceCode = (from: InvoiceFrom, n: number) =>
  `${SERIES[from]}${String(n).padStart(6, "0")}`;

/** The VAT inside an invoice's lines. Prices include VAT; a 12% line holds 12/112 of itself as
 *  VAT. Worked out once over all its 12% lines, so the parts always add up to the total. */
export function vatSplit(lines: { amount: number; vat: Vat }[]): {
  vatable: number;
  vat: number;
  exempt: number;
  zeroRated: number;
} {
  const sum = (kind: Vat) =>
    lines.filter((line) => line.vat === kind).reduce((total, line) => total + line.amount, 0);
  const gross = sum("vat12");
  const vat = Math.round((gross * 12) / 112);
  return { vatable: gross - vat, vat, exempt: sum("exempt"), zeroRated: sum("zero") };
}

/** A day plus some days, as YYYY-MM-DD. */
export function addDays(day: string, days: number): string {
  const at = new Date(`${day}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/** Days from one day to another (positive when `to` is later). */
export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** When an invoice falls due: on credit, so many days after it is made; cash on delivery, the
 *  day the goods are expected (or the day it is made); paid in advance, at once. */
export function dueOn(
  terms: PaymentTerms,
  days: number | null,
  issuedOn: string,
  expectedOn: string | null,
): string {
  if (terms === "days") return addDays(issuedOn, days ?? 0);
  if (terms === "cod") return expectedOn && expectedOn > issuedOn ? expectedOn : issuedOn;
  return issuedOn;
}

/** How an invoice stands today, in a few words, and the colour it is shown in. A cash-on-delivery
 *  invoice is never late before the goods have arrived. */
export function invoiceState(
  invoice: {
    status: "open" | "paid" | "cancelled";
    terms: PaymentTerms;
    dueOn: string;
    paid: number;
    total: number;
    delivered: boolean;
  },
  today: string,
): InvoiceState {
  if (invoice.status === "cancelled") return { word: "Cancelled", tone: "plain", overdueDays: 0 };
  if (invoice.status === "paid") return { word: "Paid", tone: "good", overdueDays: 0 };
  const partly = invoice.paid > 0 ? "Partly paid · " : "";
  if (invoice.terms === "cod" && !invoice.delivered)
    return { word: `${partly}Collect on delivery`, tone: "info", overdueDays: 0 };
  const late = daysBetween(invoice.dueOn, today);
  if (late > 0)
    return {
      word: `${partly}Overdue by ${late} ${late === 1 ? "day" : "days"}`,
      tone: "bad",
      overdueDays: late,
    };
  if (late === 0) return { word: `${partly}Due today`, tone: "warn", overdueDays: 0 };
  return {
    word: `${partly}Due in ${-late} ${late === -1 ? "day" : "days"}`,
    tone: "plain",
    overdueDays: 0,
  };
}

/** The age brackets of what customers owe, by days past the due date. */
export const AGE_BUCKETS = [
  { key: "current", label: "Not due yet" },
  { key: "d30", label: "1–30 days" },
  { key: "d60", label: "31–60 days" },
  { key: "d90", label: "61–90 days" },
  { key: "older", label: "Over 90 days" },
] as const;
