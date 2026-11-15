// Dispatch's words and rules, with no database: who packs and ships, the couriers offered, and
// the first-expiry-first pick.

import type { Role } from "../people/roles";

/** Who packs, ships and marks delivered. */
export const DISPATCH_ROLES: readonly Role[] = ["dispatch", "admin"];
/** Who reads Dispatch's lists (shipments). */
export const DISPATCH_READ_ROLES: readonly Role[] = [
  "dispatch",
  "admin",
  "ceo",
  "management",
  "finance",
  "inventory",
];

/** The couriers offered first; any other can be typed. */
export const COURIERS = [
  "LBC",
  "J&T Express",
  "Lalamove",
  "Grab Express",
  "2GO",
  "AP Cargo",
  "Ninja Van",
  "Flash Express",
];

/**
 * Picks the pieces for a line from its batches, nearest expiry first, never an expired one.
 * Answers the picks and what the shelf can't give.
 */
export function firstExpiryFirst(
  qty: number,
  batches: { batchId: number; expiresOn: string; onShelf: number }[],
  today: string,
): { picks: { batchId: number; qty: number }[]; short: number } {
  const picks: { batchId: number; qty: number }[] = [];
  let left = qty;
  for (const batch of [...batches]
    .filter((row) => row.expiresOn >= today && row.onShelf > 0)
    .sort((a, b) => a.expiresOn.localeCompare(b.expiresOn))) {
    if (left === 0) break;
    const take = Math.min(left, batch.onShelf);
    picks.push({ batchId: batch.batchId, qty: take });
    left -= take;
  }
  return { picks, short: left };
}
