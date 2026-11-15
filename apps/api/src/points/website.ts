// Points on the 2MG website, answering the calls it already makes (the old CRM's contract,
// `POST /webhooks/store/<company>/points/manage`, signed with the website's own secret), so the
// website's "My rewards" page, its sign-in and its checkout work unchanged after the switch.
//
// Who may read or spend a wallet: never someone who only typed a number. A customer's own points
// login (mobile + password; the website relays its member's sign-in, `auth_member`) opens a
// session; the 2MG website asks to connect the number's points to the first login made on it
// (`claimByNumber`, the owner's decision of 6 November 2026). A website member account is proved
// to own a wallet once one of its delivered orders on its own number earned into it. Spending at
// checkout needs the session; reading needs the session or the proved account.

import { createHash, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { hashPassword, passwordMatches } from "../auth/password";
import { phoneKey } from "../customers/service";
import { type Database, rows } from "../db/index";
import { Refusal } from "../http";
import type { Runner } from "../inventory/service";
import { siteOf } from "../online/websites";
import { pointsProgram } from "../settings/service";
import { accountFor, addEntry, lockAccount } from "./service";

const MIN_PASSWORD = 4;
/** A customer stays signed in to their points (the owner's ask): ten years, until they sign out. */
const SESSION_DAYS = 3650;
const QUIET_TRIES = 5;
const QUIET_PAUSE_MS = 24 * 3600_000;

const refuse = (message: string) => new Refusal(400, "invalid", message);
const digest = (token: string) => createHash("sha256").update(token).digest("hex");
const obj = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown, max = 120): string | null => {
  if (typeof value !== "string") return null;
  const said = value.trim();
  return said && said.length <= max ? said : null;
};

/** A Philippine mobile number's key (its last ten digits, 9XXXXXXXXX), or null. */
export function mobileKey(value: unknown): string | null {
  const key = phoneKey(typeof value === "string" ? value : null);
  return key && /^9\d{9}$/.test(key) ? key : null;
}
const asPhone = (key: string) => `+63${key}`;

let dummyHash: string | null = null;
async function wasteTime(password: string) {
  dummyHash ??= await hashPassword(randomBytes(16).toString("hex"));
  await passwordMatches(password, dummyHash);
}

async function openSession(tx: Runner, loginId: number): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await tx.execute(
    sql`insert into points_session (login_id, token_hash, expires_at) values (${loginId}, ${digest(token)}, now() + make_interval(days => ${SESSION_DAYS}))`,
  );
  return token;
}

type Login = {
  id: number;
  phoneKey: string;
  name: string;
  passwordHash: string;
  accountId: number | null;
  failures: number;
  blockedUntil: string | null;
  quietFailures: number;
  quietBlockedUntil: string | null;
};

async function loginOf(tx: Runner, key: string): Promise<Login | null> {
  const [found] = await rows<Login>(
    tx,
    sql`select id::int as id, phone_key as "phoneKey", name, password_hash as "passwordHash", account_id::int as "accountId", failures,
        blocked_until::text as "blockedUntil", quiet_failures as "quietFailures", quiet_blocked_until::text as "quietBlockedUntil"
      from points_login where phone_key = ${key} for update`,
  );
  return found ?? null;
}
const later = (at: string | null) => Boolean(at && Date.parse(at) > Date.now());

