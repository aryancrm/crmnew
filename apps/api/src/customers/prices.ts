// What a customer was given before, medicine by medicine: the date, the order, how many, the
// price for one, and what came free (a buy-one-get-one is a paid line and a free line of the same
// medicine). It reads this CRM's own orders and the ones brought from Zoho (past_order) as one
// history, so Management deciding on an order sees the old price without opening Zoho. A Zoho
// line is tied to a medicine here by its SKU; until the medicine is listed here it stands under
// its own name.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { duesSql } from "../finance/dues";
import { todayManila } from "../inventory/rules";
import { orderDetail } from "../orders/service";
import type { CustomerPrices, Me, MedicinePrices, OrderPrices } from "../types";
import { customerDetail } from "./service";

/** Rows kept per medicine (the newest), and medicines per customer. Totals count everything. */
const ROWS = 60;
const MEDICINES = 300;
const PAST_ORDERS = 100;

type Line = {
  from: "crm" | "zoho";
  orderId: number | null;
  code: string;
  at: string;
  medicineId: number | null;
  sku: string | null;
  name: string;
  unit: string | null;
  qty: number;
  unitPrice: number;
  free: boolean;
};

const keyOf = (line: Pick<Line, "medicineId" | "sku" | "name">) =>
  line.medicineId
    ? `m:${line.medicineId}`
    : line.sku
      ? `s:${line.sku.toLowerCase()}`
      : `n:${line.name.toLowerCase()}`;

/** Every line this customer was sold, newest first; `before` leaves out an order of this CRM and
 *  the ones placed after it. */
const linesOf = (db: Database, customerId: number, before?: number) =>
  rows<Line>(
    db,
    sql`select * from (
        select 'crm' as "from", o.id::int as "orderId", o.code,
          to_char(coalesce(o.submitted_at, o.created_at) at time zone 'Asia/Manila', 'YYYY-MM-DD') as at,
          m.id::int as "medicineId", m.sku, m.name || coalesce(' ' || m.strength, '') as name, m.unit,
          i.qty::int as qty, i.unit_price::int as "unitPrice", i.free, i.id as line
        from order_item i join sales_order o on o.id = i.order_id join medicine m on m.id = i.medicine_id
        where o.customer_id = ${customerId} and o.status not in ('draft', 'cancelled')
          ${before ? sql`and o.id < ${before}` : sql``}
        union all
        select 'zoho', null, p.code, to_char(p.ordered_on, 'YYYY-MM-DD'),
          m.id::int, coalesce(m.sku, i.sku), coalesce(m.name || coalesce(' ' || m.strength, ''), i.name), coalesce(m.unit, i.unit),
          i.qty::int, i.unit_price::int, i.free, i.id
        from past_order_item i join past_order p on p.id = i.past_order_id
          -- The medicine a Zoho line is: by its SKU, or any SKU the medicine went by before.
          left join lateral (select coalesce(
              (select k.medicine_id from medicine_sku k where lower(k.sku) = lower(i.sku)),
              (select d.id from medicine d where lower(d.sku) = lower(i.sku))) as id) known on i.sku is not null
          left join medicine m on m.id = known.id
        where p.customer_id = ${customerId} and p.status <> 'void'
      ) found
      order by at desc, "from", code desc, line`,
  );

/** The lines as one history per medicine: one row per order and price, the free pieces beside
 *  the paid ones of the same order. */
