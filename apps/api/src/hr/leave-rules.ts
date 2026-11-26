// The rules of leave and overtime as plain functions (no database), so they are tested on their
// own (docs/HR-PLAN.md, step 3). Taken from HR's portal (Automated-Excel: lib/leavePolicy.js,
// lib/overtimeRules.js) where PLAN.md says nothing; where PLAN.md says something, PLAN.md wins.

import { DAYS_PER_YEAR } from "./pay-rules";

// ------------------------------------------------------------------ leave

/** Vacation leave is asked for this many calendar days before it starts (Automated-Excel's
 *  VL_NOTICE_DAYS). HR recording leave for someone is not held to it. */
export const VL_NOTICE_DAYS = 7;
/** Sick leave may be asked for after the fact, this many days back. Automated-Excel allows 2;
 *  PLAN 12.13 (Aryan) allows every leave from a month back, and PLAN wins. */
export const SL_DAYS_BACK = 30;
/** Leave without pay and other leave: from a month back too (PLAN 12.13). */
export const OTHER_DAYS_BACK = 30;
/** Sick leave of this many working days or more needs a medical certificate (Automated-Excel). */
export const SL_PROOF_FROM_DAYS = 2;
/** Proof files a leave may carry, and how big each may be (Automated-Excel's leaveProofStore). */
export const LEAVE_FILES_MAX = 5;
/** The share of unused vacation leave turned into pay at year-end (Automated-Excel's
 *  VL_CONVERTIBLE_SHARE). Only reported for HR: PLAN 12.16 parks payroll extras. */
export const VL_CONVERTIBLE_SHARE = 0.5;

