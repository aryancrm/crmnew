// Brings the old CRM's link to the websites over (Aryan, 19 Nov: "the old CRM's link to the 2MG
// website, the same, whatever is missing made whole"): the id each website knows a medicine by,
// the customers' points (every wallet with its whole history, so the website's "My rewards" keeps
// it), their points sign-ins (the same passwords and sessions: nobody signs in again), the website
// accounts tied to a wallet, the points held at checkouts not finished, and the website orders the
// old CRM still had open (so the website's later updates are taken). Used by
// scripts/import-old-website.ts, which reads the old database. Safe to run again: each row keeps
// the old id it came from, so a second run adds only what is missing.

import { sql } from "drizzle-orm";
import { phoneKey } from "../customers/service";
import { type Database, rows } from "../db/index";
import { refreshTotals } from "../points/service";
import { siteOf } from "./websites";

type When = Date | string;

export type OldProduct = { id: string; code: string | null; name: string; strength: string | null };
export type OldWallet = { id: string; name: string | null; phone: string | null; balance: number | string };
export type OldEntry = {
  id: string;
  account_id: string;
  kind: string;
  points: number | string;
  reference: string | null;
  note: string | null;
  created_at: When;
};
export type OldLogin = {
  id: string;
  phone: string | null;
  name: string | null;
  password_hash: string;
  account_id: string | null;
};
export type OldSession = { credential_id: string; token_hash: string; expires_at: When };
export type OldTie = {
  site: string;
  account_ref: string;
  phone: string | null;
  rewards_account_id: string;
  order_ref: string | null;
  bound_at: When | null;
};
export type OldHold = {
  id: string;
  account_id: string;
  reference: string;
  points: number | string;
  restored: number | string | null;
  state: string;
  site: string | null;
  request_key: string | null;
  created_at: When;
};
export type OldWebOrder = {
  site: string;
  ref: string;
  status: string;
  customer_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  items: unknown;
  subtotal: number | string | null;
  relief: number | string | null;
  discount: number | string | null;
  delivery_fee: number | string | null;
  total: number | string | null;
  benefit: unknown;
  assistance: unknown;
  is_b2b: boolean | null;
  lead_id: string | null;
  placed_at: When | null;
  source_updated_at: When | null;
  account_ref: string | null;
  account_phone: string | null;
  payment_method: string | null;
  files: unknown;
  callback_url: string | null;
  redemption_id: string | null;
  admin_url: string | null;
  card_error: string | null;
};
export type OldWebsite = {
  products: OldProduct[];
  wallets: OldWallet[];
  entries: OldEntry[];
  logins: OldLogin[];
  sessions: OldSession[];
  ties: OldTie[];
  holds: OldHold[];
  orders: OldWebOrder[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const norm = (value: string | null | undefined) => (value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const iso = (value: When | null | undefined) =>
  value == null ? null : value instanceof Date ? value.toISOString() : String(value);
const whole = (value: unknown) => Math.round(Number(value) || 0);
const obj = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : typeof value === "string" && value.trim().startsWith("{")
      ? (() => {
          try {
            return JSON.parse(value) as Record<string, unknown>;
          } catch {
            return {};
          }
        })()
      : {};
const list = (value: unknown): unknown[] =>
  Array.isArray(value)
    ? value
    : typeof value === "string" && value.trim().startsWith("[")
      ? (() => {
          try {
            return JSON.parse(value) as unknown[];
          } catch {
            return [];
          }
        })()
      : [];

/** The old points sign-in's password hash ("saltHex:hashHex": scrypt, 64 bytes, over the hex salt
 *  as text) in this CRM's form ("scrypt$salt$hash", base64url): the same password still signs in
 *  (any password NFKC leaves as it is, every plain one). Null when it isn't one. */
export function convertOldHash(old: string): string | null {
  const [salt, hash, extra] = old.split(":");
  if (!salt || !hash || extra !== undefined || !/^[0-9a-f]{128}$/i.test(hash)) return null;
  return `scrypt$${Buffer.from(salt, "utf8").toString("base64url")}$${Buffer.from(hash, "hex").toString("base64url")}`;
}

/** A benefit or assistance as the website order keeps it ("senior · pending"). */
function said(value: unknown, first: string): string | null {
  if (typeof value === "string") return value.trim() || null;
  const found = obj(value);
  if (!Object.keys(found).length) return null;
  return `${String(found[first] ?? "")} · ${String(found.status ?? "")}`;
}

export async function importOldWebsite(
  db: Database,
  old: OldWebsite,
  apply: boolean,
): Promise<Record<string, number>> {
  const count = {
    medicinesMatched: 0,
    medicinesNoMatch: 0,
    wallets: 0,
    walletsNoPhone: 0,
    entries: 0,
    balanceCarried: 0,
    logins: 0,
    loginsSkipped: 0,
    sessions: 0,
    ties: 0,
    holds: 0,
    orders: 0,
    ordersNoWebsite: 0,
  };
  const DRY = new Error("dry run");
  try {
    await db.transaction(async (tx) => {
      // 1. The id each website knows a medicine by: the old one, matched by name and strength
      //    (both from Finance's one price list), else by its code. An old one with no match goes to
      //    the websites once as no longer sold.
      const medicines = await rows<{
        id: number;
        name: string;
        strength: string | null;
        sku: string | null;
        code: string | null;
        webId: string | null;
      }>(tx, sql`select id::int as id, name, strength, sku, code, web_id::text as "webId" from medicine`);
      const byName = new Map(medicines.map((one) => [`${norm(one.name)}|${norm(one.strength)}`, one]));
      const byCode = new Map<string, (typeof medicines)[number]>();
      for (const one of medicines) {
        if (one.sku) byCode.set(norm(one.sku), one);
        if (one.code) byCode.set(norm(one.code), one);
      }
      const matched = new Set<number>();
      for (const product of old.products) {
        if (!UUID.test(product.id)) continue;
        const found =
          byName.get(`${norm(product.name)}|${norm(product.strength)}`) ??
          (product.code ? byCode.get(norm(product.code)) : undefined);
        if (found && !matched.has(found.id)) {
          matched.add(found.id);
          if (found.webId !== product.id) {
            // Whichever medicine had this id gives it up (it gets a new one on its next send).
            await tx.execute(sql`update medicine set web_id = null where web_id = ${product.id}::uuid and id <> ${found.id}`);
            await tx.execute(sql`update medicine set web_id = ${product.id}::uuid where id = ${found.id}`);
            await tx.execute(sql`delete from web_catalog_sent where medicine_id = ${found.id}`);
          }
          await tx.execute(sql`delete from web_retired_product where web_id = ${product.id}::uuid`);
          count.medicinesMatched += 1;
        } else {
          await tx.execute(
            sql`insert into web_retired_product (web_id, code, name, strength)
              values (${product.id}::uuid, ${product.code}, ${product.name}, ${product.strength}) on conflict (web_id) do nothing`,
          );
          count.medicinesNoMatch += 1;
        }
      }

      // 2. Wallets, by the customer's number (the last ten digits, as here).
      const accountOf = new Map<string, number>();
      for (const wallet of old.wallets) {
        const key = phoneKey(wallet.phone);
        if (!key) {
          count.walletsNoPhone += 1;
          continue;
        }
        const [account] = await rows<{ id: number }>(
          tx,
          sql`insert into points_account (phone_key, name, customer_id)
            values (${key}, ${wallet.name?.trim() || "Customer"}, (select id from customer where phone_key = ${key} order by id limit 1))
            on conflict (phone_key) do update set phone_key = excluded.phone_key returning id::int as id`,
        );
        if (!account) continue;
        accountOf.set(wallet.id, account.id);
        count.wallets += 1;
      }

      // 3. Their whole history, entry by entry (the website shows the last ones); then each wallet's
      //    total against the old balance, one carried entry where they differ.
      const KIND: Record<string, "earn" | "spend" | "release" | "adjust"> = {
        earn: "earn",
        settle: "earn",
        reverse: "earn",
        spend: "spend",
        release: "release",
        adjust: "adjust",
      };
      for (const entry of old.entries) {
        const accountId = accountOf.get(entry.account_id);
        const kind = KIND[entry.kind];
        const points = whole(entry.points);
        if (!accountId || !kind || !points) continue;
        const made = await rows<{ id: number }>(
          tx,
          sql`insert into points_entry (account_id, kind, points, reference, note, origin, at)
            values (${accountId}, ${kind}, ${points}, ${entry.reference}, ${entry.note}, ${`old:${entry.id}`}, ${iso(entry.created_at)}::timestamptz)
            on conflict (origin) do nothing returning id::int as id`,
        );
        if (made.length) count.entries += 1;
      }
      for (const wallet of old.wallets) {
        const accountId = accountOf.get(wallet.id);
        if (!accountId) continue;
        const [sum] = await rows<{ n: number }>(
          tx,
          sql`select coalesce(sum(points), 0)::int as n from points_entry
            where account_id = ${accountId} and (origin like 'old:%' or origin = ${`old-balance:${wallet.id}`})`,
        );
        const gap = whole(wallet.balance) - (sum?.n ?? 0);
        if (gap !== 0) {
          const made = await rows<{ id: number }>(
            tx,
            sql`insert into points_entry (account_id, kind, points, note, origin)
              values (${accountId}, 'adjust', ${gap}, 'Balance carried from the old CRM', ${`old-balance:${wallet.id}`})
              on conflict (origin) do nothing returning id::int as id`,
          );
          if (made.length) count.balanceCarried += 1;
        }
        await refreshTotals(tx, accountId);
      }

      // 4. Points sign-ins: the same password (its hash turned into this CRM's form); one made here
      //    since is kept as it is.
      const loginOf = new Map<string, number>();
      for (const login of old.logins) {
        const key = phoneKey(login.phone);
        const hash = convertOldHash(login.password_hash);
        if (!key || !hash) {
          count.loginsSkipped += 1;
          continue;
        }
        const accountId = login.account_id ? (accountOf.get(login.account_id) ?? null) : null;
        const [made] = await rows<{ id: number }>(
          tx,
          sql`insert into points_login (phone_key, name, password_hash, account_id)
            values (${key}, ${login.name?.trim() || "Customer"}, ${hash}, ${accountId})
            on conflict (phone_key) do update set account_id = coalesce(points_login.account_id, excluded.account_id)
            returning id::int as id`,
        );
        if (!made) continue;
        loginOf.set(login.id, made.id);
        count.logins += 1;
      }
      // 5. Their sessions still open (the same token, kept as its hash): nobody signs in again.
      for (const session of old.sessions) {
        const loginId = loginOf.get(session.credential_id);
        const until = iso(session.expires_at);
        if (!loginId || !until || Date.parse(until) <= Date.now()) continue;
        const made = await rows<{ id: number }>(
          tx,
          sql`insert into points_session (login_id, token_hash, expires_at) values (${loginId}, ${session.token_hash}, ${until}::timestamptz)
            on conflict (token_hash) do nothing returning id::int as id`,
        );
        if (made.length) count.sessions += 1;
      }

      // 6. Website accounts tied to a wallet.
      for (const tie of old.ties) {
        const accountId = accountOf.get(tie.rewards_account_id);
        const site = siteOf(tie.site);
        if (!accountId || !site || !tie.account_ref) continue;
        const made = await rows<{ site: string }>(
          tx,
          sql`insert into points_web_account (site, account_ref, phone_key, account_id, order_ref, bound_at)
            values (${site}, ${tie.account_ref}, coalesce(${phoneKey(tie.phone)}, (select phone_key from points_account where id = ${accountId})),
              ${accountId}, ${tie.order_ref}, coalesce(${iso(tie.bound_at)}::timestamptz, now()))
            on conflict (site, account_ref) do nothing returning site`,
        );
        if (made.length) count.ties += 1;
      }

      // 7. Points held at a checkout not finished, and those on the open orders below: the same id
      //    (the website holds it); their spend entries came with the history.
      const onOrders = new Set(old.orders.map((one) => one.redemption_id).filter(Boolean));
      for (const hold of old.holds) {
        if (hold.state !== "reserved" && !onOrders.has(hold.id)) continue;
        const accountId = accountOf.get(hold.account_id);
        const points = whole(hold.points) - whole(hold.restored);
        if (!accountId || !UUID.test(hold.id) || points <= 0) continue;
        const state = hold.state === "spent" || hold.state === "released" ? hold.state : "reserved";
        const made = await rows<{ id: string }>(
          tx,
          sql`insert into points_reservation (id, account_id, site, request_key, reference, points, state, created_at)
            values (${hold.id}::uuid, ${accountId}, ${siteOf(hold.site ?? "") || "unknown"}, ${hold.request_key ?? `old:${hold.id}`},
              ${hold.reference}, ${points}, ${state}, ${iso(hold.created_at)}::timestamptz)
            on conflict do nothing returning id::text as id`,
        );
        if (made.length) count.holds += 1;
      }

      // 8. The website orders the old CRM had: their later updates find them here.
      const sites = new Map(
        (
          await rows<{ id: number; key: string }>(
            tx,
            sql`select id::int as id, key from channel_account where kind = 'website'`,
          )
        ).map((one) => [one.key, one.id]),
      );
      for (const order of old.orders) {
        const accountId = sites.get(siteOf(order.site));
        if (!accountId || !order.ref) {
          count.ordersNoWebsite += 1;
          continue;
        }
        const [lead] = order.lead_id
          ? await rows<{ id: number }>(tx, sql`select id::int as id from lead where legacy_id = ${order.lead_id}`)
          : [];
        const [hold] = order.redemption_id
          ? await rows<{ points: number }>(
              tx,
              sql`select points from points_reservation where id = ${order.redemption_id}::uuid`,
            )
          : [];
        const items = list(order.items).map((line) => {
          const { crmProductId: _id, requiresPrescription: _rx, ...rest } = obj(line);
          return rest;
        });
        const files = list(order.files).map((file) => {
          const { url: _url, fileAs: _as, ...rest } = obj(file);
          return { fetched: false, attempts: 0, gaveUp: false, ...rest };
        });
        const made = await rows<{ id: number }>(
          tx,
          sql`insert into web_order (account_id, ref, status, placed_at, source_at, customer, items, money, payment_method, benefit,
              assistance, is_b2b, account_ref, account_phone, admin_url, status_url, files, points_reservation, points_redeemed,
              lead_id, card_note)
            values (${accountId}, ${order.ref}, ${(order.status || "pending").toLowerCase()}, ${iso(order.placed_at)}::timestamptz,
              ${iso(order.source_updated_at)}::timestamptz,
              ${JSON.stringify({ name: order.customer_name, phone: order.phone, email: order.email, address: order.address })}::jsonb,
              ${JSON.stringify(items)}::jsonb,
              ${JSON.stringify({ subtotal: whole(order.subtotal), vatExempted: whole(order.relief), discount: whole(order.discount), deliveryFee: whole(order.delivery_fee), total: whole(order.total) })}::jsonb,
              ${order.payment_method}, ${said(order.benefit, "type")}, ${said(order.assistance, "program")}, ${order.is_b2b === true},
              ${order.account_ref}, ${order.account_phone}, ${order.admin_url}, ${order.callback_url},
              ${JSON.stringify(files)}::jsonb, ${hold ? order.redemption_id : null}::uuid, ${hold?.points ?? 0},
              ${lead?.id ?? null}, ${order.card_error})
            on conflict (account_id, ref) do nothing returning id::int as id`,
        );
        if (made.length) count.orders += 1;
      }
      if (!apply) throw DRY;
    });
  } catch (error) {
    if (error !== DRY) throw error;
  }
  return count;
}
