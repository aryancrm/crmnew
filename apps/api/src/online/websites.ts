// The company's websites (as many as it has). Each is connected under Channels with its own
// secret; it calls `POST /webhooks/store/<company>` signed with it (the old CRM's contract, so a
// site switches over by changing its address and secret). An order placed on a website opens a
// case on the Online desk like an enquiry: who ordered, how they pay (senior / PWD, a guarantee
// letter), the medicines matched to the catalogue as its quotation, the documents they uploaded
// (to be filed by the agent). The website's own status changes come in too, forward only. The
// case's order then sends its status back (confirmed, shipped, delivered, cancelled), signed,
// tried again until the website takes it. Prescriptions and enquiries sent through a website land
// on the person's case (by their number) or open one.

import { keepFile } from "../files/store";
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { sql } from "drizzle-orm";
import { phoneKey } from "../customers/service";
import { type Database, rows } from "../db/index";
import { allow, Refusal } from "../http";
import type { Runner } from "../inventory/service";
import { checkWebsiteHold, releaseWebsiteOrderPoints } from "../points/website";
import type {
  LeadRoad,
  Me,
  OrderStatus,
  QuoteLine,
  Vat,
  WebOrderView,
  WebsiteStatus,
} from "../types";
import { AGENCY_SHORT, journeyStops } from "./journey";
import { CHANNEL_ROLES } from "./messenger";
import { LEAD_WORK_ROLES, SOURCE_LABEL } from "./rules";
import { seal, unseal } from "./secrets";
import { caseProgress } from "./service";

// ---------------------------------------------------------------- small pieces

const text = (value: unknown, max = 255): string | null => {
  if (value === null || value === undefined) return null;
  const said = String(value).trim();
  return said ? said.slice(0, max) : null;
};
const obj = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
/** Pesos as the websites send them, to whole centavos; never negative. */
const centavos = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
};
const isoOrNull = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? null : time.toISOString();
};
const peso = (amount: number) =>
  `₱${(amount / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const norm = (value: unknown) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9.%/ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** A website's name: the host of its address ("2mginc.com"), or the short name it sends ("capsandpills"). */
export function siteOf(raw: unknown): string {
  const said = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!said) return "";
  try {
    const host = new URL(said).hostname.replace(/^www\./, "");
    if (host) return host.slice(0, 80);
  } catch {
    // not an address: a short name
  }
  return said
    .replace(/^www\./, "")
    .replace(/[^a-z0-9.\-_]/g, "")
    .slice(0, 80);
}

/** The order of a website order's statuses; cancelled is apart. */
const STATUS_ORDER = ["pending", "confirmed", "packed", "scheduled", "shipped", "delivered"];
export const WEB_STATUS_LABEL: Record<string, string> = {
  pending: "Order placed",
  confirmed: "Confirmed",
  packed: "Packed",
  scheduled: "Scheduled",
  shipped: "On the way",
  delivered: "Delivered",
  cancelled: "Cancelled",
  // Not a status of the order: the customer applies at the agency with our quotation.
  quotation_sent: "Apply with our quotation",
};
const rank = (status: string) => STATUS_ORDER.indexOf(status);
/** A status may move forward, or to cancelled from anything but delivered. */
export function movesOn(from: string, to: string): boolean {
  if (from === to) return false;
  if (to === "cancelled") return from !== "delivered";
  if (from === "cancelled" || from === "delivered") return false;
  return rank(to) > rank(from);
}
/** The website already shows `wanted`, or is past it. */
const websiteHas = (shows: string, wanted: string) =>
  shows === wanted ||
  (wanted !== "cancelled" && shows !== "cancelled" && rank(shows) >= rank(wanted));

/** Whole centavos shared out by weight; the shares add up exactly (largest remainder). */
function share(total: number, weights: number[]): number[] {
  const sum = weights.reduce((all, weight) => all + weight, 0);
  if (!total || !sum) return weights.map(() => 0);
  const raw = weights.map((weight) => (total * weight) / sum);
  const out = raw.map(Math.floor);
  let left = total - out.reduce((all, part) => all + part, 0);
  const order = raw
    .map((value, index) => ({ index, rest: value - Math.floor(value) }))
    .sort((a, b) => b.rest - a.rest);
  for (const { index } of order) {
    if (left <= 0) break;
    out[index] = (out[index] ?? 0) + 1;
    left -= 1;
  }
  return out;
}

// ---------------------------------------------------------------- talking to websites

export type WebHttp = {
  /** A document the website links to. */
  file(url: string): Promise<{ bytes: Uint8Array; mime: string } | null>;
  /** The status the CRM sends; the website's answer. */
  post(
    url: string,
    body: string,
    headers: Record<string, string>,
  ): Promise<{ status: number; json: Record<string, unknown> | null }>;
};

function privateAddress(ip: string): boolean {
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (isIP(v4) === 4) {
    const [a = 0, b = 0] = v4.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  return (
    v6 === "::" ||
    v6 === "::1" ||
    v6.startsWith("fc") ||
    v6.startsWith("fd") ||
    v6.startsWith("fe80")
  );
}

/** https on the public internet; on a developer's computer also http to this machine. */
export function allowedUrl(raw: unknown): string | null {
  const said = text(raw, 2000);
  if (!said) return null;
  try {
    const url = new URL(said);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol === "https:" && !local) return url.toString();
    if (
      local &&
      process.env.NODE_ENV !== "production" &&
      (url.protocol === "http:" || url.protocol === "https:")
    )
      return url.toString();
  } catch {
    // not an address
  }
  return null;
}

async function reachable(url: string): Promise<boolean> {
  const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
  if (["localhost", "127.0.0.1", "::1"].includes(host))
    return process.env.NODE_ENV !== "production";
  const found = await lookup(host, { all: true }).catch(() => []);
  return found.length > 0 && !found.some((address) => privateAddress(address.address));
}

const realHttp: WebHttp = {
  async file(url) {
    const safe = allowedUrl(url);
    if (!safe || !(await reachable(safe))) return null;
    try {
      const response = await fetch(safe, {
        redirect: "manual",
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) return null;
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!bytes.byteLength || bytes.byteLength > 10 * 1024 * 1024) return null;
      return {
        bytes,
        mime:
          (response.headers.get("content-type") ?? "").split(";")[0]?.trim() ||
          "application/octet-stream",
      };
    } catch {
      return null;
    }
  },
  async post(url, body, headers) {
    if (!(await reachable(url)))
      return { status: 0, json: { message: "That address isn't on the public internet." } };
    try {
      const response = await fetch(url, {
        method: "POST",
        body,
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
      });
      return {
        status: response.status,
        json: (await response.json().catch(() => null)) as Record<string, unknown> | null,
      };
    } catch {
      return { status: 0, json: null };
    }
  },
};

let http: WebHttp = realHttp;
/** The tests' own websites. */
export function useWebHttp(next: WebHttp | null): void {
  http = next ?? realHttp;
}

const sign = (body: string, secret: string) =>
  `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
/** Sends a signed call to a website (the stock link's, online/catalog.ts). */
export const postToWebsite = (url: string, body: string, secret: string, event: string) =>
  http.post(url, body, {
    "content-type": "application/json",
    "x-crm-event": event,
    "x-crm-delivery": randomUUID(),
    "x-crm-signature": sign(body, secret),
  });