/** The points page's own sign-in, or joining (`register`). Joining never connects a wallet. */
export async function customerSignIn(
  db: Database,
  input: {
    phone: unknown;
    password: unknown;
    name?: unknown;
    register?: boolean;
    invitation?: unknown;
    recover?: boolean;
  },
) {
  const key = mobileKey(input.phone);
  const password = typeof input.password === "string" ? input.password : "";
  if (!key || password.length < MIN_PASSWORD || password.length > 128)
    throw refuse(`Enter a mobile number and a password of ${MIN_PASSWORD}–128 characters.`);
  if (input.recover || text(input.invitation, 500))
    throw refuse("Ask the team to connect your points: points links aren't used any more.");
  const result = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`points-login:${key}`}, 0))`,
    );
    let login = await loginOf(tx, key);
    if (!login) {
      if (!input.register) {
        await wasteTime(password);
        return { error: "Wrong mobile number or password." };
      }
      const name = text(input.name);
      if (!name) throw refuse("Enter your name.");
      const [made] = await rows<{ id: number }>(
        tx,
        sql`insert into points_login (phone_key, name, password_hash) values (${key}, ${name}, ${await hashPassword(password)}) returning id::int as id`,
      );
      login = (await loginOf(tx, key)) ?? null;
      if (!login || !made) throw new Error("The login wasn't kept.");
    } else {
      if (later(login.blockedUntil))
        return { error: "Wrong mobile number or password, or too many attempts. Try again later." };
      if (!(await passwordMatches(password, login.passwordHash))) {
        const failures = login.failures + 1;
        await tx.execute(
          sql`update points_login set failures = ${failures}, blocked_until = ${failures >= 5 ? sql`now() + interval '15 minutes'` : null} where id = ${login.id}`,
        );
        return { error: "Wrong mobile number or password, or too many attempts. Try again later." };
      }
      await tx.execute(
        sql`update points_login set failures = 0, blocked_until = null where id = ${login.id}`,
      );
    }
    const token = await openSession(tx, login.id);
    return { token, phone: asPhone(key), name: login.name, linked: Boolean(login.accountId) };
  });
  if ("error" in result) throw refuse(result.error as string);
  return result;
}

/**
 * The website's own sign-in (or joining) just passed with this number and password: the same pair
 * opens the points session. Never an error. With `claimByNumber` (2MG) the number's points account
 * comes with the login, when no login holds it yet.
 */
export async function memberSignIn(
  db: Database,
  input: {
    phone: unknown;
    password: unknown;
    name?: unknown;
    claimByNumber?: unknown;
    site?: string;
  },
) {
  const none = { token: null, linked: false, created: false, claimed: false };
  const key = mobileKey(input.phone);
  const password = typeof input.password === "string" ? input.password : "";
  if (!key || password.length < MIN_PASSWORD || password.length > 128) return none;
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`points-login:${key}`}, 0))`,
    );
    let login = await loginOf(tx, key);
    let created = false;
    if (!login) {
      const name = text(input.name);
      if (!name) {
        await wasteTime(password);
        return none;
      }
      await tx.execute(
        sql`insert into points_login (phone_key, name, password_hash) values (${key}, ${name}, ${await hashPassword(password)})`,
      );
      login = await loginOf(tx, key);
      created = true;
    } else {
      if (later(login.quietBlockedUntil) || later(login.blockedUntil)) {
        await wasteTime(password);
        return none;
      }
      if (!(await passwordMatches(password, login.passwordHash))) {
        const failures = login.quietFailures + 1;
        await tx.execute(
          sql`update points_login set quiet_failures = ${failures >= QUIET_TRIES ? 0 : failures},
              quiet_blocked_until = ${failures >= QUIET_TRIES ? new Date(Date.now() + QUIET_PAUSE_MS).toISOString() : null} where id = ${login.id}`,
        );
        return none;
      }
      if (login.quietFailures || login.quietBlockedUntil)
        await tx.execute(
          sql`update points_login set quiet_failures = 0, quiet_blocked_until = null where id = ${login.id}`,
        );
    }
    if (!login) return none;
    let claimed = false;
    if (input.claimByNumber === true && !login.accountId) {
      const [wallet] = await rows<{ id: number; held: boolean }>(
        tx,
        sql`select a.id::int as id, exists (select 1 from points_login l where l.account_id = a.id) as held from points_account a where a.phone_key = ${key}`,
      );
      if (wallet && !wallet.held) {
        await tx.execute(
          sql`update points_login set account_id = ${wallet.id} where id = ${login.id}`,
        );
        login.accountId = wallet.id;
        claimed = true;
        await addEntry(tx, {
          accountId: wallet.id,
          kind: "adjust",
          points: 0,
          note: `Connected to the ${input.site || "website"} login made with this mobile number.`,
          origin: `claim:${login.id}:${wallet.id}`,
        });
      }
    }
    const token = await openSession(tx, login.id);
    return { token, linked: Boolean(login.accountId), created, claimed };
  });
}

