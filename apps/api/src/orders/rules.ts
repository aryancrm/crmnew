// The order line's words and rules, with no database: the statuses, what each is called,
// which the dashboard's tiles count, and who may do what. After the hub's own state machine.

import { DISPATCH_ROLES } from "../dispatch/rules";
import { poExpected } from "./divisions";
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
  ready_for_invoice: "Finance Check",
  ready_for_dispatch: "Ready For Dispatch",
  packing: "Packed",
  shipped: "In Transit",
  // The hub calls a delivered order "completed"; it is only complete once its invoice is paid,
  // which the road shows apart (docs/PLAN.md 4.5), so the word here is what happened: delivered.
  completed: "Delivered",
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

/** Who places an order: the field, the Online desk and the Admin. Not Management: it checks and
 *  approves orders, it doesn't raise them (Aryan, 19 Nov: "why would Management create an order?"). */
export const ORDER_PLACE_ROLES: readonly Role[] = ["medrep", "team_lead", "manager", "online", "admin"];
/** The Online desk (and the Admin): it reads the money accounts, to tell a customer where to pay.
 *  Its orders are delivered by Dispatch and paid in by Finance, as every channel's (19 Nov). */
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

/** Where an approved order goes: one paid in advance waits for Finance to see the money first;
 *  credit and cash on delivery go to Finance's look at the customer's dues. */
export const afterApproval = (terms: string): OrderStatus =>
  terms === "advance" ? "finance_check" : "ready_for_invoice";

/**
 * Where Management may let a held order go on from (the hub's "Continue from"): where it
 * stopped, first; or an earlier desk, to look at it again — Finance's check, or Management's own
 * approval (to change it and approve it afresh; its invoice is made again then). Never further
 * than it was, so no desk's check is skipped. Once money is on its invoice, or it was packed or
 * sent out, it goes on only from where it stopped.
 */
