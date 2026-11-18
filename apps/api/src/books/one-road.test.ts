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
import type { BookChoices, InventoryList, MedicineDetail, Overview, PurchaseBoard, PurchaseOrderExtra, VendorItems } from "../types";

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
    const coming = page.coming.find((row) => row.to === `/purchases/orders/${order.id}`);
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
    expect(after.coming.some((row) => row.to === `/purchases/orders/${order.id}`)).toBe(false);
    // On the shelf: 100 pieces in the warehouse ordered into, on the medicine's page and its history.
    const shelf = await rows<{ qty: number; warehouse: number }>(
      db,
      sql`select s.qty::int as qty, s.warehouse_id::int as warehouse from stock s join batch b on b.id = s.batch_id where b.batch_no = 'ROAD-1'`,
    );
    expect(shelf).toEqual([{ qty: 100, warehouse: warehouseId }]);
    expect(after.batches.find((one) => one.batchNo === "ROAD-1")).toMatchObject({ qty: 100, warehouseId, unitCost: 5000 });
    expect(after.moves.find((one) => one.batchNo === "ROAD-1")).toMatchObject({ kind: "receive", qty: 100 });
    expect(after.moves.find((one) => one.batchNo === "ROAD-1")?.ref).toContain("PO-");
    const stockList = await read<InventoryList>("irene", "/api/inventory");
    const beforeTotal = before.batches.filter((one) => one.state !== "expired").reduce((sum, one) => sum + one.qty, 0);
    expect(stockList.medicines.find((row) => row.id === id)?.total).toBe(beforeTotal + 100);

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

    // The vendor's invoice goes on the bill (a PDF), and opens again.
    const form = new FormData();
    form.set("file", new File([new TextEncoder().encode("%PDF-1.4 freight invoice")], "freight-invoice.pdf", { type: "application/pdf" }));
    const attached = await app.request(`/api/books/bill/${bill.id}/files`, { method: "POST", headers: { cookie: cookies.irene as string }, body: form });
    expect(attached.status, await attached.clone().text()).toBe(200);
    const withFile = await read<{ files: { id: number; name: string; uploadedBy: string }[] }>("irene", `/api/books/bill/${bill.id}`);
    expect(withFile.files).toMatchObject([{ name: "freight-invoice.pdf" }]);
    const opened = await app.request(`/api/books/files/${withFile.files[0]?.id}`, { headers: { cookie: cookies.irene as string } });
    expect(await opened.text()).toContain("freight invoice");
    const wrong = new FormData();
    wrong.set("file", new File([new TextEncoder().encode("x")], "notes.txt", { type: "text/plain" }));
    expect((await app.request(`/api/books/bill/${bill.id}/files`, { method: "POST", headers: { cookie: cookies.irene as string }, body: wrong })).status).toBe(400);

    // Voided: the cost goes back.
    expect((await post("irene", `/api/books/bill/${bill.id}/void`, { reason: "Wrong vendor" })).status).toBeLessThan(300);
    expect(await costOf("ROAD-1")).toBe(5000);
  });

  it("an extra cost entered before the goods come waits, and goes on each delivery by its share", async () => {
    const choices = await read<BookChoices>("irene", "/api/books-choices");
    const vendor = await made(await post("irene", "/api/books/vendors", { name: "Road Test Two", currency: "PHP" }));
    const travel = await made(await post("irene", "/api/books/vendors", { name: "Road Test Airline", currency: "PHP" }));
    const [medicine] = await rows<{ id: number }>(db, sql`select id::int as id from medicine where active order by id limit 1`);
    const order = await made(
      await post("irene", "/api/books/purchase_order/new", {
        supplierId: vendor.id,
        date: choices.today,
        warehouseId: choices.warehouses[0]?.id,
        issue: true,
        lines: [{ medicineId: medicine?.id, qty: 100, rate: 5 }],
      }),
    );
    // ₱1,000 of airfare and travel to bring them in, before anything came: all of it waits.
    const bill = await made(
      await post("irene", "/api/books/bill/new", {
        supplierId: travel.id,
        number: "AIR-1",
        date: choices.today,
        landedOn: order.id,
        lines: [{ itemName: "Airfare and travel", qty: 1, rate: 1000 }],
      }),
    );
    const extra = async () => read<PurchaseOrderExtra>("irene", `/api/buying/orders/${order.id}/extra`);
    expect((await extra()).landed).toMatchObject([{ id: bill.id, amount: 100000, pending: 100000 }]);

    // 40 of 100 come: 40% of it (₱400) goes on them, ₱10 a piece; ₱600 waits.
    const [line] = await rows<{ id: number }>(db, sql`select id::int as id from book_line where doc_id = ${order.id}`);
    const expiry = `${Number(choices.today.slice(0, 4)) + 2}${choices.today.slice(4)}`;
    const receive = (n: number, batchNo: string) =>
      post("irene", `/api/books/purchase_order/${order.id}/receive`, { date: choices.today, lines: [{ lineId: line?.id, qty: n, batchNo, expiresOn: expiry }] });
    await made(await receive(40, "WAIT-1"));
    expect(await costOf("WAIT-1")).toBe(500 + 1000);
    expect((await extra()).landed[0]?.pending).toBe(60000);

    // The rest comes: the ₱600 left goes on those 60, ₱10 a piece; nothing waits.
    await made(await receive(60, "WAIT-2"));
    expect(await costOf("WAIT-2")).toBe(500 + 1000);
    expect((await extra()).landed[0]?.pending).toBe(0);
    expect((await extra()).batches.map((one) => one.costNow)).toEqual([1500, 1500]);

    // Void: both batches back to the order's price.
    expect((await post("irene", `/api/books/bill/${bill.id}/void`, { reason: "Entered twice" })).status).toBeLessThan(300);
    expect([await costOf("WAIT-1"), await costOf("WAIT-2")]).toEqual([500, 500]);
  });

  it("the board, a vendor's items and Close / Reopen", async () => {
    const choices = await read<BookChoices>("irene", "/api/books-choices");
    const vendor = await made(await post("irene", "/api/books/vendors", { name: "Road Test Three", currency: "PHP" }));
    const [medicine] = await rows<{ id: number }>(db, sql`select id::int as id from medicine where active order by id limit 1`);
    const order = await made(
      await post("irene", "/api/books/purchase_order/new", {
        supplierId: vendor.id,
        date: choices.today,
        warehouseId: choices.warehouses[0]?.id,
        issue: true,
        lines: [{ medicineId: medicine?.id, qty: 20, rate: 7.5 }],
      }),
    );
    const board = await read<PurchaseBoard>("irene", "/api/buying/board");
    expect(board.toReceive.orders).toBeGreaterThanOrEqual(1);
    const items = await read<VendorItems>("irene", `/api/buying/vendors/${vendor.id}/items`);
    expect(items.items).toMatchObject([{ medicineId: medicine?.id, lastRate: 7.5, orders: 1 }]);
    const rates = await read<Record<number, { rate: number }>>("irene", `/api/buying/rates?supplierId=${vendor.id}`);
    expect(rates[medicine?.id as number]?.rate).toBe(7.5);

    // Half came, the rest won't: Close stops it counting as coming; Reopen undoes it.
    const [line] = await rows<{ id: number }>(db, sql`select id::int as id from book_line where doc_id = ${order.id}`);
    const expiry = `${Number(choices.today.slice(0, 4)) + 2}${choices.today.slice(4)}`;
    await made(await post("irene", `/api/books/purchase_order/${order.id}/receive`, { date: choices.today, lines: [{ lineId: line?.id, qty: 10, batchNo: "HALF-1", expiresOn: expiry }] }));
    const coming = async () => (await read<MedicineDetail>("irene", `/api/inventory/medicines/${medicine?.id}`)).coming.some((row) => row.to === `/purchases/orders/${order.id}`);
    expect(await coming()).toBe(true);
    expect((await post("irene", `/api/books/purchase_order/${order.id}/status`, { to: "closed" })).status).toBe(200);
    expect(await coming()).toBe(false);
    expect((await post("irene", `/api/books/purchase_order/${order.id}/status`, { to: "reopen" })).status).toBe(200);
    expect(await coming()).toBe(true);
    // Fiona (Finance) reads the purchases but doesn't make orders.
    expect((await post("fiona", `/api/books/purchase_order/${order.id}/status`, { to: "closed" })).status).toBe(403);
  });
});