type Session = {
  sessionId: number;
  loginId: number;
  phone: string;
  key: string;
  name: string;
  accountId: number | null;
};

/** The customer a points session belongs to; its wallet only while it is still their number's. */
export async function customerSession(db: Runner, token: unknown): Promise<Session> {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token))
    throw refuse("Sign in to your shared points account.");
  const [found] = await rows<{
    sessionId: number;
    loginId: number;
    key: string;
    name: string;
    accountId: number | null;
    accountKey: string | null;
  }>(
    db,
    sql`select s.id::int as "sessionId", l.id::int as "loginId", l.phone_key as key, l.name, l.account_id::int as "accountId", a.phone_key as "accountKey"
      from points_session s join points_login l on l.id = s.login_id left join points_account a on a.id = l.account_id
      where s.token_hash = ${digest(token)} and s.active and s.expires_at > now()`,
  );
  if (!found) throw refuse("Your points session expired. Sign in again.");
  return {
    sessionId: found.sessionId,
    loginId: found.loginId,
    key: found.key,
    phone: asPhone(found.key),
    name: found.name,
    accountId: found.accountId && found.accountKey === found.key ? found.accountId : null,
  };
}

export async function customerSignOut(db: Database, token: unknown): Promise<void> {
  const session = await customerSession(db, token);
  await db.execute(sql`update points_session set active = false where id = ${session.sessionId}`);
}

/**
 * Who a website call speaks for: its signed-in member account (proved to own a wallet), and for
 * spending also the customer's points session; else the points session alone.
 */
export async function websiteIdentity(
  db: Database,
  site: string,
  input: { account?: unknown; walletToken?: unknown },
  intent: "read" | "spend",
): Promise<{ accountId: number | null; phone: string; loginId?: number }> {
  if (input.account !== undefined && input.account !== null) {
    const account = obj(input.account);
    const ref = text(account.ref);
    const key = mobileKey(account.phone);
    if (!ref || !key) throw refuse("Send the authenticated website account.");
    const [bound] = await rows<{ accountId: number; key: string; walletKey: string }>(
      db,
      sql`select b.account_id::int as "accountId", b.phone_key as key, a.phone_key as "walletKey"
        from points_web_account b join points_account a on a.id = b.account_id where b.site = ${site} and b.account_ref = ${ref}`,
    );
    if (bound) {
      if (bound.key !== key || bound.walletKey !== key)
        throw refuse("This account's phone has changed. Ask the team to verify it.");
      if (intent === "spend") {
        const session = await customerSession(db, input.walletToken).catch(() => null);
        if (!session || session.accountId !== bound.accountId || session.key !== key)
          throw refuse("Sign in to your points account to use points.");
      }
      return { accountId: bound.accountId, phone: asPhone(key) };
    }
    const session = await customerSession(db, input.walletToken);
    if (session.key !== key) throw refuse("Use the number linked to your signed-in account.");
    return { accountId: session.accountId, phone: session.phone, loginId: session.loginId };
  }
  const session = await customerSession(db, input.walletToken);
  return { accountId: session.accountId, phone: session.phone, loginId: session.loginId };
}

/** A proved website account connects the customer's own login to its wallet. */
export async function connectLogin(
  db: Database,
  site: string,
  accountRef: unknown,
  loginId: number,
  key: string,
): Promise<number | null> {
  const ref = text(accountRef);
  if (!ref) return null;
  return db.transaction(async (tx) => {
    const [login] = await rows<{ accountId: number | null; key: string }>(
      tx,
      sql`select account_id::int as "accountId", phone_key as key from points_login where id = ${loginId} for update`,
    );
    if (!login || login.key !== key) return null;
    if (login.accountId) return login.accountId;
    const [bound] = await rows<{ accountId: number; key: string }>(
      tx,
      sql`select account_id::int as "accountId", phone_key as key from points_web_account where site = ${site} and account_ref = ${ref}`,
    );
    if (!bound || bound.key !== key) return null;
    await tx.execute(
      sql`update points_login set account_id = ${bound.accountId} where id = ${loginId}`,
    );
    return bound.accountId;
  });
}

// ---------------------------------------------------------------- what the website shows

