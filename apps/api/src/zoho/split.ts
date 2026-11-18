// Zoho contacts the customer import joined into one customer here although they are different
// buyers. The import (./import.ts) makes one customer per phone number and kind, so two Zoho
// contacts on one number became one customer even when their names have nothing in common: two
// pharmacies of one owner (LOS MEDICINAS PHARMACY and LUCKY 8 PHARMACY), a test contact typed on
// a real patient's number (Bea Ampaso and Test Shane). That undercounts customers and mixes their
// dues. This finds them by comparing the names each joined contact goes by, and splits a clear
// mismatch: the contacts that are someone else become a customer of their own and take their Zoho
// history with them (sales orders, invoices, payments, credit notes, returns, past orders, their
// people). Nothing is deleted; the customer kept and the new one each say in their note where the
// other went. scripts/split-zoho-contacts.ts runs it (dry run unless --apply).

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { formatPhone } from "../phone";
import type { CustomerKind } from "../types";
import { type ContactSeen, customerRecordOf, insertZohoCustomers, orderKind, zohoCustomerFrom } from "./import";

// ---------------------------------------------------------------- names

/** Words in front of a name that say nothing about who it is ("Mrs.", "Dr.", "Ma." for Maria,
 *  Zoho's "null" for an empty salutation). */
const TITLES = new Set(["mr", "mrs", "ms", "miss", "mx", "dr", "dra", "doc", "doctor", "atty", "engr", "sir", "maam", "madam", "mam", "ma", "null"]);
/** Words after a person's name that do not tell two people apart. */
const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv"]);
/** Words many business names share: what kind of business it is, not which one. */
const GENERIC = new Set(
  (
    "and the of de del la los las sa ng " +
    "pharmacy pharmacies pharma pharmas pharmaceutical pharmaceuticals pharmacia farmacia drug drugs drugstore drugstores botica botika " +
    "medical medicals med meds medicine medicines supply supplies equipment equipments product products " +
    "trading trader traders distribution distributions distributor distributors distributorship dist " +
    "marketing mktg general gen merchandise merchandising enterprise enterprises ent services service sales " +
    "inc incorporated corp corporation co company opc ltd limited group phils philippines phil ph international intl ventures " +
    "health healthcare hospital clinic center centre store"
  ).split(" "),
);
const TEST_WORDS = new Set(["test", "testing", "dummy"]);

/** A name's words, plain: no accents, case, punctuation, title in front or word typed twice in a
 *  row ("Mrs. Judith Judith Torres" → judith torres). Letters standing alone in a row are one word
 *  ("S.N.D", "E & J" → snd, ej); one letter alone is a middle initial and is left out. */
export function nameWords(name: string): string[] {
  const plain = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/^(mrs?|ms|dra?|atty|engr|ma)\.(?=[a-z])/, "$1 ")
    .replace(/&/g, " & ")
    .replace(/[.'’`\\]/g, "")
    .replace(/[^a-z0-9&]+/g, " ")
    .trim();
  const raw = plain.split(" ").filter(Boolean);
  // "E & J", "S N D": single letters (with an & between) are one word.
  const letter = (word: string | undefined) => word !== undefined && word.length === 1 && word !== "&";
  const words: string[] = [];
  for (let at = 0; at < raw.length; at++) {
    const word = raw[at] as string;
    if (word === "&") continue;
    let run = word;
    while (letter(word)) {
      if (letter(raw[at + 1])) {
        run += raw[at + 1];
        at += 1;
      } else if (raw[at + 1] === "&" && letter(raw[at + 2])) {
        run += raw[at + 2];
        at += 2;
      } else break;
    }
    words.push(run);
  }
  while (words.length > 1 && TITLES.has(words[0] as string)) words.shift();
  return words.filter((word, at) => word.length > 1 && word !== words[at - 1]);
}

/** A name says it is a test ("Test Shane", "Anshu test"). */
export const isTestName = (name: string) => nameWords(name).some((word) => TEST_WORDS.has(word));

/** The words that tell one buyer from another: no business words ("pharmacy", "inc"), no
 *  "test", no Jr./Sr. A name that is nothing but such words keeps them. */
function coreWords(name: string): string[] {
  const words = nameWords(name);
  const core = words.filter((word) => !GENERIC.has(word) && !TEST_WORDS.has(word) && !SUFFIXES.has(word));
  return core.length ? core : words.filter((word) => !TEST_WORDS.has(word));
}

/** Edit distance (letters added, dropped or changed). */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  let before = Array.from({ length: b.length + 1 }, (_, at) => at);
  for (let i = 1; i <= a.length; i++) {
    const now = [i];
    for (let j = 1; j <= b.length; j++)
      now[j] = Math.min((before[j] as number) + 1, (now[j - 1] as number) + 1, (before[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1));
    before = now;
  }
  return before[b.length] as number;
}

/** Two words are the same word: equal, one a short form of the other ("Mel", "Melchor"; "Tasha",
 *  "Natasha"; "Jacqui", "Jacqueline"; "BOBJOHN", "Bob"), one or two letters off ("Cabahug",
 *  "Cabahog"), or a short code with its letters swapped ("JLD", "JDL"). */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length >= 3 && (long.startsWith(short) || long.endsWith(short))) return true;
  let common = 0;
  while (common < short.length && short[common] === long[common]) common++;
  if (common >= 5 && common >= 0.7 * short.length) return true;
  if (a.length === b.length && a.length <= 5 && [...a].sort().join("") === [...b].sort().join("")) return true;
  if (short.length < 4) return false;
  return editDistance(a, b) <= (long.length >= 8 ? 2 : 1);
}

