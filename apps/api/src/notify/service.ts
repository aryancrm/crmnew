// The bell: each person is told about their own work, in a line they can open. Orders arriving
// at a desk (a payment to check, an order to pack) and a MedRep's order going out or arriving are
// written by the database itself (migration 0024), whichever code moved the order; what a person
// decided with a reason (sent back, held, taken back, fixed and sent again, came back) is written
// here, right after it is saved. A line is kept once per event and person.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { Refusal } from "../http";
import { iso, type Runner } from "../inventory/service";
import { STATUS_LABEL } from "../orders/rules";
import type { Me, NotificationList, OrderAction, OrderStatus } from "../types";

export async function notify(
  db: Runner,
  input: {
    to: number[];
    kind: string;
    title: string;
    body?: string | null;
    link?: string | null;
    orderId?: number | null;
    /** One line per event and person: the same key twice tells once. */
    key: string;
  },
): Promise<void> {
  const people = [...new Set(input.to.filter((id) => Number.isInteger(id) && id > 0))];
  for (const person of people)
    await db.execute(
      sql`insert into notification (person_id, kind, title, body, link, order_id, key)
          values (${person}, ${input.kind}, ${input.title}, ${input.body ?? null}, ${input.link ?? null},
            ${input.orderId ?? null}, ${input.key})
        on conflict (person_id, key) do nothing`,
    );
}

/** Everyone in a role who is at work. */
export async function peopleIn(db: Runner, roles: string[]): Promise<number[]> {
  const found = await rows<{ id: number }>(
    db,
    sql`select id::int as id from person where active and role in (${sql.join(
      roles.map((role) => sql`${role}`),
      sql`, `,
    )})`,
  );
  return found.map((row) => row.id);
}

/** What a person is told after deciding on an order: whose order it is, and who must act next. */
export async function tellAboutOrder(
  db: Database,
  me: Me,
  orderId: number,
  action: OrderAction | "revise" | "failed",
  reason: string | null,
  before: OrderStatus,
): Promise<void> {
  const [order] = await rows<{
    code: string;
    customer: string;
    medrepId: number;
    raisedBy: number;
    sentBackBy: number | null;
    status: OrderStatus;
    reply: string | null;
    heldRole: string | null;
  }>(
    db,
    sql`select o.code, c.name as customer, o.medrep_id::int as "medrepId", o.raised_by::int as "raisedBy",
        o.sent_back_by::int as "sentBackBy", o.status, o.reply, o.held_role as "heldRole"
      from sales_order o join customer c on c.id = o.customer_id where o.id = ${orderId}`,
  );
  if (!order) return;
  const label = `${order.code} · ${order.customer}`;
  const link = `/orders/${orderId}`;
  const seller = [order.medrepId, order.raisedBy].filter((id) => id !== me.id);
  const stamp = Date.now();
  const say = (to: number[], kind: string, title: string, body: string | null) =>
    notify(db, {
      to: to.filter((id) => id !== me.id),
      kind,
      title,
      body,
      link,
      orderId,
      key: `${kind}:${orderId}:${stamp}`,
    });

  switch (action) {
    case "send_back":
      return say(
        seller,
        "sent_back",
        `Sent back to you: ${label}`,
        `${me.name}: ${reason ?? ""} Fix it and send it again.`,
      );
    case "approve":
      return say(
        seller,
        "approved",
        `Approved: ${label}`,
        order.status === "finance_check" || order.status === "ready_for_invoice"
          ? `By ${me.name}. It is with Finance now.`
          : `By ${me.name}. It goes to Dispatch.`,
      );
    case "reject":
    case "hold":
    case "exception": {
      // A hold by Finance or Dispatch is Management's to know about too.
      const desk =
        order.heldRole && order.heldRole !== "management" ? await peopleIn(db, ["management"]) : [];
      const by =
        order.heldRole === "finance"
          ? "Finance"
          : order.heldRole === "dispatch"
            ? "Dispatch"
            : me.name;
      return say([...seller, ...desk], "held", `On hold: ${label}`, `${by}: ${reason ?? ""}`);
    }
    case "resume":
    case "restore": {
      // As the hub: the MedRep, and the desk it is with now.
      const desk = await peopleIn(
        db,
        order.status === "pending_approval"
          ? ["management"]
          : ["finance_check", "ready_for_invoice"].includes(order.status)
            ? ["finance"]
            : ["dispatch"],
      );
      return say(
        [...seller, ...desk],
        "resumed",
        action === "restore" ? `Restored: ${label}` : `Taken off hold: ${label}`,
        `By ${me.name}. It goes on from ${STATUS_LABEL[order.status]}.${reason ? ` Why: ${reason}` : ""}`,
      );
    }
    case "cancel":
      return say(seller, "cancelled", `Cancelled: ${label}`, `${me.name}: ${reason ?? ""}`);
    case "take_back": {
      // The desk it had reached stops seeing it; the MedRep had heard it was approved.
      const desk = ["finance_check", "ready_for_invoice"].includes(before)
        ? await peopleIn(db, ["finance"])
        : before === "ready_for_dispatch"
          ? await peopleIn(db, ["dispatch"])
          : [];
      return say(
        [...desk, ...seller],
        "taken_back",
        `Approval taken back: ${label}`,
        `${me.name}: ${reason ?? ""} It is back with Management; nothing to do on it for now.`,
      );
    }
    case "resubmit":
    case "revise": {
      const to = order.sentBackBy ? [order.sentBackBy] : await peopleIn(db, ["management"]);
      return say(
        to,
        "resent",
        `${me.name} sent it again: ${label}`,
        `${action === "revise" ? "Fixed. " : "Unchanged. "}Answer: ${order.reply ?? reason ?? ""}`,
      );
    }
    case "answer": {
      const desk = await peopleIn(
        db,
        order.heldRole === "finance"
          ? ["finance"]
          : order.heldRole === "dispatch"
            ? ["dispatch"]
            : ["management"],
      );
      return say(desk, "resent", `${me.name} answered the hold: ${label}`, reason ?? "");
    }
    case "failed":
      return say(
        [...seller, ...(await peopleIn(db, ["management"]))],
        "came_back",
        `Came back undelivered: ${label}`,
        `${me.name}: ${reason ?? ""} It is back at the warehouse, still packed.`,
      );
    default:
      return;
  }
}

export async function myNotifications(db: Database, me: Me): Promise<NotificationList> {
  const [found, counted] = await Promise.all([
    rows<NotificationList["rows"][number]>(
      db,
      sql`select id::int as id, kind, title, body, link, ${iso("at")} as at, read_at is not null as read
        from notification where person_id = ${me.id} order by at desc, id desc limit 30`,
    ),
    rows<{ unread: number }>(
      db,
      sql`select count(*)::int as unread from notification where person_id = ${me.id} and read_at is null`,
    ),
  ]);
  return { unread: counted[0]?.unread ?? 0, rows: found };
}

export async function readNotification(db: Database, me: Me, id: number): Promise<void> {
  const [done] = await rows<{ id: number }>(
    db,
    sql`update notification set read_at = coalesce(read_at, now()) where id = ${id} and person_id = ${me.id} returning id::int as id`,
  );
  if (!done) throw new Refusal(404, "not_found", "That isn't one of your notifications.");
}

export async function readAllNotifications(db: Database, me: Me): Promise<void> {
  await db.execute(
    sql`update notification set read_at = now() where person_id = ${me.id} and read_at is null`,
  );
}
