// Buying from abroad. A purchase holds what was ordered, every cost on the way in, and (once
// received) which batch each line became and what one piece of it cost to land.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { Refusal } from "../http";
import { inventoryCan, todayManila } from "../inventory/rules";
import {
  activeWarehouse,
  clean,
  day,
  iso,
  logMove,
  putIn,
  type Runner,
  warehouses,
} from "../inventory/service";
import type {
  CostKind,
  Me,
  PurchaseChoices,
  PurchaseDetail,
  PurchaseInput,
  PurchaseList,
  PurchaseRow,
  PurchaseState,
  Supplier,
} from "../types";
import { landedCosts } from "./landed";

// ---------------------------------------------------------------- suppliers

export const listSuppliers = (db: Runner) =>
  rows<Supplier>(
    db,
    sql`select id::int as id, name, country, currency, contact, active from supplier order by active desc, lower(name)`,
  );

export async function saveSupplier(
  db: Database,
  id: number | null,
  input: {
    name: string;
    country?: string | null;
    currency: string;
    contact?: string | null;
    active?: boolean;
  },
): Promise<number> {
  const name = input.name.trim();
  return db.transaction(async (tx) => {
    const twins = await rows(
      tx,
      sql`select 1 from supplier where lower(name) = ${name.toLowerCase()} and id <> ${id ?? 0}`,
    );
    if (twins.length) throw new Refusal(409, "duplicate", `${name} is already a supplier.`, "name");
    if (id === null) {
      const [made] = await rows<{ id: number }>(
        tx,
        sql`insert into supplier (name, country, currency, contact)
            values (${name}, ${clean(input.country)}, ${input.currency}, ${clean(input.contact)})
            returning id::int as id`,
      );
      return made?.id as number;
    }
    const changed = await rows(
      tx,
      sql`update supplier set name = ${name}, country = ${clean(input.country)}, currency = ${input.currency},
            contact = ${clean(input.contact)}, active = ${input.active ?? true}
          where id = ${id} returning id`,
    );
    if (!changed.length) throw new Refusal(404, "not_found", "No such supplier.");
    return id;
  });
}

// ---------------------------------------------------------------- reading

export async function purchaseChoices(db: Runner): Promise<PurchaseChoices> {
  const [suppliers, places, medicines] = await Promise.all([
    listSuppliers(db),
    warehouses(db),
    rows<PurchaseChoices["medicines"][number]>(
      db,
      sql`select id::int as id, name, strength, pack, unit, pack_size::int as "packSize"
          from medicine where active order by lower(name)`,
    ),
  ]);
  return { suppliers, warehouses: places, medicines };
}

export async function listPurchases(db: Database, me: Me): Promise<PurchaseList> {
  const today = todayManila();
  const list = await rows<PurchaseRow>(
    db,
    sql`select p.id::int as id, p.code, s.name as supplier, s.country, p.state,
          ${day("p.ordered_on")} as "orderedOn", ${day("p.expected_on")} as "expectedOn",
          (p.state = 'ordered' and p.expected_on < ${today}::date) as late,
          coalesce((
            select string_agg(m.name || coalesce(' ' || m.strength, '') || ' × ' || l.qty, ', ' order by l.id)
            from purchase_line l join medicine m on m.id = l.medicine_id
            where l.purchase_id = p.id
          ), '') as lines,
          (p.goods_total + p.extras_total)::int as total
        from purchase p join supplier s on s.id = p.supplier_id
        order by (p.state = 'ordered') desc, p.expected_on desc, p.id desc
        limit 200`,
  );
  return { can: inventoryCan(me), today, rows: list };
}

