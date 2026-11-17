// Returns and refunds, the hub's way (Aryan, 17 Nov). The MedRep who sold it (or Management) asks:
// which medicines, how many, why, and where the goods are, which decides the road:
// - coming back: Management approves; Dispatch checks what came back (good goes back on the shelf
//   into the batch it left from, damaged is written off, missing isn't credited); then Management
//   credits the bill, or doesn't, with why (the hub's Refund press after the goods check);
// - the customer keeps them: credited when Management approves;
// - not shipped yet: Management approving cancels the order (what was paid goes on Refunds owed).
// A credit takes the invoice's total down, so what is owed, the sales and the MedRep's target all
// follow; money already paid beyond the new bill shows in Finance's Refunds owed. Points follow.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { DISPATCH_ROLES } from "../dispatch/rules";
import { vatSplit } from "../finance/rules";
import { allow, Refusal } from "../http";
import { clean, iso, logMove, putIn, type Runner } from "../inventory/service";
import { notify } from "../notify/service";
import { logEvent, peso } from "../orders/events";
import { ORDER_MANAGE_ROLES } from "../orders/rules";
import { actOnOrder, inTeamSql, mayReadOrder } from "../orders/service";
import { settleOrderPoints } from "../points/service";
import type {
  Me,
  OrderReturns,
  ReturnGoods,
  ReturnInput,
  ReturnList,
  ReturnOutcome,
  ReturnReason,
  ReturnRow,
  Vat,
} from "../types";

export const RETURN_REASON_LABEL: Record<ReturnReason, string> = {
  expired: "Expired",
  damaged: "Damaged",
  wrong_item: "Wrong item",
  not_needed: "Not needed",
  other: "Other",
};
export const RETURN_REASONS = Object.keys(RETURN_REASON_LABEL) as ReturnReason[];
export const RETURN_STATUS_LABEL: Record<ReturnRow["status"], string> = {
  requested: "Waiting for Management",
  approved: "Approved: Dispatch checks the goods",
  checked: "Goods checked: Management credits it",
  received: "Credited",
  rejected: "Not approved",
  cancelled: "Cancelled",
};
export const RETURN_GOODS_LABEL: Record<ReturnGoods, string> = {
  coming_back: "Coming back",
  customer_keeps: "The customer keeps them",
  not_shipped: "Not shipped yet",
};
export const RETURN_GOODS = Object.keys(RETURN_GOODS_LABEL) as ReturnGoods[];
/** Approved and not on the road yet: "not shipped yet" cancels it. */
const BEFORE_SHIP = ["finance_check", "ready_for_invoice", "ready_for_dispatch", "packing"];
/** Who sees every return: the desks that act on them and the CEO. */
const READ_ALL = ["management", "admin", "ceo", "finance", "dispatch"];

const peopleOf = async (db: Runner, role: string) =>
  (
    await rows<{ id: number }>(
      db,
      sql`select id::int as id from person where role = ${role} and active`,
    )
  ).map((row) => row.id);

/** What is left to return of each line of an order: delivered less what other returns asked. */
export async function returnable(db: Runner, orderId: number) {
  return rows<{
    orderItemId: number;
    medicineId: number;
    medicine: string;
    qty: number;
    left: number;
    unitPrice: number;
    free: boolean;
  }>(
    db,
    sql`select i.id::int as "orderItemId", i.medicine_id::int as "medicineId", m.name || coalesce(' ' || m.strength, '') as medicine,
        i.qty::int as qty, i.unit_price::int as "unitPrice", i.free,
        (i.qty - coalesce((select sum(l.qty) from sales_return_line l join sales_return r on r.id = l.return_id
          where l.order_item_id = i.id
            and (r.status in ('requested', 'approved') or (r.status in ('checked', 'received') and l.outcome <> 'missing'))), 0))::int as left
      from order_item i join medicine m on m.id = i.medicine_id where i.order_id = ${orderId} order by i.id`,
  );
}

/** May this person ask for a return on this order: who sold it, their team lead (the hub's
 *  Request refund on the team's orders), or Management. */
function mayAsk(me: Me, order: { medrepId: number; raisedBy: number; team?: boolean }) {
  return (
    ORDER_MANAGE_ROLES.includes(me.role) ||
    order.medrepId === me.id ||
    order.raisedBy === me.id ||
    Boolean(order.team)
  );
}

