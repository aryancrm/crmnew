// Orders: placing one, what Management does with it, and the lists and figures its screens
// show. Every change is one transaction that also writes the order's timeline.

import { peopleUnder, seatsUnder } from "../org/scope";
import { bytesOf, keepFile } from "../files/store";
import { type SQL, sql } from "drizzle-orm";
import { customerDetail, missingOf } from "../customers/service";
import { type Database, rows } from "../db/index";
import { dispatchCounts, putBack } from "../dispatch/service";
import {
  cancelInvoiceOf,
  clearCaseOrder,
  invoiceOnApproval,
  refreshInvoice,
  financeCounts,
  moneyOf,
  ownDues,
  orderMoney,
} from "../finance/service";
import { Refusal } from "../http";
import { buyerLabel, todayManila } from "../inventory/rules";
import { clean, day, iso, PROMISED_ORDER, type Runner, warehouses } from "../inventory/service";
import { notify } from "../notify/service";
import { reliefPrice, SOURCE_LABEL } from "../online/rules";
import { inForce } from "../org/service";
import { ROLE_LABEL, type Role } from "../people/roles";
import { releaseOrderPoints } from "../points/service";
import { releaseReservationOf } from "../points/website";
import type {
  CustomerKind,
  CustomerPaperKind,
  BoardRep,
  BoardTab,
  Desk,
  HoldRole,
  Me,
  MyOrderStage,
  MyOrders,
  OrderAction,
  OrderBoard,
  OrderCard,
  OrderChecks,
  OrderDashboard,
  OrderDetail,
  OrderDetailsInput,
  OrderFinding,
  OrderForList,
  OrderInput,
  OrderList,
  OrderPaper,
  OrderPick,
  OrderRelief,
  OrderVersion,
  OrderRevision,
  OrderRow,
  OrderStage,
  OrderStatus,
  PaperKind,
  PaymentTerms,
  Vat,
} from "../types";
import { stuckNow } from "./clock";
import { DIVISIONS, divisionOf, divisionRule, divisionsOf, isPatientType, subDivisionOfArea, termsOfLabel } from "./divisions";
import { logEvent, peso } from "./events";
import {
  DESK_HOME,
  DESK_TABS,
  FINANCE_STATUSES,
  afterApproval,
  holder,
  INVOICE_FROM_LABEL,
  mayAddPaper,
  NEVER_STUCK,
  NEXT_OF,
  ORDER_ALL_ROLES,
  ORDER_MANAGE_ROLES,
  resumeChoices,
  orderActions,
  orderCan,
  PAPER_KINDS,
  PAPER_LABEL,
  paperList,
  STAGES,
  STATUS_GROUPS,
  STATUS_LABEL,
  STATUSES,
  STEP_OF,
} from "./rules";
import { customerCredit } from "../finance/credit";
import { FINANCE_ROLES } from "../finance/rules";
import { asksOf, leadsUp } from "./asks";
import { duesSql } from "../finance/dues";
import { activeOffers, withOfferLines } from "./offers";
import { shortLines, shortWords } from "./stock-wait";

const PAGE = 25;
const list = (values: readonly string[]): SQL =>
  sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  );

/** The person and everyone under them, for a team lead's or manager's view. */
const team = (me: Me): SQL => sql`
  with recursive team as (
    select id from person where id = ${me.id}
    union all
    select p.id from person p join team t on p.reports_to = t.id
  )`;

/** Is the order (alias `o`) one of the team's for this lead: its MedRep is under them at any
 *  depth. Never for anyone but a team lead or a manager. */
export const inTeamSql = (me: Me): SQL =>
  me.role === "team_lead" || me.role === "manager"
    ? sql`(o.medrep_id in (with recursive under as (select id from person where reports_to = ${me.id}
        union all select p.id from person p join under u on p.reports_to = u.id) select id from under))`
    : sql`false`;

/** Is the order (alias `o`) in this Management person's approval scope (Admin → Who approves
 *  what): every division, or only theirs; an order with no division only for "everything". */
export const inApprovalScopeSql = (me: Me): SQL =>
  me.role === "management"
    ? sql`(select p.approves is null or coalesce(o.division = any(p.approves), false) from person p where p.id = ${me.id})`
    : sql`true`;

/** Which orders (alias `o`) this person may see. Needs `team` in front of the query. With a box
 *  picked on the team switch (checked to be theirs): the orders sold from its seats and under it. */
function seen(me: Me): SQL {
  if (me.unit)
    return sql`(o.seat_id in ${seatsUnder(me.unit)} or (o.seat_id is null and o.medrep_id in ${peopleUnder(me.unit)}))`;
  if (ORDER_ALL_ROLES.includes(me.role)) return sql`true`;
  // A lead also sees what was sold from any seat under them, by someone who has moved on too.
  if (me.role === "team_lead" || me.role === "manager")
    return sql`(o.medrep_id in (select id from team) or o.raised_by in (select id from team)
      or o.seat_id in (select s.id from seat s where s.boss_id in (select id from team)))`;
  // The Online desk works every case's order, whoever on it placed it.
  if (me.role === "online")
    return sql`(o.medrep_id = ${me.id} or o.raised_by = ${me.id} or o.lead_id is not null)`;
  // A MedRep also sees what was sold from the seat they sit in or cover, before their time too.
  return sql`(o.medrep_id = ${me.id} or o.raised_by = ${me.id} or o.seat_id in (select h.seat_id from seat_holder h
    where h.person_id = ${me.id} and ${inForce("h", todayManila())}))`;
}

/** May this person read this order (their own, their team's, a case's for the Online desk, any for
 *  the desks that see every order)? Used to open an order's invoice from the order. */
export async function mayReadOrder(db: Database, me: Me, orderId: number): Promise<boolean> {
  const [found] = await rows<{ id: number }>(
    db,
    sql`${team(me)} select o.id::int as id from sales_order o where o.id = ${orderId} and ${seen(me)}`,
  );
  return Boolean(found);
}

/** Orders this person may read whose code or customer PO holds the text (the search box). */
export async function findOrders(
  db: Database,
  me: Me,
  like: string,
): Promise<{ id: number; code: string; customer: string; status: string }[]> {
  const found = await rows<{ id: number; code: string; customer: string; status: OrderStatus }>(
    db,
    sql`${team(me)} select o.id::int as id, o.code, c.name as customer, o.status
      from sales_order o join customer c on c.id = o.customer_id
      where (o.code ilike ${like} or o.customer_po ilike ${like}) and ${seen(me)}
      order by o.created_at desc limit 6`,
  );
  return found.map((row) => ({ ...row, status: STATUS_LABEL[row.status] }));
}

/** The Online case an order came from (alias `o`): its code and where it came in (Messenger, a
 *  website, a call…), so every desk sees "Online · Messenger" on the order. */
