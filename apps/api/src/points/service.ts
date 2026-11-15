// Customer points. 1 point = ₱1. A patient earns (10% by default) of what they actually paid for
// the medicines once the order is delivered and the money is in: never on the delivery fee, never
// on what they paid with points; on a guarantee letter only the agency's money counts. Business
// buyers never earn. Points never expire. A customer's account is their phone number.
//
// What an order has earned is kept (`points_settlement`), so each later receipt, refund or
// correction earns (or takes back) only the difference, once: every entry carries its origin.

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { allow, Refusal } from "../http";
import type { Runner } from "../inventory/service";
import { pointsProgram, SETTING_ROLES } from "../settings/service";
import type {
  Me,
  PointsAccountDetail,
  PointsAccountRow,
  PointsEntryRow,
  PointsList,
} from "../types";
import { bindAfterEarning } from "./website";

/** Who reads points (to tell a customer their balance). */
export const POINTS_READ_ROLES = ["online", "admin", "ceo", "management", "finance"] as const;

/** Points for an amount in centavos at a rate in basis points, rounded down. */
export function pointsFor(centavos: number, rateBps: number): number {
  if (!Number.isFinite(centavos) || centavos <= 0 || !Number.isFinite(rateBps) || rateBps <= 0)
    return 0;
  return Math.floor((Math.round(centavos) * Math.round(rateBps)) / 1_000_000);
}

/** One point is one peso. */
export const POINT_CENTAVOS = 100;

const KIND_WORDS: Record<string, string> = {
  earn: "Earned",
  spend: "Used",
  release: "Given back",
  adjust: "Adjusted",
};

export async function lockAccount(tx: Runner, id: number) {
  await tx.execute(sql`select id from points_account where id = ${id} for update`);
}

/** The account of a phone, made the first time it is needed. */
export async function accountFor(
  tx: Runner,
  phoneKey: string,
  customer: { id: number | null; name: string },
): Promise<number> {
  const [found] = await rows<{ id: number }>(
    tx,
    sql`insert into points_account (phone_key, customer_id, name) values (${phoneKey}, ${customer.id}, ${customer.name})
      on conflict (phone_key) do update set customer_id = coalesce(points_account.customer_id, excluded.customer_id)
      returning id::int as id`,
  );
  return found?.id as number;
}

export async function refreshTotals(tx: Runner, accountId: number) {
  await tx.execute(
    sql`update points_account set
        balance = coalesce((select sum(points) from points_entry where account_id = ${accountId}), 0),
        earned = coalesce((select sum(points) from points_entry where account_id = ${accountId} and kind = 'earn'), 0),
        spent = coalesce((select -sum(points) from points_entry where account_id = ${accountId} and kind in ('spend', 'release')), 0)
      where id = ${accountId}`,
  );
}

export async function addEntry(
  tx: Runner,
  entry: {
    accountId: number;
    kind: "earn" | "spend" | "release" | "adjust";
    points: number;
    orderId?: number | null;
    reference?: string | null;
    note?: string | null;
    origin: string;
    by?: number | null;
  },
): Promise<boolean> {
  const made = await rows<{ id: number }>(
    tx,
    sql`insert into points_entry (account_id, kind, points, order_id, reference, note, origin, by_person)
      values (${entry.accountId}, ${entry.kind}, ${entry.points}, ${entry.orderId ?? null}, ${entry.reference ?? null}, ${entry.note ?? null}, ${entry.origin}, ${entry.by ?? null})
      on conflict (origin) do nothing returning id::int as id`,
  );
  if (made.length) await refreshTotals(tx, entry.accountId);
  return made.length > 0;
}

/**
 * Brings an order's points to what its money now earns. Called whenever its delivery, its
 * receipts or its refunds change; does nothing when nothing changed.
 */