/** A "name" that is a phone number or an e-mail address says nothing either way. */
const noName = (name: string) => name.includes("@") || !/[a-z]/i.test(name);

export type NameVerdict = {
  /** same: one buyer, written differently; close: some words in common (maybe one buyer);
   *  different: nothing in common. */
  verdict: "same" | "close" | "different";
  /** How different, 0 (the same once titles, case and punctuation are set aside) to 100: same
   *  0–10, close 11–69, different 70–100. */
  score: number;
};

/** How alike two names are. */
export function compareNames(a: string, b: string): NameVerdict {
  const left = coreWords(a);
  const right = coreWords(b);
  if (!left.length || !right.length || noName(a) || noName(b)) return { verdict: "close", score: 50 };
  if (left.join(" ") === right.join(" ")) return { verdict: "same", score: 0 };
  // Each word of one name paired with at most one of the other's.
  const free = [...right];
  let matched = 0;
  for (const word of left) {
    const at = free.findIndex((other) => sameWord(word, other));
    if (at >= 0) {
      matched += 1;
      free.splice(at, 1);
    }
  }
  const fewer = Math.min(left.length, right.length);
  const glued = [left.join(""), right.join("")] as const;
  const letters = 1 - editDistance(...glued) / Math.max(glued[0].length, glued[1].length);
  if (matched === fewer) return { verdict: "same", score: matched === left.length && matched === right.length ? 5 : 10 };
  if (matched === 0 && letters < 0.6) return { verdict: "different", score: 70 + Math.round(30 * (1 - letters)) };
  return { verdict: "close", score: Math.max(11, Math.min(69, Math.round(100 * (1 - Math.max(matched / fewer, letters))))) };
}

// ---------------------------------------------------------------- which customers, what moves

/** What only Zoho's own files say (scripts/split-zoho-contacts.ts reads them). */
export type SplitSources = {
  /** Zoho's contact of each document, by `${kind}:${Zoho's id}`: the kinds of book_doc
   *  (sales_order, invoice, customer_payment, credit_note, sales_return, package, shipment), and
   *  `payment_share` for one payment's share on one invoice (past_payment's id) and `person` for a
   *  contact person. A document Zoho's files do not name keeps the contact its own fields name
   *  (customer_id), or the one whose name it carries. */
  docContact: Map<string, string>;
  /** Each contact's name in Zoho now (Zoho's contact list). */
  contactName: Map<string, string>;
  /** Contacts as Zoho lists them, in the columns of its Contacts backup: for a contact added after
   *  the backup, whose copy no customer here keeps. */
  contactRecord?: Map<string, Record<string, string>>;
};

/** Why the contacts that move are taken for someone else: different businesses or doctors, a test
 *  contact on a real customer, or different people on one phone (a patient's family, a carer). */
export type SplitKind = "business" | "test" | "people";

export type SplitContact = { zohoId: string; name: string; phone: string | null; seller: string | null; sellerOn: string | null };

/** One side of a split: the contacts and the Zoho history that is theirs. */
export type SplitSide = {
  contacts: SplitContact[];
  /** How many of each: Zoho's sales orders, invoices, payments, credit notes, returns, packages
   *  and shipments (the books), past orders, past invoices and past payments, contact persons. */
  counts: Record<string, number>;
  /** Zoho's invoices to them (not void or draft), and what is still owed on them, in centavos. */
  billed: number;
  owed: number;
  ids: { bookDocs: number[]; pastOrders: number[]; pastInvoices: number[]; pastPayments: number[]; people: number[] };
};

