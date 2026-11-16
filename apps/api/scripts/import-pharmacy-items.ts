// Zoho is closed and this CRM runs alone (Aryan, 17 Nov): the pharmacy's products that Zoho still
// held stock of become items this CRM sells too (docs/PLAN.md 17). Each Zoho item with stock that
// is not already one of the company's medicines is listed as a medicine (category "Pharmacy",
// Zoho's SKU, name, strength, form, molecule, maker, VAT, Zoho's selling price for every kind of
// buyer), and its batches go on the shelf by warehouse from Zoho's own batch records
// (.data/zoho-api/item_batches.jsonl). The books' item is tied to the medicine.
//
//   TEST_PGLITE_DIR=<a local database>   (the API must be stopped)
//   npx tsx scripts/import-pharmacy-items.ts [--apply]
//
// Never point it at the live database without Aryan's word.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { rows } from "../src/db/index";
import { importMedicines, importOpeningStock, type ListMedicine, type OpeningBatch } from "../src/zoho/medicines";
import { openTarget, ROOT, rowsOf, ZOHO_DIR } from "./zoho-files";

const apply = process.argv.includes("--apply");
if (!process.env.TEST_PGLITE_DIR) throw new Error("Give TEST_PGLITE_DIR (a local database); the live database needs Aryan's word.");
const API_DIR = join(ROOT, ".data/zoho-api");
const jsonl = (name: string) =>
  existsSync(join(API_DIR, `${name}.jsonl`))
    ? readFileSync(join(API_DIR, `${name}.jsonl`), "utf8").split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line) as Record<string, unknown>)
    : [];

const listed = jsonl("list_items").filter((item) => Number(item.stock_on_hand ?? 0) > 0);
const warehouses = new Map(jsonl("list_warehouses").map((w) => [String(w.warehouse_id), String(w.warehouse_name)]));
const csv = new Map<string, Record<string, string>>();
for (const row of rowsOf("Item.csv", ZOHO_DIR)) if (!csv.has(row["Item ID"] ?? "")) csv.set(row["Item ID"] ?? "", row);

const target = await openTarget(false);
if (!target) throw new Error("No database.");
const { db } = target;
const known = new Set((await rows<{ sku: string }>(db, sql`select lower(sku) as sku from medicine_sku`)).map((row) => row.sku));

const pesos = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
};
const list: ListMedicine[] = [];
const skuOf = new Map<string, string>();
for (const item of listed) {
  const sku = String(item.sku ?? "").trim();
  if (!sku || known.has(sku.toLowerCase())) continue;
  const row = csv.get(String(item.item_id)) ?? {};
  const price = pesos(item.rate ?? row["Selling Price"]);
  const tax = `${row["Tax Name"] ?? ""} ${row["Tax Percentage"] ?? ""}`.toLowerCase();
  list.push({
    sku: sku.slice(0, 80),
    name: String(item.name ?? row["Item Name"] ?? sku).slice(0, 160),
    generic: row["CF.Molecule"] || null,
    strength: row["CF.Strength"] || null,
    form: row["CF.Medicine Form"] || row["CF.Medicine Form_old"] || null,
    unit: String(item.unit ?? row.Unit ?? "pcs").slice(0, 40),
    pack: row["CF.Packing Type"] || null,
    packSize: 1,
    category: "Pharmacy",
    manufacturer: row.Manufacturer || null,
    brand: "GETMEDS",
    rx: /rx/i.test(row["CF.Product Type"] ?? ""),
    vat: tax.includes("12") ? "vat12" : "exempt",
    listNote: "From Zoho: a pharmacy product that had stock when Zoho was closed",
    prices: { patient: price, hospital: price, doctor: price, distributor: price, drugstore: price },
    packPrices: {},
    srp: price,
  });
  skuOf.set(String(item.item_id), sku.slice(0, 80));
}

// Their batches, from Zoho's batch records: what is left in each warehouse.
const batches: OpeningBatch[] = [];
for (const batch of jsonl("item_batches")) {
  const sku = skuOf.get(String(batch.item_id));
  if (!sku) continue;
  const expiresOn = String(batch.expiry_date ?? "");
  const batchNo = String(batch.batch_number || "NO-BATCH").slice(0, 60);
  for (const place of (batch.associated_warehouses as Record<string, unknown>[] | undefined) ?? []) {
    const qty = Number(place.balance_quantity ?? 0);
    const warehouse = warehouses.get(String(place.warehouse_id));
    if (!(qty > 0) || !warehouse || !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) continue;
    batches.push({ sku, batchNo, expiresOn, warehouse, qty, unitCost: null });
  }
}
console.log(`pharmacy items with stock, not yet medicines: ${list.length}; batch lines: ${batches.length}${apply ? "" : " (dry run)"}`);
console.log("medicines", await importMedicines(db, list, apply));
console.log("shelf", await importOpeningStock(db, batches, apply));
if (apply)
  await db.execute(
    sql`update book_item i set medicine_id = s.medicine_id from medicine_sku s where i.medicine_id is null and i.sku is not null and lower(s.sku) = lower(i.sku)`,
  );
process.exit(0);
