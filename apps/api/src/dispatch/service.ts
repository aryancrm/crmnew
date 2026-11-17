// Dispatch's work: packing an order by batch (the pieces leave the shelf when they go into the
// box, nearest expiry first), shipping it with a courier or our rider, its delivery, a parcel
// that came back, and the shipments list. Every change is one transaction that also writes
// the order's timeline and, for stock, the stock ledger.

import { type SQL, sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { allow, Refusal } from "../http";
import { todayManila } from "../inventory/rules";
import { clean, day, iso, logMove, putIn, type Runner, takeOut } from "../inventory/service";
import { logEvent, peso } from "../orders/events";
import { CASE_AGENT_ROLES, orderActions, STATUS_LABEL } from "../orders/rules";
import { settleOrderPoints } from "../points/service";
import type {
  DeliverInput,
  HoldRole,
  Me,
  OrderStatus,
  PackInput,
  PackPlan,
  ShipInput,
  ShipmentList,
  ShipmentRow,
  ShipmentTab,
} from "../types";
import { DISPATCH_READ_ROLES, DISPATCH_ROLES, firstExpiryFirst } from "./rules";

const PAGE = 25;
const ids = (values: number[]) =>
  sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  );
const dated = (value: string) =>
  new Date(`${value}T00:00:00Z`).toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

type LockedOrder = {
  id: number;
  code: string;
  status: OrderStatus;
  raisedBy: number;
  medrepId: number;
  heldFrom: OrderStatus | null;
  heldRole: HoldRole | null;
  customer: string;
  warehouseId: number | null;
  terms: string;
  leadId: number | null;
};

async function lockOrder(tx: Runner, id: number): Promise<LockedOrder> {
  const [order] = await rows<LockedOrder>(
    tx,
    sql`select o.id::int as id, o.code, o.status, o.raised_by::int as "raisedBy", o.medrep_id::int as "medrepId",
        o.held_from as "heldFrom", o.held_role as "heldRole", c.name as customer, o.warehouse_id::int as "warehouseId",
        o.payment_terms as terms, o.lead_id::int as "leadId"
      from sales_order o join customer c on c.id = o.customer_id where o.id = ${id} for update of o`,
  );
  if (!order) throw new Refusal(404, "not_found", "That order doesn't exist.");
  return order;
}

const notNow = (order: LockedOrder) =>
  new Refusal(
    409,
    "not_now",
    `${order.code} is ${STATUS_LABEL[order.status]} now, so that can't be done. Reload it.`,
  );

/** The warehouse an order ships from: the one Management picked, else the default. */
async function shipsFrom(
  db: Runner,
  warehouseId: number | null,
): Promise<{ id: number; name: string }> {
  const [place] = await rows<{ id: number; name: string }>(
    db,
    warehouseId
      ? sql`select id::int as id, name from warehouse where id = ${warehouseId}`
      : sql`select id::int as id, name from warehouse where active order by is_default desc, id limit 1`,
  );
  if (!place) throw new Refusal(409, "no_warehouse", "There is no warehouse to ship from.");
  return place;
}

type ItemRow = {
  itemId: number;
  medicineId: number;
  medicine: string;
  qty: number;
  packSize: number;
};
const itemsOf = (db: Runner, orderId: number) =>
  rows<ItemRow>(
    db,
    sql`select i.id::int as "itemId", i.medicine_id::int as "medicineId", m.name || coalesce(' ' || m.strength, '') as medicine,
        i.qty::int as qty, m.pack_size::int as "packSize"
      from order_item i join medicine m on m.id = i.medicine_id where i.order_id = ${orderId} order by i.id`,
  );

