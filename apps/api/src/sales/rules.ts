// Sales against target, with no database: which month a page is about, how far through it we
// are, and where a figure stands against that pace. The CEO Home, the team pages, the channel
// report and the company tree all read these, so a bar means the same everywhere.

import type { MonthFacts, PaceTone } from "../types";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Today in Manila, as YYYY-MM-DD. */
export const manilaDay = (now = new Date()) =>
  now.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });

const daysIn = (month: string) => {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year ?? 2000, number ?? 1, 0)).getUTCDate();
};

/** The month asked for when it is a real one and not after this month; else this month. */
export function monthFacts(asked: string | undefined, now = new Date()): MonthFacts {
  const today = manilaDay(now);
  const current = today.slice(0, 7);
  const month = asked && MONTH.test(asked) && asked <= current ? asked : current;
  const running = month === current;
  const length = daysIn(month);
  const day = Number(today.slice(8, 10));
  const [year, number] = month.split("-").map(Number);
  return {
    month,
    monthLabel: new Date(Date.UTC(year ?? 2000, (number ?? 1) - 1, 1)).toLocaleString("en-US", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }),
    today,
    running,
    pace: running ? day / length : 1,
    daysLeft: running ? length - day : 0,
  };
}

/** The first day of a month, and of the one after. */
export const monthBounds = (month: string) => {
  const [year, number] = month.split("-").map(Number);
  const next = new Date(Date.UTC(year ?? 2000, number ?? 1, 1)).toISOString().slice(0, 10);
  return { first: `${month}-01`, next };
};

/** The same days of the month before: this month, its 1st to today's date (capped at that
 *  month's length); a month gone by, the whole month before. */
export function sameDaysBefore(facts: Pick<MonthFacts, "month" | "today" | "running">): {
  from: string;
  to: string;
} {
  const [year, number] = facts.month.split("-").map(Number);
  const before = new Date(Date.UTC(year ?? 2000, (number ?? 1) - 2, 1)).toISOString().slice(0, 7);
  const length = daysIn(before);
  const day = facts.running ? Math.min(Number(facts.today.slice(8, 10)), length) : length;
  return { from: `${before}-01`, to: `${before}-${String(day).padStart(2, "0")}` };
}

/** Sold ÷ target as a percentage, one decimal; null without a target. */
export const pctOf = (sold: number, target: number | null) =>
  target && target > 0 ? Math.round((sold / target) * 1000) / 10 : null;

/** Where a figure stands against the month's pace. Far behind only once a fifth of the month has
 *  gone, so the first days don't paint everything red. */
export function paceTone(sold: number, target: number | null, pace: number): PaceTone {
  if (!target || target <= 0) return "none";
  const share = sold / target;
  if (share >= pace) return "on";
  return pace >= 0.2 && share < pace / 2 ? "far" : "behind";
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const plusDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const shortDay = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

/** A month's facts, or the days picked (from–to, a year at most) in its place. */
export function periodFacts(
  asked: { month?: string; from?: string; to?: string },
  now = new Date(),
): MonthFacts {
  const today = manilaDay(now);
  if (!asked.from || !asked.to || !DAY.test(asked.from) || !DAY.test(asked.to))
    return monthFacts(asked.month, now);
  const from = asked.from;
  const to = asked.to > today ? today : asked.to;
  if (from > to) return monthFacts(asked.month, now);
  // A whole month, or this month so far, is that month's own view (full target, the month's pace),
  // so "This month" and "Last month" read the same as the month page.
  const month = from.slice(0, 7);
  if (
    from === `${month}-01` &&
    to.slice(0, 7) === month &&
    (to === `${month}-${String(daysIn(month)).padStart(2, "0")}` || to === today)
  )
    return monthFacts(month, now);
  const days =
    Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  if (days > 366) return monthFacts(asked.month, now);
  const base = monthFacts(to.slice(0, 7), now);
  // The pace of a range that reaches today: the share of its days gone; a range gone by is whole.
  const end = asked.to > to ? asked.to : to;
  const whole =
    Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  const running = end >= today;
  return {
    ...base,
    running,
    pace: running ? days / whole : 1,
    daysLeft: running ? whole - days : 0,
    range: {
      from,
      to,
      label: from === to ? shortDay(from) : `${shortDay(from)} – ${shortDay(to)}`,
    },
  };
}

/** The first day counted and the day after the last: the range's, else the month's. */
export const boundsOf = (facts: MonthFacts) =>
  facts.range
    ? { first: facts.range.from, next: plusDays(facts.range.to, 1) }
    : monthBounds(facts.month);

/** The same number of days just before (to compare with). */
export function periodBefore(facts: MonthFacts): { from: string; to: string } {
  if (!facts.range) return sameDaysBefore(facts);
  const days =
    Math.round(
      (Date.parse(`${facts.range.to}T00:00:00Z`) - Date.parse(`${facts.range.from}T00:00:00Z`)) /
        86_400_000,
    ) + 1;
  return { from: plusDays(facts.range.from, -days), to: plusDays(facts.range.from, -1) };
}
