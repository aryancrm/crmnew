// A department's page on the portal, before anyone signs in (Aryan, 18 Nov): what went well in its
// last 30 days, counted, and how its team is set up on the company chart. Only counts: no money, no
// customer and no person's name leaves without a login. Worked out at most every five minutes.

import { type SQL, sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { Refusal } from "../http";
import type { PortalDepartment, PortalTeamNode } from "../types";
import { companyKey } from "../companies/context";

export const PORTAL_DEPARTMENTS = [
  "sales",
  "leads",
  "heads",
  "management",
  "finance",
  "inventory",
  "dispatch",
  "online",
  "hr",
  "regulatory",
  "office",
  "ceo",
  "admin",
  "books",
] as const;
export type PortalKey = (typeof PORTAL_DEPARTMENTS)[number];

/** The seats (their module) each department's team is made of. */
const MODULES: Record<PortalKey, string[]> = {
  sales: ["manager", "team_lead", "medrep"],
  // The sales line's two doors (19 Nov): its team leads, its heads.
  leads: ["team_lead"],
  heads: ["manager"],
  management: ["management"],
  finance: ["finance"],
  books: ["finance"],
  inventory: ["inventory"],
  dispatch: ["dispatch"],
  online: ["online"],
  hr: ["hr"],
  regulatory: ["regulatory"],
  office: ["staff"],
  ceo: ["ceo"],
  admin: ["admin"],
};

const SINCE = sql`(now() - interval '30 days')`;
const SINCE_DAY = sql`((now() at time zone 'Asia/Manila')::date - 30)`;

type Stat = PortalDepartment["stats"][number];

/** A Zoho document of a kind, kept in the books, from the last 30 days (void and drafts never). */
const zoho = (kind: string, more: SQL = sql`true`) =>
  sql`(select count(*)::int from book_doc where kind = ${kind} and zoho_id is not null and status not in ('void', 'draft') and doc_date > ${SINCE_DAY} and ${more})`;
const crmOrders = (where: SQL) =>
  sql`(select count(*)::int from sales_order o where o.status <> 'cancelled' and ${where})`;
/** The median days between two linked Zoho documents (a shipment and its sales order). */
const zohoDays = (fromKind: string, toKind: string) =>
  sql`(select percentile_cont(0.5) within group (order by (a.doc_date - b.doc_date))::float8
      from book_link k join book_doc a on a.id = k.from_doc and a.kind = ${fromKind} and a.status not in ('void', 'draft')
        join book_doc b on b.id = k.to_doc and b.kind = ${toKind}
      where a.doc_date > ${SINCE_DAY} and a.zoho_id is not null)`;

/** Each department's good news, counted from the company's records: Bishnoi One's own and the
 *  Zoho history kept in the books (most of the work until the switch). Only what went well is
 *  shown here (Aryan, 18 Nov: "keep it positive"); what is late or short stays inside. */
function statsOf(key: PortalKey): [string, SQL, string, Stat["unit"]][] {
  const orders = sql`(${zoho("sales_order")} + ${crmOrders(sql`o.created_at > ${SINCE}`)})`;
  const invoices = sql`(${zoho("invoice")} + (select count(*)::int from invoice where status <> 'cancelled' and issued_on > ${SINCE_DAY}))`;
  const paid = sql`(${zoho("customer_payment")} + (select count(*)::int from payment where active and paid_on > ${SINCE_DAY}))`;
  const served = sql`(select count(distinct customer_id)::int from (
      select customer_id from book_doc where kind = 'invoice' and zoho_id is not null and status not in ('void', 'draft') and doc_date > ${SINCE_DAY}
      union select customer_id from invoice where status <> 'cancelled' and issued_on > ${SINCE_DAY}) c where customer_id is not null)`;
  const customers = sql`(select count(*)::int from customer where active)`;
  const teams = sql`(select count(*)::int from org_unit where active and kind <> 'company')`;
  switch (key) {
    case "sales":
      return [
        ["Orders taken", orders, "in the last 30 days", "count"],
        ["Customers served", served, "invoiced in 30 days", "count"],
        ["Sellers", sql`(select count(*)::int from person where active and role in ('medrep', 'team_lead', 'manager'))`, "in the field and on the phone", "count"],
      ];
    case "heads":
      return [
        ["Orders taken", orders, "in the last 30 days", "count"],
        ["Teams", sql`(select count(*)::int from seat where active and lead and module = 'team_lead')`, "each with its team lead", "count"],
        ["Sellers", sql`(select count(*)::int from person where active and role in ('medrep', 'team_lead', 'manager'))`, "in the field and on the phone", "count"],
      ];
    case "leads":
      return [
        ["Orders taken", orders, "in the last 30 days", "count"],
        ["Customers served", served, "invoiced in 30 days", "count"],
        ["Sellers", sql`(select count(*)::int from person where active and role = 'medrep')`, "in the teams", "count"],
      ];
    case "management":
      return [
        ["Orders approved", sql`(${zoho("sales_order", sql`status = 'confirmed'`)} + ${crmOrders(sql`o.approved_at > ${SINCE}`)})`, "in the last 30 days", "count"],
        ["Customers served", served, "invoiced in 30 days", "count"],
        ["Customers on file", customers, "checked and ready to order", "count"],
      ];
    case "finance":
      return [
        ["Invoices made", invoices, "in the last 30 days", "count"],
        ["Payments received", paid, "in the last 30 days", "count"],
        ["Suppliers paid", zoho("vendor_payment"), "payments in 30 days", "count"],
      ];
    case "books":
      return [
        ["Invoices", invoices, "in the last 30 days", "count"],
        ["Payments received", paid, "in the last 30 days", "count"],
        ["Journals posted", zoho("journal"), "in the last 30 days", "count"],
      ];
    case "inventory":
      return [
        ["Medicines", sql`(select count(*)::int from medicine where active)`, "in the catalogue", "count"],
        ["Deliveries received", sql`(${zoho("purchase_receive")} + (select count(*)::int from purchase where state = 'received' and received_at > ${SINCE}))`, "from suppliers, 30 days", "count"],
        ["Warehouses", sql`(select count(*)::int from warehouse where active)`, "stocked and tracked", "count"],
      ];
    case "dispatch":
      return [
        ["Orders packed", sql`(${zoho("package")} + ${crmOrders(sql`o.packed_at > ${SINCE}`)})`, "in the last 30 days", "count"],
        ["Orders shipped", sql`(${zoho("shipment")} + ${crmOrders(sql`o.shipped_at > ${SINCE}`)})`, "in the last 30 days", "count"],
        ["Order to shipment", zohoDays("shipment", "sales_order"), "median, in days", "days"],
      ];
    case "online":
      return [
        ["Enquiries answered", sql`(select count(*)::int from lead where created_at > ${SINCE})`, "in the last 30 days", "count"],
        ["Quotations sent", sql`(select count(*)::int from lead where quote_sent_at > ${SINCE})`, "in the last 30 days", "count"],
        ["Patients on file", sql`(select count(*)::int from customer where kind = 'patient' and active)`, "with their history", "count"],
      ];
    case "hr":
      return [
        ["People", sql`(select count(*)::int from person where active)`, "in the company", "count"],
        ["Teams", teams, "on the company chart", "count"],
        ["Days timed in", sql`(select count(*)::int from attendance where day > ${SINCE_DAY})`, "in the last 30 days", "count"],
      ];
    case "regulatory":
      return [
        ["Registrations", sql`(select count(*)::int from product_registration)`, "followed and renewed", "count"],
        ["In the pipeline", sql`(select count(*)::int from pipeline_product)`, "products being brought in", "count"],
        ["Complaints closed", sql`(select count(*)::int from complaint where status = 'closed')`, "each followed to the end", "count"],
      ];
    case "office":
      return [["Work logs written", sql`(select count(*)::int from work_log where day > ${SINCE_DAY})`, "in the last 30 days", "count"]];
    case "ceo":
      return [
        ["Orders taken", orders, "in the last 30 days", "count"],
        ["Invoices made", invoices, "in the last 30 days", "count"],
        ["Customers on file", customers, "hospitals, doctors, patients, trade", "count"],
      ];
    case "admin":
      return [
        ["People with a login", sql`(select count(*)::int from person where active)`, "each signs in as themself", "count"],
        ["Seats", sql`(select count(*)::int from seat where active)`, "on the company chart", "count"],
        ["Teams", teams, "and departments", "count"],
      ];
  }
}

/** The department's part of the company chart: the units its seats sit in (and the units above
 *  them, with their lead, up to the company), each with its lead and its seats by title. */
async function teamOf(db: Database, key: PortalKey): Promise<{ tree: PortalTeamNode | null; people: number }> {
  const modules = MODULES[key];
  const [units, seats] = await Promise.all([
    rows<{ id: number; name: string; kind: string; parent: number | null; sort: number }>(
      db,
      sql`select id::int as id, name, kind, parent_id::int as parent, sort from org_unit where active order by sort, id`,
    ),
    rows<{ unit: number; title: string; module: string; lead: boolean; held: number; sort: number }>(
      db,
      sql`select s.unit_id::int as unit, s.title, s.module, s.lead, s.sort,
          (select count(*) from seat_holder h where h.seat_id = s.id and h.ends_on is null and h.starts_on <= (now() at time zone 'Asia/Manila')::date)::int as held
        from seat s where s.active order by s.lead desc, s.sort, s.id`,
    ),
  ]);
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const company = units.find((unit) => unit.kind === "company");
  const ours = seats.filter((seat) => modules.includes(seat.module));
  if (!ours.length || !company) return { tree: null, people: 0 };
  // The CEO's page: the company and the head of each part of it.
  const topOnly = key === "ceo";
  const keep = new Set<number>();
  for (const seat of topOnly ? seats.filter((one) => one.lead) : ours) {
    let at = byId.get(seat.unit);
    if (topOnly && at && at.parent !== company.id && at.id !== company.id) continue;
    while (at) {
      keep.add(at.id);
      at = at.parent ? byId.get(at.parent) : undefined;
    }
  }
  // The CEO's page lists every part of the company, a head seat or not.
  if (topOnly) for (const unit of units) if (unit.parent === company.id) keep.add(unit.id);
  const node = (id: number): PortalTeamNode => {
    const unit = byId.get(id) as (typeof units)[number];
    const here = seats.filter((seat) => seat.unit === id);
    const lead = here.find((seat) => seat.lead) ?? null;
    // Its own seats of the department, alike ones together ("Finance Coachee × 4").
    const members = new Map<string, { title: string; module: string; seats: number; people: number }>();
    for (const seat of here.filter((one) => !one.lead && (topOnly ? one.module === "ceo" || one.module === "admin" : modules.includes(one.module)))) {
      const known = members.get(seat.title) ?? { title: seat.title, module: seat.module, seats: 0, people: 0 };
      known.seats += 1;
      known.people += Math.min(1, seat.held);
      members.set(seat.title, known);
    }
    const children = units
      .filter((child) => child.parent === id && keep.has(child.id))
      .map((child) => node(child.id))
      .filter((child) => topOnly || child.lead || child.members.length || child.children.length);
    return {
      unit: unit.kind === "company" ? "The company" : unit.name,
      kind: unit.kind,
      lead: lead ? { title: lead.title, module: lead.module, filled: lead.held > 0 } : null,
      members: [...members.values()],
      children: topOnly && unit.kind !== "company" ? [] : children,
    };
  };
  const [people] = await rows<{ n: number }>(
    db,
    sql`select count(distinct h.person_id)::int as n from seat s join seat_holder h on h.seat_id = s.id and h.ends_on is null
      where s.active and s.module in (${sql.join(
        (topOnly ? ["ceo", "admin", "manager", "management", "finance", "dispatch", "inventory", "online", "hr", "regulatory", "staff", "team_lead", "medrep"] : modules).map((one) => sql`${one}`),
        sql`, `,
      )})`,
  );
  return { tree: node(company.id), people: people?.n ?? 0 };
}

// Per company: one company's department page is never another's (companies/context.ts).
const kept = new Map<string, { at: number; data: PortalDepartment }>();
const FRESH_MS = 5 * 60_000;

export async function portalDepartment(db: Database, key: string): Promise<PortalDepartment> {
  if (!PORTAL_DEPARTMENTS.includes(key as PortalKey))
    throw new Refusal(404, "not_found", "No such department.");
  const one = key as PortalKey;
  const cached = kept.get(companyKey(one));
  if (cached && Date.now() - cached.at < FRESH_MS) return cached.data;
  const wanted = statsOf(one);
  const [values] = await rows<Record<string, number | null>>(
    db,
    sql`select ${sql.join(
      wanted.map(([, value], index) => sql`${value} as ${sql.raw(`s${index}`)}`),
      sql`, `,
    )}`,
  );
  const stats: Stat[] = wanted.map(([label, , hint, unit], index) => {
    const value = values?.[`s${index}`];
    return {
      label,
      hint,
      unit,
      value: unit === "count" ? Number(value ?? 0) : value === null || value === undefined ? null : Math.round(Number(value) * 10) / 10,
    };
  });
  const team = await teamOf(db, one);
  const data: PortalDepartment = {
    key: one,
    stats,
    team: team.tree,
    people: team.people,
    at: new Date().toISOString(),
  };
  kept.set(companyKey(one), { at: Date.now(), data });
  return data;
}