export async function requestReturn(
  db: Database,
  me: Me,
  orderId: number,
  input: ReturnInput,
): Promise<number> {
  const goods = input.goods ?? "coming_back";
  const whole = goods === "not_shipped";
  // Not shipped yet: the whole order is cancelled, so no lines are picked.
  const lines = whole ? [] : input.lines.filter((line) => line.qty > 0);
  if (!whole && !lines.length)
    throw new Refusal(400, "invalid", "Say how many of a medicine come back.", "lines");
  if (!RETURN_REASONS.includes(input.reason))
    throw new Refusal(400, "invalid", "Say why it comes back.", "reason");
  if (whole && ORDER_MANAGE_ROLES.includes(me.role))
    throw new Refusal(
      400,
      "invalid",
      "Not shipped yet: cancel the order instead. What was paid goes on Finance's refunds.",
      "goods",
    );
  return db.transaction(async (tx) => {
    const [order] = await rows<{
      id: number;
      code: string;
      status: string;
      medrepId: number;
      raisedBy: number;
      team: boolean;
    }>(
      tx,
      sql`select o.id::int as id, o.code, o.status, o.medrep_id::int as "medrepId", o.raised_by::int as "raisedBy",
          ${inTeamSql(me)} as team
        from sales_order o where o.id = ${orderId} for update`,
    );
    if (!order) throw new Refusal(404, "not_found", "That order doesn't exist.");
    if (!mayAsk(me, order))
      throw new Refusal(403, "forbidden", "Only who sold it, or Management, asks for a return.");
    if (whole) {
      if (!BEFORE_SHIP.includes(order.status))
        throw new Refusal(
          409,
          "not_now",
          `${order.code} isn't between approval and shipping: it can't be cancelled from here.`,
        );
      const [open] = await rows(
        tx,
        sql`select 1 from sales_return where order_id = ${orderId} and status = 'requested' limit 1`,
      );
      if (open)
        throw new Refusal(409, "not_now", `Management already has a request on ${order.code}.`);
    } else if (order.status !== "completed")
      throw new Refusal(409, "not_now", `${order.code} isn't delivered yet: nothing to return.`);
    const left = await returnable(tx, orderId);
    for (const [index, line] of lines.entries()) {
      const item = left.find((one) => one.orderItemId === line.orderItemId);
      if (!item)
        throw new Refusal(400, "invalid", "That medicine isn't on this order.", `lines.${index}`);
      if (line.qty > item.left)
        throw new Refusal(
          400,
          "invalid",
          `Only ${item.left} of ${item.medicine} can still come back.`,
          `lines.${index}.qty`,
        );
    }
    const manages = ORDER_MANAGE_ROLES.includes(me.role);
    const [made] = await rows<{ id: number }>(
      tx,
      sql`insert into sales_return (order_id, status, goods, reason, note, requested_by, decided_by, decided_at)
        values (${orderId}, ${manages ? "approved" : "requested"}, ${goods}, ${input.reason}, ${clean(input.note)}, ${me.id},
          ${manages ? me.id : null}, ${manages ? sql`now()` : null})
        returning id::int as id`,
    );
    const id = made?.id as number;
    await tx.execute(
      sql`with next as (update counter set value = value + 1 where name = 'return' returning value)
        update sales_return set code = 'RET-' || lpad(next.value::text, 5, '0') from next where sales_return.id = ${id}`,
    );
    for (const line of lines) {
      const item = left.find((one) => one.orderItemId === line.orderItemId);
      await tx.execute(
        sql`insert into sales_return_line (return_id, order_item_id, medicine_id, qty, unit_price)
          values (${id}, ${line.orderItemId}, ${item?.medicineId}, ${line.qty}, ${item?.unitPrice ?? 0})`,
      );
    }
    const [code] = await rows<{ code: string }>(
      tx,
      sql`select code from sales_return where id = ${id}`,
    );
    const said = whole
      ? "the whole order, not shipped yet (cancel it and give back what was paid)"
      : `${lines
          .map(
            (line) =>
              `${left.find((one) => one.orderItemId === line.orderItemId)?.medicine} × ${line.qty}`,
          )
          .join(", ")} (${RETURN_GOODS_LABEL[goods].toLowerCase()})`;
    await logEvent(
      tx,
      orderId,
      me,
      "status",
      `Return ${code?.code} asked by ${me.name}: ${said}. Why: ${RETURN_REASON_LABEL[input.reason]}${clean(input.note) ? `, ${clean(input.note)}` : ""}.${manages ? " Approved as it was made." : ""}`,
    );
    // Management's own: approved as it is made, so the customer's keeping is credited now.
    if (manages && goods === "customer_keeps") await creditKept(tx, me, id);
    await notify(tx, {
      to:
        manages && goods === "coming_back"
          ? await peopleOf(tx, "dispatch")
          : manages
            ? []
            : await peopleOf(tx, "management"),
      kind: "return",
      title: manages
        ? `Return ${code?.code} on ${order.code}: check the goods when they come`
        : `Return ${code?.code} on ${order.code} to approve`,
      body: `${said}. Why: ${RETURN_REASON_LABEL[input.reason]}`,
      link: "/returns",
      orderId,
      key: `return:${id}:asked`,
    });
    return id;
  });
}

