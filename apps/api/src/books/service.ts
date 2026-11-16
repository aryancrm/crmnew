// The books' screens (docs/PLAN.md 17): each kind's list as Zoho Inventory lists it (its views,
// its columns, 25 to a page, newest first) and one document with everything it holds: its lines
// and batches, every field Zoho kept, the vendor, and the documents it hangs together with.

import { type SQL, sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { allow, Refusal } from "../http";
import { COST_ROLES } from "../inventory/rules";
import { todayManila } from "../inventory/rules";
import type { BookDoc, BookKind, BookLine, BookLinked, BookList, BookRow, Me, VendorDetail, VendorList, VendorRow } from "../types";

export const PURCHASE_KINDS: BookKind[] = ["purchase_order", "purchase_receive", "bill", "vendor_payment", "vendor_credit"];
export const SALES_KINDS: BookKind[] = ["sales_order", "invoice", "customer_payment", "sales_return", "credit_note"];
const ALL_KINDS: BookKind[] = [...PURCHASE_KINDS, ...SALES_KINDS, "package", "shipment", "transfer_order", "adjustment"];
export const isBookKind = (value: string): value is BookKind => (ALL_KINDS as string[]).includes(value);

/** Who reads the books: purchases and their money are for the stock and money desks. */
const mayRead = (me: Me) => allow(me, COST_ROLES, "see the purchases");

const SORTS: Record<string, SQL> = {
  date: sql`d.doc_date`,
  number: sql`lower(d.number)`,
  reference: sql`lower(d.reference)`,
  party: sql`lower(d.party_name)`,
  status: sql`d.status`,
  due: sql`d.due_date`,
  total: sql`d.total`,
  balance: sql`d.balance`,
};

/** A bill or invoice with money owed past its due day reads "overdue", whatever Zoho last said. */
const liveStatus = (today: string) => sql`case
    when d.kind in ('bill', 'invoice') and d.balance > 0 and d.due_date < ${today}::date and d.status not in ('void', 'draft', 'paid', 'closed') then 'overdue'
    when d.kind in ('bill', 'invoice') and d.status = 'overdue' and (d.balance = 0 or d.due_date >= ${today}::date) then case when d.balance = 0 then 'paid' else 'open' end
    else d.status end`;

const rowSelect = (today: string) => sql`select d.id::int as id, d.number, d.reference, to_char(d.doc_date, 'YYYY-MM-DD') as date,
    to_char(d.due_date, 'YYYY-MM-DD') as "dueDate", ${liveStatus(today)} as status,
    case when d.kind in ('bill', 'invoice') and d.balance > 0 and d.due_date < ${today}::date and d.status not in ('void', 'draft', 'paid', 'closed')
      then (${today}::date - d.due_date)::int end as "overdueDays",
    coalesce(s.name, c.name, d.party_name) as party, coalesce(d.supplier_id, d.customer_id)::int as "partyId", d.currency,
    d.total::bigint::float8 as total, d.balance::bigint::float8 as balance,
    case when d.kind = 'purchase_order' then (
      select case when coalesce(sum((l.qty_done->>'received')::numeric), 0) = 0 then 'none'
        when sum((l.qty_done->>'received')::numeric) >= sum(coalesce(l.qty, 0) - coalesce((l.qty_done->>'cancelled')::numeric, 0)) then 'full' else 'partial' end
      from book_line l where l.doc_id = d.id) end as received,
    case when d.kind = 'purchase_order' then (
      select case when coalesce(sum((l.qty_done->>'billed')::numeric), 0) = 0 then 'none'
        when sum((l.qty_done->>'billed')::numeric) >= sum(coalesce(l.qty, 0) - coalesce((l.qty_done->>'cancelled')::numeric, 0)) then 'full' else 'partial' end
      from book_line l where l.doc_id = d.id)
      when d.kind = 'purchase_receive' then case when exists (select 1 from book_link k join book_doc b on b.id = k.from_doc and b.kind = 'bill' where k.to_doc = d.id) then 'full' else 'none' end
      end as billed,
    case when d.kind = 'purchase_receive' then d.reference
      when d.kind in ('vendor_payment', 'customer_payment') then (select string_agg(b.number, ', ' order by b.doc_date) from book_link k join book_doc b on b.id = k.to_doc where k.from_doc = d.id)
      when d.kind = 'credit_note' then (select string_agg(b.number, ', ') from book_link k join book_doc b on b.id = k.to_doc and b.kind = 'invoice' where k.from_doc = d.id)
      when d.kind = 'sales_return' then (select string_agg(b.number, ', ') from book_link k join book_doc b on b.id = k.to_doc and b.kind = 'sales_order' where k.from_doc = d.id)
      end as linked,
    coalesce(d.fields->>'Mode', d.fields->>'payment_mode') as mode,
    -- What a payment or a credit has not been put on yet (Zoho's own figure, kept as its balance).
    case when d.kind in ('vendor_payment', 'customer_payment', 'vendor_credit', 'credit_note') then d.balance::bigint::float8 end as unused,
    case when d.kind in ('purchase_receive', 'sales_return') then (select sum(l.qty)::float8 from book_line l where l.doc_id = d.id) end as qty
  from book_doc d left join supplier s on s.id = d.supplier_id left join customer c on c.id = d.customer_id`;

export async function bookList(
  db: Database,
  me: Me,
  kind: BookKind,
  asked: { view?: string; page?: number; perPage?: number; q?: string; sort?: string; dir?: string; party?: number },
): Promise<BookList> {
  mayRead(me);
  const today = todayManila();
  const views = await rows<{ key: string; count: number }>(
    db,
    sql`select ${liveStatus(today)} as key, count(*)::int as count from book_doc d where d.kind = ${kind} group by 1 order by 2 desc`,
  );
  const view = asked.view && views.some((v) => v.key === asked.view) ? asked.view : "all";
  const perPage = [10, 25, 50, 100, 200].includes(asked.perPage ?? 0) ? (asked.perPage as number) : 25;
  const page = Math.max(1, asked.page ?? 1);
  const q = asked.q?.trim();
  const where = sql.join(
    [
      sql`d.kind = ${kind}`,
      view === "all" ? sql`true` : sql`${liveStatus(today)} = ${view}`,
      q ? sql`(d.number ilike ${`%${q}%`} or d.reference ilike ${`%${q}%`} or d.party_name ilike ${`%${q}%`})` : sql`true`,
      asked.party ? sql`(d.supplier_id = ${asked.party} or d.customer_id = ${asked.party})` : sql`true`,
    ],
    sql` and `,
  );
  const by = SORTS[asked.sort ?? "date"] ?? SORTS.date;
  const dir = asked.dir === "asc" ? sql`asc` : sql`desc`;
  const [count] = await rows<{ n: number }>(db, sql`select count(*)::int as n from book_doc d where ${where}`);
  const found = await rows<BookRow>(
    db,
    sql`${rowSelect(today)} where ${where} order by ${by} ${dir} nulls last, d.id desc limit ${perPage} offset ${(page - 1) * perPage}`,
  );
  return {
    kind,
    today,
    views: [{ key: "all", count: views.reduce((sum, v) => sum + v.count, 0) }, ...views],
    view,
    page,
    perPage,
    total: count?.n ?? 0,
    rows: found,
  };
}

export async function bookDoc(db: Database, me: Me, kind: BookKind, id: number): Promise<BookDoc> {
  mayRead(me);
  const today = todayManila();
  const [row] = await rows<BookRow & { kind: BookKind; fxRate: number; subTotal: number | null; paymentTerms: string | null; notes: string | null; fields: Record<string, unknown>; fromZoho: boolean; zohoCreated: string | null; supplierId: number | null }>(
    db,
    sql`select r.*, d.kind, d.fx_rate::float8 as "fxRate", d.sub_total::bigint::float8 as "subTotal", d.payment_terms as "paymentTerms", d.notes, d.fields,
        d.zoho_id is not null as "fromZoho", to_char(d.zoho_created at time zone 'Asia/Manila', 'YYYY-MM-DD HH24:MI') as "zohoCreated", d.supplier_id::int as "supplierId"
      from (${rowSelect(today)} where d.id = ${id} and d.kind = ${kind}) r join book_doc d on d.id = r.id`,
  );
  if (!row) throw new Refusal(404, "not_found", "That document is not in the books.");
  const [lines, linkedDocs, vendors] = await Promise.all([
    rows<BookLine>(
      db,
      sql`select l.id::int as id, l.n, l.medicine_id::int as "medicineId", m.name || coalesce(' ' || m.strength, '') as medicine, l.item_name as "itemName", l.sku,
          l.description, l.account, l.warehouse, l.unit, l.qty::float8 as qty, l.rate::float8 as rate, l.tax_name as "taxName", l.tax_pct::float8 as "taxPct",
          l.amount::bigint::float8 as amount, l.qty_done as "qtyDone", l.batches, l.fields, l.from_line::int as "fromLine"
        from book_line l left join medicine m on m.id = l.medicine_id where l.doc_id = ${id} order by l.n`,
    ),
    rows<BookLinked>(
      db,
      sql`select b.id::int as id, b.kind, b.number, to_char(b.doc_date, 'YYYY-MM-DD') as date, b.status, b.total::bigint::float8 as total,
          b.balance::bigint::float8 as balance, k.amount::bigint::float8 as amount, to_char(k.on_date, 'YYYY-MM-DD') as on, 'to' as direction
        from book_link k join book_doc b on b.id = k.to_doc where k.from_doc = ${id}
        union all
        select b.id::int, b.kind, b.number, to_char(b.doc_date, 'YYYY-MM-DD'), b.status, b.total::bigint::float8, b.balance::bigint::float8,
          k.amount::bigint::float8, to_char(k.on_date, 'YYYY-MM-DD'), 'from'
        from book_link k join book_doc b on b.id = k.from_doc where k.to_doc = ${id}
        order by 4`,
    ),
    row.supplierId
      ? rows<NonNullable<BookDoc["vendor"]>>(
          db,
          sql`select id::int as id, name, company_name as company, email, phone, billing_address as address, country from supplier where id = ${row.supplierId}`,
        )
      : Promise.resolve([]),
  ]);
  // A purchase order's receives and bills, once each, reach the documents they lead to (the
  // payments on its bills) through the bills' own page.
  const { supplierId: _drop, ...doc } = row;
  return { ...doc, vendor: vendors[0] ?? null, lines, linkedDocs };
}

// ------------------------------------------------------------------ vendors

const vendorSelect = sql`select s.id::int as id, s.name, s.company_name as company, s.email, coalesce(s.phone, s.mobile) as phone, s.active,
    (s.opening_payables + coalesce((select sum(round(d.balance * d.fx_rate)) from book_doc d where d.supplier_id = s.id and d.kind = 'bill' and d.status not in ('void', 'draft', 'pending_approval')), 0))::bigint::float8 as payables,
    (s.opening_credits + coalesce((select sum(round(d.balance * d.fx_rate)) from book_doc d where d.supplier_id = s.id and d.kind in ('vendor_credit', 'vendor_payment') and d.status not in ('void', 'draft', 'pending_approval')), 0))::bigint::float8 as credits
  from supplier s`;

export async function vendorList(db: Database, me: Me, asked: { view?: string; page?: number; perPage?: number; q?: string; sort?: string; dir?: string }): Promise<VendorList> {
  mayRead(me);
  const [counts] = await rows<{ all: number; active: number; inactive: number }>(
    db,
    sql`select count(*)::int as all, count(*) filter (where active)::int as active, count(*) filter (where not active)::int as inactive from supplier`,
  );
  const view = ["active", "inactive", "all"].includes(asked.view ?? "") ? (asked.view as string) : "active";
  const perPage = [10, 25, 50, 100, 200].includes(asked.perPage ?? 0) ? (asked.perPage as number) : 25;
  const page = Math.max(1, asked.page ?? 1);
  const q = asked.q?.trim();
  const where = sql.join(
    [
      view === "all" ? sql`true` : view === "active" ? sql`v.active` : sql`not v.active`,
      q ? sql`(v.name ilike ${`%${q}%`} or v.company ilike ${`%${q}%`} or v.email ilike ${`%${q}%`})` : sql`true`,
    ],
    sql` and `,
  );
  const by = asked.sort === "payables" ? sql`v.payables` : asked.sort === "company" ? sql`lower(v.company)` : sql`lower(v.name)`;
  const dir = asked.dir === "desc" ? sql`desc` : sql`asc`;
  const [count] = await rows<{ n: number }>(db, sql`select count(*)::int as n from (${vendorSelect}) v where ${where}`);
  const found = await rows<VendorRow>(db, sql`select * from (${vendorSelect}) v where ${where} order by ${by} ${dir} nulls last, v.id limit ${perPage} offset ${(page - 1) * perPage}`);
  return {
    views: [
      { key: "active", count: counts?.active ?? 0 },
      { key: "inactive", count: counts?.inactive ?? 0 },
      { key: "all", count: counts?.all ?? 0 },
    ],
    view,
    page,
    perPage,
    total: count?.n ?? 0,
    rows: found,
  };
}

export async function vendorDetail(db: Database, me: Me, id: number): Promise<VendorDetail> {
  mayRead(me);
  const today = todayManila();
  const [vendor] = await rows<VendorDetail>(
    db,
    sql`select v.*, s.mobile, s.website, s.currency, s.country, s.tin, s.billing_address as "billingAddress", s.shipping_address as "shippingAddress",
        s.payment_terms as "paymentTerms", s.fields
      from (${vendorSelect} where s.id = ${id}) v join supplier s on s.id = v.id`,
  );
  if (!vendor) throw new Refusal(404, "not_found", "That vendor is not on the list.");
  const [people, counts, recent] = await Promise.all([
    rows<VendorDetail["people"][number]>(db, sql`select id::int as id, name, email, phone, mobile, designation from supplier_person where supplier_id = ${id} order by name`),
    rows<VendorDetail["counts"][number]>(
      db,
      sql`select kind, count(*)::int as count, sum(round(total * fx_rate))::bigint::float8 as total from book_doc where supplier_id = ${id} group by kind`,
    ),
    rows<VendorDetail["recent"][number]>(db, sql`select r.*, d.kind from (${rowSelect(today)} where d.supplier_id = ${id}) r join book_doc d on d.id = r.id order by r.date desc, r.id desc limit 40`),
  ]);
  return { ...vendor, people, counts, recent };
}

/** Bills' band, as Zoho's: owed to vendors in all, due today, due within 30 days, overdue (pesos). */
export async function payables(db: Database, me: Me): Promise<{ total: number; dueToday: number; due30: number; overdue: number }> {
  mayRead(me);
  const today = todayManila();
  const [found] = await rows<{ total: number; dueToday: number; due30: number; overdue: number }>(
    db,
    sql`select coalesce(sum(round(balance * fx_rate)), 0)::bigint::float8 as total,
        coalesce(sum(round(balance * fx_rate)) filter (where due_date = ${today}::date), 0)::bigint::float8 as "dueToday",
        coalesce(sum(round(balance * fx_rate)) filter (where due_date >= ${today}::date and due_date <= ${today}::date + 30), 0)::bigint::float8 as due30,
        coalesce(sum(round(balance * fx_rate)) filter (where due_date < ${today}::date), 0)::bigint::float8 as overdue
      from book_doc where kind = 'bill' and balance > 0 and status not in ('void', 'draft', 'pending_approval')`,
  );
  return found ?? { total: 0, dueToday: 0, due30: 0, overdue: 0 };
}