type ShelfRow = {
  batchId: number;
  medicineId: number;
  batchNo: string;
  expiresOn: string;
  onShelf: number;
  unitCost: number | null;
};
/** What is on the shelf of one warehouse for some medicines, nearest expiry first. */
const shelfOf = (db: Runner, warehouseId: number, medicineIds: number[], lock = false) =>
  medicineIds.length === 0
    ? Promise.resolve([] as ShelfRow[])
    : rows<ShelfRow>(
        db,
        sql`select b.id::int as "batchId", b.medicine_id::int as "medicineId", b.batch_no as "batchNo", ${day("b.expires_on")} as "expiresOn",
            s.qty::int as "onShelf", b.unit_cost::int as "unitCost"
          from stock s join batch b on b.id = s.batch_id
          where s.warehouse_id = ${warehouseId} and s.qty > 0 and b.medicine_id in (${ids(medicineIds)})
          order by b.expires_on, b.id ${lock ? sql`for update of s` : sql``}`,
      );

/** What Dispatch picks for each line: the batches on the shelf and the first-expiry-first suggestion. */
export async function packPlan(db: Database, me: Me, orderId: number): Promise<PackPlan> {
  allow(me, DISPATCH_ROLES, "pack an order");
  const [order] = await rows<{ code: string; warehouseId: number | null }>(
    db,
    sql`select code, warehouse_id::int as "warehouseId" from sales_order where id = ${orderId}`,
  );
  if (!order) throw new Refusal(404, "not_found", "That order doesn't exist.");
  const today = todayManila();
  const [place, items] = await Promise.all([
    shipsFrom(db, order.warehouseId),
    itemsOf(db, orderId),
  ]);
  const shelf = await shelfOf(
    db,
    place.id,
    items.map((item) => item.medicineId),
  );
  return {
    orderId,
    code: order.code,
    warehouseId: place.id,
    warehouse: place.name,
    today,
    lines: items.map((item) => {
      const batches = shelf.filter(
        (row) => row.medicineId === item.medicineId && row.expiresOn >= today,
      );
      const plan = firstExpiryFirst(item.qty, batches, today);
      return {
        itemId: item.itemId,
        medicineId: item.medicineId,
        medicine: item.medicine,
        qty: item.qty,
        packSize: item.packSize,
        batches: batches.map(({ batchId, batchNo, expiresOn, onShelf }) => ({
          batchId,
          batchNo,
          expiresOn,
          onShelf,
        })),
        suggested: plan.picks,
        short: plan.short,
      };
    }),
  };
}

/** Packs an order: the pieces come off the shelf, batch by batch, into the box. Without picks
 *  the nearest expiry goes first; with picks, every line must be picked in full. */