export function signatureMatches(
  raw: string,
  given: string | null | undefined,
  secret: string,
): boolean {
  if (!given) return false;
  const a = Buffer.from(given.trim());
  const b = Buffer.from(sign(raw, secret));
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------------------------------------------------------------- connecting a website

type Site = { id: number; key: string; name: string; secret: string };

export async function siteByKey(db: Runner, key: string): Promise<Site | null> {
  const [found] = await rows<{ id: number; key: string; name: string; secret: string }>(
    db,
    sql`select id::int as id, key, name, secret from channel_account where kind = 'website' and key = ${key} and active`,
  );
  return found ? { ...found, secret: unseal(found.secret) } : null;
}

/** Connects a website; its secret is answered once, to be put in the website's settings. */
export async function connectWebsite(
  db: Database,
  me: Me,
  input: { name: string; site: string; secret?: string | null },
): Promise<{ id: number; secret: string; key: string; kept: boolean }> {
  allow(me, CHANNEL_ROLES, "connect a website");
  const key = siteOf(input.site);
  if (!key)
    throw new Refusal(
      400,
      "invalid",
      "Type the website's address (or the short name it sends).",
      "site",
    );
  const name = input.name.trim() || key;
  // The secret it has now, when given (a website moving over from the old CRM keeps working
  // unchanged); else a new one.
  const kept = Boolean(input.secret?.trim());
  const secret = input.secret?.trim() || randomBytes(32).toString("hex");
  const [account] = await rows<{ id: number }>(
    db,
    sql`insert into channel_account (kind, key, name, secret, connected_by, config)
      values ('website', ${key}, ${name}, ${seal(secret)}, ${me.id}, ${JSON.stringify({ label: name })}::jsonb)
      on conflict (kind, key) do update set name = excluded.name, secret = excluded.secret, active = true, connected_by = excluded.connected_by, connected_at = now()
      returning id::int as id`,
  );
  return { id: account?.id as number, secret: kept ? "" : secret, key, kept };
}

/** A website admin's "Open in the CRM" link (<CRM_APP_URL>/website-order?site=&ref=, as the old
 *  CRM had it): the case and the order the website's order became. Only their numbers: each page
 *  checks who may see it. */
export async function websiteOrderCase(
  db: Database,
  site: string,
  ref: string,
): Promise<{ leadId: number | null; orderId: number | null }> {
  const key = siteOf(site);
  const wanted = ref.trim();
  if (!wanted) throw new Refusal(400, "invalid", "The link has no order number.", "ref");
  const found = await rows<{ leadId: number | null; orderId: number | null }>(
    db,
    sql`select w.lead_id::int as "leadId", l.order_id::int as "orderId"
      from web_order w join channel_account a on a.id = w.account_id left join lead l on l.id = w.lead_id
      where a.kind = 'website' and w.ref = ${wanted} and (${key} = '' or a.key = ${key})
      order by w.id desc limit 2`,
  );
  if (!found.length || (!key && found.length > 1))
    throw new Refusal(404, "not_found", `No website order ${wanted} in the CRM.`);
  return found[0] as { leadId: number | null; orderId: number | null };
}

/** A new secret (the old one stops working at once). */
export async function newWebsiteSecret(
  db: Database,
  me: Me,
  id: number,
): Promise<{ secret: string }> {
  allow(me, CHANNEL_ROLES, "change a website's secret");
  const secret = randomBytes(32).toString("hex");
  const changed = await rows<{ id: number }>(
    db,
    sql`update channel_account set secret = ${seal(secret)} where id = ${id} and kind = 'website' returning id::int as id`,
  );
  if (!changed.length) throw new Refusal(404, "not_found", "No such website.");
  return { secret };
}

// ---------------------------------------------------------------- the website's calls

export type WebAnswer = {
  status: 200 | 400 | 401 | 404 | 413 | 503;
  body: Record<string, unknown>;
};

type Envelope = { event?: unknown; site?: unknown; statusUrl?: unknown; data?: unknown };

/** One website call: checked, worked, and noted (Channels shows the last one and the refusals). */
export async function answerWebsite(
  db: Database,
  raw: string,
  signature: string | null | undefined,
): Promise<WebAnswer> {
  if (raw.length > 512_000) return { status: 413, body: { message: "Too large." } };
  let envelope: Envelope;
  try {
    envelope = JSON.parse(raw) as Envelope;
  } catch {
    return { status: 400, body: { message: "Send JSON." } };
  }
  const key = siteOf(envelope.site);
  const site = key ? await siteByKey(db, key) : null;
  if (!site)
    return {
      status: 404,
      body: { message: `The website ${key || "(none named)"} isn't connected to the CRM.` },
    };
  if (!signatureMatches(raw, signature, site.secret))
    return { status: 401, body: { message: "Bad signature." } };
  const event = String(envelope.event ?? "").slice(0, 100);
  const data = obj(envelope.data);
  const ref = text(data.orderNumber ?? data.requestNumber ?? data.ref, 100);
  const note = (outcome: string, error: string | null) =>
    db.execute(
      sql`insert into web_call (account_id, site, event, ref, outcome, error) values (${site.id}, ${site.key}, ${event}, ${ref}, ${outcome}, ${error})`,
    );
  try {
    let outcome: string;
    if (
      event === "order.created" ||
      event === "order.status_updated" ||
      event === "order.letter_uploaded"
    )
      outcome = await receiveOrder(db, site, event, data, envelope.statusUrl);
    else if (event === "prescription.uploaded" || event === "enquiry.created")
      outcome = await receiveRequest(db, site, event, data);
    else outcome = "ignored";
    await note(outcome, null);
    await db.execute(
      sql`update channel_account set synced_at = now(), sync_error = null where id = ${site.id}`,
    );
    if (outcome === "documents_pending")
      return {
        status: 503,
        body: { ok: false, outcome, message: "Saved; retry to finish copying its documents." },
      };
    return { status: 200, body: { ok: true, outcome } };
  } catch (error) {
    const message =
      error instanceof Refusal
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);
    await note("failed", message).catch(() => {});
    await db
      .execute(
        sql`update channel_account set synced_at = now(), sync_error = ${message.slice(0, 500)} where id = ${site.id}`,
      )
      .catch(() => {});
    // A refusal won't change on a retry (400); anything else is worth one (503).
    if (error instanceof Refusal) return { status: 400, body: { message } };
    console.error("website call failed", error);
    return {
      status: 503,
      body: { message: "The CRM couldn't take this event; it will take a retry." },
    };
  }
}

// ---------------------------------------------------------------- orders

type WebItem = {
  name: string;
  brand: string | null;
  packSize: string | null;
  sku: string | null;
  packUnits: number | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};
type WebFile = {
  key: string;
  kind: "prescription" | "id" | "gl";
  name: string | null;
  url?: string | null;
  fetched: boolean;
  attempts: number;
  gaveUp: boolean;
};
type WebOrderRow = {
  id: number;
  ref: string;
  status: string;
  placedAt: string | null;
  sourceAt: string | null;
  customer: Record<string, unknown>;
  items: WebItem[];
  money: Record<string, number>;
  paymentMethod: string | null;
  benefit: string | null;
  assistance: string | null;
  files: WebFile[];
  leadId: number | null;
  cardNote: string | null;
  pushStatus: string | null;
};

function itemsOf(raw: unknown): WebItem[] {
  return (Array.isArray(raw) ? raw : []).slice(0, 200).map((line) => {
    const item = obj(line);
    const units = Math.round(Number(item.packUnits) || 0);
    return {
      name: text(item.name, 200) ?? "Item",
      brand: text(item.brand, 120),
      packSize: text(item.packSize, 120),
      sku: text(item.sku, 120),
      packUnits: units >= 1 ? units : null,
      quantity: Math.max(0, Math.round(Number(item.quantity) || 0)),
      unitPrice: centavos(item.unitPrice),
      lineTotal: centavos(item.lineTotal),
    };
  });
}

/** The documents an order links to, each known by its own id (or its link's hash for older senders). */
function documentsOf(data: Record<string, unknown>): (WebFile & { url: string | null })[] {
  const out: (WebFile & { url: string | null })[] = [];
  const add = (key: string, kind: WebFile["kind"], url: unknown, name: unknown) => {
    if (!key || out.some((file) => file.key === key)) return;
    out.push({
      key,
      kind,
      url: text(url, 4000),
      name: text(name),
      fetched: false,
      attempts: 0,
      gaveUp: false,
    });
  };
  if (Array.isArray(data.documents)) {
    for (const raw of data.documents) {
      const doc = obj(raw);
      if (["prescription", "id", "gl"].includes(String(doc.kind)))
        add(String(text(doc.id, 200) ?? ""), doc.kind as WebFile["kind"], doc.url, doc.name);
    }
    return out;
  }
  const byUrl = (kind: WebFile["kind"], url: unknown, name: unknown) => {
    const link = text(url, 4000);
    if (link) add(createKey(link), kind, link, name);
  };
  for (const item of Array.isArray(data.items) ? data.items : []) {
    const rx = obj(obj(item).prescription);
    byUrl("prescription", rx.url, rx.fileName);
  }
  for (const url of Array.isArray(data.prescriptionUrls) ? data.prescriptionUrls : [])
    byUrl("prescription", url, null);
  byUrl("id", obj(data.benefit).idUrl, null);
  byUrl("gl", obj(data.assistance).letterUrl, null);
  return out;
}
const createKey = (url: string) =>
  createHmac("sha256", "doc")
    .update(url.split("?")[0] ?? url)
    .digest("hex")
    .slice(0, 32);