export async function purchaseDetail(db: Database, me: Me, id: number): Promise<PurchaseDetail> {
  const today = todayManila();
  const [found, lines, costs, choices] = await Promise.all([
    rows<PurchaseDetail["purchase"]>(
      db,
      sql`select p.id::int as id, p.code, p.state, p.supplier_id::int as "supplierId", s.name as supplier, s.country,
            p.warehouse_id::int as "warehouseId", w.name as warehouse,
            ${day("p.ordered_on")} as "orderedOn", ${day("p.expected_on")} as "expectedOn",
            (p.state = 'ordered' and p.expected_on < ${today}::date) as late,
            p.currency, p.fx_rate::float8 as "fxRate", p.supplier_ref as "supplierRef", p.note,
            p.goods_total::int as "goodsTotal", p.extras_total::int as "extrasTotal",
            c.name as "createdBy", r.name as "receivedBy", ${iso("p.received_at")} as "receivedAt"
          from purchase p
          join supplier s on s.id = p.supplier_id
          join warehouse w on w.id = p.warehouse_id
          join person c on c.id = p.created_by
          left join person r on r.id = p.received_by
          where p.id = ${id}`,
    ),
    rows<PurchaseDetail["lines"][number]>(
      db,
      sql`select l.id::int as id, l.medicine_id::int as "medicineId",
            m.name || coalesce(' ' || m.strength, '') as medicine,
            l.qty::int as qty, l.unit_cost::float8 as "unitCost", l.received_qty::int as "receivedQty",
            b.batch_no as "batchNo", ${day("b.expires_on")} as "expiresOn",
            l.goods::int as goods, l.extras::int as extras, l.landed_unit::int as "landedUnit"
          from purchase_line l
          join medicine m on m.id = l.medicine_id
          left join batch b on b.id = l.batch_id
          where l.purchase_id = ${id}
          order by l.id`,
    ),
    rows<PurchaseDetail["costs"][number]>(
      db,
      sql`select kind, amount::int as amount, note from purchase_cost where purchase_id = ${id} order by id`,
    ),
    purchaseChoices(db),
  ]);
  const purchase = found[0];
  if (!purchase) throw new Refusal(404, "not_found", "No such purchase.");
  return { can: inventoryCan(me), today, choices, purchase, lines, costs };
}

// ---------------------------------------------------------------- writing

const extrasOf = (costs: { amount: number }[]) => costs.reduce((sum, cost) => sum + cost.amount, 0);

async function writeCosts(tx: Runner, id: number, costs: PurchaseInput["costs"]): Promise<void> {
  await tx.execute(sql`delete from purchase_cost where purchase_id = ${id}`);
  for (const cost of costs)
    await tx.execute(
      sql`insert into purchase_cost (purchase_id, kind, amount, note)
          values (${id}, ${cost.kind}, ${cost.amount}, ${clean(cost.note)})`,
    );
}

/**
 * Makes a purchase (id null) or changes one. While it is on order everything can change.
 * Once received, the lines are fixed: only the rate, the other costs and the notes can
 * change (a freight bill often comes later), and each batch's landed cost follows.
 */