export function byMedicine(lines: Line[]): MedicinePrices[] {
  const found = new Map<string, MedicinePrices & { orders: Set<string> }>();
  for (const line of lines) {
    const key = keyOf(line);
    let one = found.get(key);
    if (!one) {
      one = {
        key,
        medicineId: line.medicineId,
        sku: line.sku,
        name: line.name,
        unit: line.unit,
        times: 0,
        qty: 0,
        freeQty: 0,
        lastAt: line.at,
        lastPrice: null,
        rows: [],
        orders: new Set(),
      };
      found.set(key, one);
    }
    const order = `${line.from}:${line.code}`;
    one.orders.add(order);
    one.qty += line.qty;
    if (line.free) one.freeQty += line.qty;
    else if (one.lastPrice === null) one.lastPrice = line.unitPrice;
    // The same order again: its free pieces join the paid row, a second paid price is its own row.
    const same = one.rows.filter((row) => `${row.from}:${row.code}` === order);
    const row = line.free
      ? same[0]
      : same.find((mate) => mate.unitPrice === line.unitPrice || mate.unitPrice === null);
    if (row) {
      if (line.free) row.freeQty += line.qty;
      else {
        row.qty += line.qty;
        row.unitPrice = line.unitPrice;
      }
    } else if (one.rows.length < ROWS || same.length > 0)
      one.rows.push({
        at: line.at,
        code: line.code,
        orderId: line.orderId,
        from: line.from,
        qty: line.free ? 0 : line.qty,
        freeQty: line.free ? line.qty : 0,
        unitPrice: line.free ? null : line.unitPrice,
      });
  }
  return [...found.values()].map(({ orders, ...one }) => ({ ...one, times: orders.size }));
}

const pastOf = async (db: Database, customerId: number) => {
  const [past] = await rows<CustomerPrices["past"]>(
    db,
    sql`select count(*)::int as orders, coalesce(sum(total), 0)::float8 as bought,
        to_char(min(ordered_on), 'YYYY-MM-DD') as "firstOn", to_char(max(ordered_on), 'YYYY-MM-DD') as "lastOn"
      from past_order where customer_id = ${customerId} and status <> 'void'`,
  );
  return past ?? { orders: 0, bought: 0, firstOn: null, lastOn: null };
};

/** A customer's prices: every medicine they were sold and at what, and their orders from before
 *  this CRM. Whoever may see the customer may see it. */
export async function customerPrices(db: Database, me: Me, id: number): Promise<CustomerPrices> {
  await customerDetail(db, me, id);
  const [lines, past, under, owes, orders] = await Promise.all([
    linesOf(db, id),
    pastOf(db, id),
    // Whose customer it was in Zoho: the salesperson of the latest order that names one.
    rows<Pick<CustomerPrices["zoho"], "seller" | "division" | "subDivision" | "headquarter">>(
      db,
      sql`select seller, division, sub_division as "subDivision", headquarter from zoho_contact
        where customer_id = ${id} and (seller is not null or division is not null)
        order by seller_on desc nulls last limit 1`,
    ),
    // What Zoho's invoices still owe: the books (payments taken here on them count), plus what Zoho
    // Books kept as the customer's opening balance.
    rows<Pick<CustomerPrices["zoho"], "owed" | "openInvoices" | "oldestDue">>(
      db,
      sql`select (coalesce(sum(round(d.balance * d.fx_rate)), 0) + (select opening_receivables from customer where id = ${id}))::float8 as owed,
          count(d.id)::int as "openInvoices", to_char(min(d.due_date), 'YYYY-MM-DD') as "oldestDue"
        from book_doc d where d.customer_id = ${id} and d.kind = 'invoice' and d.zoho_id is not null and d.balance > 0 and d.status not in ('void', 'draft')`,
    ),
    rows<CustomerPrices["orders"][number]>(
      db,
      sql`select p.id::int as id, p.code, to_char(p.ordered_on, 'YYYY-MM-DD') as "on", p.status, p.total::float8 as total, p.seller,
          (select string_agg(i.name || ' × ' || i.qty || case when i.free then ' (free)' else '' end, ', ' order by i.id)
            from past_order_item i where i.past_order_id = p.id) as medicines
        from past_order p where p.customer_id = ${id}
        order by p.ordered_on desc, p.id desc limit ${PAST_ORDERS}`,
    ),
  ]);
  return {
    past,
    zoho: {
      seller: under[0]?.seller ?? null,
      division: under[0]?.division ?? null,
      subDivision: under[0]?.subDivision ?? null,
      headquarter: under[0]?.headquarter ?? null,
      owed: owes[0]?.owed ?? 0,
      openInvoices: owes[0]?.openInvoices ?? 0,
      oldestDue: owes[0]?.oldestDue ?? null,
    },
    orders,
    medicines: byMedicine(lines).slice(0, MEDICINES),
  };
}