const AGENCIES = ["dswd", "pcso", "ovp", "op"];
function roadOf(
  benefit: string | null,
  assistance: string | null,
): { road: LeadRoad; agency: string | null } {
  const first = (value: string | null) => norm((value ?? "").split("·")[0]);
  const type = first(benefit);
  if (type === "senior" || type === "pwd") return { road: type, agency: null };
  const program = first(assistance);
  if (!program) return { road: "regular", agency: null };
  return { road: "gl", agency: AGENCIES.includes(program) ? program : null };
}

const WEBSITE_DOCUMENT_ATTEMPTS = 6;
/** A first call this long after the order was placed doesn't open a case by itself. */
const CARD_WITHIN_MS = 72 * 60 * 60 * 1000;
export const TOO_LATE =
  "Arrived late or already moved on the website: check it there before working it here.";
export const CANCELLED_FIRST = "Cancelled on the website before the CRM opened its case.";

async function receiveOrder(
  db: Database,
  site: Site,
  event: string,
  data: Record<string, unknown>,
  statusUrl: unknown,
): Promise<string> {
  const ref = text(data.orderNumber, 100);
  if (!ref) throw new Refusal(400, "invalid", "The order has no orderNumber.");
  const files = documentsOf(data);
  const result = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`web:${site.id}:${ref}`}, 0))`,
    );
    const [found] = await rows<WebOrderRow>(
      tx,
      sql`${ORDER_SELECT} where account_id = ${site.id} and ref = ${ref} for update`,
    );
    const status = text(data.status, 40)?.toLowerCase() ?? (found ? found.status : "pending");
    const changedAt = isoOrNull(data.changedAt) ?? isoOrNull(data.createdAt);
    const callback = allowedUrl(statusUrl);
    if (event === "order.letter_uploaded" && !found)
      throw new Refusal(400, "invalid", `The CRM has no order ${ref} from ${site.name}.`);
    if (!found) {
      if (event !== "order.created" && !data.items)
        throw new Refusal(
          400,
          "invalid",
          `The CRM has no order ${ref} from ${site.name}; send order.created first.`,
        );
      const customer = obj(data.customer);
      const benefit = Object.keys(obj(data.benefit)).length
        ? `${text(obj(data.benefit).type, 20) ?? ""} · ${text(obj(data.benefit).status, 40) ?? ""}`
        : null;
      const assistance = Object.keys(obj(data.assistance)).length
        ? `${text(obj(data.assistance).program, 20) ?? ""} · ${text(obj(data.assistance).status, 40) ?? ""}`
        : null;
      // The points the customer held at checkout, checked as the old CRM checked them.
      const rewards = obj(data.rewards);
      const holdId = /^[0-9a-f-]{36}$/i.test(String(rewards.reservation ?? "")) ? String(rewards.reservation) : null;
      const hold = holdId
        ? await checkWebsiteHold(tx, {
            id: holdId,
            points: Math.max(0, Math.round(Number(rewards.points) || 0)),
            site: site.key,
            ref,
            phone: text(customer.phone, 40),
            business: data.isB2B === true,
            benefit:
              ["senior", "pwd"].includes(norm(text(obj(data.benefit).type, 20))) ||
              Boolean(text(obj(data.assistance).program, 20)),
            discount: centavos(data.discount) ?? 0,
            cancelled: status === "cancelled",
          })
        : null;
      const keptHold = hold && !hold.refused ? holdId : null;
      const [made] = await rows<{ id: number }>(
        tx,
        sql`insert into web_order (account_id, ref, status, placed_at, source_at, customer, items, money, payment_method, benefit, assistance,
            is_b2b, account_ref, account_phone, admin_url, status_url, files, points_reservation, points_redeemed, letter)
          values (${site.id}, ${ref}, ${status}, ${isoOrNull(data.createdAt)}, ${changedAt},
            ${JSON.stringify({ name: text(customer.name, 120), phone: text(customer.phone, 40), email: text(customer.email, 120), address: text(customer.address, 300), notes: text(customer.notes, 1000) })}::jsonb,
            ${JSON.stringify(itemsOf(data.items))}::jsonb,
            ${JSON.stringify({ subtotal: centavos(data.subtotal), vatExempted: centavos(data.vatExempted), discount: centavos(data.discount), deliveryFee: centavos(data.deliveryFee), total: centavos(data.total) })}::jsonb,
            ${text(data.paymentMethod, 40)}, ${benefit}, ${assistance}, ${data.isB2B === true},
            ${text(obj(data.account).ref, 120)}, ${text(obj(data.account).phone, 40)}, ${allowedUrl(data.adminUrl ?? data.orderUrl)}, ${callback},
            ${JSON.stringify(files.map(({ url: _url, ...file }) => file))}::jsonb,
            ${keptHold}::uuid,
            ${keptHold ? (hold?.points ?? 0) : 0},
            ${norm(obj(data.assistance).letterStatus) === "needed" ? "needed" : null})
          returning id::int as id`,
      );
      const order = (
        await rows<WebOrderRow>(tx, sql`${ORDER_SELECT} where id = ${made?.id}`)
      )[0] as WebOrderRow;
      const placed = Date.parse(order.placedAt ?? "") || Date.now();
      if (status === "cancelled") {
        await tx.execute(
          sql`update web_order set card_note = ${CANCELLED_FIRST} where id = ${order.id}`,
        );
        await releaseWebsiteOrderPoints(tx, order.id);
      } else if (!["pending", "confirmed"].includes(status) || Date.now() - placed > CARD_WITHIN_MS)
        await tx.execute(sql`update web_order set card_note = ${TOO_LATE} where id = ${order.id}`);
      else {
        const leadId = await openCase(tx, site, order);
        if (hold?.refused)
          await caseNote(
            tx,
            leadId,
            `The website order's ${hold.points} points were returned to the customer: ${hold.refused} Review the order's total before invoicing.`,
          );
      }
      return { orderId: order.id };
    }

    // A known order: newer details, documents not seen before, the website's status (forward only).
    if (
      callback &&
      callback !==
        (
          await rows<{ url: string | null }>(
            tx,
            sql`select status_url as url from web_order where id = ${found.id}`,
          )
        )[0]?.url
    )
      await tx.execute(sql`update web_order set status_url = ${callback} where id = ${found.id}`);
    const known = new Set(found.files.map((file) => file.key));
    const added = files
      .filter((file) => !known.has(file.key))
      .map(({ url: _url, ...file }) => file);
    if (added.length)
      await tx.execute(
        sql`update web_order set files = files || ${JSON.stringify(added)}::jsonb where id = ${found.id}`,
      );
    const newer = !changedAt || !found.sourceAt || changedAt >= found.sourceAt;
    if (newer && movesOn(found.status, status)) {
      await tx.execute(
        sql`update web_order set status = ${status}, source_at = coalesce(${changedAt}, source_at), updated_at = now(),
            push_status = case when push_status is not null and ${status} = push_status then null else push_status end,
            push_error = case when push_status is not null and ${status} = push_status then null else push_error end where id = ${found.id}`,
      );
      if (found.leadId) await websiteMoved(tx, found, status, text(data.cancelReason, 300));
      if (status === "cancelled") await releaseWebsiteOrderPoints(tx, found.id);
    }
    if (event === "order.letter_uploaded" && found.leadId)
      await caseNote(
        tx,
        found.leadId,
        `${site.name}: the customer sent their guarantee letter for ${ref}: it is in the case's papers as the guarantee letter.`,
      );
    return { orderId: found.id };
  });
  return (await copyDocuments(db, result.orderId, files, event === "order.letter_uploaded"))
    ? "documents_pending"
    : "kept";
}

