// The Online desk: each enquiry is a case. The agent saves the patient and how they pay, the
// quotation, the papers the road asks for (and, on a guarantee letter, the application and the
// letter), then places the order: it joins the same order line as a MedRep's, the agent as the
// Online channel's MedRep. Where a case stands is read from all of that every time, in the old
// CRM's road steps, so it can never disagree with its papers or its order.

import { type SQL, sql } from "drizzle-orm";
import { phoneKey } from "../customers/service";
import { type Database, rows } from "../db/index";
import { invoiceState } from "../finance/rules";
import { orderMoney } from "../finance/service";
import { allow, Refusal } from "../http";
import { todayManila } from "../inventory/rules";
import { clean, day, iso, type Runner } from "../inventory/service";
import { logEvent, peso } from "../orders/events";
import { STATUS_LABEL } from "../orders/rules";
import { caseOrderChecks, placeOrder } from "../orders/service";
import { formatPhone } from "../phone";
import { pointsByPhone, spendOnOrder } from "../points/service";
import { useWebsiteReservation } from "../points/website";
import { pointsProgram } from "../settings/service";
import type {
  CaseOrderTrail,
  DeskStep,
  GlInput,
  InvoiceState,
  LeadCard,
  LeadCase,
  LeadDesk,
  LeadInput,
  LeadPaper,
  LeadPaperKind,
  LeadQueue,
  LeadRoad,
  Me,
  OrderStatus,
  PaymentTerms,
  QuoteInput,
  QuoteLine,
  Vat,
} from "../types";
import { caseHistory } from "./case-history";
import {
  type CaseFacts,
  deskStepOf,
  LEAD_READ_ROLES,
  LEAD_WORK_ROLES,
  nextOf,
  PAPER_KINDS,
  PAPER_LABEL,
  papersFor,
  queuesOf,
  quoteTotals,
  reliefPrice,
  roadStepOf,
  SOURCE_LABEL,
  stepsOf,
} from "./rules";
import { webOrderOfCase, websiteTerms } from "./websites";

const SHOWN = 300;
const FILE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
];
export const LEAD_FILE_MAX_BYTES = 10 * 1024 * 1024;

type LeadRow = {
  id: number;
  code: string;
  source: LeadCase["lead"]["source"];
  name: string;
  relation: string | null;
  patientName: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  address: string | null;
  customerId: number | null;
  assignedTo: number | null;
  assignedName: string | null;
  road: LeadRoad;
  agency: LeadCase["lead"]["agency"];
  request: string | null;
  quoteLines: QuoteLine[];
  quoteRoad: string | null;
  quoteAgency: string | null;
  quoteSavedAt: string | null;
  quoteSentVia: string | null;
  quoteSentAt: string | null;
  glAppliedOn: string | null;
  glLetterNo: string | null;
  glAmount: number | null;
  glLetterOn: string | null;
  glVerifiedAt: string | null;
  state: "open" | "lost";
  lostReason: string | null;
  orderId: number | null;
  firstContactAt: string;
  firstDay: string;
  unopened: boolean;
  createdBy: string;
  orderCode: string | null;
  orderStatus: OrderStatus | null;
  orderTotal: number | null;
  orderTerms: PaymentTerms | null;
  orderProof: boolean;
  flagReason: string | null;
  courier: string | null;
  tracking: string | null;
  rider: string | null;
  method: string | null;
  invoiceCode: string | null;
  invoiceStatus: "open" | "paid" | "cancelled" | null;
  invoiceTerms: "advance" | "cod" | "days" | null;
  invoiceDue: string | null;
  invoicePaid: number | null;
  invoiceTotal: number | null;
  kinds: LeadPaperKind[];
  chatChannel: "messenger" | "email" | null;
  chatAccount: string | null;
  awaitingReply: boolean;
  unread: boolean;
  lastMessage: string | null;
  lastMessageAt: string | null;
  lastInboundAt: string | null;
  caseType: "enquiry" | "website_order";
  siteName: string | null;
  phoneKey: string | null;
  pointsToUse: number;
};

const leadColumns = sql`l.id::int as id, l.code, l.source, l.name, l.relation, l.patient_name as "patientName", l.phone, l.email, l.city,
  l.address, l.customer_id::int as "customerId", l.assigned_to::int as "assignedTo", who.name as "assignedName", l.road, l.agency, l.request,
  l.quote_lines as "quoteLines", l.quote_road as "quoteRoad", l.quote_agency as "quoteAgency", ${iso("l.quote_saved_at")} as "quoteSavedAt",
  l.quote_sent_via as "quoteSentVia", ${iso("l.quote_sent_at")} as "quoteSentAt", ${day("l.gl_applied_on")} as "glAppliedOn",
  l.gl_letter_no as "glLetterNo", l.gl_amount::int as "glAmount", ${day("l.gl_letter_on")} as "glLetterOn", ${iso("l.gl_verified_at")} as "glVerifiedAt",
  l.state, l.lost_reason as "lostReason", l.order_id::int as "orderId", ${iso("l.first_contact_at")} as "firstContactAt",
  to_char(l.first_contact_at at time zone 'Asia/Manila', 'YYYY-MM-DD') as "firstDay", (l.opened_at is null) as unopened,
  coalesce(maker.name, case l.chat_channel when 'messenger' then 'Messenger' when 'email' then 'Email' else 'System' end) as "createdBy",
  l.chat_channel as "chatChannel", ca.name as "chatAccount", (l.awaiting_reply and l.state = 'open') as "awaitingReply",
  (l.awaiting_reply and l.state = 'open' and (l.seen_at is null or l.last_inbound_at > l.seen_at)) as unread, l.last_message as "lastMessage",
  ${iso("l.last_message_at")} as "lastMessageAt", ${iso("l.last_inbound_at")} as "lastInboundAt",
  l.case_type as "caseType", site.name as "siteName", l.phone_key as "phoneKey", l.points_to_use::int as "pointsToUse",
  o.code as "orderCode", o.status as "orderStatus", o.total::int as "orderTotal", o.payment_terms as "orderTerms",
  exists (select 1 from order_file pf where pf.order_id = o.id and pf.kind = 'payment_proof' and pf.active) as "orderProof", o.flag_reason as "flagReason", o.courier, o.tracking, o.rider,
  o.delivery_method as method, i.code as "invoiceCode", i.status as "invoiceStatus", i.terms as "invoiceTerms", ${day("i.due_on")} as "invoiceDue",
  i.paid::int as "invoicePaid", i.total::int as "invoiceTotal",
  (select coalesce(array_agg(distinct f.kind), '{}'::text[]) from lead_file f where f.lead_id = l.id and f.active) as kinds`;
const leadFrom = sql`from lead l left join person maker on maker.id = l.created_by left join person who on who.id = l.assigned_to
  left join channel_account ca on ca.id = l.chat_account_id left join channel_account site on site.id = l.site_account_id
  left join sales_order o on o.id = l.order_id left join invoice i on i.order_id = o.id`;

