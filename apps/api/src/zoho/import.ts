// Brings what was sold before this CRM over from Zoho: the customers (hospitals, doctors, buyers,
// patients) and every sales order with its lines. It is history only: nothing here moves stock,
// makes an invoice, sends a message, gives points or opens a to-do. Every row keeps Zoho's id, so
// sending the same rows again adds only what is missing. The Admin sends them in batches (dry
// run unless `apply`); scripts/import-zoho.ts reads them from Zoho's backup.

import { sql } from "drizzle-orm";
import { z } from "zod";
import { phoneKey } from "../customers/service";
import { type Database, rows } from "../db/index";
import { formatPhone } from "../phone";
import type { CustomerKind } from "../types";

const KINDS = ["hospital", "doctor", "patient", "drugstore", "distributor", "government"] as const;
const text = (max: number) => z.string().max(max).nullish();

export const zohoCustomer = z.object({
  /** Zoho's contact id. */
  id: z.string().min(1).max(40),
  name: z.string().min(1).max(300),
  /** Zoho's "business" (a company); otherwise an individual. */
  business: z.boolean(),
  /** Zoho's "Is Doctor" tick, when it is known. */
  doctor: z.boolean().nullish(),
  /** What their Zoho orders say they are (a "Hospital PO", a bidding order…), when they say it. */
  hint: z.enum(KINDS).nullish(),
  phone: text(80),
  mobile: text(80),
  email: text(200),
  address: text(600),
  city: text(120),
  tin: text(60),
  /** Zoho's payment terms as written there ("Paid", "Net 30"). */
  terms: text(80),
  createdAt: text(40),
});
export type ZohoCustomer = z.infer<typeof zohoCustomer>;

export const zohoOrder = z.object({
  /** Zoho's sales order id. */
  id: z.string().min(1).max(40),
  /** Zoho's number (SO-67227). */
  code: z.string().min(1).max(60),
  /** Zoho's contact id of the buyer. */
  customerId: z.string().min(1).max(40),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.string().min(1).max(40),
  /** Pesos. */
  total: z.number().min(0),
  seller: text(200),
  division: text(120),
  source: text(200),
  invoicedFrom: text(200),
  reference: text(200),
  /** Zoho's "prices include tax" on this order (the usual). */
  inclusiveTax: z.boolean().nullish(),
  /** A discount on the whole order, in percent. */
  discountPercent: z.number().min(0).max(100).nullish(),
  lines: z
    .array(
      z.object({
        sku: text(80),
        name: z.string().min(1).max(400),
        unit: text(40),
        qty: z.number(),
        /** Pesos for one, as typed in Zoho. */
        rate: z.number().min(0),
        /** Zoho's line total in pesos: after the line's discount, before tax. */
        itemTotal: z.number().min(0).nullish(),
        taxPercent: z.number().min(0).max(100).nullish(),
      }),
    )
    .max(500),
});
export type ZohoOrder = z.infer<typeof zohoOrder>;

// ---------------------------------------------------------------- what Zoho's words mean here

const GOVERNMENT =
  /\b(dswd|pcso|doh|lgu|philhealth|department of|city government|municipal(ity)?|provincial government|province of|city of|rural health|city health)\b/i;
const HOSPITAL = /hospital|medical cent(er|re)|med(ical)? ?cent|clinic|infirmary|lying[- ]in|health cent(er|re)|dialysis|polyclinic/i;
const DRUGSTORE = /pharmac|drug ?store|drugs?\b|botica|farmacia|generics/i;
const DOCTOR = /^(dr|dra|doc|doctor)\b\.?/i;

/** The kind of customer a Zoho contact is here. Zoho only says business or individual, so the
 *  rest is read from their name and from what their orders were. */
export function kindOf(
  contact: Pick<ZohoCustomer, "name" | "business" | "doctor" | "hint">,
): CustomerKind {
  const name = contact.name.trim();
  if (!contact.business)
    return contact.doctor || contact.hint === "doctor" || DOCTOR.test(name) ? "doctor" : "patient";
  if (contact.hint === "government") return "government";
  if (HOSPITAL.test(name)) return "hospital";
  if (DRUGSTORE.test(name)) return "drugstore";
  if (GOVERNMENT.test(name)) return "government";
  if (contact.hint && contact.hint !== "doctor" && contact.hint !== "patient") return contact.hint;
  return "distributor";
}