const viaSql = sql.raw(`(select jsonb_build_object('code', l.code, 'source', coalesce(site.name, case l.source ${Object.entries(
  SOURCE_LABEL,
)
  .map(([key, label]) => `when '${key}' then '${label.replace(/'/g, "''")}'`)
  .join(" ")} else l.source end))
  from lead l left join channel_account site on site.id = l.site_account_id where l.id = o.lead_id)`);

const rowColumns = sql`
  o.id::int as id, o.code, o.customer_id::int as "customerId", c.name as customer, rep.name as medrep,
  o.status, (o.payment_terms = 'days') as credit, o.total::int as total, o.delivery_fee::int as "deliveryFee", o.points_used::int as "pointsUsed",
  ${iso("o.created_at")} as "createdAt", ${iso("o.updated_at")} as "updatedAt", o.flag_reason as "flagReason",
  o.patient_order as "patientOrder", o.patient_name as "patientName", o.note, o.order_type as "orderType", o.division,
  exists (select 1 from order_version v where v.order_id = o.id and v.kind = 'changed') as changed, ${viaSql} as via`;

/** The channel an order shows (Aryan, 22 Nov: one list of channels, the target sheet's): its
 *  Division, which is the sheet's channel of the seat it was placed from (CLIDP, MD Telesales, RX
 *  Business…); a PAP order keeps PAP (the sheet has no PAP row); an older order with no Division
 *  its first channel's code. Screens are still decided by the seat, never by this word. */
const SHOWN_CHANNEL = sql`(case when ch.code = 'PAP' then ch.code else coalesce(o.division, ch.code) end)`;

const rowJoins = sql`
  join customer c on c.id = o.customer_id
  join person rep on rep.id = o.medrep_id`;

const labelled = <T extends { status: OrderStatus }>(row: T) => ({
  ...row,
  statusLabel: STATUS_LABEL[row.status],
});

/** How long Management may take back an approval given by mistake. */
export const TAKE_BACK_MINUTES = 30;
/** An approval (alias `o`) Management can still take back: given by a person (not the system),
 *  under 30 minutes ago, while the next desk hasn't done anything with it: Finance hasn't checked
 *  the payment or made the invoice itself, no money is on its invoice, Dispatch hasn't packed. */
const takeBackSql = sql`(o.approved_by is not null
  and o.approved_at > now() - make_interval(mins => ${TAKE_BACK_MINUTES})
  and o.status in ('finance_check', 'ready_for_invoice', 'ready_for_dispatch')
  and not exists (select 1 from order_event e where e.order_id = o.id and e.at >= o.approved_at
    and (e.stage in ('finance_verified', 'paid', 'packed', 'shipped', 'delivered', 'completed')
      or (e.stage = 'invoiced' and e.by_person <> o.approved_by)))
  and not exists (select 1 from invoice i where i.order_id = o.id and i.status <> 'cancelled'
    and i.paid > (select coalesce(sum(pp.amount), 0) from payment pp where pp.invoice_id = i.id and pp.active and pp.method in ('points', 'withholding', 'credit', 'deduction'))))`;
/** A cancelled order (alias `o`) Management can bring back (the hub's Restore): no money given
 *  back on it, no points (they went back to the customer), not an Online or PAP case's (its case
 *  places its next order itself). */
const restorableSql = sql`(o.status = 'cancelled' and o.lead_id is null and coalesce(o.points_used, 0) = 0
  and not exists (select 1 from invoice i where i.order_id = o.id and i.refunded > 0)
  and not exists (select 1 from sales_return r where r.order_id = o.id)
  and not exists (select 1 from lead l where l.order_id = o.id)
  and not exists (select 1 from channel ch where ch.id = o.channel_id and ch.code = 'PAP'))`;
/** Not yet with Dispatch: waiting for Management or Finance, or stopped before Dispatch. */
const beforeDispatch = (order: { status: OrderStatus; heldFrom: OrderStatus | null }) =>
  ["pending_approval", "finance_check", "ready_for_invoice"].includes(order.status) ||
  ((order.status === "on_hold" || order.status === "exception") &&
    (!order.heldFrom || ["pending_approval", "finance_check", "ready_for_invoice"].includes(order.heldFrom)));
/** Money is on the order's invoice (alias `o`): points paid on it as it was made don't count. */
const paidInSql = sql`exists (select 1 from invoice i where i.order_id = o.id and i.status <> 'cancelled'
  and i.paid > (select coalesce(sum(pp.amount), 0) from payment pp where pp.invoice_id = i.id and pp.active and pp.method in ('points', 'withholding', 'credit', 'deduction')))`;
/** Sent back to the MedRep (alias `o`): its last reason, who sent it, the MedRep's answer. */
const sentBackColumns = sql`o.sent_back_count::int as "sentBackCount", o.sent_back_reason as "sentBackReason",
  (select p.name from person p where p.id = o.sent_back_by) as "sentBackBy", o.reply`;

// ---------------------------------------------------------------- reading

export type OrderFilter = {
  status?: string;
  /** One of the dashboard's tile groups, or "flagged" (on hold and exception). */
  group?: string;
  q?: string;
  medrep?: number;
  from?: string;
  to?: string;
  stuck?: boolean;
  page?: number;
};

function filterOf(me: Me, filter: OrderFilter): SQL {
  const conditions: SQL[] = [seen(me)];
  if (filter.status && STATUSES.includes(filter.status as OrderStatus))
    conditions.push(sql`o.status = ${filter.status}`);
  const group =
    filter.group === "flagged"
      ? ["on_hold", "exception"]
      : STATUS_GROUPS[filter.group as keyof typeof STATUS_GROUPS];
  if (group) conditions.push(sql`o.status in (${list(group)})`);
  if (filter.stuck) conditions.push(sql`o.status not in (${list(NEVER_STUCK)}) and ${stuckNow()}`);
  if (filter.medrep) conditions.push(sql`o.medrep_id = ${filter.medrep}`);
  if (filter.from)
    conditions.push(sql`(o.created_at at time zone 'Asia/Manila')::date >= ${filter.from}::date`);
  if (filter.to)
    conditions.push(sql`(o.created_at at time zone 'Asia/Manila')::date <= ${filter.to}::date`);
  for (const word of (filter.q ?? "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 5)) {
    const like = `%${word.replace(/[%_\\]/g, "\\$&")}%`;
    conditions.push(
      sql`(lower(o.code) like ${like} or lower(c.name) like ${like} or lower(rep.name) like ${like})`,
    );
  }
  return sql.join(conditions, sql` and `);
}

export async function listOrders(db: Database, me: Me, filter: OrderFilter): Promise<OrderList> {
  const page = Math.max(1, Math.floor(filter.page ?? 1) || 1);
  const where = filterOf(me, filter);
  const [found, counted, medreps] = await Promise.all([
    rows<Omit<OrderRow, "statusLabel">>(
      db,
      sql`${team(me)} select ${rowColumns} from sales_order o ${rowJoins}
        where ${where} order by o.created_at desc, o.id desc limit ${PAGE} offset ${(page - 1) * PAGE}`,
    ),
    rows<{ total: number; value: number }>(
      db,
      sql`${team(me)} select count(*)::int as total, coalesce(sum(o.total), 0)::float8 as value
        from sales_order o ${rowJoins} where ${where}`,
    ),
    rows<{ id: number; name: string }>(
      db,
      sql`${team(me)} select distinct rep.id::int as id, rep.name from sales_order o ${rowJoins}
        where ${seen(me)} order by rep.name`,
    ),
  ]);
  return {
    rows: found.map(labelled),
    total: counted[0]?.total ?? 0,
    totalValue: counted[0]?.value ?? 0,
    page,
    pageSize: PAGE,
    medreps,
    statuses: STATUSES.map((key) => ({ key, label: STATUS_LABEL[key] })),
    can: orderCan(me),
  };
}

export async function orderDashboard(db: Database, me: Me): Promise<OrderDashboard> {
  const [counts, figures, unchecked, money, dispatch, requests] = await Promise.all([
    rows<{ status: OrderStatus; n: number }>(
      db,
      sql`${team(me)} select o.status, count(*)::int as n from sales_order o where ${seen(me)} group by o.status`,
    ),
    rows<{ today: number; week: number; stuck: number; minutes: number | null }>(
      db,
      sql`${team(me)} select
          count(*) filter (where (o.created_at at time zone 'Asia/Manila')::date = (now() at time zone 'Asia/Manila')::date)::int as today,
          count(*) filter (where o.created_at >= now() - interval '7 days')::int as week,
          count(*) filter (where o.status not in (${list(NEVER_STUCK)}) and ${stuckNow()})::int as stuck,
          (percentile_cont(0.5) within group (order by extract(epoch from (o.updated_at - o.submitted_at)) / 60.0)
            filter (where o.status in ('shipped', 'completed') and o.submitted_at is not null))::float8 as minutes
        from sales_order o where ${seen(me)}`,
    ),
    orderCan(me).manage
      ? rows<{ n: number }>(
          db,
          sql`select count(*)::int as n from customer where active and review = 'to_review'`,
        )
      : Promise.resolve([]),
    financeCounts(db, me),
    dispatchCounts(db, me),
    ["inventory", "admin", "ceo"].includes(me.role)
      ? rows<{ n: number }>(
          db,
          sql`select count(*)::int as n from medicine_request where status = 'open'`,
        )
      : Promise.resolve([]),
  ]);
  const of = (...statuses: OrderStatus[]) =>
    counts.filter((row) => statuses.includes(row.status)).reduce((sum, row) => sum + row.n, 0);
  const figure = figures[0];
  return {
    can: orderCan(me),
    attention: {
      awaiting: of("pending_approval"),
      flagged: of("on_hold", "exception"),
      stuck: figure?.stuck ?? 0,
      customers: unchecked[0]?.n ?? 0,
      sentBack: of("draft"),
      requests: requests[0]?.n ?? 0,
      ...money,
      ...dispatch,
    },
    tiles: {
      today: figure?.today ?? 0,
      week: figure?.week ?? 0,
      pendingPayment: of(...STATUS_GROUPS.pendingPayment),
      readyForDispatch: of(...STATUS_GROUPS.readyForDispatch),
      inTransit: of(...STATUS_GROUPS.inTransit),
      exceptions: of(...STATUS_GROUPS.exceptions),
      processingMinutes: figure?.minutes == null ? null : Math.round(figure.minutes),
    },
    groups: STATUS_GROUPS,
    byStatus: STATUSES.map((key) => ({ key, label: STATUS_LABEL[key], count: of(key) }))
      .filter((row) => row.count > 0)
      .sort((a, b) => b.count - a.count),
    flaggedCounts: {
      onHold: of("on_hold"),
      exception: of("exception"),
      cancelled: of("cancelled"),
    },
  };
}

type ItemRow = OrderDetail["items"][number] & {
  orderId: number;
  /** The price the customer's own kind pays (a hospital's hospital price), if the list has one. */
  ownPrice: number | null;
  ownKind: string;
};

/** The lines of some orders, with what is sellable now. */
const itemsOf = (db: Runner, orderIds: number[]) =>
  orderIds.length === 0
    ? Promise.resolve([] as ItemRow[])
    : rows<ItemRow>(
        db,
        sql`select i.id::int as id, i.order_id::int as "orderId", i.medicine_id::int as "medicineId",
            m.name || coalesce(' ' || m.strength, '') as medicine, m.sku, m.unit, m.pack_size::int as "packSize",
            i.qty::int as qty, i.price_kind as "priceKind", i.list_price::int as "listPrice",
            i.unit_price::int as "unitPrice", i.price_reason as reason, (i.qty * i.unit_price)::int as amount, i.relief, m.vat, i.free, m.rx,
            i.offer_id::int as "offerId", m.cold_chain as cold, m.cold_box as "coldBox",
            -- Free for this order: sellable on the shelf, less what orders placed before it are
            -- promised and not packed yet (first placed, first served).
            greatest(0, coalesce((select sum(s.qty) from stock s join batch b on b.id = s.batch_id
              where b.medicine_id = i.medicine_id and b.expires_on >= (now() at time zone 'Asia/Manila')::date), 0)
              - case when so.status in ('packing', 'shipped', 'completed', 'cancelled', 'draft') then 0 else coalesce((select sum(oi.qty) from order_item oi join sales_order o on o.id = oi.order_id
                  where oi.medicine_id = i.medicine_id and o.id < i.order_id and ${PROMISED_ORDER}), 0) end)::int as "inStock",
            (select mp.amount::int from medicine_price mp where mp.medicine_id = i.medicine_id and mp.buyer_type = c.kind) as "ownPrice",
            c.kind as "ownKind",
            (select oi.unit_price::int from order_item oi join sales_order o2 on o2.id = oi.order_id
              where o2.customer_id = so.customer_id and oi.medicine_id = i.medicine_id and not oi.free
                and o2.id < i.order_id and o2.status not in ('draft', 'cancelled')
              order by o2.id desc, oi.id desc limit 1) as "lastPrice"
          from order_item i join medicine m on m.id = i.medicine_id
            join sales_order so on so.id = i.order_id join customer c on c.id = so.customer_id
          where i.order_id in (${sql.join(
            orderIds.map((id) => sql`${id}`),
            sql`, `,
          )})
          order by i.id`,
      ).then((found) =>
        found.map((item) => ({
          ...item,
          priceLabel:
            item.priceKind === "promo"
              ? "Promo"
              : item.priceKind === "offer"
                ? "Offer"
                : buyerLabel(item.priceKind),
        })),
      );

/** The kinds of papers on file for some orders. */
async function papersOf(db: Runner, orderIds: number[]): Promise<Map<number, PaperKind[]>> {
  if (orderIds.length === 0) return new Map();
  const found = await rows<{ orderId: number; kind: PaperKind }>(
    db,
    sql`select distinct order_id::int as "orderId", kind from order_file
      where active and hold_event_id is null and order_id in (${sql.join(
        orderIds.map((id) => sql`${id}`),
        sql`, `,
      )})`,
  );
  const byOrder = new Map<number, PaperKind[]>();
  for (const row of found)
    byOrder.set(row.orderId, [...(byOrder.get(row.orderId) ?? []), row.kind]);
  return byOrder;
}

type Money = { owed: number; overdue: number; days: number };

/** What the system found on an order: lower prices, short stock, a customer to look at, money
 *  the customer owes. `money` is left out once the order has its own invoice. */
function findingsOf(
  items: ItemRow[],
  customer: {
    review: string;
    licenceExpired: boolean;
    kind: string;
    terms: string;
    papers: PaperKind[];
    /** An order for one patient through a hospital or a doctor. */
    patientOrder?: boolean;
    /** What the MedRep wrote on the order: Management reads it before approving. */
    note?: string | null;
  },
  money?: { owes: Money | undefined; creditLimit: number | null; total: number },
): OrderFinding[] {
  const found: OrderFinding[] = [];
  const note = customer.note?.trim();
  if (note)
    found.push({
      kind: "note",
      short: "MedRep's note",
      decide: `read the MedRep's note: "${note.length > 80 ? `${note.slice(0, 80)}…` : note}"`,
      text: `The MedRep wrote: ${note}`,
    });
  // Stock is counted per medicine: a paid line and its free line come off the same shelf.
  const wanted = new Map<number, number>();
  for (const item of items) wanted.set(item.medicineId, (wanted.get(item.medicineId) ?? 0) + item.qty);
  const stockSaid = new Set<number>();
  // A patient's order (their own, or for them through a hospital): a prescription is required
  // whenever a patient buys (Aryan, 17 Nov), and Management checks it with the patient's ID.
  if (customer.kind === "patient" || customer.patientOrder) {
    if (!customer.papers.includes("prescription"))
      found.push({
        kind: "rx",
        short: "No prescription",
        decide: "a patient's order, no prescription attached",
        text: "A patient buys on it and no prescription is attached: it can't be approved without one",
      });
    if (!customer.papers.includes("valid_id") && !customer.papers.includes("senior_id"))
      found.push({
        kind: "rx",
        short: "No patient ID",
        decide: "the patient's ID isn't attached",
        text: "The patient's ID isn't attached",
      });
  }
  // The senior citizen's or PWD's price needs their ID on file (the law's condition), on any order.
  if (items.some((item) => item.relief) && !customer.papers.includes("senior_id"))
    found.push({
      kind: "rx",
      short: "No SC/PWD ID",
      decide: "sold at the senior citizen / PWD price, their ID isn't attached",
      text: "Sold at the senior citizen / PWD price (20% off, no VAT) and their senior citizen or PWD ID isn't attached",
    });
  for (const item of items) {
    // Free goods typed on the order (a sample) are Management's to agree to; an offer's free
    // pieces are the offer's (worked out by the system).
    if (item.free && !item.offerId)
      found.push({
        kind: "price",
        short: "Free goods",
        decide: `${item.medicine} × ${item.qty.toLocaleString("en-PH")} given free`,
        text: `Free: ${item.medicine} × ${item.qty.toLocaleString("en-PH")}${item.reason && item.reason !== "Free" ? ` (${item.reason})` : ""}`,
      });
    // A cold-chain box is priced by Management on each order (Aryan): no list to compare with.
    const priced = !item.free && !item.coldBox;
    // A senior citizen's or PWD's line is below the list by law; only lower than that is a finding.
    const floor = item.relief ? reliefPrice(item.listPrice, item.vat) : item.listPrice;
    if (priced && item.unitPrice < floor)
      found.push({
        kind: "price",
        short: `Below ${item.priceLabel.toLowerCase()} price`,
        decide: `${item.medicine} given at ${peso(item.unitPrice)}, ${item.priceLabel.toLowerCase()} price is ${peso(item.listPrice)}`,
        text: `${item.medicine}: given at ${peso(item.unitPrice)}, ${item.priceLabel} price is ${peso(item.listPrice)} (${peso((item.listPrice - item.unitPrice) * item.qty)} less in all)${item.reason ? `. Reason: ${item.reason}` : ""}`,
      });
    // Above the list: not wrong in itself, but Management sees every price that isn't the list's.
    if (priced && !item.relief && item.unitPrice > item.listPrice)
      found.push({
        kind: "price",
        short: `Above ${item.priceLabel.toLowerCase()} price`,
        decide: `${item.medicine} given at ${peso(item.unitPrice)}, ${item.priceLabel.toLowerCase()} price is ${peso(item.listPrice)}`,
        text: `${item.medicine}: given at ${peso(item.unitPrice)}, above the ${item.priceLabel} price of ${peso(item.listPrice)}${item.reason ? `. Reason: ${item.reason}` : ""}`,
      });
    // Priced as another kind of buyer, cheaper than this customer's own (a distributor's price
    // given to a hospital): Management sees it, whatever the reason typed.
    if (
      priced &&
      !item.relief &&
      item.priceKind !== "promo" &&
      // An offer's price was set in Inventory by those who set prices: not a question here.
      item.priceKind !== "offer" &&
      item.priceKind !== item.ownKind &&
      item.ownPrice != null &&
      item.unitPrice < item.ownPrice
    )
      found.push({
        kind: "price",
        short: `${item.priceLabel} price to a ${buyerLabel(item.ownKind).toLowerCase()}`,
        decide: `${item.medicine} priced as ${item.priceLabel.toLowerCase()} (${peso(item.unitPrice)}); a ${buyerLabel(item.ownKind).toLowerCase()} pays ${peso(item.ownPrice)}`,
        text: `${item.medicine}: the ${item.priceLabel.toLowerCase()} price (${peso(item.unitPrice)}) given to a ${buyerLabel(item.ownKind).toLowerCase()}, whose price is ${peso(item.ownPrice)} (${peso((item.ownPrice - item.unitPrice) * item.qty)} less in all)`,
      });
    // Priced as another kind of buyer, dearer than this customer's own (a hospital charged the
    // patient price): nothing said it, the price being "at list" of the list picked (23 Nov).
    if (
      priced &&
      !item.relief &&
      item.priceKind !== "promo" &&
      item.priceKind !== "offer" &&
      item.priceKind !== item.ownKind &&
      !(item.ownKind === "government" && item.priceKind === "bidding") &&
      item.ownPrice != null &&
      item.unitPrice > item.ownPrice
    )
      found.push({
        kind: "price",
        short: `${item.priceLabel} price to a ${buyerLabel(item.ownKind).toLowerCase()}`,
        decide: `${item.medicine} priced as ${item.priceLabel.toLowerCase()} (${peso(item.unitPrice)}); a ${buyerLabel(item.ownKind).toLowerCase()} pays ${peso(item.ownPrice)}`,
        text: `${item.medicine}: the ${item.priceLabel.toLowerCase()} price (${peso(item.unitPrice)}) charged to a ${buyerLabel(item.ownKind).toLowerCase()}, whose price is ${peso(item.ownPrice)} (${peso((item.unitPrice - item.ownPrice) * item.qty)} more in all)${item.reason ? `. Reason: ${item.reason}` : ""}`,
      });
    // Priced as another kind of buyer because Inventory has no price for this customer's own kind
    // (a drugstore given the hospital price): nothing to compare with, so Management looks (22 Nov).
    if (
      priced &&
      !item.relief &&
      item.priceKind !== "promo" &&
      item.priceKind !== "offer" &&
      item.priceKind !== item.ownKind &&
      // A government buyer's own price is the bidding price.
      !(item.ownKind === "government" && item.priceKind === "bidding") &&
      item.ownPrice == null
    )
      found.push({
        kind: "price",
        short: `No ${buyerLabel(item.ownKind).toLowerCase()} price set`,
        decide: `${item.medicine} has no ${buyerLabel(item.ownKind).toLowerCase()} price in Inventory; the ${item.priceLabel.toLowerCase()} price (${peso(item.unitPrice)}) was used`,
        text: `${item.medicine}: Inventory has no ${buyerLabel(item.ownKind).toLowerCase()} price, so the ${item.priceLabel.toLowerCase()} price (${peso(item.unitPrice)}) was given. Check it is right, or set the price in Inventory.`,
      });
    const need = wanted.get(item.medicineId) ?? item.qty;
    if (item.inStock < need && !stockSaid.has(item.medicineId)) {
      stockSaid.add(item.medicineId);
      found.push({
        kind: "stock",
        short: "Stock short",
        decide: `${item.medicine}: ${need.toLocaleString("en-PH")} ordered, ${item.inStock.toLocaleString("en-PH")} free (after earlier orders)`,
        text: `${item.medicine}: ${need.toLocaleString("en-PH")} ordered${need !== item.qty ? " (with the free ones)" : ""}, ${item.inStock.toLocaleString("en-PH")} free on the shelf after the orders placed before it`,
      });
    }
  }
  // A cold medicine goes in a styro box, which Management adds and prices (Aryan, 17 Nov).
  const cold = [...new Set(items.filter((item) => item.cold).map((item) => item.medicine))];
  if (cold.length > 0 && !items.some((item) => item.coldBox))
    found.push({
      kind: "stock",
      short: "No cold box",
      decide: `${cold.join(", ")} kept cold: add the styro box and its price`,
      text: `${cold.join(", ")} must be kept cold: no styro box on the order yet. Add the box and what the cold chain costs.`,
    });
  if (customer.review === "to_review")
    found.push({
      kind: "customer",
      short: "New customer",
      decide: "a new customer, details not checked yet",
      text: "New customer: Management hasn't checked its details yet",
    });
  if (customer.licenceExpired)
    found.push({
      kind: "licence",
      short: "Licence expired",
      decide: "the customer's licence has expired",
      text: "The customer's licence has expired",
    });
  if (customer.terms === "advance" && !customer.papers.includes("payment_proof"))
    found.push({
      kind: "papers",
      short: "No payment proof",
      decide: "pays in advance, no proof of payment yet",
      text: "Pays in advance, and no proof of payment is attached yet",
    });
  const owes = money?.owes;
  if (owes && owes.overdue > 0)
    found.push({
      kind: "owes",
      short: `Overdue ${owes.days} ${owes.days === 1 ? "day" : "days"}`,
      decide: `the customer has ${peso(owes.overdue)} overdue (${owes.days} days)`,
      text: `The customer owes ${peso(owes.owed)}, ${peso(owes.overdue)} of it overdue (the oldest by ${owes.days} days)`,
    });
  if (money && money.creditLimit !== null && (owes?.owed ?? 0) + money.total > money.creditLimit) {
    const after = (owes?.owed ?? 0) + money.total;
    found.push({
      kind: "credit",
      short: "Over credit limit",
      decide: `over the credit limit by ${peso(after - money.creditLimit)}`,
      text: `With this order the customer would owe ${peso(after)}, over the ${peso(money.creditLimit)} credit limit`,
    });
  }
  return found;
}

/** The kinds of finding Finance weighs: money, not prices or stock (Management decided those). */
const MONEY_FINDINGS: OrderFinding["kind"][] = ["owes", "credit", "papers"];

/** Everything the system finds on one order, and the facts the order line decides by. */
async function findingsOfOrder(db: Runner, orderId: number) {
  const [order] = await rows<{
    customerId: number;
    review: string;
    kind: string;
    terms: string;
    creditLimit: number | null;
    licenceExpired: boolean;
    total: number;
    gl: boolean;
    leadId: number | null;
    patientOrder: boolean;
    note: string | null;
  }>(
    db,
    sql`select o.customer_id::int as "customerId", c.review, c.kind, o.payment_terms as terms, c.credit_limit::int as "creditLimit", o.patient_order as "patientOrder", o.note,
        coalesce(c.licence_expires < (now() at time zone 'Asia/Manila')::date, false) as "licenceExpired", o.total::int as total,
        coalesce(l.road = 'gl', false) as gl, o.lead_id::int as "leadId"
      from sales_order o join customer c on c.id = o.customer_id left join lead l on l.id = o.lead_id where o.id = ${orderId}`,
  );
  if (!order) return null;
  const [items, papers, money] = await Promise.all([
    itemsOf(db, [orderId]),
    papersOf(db, [orderId]),
    moneyOf(db, [order.customerId]),
  ]);
  const found = findingsOf(
    items,
    {
      review: order.review,
      licenceExpired: order.licenceExpired,
      kind: order.kind,
      terms: order.terms,
      papers: papers.get(orderId) ?? [],
      patientOrder: order.patientOrder,
      // An Online case's order carries the case's label as its note, not anyone's words.
      note: order.leadId ? null : order.note,
    },
    { owes: money.get(order.customerId), creditLimit: order.creditLimit, total: order.total },
  );
  return { order, found };
}

/** What Management sees on an Online case's order (it approves every one, then Finance checks it). */
export async function caseOrderChecks(db: Runner, orderId: number): Promise<OrderFinding[]> {
  const read = await findingsOfOrder(db, orderId);
  return read ? read.found : [];
}

/**
 * Sends a just-placed order on along the order line. Every order placed by anyone but Management
 * goes to Management, then Finance (Management may switch Finance off on approving). The
 * Admin's own order too (Aryan, 22 Nov: nothing skips Management); its form's switch only says
 * whether Finance checks it. An Online case's order goes Management → Finance → Dispatch like
 * every other (Aryan, 18 Nov).
 */
export async function routeOrder(
  tx: Runner,
  me: Me,
  orderId: number,
  choice?: OrderChecks,
): Promise<"management" | "finance" | "dispatch"> {
  const read = await findingsOfOrder(tx, orderId);
  if (!read) return "management";
  const { order } = read;
  const fromCase = Boolean(order.leadId);
  const manager = ORDER_MANAGE_ROLES.includes(me.role);
  // Who checks an order is Management's call (Aryan, 17 Nov: MedRep → Management → Finance →
  // Dispatch). Anyone else's switch is not read: the API, not only the form, keeps the line.
  const allowed = manager || fromCase ? choice : undefined;
  const [kept] = await rows<{ finance: boolean }>(
    tx,
    sql`select finance_check as finance from sales_order where id = ${orderId}`,
  );
  // Every order goes to Finance after Management, an Online case's too (Aryan, 18 Nov: the Online
  // desk's work goes to Management and to Finance); only Management's own switch can leave it out.
  const financeStep = allowed && !fromCase ? allowed.finance : (kept?.finance ?? true);
  await tx.execute(
    sql`update sales_order set finance_check = ${financeStep} where id = ${orderId}`,
  );
  // Management approves every order that comes in, of every channel and of every placer, the
  // Admin's own too (Aryan, 22 Nov: "nothing skips Management").
  return "management";
}

/** The orders waiting for Management, the longest wait first, each with what the system found. */
export async function approvalQueue(db: Database, me: Me): Promise<OrderRow[]> {
  const waiting = await rows<
    Omit<OrderRow, "statusLabel"> & {
      review: string;
      licenceExpired: boolean;
      kind: string;
      terms: string;
      creditLimit: number | null;
      leadId: number | null;
      gl: boolean;
    }
  >(
    db,
    sql`${team(me)} select ${rowColumns}, c.review, c.kind, o.payment_terms as terms, c.credit_limit::int as "creditLimit",
        coalesce(c.licence_expires < (now() at time zone 'Asia/Manila')::date, false) as "licenceExpired", ${caseColumns}
      from sales_order o ${rowJoins}
      where ${seen(me)} and o.status = 'pending_approval' and ${inApprovalScopeSql(me)}
        and (${approverSql} is null or ${approverSql} = ${me.id} or ${me.role} = 'admin')
      order by o.submitted_at, o.id limit 100`,
  );
  const ids = waiting.map((row) => row.id);
  const [items, papers, money] = await Promise.all([
    itemsOf(db, ids),
    papersOf(db, ids),
    moneyOf(
      db,
      waiting.map((row) => row.customerId),
    ),
  ]);
  return waiting.map(({ review, licenceExpired, kind, terms, creditLimit, leadId, gl, ...row }) => {
    const own = items.filter((item) => item.orderId === row.id);
    const found = findingsOf(
      own,
      {
        review,
        licenceExpired,
        kind,
        terms,
        papers: papers.get(row.id) ?? [],
        patientOrder: row.patientOrder,
        // An Online case's order carries the case's label as its note, not anyone's words.
        note: leadId ? null : row.note,
      },
      { owes: money.get(row.customerId), creditLimit, total: row.total },
    );
    return {
      ...labelled(row),
      lines: own
        .map(
          (item) =>
            `${item.medicine} × ${item.qty.toLocaleString("en-PH")}${item.free ? " (free)" : ""}`,
        )
        .join(", "),
      findings: found,
    };
  });
}

type CardRow = Omit<OrderCard, "statusLabel" | "lines" | "items" | "findings" | "step" | "next"> & {
  review: string;
  licenceExpired: boolean;
  creditLimit: number | null;
  leadId: number | null;
  gl: boolean;
};

/** An order's Online case (alias `o`), and whether it rides on a guarantee letter. */
const caseColumns = sql`o.lead_id::int as "leadId", coalesce((select l.road = 'gl' from lead l where l.id = o.lead_id), false) as gl`;

