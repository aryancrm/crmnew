// The books' screens (docs/PLAN.md 17): each kind's list as Zoho Inventory lists it (its views,
// its columns, 25 to a page, newest first) and one document with everything it holds: its lines
// and batches, every field Zoho kept, the vendor, and the documents it hangs together with.

import { type SQL, sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { allow, Refusal } from "../http";
import { COST_ROLES } from "../inventory/rules";
import { todayManila } from "../inventory/rules";
import { bytesOf } from "../files/store";
import { LEDGER_ROLES, mayReadLedger } from "./accounts";
import { crmDoc, crmLight, crmRows } from "./crm";
import type { BookDoc, BookKind, BookLine, BookLinked, BookList, BookRow, Me, VendorDetail, VendorList, VendorRow } from "../types";

export const PURCHASE_KINDS: BookKind[] = ["purchase_order", "purchase_receive", "bill", "vendor_payment", "vendor_credit"];
export const SALES_KINDS: BookKind[] = ["sales_order", "invoice", "customer_payment", "sales_return", "credit_note"];
/** Zoho Books' own documents: money (expenses, journals, banks), for the ledger's desks only. */
export const LEDGER_KINDS: BookKind[] = ["expense", "journal", "transfer_fund", "deposit", "refund", "recurring_bill", "recurring_expense", "fixed_asset"];
const ALL_KINDS: BookKind[] = [...PURCHASE_KINDS, ...SALES_KINDS, "package", "shipment", "transfer_order", "adjustment", ...LEDGER_KINDS];
export const isBookKind = (value: string): value is BookKind => (ALL_KINDS as string[]).includes(value);

/** Who reads the books: purchases and their money are for the stock and money desks; Books' own
 *  money (expenses, journals, banks) for Finance, the CEO and the Admin. */
const mayRead = (me: Me, kind?: BookKind) => (kind && LEDGER_KINDS.includes(kind) ? mayReadLedger(me) : allow(me, COST_ROLES, "see the purchases"));


/** A bill or invoice with money owed past its due day reads "overdue", whatever Zoho last said. */
const liveStatus = (today: string) => sql`case
    when d.kind in ('bill', 'invoice') and d.balance > 0 and d.due_date < ${today}::date and d.status not in ('void', 'draft', 'paid', 'closed') then 'overdue'
    when d.kind in ('bill', 'invoice') and d.status = 'overdue' and (d.balance = 0 or d.due_date >= ${today}::date) then case when d.balance = 0 then 'paid' else 'open' end
    else d.status end`;

/** A Zoho sales order's dots, from Zoho's list when it was read (its own words), else its lines. */
const dotOf = (word: SQL, lines: SQL) => sql`case
    when ${word} in ('invoiced', 'paid', 'shipped', 'fulfilled', 'packed', 'closed') then 'full'
    when ${word} like 'partially%' then 'partial'
    when ${word} is not null then 'none'
    else ${lines} end`;
const linesDot = (what: string) => sql`(select case when coalesce(sum((l.qty_done->>${what})::numeric), 0) = 0 then 'none'
      when sum((l.qty_done->>${what})::numeric) >= sum(coalesce(l.qty, 0) - coalesce((l.qty_done->>'cancelled')::numeric, 0)) then 'full' else 'partial' end
    from book_line l where l.doc_id = d.id)`;
const salesDots = sql`case when d.kind = 'sales_order' then ${dotOf(sql`d.fields->>'invoiced_status'`, linesDot("invoiced"))} end as invoiced,
    case when d.kind = 'sales_order' then ${dotOf(sql`d.fields->>'paid_status'`, sql`(select case when count(*) = 0 then 'none' when sum(i.balance) = 0 then 'full'
        when sum(i.balance) < sum(i.total) then 'partial' else 'none' end from book_link k join book_doc i on i.id = k.from_doc and i.kind = 'invoice' and i.status <> 'void' where k.to_doc = d.id)`)} end as paid,
    case when d.kind = 'sales_order' then ${dotOf(sql`d.fields->>'packed_status'`, linesDot("packed"))} end as packed,
    case when d.kind = 'sales_order' then ${dotOf(sql`d.fields->>'shipped_status'`, sql`'none'`)} end as shipped,
    case when d.kind = 'sales_order' then coalesce(d.fields->>'Delivery Method', d.fields->>'delivery_method') end as "deliveryMethod",
    null::jsonb as crm,
    case when d.kind = 'adjustment' then jsonb_build_object('reason', d.fields->>'Reason', 'description', d.notes, 'type', initcap(d.fields->>'Adjustment Type'),
        'warehouse', (select l.warehouse from book_line l where l.doc_id = d.id and l.warehouse is not null limit 1), 'by', d.fields->>'created_by_name', 'at', d.fields->>'created_time')
      when d.kind = 'transfer_order' then jsonb_build_object('reason', d.notes, 'qty', (select sum(l.qty) from book_line l where l.doc_id = d.id),
        'from', d.fields->>'From Warehouse Name', 'to', d.fields->>'To Warehouse Name')
      when d.kind = 'package' then jsonb_build_object('so', d.reference, 'qty', (select sum(l.qty) from book_line l where l.doc_id = d.id), 'carrier', coalesce(d.fields->>'CF.Carrier', d.fields->>'carrier'))
      when d.kind = 'shipment' then jsonb_build_object('so', d.fields->>'SO Number', 'package', d.fields->>'Packing Number', 'carrier', d.fields->>'Carrier Name', 'tracking', d.reference)
      -- Zoho Books' own documents (docs/PLAN.md 17).
      when d.kind in ('expense', 'recurring_expense', 'recurring_bill') then jsonb_build_object(
        'account', (select case when count(distinct l.account) > 1 then 'Itemized' else max(l.account) end from book_line l where l.doc_id = d.id),
        'paidThrough', d.fields->>'Paid Through', 'customer', d.fields->>'Customer Name', 'by', d.fields->>'user_name', 'report', d.fields->>'report_number',
        'frequency', d.fields->>'Recurrence Frequency', 'every', d.fields->>'Repeat Every', 'last', d.fields->>'Last Sent Date')
      when d.kind = 'journal' then jsonb_build_object('notes', d.notes, 'by', d.fields->>'Journal Created By', 'type', d.fields->>'Journal Type')
      when d.kind in ('transfer_fund', 'deposit') then jsonb_build_object('from', d.fields->>'From Account', 'to', d.fields->>'To Account', 'type', d.fields->>'Transaction Type', 'description', d.notes)
      when d.kind = 'refund' then jsonb_build_object('from', d.fields->>'Refund From Account', 'mode', d.fields->>'Mode of Refund', 'creditNote', d.fields->>'Credit Note Number')
      when d.kind = 'fixed_asset' then jsonb_build_object('name', d.fields->>'Fixed Asset Name', 'type', d.fields->>'Fixed Asset Type', 'method', d.fields->>'Depreciation Method',
        'account', d.fields->>'Fixed Asset Account', 'life', d.fields->>'Asset Life')
      end as extra`;

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
      when d.kind = 'invoice' then (select string_agg(b.number, ', ') from book_link k join book_doc b on b.id = k.to_doc and b.kind = 'sales_order' where k.from_doc = d.id)
      when d.kind = 'credit_note' then (select string_agg(b.number, ', ') from book_link k join book_doc b on b.id = k.to_doc and b.kind = 'invoice' where k.from_doc = d.id)
      when d.kind = 'sales_return' then (select string_agg(b.number, ', ') from book_link k join book_doc b on b.id = k.to_doc and b.kind = 'sales_order' where k.from_doc = d.id)
      end as linked,
    coalesce(d.fields->>'Mode', d.fields->>'payment_mode') as mode,
    -- What a payment or a credit has not been put on yet (Zoho's own figure, kept as its balance).
    case when d.kind in ('vendor_payment', 'customer_payment', 'vendor_credit', 'credit_note') then d.balance::bigint::float8 end as unused,
    case when d.kind in ('purchase_receive', 'sales_return') then (select sum(l.qty)::float8 from book_line l where l.doc_id = d.id) end as qty,
    ${salesDots}
  from book_doc d left join supplier s on s.id = d.supplier_id left join customer c on c.id = d.customer_id`;

export async function bookList(
  db: Database,
  me: Me,
  kind: BookKind,
  asked: { view?: string; page?: number; perPage?: number; q?: string; sort?: string; dir?: string; party?: number },
): Promise<BookList> {
  mayRead(me, kind);
  const today = todayManila();
  // First the light rows (Zoho's documents and this CRM's own of the kind) to count, filter, sort
  // and page; then everything a row shows, for the page's rows only.
  const light = sql`(select d.id::int as id, to_char(d.doc_date, 'YYYY-MM-DD') as date, d.number, d.reference, coalesce(s.name, c.name, d.party_name) as party,
      coalesce(d.supplier_id, d.customer_id)::int as "partyId", ${liveStatus(today)} as status, d.total::bigint::float8 as total, d.balance::bigint::float8 as balance,
      to_char(d.due_date, 'YYYY-MM-DD') as due,
      -- A Zoho sales order still open when Zoho was closed: to be finished (invoiced, shipped).
      (d.kind = 'sales_order' and d.zoho_id is not null and d.status in ('confirmed', 'draft')
        and (coalesce(d.fields->>'invoiced_status', '') <> 'invoiced' or coalesce(d.fields->>'shipped_status', '') in ('pending', 'partially_shipped'))) as open
    from book_doc d left join supplier s on s.id = d.supplier_id left join customer c on c.id = d.customer_id where d.kind = ${kind}
    ${crmLight(kind, today)})`;
  const views = await rows<{ key: string; count: number }>(db, sql`select r.status as key, count(*)::int as count from ${light} r group by 1 order by 2 desc`);
  if (kind === "sales_order") {
    const [open] = await rows<{ n: number }>(db, sql`select count(*)::int as n from ${light} r where r.open`);
    if (open?.n) views.unshift({ key: "zoho_to_finish", count: open.n });
  }
  const view = asked.view && views.some((v) => v.key === asked.view) ? asked.view : "all";
  const perPage = [10, 25, 50, 100, 200].includes(asked.perPage ?? 0) ? (asked.perPage as number) : 25;
  const page = Math.max(1, asked.page ?? 1);
  const q = asked.q?.trim();
  const where = sql.join(
    [
      view === "all" ? sql`true` : view === "zoho_to_finish" ? sql`r.open` : sql`r.status = ${view}`,
      q ? sql`(r.number ilike ${`%${q}%`} or r.reference ilike ${`%${q}%`} or r.party ilike ${`%${q}%`})` : sql`true`,
      asked.party ? sql`r."partyId" = ${asked.party}` : sql`true`,
    ],
    sql` and `,
  );
  const by = LIGHT_SORTS[asked.sort ?? "date"] ?? LIGHT_SORTS.date;
  const dir = asked.dir === "asc" ? sql`asc` : sql`desc`;
  const [count] = await rows<{ n: number }>(db, sql`select count(*)::int as n from ${light} r where ${where}`);
  const pageRows = await rows<{ id: number }>(db, sql`select r.id from ${light} r where ${where} order by ${by} ${dir} nulls last, length(r.number) ${dir}, r.number ${dir}, r.id desc limit ${perPage} offset ${(page - 1) * perPage}`);
  const ids = pageRows.map((row) => row.id);
  const zoho = ids.filter((id) => id > 0);
  const crm = ids.filter((id) => id < 0);
  const full = [
    ...(zoho.length ? await rows<BookRow>(db, sql`${rowSelect(today)} where d.id in (${sql.join(zoho.map((id) => sql`${id}`), sql`, `)})`) : []),
    ...(crm.length ? await crmRows(db, kind, crm, today) : []),
  ];
  const byId = new Map(full.map((row) => [row.id, row]));
  return {
    kind,
    today,
    views: [{ key: "all", count: views.reduce((sum, v) => sum + v.count, 0) }, ...views],
    view,
    page,
    perPage,
    total: count?.n ?? 0,
    rows: ids.map((id) => byId.get(id)).filter((row): row is BookRow => Boolean(row)),
  };
}

const LIGHT_SORTS: Record<string, SQL> = {
  date: sql`r.date`,
  number: sql`lower(r.number)`,
  reference: sql`lower(r.reference)`,
  party: sql`lower(r.party)`,
  status: sql`r.status`,
  due: sql`r.due`,
  total: sql`r.total`,
  balance: sql`r.balance`,
};

export async function bookDoc(db: Database, me: Me, kind: BookKind, id: number): Promise<BookDoc> {
  mayRead(me, kind);
  const today = todayManila();
  if (id < 0) return crmDoc(db, kind, -id, today);
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
  const files = await rows<NonNullable<BookDoc["files"]>[number]>(
    db,
    sql`select id::int as id, name, mime, size, uploaded_by as "uploadedBy", uploaded_on as "uploadedOn" from book_file where doc_id = ${id} order by id`,
  );
  // Its debits and credits on the accounts (Zoho's "Journal" of a transaction), for the ledger's desks.
  const entries = LEDGER_ROLES.includes(me.role)
    ? await rows<NonNullable<BookDoc["entries"]>[number]>(
        db,
        sql`select e.account, a.id::int as "accountId", e.debit::float8 as debit, e.credit::float8 as credit
          from book_entry e left join book_account a on lower(a.name) = lower(e.account) where e.doc_id = ${id} order by e.debit desc, e.credit`,
      )
    : undefined;
  const { supplierId: _drop, ...doc } = row;
  return { ...doc, vendor: vendors[0] ?? null, lines, linkedDocs, files, entries };
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

/** A file on a books document, for the desks that read the books. */
export async function bookFile(db: Database, me: Me, id: number): Promise<{ name: string; mime: string; bytes: Uint8Array }> {
  mayRead(me);
  const [file] = await rows<{ name: string; mime: string; data: Uint8Array | null; key: string | null }>(db, sql`select name, mime, data, key from book_file where id = ${id}`);
  if (!file) throw new Refusal(404, "not_found", "That file is not here.");
  return { name: file.name, mime: file.mime, bytes: await bytesOf(file) };
}
