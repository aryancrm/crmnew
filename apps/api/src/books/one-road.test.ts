// One road for buying (Aryan, 18 Nov: "Zoho Inventory is in here and Inventory has its own
// sections too: where does he enter things, so nothing is entered twice?"). Inventory makes the
// vendor, the purchase order in Purchases, receives it onto the shelf (batch, expiry, cost); the
// stock pages show it coming until then; a freight bill can be added to those goods' cost (landed
// cost) and a void takes it back.

import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedFixture } from "../inventory/fixture";
import { seedDemo } from "../seed";
import type { BookChoices, InventoryList, MedicineDetail, Overview } from "../types";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
const read = async <T>(who: string, path: string) =>
  (await (await app.request(path, { headers: { cookie: cookies[who] as string } })).json()) as T;
const post = (who: string, path: string, body: unknown = {}) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookies[who] as string },
    body: JSON.stringify(body),
  });
const made = async (response: Response) => {
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as { id: number };
};
const costOf = async (batchNo: string) =>
  (await rows<{ cost: number }>(db, sql`select unit_cost::int as cost from batch where batch_no = ${batchNo}`))[0]?.cost;

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  await seedFixture(db);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["irene", "fiona"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
});

describe("one road for buying", () => {
  it("vendor → purchase order (coming) → receive (on the shelf, costed) → freight as landed cost → void", async () => {
    const [medicine] = await rows<{ id: number; name: string }>(db, sql`select id::int as id, name from medicine where active order by id limit 1`);
    const id = medicine?.id as number;
    const vendor = await made(await post("irene", "/api/books/vendors", { name: "Road Test Pharma", currency: "PHP" }));
    const freight = await made(await post("irene", "/api/books/vendors", { name: "Road Test Freight", currency: "PHP" }));
    const choices = await read<BookChoices>("irene", "/api/books-choices");
    const warehouseId = choices.warehouses[0]?.id as number;

    const before = await read<MedicineDetail>("irene", `/api/inventory/medicines/${id}`);
    const order = await made(
      await post("irene", "/api/books/purchase_order/new", {
        supplierId: vendor.id,
        date: choices.today,
        deliveryDate: choices.today,
        warehouseId,
        issue: true,
        lines: [{ medicineId: id, qty: 100, rate: 50 }],
      }),
    );

    // Ordered, not here yet: the stock pages show it coming, the overview counts it.
    const page = await read<MedicineDetail>("irene", `/api/inventory/medicines/${id}`);
    const coming = page.coming.find((row) => row.to === `/books/purchaseorders/${order.id}`);
    expect(coming).toMatchObject({ qty: 100, supplier: "Road Test Pharma" });
    expect(page.coming.length).toBe(before.coming.length + 1);
    const list = await read<InventoryList>("irene", "/api/inventory");
    expect(list.medicines.find((row) => row.id === id)?.coming?.qty).toBeGreaterThanOrEqual(100);
    const overview = await read<Overview>("irene", "/api/overview");
    expect(overview.toReceive?.purchases).toBeGreaterThanOrEqual(1);

    // Received: on the shelf in its batch at the order's rate, and no longer coming.
    const [line] = await rows<{ id: number }>(db, sql`select id::int as id from book_line where doc_id = ${order.id}`);
    const expiry = `${Number(choices.today.slice(0, 4)) + 2}${choices.today.slice(4)}`;
    await made(
      await post("irene", `/api/books/purchase_order/${order.id}/receive`, {
        date: choices.today,
        lines: [{ lineId: line?.id, qty: 100, batchNo: "ROAD-1", expiresOn: expiry }],
      }),
    );
    expect(await costOf("ROAD-1")).toBe(5000);
    const after = await read<MedicineDetail>("irene", `/api/inventory/medicines/${id}`);
    expect(after.coming.some((row) => row.to === `/books/purchaseorders/${order.id}`)).toBe(false);

    // The freight bill (₱1,000) is part of those goods' cost: ₱10 more a piece, kept in Inventory Asset.
    const landedChoices = await read<BookChoices>("irene", "/api/books-choices");
    expect(landedChoices.receivedOrders.some((one) => one.id === order.id)).toBe(true);
    const bill = await made(
      await post("irene", "/api/books/bill/new", {
        supplierId: freight.id,
        number: "FR-1",
        date: choices.today,
        landedOn: order.id,
        lines: [{ itemName: "Air freight", account: "Freight", qty: 1, rate: 1000 }],
      }),
    );
    expect(await costOf("ROAD-1")).toBe(6000);
    const [kept] = await rows<{ account: string; reference: string }>(
      db,
      sql`select l.account, d.reference from book_line l join book_doc d on d.id = l.doc_id where d.id = ${bill.id}`,
    );
    expect(kept?.account).toBe("Inventory Asset");

    // Voided: the cost goes back.
    expect((await post("irene", `/api/books/bill/${bill.id}/void`, { reason: "Wrong vendor" })).status).toBeLessThan(300);
    expect(await costOf("ROAD-1")).toBe(5000);
  });

  it("refuses a landed cost on an order nothing of which was received", async () => {
    const choices = await read<BookChoices>("irene", "/api/books-choices");
    const vendor = await made(await post("irene", "/api/books/vendors", { name: "Road Test Two", currency: "PHP" }));
    const [medicine] = await rows<{ id: number }>(db, sql`select id::int as id from medicine where active order by id limit 1`);
    const order = await made(
      await post("irene", "/api/books/purchase_order/new", {
        supplierId: vendor.id,
        date: choices.today,
        warehouseId: choices.warehouses[0]?.id,
        issue: true,
        lines: [{ medicineId: medicine?.id, qty: 10, rate: 5 }],
      }),
    );
    const refused = await post("irene", "/api/books/bill/new", {
      supplierId: vendor.id,
      number: "FR-2",
      date: choices.today,
      landedOn: order.id,
      lines: [{ itemName: "Freight", qty: 1, rate: 100 }],
    });
    expect(refused.status).toBe(400);
    expect(await refused.text()).toContain("receive it first");
  });
});