/** Everything a card shows about an order (alias `o`), with `cardFrom`. */
/** Who decides this order instead of Management: nobody (Aryan, 22 Nov: PAP has no head; the PAP
 *  person gets the papers and the guarantee letter ready on the case, then the order goes to
 *  Management, which reads the prescription, the letter and its amount, then to Finance). It was
 *  a PAP order's channel head until then; kept as one place should a desk ever approve apart. */
const approverSql = sql`(null::int)`;

const cardColumns = sql`${rowColumns}, o.medrep_id::int as "medrepId", ${approverSql} as "approverId",
  (select ap.name from person ap where ap.id = ${approverSql}) as "approverName", ${sentBackColumns},
  ${iso("o.approved_at")} as "approvedAt", ${takeBackSql} as "takeBack", ${iso("o.status_since")} as "stepSince",
  ${iso("o.papers_checked_at")} as "papersCheckedAt", (select pc.name from person pc where pc.id = o.papers_checked_by) as "papersCheckedBy",
  o.delivery_address as "deliveryAddress", o.receiver, o.receiver_phone as "receiverPhone", ${day("o.expected_on")} as "expectedOn",
  (select coalesce(sum(i.qty), 0) from order_item i where i.order_id = o.id)::int as pieces,
  (select p.name from person p where p.id = o.dispatch_by) as "dispatchBy", o.dispatch_by::int as "dispatchById",
  -- Who has it in hand at its desk now: Finance's person while it is with Finance, else Management's.
  (select p.name from person p where p.id = case when o.status in ('finance_check', 'ready_for_invoice') then o.finance_by else o.manage_by end) as "handledBy",
  (case when o.status in ('finance_check', 'ready_for_invoice') then o.finance_by else o.manage_by end)::int as "handledById",
  o.came_back_count::int as "cameBackCount", o.came_back_reason as "cameBackReason", c.kind as "customerKind", c.city as "customerCity", ${SHOWN_CHANNEL} as channel, a.name as area,
  o.payment_terms as "paymentTerms", o.payment_days::int as "paymentDays", ${day("o.pay_by")} as "payBy",
  ${iso("coalesce(o.submitted_at, o.created_at)")} as "submittedAt", o.held_from as "heldFrom", c.review,
  to_char(coalesce(o.submitted_at, o.created_at) at time zone 'Asia/Manila', 'YYYY-MM-DD') as "placedOn",
  c.phone as "customerPhone", w.name as warehouse, c.credit_limit::int as "creditLimit", o.held_role as "heldRole",
  o.delivery_method as "deliveryMethod", o.courier, o.tracking, o.rider,
  coalesce(c.licence_expires < (now() at time zone 'Asia/Manila')::date, false) as "licenceExpired", ${caseColumns}`;

const cardFrom = sql`from sales_order o ${rowJoins}
  left join channel ch on ch.id = o.channel_id
  left join area a on a.id = c.area_id
  left join warehouse w on w.id = o.warehouse_id`;

/** Who reads a card: Management and Finance decide, a seller waits, anyone else just reads. */
type Viewer = "management" | "finance" | "dispatch" | "seller" | "other";
const SELLERS: Role[] = ["medrep", "team_lead", "manager", "online"];
function viewerOf(me: Me, desk?: Desk): Viewer {
  if ((desk === "finance" && orderCan(me).finance) || me.role === "finance") return "finance";
  if ((desk === "dispatch" && orderCan(me).dispatch) || me.role === "dispatch") return "dispatch";
  if (ORDER_MANAGE_ROLES.includes(me.role)) return "management";
  return SELLERS.includes(me.role) ? "seller" : "other";
}

/** What happens to an order next, worded for who reads it. */
function nextLine(viewer: Viewer, row: CardRow, findings: OrderFinding[]): string {
  if (row.status === "on_hold" || row.status === "exception") {
    const by = holder(row);
    const fix =
      viewer === "seller" && by === "finance" && row.heldFrom === "finance_check"
        ? " Add the proof of payment and it goes back to Finance."
        : "";
    const who =
      row.status === "on_hold" && by !== "management"
        ? `On hold by ${by === "finance" ? "Finance" : "Dispatch"}`
        : STATUS_LABEL[row.status];
    return `${who}: ${row.flagReason ?? "no reason given"}${fix}`;
  }
  const road =
    row.deliveryMethod === "rider"
      ? `With our rider ${row.rider}`
      : row.courier
        ? `On the way with ${row.courier}${row.tracking ? ` · ${row.tracking}` : ", tracking to follow"}`
        : "On its way to the customer";
  if (viewer === "dispatch") {
    if (row.status === "ready_for_dispatch")
      return `Pack it from ${row.warehouse ?? "the main warehouse"}`;
    if (row.status === "packing") return "Packed: pick the courier and ship it";
    if (row.status === "shipped") return `${road}: mark it delivered`;
    return NEXT_OF[row.status];
  }
  if (viewer === "finance") {
    if (row.status === "finance_check")
      return findings[0] ? `Decide: ${findings[0].decide}` : "Check the payment and confirm it";
    if (row.status === "ready_for_invoice")
      return findings[0]
        ? `Decide: ${findings[0].decide}`
        : `Check what they owe and send it on (${row.paymentTerms === "days" ? `pays in ${row.paymentDays} days` : "cash on delivery"})`;
    return NEXT_OF[row.status];
  }
  if (viewer === "management")
    return row.status === "pending_approval" && findings[0]
      ? `Decide: ${findings[0].decide}`
      : row.status === "shipped"
        ? road
        : NEXT_OF[row.status];
  if (viewer === "other") return row.status === "shipped" ? road : NEXT_OF[row.status];
  switch (row.status) {
    case "draft":
      return `Sent back to you${row.flagReason ? `: ${row.flagReason}` : ""}. Fix it and place it again.`;
    case "pending_approval": {
      const who = row.approverName ?? "Management";
      return findings.length
        ? `${who} is checking it: ${findings.map((finding) => finding.short.toLowerCase()).join(", ")}`
        : `${who} is checking it`;
    }
    case "finance_check":
      return "Finance is checking the payment";
    case "ready_for_invoice":
      return "Finance is making the invoice";
    case "ready_for_dispatch":
      return "Dispatch is packing it";
    case "packing":
      return "Packed: Dispatch is sending it";
    case "shipped":
      return road;
    case "cancelled":
      return `Cancelled${row.flagReason ? `: ${row.flagReason}` : ""}`;
    default:
      return NEXT_OF[row.status];
  }
}

/** Orders as cards: their medicines in one line, what the system found, the step, what's next. */
async function toCards(
  db: Runner,
  me: Me,
  found: CardRow[],
  viewer: Viewer = viewerOf(me),
): Promise<OrderCard[]> {
  const ids = found.map((row) => row.id);
  const [items, papers, money, ownBills] = await Promise.all([
    itemsOf(db, ids),
    papersOf(db, ids),
    moneyOf(
      db,
      found.map((row) => row.customerId),
    ),
    ownDues(db, ids),
  ]);
  // What the customer owed before this order: its own invoice (made when Management approved
  // it) is the order itself, not a debt Finance weighs it against.
  const owedBefore = (row: CardRow) => {
    const all = money.get(row.customerId);
    const own = ownBills.get(row.id);
    return all && own
      ? { ...all, owed: all.owed - own.owed, overdue: all.overdue - own.overdue }
      : all;
  };
  return found.map((row) => {
    const { review, licenceExpired, gl, ...shown } = row;
    const { heldFrom, creditLimit } = row;
    const own = items.filter((item) => item.orderId === row.id);
    const onFile = papers.get(row.id) ?? [];
    // What the system found matters while the order waits for Management (or was stopped
    // before its invoice); while it waits for Finance, only the money.
    const atFinance = FINANCE_STATUSES.includes(row.status);
    const before =
      row.status === "pending_approval" ||
      atFinance ||
      (row.status === "on_hold" &&
        (!heldFrom || heldFrom === "pending_approval" || FINANCE_STATUSES.includes(heldFrom)));
    const found = before
      ? findingsOf(
          own,
          {
            review,
            licenceExpired,
            kind: row.customerKind,
            terms: row.paymentTerms,
            papers: onFile,
            patientOrder: row.patientOrder,
            // An Online case's order carries the case's label as its note, not anyone's words.
            note: row.leadId ? null : row.note,
          },
          { owes: owedBefore(row), creditLimit, total: row.total },
        )
      : [];
    // An Online case's order is checked as every channel's (Aryan, 19 Nov).
    const all = found;
    const moneyOnly = atFinance || (row.status === "on_hold" && holder(row) === "finance");
    const findings = moneyOnly
      ? all.filter((finding) => MONEY_FINDINGS.includes(finding.kind))
      : all;
    const flagged = row.status === "on_hold" || row.status === "exception";
    return {
      ...labelled(shown),
      lines: own
        .map(
          (item) =>
            `${item.medicine} × ${item.qty.toLocaleString("en-PH")}${item.free ? " (free)" : ""}`,
        )
        .join(", "),
      items: own.map((item) => ({
        medicineId: item.medicineId,
        name: item.medicine,
        qty: item.qty,
        priceLabel: item.priceLabel,
        listPrice: item.listPrice,
        unitPrice: item.unitPrice,
        free: item.free,
        reason: item.reason,
        cold: item.cold,
      })),
      findings,
      papers: onFile,
      step: flagged ? STEP_OF[heldFrom ?? "pending_approval"] : STEP_OF[row.status],
      next: nextLine(viewer, row, findings),
    };
  });
}