export async function packOrder(
  db: Database,
  me: Me,
  orderId: number,
  input: PackInput,
): Promise<void> {
  allow(me, DISPATCH_ROLES, "pack an order");
  const today = todayManila();
  await db.transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (!orderActions(me, order).pack) throw notNow(order);
    const place = await shipsFrom(tx, order.warehouseId);
    const items = await itemsOf(tx, orderId);
    const shelf = await shelfOf(
      tx,
      place.id,
      items.map((item) => item.medicineId),
      true,
    );
    const picks: { item: ItemRow; batch: ShelfRow; qty: number }[] = [];
    for (const [index, item] of items.entries()) {
      const batches = shelf.filter((row) => row.medicineId === item.medicineId);
      const chosen = input.picks
        ? input.picks.filter((pick) => pick.itemId === item.itemId)
        : firstExpiryFirst(item.qty, batches, today).picks.map((pick) => ({
            ...pick,
            itemId: item.itemId,
          }));
      const picked = chosen.reduce((sum, pick) => sum + pick.qty, 0);
      if (!input.picks && picked < item.qty) {
        const have = batches
          .filter((row) => row.expiresOn >= today)
          .reduce((sum, row) => sum + row.onShelf, 0);
        throw new Refusal(
          409,
          "short",
          `${item.medicine}: ${item.qty.toLocaleString("en-PH")} ordered, only ${have.toLocaleString("en-PH")} in ${place.name} that haven't expired. Move stock there, or ask Management to ship it from another warehouse.`,
          `lines.${index}`,
        );
      }
      if (input.picks && picked !== item.qty)
        throw new Refusal(
          400,
          "invalid",
          `${item.medicine}: pick ${item.qty.toLocaleString("en-PH")} pieces, not ${picked.toLocaleString("en-PH")}.`,
          `lines.${index}`,
        );
      for (const pick of chosen) {
        const batch = batches.find((row) => row.batchId === pick.batchId);
        if (!batch)
          throw new Refusal(
            400,
            "invalid",
            `${item.medicine}: that batch isn't on the shelf in ${place.name}.`,
            `lines.${index}`,
          );
        if (batch.expiresOn < today)
          throw new Refusal(
            400,
            "invalid",
            `${item.medicine}: batch ${batch.batchNo} has expired.`,
            `lines.${index}`,
          );
        picks.push({ item, batch, qty: pick.qty });
      }
    }
    if (input.picks?.some((pick) => !items.some((item) => item.itemId === pick.itemId)))
      throw new Refusal(400, "invalid", "A pick isn't for a line of this order.", "picks");

    const taken = new Map<number, number>();
    for (const { item, batch, qty } of picks) {
      if (!Number.isInteger(qty) || qty <= 0)
        throw new Refusal(
          400,
          "invalid",
          `${item.medicine}: a pick needs at least one piece.`,
          "picks",
        );
      taken.set(batch.batchId, (taken.get(batch.batchId) ?? 0) + qty);
      if ((taken.get(batch.batchId) ?? 0) > batch.onShelf)
        throw new Refusal(
          409,
          "short",
          `${item.medicine}: batch ${batch.batchNo} has only ${batch.onShelf.toLocaleString("en-PH")} in ${place.name}.`,
          "picks",
        );
    }
    for (const { item, batch, qty } of picks) {
      await takeOut(tx, batch.batchId, place.id, qty);
      await logMove(tx, {
        medicineId: item.medicineId,
        batchId: batch.batchId,
        warehouseId: place.id,
        qty: -qty,
        kind: "deliver",
        ref: order.code,
        note: `Packed for ${order.customer}`,
        by: me.id,
      });
      await tx.execute(
        sql`insert into order_pick (order_id, order_item_id, batch_id, warehouse_id, qty, unit_cost, by_person)
          values (${orderId}, ${item.itemId}, ${batch.batchId}, ${place.id}, ${qty}, ${batch.unitCost}, ${me.id})`,
      );
    }
    await tx.execute(
      sql`update sales_order set status = 'packing', warehouse_id = ${place.id}, packed_at = now(), packed_by = ${me.id},
        dispatch_by = coalesce(dispatch_by, ${me.id}), dispatch_by_at = coalesce(dispatch_by_at, now()), updated_at = now() where id = ${orderId}`,
    );
    const words = picks.map(
      ({ item, batch, qty }) =>
        `${item.medicine} × ${qty.toLocaleString("en-PH")} (batch ${batch.batchNo}, expires ${dated(batch.expiresOn)})`,
    );
    await logEvent(
      tx,
      orderId,
      me,
      "status",
      `Packed from ${place.name}: ${words.join("; ")}.`,
      "packed",
    );
  });
}

/** Puts an order's packed pieces back on the shelf they came from. Answers how many. */
export async function putBack(
  tx: Runner,
  me: Me,
  order: { id: number; code: string },
  why: string,
): Promise<number> {
  const picks = await rows<{
    id: number;
    batchId: number;
    warehouseId: number;
    qty: number;
    medicineId: number;
  }>(
    tx,
    sql`select p.id::int as id, p.batch_id::int as "batchId", p.warehouse_id::int as "warehouseId", p.qty::int as qty, b.medicine_id::int as "medicineId"
      from order_pick p join batch b on b.id = p.batch_id where p.order_id = ${order.id} and p.active for update of p`,
  );
  for (const pick of picks) {
    await putIn(tx, pick.batchId, pick.warehouseId, pick.qty);
    await logMove(tx, {
      medicineId: pick.medicineId,
      batchId: pick.batchId,
      warehouseId: pick.warehouseId,
      qty: pick.qty,
      kind: "return",
      ref: order.code,
      note: why,
      by: me.id,
    });
  }
  if (picks.length)
    await tx.execute(
      sql`update order_pick set active = false, returned_at = now() where order_id = ${order.id} and active`,
    );
  return picks.reduce((sum, pick) => sum + pick.qty, 0);
}