/** A case's quotation is for its road (and agency) as it is now. */
const quotedFor = (row: LeadRow) =>
  row.quoteLines.length > 0 &&
  row.quoteRoad === row.road &&
  (row.road !== "gl" || row.quoteAgency === row.agency);

function factsOf(row: LeadRow): CaseFacts {
  return {
    road: row.road,
    agency: row.agency,
    lost: row.state === "lost",
    quoted: quotedFor(row),
    // A prescription is asked for until the quotation shows every medicine is over the counter.
    rxNeeded: row.quoteLines.length === 0 || row.quoteLines.some((line) => line.rx),
    files: new Set(row.kinds),
    glApplied: Boolean(row.glAppliedOn),
    glLetter: Boolean(row.glLetterNo) || row.kinds.includes("gl_letter"),
    glVerified: Boolean(row.glVerifiedAt),
    order: row.orderStatus
      ? {
          status: row.orderStatus,
          flagReason: row.flagReason,
          courier: row.courier,
          tracking: row.tracking,
          rider: row.rider,
          method: row.method,
          paid: row.invoiceStatus === "paid",
          advance: row.orderTerms === "advance",
          proof: row.orderProof,
        }
      : null,
  };
}

const interestOf = (row: LeadRow) =>
  row.quoteLines.length
    ? row.quoteLines
        .map((line) => `${line.medicine} × ${line.qty.toLocaleString("en-PH")}`)
        .join(", ")
    : row.request;

function cardOf(row: LeadRow): LeadCard {
  const facts = factsOf(row);
  const step = roadStepOf(facts);
  const { steps, index, words } = stepsOf(row.road, step);
  const needed = papersFor(row.road, facts.rxNeeded);
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    patient: row.patientName && row.patientName !== row.name ? row.patientName : null,
    phone: row.phone,
    source: row.source,
    sourceLabel: row.siteName ?? SOURCE_LABEL[row.source],
    caseType: row.caseType,
    road: row.road,
    agency: row.agency,
    city: row.city,
    interest: interestOf(row),
    owner: row.assignedName,
    step: words,
    stepIndex: index,
    steps,
    deskStep: deskStepOf(step),
    next: nextOf(facts, step),
    lost: step === "lost",
    lostReason: row.lostReason,
    finished: step === "done",
    unopened: row.unopened,
    firstContactAt: row.firstContactAt,
    firstDay: row.firstDay,
    papers: {
      needed: needed.length,
      onFile: needed.filter((kind) => facts.files.has(kind)).length,
    },
    rxOnFile: facts.rxNeeded && facts.files.has("rx"),
    order:
      row.orderId && row.orderCode && row.orderStatus
        ? { id: row.orderId, code: row.orderCode, statusLabel: STATUS_LABEL[row.orderStatus] }
        : null,
    chat: row.chatChannel,
    awaitingReply: row.awaitingReply,
    unread: row.unread,
    lastMessage: row.lastMessage,
    lastMessageAt: row.lastMessageAt,
  };
}

const agentsOf = (db: Runner) =>
  rows<{ id: number; name: string }>(
    db,
    sql`select id::int as id, name from person where active and role in ('online', 'admin') order by role = 'admin', name`,
  );

// ---------------------------------------------------------------- the desk

const QUEUES: LeadQueue[] = ["all", "active", "attention", "deliver", "payment", "done", "lost"];
const DESK_STEPS: DeskStep[] = [
  "new",
  "rx",
  "quote",
  "papers",
  "ready",
  "ordered",
  "unpaid",
  "done",
  "lost",
];

/** The queues a card is in: by its step, and Attention when it waits on the agent's word (an
 *  unanswered message, an order held or sent back). */
function queuesOfCard(card: LeadCard): LeadQueue[] {
  const by = queuesOf(stepValue(card));
  const attention =
    by.includes("active") &&
    (card.awaitingReply ||
      card.next.startsWith("Order on hold") ||
      card.next.startsWith("Order sent back"));
  return attention ? [...by, "attention"] : by;
}

const roadOf = (card: LeadCard) =>
  card.road === "senior" || card.road === "pwd" ? "senior_pwd" : card.road;