const ORDER_SELECT = sql`select id::int as id, ref, status, to_char(placed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "placedAt",
  to_char(source_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "sourceAt", customer, items, money, payment_method as "paymentMethod",
  benefit, assistance, files, lead_id::int as "leadId", card_note as "cardNote", push_status as "pushStatus" from web_order`;

async function caseNote(tx: Runner, leadId: number, message: string) {
  await tx.execute(
    sql`insert into lead_event (lead_id, kind, message, by_person) values (${leadId}, 'status', ${message}, null)`,
  );
  await tx.execute(sql`update lead set last_activity_at = now() where id = ${leadId}`);
}

/** The website moved its order: said on the case; a cancel closes a case not ordered yet. */
async function websiteMoved(tx: Runner, order: WebOrderRow, status: string, reason: string | null) {
  const leadId = order.leadId as number;
  await caseNote(
    tx,
    leadId,
    `Website: ${WEB_STATUS_LABEL[status] ?? status}${reason ? ` (${reason})` : ""}.`,
  );
  if (status !== "cancelled") return;
  const [lead] = await rows<{
    state: string;
    orderCode: string | null;
    orderStatus: OrderStatus | null;
  }>(
    tx,
    sql`select l.state, o.code as "orderCode", o.status as "orderStatus" from lead l left join sales_order o on o.id = l.order_id where l.id = ${leadId}`,
  );
  if (!lead) return;
  if (!lead.orderStatus || lead.orderStatus === "cancelled") {
    if (lead.state === "open") {
      await tx.execute(
        sql`update lead set state = 'lost', lost_reason = ${`Cancelled on the website${reason ? `: ${reason}` : ""}`} where id = ${leadId}`,
      );
    }
  } else if (lead.orderStatus !== "completed") {
    await caseNote(
      tx,
      leadId,
      `Cancelled on the website: cancel ${lead.orderCode} here if it isn't going out.`,
    );
  }
}

type CatalogueRow = {
  id: number;
  name: string;
  strength: string | null;
  brand: string | null;
  sku: string | null;
  packSize: number;
  vat: Vat;
  rx: boolean;
  price: number | null;
};

/** The amounts ("500 mg") and volumes ("0.5 ml") a text names. */
function dosesIn(value: unknown) {
  const found = [
    ...norm(value)
      .replace(/[µμ]g/g, "mcg")
      .matchAll(/(\d+(?:\.\d+)?)\s*(mcg|mg|ml|iu|g|%)(?![a-z])/g),
  ];
  const of = (volume: boolean) =>
    new Set(found.filter((m) => (m[2] === "ml") === volume).map((m) => `${Number(m[1])}${m[2]}`));
  return { amounts: of(false), volumes: of(true) };
}
const agree = (a: Set<string>, b: Set<string>) =>
  !a.size || !b.size || (a.size === b.size && [...a].every((dose) => b.has(dose)));
function sameDose(item: WebItem, medicine: CatalogueRow) {
  const asked = dosesIn(`${item.name} ${item.packSize ?? ""}`);
  const stocked = dosesIn(`${medicine.name} ${medicine.strength ?? ""}`);
  return agree(asked.amounts, stocked.amounts) && agree(asked.volumes, stocked.volumes);
}

/** The catalogue medicine a website item is: by name, then name with strength or brand, then SKU;
 *  the doses must agree, and only a single match counts (the wrong strength is worse than none). */
export function matchMedicine(item: WebItem, catalogue: CatalogueRow[]): CatalogueRow | null {
  const name = norm(item.name);
  const brand = norm(item.brand);
  const sku = norm(item.sku);
  const namesOf = (medicine: CatalogueRow) => {
    const own = norm(medicine.name);
    const strength = norm(medicine.strength);
    const maker = norm(medicine.brand);
    return [
      own,
      ...(strength ? [`${own} ${strength}`] : []),
      ...(maker ? [`${own} ${maker}`, `${maker} ${own}`] : []),
    ];
  };
  const tiers: ((medicine: CatalogueRow) => boolean)[] = [
    (medicine) => norm(medicine.name) === name && sameDose(item, medicine),
    (medicine) =>
      (namesOf(medicine).includes(name) || (brand !== "" && namesOf(medicine).includes(brand))) &&
      sameDose(item, medicine),
    (medicine) => sku !== "" && norm(medicine.sku) === sku,
  ];
  for (const fits of tiers) {
    const found = catalogue.filter(fits);
    if (found.length === 1) return found[0] ?? null;
  }
  return null;
}

/** Opens the order's case: who ordered, how they pay, the medicines as its quotation. */
async function openCase(tx: Runner, site: Site, order: WebOrderRow): Promise<number> {
  const catalogue = await rows<CatalogueRow>(
    tx,
    sql`select m.id::int as id, m.name, m.strength, m.brand, m.sku, m.pack_size::int as "packSize", m.vat, m.rx,
        (select amount::int from medicine_price p where p.medicine_id = m.id and p.buyer_type = 'patient') as price
      from medicine m where m.active`,
  );
  const { road, agency } = roadOf(order.benefit, order.assistance);
  // A commercial discount (a coupon, an offer) comes off the lines; a senior / PWD benefit is
  // worked out again by the CRM from the road.
  const commercial = road === "senior" || road === "pwd" ? 0 : (order.money.discount ?? 0);
  const discounts = share(
    commercial,
    order.items.map((item) => item.lineTotal || item.unitPrice * item.quantity),
  );
  const lines: QuoteLine[] = [];
  let unmatched = 0;
  order.items.forEach((item, index) => {
    const medicine = item.quantity > 0 ? matchMedicine(item, catalogue) : null;
    if (!medicine || medicine.price === null) {
      unmatched += 1;
      return;
    }
    // The website sells packs; the CRM counts pieces.
    const units = item.packUnits ?? medicine.packSize;
    const gross = item.unitPrice * item.quantity - (discounts[index] ?? 0);
    const qty = item.quantity * units;
    const unitPrice = Math.max(0, Math.round(gross / qty));
    lines.push({
      medicineId: medicine.id,
      medicine: [medicine.name, medicine.strength].filter(Boolean).join(" "),
      qty,
      packSize: medicine.packSize,
      listPrice: medicine.price,
      unitPrice,
      // A price other than the list's says where it came from (Management sees it either way).
      reason: unitPrice !== medicine.price ? `The price on ${site.name}` : null,
      vat: medicine.vat,
      rx: medicine.rx,
    });
  });
  // One medicine on two website lines becomes one line.
  const merged = lines.reduce<QuoteLine[]>((all, line) => {
    const same = all.find((other) => other.medicineId === line.medicineId);
    if (same) same.qty += line.qty;
    else all.push({ ...line });
    return all;
  }, []);
  const customer = order.customer;
  const name = text(customer.name, 120) ?? "Website customer";
  const email = text(customer.email, 120);
  const items = order.items.map((item) => `${item.quantity} × ${item.name}`).join(", ");
  const request = [`Website order ${order.ref}: ${items}.`, text(customer.notes, 1000)]
    .filter(Boolean)
    .join("\n");
  const complete = merged.length > 0 && unmatched === 0;
  const [made] = await rows<{ id: number }>(
    tx,
    sql`insert into lead (source, site_account_id, case_type, name, patient_name, phone, phone_key, email, address, road, agency, request,
        quote_lines, quote_road, quote_agency, quote_saved_at, first_contact_at, created_by)
      values ('website', ${site.id}, 'website_order', ${name}, ${name}, ${text(customer.phone, 40)}, ${phoneKey(text(customer.phone, 40))},
        ${email && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email) && !/\.(local|invalid)$/i.test(email) ? email : null},
        ${text(customer.address, 300)}, ${road}, ${agency}, ${request}, ${JSON.stringify(merged)}::jsonb,
        ${complete ? road : null}, ${complete ? agency : null}, ${complete ? sql`now()` : null}, ${order.placedAt ?? new Date().toISOString()}, null)
      returning id::int as id`,
  );
  const leadId = made?.id as number;
  await tx.execute(
    sql`with next as (update counter set value = value + 1 where name = 'lead' returning value)
      update lead set code = 'ENQ-' || lpad(next.value::text, 5, '0') from next where lead.id = ${leadId}`,
  );
  await tx.execute(
    sql`update web_order set lead_id = ${leadId}, card_note = null where id = ${order.id}`,
  );
  const pays = order.paymentMethod
    ? ` Pays by ${order.paymentMethod === "cod" ? "cash on delivery" : order.paymentMethod}.`
    : "";
  await caseNote(
    tx,
    leadId,
    `Website order ${order.ref} on ${site.name}: ${items}, ${peso(order.money.total ?? 0)}.${pays}`,
  );
  if (unmatched)
    await caseNote(
      tx,
      leadId,
      `${unmatched} item${unmatched > 1 ? "s aren't" : " isn't"} in the catalogue: check the quotation against the website order and save it.`,
    );
  return leadId;
}

