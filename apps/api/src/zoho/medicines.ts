// The company's medicine list (Finance's price list) and what is on the shelf, brought in:
// each medicine with Zoho's SKU (so what it was sold for before finds it), every other SKU it
// went by in Zoho, its price for each kind of buyer, its SRP, and the batches in each warehouse
// as Zoho has them. Safe to run again: a medicine is known by its SKU, a price that did not
// change is left alone (a changed one is logged), and a batch already put on the shelf from
// Zoho is not put there twice.

import { sql } from "drizzle-orm";
import { z } from "zod";
import { type Database, rows } from "../db/index";
import { logMove, putIn } from "../inventory/service";
import type { BuyerType } from "../types";

const text = (max: number) => z.string().max(max).nullish();
const pesos = z.number().min(0).max(10_000_000).nullish();
const BUYERS = ["patient", "hospital", "doctor", "distributor", "drugstore", "bidding"] as const;
const priceSet = z.object({
  patient: pesos,
  hospital: pesos,
  doctor: pesos,
  distributor: pesos,
  drugstore: pesos,
  bidding: pesos,
});

export const listMedicine = z.object({
  /** Zoho's SKU: what the medicine is known by. */
  sku: z.string().min(1).max(80),
  /** Other SKUs the same medicine went by in Zoho. */
  aliases: z.array(z.string().min(1).max(80)).max(20).default([]),
  name: z.string().min(1).max(160),
  generic: text(300),
  strength: text(120),
  form: text(160),
  /** What one piece is called (vial, tablet) and what a pack is ("Box of 30's", 30). */
  unit: text(40),
  pack: text(80),
  packSize: z.number().int().min(1).max(100_000).default(1),
  category: text(120),
  manufacturer: text(160),
  /** Which of the two companies sells it (2MG, GETMEDS). */
  brand: text(80),
  rx: z.boolean(),
  vat: z.enum(["exempt", "vat12", "zero"]),
  shelfLifeMonths: z.number().int().min(1).max(240).nullish(),
  coldChain: z.boolean().default(false),
  listNote: text(200),
  /** Pesos for one piece, per kind of buyer; and for a whole pack where the list gives one. */
  prices: priceSet,
  packPrices: priceSet.default({}),
  /** The suggested retail price: pesos for one piece and for a pack. */
  srp: pesos,
  srpPack: pesos,
});
export type ListMedicine = z.input<typeof listMedicine>;

export const openingBatch = z.object({
  sku: z.string().min(1).max(80),
  batchNo: z.string().min(1).max(80),
  expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** The warehouse's name as Zoho has it. */
  warehouse: z.string().min(1).max(120),
  qty: z.number().min(0),
  /** Pesos one piece cost, when Zoho knows it. */
  unitCost: pesos,
});
export type OpeningBatch = z.infer<typeof openingBatch>;

const clip = (value: string | null | undefined, max: number) => {
  const clean = (value ?? "").replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, max) : null;
};
const centavos = (value: number | null | undefined) =>
  value === null || value === undefined ? null : Math.round(value * 100);

async function adminId(db: Database): Promise<number> {
  const [admin] = await rows<{ id: number }>(
    db,
    sql`select id::int as id from person where role = 'admin' and active order by id limit 1`,
  );
  if (!admin) throw new Error("No admin in this CRM.");
  return admin.id;
}

/** The medicine a SKU belongs to: its own, or one it went by before. */
const medicineOfSku = async (db: Pick<Database, "execute">, sku: string) =>
  (
    await rows<{ id: number }>(
      db,
      sql`select coalesce(
          (select medicine_id from medicine_sku where lower(sku) = ${sku.toLowerCase()}),
          (select id from medicine where lower(sku) = ${sku.toLowerCase()}))::int as id`,
    )
  )[0]?.id ?? null;

export type MedicinesResult = {
  medicines: number;
  made: number;
  updated: number;
  /** Prices set or changed (each one logged). */
  prices: number;
  /** Other SKUs now pointing at a medicine. */
  aliases: number;
  /** Left out, and why. */
  problems: string[];
};