/** Zoho's payment terms in this CRM's three: in advance, cash on delivery, or so many days. */
export function termsOf(label: string | null | undefined): {
  terms: "advance" | "cod" | "days";
  days: number | null;
} {
  const said = (label ?? "").toLowerCase();
  const days = Number(/(\d{1,3})/.exec(said)?.[1] ?? 0);
  if (/net|days|pdc|credit/.test(said) && days >= 1 && days <= 365) return { terms: "days", days };
  if (/cod|delivery|receipt/.test(said)) return { terms: "cod", days: null };
  return { terms: "advance", days: null };
}

/** What the customer was charged for one piece, in centavos: VAT in, after the line's and the
 *  order's discount. Zoho's line total is after the line's discount and before tax, whether or
 *  not the prices were typed with tax in. */
export function unitPriceOf(
  line: Pick<ZohoOrder["lines"][number], "qty" | "rate" | "itemTotal" | "taxPercent">,
  order: Pick<ZohoOrder, "inclusiveTax" | "discountPercent">,
): number {
  const tax = 1 + (line.taxPercent ?? 0) / 100;
  let pesos =
    line.itemTotal != null && line.qty > 0
      ? (line.itemTotal * tax) / line.qty
      : order.inclusiveTax === false
        ? line.rate * tax
        : line.rate;
  if (order.discountPercent) pesos *= 1 - order.discountPercent / 100;
  return Math.max(0, Math.round(pesos * 100));
}

const clip = (value: string | null | undefined, max: number) => {
  const clean = (value ?? "").replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, max) : null;
};
/** One JSON value handed to Postgres as a list of texts (one parameter, however long). */
const texts = (list: string[]) =>
  sql`(select jsonb_array_elements_text(${JSON.stringify(list)}::jsonb))`;

async function adminId(db: Database): Promise<number> {
  const [admin] = await rows<{ id: number }>(
    db,
    sql`select id::int as id from person where role = 'admin' and active order by id limit 1`,
  );
  if (!admin) throw new Error("No admin in this CRM.");
  return admin.id;
}

// ---------------------------------------------------------------- customers

export type ZohoCustomersResult = {
  customers: number;
  /** New customers here. */
  made: number;
  /** Zoho contacts that are a customer already here (the same buyer typed twice in Zoho, or added here by hand). */
  joined: number;
  alreadyHere: number;
  skipped: number;
  byKind: Partial<Record<CustomerKind, number>>;
};

/** Brings Zoho's customers over, once each. A hospital, doctor or business is one customer per
 *  name and city, and anyone with the same name and phone number is one customer, as everywhere
 *  in this CRM: a second Zoho contact of the same buyer joins the first. */
