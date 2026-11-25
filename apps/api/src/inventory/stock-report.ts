// The stock report (Inventory → Stock report): every batch in every warehouse where stock is or
// was, as Zoho's "Batch Details Report" lists them, and more: the medicine's SKU, the warehouse,
// the days to expiry, what came in and what went out, what is on the shelf, what placed orders
// have promised of each medicine and so what is free to sell, and, for those who see costs, what
// a piece cost to land and what the shelf is worth. Read from the shelf (`stock`) and its history
// (`stock_move`); the screen and the Excel file get the same rows.
//
// Zoho's report also has the manufacturer's batch number and the manufactured date. A batch here
// doesn't keep them (`batch`, migrations 0002 and 0003), so they aren't in it.

import { type SQL, sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { Refusal } from "../http";
import { type Cell, type Sheet, workbook } from "../reports/xlsx";
import type { Me, Warehouse } from "../types";
import { addDays, batchState, EXPIRING_DAYS, inventoryCan, todayManila } from "./rules";
import { PROMISED_ORDER } from "./service";

export type StockReportAsked = {
  /** One warehouse, or all of them. */
  warehouseId: number | null;
  /** Words to find in the medicine's name, strength, generic name, SKU or code, or the batch number. */
  q: string;
  /** Only the batches that expire within so many days from today; the expired ones come too. */
  within: number | null;
  /** Also the batches with nothing left on the shelf. */
  empty: boolean;
};

/** One batch in one warehouse. Pieces throughout; money in centavos. */
export type StockReportRow = {
  medicineId: number;
  /** Name and strength. */
  medicine: string;
  code: string;
  sku: string | null;
  packSize: number;
  batchId: number;
  batchNo: string;
  expiresOn: string;
  /** Days from today to the expiry; below zero once it has passed. */
  daysToExpiry: number;
  state: "ok" | "soon" | "expired";
  warehouseId: number;
  warehouse: string;
  /** The first day this batch was received into this warehouse (a transfer isn't a receive). */
  receivedOn: string | null;
  /** Who the batch was bought from, when a purchase says so. */
  vendor: string | null;
  /** Received into this warehouse: bought, opening stock, stock added. */
  received: number;
  /** Moved in from (+) or out to (−) other warehouses, net. */
  moved: number;
  /** Packed for orders, less what came back. */
  packed: number;
  /** Given to the reps as samples. */
  samples: number;
  /** What stock counts found over (+) or short (−). */
  counted: number;
  /** On the shelf now: received + moved − packed − samples + counted. */
  onShelf: number;
  /** What one piece cost to land; null when not known, or not the reader's to see. */
  unitCost: number | null;
  /** On the shelf × the cost of one. */
  value: number | null;
};

/** A medicine in the report, over every warehouse whatever the filters. */
export type StockReportMedicine = {
  medicineId: number;
  medicine: string;
  code: string;
  sku: string | null;
  packSize: number;
  /** On the shelf in every warehouse, not expired. */
  sellable: number;
  /** On the shelf in every warehouse, past its expiry. */
  expired: number;
  /** On placed orders not packed yet. */
  promised: number;
  promisedOrders: number;
  /** Sellable less promised, never below zero. */
  free: number;
};

export type StockReportTotals = {
  rows: number;
  batches: number;
  medicines: number;
  received: number;
  moved: number;
  packed: number;
  samples: number;
  counted: number;
  onShelf: number;
  /** Of what is on the shelf: in expired batches, and in batches expiring within EXPIRING_DAYS. */
  expired: number;
  soon: number;
  /** Over the medicines in the report. */
  promised: number;
  free: number;
  /** Null for those who don't see costs. */
  value: number | null;
  expiredValue: number | null;
  /** Pieces on the shelf with no cost on file (not in the value). */
  uncosted: number | null;
};

export type StockReport = {
  today: string;
  /** "Expiring soon" means within this many days. */
  expiringDays: number;
  can: { cost: boolean };
  asked: StockReportAsked;
  warehouses: Warehouse[];
  rows: StockReportRow[];
  medicines: StockReportMedicine[];
  totals: StockReportTotals;
};

/** The filters from the address (?warehouse=&q=&within=&empty=1). */
export function askedOf(query: (name: string) => string | undefined): StockReportAsked {
  const whole = (name: string, min: number, max: number, message: string): number | null => {
    const text = query(name)?.trim();
    if (!text) return null;
    const value = Number(text);
    if (!Number.isInteger(value) || value < min || value > max)
      throw new Refusal(400, "invalid", message, name);
    return value;
  };
  return {
    warehouseId: whole("warehouse", 1, Number.MAX_SAFE_INTEGER, "Pick a warehouse."),
    q: (query("q") ?? "").trim().slice(0, 100),
    within: whole("within", 0, 3650, "Type a number of days, up to 3650."),
    empty: ["1", "true", "yes"].includes((query("empty") ?? "").trim().toLowerCase()),
  };
}

/** A word for LIKE, its wildcards taken literally. */
const like = (word: string) => `%${word.replace(/[\\%_]/g, (found) => `\\${found}`)}%`;

export async function stockReport(
  db: Database,
  me: Me,
  asked: StockReportAsked,
): Promise<StockReport> {
  const today = todayManila();
  const cost = inventoryCan(me).cost;
  const place = asked.warehouseId;

  const where: SQL[] = [];
  if (!asked.empty) where.push(sql`coalesce(s.qty, 0) > 0`);
  if (asked.within !== null)
    where.push(sql`b.expires_on <= ${addDays(today, asked.within)}::date`);
  for (const word of asked.q.split(/\s+/).filter(Boolean))
    where.push(
      sql`(m.name || ' ' || coalesce(m.strength, '') || ' ' || coalesce(m.generic, '') || ' ' || coalesce(m.sku, '') || ' ' || coalesce(m.code, '') || ' ' || b.batch_no) ilike ${like(word)}`,
    );

  const [found, shelf, promised, places] = await Promise.all([
    rows<Omit<StockReportRow, "medicine" | "state" | "value"> & { name: string; strength: string | null }>(
      db,
      // Every batch and warehouse the shelf or its history knows: what each kind of move added up
      // to there, and what is on the shelf now.
      sql`with moved as (
            select batch_id, warehouse_id,
              coalesce(sum(qty) filter (where kind = 'receive'), 0)::int as received,
              coalesce(sum(qty) filter (where kind in ('move_in', 'move_out')), 0)::int as moved,
              coalesce(-sum(qty) filter (where kind in ('deliver', 'return')), 0)::int as packed,
              coalesce(-sum(qty) filter (where kind = 'sample_out'), 0)::int as samples,
              coalesce(sum(qty) filter (where kind = 'count'), 0)::int as counted,
              to_char((min(at) filter (where kind = 'receive')) at time zone 'Asia/Manila', 'YYYY-MM-DD') as received_on
            from stock_move
            ${place ? sql`where warehouse_id = ${place}` : sql``}
            group by batch_id, warehouse_id
          ),
          -- Who each batch was bought from (Zoho's batch report had it): the latest purchase receive,
          -- bill or order whose line carries the batch, read once over the purchase lines.
          vend as (
            select distinct on (medicine_id, batch) medicine_id, batch, vendor from (
              select l.medicine_id, upper(coalesce(bb.batch_no, x.value->>'Batch Reference#')) as batch,
                coalesce(sp.name, d.party_name) as vendor, d.doc_date, d.id
              from book_doc d join book_line l on l.doc_id = d.id left join supplier sp on sp.id = d.supplier_id
                left join batch bb on bb.id = l.batch_id
                left join lateral jsonb_array_elements(case when jsonb_typeof(l.batches) = 'array' then l.batches else '[]'::jsonb end) x on true
              where d.kind in ('purchase_receive', 'bill', 'purchase_order') and d.status not in ('void', 'cancelled', 'draft')
                and l.medicine_id is not null
            ) v where batch is not null and vendor is not null
            order by medicine_id, batch, doc_date desc, id desc
          ),
          places as (
            select batch_id, warehouse_id from stock ${place ? sql`where warehouse_id = ${place}` : sql``}
            union
            select batch_id, warehouse_id from moved
          )
          select m.id::int as "medicineId", m.name, m.strength, coalesce(m.code, '') as code, m.sku,
            m.pack_size::int as "packSize",
            b.id::int as "batchId", b.batch_no as "batchNo", to_char(b.expires_on, 'YYYY-MM-DD') as "expiresOn",
            (b.expires_on - ${today}::date)::int as "daysToExpiry",
            w.id::int as "warehouseId", w.name as warehouse,
            mv.received_on as "receivedOn",
            coalesce(mv.received, 0)::int as received, coalesce(mv.moved, 0)::int as moved,
            coalesce(mv.packed, 0)::int as packed, coalesce(mv.samples, 0)::int as samples,
            coalesce(mv.counted, 0)::int as counted,
            coalesce(s.qty, 0)::int as "onShelf",
            b.unit_cost::int as "unitCost", vd.vendor
          from places k
          join batch b on b.id = k.batch_id
          join medicine m on m.id = b.medicine_id
          join warehouse w on w.id = k.warehouse_id
          left join stock s on s.batch_id = k.batch_id and s.warehouse_id = k.warehouse_id
          left join moved mv on mv.batch_id = k.batch_id and mv.warehouse_id = k.warehouse_id
          left join vend vd on vd.medicine_id = b.medicine_id and vd.batch = upper(b.batch_no)
          ${where.length ? sql`where ${sql.join(where, sql` and `)}` : sql``}
          order by lower(m.name), lower(coalesce(m.strength, '')), m.id, b.expires_on, b.batch_no, lower(w.name)`,
    ),
    rows<{ medicine: number; sellable: number; expired: number }>(
      db,
      sql`select b.medicine_id::int as medicine,
            coalesce(sum(s.qty) filter (where b.expires_on >= ${today}::date), 0)::int as sellable,
            coalesce(sum(s.qty) filter (where b.expires_on < ${today}::date), 0)::int as expired
          from stock s join batch b on b.id = s.batch_id
          where s.qty > 0
          group by 1`,
    ),
    // Pieces on placed orders not packed yet: still on the shelf, but sold (as Stock by warehouse).
    rows<{ medicine: number; qty: number; orders: number }>(
      db,
      sql`select i.medicine_id::int as medicine, sum(i.qty)::int as qty, count(distinct o.id)::int as orders
          from order_item i join sales_order o on o.id = i.order_id
          where ${PROMISED_ORDER}
          group by i.medicine_id`,
    ),
    // The warehouses to pick from: the ones in use, and any other that still holds stock.
    rows<Warehouse>(
      db,
      sql`select id::int as id, code, name from warehouse
          where active or id in (select warehouse_id from stock where qty > 0)
          order by is_default desc, name`,
    ),
  ]);

  const list: StockReportRow[] = found.map(({ name, strength, ...row }) => ({
    medicineId: row.medicineId,
    medicine: `${name}${strength ? ` ${strength}` : ""}`,
    code: row.code,
    sku: row.sku,
    packSize: row.packSize,
    batchId: row.batchId,
    batchNo: row.batchNo,
    expiresOn: row.expiresOn,
    daysToExpiry: row.daysToExpiry,
    state: batchState(row.expiresOn, today),
    warehouseId: row.warehouseId,
    warehouse: row.warehouse,
    receivedOn: row.receivedOn,
    vendor: row.vendor,
    received: row.received,
    moved: row.moved,
    packed: row.packed,
    samples: row.samples,
    counted: row.counted,
    onShelf: row.onShelf,
    // What a batch cost goes only to those who see costs.
    unitCost: cost ? row.unitCost : null,
    value: cost && row.unitCost !== null ? row.onShelf * row.unitCost : null,
  }));

  const shelfBy = new Map(shelf.map((row) => [row.medicine, row]));
  const promisedBy = new Map(promised.map((row) => [row.medicine, row]));
  const medicines: StockReportMedicine[] = [];
  const seen = new Set<number>();
  for (const row of list) {
    if (seen.has(row.medicineId)) continue;
    seen.add(row.medicineId);
    const onShelf = shelfBy.get(row.medicineId);
    const held = promisedBy.get(row.medicineId);
    const sellable = onShelf?.sellable ?? 0;
    medicines.push({
      medicineId: row.medicineId,
      medicine: row.medicine,
      code: row.code,
      sku: row.sku,
      packSize: row.packSize,
      sellable,
      expired: onShelf?.expired ?? 0,
      promised: held?.qty ?? 0,
      promisedOrders: held?.orders ?? 0,
      free: Math.max(0, sellable - (held?.qty ?? 0)),
    });
  }

  const sum = (pick: (row: StockReportRow) => number) =>
    list.reduce((total, row) => total + pick(row), 0);
  const totals: StockReportTotals = {
    rows: list.length,
    batches: new Set(list.map((row) => row.batchId)).size,
    medicines: medicines.length,
    received: sum((row) => row.received),
    moved: sum((row) => row.moved),
    packed: sum((row) => row.packed),
    samples: sum((row) => row.samples),
    counted: sum((row) => row.counted),
    onShelf: sum((row) => row.onShelf),
    expired: sum((row) => (row.state === "expired" ? row.onShelf : 0)),
    soon: sum((row) => (row.state === "soon" ? row.onShelf : 0)),
    promised: medicines.reduce((total, row) => total + row.promised, 0),
    free: medicines.reduce((total, row) => total + row.free, 0),
    value: cost ? sum((row) => row.value ?? 0) : null,
    expiredValue: cost ? sum((row) => (row.state === "expired" ? (row.value ?? 0) : 0)) : null,
    uncosted: cost ? sum((row) => (row.value === null ? row.onShelf : 0)) : null,
  };

  return {
    today,
    expiringDays: EXPIRING_DAYS,
    can: { cost },
    asked,
    warehouses: places,
    rows: list,
    medicines,
    totals,
  };
}

// ---------------------------------------------------------------- the Excel file

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-11-19" as "19 Nov 2026". */
const dayWords = (day: string) => {
  const [year, month, date] = day.split("-");
  return `${Number(date)} ${MONTHS[Number(month) - 1]} ${year}`;
};
/** Centavos as pesos, the centavos kept (the cell shows what its style shows). */
const pesos = (centavos: number | null) => (centavos === null ? null : centavos / 100);
const signed = (value: number) => (value === 0 ? null : value);
const letter = (n: number) => String.fromCharCode(65 + n);

/** The title row across the sheet's columns. */
function titled(text: string, width: number): { row: Cell[]; merge: string } {
  return {
    row: [{ v: text, s: "title" }, ...Array.from({ length: width - 1 }, () => ({ v: "", s: "title" as const }))],
    merge: `A1:${letter(width - 1)}1`,
  };
}

/** The report as sheets: the batches (Zoho's report and more), then free to sell by medicine. */
export function stockReportSheets(report: StockReport): Sheet[] {
  const { asked, totals, can } = report;
  const place = asked.warehouseId
    ? (report.warehouses.find((one) => one.id === asked.warehouseId)?.name ??
      report.rows[0]?.warehouse ??
      "That warehouse")
    : "All warehouses";
  const filters = [
    place,
    asked.within !== null ? `expiring within ${asked.within} days (expired included)` : null,
    asked.q ? `"${asked.q}"` : null,
    asked.empty ? "batches with nothing left included" : null,
  ].filter(Boolean);

  const heads = [
    "Medicine",
    "SKU",
    "Batch",
    "Expiry date",
    "Days to expiry",
    "Expired / soon",
    "Warehouse",
    "First received",
    "Received",
    "Moved in / out",
    "Packed for orders",
    "Samples",
    "Counted ±",
    "On the shelf",
    ...(can.cost ? ["Cost of one (₱)", "Value on the shelf (₱)"] : []),
    "Bought from",
  ];
  const title = titled(`Stock report · ${dayWords(report.today)} · ${filters.join(" · ")}`, heads.length);
  const batches: Sheet = {
    name: "Stock report",
    merges: [title.merge],
    widths: [34, 20, 16, 12, 10, 14, 20, 13, 11, 11, 11, 10, 10, 12, ...(can.cost ? [13, 16] : []), 30],
    rows: [
      title.row,
      heads.map((v) => ({ v, s: "head" as const })),
      ...report.rows.map((row): Cell[] => [
        { v: row.medicine, s: "name" },
        row.sku,
        row.batchNo,
        row.expiresOn,
        { v: row.daysToExpiry, s: "int" },
        row.state === "expired" ? "Expired" : row.state === "soon" ? "Expiring soon" : null,
        row.warehouse,
        row.receivedOn,
        { v: row.received, s: "int" },
        { v: signed(row.moved), s: "int" },
        { v: signed(row.packed), s: "int" },
        { v: signed(row.samples), s: "int" },
        { v: signed(row.counted), s: "int" },
        { v: row.onShelf, s: "int" },
        // The cost of one shows its centavos (the writer's peso style shows whole pesos only).
        ...(can.cost ? [{ v: pesos(row.unitCost), s: "centavos" as const }, { v: pesos(row.value), s: "money" as const }] : []),
        row.vendor,
      ]),
      [
        { v: `Total · ${totals.batches.toLocaleString("en-PH")} batches`, s: "totalName" },
        ...Array.from({ length: 7 }, () => ({ v: "", s: "totalName" as const })),
        { v: totals.received, s: "totalInt" },
        { v: totals.moved, s: "totalInt" },
        { v: totals.packed, s: "totalInt" },
        { v: totals.samples, s: "totalInt" },
        { v: totals.counted, s: "totalInt" },
        { v: totals.onShelf, s: "totalInt" },
        ...(can.cost
          ? [
              { v: "", s: "totalName" as const },
              { v: pesos(totals.value), s: "totalMoney" as const },
            ]
          : []),
      ],
    ],
  };

  const medHeads = [
    "Medicine",
    "SKU",
    "On the shelf (not expired)",
    "Expired on the shelf",
    "Promised",
    "Orders",
    "Free to sell",
  ];
  const medTitle = titled(
    `Free to sell by medicine · all warehouses · ${dayWords(report.today)}`,
    medHeads.length,
  );
  const byMedicine: Sheet = {
    name: "By medicine",
    merges: [medTitle.merge],
    widths: [34, 20, 14, 14, 12, 10, 12],
    rows: [
      medTitle.row,
      medHeads.map((v) => ({ v, s: "head" as const })),
      ...report.medicines.map((row): Cell[] => [
        { v: row.medicine, s: "name" },
        row.sku,
        { v: row.sellable, s: "int" },
        { v: signed(row.expired), s: "int" },
        { v: signed(row.promised), s: "int" },
        { v: signed(row.promisedOrders), s: "int" },
        { v: row.free, s: "int" },
      ]),
      [
        { v: `Total · ${totals.medicines.toLocaleString("en-PH")} medicines`, s: "totalName" },
        { v: "", s: "totalName" },
        { v: report.medicines.reduce((total, row) => total + row.sellable, 0), s: "totalInt" },
        { v: report.medicines.reduce((total, row) => total + row.expired, 0), s: "totalInt" },
        { v: totals.promised, s: "totalInt" },
        // Left blank: one order can carry several medicines, so the orders don't add up.
        { v: "", s: "totalName" },
        { v: totals.free, s: "totalInt" },
      ],
    ],
  };
  return [batches, byMedicine];
}

export const stockReportWorkbook = (report: StockReport): Buffer =>
  workbook(stockReportSheets(report));
