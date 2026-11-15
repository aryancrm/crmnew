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