async function lockReturn(tx: Runner, id: number) {
  const [found] = await rows<{
    id: number;
    code: string;
    status: ReturnRow["status"];
    goods: ReturnGoods;
    reason: ReturnReason;
    note: string | null;
    orderId: number;
    orderCode: string;
    requestedBy: number;
  }>(
    tx,
    sql`select r.id::int as id, r.code, r.status, r.goods, r.reason, r.note, r.order_id::int as "orderId", o.code as "orderCode",
        r.requested_by::int as "requestedBy"
      from sales_return r join sales_order o on o.id = r.order_id where r.id = ${id} for update of r`,
  );
  if (!found) throw new Refusal(404, "not_found", "That return doesn't exist.");
  return found;
}

/**
 * Takes a return's credit off its order's bill (the VAT split with it), marks it credited, and
 * says on the order and to who asked (and Finance, when money paid is now beyond the bill).
 */
async function applyCredit(
  tx: Runner,
  me: Me,
  found: Awaited<ReturnType<typeof lockReturn>>,
  said: string,
): Promise<number> {
  const lines = await rows<{ qty: number; unitPrice: number; vat: Vat }>(
    tx,
    sql`select l.qty::int as qty, l.unit_price::int as "unitPrice",
        -- A senior's or PWD's line was sold VAT-exempt: its credit is too.
        coalesce((select oi.vat_then from order_item oi where oi.id = l.order_item_id),
          case when (select oi.relief from order_item oi where oi.id = l.order_item_id) then 'exempt' else m.vat end) as vat
      from sales_return_line l join medicine m on m.id = l.medicine_id
      where l.return_id = ${found.id} and l.outcome <> 'missing'`,
  );
  const credit = lines.reduce((sum, line) => sum + line.qty * line.unitPrice, 0);
  const [invoice] = await rows<{ id: number; total: number; paid: number; refunded: number }>(
    tx,
    sql`select id::int as id, total::int as total, paid::int as paid, refunded::int as refunded
      from invoice where order_id = ${found.orderId} and status <> 'cancelled' for update`,
  );
  let refundNote = "";
  if (invoice && credit > 0) {
    const amount = Math.min(credit, invoice.total);
    const split = vatSplit(lines.map((line) => ({ amount: line.qty * line.unitPrice, vat: line.vat })));
    await tx.execute(
      sql`update invoice set total = total - ${amount}, credited = credited + ${amount},
          vatable = greatest(0, vatable - ${split.vatable}), vat = greatest(0, vat - ${split.vat}),
          exempt = greatest(0, exempt - ${split.exempt}), zero_rated = greatest(0, zero_rated - ${split.zeroRated}),
          status = case when paid >= total - ${amount} then 'paid' else status end
        where id = ${invoice.id}`,
    );
    const over = invoice.paid - invoice.refunded - (invoice.total - amount);
    if (over > 0)
      refundNote = ` ${peso(over)} was already paid beyond the new bill: Finance gives it back.`;
  }
  await tx.execute(
    sql`update sales_return set status = 'received', credit = ${credit}, credited_by = ${me.id}, credited_at = now() where id = ${found.id}`,
  );
  await logEvent(
    tx,
    found.orderId,
    me,
    "status",
    `Return ${found.code} credited by ${me.name}: ${said}. ${peso(credit)} off the bill.${refundNote}`,
  );
  await settleOrderPoints(tx, found.orderId);
  await notify(tx, {
    to: [found.requestedBy, ...(refundNote ? await peopleOf(tx, "finance") : [])].filter(
      (who) => who !== me.id,
    ),
    kind: "return",
    title: `Return ${found.code} on ${found.orderCode}: ${peso(credit)} credited`,
    body: `${said}.${refundNote}`,
    link: "/returns",
    orderId: found.orderId,
    key: `return:${found.id}:credited`,
  });
  return credit;
}