export function resumeChoices(order: {
  heldFrom: OrderStatus | null;
  terms: string;
  financeCheck: boolean;
  leadId: number | null;
  paidIn: boolean;
}): OrderStatus[] {
  const from = order.heldFrom ?? "pending_approval";
  if (order.paidIn || !["finance_check", "ready_for_invoice", "ready_for_dispatch"].includes(from))
    return [from];
  const earlier: OrderStatus[] = [];
  if (from === "ready_for_dispatch" && order.financeCheck)
    earlier.push(afterApproval(order.terms));
  earlier.push("pending_approval");
  return [from, ...earlier];
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
    /** Who decides it instead of Management (a PAP order's head); none: Management. */
    approverId?: number | null;
    /** Cancelled and can come back (the server says: no money given back, no points, not a case's). */
    restorable?: boolean;
    /** One of the team's (a MedRep under this lead): the lead acts on it as its MedRep would (the
     *  hub: a Team Lead submits, fixes, answers and cancels the team's orders; approves nothing). */
    team?: boolean;
  },
): Record<OrderAction, boolean> {
  const managers = ORDER_MANAGE_ROLES.includes(me.role);
  // The approval (and a hold before it) is the order's own approver's when it has one.
  const decides =
    order.approverId != null ? order.approverId === me.id || me.role === "admin" : managers;
  const finance = FINANCE_ROLES.includes(me.role);
  const dispatch = DISPATCH_ROLES.includes(me.role);
  const mine = order.raisedBy === me.id || order.medrepId === me.id || Boolean(order.team);
  const pending = order.status === "pending_approval";
  const flagged = order.status === "on_hold" || order.status === "exception";
  const held = flagged ? holder(order) : null;
  const manage = pending || held === "management" ? decides : managers;
  return {
    approve: decides && pending,
    send_back: decides && pending,
    reject: decides && pending,
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
    // The hub's Restore: a cancelled order back to Management's approval.
    restore: managers && order.status === "cancelled" && Boolean(order.restorable),
    confirm_payment: finance && order.status === "finance_check",
    make_invoice: finance && order.status === "ready_for_invoice",
    pack: dispatch && order.status === "ready_for_dispatch",
    unpack: dispatch && order.status === "packing",
    ship: dispatch && order.status === "packing",
    // Dispatch marks every order delivered, an Online case's too (Aryan, 19 Nov: Online orders
    // go the same way as every channel's).
    deliver: dispatch && (order.status === "shipped" || order.status === "packing"),
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
    cancelled: ["cancelled"],
    done: ["completed"],
    // Sent back to the MedRep (a draft once sent back): waiting for their fix and answer.
    sent: ["draft"],
    // Approved today, wherever they are now (read by the approval's day).
    passed: [],
  },
  finance: {
    needs: ["finance_check", "ready_for_invoice"],
    upstream: ["pending_approval"],
    dispatch: ["ready_for_dispatch", "packing", "shipped"],
    hold: ["on_hold", "exception"],
    done: ["completed"],
    // Checked and sent on today (read by Finance's step's day).
    passed: [],
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
  ready_for_invoice: "Finance checks what they owe",
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
  hospital_doc: "Hospital's papers",
  payment_proof: "Proof of payment",
  prescription: "Prescription",
  valid_id: "Patient's ID",
  senior_id: "Senior citizen / PWD ID",
  med_cert: "Medical certificate",
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
  customer: {
    kind: string;
    terms: PaymentTerms;
    days: number | null;
    /** A patient's own order, or one for a patient through a hospital or a doctor. */
    patient?: boolean;
    /** A medicine on it needs a prescription. */
    rx?: boolean;
    /** Where the order came from: an old order's PO (one placed before types). */
    source?: string | null;
    /** The order's type (19 Nov): which papers it carries. */
    type?: string | null;
  },
  onFile: PaperKind[],
): { kind: PaperKind; label: string; needed: boolean; why: string | null; onFile: boolean }[] {
  const row = (kind: PaperKind, needed: boolean, why: string | null) => ({
    kind,
    label: PAPER_LABEL[kind],
    needed,
    why,
    onFile: onFile.includes(kind),
  });
  const patient = customer.patient ?? customer.kind === "patient";
  // Whatever the MedRep attached shows too, even a kind this buyer isn't expected to send.
  const withTheRest = (list: ReturnType<typeof row>[]): ReturnType<typeof row>[] => [
    ...list,
    ...onFile
      .filter((kind) => !list.some((one) => one.kind === kind))
      .map((kind) => row(kind, false, null)),
  ];
  const proof = row(
    "payment_proof",
    customer.terms === "advance",
    customer.terms === "advance"
      ? "Pays in advance: Finance checks this"
      : customer.terms === "cod"
        ? "Not needed · pays on delivery"
        : `Not needed · pays in ${customer.days} days`,
  );
  const dr = row(
    "dr",
    false,
    "The delivery receipt the customer signed: Dispatch adds it when it is delivered",
  );
  // The customer's PO, as their kind and the order's source expect it (poExpected, 19 Nov).
  const po = poExpected({ type: customer.type, kind: customer.kind, source: customer.source });
  const poRow =
    po === "never"
      ? []
      : [
          row(
            "po",
            po === "expected",
            po === "expected" ? "Their PO: attach it and type its number" : "When they give one",
          ),
        ];
  // A patient: the prescription and their ID first (Management checks them), then what a
  // discount or a guarantee letter asks for; a hospital's or doctor's order for a patient may
  // carry their PO.
  if (patient)
    return withTheRest([
      row(
        "prescription",
        customer.rx ?? true,
        customer.rx === false
          ? "No medicine on it needs one"
          : "The doctor's prescription for these medicines",
      ),
      row("valid_id", true, "The patient's valid ID"),
      row(
        "senior_id",
        customer.type === "senior_pwd",
        customer.type === "senior_pwd"
          ? "Their senior citizen's or PWD's ID: the 20% off needs it"
          : "For a senior citizen's or PWD's 20% off",
      ),
      row(
        "gl",
        customer.type === "gl",
        customer.type === "gl"
          ? "The agency's guarantee letter (PCSO, DSWD…): it pays"
          : "When a government guarantee letter pays (PCSO, DSWD…)",
      ),
      row("med_cert", false, "When the agency asks for it with the letter"),
      ...poRow,
      proof,
      dr,
      row("other", false, null),
    ]);
  return withTheRest([
    ...poRow,
    row("hospital_doc", false, "Their licence (LTO), accreditation or any paper they send"),
    proof,
    row("prescription", false, "For a prescription medicine, when there is one"),
    dr,
    row("other", false, null),
  ]);
}

/** Papers can be added to an order until it is done, by whoever placed it and by Management.
 *  Finance may add a proof of payment at any time (money for a credit order comes after
 *  delivery), except to a cancelled order. */
export function mayAddPaper(
  me: Me,
  order: {
    status: OrderStatus;
    raisedBy: number;
    medrepId: number;
    leadId?: number | null;
    /** One of the team's, for its lead. */
    team?: boolean;
  },
  kind?: PaperKind,
): boolean {
  if (order.status === "cancelled") return false;
  if (FINANCE_ROLES.includes(me.role) && (kind === undefined || kind === "payment_proof"))
    return true;
  if (DISPATCH_ROLES.includes(me.role) && (kind === undefined || kind === "dr")) return true;
  if (order.status === "completed") return false;
  return (
    ORDER_MANAGE_ROLES.includes(me.role) ||
    order.raisedBy === me.id ||
    order.medrepId === me.id ||
    Boolean(order.team)
  );
}
