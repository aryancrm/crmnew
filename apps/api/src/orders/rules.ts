// The order line's words and rules, with no database: the statuses, what each is called,
// which the dashboard's tiles count, and who may do what. After the hub's own state machine.

import { DISPATCH_ROLES } from "../dispatch/rules";
import { FINANCE_ROLES } from "../finance/rules";
import type { Role } from "../people/roles";
import type {
  BoardTab,
  Desk,
  HoldRole,
  InvoiceFrom,
  Me,
  OrderAction,
  OrderFinding,
  OrderStage,
  OrderStatus,
  PaperKind,
  PaymentTerms,
} from "../types";

export const STATUS_LABEL: Record<OrderStatus, string> = {
  draft: "Draft",
  pending_approval: "Pending Management Approval",
  finance_check: "With Finance",
  ready_for_invoice: "Ready For Invoice",
  ready_for_dispatch: "Ready For Dispatch",
  packing: "Packed",
  shipped: "In Transit",
  completed: "Completed",
  on_hold: "On Hold",
  exception: "Exception",
  cancelled: "Cancelled",
};

export const STATUSES = Object.keys(STATUS_LABEL) as OrderStatus[];

/** The statuses behind each dashboard tile. A status is in one tile only, so tiles add up. */
export const STATUS_GROUPS = {
  pendingPayment: ["finance_check", "ready_for_invoice"],
  readyForDispatch: ["ready_for_dispatch", "packing"],
  inTransit: ["shipped"],
  exceptions: ["on_hold", "exception", "cancelled"],
} satisfies Record<string, OrderStatus[]>;

/** Statuses that can't be stuck: not placed yet, or finished. */
export const NEVER_STUCK: OrderStatus[] = ["draft", "completed", "cancelled"];

export const STAGES: { key: OrderStage; label: string }[] = [
  { key: "created", label: "Created" },
  { key: "approved", label: "Management Approved" },
  { key: "finance_verified", label: "Finance Verified" },
  { key: "invoiced", label: "Invoiced" },
  { key: "paid", label: "Paid" },
  { key: "packed", label: "Packed" },
  { key: "shipped", label: "Shipped" },
  { key: "delivered", label: "Delivered" },
  { key: "completed", label: "Completed" },
];

export const ORDER_PLACE_ROLES: readonly Role[] = [
  "medrep",
  "team_lead",
  "manager",
  "management",
  "online",
  "admin",
];
/** Who takes an Online case's order to Paid: marks it delivered and records the money received. */
export const CASE_AGENT_ROLES: readonly Role[] = ["online", "admin"];
export const ORDER_MANAGE_ROLES: readonly Role[] = ["management", "admin"];
/** Who sees every order. Others see their own, or their team's. */
export const ORDER_ALL_ROLES: readonly Role[] = [
  "management",
  "finance",
  "dispatch",
  "inventory",
  "ceo",
  "admin",
];

export const orderCan = (me: Me) => ({
  place: ORDER_PLACE_ROLES.includes(me.role),
  manage: ORDER_MANAGE_ROLES.includes(me.role),
  finance: FINANCE_ROLES.includes(me.role),
  dispatch: DISPATCH_ROLES.includes(me.role),
});

/** The statuses at which an order waits for Finance. */
export const FINANCE_STATUSES: OrderStatus[] = ["finance_check", "ready_for_invoice"];
/** The statuses at which an order waits for Dispatch (on the way included). */
export const DISPATCH_STATUSES: OrderStatus[] = ["ready_for_dispatch", "packing", "shipped"];

/** Statuses an order can be put on hold from: placed and not yet on its way. */
const OPEN: OrderStatus[] = [
  "pending_approval",
  "finance_check",
  "ready_for_invoice",
  "ready_for_dispatch",
  "packing",
];

/**
 * Of what the system found on an Online case's order, what holds it for Management: a price below
 * its list (the agent's discount), and for a business buyer (never a patient) an unchecked
 * account, an expired licence, money owed or a sale on credit. Short stock is Dispatch's to sort
 * and the payment is the agent's, so neither stops it. A guarantee letter's bill to the agency
 * isn't credit.
 */
export function caseChecksOf(
  found: OrderFinding[],
  customer: { kind: string; terms: string; gl: boolean },
): OrderFinding[] {
  const business = customer.kind !== "patient";
  const kept = found.filter(
    (finding) =>
      finding.kind === "price" ||
      (business && ["customer", "licence", "owes", "credit"].includes(finding.kind)),
  );
  if (
    business &&
    customer.terms === "days" &&
    !customer.gl &&
    !kept.some((finding) => finding.kind === "credit")
  )
    kept.push({
      kind: "credit",
      short: "On credit",
      decide: "sold on credit",
      text: "Sold on credit: the buyer pays after delivery",
    });
  return kept;
}