/** Brings the price list's medicines in, each known by its SKU. */
export async function importMedicines(
  db: Database,
  list: ListMedicine[],
  apply: boolean,
): Promise<MedicinesResult> {
  const admin = await adminId(db);
  const said: MedicinesResult = { medicines: list.length, made: 0, updated: 0, prices: 0, aliases: 0, problems: [] };
  for (const raw of list) {
    const one = listMedicine.parse(raw);
    const sku = one.sku.trim().toUpperCase();
    const name = clip(one.name, 120) as string;
    const strength = clip(one.strength, 80);
    const id = await medicineOfSku(db, sku);
    const [twin] = await rows<{ id: number; sku: string | null }>(
      db,
      sql`select id::int as id, sku from medicine
        where lower(name) = ${name.toLowerCase()} and lower(coalesce(strength, '')) = ${(strength ?? "").toLowerCase()}
          and id <> ${id ?? 0}`,
    );
    if (twin) {
      said.problems.push(`${name}${strength ? ` ${strength}` : ""} (${sku}) is already listed${twin.sku ? ` as ${twin.sku}` : ""}`);
      continue;
    }
    if (id) said.updated += 1;
    else said.made += 1;
    const now = id
      ? new Map(
          (
            await rows<{ buyer: BuyerType; amount: number; pack: number | null }>(
              db,
              sql`select buyer_type as buyer, amount::int as amount, pack_amount::int as pack from medicine_price where medicine_id = ${id}`,
            )
          ).map((row) => [row.buyer, row]),
        )
      : new Map<BuyerType, { amount: number; pack: number | null }>();
    const changes = BUYERS.map((buyer) => {
      const amount = centavos(one.prices[buyer]);
      const pack = amount === null ? null : centavos(one.packPrices[buyer]);
      const old = now.get(buyer);
      return { buyer, amount, pack, oldAmount: old?.amount ?? null, oldPack: old?.pack ?? null };
      // A kind of buyer the list has no price for keeps whatever was set here by hand.
    }).filter((row) => row.amount !== null && (row.amount !== row.oldAmount || row.pack !== row.oldPack));
    said.prices += changes.length;
    if (!apply) {
      said.aliases += one.aliases.length;
      continue;
    }

    await db.transaction(async (tx) => {
      const facts = sql`name = ${name}, sku = ${sku}, generic = ${clip(one.generic, 200)}, strength = ${strength},
        form = ${clip(one.form, 120)}, pack = ${clip(one.pack, 60)}, unit = ${clip(one.unit, 30)}, pack_size = ${one.packSize},
        category = ${clip(one.category, 80)}, manufacturer = ${clip(one.manufacturer, 120)}, brand = ${clip(one.brand, 60)},
        rx = ${one.rx}, vat = ${one.vat}, srp = ${centavos(one.srp)}, srp_pack = ${centavos(one.srpPack)},
        shelf_life_months = ${one.shelfLifeMonths ?? null}, cold_chain = ${one.coldChain}, list_note = ${clip(one.listNote, 160)}`;
      let medicineId = id;
      if (medicineId) await tx.execute(sql`update medicine set ${facts}, active = true where id = ${medicineId}`);
      else {
        const [made] = await rows<{ id: number }>(
          tx,
          sql`insert into medicine (name, rx, vat) values (${name}, ${one.rx}, ${one.vat}) returning id::int as id`,
        );
        medicineId = made?.id as number;
        await tx.execute(
          sql`update medicine set ${facts}, code = 'MED-' || lpad(id::text, 5, '0') where id = ${medicineId}`,
        );
      }
      for (const alias of [sku, ...one.aliases.map((other) => other.trim())]) {
        const [owner] = await rows<{ id: number }>(
          tx,
          sql`select medicine_id::int as id from medicine_sku where lower(sku) = ${alias.toLowerCase()}`,
        );
        if (owner && owner.id !== medicineId) {
          said.problems.push(`${alias} already belongs to another medicine, not ${name}`);
          continue;
        }
        if (!owner) {
          await tx.execute(sql`insert into medicine_sku (medicine_id, sku) values (${medicineId}, ${alias})`);
          if (alias !== sku) said.aliases += 1;
        }
      }
      for (const change of changes) {
        await tx.execute(
          sql`insert into medicine_price (medicine_id, buyer_type, amount, pack_amount)
            values (${medicineId}, ${change.buyer}, ${change.amount}, ${change.pack})
            on conflict (medicine_id, buyer_type) do update set amount = excluded.amount, pack_amount = excluded.pack_amount`,
        );
        if (change.amount !== change.oldAmount)
          await tx.execute(
            sql`insert into price_change (medicine_id, what, old_amount, new_amount, by_person)
              values (${medicineId}, ${`${change.buyer[0]?.toUpperCase()}${change.buyer.slice(1)} price (price list)`}, ${change.oldAmount}, ${change.amount}, ${admin})`,
          );
      }
    });
  }
  return said;
}