/** Opens the box again: its pieces go back on the shelf and the order waits to be packed. */
export async function unpackOrder(
  db: Database,
  me: Me,
  orderId: number,
  reason: string | null,
): Promise<void> {
  allow(me, DISPATCH_ROLES, "unpack an order");
  const why = clean(reason);
  await db.transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (!orderActions(me, order).unpack) throw notNow(order);
    const pieces = await putBack(tx, me, order, `Unpacked${why ? `: ${why}` : ""}`);
    await tx.execute(
      sql`update sales_order set status = 'ready_for_dispatch', packed_at = null, packed_by = null, came_back_at = null, updated_at = now() where id = ${orderId}`,
    );
    await logEvent(
      tx,
      orderId,
      me,
      "status",
      `Unpacked: ${pieces.toLocaleString("en-PH")} pieces back on the shelf.${why ? ` ${why}` : ""}`,
    );
  });
}

/** Hands the box to a courier (its tracking can follow) or to our own rider. */
/** Nothing leaves without its pieces taken off the shelf by batch: every line fully picked. */
async function mustBePicked(tx: Runner, orderId: number): Promise<void> {
  const [short] = await rows<{ medicine: string; ordered: number; picked: number }>(
    tx,
    sql`select m.name || coalesce(' ' || m.strength, '') as medicine, i.qty::int as ordered,
        coalesce((select sum(p.qty) from order_pick p where p.order_item_id = i.id and p.active), 0)::int as picked
      from order_item i join medicine m on m.id = i.medicine_id
      where i.order_id = ${orderId}
        and coalesce((select sum(p.qty) from order_pick p where p.order_item_id = i.id and p.active), 0) < i.qty
      limit 1`,
  );
  if (short)
    throw new Refusal(
      409,
      "not_now",
      `${short.medicine}: ${short.picked} of ${short.ordered} taken off the shelf. Pack it again so every piece is picked by batch.`,
    );
}

export async function shipOrder(
  db: Database,
  me: Me,
  orderId: number,
  input: ShipInput,
): Promise<void> {
  allow(me, DISPATCH_ROLES, "ship an order");
  const courier = clean(input.courier);
  const tracking = clean(input.tracking);
  const wait = input.method === "courier" && !tracking ? clean(input.trackingWait) : null;
  const rider = clean(input.rider);
  if (input.method === "courier" && !courier)
    throw new Refusal(400, "invalid", "Say which courier takes it.", "courier");
  if (input.method === "rider" && !rider)
    throw new Refusal(400, "invalid", "Say which rider takes it.", "rider");
  // The hub's "not ready yet": no tracking number now, so say why (it is added when it comes).
  if (input.method === "courier" && !tracking && !wait)
    throw new Refusal(
      400,
      "invalid",
      "Type the tracking number, or say why it isn't ready yet.",
      "trackingWait",
    );
  // The hub's Confirm for delivery: the slip on the parcel is checked against the order first.
  if (!input.addressChecked)
    throw new Refusal(
      400,
      "invalid",
      "Check the address slip on the parcel against the order's address first.",
      "addressChecked",
    );
  await db.transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (!orderActions(me, order).ship) throw notNow(order);
    await mustBePicked(tx, orderId);
    const [to] = await rows<{ address: string | null; receiver: string | null; phone: string | null }>(
      tx,
      sql`select coalesce(o.delivery_address, c.address, c.city) as address, o.receiver, coalesce(o.receiver_phone, c.phone) as phone
        from sales_order o join customer c on c.id = o.customer_id where o.id = ${orderId}`,
    );
    await tx.execute(
      sql`update sales_order set status = 'shipped', delivery_method = ${input.method},
          courier = ${input.method === "courier" ? courier : null}, tracking = ${input.method === "courier" ? tracking : null},
          tracking_wait = ${wait}, rider = ${input.method === "rider" ? rider : null}, shipped_at = now(), shipped_by = ${me.id},
          address_checked_at = now(), address_checked_by = ${me.id},
          dispatch_by = coalesce(dispatch_by, ${me.id}), came_back_at = null, updated_at = now()
        where id = ${orderId}`,
    );
    const how =
      input.method === "courier"
        ? `with ${courier}${tracking ? ` (tracking ${tracking})` : `, tracking to follow (${wait?.toLowerCase()})`}`
        : `with our rider ${rider}`;
    const slip = [to?.receiver, to?.address, to?.phone].filter(Boolean).join(", ");
    await logEvent(
      tx,
      orderId,
      me,
      "status",
      `Shipped ${how}. Address slip checked against the order${slip ? `: ${slip}` : ""}.${clean(input.note) ? ` ${clean(input.note)}` : ""}`,
      "shipped",
    );
  });
}