/** For an order being decided: what this customer was given before for each of its medicines,
 *  and the customer in short. Whoever may open the order may see it. */
export async function orderPrices(db: Database, me: Me, id: number): Promise<OrderPrices> {
  const detail = await orderDetail(db, me, id);
  const customerId = detail.order.customerId;
  const today = todayManila();
  const [lines, past, own, dues] = await Promise.all([
    linesOf(db, customerId, id),
    pastOf(db, customerId),
    rows<{ orders: number; bought: number; lastAt: string | null; firstAt: string | null }>(
      db,
      sql`select count(*)::int as orders, coalesce(sum(total), 0)::float8 as bought,
          to_char(max(coalesce(submitted_at, created_at)) at time zone 'Asia/Manila', 'YYYY-MM-DD') as "lastAt",
          to_char(min(coalesce(submitted_at, created_at)) at time zone 'Asia/Manila', 'YYYY-MM-DD') as "firstAt"
        from sales_order where customer_id = ${customerId} and id < ${id} and status not in ('draft', 'cancelled')`,
    ),
    // What they owe now, wherever it was billed (this CRM, Zoho's invoices, Zoho's opening balance).
    rows<{ owed: number; overdue: number; days: number; zoho: number }>(
      db,
      sql`select coalesce(sum(dd.balance) filter (where not dd.cod_waiting), 0)::float8 as owed,
          coalesce(sum(dd.balance) filter (where not dd.on_delivery and dd.late > 0), 0)::float8 as overdue,
          coalesce(max(dd.late) filter (where not dd.on_delivery and dd.late > 0), 0)::int as days,
          coalesce(sum(dd.balance) filter (where dd.source <> 'crm'), 0)::float8 as zoho
        from ${duesSql(today)} dd where dd.customer_id = ${customerId}`,
    ),
  ]);
  const medicines = byMedicine(lines);
  const found = new Map(medicines.map((one) => [one.key, one]));
  const days = [past.firstOn, own[0]?.firstAt, past.lastOn, own[0]?.lastAt].filter(
    (day): day is string => Boolean(day),
  );
  return {
    customer: {
      id: customerId,
      orders: past.orders + (own[0]?.orders ?? 0),
      bought: past.bought + (own[0]?.bought ?? 0),
      firstOn: days.length ? days.reduce((a, b) => (a < b ? a : b)) : null,
      lastOn: days.length ? days.reduce((a, b) => (a > b ? a : b)) : null,
      lastCode: lines[0]?.code ?? null,
      crmOrders: own[0]?.orders ?? 0,
      zohoOrders: past.orders,
      owed: dues[0]?.owed ?? 0,
      overdue: dues[0]?.overdue ?? 0,
      overdueDays: dues[0]?.days ?? 0,
      zohoOwed: dues[0]?.zoho ?? 0,
      top: [...medicines]
        .sort((a, b) => b.times - a.times || (a.lastAt < b.lastAt ? 1 : -1))
        .slice(0, 5)
        .map((one) => ({
          key: one.key,
          name: one.name,
          times: one.times,
          qty: one.qty,
          unit: one.unit,
          lastPrice: one.lastPrice,
        })),
    },
    lines: Object.fromEntries(
      detail.items.map((item) => [
        item.id,
        found.get(`m:${item.medicineId}`) ??
          (item.sku ? found.get(`s:${item.sku.toLowerCase()}`) : undefined) ??
          null,
      ]),
    ),
  };
}
