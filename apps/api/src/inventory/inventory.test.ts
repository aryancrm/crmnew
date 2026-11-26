import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase } from "../db/index";
import { migrate } from "../db/migrate";
import { seedDemo } from "../seed";
import type { InventoryList, MedicineDetail, MedicineRequests } from "../types";
import { seedFixture } from "./fixture";
import { addDays, todayManila } from "./rules";

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
  for (const name of ["ryan", "marco", "sarla", "naresh", "fiona", "irene"]) {
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
const list = async (who = "ryan") =>
  (await (await get(who, "/api/inventory")).json()) as InventoryList;
const detail = async (id: number, who = "ryan") =>
  (await (await get(who, `/api/inventory/medicines/${id}`)).json()) as MedicineDetail;
const queries = (response: Response) =>
  Number(/"(\d+) queries"/.exec(response.headers.get("server-timing") ?? "")?.[1]);

async function named(name: string) {
  const inventory = await list();
  const medicine = inventory.medicines.find((row) => row.name === name);
  if (!medicine) throw new Error(`no ${name}`);
  const place = (code: string) =>
    inventory.warehouses.find((row) => row.code === code)?.id as number;
  return { medicine, main: place("MAIN"), cebu: place("CEBU") };
}

const inSixMonths = addDays(todayManila(), 180);

describe("the inventory list", () => {
  it("shows every role the stock by warehouse, what is out, low and expiring, and what is coming", async () => {
    const response = await get("ryan", "/api/inventory");
    expect(response.status).toBe(200);
    // The list and its figures, plus one read of what placed orders have promised.
    expect(queries(response)).toBe(8);
    const inventory = (await response.json()) as InventoryList;

    expect(inventory.can).toEqual({
      stock: false,
      catalogue: false,
      price: false,
      purchase: false,
      cost: false,
    });
    expect(inventory.summary).toEqual({ medicines: 6, out: 1, low: 1, expiring: 1 });
    const by = Object.fromEntries(inventory.medicines.map((row) => [row.name, row]));
    const main = inventory.warehouses.find((row) => row.code === "MAIN")?.id as number;
    const cebu = inventory.warehouses.find((row) => row.code === "CEBU")?.id as number;

    expect(by.Bortezomib).toMatchObject({
      total: 240,
      status: "ok",
      stock: { [main]: 180, [cebu]: 60 },
    });
    expect(by.Anastrozole).toMatchObject({ total: 35, status: "low", coming: { qty: 200 } });
    expect(by.Abiraterone).toMatchObject({ total: 0, status: "out", nearestExpiry: null });
    expect(by.Capecitabine?.expiringSoon).toBe(true);
    expect(by.Imatinib?.code).toMatch(/^MED-\d{5}$/);
    expect(inventory.news.map((news) => news.kind).sort()).toEqual(["low", "out"]);
  });

  it("needs a sign-in", async () => {
    expect((await app.request("/api/inventory")).status).toBe(401);
  });
});

describe("one medicine", () => {
  it("shows its batches, every price, the running promo and its history", async () => {
    const { medicine } = await named("Anastrozole");
    const response = await get("sarla", `/api/inventory/medicines/${medicine.id}`);
    // With one for its offers, one for what placed orders have promised (Free to sell), and one
    // for PCSO's other two vendors' prices (26 Nov).
    expect(queries(response)).toBe(13);
    const page = (await response.json()) as MedicineDetail;
    expect(page.free).toBe(Math.max(0, page.total - page.promised));
    expect(page.batches).toMatchObject([
      { batchNo: "AN2291", qty: 35, state: "ok", unitCost: 90500 },
    ]);
    expect(page.cost).toEqual({ min: 90500, max: 90500, average: 90500 });
    expect(page.prices).toMatchObject({ patient: 145000, hospital: 130000, doctor: 125000 });
    expect(page.promos).toMatchObject([{ name: "November promo", amount: 120000, state: "now" }]);
    expect(page.coming).toMatchObject([
      { qty: 200, code: "PO-00002", supplier: "Natco Pharma", late: false },
    ]);
    expect(page.moves[0]).toMatchObject({ kind: "receive", qty: 35, by: "Marco" });
    expect(page.priceChanges.length).toBeGreaterThan(0);
    // A seller gets neither the price history nor what anything cost.
    const forRyan = await detail(medicine.id, "ryan");
    expect(forRyan.priceChanges).toEqual([]);
    expect(forRyan.cost).toBeNull();
    expect(forRyan.batches[0]?.unitCost).toBeNull();
    expect((await get("ryan", "/api/inventory/medicines/999999")).status).toBe(404);
  });
});

describe("receiving stock", () => {
  it("is Dispatch's job, asks the batch and expiry, and grows the shelf", async () => {
    const { medicine, main } = await named("Letrozole");
    const input = {
      medicineId: medicine.id,
      warehouseId: main,
      batchNo: " lt2500 ",
      expiresOn: inSixMonths,
      qty: 40,
    };

    const refused = await post("ryan", "/api/inventory/receive", input);
    expect(refused.status).toBe(403);
    expect((await refused.json()).error.message).toBe(
      "Only Inventory, Dispatch, Admin can receive stock.",
    );

    const noBatch = await post("marco", "/api/inventory/receive", { ...input, batchNo: "" });
    expect((await noBatch.json()).error).toMatchObject({ field: "batchNo" });
    const expired = await post("marco", "/api/inventory/receive", {
      ...input,
      expiresOn: addDays(todayManila(), -1),
    });
    expect((await expired.json()).error).toMatchObject({ field: "expiresOn" });

    expect((await post("marco", "/api/inventory/receive", input)).status).toBe(200);
    const after = await named("Letrozole");
    expect(after.medicine.total).toBe(medicine.total + 40);
    expect(
      (await detail(medicine.id)).batches.some(
        (batch) => batch.batchNo === "LT2500" && batch.qty === 40,
      ),
    ).toBe(true);

    // The same batch number with another expiry is a mistake on one of the boxes.
    const differs = await post("marco", "/api/inventory/receive", {
      ...input,
      expiresOn: addDays(inSixMonths, 30),
    });
    expect(differs.status).toBe(409);
    expect((await differs.json()).error.field).toBe("expiresOn");
  });
});

describe("moving and counting", () => {
  it("moves a batch between warehouses without changing the total", async () => {
    const { medicine, main, cebu } = await named("Bortezomib");
    const batch = (await detail(medicine.id)).batches.find((row) => row.warehouseId === main);
    const move = { batchId: batch?.batchId, fromWarehouseId: main, toWarehouseId: cebu, qty: 20 };

    expect((await post("fiona", "/api/inventory/move", move)).status).toBe(403);
    expect(
      (await post("marco", "/api/inventory/move", { ...move, toWarehouseId: main })).status,
    ).toBe(400);
    const tooMany = await post("marco", "/api/inventory/move", { ...move, qty: 5000 });
    expect(tooMany.status).toBe(409);
    expect((await tooMany.json()).error.field).toBe("qty");

    expect((await post("marco", "/api/inventory/move", move)).status).toBe(200);
    const after = await named("Bortezomib");
    expect(after.medicine).toMatchObject({ total: 240, stock: { [main]: 160, [cebu]: 80 } });
    const kinds = (await detail(medicine.id)).moves
      .slice(0, 2)
      .map((row) => row.kind)
      .sort();
    expect(kinds).toEqual(["move_in", "move_out"]);
  });

  it("sets the shelf to a count, and wants the reason for a difference", async () => {
    const { medicine, main } = await named("Imatinib");
    const batch = (await detail(medicine.id)).batches.find((row) => row.warehouseId === main);
    const count = { batchId: batch?.batchId, warehouseId: main, counted: 415 };

    const noReason = await post("marco", "/api/inventory/count", count);
    expect((await noReason.json()).error.field).toBe("reason");
    const done = await post("marco", "/api/inventory/count", {
      ...count,
      reason: "5 boxes damaged",
    });
    expect(await done.json()).toEqual({ difference: -5 });
    expect((await named("Imatinib")).medicine.stock[main]).toBe(415);
    expect((await detail(medicine.id)).moves[0]).toMatchObject({
      kind: "count",
      qty: -5,
      note: "5 boxes damaged",
    });

    const same = await post("marco", "/api/inventory/count", count);
    expect(await same.json()).toEqual({ difference: 0 });
  });
});

describe("prices and promos", () => {
  it("are changed only by Management, the CEO and Admin, and every change is kept", async () => {
    const { medicine } = await named("Letrozole");
    const path = `/api/inventory/medicines/${medicine.id}/prices`;
    expect((await post("ryan", path, { prices: { hospital: 100 } })).status).toBe(403);
    expect((await post("marco", path, { prices: { hospital: 100 } })).status).toBe(403);
    const negative = await post("sarla", path, { prices: { hospital: -5 } });
    expect(negative.status).toBe(400);

    expect(
      (await post("sarla", path, { prices: { hospital: 126000, bidding: 119000, doctor: null } }))
        .status,
    ).toBe(200);
    const page = await detail(medicine.id, "sarla");
    expect(page.prices).toEqual({ patient: 140000, hospital: 126000, bidding: 119000 });
    expect(
      page.priceChanges
        .slice(0, 3)
        .map((row) => `${row.what}: ${row.old} -> ${row.new}`)
        .sort(),
    ).toEqual([
      "Bidding price: null -> 119000",
      "Doctor price: 125000 -> null",
      "Hospital price: 128000 -> 126000",
    ]);
    // Saving the same prices again changes nothing and logs nothing.
    await post("naresh", path, { prices: { hospital: 126000 } });
    expect((await detail(medicine.id, "sarla")).priceChanges.length).toBe(page.priceChanges.length);
  });

  it("run a dated promo and end it", async () => {
    const { medicine } = await named("Imatinib");
    const path = `/api/inventory/medicines/${medicine.id}/promos`;
    const today = todayManila();
    const backwards = await post("sarla", path, {
      name: "Launch",
      amount: 350000,
      startsOn: today,
      endsOn: addDays(today, -2),
    });
    expect((await backwards.json()).error.field).toBe("endsOn");
    expect(
      (
        await post("sarla", path, {
          name: "Launch",
          amount: 350000,
          startsOn: today,
          endsOn: addDays(today, 10),
        })
      ).status,
    ).toBe(200);
    const [promo] = (await detail(medicine.id)).promos;
    expect(promo).toMatchObject({ name: "Launch", state: "now" });
    expect((await post("sarla", `/api/inventory/promos/${promo?.id}/end`)).status).toBe(200);
    expect((await detail(medicine.id)).promos[0]?.state).toBe("ended");
  });
});

describe("the catalogue", () => {
  it("adds a medicine once and gives it a code", async () => {
    const input = {
      name: "Tamoxifen",
      strength: "20 mg",
      pack: "Box of 30",
      rx: true,
      vat: "exempt",
      reorderLevel: 10,
    };
    expect((await post("marco", "/api/inventory/medicines", input)).status).toBe(403);
    // Adding medicines is Inventory's: Management asks for one it doesn't have instead.
    expect((await post("sarla", "/api/inventory/medicines", input)).status).toBe(403);
    const made = await post("irene", "/api/inventory/medicines", input);
    expect(made.status).toBe(200);
    const page = await detail((await made.json()).id);
    expect(page.medicine).toMatchObject({ name: "Tamoxifen", strength: "20 mg", reorderLevel: 10 });
    expect(page.medicine.code).toMatch(/^MED-\d{5}$/);
    expect(page.status).toBe("out");

    const twin = await post("irene", "/api/inventory/medicines", { ...input, name: "tamoxifen " });
    expect(twin.status).toBe(409);
    expect((await twin.json()).error.message).toBe("tamoxifen 20 mg is already in the list.");
    const blank = await post("irene", "/api/inventory/medicines", { ...input, name: "  " });
    expect((await blank.json()).error.field).toBe("name");

    const edited = await post("irene", `/api/inventory/medicines/${page.medicine.id}`, {
      ...input,
      reorderLevel: 25,
    });
    expect(edited.status).toBe(200);
    expect((await detail(page.medicine.id)).medicine.reorderLevel).toBe(25);
  });
});

describe("stock news", () => {
  it("keeps one open notice per medicine and takes it down", async () => {
    const { medicine } = await named("Anastrozole");
    expect(
      (await post("ryan", "/api/stock-news", { medicineId: medicine.id, kind: "back" })).status,
    ).toBe(403);
    expect(
      (
        await post("marco", "/api/stock-news", {
          medicineId: medicine.id,
          kind: "back",
          message: "200 boxes in.",
        })
      ).status,
    ).toBe(200);
    const news = (
      (await (await get("ryan", "/api/stock-news")).json()) as { news: InventoryList["news"] }
    ).news;
    const mine = news.filter((row) => row.medicineId === medicine.id);
    expect(mine).toMatchObject([{ kind: "back", message: "200 boxes in.", by: "Marco" }]);
    expect((await post("marco", `/api/stock-news/${mine[0]?.id}/close`)).status).toBe(200);
    expect((await list()).news.some((row) => row.medicineId === medicine.id)).toBe(false);
  });
});

describe("all medicines", () => {
  it("lists every medicine with its details, every price, the promo and its stock", async () => {
    const response = await get("ryan", "/api/inventory/medicines");
    expect(response.status).toBe(200);
    // The catalogue's reads, plus one of what placed orders have promised and one of the offers.
    expect(queries(response)).toBe(7);
    const page = (await response.json()) as import("../types").Catalogue;
    const anastrozole = page.rows.find((row) => row.name === "Anastrozole");
    expect(anastrozole).toMatchObject({
      sku: "GM-4410",
      generic: "Anastrozole",
      strength: "1 mg",
      form: "Tablet",
      pack: "Box of 30",
      category: "Cancer Therapy",
      manufacturer: "Natco Pharma",
      brand: "2MG",
      rx: true,
      vat: "exempt",
      prices: { patient: 145000, hospital: 130000, doctor: 125000 },
      promo: { name: "November promo", amount: 120000 },
      total: 35,
      status: "low",
      cost: null,
    });
    expect(page.categories).toContain("Cancer Therapy");
    // Those who see costs get the average landed cost of what is on the shelf.
    const forSarla = (await (
      await get("sarla", "/api/inventory/medicines")
    ).json()) as import("../types").Catalogue;
    expect(forSarla.rows.find((row) => row.name === "Anastrozole")?.cost).toBe(90500);
  });

  it("keeps a SKU for one medicine only", async () => {
    const input = {
      name: "Gefitinib",
      strength: "250 mg",
      sku: "gm-4410",
      rx: true,
      vat: "exempt",
      reorderLevel: 0,
    };
    const taken = await post("irene", "/api/inventory/medicines", input);
    expect(taken.status).toBe(409);
    expect((await taken.json()).error).toMatchObject({
      field: "sku",
      message: "SKU GM-4410 is already Anastrozole's.",
    });
    const made = await post("irene", "/api/inventory/medicines", {
      ...input,
      sku: "gm-4777",
      manufacturer: "Natco Pharma",
    });
    expect((await detail((await made.json()).id)).medicine).toMatchObject({
      sku: "GM-4777",
      manufacturer: "Natco Pharma",
    });
  });
});

describe("pieces and packs", () => {
  it("keeps the price of one piece, and a pack's own price when it has one", async () => {
    const made = await post("irene", "/api/inventory/medicines", {
      name: "Tamsulosin",
      strength: "400 mcg",
      unit: "capsule",
      pack: "Box of 30",
      packSize: 30,
      rx: true,
      vat: "exempt",
      reorderLevel: 0,
    });
    const id = (await made.json()).id as number;
    const path = `/api/inventory/medicines/${id}/prices`;
    expect((await detail(id)).medicine).toMatchObject({ unit: "capsule", packSize: 30 });

    // ₱12 a capsule to a patient, ₱330 for the whole box (cheaper than 30 x ₱12); hospitals by the piece only.
    await post("sarla", path, {
      prices: { patient: 1200, hospital: 1000 },
      packPrices: { patient: 33000 },
    });
    let page = await detail(id, "sarla");
    expect(page.prices).toEqual({ patient: 1200, hospital: 1000 });
    expect(page.packPrices).toEqual({ patient: 33000 });

    // A box price alone sets the piece price from it: ₱270 a box of 30 is ₱9 a capsule.
    await post("sarla", path, { prices: {}, packPrices: { doctor: 27000 } });
    page = await detail(id, "sarla");
    expect(page.prices.doctor).toBe(900);
    expect(page.packPrices.doctor).toBe(27000);

    // Taking the piece price off takes the pack price with it.
    await post("sarla", path, { prices: { patient: null }, packPrices: {} });
    page = await detail(id, "sarla");
    expect(page.prices.patient).toBeUndefined();
    expect(page.packPrices.patient).toBeUndefined();
    expect(page.priceChanges.map((row) => row.what)).toContain("Patient price, whole pack");

    const list = (await (
      await get("ryan", "/api/inventory/medicines")
    ).json()) as import("../types").Catalogue;
    expect(list.rows.find((row) => row.id === id)).toMatchObject({
      packSize: 30,
      unit: "capsule",
      packPrices: { doctor: 27000 },
    });
    const zero = await post("irene", `/api/inventory/medicines/${id}`, {
      name: "Tamsulosin",
      strength: "400 mcg",
      packSize: 0,
      rx: true,
      vat: "exempt",
      reorderLevel: 0,
    });
    expect((await zero.json()).error.field).toBe("packSize");
  });
});

describe("medicine not available", () => {
  it("gathers every ask under one open request, and Inventory answers it once", async () => {
    const ask = { name: "Osimertinib", strength: "80 mg", qty: 30, note: "For a lung patient" };
    expect((await post("sarla", "/api/inventory/requests", ask)).status).toBe(200);
    // The same medicine again (any case) is the same request, asked twice.
    expect(
      (await post("ryan", "/api/inventory/requests", { ...ask, name: "osimertinib", qty: 10 }))
        .status,
    ).toBe(200);
    expect((await post("ryan", "/api/inventory/requests", { name: " " })).status).toBe(400);
    const open = (await (await get("irene", "/api/inventory/requests")).json()) as MedicineRequests;
    const row = open.rows.find((request) => request.name === "Osimertinib");
    expect(row).toMatchObject({ times: 2, qty: 40, status: "open", strength: "80 mg" });
    expect(row?.asks.map((one) => one.by).sort()).toEqual(["Ryan", "Sarla"]);
    expect(open.can.answer).toBe(true);
    // Whoever asked sees their own ask only; Management can't answer.
    const ryans = (await (await get("ryan", "/api/inventory/requests")).json()) as MedicineRequests;
    expect(ryans.rows.find((request) => request.id === row?.id)?.asks.map((one) => one.by)).toEqual(
      ["Ryan"],
    );
    expect(
      (await post("sarla", `/api/inventory/requests/${row?.id}/answer`, { status: "ordered" }))
        .status,
    ).toBe(403);
    // Refused without a reason; then ordered, once.
    expect(
      (await post("irene", `/api/inventory/requests/${row?.id}/answer`, { status: "declined" }))
        .status,
    ).toBe(400);
    const answer = { status: "ordered", answer: "Ordered from Hetero, here by the 25th" };
    expect((await post("irene", `/api/inventory/requests/${row?.id}/answer`, answer)).status).toBe(
      200,
    );
    expect((await post("irene", `/api/inventory/requests/${row?.id}/answer`, answer)).status).toBe(
      409,
    );
    const done = (await (
      await get("sarla", "/api/inventory/requests?show=answered")
    ).json()) as MedicineRequests;
    expect(done.rows.find((request) => request.id === row?.id)).toMatchObject({
      status: "ordered",
      answer: "Ordered from Hetero, here by the 25th",
      answeredBy: "Irene",
    });
    // Asked again after it was answered: a new request.
    await post("ryan", "/api/inventory/requests", ask);
    const again = (await (
      await get("irene", "/api/inventory/requests")
    ).json()) as MedicineRequests;
    expect(again.rows.find((request) => request.name === "Osimertinib")?.times).toBe(1);
  });
});
