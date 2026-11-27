// Calendar and fiscal period helpers for BIR books, VAT, EWT, and Income Tax returns.
// Calendar-year withholding returns (0619-E, 1601-EQ, 1604-E, QAP, SAWT, 2307) always use
// fiscalMonthEnd = 12 regardless of a company's fiscal year override (NABHI_FINANCE 0.4.62).

import { Refusal } from "../http";

export type BirPeriod = {
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
  label: string;
};

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Last day of `month` (1..12) in `year`, returned as YYYY-MM-DD. */
export function monthEnd(year: number, month: number): string {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Refusal(400, "invalid", "Month must be 1 to 12.", "month");
  }
  const dt = new Date(Date.UTC(year, month, 0));
  return dt.toISOString().slice(0, 10);
}

/** First and last day of `month` (1..12) in `year`. */
export function monthPeriod(year: number, month: number): BirPeriod {
  const end = monthEnd(year, month);
  const start = `${year}-${pad2(month)}-01`;
  const label = new Date(`${start}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return { start, end, label };
}

/** Quarter `q` (1..4) of the year ending in `fiscalMonthEnd` (1..12). */
export function quarter(year: number, q: number, fiscalMonthEnd = 12): BirPeriod {
  if (!Number.isInteger(q) || q < 1 || q > 4) {
    throw new Refusal(400, "invalid", "Quarter must be 1, 2, 3, or 4.", "quarter");
  }
  if (!Number.isInteger(fiscalMonthEnd) || fiscalMonthEnd < 1 || fiscalMonthEnd > 12) {
    throw new Refusal(400, "invalid", "Fiscal month end must be 1 to 12.", "fiscalMonthEnd");
  }
  const endIndex = year * 12 + (fiscalMonthEnd - 1) - 3 * (4 - q);
  const endY = Math.floor(endIndex / 12);
  const endM0 = endIndex - endY * 12;
  const startIndex = endIndex - 2;
  const startY = Math.floor(startIndex / 12);
  const startM0 = startIndex - startY * 12;
  const ordinals = ["1st", "2nd", "3rd", "4th"] as const;
  const start = `${startY}-${pad2(startM0 + 1)}-01`;
  const end = monthEnd(endY, endM0 + 1);
  return {
    start,
    end,
    label: `${ordinals[q - 1]} quarter, ${fiscalMonthEnd === 12 ? "calendar" : "fiscal"} year ${year}`,
  };
}

/** BIR withholding returns (0619-E, 1601-EQ, 1604-E, QAP, SAWT, 2307) always follow the calendar year. */
export const calendarQuarter = (year: number, q: number): BirPeriod => quarter(year, q, 12);

/** Each month inside `period` in chronological order. */
export function monthsOf(period: BirPeriod): BirPeriod[] {
  const out: BirPeriod[] = [];
  let y = Number(period.start.slice(0, 4));
  let m = Number(period.start.slice(5, 7));
  while (`${y}-${pad2(m)}-01` <= period.end) {
    out.push(monthPeriod(y, m));
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** Zero-based month slot (0, 1, 2) of an ISO date within a 3-month quarter, or -1 if outside. */
export function monthSlotInQuarter(isoDate: string, months: BirPeriod[]): number {
  return months.findIndex((m) => m.start <= isoDate && isoDate <= m.end);
}
