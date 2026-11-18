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
  /** Zoho has a company name for it (a business typed without one is usually a person). */
  company: z.boolean().nullish(),
  /** The licence to operate: its number, what it is for ("Drugstore", "Hospital", "Drug
   *  Wholesaler") and the day it runs out (YYYY-MM-DD). */
  licenceNo: text(80),
  licenceType: text(80),
  licenceExpires: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
  /** Who holds the licence, and the day it was issued (Zoho's CF.License Owner / Issuance Date). */
  licenceOwner: text(120),
  licenceIssued: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
  /** The salesperson on their latest order ("HOS | Juan"), its day, and its Division,
   *  Sub-division and Headquarter. */
  seller: text(200),
  sellerOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
  division: text(120),
  subDivision: text(120),
  headquarter: text(120),
  /** Their number is shared by many different names in Zoho (an office line): it is kept, but
   *  says nothing about who they are. */
  sharedPhone: z.boolean().nullish(),
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
  /** The name the order was under in Zoho, the doctor who referred it, the patient it was for. */
  customerName: text(300),
  doctor: text(200),
  patient: text(200),
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

/** What a licence to operate is for. */
function licenceKind(type: string | null | undefined): CustomerKind | null {
  const said = (type ?? "").toLowerCase();
  if (!said.trim()) return null;
  if (/hospital|clinic/.test(said)) return "hospital";
  if (/wholesal|distribut|import|trader/.test(said)) return "distributor";
  if (/drug ?store|pharmac|retail/.test(said)) return "drugstore";
  return null;
}

/** The kind of customer a Zoho contact is here. Zoho only says business or individual (and
 *  thousands of its "businesses" are people), so the rest is read from the licence, the name and
 *  what their orders were. */
export function kindOf(
  contact: Pick<
    ZohoCustomer,
    "name" | "business" | "doctor" | "hint" | "company" | "licenceNo" | "licenceType"
  >,
): CustomerKind {
  const name = contact.name.trim();
  const person = contact.doctor || contact.hint === "doctor" || DOCTOR.test(name) ? "doctor" : "patient";
  if (!contact.business) return person;
  if (contact.hint === "government") return "government";
  const licensed = licenceKind(contact.licenceType);
  if (licensed) return licensed;
  if (HOSPITAL.test(name)) return "hospital";
  if (DRUGSTORE.test(name)) return "drugstore";
  if (GOVERNMENT.test(name)) return "government";
  if (contact.hint) return contact.hint === "patient" ? person : contact.hint;
  // A "business" with no company name, no licence and no business order is a person.
  if (contact.company === false && !contact.licenceNo) return person;
  return "distributor";
}

/** What an order says its buyer is: Zoho's "Source", else the salesperson's channel. */
const SOURCE_KIND: Record<string, CustomerKind> = {
  "Hospital PO": "hospital",
  "Bidding Order": "government",
  "Doctor order": "doctor",
  "Distributor order": "distributor",
  "Patient order referred by doctor": "patient",
  "Patient order referred by patient": "patient",
  "B2C Order": "patient",
  DSWD: "patient",
  PCSO: "patient",
  "Office of the President": "patient",
};
const CHANNEL_KIND: Record<string, CustomerKind> = {
  HOS: "hospital",
  BID: "government",
  B2B: "distributor",
  MT: "distributor",
  B2C: "patient",
  TeleSales: "patient",
};
export function orderKind(source: string | null | undefined, seller: string | null | undefined): CustomerKind | undefined {
  const said = seller ?? "";
  return SOURCE_KIND[source ?? ""] ?? CHANNEL_KIND[said.includes("|") ? (said.split("|")[0] ?? "").trim() : ""];
}

/** What a contact's orders in Zoho say about them: what kind of buyer each order took them for,
 *  how they paid last, where it went, and whose customer they were. */
export type ContactSeen = {
  kinds: Map<CustomerKind, number>;
  terms: string;
  city: string;
  address: string;
  seller: string;
  sellerOn: string;
  division: string;
  subDivision: string;
  headquarter: string;
};

const said = (value: string | undefined) => (value ?? "").trim();
const cut = (value: string, max: number) => (value.length > max ? value.slice(0, max) : value) || null;
const isDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

