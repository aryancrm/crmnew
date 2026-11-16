// Brings the company's medicine list in from Finance's price list (the Excel file, its current
// sheet), each medicine tied to its item in Zoho: Zoho's SKU (so what it was sold for before
// finds it), the other SKUs it went by there, who makes it, what it cost, and the batches on the
// shelf in each warehouse. Prices come from the price list: doctor, patient, distributor,
// drugstore and hospital (one column in the list), and the SRP.
//
//   PRICE_LIST=<the .xlsx>     (default: crmnew/.data/lists/price-list-2026.xlsx)
//   PRICE_SHEET=<sheet name>   (default: Pricelist02.2026)
//   ZOHO_DIR=<the unpacked backup>, with Batches.json beside Item.csv when the shelf is brought too
//   npx tsx scripts/import-medicines.ts [--apply] [--memory] [--items]
//
// Dry run by default; --apply writes. With no database it prints each medicine and the Zoho
// item it was tied to, to look over. --items writes the Zoho items to fetch batches for.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  importMedicines,
  importOpeningStock,
  type ListMedicine,
  type OpeningBatch,
  listMedicine,
  openingBatch,
} from "../src/zoho/medicines";
import { readXlsx } from "./xlsx";
import { numberOf, openTarget, ROOT, rowsOf, said, ZOHO_DIR } from "./zoho-files";

const apply = process.argv.includes("--apply");
const memory = process.argv.includes("--memory");
const file = process.env.PRICE_LIST ?? join(ROOT, ".data/lists/price-list-2026.xlsx");
const sheetName = process.env.PRICE_SHEET ?? "Pricelist02.2026";

// ---------------------------------------------------------------- Zoho's items

