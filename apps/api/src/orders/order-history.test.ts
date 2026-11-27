// The customer's orders on an order's page, as the Online case page shows them (Aryan, 27 Nov: the
// case page's pieces on every order): the customer's orders newest first, only those the reader may
// open; a patient's by their mobile number, a business's by the customer on file.

import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase } from "../db/index";
import { migrate } from "../db/migrate";
import { seedFixture } from "../inventory/fixture";
import { seedDemo } from "../seed";
import type { Catalogue, OrderHistory } from "../types";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
let medicine: number;

const get = (who: string, path: string) => app.request(path, { headers: { cookie: cookies[who] as string } });
const read = async <T>(who: string, path: string) => (await (await get(who, path)).json()) as T;
const post = (who: string, path: string, body: unknown = {}) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookies[who] as string },
    body: JSON.stringify(body),
  });
const place = async (who: string, body: object) => {
  const response = await post(who, "/api/orders", body);
  const text = await response.text();
  expect(response.status, text).toBe(200);
  return (JSON.parse(text) as { id: number }).id;
};
const customer = async (body: object) =>
  ((await (await post("sarla", "/api/customers", body)).json()) as { id: number }).id;
const history = (who: string, id: number) => read<OrderHistory>(who, `/api/orders/${id}/history`);

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  await seedFixture(db);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["ryan", "daniel", "sarla"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
  const catalogue = await read<Catalogue>("sarla", "/api/inventory/medicines");
  const row = catalogue.rows.find((item) => item.prices.hospital !== undefined && item.prices.patient !== undefined && item.total >= 100);
  if (!row) throw new Error("the fixture has no medicine with hospital and patient prices and stock");
  medicine = row.id;
});

describe("the customer's orders on an order's page", () => {
  it("a business's: its orders newest first, only the ones the reader may open", async () => {
    const hospital = await customer({ kind: "hospital", name: "History Test Hospital", city: "Pasay" });
    const first = await place("ryan", { customerId: hospital, items: [{ medicineId: medicine, qty: 4, priceKind: "hospital" }] });
    const second = await place("ryan", { customerId: hospital, items: [{ medicineId: medicine, qty: 2, priceKind: "hospital" }] });
    // Another seller's order for the same hospital: the area manager places one, and it is made
    // the division head's own sale (no seat of Ryan's), which Ryan may not open.
    const other = await place("daniel", { customerId: hospital, items: [{ medicineId: medicine, qty: 3, priceKind: "hospital" }] });
    await db.execute(sql`update sales_order set medrep_id = (select id from person where email = 'vanessa@2mg.test'),
      raised_by = (select id from person where email = 'vanessa@2mg.test'), seat_id = null where id = ${other}`);

    // The MedRep: his own two, the newest first; never by a hospital's phone.
    const his = await history("ryan", second);
    expect(his.number).toBeNull();
    expect(his.customer).toBe("History Test Hospital");
    // A business is told apart by its own number, as a patient by the phone.
    expect(his.code).toMatch(/^CUS-\d{5}$/);
    expect(his.orders.map((one) => one.id)).toEqual([second, first]);
    expect(his.ordersTotal).toBe(2);
    expect(his.orders[0]?.statusLabel).toBeTruthy();

    // Management sees every order: the other seller's too.
    const all = await history("sarla", second);
    expect(all.orders.map((one) => one.id)).toEqual([other, second, first]);
    expect(all.ordersTotal).toBe(3);

    // An order he may not open shows him nothing.
    expect((await get("ryan", `/api/orders/${other}/history`)).status).toBe(404);
  });

  it("a patient's: by their mobile number, as on the case page", async () => {
    const patient = await customer({ kind: "patient", name: "Rosa History", phone: "0917 555 0199", city: "Pasay", paymentTerms: "cod" });
    const id = await place("ryan", { customerId: patient, type: "patient", items: [{ medicineId: medicine, qty: 1, priceKind: "patient" }] });
    const theirs = await history("ryan", id);
    expect(theirs.number).toBe("9175550199");
    expect(theirs.orders.map((one) => one.id)).toEqual([id]);
    expect(theirs.orders[0]?.medicines).toContain("× 1");
  });
});