export async function settleOrderPoints(tx: Runner, orderId: number): Promise<void> {
  const [order] = await rows<{
    code: string;
    status: string;
    total: number;
    fee: number;
    pointsUsed: number;
    kind: string;
    phoneKey: string | null;
    customerId: number;
    name: string;
    gl: boolean;
  }>(
    tx,
    sql`select o.code, o.status, o.total::int as total, o.delivery_fee::int as fee, o.points_used::int as "pointsUsed", c.kind,
        c.phone_key as "phoneKey", c.id::int as "customerId", c.name, coalesce(l.road = 'gl', false) as gl
      from sales_order o join customer c on c.id = o.customer_id left join lead l on l.id = o.lead_id where o.id = ${orderId}`,
  );
  if (!order || order.status !== "completed") return;
  const program = await pointsProgram(tx);
  const [prior] = await rows<{
    accountId: number;
    rateBps: number;
    credited: number;
    paid: number;
    revision: number;
  }>(
    tx,
    sql`select account_id::int as "accountId", rate_bps as "rateBps", credited, paid, revision from points_settlement where order_id = ${orderId} for update`,
  );
  // Business buyers never earn; an order that earned before is brought back to zero.
  const business = order.kind !== "patient";
  if (!prior && (!program.enabled || business || !order.phoneKey)) return;
  const accountId =
    prior?.accountId ??
    (await accountFor(tx, order.phoneKey as string, { id: order.customerId, name: order.name }));
  await lockAccount(tx, accountId);
  const rateBps = prior?.rateBps ?? program.rateBps;
  if (!prior)
    await tx.execute(
      sql`insert into points_settlement (order_id, account_id, rate_bps) values (${orderId}, ${accountId}, ${rateBps}) on conflict do nothing`,
    );

  const [money] = await rows<{ invoiceTotal: number | null; received: number; refunded: number }>(
    tx,
    sql`select i.total::int as "invoiceTotal",
        coalesce((select sum(p.amount) from payment p where p.invoice_id = i.id and p.active and p.method <> 'points'
          and p.payer = ${order.gl ? "agency" : "customer"}), 0)::int as received,
        coalesce((select sum(r.amount) from refund r where r.invoice_id = i.id), 0)::int as refunded
      from invoice i where i.order_id = ${orderId} and i.status <> 'cancelled'`,
  );
  const fee = order.gl ? 0 : order.fee;
  const goods = Math.max(0, order.total - fee - order.pointsUsed * POINT_CENTAVOS);
  const paid =
    business || !money?.invoiceTotal
      ? 0
      : Math.min(
          goods,
          Math.max(0, Math.min(money.invoiceTotal, money.received - money.refunded) - fee),
        );
  let target = pointsFor(paid, rateBps);
  // Switched off: corrections may take points back, but nothing new is earned.
  if (!program.enabled) target = Math.min(target, prior?.credited ?? 0);
  const credited = prior?.credited ?? 0;
  const delta = target - credited;
  if (!delta) return;
  const revision = (prior?.revision ?? 0) + 1;
  await addEntry(tx, {
    accountId,
    kind: "earn",
    points: delta,
    orderId,
    reference: order.code,
    note:
      delta > 0
        ? order.gl
          ? "Agency money received"
          : "Paid for the medicines"
        : "Money given back",
    origin: `earn:${orderId}:${revision}`,
  });
  await tx.execute(
    sql`update points_settlement set credited = ${target}, paid = ${paid}, revision = ${revision} where order_id = ${orderId}`,
  );
  // A website member's order that earned: their website account now reads these points.
  if (target > 0) await bindAfterEarning(tx, orderId);
}

