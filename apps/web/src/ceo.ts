// The CEO Home's pure helpers: short pesos, the month picker's months, and the
// change in what was collected, in words. Import-free, tested with node --test.

/** Up to one decimal, without a trailing ".0": 57.6, 120, 9.7. */
const oneDecimal = (n: number) => {
  const r = Math.round(n * 10) / 10;
  return r >= 100 ? String(Math.round(r)) : String(r);
};

/**
 * Pesos short enough for a tile: "₱57.6M", "₱734K", "₱12.5K", "₱9,800"
 * (centavos in; the exact figure goes in the tile's title).
 */
export function shortPeso(centavos: number): string {
  const pesos = centavos / 100;
  const a = Math.abs(pesos);
  const sign = pesos < 0 ? "−" : "";
  if (a >= 999_500_000) return `${sign}₱${oneDecimal(a / 1_000_000_000)}B`;
  if (a >= 999_500) return `${sign}₱${oneDecimal(a / 1_000_000)}M`;
  if (a >= 99_950) return `${sign}₱${Math.round(a / 1_000)}K`;
  if (a >= 10_000) return `${sign}₱${oneDecimal(a / 1_000)}K`;
  return `${sign}₱${Math.round(a).toLocaleString("en-PH")}`;
}

/** The exact pesos, for a tile's title: "₱57,600,000". */
export function exactPeso(centavos: number): string {
  return `₱${Math.round(centavos / 100).toLocaleString("en-PH")}`;
}

/** "2026-11" → "November 2026". */
export function monthName(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y ?? 2000, (m ?? 1) - 1, 1)).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "2026-11" → "Nov". */
export function monthShort(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y ?? 2000, (m ?? 1) - 1, 1)).toLocaleString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
}

/** The month `by` months away, as YYYY-MM. */
export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y ?? 2000, (m ?? 1) - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The Home's address for a month: this month is plain "/". */
export function monthHref(month: string, current: string): string {
  return month >= current ? "/" : `/?month=${month}`;
}

/** The month from the address, when it is a real one and not after this month; else this month. */
export function pickedMonth(value: unknown, current: string): string {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && value <= current
    ? value
    : current;
}

/** "Oct 1–12" for some days of a month, "October" for all of it. */
export function daysLabel(from: string, to: string): string {
  const month = from.slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y ?? 2000, m ?? 1, 0)).getUTCDate();
  const first = Number(from.slice(8, 10));
  const end = Number(to.slice(8, 10));
  if (first === 1 && end === last) return monthName(month).split(" ")[0] ?? month;
  return first === end ? `${monthShort(month)} ${first}` : `${monthShort(month)} ${first}–${end}`;
}

/**
 * What was collected against the same days before, in words and a tone:
 * "+12% vs Oct 1–12" (up), "−8% vs October" (down), "vs ₱0 in Oct 1–12"
 * when nothing came in then; null when there is nothing to compare with.
 */
export function collectedChange(
  now: number,
  before: { amount: number; from: string; to: string } | null,
): { text: string; tone: "up" | "down" | "flat" } | null {
  if (!before) return null;
  const days = daysLabel(before.from, before.to);
  if (before.amount <= 0)
    return { text: now > 0 ? `vs ₱0 in ${days}` : `Nothing in ${days} either`, tone: "flat" };
  const pct = Math.round(((now - before.amount) / before.amount) * 100);
  if (pct === 0) return { text: `Same as ${days}`, tone: "flat" };
  return pct > 0
    ? { text: `+${pct}% vs ${days}`, tone: "up" }
    : { text: `−${Math.abs(pct)}% vs ${days}`, tone: "down" };
}

/** "3 orders", "1 order". */
export function counted(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-PH")} ${n === 1 ? one : many}`;
}
