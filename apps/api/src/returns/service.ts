// Goods that come back after delivery (Aryan). The MedRep who sold it (or Management) asks for
// a return: which medicines, how many, why. Management approves it (its own request is approved
// as it is made). Dispatch checks what came back: good goes back on the shelf into the batch it
// left from, damaged is written off, missing isn't credited. What came back is credited on the
// bill: the invoice's total comes down, so what is owed, the sales and the MedRep's target all
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
import { mayReadOrder } from "../orders/service";
import { settleOrderPoints } from "../points/service";
import type {
  Me,
  OrderReturns,
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
  received: "Received and credited",
  rejected: "Not approved",
  cancelled: "Cancelled",
};
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
            and (r.status in ('requested', 'approved') or (r.status = 'received' and l.outcome <> 'missing'))), 0))::int as left
      from order_item i join medicine m on m.id = i.medicine_id where i.order_id = ${orderId} order by i.id`,
  );
}

/** May this person ask for a return on this order: who sold it, or Management. */
function mayAsk(me: Me, order: { medrepId: number; raisedBy: number }) {
  return (
    ORDER_MANAGE_ROLES.includes(me.role) || order.medrepId === me.id || order.raisedBy === me.id
  );
}

export async function requestReturn(
  db: Database,
  me: Me,
  orderId: number,
  input: ReturnInput,
): Promise<number> {
  const lines = input.lines.filter((line) => line.qty > 0);
  if (!lines.length)
    throw new Refusal(400, "invalid", "Say how many of a medicine come back.", "lines");
  if (!RETURN_REASONS.includes(input.reason))
    throw new Refusal(400, "invalid", "Say why it comes back.", "reason");
  return db.transaction(async (tx) => {
    const [order] = await rows<{
      id: number;
      code: string;
      status: string;
      medrepId: number;
      raisedBy: number;
    }>(
      tx,
      sql`select id::int as id, code, status, medrep_id::int as "medrepId", raised_by::int as "raisedBy"
        from sales_order where id = ${orderId} for update`,
    );
    if (!order) throw new Refusal(404, "not_found", "That order doesn't exist.");
    if (!mayAsk(me, order))
      throw new Refusal(403, "forbidden", "Only who sold it, or Management, asks for a return.");
    if (order.status !== "completed")
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
      sql`insert into sales_return (order_id, status, reason, note, requested_by, decided_by, decided_at)
        values (${orderId}, ${manages ? "approved" : "requested"}, ${input.reason}, ${clean(input.note)}, ${me.id},
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
    const said = lines
      .map(
        (line) =>
          `${left.find((one) => one.orderItemId === line.orderItemId)?.medicine} × ${line.qty}`,
      )
      .join(", ");
    await logEvent(
      tx,
      orderId,
      me,
      "status",
      `Return ${code?.code} asked by ${me.name}: ${said}. Why: ${RETURN_REASON_LABEL[input.reason]}${clean(input.note) ? `, ${clean(input.note)}` : ""}.${manages ? " Approved as it was made." : ""}`,
    );
    await notify(tx, {
      to: manages ? await peopleOf(tx, "dispatch") : await peopleOf(tx, "management"),
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
    orderId: number;
    orderCode: string;
    requestedBy: number;
  }>(
    tx,
    sql`select r.id::int as id, r.code, r.status, r.order_id::int as "orderId", o.code as "orderCode", r.requested_by::int as "requestedBy"
      from sales_return r join sales_order o on o.id = r.order_id where r.id = ${id} for update of r`,
  );
  if (!found) throw new Refusal(404, "not_found", "That return doesn't exist.");
  return found;
}

/** Management's word: approved (Dispatch then checks the goods) or not, with why. */
export async function decideReturn(
  db: Database,
  me: Me,
  id: number,
  input: { approve: boolean; note?: string | null },
): Promise<void> {
  allow(me, ORDER_MANAGE_ROLES, "approve a return");
  if (!input.approve && !clean(input.note))
    throw new Refusal(400, "invalid", "Say why it isn't approved.", "note");
  await db.transaction(async (tx) => {
    const found = await lockReturn(tx, id);
    if (found.status !== "requested")
      throw new Refusal(409, "not_now", `${found.code} isn't waiting for Management now.`);
    await tx.execute(
      sql`update sales_return set status = ${input.approve ? "approved" : "rejected"}, decided_by = ${me.id},
          decided_at = now(), decided_note = ${clean(input.note)} where id = ${id}`,
    );
    await logEvent(
      tx,
      found.orderId,
      me,
      "status",
      input.approve
        ? `Return ${found.code} approved by ${me.name}. Dispatch checks the goods when they come.`
        : `Return ${found.code} not approved by ${me.name}: ${clean(input.note)}`,
    );
    await notify(tx, {
      to: [found.requestedBy, ...(input.approve ? await peopleOf(tx, "dispatch") : [])].filter(
        (who) => who !== me.id,
      ),
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

/** Who asked takes it back while Management hasn't decided. */
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

/** Dispatch checks what came back, line by line; the bill is credited by what came back. */
export async function receiveReturn(
  db: Database,
  me: Me,
  id: number,
  input: { lines: { lineId: number; outcome: ReturnOutcome }[] },
): Promise<{ credit: number }> {
  allow(me, DISPATCH_ROLES, "check returned goods");
  return db.transaction(async (tx) => {
    const found = await lockReturn(tx, id);
    if (found.status !== "approved")
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
      vat: Vat;
    }>(
      tx,
      sql`select l.id::int as id, l.order_item_id::int as "orderItemId", l.medicine_id::int as "medicineId",
          m.name || coalesce(' ' || m.strength, '') as medicine, l.qty::int as qty, l.unit_price::int as "unitPrice",
          -- A senior's or PWD's line was sold VAT-exempt: its credit is too.
          case when (select oi.relief from order_item oi where oi.id = l.order_item_id) then 'exempt' else m.vat end as vat
        from sales_return_line l join medicine m on m.id = l.medicine_id where l.return_id = ${id} order by l.id`,
    );
    const outcomeOf = new Map(input.lines.map((line) => [line.lineId, line.outcome]));
    for (const line of lines)
      if (!outcomeOf.get(line.id))
        throw new Refusal(
          400,
          "invalid",
          `Say what came back of ${line.medicine}: good, damaged or not received.`,
          "lines",
        );
    let credit = 0;
    const credited: { amount: number; vat: Vat }[] = [];
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
      if (outcome !== "missing") {
        credit += line.qty * line.unitPrice;
        credited.push({ amount: line.qty * line.unitPrice, vat: line.vat });
      }
      said.push(
        `${line.medicine} × ${line.qty} ${outcome === "restocked" ? "back on the shelf" : outcome === "damaged" ? "damaged, written off" : "not received"}`,
      );
      await tx.execute(
        sql`update sales_return_line set outcome = ${outcome}, batch_id = ${batchId}, warehouse_id = ${warehouseId} where id = ${line.id}`,
      );
    }
    // The bill comes down by what came back; its VAT split with it.
    const [invoice] = await rows<{ id: number; total: number; paid: number; refunded: number }>(
      tx,
      sql`select id::int as id, total::int as total, paid::int as paid, refunded::int as refunded
        from invoice where order_id = ${found.orderId} and status <> 'cancelled' for update`,
    );
    let refundNote = "";
    if (invoice && credit > 0) {
      const amount = Math.min(credit, invoice.total);
      const split = vatSplit(credited);
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
      sql`update sales_return set status = 'received', received_by = ${me.id}, received_at = now(), credit = ${credit} where id = ${id}`,
    );
    await logEvent(
      tx,
      found.orderId,
      me,
      "status",
      `Return ${found.code} received by ${me.name}: ${said.join("; ")}. Credited ${peso(credit)} on the bill.${refundNote}`,
    );
    await settleOrderPoints(tx, found.orderId);
    await notify(tx, {
      to: [found.requestedBy, ...(refundNote ? await peopleOf(tx, "finance") : [])].filter(
        (who) => who !== me.id,
      ),
      kind: "return",
      title: `Return ${found.code} on ${found.orderCode}: ${peso(credit)} credited`,
      body: `${said.join("; ")}.${refundNote}`,
      link: "/returns",
      orderId: found.orderId,
      key: `return:${id}:received`,
    });
    return { credit };
  });
}

const returnColumns = sql`r.id::int as id, r.code, r.order_id::int as "orderId", o.code as "orderCode", c.name as customer,
  rep.name as medrep, r.status, r.reason, r.note, asker.name as "requestedBy", r.requested_by::int as "requestedById",
  ${iso("r.requested_at")} as "requestedAt", decider.name as "decidedBy", r.decided_note as "decidedNote",
  ${iso("r.decided_at")} as "decidedAt", receiver.name as "receivedBy", ${iso("r.received_at")} as "receivedAt", r.credit::int as credit,
  coalesce((select json_agg(json_build_object('id', l.id, 'medicine', m.name || coalesce(' ' || m.strength, ''), 'qty', l.qty,
    'unitPrice', l.unit_price, 'outcome', l.outcome) order by l.id)
    from sales_return_line l join medicine m on m.id = l.medicine_id where l.return_id = r.id), '[]'::json) as lines`;
const returnFrom = sql`from sales_return r join sales_order o on o.id = r.order_id join customer c on c.id = o.customer_id
  join person rep on rep.id = o.medrep_id join person asker on asker.id = r.requested_by
  left join person decider on decider.id = r.decided_by left join person receiver on receiver.id = r.received_by`;

function labelled(me: Me, row: Omit<ReturnRow, "statusLabel" | "reasonLabel" | "can">): ReturnRow {
  return {
    ...row,
    statusLabel: RETURN_STATUS_LABEL[row.status],
    reasonLabel: RETURN_REASON_LABEL[row.reason],
    can: {
      decide: ORDER_MANAGE_ROLES.includes(me.role) && row.status === "requested",
      receive: DISPATCH_ROLES.includes(me.role) && row.status === "approved",
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
  const status = ["requested", "approved", "received", "rejected", "cancelled"].includes(
    filter.status ?? "",
  )
    ? filter.status
    : null;
  const found = await rows<Omit<ReturnRow, "statusLabel" | "reasonLabel" | "can">>(
    db,
    sql`select ${returnColumns} ${returnFrom}
      where ${all ? sql`true` : sql`(o.medrep_id = ${me.id} or o.raised_by = ${me.id} or r.requested_by = ${me.id})`}
        ${status ? sql`and r.status = ${status}` : sql``}
      order by case r.status when 'requested' then 0 when 'approved' then 1 else 2 end, r.requested_at desc limit 200`,
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
    rows<Omit<ReturnRow, "statusLabel" | "reasonLabel" | "can">>(
      db,
      sql`select ${returnColumns} ${returnFrom} where r.order_id = ${orderId} order by r.requested_at desc`,
    ),
    returnable(db, orderId),
    rows<{ status: string; medrepId: number; raisedBy: number }>(
      db,
      sql`select status, medrep_id::int as "medrepId", raised_by::int as "raisedBy" from sales_order where id = ${orderId}`,
    ),
  ]);
  const one = order[0];
  return {
    returns: found.map((row) => labelled(me, row)),
    left,
    can: {
      ask:
        Boolean(one) &&
        one?.status === "completed" &&
        mayAsk(me, one as { medrepId: number; raisedBy: number }) &&
        left.some((line) => line.left > 0),
    },
  };
}

/** A return is read by whoever may read its order. */
export async function mayReadReturnOrder(db: Database, me: Me, orderId: number) {
  return mayReadOrder(db, me, orderId);
}