/** The customer keeps the goods (the hub's "customer keeps"): credited as approved, nothing to check. */
async function creditKept(tx: Runner, me: Me, id: number): Promise<void> {
  const found = await lockReturn(tx, id);
  await tx.execute(sql`update sales_return_line set outcome = 'kept' where return_id = ${id}`);
  await applyCredit(tx, me, found, "the customer keeps the goods");
}

/** Management's word: approved (the road the goods take follows) or not, with why. */
export async function decideReturn(
  db: Database,
  me: Me,
  id: number,
  input: { approve: boolean; note?: string | null },
): Promise<void> {
  allow(me, ORDER_MANAGE_ROLES, "approve a return");
  if (!input.approve && !clean(input.note))
    throw new Refusal(400, "invalid", "Say why it isn't approved.", "note");
  // Not shipped yet: approving cancels the order first (its own rules: the invoice cancelled,
  // packed pieces back on the shelf, what was paid on Refunds owed).
  const [first] = await rows<{ goods: ReturnGoods; status: string; orderId: number; code: string; reason: ReturnReason; note: string | null }>(
    db,
    sql`select goods, status, order_id::int as "orderId", code, reason, note from sales_return where id = ${id}`,
  );
  if (!first) throw new Refusal(404, "not_found", "That return doesn't exist.");
  if (first.status !== "requested")
    throw new Refusal(409, "not_now", `${first.code} isn't waiting for Management now.`);
  if (input.approve && first.goods === "not_shipped")
    await actOnOrder(db, me, first.orderId, "cancel", {
      reason: `Return ${first.code}: ${RETURN_REASON_LABEL[first.reason]}${first.note ? `, ${first.note}` : ""}${clean(input.note) ? `. ${clean(input.note)}` : ""}`,
    });
  await db.transaction(async (tx) => {
    const found = await lockReturn(tx, id);
    if (found.status !== "requested")
      throw new Refusal(409, "not_now", `${found.code} isn't waiting for Management now.`);
    const done = input.approve && found.goods === "not_shipped";
    await tx.execute(
      sql`update sales_return set status = ${!input.approve ? "rejected" : done ? "received" : "approved"}, decided_by = ${me.id},
          decided_at = now(), decided_note = ${clean(input.note)},
          credited_by = ${done ? me.id : null}, credited_at = ${done ? sql`now()` : null} where id = ${id}`,
    );
    await logEvent(
      tx,
      found.orderId,
      me,
      "status",
      !input.approve
        ? `Return ${found.code} not approved by ${me.name}: ${clean(input.note)}`
        : found.goods === "coming_back"
          ? `Return ${found.code} approved by ${me.name}. Dispatch checks the goods when they come.`
          : found.goods === "not_shipped"
            ? `Return ${found.code} approved by ${me.name}: the order is cancelled, what was paid goes on Finance's refunds.`
            : `Return ${found.code} approved by ${me.name}.`,
    );
    if (input.approve && found.goods === "customer_keeps") await creditKept(tx, me, id);
    await notify(tx, {
      to: [
        found.requestedBy,
        ...(input.approve && found.goods === "coming_back" ? await peopleOf(tx, "dispatch") : []),
      ].filter((who) => who !== me.id),
      kind: "return",
      title: input.approve
        ? `Return ${found.code} on ${found.orderCode} approved`
        : `Return ${found.code} on ${found.orderCode} not approved`,
      body: clean(input.note),
      link: "/returns",
      orderId: found.orderId,
      key: `return:${id}:decided`,
    });
  });
}