export type SplitMove = SplitSide & {
  kind: SplitKind;
  /** The least different pair of names between it and what stays (70–100). */
  score: number;
  /** The contact the new customer is made from (its Zoho id becomes the customer's). */
  main: string;
  /** The area the new customer goes to: the one its own Zoho salesperson's seat has, else the
   *  area of the customer it leaves (so the same desk still sees it). */
  areaId: number | null;
  areaFrom: "its salesperson" | "the customer it leaves";
};

export type SplitCase = {
  customerId: number;
  code: string;
  name: string;
  kind: string;
  areaId: number | null;
  /** The area of what stays, when its Zoho salesperson changes with the split (null: unchanged). */
  newAreaId: number | null;
  stays: SplitSide;
  moves: SplitMove[];
  /** Names on it that are alike only in part (kept together; for a look): [name, name, score]. */
  unsure: [string, string, number][];
  /** Documents no Zoho file ties to one of its contacts: they stay. */
  unknown: number;
  /** This CRM's own records on it (orders, bills, visits, calls…): they stay. */
  crmOwn: number;
  /** Links between what moves and what stays (a payment on an invoice, an invoice of an order):
   *  none expected; a case with any is not split until someone looks. */
  crossLinks: number;
  /** How the import joined them: the phones of the contacts, as Zoho has them. */
  phones: string[];
};

/** Every customer made of several Zoho contacts whose names differ (once titles, case and
 *  punctuation are set aside), with how different and what a split would move. */
export type SplitReport = {
  /** Customers made of two or more Zoho contacts. */
  joined: number;
  /** Of them, with names that differ, and the verdict on each. */
  listed: { customerId: number; code: string; name: string; kind: string; verdict: "same" | "close" | "different"; score: number; names: string[] }[];
  cases: SplitCase[];
};

type Contact = { zohoId: string; customerId: number; seller: string | null; sellerOn: string | null };
type Doc = { id: number; kind: string; zohoId: string | null; name: string | null; own: string | null; customerId: number; status: string; total: number; balance: number };
type Past = { id: number; zohoId: string; customerId: number; name?: string | null; parent?: number | null; source?: string | null; seller?: string | null; status?: string };
type Customer = { id: number; code: string; name: string; kind: string; zohoId: string | null; areaId: number | null; fields: Record<string, unknown> };

const ORDER = { same: 0, close: 1, different: 2 } as const;
const plain = (name: string) => nameWords(name).join(" ");

/** The copy of each Zoho contact a customer keeps (customerFields): its own record, and the
 *  records of the contacts joined to it under "Other Zoho records". */
function recordsOf(customer: Customer): Map<string, Record<string, string>> {
  const out = new Map<string, Record<string, string>>();
  const { "Other Zoho records": others, ...own } = customer.fields as Record<string, unknown> & { "Other Zoho records"?: Record<string, string>[] };
  if (customer.zohoId && Object.keys(own).length) out.set(customer.zohoId, { "Contact ID": customer.zohoId, ...(own as Record<string, string>) });
  for (const record of others ?? []) if (record["Contact ID"]) out.set(record["Contact ID"], record);
  return out;
}

/** The number the import knew a contact by. */
function numberOf(record: Record<string, string> | undefined): string | null {
  if (!record) return null;
  const pick = (key: string) => (record[key] ?? "").trim() || null;
  return pick("MobilePhone") ?? pick("CF.Contact Number") ?? pick("Phone");
}

