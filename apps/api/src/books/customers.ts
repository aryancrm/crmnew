// Customers as Zoho Inventory lists them (docs/PLAN.md 17), one view per kind (hospitals, doctors,
// patients, drugstores, distributors, government) because each kind is a different customer:
// NAME, COMPANY NAME, EMAIL, WORK PHONE, RECEIVABLES. A customer shows what matters for its kind
// (a hospital's licence and terms, a doctor's specialty and hospital, a patient's details from
// their orders), every field Zoho kept, its people, and every document with it — Zoho's and the
// CRM's own.

import { type SQL, sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { allow, Refusal } from "../http";
import { COST_ROLES, todayManila } from "../inventory/rules";
import type { BookCustomer, BookCustomerList, BookCustomerRow, BookRow, Me } from "../types";
import { crmRows } from "./crm";

const KINDS = ["hospital", "doctor", "patient", "drugstore", "distributor", "government"];

/** What each customer owes and has unused, from Zoho's invoices and the CRM's, plus openings. */
const money = sql`(select customer_id, sum(owed)::bigint as owed, sum(unused)::bigint as unused from (
    select d.customer_id, round(d.balance * d.fx_rate) as owed, 0 as unused from book_doc d
      where d.kind = 'invoice' and d.balance > 0 and d.status not in ('void', 'draft') and d.customer_id is not null
    union all
    select d.customer_id, 0, round(d.balance * d.fx_rate) from book_doc d
      where d.kind in ('credit_note', 'customer_payment') and d.balance > 0 and d.status not in ('void', 'draft') and d.customer_id is not null
    union all
    select i.customer_id, greatest(0, i.total - i.paid), 0 from invoice i where i.status = 'open'
  ) m group by customer_id)`;

const rowSelect = sql`select c.id::int as id, c.name, c.kind, c.zoho_fields->>'Company Name' as company, c.email, c.phone, c.city,
    (c.opening_receivables + coalesce(m.owed, 0))::float8 as receivables, (c.opening_credits + coalesce(m.unused, 0))::float8 as credits, c.active
  from customer c left join ${money} m on m.customer_id = c.id`;

export async function customerList(db: Database, me: Me, asked: { view?: string; page?: number; perPage?: number; q?: string; sort?: string; dir?: string }): Promise<BookCustomerList> {
  allow(me, COST_ROLES, "see the customers' books");
  const counts = await rows<{ key: string; count: number }>(db, sql`select kind as key, count(*)::int as count from customer group by kind`);
  const view = asked.view && (KINDS.includes(asked.view) || ["owing", "inactive"].includes(asked.view)) ? asked.view : "all";
  const perPage = [10, 25, 50, 100, 200].includes(asked.perPage ?? 0) ? (asked.perPage as number) : 25;
  const page = Math.max(1, asked.page ?? 1);
  const q = asked.q?.trim();
  const where = sql.join(
    [
      KINDS.includes(view) ? sql`c.kind = ${view}` : view === "inactive" ? sql`not c.active` : sql`true`,
      view === "owing" ? sql`(c.opening_receivables + coalesce(m.owed, 0)) > 0` : sql`true`,
      q ? sql`(c.name ilike ${`%${q}%`} or c.email ilike ${`%${q}%`} or c.phone ilike ${`%${q}%`} or c.code ilike ${`%${q}%`})` : sql`true`,
    ],
    sql` and `,
  );
  const sorts: Record<string, SQL> = { name: sql`lower(c.name)`, receivables: sql`(c.opening_receivables + coalesce(m.owed, 0))`, city: sql`lower(c.city)` };
  const by = sorts[asked.sort ?? "name"] ?? sorts.name;
  const dir = asked.dir === "desc" ? sql`desc` : sql`asc`;
  const [owing] = await rows<{ n: number }>(db, sql`select count(*)::int as n from customer c join ${money} m on m.customer_id = c.id where m.owed > 0 or c.opening_receivables > 0`);
  const [count] = await rows<{ n: number }>(db, sql`select count(*)::int as n from customer c left join ${money} m on m.customer_id = c.id where ${where}`);
  const found = await rows<BookCustomerRow>(db, sql`${rowSelect} where ${where} order by ${by} ${dir} nulls last, c.id limit ${perPage} offset ${(page - 1) * perPage}`);
  const all = counts.reduce((sum, c) => sum + c.count, 0);
  return {
    views: [{ key: "all", count: all }, ...KINDS.map((key) => ({ key, count: counts.find((c) => c.key === key)?.count ?? 0 })), { key: "owing", count: owing?.n ?? 0 }],
    view,
    page,
    perPage,
    total: count?.n ?? 0,
    rows: found,
  };
}

/** Zoho's patient fields on a sales order, as a person reads them. */
const PATIENT_FIELDS: [string, string][] = [
  ["CF.PX Name", "Patient"],
  ["CF.PX Age", "Age"],
  ["CF.PX Sex", "Sex"],
  ["CF.PX Disease", "Disease"],
  ["CF.PX Type", "Type"],
  ["CF.PX Mobile", "Mobile"],
  ["CF.Doctor Name", "Doctor"],
  ["CF.Doctor Consultant", "Doctor consultant"],
  ["CF.Senior Citizen", "Senior citizen"],
  ["CF.Senior Citizen ID (URL)", "Senior citizen ID"],
  ["CF.Physically Disabled ID (URL)", "PWD ID"],
  ["CF.Prescription (URL)", "Prescription"],
  ["CF.Refill Required", "Refill required"],
  ["CF.Refill Date", "Refill date"],
  ["CF.Customer Group", "Customer group"],
  ["CF.MemberShip", "Membership"],
];

export async function customerDetail(db: Database, me: Me, id: number): Promise<BookCustomer> {
  allow(me, COST_ROLES, "see the customers' books");
  const today = todayManila();
  const [customer] = await rows<BookCustomer & { worksAtId: number | null }>(
    db,
    sql`select r.*, c.code, c.address, c.tin, c.licence_no as "licenceNo", to_char(c.licence_expires, 'YYYY-MM-DD') as "licenceExpires",
        c.permit_no as "permitNo", to_char(c.permit_expires, 'YYYY-MM-DD') as "permitExpires", c.payment_terms as "paymentTerms", c.payment_days as "paymentDays",
        c.credit_limit::float8 as "creditLimit", c.specialty, c.works_at::int as "worksAtId", a.name as area, c.note,
        to_char((c.created_at at time zone 'Asia/Manila')::date, 'YYYY-MM-DD') as "createdOn", c.zoho_fields as "zohoFields"
      from (${rowSelect} where c.id = ${id}) r join customer c on c.id = r.id left join area a on a.id = c.area_id`,
  );
  if (!customer) throw new Refusal(404, "not_found", "That customer is not on the list.");
  const { worksAtId, ...rest } = customer;
  const [worksAt, doctors, people, counts, zohoRecent, patientRow] = await Promise.all([
    worksAtId ? rows<{ id: number; name: string }>(db, sql`select id::int as id, name from customer where id = ${worksAtId}`) : Promise.resolve([]),
    customer.kind === "hospital"
      ? rows<BookCustomer["doctors"][number]>(db, sql`select id::int as id, name, specialty from customer where works_at = ${id} and kind = 'doctor' order by name limit 100`)
      : Promise.resolve([]),
    rows<BookCustomer["people"][number]>(db, sql`select id::int as id, name, email, phone, mobile, designation from customer_person where customer_id = ${id} order by name`),
    rows<BookCustomer["counts"][number]>(
      db,
      sql`select kind, count(*)::int as count, sum(round(total * fx_rate))::float8 as total from book_doc where customer_id = ${id} group by kind
        union all select 'sales_order', count(*)::int, coalesce(sum(total), 0)::float8 from sales_order where customer_id = ${id} having count(*) > 0
        union all select 'invoice', count(*)::int, coalesce(sum(total), 0)::float8 from invoice where customer_id = ${id} having count(*) > 0`,
    ),
    rows<BookRow & { kind: BookCustomer["recent"][number]["kind"] }>(
      db,
      sql`select d.id::int as id, d.kind, d.number, d.reference, to_char(d.doc_date, 'YYYY-MM-DD') as date, to_char(d.due_date, 'YYYY-MM-DD') as "dueDate",
          d.status, d.party_name as party, d.customer_id::int as "partyId", d.currency, d.total::float8 as total, d.balance::float8 as balance
        from book_doc d where d.customer_id = ${id} order by d.doc_date desc, d.id desc limit 40`,
    ),
    customer.kind === "patient" || customer.kind === "doctor"
      ? rows<{ fields: Record<string, string> }>(db, sql`select fields from book_doc where customer_id = ${id} and kind = 'sales_order' and fields ? 'CF.PX Name' order by doc_date desc limit 1`)
      : Promise.resolve([]),
  ]);
  // The CRM's own orders and invoices with them, newest first.
  const crmIds = await rows<{ id: number; kind: "sales_order" | "invoice" }>(
    db,
    sql`select r.id, r.kind from (
        select l.id, 'sales_order' as kind, l.date from (select -o.id::int as id, to_char(o.created_at, 'YYYY-MM-DD') as date from sales_order o where o.customer_id = ${id}) l
        union all select l.id, 'invoice', l.date from (select -i.id::int as id, to_char(i.issued_on, 'YYYY-MM-DD') as date from invoice i where i.customer_id = ${id}) l
      ) r order by r.date desc limit 20`,
  );
  const crm = [
    ...(await crmRows(db, "sales_order", crmIds.filter((r) => r.kind === "sales_order").map((r) => r.id), today)).map((row) => ({ ...row, kind: "sales_order" as const })),
    ...(await crmRows(db, "invoice", crmIds.filter((r) => r.kind === "invoice").map((r) => r.id), today)).map((row) => ({ ...row, kind: "invoice" as const })),
  ];
  const blank = { overdueDays: null, received: null, billed: null, linked: null, mode: null, unused: null, qty: null };
  const filled = (row: BookRow & { kind: BookCustomer["recent"][number]["kind"] }) => ({ ...blank, ...row });
  const recent = [...zohoRecent.map(filled), ...crm].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, 50);
  const fields = patientRow[0]?.fields ?? {};
  const patient = patientRow.length
    ? Object.fromEntries(PATIENT_FIELDS.filter(([key]) => fields[key] && fields[key] !== "false").map(([key, label]) => [label, String(fields[key])]))
    : null;
  return { ...rest, worksAt: worksAt[0] ?? null, doctors, people, counts, recent, patient };
}