/** Which desk holds a held order: its own record, else (older rows) where it stood. */
export const holder = (order: {
  heldRole?: HoldRole | null;
  heldFrom?: OrderStatus | null;
}): HoldRole =>
  order.heldRole ??
  (FINANCE_STATUSES.includes(order.heldFrom as OrderStatus) ? "finance" : "management");

/** Which buttons an order shows this person. The service checks the same again. Management
 *  holds an order anywhere before it leaves; Finance and Dispatch only at their own step, and
 *  each takes off only its own holds. A parcel on the road can't be cancelled: it must come
 *  back first. */
export function orderActions(
  me: Me,
  order: {
    status: OrderStatus;
    raisedBy: number;
    medrepId: number;
    heldFrom?: OrderStatus | null;
    heldRole?: HoldRole | null;
    leadId?: number | null;
    /** Management's approval can still be taken back (the server says, from its timeline). */
    takeBack?: boolean;
  },
): Record<OrderAction, boolean> {
  const manage = ORDER_MANAGE_ROLES.includes(me.role);
  const finance = FINANCE_ROLES.includes(me.role);
  const dispatch = DISPATCH_ROLES.includes(me.role);
  // An Online case's order: its agent hands it over (Dispatch still packs and ships it).
  const agent = Boolean(order.leadId) && CASE_AGENT_ROLES.includes(me.role);
  const mine = order.raisedBy === me.id || order.medrepId === me.id;
  const pending = order.status === "pending_approval";
  const flagged = order.status === "on_hold" || order.status === "exception";
  const held = flagged ? holder(order) : null;
  return {
    approve: manage && pending,
    send_back: manage && pending,
    reject: manage && pending,
    hold:
      (manage && OPEN.includes(order.status)) ||
      (finance && FINANCE_STATUSES.includes(order.status)) ||
      (dispatch && (order.status === "ready_for_dispatch" || order.status === "packing")),
    exception: manage && (OPEN.includes(order.status) || order.status === "shipped"),
    resume:
      (manage && flagged) || (finance && held === "finance") || (dispatch && held === "dispatch"),
    // The MedRep may cancel their own order while it is a draft, or held before Finance acted.
    cancel:
      (manage && !["shipped", "completed", "cancelled"].includes(order.status)) ||
      (mine && order.status === "draft") ||
      (mine && flagged && (!order.heldFrom || order.heldFrom === "pending_approval")),
    answer: mine && flagged,
    resubmit: mine && order.status === "draft",
    take_back: manage && Boolean(order.takeBack),
    confirm_payment: finance && order.status === "finance_check",
    make_invoice: finance && order.status === "ready_for_invoice",
    pack: dispatch && order.status === "ready_for_dispatch",
    unpack: dispatch && order.status === "packing",
    ship: dispatch && order.status === "packing",
    deliver: (dispatch || agent) && (order.status === "shipped" || order.status === "packing"),
    failed: dispatch && order.status === "shipped",
  };
}

/** Which statuses each tab of a desk's board holds. "done" is completed today. */
export const DESK_TABS: Record<Desk, Partial<Record<BoardTab, OrderStatus[]>>> = {
  management: {
    needs: ["pending_approval"],
    // Every order once placed: the All orders page's first tab.
    all: [
      "pending_approval",
      "finance_check",
      "ready_for_invoice",
      "ready_for_dispatch",
      "packing",
      "shipped",
      "completed",
      "on_hold",
      "exception",
      "cancelled",
    ],
    finance: ["finance_check", "ready_for_invoice"],
    dispatch: ["ready_for_dispatch", "packing", "shipped"],
    hold: ["on_hold", "exception"],
    done: ["completed"],
    // Sent back to the MedRep (a draft once sent back): waiting for their fix and answer.
    sent: ["draft"],
  },
  finance: {
    needs: ["finance_check", "ready_for_invoice"],
    upstream: ["pending_approval"],
    dispatch: ["ready_for_dispatch", "packing", "shipped"],
    hold: ["on_hold", "exception"],
    done: ["completed"],
  },
  dispatch: {
    needs: ["ready_for_dispatch", "packing", "shipped"],
    // The warehouse's own piles (the board narrows packed ones to came back / to ship).
    to_pack: ["ready_for_dispatch"],
    to_ship: ["packing"],
    road: ["shipped"],
    came_back: ["packing"],
    upstream: ["pending_approval", "finance_check", "ready_for_invoice"],
    hold: ["on_hold", "exception"],
    done: ["completed"],
  },
};