/** Who asked takes it back while Management hasn't decided, or before the goods are checked. */
export async function cancelReturn(db: Database, me: Me, id: number): Promise<void> {
  await db.transaction(async (tx) => {
    const found = await lockReturn(tx, id);
    if (found.requestedBy !== me.id && !ORDER_MANAGE_ROLES.includes(me.role))
      throw new Refusal(403, "forbidden", "Only who asked for it can take it back.");
    if (found.status !== "requested" && found.status !== "approved")
      throw new Refusal(409, "not_now", `${found.code} is done: it can't be taken back.`);
    await tx.execute(sql`update sales_return set status = 'cancelled' where id = ${id}`);
    await logEvent(
      tx,
      found.orderId,
      me,
      "status",
      `Return ${found.code} cancelled by ${me.name}.`,
    );
  });
}

/** Dispatch checks what came back, line by line: good back on the shelf, damaged written off.
 *  Management then credits the bill (the hub's Refund press after the goods check). */
export async function receiveReturn(
  db: Database,
  me: Me,
  id: number,
  input: { lines: { lineId: number; outcome: ReturnOutcome }[] },
): Promise<{ credit: number }> {
  allow(me, DISPATCH_ROLES, "check returned goods");
  return db.transaction(async (tx) => {
    const found = await lockReturn(tx, id);
    if (found.status !== "approved" || found.goods !== "coming_back")
      throw new Refusal(
        409,
        "not_now",
        found.status === "requested"
          ? `${found.code} waits for Management's approval first.`
          : `${found.code} isn't waiting for its goods now.`,
      );
    const lines = await rows<{
      id: number;
      orderItemId: number;
      medicineId: number;
      medicine: string;
      qty: number;
      unitPrice: number;
    }>(
      tx,
      sql`select l.id::int as id, l.order_item_id::int as "orderItemId", l.medicine_id::int as "medicineId",
          m.name || coalesce(' ' || m.strength, '') as medicine, l.qty::int as qty, l.unit_price::int as "unitPrice"
        from sales_return_line l join medicine m on m.id = l.medicine_id where l.return_id = ${id} order by l.id`,
    );
    const outcomeOf = new Map(input.lines.map((line) => [line.lineId, line.outcome]));
    for (const line of lines) {
      const outcome = outcomeOf.get(line.id);
      if (!outcome || outcome === "kept")
        throw new Refusal(
          400,
          "invalid",
          `Say what came back of ${line.medicine}: good, damaged or not received.`,
          "lines",
        );
    }
    let credit = 0;
    const said: string[] = [];
    for (const line of lines) {
      const outcome = outcomeOf.get(line.id) as ReturnOutcome;
      let batchId: number | null = null;
      let warehouseId: number | null = null;
      if (outcome === "restocked") {
        // Back into the batch it left from (the largest pick of that line), in its warehouse.
        const [pick] = await rows<{ batchId: number; warehouseId: number }>(
          tx,
          sql`select batch_id::int as "batchId", warehouse_id::int as "warehouseId" from order_pick
            where order_item_id = ${line.orderItemId} order by qty desc, id limit 1`,
        );
        // None on record (an older order): the medicine's latest batch, in the order's warehouse.
        const [fallback] = pick
          ? [pick]
          : await rows<{ batchId: number; warehouseId: number }>(
              tx,
              sql`select b.id::int as "batchId",
                  coalesce((select o.warehouse_id from sales_order o where o.id = ${found.orderId}),
                    (select w.id from warehouse w where w.active order by w.is_default desc, w.id limit 1))::int as "warehouseId"
                from batch b where b.medicine_id = ${line.medicineId} order by b.expires_on desc, b.id desc limit 1`,
            );
        if (!fallback?.warehouseId)
          throw new Refusal(
            409,
            "not_now",
            `No batch of ${line.medicine} is on record: count it in as a stock adjustment instead.`,
          );
        batchId = fallback.batchId;
        warehouseId = fallback.warehouseId;
        await putIn(tx, batchId, warehouseId, line.qty);
        await logMove(tx, {
          medicineId: line.medicineId,
          batchId,
          warehouseId,
          qty: line.qty,
          kind: "return",
          ref: found.code,
          note: `Came back from ${found.orderCode}`,
          by: me.id,
        });
      }
      if (outcome !== "missing") credit += line.qty * line.unitPrice;
      said.push(
        `${line.medicine} × ${line.qty} ${outcome === "restocked" ? "back on the shelf" : outcome === "damaged" ? "damaged, written off" : "not received"}`,
      );
      await tx.execute(
        sql`update sales_return_line set outcome = ${outcome}, batch_id = ${batchId}, warehouse_id = ${warehouseId} where id = ${line.id}`,
      );
    }
    await tx.execute(
      sql`update sales_return set status = 'checked', received_by = ${me.id}, received_at = now(), credit = ${credit} where id = ${id}`,
    );
    await logEvent(
      tx,
      found.orderId,
      me,
      "status",
      `Return ${found.code} goods checked by ${me.name}: ${said.join("; ")}. Management credits ${peso(credit)} on the bill, or not.`,
    );
    await notify(tx, {
      to: (await peopleOf(tx, "management")).filter((who) => who !== me.id),
      kind: "return",
      title: `Return ${found.code} on ${found.orderCode}: goods checked, credit ${peso(credit)}?`,
      body: said.join("; "),
      link: "/returns?status=checked",
      orderId: found.orderId,
      key: `return:${id}:checked`,
    });
    return { credit };
  });
}

