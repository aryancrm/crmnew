// Demo only: the seeded orders all moved within a second, so every desk looks instant. This spreads
// each order's steps over believable times (Management minutes to hours, Finance up to a day or so,
// packing hours, the road a day or three) ending now, moving the timeline's entries with them, so
// Speed and the clocks on the cards show something real. Never runs online (SEED_DEMO only).

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";

/** Minutes a step takes in the demo: [shortest, longest]. */
const SPAN: Record<string, [number, number]> = {
  pending_approval: [12, 420],
  finance_check: [30, 1500],
  ready_for_invoice: [20, 900],
  ready_for_dispatch: [45, 1400],
  packing: [20, 600],
  shipped: [600, 4300],
  draft: [60, 1300],
};

/** Whose step each status is (the roles that move an order on from it). */
const DESK: Record<string, string[]> = {
  pending_approval: ["management", "admin", "ceo"],
  finance_check: ["finance", "admin"],
  ready_for_invoice: ["finance", "admin"],
  ready_for_dispatch: ["dispatch", "admin"],
  packing: ["dispatch", "admin"],
  shipped: ["dispatch", "online", "admin"],
  draft: ["medrep", "team_lead", "manager", "online"],
};

export async function spreadDemoStepTimes(db: Database): Promise<number> {
  let seed = 20261115;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const between = ([low, high]: [number, number]) => Math.round(low + random() * (high - low));
  const steps = await rows<{
    id: number;
    orderId: number;
    status: string;
    enteredAt: string;
    leftAt: string | null;
  }>(
    db,
    sql`select id::int as id, order_id::int as "orderId", status, entered_at::text as "enteredAt", left_at::text as "leftAt"
      from order_step order by order_id, entered_at, id`,
  );
  const byOrder = new Map<number, typeof steps>();
  for (const step of steps) byOrder.set(step.orderId, [...(byOrder.get(step.orderId) ?? []), step]);
  const events = await rows<{ id: number; orderId: number; at: string; role: string | null }>(
    db,
    sql`select e.id::int as id, e.order_id::int as "orderId", e.at::text as at, p.role from order_event e
      left join person p on p.id = e.by_person where e.stage <> 'created' order by e.order_id, e.id`,
  );
  const eventsOf = new Map<number, typeof events>();
  for (const one of events) eventsOf.set(one.orderId, [...(eventsOf.get(one.orderId) ?? []), one]);
  const now = Date.now();
  for (const [orderId, list] of byOrder) {
    const minutes = list.map((step) => (step.leftAt ? between(SPAN[step.status] ?? [10, 120]) : 0));
    const open = between([10, 700]);
    const total = minutes.reduce((sum, value) => sum + value, 0);
    let cursor = now - (total + open) * 60_000;
    const placed = new Date(cursor).toISOString();
    // Each step that ended has one event: the one Speed reads as who moved it on (the nearest,
    // then the first), each event given to one step only (the seed moved several in one second).
    const taken = new Set<number>();
    const mover = list.map((step) => {
      if (!step.leftAt) return null;
      const left = Date.parse(step.leftAt);
      const desk = DESK[step.status];
      const close = (eventsOf.get(orderId) ?? []).filter(
        (one) => !taken.has(one.id) && Math.abs(Date.parse(one.at) - left) <= 15_000,
      );
      // The desk whose step it is moved it on: an approval is Management's, a payment Finance's.
      const ours = desk ? close.filter((one) => desk.includes(one.role ?? "")) : [];
      const near = (ours.length ? ours : close).sort(
        (a, b) =>
          Math.abs(Date.parse(a.at) - left) - Math.abs(Date.parse(b.at) - left) || a.id - b.id,
      )[0];
      if (near) taken.add(near.id);
      return near?.id ?? null;
    });
    await db.transaction(async (tx) => {
      for (const [n, step] of list.entries()) {
        const entered = new Date(cursor).toISOString();
        const left = step.leftAt
          ? new Date(cursor + (minutes[n] as number) * 60_000).toISOString()
          : null;
        const moved = mover[n];
        if (left && moved)
          await tx.execute(
            sql`update order_event set at = ${left}::timestamptz where id = ${moved}`,
          );
        await tx.execute(
          sql`update order_step set entered_at = ${entered}::timestamptz, left_at = ${left}::timestamptz where id = ${step.id}`,
        );
        if (step.status === "shipped" && left)
          await tx.execute(
            sql`update sales_order set shipped_at = ${entered}::timestamptz, delivered_at = ${left}::timestamptz,
              delivered_on = (${left}::timestamptz at time zone 'Asia/Manila')::date
              where id = ${orderId} and delivered_at is not null`,
          );
        if (left) cursor += (minutes[n] as number) * 60_000;
      }
      await tx.execute(
        sql`update sales_order set created_at = ${placed}::timestamptz, submitted_at = ${placed}::timestamptz,
          status_since = ${new Date(cursor).toISOString()}::timestamptz where id = ${orderId}`,
      );
      await tx.execute(
        sql`update order_event set at = ${placed}::timestamptz where order_id = ${orderId} and stage = 'created'`,
      );
    });
  }
  return byOrder.size;
}