/** Management's board: the orders of one tab as cards, and how many each tab holds. */
export async function orderBoard(
  db: Database,
  me: Me,
  filter: {
    desk?: string;
    tab?: string;
    channel?: string;
    medrep?: number;
    q?: string;
    status?: string;
    /** How it pays: Finance's Prepaid orders are the board of the ones paid in advance. */
    terms?: string;
    /** Cards already shown: "Load more" asks for the next ones (up to 600 at once). */
    shown?: number;
  },
): Promise<OrderBoard> {
  const limit = Math.min(600, 60 + Math.max(0, Math.floor(filter.shown ?? 0)));
  const asked: Desk | undefined =
    filter.desk === "finance" || filter.desk === "dispatch" || filter.desk === "management"
      ? filter.desk
      : me.role === "finance"
        ? "finance"
        : me.role === "dispatch"
          ? "dispatch"
          : undefined;
  const readers: Record<Desk, Role[]> = {
    management: ORDER_ALL_ROLES as Role[],
    finance: ["finance", "admin", "ceo", "management"],
    dispatch: ["dispatch", "admin", "ceo", "management"],
  };
  const desk: Desk = asked && readers[asked].includes(me.role) ? asked : "management";
  const tabs = DESK_TABS[desk];
  const keys = Object.keys(tabs) as BoardTab[];
  const tab: BoardTab =
    filter.tab && keys.includes(filter.tab as BoardTab)
      ? (filter.tab as BoardTab)
      : DESK_HOME[desk];
  const status = STATUSES.includes(filter.status as OrderStatus)
    ? (filter.status as OrderStatus)
    : null;
  const today = sql`(now() at time zone 'Asia/Manila')::date`;
  const narrowed: SQL[] = [seen(me)];
  // The sheet's channel as the board shows it; an old link's first-channel code still works.
  if (filter.channel) narrowed.push(sql`(${SHOWN_CHANNEL} = ${filter.channel} or ch.code = ${filter.channel})`);
  if (filter.terms && ["advance", "cod", "days"].includes(filter.terms))
    narrowed.push(sql`o.payment_terms = ${filter.terms}`);
  for (const word of (filter.q ?? "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 5)) {
    const like = `%${word.replace(/[%_\\]/g, "\\$&")}%`;
    narrowed.push(sql`(lower(o.code) like ${like} or lower(c.name) like ${like} or lower(rep.name) like ${like}
      or lower(coalesce(o.delivery_address, '')) like ${like} or lower(coalesce(o.tracking, '')) like ${like}
      or exists (select 1 from order_item i join medicine m on m.id = i.medicine_id where i.order_id = o.id and lower(m.name) like ${like}))`);
  }
  // The MedRep strip counts everyone in the other filters, so a MedRep can be picked from it.
  const everyRep = sql.join(narrowed, sql` and `);
  if (filter.medrep) narrowed.push(sql`o.medrep_id = ${filter.medrep}`);
  const scope = sql.join(narrowed, sql` and `);
  // A PAP order waiting for approval is its head's, not Management's: out of Management's piles
  // (All orders still lists it).
  // Nor an order outside this Management person's divisions (Who approves what).
  const notMine =
    desk === "management"
      ? sql` and not (o.status = 'pending_approval' and ${approverSql} is not null and ${approverSql} <> ${me.id})
          and ${inApprovalScopeSql(me)}`
      : sql``;
  const inTab = (key: BoardTab): SQL =>
    key === "all" ? inTabOf(key) : sql`(${inTabOf(key)})${notMine}`;
  const inTabOf = (key: BoardTab): SQL =>
    // Dispatch's holds are the warehouse's own: held by Dispatch, or stopped at one of its steps.
    desk === "dispatch" && key === "hold"
      ? sql`o.status in ('on_hold', 'exception') and (o.held_role = 'dispatch' or o.held_from in ('ready_for_dispatch', 'packing', 'shipped'))`
      : // Finance's holds are its own too: held by Finance, or stopped at one of its steps.
        desk === "finance" && key === "hold"
        ? sql`o.status in ('on_hold', 'exception') and (o.held_role = 'finance' or o.held_from in ('finance_check', 'ready_for_invoice'))`
        : key === "passed"
          ? desk === "finance"
            ? sql`exists (select 1 from order_event e where e.order_id = o.id and e.stage = 'finance_verified'
                and (e.at at time zone 'Asia/Manila')::date = ${today})`
            : sql`o.approved_at is not null and (o.approved_at at time zone 'Asia/Manila')::date = ${today}`
          : key === "done"
          ? sql`o.status = 'completed' and o.delivered_on = ${today}::date`
          : key === "sent"
            ? sql`o.status = 'draft' and o.sent_back_at is not null`
            : key === "to_ship"
              ? sql`o.status = 'packing' and o.came_back_at is null`
              : key === "came_back"
                ? sql`o.status = 'packing' and o.came_back_at is not null`
                : sql`o.status in (${list(tabs[key] ?? [])})`;
  const from = sql`from sales_order o ${rowJoins} left join channel ch on ch.id = o.channel_id left join area a on a.id = c.area_id`;

  const picked = status ? sql`o.status = ${status}` : inTab(tab);
  const [counts, statusCounts, found, choices, byRep] = await Promise.all([
    rows<Partial<Record<BoardTab, number>>>(
      db,
      sql`${team(me)} select ${sql.join(
        keys.map(
          (key) => sql`count(*) filter (where ${inTab(key)})::int as ${sql.raw(`"${key}"`)}`,
        ),
        sql`, `,
      )} ${from} where ${scope}`,
    ),
    rows<{ status: OrderStatus; n: number }>(
      db,
      sql`${team(me)} select o.status, count(*)::int as n ${from} where ${scope} group by o.status`,
    ),
    rows<CardRow>(
      db,
      sql`${team(me)} select ${cardColumns} ${cardFrom}
        where ${scope} and ${picked}
        order by ${
          // A desk's own work comes oldest-waiting first (the late ones on top); other lists newest first.
          tab === "needs" || tab === "to_pack" || tab === "to_ship"
            ? sql`o.status_since asc, o.id`
            : sql`coalesce(o.submitted_at, o.created_at) desc, o.id desc`
        } limit ${limit}`,
    ),
    rows<{ channel: string | null; id: number; name: string }>(
      db,
      sql`${team(me)} select distinct ch.code as channel, rep.id::int as id, rep.name
        from sales_order o ${rowJoins} left join channel ch on ch.id = o.channel_id where ${seen(me)}`,
    ),
    rows<BoardRep>(
      db,
      sql`${team(me)} select rep.id::int as id, rep.name,
          (case when rch.code = 'PAP' then rch.code else coalesce((${seatDivisionsSql(sql`rep.id`, todayManila())})[1], rch.code) end) as channel, ra.name as area,
          count(*)::int as orders, coalesce(sum(o.total), 0)::float8 as value,
          ${iso("min(coalesce(o.submitted_at, o.created_at))")} as oldest
        ${from} left join channel rch on rch.id = rep.channel_id left join area ra on ra.id = rep.area_id
        where ${everyRep} and ${picked}
        group by rep.id, rep.name, rch.code, ra.name
        order by count(*) desc, sum(o.total) desc, rep.name`,
    ),
  ]);
  return {
    desk,
    tab,
    status,
    counts: counts[0] ?? {},
    byStatus: Object.fromEntries(statusCounts.map((row) => [row.status, row.n])),
    cards: await toCards(db, me, found, desk === "management" ? viewerOf(me) : desk),
    // Every channel, in the company's order (Aryan, 19 Nov: the list showed only the channels with
    // orders, and looked short).
    // The sheet's channels (the Divisions), and PAP, which is on no row of the sheet.
    channels: [...DIVISIONS, "PAP"],
    medreps: [
      ...new Map(choices.map((row) => [row.id, { id: row.id, name: row.name }])).values(),
    ].sort((x, y) => x.name.localeCompare(y.name)),
    byRep,
    can: orderCan(me),
  };
}

const MY_STAGES: Record<Exclude<MyOrderStage, "all">, SQL> = {
  sent_back: sql`o.status = 'draft'`,
  management: sql`o.status = 'pending_approval'`,
  finance: sql`o.status in ('finance_check', 'ready_for_invoice')`,
  dispatch: sql`o.status in ('ready_for_dispatch', 'packing', 'shipped')`,
  held: sql`o.status in ('on_hold', 'exception')`,
  delivered: sql`o.status = 'completed' and date_trunc('month', o.delivered_on) = date_trunc('month', (now() at time zone 'Asia/Manila')::date)`,
};

/** A person's own orders (a team lead's: the team's), where they stand, and this month's sales. */
export async function myOrders(
  db: Database,
  me: Me,
  filter: { stage?: string; page?: number; seat?: number; division?: string },
): Promise<MyOrders> {
  const stage: MyOrderStage =
    filter.stage && filter.stage in MY_STAGES ? (filter.stage as MyOrderStage) : "all";
  const page = Math.max(1, Math.floor(filter.page ?? 1) || 1);
  const pageSize = 20;
  // One seat of the team (a lead's person page): everything below reads only its orders.
  const scope = filter.seat ? sql`${seen(me)} and o.seat_id = ${filter.seat}` : seen(me);
  // One Division picked (the split by Division on top): the list and its counts read only it.
  const division = divisionOf(filter.division);
  const scoped = division ? sql`${scope} and o.division = ${division}` : scope;
  const where = stage === "all" ? scoped : sql`${scoped} and ${MY_STAGES[stage]}`;
  const thisMonth = sql`date_trunc('month', o.created_at at time zone 'Asia/Manila') = date_trunc('month', now() at time zone 'Asia/Manila')`;
  const placed = sql`o.status not in ('draft', 'cancelled')`;
  const [counts, held, sales, found, byDivision] = await Promise.all([
    rows<Record<MyOrderStage, number>>(
      db,
      sql`${team(me)} select count(*)::int as "all",
          count(*) filter (where ${MY_STAGES.sent_back})::int as sent_back,
          count(*) filter (where ${MY_STAGES.management})::int as management,
          count(*) filter (where ${MY_STAGES.finance})::int as finance,
          count(*) filter (where ${MY_STAGES.dispatch})::int as dispatch,
          count(*) filter (where ${MY_STAGES.held})::int as held,
          count(*) filter (where ${MY_STAGES.delivered})::int as delivered
        from sales_order o where ${scoped}`,
    ),
    rows<MyOrders["held"][number]>(
      db,
      sql`${team(me)} select o.id::int as id, o.code, c.name as customer, o.status, o.flag_reason as reason
        from sales_order o ${rowJoins} where ${scope} and (${MY_STAGES.held} or ${MY_STAGES.sent_back}) order by o.updated_at desc limit 5`,
    ),
    // What was sold is what Finance invoiced (not cancelled): what the target counts.
    rows<MyOrders["sales"]>(
      db,
      sql`${team(me)} select to_char(now() at time zone 'Asia/Manila', 'FMMonth') as month,
          count(*) filter (where ${placed} and ${thisMonth})::int as orders,
          coalesce((select sum(i.total) from invoice i join sales_order o on o.id = i.order_id
            where ${scope} and i.status <> 'cancelled'
              and date_trunc('month', i.issued_on) = date_trunc('month', now() at time zone 'Asia/Manila')), 0)::float8 as value,
          coalesce((select sum(i.total) from invoice i join sales_order o on o.id = i.order_id
            where ${scope} and i.status <> 'cancelled'
              and i.issued_on = (now() at time zone 'Asia/Manila')::date), 0)::float8 as today,
          ((date_trunc('month', now() at time zone 'Asia/Manila') + interval '1 month')::date
            - (now() at time zone 'Asia/Manila')::date - 1)::int as "daysLeft",
          extract(day from now() at time zone 'Asia/Manila')::int as day,
          extract(day from (date_trunc('month', now() at time zone 'Asia/Manila') + interval '1 month' - interval '1 day'))::int as "daysInMonth",
          (select t.amount::float8 from sales_target t where t.person_id = ${me.id}
            and t.month = date_trunc('month', now() at time zone 'Asia/Manila')::date) as target
        from sales_order o where ${scope}`,
    ),
    rows<CardRow>(
      db,
      sql`${team(me)} select ${cardColumns} ${cardFrom} where ${where}
        order by coalesce(o.submitted_at, o.created_at) desc, o.id desc limit ${pageSize} offset ${(page - 1) * pageSize}`,
    ),
    rows<MyOrders["byDivision"][number]>(
      db,
      sql`${team(me)} select coalesce(o.division, 'No Division') as division, count(*)::int as orders, coalesce(sum(o.total), 0)::float8 as value
        from sales_order o where ${scope} and ${placed} and ${thisMonth} group by 1 order by 3 desc, 1`,
    ),
  ]);
  const counted = counts[0] ?? {
    all: 0,
    sent_back: 0,
    management: 0,
    finance: 0,
    dispatch: 0,
    held: 0,
    delivered: 0,
  };
  return {
    stage,
    counts: counted,
    held,
    sales: sales[0] ?? {
      month: "",
      orders: 0,
      value: 0,
      today: 0,
      daysLeft: 0,
      target: null,
      day: 1,
      daysInMonth: 30,
    },
    byDivision,
    division,
    cards: await toCards(db, me, found),
    total: counted[stage],
    page,
    pageSize,
  };
}

/** Each active warehouse and what it can't fill of an order: its unexpired stock less what other
 *  approved, unpacked orders shipping from it hold (Management picks where it ships from). */
async function warehouseFill(db: Runner, orderId: number): Promise<OrderDetail["warehouseFill"]> {
  const today = todayManila();
  const found = await rows<{
    id: number;
    name: string;
    isDefault: boolean;
    medicine: string;
    need: number;
    have: number;
  }>(
    db,
    sql`with need as (
          select medicine_id, sum(qty)::int as qty from order_item where order_id = ${orderId} group by 1
        )
        select w.id::int as id, w.name, w.is_default as "isDefault",
          m.name || coalesce(' ' || m.strength, '') as medicine, n.qty as need,
          greatest(0,
            coalesce((select sum(s.qty) from stock s join batch b on b.id = s.batch_id
              where s.warehouse_id = w.id and b.medicine_id = n.medicine_id and s.qty > 0
                and b.expires_on >= ${today}::date), 0)
            - coalesce((select sum(i.qty) from order_item i join sales_order o on o.id = i.order_id
              where o.warehouse_id = w.id and o.id <> ${orderId} and i.medicine_id = n.medicine_id
                and ${PROMISED_ORDER}), 0)
          )::int as have
        from warehouse w cross join need n join medicine m on m.id = n.medicine_id
        where w.active
        order by w.is_default desc, w.name, m.name`,
  );
  const out = new Map<number, NonNullable<OrderDetail["warehouseFill"]>[number]>();
  for (const row of found) {
    const place = out.get(row.id) ?? {
      id: row.id,
      name: row.name,
      isDefault: row.isDefault,
      short: [],
      lines: [],
    };
    place.lines.push({ medicine: row.medicine, need: row.need, have: row.have });
    if (row.have < row.need)
      place.short.push({ medicine: row.medicine, need: row.need, have: row.have });
    out.set(row.id, place);
  }
  return [...out.values()];
}

export async function orderDetail(db: Database, me: Me, id: number): Promise<OrderDetail> {
  const [order] = await rows<
    Omit<OrderDetail["order"], "statusLabel" | "invoiceFromLabel"> & {
      raisedById: number;
      medrepId: number;
      licenceExpired: boolean;
      creditLimit: number | null;
      gl: boolean;
      undoable: boolean;
      approverId: number | null;
      restorable: boolean;
      paidIn: boolean;
      team: boolean;
      waitingSince: string | null;
      waitingBy: string | null;
      licenceOwner: string | null;
      ltoType: string | null;
      licenceIssued: string | null;
      customerPapers: CustomerPaperKind[];
    }
  >(
    db,
    sql`${team(me)} select ${rowColumns}, ${caseColumns}, c.kind as "customerKind", c.city as "customerCity", c.review as "customerReview",
        -- Who the customer is, for Management's check of a new one (23 Nov): its phone, who added it and when.
        c.phone as "customerPhone", (select ap.name from person ap where ap.id = c.added_by) as "customerAddedBy",
        to_char(c.created_at at time zone 'Asia/Manila', 'YYYY-MM-DD') as "customerAddedOn",
        coalesce(c.licence_expires < (now() at time zone 'Asia/Manila')::date, false) as "licenceExpired",
        c.licence_no as "licenceNo", ${day("c.licence_expires")} as "licenceExpires", c.tin,
        o.no_proof_reason as "noProofReason", o.no_proof_note as "noProofNote", ${approverSql} as "approverId",
        o.source, o.stock_reason as "stockReason", ${inTeamSql(me)} as team,
        c.licence_owner as "licenceOwner", c.lto_type as "ltoType", ${day("c.licence_issued")} as "licenceIssued",
        (select coalesce(array_agg(distinct f.kind), '{}') from customer_file f where f.customer_id = c.id and f.active) as "customerPapers",
        (select ap.name from person ap where ap.id = ${approverSql}) as "approverName",
        (o.finance_checked_by = ${me.id} and o.status = 'ready_for_dispatch' and coalesce(o.points_used, 0) = 0
          and now() - o.finance_checked_at <= interval '90 seconds') as undoable,
        (select coalesce(json_agg(json_build_object('id', f.id, 'name', f.name) order by f.id), '[]'::json)
          from order_file f where f.order_id = o.id and f.active and f.hold_event_id is not null
            and o.status in ('on_hold', 'exception')
            and f.hold_event_id = (select max(g.hold_event_id) from order_file g where g.order_id = o.id and g.active))
          as "holdProofs",
        raiser.name as "raisedBy", o.raised_by::int as "raisedById", o.medrep_id::int as "medrepId",
        ${SHOWN_CHANNEL} as channel, a.name as area,
        o.payment_terms as "paymentTerms", o.payment_days::int as "paymentDays",
        o.delivery_address as "deliveryAddress", o.receiver, o.receiver_phone as "receiverPhone", o.note,
        o.customer_po as "customerPo", o.invoice_from as "invoiceFrom", o.doctor_id::int as "doctorId", doc.name as doctor,
        ${day("o.expected_on")} as "expectedOn", o.warehouse_id::int as "warehouseId", w.name as warehouse,
        o.held_from as "heldFrom", ${iso("o.submitted_at")} as "submittedAt", ${iso("o.approved_at")} as "approvedAt",
        approver.name as "approvedBy", c.credit_limit::int as "creditLimit", o.held_role as "heldRole",
        ${iso("o.papers_checked_at")} as "papersCheckedAt", (select pc.name from person pc where pc.id = o.papers_checked_by) as "papersCheckedBy",
        o.delivery_method as "deliveryMethod", o.courier, o.tracking, o.tracking_wait as "trackingWait", o.rider,
        ${iso("o.packed_at")} as "packedAt", packer.name as "packedBy", ${iso("o.shipped_at")} as "shippedAt", shipper.name as "shippedBy",
        ${day("o.delivered_on")} as "deliveredOn", deliverer.name as "deliveredBy", o.received_by as "receivedBy",
        o.division, o.sub_division as "subDivision", o.payment_term as "paymentTerm", o.finance_check as "financeCheck",
        ${sentBackColumns}, ${iso("o.sent_back_at")} as "sentBackAt",
        case when ${takeBackSql} then ${iso(`(o.approved_at + make_interval(mins => ${TAKE_BACK_MINUTES}))`)} end as "takeBackUntil",
        case when o.relief_kind is not null then json_build_object('kind', o.relief_kind, 'idNo', o.relief_id_no, 'name', o.relief_name) end as relief,
        o.order_type as type, o.headquarter, o.no_rx_reason as "noRxReason",
        (select json_build_object('leadId', gc.id, 'agency', gc.agency, 'sentOn', to_char(gc.claim_sent_on, 'YYYY-MM-DD'), 'ref', gc.claim_ref)
          from lead gc where gc.order_id = o.id and gc.road = 'gl' order by gc.id desc limit 1) as "glClaim",
        o.gl_number as "glNumber", o.gl_amount::int as "glAmount", (select gp.name from person gp where gp.id = o.gl_set_by) as "glSetBy",
        ${restorableSql} as restorable, ${paidInSql} as "paidIn", ${iso("o.waiting_stock_at")} as "waitingSince",
        (select wp.name from person wp where wp.id = o.waiting_stock_by) as "waitingBy"
      from sales_order o ${rowJoins}
      join person raiser on raiser.id = o.raised_by
      left join channel ch on ch.id = o.channel_id
      left join area a on a.id = c.area_id
      left join warehouse w on w.id = o.warehouse_id
      left join person approver on approver.id = o.approved_by
      left join person packer on packer.id = o.packed_by
      left join person shipper on shipper.id = o.shipped_by
      left join person deliverer on deliverer.id = o.delivered_by
      left join customer doc on doc.id = o.doctor_id
      where o.id = ${id} and ${seen(me)}`,
  );
  if (!order)
    throw new Refusal(404, "not_found", "That order isn't one of yours, or it doesn't exist.");
  const [items, events, places, papers, money, owes, picks, steps, versions] = await Promise.all([
    itemsOf(db, [id]),
    rows<{
      id: number;
      kind: string;
      stage: OrderStage | null;
      message: string;
      by: string;
      role: Role;
      at: string;
    }>(
      db,
      sql`select e.id::int as id, e.kind, e.stage, e.message, p.name as by, p.role, ${iso("e.at")} as at
        from order_event e join person p on p.id = e.by_person
        where e.order_id = ${id} order by e.at, e.id`,
    ),
    warehouses(db),
    rows<Omit<OrderPaper, "kindLabel">>(
      db,
      sql`select f.id::int as id, f.kind, f.name, f.mime, f.size::int as size, p.name as by, ${iso("f.at")} as at
        from order_file f join person p on p.id = f.by_person
        where f.order_id = ${id} and f.active and f.hold_event_id is null order by f.at, f.id`,
    ),
    orderMoney(db, id),
    moneyOf(db, [order.customerId], id),
    rows<OrderPick>(
      db,
      sql`select p.id::int as id, p.order_item_id::int as "itemId", m.name || coalesce(' ' || m.strength, '') as medicine,
          p.batch_id::int as "batchId", b.batch_no as "batchNo", ${day("b.expires_on")} as "expiresOn", w.name as warehouse,
          p.qty::int as qty, m.pack_size::int as "packSize"
        from order_pick p join batch b on b.id = p.batch_id join medicine m on m.id = b.medicine_id join warehouse w on w.id = p.warehouse_id
        where p.order_id = ${id} and p.active order by p.order_item_id, b.expires_on, p.id`,
    ),
    rows<{ status: OrderStatus; enteredAt: string; leftAt: string | null; minutes: number }>(
      db,
      sql`select s.status, ${iso("s.entered_at")} as "enteredAt", ${iso("s.left_at")} as "leftAt",
          round(extract(epoch from (coalesce(s.left_at, now()) - s.entered_at)) / 60)::int as minutes
        from order_step s where s.order_id = ${id} order by s.entered_at, s.id`,
    ),
    rows<Omit<OrderVersion, "kindLabel" | "byRole"> & { role: Role | null }>(
      db,
      sql`select v.n, v.kind, p.name as by, p.role, ${iso("v.at")} as at, v.why, v.total::float8 as total, v.lines
        from order_version v left join person p on p.id = v.by_person
        where v.order_id = ${id} order by v.n`,
    ),
  ]);
  const {
    raisedById,
    medrepId,
    licenceExpired,
    creditLimit,
    gl,
    undoable,
    approverId,
    restorable,
    paidIn,
    team: inTeam,
    waitingSince,
    waitingBy,
    licenceOwner,
    ltoType,
    licenceIssued,
    customerPapers,
    ...shown
  } = order;
  const onFile = [...new Set(papers.map((paper) => paper.kind))];
  const who = {
    status: order.status,
    raisedBy: raisedById,
    medrepId,
    heldFrom: order.heldFrom,
    heldRole: order.heldRole,
    leadId: order.leadId,
    takeBack: Boolean(order.takeBackUntil),
    approverId,
    restorable,
    team: inTeam,
  };
  const can = orderActions(me, who);
  const held = order.status === "on_hold" || order.status === "exception";
  const found = findingsOf(
    items,
    {
      review: order.customerReview,
      licenceExpired,
      kind: order.customerKind,
      terms: order.paymentTerms,
      papers: onFile,
      patientOrder: order.patientOrder,
      // An Online case's order carries the case's label as its note, not anyone's words.
      note: order.leadId ? null : order.note,
    },
    // What the customer owes counts until the order is past Finance (its own invoice, made when
    // Management approved it, left out).
    beforeDispatch(order)
      ? { owes: owes.get(order.customerId), creditLimit, total: order.total }
      : undefined,
  );
  return {
    order: {
      ...labelled(shown),
      // Delivered and paid is complete; delivered with money still owed says just that.
      ...(shown.status === "completed" && money.invoice?.status === "paid"
        ? { statusLabel: "Completed" }
        : {}),
      invoiceFromLabel: INVOICE_FROM_LABEL[order.invoiceFrom],
      customerMissing: missingOf(
        {
          kind: order.customerKind,
          tin: order.tin,
          licenceOwner,
          licenceNo: order.licenceNo,
          ltoType,
          licenceIssued,
          licenceExpires: order.licenceExpires,
        },
        customerPapers,
      ),
    },
    items: items.map(({ orderId: _orderId, ...item }) => item),
    asks: await asksOf(db, me, id),
    askUp:
      ORDER_MANAGE_ROLES.includes(me.role) && !["cancelled", "completed"].includes(order.status)
        ? await leadsUp(db, medrepId)
        : null,
    versions: versions.map(({ role, ...version }) => ({
      ...version,
      kindLabel: VERSION_LABEL[version.kind],
      byRole: role ? ROLE_LABEL[role] : null,
    })),
    papers: papers.map((paper) => ({ ...paper, kindLabel: PAPER_LABEL[paper.kind] })),
    paperList: paperList(
      {
        kind: order.customerKind,
        terms: order.paymentTerms,
        days: order.paymentDays,
        patient: order.customerKind === "patient" || order.patientOrder,
        rx: items.some((item) => item.rx),
        source: order.source,
        type: order.type,
        division: order.division,
        noRxReason: order.noRxReason,
      },
      onFile,
    ),
    findings: found,
    // "Paid" counts only while the invoice is paid: a payment taken off un-pays it.
    // "Paid" and "Completed" count only while the invoice is paid: a payment taken off un-pays it.
    stages: STAGES.map((stage) => ({
      ...stage,
      at:
        (stage.key === "paid" || stage.key === "completed") && money.invoice?.status !== "paid"
          ? null
          : (events.findLast((event) => event.stage === stage.key)?.at ?? null),
    })),
    events: events.map(({ role, ...event }) => ({ ...event, byRole: ROLE_LABEL[role] })),
    steps: steps.map((step) => ({ ...step, label: STATUS_LABEL[step.status] })),
    warehouses: places,
    // The checks Management has approved one by one (19 Nov), with who and when.
    checksApproved: await rows<{ key: OrderCheckKey; by: string; at: string }>(
      db,
      sql`select k.check_key as key, p.name as by, ${iso("k.at")} as at
        from order_check k join person p on p.id = k.by_person where k.order_id = ${id} order by k.at`,
    ),
    // Management lets a held order go on from where it stopped, or an earlier desk.
    resumeTo:
      can.resume && (ORDER_MANAGE_ROLES.includes(me.role) || approverId === me.id)
        ? resumeChoices({
            heldFrom: order.heldFrom,
            terms: order.paymentTerms,
            financeCheck: order.financeCheck,
            leadId: order.leadId,
            paidIn,
          }).map((status) => ({ status, label: STATUS_LABEL[status] }))
        : [],
    waitingStock:
      held && waitingSince
        ? { since: waitingSince, by: waitingBy, short: await shortLines(db, id) }
        : null,
    dues: {
      ...(
        await rows<{ owed: number; overdue: number; days: number; zoho: number }>(
          db,
          sql`select coalesce(sum(dd.balance) filter (where not dd.cod_waiting), 0)::float8 as owed,
              coalesce(sum(dd.balance) filter (where not dd.on_delivery and dd.late > 0), 0)::float8 as overdue,
              coalesce(max(dd.late) filter (where not dd.on_delivery and dd.late > 0), 0)::int as days,
              coalesce(sum(dd.balance) filter (where dd.source <> 'crm' and not dd.cod_waiting), 0)::float8 as zoho
            from ${duesSql(todayManila())} dd where dd.customer_id = ${order.customerId} and dd.order_id is distinct from ${id}`,
        )
      )[0] ?? { owed: 0, overdue: 0, days: 0, zoho: 0 },
      creditLimit,
      credit: (await customerCredit(db, order.customerId)).total,
    },
    warehouseFill: can.approve ? await warehouseFill(db, id) : null,
    money,
    picks,
    can: {
      ...can,
      addPaper: mayAddPaper(me, who, "po"),
      addProof: mayAddPaper(me, who, "payment_proof"),
      addDr: mayAddPaper(me, who, "dr"),
      // Finance records the money received, an Online case's order's too (19 Nov). Not while an
      // advance order waits for Finance's payment check: the money comes in there.
      recordPayment:
        orderCan(me).finance &&
        money.invoice?.status === "open" &&
        order.status !== "finance_check" &&
        !(held && order.heldFrom === "finance_check"),
      waitStock: can.hold && (await shortLines(db, id)).length > 0,
      undoConfirm: orderCan(me).finance && Boolean(undoable),
    },
  };
}

// ---------------------------------------------------------------- writing

/** What only the system passes when it places an order (the Online desk's case): the payment
 *  terms when they aren't the customer's (a guarantee letter: the agency pays later), the
 *  statutory relief on its lines, the case it came from, and work done inside the same
 *  transaction. */
export type PlaceOptions = {
  terms?: { terms: PaymentTerms; days: number | null };
  /** An Online or PAP case's order: a senior's or PWD's ID is on the case's papers, not typed. */
  reliefFromCase?: boolean;
  leadId?: number;
  /** What the customer pays for delivery (a website order's fee), on top of the medicines. */
  deliveryFee?: number;
  inside?: (tx: Runner, orderId: number) => Promise<void>;
  /** An Online case's order: the agent asks Management to check it although nothing is wrong. */
  toManagement?: boolean;
  /** A PAP case's order (Aryan, 22 Nov: PAP is a process, the sale counts where the patient came
   *  from): the person the case came from is its MedRep; the PAP person only raised it. */
  creditTo?: number;
};

type KeptRelief = { unitPrice: number; priceKind: string; listPrice: number; reason: string | null };

/** The order's lines checked and priced, the same for a new order and a fixed one: each
 *  medicine on it once (a second line only as free goods), something paid for, a price of the
 *  kind picked, and a reason for any price given other than it (below or above: Management sees
 *  both). A senior citizen's or PWD's order (relief) gets, on every paid line, the lowest of: the
 *  price of its kind less VAT and 20% (the law), a running promo less VAT, or a lower price given
 *  (with its reason) less VAT; never a promo and the 20% together. */
async function checkedLines(
  db: Runner,
  input: OrderInput,
  today: string,
  relief?: OrderRelief | null,
  /** A case's quote: on a relief order its lower quoted price (with VAT) is one of the choices.
   *  Anywhere else a relief order's prices are worked out here, never taken as typed (a changed
   *  order sends its relief prices back, and they must not lose their VAT twice). */
  quoted = false,
  /** A changed order's SC/PWD lines as they were, by medicine: one sent back at the same price
   *  keeps it (already without VAT). */
  keptRelief?: Map<number, KeptRelief>,
  /** The buyer's kind: the offers running for it (Buy X Take Y, a special price) apply. */
  buyer: CustomerKind | null = null,
) {
  if (input.items.length === 0)
    throw new Refusal(400, "invalid", "Add at least one medicine.", "items");
  const ids = [...new Set(input.items.map((item) => item.medicineId))];
  // A medicine may be on the order twice only as one paid line and one free line (a Buy 1 Take 1,
  // a sample), and an order needs something paid for.
  for (const id of ids) {
    const paid = input.items.filter((item) => item.medicineId === id && !item.free).length;
    const free = input.items.filter((item) => item.medicineId === id && item.free).length;
    if (paid > 1 || free > 1)
      throw new Refusal(
        400,
        "invalid",
        "A medicine is on the order twice. Put it on one line, or make the second one free.",
        "items",
      );
  }
  if (input.items.every((item) => item.free))
    throw new Refusal(400, "invalid", "Add at least one medicine that is paid for.", "items");
  const inIds = sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );
  const [medicines, prices, promos] = await Promise.all([
    rows<{ id: number; name: string; vat: Vat; coldBox: boolean }>(
      db,
      sql`select id::int as id, name || coalesce(' ' || strength, '') as name, vat, cold_box as "coldBox" from medicine where active and id in (${inIds})`,
    ),
    rows<{ medicineId: number; kind: string; amount: number }>(
      db,
      sql`select medicine_id::int as "medicineId", buyer_type as kind, amount::int as amount from medicine_price where medicine_id in (${inIds})`,
    ),
    rows<{ medicineId: number; amount: number }>(
      db,
      sql`select distinct on (medicine_id) medicine_id::int as "medicineId", amount::int as amount from promo
        where medicine_id in (${inIds}) and starts_on <= ${today}::date and ends_on >= ${today}::date
        order by medicine_id, amount`,
    ),
  ]);
  const offers = await activeOffers(db, ids, buyer, today);
  const law = relief
    ? relief.kind === "senior"
      ? "Senior citizen: patient price, no VAT, 20% off (RA 9994)"
      : "PWD: patient price, no VAT, 20% off (RA 10754)"
    : "";

  const lines = input.items.map((item, index) => {
    const medicine = medicines.find((row) => row.id === item.medicineId);
    if (!medicine)
      throw new Refusal(
        400,
        "invalid",
        "That medicine isn't in the list any more.",
        `items.${index}.medicineId`,
      );
    const promo = promos.find((row) => row.medicineId === item.medicineId)?.amount;
    const offer = offers.get(item.medicineId);
    const found =
      item.priceKind === "promo"
        ? promo
        : item.priceKind === "offer"
          ? (offer?.price ?? undefined)
          : prices.find((row) => row.medicineId === item.medicineId && row.kind === item.priceKind)
              ?.amount;
    // A free line is given at no charge whatever its price.
    if (item.free)
      return {
        ...item,
        listPrice: found ?? 0,
        unitPrice: 0,
        reason: clean(item.reason) ?? "Free",
        free: true,
        relief: false,
      };
    // A cold-chain box: whatever price is typed on the order (Management's), its list or none.
    if (medicine.coldBox)
      return {
        ...item,
        listPrice: found ?? 0,
        unitPrice: Math.max(0, item.unitPrice ?? found ?? 0),
        reason: clean(item.reason) ?? "Cold-chain packaging",
        free: false,
        relief: false,
      };
    const listPrice = found;
    if (listPrice === undefined)
      throw new Refusal(
        400,
        "invalid",
        `${medicine.name} has no ${item.priceKind === "promo" ? "promo" : item.priceKind === "offer" ? "offer" : buyerLabel(item.priceKind)} price${item.priceKind === "offer" ? " running for this buyer" : ""}. Pick another price.`,
        `items.${index}.priceKind`,
      );
    const reason = clean(item.reason);
    if (relief) {
      // The lowest the law and the offers allow, worked out here, not typed. The law's price is
      // the patient price less VAT and 20% (Aryan, 17 Nov), whoever the buyer; the price picked
      // only when the medicine has no patient price.
      const patientPrice = prices.find(
        (row) => row.medicineId === item.medicineId && row.kind === "patient",
      )?.amount;
      const base = patientPrice ?? listPrice;
      const candidates: { price: number; kind: string; list: number; why: string }[] = [
        {
          price: reliefPrice(base, medicine.vat),
          kind: patientPrice !== undefined ? "patient" : item.priceKind,
          list: base,
          why: law,
        },
      ];
      if (promo !== undefined)
        candidates.push({ price: exVat(promo, medicine.vat), kind: "promo", list: promo, why: `Promo, no VAT (the law: not both)` });
      if (quoted && item.unitPrice !== undefined && item.unitPrice !== null && item.unitPrice < listPrice) {
        if (!reason)
          throw new Refusal(
            400,
            "invalid",
            `Say why ${medicine.name} is given below the ${buyerLabel(item.priceKind)} price.`,
            `items.${index}.reason`,
          );
        candidates.push({ price: exVat(item.unitPrice, medicine.vat), kind: item.priceKind, list: listPrice, why: `No VAT · ${reason}` });
      }
      const was = keptRelief?.get(item.medicineId);
      if (was && item.unitPrice === was.unitPrice)
        candidates.push({ price: was.unitPrice, kind: was.priceKind, list: was.listPrice, why: was.reason ?? law });
      const best = candidates.reduce((low, one) => (one.price < low.price ? one : low));
      return {
        ...item,
        priceKind: best.kind,
        listPrice: best.list,
        unitPrice: best.price,
        reason: best.why,
        free: false,
        relief: true,
      };
    }
    const unitPrice = item.unitPrice ?? listPrice;
    // Bought at an offer's price: the offer is the reason.
    if (item.priceKind === "offer" && offer && unitPrice === listPrice)
      return {
        ...item,
        listPrice,
        unitPrice,
        reason: offer.name,
        free: false,
        relief: false,
        offerId: offer.id,
      };
    if (unitPrice !== listPrice && !reason)
      throw new Refusal(
        400,
        "invalid",
        `Say why ${medicine.name} is given ${unitPrice < listPrice ? "below" : "above"} the ${buyerLabel(item.priceKind)} price.`,
        `items.${index}.reason`,
      );
    return {
      ...item,
      listPrice,
      unitPrice,
      reason: unitPrice !== listPrice ? reason : null,
      free: false,
      relief: false,
    };
  });
  // The offers' free pieces, worked out here (never typed); not with an SC/PWD price (the law:
  // the discount or a promo, never both).
  const priced = lines.map((line) => ({
    ...line,
    offerId: ("offerId" in line ? line.offerId : null) as number | null,
  }));
  return relief ? priced : withOfferLines(priced, offers);
}

