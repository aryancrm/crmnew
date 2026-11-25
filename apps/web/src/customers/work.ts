// What a seller does with a customer, on the customer's own page (medrep branch, 25 Nov: "in
// their customers should be the data they need and what they can do, guided, without pressing
// another tab"). Pure rules, tested in work.test.ts; customer-work.tsx draws them.
// - sellerKind: the person's way of working (in the field, a doctor's calls, PAP, by phone…).
// - actionsFor: the buttons on top, the seller's most used first.
// - nextSteps: what waits with this customer now, each with what to press.

import type { ClientPage } from "@2mg/api/mr";
import type { CustomerPage, Me, OrderStatus } from "@2mg/api/types";

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

/** The buttons on top of a customer (26 Nov, the six UX laws): one primary, New order, then at
 *  most two of the seller's own (Hick: few choices); Directions sits by the address it acts on
 *  (proximity), the rest under More. Only those they may use. */
export function actionsFor(
  seller: SellerKind,
  can: { order: boolean; visit: boolean; call: boolean; directions: boolean },
): ActionKey[] {
  const own: ActionKey[] = seller === "field" || seller === "rx" || seller === "pap" || seller === "lead" ? ["visit", "call"] : ["call"];
  return (["order", ...own] as ActionKey[]).filter((key) => can[key]).slice(0, 3);
}

export type NextStep = {
  key: string;
  text: string;
  /** A line under it (the best time to go, what the order is). */
  sub?: string;
  tone: "bad" | "warn" | "info";
  /** What to press: an action of the bar, a page, or the papers below. */
  go?: { label: string; action: ActionKey } | { label: string; to: string } | { label: string; papers: true };
};

/** Orders the seller has to do something about, and those on their way. */
const STUCK: OrderStatus[] = ["on_hold", "exception", "draft"];
const MOVING: OrderStatus[] = ["pending_approval", "finance_check", "ready_for_invoice", "ready_for_dispatch", "packing", "shipped"];

const pesoWords = (centavos: number) => `₱${Math.round(centavos / 100).toLocaleString("en-PH")}`;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const DAY = new Intl.DateTimeFormat("en-PH", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const dayWords = (day: string) => DAY.format(new Date(`${day}T00:00:00Z`));

/** What waits with this customer now, the most urgent first. */
export function nextSteps(
  page: Pick<CustomerPage, "customer" | "totals" | "orders" | "refill">,
  field: ClientPage | null | undefined,
  can: { order: boolean; visit: boolean; call: boolean },
  today: string,
): NextStep[] {
  const steps: NextStep[] = [];
  const { customer, totals } = page;
  for (const order of page.orders.filter((one) => STUCK.includes(one.status)).slice(0, 3))
    steps.push({
      key: `order-${order.id}`,
      text: order.status === "draft" ? `Order ${order.code} is waiting for you to send it` : `Order ${order.code} is ${order.statusLabel.toLowerCase()}`,
      sub: order.medicines ?? undefined,
      tone: "warn",
      go: { label: "Open", to: `/orders/${order.id}` },
    });
  if (totals.overdue > 0)
    steps.push({
      key: "overdue",
      text: `Overdue ${pesoWords(totals.overdue)}`,
      sub: `${pesoWords(totals.owed)} owed in all`,
      tone: "bad",
      // The same words as the button on top (one name for one thing).
      go: can.call ? { label: ACTION_WORDS.call, action: "call" } : { label: "Statement", to: `/customers/${customer.id}/statement` },
    });
  const reorder = page.refill.nextOn;
  if (reorder && daysBetween(today, reorder) <= 7)
    steps.push({
      key: "reorder",
      text: reorder < today ? `Reorder was due ${dayWords(reorder)}` : `Reorder due ${dayWords(reorder)}`,
      sub: page.refill.lastOn ? `Last order ${dayWords(page.refill.lastOn.slice(0, 10))}` : undefined,
      tone: reorder < today ? "warn" : "info",
      go: can.order ? { label: ACTION_WORDS.order, action: "order" } : undefined,
    });
  if (customer.licenceState === "expired" || customer.licenceState === "soon")
    steps.push({
      key: "licence",
      text: customer.licenceState === "expired" ? "Their licence has expired: ask for the new one" : "Their licence expires soon: ask for the new one",
      tone: customer.licenceState === "expired" ? "bad" : "warn",
      go: { label: "Papers", papers: true },
    });
  if (field) {
    const best = [field.client.prefDays.join(", "), field.client.prefTime].filter(Boolean).join(" · ");
    const last = field.history.find((visit) => visit.status === "done");
    if (field.client.nextVisit)
      steps.push({
        key: "visit",
        text: `Next visit ${dayWords(field.client.nextVisit.day)}`,
        sub: best ? `Best ${best}` : undefined,
        tone: "info",
        go: { label: "Open visit", to: `/visits/${field.client.nextVisit.id}` },
      });
    else if (can.visit)
      steps.push({
        key: "visit",
        text: last ? `No visit planned · last one ${daysBetween(last.day, today)} days ago` : "No visit planned · never visited",
        sub: best ? `Best ${best}` : undefined,
        tone: last && daysBetween(last.day, today) <= 30 ? "info" : "warn",
        go: { label: ACTION_WORDS.visit, action: "visit" },
      });
  }
  const moving = page.orders.filter((one) => MOVING.includes(one.status));
  if (moving.length)
    steps.push({
      key: "moving",
      text: `${moving.length} order${moving.length === 1 ? "" : "s"} on the way`,
      sub: moving
        .slice(0, 2)
        .map((one) => `${one.code}: ${one.statusLabel}`)
        .join(" · "),
      tone: "info",
    });
  if (customer.review === "to_review")
    steps.push({ key: "review", text: "New customer: Management checks their papers once", tone: "info" });
  const rank = { bad: 0, warn: 1, info: 2 } as const;
  return steps.sort((a, b) => rank[a.tone] - rank[b.tone]);
}