export async function savePurchase(
  db: Database,
  me: Me,
  id: number | null,
  input: PurchaseInput,
): Promise<number> {
  if (input.expectedOn < input.orderedOn)
    throw new Refusal(400, "invalid", "It can't be expected before it is ordered.", "expectedOn");
  const extras = extrasOf(input.costs);

  return db.transaction(async (tx) => {
    let state: PurchaseState = "ordered";
    if (id !== null) {
      const [now] = await rows<{ state: PurchaseState }>(
        tx,
        sql`select state from purchase where id = ${id} for update`,
      );
      if (!now) throw new Refusal(404, "not_found", "No such purchase.");
      if (now.state === "cancelled")
        throw new Refusal(409, "cancelled", "This purchase was cancelled.");
      state = now.state;
    }

    if (state === "received") {
      const lines = await rows<{ id: number; qty: number; unitCost: number }>(
        tx,
        sql`select id::int as id, coalesce(received_qty, 0)::int as qty, unit_cost::float8 as "unitCost"
            from purchase_line where purchase_id = ${id} order by id`,
      );
      const landed = landedCosts(lines, input.fxRate, extras);
      for (const [index, line] of lines.entries()) {
        const cost = landed[index];
        if (!cost) continue;
        await tx.execute(
          sql`update purchase_line set goods = ${cost.goods}, extras = ${cost.extras}, landed_unit = ${cost.landedUnit}
              where id = ${line.id}`,
        );
        // The batch this line made follows its new cost.
        await tx.execute(
          sql`update batch set unit_cost = ${cost.landedUnit} where purchase_line_id = ${line.id}`,
        );
      }
      await tx.execute(
        sql`update purchase set fx_rate = ${input.fxRate}, supplier_ref = ${clean(input.supplierRef)}, note = ${clean(input.note)},
              goods_total = ${landed.reduce((sum, cost) => sum + cost.goods, 0)}, extras_total = ${extras}
            where id = ${id}`,
      );
      await writeCosts(tx, id as number, input.costs);
      return id as number;
    }

    const [supplier] = await rows(
      tx,
      sql`select 1 from supplier where id = ${input.supplierId} and active`,
    );
    if (!supplier) throw new Refusal(400, "invalid", "Pick a supplier.", "supplierId");
    await activeWarehouse(tx, input.warehouseId, "warehouseId");

    const ids = input.lines.map((line) => line.medicineId);
    if (new Set(ids).size !== ids.length)
      throw new Refusal(
        400,
        "invalid",
        "A medicine is on this purchase twice. Put it on one line.",
        "lines",
      );
    const known = await rows<{ id: number }>(
      tx,
      sql`select id::int as id from medicine where active and id in (${sql.join(
        ids.map((value) => sql`${value}`),
        sql`, `,
      )})`,
    );
    if (known.length !== ids.length)
      throw new Refusal(400, "invalid", "Pick a medicine on every line.", "lines");

    const landed = landedCosts(input.lines, input.fxRate, extras);
    const goodsTotal = landed.reduce((sum, cost) => sum + cost.goods, 0);

    let purchaseId = id;
    if (purchaseId === null) {
      const [made] = await rows<{ id: number }>(
        tx,
        sql`insert into purchase (supplier_id, warehouse_id, ordered_on, expected_on, currency, fx_rate,
              supplier_ref, note, goods_total, extras_total, created_by)
            values (${input.supplierId}, ${input.warehouseId}, ${input.orderedOn}::date, ${input.expectedOn}::date,
              ${input.currency}, ${input.fxRate}, ${clean(input.supplierRef)}, ${clean(input.note)},
              ${goodsTotal}, ${extras}, ${me.id})
            returning id::int as id`,
      );
      purchaseId = made?.id as number;
      await tx.execute(
        sql`update purchase set code = 'PO-' || lpad(id::text, 5, '0') where id = ${purchaseId}`,
      );
    } else {
      await tx.execute(
        sql`update purchase set supplier_id = ${input.supplierId}, warehouse_id = ${input.warehouseId},
              ordered_on = ${input.orderedOn}::date, expected_on = ${input.expectedOn}::date,
              currency = ${input.currency}, fx_rate = ${input.fxRate}, supplier_ref = ${clean(input.supplierRef)},
              note = ${clean(input.note)}, goods_total = ${goodsTotal}, extras_total = ${extras}
            where id = ${purchaseId}`,
      );
      await tx.execute(sql`delete from purchase_line where purchase_id = ${purchaseId}`);
    }
    for (const [index, line] of input.lines.entries()) {
      const cost = landed[index];
      await tx.execute(
        sql`insert into purchase_line (purchase_id, medicine_id, qty, unit_cost, goods, extras, landed_unit)
            values (${purchaseId}, ${line.medicineId}, ${line.qty}, ${line.unitCost},
                    ${cost?.goods ?? 0}, ${cost?.extras ?? 0}, ${cost?.landedUnit ?? 0})`,
      );
    }
    await writeCosts(tx, purchaseId, input.costs);
    return purchaseId;
  });
}

export type ReceiveLine = {
  lineId: number;
  qty: number;
  batchNo?: string | null;
  expiresOn?: string | null;
};

/**
 * The goods arrive. Each line says how many came, their batch number and expiry. The other
 * costs are shared over what actually came, each batch gets its landed cost, and the shelf grows.
 */