/** Copies the order's documents onto its case, unsorted; true while some still wait for a retry. */
async function copyDocuments(
  db: Database,
  orderId: number,
  incoming: (WebFile & { url: string | null })[],
  /** A guarantee letter sent after the order (order.letter_uploaded): filed as the letter. */
  letterLater = false,
): Promise<boolean> {
  const [order] = await rows<WebOrderRow>(db, sql`${ORDER_SELECT} where id = ${orderId}`);
  if (!order?.leadId) return false;
  const links = new Map(
    incoming.filter((file) => file.url).map((file) => [file.key, file.url as string]),
  );
  let waiting = false;
  const files = [...order.files];
  for (const file of files) {
    if (file.fetched || file.gaveUp) continue;
    const url = links.get(file.key);
    if (!url) {
      waiting = true;
      continue;
    }
    const got = await http.file(url);
    if (got && /^(image\/(jpeg|png|webp|gif|heic|heif)|application\/pdf)$/.test(got.mime)) {
      const extension = got.mime === "application/pdf" ? "pdf" : (got.mime.split("/")[1] ?? "jpg");
      const label = file.kind === "prescription" ? "rx" : file.kind === "id" ? "id" : "gl-letter";
      const kept = await keepFile("cases", {
        name: `website-${label}-${order.ref}-${file.key.slice(0, 6)}.${extension}`,
        mime: got.mime,
        bytes: got.bytes,
      });
      await db.execute(
        sql`insert into lead_file (lead_id, kind, name, mime, size, data, store_key, by_person)
          values (${order.leadId}, ${letterLater && file.kind === "gl" ? "gl_letter" : "unsorted"}, ${kept.name}, ${kept.mime}, ${kept.size}, ${kept.data}, ${kept.key}, null)`,
      );
      file.fetched = true;
    } else {
      file.attempts += 1;
      if (file.attempts >= WEBSITE_DOCUMENT_ATTEMPTS) {
        file.gaveUp = true;
        await caseNote(
          db,
          order.leadId,
          `A ${file.kind === "gl" ? "guarantee letter" : file.kind === "id" ? "ID" : "prescription"} from website order ${order.ref} couldn't be copied: open it in the website's admin or upload it here.`,
        );
      } else waiting = true;
    }
  }
  await db.execute(
    sql`update web_order set files = ${JSON.stringify(files)}::jsonb where id = ${orderId}`,
  );
  return waiting;
}

/** A person opens the case of an order the CRM left (it came late or had moved on). */
export async function openWebsiteCase(
  db: Database,
  me: Me,
  webOrderId: number,
): Promise<{ leadId: number }> {
  allow(me, [...LEAD_WORK_ROLES, ...CHANNEL_ROLES], "open a website order's case");
  return db.transaction(async (tx) => {
    const [found] = await rows<WebOrderRow>(
      tx,
      sql`${ORDER_SELECT} where id = ${webOrderId} for update`,
    );
    const [owner] = await rows<{ accountId: number }>(
      tx,
      sql`select account_id::int as "accountId" from web_order where id = ${webOrderId}`,
    );
    if (!found) throw new Refusal(404, "not_found", "No such website order.");
    if (found.leadId) return { leadId: found.leadId };
    if (found.status === "cancelled")
      throw new Refusal(409, "not_now", "It is cancelled on the website.");
    const [account] = await rows<{ id: number; key: string; name: string }>(
      tx,
      sql`select id::int as id, key, name from channel_account where id = ${owner?.accountId}`,
    );
    const leadId = await openCase(
      tx,
      {
        id: account?.id as number,
        key: account?.key ?? "",
        name: account?.name ?? "Website",
        secret: "",
      },
      found,
    );
    await caseNote(tx, leadId, `${me.name} opened this case for the website order.`);
    return { leadId };
  });
}

// ---------------------------------------------------------------- prescriptions and enquiries

