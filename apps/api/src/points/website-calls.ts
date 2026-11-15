// One signed points call from a website (`POST /webhooks/store/<company>/points/manage`), answered
// the way the old CRM did: 400 for a refusal a retry won't change, 401 a bad signature, 404 a
// website that isn't connected, 500 anything else (the website retries with the same request key).

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { Refusal } from "../http";
import { signatureMatches, siteByKey, siteOf } from "../online/websites";
import {
  accountByPhone,
  adminAdjust,
  connectLogin,
  customerSession,
  customerSignIn,
  customerSignOut,
  finish,
  linkOrderAccount,
  memberSignIn,
  mobileKey,
  reserve,
  rewardOrders,
  siteReservation,
  walletPoints,
  websiteIdentity,
} from "./website";

export type PointsAnswer = { status: 200 | 400 | 401 | 404 | 413 | 500; body: unknown };

const refuse = (message: string) => new Refusal(400, "invalid", message);
const obj = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export async function answerPointsCall(
  db: Database,
  raw: string,
  signature: string | null | undefined,
): Promise<PointsAnswer> {
  if (raw.length > 8000) return { status: 413, body: { message: "Too large." } };
  let body: Record<string, unknown>;
  try {
    body = obj(JSON.parse(raw));
  } catch {
    return { status: 400, body: { message: "Invalid wallet request." } };
  }
  const site = siteOf(body.site);
  const connected = site ? await siteByKey(db, site) : null;
  if (!connected) return { status: 404, body: { message: "Company not found." } };
  if (!signatureMatches(raw, signature, connected.secret))
    return { status: 401, body: { message: "Bad signature." } };
  const ok = (answer: unknown): PointsAnswer => ({ status: 200, body: answer });
  try {
    const sent = Date.parse(String(body.sentAt ?? ""));
    if (!Number.isFinite(sent) || Math.abs(Date.now() - sent) > 300_000)
      throw refuse("Request expired.");
    const operation = String(body.operation ?? "");
    switch (operation) {
      case "auth_login":
      case "auth_register":
        return ok(
          await customerSignIn(db, {
            phone: body.phone,
            password: body.password,
            name: body.name,
            register: operation === "auth_register",
            invitation: body.invitation,
            recover: body.recover === true,
          }),
        );
      case "auth_member":
        return ok(
          await memberSignIn(db, {
            phone: body.phone,
            password: body.password,
            name: body.name,
            claimByNumber: body.claimByNumber,
            site: connected.name,
          }),
        );
      case "auth_logout":
        await customerSignOut(db, body.walletToken);
        return ok({ ok: true });
      case "order_account":
        return ok(await linkOrderAccount(db, site, { ref: body.ref, account: body.account }));
      case "wallet_read": {
        const identity = await websiteIdentity(db, site, body, "read");
        const accountId =
          identity.accountId ??
          (identity.loginId
            ? await connect(db, site, body.accountRef, identity.loginId, identity.phone)
            : null);
        const [points, orders] = await Promise.all([
          walletPoints(db, accountId),
          rewardOrders(db, accountId),
        ]);
        return ok({ ...points, orders, linked: Boolean(accountId), phone: identity.phone });
      }
      case "member_rewards":
        return ok(await memberRewards(db, site, body));
      case "admin_lookup":
      case "admin_adjust": {
        const staff = typeof body.staff === "string" ? body.staff.trim() : "";
        if (!staff) throw refuse("Authenticated staff identity required.");
        const accountId =
          operation === "admin_adjust"
            ? await adminAdjust(db, {
                site,
                phone: body.phone,
                points: body.points,
                reason: body.reason,
                staff,
                requestKey: body.requestKey,
              })
            : await accountByPhone(db, body.phone);
        return ok(await walletPoints(db, accountId));
      }
      case "site_reservation_read": {
        const found = await siteReservation(db, site, body.requestKey);
        return ok({ reservation: found ? strip(found) : null });
      }
      case "site_reservation_settle": {
        if (body.outcome !== "commit" && body.outcome !== "release")
          throw refuse('outcome is "commit" or "release".');
        const found = await siteReservation(db, site, body.requestKey);
        if (!found)
          return {
            status: 404,
            body: { message: "This site has no points reservation under that requestKey." },
          };
        const reason =
          (typeof body.reason === "string" ? body.reason.trim().slice(0, 300) : "") ||
          "no reason given";
        const done = await db.transaction((tx) =>
          finish(
            tx,
            found.id,
            body.outcome === "release",
            `Checkout not finished on ${site}: ${reason}`,
          ),
        );
        return ok({ reservation: strip(done) });
      }
    }
    // Reading a reservation, reserving and committing spend the wallet; releasing only gives back.
    const identity = await websiteIdentity(
      db,
      site,
      body,
      operation === "release" ? "read" : "spend",
    );
    if (!identity.accountId)
      throw refuse("Sign in with your website account to connect your points.");
    if (operation === "reservation_read") {
      const found = await siteReservation(db, site, body.requestKey);
      return ok({
        reservation: found && found.accountId === identity.accountId ? strip(found) : null,
      });
    }
    if (operation === "reserve")
      return ok(
        await reserve(db, {
          accountId: identity.accountId,
          site,
          requestKey: body.requestKey,
          reference: body.reference,
          maximum: body.maximum,
        }),
      );
    if (operation !== "commit" && operation !== "release")
      throw refuse("Unknown wallet operation.");
    const id = typeof body.redemption === "string" ? body.redemption : "";
    const [owned] = /^[0-9a-f-]{36}$/i.test(id)
      ? await rows<{ ok: boolean }>(
          db,
          sql`select true as ok from points_reservation where id = ${id}::uuid and site = ${site} and account_id = ${identity.accountId}`,
        )
      : [];
    if (!owned) throw refuse("Redemption does not belong to this account and site.");
    return ok(
      await db.transaction((tx) =>
        finish(tx, id, operation === "release", "Released by the website"),
      ),
    );
  } catch (error) {
    if (error instanceof Refusal)
      return { status: error.status === 404 ? 404 : 400, body: { message: error.message } };
    console.error("points call failed", error instanceof Error ? error.message : error);
    return {
      status: 500,
      body: { message: "Wallet unavailable; retry with the same request key." },
    };
  }
}