export async function importZohoCustomers(
  db: Database,
  customers: ZohoCustomer[],
  apply: boolean,
): Promise<ZohoCustomersResult> {
  const admin = await adminId(db);
  const said: ZohoCustomersResult = {
    customers: customers.length,
    made: 0,
    joined: 0,
    alreadyHere: 0,
    skipped: 0,
    byKind: {},
  };
  if (customers.length === 0) return said;

  const linked = new Set(
    (
      await rows<{ id: string }>(
        db,
        sql`select zoho_id as id from zoho_contact where zoho_id in ${texts(customers.map((one) => one.id))}`,
      )
    ).map((row) => row.id),
  );
  const fresh: ZohoCustomer[] = [];
  const seenIds = new Set<string>();
  for (const one of customers) {
    if (linked.has(one.id)) said.alreadyHere += 1;
    else if (seenIds.has(one.id)) said.skipped += 1;
    else {
      seenIds.add(one.id);
      fresh.push(one);
    }
  }

  // Customers already here under the same names, and the areas that name a city.
  const names = [...new Set(fresh.map((one) => (clip(one.name, 160) ?? "").toLowerCase()))];
  const here = await rows<{ id: number; kind: string; name: string; city: string; phoneKey: string | null }>(
    db,
    sql`select id::int as id, kind, lower(name) as name, lower(coalesce(city, '')) as city, phone_key as "phoneKey"
      from customer where lower(name) in ${texts(names)} order by id`,
  );
  // A customer here, or one about to be made from this batch (its Zoho id, until it has an id).
  type Target = number | string;
  const byPlace = new Map<string, Target>();
  const byPhone = new Map<string, Target>();
  for (const row of here) {
    const place = `${row.kind}|${row.name}|${row.city}`;
    if (row.kind !== "patient" && !byPlace.has(place)) byPlace.set(place, row.id);
    const phone = `${row.kind}|${row.name}|${row.phoneKey}`;
    if (row.phoneKey && !byPhone.has(phone)) byPhone.set(phone, row.id);
  }
  const areas = await rows<{ id: number; cities: string[] }>(
    db,
    sql`select id::int as id, cities from area`,
  );
  const areaOf = new Map<string, number | null>();
  for (const area of areas)
    for (const city of area.cities ?? []) {
      const key = city.toLowerCase();
      // A city two areas name belongs to neither until someone says which.
      areaOf.set(key, areaOf.has(key) ? null : area.id);
    }

  const toMake: Record<string, unknown>[] = [];
  const links: { zohoId: string; target: Target }[] = [];
  for (const one of fresh) {
    const name = clip(one.name, 160) as string;
    if (!name) {
      said.skipped += 1;
      continue;
    }
    const kind = kindOf(one);
    const city = clip(one.city, 80);
    const number = clip(one.mobile, 40) ?? clip(one.phone, 40);
    const key = phoneKey(number);
    const place = `${kind}|${name.toLowerCase()}|${(city ?? "").toLowerCase()}`;
    const phone = `${kind}|${name.toLowerCase()}|${key}`;
    const target = (kind !== "patient" ? byPlace.get(place) : undefined) ?? (key ? byPhone.get(phone) : undefined);
    if (target !== undefined) {
      said.joined += 1;
      links.push({ zohoId: one.id, target });
      continue;
    }
    said.made += 1;
    said.byKind[kind] = (said.byKind[kind] ?? 0) + 1;
    if (kind !== "patient") byPlace.set(place, one.id);
    if (key) byPhone.set(phone, one.id);
    links.push({ zohoId: one.id, target: one.id });
    const { terms, days } = termsOf(one.terms);
    const made = one.createdAt ? new Date(one.createdAt) : null;
    toMake.push({
      zohoId: one.id,
      kind,
      name,
      phone: formatPhone(number)?.slice(0, 40) ?? null,
      phoneKey: key,
      email: clip(one.email, 120),
      address: clip(one.address, 300),
      city,
      areaId: kind === "patient" || !city ? null : (areaOf.get(city.toLowerCase()) ?? null),
      tin: clip(one.tin, 40),
      terms,
      days,
      createdAt: made && !Number.isNaN(made.getTime()) ? made.toISOString() : null,
    });
  }
  if (!apply) return said;

  await db.transaction(async (tx) => {
    const made = toMake.length
      ? await rows<{ id: number; zohoId: string }>(
          tx,
          sql`insert into customer (kind, name, phone, phone_key, email, address, city, area_id, tin,
              payment_terms, payment_days, review, added_by, created_at, zoho_id)
            select x.kind, x.name, x.phone, x."phoneKey", x.email, x.address, x.city, x."areaId", x.tin,
              x.terms, x.days, 'ok', ${admin}, coalesce(x."createdAt"::timestamptz, now()), x."zohoId"
            from jsonb_to_recordset(${JSON.stringify(toMake)}::jsonb) as x(kind text, name text, phone text,
              "phoneKey" text, email text, address text, city text, "areaId" bigint, tin text, terms text,
              days integer, "createdAt" text, "zohoId" text)
            on conflict do nothing
            returning id::int as id, zoho_id as "zohoId"`,
        )
      : [];
    const idOf = new Map(made.map((row) => [row.zohoId, row.id]));
    if (made.length)
      await tx.execute(
        sql`update customer set code = 'CUS-' || lpad(id::text, 5, '0')
          where code is null and zoho_id in ${texts(made.map((row) => row.zohoId))}`,
      );
    const pairs = links
      .map((link) => ({
        zohoId: link.zohoId,
        customerId: typeof link.target === "number" ? link.target : idOf.get(link.target),
      }))
      .filter((pair) => pair.customerId !== undefined);
    // A customer the database would not take twice (the same name, written a little differently).
    const lost = links.length - pairs.length;
    said.skipped += lost;
    said.made -= toMake.length - made.length;
    if (pairs.length)
      await tx.execute(
        sql`insert into zoho_contact (zoho_id, customer_id)
          select x."zohoId", x."customerId" from jsonb_to_recordset(${JSON.stringify(pairs)}::jsonb)
            as x("zohoId" text, "customerId" bigint)
          on conflict do nothing`,
      );
  });
  return said;
}

