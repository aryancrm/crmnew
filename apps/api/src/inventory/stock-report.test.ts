import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase } from "../db/index";
import { migrate } from "../db/migrate";
import { seedDemo } from "../seed";
import { seedFixture } from "./fixture";
import { addDays, todayManila } from "./rules";
import { type StockReport, stockReportSheets, stockReportWorkbook } from "./stock-report";

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
  for (const name of ["ryan", "irene", "sarla", "marco"]) {
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
const report = async (who: string, query = "") => {
  const response = await get(who, `/api/inventory/stock-report${query ? `?${query}` : ""}`);
  expect(response.status).toBe(200);
  return (await response.json()) as StockReport;
};
/** One batch in one warehouse ("Main" or "Cebu"). */
const line = (data: StockReport, batchNo: string, place: string) =>
  data.rows.find((row) => row.batchNo === batchNo && row.warehouse.startsWith(place));
const queries = (response: Response) =>
  Number(/"(\d+) queries"/.exec(response.headers.get("server-timing") ?? "")?.[1]);
const today = todayManila();
const months = (n: number) => Math.round(n * 30.4);

describe("the stock report", () => {
  it("lists every batch in each warehouse: expiry, what came in, what is on the shelf, its cost", async () => {
    const response = await get("irene", "/api/inventory/stock-report");
    expect(response.status).toBe(200);
    // The batches, the shelf by medicine, what is promised, the warehouses; and the sign-in.
    expect(queries(response)).toBe(5);
    const data = (await response.json()) as StockReport;
    expect(data.can).toEqual({ cost: true });
    expect(data.today).toBe(today);

    // By medicine, then the batch expiring first, then the warehouse. Abiraterone has no batch.
    expect(data.rows.map((row) => `${row.batchNo} ${row.warehouse}`)).toEqual([
      "AN2291 Main warehouse",
      "BZ1180 Cebu warehouse",
      "BZ1180 Main warehouse",
      "CP1193 Main warehouse",
      "IM0457 Main warehouse",
      "IM0461 Cebu warehouse",
      "LT2407 Cebu warehouse",
      "LT2407 Main warehouse",
      "LT2511 Main warehouse",
    ]);
    expect(line(data, "BZ1180", "Main")).toMatchObject({
      medicine: "Bortezomib 3.5 mg",
      sku: "GM-4533",
      expiresOn: addDays(today, months(16)),
      daysToExpiry: months(16),
      state: "ok",
      receivedOn: today,
      received: 180,
      moved: 0,
      packed: 0,
      onShelf: 180,
      unitCost: 715000,
      value: 180 * 715000,
    });
    expect(line(data, "BZ1180", "Cebu")).toMatchObject({ received: 60, onShelf: 60 });
    // Bought on a purchase order: received at what it cost to land.
    const bought = line(data, "LT2511", "Main");
    expect(bought).toMatchObject({ received: 200, onShelf: 200 });
    expect(bought?.unitCost).toBeGreaterThan(0);
    expect(line(data, "CP1193", "Main")).toMatchObject({ state: "soon", daysToExpiry: months(2) });

    expect(data.totals).toMatchObject({
      rows: 9,
      batches: 7,
      medicines: 5,
      received: 1451,
      onShelf: 1451,
      expired: 0,
      soon: 46,
      promised: 0,
      free: 1451,
      uncosted: 0,
    });
    expect(data.totals.value).toBe(data.rows.reduce((sum, row) => sum + (row.value ?? 0), 0));
    expect(data.medicines.find((row) => row.medicine === "Bortezomib 3.5 mg")).toMatchObject({
      sellable: 240,
      expired: 0,
      promised: 0,
      free: 240,
    });
  });

  it("shows a seller the stock but never what it cost", async () => {
    const data = await report("ryan");
    expect(data.can).toEqual({ cost: false });
    expect(data.rows).toHaveLength(9);
    expect(data.rows.every((row) => row.unitCost === null && row.value === null)).toBe(true);
    expect(data.totals).toMatchObject({ value: null, expiredValue: null, uncosted: null });
    // Nor in the Excel file: no cost columns at all.
    const [sheet] = stockReportSheets(data);
    const heads = (sheet?.rows[1] ?? []).map((cell) => (typeof cell === "object" ? cell?.v : cell));
    expect(heads).toContain("On the shelf");
    expect(heads).not.toContain("Cost of one (₱)");
  });

  it("takes what placed orders promised off what is free to sell", async () => {
    const before = await report("sarla");
    const bortezomib = before.medicines.find((row) => row.medicine.startsWith("Bortezomib"));
    const customer = (await (
      await post("sarla", "/api/customers", {
        kind: "hospital",
        name: "San Juan de Dios Hospital",
        city: "Pasay",
        address: "2772 Roxas Blvd",
      })
    ).json()) as { id: number };
    const placed = await post("ryan", "/api/orders", {
      customerId: customer.id,
      items: [{ medicineId: bortezomib?.medicineId, qty: 10, priceKind: "hospital" }],
    });
    expect(placed.status).toBe(200);

    const after = await report("sarla");
    expect(after.medicines.find((row) => row.medicine.startsWith("Bortezomib"))).toMatchObject({
      sellable: 240,
      promised: 10,
      promisedOrders: 1,
      free: 230,
    });
    // Still on the shelf until Dispatch packs it.
    expect(line(after, "BZ1180", "Main")?.onShelf).toBe(180);
    expect(after.totals).toMatchObject({ promised: 10, free: 1441, onShelf: 1451 });
  });

  it("follows moves, counts and expiry, and filters by warehouse, words, expiry and empty batches", async () => {
    const first = await report("irene");
    const cebu = first.warehouses.find((one) => one.code === "CEBU")?.id as number;
    const main = first.warehouses.find((one) => one.code === "MAIN")?.id as number;
    const bz1180 = line(first, "BZ1180", "Main")?.batchId as number;
    const im0461 = line(first, "IM0461", "Cebu")?.batchId as number;

    expect(
      (
        await post("marco", "/api/inventory/move", {
          batchId: bz1180,
          fromWarehouseId: main,
          toWarehouseId: cebu,
          qty: 20,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await post("marco", "/api/inventory/count", {
          batchId: im0461,
          warehouseId: cebu,
          counted: 0,
          reason: "Broken in transit",
        })
      ).status,
    ).toBe(200);
    // A batch that has passed its expiry (stock isn't received expired, so it is aged here).
    await db.execute(
      sql`update batch set expires_on = ${addDays(today, -3)}::date where batch_no = 'AN2291'`,
    );

    const data = await report("irene");
    expect(line(data, "BZ1180", "Main")).toMatchObject({ received: 180, moved: -20, onShelf: 160 });
    expect(line(data, "BZ1180", "Cebu")).toMatchObject({ received: 60, moved: 20, onShelf: 80 });
    expect(line(data, "AN2291", "Main")).toMatchObject({
      state: "expired",
      daysToExpiry: -3,
      onShelf: 35,
    });
    // Counted down to nothing: gone from the report until batches with nothing left are asked for.
    expect(line(data, "IM0461", "Cebu")).toBeUndefined();
    expect(data.totals).toMatchObject({
      rows: 8,
      moved: 0,
      counted: 0,
      onShelf: 1331,
      expired: 35,
    });
    expect(data.medicines.find((row) => row.medicine.startsWith("Anastrozole"))).toMatchObject({
      sellable: 0,
      expired: 35,
      free: 0,
    });

    const empty = await report("irene", "empty=1");
    expect(line(empty, "IM0461", "Cebu")).toMatchObject({
      received: 120,
      counted: -120,
      onShelf: 0,
    });
    expect(empty.totals).toMatchObject({ rows: 9, counted: -120, onShelf: 1331 });

    const inCebu = await report("irene", `warehouse=${cebu}`);
    expect(inCebu.rows.map((row) => row.batchNo)).toEqual(["BZ1180", "LT2407"]);
    expect(inCebu.rows.every((row) => row.warehouseId === cebu)).toBe(true);

    expect((await report("irene", "q=bz1180")).rows.map((row) => row.warehouse)).toEqual([
      "Cebu warehouse",
      "Main warehouse",
    ]);
    expect((await report("irene", "q=letro%202511")).rows.map((row) => row.batchNo)).toEqual([
      "LT2511",
    ]);
    expect((await report("irene", "q=GM-4127")).rows.map((row) => row.batchNo)).toEqual([
      "IM0457",
    ]);
    // A wildcard is a plain character here.
    expect((await report("irene", "q=%25")).rows).toEqual([]);

    // Expiring within 90 days, the expired ones with them.
    expect((await report("irene", "within=90")).rows.map((row) => row.batchNo)).toEqual([
      "AN2291",
      "CP1193",
    ]);

    expect((await get("irene", "/api/inventory/stock-report?within=soon")).status).toBe(400);
    expect((await get("irene", "/api/inventory/stock-report?warehouse=-1")).status).toBe(400);
  });

  it("downloads as an Excel file with the same rows", async () => {
    const query = "within=365";
    const file = await get("irene", `/api/inventory/stock-report.xlsx?${query}`);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(file.headers.get("content-disposition")).toBe(
      `attachment; filename="stock-report-${today}.xlsx"`,
    );
    const bytes = Buffer.from(await file.arrayBuffer());
    expect(bytes.subarray(0, 2).toString()).toBe("PK");

    // The file is exactly the workbook of the rows the screen gets for the same filters.
    const data = await report("irene", query);
    expect(bytes.equals(stockReportWorkbook(data))).toBe(true);
    const [batches, byMedicine] = stockReportSheets(data);
    const text = (cells: unknown[] = []) =>
      cells.map((cell) => (cell && typeof cell === "object" ? (cell as { v: unknown }).v : cell));
    expect(text(batches?.rows[0])[0]).toContain("Stock report");
    expect(text(batches?.rows[1])).toEqual([
      "Medicine",
      "SKU",
      "Batch",
      "Expiry date",
      "Days to expiry",
      "Expired / soon",
      "Warehouse",
      "First received",
      "Received",
      "Moved in / out",
      "Packed for orders",
      "Samples",
      "Counted ±",
      "On the shelf",
      "Cost of one (₱)",
      "Value on the shelf (₱)",
    ]);
    // A title, the headings, one line per batch and warehouse, and the total.
    expect(batches?.rows).toHaveLength(data.rows.length + 3);
    expect(text(batches?.rows[2])).toEqual([
      "Anastrozole 1 mg",
      "GM-4410",
      "AN2291",
      addDays(today, -3),
      -3,
      "Expired",
      "Main warehouse",
      today,
      35,
      null,
      null,
      null,
      null,
      35,
      905,
      35 * 905,
    ]);
    expect(text(batches?.rows.at(-1))[13]).toBe(data.totals.onShelf);
    expect(byMedicine?.name).toBe("By medicine");
    expect(byMedicine?.rows).toHaveLength(data.medicines.length + 3);
  });

  it("needs a sign-in", async () => {
    expect((await app.request("/api/inventory/stock-report")).status).toBe(401);
    expect((await app.request("/api/inventory/stock-report.xlsx")).status).toBe(401);
  });
});
