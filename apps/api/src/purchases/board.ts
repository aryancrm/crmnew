// Purchases in this CRM's own look (Aryan, 18 Nov: "move Purchases out of Zoho's style into our
// Inventory style, every feature, better than Zoho"; Zoho's screens stay for showing both). The
// same documents as Zoho's screens (book_doc: purchase orders, receives, bills, payments made,
// vendor credits, Zoho's history and those made here), read for what the Inventory and Finance
// desks act on: what is still to come in, to bill, to pay; what to buy again before it runs out;
// what each vendor sells us and at what price last time; what a purchase order's goods landed at.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { allow } from "../http";
import { COST_ROLES, todayManila } from "../inventory/rules";
import { PROMISED_ORDER } from "../inventory/service";
import { companyInfo } from "../settings/service";
import type { Me, PurchaseBoard, PurchaseOrderExtra, VendorItems } from "../types";

/** What is left to come in on a line (Zoho's "quantity ordered" less cancelled and received). */
const LEFT = sql`(coalesce(l.qty, 0) - coalesce((l.qty_done->>'cancelled')::numeric, 0) - coalesce((l.qty_done->>'received')::numeric, 0))`;
const RECEIVED_NOT_BILLED = sql`(coalesce((l.qty_done->>'received')::numeric, 0) - coalesce((l.qty_done->>'billed')::numeric, 0))`;
/** An order that is still running: not a draft, cancelled, closed or void. A Zoho order a year old
 *  that never came is history, not stock coming (as the stock pages count it). */
const RUNNING = (today: string) =>
  sql`d.kind = 'purchase_order' and d.status not in ('draft', 'cancelled', 'closed', 'void') and coalesce(d.due_date, d.doc_date) >= ${today}::date - 365`;