export async function planSplits(db: Database, sources: SplitSources, only?: number[], step: (what: string) => void = () => {}): Promise<SplitReport> {
  const scope = only?.length
    ? sql`(select customer_id from zoho_contact where customer_id in (select jsonb_array_elements_text(${JSON.stringify(only.map(String))}::jsonb)::bigint) group by 1 having count(*) > 1)`
    : sql`(select customer_id from zoho_contact group by 1 having count(*) > 1)`;
  const timed = <T>(what: string, query: Promise<T>) => query.then((found) => (step(what), found));
  const [customers, contacts, docs, orders, invoices, payments, people, own, ties, links] = await Promise.all([
    timed("customers", rows<Customer>(
      db,
      sql`select id::int as id, code, name, kind, zoho_id as "zohoId", area_id::int as "areaId", zoho_fields as fields
        from customer where id in ${scope} order by id`,
    )),
    timed("contacts", rows<Contact>(
      db,
      sql`select zoho_id as "zohoId", customer_id::int as "customerId", seller, to_char(seller_on, 'YYYY-MM-DD') as "sellerOn"
        from zoho_contact where customer_id in ${scope} order by zoho_id`,
    )),
    timed("documents", rows<Doc>(
      db,
      sql`select id::int as id, kind, zoho_id as "zohoId", party_name as name, fields->>'customer_id' as own, customer_id::int as "customerId",
          status, round(total * fx_rate)::float8 as total, round(balance * fx_rate)::float8 as balance
        from book_doc where customer_id in ${scope}`,
    )),
    timed("past orders", rows<Past>(
      db,
      sql`select id::int as id, zoho_id as "zohoId", customer_id::int as "customerId", customer_name as name, source, seller, status
        from past_order where customer_id in ${scope}`,
    )),
    timed("past invoices", rows<Past>(db, sql`select id::int as id, zoho_id as "zohoId", customer_id::int as "customerId", past_order_id::int as parent from past_invoice where customer_id in ${scope}`)),
    timed("past payments", rows<Past>(db, sql`select id::int as id, zoho_id as "zohoId", customer_id::int as "customerId", past_invoice_id::int as parent from past_payment where customer_id in ${scope}`)),
    timed("people", rows<Past>(db, sql`select id::int as id, coalesce(zoho_id, '') as "zohoId", customer_id::int as "customerId" from customer_person where customer_id in ${scope}`)),
    timed("the CRM's own records", rows<{ customerId: number; n: number }>(
      db,
      sql`select customer_id::int as "customerId", count(*)::int as n from (
          select customer_id from sales_order union all select customer_id from invoice union all select customer_id from payment
          union all select customer_id from b2b_account union all select customer_id from account_call union all select customer_id from visit
          union all select customer_id from lead union all select customer_id from customer_file union all select customer_id from points_account
          union all select customer_id from complaint union all select customer_id from sample_move union all select customer_id from medicine_request_ask
          union all select customer_id from doctor_list union all select customer_id from clidp_listing union all select customer_id from mt_listing
        ) x where customer_id in ${scope} group by 1`,
    )),
    timed("salespeople", rows<{ name: string; areaId: number | null }>(db, sql`select z.name, s.area_id::int as "areaId" from zoho_seller z join seat s on s.id = z.seat_id`)),
    timed("links", rows<{ a: number; b: number }>(
      db,
      sql`select from_doc::int as a, to_doc::int as b from book_link
        where from_doc in (select id from book_doc where customer_id in ${scope}) or to_doc in (select id from book_doc where customer_id in ${scope})`,
    )),
  ]);
  step("read from the database");
  const areaOfSeller = new Map(ties.map((tie) => [tie.name, tie.areaId]));
  const ownOf = new Map(own.map((row) => [row.customerId, row.n]));
  const by = <T extends { customerId: number }>(list: T[]) => {
    const out = new Map<number, T[]>();
    for (const one of list) {
      const have = out.get(one.customerId);
      if (have) have.push(one);
      else out.set(one.customerId, [one]);
    }
    return out;
  };
  const [contactsOf, docsOf, ordersOf, invoicesOf, paymentsOf, peopleOf] = [by(contacts), by(docs), by(orders), by(invoices), by(payments), by(people)];
  const linksOf = new Map<number, number[]>();
  for (const link of links) {
    linksOf.set(link.a, [...(linksOf.get(link.a) ?? []), link.b]);
    linksOf.set(link.b, [...(linksOf.get(link.b) ?? []), link.a]);
  }

  const report: SplitReport = { joined: customers.length, listed: [], cases: [] };
  for (const customer of customers) {
    const mine = contactsOf.get(customer.id) ?? [];
    const ids = new Set(mine.map((one) => one.zohoId));
    const records = recordsOf(customer);
    const record = (id: string) => records.get(id) ?? sources.contactRecord?.get(id);
    // The names each contact goes by: in Zoho now, in its copy here, and on its documents.
    const aliases = new Map(mine.map((one) => [one.zohoId, new Set<string>()]));
    const nameOf = (id: string) => sources.contactName.get(id) ?? record(id)?.["Display Name"] ?? null;
    for (const one of mine) {
      const now = nameOf(one.zohoId);
      if (now) aliases.get(one.zohoId)?.add(now);
      const copy = record(one.zohoId)?.["Display Name"];
      if (copy) aliases.get(one.zohoId)?.add(copy);
    }
    // Whose each document is.
    const byPlainName = new Map<string, string | null>();
    for (const [id, names] of aliases)
      for (const name of names) byPlainName.set(plain(name), byPlainName.has(plain(name)) && byPlainName.get(plain(name)) !== id ? null : id);
    const ours = (id: string | null | undefined) => (id && ids.has(id) ? id : null);
    const named = (name: string | null | undefined) => (name ? (byPlainName.get(plain(name)) ?? null) : null);
    const docContact = new Map<number, string | null>();
    for (const doc of docsOf.get(customer.id) ?? [])
      docContact.set(doc.id, ours(doc.zohoId ? sources.docContact.get(`${doc.kind}:${doc.zohoId}`) : null) ?? ours(doc.own) ?? named(doc.name));
    const orderContact = new Map<number, string | null>();
    for (const order of ordersOf.get(customer.id) ?? []) orderContact.set(order.id, ours(sources.docContact.get(`sales_order:${order.zohoId}`)) ?? named(order.name));
    const invoiceContact = new Map<number, string | null>();
    for (const invoice of invoicesOf.get(customer.id) ?? [])
      invoiceContact.set(invoice.id, ours(sources.docContact.get(`invoice:${invoice.zohoId}`)) ?? (invoice.parent ? (orderContact.get(invoice.parent) ?? null) : null));
    const paymentContact = new Map<number, string | null>();
    for (const payment of paymentsOf.get(customer.id) ?? []) {
      const whole = payment.zohoId.startsWith("payment-") ? `customer_payment:${payment.zohoId.slice(8)}` : `payment_share:${payment.zohoId}`;
      paymentContact.set(payment.id, ours(sources.docContact.get(whole)) ?? (payment.parent ? (invoiceContact.get(payment.parent) ?? null) : null));
    }
    const personContact = new Map<number, string | null>();
    for (const person of peopleOf.get(customer.id) ?? [])
      personContact.set(person.id, ours(person.zohoId.includes(":") ? person.zohoId.split(":")[0] : sources.docContact.get(`person:${person.zohoId}`)));
    // Names on documents are names the contact went by too.
    for (const doc of docsOf.get(customer.id) ?? []) {
      const id = docContact.get(doc.id);
      if (id && doc.name) aliases.get(id)?.add(doc.name);
    }
    for (const order of ordersOf.get(customer.id) ?? []) {
      const id = orderContact.get(order.id);
      if (id && order.name) aliases.get(id)?.add(order.name);
    }

    // Every name on it, as written (spaces aside).
    const distinct = [...new Set([...aliases.values()].flatMap((names) => [...names].map((name) => name.replace(/\s+/g, " ").trim())))];
    if (distinct.length < 2) continue;

    // Contacts that go by the same name (any of theirs) are one buyer.
    const relation = (a: string, b: string) => {
      let best: NameVerdict = { verdict: "different", score: 100 };
      for (const x of aliases.get(a) ?? [])
        for (const y of aliases.get(b) ?? []) {
          const found = compareNames(x, y);
          if (ORDER[found.verdict] < ORDER[best.verdict] || (found.verdict === best.verdict && found.score < best.score)) best = found;
        }
      if (!(aliases.get(a)?.size && aliases.get(b)?.size)) best = { verdict: "close", score: 50 };
      return best;
    };
    const parent = new Map(mine.map((one) => [one.zohoId, one.zohoId]));
    const root = (id: string): string => {
      const up = parent.get(id) as string;
      return up === id ? id : root(up);
    };
    const pairs = new Map<string, NameVerdict>();
    for (const [at, a] of mine.entries())
      for (const b of mine.slice(at + 1)) {
        const found = relation(a.zohoId, b.zohoId);
        pairs.set(`${a.zohoId}|${b.zohoId}`, found);
        pairs.set(`${b.zohoId}|${a.zohoId}`, found);
        if (found.verdict === "same") parent.set(root(a.zohoId), root(b.zohoId));
      }
    const clusters = new Map<string, string[]>();
    for (const one of mine) clusters.set(root(one.zohoId), [...(clusters.get(root(one.zohoId)) ?? []), one.zohoId]);
    const between = (x: string[], y: string[]) => {
      let best: NameVerdict = { verdict: "different", score: 100 };
      for (const a of x)
        for (const b of y) {
          const found = pairs.get(`${a}|${b}`) as NameVerdict;
          if (ORDER[found.verdict] < ORDER[best.verdict] || (found.verdict === best.verdict && found.score < best.score)) best = found;
        }
      return best;
    };
    let worst: NameVerdict = { verdict: "same", score: 0 };
    for (const found of pairs.values()) if (ORDER[found.verdict] > ORDER[worst.verdict] || (found.verdict === worst.verdict && found.score > worst.score)) worst = found;
    const listedNames = distinct;
    if (clusters.size === 1) {
      // Names that differ only as one buyer's would: titles, spelling, a middle name.
      let most = 0;
      for (const [at, a] of distinct.entries()) for (const b of distinct.slice(at + 1)) most = Math.max(most, compareNames(a, b).score);
      report.listed.push({ customerId: customer.id, code: customer.code, name: customer.name, kind: customer.kind, verdict: "same", score: most, names: listedNames });
      continue;
    }
    report.listed.push({ customerId: customer.id, code: customer.code, name: customer.name, kind: customer.kind, verdict: worst.verdict, score: worst.score, names: listedNames });

    // What stays: the contact the customer was made from, and every contact alike in part.
    const home = customer.zohoId && ids.has(customer.zohoId) ? (clusters.get(root(customer.zohoId)) as string[]) : null;
    if (!home) continue;
    // (alike in part to anything that stays: it stays too)
    const stay = new Set(home);
    for (let grew = true; grew; ) {
      grew = false;
      for (const members of clusters.values())
        if (!stay.has(members[0] as string) && between(members, [...stay]).verdict !== "different") {
          for (const id of members) stay.add(id);
          grew = true;
        }
    }
    const leaving = [...clusters.values()].filter((members) => !stay.has(members[0] as string));
    const unsure: [string, string, number][] = [];
    for (const [at, a] of [...clusters.values()].entries())
      for (const b of [...clusters.values()].slice(at + 1)) {
        const found = between(a, b);
        if (found.verdict === "close") unsure.push([nameOf(a[0] as string) ?? "?", nameOf(b[0] as string) ?? "?", found.score]);
      }
    // Leaving contacts alike in part go together.
    const groups: string[][] = [];
    for (const members of leaving) {
      const with_ = groups.find((group) => between(group, members).verdict !== "different");
      if (with_) with_.push(...members);
      else groups.push([...members]);
    }
    const testOf = (members: string[]) => members.every((id) => isTestName(nameOf(id) ?? ""));
    const homeTest = testOf(home);

    const side = (members: Set<string>, keepUnknown: boolean): SplitSide => {
      const pick = (map: Map<number, string | null>) => [...map].filter(([, id]) => (id ? members.has(id) : keepUnknown)).map(([row]) => row);
      const bookDocs = pick(docContact);
      const counts: Record<string, number> = {};
      let billed = 0;
      let owed = 0;
      const docById = new Map((docsOf.get(customer.id) ?? []).map((doc) => [doc.id, doc]));
      for (const id of bookDocs) {
        const doc = docById.get(id) as Doc;
        counts[doc.kind] = (counts[doc.kind] ?? 0) + 1;
        if (doc.kind === "invoice" && doc.status !== "void" && doc.status !== "draft") {
          billed += doc.total;
          owed += doc.balance;
        }
      }
      const out = {
        bookDocs,
        pastOrders: pick(orderContact),
        pastInvoices: pick(invoiceContact),
        pastPayments: pick(paymentContact),
        people: pick(personContact),
      };
      if (out.pastOrders.length) counts.past_order = out.pastOrders.length;
      if (out.pastInvoices.length) counts.past_invoice = out.pastInvoices.length;
      if (out.pastPayments.length) counts.past_payment = out.pastPayments.length;
      if (out.people.length) counts.person = out.people.length;
      return {
        contacts: mine
          .filter((one) => members.has(one.zohoId))
          .map((one) => ({ zohoId: one.zohoId, name: nameOf(one.zohoId) ?? "?", phone: formatPhone(numberOf(record(one.zohoId))), seller: one.seller, sellerOn: one.sellerOn })),
        counts,
        billed,
        owed,
        ids: out,
      };
    };
    const latest = (list: SplitContact[]) => [...list].filter((one) => one.seller).sort((a, b) => (b.sellerOn ?? "").localeCompare(a.sellerOn ?? ""))[0]?.seller ?? null;
    const moves: SplitMove[] = [];
    for (const group of groups) {
      const test = testOf(group);
      if (homeTest && test) continue;
      const moved = side(new Set(group), false);
      // The new customer is made from the contact with the most history.
      const weight = (id: string) => [docContact, orderContact].reduce((sum, map) => sum + [...map.values()].filter((one) => one === id).length, 0);
      const main = [...group].sort((a, b) => weight(b) - weight(a) || a.localeCompare(b))[0] as string;
      const seller = latest(moved.contacts);
      const own = seller ? areaOfSeller.get(seller) : undefined;
      moves.push({
        ...moved,
        kind: test || homeTest ? "test" : customer.kind === "patient" ? "people" : "business",
        score: between(group, home).score,
        main,
        areaId: own ?? customer.areaId,
        areaFrom: own ? "its salesperson" : "the customer it leaves",
      });
    }
    if (!moves.length) continue;
    const leavingIds = new Set(moves.flatMap((move) => move.contacts.map((one) => one.zohoId)));
    const stays = side(new Set(mine.map((one) => one.zohoId).filter((id) => !leavingIds.has(id))), true);
    // Whose desk it is: the area of its latest Zoho salesperson's seat, when that is where it is now.
    const sellerBefore = latest(mine.map((one) => ({ zohoId: one.zohoId, name: "", phone: null, seller: one.seller, sellerOn: one.sellerOn })));
    const sellerAfter = latest(stays.contacts);
    const before = sellerBefore ? areaOfSeller.get(sellerBefore) : undefined;
    const after = sellerAfter ? areaOfSeller.get(sellerAfter) : undefined;
    const newAreaId = before && customer.areaId === before && after && after !== before ? after : null;
    // Links that would cross between the two.
    const movedDocs = new Set(moves.flatMap((move) => move.ids.bookDocs));
    const stayingDocs = new Set(stays.ids.bookDocs);
    let crossLinks = 0;
    for (const id of movedDocs) for (const other of linksOf.get(id) ?? []) if (stayingDocs.has(other)) crossLinks += 1;
    const movedOrders = new Set(moves.flatMap((move) => move.ids.pastOrders));
    const movedInvoices = new Set(moves.flatMap((move) => move.ids.pastInvoices));
    for (const invoice of invoicesOf.get(customer.id) ?? []) if (invoice.parent && movedOrders.has(invoice.parent) !== movedInvoices.has(invoice.id)) crossLinks += 1;
    const movedPayments = new Set(moves.flatMap((move) => move.ids.pastPayments));
    for (const payment of paymentsOf.get(customer.id) ?? []) if (payment.parent && movedInvoices.has(payment.parent) !== movedPayments.has(payment.id)) crossLinks += 1;
    const unknown = [docContact, orderContact, invoiceContact, paymentContact].reduce((sum, map) => sum + [...map.values()].filter((id) => !id).length, 0);
    report.cases.push({
      customerId: customer.id,
      code: customer.code,
      name: customer.name,
      kind: customer.kind,
      areaId: customer.areaId,
      newAreaId,
      stays,
      moves,
      unsure,
      unknown,
      crmOwn: ownOf.get(customer.id) ?? 0,
      crossLinks,
      phones: [...new Set(mine.map((one) => formatPhone(numberOf(record(one.zohoId)))).filter((phone): phone is string => Boolean(phone)))],
    });
  }
  report.cases.sort((a, b) => a.moves[0]!.kind.localeCompare(b.moves[0]!.kind) || b.stays.billed + b.moves[0]!.billed - (a.stays.billed + a.moves[0]!.billed));
  report.listed.sort((a, b) => b.score - a.score || a.customerId - b.customerId);
  return report;
}

