// Inventory's reads and writes. Every write is one transaction: the shelf (`stock`) and its
// history (`stock_move`) change together or not at all, and the shelf can never go below zero.

import { randomUUID } from "node:crypto";
import { type SQL, sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { Refusal } from "../http";
import { offersOf, runningOffers } from "./offers";
import type {
  BuyerType,
  Catalogue,
  CatalogueRow,
  ComingRow,
  InventoryList,
  Me,
  MedicineDetail,
  MedicineInput,
  MedicineRow,
  NewsKind,
  StockNews,
  Warehouse,
} from "../types";
import {
  addDays,
  BUYER_TYPES,
  batchState,
  buyerLabel,
  EXPIRING_DAYS,
  inventoryCan,
  stockStatus,
  todayManila,
} from "./rules";

/** An order (alias `o`) whose pieces are sold but still on the shelf: placed, not packed yet
 *  (held ones too, unless held from a later step). */
export const PROMISED_ORDER = sql`(o.status in ('pending_approval', 'finance_check', 'ready_for_invoice', 'ready_for_dispatch')
  or (o.status in ('on_hold', 'exception') and coalesce(o.held_from, 'pending_approval') in ('pending_approval', 'finance_check', 'ready_for_invoice', 'ready_for_dispatch')))`;
export type Runner = Pick<Database, "execute">;

export const iso = (column: string): SQL =>
  sql.raw(`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`);
export const day = (column: string): SQL => sql.raw(`to_char(${column}, 'YYYY-MM-DD')`);
export const clean = (value: string | null | undefined) => {
  const text = value?.trim();
  return text ? text : null;
};

export async function warehouses(db: Runner): Promise<Warehouse[]> {
  return rows<Warehouse>(
    db,
    sql`select id::int as id, code, name from warehouse where active order by is_default desc, name`,
  );
}

function newsQuery(where: SQL): SQL {
  return sql`
    select n.id::int as id, n.medicine_id::int as "medicineId",
      m.name || coalesce(' ' || m.strength, '') as medicine,
      n.kind, n.message, p.name as by, ${iso("n.created_at")} as at
    from stock_news n
    join medicine m on m.id = n.medicine_id
    join person p on p.id = n.by_person
    where n.closed_at is null and ${where}
    order by n.created_at desc
    limit 30`;
}

export const openNews = (db: Runner) => rows<StockNews>(db, newsQuery(sql`true`));

// ---------------------------------------------------------------- the list

export async function listInventory(db: Database, me: Me): Promise<InventoryList> {
  const today = todayManila();
  const soon = addDays(today, EXPIRING_DAYS);
  const [medicines, stock, coming, expiring, places, news] = await Promise.all([
    rows<{
      id: number;
      code: string;
      name: string;
      strength: string | null;
      pack: string | null;
      unit: string | null;
      packSize: number;
      rx: boolean;
      reorder: number;
    }>(
      db,
      sql`select id::int as id, code, name, strength, pack, unit, pack_size::int as "packSize", rx, reorder_level::int as reorder
          from medicine where active order by lower(name), lower(coalesce(strength, ''))`,
    ),
    rows<{
      medicine: number;
      warehouse: number;
      sellable: number;
      expired: number;
      nearest: string | null;
    }>(
      db,
      sql`select b.medicine_id::int as medicine, s.warehouse_id::int as warehouse,
            coalesce(sum(s.qty) filter (where b.expires_on >= ${today}::date), 0)::int as sellable,
            coalesce(sum(s.qty) filter (where b.expires_on < ${today}::date), 0)::int as expired,
            to_char(min(b.expires_on) filter (where b.expires_on >= ${today}::date), 'YYYY-MM-DD') as nearest
          from stock s join batch b on b.id = s.batch_id
          where s.qty > 0
          group by 1, 2`,
    ),
    rows<{ medicine: number; qty: number; on: string }>(
      db,
      // What is ordered and not yet on the shelf: the purchase orders in Purchases (Zoho's and those
      // made here), and the few made on the first purchase pages.
      sql`select medicine::int as medicine, sum(qty)::int as qty, ${day("min(due)")} as on from (
            select l.medicine_id as medicine, l.qty as qty, p.expected_on as due
              from purchase_line l join purchase p on p.id = l.purchase_id where p.state = 'ordered'
            union all
            select l.medicine_id, (l.qty - coalesce((l.qty_done->>'cancelled')::numeric, 0) - coalesce((l.qty_done->>'received')::numeric, 0)), coalesce(d.due_date, d.doc_date)
              from book_doc d join book_line l on l.doc_id = d.id
          where d.kind = 'purchase_order' and d.status not in ('draft', 'cancelled', 'closed', 'void')
            and l.medicine_id is not null
            and coalesce(d.due_date, d.doc_date) >= ${today}::date - 365
            and l.qty - coalesce((l.qty_done->>'cancelled')::numeric, 0) - coalesce((l.qty_done->>'received')::numeric, 0) > 0
          ) c group by 1`,
    ),
    rows<{ count: number }>(
      db,
      sql`select count(distinct b.id)::int as count
          from batch b join stock s on s.batch_id = b.id
          where s.qty > 0 and b.expires_on >= ${today}::date and b.expires_on <= ${soon}::date`,
    ),
    warehouses(db),
    openNews(db),
  ]);

  const byMedicine = new Map<number, typeof stock>();
  for (const row of stock)
    byMedicine.set(row.medicine, [...(byMedicine.get(row.medicine) ?? []), row]);
  const comingBy = new Map(coming.map((row) => [row.medicine, { qty: row.qty, on: row.on }]));
  // Promised: pieces on placed orders not packed yet (they are still on the shelf, but sold).
  const promisedRows = await rows<{ medicine: number; qty: number; orders: number }>(
    db,
    sql`select i.medicine_id::int as medicine, sum(i.qty)::int as qty, count(distinct o.id)::int as orders
      from order_item i join sales_order o on o.id = i.order_id
      where ${PROMISED_ORDER}
      group by i.medicine_id`,
  );
  const promisedBy = new Map(promisedRows.map((row) => [row.medicine, row]));

  const list: MedicineRow[] = medicines.map((medicine) => {
    const lines = byMedicine.get(medicine.id) ?? [];
    const perWarehouse: Record<number, number> = {};
    let total = 0;
    let expired = 0;
    let nearest: string | null = null;
    for (const line of lines) {
      perWarehouse[line.warehouse] = line.sellable;
      total += line.sellable;
      expired += line.expired;
      if (line.nearest && (!nearest || line.nearest < nearest)) nearest = line.nearest;
    }
    return {
      id: medicine.id,
      code: medicine.code,
      name: medicine.name,
      strength: medicine.strength,
      pack: medicine.pack,
      unit: medicine.unit,
      packSize: medicine.packSize,
      rx: medicine.rx,
      reorderLevel: medicine.reorder,
      stock: perWarehouse,
      total,
      promised: promisedBy.get(medicine.id)?.qty ?? 0,
      promisedOrders: promisedBy.get(medicine.id)?.orders ?? 0,
      free: Math.max(0, total - (promisedBy.get(medicine.id)?.qty ?? 0)),
      expired,
      coming: comingBy.get(medicine.id) ?? null,
      nearestExpiry: nearest,
      expiringSoon: nearest !== null && nearest <= soon,
      status: stockStatus(total, medicine.reorder),
    };
  });

  return {
    can: inventoryCan(me),
    today,
    warehouses: places,
    summary: {
      medicines: list.length,
      out: list.filter((row) => row.status === "out").length,
      low: list.filter((row) => row.status === "low").length,
      expiring: expiring[0]?.count ?? 0,
    },
    medicines: list,
    news,
  };
}

// ---------------------------------------------------------------- all medicines

/** Every medicine with everything known about it: details, every price, promo, stock, cost. */
export async function catalogue(db: Database, me: Me): Promise<Catalogue> {
  const today = todayManila();
  const can = inventoryCan(me);
  const [medicines, prices, promos, shelf] = await Promise.all([
    rows<
      Omit<
        CatalogueRow,
        "prices" | "packPrices" | "promo" | "total" | "status" | "cost" | "reorderLevel"
      > & { reorder: number }
    >(
      db,
      sql`select id::int as id, code, sku, name, generic, strength, form, pack, unit, pack_size::int as "packSize",
            category, manufacturer, brand, rx, vat, cold_chain as "coldChain", cold_box as "coldBox", no_samples as "noSamples", reorder_level::int as reorder
          from medicine where active order by lower(name), lower(coalesce(strength, ''))`,
    ),
    rows<{ medicine: number; buyer: BuyerType; amount: number; pack: number | null }>(
      db,
      sql`select medicine_id::int as medicine, buyer_type as buyer, amount::int as amount, pack_amount::int as pack
          from medicine_price`,
    ),
    rows<{ medicine: number; name: string; amount: number; endsOn: string }>(
      db,
      sql`select distinct on (medicine_id) medicine_id::int as medicine, name, amount::int as amount, ${day("ends_on")} as "endsOn"
          from promo where starts_on <= ${today}::date and ends_on >= ${today}::date
          order by medicine_id, amount`,
    ),
    rows<{ medicine: number; sellable: number; costed: number; costSum: number }>(
      db,
      sql`select b.medicine_id::int as medicine,
            coalesce(sum(s.qty) filter (where b.expires_on >= ${today}::date), 0)::int as sellable,
            coalesce(sum(s.qty) filter (where b.unit_cost is not null), 0)::int as costed,
            coalesce(sum(s.qty::bigint * b.unit_cost) filter (where b.unit_cost is not null), 0)::float8 as "costSum"
          from stock s join batch b on b.id = s.batch_id
          where s.qty > 0
          group by 1`,
    ),
  ]);

  const priceBy = new Map<number, Partial<Record<BuyerType, number>>>();
  const packBy = new Map<number, Partial<Record<BuyerType, number>>>();
  for (const row of prices) {
    priceBy.set(row.medicine, { ...priceBy.get(row.medicine), [row.buyer]: row.amount });
    if (row.pack !== null)
      packBy.set(row.medicine, { ...packBy.get(row.medicine), [row.buyer]: row.pack });
  }
  const promoBy = new Map(
    promos.map((row) => [row.medicine, { name: row.name, amount: row.amount, endsOn: row.endsOn }]),
  );
  const offerBy = await runningOffers(db, today);
  const shelfBy = new Map(shelf.map((row) => [row.medicine, row]));
  // Pieces on placed orders not packed yet: on the shelf, but sold.
  const promised = await rows<{ medicine: number; qty: number }>(
    db,
    sql`select i.medicine_id::int as medicine, sum(i.qty)::int as qty
      from order_item i join sales_order o on o.id = i.order_id where ${PROMISED_ORDER} group by i.medicine_id`,
  );
  const promisedBy = new Map(promised.map((row) => [row.medicine, row.qty]));

  const list: CatalogueRow[] = medicines.map(({ reorder, ...medicine }) => {
    const onShelf = shelfBy.get(medicine.id);
    const held = promisedBy.get(medicine.id) ?? 0;
    const total = onShelf?.sellable ?? 0;
    return {
      ...medicine,
      reorderLevel: reorder,
      prices: priceBy.get(medicine.id) ?? {},
      packPrices: packBy.get(medicine.id) ?? {},
      promo: promoBy.get(medicine.id) ?? null,
      offers: offerBy.get(medicine.id) ?? [],
      total,
      promised: held,
      free: Math.max(0, total - held),
      status: stockStatus(total, reorder),
      cost:
        can.cost && onShelf && onShelf.costed > 0
          ? Math.round(onShelf.costSum / onShelf.costed)
          : null,
    };
  });
  const categories = [
    ...new Set(list.map((row) => row.category).filter((value): value is string => Boolean(value))),
  ].sort();
  return { can, today, buyerTypes: BUYER_TYPES, categories, rows: list };
}

// ---------------------------------------------------------------- one medicine

export async function medicineDetail(db: Database, me: Me, id: number): Promise<MedicineDetail> {
  const today = todayManila();
  const can = inventoryCan(me);
  const [found, batches, prices, promos, coming, moves, changes, places, news] = await Promise.all([
    rows<MedicineDetail["medicine"] & { reorder: number }>(
      db,
      sql`select id::int as id, code, sku, name, generic, strength, form, pack, unit, pack_size::int as "packSize",
            category, manufacturer, brand, rx, vat, cold_chain as "coldChain", cold_box as "coldBox", no_samples as "noSamples", reorder_level::int as reorder, active
          from medicine where id = ${id}`,
    ),
    rows<{
      batchId: number;
      batchNo: string;
      expiresOn: string;
      warehouseId: number;
      qty: number;
      unitCost: number | null;
    }>(
      db,
      sql`select b.id::int as "batchId", b.batch_no as "batchNo", ${day("b.expires_on")} as "expiresOn",
            s.warehouse_id::int as "warehouseId", s.qty::int as qty, b.unit_cost::int as "unitCost"
          from batch b join stock s on s.batch_id = b.id
          where b.medicine_id = ${id} and s.qty > 0
          order by b.expires_on, b.batch_no, s.warehouse_id`,
    ),
    rows<{ buyer: BuyerType; amount: number; pack: number | null }>(
      db,
      sql`select buyer_type as buyer, amount::int as amount, pack_amount::int as pack
          from medicine_price where medicine_id = ${id}`,
    ),
    rows<{ id: number; name: string; amount: number; startsOn: string; endsOn: string }>(
      db,
      sql`select id::int as id, name, amount::int as amount, ${day("starts_on")} as "startsOn", ${day("ends_on")} as "endsOn"
          from promo where medicine_id = ${id} and ends_on >= ${addDays(today, -30)}::date
          order by starts_on desc`,
    ),
    rows<ComingRow>(
      db,
      sql`select * from (
            select p.id::int as "purchaseId", p.code, l.qty::int as qty, w.name as warehouse,
              ${day("p.expected_on")} as "expectedOn", s.name as supplier, (p.expected_on < ${today}::date) as late,
              '/purchases/' || p.id as to
            from purchase_line l
            join purchase p on p.id = l.purchase_id
            join warehouse w on w.id = p.warehouse_id
            join supplier s on s.id = p.supplier_id
            where l.medicine_id = ${id} and p.state = 'ordered'
            union all
            select d.id::int, d.number, (l.qty - coalesce((l.qty_done->>'cancelled')::numeric, 0) - coalesce((l.qty_done->>'received')::numeric, 0))::int, coalesce(w.name, d.fields->>'Warehouse Name', ''),
              ${day("coalesce(d.due_date, d.doc_date)")}, coalesce(s.name, d.party_name, ''), coalesce(d.due_date < ${today}::date, false),
              '/purchases/orders/' || d.id
            from book_doc d join book_line l on l.doc_id = d.id
          left join warehouse w on w.id = d.warehouse_id left join supplier s on s.id = d.supplier_id
          where d.kind = 'purchase_order' and d.status not in ('draft', 'cancelled', 'closed', 'void')
            and l.medicine_id is not null
            and coalesce(d.due_date, d.doc_date) >= ${today}::date - 365
            and l.qty - coalesce((l.qty_done->>'cancelled')::numeric, 0) - coalesce((l.qty_done->>'received')::numeric, 0) > 0
              and l.medicine_id = ${id}
          ) c order by "expectedOn"`,
    ),
    rows<MedicineDetail["moves"][number]>(
      db,
      sql`select v.id::int as id, ${iso("v.at")} as at, v.kind, v.qty::int as qty, b.batch_no as "batchNo",
            w.name as warehouse, v.ref, v.note, p.name as by
          from stock_move v
          join batch b on b.id = v.batch_id
          join warehouse w on w.id = v.warehouse_id
          join person p on p.id = v.by_person
          where v.medicine_id = ${id}
          order by v.at desc, v.id desc
          limit 20`,
    ),
    can.price
      ? rows<MedicineDetail["priceChanges"][number]>(
          db,
          sql`select c.id::int as id, ${iso("c.at")} as at, c.what, c.old_amount::int as old, c.new_amount::int as new, p.name as by
              from price_change c join person p on p.id = c.by_person
              where c.medicine_id = ${id}
              order by c.at desc, c.id desc
              limit 20`,
        )
      : Promise.resolve([]),
    warehouses(db),
    rows<StockNews>(db, newsQuery(sql`n.medicine_id = ${id}`)),
  ]);

  const medicine = found[0];
  if (!medicine) throw new Refusal(404, "not_found", "No such medicine.");
  const { reorder, ...facts } = medicine;

  let total = 0;
  let expired = 0;
  let costed = 0;
  let costSum = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = 0;
  const lines = batches.map((batch) => {
    const state = batchState(batch.expiresOn, today);
    if (state === "expired") expired += batch.qty;
    else total += batch.qty;
    if (batch.unitCost !== null) {
      costed += batch.qty;
      costSum += batch.qty * batch.unitCost;
      min = Math.min(min, batch.unitCost);
      max = Math.max(max, batch.unitCost);
    }
    // What a batch cost is shown only to those who may see costs.
    return { ...batch, unitCost: can.cost ? batch.unitCost : null, state };
  });

  // Pieces on placed orders not packed yet: on the shelf, but sold (as the stock list counts them).
  const [held] = await rows<{ qty: number; orders: number }>(
    db,
    sql`select coalesce(sum(i.qty), 0)::int as qty, count(distinct o.id)::int as orders
      from order_item i join sales_order o on o.id = i.order_id where i.medicine_id = ${id} and ${PROMISED_ORDER}`,
  );
  return {
    can,
    today,
    warehouses: places,
    buyerTypes: BUYER_TYPES,
    medicine: { ...facts, reorderLevel: reorder },
    status: stockStatus(total, reorder),
    total,
    promised: held?.qty ?? 0,
    promisedOrders: held?.orders ?? 0,
    free: Math.max(0, total - (held?.qty ?? 0)),
    expired,
    batches: lines,
    cost: can.cost && costed > 0 ? { min, max, average: Math.round(costSum / costed) } : null,
    prices: Object.fromEntries(prices.map((row) => [row.buyer, row.amount])),
    packPrices: Object.fromEntries(
      prices.filter((row) => row.pack !== null).map((row) => [row.buyer, row.pack]),
    ),
    promos: promos.map((promo) => ({
      ...promo,
      state: promo.endsOn < today ? "ended" : promo.startsOn > today ? "later" : "now",
    })),
    offers: await offersOf(db, id),
    coming,
    moves,
    priceChanges: changes,
    news,
  };
}

export async function activeMedicine(
  db: Runner,
  id: number,
): Promise<{ id: number; name: string }> {
  const [found] = await rows<{ id: number; name: string; active: boolean }>(
    db,
    sql`select id::int as id, name, active from medicine where id = ${id}`,
  );
  if (!found) throw new Refusal(404, "not_found", "No such medicine.");
  if (!found.active) throw new Refusal(409, "inactive", `${found.name} is no longer in the list.`);
  return found;
}

export async function activeWarehouse(db: Runner, id: number, field: string): Promise<Warehouse> {
  const [found] = await rows<Warehouse>(
    db,
    sql`select id::int as id, code, name from warehouse where id = ${id} and active`,
  );
  if (!found) throw new Refusal(400, "invalid", "Pick a warehouse.", field);
  return found;
}

/** Adds a medicine (id null) or changes one. The same name and strength is never listed twice. */
export async function saveMedicine(
  db: Database,
  id: number | null,
  input: MedicineInput,
): Promise<number> {
  const name = input.name.trim();
  const strength = clean(input.strength);
  return db.transaction(async (tx) => {
    const twins = await rows<{ id: number }>(
      tx,
      sql`select id::int as id from medicine
          where lower(name) = ${name.toLowerCase()} and lower(coalesce(strength, '')) = ${(strength ?? "").toLowerCase()}
            and id <> ${id ?? 0}`,
    );
    if (twins.length)
      throw new Refusal(
        409,
        "duplicate",
        `${name}${strength ? ` ${strength}` : ""} is already in the list.`,
        "name",
      );

    const sku = clean(input.sku)?.toUpperCase() ?? null;
    if (sku) {
      const taken = await rows<{ name: string }>(
        tx,
        sql`select name from medicine where id <> ${id ?? 0} and (lower(sku) = ${sku.toLowerCase()}
          or id in (select medicine_id from medicine_sku where lower(sku) = ${sku.toLowerCase()}))`,
      );
      if (taken.length)
        throw new Refusal(409, "duplicate", `SKU ${sku} is already ${taken[0]?.name}'s.`, "sku");
    }

    if (id === null) {
      const [made] = await rows<{ id: number }>(
        tx,
        sql`insert into medicine (name, sku, generic, strength, form, pack, unit, pack_size, category, manufacturer, brand, rx, vat, reorder_level, cold_chain, cold_box)
            values (${name}, ${sku}, ${clean(input.generic)}, ${strength}, ${clean(input.form)}, ${clean(input.pack)},
                    ${clean(input.unit)}, ${input.packSize ?? 1}, ${clean(input.category)}, ${clean(input.manufacturer)}, ${clean(input.brand)},
                    ${input.rx}, ${input.vat}, ${input.reorderLevel}, ${input.coldChain ?? false}, ${input.coldBox ?? false})
            returning id::int as id`,
      );
      const madeId = made?.id as number;
      await tx.execute(
        sql`update medicine set code = 'MED-' || lpad(id::text, 5, '0') where id = ${madeId}`,
      );
      if (sku) await tx.execute(sql`insert into medicine_sku (medicine_id, sku) values (${madeId}, ${sku})`);
      return madeId;
    }
    const changed = await rows(
      tx,
      sql`update medicine set name = ${name}, sku = ${sku}, generic = ${clean(input.generic)}, strength = ${strength},
            form = ${clean(input.form)}, pack = ${clean(input.pack)}, unit = ${clean(input.unit)},
            pack_size = ${input.packSize ?? 1},
            category = ${clean(input.category)}, manufacturer = ${clean(input.manufacturer)}, brand = ${clean(input.brand)},
            rx = ${input.rx}, vat = ${input.vat}, reorder_level = ${input.reorderLevel},
            cold_chain = coalesce(${input.coldChain ?? null}::boolean, cold_chain),
            cold_box = coalesce(${input.coldBox ?? null}::boolean, cold_box),
            no_samples = coalesce(${input.noSamples ?? null}::boolean, no_samples)
          where id = ${id} returning id`,
    );
    if (!changed.length) throw new Refusal(404, "not_found", "No such medicine.");
    // Its SKU now is one of the SKUs it goes by (the ones before stay, for its old orders).
    if (sku)
      await tx.execute(
        sql`insert into medicine_sku (medicine_id, sku) select ${id}, ${sku}
          where not exists (select 1 from medicine_sku where lower(sku) = ${sku.toLowerCase()})`,
      );
    return id;
  });
}

// ---------------------------------------------------------------- prices

/**
 * Sets prices, in centavos. `prices` is the price of ONE piece per kind of buyer; `packPrices`
 * is the price of a whole pack where it isn't simply its pieces added up. `null` takes a price
 * off. A pack price given without a piece price sets the piece price from it. Every change is logged.
 */
export async function setPrices(
  db: Database,
  me: Me,
  medicineId: number,
  prices: Partial<Record<BuyerType, number | null>>,
  packPrices: Partial<Record<BuyerType, number | null>> = {},
): Promise<void> {
  await db.transaction(async (tx) => {
    await activeMedicine(tx, medicineId);
    const [{ packSize } = { packSize: 1 }] = await rows<{ packSize: number }>(
      tx,
      sql`select pack_size::int as "packSize" from medicine where id = ${medicineId}`,
    );
    const now = new Map(
      (
        await rows<{ buyer: BuyerType; amount: number; pack: number | null }>(
          tx,
          sql`select buyer_type as buyer, amount::int as amount, pack_amount::int as pack
              from medicine_price where medicine_id = ${medicineId} for update`,
        )
      ).map((row) => [row.buyer, row]),
    );
    const log = (what: string, old: number | null, next: number | null) =>
      tx.execute(
        sql`insert into price_change (medicine_id, what, old_amount, new_amount, by_person)
            values (${medicineId}, ${what}, ${old}, ${next}, ${me.id})`,
      );

    for (const { key } of BUYER_TYPES) {
      const old = now.get(key);
      const oldPiece = old?.amount ?? null;
      const oldPack = old?.pack ?? null;
      let pack = key in packPrices ? (packPrices[key] ?? null) : oldPack;
      let piece = key in prices ? (prices[key] ?? null) : oldPiece;
      // A pack price alone says what one piece costs.
      if (piece === null && pack !== null && key in packPrices) piece = Math.round(pack / packSize);
      // No piece price: this buyer isn't sold to, so there is no pack price either.
      if (piece === null) pack = null;
      if (piece === oldPiece && pack === oldPack) continue;

      if (piece === null)
        await tx.execute(
          sql`delete from medicine_price where medicine_id = ${medicineId} and buyer_type = ${key}`,
        );
      else
        await tx.execute(
          sql`insert into medicine_price (medicine_id, buyer_type, amount, pack_amount)
              values (${medicineId}, ${key}, ${piece}, ${pack})
              on conflict (medicine_id, buyer_type) do update set amount = excluded.amount, pack_amount = excluded.pack_amount`,
        );
      if (piece !== oldPiece) await log(`${buyerLabel(key)} price`, oldPiece, piece);
      if (pack !== oldPack) await log(`${buyerLabel(key)} price, whole pack`, oldPack, pack);
    }
  });
}

export async function addPromo(
  db: Database,
  me: Me,
  medicineId: number,
  input: { name: string; amount: number; startsOn: string; endsOn: string },
): Promise<void> {
  if (input.endsOn < input.startsOn)
    throw new Refusal(400, "invalid", "The promo can't end before it starts.", "endsOn");
  if (input.endsOn < todayManila())
    throw new Refusal(400, "invalid", "That end date has already passed.", "endsOn");
  await db.transaction(async (tx) => {
    await activeMedicine(tx, medicineId);
    await tx.execute(
      sql`insert into promo (medicine_id, name, amount, starts_on, ends_on, created_by)
          values (${medicineId}, ${input.name.trim()}, ${input.amount}, ${input.startsOn}::date, ${input.endsOn}::date, ${me.id})`,
    );
    await tx.execute(
      sql`insert into price_change (medicine_id, what, old_amount, new_amount, by_person)
          values (${medicineId}, ${`Promo "${input.name.trim()}" ${input.startsOn} to ${input.endsOn}`}, null, ${input.amount}, ${me.id})`,
    );
  });
}

/** Ends a promo as of yesterday (a promo not yet started never runs). */
export async function endPromo(db: Database, me: Me, promoId: number): Promise<void> {
  const yesterday = addDays(todayManila(), -1);
  await db.transaction(async (tx) => {
    const [promo] = await rows<{ medicine: number; name: string; amount: number; endsOn: string }>(
      tx,
      sql`select medicine_id::int as medicine, name, amount::int as amount, ${day("ends_on")} as "endsOn"
          from promo where id = ${promoId} for update`,
    );
    if (!promo) throw new Refusal(404, "not_found", "No such promo.");
    if (promo.endsOn <= yesterday) return;
    await tx.execute(
      sql`update promo set ends_on = ${yesterday}::date, starts_on = least(starts_on, ${yesterday}::date) where id = ${promoId}`,
    );
    await tx.execute(
      sql`insert into price_change (medicine_id, what, old_amount, new_amount, by_person)
          values (${promo.medicine}, ${`Promo "${promo.name}" ended`}, ${promo.amount}, null, ${me.id})`,
    );
  });
}

// ---------------------------------------------------------------- the shelf

export async function putIn(
  tx: Runner,
  batchId: number,
  warehouseId: number,
  qty: number,
): Promise<void> {
  await tx.execute(
    sql`insert into stock (batch_id, warehouse_id, qty) values (${batchId}, ${warehouseId}, ${qty})
        on conflict (batch_id, warehouse_id) do update set qty = stock.qty + excluded.qty`,
  );
}

/** Takes pieces off the shelf only if they are all there: two people can't take the same ones. */
export async function takeOut(
  tx: Runner,
  batchId: number,
  warehouseId: number,
  qty: number,
): Promise<void> {
  const done = await rows(
    tx,
    sql`update stock set qty = qty - ${qty}
        where batch_id = ${batchId} and warehouse_id = ${warehouseId} and qty >= ${qty}
        returning qty`,
  );
  if (!done.length)
    throw new Refusal(
      409,
      "short",
      "There isn't that much of this batch in that warehouse.",
      "qty",
    );
}

export async function logMove(
  tx: Runner,
  move: {
    medicineId: number;
    batchId: number;
    warehouseId: number;
    qty: number;
    kind: "receive" | "move_out" | "move_in" | "count" | "deliver" | "return";
    ref?: string | null;
    note?: string | null;
    by: number;
  },
): Promise<void> {
  await tx.execute(
    sql`insert into stock_move (medicine_id, batch_id, warehouse_id, qty, kind, ref, note, by_person)
        values (${move.medicineId}, ${move.batchId}, ${move.warehouseId}, ${move.qty}, ${move.kind},
                ${move.ref ?? null}, ${move.note ?? null}, ${move.by})`,
  );
}

export type ReceiveInput = {
  medicineId: number;
  warehouseId: number;
  batchNo: string;
  expiresOn: string;
  qty: number;
  ref?: string | null;
  note?: string | null;
  /** What one piece cost to land, in centavos, when it is known. */
  unitCost?: number | null;
};

/**
 * Stock put on the shelf without a purchase: opening stock, or a correction. Stock bought
 * from a supplier is received on its purchase, which works out what it cost to land.
 */
export async function receiveStock(
  db: Database,
  me: Me,
  input: ReceiveInput,
): Promise<{ batchId: number }> {
  const today = todayManila();
  const batchNo = input.batchNo.trim().toUpperCase();
  if (input.expiresOn < today)
    throw new Refusal(
      400,
      "invalid",
      "This batch has already expired. Expired stock isn't received.",
      "expiresOn",
    );

  return db.transaction(async (tx) => {
    await activeMedicine(tx, input.medicineId);
    await activeWarehouse(tx, input.warehouseId, "warehouseId");

    let [batch] = await rows<{ id: number; expiresOn: string }>(
      tx,
      sql`select id::int as id, ${day("expires_on")} as "expiresOn" from batch
          where medicine_id = ${input.medicineId} and batch_no = ${batchNo}`,
    );
    if (batch && batch.expiresOn !== input.expiresOn)
      throw new Refusal(
        409,
        "batch_differs",
        `Batch ${batchNo} is already on file with expiry ${batch.expiresOn}. Check the box.`,
        "expiresOn",
      );
    if (!batch)
      [batch] = await rows<{ id: number; expiresOn: string }>(
        tx,
        sql`insert into batch (medicine_id, batch_no, expires_on, unit_cost)
            values (${input.medicineId}, ${batchNo}, ${input.expiresOn}::date, ${input.unitCost ?? null})
            returning id::int as id, ${day("expires_on")} as "expiresOn"`,
      );
    const batchId = batch?.id as number;
    const ref = clean(input.ref);

    await putIn(tx, batchId, input.warehouseId, input.qty);
    await logMove(tx, {
      medicineId: input.medicineId,
      batchId,
      warehouseId: input.warehouseId,
      qty: input.qty,
      kind: "receive",
      ref,
      note: clean(input.note),
      by: me.id,
    });
    return { batchId };
  });
}

async function batchOf(tx: Runner, batchId: number): Promise<{ id: number; medicineId: number }> {
  const [batch] = await rows<{ id: number; medicineId: number }>(
    tx,
    sql`select id::int as id, medicine_id::int as "medicineId" from batch where id = ${batchId}`,
  );
  if (!batch) throw new Refusal(400, "invalid", "Pick a batch.", "batchId");
  return batch;
}

/** Moves pieces of one batch from one warehouse to another. */
export async function moveStock(
  db: Database,
  me: Me,
  input: {
    batchId: number;
    fromWarehouseId: number;
    toWarehouseId: number;
    qty: number;
    note?: string | null;
  },
): Promise<void> {
  if (input.fromWarehouseId === input.toWarehouseId)
    throw new Refusal(400, "invalid", "Pick a different warehouse to move it to.", "toWarehouseId");
  await db.transaction(async (tx) => {
    const batch = await batchOf(tx, input.batchId);
    await activeWarehouse(tx, input.fromWarehouseId, "fromWarehouseId");
    await activeWarehouse(tx, input.toWarehouseId, "toWarehouseId");
    const ref = `MOVE-${randomUUID().slice(0, 8).toUpperCase()}`;
    const shared = {
      medicineId: batch.medicineId,
      batchId: batch.id,
      ref,
      note: clean(input.note),
      by: me.id,
    };
    await takeOut(tx, batch.id, input.fromWarehouseId, input.qty);
    await logMove(tx, {
      ...shared,
      warehouseId: input.fromWarehouseId,
      qty: -input.qty,
      kind: "move_out",
    });
    await putIn(tx, batch.id, input.toWarehouseId, input.qty);
    await logMove(tx, {
      ...shared,
      warehouseId: input.toWarehouseId,
      qty: input.qty,
      kind: "move_in",
    });
  });
}

/** A stock count: the shelf is set to what was counted; a difference needs its reason. */
export async function countStock(
  db: Database,
  me: Me,
  input: { batchId: number; warehouseId: number; counted: number; reason?: string | null },
): Promise<{ difference: number }> {
  return db.transaction(async (tx) => {
    const batch = await batchOf(tx, input.batchId);
    await activeWarehouse(tx, input.warehouseId, "warehouseId");
    const [shelf] = await rows<{ qty: number }>(
      tx,
      sql`select qty::int as qty from stock where batch_id = ${batch.id} and warehouse_id = ${input.warehouseId} for update`,
    );
    const difference = input.counted - (shelf?.qty ?? 0);
    if (difference === 0) return { difference };
    const reason = clean(input.reason);
    if (!reason)
      throw new Refusal(400, "invalid", "Say why the count differs from the system.", "reason");
    if (difference > 0) await putIn(tx, batch.id, input.warehouseId, difference);
    else await takeOut(tx, batch.id, input.warehouseId, -difference);
    await logMove(tx, {
      medicineId: batch.medicineId,
      batchId: batch.id,
      warehouseId: input.warehouseId,
      qty: difference,
      kind: "count",
      note: reason,
      by: me.id,
    });
    return { difference };
  });
}

// ---------------------------------------------------------------- stock news

/** One open notice per medicine: a new one replaces the one before. */
export async function postNews(
  db: Database,
  me: Me,
  input: { medicineId: number; kind: NewsKind; message?: string | null },
): Promise<void> {
  await db.transaction(async (tx) => {
    await activeMedicine(tx, input.medicineId);
    await tx.execute(
      sql`update stock_news set closed_at = now() where medicine_id = ${input.medicineId} and closed_at is null`,
    );
    await tx.execute(
      sql`insert into stock_news (medicine_id, kind, message, by_person)
          values (${input.medicineId}, ${input.kind}, ${clean(input.message)}, ${me.id})`,
    );
  });
}

export async function closeNews(db: Database, id: number): Promise<void> {
  await db.execute(
    sql`update stock_news set closed_at = now() where id = ${id} and closed_at is null`,
  );
}