/** Each desk's first tab: its own work. */
export const DESK_HOME: Record<Desk, BoardTab> = {
  management: "needs",
  finance: "needs",
  dispatch: "needs",
};

/** How far along the line a status is: 0 placed, 1 Management, 2 Finance, 3 packing, 4 shipped, 5 delivered. */
export const STEP_OF: Record<OrderStatus, number> = {
  draft: 0,
  pending_approval: 1,
  finance_check: 2,
  ready_for_invoice: 2,
  ready_for_dispatch: 3,
  packing: 4,
  shipped: 5,
  completed: 6,
  on_hold: 1,
  exception: 1,
  cancelled: 0,
};

/** Whose move it is, in one line. */
export const NEXT_OF: Record<OrderStatus, string> = {
  draft: "With the MedRep: fix and place again",
  pending_approval: "Nothing found: approve",
  finance_check: "Finance checks the payment",
  ready_for_invoice: "Finance makes the invoice",
  ready_for_dispatch: "Dispatch packs it",
  packing: "Packed: Dispatch ships it",
  shipped: "On its way to the customer",
  completed: "Delivered",
  on_hold: "On hold",
  exception: "Exception",
  cancelled: "Cancelled",
};

export const PAPER_LABEL: Record<PaperKind, string> = {
  po: "Customer's PO",
  payment_proof: "Proof of payment",
  prescription: "Prescription",
  gl: "Guarantee letter",
  dr: "Signed delivery receipt",
  other: "Other paper",
};
export const PAPER_KINDS = Object.keys(PAPER_LABEL) as PaperKind[];

export const INVOICE_FROM_LABEL: Record<InvoiceFrom, string> = {
  "2mg": "2MG Inc.",
  getmeds: "GetMeds Philippines Inc.",
};

/** The papers an order is expected to carry. Only a proof of payment is needed before it can
 *  go on (for a customer who pays in advance); the rest are kept when there are any. */
export function paperList(
  customer: { kind: string; terms: PaymentTerms; days: number | null },
  onFile: PaperKind[],
): { kind: PaperKind; label: string; needed: boolean; why: string | null; onFile: boolean }[] {
  const row = (kind: PaperKind, needed: boolean, why: string | null) => ({
    kind,
    label: PAPER_LABEL[kind],
    needed,
    why,
    onFile: onFile.includes(kind),
  });
  return [
    row(
      "po",
      false,
      customer.kind === "hospital" ? "The hospital's purchase order, when it gave one" : null,
    ),
    row(
      "payment_proof",
      customer.terms === "advance",
      customer.terms === "advance"
        ? "Pays in advance: Finance checks this"
        : customer.terms === "cod"
          ? "Not needed · pays on delivery"
          : `Not needed · pays in ${customer.days} days`,
    ),
    row("prescription", false, "For a prescription medicine, when there is one"),
    row("gl", false, "When a patient's government guarantee letter pays"),
    row(
      "dr",
      false,
      "The delivery receipt the customer signed: Dispatch adds it when it is delivered",
    ),
  ];
}

/** Papers can be added to an order until it is done, by whoever placed it and by Management.
 *  Finance may add a proof of payment at any time (money for a credit order comes after
 *  delivery), except to a cancelled order. */
export function mayAddPaper(
  me: Me,
  order: { status: OrderStatus; raisedBy: number; medrepId: number; leadId?: number | null },
  kind?: PaperKind,
): boolean {
  if (order.status === "cancelled") return false;
  if (FINANCE_ROLES.includes(me.role) && (kind === undefined || kind === "payment_proof"))
    return true;
  if (DISPATCH_ROLES.includes(me.role) && (kind === undefined || kind === "dr")) return true;
  // The case's agent keeps the money's proof and the signed receipt on it, delivered or not.
  if (
    order.leadId &&
    CASE_AGENT_ROLES.includes(me.role) &&
    (kind === undefined || kind === "payment_proof" || kind === "dr")
  )
    return true;
  if (order.status === "completed") return false;
  return (
    ORDER_MANAGE_ROLES.includes(me.role) || order.raisedBy === me.id || order.medrepId === me.id
  );
}
