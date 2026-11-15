import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedFixture } from "../inventory/fixture";
import { seedDemo } from "../seed";
import type { CatalogueRow, CustomerList, OrderDetail, SearchResult, ToCollect } from "../types";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
const get = (who: string, path: string) =>
  app.request(path, { headers: { cookie: cookies[who] as string } });
const read = async <T>(who: string, path: string) => (await (await get(who, path)).json()) as T;
const send = (who: string, path: string, body: unknown = {}) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookies[who] as string },
    body: JSON.stringify(body),
  });

let hospital: number;
let medicineId: number;

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  await seedFixture(db);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["naresh", "sarla", "ryan", "marco"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
  hospital = (
    (await (
      await send("sarla", "/api/customers", {
        kind: "hospital",
        name: "Audit Hospital",
        city: "Pasay",
      })
    ).json()) as { id: number }
  ).id;
  // A medicine with both a hospital and a distributor price, the distributor's lower.
  const [both] = await rows<{ id: number }>(
    db,
    sql`select h.medicine_id::int as id from medicine_price h join medicine_price d
      on d.medicine_id = h.medicine_id and d.buyer_type = 'distributor' and d.amount < h.amount
      where h.buyer_type = 'hospital' limit 1`,
  );
  medicineId = both?.id as number;
});

const place = async (priceKind = "hospital", qty = 2) => {
  const response = await send("ryan", "/api/orders", {
    customerId: hospital,
    items: [{ medicineId, qty, priceKind, reason: priceKind === "hospital" ? undefined : "Asked" }],
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { id: number }).id;
};

describe("the role audit's fixes", () => {
  it("Management sees a distributor's price given to a hospital", async () => {
    expect(medicineId).toBeTruthy();
    const id = await place("distributor");
    const detail = await read<OrderDetail>("sarla", `/api/orders/${id}`);
    expect(JSON.stringify(detail.findings)).toContain("Distributor price to a hospital");
  });

  it("the MedRep answers a hold and may call his held order off", async () => {
    const id = await place();
    expect((await send("sarla", `/api/orders/${id}/hold`, { reason: "Which ward?" })).status).toBe(
      200,
    );
    expect((await send("ryan", `/api/orders/${id}/answer`, {})).status).toBe(400);
    expect(
      (await send("ryan", `/api/orders/${id}/answer`, { reason: "Oncology ward" })).status,
    ).toBe(200);
    const after = await read<OrderDetail>("ryan", `/api/orders/${id}`);
    expect(after.order.status).toBe("on_hold");
    expect(JSON.stringify(after)).toContain("Oncology ward");
    expect(
      (await send("ryan", `/api/orders/${id}/cancel`, { reason: "Not needed now" })).status,
    ).toBe(200);
  });

  it("counts the pieces placed orders hold, and ships nothing that wasn't picked", async () => {
    const before = await read<{ rows: CatalogueRow[] }>("ryan", "/api/inventory/medicines");
    const row = before.rows.find((one) => one.id === medicineId);
    const id = await place("hospital", 3);
    const after = await read<{ rows: CatalogueRow[] }>("ryan", "/api/inventory/medicines");
    const now = after.rows.find((one) => one.id === medicineId);
    expect((now?.promised ?? 0) - (row?.promised ?? 0)).toBe(3);
    expect(now?.free).toBe(Math.max(0, (now?.total ?? 0) - (now?.promised ?? 0)));
    // An order put into packing without its pieces picked can't be shipped.
    await db.execute(sql`update sales_order set status = 'packing' where id = ${id}`);
    const ship = await send("marco", `/api/dispatch/orders/${id}/ship`, {
      method: "rider",
      rider: "Jun",
    });
    expect(ship.status).toBe(409);
  });

  it("tells the MedRep what his customers owe him, by how late", async () => {
    const mine = await read<ToCollect>("ryan", "/api/my/collect");
    expect(mine.buckets.map((one) => one.key)).toEqual(["not_due", "d30", "d60", "older"]);
    expect(mine.buckets.reduce((sum, one) => sum + one.amount, 0)).toBe(mine.total);
    expect(mine.rows.every((row) => row.balance > 0)).toBe(true);
  });

  it("keeps a city in one area of a channel", async () => {
    const [used] = await rows<{ channelId: number; city: string }>(
      db,
      sql`select channel_id::int as "channelId", cities[1] as city from area where array_length(cities, 1) > 0 limit 1`,
    );
    const twice = await send("naresh", "/api/org/areas", {
      channelId: used?.channelId,
      name: "Audit twin area",
      cities: [used?.city],
    });
    expect(twice.status).toBe(409);
    expect(JSON.stringify(await twice.json())).toContain("is already in the area");
  });

  it("lets Finance set a customer's terms and credit limit, not a MedRep", async () => {
    const asked = { paymentTerms: "days", paymentDays: 45, creditLimit: 500_000_00 };
    const fiona = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "fiona@2mg.test", password: PASSWORD }),
    });
    cookies.fiona = fiona.headers.get("set-cookie")?.split(";")[0] as string;
    expect((await send("fiona", `/api/customers/${hospital}/credit`, asked)).status).toBe(200);
    const [saved] = await rows<{ terms: string; days: number; limit: number }>(
      db,
      sql`select payment_terms as terms, payment_days::int as days, credit_limit::int as "limit" from customer where id = ${hospital}`,
    );
    expect(saved).toEqual({ terms: "days", days: 45, limit: 500_000_00 });
    expect((await send("ryan", `/api/customers/${hospital}/credit`, asked)).status).toBe(403);
    // Orders stuck two days at any desk are listed for Management.
    expect((await get("sarla", "/api/orders?stuck=1")).status).toBe(200);
  });

  it("lists who owes and finds orders and people from the search box", async () => {
    const list = await read<CustomerList>("sarla", "/api/customers?sort=owed&owes=");
    expect(list.rows[0]).toHaveProperty("owed");
    const [order] = await rows<{ code: string }>(db, sql`select code from sales_order limit 1`);
    const found = await read<SearchResult>("naresh", `/api/search?q=${order?.code}`);
    expect(found.orders.map((one) => one.code)).toContain(order?.code);
    const people = await read<SearchResult>("naresh", "/api/search?q=Ryan");
    expect(people.people.some((one) => one.name === "Ryan")).toBe(true);
    expect((await read<SearchResult>("ryan", "/api/search?q=Sarla")).people).toEqual([]);
  });
});