const MONTH_NAME = (key: string) =>
  new Date(`${key}-01T00:00:00Z`).toLocaleDateString("en-PH", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

export async function leadDesk(
  db: Database,
  me: Me,
  filter: {
    queue?: string;
    step?: string;
    q?: string;
    source?: string;
    road?: string;
    who?: string;
    type?: string;
    month?: string;
    shown?: number;
  },
): Promise<LeadDesk> {
  allow(me, LEAD_READ_ROLES, "see the Online desk");
  const queue: LeadQueue = QUEUES.includes(filter.queue as LeadQueue)
    ? (filter.queue as LeadQueue)
    : "active";
  const step: DeskStep | null = DESK_STEPS.includes(filter.step as DeskStep)
    ? (filter.step as DeskStep)
    : null;
  const road = ["regular", "senior", "pwd", "senior_pwd", "gl"].includes(filter.road ?? "")
    ? (filter.road as string)
    : null;
  const type = filter.type === "enquiry" || filter.type === "website_order" ? filter.type : null;
  const month = /^\d{4}-\d{2}$/.test(filter.month ?? "") ? (filter.month as string) : null;
  const where: SQL[] = [];
  if (filter.source && filter.source in SOURCE_LABEL) where.push(sql`l.source = ${filter.source}`);
  if (filter.who === "mine") where.push(sql`l.assigned_to = ${me.id}`);
  for (const word of (filter.q ?? "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 5)) {
    const like = `%${word.replace(/[%_\\]/g, "\\$&")}%`;
    const digits = word.replace(/\D/g, "");
    where.push(
      sql`(lower(l.name) like ${like} or lower(coalesce(l.patient_name, '')) like ${like} or lower(l.code) like ${like}
        or lower(coalesce(l.request, '')) like ${like} or lower(l.quote_lines::text) like ${like} or lower(coalesce(l.city, '')) like ${like}
        or lower(coalesce(l.last_message, '')) like ${like} or lower(coalesce(l.email, '')) like ${like}
        ${digits.length >= 4 ? sql`or coalesce(l.phone_key, '') like ${`%${digits}%`}` : sql``})`,
    );
  }
  const [found, agents] = await Promise.all([
    rows<LeadRow>(
      db,
      sql`select ${leadColumns} ${leadFrom} where ${where.length ? sql.join(where, sql` and `) : sql`true`} order by l.first_contact_at desc, l.id desc`,
    ),
    agentsOf(db),
  ]);
  const every = found.map(cardOf);
  // The kind and the road narrow everything but their own counts.
  const ofType = (card: LeadCard) => !type || card.caseType === type;
  const ofRoad = (card: LeadCard) =>
    !road || (road === "senior_pwd" ? roadOf(card) === road : card.road === road);
  const inQueueOf = (card: LeadCard) => queuesOfCard(card).includes(queue);
  const all = every.filter((card) => ofType(card) && ofRoad(card));
  const counts = Object.fromEntries(QUEUES.map((key) => [key, 0])) as Record<LeadQueue, number>;
  for (const card of all) for (const key of queuesOfCard(card)) counts[key] += 1;
  const types = { all: 0, enquiry: 0, website_order: 0 };
  for (const card of every.filter((one) => ofRoad(one) && inQueueOf(one))) {
    types.all += 1;
    types[card.caseType] += 1;
  }
  const roads = { all: 0, regular: 0, senior_pwd: 0, gl: 0 };
  for (const card of every.filter((one) => ofType(one) && inQueueOf(one))) {
    roads.all += 1;
    roads[roadOf(card)] += 1;
  }
  const inQueue = all.filter(inQueueOf);
  const byMonth = new Map<string, number>();
  for (const card of inQueue)
    byMonth.set(card.firstDay.slice(0, 7), (byMonth.get(card.firstDay.slice(0, 7)) ?? 0) + 1);
  const months = [...byMonth.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 6)
    .map(([key, n]) => ({ key, label: MONTH_NAME(key), count: n }));
  const inMonth = month ? inQueue.filter((card) => card.firstDay.startsWith(month)) : inQueue;
  const steps = Object.fromEntries(DESK_STEPS.map((key) => [key, 0])) as Record<DeskStep, number>;
  for (const card of inMonth) steps[card.deskStep] += 1;
  const matched = step ? inMonth.filter((card) => card.deskStep === step) : inMonth;
  return {
    queue,
    step,
    counts,
    steps,
    types,
    roads,
    months,
    month,
    cards: matched.slice(0, Math.max(SHOWN, filter.shown ?? 0)),
    total: matched.length,
    agents,
    can: { add: LEAD_WORK_ROLES.includes(me.role) },
  };
}

const stepValue = (card: LeadCard) => (card.lost ? "lost" : card.step.value);

// ---------------------------------------------------------------- one case

async function readLead(db: Runner, id: number): Promise<LeadRow> {
  const [row] = await rows<LeadRow>(db, sql`select ${leadColumns} ${leadFrom} where l.id = ${id}`);
  if (!row) throw new Refusal(404, "not_found", "That enquiry doesn't exist.");
  return row;
}

const ORDER_FOR_JOURNEY: Partial<Record<OrderStatus, string>> = {
  draft: "draft",
  shipped: "shipped",
  completed: "delivered",
  cancelled: "cancelled",
};

/** The journey chart's facts, in the shape the old chart reads. */
function journeyOf(row: LeadRow, facts: CaseFacts, step: string): LeadCase["journey"] {
  const liveOrder = Boolean(row.orderStatus && row.orderStatus !== "cancelled");
  const quoted = quotedFor(row);
  return {
    lead: {
      state: row.state === "lost" ? "lost" : liveOrder ? "ordered" : quoted ? "quoted" : "new",
      assistance: row.road === "regular" ? "none" : row.road,
      agency: row.agency,
      road_step: step,
      quote: quoted ? "saved" : "",
      quote_sent_via: row.quoteSentVia,
      quote_context: row.quoteLines.length
        ? {
            assistance: row.quoteRoad === "regular" ? "none" : row.quoteRoad,
            agency: row.quoteAgency,
          }
        : null,
      case_type: row.caseType,
      rx_needed: facts.rxNeeded,
      source: row.source,
    },
    rx: facts.files.has("rx") ? { state: "approved" } : null,
    gl:
      row.road === "gl" && row.glAppliedOn
        ? {
            state:
              step === "done"
                ? "paid"
                : row.glVerifiedAt
                  ? "verified"
                  : facts.glLetter
                    ? "letter_received"
                    : "applied",
            claim_sent_on: null,
          }
        : null,
    order:
      liveOrder && row.orderStatus
        ? {
            state: ORDER_FOR_JOURNEY[row.orderStatus] ?? "confirmed",
            packed_at: row.orderStatus === "packing" ? row.firstContactAt : null,
          }
        : null,
    approved: row.kinds,
  };
}

/** Where a case stands, for a website's admin reading its order's progress (no person asks). */
export async function caseProgress(db: Database, leadId: number) {
  const row = await readLead(db, leadId);
  const facts = factsOf(row);
  const step = roadStepOf(facts);
  return {
    road: row.road,
    agency: row.agency,
    step: stepsOf(row.road, step).words,
    next: nextOf(facts, step),
    journey: journeyOf(row, facts, step),
  };
}

/** Why the case can't use points (null when it can). Points are a choice instead of any other
 *  discount: never with the senior / PWD discount or a guarantee letter. */
function pointsWhy(row: LeadRow, balance: number): string | null {
  if (row.road !== "regular")
    return "Points don't combine with the senior / PWD discount or a guarantee letter.";
  if (!row.phoneKey) return "Add their phone number: their points are kept by it.";
  if (balance <= 0) return "They have no points yet.";
  return null;
}

/** How many points the case's order will use (0 takes them off). */
export async function setCasePoints(
  db: Database,
  me: Me,
  id: number,
  points: number,
): Promise<void> {
  allow(me, LEAD_WORK_ROLES, "use a customer's points");
  if (!Number.isInteger(points) || points < 0)
    throw new Refusal(400, "invalid", "Type a whole number of points.", "points");
  await db.transaction(async (tx) => {
    const lead = await lockLead(tx, id);
    if (lead.ordered)
      throw new Refusal(409, "not_now", "The order is placed: its points are on it now.");
    const row = await readLead(tx, id);
    if (points > 0) {
      const why = pointsWhy(row, (await pointsByPhone(tx, row.phoneKey)).balance);
      if (why) throw new Refusal(409, "not_now", why, "points");
      const { balance } = await pointsByPhone(tx, row.phoneKey);
      if (points > balance)
        throw new Refusal(
          400,
          "invalid",
          `They have ${balance.toLocaleString("en-PH")} points.`,
          "points",
        );
      const goods = quoteTotals(row.quoteLines, row.road).total;
      if (points * 100 > goods)
        throw new Refusal(
          400,
          "invalid",
          `Points pay for the medicines only: at most ${Math.floor(goods / 100).toLocaleString("en-PH")} points here.`,
          "points",
        );
    }
    await tx.execute(sql`update lead set points_to_use = ${points} where id = ${id}`);
    await note(
      tx,
      id,
      me,
      "status",
      points
        ? `${points.toLocaleString("en-PH")} points will be used on the order.`
        : "No points on the order.",
    );
  });
}

/** What happened to a case's order on the order line, for its Order & delivery and Payment steps. */
async function orderTrail(db: Runner, orderId: number): Promise<CaseOrderTrail> {
  const [order] = await rows<{
    status: OrderStatus;
    approvedAt: string | null;
    approvedBy: string | null;
    flagReason: string | null;
    heldRole: string | null;
    packedAt: string | null;
    packedBy: string | null;
    warehouse: string | null;
    shippedAt: string | null;
    shippedBy: string | null;
    method: string | null;
    courier: string | null;
    tracking: string | null;
    rider: string | null;
    deliveredOn: string | null;
    receivedBy: string | null;
    deliveredBy: string | null;
    receiver: string | null;
    receiverPhone: string | null;
    address: string | null;
    pointsUsed: number;
  }>(
    db,
    sql`select o.status, ${iso("o.approved_at")} as "approvedAt", approver.name as "approvedBy", o.flag_reason as "flagReason",
        o.held_role as "heldRole", ${iso("o.packed_at")} as "packedAt", packer.name as "packedBy", w.name as warehouse,
        ${iso("o.shipped_at")} as "shippedAt", shipper.name as "shippedBy", o.delivery_method as method, o.courier, o.tracking, o.rider,
        ${day("o.delivered_on")} as "deliveredOn", o.received_by as "receivedBy", deliverer.name as "deliveredBy",
        o.receiver, o.receiver_phone as "receiverPhone", o.delivery_address as address, o.points_used::int as "pointsUsed"
      from sales_order o
        left join person approver on approver.id = o.approved_by left join person packer on packer.id = o.packed_by
        left join person shipper on shipper.id = o.shipped_by left join person deliverer on deliverer.id = o.delivered_by
        left join warehouse w on w.id = o.warehouse_id
      where o.id = ${orderId}`,
  );
  if (!order) throw new Refusal(404, "not_found", "That order doesn't exist.");
  const [picks, money, checks] = await Promise.all([
    rows<{ medicine: string; batchNo: string; expiresOn: string; qty: number }>(
      db,
      sql`select m.name || coalesce(' ' || m.strength, '') as medicine, b.batch_no as "batchNo", ${day("b.expires_on")} as "expiresOn", p.qty::int as qty
        from order_pick p join batch b on b.id = p.batch_id join medicine m on m.id = b.medicine_id where p.order_id = ${orderId} and p.active order by p.id`,
    ),
    orderMoney(db, orderId),
    order.status === "pending_approval" ? caseOrderChecks(db, orderId) : Promise.resolve([]),
  ]);
  const held =
    (order.status === "on_hold" || order.status === "exception") &&
    (order.heldRole ?? "management") === "management";
  const check: CaseOrderTrail["check"] =
    order.status === "pending_approval"
      ? { state: "waiting", by: null, at: null, reasons: checks.map((found) => found.text) }
      : held
        ? { state: "held", by: null, at: null, reasons: order.flagReason ? [order.flagReason] : [] }
        : order.status === "draft"
          ? {
              state: "sent_back",
              by: null,
              at: null,
              reasons: order.flagReason ? [order.flagReason] : [],
            }
          : order.approvedBy
            ? { state: "approved", by: order.approvedBy, at: order.approvedAt, reasons: [] }
            : { state: "none", by: null, at: order.approvedAt, reasons: [] };
  const month = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-PH", {
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  return {
    check,
    packed: order.packedAt
      ? {
          by: order.packedBy,
          at: order.packedAt,
          warehouse: order.warehouse,
          batches: picks.map(
            (pick) => `${pick.medicine} · batch ${pick.batchNo}, exp ${month(pick.expiresOn)}`,
          ),
        }
      : null,
    shipped: order.shippedAt
      ? {
          how:
            order.method === "rider"
              ? `Our rider ${order.rider ?? ""}`.trim()
              : [order.courier, order.tracking].filter(Boolean).join(" · ") || "Courier",
          by: order.shippedBy,
          at: order.shippedAt,
        }
      : null,
    delivered: order.deliveredOn
      ? { on: order.deliveredOn, receivedBy: order.receivedBy, by: order.deliveredBy }
      : null,
    receiver: order.receiver,
    receiverPhone: order.receiverPhone,
    address: order.address,
    pointsUsed: order.pointsUsed,
    invoice: money.invoice
      ? {
          id: money.invoice.id,
          code: money.invoice.code,
          total: money.invoice.total,
          paid: money.invoice.paid,
          balance: money.invoice.balance,
          state: money.invoice.state,
        }
      : null,
    payments: money.payments
      .filter((payment) => payment.active)
      .map((payment) => ({
        id: payment.id,
        amount: payment.amount,
        methodLabel: payment.methodLabel,
        reference: payment.reference,
        paidOn: payment.paidOn,
        by: payment.by,
      })),
  };
}

export async function leadCase(db: Database, me: Me, id: number): Promise<LeadCase> {
  allow(me, LEAD_READ_ROLES, "see the Online desk");
  const row = await readLead(db, id);
  const work = LEAD_WORK_ROLES.includes(me.role);
  if (work && row.unopened)
    await db.execute(sql`update lead set opened_at = now() where id = ${id} and opened_at is null`);
  const [files, events, agents, web, wallet, program, trail, history] = await Promise.all([
    rows<Omit<LeadPaper, "kindLabel">>(
      db,
      sql`select f.id::int as id, f.kind, f.name, f.mime, f.size::int as size, coalesce(p.name, 'From the chat') as by, ${iso("f.at")} as at
        from lead_file f left join person p on p.id = f.by_person where f.lead_id = ${id} and f.active order by f.at, f.id`,
    ),
    rows<LeadCase["events"][number]>(
      db,
      sql`select e.id::int as id, e.kind, e.message, coalesce(p.name, 'System') as by, ${iso("e.at")} as at
        from lead_event e left join person p on p.id = e.by_person where e.lead_id = ${id} order by e.at desc, e.id desc`,
    ),
    agentsOf(db),
    row.caseType === "website_order" || row.siteName
      ? webOrderOfCase(db, id)
      : Promise.resolve(null),
    pointsByPhone(db, row.phoneKey),
    pointsProgram(db),
    row.orderId && row.orderStatus ? orderTrail(db, row.orderId) : Promise.resolve(null),
    caseHistory(db, { id, phoneKey: row.phoneKey, customerId: row.customerId }),
  ]);
  const facts = factsOf(row);
  const step = roadStepOf(facts);
  const { steps, index, words } = stepsOf(row.road, step);
  const needed = papersFor(row.road, facts.rxNeeded);
  const papers = PAPER_KINDS.filter((kind) => kind !== "other" && kind !== "unsorted").map(
    (kind) => ({
      kind,
      label: PAPER_LABEL[kind],
      needed: needed.includes(kind),
      files: files
        .filter((file) => file.kind === kind)
        .map((file) => ({ ...file, kindLabel: PAPER_LABEL[file.kind] })),
    }),
  );
  const quoted = quotedFor(row);
  const totals = quoteTotals(row.quoteLines, row.road);
  const liveOrder = row.orderStatus && row.orderStatus !== "cancelled";
  const placeWhy = !work
    ? "Only the Online desk places orders."
    : row.state === "lost"
      ? "The case is closed."
      : liveOrder
        ? "The order is placed."
        : step === "ready"
          ? null
          : nextOf(facts, step);
  const invoice: { code: string; state: InvoiceState; balance: number } | null =
    row.invoiceCode && row.invoiceStatus && row.invoiceTerms && row.invoiceDue
      ? {
          code: row.invoiceCode,
          state: invoiceState(
            {
              status: row.invoiceStatus,
              terms: row.invoiceTerms,
              dueOn: row.invoiceDue,
              paid: row.invoicePaid ?? 0,
              total: row.invoiceTotal ?? 0,
              delivered: row.orderStatus === "completed",
            },
            todayManila(),
          ),
          balance:
            row.invoiceStatus === "cancelled"
              ? 0
              : (row.invoiceTotal ?? 0) - (row.invoicePaid ?? 0),
        }
      : null;
  return {
    lead: {
      id: row.id,
      code: row.code,
      source: row.source,
      sourceLabel: row.siteName ?? SOURCE_LABEL[row.source],
      caseType: row.caseType,
      name: row.name,
      relation: row.relation,
      patientName: row.patientName,
      phone: row.phone,
      email: row.email,
      city: row.city,
      address: row.address,
      customerId: row.customerId,
      assignedTo: row.assignedTo,
      assignedName: row.assignedName,
      road: row.road,
      agency: row.agency,
      request: row.request,
      quoteSentVia: row.quoteSentVia,
      quoteSentAt: row.quoteSentAt,
      glAppliedOn: row.glAppliedOn,
      glLetterNo: row.glLetterNo,
      glAmount: row.glAmount,
      glLetterOn: row.glLetterOn,
      glVerifiedAt: row.glVerifiedAt,
      state: row.state,
      lostReason: row.lostReason,
      firstContactAt: row.firstContactAt,
      createdBy: row.createdBy,
      chatChannel: row.chatChannel,
      chatAccount: row.chatAccount,
      awaitingReply: row.awaitingReply,
      lastInboundAt: row.lastInboundAt,
    },
    step: words,
    steps,
    stepIndex: index,
    next: nextOf(facts, step),
    papers,
    unsorted: files
      .filter((file) => file.kind === "unsorted")
      .map((file) => ({ ...file, kindLabel: PAPER_LABEL.unsorted })),
    web,
    points: {
      program,
      accountId: wallet.accountId,
      balance: wallet.balance,
      toUse: web?.pointsRedeemed ? web.pointsRedeemed : row.pointsToUse,
      why: web?.pointsRedeemed
        ? `The customer used ${web.pointsRedeemed.toLocaleString("en-PH")} points at the website's checkout.`
        : pointsWhy(row, wallet.balance),
    },
    quote: {
      lines: row.quoteLines,
      ...totals,
      stale: row.quoteLines.length > 0 && !quoted,
      savedAt: row.quoteSavedAt,
    },
    order:
      row.orderId && row.orderCode && row.orderStatus
        ? {
            id: row.orderId,
            code: row.orderCode,
            status: row.orderStatus,
            statusLabel: STATUS_LABEL[row.orderStatus],
            total: row.orderTotal ?? 0,
            terms: row.orderTerms ?? "advance",
            proof: row.orderProof,
            flagReason: row.flagReason,
            invoice,
            trail: trail as CaseOrderTrail,
          }
        : null,
    journey: journeyOf(row, facts, step),
    events,
    agents,
    history,
    can: {
      work: work && row.state === "open",
      placeOrder: placeWhy === null,
      placeWhy,
      // The agent hands the parcel over once Dispatch has packed it, and records the money once
      // there is an invoice (in advance, or after a cash-on-delivery handover).
      deliver: work && (row.orderStatus === "shipped" || row.orderStatus === "packing"),
      pay:
        work &&
        Boolean(
          trail?.invoice && trail.invoice.balance > 0 && trail.invoice.state.word !== "Cancelled",
        ) &&
        (row.orderTerms !== "cod" || row.orderStatus === "completed"),
    },
  };
}

// ---------------------------------------------------------------- writing

async function lockLead(tx: Runner, id: number) {
  const [lead] = await rows<{
    id: number;
    code: string;
    state: string;
    road: LeadRoad;
    orderId: number | null;
    orderStatus: OrderStatus | null;
  }>(
    tx,
    sql`select l.id::int as id, l.code, l.state, l.road, l.order_id::int as "orderId", o.status as "orderStatus"
      from lead l left join sales_order o on o.id = l.order_id where l.id = ${id} for update of l`,
  );
  if (!lead) throw new Refusal(404, "not_found", "That enquiry doesn't exist.");
  return { ...lead, ordered: Boolean(lead.orderStatus && lead.orderStatus !== "cancelled") };
}

async function note(tx: Runner, leadId: number, me: Me, kind: string, message: string) {
  await tx.execute(
    sql`insert into lead_event (lead_id, kind, message, by_person) values (${leadId}, ${kind}, ${message}, ${me.id})`,
  );
  await tx.execute(sql`update lead set last_activity_at = now() where id = ${leadId}`);
}

async function agentOrNull(tx: Runner, id: number | null | undefined): Promise<number | null> {
  if (!id) return null;
  const [agent] = await rows<{ id: number }>(
    tx,
    sql`select id::int as id from person where id = ${id} and active and role in ('online', 'admin')`,
  );
  if (!agent) throw new Refusal(400, "invalid", "Pick someone on the Online desk.", "assignedTo");
  return agent.id;
}

/** A new enquiry, typed in by the agent (a call, a walk-in, a chat until Messenger connects). */
export async function addLead(db: Database, me: Me, input: LeadInput): Promise<number> {
  allow(me, LEAD_WORK_ROLES, "add an enquiry");
  const name = input.name.trim();
  if (!name) throw new Refusal(400, "invalid", "Type who is asking.", "name");
  if (input.road === "gl" && !input.agency)
    throw new Refusal(400, "invalid", "Pick the agency that gives the letter.", "agency");
  return db.transaction(async (tx) => {
    const assigned =
      input.assignedTo === undefined
        ? me.role === "online"
          ? me.id
          : null
        : await agentOrNull(tx, input.assignedTo);
    const self = !clean(input.relation) || clean(input.relation)?.toLowerCase() === "self";
    const [made] = await rows<{ id: number }>(
      tx,
      sql`insert into lead (source, name, relation, patient_name, phone, phone_key, email, city, address, road, agency, request, assigned_to, created_by, opened_at)
        values (${input.source}, ${name}, ${clean(input.relation)}, ${self ? name : (clean(input.patientName) ?? name)}, ${formatPhone(input.phone)}, ${phoneKey(input.phone)},
          ${clean(input.email)}, ${clean(input.city)}, ${clean(input.address)}, ${input.road ?? "regular"}, ${input.road === "gl" ? (input.agency ?? null) : null},
          ${clean(input.request)}, ${assigned}, ${me.id}, now())
        returning id::int as id`,
    );
    const id = made?.id as number;
    await tx.execute(
      sql`with next as (update counter set value = value + 1 where name = 'lead' returning value)
        update lead set code = 'ENQ-' || lpad(next.value::text, 5, '0') from next where lead.id = ${id}`,
    );
    await note(
      tx,
      id,
      me,
      "status",
      `Enquiry from ${SOURCE_LABEL[input.source]} added by ${me.name}.`,
    );
    return id;
  });
}

/** Who they are, how they pay, who works it. The road can't change once the order is placed. */
export async function saveLead(db: Database, me: Me, id: number, input: LeadInput): Promise<void> {
  allow(me, LEAD_WORK_ROLES, "change an enquiry");
  const name = input.name.trim();
  if (!name) throw new Refusal(400, "invalid", "Type who is asking.", "name");
  await db.transaction(async (tx) => {
    const lead = await lockLead(tx, id);
    if (lead.state === "lost")
      throw new Refusal(409, "not_now", `${lead.code} is closed. Reopen it first.`);
    const road = input.road ?? lead.road;
    if (road !== lead.road && lead.ordered)
      throw new Refusal(409, "not_now", "Locked: the order is placed with this road.", "road");
    if (road === "gl" && !input.agency)
      throw new Refusal(400, "invalid", "Pick the agency that gives the letter.", "agency");
    const assigned = await agentOrNull(tx, input.assignedTo);
    const self = !clean(input.relation) || clean(input.relation)?.toLowerCase() === "self";
    await tx.execute(
      sql`update lead set source = ${input.source}, name = ${name}, relation = ${clean(input.relation)},
          patient_name = ${self ? name : (clean(input.patientName) ?? name)}, phone = ${formatPhone(input.phone)}, phone_key = ${phoneKey(input.phone)},
          email = ${clean(input.email)}, city = ${clean(input.city)}, address = ${clean(input.address)}, road = ${road},
          agency = ${road === "gl" ? (input.agency ?? null) : null}, request = ${clean(input.request)}, assigned_to = ${assigned},
          points_to_use = case when ${road} = 'regular' then points_to_use else 0 end
        where id = ${id}`,
    );
    const roadWords = {
      regular: "Regular",
      senior: "Senior citizen",
      pwd: "PWD",
      gl: "Guarantee letter",
    };
    await note(
      tx,
      id,
      me,
      "status",
      road !== lead.road
        ? `Details saved. Pays by: ${roadWords[road]} (was ${roadWords[lead.road]}).`
        : "Details saved.",
    );
  });
}

/** The quotation: catalogue medicines at the patient price; a lower price needs its reason. */
export async function saveQuote(
  db: Database,
  me: Me,
  id: number,
  input: QuoteInput,
): Promise<void> {
  allow(me, LEAD_WORK_ROLES, "make a quotation");
  if (input.lines.length === 0)
    throw new Refusal(400, "invalid", "Add at least one medicine.", "lines");
  const ids = [...new Set(input.lines.map((line) => line.medicineId))];
  if (ids.length !== input.lines.length)
    throw new Refusal(
      400,
      "invalid",
      "A medicine is on the quotation twice. Put it on one line.",
      "lines",
    );
  const medicines = await rows<{
    id: number;
    name: string;
    vat: Vat;
    rx: boolean;
    packSize: number;
    price: number | null;
  }>(
    db,
    sql`select m.id::int as id, m.name || coalesce(' ' || m.strength, '') as name, m.vat, m.rx, m.pack_size::int as "packSize",
        (select amount::int from medicine_price p where p.medicine_id = m.id and p.buyer_type = 'patient') as price
      from medicine m where m.active and m.id in (${sql.join(
        ids.map((value) => sql`${value}`),
        sql`, `,
      )})`,
  );
  const lines: QuoteLine[] = input.lines.map((line, index) => {
    const medicine = medicines.find((row) => row.id === line.medicineId);
    if (!medicine)
      throw new Refusal(
        400,
        "invalid",
        "That medicine isn't in the list any more.",
        `lines.${index}.medicineId`,
      );
    if (medicine.price === null)
      throw new Refusal(
        400,
        "invalid",
        `${medicine.name} has no patient price yet. Ask Inventory to set one.`,
        `lines.${index}.medicineId`,
      );
    if (!Number.isInteger(line.qty) || line.qty <= 0)
      throw new Refusal(400, "invalid", "Type how many.", `lines.${index}.qty`);
    const unitPrice = line.unitPrice ?? medicine.price;
    const reason = clean(line.reason);
    if (unitPrice < medicine.price && !reason)
      throw new Refusal(
        400,
        "invalid",
        `Say why ${medicine.name} is below the patient price.`,
        `lines.${index}.reason`,
      );
    return {
      medicineId: medicine.id,
      medicine: medicine.name,
      qty: line.qty,
      packSize: medicine.packSize,
      listPrice: medicine.price,
      unitPrice,
      reason: unitPrice < medicine.price ? reason : null,
      vat: medicine.vat,
      rx: medicine.rx,
    };
  });
  await db.transaction(async (tx) => {
    const lead = await lockLead(tx, id);
    if (lead.state === "lost")
      throw new Refusal(409, "not_now", `${lead.code} is closed. Reopen it first.`);
    if (lead.ordered)
      throw new Refusal(409, "not_now", "The order is placed: its medicines are on the order now.");
    const [now] = await rows<{ road: LeadRoad; agency: string | null }>(
      tx,
      sql`select road, agency from lead where id = ${id}`,
    );
    const road = now?.road ?? "regular";
    if (road === "gl" && !now?.agency)
      throw new Refusal(
        400,
        "invalid",
        "Pick the agency first: the quotation is made for it.",
        "agency",
      );
    await tx.execute(
      sql`update lead set quote_lines = ${JSON.stringify(lines)}::jsonb, quote_road = ${road}, quote_agency = ${now?.agency ?? null}, quote_saved_at = now(),
          quote_sent_via = null, quote_sent_at = null where id = ${id}`,
    );
    const totals = quoteTotals(lines, road);
    await note(
      tx,
      id,
      me,
      "quote",
      `Quotation saved: ${lines.map((line) => `${line.medicine} × ${line.qty.toLocaleString("en-PH")}`).join(", ")}. ${peso(totals.subtotal)}${totals.relief ? `; ${peso(totals.total)} after no VAT and 20% off` : ""}.`,
    );
  });
}

const SENT_VIA = ["messenger", "sms", "viber", "whatsapp", "email", "printed"];
export async function quoteSent(db: Database, me: Me, id: number, via: string): Promise<void> {
  allow(me, LEAD_WORK_ROLES, "send a quotation");
  if (!SENT_VIA.includes(via)) throw new Refusal(400, "invalid", "Say how it was sent.", "via");
  await db.transaction(async (tx) => {
    const lead = await lockLead(tx, id);
    const [saved] = await rows<{ n: number }>(
      tx,
      sql`select jsonb_array_length(quote_lines)::int as n from lead where id = ${id}`,
    );
    if (!saved?.n) throw new Refusal(409, "not_now", "Save the quotation first.");
    await tx.execute(
      sql`update lead set quote_sent_via = ${via}, quote_sent_at = now() where id = ${id}`,
    );
    await note(
      tx,
      id,
      me,
      "quote",
      `Quotation sent by ${via === "sms" ? "SMS" : via}. (${lead.code})`,
    );
  });
}

/** The guarantee letter's road: the application, the letter, its check. */
export async function saveGl(db: Database, me: Me, id: number, input: GlInput): Promise<void> {
  allow(me, LEAD_WORK_ROLES, "record a guarantee letter");
  const today = todayManila();
  for (const [field, value] of [
    ["appliedOn", input.appliedOn],
    ["letterOn", input.letterOn],
  ] as const)
    if (value && value > today)
      throw new Refusal(400, "invalid", "That day hasn't come yet.", field);
  await db.transaction(async (tx) => {
    const lead = await lockLead(tx, id);
    if (lead.road !== "gl")
      throw new Refusal(409, "not_now", "This case doesn't pay by a guarantee letter.");
    if (lead.ordered) throw new Refusal(409, "not_now", "The order is placed with this letter.");
    const [before] = await rows<{ letters: number; verified: boolean }>(
      tx,
      sql`select (select count(*) from lead_file where lead_id = ${id} and kind = 'gl_letter' and active)::int as letters, gl_verified_at is not null as verified from lead where id = ${id}`,
    );
    if (input.verify) {
      if (!clean(input.letterNo))
        throw new Refusal(
          400,
          "invalid",
          "Type the letter's number before marking it verified.",
          "letterNo",
        );
      if (!before?.letters)
        throw new Refusal(
          400,
          "invalid",
          "File the photo of the letter before marking it verified.",
          "verify",
        );
      if (!input.amount)
        throw new Refusal(400, "invalid", "Type the amount the letter grants.", "amount");
    }
    await tx.execute(
      sql`update lead set gl_applied_on = ${input.appliedOn ?? null}::date, gl_letter_no = ${clean(input.letterNo)}, gl_amount = ${input.amount ?? null},
          gl_letter_on = ${input.letterOn ?? null}::date,
          gl_verified_at = ${input.verify ? sql`coalesce(gl_verified_at, now())` : null}, gl_verified_by = ${input.verify ? me.id : null}
        where id = ${id}`,
    );
    const said = [
      input.appliedOn ? `applied on ${input.appliedOn}` : null,
      clean(input.letterNo) ? `letter ${clean(input.letterNo)}` : null,
      input.amount ? `for ${peso(input.amount)}` : null,
      input.verify ? "verified" : before?.verified ? "no longer verified" : null,
    ].filter(Boolean);
    await note(tx, id, me, "gl", `Guarantee letter: ${said.join(", ") || "cleared"}.`);
  });
}

// ---------------------------------------------------------------- papers

export async function addLeadFile(
  db: Database,
  me: Me,
  leadId: number,
  file: { kind: string; name: string; mime: string; bytes: Uint8Array },
): Promise<number> {
  allow(me, LEAD_WORK_ROLES, "file a paper");
  if (!PAPER_KINDS.includes(file.kind as LeadPaperKind) || file.kind === "unsorted")
    throw new Refusal(400, "invalid", "Say what the paper is.", "kind");
  if (!FILE_TYPES.includes(file.mime))
    throw new Refusal(400, "invalid", "Attach a photo or a PDF.", "file");
  if (file.bytes.byteLength === 0) throw new Refusal(400, "invalid", "That file is empty.", "file");
  if (file.bytes.byteLength > LEAD_FILE_MAX_BYTES)
    throw new Refusal(400, "invalid", "That file is over 10 MB. Take the photo again.", "file");
  const name = file.name.trim().slice(0, 120) || "paper";
  return db.transaction(async (tx) => {
    const lead = await lockLead(tx, leadId);
    if (lead.state === "lost")
      throw new Refusal(409, "not_now", `${lead.code} is closed. Reopen it first.`);
    const [made] = await rows<{ id: number }>(
      tx,
      sql`insert into lead_file (lead_id, kind, name, mime, size, data, by_person)
        values (${leadId}, ${file.kind}, ${name}, ${file.mime}, ${file.bytes.byteLength}, ${Buffer.from(file.bytes)}, ${me.id}) returning id::int as id`,
    );
    await note(
      tx,
      leadId,
      me,
      "paper",
      `${PAPER_LABEL[file.kind as LeadPaperKind]} filed (${name}).`,
    );
    return made?.id as number;
  });
}

export async function readLeadFile(
  db: Database,
  me: Me,
  fileId: number,
): Promise<{ name: string; mime: string; bytes: Uint8Array }> {
  allow(me, LEAD_READ_ROLES, "see a case's papers");
  const [file] = await rows<{ name: string; mime: string; data: Uint8Array }>(
    db,
    sql`select name, mime, data from lead_file where id = ${fileId} and active`,
  );
  if (!file) throw new Refusal(404, "not_found", "That paper isn't there any more.");
  return { name: file.name, mime: file.mime, bytes: file.data };
}

export async function removeLeadFile(db: Database, me: Me, fileId: number): Promise<void> {
  allow(me, LEAD_WORK_ROLES, "take a paper off");
  await db.transaction(async (tx) => {
    const [file] = await rows<{ leadId: number; kind: LeadPaperKind; name: string }>(
      tx,
      sql`select lead_id::int as "leadId", kind, name from lead_file where id = ${fileId} and active for update`,
    );
    if (!file) throw new Refusal(404, "not_found", "That paper isn't there any more.");
    const lead = await lockLead(tx, file.leadId);
    if (lead.ordered)
      throw new Refusal(409, "not_now", "The order is placed with these papers: they stay.");
    await tx.execute(sql`update lead_file set active = false where id = ${fileId}`);
    await note(tx, file.leadId, me, "paper", `${PAPER_LABEL[file.kind]} taken off (${file.name}).`);
  });
}

// ---------------------------------------------------------------- notes, closing

export async function addLeadNote(
  db: Database,
  me: Me,
  id: number,
  message: string,
): Promise<void> {
  allow(me, LEAD_WORK_ROLES, "write on a case");
  const text = message.trim();
  if (!text) throw new Refusal(400, "invalid", "Type the note.", "message");
  await db.transaction(async (tx) => {
    await lockLead(tx, id);
    await note(tx, id, me, "note", text);
  });
}

export async function closeLead(
  db: Database,
  me: Me,
  id: number,
  reason: string | null,
): Promise<void> {
  allow(me, LEAD_WORK_ROLES, "close a case");
  const why = clean(reason);
  if (!why) throw new Refusal(400, "invalid", "Say why it is lost.", "reason");
  await db.transaction(async (tx) => {
    const lead = await lockLead(tx, id);
    if (lead.state === "lost") return;
    if (lead.ordered)
      throw new Refusal(
        409,
        "not_now",
        "The order is placed. Cancel the order first if it isn't going ahead.",
      );
    await tx.execute(sql`update lead set state = 'lost', lost_reason = ${why} where id = ${id}`);
    await note(tx, id, me, "status", `Closed as lost: ${why}.`);
  });
}

export async function reopenLead(db: Database, me: Me, id: number): Promise<void> {
  allow(me, LEAD_WORK_ROLES, "reopen a case");
  await db.transaction(async (tx) => {
    const lead = await lockLead(tx, id);
    if (lead.state !== "lost") return;
    await tx.execute(sql`update lead set state = 'open', lost_reason = null where id = ${id}`);
    await note(tx, id, me, "status", "Reopened.");
  });
}

// ---------------------------------------------------------------- the order

const ORDER_PAPER: Record<LeadPaperKind, string> = {
  rx: "prescription",
  gl_letter: "gl",
  osca_id: "other",
  pwd_id: "other",
  pwd_booklet: "other",
  valid_id: "other",
  med_cert: "other",
  other: "other",
  unsorted: "other",
};

/** The patient on file for a case: linked, else found by the number, else added now. */
async function patientOf(db: Database, me: Me, id: number): Promise<number> {
  return db.transaction(async (tx) => {
    const [lead] = await rows<{
      customerId: number | null;
      name: string;
      patient: string | null;
      phone: string | null;
      key: string | null;
      email: string | null;
      city: string | null;
      address: string | null;
    }>(
      tx,
      sql`select customer_id::int as "customerId", name, patient_name as patient, phone, phone_key as key, email, city, address from lead where id = ${id} for update`,
    );
    if (!lead) throw new Refusal(404, "not_found", "That enquiry doesn't exist.");
    if (lead.customerId) return lead.customerId;
    const patient = lead.patient ?? lead.name;
    const [found] = lead.key
      ? await rows<{ id: number }>(
          tx,
          sql`select id::int as id from customer where active and kind = 'patient' and phone_key = ${lead.key}
            order by (lower(name) = ${patient.toLowerCase()}) desc, id limit 1`,
        )
      : [];
    let customerId = found?.id;
    if (!customerId) {
      const [made] = await rows<{ id: number }>(
        tx,
        sql`insert into customer (kind, name, phone, phone_key, email, address, city, payment_terms, review, added_by)
          values ('patient', ${patient}, ${lead.phone}, ${lead.key}, ${lead.email}, ${lead.address}, ${lead.city}, 'advance', 'to_review', ${me.id})
          returning id::int as id`,
      );
      customerId = made?.id as number;
      await tx.execute(
        sql`update customer set code = 'CUS-' || lpad(id::text, 5, '0') where id = ${customerId}`,
      );
    }
    await tx.execute(sql`update lead set customer_id = ${customerId} where id = ${id}`);
    await note(
      tx,
      id,
      me,
      "status",
      found ? `${patient} is already a customer: linked.` : `${patient} added as a customer.`,
    );
    return customerId;
  });
}

/** Places the case's order on the same line as a MedRep's. A patient pays cash on delivery or in advance (Finance then checks the
 *  proof); a guarantee letter's order is billed to the agency. */
export async function orderFromLead(
  db: Database,
  me: Me,
  id: number,
  pay?: "cod" | "advance" | null,
  toManagement = false,
): Promise<number> {
  allow(me, LEAD_WORK_ROLES, "place an order");
  const row = await readLead(db, id);
  const facts = factsOf(row);
  const step = roadStepOf(facts);
  if (row.state === "lost")
    throw new Refusal(409, "not_now", `${row.code} is closed. Reopen it first.`);
  if (row.orderStatus && row.orderStatus !== "cancelled")
    throw new Refusal(409, "not_now", `The order ${row.orderCode} is already placed.`);
  if (step !== "ready")
    throw new Refusal(
      409,
      "not_ready",
      `Not ready to order: ${nextOf(facts, step).toLowerCase()}.`,
    );
  // A website order comes with how the customer chose to pay, and its delivery fee.
  const website = await websiteTerms(db, id);
  const paying = pay ?? website?.pay ?? null;
  if (row.road !== "gl" && paying !== "cod" && paying !== "advance")
    throw new Refusal(
      400,
      "invalid",
      "Say how they pay: cash on delivery or paid in advance.",
      "pay",
    );
  const customerId = await patientOf(db, me, id);
  const relief = row.road === "senior" || row.road === "pwd";
  const law =
    row.road === "senior"
      ? "Senior citizen: 20% off and no VAT (RA 9994)"
      : "PWD: 20% off and no VAT (RA 10754)";
  return placeOrder(
    db,
    me,
    {
      customerId,
      items: row.quoteLines.map((line) => ({
        medicineId: line.medicineId,
        qty: line.qty,
        priceKind: "patient",
        unitPrice: relief ? reliefPrice(line.unitPrice, line.vat) : line.unitPrice,
        reason: relief ? (line.reason ? `${law} · ${line.reason}` : law) : line.reason,
      })),
      deliveryAddress: [row.address, row.city].filter(Boolean).join(", ") || null,
      receiver: row.patientName ?? row.name,
      receiverPhone: row.phone,
      note: `Online enquiry ${row.code} (${SOURCE_LABEL[row.source]})${row.road === "gl" && row.glLetterNo ? ` · GL ${row.glLetterNo}` : ""}`,
    },
    {
      // A guarantee letter's order is paid by the agency on its claim: billed, not paid first.
      terms:
        row.road === "gl"
          ? { terms: "days", days: 60 }
          : { terms: paying === "cod" ? "cod" : "advance", days: null },
      deliveryFee: website?.deliveryFee ?? 0,
      relief,
      leadId: id,
      toManagement,
      inside: async (tx, orderId) => {
        // The points the agent chose come off the medicines (checked again against the balance now).
        // Points the customer used at the website's checkout were taken then; else the agent's choice.
        const fromWebsite = await useWebsiteReservation(tx, id, orderId);
        if (!fromWebsite && row.road === "regular" && row.pointsToUse > 0)
          await spendOnOrder(tx, me, orderId, row.pointsToUse);
        await tx.execute(
          sql`insert into order_file (order_id, kind, name, mime, size, data, by_person)
            select ${orderId}, case f.kind ${sql.raw(
              Object.entries(ORDER_PAPER)
                .map(([kind, as]) => `when '${kind}' then '${as}'`)
                .join(" "),
            )} end, f.name, f.mime, f.size, f.data, ${me.id}
            from lead_file f where f.lead_id = ${id} and f.active and f.kind <> 'unsorted'`,
        );
        const [code] = await rows<{ code: string }>(
          tx,
          sql`select code from sales_order where id = ${orderId}`,
        );
        await tx.execute(
          sql`update lead set order_id = ${orderId}, last_activity_at = now() where id = ${id}`,
        );
        await logEvent(
          tx,
          orderId,
          me,
          "paper",
          `From the Online enquiry ${row.code}: its papers came with it.`,
        );
        // Where it goes next is the order line's (routeOrder): Management only for a discount,
        // credit or a business buyer to check; else straight to Dispatch with its invoice.
        const checks = await caseOrderChecks(tx, orderId);
        const where =
          checks.length > 0
            ? `Management checks it first (${checks.map((check) => check.short.toLowerCase()).join(", ")})`
            : toManagement
              ? "sent to Management to check"
              : "it goes to Dispatch";
        await tx.execute(
          sql`insert into lead_event (lead_id, kind, message, by_person) values (${id}, 'status', ${`Order ${code?.code} placed: ${where}.`}, ${me.id})`,
        );
      },
    },
  );
}
