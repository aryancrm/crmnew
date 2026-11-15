import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { countQueries, type Database, openDatabase } from "../db/index";
import { migrate } from "../db/migrate";
import { seedFixture } from "../inventory/fixture";
import { seedDemo } from "../seed";
import type { ChannelReport, InventoryList, MoveList, Overview, SearchResult } from "../types";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};

const get = (who: string, path: string) =>
  app.request(path, { headers: { cookie: cookies[who] as string } });
const read = async <T>(who: string, path: string) => (await (await get(who, path)).json()) as T;
const post = (who: string, path: string, body: unknown) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookies[who] as string },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  await seedFixture(db);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["ryan", "sarla", "irene", "naresh"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
});

describe("overview", () => {
  it("agrees with the stock list and shows each role only its own work", async () => {
    const stock = await read<InventoryList>("irene", "/api/inventory");
    const irene = await read<Overview>("irene", "/api/overview");
    expect(irene.stock.medicines).toBe(stock.summary.medicines);
    expect(irene.stock.out).toBe(stock.summary.out);
    expect(irene.stock.low).toBe(stock.summary.low);
    expect(irene.toReceive).not.toBeNull();
    expect(irene.toReview).toBeNull();
    expect(irene.topStocked[0]?.total).toBe(
      Math.max(...stock.medicines.map((medicine) => medicine.total)),
    );

    const ryan = await read<Overview>("ryan", "/api/overview");
    expect(ryan.toReceive).toBeNull();
    expect(ryan.toReview).toBeNull();
    expect((await read<Overview>("sarla", "/api/overview")).toReview).toBe(0);
  });

  it("answers in a fixed number of queries", async () => {
    const { queries } = await countQueries(async () => get("irene", "/api/overview"));
    expect(queries).toBeLessThanOrEqual(12);
  });
});

describe("the stock ledger as lists", () => {
  it("lists a transfer once, with where it went", async () => {
    const stock = await read<InventoryList>("irene", "/api/inventory");
    const [from, to] = stock.warehouses;
    const medicine = stock.medicines.find((row) => (row.stock[from?.id as number] ?? 0) >= 5);
    if (!from || !to || !medicine) throw new Error("the fixture has no stock to move");
    const detail = await read<{ batches: { batchId: number; warehouseId: number; qty: number }[] }>(
      "irene",
      `/api/inventory/medicines/${medicine.id}`,
    );
    const batch = detail.batches.find((row) => row.warehouseId === from.id && row.qty >= 5);
    if (!batch) throw new Error("no batch to move");
    const before = (await read<MoveList>("irene", "/api/moves?kind=transfer")).total;
    const moved = await post("irene", "/api/inventory/move", {
      batchId: batch.batchId,
      fromWarehouseId: from.id,
      toWarehouseId: to.id,
      qty: 5,
      note: "To the branch",
    });
    expect(moved.status).toBe(200);
    const transfers = await read<MoveList>("irene", "/api/moves?kind=transfer");
    expect(transfers.total).toBe(before + 1);
    expect(transfers.rows[0]).toMatchObject({
      qty: -5,
      warehouse: from.name,
      toWarehouse: to.name,
    });
    expect((await read<MoveList>("ryan", "/api/moves?kind=receive")).rows.length).toBeGreaterThan(
      0,
    );
  });
});

describe("search", () => {
  it("finds medicines for everyone and only the customers a person may see", async () => {
    const stock = await read<InventoryList>("irene", "/api/inventory");
    const word = (stock.medicines[0]?.name ?? "").slice(0, 4);
    expect(
      (await read<SearchResult>("ryan", `/api/search?q=${encodeURIComponent(word)}`)).medicines
        .length,
    ).toBeGreaterThan(0);
    await post("sarla", "/api/customers", {
      kind: "hospital",
      name: "Chong Hua Hospital",
      city: "Cebu City",
    });
    expect((await read<SearchResult>("sarla", "/api/search?q=chong")).customers).toHaveLength(1);
    expect((await read<SearchResult>("ryan", "/api/search?q=chong")).customers).toHaveLength(0);
    expect((await read<SearchResult>("ryan", "/api/search?q=c")).medicines).toHaveLength(0);
  });
});

describe("the channels report", () => {
  it("lists all eight channels with their head and people, for the CEO and Admin only", async () => {
    const report = await read<ChannelReport>("naresh", "/api/reports/channels");
    expect(report.channels.map((channel) => channel.code)).toEqual([
      "HOSP",
      "RX",
      "B2B",
      "BID",
      "PAP",
      "TS",
      "MT",
      "ONLINE",
    ]);
    const hosp = report.channels[0];
    expect(hosp?.head?.name).toBe("Vanessa");
    expect(hosp).toMatchObject({ people: 3, medreps: 1, areas: 1 });
    // Head, then who reports to her, then who reports to him.
    expect(hosp?.tree.map((person) => person.name)).toEqual(["Vanessa"]);
    expect(hosp?.tree[0]?.team.map((person) => person.name)).toEqual(["Daniel"]);
    expect(hosp?.tree[0]?.team[0]?.team.map((person) => person.name)).toEqual(["Ryan"]);
    expect(report.channels.find((channel) => channel.code === "ONLINE")?.head?.name).toBe("Jane");
    // A channel nobody was named head of has none: it is never guessed.
    expect(report.channels.find((channel) => channel.code === "RX")).toMatchObject({
      head: null,
      people: 0,
    });
    expect((await get("sarla", "/api/reports/channels")).status).toBe(403);
    expect((await read<Overview>("naresh", "/api/overview")).apps?.channels).toBe(8);
    expect((await read<Overview>("sarla", "/api/overview")).apps).toBeNull();
  });
});
