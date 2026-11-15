// Inventory's fixed lists and small rules, with no database in them.

import type { Role } from "../people/roles";
import type { BuyerType, InventoryCan, Me, StockStatus } from "../types";

export const BUYER_TYPES: { key: BuyerType; label: string }[] = [
  { key: "patient", label: "Patient" },
  { key: "hospital", label: "Hospital" },
  { key: "doctor", label: "Doctor" },
  { key: "distributor", label: "Distributor" },
  { key: "drugstore", label: "Drugstore" },
  { key: "bidding", label: "Bidding" },
];

export const buyerLabel = (key: string) =>
  BUYER_TYPES.find((type) => type.key === key)?.label ?? key;

/** Who receives, moves and counts stock, and posts stock news. */
export const STOCK_ROLES: readonly Role[] = ["inventory", "dispatch", "admin"];
/** Who adds a medicine or changes its details. */
export const CATALOGUE_ROLES: readonly Role[] = ["inventory", "admin"];
/** Who buys: suppliers and purchases. */
export const PURCHASE_ROLES: readonly Role[] = ["inventory", "admin"];
/** Who sees what a medicine cost to land, and so the margin. Sellers never do. */
export const COST_ROLES: readonly Role[] = ["inventory", "management", "finance", "ceo", "admin"];
/** Who changes prices and promos. */
export const PRICE_ROLES: readonly Role[] = ["management", "ceo", "admin"];

export function inventoryCan(me: Me): InventoryCan {
  return {
    stock: STOCK_ROLES.includes(me.role),
    catalogue: CATALOGUE_ROLES.includes(me.role),
    price: PRICE_ROLES.includes(me.role),
    purchase: PURCHASE_ROLES.includes(me.role),
    cost: COST_ROLES.includes(me.role),
  };
}

/** Days before expiry at which a batch is flagged. */
export const EXPIRING_DAYS = 90;

/** Today in Manila, "YYYY-MM-DD": the business's day, whatever the server's clock says. */
export function todayManila(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(now);
}

export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Out at zero sellable pieces; low at or under the reorder level (when one is set). */
export function stockStatus(sellable: number, reorderLevel: number): StockStatus {
  if (sellable <= 0) return "out";
  if (reorderLevel > 0 && sellable <= reorderLevel) return "low";
  return "ok";
}

export function batchState(expiresOn: string, today: string): "ok" | "soon" | "expired" {
  if (expiresOn < today) return "expired";
  return expiresOn <= addDays(today, EXPIRING_DAYS) ? "soon" : "ok";
}