/** A price with its VAT taken out (a 12% medicine); a VAT-exempt one as it is. */
const exVat = (price: number, vat: Vat) => (vat === "vat12" ? Math.round(price / 1.12) : price);

/** An order's SC/PWD relief: on any order whose buyer shows a senior citizen's or PWD's ID
 *  (Aryan, 17 Nov), with its number (and the name on it) for the invoice. */
async function checkedRelief(
  input: { relief?: OrderRelief | null },
  needId: boolean,
): Promise<OrderRelief | null> {
  const relief = input.relief;
  if (!relief) return null;
  const idNo = clean(relief.idNo);
  if (needId && !idNo)
    throw new Refusal(
      400,
      "invalid",
      relief.kind === "senior" ? "Type their OSCA ID number." : "Type their PWD ID number.",
      "relief.idNo",
    );
  return { kind: relief.kind, idNo, name: clean(relief.name) };
}

/** Places an order. A MedRep's waits for Management; Management's own goes straight on. */
/** The MedReps a team lead (any of theirs) or Management (anyone) places orders for. */
const forWhom = (me: Me): SQL =>
  me.role === "team_lead" || me.role === "manager"
    ? sql`p.id in (with recursive team as (select id from person where id = ${me.id}
        union all select q.id from person q join team t on q.reports_to = t.id) select id from team)`
    : ORDER_ALL_ROLES.includes(me.role)
      ? sql`true`
      : sql`false`;

/** The Division a form sends: one of the sales tracker's channels (a hub word is read as its
 *  channel, for a page still open from before); anything else is refused. */
function divisionPicked(typed: string | null | undefined): string | null {
  const said = clean(typed);
  if (!said) return null;
  const division = divisionOf(said);
  if (!division) throw new Refusal(400, "invalid", "Pick the Division from the list.", "division");
  return division;
}

/** A person's seats' Divisions (migration 0114), the main seat's first: `who` is their id. */
const seatDivisionsSql = (who: SQL, today: string) => sql`(select array_agg(seat_division(dh.seat_id)
    order by (dh.kind = 'holder') desc, ds.lead desc, dh.starts_on, dh.id)
  from seat_holder dh join seat ds on ds.id = dh.seat_id and ds.active
  where dh.person_id = ${who} and ${inForce("dh", today)})`;

async function pickedMedrep(db: Database, me: Me, medrepId: number) {
  const [found] = await rows<{ id: number; channelId: number | null }>(
    db,
    sql`select p.id::int as id, p.channel_id::int as "channelId" from person p
      where p.id = ${medrepId} and p.active and p.role = 'medrep' and ${forWhom(me)}`,
  );
  if (!found) throw new Refusal(400, "invalid", "Pick one of your MedReps.", "medrepId");
  return found;
}

/** Whom this person may place an order for, and the MedRep who looks after the customer. */
export async function orderForList(
  db: Database,
  me: Me,
  customerId: number | null,
): Promise<OrderForList> {
  if (me.role === "medrep" || me.role === "online")
    return { can: false, medreps: [], suggested: null };
  const today = todayManila();
  const found = await rows<Omit<OrderForList["medreps"][number], "divisions"> & { seatDivisions: string[] | null }>(
    db,
    sql`select p.id::int as id, p.name, a.name as area, ch.code as channel, ch.division, seat.login, seat.team,
        ${seatDivisionsSql(sql`p.id`, today)} as "seatDivisions" from person p
      left join area a on a.id = p.area_id left join channel ch on ch.id = p.channel_id
      left join lateral (select s.login, u.name as team from seat_holder h join seat s on s.id = h.seat_id and s.active
        join org_unit u on u.id = s.unit_id where h.person_id = p.id and h.kind = 'holder' and ${inForce("h", today)}
        order by h.starts_on, h.id limit 1) seat on true
      where p.active and p.role = 'medrep' and ${forWhom(me)} order by seat.team nulls last, p.name`,
  );
  // Each MedRep's own Divisions: the order picked for them carries one of theirs.
  const medreps = found.map(({ seatDivisions, ...rep }) => ({
    ...rep,
    divisions: divisionsOf(seatDivisions, rep.division),
    division: divisionsOf(seatDivisions, rep.division)[0] ?? null,
  }));
  const [suggested] = customerId
    ? await rows<{ id: number }>(
        db,
        sql`select p.id::int as id from customer c join person p on p.area_id = c.area_id and p.role = 'medrep' and p.active
          where c.id = ${customerId} limit 1`,
      )
    : [];
  return {
    can: medreps.length > 0,
    medreps,
    suggested: suggested && medreps.some((rep) => rep.id === suggested.id) ? suggested.id : null,
  };
}

/** Keeps the order's lines as they stand now as its next version (1 = as placed). */
const VERSION_LABEL: Record<OrderVersion["kind"], string> = {
  placed: "Placed",
  fixed: "Fixed by the MedRep",
  changed: "Changed by Management",
};

async function saveVersion(
  tx: Runner,
  orderId: number,
  kind: "placed" | "fixed" | "changed",
  me: Me,
  why: string | null,
): Promise<void> {
  await tx.execute(
    sql`insert into order_version (order_id, n, kind, by_person, why, lines, total)
      select ${orderId}, coalesce((select max(n) from order_version where order_id = ${orderId}), 0) + 1, ${kind}, ${me.id}, ${why},
        coalesce((select jsonb_agg(jsonb_build_object(
            'medicineId', i.medicine_id, 'name', m.name || coalesce(' ' || m.strength, ''), 'qty', i.qty,
            'priceKind', i.price_kind, 'listPrice', i.list_price, 'unitPrice', i.unit_price, 'reason', i.price_reason,
            'free', i.free, 'relief', i.relief) order by i.id)
          from order_item i join medicine m on m.id = i.medicine_id where i.order_id = ${orderId}), '[]'::jsonb),
        (select total from sales_order where id = ${orderId})`,
  );
}

