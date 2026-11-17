// The Online desk's rules, with no database: where a case stands on its payment road (in the
// old CRM's words, from ./journey.ts), what to do next, which papers the road asks for, and the
// senior citizen / PWD relief.

import type { Role } from "../people/roles";
import type {
  DeskStep,
  LeadPaperKind,
  LeadQueue,
  LeadRoad,
  LeadSource,
  OrderStatus,
  QuoteLine,
  RoadStepWords,
  Vat,
} from "../types";
import { AGENCY_SHORT, ROAD_STEP_DATA, type Road, roadStepData } from "./journey";

/** Who works the cases. */
export const LEAD_WORK_ROLES: readonly Role[] = ["online", "admin"];
/** A PAP MedRep works their own patient-assistance (guarantee letter) cases. */
export const PAP_CHANNEL = "PAP";
export const isPapRep = (me: { role: Role; channel: { code: string } | null }) =>
  me.role === "medrep" && me.channel?.code === PAP_CHANNEL;
/** Who reads them. */
export const LEAD_READ_ROLES: readonly Role[] = ["online", "admin", "ceo", "management"];

export const SOURCE_LABEL: Record<LeadSource, string> = {
  messenger: "Messenger",
  facebook: "Facebook",
  instagram: "Instagram",
  website: "Website",
  website_2mg: "2MG website",
  website_capsandpills: "Caps & Pills website",
  phone: "Call",
  walk_in: "Walk-in",
  referral: "Referral",
  email: "Email",
  other: "Other",
};
export const SOURCES = Object.keys(SOURCE_LABEL) as LeadSource[];

export const PAPER_LABEL: Record<LeadPaperKind, string> = {
  rx: "Prescription",
  osca_id: "Senior citizen (OSCA) ID",
  pwd_id: "PWD ID",
  pwd_booklet: "PWD purchase booklet",
  valid_id: "Patient's valid ID",
  med_cert: "Medical certificate or clinical abstract",
  gl_letter: "Guarantee letter",
  pickup_photo: "Pick-up photo",
  other: "Other paper",
  unsorted: "Photo from the chat",
};
export const PAPER_KINDS = Object.keys(PAPER_LABEL) as LeadPaperKind[];
/** The same papers inside a sentence ("Add the PWD ID"). */
const PAPER_PHRASE: Record<LeadPaperKind, string> = {
  rx: "prescription",
  osca_id: "senior citizen (OSCA) ID",
  pwd_id: "PWD ID",
  pwd_booklet: "PWD purchase booklet",
  valid_id: "patient's valid ID",
  med_cert: "medical certificate or clinical abstract",
  gl_letter: "guarantee letter",
  pickup_photo: "pick-up photo",
  other: "other paper",
  unsorted: "photo from the chat",
};

/** The old journey's three roads: senior and PWD walk the same discount road. */
export const journeyRoad = (road: LeadRoad): Road =>
  road === "gl" ? "gl" : road === "regular" ? "regular" : "discount";

/** The papers each road asks for before the order (the prescription only when a quoted
 *  medicine needs one). */
export function papersFor(road: LeadRoad, rxNeeded: boolean): LeadPaperKind[] {
  const rx: LeadPaperKind[] = rxNeeded ? ["rx"] : [];
  if (road === "senior") return [...rx, "osca_id"];
  if (road === "pwd") return [...rx, "pwd_id", "pwd_booklet"];
  if (road === "gl") return [...rx, "valid_id", "med_cert", "gl_letter"];
  return rx;
}

/** A senior citizen's or PWD's price: VAT taken out of a 12% medicine, then 20% off (the law). */
export const reliefPrice = (price: number, vat: Vat) =>
  Math.round((vat === "vat12" ? price / 1.12 : price) * 0.8);

/** What a quotation comes to on its road. */
export function quoteTotals(
  lines: QuoteLine[],
  road: LeadRoad,
): { subtotal: number; relief: { vatRemoved: number; discount: number } | null; total: number } {
  const subtotal = lines.reduce((sum, line) => sum + line.qty * line.unitPrice, 0);
  if (road !== "senior" && road !== "pwd") return { subtotal, relief: null, total: subtotal };
  const net = lines.reduce(
    (sum, line) =>
      sum + line.qty * (line.vat === "vat12" ? Math.round(line.unitPrice / 1.12) : line.unitPrice),
    0,
  );
  const total = lines.reduce(
    (sum, line) => sum + line.qty * reliefPrice(line.unitPrice, line.vat),
    0,
  );
  return { subtotal, relief: { vatRemoved: subtotal - net, discount: net - total }, total };
}

/** The facts a case's step is read from. */
export type CaseFacts = {
  road: LeadRoad;
  agency: string | null;
  lost: boolean;
  quoted: boolean;
  rxNeeded: boolean;
  files: Set<LeadPaperKind>;
  glApplied: boolean;
  glLetter: boolean;
  glVerified: boolean;
  /** Why the verified letter can't carry the order (expired, less than the quotation). */
  glProblem: string | null;
  /** The claim went to the agency after delivery. */
  claimSent: boolean;
  order: {
    status: OrderStatus;
    flagReason: string | null;
    courier: string | null;
    tracking: string | null;
    rider: string | null;
    method: string | null;
    paid: boolean;
    /** Paid in advance: the agent records the money received. */
    advance: boolean;
    proof: boolean;
  } | null;
};

