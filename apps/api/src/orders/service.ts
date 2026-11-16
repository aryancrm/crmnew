// Orders: placing one, what Management does with it, and the lists and figures its screens
// show. Every change is one transaction that also writes the order's timeline.

import { bytesOf, keepFile } from "../files/store";
import { type SQL, sql } from "drizzle-orm";
import { customerDetail } from "../customers/service";
import { type Database, rows } from "../db/index";
import { dispatchCounts, putBack } from "../dispatch/service";
import {
  cancelInvoiceOf,
  clearCaseOrder,
  financeCounts,
  moneyOf,
  orderMoney,
} from "../finance/service";
import { Refusal } from "../http";
import { buyerLabel, todayManila } from "../inventory/rules";
import { clean, day, iso, PROMISED_ORDER, type Runner, warehouses } from "../inventory/service";
import { notify } from "../notify/service";
import { reliefPrice } from "../online/rules";
import { inForce } from "../org/service";
import { ROLE_LABEL, type Role } from "../people/roles";
import { releaseOrderPoints } from "../points/service";
import { releaseReservationOf } from "../points/website";
import type {
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
  OrderRevision,
  OrderRow,
  OrderStage,
  OrderStatus,
  PaperKind,
  PaymentTerms,
  Vat,
} from "../types";
import { stuckNow } from "./clock";
import { DIVISIONS, subDivisionOfArea, termsOfLabel } from "./divisions";
import { logEvent, peso } from "./events";
import {
  CASE_AGENT_ROLES,
  caseChecksOf,
  DESK_HOME,
  DESK_TABS,
  FINANCE_STATUSES,
  holder,
  INVOICE_FROM_LABEL,
  mayAddPaper,
  NEVER_STUCK,
  NEXT_OF,
  ORDER_ALL_ROLES,
  ORDER_MANAGE_ROLES,
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

/** Which orders (alias `o`) this person may see. Needs `team` in front of the query. */
function seen(me: Me): SQL {
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

const rowColumns = sql`
  o.id::int as id, o.code, o.customer_id::int as "customerId", c.name as customer, rep.name as medrep,
  o.status, (o.payment_terms = 'days') as credit, o.total::int as total, o.delivery_fee::int as "deliveryFee", o.points_used::int as "pointsUsed",
  ${iso("o.created_at")} as "createdAt", ${iso("o.updated_at")} as "updatedAt", o.flag_reason as "flagReason",
  o.patient_order as "patientOrder", o.patient_name as "patientName"`;

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
  and not exists (select 1 from invoice i where i.order_id = o.id and i.status <> 'cancelled' and i.paid > 0))`;
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
  relief: boolean;
  vat: Vat;
  /** The price the customer's own kind pays (a hospital's hospital price), if the list has one. */
  ownPrice: number | null;
  ownKind: string;
  /** The medicine needs a prescription. */
  rx: boolean;
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
          priceLabel: item.priceKind === "promo" ? "Promo" : buyerLabel(item.priceKind),
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
  },
  money?: { owes: Money | undefined; creditLimit: number | null; total: number },
): OrderFinding[] {
  const found: OrderFinding[] = [];
  // A patient's order (their own, or for them through a hospital): Management checks the
  // prescription for a prescription medicine, and the patient's ID.
  if (customer.kind === "patient" || customer.patientOrder) {
    if (items.some((item) => item.rx) && !customer.papers.includes("prescription"))
      found.push({
        kind: "rx",
        short: "No prescription",
        decide: "a prescription medicine, no prescription attached",
        text: "A prescription medicine is on it and no prescription is attached",
      });
    if (!customer.papers.includes("valid_id") && !customer.papers.includes("senior_id"))
      found.push({
        kind: "rx",
        short: "No patient ID",
        decide: "the patient's ID isn't attached",
        text: "The patient's ID isn't attached",
      });
  }
  for (const item of items) {
    // Free goods (a Buy 1 Take 1, a sample) are Management's to agree to.
    if (item.free)
      found.push({
        kind: "price",
        short: "Free goods",
        decide: `${item.medicine} × ${item.qty.toLocaleString("en-PH")} given free`,
        text: `Free: ${item.medicine} × ${item.qty.toLocaleString("en-PH")}${item.reason && item.reason !== "Free" ? ` (${item.reason})` : ""}`,
      });
    // A senior citizen's or PWD's line is below the list by law; only lower than that is a finding.
    const floor = item.relief ? reliefPrice(item.listPrice, item.vat) : item.listPrice;
    if (!item.free && item.unitPrice < floor)
      found.push({
        kind: "price",
        short: `Below ${item.priceLabel.toLowerCase()} price`,
        decide: `${item.medicine} given at ${peso(item.unitPrice)}, ${item.priceLabel.toLowerCase()} price is ${peso(item.listPrice)}`,
        text: `${item.medicine}: given at ${peso(item.unitPrice)}, ${item.priceLabel} price is ${peso(item.listPrice)} (${peso((item.listPrice - item.unitPrice) * item.qty)} less in all)${item.reason ? `. Reason: ${item.reason}` : ""}`,
      });
    // Priced as another kind of buyer, cheaper than this customer's own (a distributor's price
    // given to a hospital): Management sees it, whatever the reason typed.
    if (
      !item.free &&
      !item.relief &&
      item.priceKind !== "promo" &&
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
    if (item.inStock < item.qty)
      found.push({
        kind: "stock",
        short: "Stock short",
        decide: `${item.medicine}: ${item.qty.toLocaleString("en-PH")} ordered, ${item.inStock.toLocaleString("en-PH")} free (after earlier orders)`,
        text: `${item.medicine}: ${item.qty.toLocaleString("en-PH")} ordered, ${item.inStock.toLocaleString("en-PH")} free on the shelf after the orders placed before it`,
      });
  }
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
  }>(
    db,
    sql`select o.customer_id::int as "customerId", c.review, c.kind, o.payment_terms as terms, c.credit_limit::int as "creditLimit", o.patient_order as "patientOrder",
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
    },
    { owes: money.get(order.customerId), creditLimit: order.creditLimit, total: order.total },
  );
  return { order, found };
}