export async function placeOrder(
  db: Database,
  me: Me,
  input: OrderInput,
  options: PlaceOptions = {},
): Promise<number> {
  const { customer } = await customerDetail(db, me, input.customerId);
  const today = todayManila();
  if (input.expectedOn && input.expectedOn < today)
    throw new Refusal(400, "invalid", "The delivery date has passed.", "expectedOn");
  if (input.doctorId) {
    const [doctor] = await rows<{ kind: string }>(
      db,
      sql`select kind from customer where id = ${input.doctorId} and active`,
    );
    if (doctor?.kind !== "doctor")
      throw new Refusal(400, "invalid", "Pick a doctor from your doctors.", "doctorId");
  }

  // A senior's or PWD's own order: its ID is typed on the form (a case's is on its papers).
  const relief = await checkedRelief(input, !options.reliefFromCase);
  const lines = await checkedLines(
    db,
    input,
    today,
    relief,
    Boolean(options.reliefFromCase),
    undefined,
    customer.kind,
  );
  const division = divisionPicked(input.division);
  const deliveryFee = Math.max(0, Math.round(options.deliveryFee ?? 0));
  const total = lines.reduce((sum, line) => sum + line.qty * line.unitPrice, 0) + deliveryFee;

  // Management's own order is approved as it is placed, but a patient's waits for its
  // prescription (Aryan, 17 Nov: Rx whenever a patient buys): Management approves it once on file.
  // The order's type, picked first (Aryan, 19 Nov): a business's type is never a patient's own
  // order; Senior / PWD carries their ID; a patient's type for a hospital or a doctor is an order
  // for one patient.
  const type = input.type ?? null;
  if (type && !isPatientType(type) && customer.kind === "patient")
    throw new Refusal(400, "invalid", "A patient's order is Patient, Senior / PWD or Guarantee letter.", "type");
  // A guarantee letter is PAP's work (Aryan, 22 Nov): a seller hands the patient to PAP, who gets
  // the quotations and the letter and places the case's order (the sale stays the seller's). The
  // order form said so; the server refuses it too, so the form isn't the only guard.
  if (
    type === "gl" &&
    !options.leadId &&
    !options.creditTo &&
    ["medrep", "team_lead", "manager", "online"].includes(me.role) &&
    me.channel?.code !== "PAP"
  )
    throw new Refusal(
      403,
      "forbidden",
      "A guarantee letter is PAP's work: hand the patient to PAP (Hand to PAP on the order form). The sale stays yours.",
      "type",
    );
  if (type === "po" && !clean(input.customerPo))
    throw new Refusal(400, "invalid", "Type their PO number: it goes on the invoice.", "customerPo");
  if (type === "senior_pwd" && !relief)
    throw new Refusal(400, "invalid", "Say senior citizen or PWD, with their ID number.", "relief");
  if (type && type !== "senior_pwd" && relief && !options.reliefFromCase)
    throw new Refusal(400, "invalid", "The 20% off is for a Senior / PWD order: pick that type.", "type");
  const patientOrder =
    customer.kind !== "patient" && (type ? isPatientType(type) : Boolean(input.patientOrder));
  const patientBuys = customer.kind === "patient" || patientOrder;
  // Nothing skips Management (Aryan, 22 Nov): the Admin's own order waits for approval too.
  const manages = false as boolean;
  // Whose order it is: the MedRep who placed it; for one a team lead or Management places, the
  // MedRep they pick (one of the lead's own people), else the MedRep of the customer's area.
  const picked = input.medrepId ? await pickedMedrep(db, me, input.medrepId) : null;
  const [credited] = options.creditTo
    ? await rows<{ id: number; channelId: number | null }>(
        db,
        sql`select id::int as id, channel_id::int as "channelId" from person where id = ${options.creditTo} and active`,
      )
    : [];
  const [holder] = credited
    ? [credited]
    : picked
    ? [picked]
    : // A MedRep's and the Online desk's own orders are theirs; the agent is the Online channel's MedRep.
      me.role === "medrep" || me.role === "online" || !customer.areaId
      ? []
      : await rows<{ id: number; channelId: number | null }>(
          db,
          sql`select id::int as id, channel_id::int as "channelId" from person
            where area_id = ${customer.areaId} and role = 'medrep' and active order by id limit 1`,
        );
  const [own] = await rows<{ channelId: number | null }>(
    db,
    sql`select channel_id::int as "channelId" from person where id = ${me.id}`,
  );
  // Management's own order skips the queue, so it ships from the default warehouse.
  const [shipsFrom] = manages
    ? await rows<{ id: number }>(
        db,
        sql`select id::int as id from warehouse where active order by is_default desc, id limit 1`,
      )
    : [];
  // The Payment Terms the MedRep agreed with the customer ("PDC 30"), else the customer's own.
  const paymentTerm = clean(input.paymentTerm);
  const terms =
    options.terms ??
    (paymentTerm
      ? termsOfLabel(paymentTerm)
      : { terms: customer.paymentTerms, days: customer.paymentDays });
  const [placer] = await rows<{ division: string | null; area: string | null; title: string | null; seatDivisions: string[] | null }>(
    db,
    // The division and area are the MedRep's whose order it is (a team lead ordering for Ryan
    // books it under Ryan's channel and area), else the placer's own.
    sql`select ch.division, a.name as area, p.title, ${seatDivisionsSql(sql`p.id`, today)} as "seatDivisions"
      from person p left join channel ch on ch.id = p.channel_id left join area a on a.id = p.area_id where p.id = ${holder?.id ?? me.id}`,
  );
  // The order's Division starts as its person's own and may be any (Aryan, 19 Nov, evening: "the
  // MedRep's screen universal, as the hub's: a hospital MedRep who gets a prescription order
  // picks that Division and its fields follow"). Whatever its Division, the order counts for its
  // MedRep: their own lead and head, their channel, their target.
  const ownDivisions = divisionsOf(placer?.seatDivisions ?? null, placer?.division ?? null);
  const orderDivision = division ?? ownDivisions[0] ?? null;
  // The Sub-division and Headquarter as the form sent them (the hub's rule, 19 Nov), else: their
  // own Division's from where they sit, as before; another Division's by the hub's rule (never the
  // person's own place on another Division's order, the hub's slip).
  const rule = divisionRule(orderDivision, type === "gl");
  const subDivision =
    clean(input.subDivision) ??
    (orderDivision && orderDivision === ownDivisions[0] && (placer?.area || placer?.title)
      ? subDivisionOfArea(orderDivision, placer?.area, placer?.title)
      : (rule?.sub ?? null));
  const headquarter = clean(input.headquarter) ?? (rule?.hq || null);
  const status: OrderStatus = manages ? afterApproval(terms.terms) : "pending_approval";

  return db.transaction(async (tx) => {
    const [made] = await rows<{ id: number }>(
      tx,
      sql`insert into sales_order (customer_id, medrep_id, raised_by, channel_id, status, payment_terms, payment_days, pay_by,
          delivery_address, receiver, receiver_phone, note, expected_on, customer_po, invoice_from, doctor_id, total, submitted_at,
          approved_at, approved_by, warehouse_id, lead_id, delivery_fee, division, sub_division, payment_term,
          no_proof_reason, no_proof_note, patient_order, patient_name, relief_kind, relief_id_no, relief_name,
          source, stock_reason, order_type, headquarter, no_rx_reason, gl_number, gl_amount, gl_set_by, gl_set_at)
        values (${customer.id}, ${holder?.id ?? me.id}, ${me.id}, ${holder?.channelId ?? own?.channelId ?? null}, ${status},
          ${terms.terms}, ${terms.days}, ${("payBy" in terms ? terms.payBy : null) ?? null},
          ${clean(input.deliveryAddress) ?? withCity(customer.address, customer.city)},
          ${clean(input.receiver)}, ${clean(input.receiverPhone)}, ${clean(input.note)}, ${input.expectedOn || null}, ${clean(input.customerPo)}, ${input.invoiceFrom ?? "2mg"}, ${input.doctorId ?? null}, ${total}, now(),
          ${manages ? sql`now()` : null}, ${manages ? me.id : null}, ${shipsFrom?.id ?? null}, ${options.leadId ?? null}, ${deliveryFee},
          ${orderDivision}, ${subDivision || null}, ${paymentTerm},
          ${input.noProofReason ?? null}, ${clean(input.noProofNote)}, ${patientOrder},
          ${patientOrder ? clean(input.patientName) : null},
          ${relief?.kind ?? null}, ${relief?.idNo ?? null}, ${relief?.name ?? null},
          ${input.source ?? null}, ${clean(input.stockReason)}, ${type}, ${headquarter}, ${clean(input.noRxReason)},
          ${clean(input.glNumber)}, ${input.glAmount ?? null},
          ${clean(input.glNumber) || input.glAmount != null ? me.id : null}, ${clean(input.glNumber) || input.glAmount != null ? sql`now()` : null})
        returning id::int as id`,
    );
    const id = made?.id as number;
    await tx.execute(
      sql`with next as (update counter set value = value + 1 where name = 'order' returning value)
        update sales_order set code = '2MG-' || (500000 + next.value)::text from next where sales_order.id = ${id}`,
    );
    for (const line of lines)
      await tx.execute(
        sql`insert into order_item (order_id, medicine_id, qty, price_kind, list_price, unit_price, price_reason, relief, free, offer_id)
          values (${id}, ${line.medicineId}, ${line.qty}, ${line.priceKind}, ${line.listPrice}, ${line.unitPrice}, ${line.reason}, ${line.relief}, ${line.free}, ${line.offerId ?? null})`,
      );
    // The order as it was placed: its first version, kept whatever is changed after.
    await saveVersion(tx, id, "placed", me, null);
    await logEvent(
      tx,
      id,
      me,
      "status",
      manages
        ? `${me.name} placed this order. It skips the approval queue.`
        : options.leadId
          ? `${me.name} placed this order from the Online case.`
          : `${me.name} placed this order. It waits for Management's approval.`,
      "created",
    );
    if (manages) await logEvent(tx, id, me, "status", "Approved when placed.", "approved");
    // A bidding order may say which award it delivers (19 Nov): the tender keeps it as its order.
    if (input.tenderId) {
      const [linked] = await rows<{ step: string; code: string }>(
        tx,
        sql`update tender set order_id = ${id}, updated_at = now()
          where id = ${input.tenderId} and agency_id = ${customer.id} and order_id is null and step in ('won', 'contract')
          returning step, code`,
      );
      if (!linked) throw new Refusal(400, "invalid", "That award isn't this customer's, or it already has its order.", "tenderId");
      const [placedCode] = await rows<{ code: string }>(tx, sql`select code from sales_order where id = ${id}`);
      await tx.execute(
        sql`insert into tender_event (tender_id, step, note, by_person)
          values (${input.tenderId}, ${linked.step}, ${`Order ${placedCode?.code ?? ""} placed for this award`}, ${me.id})`,
      );
      await logEvent(tx, id, me, "note", `Delivers the award of tender ${linked.code}.`);
    }
    if (options.inside) await options.inside(tx, id);
    // On along the line, by the switch at the top of the order form.
    await routeOrder(
      tx,
      me,
      id,
      options.leadId ? { management: options.toManagement ?? false, finance: true } : input.checks,
    );
    return id;
  });
}

/** A customer's address with their city after it, unless the address already ends with it
 *  ("2772 Roxas Blvd, Pasay" stays as it is). */
export function withCity(address: string | null, city: string | null): string | null {
  if (!address) return city || null;
  if (!city || address.toLowerCase().trimEnd().endsWith(city.toLowerCase())) return address;
  return `${address}, ${city}`;
}


export async function actOnOrder(
  db: Database,
  me: Me,
  id: number,
  action: OrderAction,
  input: {
    reason?: string | null;
    warehouseId?: number | null;
    finance?: boolean;
    /** Holding: wait until what it needs is on the shelf (the reason is worked out). */
    stock?: boolean;
    /** Taking it off hold: the step it goes on from (Management may pick an earlier one). */
    to?: OrderStatus;
  },
): Promise<OrderStatus> {
  const reason = clean(input.reason);
  let before: OrderStatus = "pending_approval";
  await db.transaction(async (tx) => {
    const [order] = await rows<{
      id: number;
      status: OrderStatus;
      raisedBy: number;
      medrepId: number;
      heldFrom: OrderStatus | null;
      heldRole: HoldRole | null;
      terms: string;
      code: string;
      leadId: number | null;
      financeCheck: boolean;
      takeBack: boolean;
      approvedBy: string | null;
      approverId: number | null;
      approved: boolean;
      restorable: boolean;
      paidIn: boolean;
      team: boolean;
      inScope: boolean;
    }>(
      tx,
      sql`select o.id::int as id, o.status, o.raised_by::int as "raisedBy", o.medrep_id::int as "medrepId", ${approverSql} as "approverId", o.held_from as "heldFrom",
          o.held_role as "heldRole", o.payment_terms as terms, o.code, o.lead_id::int as "leadId", o.finance_check as "financeCheck",
          ${takeBackSql} as "takeBack", (select p.name from person p where p.id = o.approved_by) as "approvedBy",
          o.approved_at is not null as approved, ${restorableSql} as restorable, ${paidInSql} as "paidIn",
          ${inTeamSql(me)} as team, ${inApprovalScopeSql(me)} as "inScope"
        from sales_order o where o.id = ${id} for update of o`,
    );
    if (!order) throw new Refusal(404, "not_found", "That order doesn't exist.");
    before = order.status;
    // Approving is for those whose divisions it is in (Admin → Who approves what).
    if (["approve", "send_back", "reject"].includes(action) && !order.inScope)
      throw new Refusal(
        403,
        "forbidden",
        `${order.code} is in a division you don't approve: it is for the Management of that division.`,
      );
    if (!orderActions(me, order)[action])
      throw new Refusal(
        409,
        "not_now",
        action === "take_back"
          ? `${order.code}'s approval can't be taken back now: it is past ${TAKE_BACK_MINUTES} minutes, or Finance or Dispatch has already worked on it. Put it on hold instead.`
          : `${order.code} is ${STATUS_LABEL[order.status]} now, so that can't be done. Reload it.`,
      );
    const needsReason: OrderAction[] = [
      "answer",
      "send_back",
      "reject",
      "hold",
      "exception",
      "cancel",
      "take_back",
      "restore",
    ];
    if (needsReason.includes(action) && !reason && !(action === "hold" && input.stock))
      throw new Refusal(400, "invalid", "Say why.", "reason");
    // Management says why a held order can go on (the hub's Resume); Finance and Dispatch lift
    // their own holds with a press.
    const managing = ORDER_MANAGE_ROLES.includes(me.role) || order.approverId === me.id;
    if (action === "resume" && managing && !reason)
      throw new Refusal(400, "invalid", "Say why it can go on.", "reason");
    if (action === "resubmit" && !reason)
      throw new Refusal(
        400,
        "invalid",
        "Tell Management what you fixed, or why it is right as it is.",
        "reason",
      );
    const set = (changes: SQL) =>
      tx.execute(sql`update sales_order set ${changes}, updated_at = now() where id = ${id}`);

    switch (action) {
      case "approve": {
        // Whenever a patient buys, the prescription is on the order before Management approves.
        const [rx] = await rows<{ patient: boolean; onFile: boolean }>(
          tx,
          sql`select (c.kind = 'patient' or o.patient_order) as patient,
              exists (select 1 from order_file f where f.order_id = o.id and f.active and f.kind = 'prescription') as "onFile"
            from sales_order o join customer c on c.id = o.customer_id where o.id = ${id}`,
        );
        if (rx?.patient && !rx.onFile)
          throw new Refusal(
            409,
            "no_prescription",
            "A patient's order is approved only with the prescription: attach it first (under Documents), or send it back for it.",
          );
        // Every check is fine or approved before the order is (Aryan, 22 Nov: "approve is blocked
        // until everything is checked"): Documents by hand always, the others when the system
        // found something on them.
        // What isn't on the shelf isn't approved (Aryan, 23 Nov: "not in stock: it stops right
        // there, on hold"): it went on to Finance and Dispatch with a whole invoice and stopped at
        // the packing table. Management holds it with Wait for stock, or changes its medicines.
        const short = await shortLines(tx, id);
        if (short.length)
          throw new Refusal(
            409,
            "short_stock",
            `Not in stock: ${shortWords(short)}. It can't be approved: press Wait for stock (it is held until the stock is in, and you are told), or change its medicines.`,
          );
        const open = await openChecks(tx, id);
        if (open.length)
          throw new Refusal(
            409,
            "checks_open",
            `Check first: ${open.map((key) => CHECK_LABEL[key]).join(", ")}. Open the order and approve each.`,
          );
        const [place] = input.warehouseId
          ? await rows<{ id: number; name: string }>(
              tx,
              sql`select id::int as id, name from warehouse where id = ${input.warehouseId} and active`,
            )
          : await rows<{ id: number; name: string }>(
              tx,
              sql`select id::int as id, name from warehouse where active order by is_default desc, id limit 1`,
            );
        if (!place)
          throw new Refusal(400, "invalid", "Pick the warehouse it ships from.", "warehouseId");
        // Enough in the company but not in the warehouse picked: Dispatch couldn't pack it there.
        const there = (await warehouseFill(tx, id))?.find((one) => one.id === place.id);
        if (there?.short.length)
          throw new Refusal(
            409,
            "short_stock",
            `${place.name} doesn't have enough: ${there.short.map((one) => `${one.medicine} (needs ${one.need.toLocaleString("en-PH")}, ${one.have.toLocaleString("en-PH")} there)`).join("; ")}. Pick another warehouse, or move stock there first.`,
            "warehouseId",
          );
        // Management says on approving whether Finance checks it too.
        const financeCheck = input.finance === undefined ? order.financeCheck : input.finance;
        if (financeCheck !== order.financeCheck)
          await tx.execute(
            sql`update sales_order set finance_check = ${financeCheck} where id = ${id}`,
          );
        // An order whose Finance check Management switched off goes to Dispatch with its invoice once
        // approved. An Online case's order goes to Finance like every other (Aryan, 18 Nov).
        if (!financeCheck) {
          await set(
            sql`warehouse_id = ${place.id}, approved_at = now(), approved_by = ${me.id}, flag_reason = null`,
          );
          await logEvent(
            tx,
            id,
            me,
            "status",
            `Approved. Ships from ${place.name.replace(/\.$/, "")}. It goes to Dispatch with its invoice.`,
            "approved",
          );
          await clearCaseOrder(tx, me, id);
          return;
        }
        const next = afterApproval(order.terms);
        await set(
          sql`status = ${next}, warehouse_id = ${place.id}, approved_at = now(), approved_by = ${me.id}, flag_reason = null`,
        );
        await logEvent(
          tx,
          id,
          me,
          "status",
          `Approved. Ships from ${place.name.replace(/\.$/, "")}. ${next === "ready_for_invoice" ? `${order.terms === "cod" ? "Cash on delivery" : "Credit customer"}: Finance checks what the customer owes and lets it go.` : "It goes to Finance to check the payment."}`,
          "approved",
        );
        // The invoice is made as Management approves (Aryan, 17 Nov).
        await invoiceOnApproval(tx, me, id);
        return;
      }
      case "send_back":
        await clearChecks(tx, id);
        await set(
          sql`status = 'draft', flag_reason = ${reason}, sent_back_count = sent_back_count + 1, sent_back_reason = ${reason},
            sent_back_at = now(), sent_back_by = ${me.id}, reply = null`,
        );
        return logEvent(
          tx,
          id,
          me,
          "status",
          `Sent back to the MedRep to fix and place again. Reason: ${reason}`,
        );
      // No longer offered (Aryan, 23 Nov: "Reject and Put on hold do the same: keep one"); kept
      // for an old page still open, where it does what it always did: a hold with its reason.
      case "reject":
        await set(
          sql`status = 'on_hold', held_from = 'pending_approval', held_role = 'management', flag_reason = ${reason}`,
        );
        return logEvent(tx, id, me, "status", `Rejected and put on hold. Reason: ${reason}`);
      case "hold": {
        const role: HoldRole =
          me.role === "finance" ? "finance" : me.role === "dispatch" ? "dispatch" : "management";
        if (input.stock) {
          const short = await shortLines(tx, id);
          if (!short.length)
            throw new Refusal(
              409,
              "in_stock",
              `Everything on ${order.code} is on the shelf: it doesn't need to wait.`,
            );
          const why = `Waiting for stock: ${shortWords(short)}${reason ? `. ${reason}` : ""}`;
          await set(
            sql`status = 'on_hold', held_from = ${order.status}, held_role = ${role}, flag_reason = ${why},
              waiting_stock_at = now(), waiting_stock_by = ${me.id}`,
          );
          return logEvent(
            tx,
            id,
            me,
            "status",
            `${why}. Held until it comes in; ${me.name} and the MedRep are told when it does.`,
          );
        }
        await set(
          sql`status = 'on_hold', held_from = ${order.status}, held_role = ${role}, flag_reason = ${reason}, reply = null`,
        );
        return logEvent(
          tx,
          id,
          me,
          "status",
          `Put on hold${role === "management" ? "" : ` by ${role === "finance" ? "Finance" : "Dispatch"}`}. Reason: ${reason}`,
        );
      }
      case "exception":
        await set(
          sql`status = 'exception', held_from = ${order.status}, held_role = 'management', flag_reason = ${reason}`,
        );
        return logEvent(tx, id, me, "status", `Marked as an exception. Reason: ${reason}`);
      case "resume": {
        const stopped = order.heldFrom ?? "pending_approval";
        // Where it stopped, or (Management) an earlier desk to look at it again.
        const choices = managing ? resumeChoices(order) : [stopped];
        const back = input.to ?? stopped;
        if (!choices.includes(back))
          throw new Refusal(
            400,
            "invalid",
            `${order.code} can go on only from ${choices.map((one) => STATUS_LABEL[one]).join(" or ")}.`,
            "to",
          );
        if (back !== stopped) {
          // Back before Finance's check: Finance looks again (nothing was paid on it).
          await set(sql`finance_checked_at = null, finance_checked_by = null`);
          await tx.execute(
            sql`update order_event set stage = null where order_id = ${id} and stage in ('finance_verified', 'paid')`,
          );
        }
        if (back === "pending_approval" && order.approved) {
          // Back to Management's approval: as if not yet approved; its invoice is made again
          // (the same number) when it is approved.
          await cancelInvoiceOf(tx, me, id, `Back to Management: ${reason ?? "taken off hold"}`);
          await set(sql`approved_at = null, approved_by = null`);
          // Its checks are looked at afresh, as after a take-back.
          await clearChecks(tx, id);
        }
        await set(
          sql`status = ${back}, held_from = null, held_role = null, flag_reason = null,
            waiting_stock_at = null, waiting_stock_by = null`,
        );
        return logEvent(
          tx,
          id,
          me,
          "status",
          `Taken off hold by ${me.name}: ${back === stopped ? "goes on from" : "back to"} ${STATUS_LABEL[back]}.${reason ? ` Why: ${reason}` : ""}`,
        );
      }
      case "restore": {
        // The hub's Restore: the cancelled order comes back to Management's approval, as it was;
        // the cancel stays on its timeline. Its invoice (if it had one) is made good again when
        // it is approved, and money received on it counts again then.
        await set(
          sql`status = 'pending_approval', approved_at = null, approved_by = null, finance_checked_at = null,
            finance_checked_by = null, held_from = null, held_role = null, flag_reason = null,
            waiting_stock_at = null, waiting_stock_by = null, packed_at = null, packed_by = null`,
        );
        // Its checks are looked at afresh: it is approved again like a new order.
        await clearChecks(tx, id);
        // Packed before the cancel: its pieces went back on the shelf, so it is packed afresh.
        await tx.execute(
          sql`update order_event set stage = null where order_id = ${id} and stage in ('finance_verified', 'paid', 'packed')`,
        );
        return logEvent(
          tx,
          id,
          me,
          "status",
          `Restored by ${me.name}: back with Management for approval. Why: ${reason}`,
        );
      }
      case "answer":
        // The hold stays until its desk takes it off; the answer is kept on the order too, so the
        // desk's card and page show it (it was only a line on the timeline, 23 Nov).
        await set(sql`reply = ${reason}`);
        return logEvent(tx, id, me, "note", `Answer to the hold, from ${me.name}: ${reason}`);
      case "cancel": {
        await set(sql`status = 'cancelled', flag_reason = ${reason ?? "Cancelled by the MedRep"}`);
        await logEvent(tx, id, me, "status", `Cancelled.${reason ? ` Reason: ${reason}` : ""}`);
        // Packed and not gone: the pieces go back on the shelf.
        const pieces = await putBack(
          tx,
          me,
          order,
          `Order cancelled${reason ? `: ${reason}` : ""}`,
        );
        if (pieces > 0)
          await logEvent(
            tx,
            id,
            me,
            "dispatch",
            `${pieces.toLocaleString("en-PH")} packed pieces back on the shelf.`,
          );
        await cancelInvoiceOf(tx, me, id, reason);
        // The points the customer used go back to them.
        const back = (await releaseOrderPoints(tx, me, id)) + (await releaseReservationOf(tx, id));
        if (back)
          await logEvent(
            tx,
            id,
            me,
            "payment",
            `${back.toLocaleString("en-PH")} points given back to the customer.`,
          );
        return;
      }
      case "resubmit":
        await set(
          sql`status = 'pending_approval', flag_reason = null, submitted_at = now(), reply = ${reason}`,
        );
        await logEvent(
          tx,
          id,
          me,
          "status",
          `Sent again to Management unchanged. ${me.name}'s answer: ${reason}`,
        );
        await routeOrder(tx, me, id);
        return;
      case "take_back": {
        // Back to Management's queue, as if never approved; an invoice made with the approval goes.
        // Its checks are looked at afresh.
        await clearChecks(tx, id);
        await cancelInvoiceOf(tx, me, id, `Approval taken back: ${reason}`);
        await set(
          sql`status = 'pending_approval', approved_at = null, approved_by = null, held_from = null, held_role = null`,
        );
        return logEvent(
          tx,
          id,
          me,
          "status",
          `Approval taken back by ${me.name}${order.approvedBy && order.approvedBy !== me.name ? ` (approved by ${order.approvedBy})` : ""}. Reason: ${reason}. It waits for Management again; Finance and Dispatch don't see it until it is approved.`,
        );
      }
      case "confirm_payment":
      case "make_invoice":
      case "pack":
      case "unpack":
      case "ship":
      case "deliver":
      case "failed":
        // Finance's and Dispatch's steps carry money or stock: they have their own addresses.
        throw new Refusal(400, "invalid", "That step has its own button.");
    }
  });
  return before;
}