export type OpeningStockResult = {
  batches: number;
  /** Put on the shelf now, and the pieces in them. */
  put: number;
  pieces: number;
  alreadyHere: number;
  /** A batch of a medicine that is not in the list. */
  noMedicine: number;
  /** Warehouses made for it. */
  warehouses: string[];
};

/** Puts Zoho's batches on the shelf, each in its warehouse, once. A batch already brought from
 *  Zoho is left as it is: from then on the shelf is this CRM's to keep. */
export async function importOpeningStock(
  db: Database,
  batches: OpeningBatch[],
  apply: boolean,
): Promise<OpeningStockResult> {
  const admin = await adminId(db);
  const said: OpeningStockResult = { batches: batches.length, put: 0, pieces: 0, alreadyHere: 0, noMedicine: 0, warehouses: [] };
  const places = new Map(
    (
      await rows<{ id: number; name: string; code: string }>(db, sql`select id::int as id, name, code from warehouse`)
    ).map((row) => [row.name.toLowerCase(), row.id]),
  );
  const codes = new Set(
    (await rows<{ code: string }>(db, sql`select code from warehouse`)).map((row) => row.code),
  );
  const [main] = await rows<{ id: number }>(db, sql`select id::int as id from warehouse where is_default`);
  let hasDefault = Boolean(main);

  for (const raw of batches) {
    const one = openingBatch.parse(raw);
    const qty = Math.round(one.qty);
    if (!(qty > 0)) continue;
    const medicineId = await medicineOfSku(db, one.sku);
    if (!medicineId) {
      said.noMedicine += 1;
      continue;
    }
    const place = clip(one.warehouse, 80) as string;
    let warehouseId = places.get(place.toLowerCase());
    if (!warehouseId) {
      said.warehouses.push(place);
      if (apply) {
        let code = place.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "WAREHOUSE";
        for (let n = 2; codes.has(code); n++) code = `${code.replace(/-\d+$/, "")}-${n}`;
        codes.add(code);
        const [made] = await rows<{ id: number }>(
          db,
          sql`insert into warehouse (code, name, is_default) values (${code}, ${place}, ${!hasDefault}) returning id::int as id`,
        );
        hasDefault = true;
        warehouseId = made?.id as number;
      } else warehouseId = -said.warehouses.length;
      places.set(place.toLowerCase(), warehouseId);
    }
    const batchNo = one.batchNo.trim().toUpperCase().slice(0, 60);
    const [batch] = await rows<{ id: number }>(
      db,
      sql`select id::int as id from batch where medicine_id = ${medicineId} and batch_no = ${batchNo}`,
    );
    if (batch && warehouseId > 0) {
      const [moved] = await rows<{ id: number }>(
        db,
        sql`select id::int as id from stock_move where batch_id = ${batch.id} and warehouse_id = ${warehouseId} and ref = 'ZOHO' limit 1`,
      );
      if (moved) {
        said.alreadyHere += 1;
        continue;
      }
    }
    said.put += 1;
    said.pieces += qty;
    if (!apply) continue;
    await db.transaction(async (tx) => {
      const batchId =
        batch?.id ??
        (
          await rows<{ id: number }>(
            tx,
            sql`insert into batch (medicine_id, batch_no, expires_on, unit_cost)
              values (${medicineId}, ${batchNo}, ${one.expiresOn}::date, ${centavos(one.unitCost)}) returning id::int as id`,
          )
        )[0]?.id;
      await putIn(tx, batchId as number, warehouseId as number, qty);
      await logMove(tx, {
        medicineId,
        batchId: batchId as number,
        warehouseId: warehouseId as number,
        qty,
        kind: "receive",
        ref: "ZOHO",
        note: "Opening stock from Zoho",
        by: admin,
      });
    });
  }
  return said;
}