const KIND_LABEL: Record<string, string> = {
  earn: "Earned on a delivery",
  spend: "Points redeemed",
  release: "Points restored",
  adjust: "Adjusted by the team",
};

export async function walletPoints(db: Runner, accountId: number | null) {
  const program = await pointsProgram(db);
  const empty = {
    enabled: program.enabled,
    ratePercent: program.rateBps / 100,
    account: null as { name: string; balance: number; earned: number } | null,
    entries: [] as unknown[],
  };
  if (!accountId) return empty;
  const [account] = await rows<{ name: string; balance: number; earned: number }>(
    db,
    sql`select name, balance, earned from points_account where id = ${accountId}`,
  );
  if (!account) return empty;
  const entries = await rows<{
    date: string;
    kind: string;
    points: number;
    reference: string | null;
  }>(
    db,
    sql`select to_char(at at time zone 'Asia/Manila', 'YYYY-MM-DD') as date, kind, points, reference from points_entry
      where account_id = ${accountId} and points <> 0 order by at desc, id desc limit 50`,
  );
  return {
    ...empty,
    account,
    entries: entries.map((entry) => ({
      date: entry.date,
      kind: entry.kind,
      label: KIND_LABEL[entry.kind] ?? entry.kind,
      points: entry.points,
      reference: entry.kind === "adjust" ? "" : (entry.reference ?? ""),
    })),
  };
}

const ORDER_WORD: Record<string, string> = {
  completed: "delivered",
  shipped: "shipped",
  cancelled: "cancelled",
  draft: "draft",
};

/** The customer's orders that earned or used points, as the website lists them (pesos). */
export async function rewardOrders(db: Runner, accountId: number | null) {
  if (!accountId) return [];
  const found = await rows<{
    code: string;
    status: string;
    createdAt: string;
    total: number;
    paid: number | null;
    credited: number | null;
    redeemed: number;
    balance: number | null;
    gl: boolean;
    webRef: string | null;
    site: string | null;
    items: { name: string; quantity: number }[];
  }>(
    db,
    sql`select o.code, o.status, to_char(o.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "createdAt", o.total::int as total,
        s.paid, s.credited, o.points_used::int as redeemed, (i.total - i.paid)::int as balance, coalesce(l.road = 'gl', false) as gl,
        w.ref as "webRef", acct.key as site,
        coalesce((select jsonb_agg(jsonb_build_object('name', m.name || coalesce(' ' || m.strength, ''), 'quantity', it.qty)) from order_item it join medicine m on m.id = it.medicine_id where it.order_id = o.id), '[]'::jsonb) as items
      from sales_order o
      left join points_settlement s on s.order_id = o.id and s.account_id = ${accountId}
      left join invoice i on i.order_id = o.id and i.status <> 'cancelled'
      left join lead l on l.id = o.lead_id
      left join web_order w on w.lead_id = o.lead_id
      left join channel_account acct on acct.id = w.account_id
      where s.order_id is not null
        or exists (select 1 from points_entry e where e.order_id = o.id and e.account_id = ${accountId} and e.kind = 'spend')
        or exists (select 1 from points_reservation r where r.order_id = o.id and r.account_id = ${accountId})
      order by o.created_at desc limit 100`,
  );
  return found.map((row) => ({
    reference: row.webRef ?? row.code,
    crmReference: row.code,
    site: row.site ?? "team",
    status: ORDER_WORD[row.status] ?? "confirmed",
    date: row.createdAt,
    total: row.total / 100,
    eligiblePaid: (row.paid ?? 0) / 100,
    points: row.credited ?? 0,
    redeemed: row.redeemed,
    remaining: row.gl || row.balance === null ? null : row.balance / 100,
    agency: row.gl,
    items: row.items.map((item) => ({ name: item.name, quantity: Number(item.quantity) })),
  }));
}

// ---------------------------------------------------------------- website accounts and orders