async function receiveRequest(
  db: Database,
  site: Site,
  event: string,
  data: Record<string, unknown>,
): Promise<string> {
  const kind = event === "prescription.uploaded" ? "prescription" : "enquiry";
  const ref = text(data.requestNumber ?? data.enquiryNumber ?? data.ref ?? data.requestId, 100);
  if (!ref) throw new Refusal(400, "invalid", `The ${kind} has no number.`);
  const customer = obj(data.customer);
  const name = text(customer.name ?? data.name, 120) ?? "Website customer";
  const phone = text(customer.phone ?? data.phone, 40);
  const email = text(customer.email ?? data.email, 120);
  const subject = text(data.subject ?? data.topic, 200);
  const message = text(data.note ?? data.message, 2000);
  const fileUrl = kind === "prescription" ? text(data.fileUrl, 4000) : null;
  const fileName = text(data.fileName);
  const leadId = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`webreq:${site.id}:${kind}:${ref}`}, 0))`,
    );
    const [known] = await rows<{ leadId: number | null }>(
      tx,
      sql`select lead_id::int as "leadId" from web_request where account_id = ${site.id} and kind = ${kind} and ref = ${ref}`,
    );
    if (known) return known.leadId;
    // The person's newest open case, by their number; else a new one.
    const key = phoneKey(phone);
    const [existing] = key
      ? await rows<{ id: number }>(
          tx,
          sql`select id::int as id from lead where phone_key = ${key} and state = 'open' order by id desc limit 1`,
        )
      : [];
    let id = existing?.id;
    const label =
      kind === "prescription"
        ? `Prescription sent through ${site.name} · ${ref}`
        : `${subject ?? "Enquiry"} · ${ref}`;
    if (!id) {
      const [made] = await rows<{ id: number }>(
        tx,
        sql`insert into lead (source, site_account_id, name, patient_name, phone, phone_key, email, address, request, first_contact_at, created_by)
          values ('website', ${site.id}, ${name}, ${name}, ${phone}, ${key}, ${email && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email) ? email : null},
            ${text(customer.address, 300)}, ${[label, message].filter(Boolean).join("\n")}, ${isoOrNull(data.createdAt) ?? new Date().toISOString()}, null)
          returning id::int as id`,
      );
      id = made?.id as number;
      await tx.execute(
        sql`with next as (update counter set value = value + 1 where name = 'lead' returning value)
          update lead set code = 'ENQ-' || lpad(next.value::text, 5, '0') from next where lead.id = ${id}`,
      );
    }
    await tx.execute(
      sql`insert into web_request (account_id, kind, ref, customer, message, file, lead_id)
        values (${site.id}, ${kind}, ${ref}, ${JSON.stringify({ name, phone, email })}::jsonb, ${message},
          ${fileUrl ? JSON.stringify({ name: fileName, fetched: false, attempts: 0 }) : null}::jsonb, ${id})`,
    );
    await caseNote(tx, id, `${label}${message ? `: ${message}` : ""}`);
    if (existing) await tx.execute(sql`update lead set awaiting_reply = true where id = ${id}`);
    return id;
  });
  if (!fileUrl || !leadId) return "kept";
  // The prescription onto the case; a link that fails is tried again on the website's retry.
  const [request] = await rows<{
    id: number;
    file: { name: string | null; fetched: boolean; attempts: number; gaveUp?: boolean } | null;
  }>(
    db,
    sql`select id::int as id, file from web_request where account_id = ${site.id} and kind = ${kind} and ref = ${ref}`,
  );
  const file = request?.file;
  if (!request || !file || file.fetched || file.gaveUp) return "kept";
  const got = await http.file(fileUrl);
  if (got && /^(image\/(jpeg|png|webp|gif|heic|heif)|application\/pdf)$/.test(got.mime)) {
    const kept = await keepFile("cases", {
      name: `website-rx-${ref}.${got.mime === "application/pdf" ? "pdf" : (got.mime.split("/")[1] ?? "jpg")}`,
      mime: got.mime,
      bytes: got.bytes,
    });
    await db.execute(
      sql`insert into lead_file (lead_id, kind, name, mime, size, data, store_key, by_person)
        values (${leadId}, 'unsorted', ${kept.name}, ${kept.mime}, ${kept.size}, ${kept.data}, ${kept.key}, null)`,
    );
    await db.execute(
      sql`update web_request set file = ${JSON.stringify({ ...file, fetched: true })}::jsonb where id = ${request.id}`,
    );
    return "kept";
  }
  const attempts = file.attempts + 1;
  const gaveUp = attempts >= WEBSITE_DOCUMENT_ATTEMPTS;
  await db.execute(
    sql`update web_request set file = ${JSON.stringify({ ...file, attempts, gaveUp })}::jsonb where id = ${request.id}`,
  );
  if (gaveUp) {
    await caseNote(
      db,
      leadId,
      `The prescription ${ref} from ${site.name} couldn't be copied: open it in the website's admin or upload it here.`,
    );
    return "kept";
  }
  return "documents_pending";
}

// ---------------------------------------------------------------- the status back to the website

/** What a website should show for the case's order (or a closed case with no order). */
function wantedFor(order: {
  status: OrderStatus | null;
  state: string;
}): "confirmed" | "shipped" | "delivered" | "cancelled" | null {
  if (!order.status) return order.state === "lost" ? "cancelled" : null;
  if (order.status === "cancelled") return "cancelled";
  if (order.status === "completed") return "delivered";
  if (order.status === "shipped") return "shipped";
  // Confirmed once Management approves it, like the customer's own email (18 Nov).
  if (["finance_check", "ready_for_invoice", "ready_for_dispatch", "packing"].includes(order.status))
    return "confirmed";
  return null;
}

/** Sets what each website order should be told, then sends what is due. */
export async function pushWebsites(db: Database): Promise<number> {
  const watched = await rows<{
    id: number;
    status: string;
    pushStatus: string | null;
    orderStatus: OrderStatus | null;
    state: string;
    flagReason: string | null;
    lostReason: string | null;
    tracking: string | null;
    pushedTracking: string | null;
    letter: string | null;
    quoted: boolean;
  }>(
    db,
    sql`select w.id::int as id, w.status, w.push_status as "pushStatus", o.status as "orderStatus", l.state, o.flag_reason as "flagReason", l.lost_reason as "lostReason",
        nullif(trim(o.tracking), '') as tracking, w.pushed_tracking as "pushedTracking", w.letter,
        (l.quote_sent_at is not null or l.gl_applied_on is not null) as quoted
      from web_order w join lead l on l.id = w.lead_id left join sales_order o on o.id = l.order_id
      where w.status not in ('delivered', 'cancelled') or w.push_status is not null`,
  );
  for (const row of watched) {
    // A tracking number typed after shipping: "shipped" goes again with it (the old CRM's way).
    if (
      row.orderStatus === "shipped" &&
      row.status === "shipped" &&
      !row.pushStatus &&
      row.tracking &&
      row.tracking !== row.pushedTracking
    ) {
      await db.execute(
        sql`update web_order set push_status = 'shipped', push_reason = null, push_error = null, push_attempts = 0, push_next_at = now() where id = ${row.id}`,
      );
      continue;
    }
    const wanted = wantedFor({ status: row.orderStatus, state: row.state });
    // A guarantee letter's customer: once our quotation went out (or the application is on
    // record), the website tells them to apply with it; once, and never over a real move.
    if (
      (!wanted || websiteHas(row.status, wanted)) &&
      row.letter === "needed" &&
      row.quoted &&
      !row.pushStatus &&
      !["shipped", "delivered", "cancelled"].includes(row.status) &&
      !["shipped", "completed", "cancelled"].includes(row.orderStatus ?? "")
    ) {
      await db.execute(
        sql`update web_order set push_status = 'quotation_sent', push_reason = null, push_error = null, push_attempts = 0, push_next_at = now() where id = ${row.id}`,
      );
      continue;
    }
    if (!wanted || websiteHas(row.status, wanted) || row.pushStatus === wanted) continue;
    const reason =
      wanted === "cancelled"
        ? row.orderStatus === "cancelled"
          ? row.flagReason
          : row.lostReason
        : null;
    await db.execute(
      sql`update web_order set push_status = ${wanted}, push_reason = ${reason}, push_error = null, push_attempts = 0, push_next_at = now() where id = ${row.id}`,
    );
  }
  const due = await rows<{ id: number }>(
    db,
    sql`select id::int as id from web_order where push_status is not null and push_attempts < 30 and coalesce(push_next_at, now()) <= now() order by id limit 50`,
  );
  let sent = 0;
  for (const row of due) if (await pushOne(db, row.id)) sent += 1;
  return sent;
}

async function pushOne(db: Database, id: number): Promise<boolean> {
  const [order] = await rows<{
    ref: string;
    pushStatus: string;
    pushReason: string | null;
    statusUrl: string | null;
    leadId: number | null;
    secret: string;
    siteName: string;
    tracking: string | null;
    courier: string | null;
    attempts: number;
  }>(
    db,
    sql`select w.ref, w.push_status as "pushStatus", w.push_reason as "pushReason", w.status_url as "statusUrl", w.lead_id::int as "leadId", a.secret,
        a.name as "siteName", o.tracking, o.courier, w.push_attempts::int as attempts
      from web_order w join channel_account a on a.id = w.account_id left join lead l on l.id = w.lead_id left join sales_order o on o.id = l.order_id
      where w.id = ${id} and w.push_status is not null`,
  );
  if (!order) return false;
  if (!order.statusUrl) {
    await db.execute(
      sql`update web_order set push_error = 'The website didn''t say where to send updates.', push_attempts = 30 where id = ${id}`,
    );
    return false;
  }
  const tracking = order.tracking?.trim() || null;
  const link = tracking && /^https:\/\//.test(tracking) ? tracking : null;
  const body = JSON.stringify({
    event: "order.status",
    deliveryId: randomUUID(),
    sentAt: new Date().toISOString(),
    data: {
      orderNumber: order.ref,
      status: order.pushStatus,
      ...(order.pushReason ? { reason: order.pushReason } : {}),
      ...(order.pushStatus === "shipped" && tracking
        ? { trackingNumber: link ? null : tracking, ...(link ? { trackingUrl: link } : {}) }
        : {}),
      changedAt: new Date().toISOString(),
    },
  });
  const deliveryId = (JSON.parse(body) as { deliveryId: string }).deliveryId;
  const answer = await http.post(order.statusUrl, body, {
    "content-type": "application/json",
    "x-crm-event": "order.status",
    "x-crm-delivery": deliveryId,
    "x-crm-signature": sign(body, unseal(order.secret)),
  });
  const message = text(answer.json?.message, 500);
  if (answer.status >= 200 && answer.status < 300) {
    if (order.pushStatus === "quotation_sent") {
      // No status moved: the website keeps what it shows (forward only), the letter is quoted.
      const said = text(answer.json?.status, 40);
      await db.execute(
        sql`update web_order set letter = 'quoted', push_status = null, push_reason = null, push_error = null, push_attempts = 0, pushed_at = now(),
            status = case when ${said ?? ""} in ('pending', 'confirmed', 'packed', 'scheduled', 'shipped', 'delivered', 'cancelled') then ${said ?? ""} else status end
          where id = ${id}`,
      );
      if (order.leadId)
        await caseNote(db, order.leadId, `${order.siteName} now tells the customer to apply at the agency with our quotation.`);
      return true;
    }
    const shows = text(answer.json?.status, 40) ?? order.pushStatus;
    await db.execute(
      sql`update web_order set status = ${shows}, push_status = null, push_reason = null, push_error = null, push_attempts = 0, pushed_at = now(), updated_at = now(),
          pushed_tracking = ${order.pushStatus === "shipped" ? tracking : null} where id = ${id}`,
    );
    if (order.leadId)
      await caseNote(
        db,
        order.leadId,
        `${order.siteName} now shows: ${WEB_STATUS_LABEL[shows] ?? shows}.`,
      );
    return true;
  }
  if (answer.status >= 400 && answer.status < 500) {
    // The website refused it: trying again won't change that; a person looks.
    await db.execute(
      sql`update web_order set push_error = ${`${order.siteName} refused "${order.pushStatus}": ${message ?? `answered ${answer.status}`}`}, push_attempts = 30 where id = ${id}`,
    );
    if (order.leadId)
      await caseNote(
        db,
        order.leadId,
        `${order.siteName} didn't take "${WEB_STATUS_LABEL[order.pushStatus]}": ${message ?? `it answered ${answer.status}`}.`,
      );
    return false;
  }
  const attempts = order.attempts + 1;
  const wait = Math.min(6 * 3600, 30 * 2 ** Math.min(attempts, 10));
  await db.execute(
    sql`update web_order set push_error = ${message ?? (answer.status ? `${order.siteName} answered ${answer.status}.` : `${order.siteName} didn't answer.`)},
        push_attempts = ${attempts}, push_next_at = now() + make_interval(secs => ${wait}) where id = ${id}`,
  );
  return false;
}

/** "Try again" on a status the website didn't take. */
export async function retryWebsitePush(db: Database, me: Me, webOrderId: number): Promise<void> {
  allow(me, [...LEAD_WORK_ROLES, ...CHANNEL_ROLES], "send a status to a website again");
  const changed = await rows<{ id: number }>(
    db,
    sql`update web_order set push_attempts = 0, push_next_at = now(), push_error = null where id = ${webOrderId} and push_status is not null returning id::int as id`,
  );
  if (!changed.length)
    throw new Refusal(409, "not_now", "Nothing is waiting to go to the website.");
  await pushOne(db, webOrderId);
}

// ---------------------------------------------------------------- the website's admin reads progress

/** A time column as the website reads it (UTC, ISO); the column is the code's own, never input. */
const isoOf = (column: string) => sql.raw(`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`);

/** A website's admin reads where its order stands (facts only; nothing is written). */
export async function answerProgress(
  db: Database,
  raw: string,
  signature: string | null | undefined,
): Promise<WebAnswer> {
  if (raw.length > 4000) return { status: 413, body: { message: "Too big." } };
  let envelope: { site?: unknown; ref?: unknown; sentAt?: unknown };
  try {
    envelope = JSON.parse(raw);
  } catch {
    return { status: 400, body: { message: "Send JSON." } };
  }
  const site = await siteByKey(db, siteOf(envelope.site));
  if (!site) return { status: 404, body: { message: "That website isn't connected." } };
  if (!signatureMatches(raw, signature, site.secret))
    return { status: 401, body: { message: "Bad signature." } };
  const sent = Date.parse(String(envelope.sentAt ?? ""));
  if (!Number.isFinite(sent) || Math.abs(Date.now() - sent) > 5 * 60_000)
    return { status: 400, body: { message: "sentAt is missing or more than five minutes off." } };
  const ref = text(envelope.ref, 100);
  if (!ref || typeof envelope.site !== "string")
    return { status: 400, body: { message: "Send the order's ref and the site." } };
  const [order] = await rows<{ leadId: number | null; note: string | null; at: string }>(
    db,
    sql`select lead_id::int as "leadId", card_note as note, ${isoOf("coalesce(updated_at, created_at)")} as at
      from web_order where account_id = ${site.id} and ref = ${ref}`,
  );
  if (!order) return { status: 404, body: { found: false, message: "No such order from this website." } };
  // As the old CRM answered (apps/store/src/progress.ts), the shape the website checks.
  if (!order.leadId)
    return {
      status: 200,
      body: {
        found: true,
        progress: {
          ref,
          road: "regular",
          roadLabel: "Regular",
          step: { key: "new", label: "No case yet" },
          nextStep: order.note ?? "The team opens a case for this order.",
          closed: false,
          stops: [],
          delivery: null,
          payment: null,
          letter: null,
          updatedAt: order.at,
        },
      },
    };
  const progress = await caseProgress(db, order.leadId);
  const [lead] = await rows<{
    state: string;
    agency: string | null;
    applied: boolean;
    letterNo: string | null;
    letterFile: boolean;
    verified: boolean;
    billed: boolean;
    glAmount: number | null;
    updatedAt: string;
  }>(
    db,
    sql`select l.state, l.agency, l.gl_applied_on is not null as applied, l.gl_letter_no as "letterNo",
        exists (select 1 from lead_file f where f.lead_id = l.id and f.active and f.kind = 'gl_letter') as "letterFile",
        l.gl_verified_at is not null as verified, l.claim_sent_on is not null as billed, l.gl_amount::int as "glAmount",
        ${isoOf("l.last_activity_at")} as "updatedAt"
      from lead l where l.id = ${order.leadId}`,
  );
  const [sale] = await rows<{
    status: OrderStatus;
    approved: boolean;
    method: string | null;
    tracking: string | null;
    trackingWait: boolean;
    expectedOn: string | null;
    deliveredAt: string | null;
    cameBack: number;
    terms: string;
    total: number;
    invoiceTotal: number | null;
    received: number | null;
  }>(
    db,
    sql`select o.status, o.approved_at is not null as approved, o.delivery_method as method, nullif(trim(o.tracking), '') as tracking,
        o.tracking_wait is not null as "trackingWait", to_char(o.expected_on, 'YYYY-MM-DD') as "expectedOn",
        ${isoOf("o.delivered_at")} as "deliveredAt", o.came_back_count::int as "cameBack", o.payment_terms as terms, o.total::int as total,
        i.total::int as "invoiceTotal", (i.paid - coalesce(i.refunded, 0))::int as received
      from lead l join sales_order o on o.id = l.order_id
      left join invoice i on i.order_id = o.id and i.status <> 'cancelled'
      where l.id = ${order.leadId}`,
  );
  const lost = lead?.state === "lost";
  const stops = journeyStops(progress.journey as never)
    .filter((stop) => stop.onRoad)
    .map((stop) => ({
      key: stop.key,
      label: stop.label,
      // A lost case has no current stop.
      state: stop.state === "todo" || (lost && stop.state === "current") ? "pending" : stop.state,
    }));
  const agency = progress.agency ? (AGENCY_SHORT[progress.agency] ?? progress.agency.toUpperCase()) : null;
  const roadLabel =
    progress.road === "gl"
      ? agency
        ? `GL · ${agency}`
        : "GL"
      : progress.road === "regular"
        ? "Regular"
        : progress.road === "senior"
          ? "Senior citizen"
          : "PWD";
  // The order's delivery and money, in the old CRM's words.
  const saleState = !sale
    ? null
    : sale.status === "completed"
      ? "delivered"
      : sale.status === "shipped"
        ? "shipped"
        : sale.status === "cancelled"
          ? "cancelled"
          : sale.status === "draft" || sale.status === "pending_approval" || (sale.status === "on_hold" && !sale.approved)
            ? "draft"
            : "confirmed";
  const STATE_LABEL: Record<string, string> = {
    draft: "Draft",
    confirmed: "Confirmed",
    shipped: "Shipped",
    delivered: "Delivered",
    cancelled: "Cancelled",
  };
  const link = sale?.tracking?.match(/https:\/\/\S+/)?.[0] ?? null;
  const trackingNumber = sale?.tracking ? sale.tracking.replace(/https?:\/\/\S+/g, "").trim() || null : null;
  const delivery =
    sale && saleState
      ? {
          status: saleState,
          statusLabel: STATE_LABEL[saleState] ?? saleState,
          outcome:
            saleState === "delivered"
              ? "Delivered to receiver"
              : saleState === "cancelled"
                ? sale.cameBack > 0
                  ? "Returned to sender"
                  : "Cancelled"
                : sale.cameBack > 0
                  ? "Delivery attempt failed"
                  : saleState === "shipped"
                    ? "In transit"
                    : "Not dispatched",
          method:
            sale.method === "pickup"
              ? "Pick-up"
              : sale.method === "rider"
                ? "Our delivery"
                : sale.method === "courier"
                  ? "Courier"
                  : null,
          trackingNumber,
          trackingUrl: link,
          expectedOn: sale.expectedOn,
          deliveredAt: sale.deliveredAt,
          issue:
            saleState === "shipped" && sale.trackingWait && !sale.tracking
              ? "Waiting for tracking"
              : sale.cameBack > 0 && saleState !== "delivered" && saleState !== "cancelled"
                ? "Delivery attempt failed"
                : null,
        }
      : null;
  const total = sale ? (sale.invoiceTotal ?? sale.total) : 0;
  const received = sale?.received ?? 0;
  const payment = sale
    ? {
        method:
          progress.road === "gl"
            ? "Government agency claim (GL)"
            : sale.terms === "cod"
              ? "Cash on delivery (COD)"
              : sale.terms === "advance"
                ? "Paid online / prepaid"
                : "On account (pays by the due date)",
        invoiced: sale.invoiceTotal !== null,
        total: total / 100,
        received: received / 100,
        balance: Math.max(0, total - received) / 100,
      }
    : null;
  // A guarantee letter's own road, once applied for.
  const letterState =
    progress.road !== "gl" || !lead?.applied
      ? null
      : progress.step.value === "done"
        ? "paid"
        : lead.billed
          ? "billed"
          : lead.verified
            ? "verified"
            : lead.letterNo || lead.letterFile
              ? "pending"
              : "applying";
  const LETTER_LABEL: Record<string, string> = {
    applying: "Applied",
    pending: "GL awarded",
    verified: "Verified",
    billed: "Billed to the agency",
    paid: "Paid by the agency",
  };
  return {
    status: 200,
    body: {
      found: true,
      progress: {
        ref,
        road: progress.road,
        roadLabel,
        step: lost ? { key: "lost", label: "Lost" } : { key: progress.step.value, label: progress.step.label },
        nextStep: String(progress.next ?? ""),
        closed: lost,
        stops,
        delivery,
        payment,
        letter: letterState
          ? { state: letterState, stateLabel: LETTER_LABEL[letterState] ?? letterState, amount: (lead?.glAmount ?? 0) / 100 }
          : null,
        updatedAt: lead?.updatedAt ?? order.at,
      },
    },
  };
}

// ---------------------------------------------------------------- reads for the screens

/** The website order a case was opened for, as the customer placed it. */
export async function webOrderOfCase(db: Runner, leadId: number): Promise<WebOrderView | null> {
  const [found] = await rows<{
    id: number;
    site: string;
    ref: string;
    status: string;
    placedAt: string | null;
    adminUrl: string | null;
    paymentMethod: string | null;
    benefit: string | null;
    assistance: string | null;
    items: WebItem[];
    money: Record<string, number>;
    files: WebFile[];
    pushStatus: string | null;
    pushError: string | null;
    pushedAt: string | null;
    pointsRedeemed: number;
  }>(
    db,
    sql`select w.id::int as id, a.name as site, w.ref, w.status, w.points_redeemed::int as "pointsRedeemed", to_char(w.placed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "placedAt",
        w.admin_url as "adminUrl", w.payment_method as "paymentMethod", w.benefit, w.assistance, w.items, w.money, w.files,
        w.push_status as "pushStatus", w.push_error as "pushError", to_char(w.pushed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "pushedAt"
      from web_order w join channel_account a on a.id = w.account_id where w.lead_id = ${leadId} order by w.id desc limit 1`,
  );
  if (!found) return null;
  const catalogue = await rows<CatalogueRow>(
    db,
    sql`select m.id::int as id, m.name, m.strength, m.brand, m.sku, m.pack_size::int as "packSize", m.vat, m.rx, null::int as price from medicine m where m.active`,
  );
  return {
    id: found.id,
    site: found.site,
    ref: found.ref,
    status: found.status,
    statusLabel: WEB_STATUS_LABEL[found.status] ?? found.status,
    placedAt: found.placedAt,
    adminUrl: found.adminUrl,
    paymentMethod: found.paymentMethod,
    benefit: found.benefit,
    assistance: found.assistance,
    items: found.items.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
      matched: Boolean(matchMedicine(item, catalogue)),
    })),
    pointsRedeemed: found.pointsRedeemed,
    money: {
      subtotal: found.money.subtotal ?? 0,
      vatExempted: found.money.vatExempted ?? 0,
      discount: found.money.discount ?? 0,
      deliveryFee: found.money.deliveryFee ?? 0,
      total: found.money.total ?? 0,
    },
    files: found.files.map((file) => ({
      name: file.name,
      kind: file.kind,
      fetched: file.fetched,
      gaveUp: file.gaveUp,
    })),
    push: { status: found.pushStatus, error: found.pushError, pushedAt: found.pushedAt },
  };
}

/** The delivery fee and the way the customer chose to pay, for the order the case places. */
export async function websiteTerms(
  db: Runner,
  leadId: number,
): Promise<{ deliveryFee: number; pay: "cod" | "advance" | null } | null> {
  const [found] = await rows<{ fee: number | null; method: string | null }>(
    db,
    sql`select (money->>'deliveryFee')::int as fee, payment_method as method from web_order where lead_id = ${leadId} order by id desc limit 1`,
  );
  if (!found) return null;
  const method = (found.method ?? "").toLowerCase();
  return {
    deliveryFee: found.fee ?? 0,
    pay: method === "cod" || method.includes("cash") ? "cod" : method ? "advance" : null,
  };
}

/** A website's connection, for Channels. */
export async function websiteStatus(db: Runner, accountId: number): Promise<WebsiteStatus> {
  const [last, [counted], noCase, pushFailing, refusals, [config]] = await Promise.all([
    rows<{ at: string; event: string; outcome: string; error: string | null }>(
      db,
      sql`select to_char(at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as at, event, outcome, error from web_call where account_id = ${accountId} order by id desc limit 1`,
    ),
    rows<{ n: number }>(
      db,
      sql`select count(*)::int as n from web_order where account_id = ${accountId}`,
    ),
    rows<WebsiteStatus["noCase"][number]>(
      db,
      sql`select id::int as id, ref, status, to_char(placed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "placedAt", card_note as note
        from web_order where account_id = ${accountId} and lead_id is null and status <> 'cancelled' order by id desc limit 20`,
    ),
    rows<WebsiteStatus["pushFailing"][number]>(
      db,
      sql`select id::int as id, ref, push_status as status, push_error as error from web_order
        where account_id = ${accountId} and push_status is not null and push_error is not null order by id desc limit 20`,
    ),
    rows<WebsiteStatus["refusals"][number]>(
      db,
      sql`select to_char(at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as at, event, ref, error from web_call
        where account_id = ${accountId} and outcome = 'failed' order by id desc limit 10`,
    ),
    rows<WebsiteStatus["catalog"]>(
      db,
      sql`select nullif(config->>'catalogUrl', '') as url, config->>'catalogSentAt' as "sentAt", (config->>'catalogSent')::int as sent,
          config->>'catalogCheckedAt' as "checkedAt", config->>'catalogError' as error
        from channel_account where id = ${accountId}`,
    ),
  ]);
  return {
    lastCall: last[0] ?? null,
    orders: counted?.n ?? 0,
    noCase,
    pushFailing,
    refusals,
    catalog: config ?? { url: null, sentAt: null, sent: null, checkedAt: null, error: null },
  };
}

export { SOURCE_LABEL };
