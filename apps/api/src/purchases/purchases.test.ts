import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase } from "../db/index";
import { migrate } from "../db/migrate";
import { seedFixture } from "../inventory/fixture";
import { addDays, todayManila } from "../inventory/rules";
import { seedDemo } from "../seed";
import type { InventoryList, MedicineDetail, PurchaseDetail, PurchaseList } from "../types";
import { landedCosts } from "./landed";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  await seedFixture(db);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["ryan", "marco", "sarla", "irene", "fiona"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
});

const get = (who: string, path: string) =>
  app.request(path, { headers: { cookie: cookies[who] as string } });
const post = (who: string, path: string, body: unknown = {}) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookies[who] as string },
    body: JSON.stringify(body),
  });
const inventory = async () =>
  (await (await get("irene", "/api/inventory")).json()) as InventoryList;
const purchase = async (id: number, who = "irene") =>
  (await (await get(who, `/api/purchases/${id}`)).json()) as PurchaseDetail;
const medicinePage = async (id: number, who: string) =>
  (await (await get(who, `/api/inventory/medicines/${id}`)).json()) as MedicineDetail;

async function order() {
  const list = await inventory();
  const idOf = (name: string) => list.medicines.find((row) => row.name === name)?.id as number;
  const main = list.warehouses.find((row) => row.code === "MAIN")?.id as number;
  const supplierId = (
    (await (await get("irene", "/api/suppliers")).json()) as { suppliers: { id: number }[] }
  ).suppliers[0]?.id;
  const today = todayManila();
  return {
    imatinib: idOf("Imatinib"),
    bortezomib: idOf("Bortezomib"),
    input: {
      supplierId,
      warehouseId: main,
      orderedOn: today,
      expectedOn: addDays(today, 14),
      currency: "usd",
      fxRate: 58,
      lines: [
        { medicineId: idOf("Imatinib"), qty: 100, unitCost: 60 },
        { medicineId: idOf("Bortezomib"), qty: 10, unitCost: 150 },
      ],
      costs: [
        { kind: "freight", amount: 2_000_000, note: "Air freight" },
        { kind: "customs", amount: 500_000 },
      ],
    },
  };
}

describe("what a purchase costs to land", () => {
  it("shares the other costs by goods value, to the centavo", () => {
    const landed = landedCosts(
      [
        { qty: 100, unitCost: 10 },
        { qty: 50, unitCost: 40 },
      ],
      50,
      1_000_001,
    );
    expect(landed).toEqual([
      { goods: 5_000_000, extras: 333_334, landedUnit: 53_333 },
      { goods: 10_000_000, extras: 666_667, landedUnit: 213_333 },
    ]);
    expect(landed[0]!.extras + landed[1]!.extras).toBe(1_000_001);
  });

  it("shares by pieces when the goods are free, and copes with nothing", () => {
    expect(
      landedCosts(
        [
          { qty: 30, unitCost: 0 },
          { qty: 10, unitCost: 0 },
        ],
        58,
        400,
      ).map((line) => line.extras),
    ).toEqual([300, 100]);
    expect(landedCosts([], 58, 500)).toEqual([]);
    expect(landedCosts([{ qty: 0, unitCost: 5 }], 58, 0)).toEqual([
      { goods: 0, extras: 0, landedUnit: 0 },
    ]);
  });
});