/** The points a patient uses on their order: taken from their balance now. */
export async function spendOnOrder(
  tx: Runner,
  me: Me,
  orderId: number,
  points: number,
): Promise<void> {
  if (!points) return;
  const [order] = await rows<{
    code: string;
    total: number;
    fee: number;
    phoneKey: string | null;
    customerId: number;
    name: string;
    kind: string;
  }>(
    tx,
    sql`select o.code, o.total::int as total, o.delivery_fee::int as fee, c.phone_key as "phoneKey", c.id::int as "customerId", c.name, c.kind
      from sales_order o join customer c on c.id = o.customer_id where o.id = ${orderId}`,
  );
  if (!order?.phoneKey || order.kind !== "patient")
    throw new Refusal(400, "invalid", "Only a patient with a phone number uses points.", "points");
  const goods = order.total - order.fee;
  if (points * POINT_CENTAVOS > goods)
    throw new Refusal(
      400,
      "invalid",
      `Points pay for the medicines only: at most ${Math.floor(goods / POINT_CENTAVOS).toLocaleString("en-PH")} points here.`,
      "points",
    );
  const accountId = await accountFor(tx, order.phoneKey, {
    id: order.customerId,
    name: order.name,
  });
  await lockAccount(tx, accountId);
  const [account] = await rows<{ balance: number }>(
    tx,
    sql`select balance from points_account where id = ${accountId}`,
  );
  if ((account?.balance ?? 0) < points)
    throw new Refusal(
      400,
      "invalid",
      `They have ${(account?.balance ?? 0).toLocaleString("en-PH")} points: not enough for ${points.toLocaleString("en-PH")}.`,
      "points",
    );
  await addEntry(tx, {
    accountId,
    kind: "spend",
    points: -points,
    orderId,
    reference: order.code,
    note: "Used on the order",
    origin: `spend:${orderId}`,
    by: me.id,
  });
  await tx.execute(sql`update sales_order set points_used = ${points} where id = ${orderId}`);
}

/** An order cancelled: the points it used go back to the customer, once. */
export async function releaseOrderPoints(tx: Runner, me: Me, orderId: number): Promise<number> {
  const [spent] = await rows<{ accountId: number; points: number; reference: string | null }>(
    tx,
    sql`select account_id::int as "accountId", -points as points, reference from points_entry where origin = ${`spend:${orderId}`}`,
  );
  if (!spent) return 0;
  await lockAccount(tx, spent.accountId);
  const given = await addEntry(tx, {
    accountId: spent.accountId,
    kind: "release",
    points: spent.points,
    orderId,
    reference: spent.reference,
    note: "The order was cancelled",
    origin: `release:${orderId}`,
    by: me.id,
  });
  return given ? spent.points : 0;
}

// ---------------------------------------------------------------- reads and adjustments

const accountColumns = sql`a.id::int as id, a.name, a.phone_key as "phoneKey", a.customer_id::int as "customerId", a.balance, a.earned, a.spent,
  to_char((select max(at) from points_entry e where e.account_id = a.id) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "lastAt"`;

const masked = (key: string) => `${"•".repeat(Math.max(0, key.length - 4))}${key.slice(-4)}`;