const addDays = (day: string, by: number) => {
  const at = new Date(`${day}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + by);
  return at.toISOString().slice(0, 10);
};

/** The first day a person may ask for vacation leave from, asking today. */
export const earliestVl = (today: string) => addDays(today, VL_NOTICE_DAYS);

/** Whether a person may ask for leave of this kind starting on `from`, asking today: null when
 *  yes, else why not. */
export function leaveStartRefusal(kind: string, from: string, today: string): string | null {
  if (kind === "vl") {
    const earliest = earliestVl(today);
    return from < earliest
      ? `Vacation leave needs ${VL_NOTICE_DAYS} days' notice: the earliest first day is ${earliest}. Ask HR if it can't wait.`
      : null;
  }
  const back = kind === "sl" ? SL_DAYS_BACK : OTHER_DAYS_BACK;
  return from < addDays(today, -back)
    ? `${kind === "sl" ? "Sick leave" : "Leave"} is asked for at most ${back} days after the fact.`
    : null;
}

/** A year's credits for one kind, as a ledger: the opening days (the rule), HR's adjustments, the
 *  days used (approved) and asked (waiting); what is left never goes below nothing. Days in halves. */
export function ledger(input: { opening: number; adjustments: number[]; used: number; asked: number }) {
  const adjusted = input.adjustments.reduce((sum, one) => sum + one, 0);
  const total = Math.max(0, input.opening + adjusted);
  return {
    opening: input.opening,
    adjusted,
    total,
    used: input.used,
    asked: input.asked,
    left: Math.max(0, total - input.used - input.asked),
  };
}

/** Days as half-day steps: 1.5 is 3 halves; anything not a half step is refused (null). */
export function halfDaysOf(days: number): number | null {
  const halves = days * 2;
  return Number.isFinite(halves) && Math.abs(halves - Math.round(halves)) < 1e-9 && halves !== 0
    ? Math.round(halves)
    : null;
}

/** A day's pay from the monthly salary (centavos), as payroll counts it: monthly × 12 ÷ 313. */
export const dailyRate = (monthly: number) => Math.round((monthly * 12) / DAYS_PER_YEAR);

/** Year-end: half of the unused vacation leave, and what it comes to at the person's day rate
 *  (centavos). Reported for HR only, never paid by the CRM. */
export function vlConversion(unusedDays: number, monthlySalary: number | null) {
  const days = Math.floor(Math.max(0, unusedDays) * VL_CONVERTIBLE_SHARE * 2) / 2;
  const perDay = monthlySalary === null ? null : dailyRate(monthlySalary);
  return { days, perDay, amount: perDay === null ? null : Math.round(days * perDay) };
}

// ------------------------------------------------------------------ overtime

/** The kinds of day overtime is filed on (Automated-Excel's OT_TYPES); "broken" is broken time. */
export const OT_TYPES = {
  regular: "Regular day",
  rest: "Rest day",
  legal: "Regular holiday",
  special: "Special non-working day",
  rest_legal: "Rest day on a regular holiday",
  rest_special: "Rest day on a special day",
  broken: "Broken time",
} as const;
export type OtType = keyof typeof OT_TYPES;
export type DayKind = Exclude<OtType, "broken">;

const NIGHT_FROM = 22 * 60;
const NIGHT_TO = 6 * 60;
const FIRST_HOUR = 60;
const STEP = 30;
const LUNCH_FROM = 9 * 60;
const LUNCH = 60;

const minutesOf = (clock: string) => {
  const [h, m] = clock.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** What kind of day it is for this person: a rest day on their schedule, a holiday, or both. */
export function dayKindOf(
  day: string,
  workDays: readonly number[],
  holiday: "regular" | "special" | null,
): DayKind {
  const rest = !workDays.includes(new Date(`${day}T00:00:00Z`).getUTCDay());
  if (holiday === "regular") return rest ? "rest_legal" : "legal";
  if (holiday === "special") return rest ? "rest_special" : "special";
  return rest ? "rest" : "regular";
}

/** The types a person may pick for overtime on a day: the day's own kind, or broken time. */
export const otTypesFor = (kind: DayKind): OtType[] => [kind, "broken"];

/** Times on the hour or the half hour only (Automated-Excel). */
export const onHalfHour = (clock: string) => /^\d{2}:(00|30)$/.test(clock);

/**
 * The overtime hours that count, from a time in to a time out (past midnight when out is before
 * in), as Automated-Excel's computeOvertime counts them: on a regular day the person's working
 * hours never count, on any other day every hour does; 10 PM to 6 AM is night differential; the
 * first hour must be whole, after it hours count in 30-minute steps; 9 hours or more loses an
 * hour for lunch, taken from the daytime hours first.
 */
export function overtimeOf(input: {
  from: string;
  to: string;
  dayKind: DayKind;
  workStart: string;
  workEnd: string;
}): { minutes: number; nightMinutes: number; lunchMinutes: number } | { error: string } {
  const start = minutesOf(input.workStart);
  const end = minutesOf(input.workEnd);
  const atWork = (m: number) => {
    const c = m % 1440;
    return end > start ? c >= start && c < end : c >= start || c < end;
  };
  const night = (m: number) => {
    const c = m % 1440;
    return c >= NIGHT_FROM || c < NIGHT_TO;
  };
  const from = minutesOf(input.from);
  let to = minutesOf(input.to);
  if (to <= from) to += 1440;
  const counted: boolean[] = [];
  for (let m = from; m < to; m += 1)
    if (input.dayKind !== "regular" || !atWork(m)) counted.push(night(m));
  let total = counted.length;
  const lunch = total >= LUNCH_FROM ? LUNCH : 0;
  total -= lunch;
  if (total < FIRST_HOUR) return { error: "Overtime starts at one whole hour outside working hours." };
  total = FIRST_HOUR + Math.floor((total - FIRST_HOUR) / STEP) * STEP;
  let lunchLeft = lunch;
  const kept: boolean[] = [];
  for (const isNight of counted) {
    if (lunchLeft > 0 && !isNight) {
      lunchLeft -= 1;
      continue;
    }
    kept.push(isNight);
  }
  const used = kept.slice(lunchLeft, lunchLeft + total);
  return { minutes: total, nightMinutes: used.filter(Boolean).length, lunchMinutes: lunch };
}
