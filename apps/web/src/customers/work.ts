// What a seller does with a customer, on the customer's own page (medrep branch, 25 Nov: "in
// their customers should be the data they need and what they can do, guided, without pressing
// another tab"). Pure rules, tested in work.test.ts; customer-work.tsx draws them.
// - sellerKind: the person's way of working (in the field, a doctor's calls, PAP, by phone…).
// - actionsFor: the buttons on top, the seller's most used first.

import type { Me } from "@2mg/api/types";

export type SellerKind = "field" | "rx" | "pap" | "phone" | "lead" | "desk";

/** How the person works their customers: by their seat's channel (menus.ts gives the same seats
 *  their Visits or Calls folder). */
export function sellerKind(me: Pick<Me, "role" | "channel">): SellerKind {
  if (me.role === "team_lead" || me.role === "manager") return "lead";
  if (me.role === "online") return "phone";
  if (me.role !== "medrep") return "desk";
  const code = me.channel?.code;
  if (code === "RX") return "rx";
  if (code === "PAP") return "pap";
  // Telesales, B2B (NBD, CRR, CLIDP), Government Bidding and the Online office work by phone.
  if (code === "TS" || code === "B2B" || code === "BID" || code === "ONLINE") return "phone";
  return "field";
}

export type ActionKey = "order" | "visit" | "call" | "directions";
export const ACTION_WORDS: Record<ActionKey, string> = {
  order: "New order",
  visit: "Add visit",
  call: "Log a call",
  directions: "Directions",
};

/** The buttons on a customer for this seller, the most used first; only those they may use. */
export function actionsFor(
  seller: SellerKind,
  can: { order: boolean; visit: boolean; call: boolean; directions: boolean },
): ActionKey[] {
  const order: ActionKey[] =
    seller === "phone"
      ? ["call", "order", "directions"]
      : seller === "field" || seller === "rx" || seller === "pap" || seller === "lead"
        ? ["order", "visit", "call", "directions"]
        : ["order", "call", "directions"];
  return order.filter((key) => can[key]);
}
