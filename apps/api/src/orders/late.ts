// How long each desk may keep an order before it counts as late: one table for Speed, the cards'
// "Late" and the team pages, so a Finance order isn't late at four hours on one screen and at a day
// on another. Minutes.

export const LATE_AFTER = {
  management: 4 * 60,
  finance: 24 * 60,
  dispatch: 24 * 60,
  road: 72 * 60,
  fix: 24 * 60,
} as const;

/** The limit for an order waiting at a status (none for the statuses no desk is timed on). */
export function lateAfterFor(status: string): number | null {
  if (status === "pending_approval") return LATE_AFTER.management;
  if (status === "finance_check" || status === "ready_for_invoice") return LATE_AFTER.finance;
  if (status === "ready_for_dispatch" || status === "packing") return LATE_AFTER.dispatch;
  if (status === "shipped") return LATE_AFTER.road;
  if (status === "draft") return LATE_AFTER.fix;
  return null;
}