/**
 * A MedRep fixes an order Management sent back and sends it to Management again: its medicines,
 * quantities and prices, the payment terms, the delivery and the note, with their answer to
 * Management's reason. The customer stays (another customer is a new order). Every change is
 * written on the order's timeline, so Management sees what was fixed beside the answer.
 */
export async function reviseOrder(
  db: Database,
  me: Me,
  id: number,
  input: OrderRevision,
  /** management: Management changes a placed order before approving it (it stays with them, the
   *  MedRep is told what changed and why). */
  by: "medrep" | "management" = "medrep",
): Promise<void> {
  const answer = clean(input.answer);
  if (!answer)
    throw new Refusal(
      400,
      "invalid",
      by === "management"
        ? "Say why you changed it: the MedRep is told."
        : "Tell Management what you fixed, or why it is right as it is.",
      "answer",
    );
  const today = todayManila();
  if (input.expectedOn && input.expectedOn < today)
    throw new Refusal(400, "invalid", "The delivery date has passed.", "expectedOn");
  const division = divisionPicked(input.division);
  // SC/PWD stays as the order has it unless the MedRep's fix says otherwise: a change never loses it.
  const [stored] = await rows<{
    kind: "senior" | "pwd" | null;
    idNo: string | null;
    name: string | null;
    lead: number | null;
    buyer: CustomerKind | null;
  }>(
    db,
    sql`select relief_kind as kind, relief_id_no as "idNo", relief_name as name, lead_id::int as lead,
        (select c.kind from customer c where c.id = sales_order.customer_id) as buyer
      from sales_order where id = ${id}`,
  );
  const relief =
    by === "medrep" && input.relief !== undefined
      ? await checkedRelief(input, !stored?.lead)
      : stored?.kind
        ? { kind: stored.kind, idNo: stored.idNo, name: stored.name }
        : null;
  // Its SC/PWD lines as they stand (a case's quote among them): sent back unchanged, they keep
  // their price rather than lose their VAT a second time or a lower quote.
  const kept = await rows<KeptRelief & { medicineId: number }>(
    db,
    sql`select medicine_id::int as "medicineId", unit_price::int as "unitPrice", price_kind as "priceKind",
        list_price::int as "listPrice", price_reason as reason
      from order_item where order_id = ${id} and relief and not free`,
  );
  const lines = await checkedLines(
    db,
    input,
    today,
    relief,
    false,
    new Map(kept.map(({ medicineId, ...line }) => [medicineId, line])),
    stored?.buyer ?? null,
  );
  await db.transaction(async (tx) => {
    // Changed: its checks are looked at afresh (19 Nov).
    await clearChecks(tx, id);
    const [order] = await rows<{
      status: OrderStatus;
      raisedBy: number;
      medrepId: number;
      customerId: number;
      code: string;
      deliveryFee: number;
      paymentTerm: string | null;
      paymentTerms: PaymentTerms;
      paymentDays: number | null;
      expectedOn: string | null;
      deliveryAddress: string | null;
      receiver: string | null;
      receiverPhone: string | null;
      customerPo: string | null;
      note: string | null;
      division: string | null;
      subDivision: string | null;
      team: boolean;
    }>(
      tx,
      sql`select o.status, o.raised_by::int as "raisedBy", o.medrep_id::int as "medrepId", o.customer_id::int as "customerId",
          o.code, o.delivery_fee::int as "deliveryFee", o.payment_term as "paymentTerm", o.payment_terms as "paymentTerms",
          o.payment_days::int as "paymentDays", ${day("o.expected_on")} as "expectedOn", o.delivery_address as "deliveryAddress",
          o.receiver, o.receiver_phone as "receiverPhone", o.customer_po as "customerPo", o.note, o.division, o.sub_division as "subDivision",
          ${inTeamSql(me)} as team
        from sales_order o where o.id = ${id} for update of o`,
    );
    if (!order) throw new Refusal(404, "not_found", "That order doesn't exist.");
    if (by === "management" ? !orderActions(me, order).approve : !orderActions(me, order).resubmit)
      throw new Refusal(
        409,
        "not_now",
        by === "management"
          ? `${order.code} isn't waiting for Management now, so it can't be changed. Reload it.`
          : `${order.code} isn't waiting for you to fix it now. Reload it.`,
      );
    if (input.customerId !== order.customerId)
      throw new Refusal(
        400,
        "invalid",
        "The customer can't change on a placed order. Cancel it and place a new one.",
        "customerId",
      );

    const before = await rows<{
      medicineId: number;
      name: string;
      qty: number;
      unitPrice: number;
      priceKind: string;
      free: boolean;
    }>(
      tx,
      sql`select i.medicine_id::int as "medicineId", m.name || coalesce(' ' || m.strength, '') as name, i.qty::int as qty,
          i.unit_price::int as "unitPrice", i.price_kind as "priceKind", i.free
        from order_item i join medicine m on m.id = i.medicine_id where i.order_id = ${id} order by i.id`,
    );
    const names = new Map(before.map((line) => [line.medicineId, line.name]));
    const missing = lines
      .filter((line) => !names.has(line.medicineId))
      .map((line) => line.medicineId);
    if (missing.length)
      for (const row of await rows<{ id: number; name: string }>(
        tx,
        sql`select id::int as id, name || coalesce(' ' || strength, '') as name from medicine where id in (${sql.join(
          missing.map((one) => sql`${one}`),
          sql`, `,
        )})`,
      ))
        names.set(row.id, row.name);
    const label = (line: { medicineId: number; free: boolean }) =>
      `${names.get(line.medicineId) ?? "A medicine"}${line.free ? " (free)" : ""}`;
    const same = (
      x: { medicineId: number; free: boolean },
      y: { medicineId: number; free: boolean },
    ) => x.medicineId === y.medicineId && x.free === y.free;
    const changes: string[] = [];
    for (const line of lines) {
      const was = before.find((old) => same(old, line));
      if (!was)
        changes.push(
          `added ${label(line)} × ${line.qty.toLocaleString("en-PH")}${line.free ? "" : ` at ${peso(line.unitPrice)}`}`,
        );
      else {
        if (was.qty !== line.qty)
          changes.push(
            `${label(line)}: ${was.qty.toLocaleString("en-PH")} → ${line.qty.toLocaleString("en-PH")}`,
          );
        if (!line.free && was.unitPrice !== line.unitPrice)
          changes.push(`${label(line)}: ${peso(was.unitPrice)} → ${peso(line.unitPrice)} each`);
        else if (!line.free && was.priceKind !== line.priceKind)
          changes.push(`${label(line)}: ${buyerLabel(was.priceKind)} price → ${buyerLabel(line.priceKind)} price`);
      }
    }
    if ((stored?.kind ?? null) !== (relief?.kind ?? null))
      changes.push(relief ? `${relief.kind === "senior" ? "senior citizen" : "PWD"} discount on` : "SC/PWD discount off");
    for (const old of before)
      if (!lines.some((line) => same(old, line))) changes.push(`took off ${label(old)}`);

    const paymentTerm = clean(input.paymentTerm) ?? order.paymentTerm;
    const terms = paymentTerm
      ? termsOfLabel(paymentTerm)
      : { terms: order.paymentTerms, days: order.paymentDays };
    const next = {
      paymentTerm,
      expectedOn: input.expectedOn || null,
      deliveryAddress: clean(input.deliveryAddress) ?? order.deliveryAddress,
      receiver: clean(input.receiver),
      receiverPhone: clean(input.receiverPhone),
      customerPo: clean(input.customerPo),
      note: clean(input.note),
      division: division ?? order.division,
      subDivision: clean(input.subDivision) ?? order.subDivision,
    };
    const WORDS: Record<keyof typeof next, string> = {
      paymentTerm: "payment terms",
      expectedOn: "delivery date",
      deliveryAddress: "delivery address",
      receiver: "receiver",
      receiverPhone: "receiver's phone",
      customerPo: "customer's PO",
      note: "note",
      division: "Division",
      subDivision: "Sub-division",
    };
    for (const key of Object.keys(next) as (keyof typeof next)[])
      if ((order[key] ?? null) !== (next[key] ?? null))
        changes.push(`${WORDS[key]}: ${order[key] ?? "—"} → ${next[key] ?? "—"}`);

    // The lines now are the newest version; every earlier one stays in order_version.
    await tx.execute(sql`delete from order_item where order_id = ${id}`);
    for (const line of lines)
      await tx.execute(
        sql`insert into order_item (order_id, medicine_id, qty, price_kind, list_price, unit_price, price_reason, relief, free, offer_id)
          values (${id}, ${line.medicineId}, ${line.qty}, ${line.priceKind}, ${line.listPrice}, ${line.unitPrice}, ${line.reason}, ${line.relief}, ${line.free}, ${line.offerId ?? null})`,
      );
    await tx.execute(
      sql`update sales_order set relief_kind = ${relief?.kind ?? null}, relief_id_no = ${relief?.idNo ?? null}, relief_name = ${relief?.name ?? null} where id = ${id}`,
    );
    const total =
      lines.reduce((sum, line) => sum + line.qty * line.unitPrice, 0) + order.deliveryFee;
    await tx.execute(
      sql`update sales_order set total = ${total}, payment_term = ${next.paymentTerm}, payment_terms = ${terms.terms},
          payment_days = ${terms.days}, pay_by = ${("payBy" in terms ? terms.payBy : null) ?? null},
          expected_on = ${next.expectedOn}, delivery_address = ${next.deliveryAddress},
          receiver = ${next.receiver}, receiver_phone = ${next.receiverPhone}, customer_po = ${next.customerPo}, note = ${next.note},
          invoice_from = coalesce(${input.invoiceFrom ?? null}, invoice_from), doctor_id = ${input.doctorId ?? null},
          division = ${next.division}, sub_division = ${next.subDivision},
          ${
            by === "management"
              ? sql``
              : sql`status = 'pending_approval', flag_reason = null, submitted_at = now(), reply = ${answer},
            no_proof_reason = ${input.noProofReason ?? null}, no_proof_note = ${clean(input.noProofNote)},
            source = coalesce(${input.source ?? null}, source), stock_reason = ${clean(input.stockReason)},
            patient_order = ${Boolean(input.patientOrder)}, patient_name = ${input.patientOrder ? clean(input.patientName) : null},
            order_type = coalesce(${input.type ?? null}, order_type),
            headquarter = coalesce(${clean(input.headquarter)}, headquarter), no_rx_reason = ${clean(input.noRxReason)},`
          }
          updated_at = now()
        where id = ${id}`,
    );
    if (by === "management") {
      if (!changes.length) throw new Refusal(400, "invalid", "Nothing was changed.", "answer");
      await saveVersion(tx, id, "changed", me, answer);
      await logEvent(
        tx,
        id,
        me,
        "status",
        `${me.name} changed the order before approving it: ${changes.join("; ")}. Why: ${answer}`,
      );
      await notify(tx, {
        to: [order.medrepId, order.raisedBy].filter((who) => who !== me.id),
        kind: "order_changed",
        title: `${me.name} changed your order ${order.code}`,
        body: `${changes.join("; ")}. Why: ${answer}`,
        link: `/orders/${id}`,
        orderId: id,
        key: `order:${id}:changed:${Date.now()}`,
      });
      return;
    }
    await saveVersion(tx, id, "fixed", me, answer);
    await logEvent(
      tx,
      id,
      me,
      "status",
      `${me.name} fixed it and sent it again to Management. Answer: ${answer}`,
    );
    if (changes.length) await logEvent(tx, id, me, "status", `Changed: ${changes.join("; ")}.`);
    await routeOrder(tx, me, id);
  });
}

/**
 * Management completes a field order before approving it (the MedRep sends a little; the rest is
 * Management's): its Division and Sub-division, the Payment Terms (which set how it is paid),
 * the receiver, the address, the day wanted, the customer's PO, the company that bills it and
 * the note. Until its invoice is made; each change is written on the order's timeline.
 */