/** What holds an Online case's order for Management (none: it goes straight to Dispatch). */
export async function caseOrderChecks(db: Runner, orderId: number): Promise<OrderFinding[]> {
  const read = await findingsOfOrder(db, orderId);
  return read ? caseChecksOf(read.found, read.order) : [];
}

/**
 * Sends a just-placed order on along the order line, by the switch at the top of its form:
 * to Management or not, to Finance or not. Management sees it anyway when the system finds
 * something wrong on it (a price below the list, over the credit limit, money overdue, a new
 * business customer, an expired licence; a missing proof of payment while Finance is off).
 * Without a choice (older callers) every MedRep order goes to Management and then Finance, as
 * before. An Online case's order never waits for Finance (its agent takes the money) and goes
 * to Management only for what `caseChecksOf` finds or when the agent asks. Management's own
 * order skips Management. Short stock is never Management's: Dispatch sees it.
 */
export async function routeOrder(
  tx: Runner,
  me: Me,
  orderId: number,
  choice?: OrderChecks,
): Promise<"management" | "finance" | "dispatch"> {
  const read = await findingsOfOrder(tx, orderId);
  if (!read) return "management";
  const { order, found } = read;
  const fromCase = Boolean(order.leadId);
  const manages = ORDER_MANAGE_ROLES.includes(me.role);
  const [kept] = await rows<{ finance: boolean }>(
    tx,
    sql`select finance_check as finance from sales_order where id = ${orderId}`,
  );
  const financeStep = !fromCase && (choice ? choice.finance : (kept?.finance ?? true));
  await tx.execute(
    sql`update sales_order set finance_check = ${financeStep} where id = ${orderId}`,
  );
  if (!manages && !fromCase && !choice) return "management";
  const checks = manages
    ? []
    : fromCase
      ? caseChecksOf(found, order)
      : // A proof of payment is Finance's to check while Finance is on.
        found.filter(
          (finding) => finding.kind !== "stock" && (financeStep ? finding.kind !== "papers" : true),
        );
  if (checks.length > 0) {
    await logEvent(
      tx,
      orderId,
      me,
      "status",
      `Management checks it first: ${checks.map((check) => check.short.toLowerCase()).join(", ")}.`,
    );
    return "management";
  }
  if (!manages && choice?.management) {
    await logEvent(tx, orderId, me, "status", `${me.name} sent it to Management to check.`);
    return "management";
  }
  const why = "Nothing for Management to check";
  if (financeStep) {
    if (!manages) {
      const next = afterApproval(order.terms);
      const [place] = await rows<{ id: number }>(
        tx,
        sql`select id::int as id from warehouse where active order by is_default desc, id limit 1`,
      );
      await tx.execute(
        sql`update sales_order set status = ${next}, approved_at = now(), warehouse_id = coalesce(warehouse_id, ${place?.id ?? null}), updated_at = now() where id = ${orderId}`,
      );
      await logEvent(tx, orderId, me, "status", `${why}: it goes to Finance.`, "approved");
    }
    return "finance";
  }
  await clearCaseOrder(
    tx,
    me,
    orderId,
    manages ? undefined : `${why}: it goes to Dispatch with its invoice.`,
  );
  return "dispatch";
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
      where ${seen(me)} and o.status = 'pending_approval'
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
      findings: leadId ? caseChecksOf(found, { kind, terms, gl }) : found,
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
/** Who decides this order instead of Management: a PAP order's channel head (patient
 *  assistance is approved apart, Aryan). None for every other order. */
const approverSql = sql`(select ch2.head_id::int from channel ch2 where ch2.id = o.channel_id and ch2.code = 'PAP')`;

const cardColumns = sql`${rowColumns}, o.medrep_id::int as "medrepId", ${approverSql} as "approverId",
  (select ap.name from person ap where ap.id = ${approverSql}) as "approverName", ${sentBackColumns},
  ${iso("o.approved_at")} as "approvedAt", ${takeBackSql} as "takeBack", ${iso("o.status_since")} as "stepSince",
  o.delivery_address as "deliveryAddress", o.receiver, o.receiver_phone as "receiverPhone", ${day("o.expected_on")} as "expectedOn",
  (select coalesce(sum(i.qty), 0) from order_item i where i.order_id = o.id)::int as pieces,
  (select p.name from person p where p.id = o.dispatch_by) as "dispatchBy", o.dispatch_by::int as "dispatchById",
  (select p.name from person p where p.id = o.manage_by) as "handledBy", o.manage_by::int as "handledById",
  o.came_back_count::int as "cameBackCount", o.came_back_reason as "cameBackReason", c.kind as "customerKind", c.city as "customerCity", ch.code as channel, a.name as area,
  o.payment_terms as "paymentTerms", o.payment_days::int as "paymentDays",
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
        : `Make the invoice (${row.paymentTerms === "days" ? `pays in ${row.paymentDays} days` : "cash on delivery"})`;
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
      // A PAP order is approved by the PAP head, not Management.
      const who = row.approverName ? `${row.approverName} (PAP head)` : "Management";
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
  const [items, papers, money] = await Promise.all([
    itemsOf(db, ids),
    papersOf(db, ids),
    moneyOf(
      db,
      found.map((row) => row.customerId),
    ),
  ]);
  return found.map((row) => {
    const { review, licenceExpired, creditLimit, gl, ...shown } = row;
    const { heldFrom } = row;
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
          },
          { owes: money.get(row.customerId), creditLimit, total: row.total },
        )
      : [];
    // An Online case's order waits only on what sent it to Management.
    const all = row.leadId
      ? caseChecksOf(found, { kind: row.customerKind, terms: row.paymentTerms, gl })
      : found;
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
  if (filter.channel) narrowed.push(sql`ch.code = ${filter.channel}`);
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
  const notMine =
    desk === "management"
      ? sql` and not (o.status = 'pending_approval' and ${approverSql} is not null and ${approverSql} <> ${me.id})`
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
      sql`${team(me)} select rep.id::int as id, rep.name, rch.code as channel, ra.name as area,
          count(*)::int as orders, coalesce(sum(o.total), 0)::int as value,
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
    channels: [
      ...new Set(choices.map((row) => row.channel).filter((code): code is string => Boolean(code))),
    ].sort(),
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
  filter: { stage?: string; page?: number; seat?: number },
): Promise<MyOrders> {
  const stage: MyOrderStage =
    filter.stage && filter.stage in MY_STAGES ? (filter.stage as MyOrderStage) : "all";
  const page = Math.max(1, Math.floor(filter.page ?? 1) || 1);
  const pageSize = 20;
  // One seat of the team (a lead's person page): everything below reads only its orders.
  const scope = filter.seat ? sql`${seen(me)} and o.seat_id = ${filter.seat}` : seen(me);
  const where = stage === "all" ? scope : sql`${scope} and ${MY_STAGES[stage]}`;
  const thisMonth = sql`date_trunc('month', o.created_at at time zone 'Asia/Manila') = date_trunc('month', now() at time zone 'Asia/Manila')`;
  const placed = sql`o.status not in ('draft', 'cancelled')`;
  const [counts, held, sales, found] = await Promise.all([
    rows<Record<MyOrderStage, number>>(
      db,
      sql`${team(me)} select count(*)::int as "all",
          count(*) filter (where ${MY_STAGES.sent_back})::int as sent_back,
          count(*) filter (where ${MY_STAGES.management})::int as management,
          count(*) filter (where ${MY_STAGES.finance})::int as finance,
          count(*) filter (where ${MY_STAGES.dispatch})::int as dispatch,
          count(*) filter (where ${MY_STAGES.held})::int as held,
          count(*) filter (where ${MY_STAGES.delivered})::int as delivered
        from sales_order o where ${scope}`,
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
    }
  >(
    db,
    sql`${team(me)} select ${rowColumns}, ${caseColumns}, c.kind as "customerKind", c.city as "customerCity", c.review as "customerReview",
        coalesce(c.licence_expires < (now() at time zone 'Asia/Manila')::date, false) as "licenceExpired",
        c.licence_no as "licenceNo", ${day("c.licence_expires")} as "licenceExpires", c.tin,
        o.no_proof_reason as "noProofReason", o.no_proof_note as "noProofNote", ${approverSql} as "approverId",
        (select ap.name from person ap where ap.id = ${approverSql}) as "approverName",
        (o.finance_checked_by = ${me.id} and o.status = 'ready_for_dispatch' and coalesce(o.points_used, 0) = 0
          and now() - o.finance_checked_at <= interval '90 seconds') as undoable,
        (select coalesce(json_agg(json_build_object('id', f.id, 'name', f.name) order by f.id), '[]'::json)
          from order_file f where f.order_id = o.id and f.active and f.hold_event_id is not null
            and o.status in ('on_hold', 'exception')
            and f.hold_event_id = (select max(g.hold_event_id) from order_file g where g.order_id = o.id and g.active))
          as "holdProofs",
        raiser.name as "raisedBy", o.raised_by::int as "raisedById", o.medrep_id::int as "medrepId",
        ch.code as channel, a.name as area,
        o.payment_terms as "paymentTerms", o.payment_days::int as "paymentDays",
        o.delivery_address as "deliveryAddress", o.receiver, o.receiver_phone as "receiverPhone", o.note,
        o.customer_po as "customerPo", o.invoice_from as "invoiceFrom", o.doctor_id::int as "doctorId", doc.name as doctor,
        ${day("o.expected_on")} as "expectedOn", o.warehouse_id::int as "warehouseId", w.name as warehouse,
        o.held_from as "heldFrom", ${iso("o.submitted_at")} as "submittedAt", ${iso("o.approved_at")} as "approvedAt",
        approver.name as "approvedBy", c.credit_limit::int as "creditLimit", o.held_role as "heldRole",
        o.delivery_method as "deliveryMethod", o.courier, o.tracking, o.rider,
        ${iso("o.packed_at")} as "packedAt", packer.name as "packedBy", ${iso("o.shipped_at")} as "shippedAt", shipper.name as "shippedBy",
        ${day("o.delivered_on")} as "deliveredOn", deliverer.name as "deliveredBy", o.received_by as "receivedBy",
        o.division, o.sub_division as "subDivision", o.payment_term as "paymentTerm", o.finance_check as "financeCheck",
        ${sentBackColumns}, ${iso("o.sent_back_at")} as "sentBackAt",
        case when ${takeBackSql} then ${iso(`(o.approved_at + make_interval(mins => ${TAKE_BACK_MINUTES}))`)} end as "takeBackUntil"
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
  const [items, events, places, papers, money, owes, picks, steps] = await Promise.all([
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
    moneyOf(db, [order.customerId]),
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
  ]);
  const { raisedById, medrepId, licenceExpired, creditLimit, gl, undoable, approverId, ...shown } =
    order;
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
  };
  const found = findingsOf(
    items,
    {
      review: order.customerReview,
      licenceExpired,
      kind: order.customerKind,
      terms: order.paymentTerms,
      papers: onFile,
      patientOrder: order.patientOrder,
    },
    money.invoice
      ? undefined
      : { owes: owes.get(order.customerId), creditLimit, total: order.total },
  );
  return {
    order: {
      ...labelled(shown),
      // Delivered and paid is complete; delivered with money still owed says just that.
      ...(shown.status === "completed" && money.invoice?.status === "paid"
        ? { statusLabel: "Completed" }
        : {}),
      invoiceFromLabel: INVOICE_FROM_LABEL[order.invoiceFrom],
    },
    items: items.map(({ orderId: _orderId, ...item }) => item),
    papers: papers.map((paper) => ({ ...paper, kindLabel: PAPER_LABEL[paper.kind] })),
    paperList: paperList(
      {
        kind: order.customerKind,
        terms: order.paymentTerms,
        days: order.paymentDays,
        patient: order.customerKind === "patient" || order.patientOrder,
        rx: items.some((item) => item.rx),
      },
      onFile,
    ),
    // An Online case's order is held only for what sends it to Management.
    findings: order.leadId
      ? caseChecksOf(found, { kind: order.customerKind, terms: order.paymentTerms, gl })
      : found,
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
    warehouseFill: orderActions(me, who).approve ? await warehouseFill(db, id) : null,
    money,
    picks,
    can: {
      ...orderActions(me, who),
      addPaper: mayAddPaper(me, who, "po"),
      addProof: mayAddPaper(me, who, "payment_proof"),
      addDr: mayAddPaper(me, who, "dr"),
      // Finance, or for an Online case's order the Online desk, records the money received.
      recordPayment:
        (orderCan(me).finance || (Boolean(order.leadId) && CASE_AGENT_ROLES.includes(me.role))) &&
        money.invoice?.status === "open",
      waitStock: orderActions(me, who).hold && (await shortLines(db, id)).length > 0,
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
  relief?: boolean;
  leadId?: number;
  /** What the customer pays for delivery (a website order's fee), on top of the medicines. */
  deliveryFee?: number;
  inside?: (tx: Runner, orderId: number) => Promise<void>;
  /** An Online case's order: the agent asks Management to check it although nothing is wrong. */
  toManagement?: boolean;
};

/** The order's lines checked and priced, the same for a new order and a fixed one: each
 *  medicine on it once (a second line only as free goods), something paid for, a price of the
 *  kind picked, and a reason for any price given below it. */
async function checkedLines(db: Runner, input: OrderInput, today: string) {
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
    rows<{ id: number; name: string }>(
      db,
      sql`select id::int as id, name || coalesce(' ' || strength, '') as name from medicine where active and id in (${inIds})`,
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

  const lines = input.items.map((item, index) => {
    const medicine = medicines.find((row) => row.id === item.medicineId);
    if (!medicine)
      throw new Refusal(
        400,
        "invalid",
        "That medicine isn't in the list any more.",
        `items.${index}.medicineId`,
      );
    const found =
      item.priceKind === "promo"
        ? promos.find((row) => row.medicineId === item.medicineId)?.amount
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
      };
    const listPrice = found;
    if (listPrice === undefined)
      throw new Refusal(
        400,
        "invalid",
        `${medicine.name} has no ${item.priceKind === "promo" ? "promo" : buyerLabel(item.priceKind)} price. Pick another price.`,
        `items.${index}.priceKind`,
      );
    const unitPrice = item.unitPrice ?? listPrice;
    const reason = clean(item.reason);
    if (unitPrice < listPrice && !reason)
      throw new Refusal(
        400,
        "invalid",
        `Say why ${medicine.name} is given below the ${buyerLabel(item.priceKind)} price.`,
        `items.${index}.reason`,
      );
    return {
      ...item,
      listPrice,
      unitPrice,
      reason: unitPrice < listPrice ? reason : null,
      free: false,
    };
  });
  return lines;
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
  const medreps = await rows<OrderForList["medreps"][number]>(
    db,
    sql`select p.id::int as id, p.name, a.name as area, ch.code as channel, ch.division, seat.login, seat.team from person p
      left join area a on a.id = p.area_id left join channel ch on ch.id = p.channel_id
      left join lateral (select s.login, u.name as team from seat_holder h join seat s on s.id = h.seat_id and s.active
        join org_unit u on u.id = s.unit_id where h.person_id = p.id and h.kind = 'holder' and ${inForce("h", today)}
        order by h.starts_on limit 1) seat on true
      where p.active and p.role = 'medrep' and ${forWhom(me)} order by seat.team nulls last, p.name`,
  );
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

  const lines = await checkedLines(db, input, today);
  const division = clean(input.division);
  if (division && !(DIVISIONS as readonly string[]).includes(division))
    throw new Refusal(400, "invalid", "Pick the Division from the list.", "division");
  const deliveryFee = Math.max(0, Math.round(options.deliveryFee ?? 0));
  const total = lines.reduce((sum, line) => sum + line.qty * line.unitPrice, 0) + deliveryFee;

  const manages = orderCan(me).manage;
  // Whose order it is: the MedRep who placed it; for one a team lead or Management places, the
  // MedRep they pick (one of the lead's own people), else the MedRep of the customer's area.
  const picked = input.medrepId ? await pickedMedrep(db, me, input.medrepId) : null;
  const [holder] = picked
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
  const [placer] = await rows<{ division: string | null; area: string | null }>(
    db,
    // The division and area are the MedRep's whose order it is (a team lead ordering for Ryan
    // books it under Ryan's channel and area), else the placer's own.
    sql`select ch.division, a.name as area from person p left join channel ch on ch.id = p.channel_id left join area a on a.id = p.area_id where p.id = ${holder?.id ?? me.id}`,
  );
  // The channel's own Division, as the Admin panel sets it (none when it has none).
  const orderDivision = division ?? placer?.division ?? null;
  const subDivision =
    clean(input.subDivision) ??
    (orderDivision && placer?.area ? subDivisionOfArea(orderDivision, placer.area) : null);
  const status: OrderStatus = manages ? afterApproval(terms.terms) : "pending_approval";

  return db.transaction(async (tx) => {
    const [made] = await rows<{ id: number }>(
      tx,
      sql`insert into sales_order (customer_id, medrep_id, raised_by, channel_id, status, payment_terms, payment_days,
          delivery_address, receiver, receiver_phone, note, expected_on, customer_po, invoice_from, doctor_id, total, submitted_at,
          approved_at, approved_by, warehouse_id, lead_id, delivery_fee, division, sub_division, payment_term,
          no_proof_reason, no_proof_note, patient_order, patient_name)
        values (${customer.id}, ${holder?.id ?? me.id}, ${me.id}, ${holder?.channelId ?? own?.channelId ?? null}, ${status},
          ${terms.terms}, ${terms.days},
          ${clean(input.deliveryAddress) ?? withCity(customer.address, customer.city)},
          ${clean(input.receiver)}, ${clean(input.receiverPhone)}, ${clean(input.note)}, ${input.expectedOn || null}, ${clean(input.customerPo)}, ${input.invoiceFrom ?? "2mg"}, ${input.doctorId ?? null}, ${total}, now(),
          ${manages ? sql`now()` : null}, ${manages ? me.id : null}, ${shipsFrom?.id ?? null}, ${options.leadId ?? null}, ${deliveryFee},
          ${orderDivision}, ${subDivision || null}, ${paymentTerm},
          ${input.noProofReason ?? null}, ${clean(input.noProofNote)}, ${Boolean(input.patientOrder) && customer.kind !== "patient"},
          ${input.patientOrder && customer.kind !== "patient" ? clean(input.patientName) : null})
        returning id::int as id`,
    );
    const id = made?.id as number;
    await tx.execute(
      sql`with next as (update counter set value = value + 1 where name = 'order' returning value)
        update sales_order set code = '2MG-' || (500000 + next.value)::text from next where sales_order.id = ${id}`,
    );
    for (const line of lines)
      await tx.execute(
        sql`insert into order_item (order_id, medicine_id, qty, price_kind, list_price, unit_price, price_reason, relief, free)
          values (${id}, ${line.medicineId}, ${line.qty}, ${line.priceKind}, ${line.listPrice}, ${line.unitPrice}, ${line.reason}, ${options.relief ?? false}, ${line.free})`,
      );
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
    if (options.inside) await options.inside(tx, id);
    // On along the line, by the switch at the top of the order form.
    await routeOrder(
      tx,
      me,
      id,
      options.leadId ? { management: options.toManagement ?? false, finance: false } : input.checks,
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

/** Where an approved order goes: only a customer who pays in advance needs its money checked
 *  first; credit and cash on delivery go straight to their invoice. */
const afterApproval = (terms: string): OrderStatus =>
  terms === "advance" ? "finance_check" : "ready_for_invoice";

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
    }>(
      tx,
      sql`select o.id::int as id, o.status, o.raised_by::int as "raisedBy", o.medrep_id::int as "medrepId", ${approverSql} as "approverId", o.held_from as "heldFrom",
          o.held_role as "heldRole", o.payment_terms as terms, o.code, o.lead_id::int as "leadId", o.finance_check as "financeCheck",
          ${takeBackSql} as "takeBack", (select p.name from person p where p.id = o.approved_by) as "approvedBy"
        from sales_order o where o.id = ${id} for update of o`,
    );
    if (!order) throw new Refusal(404, "not_found", "That order doesn't exist.");
    before = order.status;
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
    ];
    if (needsReason.includes(action) && !reason && !(action === "hold" && input.stock))
      throw new Refusal(400, "invalid", "Say why.", "reason");
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
        // Management says on approving whether Finance checks it too.
        const financeCheck =
          input.finance === undefined ? order.financeCheck : input.finance && !order.leadId;
        if (financeCheck !== order.financeCheck)
          await tx.execute(
            sql`update sales_order set finance_check = ${financeCheck} where id = ${id}`,
          );
        // An Online case's order (its agent takes the money), or any order while Finance's check
        // is switched off: once Management has said yes it goes to Dispatch with its invoice.
        if (order.leadId || !financeCheck) {
          await set(
            sql`warehouse_id = ${place.id}, approved_at = now(), approved_by = ${me.id}, flag_reason = null`,
          );
          await logEvent(
            tx,
            id,
            me,
            "status",
            `Approved. Ships from ${place.name}. It goes to Dispatch with its invoice${order.leadId ? "; the Online desk takes the payment" : ""}.`,
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
          `Approved. Ships from ${place.name}. ${next === "ready_for_invoice" ? `${order.terms === "cod" ? "Cash on delivery" : "Credit customer"}: no payment check needed, Finance makes the invoice.` : "It goes to Finance to check the payment."}`,
          "approved",
        );
        return;
      }
      case "send_back":
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
          sql`status = 'on_hold', held_from = ${order.status}, held_role = ${role}, flag_reason = ${reason}`,
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
        const back = order.heldFrom ?? "pending_approval";
        await set(
          sql`status = ${back}, held_from = null, held_role = null, flag_reason = null,
            waiting_stock_at = null, waiting_stock_by = null`,
        );
        return logEvent(
          tx,
          id,
          me,
          "status",
          `Taken off hold: back to ${STATUS_LABEL[back]}.${reason ? ` ${reason}` : ""}`,
        );
      }
      case "answer":
        // Only words on the order's timeline: the hold stays until its desk takes it off.
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
  const division = clean(input.division);
  if (division && !(DIVISIONS as readonly string[]).includes(division))
    throw new Refusal(400, "invalid", "Pick the Division from the list.", "division");
  const lines = await checkedLines(db, input, today);
  await db.transaction(async (tx) => {
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
    }>(
      tx,
      sql`select o.status, o.raised_by::int as "raisedBy", o.medrep_id::int as "medrepId", o.customer_id::int as "customerId",
          o.code, o.delivery_fee::int as "deliveryFee", o.payment_term as "paymentTerm", o.payment_terms as "paymentTerms",
          o.payment_days::int as "paymentDays", ${day("o.expected_on")} as "expectedOn", o.delivery_address as "deliveryAddress",
          o.receiver, o.receiver_phone as "receiverPhone", o.customer_po as "customerPo", o.note, o.division, o.sub_division as "subDivision"
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
      free: boolean;
    }>(
      tx,
      sql`select i.medicine_id::int as "medicineId", m.name || coalesce(' ' || m.strength, '') as name, i.qty::int as qty,
          i.unit_price::int as "unitPrice", i.free
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
      }
    }
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

    await tx.execute(sql`delete from order_item where order_id = ${id}`);
    for (const line of lines)
      await tx.execute(
        sql`insert into order_item (order_id, medicine_id, qty, price_kind, list_price, unit_price, price_reason, relief, free)
          values (${id}, ${line.medicineId}, ${line.qty}, ${line.priceKind}, ${line.listPrice}, ${line.unitPrice}, ${line.reason}, false, ${line.free})`,
      );
    const total =
      lines.reduce((sum, line) => sum + line.qty * line.unitPrice, 0) + order.deliveryFee;
    await tx.execute(
      sql`update sales_order set total = ${total}, payment_term = ${next.paymentTerm}, payment_terms = ${terms.terms},
          payment_days = ${terms.days}, expected_on = ${next.expectedOn}, delivery_address = ${next.deliveryAddress},
          receiver = ${next.receiver}, receiver_phone = ${next.receiverPhone}, customer_po = ${next.customerPo}, note = ${next.note},
          invoice_from = coalesce(${input.invoiceFrom ?? null}, invoice_from), doctor_id = ${input.doctorId ?? null},
          division = ${next.division}, sub_division = ${next.subDivision},
          ${
            by === "management"
              ? sql``
              : sql`status = 'pending_approval', flag_reason = null, submitted_at = now(), reply = ${answer},
            no_proof_reason = ${input.noProofReason ?? null}, no_proof_note = ${clean(input.noProofNote)},
            patient_order = ${Boolean(input.patientOrder)}, patient_name = ${input.patientOrder ? clean(input.patientName) : null},`
          }
          updated_at = now()
        where id = ${id}`,
    );
    if (by === "management") {
      if (!changes.length) throw new Refusal(400, "invalid", "Nothing was changed.", "answer");
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
  const division = clean(input.division);
  if (division && !(DIVISIONS as readonly string[]).includes(division))
    throw new Refusal(400, "invalid", "Pick the Division from the list.", "division");
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
    const [invoiced] = await rows<{ id: number }>(
      tx,
      sql`select id::int as id from invoice where order_id = ${id} and status <> 'cancelled'`,
    );
    if (invoiced || ["packing", "shipped", "completed", "cancelled"].includes(order.status))
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
          ${terms ? sql`payment_terms = ${terms.terms}, payment_days = ${terms.days},` : sql``} updated_at = now()
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
      `${step && FINANCE_STATUSES.includes(order.status) && step !== order.status ? (step === "finance_check" ? "Now paid in advance: Finance checks the money first. " : "No advance payment now: Finance makes the invoice. ") : ""}Details completed: ${changed.map((key) => `${LABEL[key]} ${order[key] ?? "—"} → ${next[key] ?? "—"}`).join("; ")}.`,
    );
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
    leadId: number | null;
  }>(
    db,
    sql`${team(me)} select o.status, o.raised_by::int as "raisedBy", o.medrep_id::int as "medrepId", o.code, o.held_from as "heldFrom",
        o.lead_id::int as "leadId"
      from sales_order o where o.id = ${id} and ${seen(me)}`,
  );
  if (!order)
    throw new Refusal(404, "not_found", "That order isn't one of yours, or it doesn't exist.");
  return order;
}

/** Keeps a paper (a photo or PDF) on an order and writes it to the order's timeline. */
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
    // Finance held it for want of the proof: the proof sends it back to Finance by itself.
    if (
      paper.kind === "payment_proof" &&
      order.status === "on_hold" &&
      order.heldFrom === "finance_check"
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
    await logEvent(
      tx,
      orderId,
      me,
      "note",
      order.by ? `${me.name} took it over from ${order.name}.` : `${me.name} is handling it.`,
    );
  });
}