export async function purchaseBoard(db: Database, me: Me): Promise<PurchaseBoard> {
  allow(me, COST_ROLES, "see the purchases");
  const today = todayManila();
  const [receive, bill, owed, credits, buyMore, recent] = await Promise.all([
    rows<PurchaseBoard["toReceive"]>(
      db,
      sql`select count(distinct d.id)::int as orders, coalesce(sum(${LEFT}), 0)::int as pieces,
          count(distinct d.id) filter (where d.due_date < ${today}::date)::int as late,
          coalesce(sum(round(${LEFT} * coalesce(l.rate, 0) * d.fx_rate * 100)), 0)::bigint::float8 as value
        from book_doc d join book_line l on l.doc_id = d.id
        where ${RUNNING(today)} and ${LEFT} > 0`,
    ),
    rows<PurchaseBoard["toBill"]>(
      db,
      sql`select count(distinct d.id)::int as orders,
          coalesce(sum(round(${RECEIVED_NOT_BILLED} * coalesce(l.rate, 0) * d.fx_rate * 100)), 0)::bigint::float8 as value
        from book_doc d join book_line l on l.doc_id = d.id
        where d.kind = 'purchase_order' and d.status not in ('draft', 'cancelled', 'void') and ${RECEIVED_NOT_BILLED} > 0
          and d.doc_date >= ${today}::date - 365`,
    ),
    rows<PurchaseBoard["bills"]>(
      db,
      sql`select count(*)::int as open, coalesce(sum(round(d.balance * d.fx_rate)), 0)::bigint::float8 as owed,
          count(*) filter (where d.due_date < ${today}::date)::int as overdue,
          coalesce(sum(round(d.balance * d.fx_rate)) filter (where d.due_date < ${today}::date), 0)::bigint::float8 as "overdueAmount",
          coalesce(sum(round(d.balance * d.fx_rate)) filter (where d.due_date between ${today}::date and ${today}::date + 7), 0)::bigint::float8 as "dueThisWeek"
        from book_doc d where d.kind = 'bill' and d.balance > 0 and d.status not in ('void', 'draft', 'paid', 'closed')`,
    ),
    rows<{ amount: number }>(
      db,
      sql`select coalesce(sum(round(d.balance * d.fx_rate)), 0)::bigint::float8 as amount
        from book_doc d where d.kind in ('vendor_credit', 'vendor_payment') and d.balance > 0 and d.status not in ('void', 'draft', 'closed')`,
    ),
    // Low on the shelf (at or under its low-stock level): how fast it sells, how long it lasts,
    // what is coming, and where it was bought last and at what price, to order it again.
    rows<PurchaseBoard["buyMore"][number]>(
      db,
      sql`with shelf as (
            select s_b.medicine_id, sum(s.qty)::int as qty from stock s join batch s_b on s_b.id = s.batch_id
            where s.qty > 0 and s_b.expires_on >= ${today}::date group by 1),
          -- Pieces on placed orders not packed yet: on the shelf, but sold. "Free" is what is left
          -- after them (it was the whole shelf, so a medicine its orders had already taken, or
          -- wanted more of than there was, never came up to buy; 23 Nov).
          promised as (
            select i.medicine_id, sum(i.qty)::int as qty from order_item i join sales_order o on o.id = i.order_id
            where ${PROMISED_ORDER} group by 1),
          free as (
            select m.id as medicine_id, coalesce(sh.qty, 0) - coalesce(pr.qty, 0) as qty
            from medicine m left join shelf sh on sh.medicine_id = m.id left join promised pr on pr.medicine_id = m.id),
          sold as (
            select medicine_id, sum(-qty)::int as qty from stock_move
            where kind = 'deliver' and at >= now() - interval '30 days' group by 1),
          coming as (
            select l.medicine_id, sum(${LEFT})::int as qty from book_doc d join book_line l on l.doc_id = d.id
            where ${RUNNING(today)} and l.medicine_id is not null and ${LEFT} > 0 group by 1),
          last as (
            select distinct on (l.medicine_id) l.medicine_id, d.supplier_id, coalesce(s.name, d.party_name) as vendor, l.rate::float8 as rate,
              d.currency, to_char(d.doc_date, 'YYYY-MM-DD') as on
            from book_doc d join book_line l on l.doc_id = d.id left join supplier s on s.id = d.supplier_id
            where d.kind in ('purchase_order', 'bill') and d.status not in ('void', 'cancelled', 'draft') and l.medicine_id is not null and coalesce(l.rate, 0) > 0
            order by l.medicine_id, d.doc_date desc, d.id desc)
        select m.id::int as id, m.name || coalesce(' ' || m.strength, '') as name, m.pack, m.pack_size::int as "packSize",
          greatest(coalesce(f.qty, 0), 0)::int as free, greatest(-coalesce(f.qty, 0), 0)::int as short,
          m.reorder_level::int as "reorderLevel", coalesce(so.qty, 0)::int as "sold30",
          coalesce(c.qty, 0)::int as coming,
          case when coalesce(so.qty, 0) > 0 then floor(greatest(coalesce(f.qty, 0), 0) * 30.0 / so.qty)::int end as "daysLeft",
          la.supplier_id::int as "vendorId", la.vendor, la.rate as "lastRate", la.currency as "lastCurrency", la.on as "lastOn"
        from medicine m
          left join free f on f.medicine_id = m.id left join sold so on so.medicine_id = m.id
          left join coming c on c.medicine_id = m.id left join last la on la.medicine_id = m.id
        where m.active and not coalesce(m.cold_box, false) and m.reorder_level > 0 and coalesce(f.qty, 0) <= m.reorder_level
        order by (coalesce(c.qty, 0) > 0), coalesce(f.qty, 0)::float / greatest(m.reorder_level, 1), m.name
        limit 60`,
    ),
    rows<PurchaseBoard["recent"][number]>(
      db,
      sql`select d.id::int as id, d.kind, d.number, coalesce(s.name, d.party_name) as party, to_char(d.doc_date, 'YYYY-MM-DD') as date,
          d.total::bigint::float8 as total, d.currency, d.status, (d.zoho_id is not null) as "fromZoho"
        from book_doc d left join supplier s on s.id = d.supplier_id
        where d.kind in ('purchase_order', 'purchase_receive', 'bill', 'vendor_payment', 'vendor_credit')
        order by d.doc_date desc, d.id desc limit 12`,
    ),
  ]);
  return {
    today,
    toReceive: receive[0] ?? { orders: 0, pieces: 0, late: 0, value: 0 },
    toBill: bill[0] ?? { orders: 0, value: 0 },
    bills: owed[0] ?? { open: 0, owed: 0, overdue: 0, overdueAmount: 0, dueThisWeek: 0 },
    unusedCredits: credits[0]?.amount ?? 0,
    buyMore,
    recent,
  };
}

/** A purchase order's goods as they landed: each batch that came in (order price in pesos, and
 *  its cost now, with any freight or customs added), and the landed-cost bills put on it. */