type Item = {
  id: string;
  sku: string;
  /** The code at the front of Zoho's SKU ("GM-3249 ( 200 mg 10's )" → GM-3249). */
  code: string;
  name: string;
  strength: string;
  molecule: string;
  maker: string;
  type: string;
  active: boolean;
  stock: number;
  rate: number;
  cost: number;
  sold: number;
  lastSold: string;
};
const items = new Map<string, Item>();
for (const row of rowsOf("Item.csv")) {
  const id = said(row["Item ID"]);
  if (!id || items.has(id)) continue;
  const sku = said(row.SKU);
  items.set(id, {
    id,
    sku,
    code: (sku.split(/[\s(]/)[0] ?? sku).toUpperCase(),
    name: said(row["Item Name"]),
    strength: said(row["CF.Strength"]),
    molecule: said(row["CF.Molecule"]),
    maker: said(row.Manufacturer),
    type: said(row["CF.Product Type"]),
    active: said(row.Status) === "Active",
    stock: numberOf(row["Stock On Hand"]),
    rate: numberOf(row["Selling Price"]),
    cost: numberOf(row["Purchase Price"]),
    sold: 0,
    lastSold: "",
  });
}
const bySku = new Map([...items.values()].map((item) => [item.sku.toLowerCase(), item]));
const byCode = new Map<string, Item[]>();
for (const item of items.values()) byCode.set(item.code, [...(byCode.get(item.code) ?? []), item]);
for (const row of rowsOf("Sales_Order")) {
  const status = said(row.Status);
  const item = bySku.get(said(row.SKU).toLowerCase());
  if (!item || status === "void" || status === "draft") continue;
  item.sold += 1;
  if (said(row["Order Date"]) > item.lastSold) item.lastSold = said(row["Order Date"]);
}

// ---------------------------------------------------------------- the price list

/** Rows the names alone do not settle (two items under one name, a list name that differs from
 *  Zoho's): the Zoho item it is, and the other items that are the same medicine. Looked up one
 *  by one against Zoho's items, their strength, price and what is on the shelf. */
const TIED: Record<string, { is: string; also?: string[] }> = {
  "sugamaget 200 [field]": { is: "GM-4526", also: ["GM-4313"] },
  "kontra [b2b/bid]": { is: "GM-4494" },
  "superflora gg stick": { is: "GM-4620" },
  "superflora gg": { is: "GM-4599" },
  "superflora w11": { is: "GM-4600" },
  "epriget 5000 iu": { is: "GM-4594" },
  "epriget 25k iu": { is: "GM-4625" },
  zologet: { is: "GM-4317", also: ["GM-3489"] },
  "doseget-20": { is: "GM-4404" },
  "doseget-80": { is: "GM-4405" },
  "doseget-120": { is: "GM-4386" },
  "doseget 20mg": { is: "GM-4605" },
  "doseget 80mg": { is: "GM-4606" },
  midaget: { is: "GM-4624" },
  getmeds: { is: "GM-4336" },
  "getmeds -": { is: "GM-4337" },
  "getmeds / g20, g22": { is: "GM-4368", also: ["GM-4406"] },
  "getmeds / g24": { is: "GM-4407" },
  "getmeds / g26": { is: "GM-4408" },
  "getmeds disposable blood bags-single": { is: "GM-4581" },
  geotek: { is: "GM-4416" },
  bupidex: { is: "GM-4604", also: ["GM-4354"] },
  "pacliget 100mg": { is: "GM-4607", also: ["GM-4316"] },
  sondelbay: { is: "GM-4541", also: ["GM-4584"] },
  deciget: { is: "GM-4168", also: ["GM-4702"] },
  borteget: { is: "GM-4543", also: ["GM-3218"] },
};

const plain = (value: string) =>
  value
    .toLowerCase()
    .replace(/\[.*?\]|\(.*?\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const numbers = (value: string) =>
  [...value.replace(/,/g, "").matchAll(/\d+(?:\.\d+)?/g)].map((found) => String(Number(found[0])));

/** The Zoho item a list row is, by its brand's first word, the numbers in its name and strength,
 *  the SRP against Zoho's price, and which one is alive (active, on the shelf, sold lately). */
function tie(brand: string, strength: string, srp: number): { item: Item | null; also: Item[]; sure: boolean } {
  const fixed = TIED[brand.toLowerCase()];
  if (fixed) {
    const one = (code: string) => {
      const found = byCode.get(code) ?? [];
      if (found.length !== 1) throw new Error(`${code} is ${found.length} items in Zoho, not one.`);
      return found[0] as Item;
    };
    return { item: one(fixed.is), also: (fixed.also ?? []).map(one), sure: true };
  }
  const word = plain(brand).split(" ")[0] ?? "";
  const wanted = new Set([...numbers(brand.replace(/\[.*?\]/g, "")), ...numbers(strength)]);
  const scored = [...items.values()]
    .filter((item) => word.length >= 3 && plain(item.name).split(" ")[0] === word)
    .map((item) => {
      const has = new Set([...numbers(item.name), ...numbers(item.strength)]);
      const shared = [...wanted].filter((value) => has.has(value)).length;
      let score = shared * 10;
      if (wanted.size && has.size && !shared) score -= 8;
      if (srp > 0 && Math.abs(item.rate - srp) / srp < 0.005) score += 8;
      if (plain(item.name) === plain(brand)) score += 5;
      if (item.active) score += 3;
      if (item.stock > 0) score += 3;
      score += Math.min(item.sold, 500) / 100;
      if (item.lastSold >= "2025-06-01") score += 2;
      if (/duplicate/i.test(item.name)) score -= 20;
      return { item, score, shared };
    })
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score <= 0) return { item: null, also: [], sure: false };
  return { item: best.item, also: [], sure: best.score >= 10 };
}

const sheet = readXlsx(file).find((one) => one.name === sheetName);
if (!sheet) throw new Error(`No sheet "${sheetName}" in ${file}.`);
const price = (value: string | undefined) => {
  const found = Number(said(value));
  return said(value) && Number.isFinite(found) && found >= 0 ? found : null;
};

const list: ListMedicine[] = [];
const untied: string[] = [];
const table: string[] = [];
const taken = new Map<string, string>();
for (const row of sheet.rows.slice(2)) {
  const cell = (index: number) => said(row.cells[index]);
  const brandText = cell(4);
  if (!brandText || !cell(3)) continue;
  const tag = /\[(.*?)\]/.exec(brandText)?.[1] ?? null;
  const brand = brandText.replace(/\s*\[.*?\]/g, "").replace(/\s*-\s*$/, "").trim();
  const genericText = cell(3);
  const strengthText = /^[-\s]*$|^n\/a$/i.test(cell(5)) ? "" : cell(5);
  const srp = price(row.cells[16]);
  const { item, also, sure } = tie(brandText, strengthText, srp ?? 0);
  if (!item) {
    untied.push(`row ${row.number}: ${brandText} ${strengthText}`);
    continue;
  }
  const before = taken.get(item.id);
  if (before) throw new Error(`${item.sku} is tied to both "${before}" and "${brandText}".`);
  taken.set(item.id, brandText);
  // The name staff know it by; the strength beside it unless the name already ends with it.
  const tail = /[\s-](\d+(?:\.\d+)?)\s*(mg|g|mcg|iu|ml)?$/i.exec(brand);
  const repeats = tail && numbers(strengthText)[0] === String(Number(tail[1]));
  // A supply sold under the house name alone ("Getmeds", "Geotek") is known by what it is.
  const house = /^(\w+)(?:\s*\/.*)?$/.exec(brand);
  const name =
    /suppl/i.test(cell(1)) && house
      ? `${house[1]} ${genericText}`
      : repeats
        ? brand.slice(0, tail.index).trim()
        : brand;
  const count = Math.max(1, Math.round(price(row.cells[10]) ?? 1));
  const months = Number(/\d+/.exec(cell(11))?.[0] ?? 0);
  const note = [cell(23), tag ? `For ${tag}` : ""].filter(Boolean).join(" · ");
  const supplies = /suppl/i.test(cell(1));
  const drugstoreHospital = price(row.cells[21]);
  const drugstoreHospitalPack = price(row.cells[22]);
  const medicine: ListMedicine = {
    sku: item.code,
    aliases: [...new Set([item.sku, ...also.flatMap((other) => [other.code, other.sku])])].filter(
      (sku) => sku.toUpperCase() !== item.code,
    ),
    name,
    generic: genericText.replace(/\s*\[.*?\]/g, "").replace(/\*+$/, "").trim(),
    strength: strengthText || null,
    form: /^-+$/.test(cell(6)) ? null : cell(6) || null,
    unit: cell(7) ? cell(7).toLowerCase() : null,
    pack: cell(8) || null,
    packSize: count,
    category: cell(1) || null,
    manufacturer: item.maker || null,
    brand: /^-?$/.test(cell(0)) ? null : cell(0),
    rx: item.type ? item.type === "RX" : !supplies,
    vat: /^vat$/i.test(cell(2)) ? "vat12" : "exempt",
    shelfLifeMonths: months >= 1 && months <= 240 ? months : null,
    coldChain: /cold chain/i.test(genericText) || /cold chain/i.test(brandText),
    listNote: note || null,
    prices: {
      doctor: price(row.cells[12]),
      patient: price(row.cells[14]),
      distributor: price(row.cells[18]),
      drugstore: drugstoreHospital,
      hospital: drugstoreHospital,
    },
    packPrices:
      count > 1
        ? {
            doctor: price(row.cells[13]),
            patient: price(row.cells[15]),
            distributor: price(row.cells[19]),
            drugstore: drugstoreHospitalPack,
            hospital: drugstoreHospitalPack,
          }
        : {},
    srp,
    srpPack: count > 1 ? price(row.cells[17]) : null,
  };
  listMedicine.parse(medicine);
  list.push(medicine);
  table.push(
    `${String(row.number).padStart(4)} ${sure ? " " : "?"} ${`${name} ${strengthText}`.slice(0, 44).padEnd(44)} → ${item.code.padEnd(8)} ${item.name.slice(0, 30).padEnd(30)} shelf ${String(item.stock).padStart(7)}  sold ${String(item.sold).padStart(5)}${also.length ? `  also ${also.map((other) => other.code).join(", ")}` : ""}`,
  );
}

// The Zoho items whose batches make the shelf: each medicine's own item and its other SKUs.
const shelfItems = list.flatMap((medicine) =>
  [medicine.sku, ...(medicine.aliases ?? [])]
    .map((sku) => bySku.get(sku.toLowerCase()) ?? (byCode.get(sku.toUpperCase())?.length === 1 ? byCode.get(sku.toUpperCase())?.[0] : undefined))
    .filter((item): item is Item => Boolean(item))
    .filter((item, index, all) => all.findIndex((other) => other.id === item.id) === index)
    .map((item) => ({ id: item.id, sku: medicine.sku, cost: item.cost, stock: item.stock })),
);
if (process.argv.includes("--items")) {
  const out = join(ZOHO_DIR, "medicine-items.json");
  writeFileSync(out, JSON.stringify(shelfItems.map((item) => item.id)));
  console.log(`Wrote ${shelfItems.length} Zoho item ids to ${out}`);
}

// What is on the shelf, as fetched from Zoho (one row per batch per warehouse with pieces left):
// [itemId, batch, expiry, warehouse, pieces].
const batchFile = join(ZOHO_DIR, "Batches.json");
const batches: OpeningBatch[] = [];
if (existsSync(batchFile)) {
  const owner = new Map(shelfItems.map((item) => [item.id, item]));
  for (const [itemId, batchNo, expiresOn, warehouse, qty] of JSON.parse(readFileSync(batchFile, "utf8")) as [
    string,
    string,
    string,
    string,
    number,
  ][]) {
    const item = owner.get(itemId);
    if (!item || !(qty > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) continue;
    // The same batch of a medicine in the same warehouse (under two of its SKUs, or received
    // twice) is one line on the shelf.
    const same = batches.find(
      (one) => one.sku === item.sku && one.batchNo === (batchNo || "NO-BATCH") && one.warehouse === warehouse,
    );
    if (same) same.qty += qty;
    else
      batches.push(
        openingBatch.parse({ sku: item.sku, batchNo: batchNo || "NO-BATCH", expiresOn, warehouse, qty, unitCost: item.cost > 0 ? item.cost : null }),
      );
  }
}

// The warehouse holding the most comes first: it is the main one where none is yet.
const held = new Map<string, number>();
for (const one of batches) held.set(one.warehouse, (held.get(one.warehouse) ?? 0) + one.qty);
batches.sort((a, b) => (held.get(b.warehouse) ?? 0) - (held.get(a.warehouse) ?? 0));

console.log(`The price list ${file} (sheet ${sheetName}): ${list.length} medicines`);
console.log(table.join("\n"));
if (untied.length) console.log(`Not found in Zoho (left out):\n  ${untied.join("\n  ")}`);
console.log(
  `  cold chain: ${list.filter((one) => one.coldChain).length}; with VAT: ${list.filter((one) => one.vat === "vat12").length}; no price yet: ${list.filter((one) => !one.prices.patient && !one.prices.doctor).length}`,
);
console.log(
  `  on the shelf in Zoho: ${shelfItems.reduce((sum, item) => sum + Math.max(0, item.stock), 0).toLocaleString("en-PH")} pieces of ${shelfItems.filter((item) => item.stock > 0).length} items; batches fetched: ${batches.length} (${batches.reduce((sum, one) => sum + one.qty, 0).toLocaleString("en-PH")} pieces)`,
);

const target = await openTarget(memory);
if (!target) {
  console.log("No database given: listed only. (DATABASE_URL, .env.live, TEST_PGLITE_DIR or --memory to go on.)");
  process.exit(0);
}
const writes = apply || memory;
const medicinesSaid = await importMedicines(target.db, list, writes);
const stockSaid = await importOpeningStock(target.db, batches, writes);
console.log(writes ? `Written to ${target.where}:` : "Dry run (nothing written; add --apply):");
console.log("  medicines", medicinesSaid);
console.log("  shelf", stockSaid);
process.exit(0);
