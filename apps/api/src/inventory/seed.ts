// Demo stock for a developer's computer: a few medicines the way the business keeps them,
// counted and priced by the piece, with a pack size. Goes through the same service the screens
// use, so it can only make what a person could make. Runs once. (The tests have their own
// fixed stock in fixture.ts.)

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { receivePurchase, savePurchase, saveSupplier } from "../purchases/service";
import type { BuyerType, Me } from "../types";
import { addDays, todayManila } from "./rules";
import { addPromo, postNews, receiveStock, saveMedicine, setPrices } from "./service";

const peso = (amount: number) => Math.round(amount * 100);

type Demo = {
  sku: string;
  name: string;
  generic: string;
  strength: string;
  form: string;
  /** What one piece is called, the pack's name, and how many pieces it holds. */
  unit: string;
  pack: string;
  packSize: number;
  maker: string;
  /** Low-stock level, in pieces. */
  reorder: number;
  /** What one piece cost to land, in pesos. */
  cost: number;
  /** Pesos for one piece. */
  prices: Partial<Record<BuyerType, number>>;
  /** Pesos for a whole pack, where the pack has its own price. */
  packPrices?: Partial<Record<BuyerType, number>>;
  /** [warehouse code, batch, months until expiry, pieces] */
  stock: [string, string, number, number][];
};

const DEMO: Demo[] = [
  {
    sku: "GM-4410",
    name: "Anastrozole",
    generic: "Anastrozole",
    strength: "1 mg",
    form: "Tablet",
    unit: "tablet",
    pack: "Box of 30",
    packSize: 30,
    maker: "Natco Pharma",
    reorder: 1500,
    cost: 30.2,
    prices: { patient: 50, hospital: 43.5, doctor: 41.75, distributor: 39.5, drugstore: 40.75 },
    packPrices: { patient: 1450, hospital: 1300, doctor: 1250 },
    stock: [["MAIN", "AN2291", 19, 1050]],
  },
  {
    sku: "GM-4533",
    name: "Bortezomib",
    generic: "Bortezomib",
    strength: "3.5 mg",
    form: "Injection",
    unit: "vial",
    pack: "1 vial",
    packSize: 1,
    maker: "Natco Pharma",
    reorder: 40,
    cost: 7150,
    prices: { patient: 10500, hospital: 9800, doctor: 9600, bidding: 9200 },
    stock: [
      ["MAIN", "BZ1180", 16, 180],
      ["CEBU", "BZ1180", 16, 60],
    ],
  },
  {
    sku: "GM-4127",
    name: "Imatinib",
    generic: "Imatinib mesylate",
    strength: "400 mg",
    form: "Tablet",
    unit: "tablet",
    pack: "Box of 30",
    packSize: 30,
    maker: "Hetero Labs",
    reorder: 3000,
    cost: 94.65,
    prices: { patient: 145, hospital: 130, doctor: 127, distributor: 120 },
    packPrices: { patient: 4200, hospital: 3900 },
    stock: [
      ["MAIN", "IM0457", 14, 4200],
      ["CEBU", "IM0461", 20, 1200],
    ],
  },
  {
    sku: "GM-4402",
    name: "Letrozole",
    generic: "Letrozole",
    strength: "2.5 mg",
    form: "Tablet",
    unit: "tablet",
    pack: "Box of 30",
    packSize: 30,
    maker: "Natco Pharma",
    reorder: 2400,
    cost: 27.35,
    prices: { patient: 48, hospital: 42.75, doctor: 41.75 },
    packPrices: { patient: 1400 },
    stock: [
      ["MAIN", "LT2407", 19, 3100],
      ["CEBU", "LT2407", 19, 800],
    ],
  },
  {
    sku: "GM-4219",
    name: "Capecitabine",
    generic: "Capecitabine",
    strength: "500 mg",
    form: "Tablet",
    unit: "tablet",
    pack: "Box of 120",
    packSize: 120,
    maker: "Hetero Labs",
    reorder: 2400,
    cost: 35.85,
    prices: { patient: 55, hospital: 49.25, doctor: 49.25 },
    packPrices: { patient: 6400 },
    stock: [["MAIN", "CP1193", 2, 5520]],
  },
  {
    sku: "GM-4524",
    name: "Abiraterone",
    generic: "Abiraterone acetate",
    strength: "250 mg",
    form: "Tablet",
    unit: "tablet",
    pack: "Bottle of 120",
    packSize: 120,
    maker: "Beta Drugs Ltd.",
    reorder: 2400,
    cost: 107.5,
    prices: { patient: 160, hospital: 143.5, doctor: 141.75 },
    packPrices: { patient: 18500 },
    stock: [],
  },
];