/** A website order of this member's: its points come to their account once it earns. */
export async function linkOrderAccount(
  db: Database,
  site: string,
  input: { ref: unknown; account: unknown },
): Promise<{ ok: true; bound: boolean }> {
  const ref = text(input.ref);
  const account = obj(input.account);
  const accountRef = text(account.ref);
  const key = mobileKey(account.phone);
  if (!ref || !accountRef || !key)
    throw refuse("Send the site, the order and the website account with its number.");
  const [order] = await rows<{
    id: number;
    accountRef: string | null;
    phone: string | null;
    leadId: number | null;
  }>(
    db,
    sql`select w.id::int as id, w.account_ref as "accountRef", w.customer->>'phone' as phone, w.lead_id::int as "leadId"
      from web_order w join channel_account a on a.id = w.account_id where a.key = ${site} and w.ref = ${ref}`,
  );
  // Not here yet: its order.created is still on the way; the website tries again.
  if (!order) throw new Error(`Order ${ref} has not reached the CRM yet.`);
  if (mobileKey(order.phone) !== key)
    throw refuse("The account's number is not the order's number.");
  if (order.accountRef && order.accountRef !== accountRef)
    throw refuse("This order already belongs to another website account.");
  if (!order.accountRef)
    await db.execute(
      sql`update web_order set account_ref = ${accountRef}, account_phone = ${asPhone(key)} where id = ${order.id}`,
    );
  return { ok: true, bound: await bindAccount(db, order.id) };
}

/** Binds the order's member account to the wallet its points went to, when they are its number's. */
export async function bindAccount(tx: Runner, webOrderId: number): Promise<boolean> {
  const [found] = await rows<{
    site: string;
    ref: string;
    accountRef: string | null;
    accountPhone: string | null;
    accountId: number | null;
    walletKey: string | null;
  }>(
    tx,
    sql`select a.key as site, w.ref, w.account_ref as "accountRef", w.account_phone as "accountPhone", s.account_id::int as "accountId", pa.phone_key as "walletKey"
      from web_order w join channel_account a on a.id = w.account_id
      left join lead l on l.id = w.lead_id left join sales_order o on o.id = l.order_id
      left join points_settlement s on s.order_id = o.id and s.credited > 0 left join points_account pa on pa.id = s.account_id
      where w.id = ${webOrderId}`,
  );
  const key = mobileKey(found?.accountPhone);
  if (!found?.accountRef || !key || !found.accountId || found.walletKey !== key) return false;
  await tx.execute(
    sql`insert into points_web_account (site, account_ref, phone_key, account_id, order_ref) values (${found.site}, ${found.accountRef}, ${key}, ${found.accountId}, ${found.ref})
      on conflict (site, account_ref) do nothing`,
  );
  return true;
}

/** After an order earned: its website member account is bound, when it was placed signed in. */
export async function bindAfterEarning(tx: Runner, orderId: number): Promise<void> {
  const [found] = await rows<{ id: number }>(
    tx,
    sql`select w.id::int as id from web_order w join lead l on l.id = w.lead_id where l.order_id = ${orderId} and w.account_ref is not null limit 1`,
  );
  if (found) await bindAccount(tx, found.id);
}

// ---------------------------------------------------------------- reservations

export type Reservation = {
  id: string;
  points: number;
  reference: string;
  state: "reserved" | "spent" | "released";
  requestKey: string;
  site: string;
  createdAt: string;
};

const RESERVATION = sql`id::text as id, points, reference, state, request_key as "requestKey", site, to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "createdAt"`;

/** Points held at a checkout, once per request key: a retry answers the same reservation. */
export async function reserve(
  db: Database,
  input: {
    accountId: number;
    site: string;
    requestKey: unknown;
    reference: unknown;
    maximum: unknown;
  },
): Promise<Reservation> {
  const requestKey = text(input.requestKey, 160);
  const reference = text(input.reference, 120) ?? "Website checkout";
  const maximum = Number(input.maximum);
  if (!requestKey || !Number.isSafeInteger(maximum) || maximum < 1)
    throw refuse("Enter a valid redemption request and whole points.");
  return db.transaction(async (tx) => {
    await lockAccount(tx, input.accountId);
    const [old] = await rows<Reservation>(
      tx,
      sql`select ${RESERVATION} from points_reservation where account_id = ${input.accountId} and request_key = ${requestKey}`,
    );
    if (old) {
      if (old.state === "released")
        throw refuse("This redemption was released; start a new checkout.");
      if (old.site !== input.site || old.reference !== reference)
        throw refuse("Redemption belongs to another channel or order.");
      return old;
    }
    if (!(await pointsProgram(tx)).enabled) throw refuse("Points are currently switched off.");
    const [account] = await rows<{ balance: number }>(
      tx,
      sql`select balance from points_account where id = ${input.accountId}`,
    );
    if ((account?.balance ?? 0) < maximum)
      throw refuse("Your points balance changed. Review checkout before trying again.");
    const [made] = await rows<Reservation>(
      tx,
      sql`insert into points_reservation (account_id, site, request_key, reference, points) values (${input.accountId}, ${input.site}, ${requestKey}, ${reference}, ${maximum})
        returning ${RESERVATION}`,
    );
    if (!made) throw new Error("The reservation wasn't kept.");
    await addEntry(tx, {
      accountId: input.accountId,
      kind: "spend",
      points: -maximum,
      reference,
      note: `Reserved at checkout on ${input.site}`,
      origin: `reserve:${made.id}`,
    });
    return made;
  });
}