/** A reservation as the website reads it (never whose account it is). */
const strip = (row: object) => {
  const { accountId: _accountId, ...rest } = row as Record<string, unknown>;
  return rest;
};

/** The customer's login reaches the wallet their proved website account owns. */
const connect = (db: Database, site: string, accountRef: unknown, loginId: number, phone: string) =>
  connectLogin(db, site, accountRef, loginId, mobileKey(phone) ?? "");

/**
 * The member's points with their own orders (at most 50 the website names, already its member's):
 * orders not linked yet are linked first, so a missed link never hides their points.
 */
async function memberRewards(db: Database, site: string, body: Record<string, unknown>) {
  const account = obj(body.account);
  const orders = body.orders;
  if (
    typeof account.ref !== "string" ||
    !account.ref.trim() ||
    account.ref.length > 120 ||
    typeof account.phone !== "string" ||
    !Array.isArray(orders) ||
    orders.length > 50
  )
    throw refuse("Send the authenticated account and its saved orders.");
  const key = mobileKey(account.phone);
  if (!key) throw refuse("Invalid account number.");
  const [bound] = await rows<{ accountId: number; key: string }>(
    db,
    sql`select account_id::int as "accountId", phone_key as key from points_web_account where site = ${site} and account_ref = ${account.ref}`,
  );
  if (bound && bound.key !== key)
    throw refuse("The website account's number has changed. Ask the team to verify it.");
  let pending = false;
  let accountId = bound?.accountId ?? null;
  if (!bound)
    for (const ref of orders) {
      if (typeof ref !== "string" || !ref.trim() || ref.length > 120)
        throw refuse("Invalid order reference.");
      try {
        const linked = await linkOrderAccount(db, site, { ref, account });
        if (linked.bound) break;
      } catch (error) {
        // Another account's order, another number: simply not linked. Not here yet: next visit.
        if (error instanceof Refusal) continue;
        pending = true;
      }
    }
  if (!accountId) {
    const [now] = await rows<{ accountId: number }>(
      db,
      sql`select account_id::int as "accountId" from points_web_account where site = ${site} and account_ref = ${account.ref}`,
    );
    accountId = now?.accountId ?? null;
  }
  if (body.walletToken) {
    const session = await customerSession(db, body.walletToken).catch(() => null);
    if (session && session.key === key) {
      if (!accountId && session.accountId) accountId = session.accountId;
      await connect(db, site, account.ref, session.loginId, session.phone);
    }
  }
  const [points, rewardList] = await Promise.all([
    walletPoints(db, accountId),
    rewardOrders(db, accountId),
  ]);
  return {
    ...points,
    orders: rewardList,
    linked: Boolean(accountId),
    phone: account.phone,
    pending,
  };
}