// ---------------------------------------------------------------- sales orders

export type ZohoOrdersResult = {
  orders: number;
  made: number;
  alreadyHere: number;
  /** Orders whose buyer is not here yet (bring the customers first). */
  noCustomer: number;
  /** Drafts are not orders yet: left behind. */
  drafts: number;
  lines: number;
  freeLines: number;
};

/** Brings Zoho's sales orders over, once each, under the customers brought before them. */
export async function importZohoOrders(
  db: Database,
  orders: ZohoOrder[],
  apply: boolean,
): Promise<ZohoOrdersResult> {
  const said: ZohoOrdersResult = {
    orders: orders.length,
    made: 0,
    alreadyHere: 0,
    noCustomer: 0,
    drafts: 0,
    lines: 0,
    freeLines: 0,
  };
  if (orders.length === 0) return said;
  const have = new Set(
    (
      await rows<{ id: string }>(
        db,
        sql`select zoho_id as id from past_order where zoho_id in ${texts(orders.map((one) => one.id))}`,
      )
    ).map((row) => row.id),
  );
  const customerOf = new Map(
    (
      await rows<{ zohoId: string; customerId: number }>(
        db,
        sql`select zoho_id as "zohoId", customer_id::int as "customerId" from zoho_contact
          where zoho_id in ${texts([...new Set(orders.map((one) => one.customerId))])}`,
      )
    ).map((row) => [row.zohoId, row.customerId]),
  );

  const toMake: Record<string, unknown>[] = [];
  const items: Record<string, unknown>[] = [];
  for (const order of orders) {
    if (order.status.toLowerCase() === "draft") {
      said.drafts += 1;
      continue;
    }
    if (have.has(order.id)) {
      said.alreadyHere += 1;
      continue;
    }
    const customerId = customerOf.get(order.customerId);
    if (!customerId) {
      said.noCustomer += 1;
      continue;
    }
    have.add(order.id);
    said.made += 1;
    toMake.push({
      zohoId: order.id,
      code: order.code.trim(),
      customerId,
      day: order.date,
      status: order.status.toLowerCase(),
      total: Math.round(order.total * 100),
      seller: clip(order.seller, 160),
      division: clip(order.division, 80),
      source: clip(order.source, 120),
      invoicedFrom: clip(order.invoicedFrom, 120),
      reference: clip(order.reference, 120),
    });
    for (const line of order.lines) {
      const qty = Math.round(line.qty);
      if (!(qty > 0)) continue;
      const unitPrice = unitPriceOf(line, order);
      said.lines += 1;
      if (unitPrice === 0) said.freeLines += 1;
      items.push({
        line: items.length,
        zohoId: order.id,
        sku: clip(line.sku, 60),
        name: clip(line.name, 200) ?? "Unnamed",
        unit: clip(line.unit, 20),
        qty,
        unitPrice,
        free: unitPrice === 0,
      });
    }
  }
  if (!apply || toMake.length === 0) return said;

  await db.transaction(async (tx) => {
    await tx.execute(
      sql`insert into past_order (zoho_id, code, customer_id, ordered_on, status, total, seller, division, source, invoiced_from, reference)
        select x."zohoId", x.code, x."customerId", x.day::date, x.status, x.total, x.seller, x.division, x.source, x."invoicedFrom", x.reference
        from jsonb_to_recordset(${JSON.stringify(toMake)}::jsonb) as x("zohoId" text, code text, "customerId" bigint,
          day text, status text, total bigint, seller text, division text, source text, "invoicedFrom" text, reference text)`,
    );
    if (items.length)
      await tx.execute(
        sql`insert into past_order_item (past_order_id, sku, name, unit, qty, unit_price, free)
          select p.id, x.sku, x.name, x.unit, x.qty, x."unitPrice", x.free
          from jsonb_to_recordset(${JSON.stringify(items)}::jsonb) as x(line integer, "zohoId" text, sku text,
            name text, unit text, qty integer, "unitPrice" integer, free boolean)
          join past_order p on p.zoho_id = x."zohoId"
          order by x.line`,
      );
  });
  return said;
}