/** Management, after Dispatch's check: credit the bill by what came back, or not (with why). */
export async function creditReturn(
  db: Database,
  me: Me,
  id: number,
  input: { credit: boolean; note?: string | null },
): Promise<void> {
  allow(me, ORDER_MANAGE_ROLES, "credit a return");
  if (!input.credit && !clean(input.note))
    throw new Refusal(400, "invalid", "Say why it isn't credited.", "note");
  await db.transaction(async (tx) => {
    const found = await lockReturn(tx, id);
    if (found.status !== "checked")
      throw new Refusal(409, "not_now", `${found.code} isn't waiting to be credited now.`);
    if (input.credit) {
      await applyCredit(tx, me, found, clean(input.note) ?? "the goods checked by Dispatch");
      return;
    }
    await tx.execute(
      sql`update sales_return set status = 'rejected', decided_by = ${me.id}, decided_at = now(), decided_note = ${clean(input.note)}, credit = 0
        where id = ${id}`,
    );
    await logEvent(
      tx,
      found.orderId,
      me,
      "status",
      `Return ${found.code} not credited by ${me.name}: ${clean(input.note)}. What came back stays as Dispatch checked it.`,
    );
    await notify(tx, {
      to: [found.requestedBy].filter((who) => who !== me.id),
      kind: "return",
      title: `Return ${found.code} on ${found.orderCode} not credited`,
      body: clean(input.note),
      link: "/returns",
      orderId: found.orderId,
      key: `return:${id}:not-credited`,
    });
  });
}

const returnColumns = sql`r.id::int as id, r.code, r.order_id::int as "orderId", o.code as "orderCode", c.name as customer,
  rep.name as medrep, r.status, r.goods, r.reason, r.note, asker.name as "requestedBy", r.requested_by::int as "requestedById",
  ${iso("r.requested_at")} as "requestedAt", decider.name as "decidedBy", r.decided_note as "decidedNote",
  ${iso("r.decided_at")} as "decidedAt", receiver.name as "receivedBy", ${iso("r.received_at")} as "receivedAt", crediter.name as "creditedBy", ${iso("r.credited_at")} as "creditedAt", r.credit::int as credit,
  coalesce((select json_agg(json_build_object('id', l.id, 'medicine', m.name || coalesce(' ' || m.strength, ''), 'qty', l.qty,
    'unitPrice', l.unit_price, 'outcome', l.outcome) order by l.id)
    from sales_return_line l join medicine m on m.id = l.medicine_id where l.return_id = r.id), '[]'::json) as lines`;
const returnFrom = sql`from sales_return r join sales_order o on o.id = r.order_id join customer c on c.id = o.customer_id
  join person rep on rep.id = o.medrep_id join person asker on asker.id = r.requested_by
  left join person decider on decider.id = r.decided_by left join person receiver on receiver.id = r.received_by
  left join person crediter on crediter.id = r.credited_by`;

