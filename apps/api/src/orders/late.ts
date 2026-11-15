// How long each desk may keep an order before it counts as late: one table for Speed, the cards'
// "Late" and the team pages, so a Finance order isn't late at four hours on one screen and at a day
// on another. A desk's clock runs only in working hours (src/hr/work-time.ts): an order left at 6 pm
// isn't late by morning, and a working day is a day. The road (a courier) runs on the plain clock.
// Minutes. No imports: the web app reads this file.

/** A working day's minutes on the company's hours (7:00 to 16:00). */
const WORKING_DAY = 9 * 60;

export const LATE_AFTER = {
  management: 4 * 60,
  finance: WORKING_DAY,
  dispatch: WORKING_DAY,
  road: 72 * 60,
  fix: WORKING_DAY,
} as const;

/** The limits as people say them. */
export const LIMIT_WORDS: Record<keyof typeof LATE_AFTER, string> = {
  management: "4 working hours",
  finance: "1 working day",
  dispatch: "1 working day",
  road: "3 days",
  fix: "1 working day",
};

/** An order that hasn't moved from its step for two working days is stuck. */
export const STUCK_WORK_MINUTES = 2 * WORKING_DAY;

/** Whether a status's clock runs on working hours (every desk) or the plain clock (the road). */
export const onWorkClock = (status: string) => status !== "shipped";

/** The limit for an order waiting at a status (none for the statuses no desk is timed on). */
export function lateAfterFor(status: string): number | null {
  if (status === "pending_approval") return LATE_AFTER.management;
  if (status === "finance_check" || status === "ready_for_invoice") return LATE_AFTER.finance;
  if (status === "ready_for_dispatch" || status === "packing") return LATE_AFTER.dispatch;
  if (status === "shipped") return LATE_AFTER.road;
  if (status === "draft") return LATE_AFTER.fix;
  return null;
}