/** Where a case stands: a saved road step of the old CRM ("new", "rx_wait", "ready", …). */
export function roadStepOf(f: CaseFacts): string {
  if (f.lost) return "lost";
  const order = f.order && f.order.status !== "cancelled" ? f.order : null;
  if (order) {
    if (order.status === "completed")
      return order.paid ? "done" : f.road === "gl" ? (f.claimSent ? "billed" : "claim") : "payment";
    return "ordered";
  }
  const rxOk = !f.rxNeeded || f.files.has("rx");
  if (!f.quoted) return f.files.has("rx") ? "rx_ok" : "new";
  if (f.road === "gl") {
    if (!f.glApplied) return "apply";
    if (!f.glLetter) return "waiting";
    if (!f.glVerified || f.glProblem) return "verify";
    if (!rxOk || !f.files.has("valid_id") || !f.files.has("med_cert")) return "papers";
    return "ready";
  }
  if (!rxOk) return "rx_wait";
  if (f.road === "senior" && !f.files.has("osca_id")) return "papers";
  if (f.road === "pwd" && (!f.files.has("pwd_id") || !f.files.has("pwd_booklet"))) return "papers";
  return "ready";
}

const ORDER_WORDS: Partial<Record<OrderStatus, string>> = {
  pending_approval: "With Management for a check",
  finance_check: "Finance checks the payment",
  ready_for_invoice: "Finance checks what they owe",
  ready_for_dispatch: "Dispatch packs it",
  packing: "Packed: Dispatch ships it",
};

/** What to do next, in one line for the card and the case. */
export function nextOf(f: CaseFacts, step: string): string {
  const agency = f.agency ? (AGENCY_SHORT[f.agency] ?? f.agency.toUpperCase()) : "the agency";
  const missing = (kinds: LeadPaperKind[]) =>
    kinds
      .filter((kind) => !f.files.has(kind))
      .map((kind) => PAPER_PHRASE[kind])
      .join(", ")
      .replace(/, ([^,]*)$/, " and $1");
  switch (step) {
    case "lost":
      return "Closed as lost";
    case "new":
      return "Answer the enquiry and save the quotation";
    case "rx_ok":
      return "Prescription on file: save the quotation";
    case "rx_wait":
      return "Add the prescription photo";
    case "papers":
      return `Add the ${missing(papersFor(f.road, f.rxNeeded).filter((kind) => kind !== "gl_letter"))}`;
    case "apply":
      return `Send the quotation and record the ${agency} application`;
    case "waiting":
      return `Waiting for the ${agency} letter: follow up`;
    case "verify":
      return f.glProblem ?? "Check the guarantee letter and mark it verified";
    case "ready":
      return "Place the order";
    case "ordered": {
      const order = f.order;
      if (!order) return "Ordered";
      if (order.status === "on_hold" || order.status === "exception")
        return `Order on hold: ${order.flagReason ?? "no reason given"}`;
      if (order.status === "draft")
        return `Order sent back: ${order.flagReason ?? "fix it and place it again"}`;
      if (order.status === "pending_approval") return ORDER_WORDS.pending_approval as string;
      // Paid in advance: the agent records the money as soon as the order is on its way to Dispatch.
      if (order.advance && !order.paid) return "Record the advance payment received";
      if (order.status === "shipped")
        return `${order.method === "rider" ? `With our rider ${order.rider}` : `On the way with ${order.courier ?? "the courier"}${order.tracking ? ` · ${order.tracking}` : ""}`}: mark it delivered`;
      return ORDER_WORDS[order.status] ?? "Ordered";
    }
    case "payment":
      return "Delivered: record the payment received";
    case "claim":
      return f.files.has("pickup_photo")
        ? `Delivered: send the claim to ${agency}`
        : `Delivered: add the pick-up photo, then send the claim to ${agency}`;
    case "billed":
      return `Claim sent: waiting for ${agency} to pay`;
    case "done":
      return "Delivered and paid; refill when due";
    default:
      return roadStepData(journeyRoad(f.road), step).hint;
  }
}

/** The road's steps and where this one is on them. */
export function stepsOf(
  road: LeadRoad,
  step: string,
): { steps: RoadStepWords[]; index: number; words: RoadStepWords } {
  const steps = ROAD_STEP_DATA[journeyRoad(road)];
  const index = Math.max(
    0,
    steps.findIndex((row) => row.value === step),
  );
  return {
    steps,
    index,
    words:
      step === "lost"
        ? { value: "lost", label: "Lost", hint: "closed" }
        : roadStepData(journeyRoad(road), step),
  };
}

/** The desk's step line, as the old desk grouped the road steps. */
export function deskStepOf(step: string): DeskStep {
  if (step === "lost") return "lost";
  if (step === "new") return "new";
  if (step === "rx_wait" || step === "rx_check" || step === "rx_ok") return "rx";
  if (step === "quoted") return "quote";
  if (["papers", "apply", "waiting", "verify"].includes(step)) return "papers";
  if (step === "ready") return "ready";
  if (step === "ordered") return "ordered";
  if (["invoice", "payment", "claim", "billed"].includes(step)) return "unpaid";
  return "done";
}

/** Which queues a case is in (All is every case). */
export function queuesOf(step: string): LeadQueue[] {
  if (step === "lost") return ["all", "lost"];
  const out: LeadQueue[] = ["all"];
  if (step !== "done") out.push("active");
  if (step === "ordered") out.push("deliver");
  if (["invoice", "payment", "claim", "billed"].includes(step)) out.push("payment");
  if (step === "done") out.push("done");
  return out;
}