type Row = Omit<ReturnRow, "statusLabel" | "goodsLabel" | "reasonLabel" | "can">;
function labelled(me: Me, row: Row): ReturnRow {
  return {
    ...row,
    statusLabel:
      row.status === "received" && row.goods === "not_shipped"
        ? "Order cancelled: Finance gives back what was paid"
        : RETURN_STATUS_LABEL[row.status],
    goodsLabel: RETURN_GOODS_LABEL[row.goods],
    reasonLabel: RETURN_REASON_LABEL[row.reason],
    can: {
      decide: ORDER_MANAGE_ROLES.includes(me.role) && row.status === "requested",
      receive:
        DISPATCH_ROLES.includes(me.role) && row.status === "approved" && row.goods === "coming_back",
      credit: ORDER_MANAGE_ROLES.includes(me.role) && row.status === "checked",
      cancel:
        (row.requestedById === me.id || ORDER_MANAGE_ROLES.includes(me.role)) &&
        (row.status === "requested" || row.status === "approved"),
    },
  };
}

/** Returns, the ones waiting on this person's desk first. A MedRep sees their own orders'. */
export async function listReturns(
  db: Database,
  me: Me,
  filter: { status?: string },
): Promise<ReturnList> {
  const all = READ_ALL.includes(me.role);
  const status = ["requested", "approved", "checked", "received", "rejected", "cancelled"].includes(
    filter.status ?? "",
  )
    ? filter.status
    : null;
  const found = await rows<Row>(
    db,
    sql`select ${returnColumns} ${returnFrom}
      where ${all ? sql`true` : sql`(o.medrep_id = ${me.id} or o.raised_by = ${me.id} or r.requested_by = ${me.id})`}
        ${status ? sql`and r.status = ${status}` : sql``}
      order by case r.status when 'requested' then 0 when 'checked' then 1 when 'approved' then 2 else 3 end, r.requested_at desc limit 200`,
  );
  const counts = await rows<{ status: ReturnRow["status"]; n: number }>(
    db,
    sql`select r.status, count(*)::int as n ${returnFrom}
      where ${all ? sql`true` : sql`(o.medrep_id = ${me.id} or o.raised_by = ${me.id} or r.requested_by = ${me.id})`}
      group by r.status`,
  );
  return {
    rows: found.map((row) => labelled(me, row)),
    counts: Object.fromEntries(counts.map((row) => [row.status, row.n])),
  };
}

/** One order's returns and what can still come back, for its page. */
export async function orderReturns(db: Runner, me: Me, orderId: number): Promise<OrderReturns> {
  const [found, left, order] = await Promise.all([
    rows<Row>(
      db,
      sql`select ${returnColumns} ${returnFrom} where r.order_id = ${orderId} order by r.requested_at desc`,
    ),
    returnable(db, orderId),
    rows<{ status: string; medrepId: number; raisedBy: number; team: boolean }>(
      db,
      sql`select o.status, o.medrep_id::int as "medrepId", o.raised_by::int as "raisedBy", ${inTeamSql(me)} as team
        from sales_order o where o.id = ${orderId}`,
    ),
  ]);
  const one = order[0];
  const asker = Boolean(one) && mayAsk(me, one as { medrepId: number; raisedBy: number; team: boolean });
  // Where the goods may be now: delivered (coming back, or the customer keeps them), or not on
  // the road yet (the MedRep asks Management to cancel; Management cancels it itself).
  const goods: ReturnGoods[] =
    one?.status === "completed" && left.some((line) => line.left > 0)
      ? ["coming_back", "customer_keeps"]
      : one && BEFORE_SHIP.includes(one.status) && !ORDER_MANAGE_ROLES.includes(me.role) &&
          !found.some((row) => row.status === "requested")
        ? ["not_shipped"]
        : [];
  return {
    returns: found.map((row) => labelled(me, row)),
    left,
    can: { ask: asker && goods.length > 0, goods },
  };
}

/** A return is read by whoever may read its order. */
export async function mayReadReturnOrder(db: Database, me: Me, orderId: number) {
  return mayReadOrder(db, me, orderId);
}