export async function seedDemoInventory(db: Database): Promise<boolean> {
  const [counted] = await rows<{ count: number }>(
    db,
    sql`select count(*)::int as count from medicine`,
  );
  if ((counted?.count ?? 0) > 0) return false;
  const who = async (role: string) =>
    (
      await rows<{ id: number }>(
        db,
        sql`select id::int as id from person where role = ${role} limit 1`,
      )
    )[0];
  const [dispatch, management, inventory] = await Promise.all([
    who("dispatch"),
    who("management"),
    who("inventory"),
  ]);
  if (!dispatch || !management || !inventory) return false;
  // The service only needs to know who did it.
  const marco = { id: dispatch.id } as Me;
  const sarla = { id: management.id } as Me;
  const irene = { id: inventory.id } as Me;

  await db.execute(
    sql`insert into warehouse (code, name, is_default) values ('MAIN', 'Main warehouse', true), ('CEBU', 'Cebu warehouse', false)`,
  );
  const places = await rows<{ id: number; code: string }>(
    db,
    sql`select id::int as id, code from warehouse`,
  );
  const place = (code: string) => places.find((row) => row.code === code)?.id as number;
  const today = todayManila();
  const ids = new Map<string, number>();
  const centavos = (pesos: Partial<Record<BuyerType, number>> = {}) =>
    Object.fromEntries(Object.entries(pesos).map(([key, amount]) => [key, peso(amount as number)]));

  for (const demo of DEMO) {
    const id = await saveMedicine(db, null, {
      name: demo.name,
      sku: demo.sku,
      generic: demo.generic,
      strength: demo.strength,
      form: demo.form,
      unit: demo.unit,
      pack: demo.pack,
      packSize: demo.packSize,
      category: "Cancer Therapy",
      manufacturer: demo.maker,
      brand: "2MG",
      rx: true,
      vat: "exempt",
      reorderLevel: demo.reorder,
    });
    ids.set(demo.name, id);
    await setPrices(db, sarla, id, centavos(demo.prices), centavos(demo.packPrices));
    for (const [code, batchNo, months, qty] of demo.stock)
      await receiveStock(db, irene, {
        medicineId: id,
        warehouseId: place(code),
        batchNo,
        expiresOn: addDays(today, Math.round(months * 30.4)),
        qty,
        ref: "Opening stock",
        unitCost: peso(demo.cost),
      });
  }

  const anastrozole = ids.get("Anastrozole") as number;
  const abiraterone = ids.get("Abiraterone") as number;
  const letrozole = ids.get("Letrozole") as number;
  await addPromo(db, sarla, anastrozole, {
    name: "November promo",
    amount: peso(40),
    startsOn: addDays(today, -10),
    endsOn: addDays(today, 16),
  });

  // Buying: two suppliers, one purchase already landed (a second Letrozole batch that cost
  // more than the first), and two still on their way. Quantities are pieces.
  const natco = await saveSupplier(db, null, {
    name: "Natco Pharma",
    country: "India",
    currency: "USD",
    contact: "exports@natco.example",
  });
  const beta = await saveSupplier(db, null, {
    name: "Beta Drugs Ltd.",
    country: "India",
    currency: "USD",
  });
  const landedAlready = await savePurchase(db, irene, null, {
    supplierId: natco,
    warehouseId: place("MAIN"),
    orderedOn: addDays(today, -30),
    expectedOn: addDays(today, -6),
    currency: "USD",
    fxRate: 58.2,
    supplierRef: "NAT/EXP/2291",
    lines: [{ medicineId: letrozole, qty: 6000, unitCost: 0.44 }],
    costs: [
      { kind: "freight", amount: peso(18000), note: "Air, Hyderabad to Manila" },
      { kind: "customs", amount: peso(9500) },
      { kind: "packaging", amount: peso(2400), note: "Cold boxes" },
    ],
  });
  const [line] = await rows<{ id: number }>(
    db,
    sql`select id::int as id from purchase_line where purchase_id = ${landedAlready}`,
  );
  await receivePurchase(db, irene, landedAlready, [
    { lineId: line?.id as number, qty: 6000, batchNo: "LT2511", expiresOn: addDays(today, 640) },
  ]);
  await savePurchase(db, irene, null, {
    supplierId: natco,
    warehouseId: place("MAIN"),
    orderedOn: addDays(today, -12),
    expectedOn: addDays(today, 6),
    currency: "USD",
    fxRate: 58.4,
    lines: [{ medicineId: anastrozole, qty: 6000, unitCost: 0.47 }],
    costs: [{ kind: "freight", amount: peso(16500) }],
  });
  await savePurchase(db, irene, null, {
    supplierId: beta,
    warehouseId: place("MAIN"),
    orderedOn: addDays(today, -9),
    expectedOn: addDays(today, 8),
    currency: "USD",
    fxRate: 58.4,
    lines: [{ medicineId: abiraterone, qty: 18000, unitCost: 1.71 }],
    costs: [
      { kind: "freight", amount: peso(42000) },
      { kind: "customs", amount: peso(26000) },
    ],
  });

  await postNews(db, marco, {
    medicineId: abiraterone,
    kind: "out",
    message: "Out of stock. New delivery expected next week.",
  });
  await postNews(db, marco, {
    medicineId: anastrozole,
    kind: "low",
    message: "Only 35 boxes left.",
  });
  return true;
}