export async function pointsList(db: Database, me: Me, query: { q?: string }): Promise<PointsList> {
  allow(me, POINTS_READ_ROLES, "see customers' points");
  const words = (query.q ?? "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 4);
  const where = words.map((word) => {
    const digits = word.replace(/\D/g, "");
    return digits.length >= 4
      ? sql`a.phone_key like ${`%${digits.slice(-10)}%`}`
      : sql`lower(a.name) like ${`%${word.replace(/[%_\\]/g, "\\$&")}%`}`;
  });
  const [accounts, [totals], program] = await Promise.all([
    rows<PointsAccountRow>(
      db,
      sql`select ${accountColumns} from points_account a ${where.length ? sql`where ${sql.join(where, sql` and `)}` : sql``} order by a.balance desc, a.id desc limit 200`,
    ),
    rows<{ accounts: number; balance: number; earned: number }>(
      db,
      sql`select count(*)::int as accounts, coalesce(sum(balance), 0)::int as balance, coalesce(sum(earned), 0)::int as earned from points_account`,
    ),
    pointsProgram(db),
  ]);
  return {
    program,
    accounts: accounts.map((account) => ({ ...account, phone: masked(account.phoneKey) })),
    totals: totals ?? { accounts: 0, balance: 0, earned: 0 },
    can: {
      adjust: (SETTING_ROLES as readonly string[]).includes(me.role),
      program: (SETTING_ROLES as readonly string[]).includes(me.role),
    },
  };
}

export async function pointsAccount(
  db: Database,
  me: Me,
  id: number,
): Promise<PointsAccountDetail> {
  allow(me, POINTS_READ_ROLES, "see a customer's points");
  const [account] = await rows<PointsAccountRow>(
    db,
    sql`select ${accountColumns} from points_account a where a.id = ${id}`,
  );
  if (!account) throw new Refusal(404, "not_found", "No such points account.");
  const entries = await rows<PointsEntryRow>(
    db,
    sql`select e.id::int as id, e.kind, e.points, e.reference, e.note, e.order_id::int as "orderId", p.name as by,
        to_char(e.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as at
      from points_entry e left join person p on p.id = e.by_person where e.account_id = ${id} order by e.at desc, e.id desc limit 200`,
  );
  return {
    account: { ...account, phone: masked(account.phoneKey) },
    entries: entries.map((entry) => ({
      ...entry,
      kindLabel: KIND_WORDS[entry.kind] ?? entry.kind,
    })),
    can: { adjust: (SETTING_ROLES as readonly string[]).includes(me.role) },
  };
}

/** A customer's points by their phone (for the case and the customer's page). */
export async function pointsByPhone(
  db: Runner,
  phoneKey: string | null,
): Promise<{ accountId: number | null; balance: number }> {
  if (!phoneKey) return { accountId: null, balance: 0 };
  const [found] = await rows<{ id: number; balance: number }>(
    db,
    sql`select id::int as id, balance from points_account where phone_key = ${phoneKey}`,
  );
  return { accountId: found?.id ?? null, balance: found?.balance ?? 0 };
}

/** The team adds or takes off points by hand, with why; a balance never goes below zero. */
export async function adjustPoints(
  db: Database,
  me: Me,
  accountId: number,
  input: { points: number; reason: string },
): Promise<void> {
  allow(me, SETTING_ROLES, "adjust a customer's points");
  if (!Number.isInteger(input.points) || input.points === 0)
    throw new Refusal(
      400,
      "invalid",
      "Type how many points to add (or take off, with a minus).",
      "points",
    );
  const reason = input.reason.trim();
  if (!reason) throw new Refusal(400, "invalid", "Say why.", "reason");
  await db.transaction(async (tx) => {
    await lockAccount(tx, accountId);
    const [account] = await rows<{ balance: number }>(
      tx,
      sql`select balance from points_account where id = ${accountId}`,
    );
    if (!account) throw new Refusal(404, "not_found", "No such points account.");
    if (account.balance + input.points < 0)
      throw new Refusal(
        400,
        "invalid",
        `They have ${account.balance.toLocaleString("en-PH")} points: that would go below zero.`,
        "points",
      );
    await addEntry(tx, {
      accountId,
      kind: "adjust",
      points: input.points,
      note: reason,
      origin: `adjust:${randomUUID()}`,
      by: me.id,
    });
  });
}

/** Opens an account for a customer by their phone (to give them points by hand). */
export async function openAccountFor(
  db: Database,
  me: Me,
  customerId: number,
): Promise<{ id: number }> {
  allow(me, SETTING_ROLES, "open a points account");
  const [customer] = await rows<{ phoneKey: string | null; name: string; kind: string }>(
    db,
    sql`select phone_key as "phoneKey", name, kind from customer where id = ${customerId}`,
  );
  if (!customer) throw new Refusal(404, "not_found", "No such customer.");
  if (customer.kind !== "patient") throw new Refusal(409, "not_now", "Only patients earn points.");
  if (!customer.phoneKey)
    throw new Refusal(409, "not_now", "Add their phone number first: their points are kept by it.");
  return { id: await accountFor(db, customer.phoneKey, { id: customerId, name: customer.name }) };
}