/** A Zoho contact as the customer import takes it: a row of Zoho's Contacts backup (or the copy of
 *  it a customer here keeps in zoho_fields), with what its orders say. */
export function zohoCustomerFrom(row: Record<string, string>, seen: ContactSeen | undefined, sharedPhone: boolean): ZohoCustomer {
  const hint = seen ? [...seen.kinds].sort((a, b) => b[1] - a[1])[0]?.[0] : undefined;
  const created = said(row["Created Time"]);
  const expires = said(row["CF.License Expiry Date"]);
  const issued = said(row["CF.License Issuance Date"]);
  return {
    id: said(row["Contact ID"]),
    name: (said(row["Display Name"]) || said(row["Contact Name"]) || said(row["Company Name"]) || "Unnamed").slice(0, 300),
    business: said(row["Customer Sub Type"]) === "business",
    doctor: said(row["CF.Is Doctor"]) === "true",
    hint: hint ?? null,
    phone: cut(said(row.Phone), 80),
    mobile: cut(said(row.MobilePhone) || said(row["CF.Contact Number"]), 80),
    email: cut(said(row.EmailID), 200),
    address: cut(
      [said(row["Billing Address"]), said(row["Billing Street2"])].filter(Boolean).join(", ") || (seen?.address ?? ""),
      600,
    ),
    city: cut(said(row["Billing City"]) || said(row["Shipping City"]) || (seen?.city ?? ""), 120),
    tin: cut(said(row["CF.TIN"]), 60),
    terms: seen?.terms || "Paid",
    createdAt: /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(created) ? `${created.replace(" ", "T")}+08:00` : null,
    company: Boolean(said(row["Company Name"])),
    licenceNo: cut(said(row["CF.LTO License Number"]), 80),
    licenceType: cut(said(row["CF.LTO Type"]), 80),
    licenceExpires: isDay(expires) ? expires : null,
    licenceOwner: cut(said(row["CF.License Owner"]), 120),
    licenceIssued: isDay(issued) ? issued : null,
    seller: cut(seen?.seller ?? "", 200),
    sellerOn: seen && isDay(seen.sellerOn) ? seen.sellerOn : null,
    division: cut(seen?.division ?? "", 120),
    subDivision: cut(seen?.subDivision ?? "", 120),
    headquarter: cut(seen?.headquarter ?? "", 120),
    sharedPhone,
  };
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

/** A number that says who someone is: not a placeholder (0000000000, 1234567890) and not a line
 *  many different names share. */
export function identityPhone(number: string | null | undefined, shared?: boolean | null): string | null {
  const key = phoneKey(number);
  if (!key || shared) return null;
  if (/^(\d)\1+$/.test(key) || /0123456789|1234567890|9876543210/.test(key)) return null;
  return key;
}

export type CustomerRecord = ReturnType<typeof customerRecordOf>;

/** The customer a Zoho contact is here, as the import makes it. */
export function customerRecordOf(one: ZohoCustomer) {
  const kind = kindOf(one);
  const number = clip(one.mobile, 40) ?? clip(one.phone, 40);
  const { terms, days } = termsOf(one.terms);
  const made = one.createdAt ? new Date(one.createdAt) : null;
  return {
    zohoId: one.id,
    kind,
    name: clip(one.name, 160) as string,
    phone: formatPhone(number)?.slice(0, 40) ?? null,
    phoneKey: phoneKey(number),
    email: clip(one.email, 120),
    address: clip(one.address, 300),
    city: clip(one.city, 80),
    tin: clip(one.tin, 40),
    licenceNo: kind === "patient" ? null : clip(one.licenceNo, 60),
    licenceExpires: kind === "patient" ? null : (one.licenceExpires ?? null),
    licenceOwner: kind === "patient" ? null : clip(one.licenceOwner, 120),
    ltoType: kind === "patient" ? null : clip(one.licenceType, 80),
    licenceIssued: kind === "patient" ? null : (one.licenceIssued ?? null),
    terms,
    days,
    createdAt: made && !Number.isNaN(made.getTime()) ? made.toISOString() : null,
  };
}

/** Writes new customers made from Zoho contacts (each with its CUS- code); a contact already a
 *  customer here is left as it is. */
export async function insertZohoCustomers(
  tx: Pick<Database, "execute">,
  toMake: CustomerRecord[],
  admin: number,
): Promise<{ id: number; zohoId: string }[]> {
  if (!toMake.length) return [];
  const made = await rows<{ id: number; zohoId: string }>(
    tx,
    sql`insert into customer (kind, name, phone, phone_key, email, address, city, tin,
        licence_no, licence_expires, licence_owner, lto_type, licence_issued,
        payment_terms, payment_days, review, added_by, created_at, zoho_id)
      select x.kind, x.name, x.phone, x."phoneKey", x.email, x.address, x.city, x.tin,
        x."licenceNo", x."licenceExpires"::date, x."licenceOwner", x."ltoType", x."licenceIssued"::date,
        x.terms, x.days, 'ok', ${admin}, coalesce(x."createdAt"::timestamptz, now()), x."zohoId"
      from jsonb_to_recordset(${JSON.stringify(toMake)}::jsonb) as x(kind text, name text, phone text,
        "phoneKey" text, email text, address text, city text, tin text,
        "licenceNo" text, "licenceExpires" text, "licenceOwner" text, "ltoType" text,
        "licenceIssued" text, terms text, days integer, "createdAt" text, "zohoId" text)
      on conflict do nothing
      returning id::int as id, zoho_id as "zohoId"`,
  );
  if (made.length)
    await tx.execute(
      sql`update customer set code = 'CUS-' || lpad(id::text, 5, '0')
        where code is null and zoho_id in ${texts(made.map((row) => row.zohoId))}`,
    );
  return made;
}

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

/** Brings Zoho's customers over, once each. As everywhere in this CRM a customer is known by
 *  their phone number: the same number and kind is one customer (a second Zoho contact of the
 *  same buyer joins the first), and a hospital, doctor or business is one customer per name and
 *  city. Each contact keeps whose customer it was in Zoho. */
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
  const known: Record<string, unknown>[] = [];
  for (const one of customers) {
    if (linked.has(one.id)) {
      said.alreadyHere += 1;
      // Brought before: what Zoho knows now fills only what the customer here is missing, so
      // nothing typed in this CRM is overwritten.
      const number = clip(one.mobile, 40) ?? clip(one.phone, 40);
      known.push({
        zohoId: one.id,
        phone: formatPhone(number)?.slice(0, 40) ?? null,
        phoneKey: phoneKey(number),
        email: clip(one.email, 120),
        address: clip(one.address, 300),
        city: clip(one.city, 80),
        tin: clip(one.tin, 40),
        licenceNo: clip(one.licenceNo, 60),
        licenceExpires: one.licenceExpires ?? null,
        licenceOwner: clip(one.licenceOwner, 120),
        ltoType: clip(one.licenceType, 80),
        licenceIssued: one.licenceIssued ?? null,
      });
    } else if (seenIds.has(one.id)) said.skipped += 1;
    else {
      seenIds.add(one.id);
      fresh.push(one);
    }
  }

  // Customers already here under the same names. (No area is given: Zoho does not say whose
  // customer it is, and a city alone would put a hospital under the wrong channel.)
  const names = [...new Set(fresh.map((one) => (clip(one.name, 160) ?? "").toLowerCase()))];
  const numbers = [
    ...new Set(
      fresh
        .map((one) => identityPhone(clip(one.mobile, 40) ?? clip(one.phone, 40), one.sharedPhone))
        .filter((key): key is string => Boolean(key)),
    ),
  ];
  const here = await rows<{ id: number; kind: string; name: string; city: string; phoneKey: string | null }>(
    db,
    sql`select id::int as id, kind, lower(name) as name, lower(coalesce(city, '')) as city, phone_key as "phoneKey"
      from customer where lower(name) in ${texts(names)} or phone_key in ${texts(numbers)} order by id`,
  );
  // A customer here, or one about to be made from this batch (its Zoho id, until it has an id).
  type Target = number | string;
  const byPlace = new Map<string, Target>();
  const byPhone = new Map<string, Target>();
  for (const row of here) {
    const place = `${row.kind}|${row.name}|${row.city}`;
    if (row.kind !== "patient" && !byPlace.has(place)) byPlace.set(place, row.id);
    const phone = `${row.kind}|${row.phoneKey}`;
    if (row.phoneKey && !byPhone.has(phone)) byPhone.set(phone, row.id);
  }
  const toMake: CustomerRecord[] = [];
  const links: { zohoId: string; target: Target }[] = [];
  const sellerOf = new Map(customers.map((one) => [one.id, one]));
  for (const one of fresh) {
    const name = clip(one.name, 160) as string;
    if (!name) {
      said.skipped += 1;
      continue;
    }
    const kind = kindOf(one);
    const city = clip(one.city, 80);
    const number = clip(one.mobile, 40) ?? clip(one.phone, 40);
    const identity = identityPhone(number, one.sharedPhone);
    const place = `${kind}|${name.toLowerCase()}|${(city ?? "").toLowerCase()}`;
    const phone = `${kind}|${identity}`;
    const target = (identity ? byPhone.get(phone) : undefined) ?? (kind !== "patient" ? byPlace.get(place) : undefined);
    if (target !== undefined) {
      said.joined += 1;
      links.push({ zohoId: one.id, target });
      continue;
    }
    said.made += 1;
    said.byKind[kind] = (said.byKind[kind] ?? 0) + 1;
    if (kind !== "patient") byPlace.set(place, one.id);
    if (identity) byPhone.set(phone, one.id);
    links.push({ zohoId: one.id, target: one.id });
    toMake.push(customerRecordOf(one));
  }
  if (!apply) return said;

  await db.transaction(async (tx) => {
    if (known.length)
      await tx.execute(
        sql`update customer c set phone = coalesce(c.phone, x.phone), phone_key = coalesce(c.phone_key, x."phoneKey"),
            email = coalesce(c.email, x.email), address = coalesce(c.address, x.address), city = coalesce(c.city, x.city),
            tin = coalesce(c.tin, x.tin),
            licence_no = case when c.kind = 'patient' then c.licence_no else coalesce(c.licence_no, x."licenceNo") end,
            licence_expires = case when c.kind = 'patient' then c.licence_expires else coalesce(c.licence_expires, x."licenceExpires"::date) end,
            licence_owner = case when c.kind = 'patient' then c.licence_owner else coalesce(c.licence_owner, x."licenceOwner") end,
            lto_type = case when c.kind = 'patient' then c.lto_type else coalesce(c.lto_type, x."ltoType") end,
            licence_issued = case when c.kind = 'patient' then c.licence_issued else coalesce(c.licence_issued, x."licenceIssued"::date) end
          from jsonb_to_recordset(${JSON.stringify(known)}::jsonb) as x("zohoId" text, phone text, "phoneKey" text, email text,
            address text, city text, tin text, "licenceNo" text, "licenceExpires" text, "licenceOwner" text,
            "ltoType" text, "licenceIssued" text)
          where c.zoho_id = x."zohoId"`,
      );
    const made = await insertZohoCustomers(tx, toMake, admin);
    const idOf = new Map(made.map((row) => [row.zohoId, row.id]));
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
    // Whose customer each contact was in Zoho (new ones, and the latest for those brought before).
    const sellers = customers
      .filter((one) => one.seller || one.division || one.subDivision || one.headquarter)
      .map((one) => ({
        zohoId: one.id,
        seller: clip(sellerOf.get(one.id)?.seller, 160),
        sellerOn: one.sellerOn ?? null,
        division: clip(one.division, 80),
        subDivision: clip(one.subDivision, 80),
        headquarter: clip(one.headquarter, 80),
      }));
    if (sellers.length)
      await tx.execute(
        sql`update zoho_contact z set seller = x.seller, seller_on = x."sellerOn"::date, division = x.division,
            sub_division = x."subDivision", headquarter = x.headquarter
          from jsonb_to_recordset(${JSON.stringify(sellers)}::jsonb) as x("zohoId" text, seller text, "sellerOn" text,
            division text, "subDivision" text, headquarter text)
          where z.zoho_id = x."zohoId"`,
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
  const known: { zohoId: string; status: string; total: number }[] = [];
  for (const order of orders) {
    if (order.status.toLowerCase() === "draft") {
      said.drafts += 1;
      continue;
    }
    if (have.has(order.id)) {
      said.alreadyHere += 1;
      // Brought before: where it stands now in Zoho (invoiced since, or void).
      known.push({ zohoId: order.id, status: order.status.toLowerCase(), total: Math.round(order.total * 100) });
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
      customerName: clip(order.customerName, 160),
      doctor: clip(order.doctor && !/^n\/?a$/i.test(order.doctor.trim()) ? order.doctor : null, 120),
      patient: clip(order.patient, 120),
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
  if (!apply || (toMake.length === 0 && known.length === 0)) return said;

  await db.transaction(async (tx) => {
    if (known.length)
      await tx.execute(
        sql`update past_order p set status = x.status, total = x.total
          from jsonb_to_recordset(${JSON.stringify(known)}::jsonb) as x("zohoId" text, status text, total bigint)
          where p.zoho_id = x."zohoId" and (p.status <> x.status or p.total <> x.total)`,
      );
    if (toMake.length === 0) return;
    await tx.execute(
      sql`insert into past_order (zoho_id, code, customer_id, ordered_on, status, total, seller, division, source, invoiced_from, reference,
          customer_name, doctor, patient)
        select x."zohoId", x.code, x."customerId", x.day::date, x.status, x.total, x.seller, x.division, x.source, x."invoicedFrom", x.reference,
          x."customerName", x.doctor, x.patient
        from jsonb_to_recordset(${JSON.stringify(toMake)}::jsonb) as x("zohoId" text, code text, "customerId" bigint,
          day text, status text, total bigint, seller text, division text, source text, "invoicedFrom" text, reference text,
          "customerName" text, doctor text, patient text)`,
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

// ---------------------------------------------------------------- invoices and payments

export const zohoInvoice = z.object({
  /** Zoho's invoice id. */
  id: z.string().min(1).max(40),
  code: z.string().min(1).max(60),
  customerId: z.string().min(1).max(40),
  /** The sales order it bills (SO-67227). */
  orderCode: text(60),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dueOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
  status: z.string().min(1).max(40),
  /** Pesos. */
  total: z.number().min(0),
  balance: z.number().min(0),
  terms: text(120),
  seller: text(200),
  invoicedFrom: text(200),
});
export type ZohoInvoice = z.infer<typeof zohoInvoice>;

export const zohoPayment = z.object({
  /** Zoho's id for this payment's share on one invoice. */
  id: z.string().min(1).max(60),
  paymentNo: text(60),
  customerId: z.string().min(1).max(40),
  invoiceCode: text(60),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mode: text(80),
  reference: text(200),
  /** Pesos put on this invoice, and the whole payment. */
  amount: z.number().min(0),
  paymentTotal: z.number().min(0),
});
export type ZohoPayment = z.infer<typeof zohoPayment>;

export type ZohoInvoicesResult = {
  invoices: number;
  made: number;
  /** Brought before: their status and balance brought up to date. */
  updated: number;
  noCustomer: number;
  /** Still owed on them, in pesos (void and draft left out). */
  owed: number;
};

/** Zoho's invoices, once each; a rerun brings each one's latest status and balance. */
export async function importZohoInvoices(
  db: Database,
  invoices: ZohoInvoice[],
  apply: boolean,
): Promise<ZohoInvoicesResult> {
  const said: ZohoInvoicesResult = { invoices: invoices.length, made: 0, updated: 0, noCustomer: 0, owed: 0 };
  if (invoices.length === 0) return said;
  const customerOf = new Map(
    (
      await rows<{ zohoId: string; customerId: number }>(
        db,
        sql`select zoho_id as "zohoId", customer_id::int as "customerId" from zoho_contact
          where zoho_id in ${texts([...new Set(invoices.map((one) => one.customerId))])}`,
      )
    ).map((row) => [row.zohoId, row.customerId]),
  );
  const have = new Set(
    (
      await rows<{ id: string }>(
        db,
        sql`select zoho_id as id from past_invoice where zoho_id in ${texts(invoices.map((one) => one.id))}`,
      )
    ).map((row) => row.id),
  );
  const list: Record<string, unknown>[] = [];
  for (const invoice of invoices) {
    const customerId = customerOf.get(invoice.customerId);
    if (!customerId) {
      said.noCustomer += 1;
      continue;
    }
    const status = invoice.status.toLowerCase();
    if (status !== "void" && status !== "draft") said.owed += invoice.balance;
    if (have.has(invoice.id)) said.updated += 1;
    else said.made += 1;
    list.push({
      zohoId: invoice.id,
      code: invoice.code.trim(),
      customerId,
      orderCode: clip(invoice.orderCode, 60),
      day: invoice.date,
      dueOn: invoice.dueOn ?? null,
      status,
      total: Math.round(invoice.total * 100),
      balance: Math.round(invoice.balance * 100),
      terms: clip(invoice.terms, 80),
      seller: clip(invoice.seller, 160),
      invoicedFrom: clip(invoice.invoicedFrom, 120),
    });
  }
  said.owed = Math.round(said.owed * 100) / 100;
  if (!apply || list.length === 0) return said;
  await db.execute(
    sql`insert into past_invoice (zoho_id, code, customer_id, past_order_id, order_code, issued_on, due_on, status, total, balance, terms, seller, invoiced_from)
      select x."zohoId", x.code, x."customerId",
        (select p.id from past_order p where p.code = x."orderCode" and p.customer_id = x."customerId" order by p.id limit 1),
        x."orderCode", x.day::date, x."dueOn"::date, x.status, x.total, x.balance, x.terms, x.seller, x."invoicedFrom"
      from jsonb_to_recordset(${JSON.stringify(list)}::jsonb) as x("zohoId" text, code text, "customerId" bigint,
        "orderCode" text, day text, "dueOn" text, status text, total bigint, balance bigint, terms text, seller text, "invoicedFrom" text)
      on conflict (zoho_id) do update set status = excluded.status, total = excluded.total, balance = excluded.balance,
        due_on = excluded.due_on, past_order_id = coalesce(past_invoice.past_order_id, excluded.past_order_id)`,
  );
  return said;
}

export type ZohoPaymentsResult = { payments: number; made: number; alreadyHere: number; noCustomer: number };

/** Zoho's payments, once each (a payment does not change). */
export async function importZohoPayments(
  db: Database,
  payments: ZohoPayment[],
  apply: boolean,
): Promise<ZohoPaymentsResult> {
  const said: ZohoPaymentsResult = { payments: payments.length, made: 0, alreadyHere: 0, noCustomer: 0 };
  if (payments.length === 0) return said;
  const customerOf = new Map(
    (
      await rows<{ zohoId: string; customerId: number }>(
        db,
        sql`select zoho_id as "zohoId", customer_id::int as "customerId" from zoho_contact
          where zoho_id in ${texts([...new Set(payments.map((one) => one.customerId))])}`,
      )
    ).map((row) => [row.zohoId, row.customerId]),
  );
  const have = new Set(
    (
      await rows<{ id: string }>(
        db,
        sql`select zoho_id as id from past_payment where zoho_id in ${texts(payments.map((one) => one.id))}`,
      )
    ).map((row) => row.id),
  );
  const list: Record<string, unknown>[] = [];
  for (const payment of payments) {
    if (have.has(payment.id)) {
      said.alreadyHere += 1;
      continue;
    }
    const customerId = customerOf.get(payment.customerId);
    if (!customerId) {
      said.noCustomer += 1;
      continue;
    }
    have.add(payment.id);
    said.made += 1;
    list.push({
      zohoId: payment.id,
      paymentNo: clip(payment.paymentNo, 60),
      customerId,
      invoiceCode: clip(payment.invoiceCode, 60),
      day: payment.date,
      mode: clip(payment.mode, 60),
      reference: clip(payment.reference, 160),
      amount: Math.round(payment.amount * 100),
      paymentTotal: Math.round(payment.paymentTotal * 100),
    });
  }
  if (!apply || list.length === 0) return said;
  await db.execute(
    sql`insert into past_payment (zoho_id, payment_no, customer_id, past_invoice_id, invoice_code, paid_on, mode, reference, amount, payment_total)
      select x."zohoId", x."paymentNo", x."customerId",
        (select v.id from past_invoice v where v.code = x."invoiceCode" and v.customer_id = x."customerId" order by v.id limit 1),
        x."invoiceCode", x.day::date, x.mode, x.reference, x.amount, x."paymentTotal"
      from jsonb_to_recordset(${JSON.stringify(list)}::jsonb) as x("zohoId" text, "paymentNo" text, "customerId" bigint,
        "invoiceCode" text, day text, mode text, reference text, amount bigint, "paymentTotal" bigint)
      on conflict (zoho_id) do nothing`,
  );
  return said;
}