// ---------------------------------------------------------------- the split

export type SplitDone = { customerId: number; made: { id: number; code: string; name: string; kind: string; contacts: number; moved: Record<string, number> }[]; skipped: string | null };

/** Splits one customer as planned: each group of contacts that moves becomes a customer of its own,
 *  made as the import would have made it from its main contact, in its area, with its Zoho history
 *  (documents, past orders, invoices and payments, contact persons, the copy of its Zoho record).
 *  Nothing is deleted. Done again it finds the contacts gone and does nothing. */
export async function applySplit(db: Database, plan: SplitCase, sources: SplitSources, admin: number, on: string): Promise<SplitDone> {
  const done: SplitDone = { customerId: plan.customerId, made: [], skipped: null };
  if (plan.crossLinks) return { ...done, skipped: "documents that move are linked to documents that stay" };
  return db.transaction(async (tx) => {
    const [customer] = await rows<Customer & { note: string | null }>(
      tx,
      sql`select id::int as id, code, name, kind, zoho_id as "zohoId", area_id::int as "areaId", zoho_fields as fields, note
        from customer where id = ${plan.customerId} for update`,
    );
    if (!customer) return { ...done, skipped: "no such customer" };
    const here = new Set(
      (await rows<{ id: string }>(tx, sql`select zoho_id as id from zoho_contact where customer_id = ${plan.customerId}`)).map((row) => row.id),
    );
    const records = recordsOf(customer);
    let others = ((customer.fields as { "Other Zoho records"?: Record<string, string>[] })["Other Zoho records"] ?? []).slice();
    const notes: string[] = [];
    for (const move of plan.moves) {
      const ids = move.contacts.map((one) => one.zohoId);
      if (!ids.every((id) => here.has(id))) continue;
      // The new customer, from its main contact as Zoho had it, and what its orders say it is.
      const record = records.get(move.main) ?? sources.contactRecord?.get(move.main) ?? { "Contact ID": move.main, "Display Name": move.contacts[0]?.name ?? "Unnamed" };
      const seen = await seenOf(tx, move);
      const made = (await insertZohoCustomers(tx, [customerRecordOf(zohoCustomerFrom(record, seen, false))], admin))[0];
      if (!made) throw new Error(`Customer ${plan.code}: a customer already holds Zoho contact ${move.main}.`);
      const names = move.contacts.map((one) => one.name).filter((name, at, all) => all.indexOf(name) === at);
      const { "Contact ID": _main, ...own } = records.get(move.main) ?? {};
      const theirs = others.filter((one) => ids.includes(one["Contact ID"] ?? "") && one["Contact ID"] !== move.main);
      others = others.filter((one) => !ids.includes(one["Contact ID"] ?? ""));
      const [row] = await rows<{ code: string; name: string; kind: string }>(
        tx,
        sql`update customer set area_id = ${move.areaId},
            zoho_fields = ${JSON.stringify({ ...own, ...(theirs.length ? { "Other Zoho records": theirs } : {}) })}::jsonb,
            note = ${`Split from ${plan.code} (${plan.name}) on ${on}: Zoho's ${names.join(" / ")} had been joined to it by a shared phone; its Zoho history came with it.`}
          where id = ${made.id} returning code, name, kind`,
      );
      const id = made.id;
      const keep = plan.customerId;
      const list = (values: number[]) => sql`(select jsonb_array_elements_text(${JSON.stringify(values.map(String))}::jsonb)::bigint)`;
      await tx.execute(sql`update zoho_contact set customer_id = ${id} where customer_id = ${keep} and zoho_id in (select jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))`);
      const moved: Record<string, number> = {};
      for (const [table, values] of [
        ["book_doc", move.ids.bookDocs],
        ["past_order", move.ids.pastOrders],
        ["past_invoice", move.ids.pastInvoices],
        ["past_payment", move.ids.pastPayments],
        ["customer_person", move.ids.people],
      ] as const) {
        if (!values.length) continue;
        const changed = await rows<{ id: number }>(
          tx,
          sql`update ${sql.raw(table)} set customer_id = ${id} where customer_id = ${keep} and id in ${list(values)} returning id::int as id`,
        );
        moved[table] = changed.length;
      }
      notes.push(`Zoho's ${names.join(" / ")} and its Zoho history moved to ${row?.code} on ${on}: a different buyer on the same phone.`);
      done.made.push({ id, code: row?.code ?? "", name: row?.name ?? "", kind: row?.kind ?? "", contacts: ids.length, moved });
    }
    if (!done.made.length) return { ...done, skipped: "already split" };
    const fields = { ...(customer.fields as Record<string, unknown>) };
    if (others.length) fields["Other Zoho records"] = others;
    else delete fields["Other Zoho records"];
    await tx.execute(
      sql`update customer set zoho_fields = ${JSON.stringify(fields)}::jsonb,
          note = ${[customer.note, ...notes].filter(Boolean).join("\n")},
          area_id = coalesce(${plan.newAreaId}::bigint, area_id)
        where id = ${plan.customerId}`,
    );
    return done;
  });
}