export async function purchaseOrderExtra(db: Database, me: Me, id: number): Promise<PurchaseOrderExtra> {
  allow(me, COST_ROLES, "see the purchases");
  const [batches, landed, company] = await Promise.all([
    rows<PurchaseOrderExtra["batches"][number]>(
      db,
      sql`select r.id::int as "receiveId", r.number as receive, to_char(r.doc_date, 'YYYY-MM-DD') as date, l.from_line::int as "lineId",
          b.batch_no as "batchNo", to_char(b.expires_on, 'YYYY-MM-DD') as "expiresOn", l.qty::float8 as qty, l.warehouse,
          round(coalesce(l.rate, 0) * o.fx_rate * 100)::bigint::float8 as "orderCost", b.unit_cost::bigint::float8 as "costNow"
        from book_link k
          join book_doc r on r.id = k.from_doc and r.kind = 'purchase_receive' and r.status <> 'void'
          join book_doc o on o.id = k.to_doc
          join book_line l on l.doc_id = r.id
          left join batch b on b.id = l.batch_id
        where k.to_doc = ${id}
        order by r.doc_date, r.id, l.n`,
    ),
    rows<PurchaseOrderExtra["landed"][number]>(
      db,
      sql`select d.id::int as id, d.number, coalesce(s.name, d.party_name) as vendor, to_char(d.doc_date, 'YYYY-MM-DD') as date,
          round(coalesce(d.sub_total, d.total) * d.fx_rate)::bigint::float8 as amount,
          coalesce((d.fields->>'_pending')::bigint, 0)::float8 as pending, d.status
        from book_doc d left join supplier s on s.id = d.supplier_id
        where d.kind = 'bill' and d.fields->>'Landed cost on' = (select number from book_doc where id = ${id})
        order by d.doc_date, d.id`,
    ),
    companyInfo(db),
  ]);
  return { batches, landed, company };
}

/** What a vendor sells us: each item, how often, how much, and the price last time. */
export async function vendorItems(db: Database, me: Me, id: number): Promise<VendorItems> {
  allow(me, COST_ROLES, "see the purchases");
  const items = await rows<VendorItems["items"][number]>(
    db,
    sql`select l.medicine_id::int as "medicineId", coalesce(m.name || coalesce(' ' || m.strength, ''), l.item_name, l.account) as name,
        count(distinct d.id)::int as orders, coalesce(sum(l.qty), 0)::float8 as qty,
        (array_agg(l.rate::float8 order by d.doc_date desc, d.id desc))[1] as "lastRate",
        (array_agg(d.currency order by d.doc_date desc, d.id desc))[1] as currency,
        to_char(max(d.doc_date), 'YYYY-MM-DD') as "lastOn"
      from book_doc d join book_line l on l.doc_id = d.id left join medicine m on m.id = l.medicine_id
      where d.supplier_id = ${id} and d.kind in ('purchase_order', 'bill') and d.status not in ('void', 'cancelled')
        and coalesce(l.qty, 0) > 0
      group by 1, 2 order by max(d.doc_date) desc, 2 limit 200`,
  );
  return { items };
}

/** The price each medicine was bought at last: from this vendor when one is picked, else from
 *  anyone. For the new purchase order's lines. */
export async function lastRates(db: Database, me: Me, supplierId: number | null): Promise<Record<number, { rate: number; currency: string; on: string; vendor: string | null }>> {
  allow(me, COST_ROLES, "see the purchases");
  const found = await rows<{ medicineId: number; rate: number; currency: string; on: string; vendor: string | null }>(
    db,
    sql`select distinct on (l.medicine_id) l.medicine_id::int as "medicineId", l.rate::float8 as rate, d.currency,
        to_char(d.doc_date, 'YYYY-MM-DD') as on, coalesce(s.name, d.party_name) as vendor
      from book_doc d join book_line l on l.doc_id = d.id left join supplier s on s.id = d.supplier_id
      where d.kind in ('purchase_order', 'bill') and d.status not in ('void', 'cancelled', 'draft') and l.medicine_id is not null
        and coalesce(l.rate, 0) > 0 ${supplierId ? sql`and d.supplier_id = ${supplierId}` : sql``}
      order by l.medicine_id, d.doc_date desc, d.id desc`,
  );
  return Object.fromEntries(found.map(({ medicineId, ...rest }) => [medicineId, rest]));
}