const DAY_MS = 86_400_000;
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/**
 * Demo only: an invoice is never dated before its order. The finance seed ages a few credit
 * invoices (one long overdue) before the times are spread to end now. A completed order's whole
 * story moves back with its invoice (placed the day before it, delivered long ago, so it is truly
 * late); an open order's invoice is dated the day Finance made it. Safe to run on every start.
 */
export async function alignDemoMoneyDates(db: Database): Promise<number> {
  const wrong = await rows<{
    orderId: number;
    invoiceId: number;
    status: string;
    placed: string;
    issued: string;
  }>(
    db,
    sql`select o.id::int as "orderId", i.id::int as "invoiceId", o.status,
        (o.created_at at time zone 'Asia/Manila')::date::text as placed, i.issued_on::text as issued
      from invoice i join sales_order o on o.id = i.order_id
      where i.issued_on < (o.created_at at time zone 'Asia/Manila')::date`,
  );
  for (const one of wrong)
    await db.transaction(async (tx) => {
      if (one.status === "completed") {
        const back = sql`${`${daysBetween(one.issued, one.placed) + 1} days`}::interval`;
        await tx.execute(
          sql`update sales_order set created_at = created_at - ${back}, submitted_at = submitted_at - ${back},
              approved_at = approved_at - ${back}, updated_at = updated_at - ${back}, packed_at = packed_at - ${back},
              shipped_at = shipped_at - ${back}, delivered_at = delivered_at - ${back},
              delivered_on = (delivered_on - ${back})::date, expected_on = (expected_on - ${back})::date,
              sent_back_at = sent_back_at - ${back}, finance_checked_at = finance_checked_at - ${back},
              status_since = status_since - ${back}, dispatch_by_at = dispatch_by_at - ${back},
              came_back_at = came_back_at - ${back}
            where id = ${one.orderId}`,
        );
        await tx.execute(
          sql`update order_step set entered_at = entered_at - ${back}, left_at = left_at - ${back} where order_id = ${one.orderId}`,
        );
        await tx.execute(
          sql`update order_event set at = at - ${back} where order_id = ${one.orderId}`,
        );
        // Credit falls due its days after the delivery, cash on delivery on it.
        await tx.execute(
          sql`update invoice i set due_on = case
              when i.terms = 'days' then coalesce(o.delivered_on, i.issued_on) + coalesce(o.payment_days, 0)
              when i.terms = 'cod' then coalesce(o.delivered_on, i.issued_on) else i.due_on end
            from sales_order o where o.id = i.order_id and i.id = ${one.invoiceId}`,
        );
      } else {
        // Dated the day Finance finished with it (else the day it was placed).
        await tx.execute(
          sql`update invoice i set issued_on = made.day,
              due_on = case
                when i.terms = 'days' then coalesce(o.delivered_on, made.day) + coalesce(o.payment_days, 0)
                when i.terms = 'cod' then coalesce(o.delivered_on, made.day) else made.day end
            from sales_order o, lateral (select coalesce(
                (select max(s.left_at) from order_step s where s.order_id = o.id and s.status in ('finance_check', 'ready_for_invoice')),
                o.created_at) at time zone 'Asia/Manila' as at) step,
              lateral (select step.at::date as day) made
            where o.id = i.order_id and i.id = ${one.invoiceId}`,
        );
        await tx.execute(
          sql`update payment p set paid_on = greatest(p.paid_on, i.issued_on) from invoice i
            where i.id = p.invoice_id and i.id = ${one.invoiceId}`,
        );
      }
    });
  return wrong.length;
}