/** The courier's tracking number, added or corrected after it left. */
export async function setTracking(
  db: Database,
  me: Me,
  orderId: number,
  input: { courier?: string | null; tracking?: string | null },
): Promise<void> {
  allow(me, DISPATCH_ROLES, "add a tracking number");
  const tracking = clean(input.tracking);
  if (!tracking) throw new Refusal(400, "invalid", "Type the tracking number.", "tracking");
  await db.transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    const [shipped] = await rows<{ method: string | null; courier: string | null }>(
      tx,
      sql`select delivery_method as method, courier from sales_order where id = ${orderId}`,
    );
    if (!["shipped", "completed"].includes(order.status) || shipped?.method !== "courier")
      throw new Refusal(
        409,
        "not_now",
        `${order.code} isn't with a courier, so it has no tracking number.`,
      );
    const courier = clean(input.courier) ?? shipped.courier;
    await tx.execute(
      sql`update sales_order set tracking = ${tracking}, tracking_wait = null, courier = ${courier}, updated_at = now() where id = ${orderId}`,
    );
    await logEvent(tx, orderId, me, "dispatch", `Tracking number ${tracking} (${courier}).`);
  });
}

/** The customer has it: who received it, and when. A packed order handed over at the warehouse
 *  is a pick-up. A cash-on-delivery invoice falls due the day it arrived. */
export async function deliverOrder(
  db: Database,
  me: Me,
  orderId: number,
  input: DeliverInput,
): Promise<void> {
  // Dispatch, or for an Online case's order its agent (checked on the order below).
  allow(me, [...DISPATCH_ROLES, ...CASE_AGENT_ROLES], "mark an order delivered");
  const receivedBy = clean(input.receivedBy);
  if (!receivedBy) throw new Refusal(400, "invalid", "Type who received it.", "receivedBy");
  if (input.deliveredOn > todayManila())
    throw new Refusal(400, "invalid", "That day hasn't come yet.", "deliveredOn");
  await db.transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (!orderActions(me, order).deliver) throw notNow(order);
    // The signed delivery receipt is the proof the customer has it: no photo, not delivered.
    const [receipt] = await rows(
      tx,
      sql`select 1 from order_file where order_id = ${orderId} and kind = 'dr' and active limit 1`,
    );
    if (!receipt)
      throw new Refusal(
        400,
        "invalid",
        "Add the photo of the signed delivery receipt first: it is the proof the customer has it.",
        "proof",
      );
    const pickup = order.status === "packing";
    await tx.execute(
      sql`update sales_order set status = 'completed', delivered_on = ${input.deliveredOn}::date, delivered_at = now(), delivered_by = ${me.id},
          received_by = ${receivedBy}, delivery_method = coalesce(delivery_method, ${pickup ? "pickup" : null}), updated_at = now()
        where id = ${orderId}`,
    );
    const [invoice] = await rows<{ code: string; status: string; balance: number; terms: string }>(
      tx,
      // Cash on delivery falls due on delivery; credit counts its days from delivery, not from the
      // invoice (goods not yet received are never late).
      sql`update invoice set due_on = case
          when terms = 'cod' and status = 'open' then ${input.deliveredOn}::date
          when terms = 'days' and status = 'open'
            then ${input.deliveredOn}::date + coalesce((select o.payment_days from sales_order o where o.id = ${orderId}), 0)
          else due_on end
        where order_id = ${orderId} returning code, status, (total - paid)::int as balance, terms`,
    );
    const collect =
      invoice?.terms === "cod" && invoice.status === "open"
        ? ` Cash on delivery: ${peso(invoice.balance)} to collect; ${order.leadId ? "the Online desk" : "Finance"} records it.`
        : "";
    await logEvent(
      tx,
      orderId,
      me,
      "status",
      `${pickup ? "Picked up at the warehouse" : "Delivered"}: received by ${receivedBy} on ${dated(input.deliveredOn)}.${collect}${clean(input.note) ? ` ${clean(input.note)}` : ""}`,
      "delivered",
    );
    if (invoice?.status === "paid")
      await logEvent(tx, orderId, me, "status", "Completed: delivered and paid.", "completed");
    // Paid before it arrived: the points are earned now.
    await settleOrderPoints(tx, orderId);
  });
}