/** Spends a reservation, or gives its points back (never both; asking again answers it again). */
export async function finish(
  tx: Runner,
  id: string,
  release: boolean,
  reason: string,
): Promise<Reservation> {
  const [row] = await rows<Reservation & { accountId: number }>(
    tx,
    sql`select ${RESERVATION}, account_id::int as "accountId" from points_reservation where id = ${id}::uuid for update`,
  );
  if (!row) throw new Refusal(404, "not_found", "No such reservation.");
  if (row.state === (release ? "released" : "spent")) return row;
  if (release && row.state === "spent")
    throw refuse(
      "These points were spent on an order; they come back only when that order is cancelled.",
    );
  if (!release && row.state === "released")
    throw refuse("This reservation was released; start a new checkout.");
  if (release) {
    await lockAccount(tx, row.accountId);
    await addEntry(tx, {
      accountId: row.accountId,
      kind: "release",
      points: row.points,
      reference: row.reference,
      note: reason,
      origin: `unreserve:${row.id}`,
    });
  }
  const [done] = await rows<Reservation>(
    tx,
    sql`update points_reservation set state = ${release ? "released" : "spent"} where id = ${id}::uuid returning ${RESERVATION}`,
  );
  return done as Reservation;
}

/** A checkout's reservation by its site and request key: a live one before one given back. */
export async function siteReservation(
  db: Runner,
  site: string,
  requestKey: unknown,
): Promise<(Reservation & { accountId: number }) | null> {
  const key = text(requestKey, 160);
  if (!key) throw refuse("Send the checkout's requestKey.");
  const [found] = await rows<Reservation & { accountId: number }>(
    db,
    sql`select ${RESERVATION}, account_id::int as "accountId" from points_reservation where site = ${site} and request_key = ${key}
      order by (state = 'released'), created_at desc limit 1`,
  );
  return found ?? null;
}

/**
 * The order a website case placed takes the points its customer reserved at checkout: they were
 * taken from the wallet then, so nothing is taken again; the reservation is spent on the order.
 */
export async function useWebsiteReservation(
  tx: Runner,
  leadId: number,
  orderId: number,
): Promise<number> {
  const [web] = await rows<{ reservation: string | null }>(
    tx,
    sql`select points_reservation::text as reservation from web_order where lead_id = ${leadId} and points_reservation is not null order by id desc limit 1`,
  );
  if (!web?.reservation) return 0;
  const [held] = await rows<{ points: number; state: string; orderId: number | null }>(
    tx,
    sql`select points, state, order_id::int as "orderId" from points_reservation where id = ${web.reservation}::uuid for update`,
  );
  if (!held || held.state === "released" || (held.orderId && held.orderId !== orderId)) return 0;
  await tx.execute(
    sql`update points_reservation set state = 'spent', order_id = ${orderId} where id = ${web.reservation}::uuid`,
  );
  await tx.execute(sql`update sales_order set points_used = ${held.points} where id = ${orderId}`);
  return held.points;
}

