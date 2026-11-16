// Items as Zoho Inventory lists them (docs/PLAN.md 17): "Active Items", NAME, SKU, REORDER LEVEL —
// with STOCK ON HAND and RATE beside them. Every item Zoho had is here; an item that is one of
// this CRM's medicines shows the CRM's own stock (by warehouse and batch, the stock that is sold
// from now on) beside Zoho's figures on the day it was read; a medicine Zoho never had is listed too.

import { type SQL, sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { allow, Refusal } from "../http";
import { COST_ROLES } from "../inventory/rules";
import type { BookItem, BookItemList, BookItemRow, BookPriceList, BookRow, Me } from "../types";

const crmStock = sql`(select b.medicine_id, sum(s.qty)::float8 as qty from stock s join batch b on b.id = s.batch_id group by b.medicine_id)`;

/** Zoho's items, and the CRM's medicines that no Zoho item is. */
const light = sql`(
    select i.id::int as id, i.name, i.sku, i.status, i.unit, i.rate::float8 as rate, i.reorder_level::float8 as "reorderLevel",
      coalesce(cs.qty, (i.zoho_stock->>'stock_on_hand')::float8) as stock, i.medicine_id::int as "medicineId", true as zoho
    from book_item i left join ${crmStock} cs on cs.medicine_id = i.medicine_id
    union all
    select -m.id::int, m.name || coalesce(' ' || m.strength, ''), (select k.sku from medicine_sku k where k.medicine_id = m.id order by k.id limit 1),
      case when m.active then 'active' else 'inactive' end, 'pcs', (select p.amount from medicine_price p where p.medicine_id = m.id and p.buyer_type = 'patient')::float8,
      m.reorder_level::float8, coalesce(cs.qty, 0), m.id::int, false
    from medicine m left join ${crmStock} cs on cs.medicine_id = m.id
    where not exists (select 1 from book_item i where i.medicine_id = m.id)
  )`;

export async function itemList(db: Database, me: Me, asked: { view?: string; page?: number; perPage?: number; q?: string; sort?: string; dir?: string }): Promise<BookItemList> {
  allow(me, COST_ROLES, "see the items' books");
  const [counts] = await rows<Record<string, number>>(
    db,
    sql`select count(*) filter (where r.status = 'active')::int as active, count(*) filter (where r.status <> 'active')::int as inactive, count(*)::int as all,
        count(*) filter (where r.status = 'active' and r.stock > 0 and r."reorderLevel" > 0 and r.stock <= r."reorderLevel")::int as low,
        count(*) filter (where r.status = 'active' and coalesce(r.stock, 0) <= 0)::int as out,
        count(*) filter (where r."medicineId" is not null)::int as medicines
      from ${light} r`,
  );
  const views = ["active", "inactive", "all", "low", "out", "medicines"];
  const view = views.includes(asked.view ?? "") ? (asked.view as string) : "active";
  const filters: Record<string, SQL> = {
    active: sql`r.status = 'active'`,
    inactive: sql`r.status <> 'active'`,
    all: sql`true`,
    low: sql`r.status = 'active' and r.stock > 0 and r."reorderLevel" > 0 and r.stock <= r."reorderLevel"`,
    out: sql`r.status = 'active' and coalesce(r.stock, 0) <= 0`,
    medicines: sql`r."medicineId" is not null`,
  };
  const q = asked.q?.trim();
  const where = sql`${filters[view] ?? sql`true`} and ${q ? sql`(r.name ilike ${`%${q}%`} or r.sku ilike ${`%${q}%`})` : sql`true`}`;
  const sorts: Record<string, SQL> = { name: sql`lower(r.name)`, sku: sql`lower(r.sku)`, stock: sql`r.stock`, reorder: sql`r."reorderLevel"`, rate: sql`r.rate` };
  const by = sorts[asked.sort ?? "name"] ?? sorts.name;
  const dir = asked.dir === "desc" ? sql`desc` : sql`asc`;
  const perPage = [10, 25, 50, 100, 200].includes(asked.perPage ?? 0) ? (asked.perPage as number) : 25;
  const page = Math.max(1, asked.page ?? 1);
  const [count] = await rows<{ n: number }>(db, sql`select count(*)::int as n from ${light} r where ${where}`);
  const found = await rows<BookItemRow>(db, sql`select * from ${light} r where ${where} order by ${by} ${dir} nulls last, r.id limit ${perPage} offset ${(page - 1) * perPage}`);
  return { views: views.map((key) => ({ key, count: counts?.[key] ?? 0 })), view, page, perPage, total: count?.n ?? 0, rows: found };
}

const OPEN_ORDER = ["pending_approval", "finance_check", "ready_for_invoice", "invoiced", "ready_for_dispatch", "packing", "on_hold"];

export async function itemDetail(db: Database, me: Me, id: number): Promise<BookItem> {
  allow(me, COST_ROLES, "see the items' books");
  const [item] = await rows<BookItemRow & { itemType: string | null; purchaseRate: number | null; fields: Record<string, unknown>; zohoStock: Record<string, unknown>; zohoBatches: Record<string, unknown>[] }>(
    db,
    id > 0
      ? sql`select r.*, i.item_type as "itemType", i.purchase_rate::float8 as "purchaseRate", i.fields, i.zoho_stock as "zohoStock", i.batches as "zohoBatches"
          from ${light} r join book_item i on i.id = r.id where r.id = ${id}`
      : sql`select r.*, null as "itemType", null::float8 as "purchaseRate", '{}'::jsonb as fields, '{}'::jsonb as "zohoStock", '[]'::jsonb as "zohoBatches"
          from ${light} r where r.id = ${id}`,
  );
  if (!item) throw new Refusal(404, "not_found", "That item is not on the list.");
  const medicineId = item.medicineId;
  const [medicine, warehouses, batches, committed, recent] = await Promise.all([
    medicineId
      ? rows<NonNullable<BookItem["medicine"]>>(db, sql`select id::int as id, name, generic, strength, form, pack from medicine where id = ${medicineId}`)
      : Promise.resolve([]),
    medicineId
      ? rows<BookItem["warehouses"][number]>(
          db,
          sql`select w.name, sum(s.qty)::float8 as qty from stock s join batch b on b.id = s.batch_id join warehouse w on w.id = s.warehouse_id
            where b.medicine_id = ${medicineId} group by w.name having sum(s.qty) <> 0 order by 2 desc`,
        )
      : Promise.resolve([]),
    medicineId
      ? rows<BookItem["batches"][number]>(
          db,
          sql`select b.batch_no as "batchNo", to_char(b.expires_on, 'YYYY-MM-DD') as "expiresOn", s.qty::float8 as qty, w.name as warehouse
            from stock s join batch b on b.id = s.batch_id join warehouse w on w.id = s.warehouse_id where b.medicine_id = ${medicineId} and s.qty <> 0
            order by b.expires_on, w.name`,
        )
      : Promise.resolve([]),
    medicineId
      ? rows<{ qty: number }>(
          db,
          sql`select coalesce(sum(oi.qty), 0)::float8 as qty from order_item oi join sales_order o on o.id = oi.order_id
            where oi.medicine_id = ${medicineId} and o.status in (${sql.join(OPEN_ORDER.map((s) => sql`${s}`), sql`, `)})`,
        )
      : Promise.resolve([{ qty: 0 }]),
    rows<BookRow & { kind: BookItem["recent"][number]["kind"]; qty: number | null }>(
      db,
      sql`select d.id::int as id, d.kind, d.number, d.reference, to_char(d.doc_date, 'YYYY-MM-DD') as date, null as "dueDate", d.status,
          d.party_name as party, coalesce(d.supplier_id, d.customer_id)::int as "partyId", d.currency, d.total::float8 as total, d.balance::float8 as balance,
          l.qty::float8 as qty
        from book_line l join book_doc d on d.id = l.doc_id
        where ${medicineId ? sql`(l.medicine_id = ${medicineId} or (l.sku is not null and lower(l.sku) = lower(${item.sku ?? ""})))` : sql`lower(l.sku) = lower(${item.sku ?? "-"})`}
        order by d.doc_date desc, d.id desc limit 50`,
    ),
  ]);
  const blank = { overdueDays: null, received: null, billed: null, linked: null, mode: null, unused: null };
  return {
    ...item,
    medicine: medicine[0] ?? null,
    warehouses,
    batches,
    committed: committed[0]?.qty ?? 0,
    recent: recent.map((row) => ({ ...blank, ...row })),
  };
}

export async function priceLists(db: Database, me: Me): Promise<BookPriceList[]> {
  allow(me, COST_ROLES, "see the price lists");
  return rows<BookPriceList>(db, sql`select id::int as id, name, currency, kind, details, scheme, rounding, status from book_price_list order by name`);
}
