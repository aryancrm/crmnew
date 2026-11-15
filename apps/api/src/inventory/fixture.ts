// Fixed stock for the tests. Kept apart from the demo data so that can change freely. Goes through the same service the
// screens use, so it can only make what a person could make. Runs once.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { receivePurchase, savePurchase, saveSupplier } from "../purchases/service";
import type { BuyerType, Me } from "../types";
import { addDays, todayManila } from "./rules";
import { addPromo, postNews, receiveStock, saveMedicine, setPrices } from "./service";

const peso = (amount: number) => Math.round(amount * 100);

type Demo = {
  /** [SKU, category, manufacturer] */
  item: [string, string, string];
  name: string;
  generic: string;
  strength: string;
  form: string;
  pack: string;
  reorder: number;
  prices: Partial<Record<BuyerType, number>>;
  /** What one piece of the opening stock cost to land, in pesos. */
  cost: number;
  /** [warehouse code, batch, months until expiry, pieces] */
  stock: [string, string, number, number][];
};

const DEMO: Demo[] = [
  {
    item: ["GM-4410", "Cancer Therapy", "Natco Pharma"],
    name: "Anastrozole",
    generic: "Anastrozole",
    strength: "1 mg",
    form: "Tablet",
    pack: "Box of 30",
    reorder: 50,
    cost: 905,
    prices: { patient: 1450, hospital: 1300, doctor: 1250, distributor: 1180, drugstore: 1220 },
    stock: [["MAIN", "AN2291", 19, 35]],
  },
  {
    item: ["GM-4533", "Cancer Therapy", "Natco Pharma"],
    name: "Bortezomib",
    generic: "Bortezomib",
    strength: "3.5 mg",
    form: "Vial",
    pack: "1 vial",
    reorder: 40,
    cost: 7150,
    prices: { patient: 10500, hospital: 9800, doctor: 9600, bidding: 9200 },
    stock: [
      ["MAIN", "BZ1180", 16, 180],
      ["CEBU", "BZ1180", 16, 60],
    ],
  },
  {
    item: ["GM-4127", "Cancer Therapy", "Hetero Labs"],
    name: "Imatinib",
    generic: "Imatinib mesylate",
    strength: "400 mg",
    form: "Tablet",
    pack: "Box of 30",
    reorder: 100,
    cost: 2840,
    prices: { patient: 4200, hospital: 3900, doctor: 3800, distributor: 3600 },
    stock: [
      ["MAIN", "IM0457", 14, 420],
      ["CEBU", "IM0461", 20, 120],
    ],
  },
  {
    item: ["GM-4402", "Cancer Therapy", "Natco Pharma"],
    name: "Letrozole",
    generic: "Letrozole",
    strength: "2.5 mg",
    form: "Tablet",
    pack: "Box of 30",
    reorder: 80,
    cost: 820,
    prices: { patient: 1400, hospital: 1280, doctor: 1250 },
    stock: [
      ["MAIN", "LT2407", 19, 310],
      ["CEBU", "LT2407", 19, 80],
    ],
  },
  {
    item: ["GM-4219", "Cancer Therapy", "Hetero Labs"],
    name: "Capecitabine",
    generic: "Capecitabine",
    strength: "500 mg",
    form: "Tablet",
    pack: "Box of 120",
    reorder: 20,
    cost: 4300,
    prices: { patient: 6400, hospital: 5900, doctor: 5900 },
    stock: [["MAIN", "CP1193", 2, 46]],
  },
  {
    item: ["GM-4524", "Cancer Therapy", "Beta Drugs Ltd."],
    name: "Abiraterone",
    generic: "Abiraterone acetate",
    strength: "250 mg",
    form: "Tablet",
    pack: "Box of 120",
    reorder: 20,
    cost: 12900,
    prices: { patient: 18500, hospital: 17200, doctor: 17000 },
    stock: [],
  },
];

export async function seedFixture(db: Database): Promise<boolean> {
  const [counted] = await rows<{ count: number }>(
    db,
    sql`select count(*)::int as count from medicine`,
  );
  if ((counted?.count ?? 0) > 0) return false;
  const [dispatch] = await rows<{ id: number }>(
    db,
    sql`select id::int as id from person where role = 'dispatch' limit 1`,
  );
  const [management] = await rows<{ id: number }>(
    db,
    sql`select id::int as id from person where role = 'management' limit 1`,
  );
  const [inventory] = await rows<{ id: number }>(
    db,
    sql`select id::int as id from person where role = 'inventory' limit 1`,
  );
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

  for (const demo of DEMO) {
    const id = await saveMedicine(db, null, {
      name: demo.name,
      generic: demo.generic,
      strength: demo.strength,
      form: demo.form,
      pack: demo.pack,
      sku: demo.item[0],
      category: demo.item[1],
      manufacturer: demo.item[2],
      brand: "2MG",
      unit: demo.form === "Vial" ? "vial" : "box",
      rx: true,
      vat: "exempt",
      reorderLevel: demo.reorder,
    });
    ids.set(demo.name, id);
    await setPrices(
      db,
      sarla,
      id,
      Object.fromEntries(
        Object.entries(demo.prices).map(([key, amount]) => [key, peso(amount as number)]),
      ),
    );
    for (const [code, batchNo, months, qty] of demo.stock)
      await receiveStock(db, marco, {
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
  await addPromo(db, sarla, anastrozole, {
    name: "November promo",
    amount: peso(1200),
    startsOn: addDays(today, -10),
    endsOn: addDays(today, 16),
  });
  // Buying: two suppliers, one purchase already landed (a second Letrozole batch that cost
  // more than the first), and two still on their way.
  const natco = await saveSupplier(db, null, {
    name: "Natco Pharma",
    country: "India",
    currency: "USD",
    contact: "exports@natco.example",
  });
  const qilu = await saveSupplier(db, null, {
    name: "Qilu Pharmaceutical",
    country: "China",
    currency: "USD",
  });
  const letrozole = ids.get("Letrozole") as number;
  const landedAlready = await savePurchase(db, irene, null, {
    supplierId: natco,
    warehouseId: place("MAIN"),
    orderedOn: addDays(today, -30),
    expectedOn: addDays(today, -6),
    currency: "USD",
    fxRate: 58.2,
    supplierRef: "NAT/EXP/2291",
    lines: [{ medicineId: letrozole, qty: 200, unitCost: 13.2 }],
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
    { lineId: line?.id as number, qty: 200, batchNo: "LT2511", expiresOn: addDays(today, 640) },
  ]);
  await savePurchase(db, irene, null, {
    supplierId: natco,
    warehouseId: place("MAIN"),
    orderedOn: addDays(today, -12),
    expectedOn: addDays(today, 6),
    currency: "USD",
    fxRate: 58.4,
    lines: [{ medicineId: anastrozole, qty: 200, unitCost: 14.1 }],
    costs: [{ kind: "freight", amount: peso(16500) }],
  });
  await savePurchase(db, irene, null, {
    supplierId: qilu,
    warehouseId: place("MAIN"),
    orderedOn: addDays(today, -9),
    expectedOn: addDays(today, 8),
    currency: "USD",
    fxRate: 58.4,
    lines: [{ medicineId: abiraterone, qty: 150, unitCost: 205 }],
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