/** The parcel didn't reach the customer and came back, still packed: it waits to be shipped
 *  again (or to be unpacked). */
export async function failedDelivery(
  db: Database,
  me: Me,
  orderId: number,
  reason: string | null,
): Promise<void> {
  allow(me, DISPATCH_ROLES, "say a delivery failed");
  const why = clean(reason);
  if (!why) throw new Refusal(400, "invalid", "Say why it didn't reach the customer.", "reason");
  await db.transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (!orderActions(me, order).failed) throw notNow(order);
    await tx.execute(
      sql`update sales_order set status = 'packing', delivery_method = null, courier = null, tracking = null, tracking_wait = null, rider = null,
          address_checked_at = null, address_checked_by = null,
          came_back_count = came_back_count + 1, came_back_reason = ${why}, came_back_at = now(),
          shipped_at = null, shipped_by = null, updated_at = now() where id = ${orderId}`,
    );
    await logEvent(
      tx,
      orderId,
      me,
      "status",
      `Didn't reach the customer: ${why}. The parcel is back with Dispatch, still packed.`,
    );
  });
}

/** Dispatch's counts for the menu: to pack, to ship (came back too), on the way, its own holds. */
export async function dispatchCounts(
  db: Runner,
  me: Me,
): Promise<{ toPack: number; toShip: number; onTheWay: number; heldByDispatch: number }> {
  if (!DISPATCH_READ_ROLES.includes(me.role))
    return { toPack: 0, toShip: 0, onTheWay: 0, heldByDispatch: 0 };
  const [counted] = await rows<{
    toPack: number;
    toShip: number;
    onTheWay: number;
    heldByDispatch: number;
  }>(
    db,
    sql`select count(*) filter (where status = 'ready_for_dispatch')::int as "toPack",
        count(*) filter (where status = 'packing')::int as "toShip",
        count(*) filter (where status = 'shipped')::int as "onTheWay",
        count(*) filter (where status in ('on_hold', 'exception')
          and (held_role = 'dispatch' or held_from in ('ready_for_dispatch', 'packing', 'shipped')))::int as "heldByDispatch"
      from sales_order where status in ('ready_for_dispatch', 'packing', 'shipped', 'on_hold', 'exception')`,
  );
  return counted ?? { toPack: 0, toShip: 0, onTheWay: 0, heldByDispatch: 0 };
}

const SHIPMENT_TABS: Record<ShipmentTab, SQL> = {
  road: sql`o.status = 'shipped'`,
  delivered: sql`o.status = 'completed' and o.delivered_at is not null`,
  all: sql`(o.shipped_at is not null or o.delivered_at is not null)`,
};