export async function receivePurchase(
  db: Database,
  me: Me,
  id: number,
  input: ReceiveLine[],
): Promise<void> {
  const today = todayManila();
  await db.transaction(async (tx) => {
    const [purchase] = await rows<{
      state: PurchaseState;
      code: string;
      warehouseId: number;
      fxRate: number;
    }>(
      tx,
      sql`select state, code, warehouse_id::int as "warehouseId", fx_rate::float8 as "fxRate"
          from purchase where id = ${id} for update`,
    );
    if (!purchase) throw new Refusal(404, "not_found", "No such purchase.");
    if (purchase.state !== "ordered")
      throw new Refusal(409, "not_ordered", `This purchase was already ${purchase.state}.`);

    const lines = await rows<{ id: number; medicineId: number; unitCost: number }>(
      tx,
      sql`select id::int as id, medicine_id::int as "medicineId", unit_cost::float8 as "unitCost"
          from purchase_line where purchase_id = ${id} order by id`,
    );
    const came = lines.map((line, index) => {
      const entry = input.find((row) => row.lineId === line.id);
      const at = input.findIndex((row) => row.lineId === line.id);
      if (!entry)
        throw new Refusal(
          400,
          "invalid",
          "Say how many of every medicine arrived (0 if none).",
          "lines",
        );
      const batchNo = (entry.batchNo ?? "").trim().toUpperCase();
      if (entry.qty > 0) {
        if (!batchNo)
          throw new Refusal(
            400,
            "invalid",
            "Type the batch number on the box.",
            `lines.${at}.batchNo`,
          );
        if (!entry.expiresOn)
          throw new Refusal(400, "invalid", "Pick the expiry date.", `lines.${at}.expiresOn`);
        if (entry.expiresOn < today)
          throw new Refusal(
            400,
            "invalid",
            "This batch has already expired. Expired stock isn't received.",
            `lines.${at}.expiresOn`,
          );
      }
      return { ...line, index, at, qty: entry.qty, batchNo, expiresOn: entry.expiresOn ?? null };
    });
    if (!came.some((line) => line.qty > 0))
      throw new Refusal(400, "invalid", "Nothing arrived? Cancel the purchase instead.", "lines");

    const [{ extras } = { extras: 0 }] = await rows<{ extras: number }>(
      tx,
      sql`select coalesce(sum(amount), 0)::int as extras from purchase_cost where purchase_id = ${id}`,
    );
    const landed = landedCosts(came, purchase.fxRate, extras);

    for (const line of came) {
      const cost = landed[line.index] ?? { goods: 0, extras: 0, landedUnit: 0 };
      let batchId: number | null = null;
      if (line.qty > 0) {
        const [batch] = await rows<{
          id: number;
          expiresOn: string;
          unitCost: number | null;
          onShelf: number;
        }>(
          tx,
          sql`select b.id::int as id, ${day("b.expires_on")} as "expiresOn", b.unit_cost::int as "unitCost",
                coalesce((select sum(qty) from stock where batch_id = b.id), 0)::int as "onShelf"
              from batch b where b.medicine_id = ${line.medicineId} and b.batch_no = ${line.batchNo}`,
        );
        if (batch && batch.expiresOn !== line.expiresOn)
          throw new Refusal(
            409,
            "batch_differs",
            `Batch ${line.batchNo} is already on file with expiry ${batch.expiresOn}. Check the box.`,
            `lines.${line.at}.expiresOn`,
          );
        if (batch) {
          // More of a batch already on the shelf: its cost becomes the average of old and new.
          const average =
            batch.unitCost === null || batch.onShelf === 0
              ? cost.landedUnit
              : Math.round(
                  (batch.onShelf * batch.unitCost + line.qty * cost.landedUnit) /
                    (batch.onShelf + line.qty),
                );
          await tx.execute(sql`update batch set unit_cost = ${average} where id = ${batch.id}`);
          batchId = batch.id;
        } else {
          const [made] = await rows<{ id: number }>(
            tx,
            sql`insert into batch (medicine_id, batch_no, expires_on, unit_cost, purchase_line_id)
                values (${line.medicineId}, ${line.batchNo}, ${line.expiresOn}::date, ${cost.landedUnit}, ${line.id})
                returning id::int as id`,
          );
          batchId = made?.id as number;
        }
        await putIn(tx, batchId, purchase.warehouseId, line.qty);
        await logMove(tx, {
          medicineId: line.medicineId,
          batchId,
          warehouseId: purchase.warehouseId,
          qty: line.qty,
          kind: "receive",
          ref: purchase.code,
          by: me.id,
        });
      }
      await tx.execute(
        sql`update purchase_line set received_qty = ${line.qty}, batch_id = ${batchId},
              goods = ${cost.goods}, extras = ${cost.extras}, landed_unit = ${cost.landedUnit}
            where id = ${line.id}`,
      );
    }
    await tx.execute(
      sql`update purchase set state = 'received', received_by = ${me.id}, received_at = now(),
            goods_total = ${landed.reduce((sum, cost) => sum + cost.goods, 0)}
          where id = ${id}`,
    );
  });
}

export async function cancelPurchase(db: Database, id: number): Promise<void> {
  const done = await rows(
    db,
    sql`update purchase set state = 'cancelled' where id = ${id} and state = 'ordered' returning id`,
  );
  if (!done.length)
    throw new Refusal(409, "not_ordered", "Only a purchase still on order can be cancelled.");
}

export type { CostKind };