describe("purchases", () => {
  it("are seen only by those who see costs, and made only by Inventory", async () => {
    expect((await get("ryan", "/api/purchases")).status).toBe(403);
    expect((await get("marco", "/api/purchases")).status).toBe(403);
    expect((await get("fiona", "/api/purchases")).status).toBe(200);
    const { input } = await order();
    const refused = await post("sarla", "/api/purchases", input);
    expect(refused.status).toBe(403);
    expect((await refused.json()).error.message).toBe("Only Inventory, Admin can make a purchase.");

    const list = (await (await get("irene", "/api/purchases")).json()) as PurchaseList;
    expect(list.rows.map((row) => `${row.code} ${row.state}`).sort()).toEqual([
      "PO-00001 received",
      "PO-00002 ordered",
      "PO-00003 ordered",
    ]);
    expect(list.rows.find((row) => row.code === "PO-00002")?.lines).toBe("Anastrozole 1 mg × 200");
  });

  it("work out the landed cost of each line when ordered", async () => {
    const { input, imatinib } = await order();
    const twice = await post("irene", "/api/purchases", {
      ...input,
      lines: [input.lines[0], input.lines[0]],
    });
    expect((await twice.json()).error.field).toBe("lines");
    const early = await post("irene", "/api/purchases", {
      ...input,
      expectedOn: addDays(input.orderedOn, -1),
    });
    expect((await early.json()).error.field).toBe("expectedOn");
    const empty = await post("irene", "/api/purchases", { ...input, lines: [] });
    expect((await empty.json()).error.message).toBe("Add at least one medicine.");

    const made = await post("irene", "/api/purchases", input);
    expect(made.status).toBe(200);
    const page = await purchase((await made.json()).id);
    expect(page.purchase).toMatchObject({
      state: "ordered",
      currency: "USD",
      fxRate: 58,
      goodsTotal: 43_500_000,
      extrasTotal: 2_500_000,
    });
    expect(page.purchase.code).toMatch(/^PO-\d{5}$/);
    // 100 x $60 x 58 = ₱348,000 + ₱20,000 of the costs = ₱3,680 a box; 10 x $150 x 58 = ₱87,000 + ₱5,000 = ₱9,200 a vial.
    expect(page.lines.map((line) => [line.goods, line.extras, line.landedUnit])).toEqual([
      [34_800_000, 2_000_000, 368_000],
      [8_700_000, 500_000, 920_000],
    ]);
    expect((await inventory()).medicines.find((row) => row.id === imatinib)?.coming).toMatchObject({
      qty: 100,
    });
  });

  it("are received by batch: the shelf grows and each batch keeps what it cost", async () => {
    const { input, imatinib, bortezomib } = await order();
    const id = (await (await post("irene", "/api/purchases", input)).json()).id as number;
    const before = (await inventory()).medicines.find((row) => row.id === imatinib)?.total ?? 0;
    const lines = (await purchase(id)).lines;
    const expiresOn = addDays(todayManila(), 500);

    expect((await post("marco", `/api/purchases/${id}/receive`, { lines: [] })).status).toBe(403);
    const noBatch = await post("irene", `/api/purchases/${id}/receive`, {
      lines: [
        { lineId: lines[0]?.id, qty: 90, batchNo: "", expiresOn },
        { lineId: lines[1]?.id, qty: 10, batchNo: "BZ9001", expiresOn },
      ],
    });
    expect((await noBatch.json()).error.field).toBe("lines.0.batchNo");

    // 90 of the 100 boxes came: the costs are shared over what arrived.
    const done = await post("irene", `/api/purchases/${id}/receive`, {
      lines: [
        { lineId: lines[0]?.id, qty: 90, batchNo: "im9001", expiresOn },
        { lineId: lines[1]?.id, qty: 10, batchNo: "BZ9001", expiresOn },
      ],
    });
    expect(done.status).toBe(200);
    const page = await purchase(id);
    expect(page.purchase).toMatchObject({
      state: "received",
      goodsTotal: 40_020_000,
      extrasTotal: 2_500_000,
      receivedBy: "Irene",
    });
    expect(
      page.lines.map((line) => [line.receivedQty, line.batchNo, line.extras, line.landedUnit]),
    ).toEqual([
      [90, "IM9001", 1_956_522, 369_739],
      [10, "BZ9001", 543_478, 924_348],
    ]);
    expect((await inventory()).medicines.find((row) => row.id === imatinib)?.total).toBe(
      before + 90,
    );

    const seen = await medicinePage(imatinib, "sarla");
    expect(seen.batches.find((batch) => batch.batchNo === "IM9001")).toMatchObject({
      qty: 90,
      unitCost: 369_739,
    });
    expect(seen.cost).toMatchObject({ min: 284_000, max: 369_739 });
    expect(seen.moves[0]).toMatchObject({ kind: "receive", qty: 90, ref: page.purchase.code });
    expect(
      (await medicinePage(bortezomib, "ryan")).batches.every((batch) => batch.unitCost === null),
    ).toBe(true);

    expect((await post("irene", `/api/purchases/${id}/receive`, { lines: [] })).status).toBe(400);
    const again = await post("irene", `/api/purchases/${id}/receive`, {
      lines: [
        { lineId: lines[0]?.id, qty: 1, batchNo: "IM9002", expiresOn },
        { lineId: lines[1]?.id, qty: 0 },
      ],
    });
    expect(again.status).toBe(409);

    // The freight bill came in higher: the batches' costs follow, the lines stay as received.
    const changed = await post("irene", `/api/purchases/${id}`, {
      ...input,
      lines: [{ medicineId: imatinib, qty: 1, unitCost: 1 }],
      costs: [{ kind: "freight", amount: 4_002_000 }],
    });
    expect(changed.status).toBe(200);
    const after = await purchase(id);
    expect(after.lines.map((line) => [line.receivedQty, line.extras, line.landedUnit])).toEqual([
      [90, 3_132_000, 382_800],
      [10, 870_000, 957_000],
    ]);
    expect(
      (await medicinePage(imatinib, "sarla")).batches.find((batch) => batch.batchNo === "IM9001")
        ?.unitCost,
    ).toBe(382_800);
    expect((await post("irene", `/api/purchases/${id}/cancel`)).status).toBe(409);
  });

  it("can be cancelled while on order", async () => {
    const { input, imatinib } = await order();
    const coming =
      (await inventory()).medicines.find((row) => row.id === imatinib)?.coming?.qty ?? 0;
    const id = (await (await post("irene", "/api/purchases", input)).json()).id as number;
    // A cancel says why; the reason goes on the purchase's note.
    expect((await post("irene", `/api/purchases/${id}/cancel`)).status).toBe(400);
    expect(
      (await post("irene", `/api/purchases/${id}/cancel`, { reason: "Supplier raised the price" }))
        .status,
    ).toBe(200);
    expect((await purchase(id)).purchase.state).toBe("cancelled");
    expect((await purchase(id)).purchase.note).toContain("Cancelled: Supplier raised the price");
    expect((await inventory()).medicines.find((row) => row.id === imatinib)?.coming?.qty ?? 0).toBe(
      coming,
    );
    expect((await post("irene", `/api/purchases/${id}/cancel`)).status).toBe(409);
    expect((await post("irene", `/api/purchases/${id}`, input)).status).toBe(409);
  });
});

describe("suppliers", () => {
  it("are added once", async () => {
    const input = { name: "Hetero Labs", country: "India", currency: "inr" };
    expect((await post("sarla", "/api/suppliers", input)).status).toBe(403);
    expect((await post("irene", "/api/suppliers", input)).status).toBe(200);
    const twin = await post("irene", "/api/suppliers", { ...input, name: " hetero labs" });
    expect((await twin.json()).error.message).toBe("hetero labs is already a supplier.");
    const bad = await post("irene", "/api/suppliers", {
      ...input,
      name: "Other",
      currency: "rupees",
    });
    expect((await bad.json()).error.field).toBe("currency");
    const list = (
      (await (await get("fiona", "/api/suppliers")).json()) as {
        suppliers: { name: string; currency: string }[];
      }
    ).suppliers;
    expect(list.find((row) => row.name === "Hetero Labs")?.currency).toBe("INR");
  });
});