/** An order cancelled: the website reservation it spent goes back to the customer, once. */
export async function releaseReservationOf(tx: Runner, orderId: number): Promise<number> {
  const [held] = await rows<{ id: string; accountId: number; points: number; reference: string }>(
    tx,
    sql`select id::text as id, account_id::int as "accountId", points, reference from points_reservation where order_id = ${orderId} and state = 'spent' for update`,
  );
  if (!held) return 0;
  await lockAccount(tx, held.accountId);
  await addEntry(tx, {
    accountId: held.accountId,
    kind: "release",
    points: held.points,
    orderId,
    reference: held.reference,
    note: "The order was cancelled",
    origin: `release:${orderId}`,
  });
  await tx.execute(
    sql`update points_reservation set state = 'released' where id = ${held.id}::uuid`,
  );
  return held.points;
}

/**
 * A website order cancelled on the website: the points its checkout took come back, once, unless
 * a live CRM order holds them (cancelling that order gives them back).
 */
export async function releaseWebsiteOrderPoints(tx: Runner, webOrderId: number): Promise<number> {
  const [web] = await rows<{ reservation: string | null; ref: string }>(
    tx,
    sql`select points_reservation::text as reservation, ref from web_order where id = ${webOrderId}`,
  );
  if (!web?.reservation) return 0;
  const [held] = await rows<{
    accountId: number;
    points: number;
    state: string;
    reference: string;
    orderStatus: string | null;
    orderId: number | null;
  }>(
    tx,
    sql`select r.account_id::int as "accountId", r.points, r.state, r.reference, r.order_id::int as "orderId", o.status as "orderStatus"
      from points_reservation r left join sales_order o on o.id = r.order_id where r.id = ${web.reservation}::uuid for update of r`,
  );
  if (!held || held.state === "released") return 0;
  if (held.orderId && held.orderStatus !== "cancelled") return 0;
  await lockAccount(tx, held.accountId);
  await addEntry(tx, {
    accountId: held.accountId,
    kind: "release",
    points: held.points,
    reference: held.reference,
    note: `Cancelled on the website (${web.ref})`,
    origin: `unreserve:${web.reservation}`,
  });
  await tx.execute(
    sql`update points_reservation set state = 'released' where id = ${web.reservation}::uuid`,
  );
  return held.points;
}

/** The team's points tools in the website's admin: one account by number, adjusted with why. */
export async function adminAdjust(
  db: Database,
  input: {
    site: string;
    phone: unknown;
    points: unknown;
    reason: unknown;
    staff: string;
    requestKey: unknown;
  },
) {
  const key = mobileKey(input.phone);
  if (!key) throw refuse("Enter a Philippine mobile number.");
  const [account] = await rows<{ id: number; balance: number }>(
    db,
    sql`select id::int as id, balance from points_account where phone_key = ${key}`,
  );
  if (!account) throw refuse("No points account on this number.");
  const points = Number(input.points);
  const reason = text(input.reason, 300);
  if (!Number.isSafeInteger(points) || points === 0)
    throw refuse("Enter whole points to add or take off.");
  if (!reason) throw refuse("Enter a reason for the adjustment.");
  const requestKey = text(input.requestKey, 160);
  if (!requestKey) throw refuse("Send the adjustment's requestKey.");
  await db.transaction(async (tx) => {
    await lockAccount(tx, account.id);
    const [now] = await rows<{ balance: number }>(
      tx,
      sql`select balance from points_account where id = ${account.id}`,
    );
    const [done] = await rows<{ id: number }>(
      tx,
      sql`select id::int as id from points_entry where origin = ${`webadjust:${input.site}:${requestKey}`}`,
    );
    if (done) return;
    if ((now?.balance ?? 0) + points < 0) throw refuse("That would take the balance below zero.");
    await addEntry(tx, {
      accountId: account.id,
      kind: "adjust",
      points,
      note: `${reason} (${input.staff} on ${input.site})`,
      origin: `webadjust:${input.site}:${requestKey}`,
    });
  });
  return account.id;
}

export async function accountByPhone(db: Runner, phone: unknown): Promise<number | null> {
  const key = mobileKey(phone);
  if (!key) throw refuse("Enter a Philippine mobile number.");
  const [account] = await rows<{ id: number }>(
    db,
    sql`select id::int as id from points_account where phone_key = ${key}`,
  );
  return account?.id ?? null;
}

export { accountFor, siteOf };