/** What a group's own Zoho orders say about it, as the import read them: the kind of buyer each
 *  order took it for, how it paid last, where its latest order went. */
async function seenOf(db: Pick<Database, "execute">, move: SplitMove): Promise<ContactSeen> {
  const seen: ContactSeen = { kinds: new Map<CustomerKind, number>(), terms: "", city: "", address: "", seller: "", sellerOn: "", division: "", subDivision: "", headquarter: "" };
  if (move.ids.pastOrders.length) {
    const orders = await rows<{ source: string | null; seller: string | null }>(
      db,
      sql`select source, seller from past_order where id in (select jsonb_array_elements_text(${JSON.stringify(move.ids.pastOrders.map(String))}::jsonb)::bigint)
        and status not in ('void', 'draft')`,
    );
    for (const order of orders) {
      const kind = orderKind(order.source, order.seller);
      if (kind) seen.kinds.set(kind, (seen.kinds.get(kind) ?? 0) + 1);
    }
  }
  if (move.ids.bookDocs.length) {
    const [last] = await rows<{ terms: string | null; label: string | null; city: string | null; address: string | null }>(
      db,
      sql`select fields->>'Payment Terms' as terms, fields->>'Payment Terms Label' as label,
          coalesce(nullif(fields->>'Shipping City', ''), fields->>'Billing City') as city,
          concat_ws(', ', nullif(fields->>'Shipping Address', ''), nullif(fields->>'Shipping Street2', '')) as address
        from book_doc where kind = 'sales_order' and status not in ('void', 'draft')
          and id in (select jsonb_array_elements_text(${JSON.stringify(move.ids.bookDocs.map(String))}::jsonb)::bigint)
        order by doc_date desc, id desc limit 1`,
    );
    if (last) {
      const days = Number((last.terms ?? "").replace(/,/g, "")) || 0;
      seen.terms = /cod/i.test(last.label ?? "") ? "COD" : days >= 7 ? `Net ${days}` : "Paid";
      seen.city = last.city ?? "";
      seen.address = last.address ?? "";
    }
  }
  return seen;
}