export async function saveOrderDetails(
  db: Database,
  me: Me,
  id: number,
  input: OrderDetailsInput,
): Promise<void> {
  if (!ORDER_MANAGE_ROLES.includes(me.role))
    throw new Refusal(403, "not_allowed", "Only Management completes an order's details.");
  const division = divisionPicked(input.division);
  if (input.expectedOn && input.expectedOn < todayManila())
    throw new Refusal(400, "invalid", "The delivery date has passed.", "expectedOn");
  await db.transaction(async (tx) => {
    const [order] = await rows<{
      status: OrderStatus;
      code: string;
      division: string | null;
      subDivision: string | null;
      paymentTerm: string | null;
      receiver: string | null;
      receiverPhone: string | null;
      deliveryAddress: string | null;
      expectedOn: string | null;
      customerPo: string | null;
      invoiceFrom: string;
      note: string | null;
    }>(
      tx,
      sql`select status, code, division, sub_division as "subDivision", payment_term as "paymentTerm", receiver, receiver_phone as "receiverPhone",
          delivery_address as "deliveryAddress", ${day("expected_on")} as "expectedOn", customer_po as "customerPo", invoice_from as "invoiceFrom", note
        from sales_order where id = ${id} for update`,
    );
    if (!order) throw new Refusal(404, "not_found", "That order doesn't exist.");
    // The invoice is made as Management approves. Until money is on it and while the order is
    // still with Finance, a change of details updates it, as the hub's edit updated its Sales
    // Order; after that the details stay as invoiced.
    const [invoiced] = await rows<{ id: number; code: string; paid: number }>(
      tx,
      sql`select id::int as id, code, paid::int as paid from invoice where order_id = ${id} and status <> 'cancelled'`,
    );
    const replaceable =
      invoiced && invoiced.paid === 0 && FINANCE_STATUSES.includes(order.status);
    if (
      (invoiced && !replaceable) ||
      ["packing", "shipped", "completed", "cancelled"].includes(order.status)
    )
      throw new Refusal(
        409,
        "not_now",
        `${order.code} has its invoice already, so its details can't be changed now.`,
      );
    const next = {
      division,
      subDivision: clean(input.subDivision),
      paymentTerm: clean(input.paymentTerm),
      receiver: clean(input.receiver),
      receiverPhone: clean(input.receiverPhone),
      deliveryAddress: clean(input.deliveryAddress),
      expectedOn: input.expectedOn || null,
      customerPo: clean(input.customerPo),
      invoiceFrom: input.invoiceFrom ?? order.invoiceFrom,
      note: clean(input.note),
    };
    const LABEL: Record<keyof typeof next, string> = {
      division: "Division",
      subDivision: "Sub-division",
      paymentTerm: "Payment Terms",
      receiver: "Receiver",
      receiverPhone: "Receiver's contact",
      deliveryAddress: "Delivery address",
      expectedOn: "Expected shipment",
      customerPo: "Customer's PO",
      invoiceFrom: "Invoicing from",
      note: "Remarks",
    };
    const changed = (Object.keys(next) as (keyof typeof next)[]).filter(
      (key) => (order[key] ?? null) !== (next[key] ?? null),
    );
    if (changed.length === 0) return;
    const terms = next.paymentTerm ? termsOfLabel(next.paymentTerm) : null;
    await tx.execute(
      sql`update sales_order set division = ${next.division}, sub_division = ${next.subDivision}, payment_term = ${next.paymentTerm},
          receiver = ${next.receiver}, receiver_phone = ${next.receiverPhone}, delivery_address = ${next.deliveryAddress},
          expected_on = ${next.expectedOn}, customer_po = ${next.customerPo}, invoice_from = ${next.invoiceFrom}, note = ${next.note},
          ${terms ? sql`payment_terms = ${terms.terms}, payment_days = ${terms.days}, pay_by = ${terms.payBy ?? null},` : sql``} updated_at = now()
        where id = ${id}`,
    );
    // New terms at Finance move the order to the Finance step those terms take: advance has its
    // money checked, credit and cash on delivery go straight to their invoice.
    const step = terms ? afterApproval(terms.terms) : null;
    if (step && FINANCE_STATUSES.includes(order.status) && step !== order.status) {
      // (The order_step_moved trigger closes the old step's clock and opens the new one.)
      await tx.execute(
        sql`update sales_order set status = ${step}, status_since = now() where id = ${id}`,
      );
    }
    await logEvent(
      tx,
      id,
      me,
      "status",
      `${step && FINANCE_STATUSES.includes(order.status) && step !== order.status ? (step === "finance_check" ? "Now paid in advance: Finance checks the money first. " : "No advance payment now: Finance checks what the customer owes. ") : ""}Details completed: ${changed.map((key) => `${LABEL[key]} ${order[key] ?? "—"} → ${next[key] ?? "—"}`).join("; ")}.`,
    );
    // An unpaid invoice made on approval follows the new details (terms, due day, company).
    if (invoiced && replaceable) await refreshInvoice(tx, me, id);
  });
}

// ---------------------------------------------------------------- papers

const PAPER_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
];
export const PAPER_MAX_BYTES = 10 * 1024 * 1024;

/** The order a paper hangs on, if this person may see it. */
async function visibleOrder(db: Runner, me: Me, id: number) {
  const [order] = await rows<{
    status: OrderStatus;
    raisedBy: number;
    medrepId: number;
    code: string;
    heldFrom: OrderStatus | null;
    heldRole: HoldRole | null;
    leadId: number | null;
    team: boolean;
  }>(
    db,
    sql`${team(me)} select o.status, o.raised_by::int as "raisedBy", o.medrep_id::int as "medrepId", o.code, o.held_from as "heldFrom", o.held_role as "heldRole",
        o.lead_id::int as "leadId", ${inTeamSql(me)} as team
      from sales_order o where o.id = ${id} and ${seen(me)}`,
  );
  if (!order)
    throw new Refusal(404, "not_found", "That order isn't one of yours, or it doesn't exist.");
  return order;
}

/** The four checks Management approves one by one (Aryan, 19 Nov). */
export const CHECK_KEYS = ["papers", "price", "stock", "customer"] as const;
/** Finance's own, approved the same way when the system found something (19 Nov); its payment
 *  check is Confirm payment or sending the order on, as before. */
export const FINANCE_CHECK_KEYS = ["finance_papers", "finance_dues", "finance_credit"] as const;
export type OrderCheckKey = (typeof CHECK_KEYS)[number] | (typeof FINANCE_CHECK_KEYS)[number];
const CHECK_LABEL: Record<OrderCheckKey, string> = {
  papers: "Documents",
  price: "Medicines & price",
  stock: "Stock & warehouse",
  customer: "Customer & licence",
  finance_papers: "Papers (Finance)",
  finance_dues: "Owed from before",
  finance_credit: "Credit limit",
};

/** Management's checks still to approve on an order: Documents until someone read the papers, and
 *  each of the others the system found something on. The order's page shows the same (checks.tsx). */
export async function openChecks(tx: Runner, orderId: number): Promise<OrderCheckKey[]> {
  const read = await findingsOfOrder(tx, orderId);
  const kinds = new Set((read?.found ?? []).map((finding) => finding.kind));
  const [done] = await rows<{ keys: string[]; papers: boolean }>(
    tx,
    sql`select coalesce((select array_agg(k.check_key) from order_check k where k.order_id = o.id), '{}') as keys,
        o.papers_checked_at is not null as papers from sales_order o where o.id = ${orderId}`,
  );
  const approved = new Set(done?.keys ?? []);
  const open: OrderCheckKey[] = [];
  if (!approved.has("papers") && !done?.papers) open.push("papers");
  if ((kinds.has("price") || kinds.has("note")) && !approved.has("price")) open.push("price");
  if (kinds.has("stock") && !approved.has("stock")) open.push("stock");
  if ((["customer", "licence", "owes", "credit"] as const).some((kind) => kinds.has(kind)) && !approved.has("customer"))
    open.push("customer");
  return open;
}

/** Marks every Management check approved by this person: for the demo seeds and the tests, which
 *  approve orders without the screen. Never called from an address. */
export async function tickChecks(tx: Runner, orderId: number, personId: number): Promise<void> {
  for (const key of CHECK_KEYS)
    await tx.execute(
      sql`insert into order_check (order_id, check_key, by_person) values (${orderId}, ${key}, ${personId})
        on conflict (order_id, check_key) do nothing`,
    );
}

/** Clears an order's check approvals (all, or one): it is looked at afresh. */
export async function clearChecks(tx: Runner, orderId: number, key?: OrderCheckKey): Promise<void> {
  await tx.execute(
    key
      ? sql`delete from order_check where order_id = ${orderId} and check_key = ${key}`
      : sql`delete from order_check where order_id = ${orderId}`,
  );
}

/** Management approves one check of an order that the system found something on (Aryan, 19 Nov:
 *  "each with its own approve; what the system finds fine is ticked by itself"); Documents also
 *  marks its papers read by hand. The order itself is approved with the Approve action, once
 *  every check is fine or approved. */
export async function approveCheck(db: Database, me: Me, orderId: number, key: string): Promise<void> {
  const finance = (FINANCE_CHECK_KEYS as readonly string[]).includes(key);
  if (!finance && !(CHECK_KEYS as readonly string[]).includes(key))
    throw new Refusal(404, "not_found", "No such check.");
  const check = key as OrderCheckKey;
  const order = await visibleOrder(db, me, orderId);
  const [row] = await rows<{ approverId: number | null; status: string }>(
    db,
    sql`select ${approverSql} as "approverId", o.status from sales_order o where o.id = ${orderId}`,
  );
  if (finance) {
    // Finance's own checks, while the order is Finance's to check.
    if (!FINANCE_ROLES.includes(me.role)) throw new Refusal(403, "not_allowed", "Finance approves its own checks.");
    if (row?.status !== "finance_check" && row?.status !== "ready_for_invoice")
      throw new Refusal(409, "not_now", `${order.code} isn't with Finance now. Reload it.`);
  } else {
    const decides = ORDER_MANAGE_ROLES.includes(me.role) || (row?.approverId != null && row.approverId === me.id);
    if (!decides) throw new Refusal(403, "not_allowed", "Management approves an order's checks.");
    if (row?.status !== "pending_approval")
      throw new Refusal(409, "not_now", `${order.code} isn't waiting for approval now. Reload it.`);
    // Short stock isn't approved away (23 Nov): the order waits for the stock, or its medicines change.
    if (check === "stock") {
      const short = await shortLines(db, orderId);
      if (short.length)
        throw new Refusal(409, "short_stock", `Not in stock: ${shortWords(short)}. Press Wait for stock, or change the medicines.`);
    }
  }
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`insert into order_check (order_id, check_key, by_person) values (${orderId}, ${check}, ${me.id})
        on conflict (order_id, check_key) do update set by_person = excluded.by_person, at = now()`,
    );
    if (check === "papers")
      await tx.execute(
        sql`update sales_order set papers_checked_by = ${me.id}, papers_checked_at = now() where id = ${orderId} and papers_checked_at is null`,
      );
    await logEvent(tx, orderId, me, "check", `${CHECK_LABEL[check]}: approved by ${me.name}.`);
  });
}

/** A guarantee letter's number and the amount the agency approves for our quotation (Aryan, 19 Nov:
 *  "we don't know it before; at the end we write what we got"). Written by the order's MedRep,
 *  Management or Finance once the letter is in, on a guarantee letter's order not cancelled. */
export async function setOrderGl(
  db: Database,
  me: Me,
  orderId: number,
  input: { number?: string | null; amount?: number | null },
): Promise<void> {
  const order = await visibleOrder(db, me, orderId);
  const [row] = await rows<{ type: string | null; status: string; medrepId: number; raisedBy: number }>(
    db,
    sql`select order_type as type, status, medrep_id::int as "medrepId", raised_by::int as "raisedBy" from sales_order where id = ${orderId}`,
  );
  const writes =
    ORDER_MANAGE_ROLES.includes(me.role) ||
    FINANCE_ROLES.includes(me.role) ||
    row?.medrepId === me.id ||
    row?.raisedBy === me.id;
  if (!writes) throw new Refusal(403, "not_allowed", "The order's MedRep, Management or Finance writes the letter's amount.");
  if (row?.type !== "gl") throw new Refusal(409, "not_now", `${order.code} isn't a guarantee letter's order.`);
  if (row.status === "cancelled") throw new Refusal(409, "not_now", `${order.code} is cancelled.`);
  const number = clean(input.number);
  const amount = input.amount ?? null;
  if (!number && amount === null) throw new Refusal(400, "invalid", "Type the letter's number or its amount.", "amount");
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`update sales_order set gl_number = ${number}, gl_amount = ${amount}, gl_set_by = ${me.id}, gl_set_at = now() where id = ${orderId}`,
    );
    await logEvent(
      tx,
      orderId,
      me,
      "note",
      `Guarantee letter${number ? ` ${number}` : ""}: ${amount === null ? "amount not in yet" : `${peso(amount)} approved`} (written by ${me.name}).`,
    );
  });
}

/** Keeps a paper (a photo or PDF) on an order and writes it to the order's timeline. */
/** Management says an order's papers are right, having looked at each by hand (Aryan, 19 Nov: a
 *  prescription is read, never ticked by the system); `ok: false` takes it back. While the order is
 *  Management's (or the PAP head's) to decide. */
export async function checkPapers(db: Database, me: Me, orderId: number, ok: boolean): Promise<void> {
  const order = await visibleOrder(db, me, orderId);
  const [row] = await rows<{ approverId: number | null; status: string; checked: boolean }>(
    db,
    sql`select ${approverSql} as "approverId", o.status, o.papers_checked_at is not null as checked from sales_order o where o.id = ${orderId}`,
  );
  const decides = ORDER_MANAGE_ROLES.includes(me.role) || (row?.approverId != null && row.approverId === me.id);
  if (!decides) throw new Refusal(403, "not_allowed", "Management checks an order's papers.");
  if (!row || ["cancelled", "completed"].includes(row.status))
    throw new Refusal(409, "not_now", `${order.code}'s papers can't be checked now.`);
  if (row.checked === ok) return;
  await db.transaction(async (tx) => {
    await tx.execute(
      ok
        ? sql`update sales_order set papers_checked_by = ${me.id}, papers_checked_at = now() where id = ${orderId}`
        : sql`update sales_order set papers_checked_by = null, papers_checked_at = null where id = ${orderId}`,
    );
    if (!ok) await clearChecks(tx, orderId, "papers");
    await logEvent(tx, orderId, me, "paper", ok ? "Papers checked by hand: right." : "Papers check taken back: to look at again.");
  });
}

export async function addPaper(
  db: Database,
  me: Me,
  orderId: number,
  paper: { kind: string; name: string; mime: string; bytes: Uint8Array },
): Promise<number> {
  const order = await visibleOrder(db, me, orderId);
  if (!PAPER_KINDS.includes(paper.kind as PaperKind))
    throw new Refusal(400, "invalid", "Say what the paper is.", "kind");
  if (!mayAddPaper(me, order, paper.kind as PaperKind))
    throw new Refusal(403, "not_allowed", `Papers can't be added to ${order.code} now.`);
  if (!PAPER_TYPES.includes(paper.mime))
    throw new Refusal(400, "invalid", "Attach a photo or a PDF.", "file");
  if (paper.bytes.byteLength === 0)
    throw new Refusal(400, "invalid", "That file is empty.", "file");
  if (paper.bytes.byteLength > PAPER_MAX_BYTES)
    throw new Refusal(400, "invalid", "That file is over 10 MB. Take the photo again.", "file");
  const kept = await keepFile("orders", {
    name: paper.name.trim().slice(0, 120) || "paper",
    mime: paper.mime,
    bytes: paper.bytes,
  });
  const name = kept.name;
  return db.transaction(async (tx) => {
    const [made] = await rows<{ id: number }>(
      tx,
      sql`insert into order_file (order_id, kind, name, mime, size, data, store_key, by_person)
        values (${orderId}, ${paper.kind}, ${name}, ${kept.mime}, ${kept.size}, ${kept.data}, ${kept.key}, ${me.id})
        returning id::int as id`,
    );
    await logEvent(
      tx,
      orderId,
      me,
      "paper",
      `${PAPER_LABEL[paper.kind as PaperKind]} attached (${name}).`,
    );
    // A new paper (not Finance's proof, not Dispatch's receipt) is Management's to look at again.
    if (paper.kind !== "payment_proof" && paper.kind !== "dr") {
      await tx.execute(sql`update sales_order set papers_checked_by = null, papers_checked_at = null where id = ${orderId} and papers_checked_at is not null`);
      await clearChecks(tx, orderId, "papers");
    }
    // Finance held it for want of the proof: the proof sends it back to Finance by itself.
    if (
      paper.kind === "payment_proof" &&
      order.status === "on_hold" &&
      order.heldFrom === "finance_check" &&
      // Only Finance's own hold: one Management placed at this step stays until Management lifts it.
      order.heldRole !== "management"
    ) {
      await tx.execute(
        sql`update sales_order set status = 'finance_check', held_from = null, flag_reason = null, updated_at = now() where id = ${orderId}`,
      );
      await logEvent(
        tx,
        orderId,
        me,
        "status",
        "Proof of payment added: back with Finance to check.",
      );
    }
    return made?.id as number;
  });
}

/** One paper's bytes, for someone who may see its order. */
export async function readPaper(
  db: Database,
  me: Me,
  paperId: number,
): Promise<{ name: string; mime: string; bytes: Uint8Array }> {
  const [paper] = await rows<{
    orderId: number;
    name: string;
    mime: string;
    data: Uint8Array | null;
    key: string | null;
  }>(
    db,
    sql`select order_id::int as "orderId", name, mime, data, store_key as key from order_file where id = ${paperId} and active`,
  );
  if (!paper) throw new Refusal(404, "not_found", "That paper isn't there any more.");
  await visibleOrder(db, me, paper.orderId);
  return { name: paper.name, mime: paper.mime, bytes: await bytesOf(paper) };
}

/** Takes a paper off an order. It is kept, marked removed, and the timeline says so. */
export async function removePaper(db: Database, me: Me, paperId: number): Promise<void> {
  const [paper] = await rows<{ orderId: number; kind: PaperKind; name: string }>(
    db,
    sql`select order_id::int as "orderId", kind, name from order_file where id = ${paperId} and active`,
  );
  if (!paper) throw new Refusal(404, "not_found", "That paper isn't there any more.");
  const order = await visibleOrder(db, me, paper.orderId);
  if (!mayAddPaper(me, order, paper.kind))
    throw new Refusal(403, "not_allowed", `Papers on ${order.code} can't be changed now.`);
  await db.transaction(async (tx) => {
    await tx.execute(sql`update order_file set active = false where id = ${paperId}`);
    await logEvent(
      tx,
      paper.orderId,
      me,
      "paper",
      `${PAPER_LABEL[paper.kind]} removed (${paper.name}).`,
    );
  });
}

/** Who in Management is handling an order: everyone sees every order; one says "I'll handle it"
 *  and the others see who. Taking one someone else has says so on the timeline. */
export async function handleOrder(
  db: Database,
  me: Me,
  orderId: number,
  release: boolean,
): Promise<void> {
  if (!ORDER_MANAGE_ROLES.includes(me.role))
    throw new Refusal(403, "not_allowed", "Only Management handles an order here.");
  await db.transaction(async (tx) => {
    const [order] = await rows<{
      code: string;
      status: OrderStatus;
      heldRole: HoldRole | null;
      by: number | null;
      name: string | null;
    }>(
      tx,
      sql`select o.code, o.status, o.held_role as "heldRole", o.manage_by::int as by, p.name
        from sales_order o left join person p on p.id = o.manage_by where o.id = ${orderId} for update of o`,
    );
    if (!order) throw new Refusal(404, "not_found", "That order doesn't exist.");
    const managements =
      order.status === "pending_approval" ||
      ((order.status === "on_hold" || order.status === "exception") &&
        (order.heldRole ?? "management") === "management");
    if (!managements)
      throw new Refusal(409, "not_now", `${order.code} isn't with Management now. Reload it.`);
    if (release) {
      if (order.by !== me.id) return;
      await tx.execute(
        sql`update sales_order set manage_by = null, manage_by_at = null where id = ${orderId}`,
      );
      await tx.execute(
        sql`insert into order_assignment (order_id, desk, person_id, how, by_person) values (${orderId}, 'management', ${me.id}, 'released', ${me.id})`,
      );
      await logEvent(
        tx,
        orderId,
        me,
        "note",
        `${me.name} let it go: anyone in Management can take it.`,
      );
      return;
    }
    if (order.by === me.id) return;
    await tx.execute(
      sql`update sales_order set manage_by = ${me.id}, manage_by_at = now() where id = ${orderId}`,
    );
    await tx.execute(
      sql`insert into order_assignment (order_id, desk, person_id, how, by_person) values (${orderId}, 'management', ${me.id}, 'took', ${me.id})`,
    );
    await logEvent(
      tx,
      orderId,
      me,
      "note",
      order.by ? `${me.name} took it over from ${order.name}.` : `${me.name} is handling it.`,
    );
  });
}