/** Every parcel that left: on the road, delivered, or both, newest first. */
export async function listShipments(
  db: Database,
  me: Me,
  filter: { tab?: string; q?: string; page?: number },
): Promise<ShipmentList> {
  allow(me, DISPATCH_READ_ROLES, "see shipments");
  const tab: ShipmentTab =
    filter.tab && filter.tab in SHIPMENT_TABS ? (filter.tab as ShipmentTab) : "road";
  const page = Math.max(1, Math.floor(filter.page ?? 1) || 1);
  const narrowed: SQL[] = [];
  for (const word of (filter.q ?? "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 5)) {
    const like = `%${word.replace(/[%_\\]/g, "\\$&")}%`;
    narrowed.push(
      sql`(lower(o.code) like ${like} or lower(c.name) like ${like} or lower(coalesce(o.tracking, '')) like ${like} or lower(coalesce(o.courier, '')) like ${like} or lower(coalesce(o.rider, '')) like ${like})`,
    );
  }
  const scope = narrowed.length ? sql.join(narrowed, sql` and `) : sql`true`;
  const from = sql`from sales_order o join customer c on c.id = o.customer_id join person rep on rep.id = o.medrep_id`;
  const [found, counted] = await Promise.all([
    rows<Omit<ShipmentRow, "statusLabel">>(
      db,
      sql`select o.id::int as id, o.code, o.customer_id::int as "customerId", c.name as customer, c.city, rep.name as medrep, o.status,
          o.delivery_method as "deliveryMethod", o.courier, o.tracking, o.tracking_wait as "trackingWait", o.rider, ${iso("o.shipped_at")} as "shippedAt",
          ${day("o.delivered_on")} as "deliveredOn", o.received_by as "receivedBy", o.total::int as total
        ${from} where ${scope} and ${SHIPMENT_TABS[tab]}
        order by ${tab === "road" ? sql`o.shipped_at asc nulls last, o.id` : sql`coalesce(o.delivered_at, o.shipped_at) desc nulls last, o.id desc`}
        limit ${PAGE} offset ${(page - 1) * PAGE}`,
    ),
    rows<Record<ShipmentTab, number>>(
      db,
      sql`select count(*) filter (where ${SHIPMENT_TABS.road})::int as road, count(*) filter (where ${SHIPMENT_TABS.delivered})::int as delivered,
          count(*) filter (where ${SHIPMENT_TABS.all})::int as "all" ${from} where ${scope}`,
    ),
  ]);
  const counts = counted[0] ?? { road: 0, delivered: 0, all: 0 };
  return {
    tab,
    counts,
    rows: found.map((row) => ({ ...row, statusLabel: STATUS_LABEL[row.status] })),
    total: counts[tab],
    page,
    pageSize: PAGE,
  };
}

/** Who in the warehouse has an order in hand, so two people don't pack the same one. Taking one
 *  someone else has says so on the timeline; letting go frees it for anyone. */
export async function takeOrder(
  db: Database,
  me: Me,
  orderId: number,
  release: boolean,
): Promise<void> {
  allow(me, DISPATCH_ROLES, "take an order in the warehouse");
  await db.transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (!["ready_for_dispatch", "packing"].includes(order.status))
      throw new Refusal(
        409,
        "not_now",
        `${order.code} isn't waiting in the warehouse now. Reload it.`,
      );
    const [held] = await rows<{ by: number | null; name: string | null }>(
      tx,
      sql`select o.dispatch_by::int as by, p.name from sales_order o left join person p on p.id = o.dispatch_by where o.id = ${orderId}`,
    );
    if (release) {
      if (held?.by !== me.id) return;
      await tx.execute(
        sql`update sales_order set dispatch_by = null, dispatch_by_at = null where id = ${orderId}`,
      );
      await logEvent(
        tx,
        orderId,
        me,
        "dispatch",
        `${me.name} let it go: anyone in the warehouse can take it.`,
      );
      return;
    }
    if (held?.by === me.id) return;
    await tx.execute(
      sql`update sales_order set dispatch_by = ${me.id}, dispatch_by_at = now() where id = ${orderId}`,
    );
    await logEvent(
      tx,
      orderId,
      me,
      "dispatch",
      held?.by
        ? `${me.name} took it over from ${held.name}.`
        : `${me.name} took it in the warehouse.`,
    );
  });
}
