// The customer hears of each step of their order, as in the old CRM (backend/apps/crm/src/
// customer-mail.ts and order-updates.ts): confirmed, on the way, delivered, payment received.
// Every order (a patient's case, a hospital's PO, a bid, a distributor's order) by email, once per
// step, automatically; and the same words, short, for WhatsApp, Viber, SMS and Messenger from the
// "Send to customer" button. A patient is greeted by their first name, a business by its name.
// An email never stops the step it follows: a failure is written on the order instead.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { logEvent } from "../orders/events";
import { companyInfo } from "../settings/service";
import type { CustomerUpdate, Me, TellEvent } from "../types";

export type { CustomerUpdate, TellEvent };

import { sendFromMailbox, sendOnCase, startEmailThread } from "./email";

export const TELL_TITLE: Record<TellEvent, string> = {
  confirmed: "Order confirmed",
  shipped: "On the way",
  delivered: "Delivered",
  paid: "Payment received",
};

const peso = (centavos: number) =>
  `₱${(centavos / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const phDate = (day: string) =>
  new Date(`${day.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-PH", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

/** The step an order has reached, for its update: the newest one there is to tell. */
export function stepOf(status: string, paid: boolean): TellEvent | null {
  if (status === "completed") return paid ? "paid" : "delivered";
  if (status === "shipped") return "shipped";
  // Confirmed once Management approves it (18 Nov): Finance's check and the packing come after.
  if (["finance_check", "ready_for_invoice", "ready_for_dispatch", "packing"].includes(status))
    return "confirmed";
  return null;
}

/** The update for one step of an order (null when that step hasn't happened). */
export async function customerUpdate(
  db: Database,
  orderId: number,
  wanted?: TellEvent,
): Promise<CustomerUpdate | null> {
  const [o] = await rows<{
    code: string;
    leadId: number | null;
    status: string;
    total: number;
    deliveryFee: number;
    pointsUsed: number;
    terms: string;
    days: number | null;
    termLabel: string | null;
    method: string | null;
    courier: string | null;
    tracking: string | null;
    rider: string | null;
    address: string | null;
    expectedOn: string | null;
    deliveredOn: string | null;
    customer: string;
    kind: string;
    patient: string | null;
    email: string | null;
    phone: string | null;
    chat: string | null;
  }>(
    db,
    sql`select o.code, o.lead_id::int as "leadId", o.status, o.total::int as total, o.delivery_fee::int as "deliveryFee",
        o.points_used::int as "pointsUsed", o.payment_terms as terms, o.payment_days::int as days, o.payment_term as "termLabel", o.delivery_method as method,
        o.courier, o.tracking, o.rider, o.delivery_address as address, to_char(o.expected_on, 'YYYY-MM-DD') as "expectedOn",
        to_char(o.delivered_on, 'YYYY-MM-DD') as "deliveredOn", c.name as customer, c.kind, coalesce(l.patient_name, l.name) as patient,
        coalesce(nullif(l.email, ''), nullif(c.email, '')) as email, coalesce(nullif(o.receiver_phone, ''), nullif(l.phone, ''), nullif(c.phone, '')) as phone,
        l.chat_channel as chat
      from sales_order o join customer c on c.id = o.customer_id left join lead l on l.id = o.lead_id where o.id = ${orderId}`,
  );
  if (!o) return null;
  const [company, lines, invoice, payment] = await Promise.all([
    companyInfo(db),
    rows<{
      name: string;
      qty: number;
      unit: string | null;
      price: number;
      amount: number;
      free: boolean;
      reason: string | null;
    }>(
      db,
      sql`select m.name || coalesce(' ' || m.strength, '') as name, i.qty::int as qty, m.unit, i.unit_price::int as price,
          (i.qty * i.unit_price)::int as amount, i.free, i.price_reason as reason
        from order_item i join medicine m on m.id = i.medicine_id where i.order_id = ${orderId} order by i.id`,
    ),
    rows<{ paid: number; balance: number; status: string; dueOn: string }>(
      db,
      sql`select paid::int as paid, (total - paid)::int as balance, status, to_char(due_on, 'YYYY-MM-DD') as "dueOn"
        from invoice where order_id = ${orderId} and status <> 'cancelled'`,
    ).then((found) => found[0] ?? null),
    rows<{ amount: number; reference: string | null; paidOn: string }>(
      db,
      sql`select p.amount::int as amount, p.reference, to_char(p.paid_on, 'YYYY-MM-DD') as "paidOn"
        from payment p join invoice i on i.id = p.invoice_id
        where i.order_id = ${orderId} and p.active and p.method <> 'points' order by p.at desc, p.id desc limit 1`,
    ).then((found) => found[0] ?? null),
  ]);
  const reached = stepOf(o.status, invoice?.status === "paid");
  const event = wanted ?? reached;
  if (!event) return null;
  const order = ["confirmed", "shipped", "delivered", "paid"];
  // Money can come before the goods (an advance, a deposit): "paid" goes whenever a payment is in.
  if (event === "paid" ? !payment : !reached || order.indexOf(event) > order.indexOf(reached))
    return null;

  // A patient by their first name; a hospital, a doctor's clinic or a business by its name.
  const business = o.kind !== "patient";
  const who = business ? o.customer : ((o.patient ?? o.customer).trim().split(/\s+/)[0] ?? "");
  const greeting = who ? `Good day, ${who}!` : "Good day!";
  const pickup = o.method === "pickup";
  const due = invoice
    ? Math.max(0, invoice.balance)
    : o.terms === "cod"
      ? Math.max(0, o.total - o.pointsUsed * 100)
      : 0;
  const tracking = [o.courier, o.tracking].filter(Boolean).join(" · ");
  const address =
    o.address && o.address.replace(/[^\p{L}\p{N}]/gu, "").length > 3 ? o.address : null;
  // "Anastrozole 1 mg × 30 tablets at ₱43.50: ₱1,305.00"; a free line says its promo.
  const pieces = (qty: number, unit: string | null) =>
    `${qty.toLocaleString("en-PH")}${unit ? ` ${qty === 1 || /s$/i.test(unit) ? unit : `${unit}s`}` : ""}`;
  const goods = lines.map((line) =>
    line.free
      ? `${line.name} × ${pieces(line.qty, line.unit)}: Free${line.reason && line.reason !== "Free" ? ` (${line.reason})` : ""}`
      : `${line.name} × ${pieces(line.qty, line.unit)} at ${peso(line.price)}: ${peso(line.amount)}`,
  );
  const money = [
    ...(o.deliveryFee > 0 ? [`Delivery fee: ${peso(o.deliveryFee)}`] : []),
    `Total: ${peso(o.total)}`,
    ...(o.pointsUsed > 0 ? [`Points used: −${peso(o.pointsUsed * 100)}`] : []),
  ];
  const credit =
    o.terms === "days" && o.days
      ? `Payment terms: ${o.termLabel ?? `${o.days} days`}${invoice ? `, due ${phDate(invoice.dueOn)}` : ""}`
      : null;
  let subject = "";
  let say: string[] = [];
  let details: string[] = [];
  let short: string[] = [];
  switch (event) {
    case "confirmed":
      subject = `Your order ${o.code} is confirmed`;
      say = [
        `We've confirmed your order ${o.code}.`,
        pickup
          ? "We'll contact you when it's ready to collect."
          : "We'll let you know when it is on its way.",
      ];
      // How they pay, so nobody has to ask: in advance (the order goes out once the money is
      // checked), on delivery, or on the credit terms.
      const howToPay =
        o.terms === "advance" && due > 0
          ? `To pay in advance: ${peso(due)}. Send us the proof of payment: your order goes out once it is checked.`
          : o.terms === "cod" && due > 0
            ? `To pay on ${pickup ? "pick-up" : "delivery"}: ${peso(due)}`
            : null;
      details = [
        ...(address && !pickup ? [`Address: ${address}`] : []),
        ...(o.expectedOn ? [`Expected: ${phDate(o.expectedOn)}`] : []),
        ...(howToPay ? [howToPay] : []),
        ...(credit ? [credit] : []),
      ];
      short = [
        `Your order ${o.code} is confirmed.`,
        `Total: ${peso(o.total)}`,
        ...(howToPay ? [howToPay] : []),
        ...(o.expectedOn ? [`Expected: ${phDate(o.expectedOn)}`] : []),
      ];
      break;
    case "shipped": {
      const prepare =
        due > 0 && o.terms === "cod" ? `Please prepare ${peso(due)} for payment on delivery.` : "";
      subject = `Your order ${o.code} is on the way`;
      say = [
        `Your order ${o.code} is on its way to you.`,
        o.method === "rider"
          ? "Our rider is bringing it to you."
          : o.courier
            ? "It is with the courier."
            : "",
        prepare,
      ].filter(Boolean);
      details = [
        ...(address ? [`Address: ${address}`] : []),
        ...(tracking ? [`Courier & tracking: ${tracking}`] : []),
      ];
      short = [
        `Your order ${o.code} is on the way.`,
        ...(tracking ? [`Courier & tracking: ${tracking}`] : []),
        ...(prepare ? [prepare] : []),
      ];
      break;
    }
    case "delivered":
      subject = pickup ? `Picked up: order ${o.code}` : `Delivered: order ${o.code}`;
      say = [
        `Your order ${o.code} was ${pickup ? "picked up" : "delivered"}${o.deliveredOn ? ` on ${phDate(o.deliveredOn)}` : ""}.`,
        `Thank you for choosing ${company.name}!`,
        ...(due > 0
          ? [
              `Balance to pay: ${peso(due)}${credit && invoice ? `, due ${phDate(invoice.dueOn)}` : ""}.`,
            ]
          : []),
      ];
      details = !pickup && address ? [`Delivered to: ${address}`] : [];
      short = [
        `Your order ${o.code} was ${pickup ? "picked up" : "delivered"}. Thank you!`,
        ...(due > 0 ? [`Balance to pay: ${peso(due)}`] : []),
      ];
      break;
    case "paid":
      subject = `Payment received for ${o.code}`;
      say = [
        `Thank you! We received your payment of ${peso(payment?.amount ?? 0)} for order ${o.code}.`,
      ];
      details = [
        ...(payment ? [`Date: ${phDate(payment.paidOn)}`] : []),
        ...(payment?.reference ? [`Reference: ${payment.reference}`] : []),
        ...(invoice ? [`Balance left: ${peso(Math.max(0, invoice.balance))}`] : []),
      ];
      short = [
        `Thank you! We received your payment of ${peso(payment?.amount ?? 0)} for order ${o.code}.`,
        ...(invoice ? [`Balance left: ${peso(Math.max(0, invoice.balance))}`] : []),
      ];
      break;
  }
  const contact = company.phone
    ? `Reply to this email or call ${company.phone}.`
    : "Reply to this email.";
  const text = [
    greeting,
    "",
    ...say.flatMap((line) => [line, ""]),
    ...goods,
    "",
    ...money,
    "",
    ...(details.length ? [...details, ""] : []),
    contact,
    "",
    company.name,
    [company.address.replace(/\s*\n\s*/g, ", "), company.phone, company.email]
      .filter(Boolean)
      .join(" · "),
  ]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const shortText = [
    greeting,
    ...short,
    `— ${company.name}${company.phone ? ` · ${company.phone}` : ""}`,
  ].join("\n");
  const label =
    event === "paid" && payment
      ? `${TELL_TITLE.paid} (${peso(payment.amount)}, ${phDate(payment.paidOn)}${payment.reference ? `, ${payment.reference}` : ""})`
      : TELL_TITLE[event];
  const [emailed] = await rows<{ at: string }>(
    db,
    sql`select at from order_event where order_id = ${orderId} and kind = 'email' and message = ${`Emailed the customer: ${label}`} order by at desc limit 1`,
  );
  return {
    event,
    title: TELL_TITLE[event],
    label,
    subject,
    text,
    short: shortText,
    email: o.email,
    phone: o.phone,
    leadId: o.leadId,
    messenger: o.chat === "messenger",
    emailedAt: emailed ? new Date(emailed.at).toISOString() : null,
  };
}

/**
 * Emails the customer one step of their order: automatically once per step (`again` false), or
 * again when someone presses Send to customer → Email. Answers whether an email went.
 */
export async function tellCustomer(
  db: Database,
  me: Me,
  orderId: number,
  event?: TellEvent,
  again = false,
): Promise<boolean> {
  try {
    const update = await customerUpdate(db, orderId, event);
    if (!update?.email) return false;
    const label = `Emailed the customer: ${update.label}`;
    if (!again && update.emailedAt) return false;
    // A case's customer: on the case's email conversation; anyone else: from the first mailbox.
    let sent = false;
    if (update.leadId && (await startEmailThread(db, update.leadId))) {
      await sendOnCase(db, update.leadId, update.text, { subject: update.subject }, null);
      sent = true;
    } else
      sent = await sendFromMailbox(db, {
        to: update.email,
        subject: update.subject,
        text: update.text,
      });
    if (!sent) return false;
    await logEvent(db, orderId, me, "email", label);
    if (update.leadId)
      await db.execute(
        sql`insert into lead_event (lead_id, kind, message, by_person) values (${update.leadId}, 'email', ${`${label} (${update.subject})`}, ${me.id})`,
      );
    return true;
  } catch (error) {
    await logEvent(
      db,
      orderId,
      me,
      "status",
      `Email to the customer not sent: ${error instanceof Error ? error.message : "the mailbox refused it"}`,
    ).catch(() => {});
    return false;
  }
}

/** "Send to customer" by an app on the phone (WhatsApp, Viber, SMS, copied): noted on the order and its case. */
export async function noteSent(db: Database, me: Me, orderId: number, via: string): Promise<void> {
  const update = await customerUpdate(db, orderId);
  if (!update) return;
  const how =
    {
      whatsapp: "WhatsApp",
      viber: "Viber",
      sms: "SMS",
      messenger: "Messenger",
      copy: "copied text",
    }[via] ?? via;
  const message = `Sent to the customer by ${how}: ${update.title}`;
  await logEvent(db, orderId, me, "sent", message);
  if (update.leadId)
    await db.execute(
      sql`insert into lead_event (lead_id, kind, message, by_person) values (${update.leadId}, 'status', ${message}, ${me.id})`,
    );
}
