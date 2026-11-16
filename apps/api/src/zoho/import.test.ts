import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedFixture } from "../inventory/fixture";
import { seedDemo } from "../seed";
import type { CustomerPrices, OrderDetail, OrderPrices } from "../types";
import {
  kindOf,
  termsOf,
  unitPriceOf,
  type ZohoCustomersResult,
  type ZohoOrdersResult,
} from "./import";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
let hospital: number;
let medicine: { id: number; sku: string; price: number };

const get = (who: string, path: string) =>
  app.request(path, { headers: { cookie: cookies[who] as string } });
const read = async <T>(who: string, path: string) => (await (await get(who, path)).json()) as T;
const post = (who: string, path: string, body: unknown = {}) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookies[who] as string },
    body: JSON.stringify(body),
  });
const send = async <T>(path: string, body: object, who = "admin") => {
  const response = await post(who, `/api/admin/import/${path}`, body);
  return { status: response.status, said: (await response.json()) as T };
};
const count = async (table: string) =>
  (await rows<{ n: number }>(db, sql.raw(`select count(*)::int as n from ${table}`)))[0]?.n ?? 0;

const customers = [
  // The hospital Management already added here by hand: joins it.
  { id: "z-100", name: "San Juan de Dios Hospital", business: true, city: "Pasay", phone: "(02) 8831 9731", terms: "Net 30" },
  // The same hospital typed a second time in Zoho.
  { id: "z-101", name: "san juan de dios hospital", business: true, city: "PASAY" },
  { id: "z-102", name: "Davao Doctors Hospital", business: true, city: "Davao City", hint: "hospital" },
  { id: "z-103", name: "Mercury Drug Baclaran", business: true, city: "Pasay" },
  { id: "z-104", name: "Medisource Trading", business: true, hint: "distributor" },
  { id: "z-105", name: "Quezon Province", business: true, hint: "government" },
  { id: "z-106", name: "Dr. Ana Reyes", business: false, mobile: "0917 555 0101" },
  { id: "z-107", name: "Lorna Santos", business: false, mobile: "+63 917 555 0202", terms: "Paid" },
  // The same patient again, the number written another way: one customer.
  { id: "z-108", name: "LORNA SANTOS", business: false, mobile: "09175550202" },
  // Another person on the same number: their own customer.
  { id: "z-109", name: "Pedro Santos", business: false, mobile: "09175550202" },
];

const orders = () => [
  {
    id: "so-1",
    code: "SO-67227",
    customerId: "z-100",
    date: "2026-10-12",
    status: "closed",
    total: 4809.6,
    seller: "HOS | Ryan",
    division: "HOS",
    source: "Hospital PO",
    inclusiveTax: true,
    lines: [
      // Buy one get one: a paid line and a free line of the same medicine.
      { sku: medicine.sku, name: "From Zoho", unit: "pcs", qty: 36, rate: 66.8, itemTotal: 2404.8, taxPercent: 0 },
      { sku: medicine.sku, name: "From Zoho", unit: "pcs", qty: 36, rate: 0, itemTotal: 0, taxPercent: 0 },
      // Not in this CRM's medicine list: stands under its own name.
      { sku: "GM-9999", name: "LetroGet 2.5", unit: "pcs", qty: 30, rate: 80.16, itemTotal: 2147.14, taxPercent: 12 },
    ],
  },
  {
    id: "so-2",
    code: "SO-61002",
    // The second Zoho contact of the same hospital: the same customer here.
    customerId: "z-101",
    date: "2026-06-03",
    status: "closed",
    total: 720,
    lines: [{ sku: medicine.sku.toLowerCase(), name: "From Zoho", qty: 10, rate: 72, itemTotal: 720, taxPercent: 0 }],
  },
  {
    id: "so-3",
    code: "SO-61500",
    customerId: "z-100",
    date: "2026-08-01",
    status: "void",
    total: 100,
    lines: [{ sku: medicine.sku, name: "From Zoho", qty: 10, rate: 10, itemTotal: 100 }],
  },
  { id: "so-4", code: "SO-70001", customerId: "z-100", date: "2026-11-01", status: "draft", total: 0, lines: [] },
  { id: "so-5", code: "SO-70002", customerId: "z-nobody", date: "2026-11-02", status: "confirmed", total: 50, lines: [] },
  {
    id: "so-6",
    code: "SO-50001",
    customerId: "z-102",
    date: "2025-01-15",
    status: "closed",
    total: 500,
    lines: [{ sku: medicine.sku, name: "From Zoho", qty: 10, rate: 50, itemTotal: 500 }],
  },
];

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  await seedFixture(db);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["ryan", "sarla", "admin"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
  const added = await post("sarla", "/api/customers", {
    kind: "hospital",
    name: "San Juan de Dios Hospital",
    city: "Pasay",
    address: "2772 Roxas Blvd",
  });
  hospital = ((await added.json()) as { id: number }).id;
  const [found] = await rows<{ id: number; sku: string; price: number }>(
    db,
    sql`select m.id::int as id, m.sku, p.amount::int as price from medicine m
        join medicine_price p on p.medicine_id = m.id and p.buyer_type = 'hospital'
      where m.sku is not null and m.active
        and (select coalesce(sum(s.qty), 0) from stock s join batch b on b.id = s.batch_id where b.medicine_id = m.id) >= 100
      order by m.id limit 1`,
  );
  if (!found) throw new Error("the fixture has no medicine with a SKU, a hospital price and stock");
  medicine = found;
});

describe("what Zoho's words mean here", () => {
  it("reads the kind of customer from Zoho's tick, the name and the orders", () => {
    expect(kindOf({ name: "Lorna Santos", business: false })).toBe("patient");
    expect(kindOf({ name: "Dra. Ana Reyes", business: false })).toBe("doctor");
    expect(kindOf({ name: "Ana Reyes", business: false, doctor: true })).toBe("doctor");
    expect(kindOf({ name: "Ana Reyes", business: false, hint: "doctor" })).toBe("doctor");
    expect(kindOf({ name: "Makati Medical Center", business: true })).toBe("hospital");
    expect(kindOf({ name: "Mercury Drug Baclaran", business: true, hint: "distributor" })).toBe("drugstore");
    expect(kindOf({ name: "Quezon Province", business: true, hint: "government" })).toBe("government");
    expect(kindOf({ name: "St. Luke's", business: true, hint: "hospital" })).toBe("hospital");
    expect(kindOf({ name: "Medisource Trading", business: true })).toBe("distributor");
  });

  it("reads the payment terms", () => {
    expect(termsOf("Paid")).toEqual({ terms: "advance", days: null });
    expect(termsOf("Advanced Payment")).toEqual({ terms: "advance", days: null });
    expect(termsOf("Net 30")).toEqual({ terms: "days", days: 30 });
    expect(termsOf("net ")).toEqual({ terms: "advance", days: null });
    expect(termsOf("Due on Receipt")).toEqual({ terms: "cod", days: null });
    expect(termsOf(null)).toEqual({ terms: "advance", days: null });
  });

  it("works out what one piece cost the customer, VAT in, after discounts", () => {
    // Typed with tax in: 3 at 1,400, Zoho's total before tax is 3,750.
    expect(unitPriceOf({ qty: 3, rate: 1400, itemTotal: 3750, taxPercent: 12 }, { inclusiveTax: true })).toBe(140000);
    // Typed before tax.
    expect(unitPriceOf({ qty: 10, rate: 100, itemTotal: 1000, taxPercent: 12 }, { inclusiveTax: false })).toBe(11200);
    // A 10% discount on the line is already in Zoho's line total.
    expect(unitPriceOf({ qty: 10, rate: 100, itemTotal: 900, taxPercent: 0 }, {})).toBe(9000);
    // A discount on the whole order.
    expect(unitPriceOf({ qty: 10, rate: 100, itemTotal: 1000, taxPercent: 0 }, { discountPercent: 5 })).toBe(9500);
    expect(unitPriceOf({ qty: 28, rate: 0, itemTotal: 0 }, {})).toBe(0);
    expect(unitPriceOf({ qty: 2, rate: 167.508 }, { inclusiveTax: true })).toBe(16751);
  });
});

describe("bringing Zoho's customers", () => {
  it("only the Admin may, and a dry run writes nothing", async () => {
    expect((await send("zoho-customers", { customers, apply: true }, "sarla")).status).toBe(403);
    const before = await count("customer");
    const dry = await send<ZohoCustomersResult>("zoho-customers", { customers });
    expect(dry.status).toBe(200);
    expect(dry.said).toMatchObject({ customers: 10, made: 7, joined: 3, alreadyHere: 0 });
    expect(await count("customer")).toBe(before);
    expect(await count("zoho_contact")).toBe(0);
  });

  it("makes each buyer once: twins in Zoho and customers already here are joined", async () => {
    const before = await count("customer");
    const { said } = await send<ZohoCustomersResult>("zoho-customers", { customers, apply: true });
    expect(said).toMatchObject({ made: 7, joined: 3, skipped: 0 });
    expect(said.byKind).toEqual({ hospital: 1, drugstore: 1, distributor: 1, government: 1, doctor: 1, patient: 2 });
    expect(await count("customer")).toBe(before + 7);
    expect(await count("zoho_contact")).toBe(10);
    const linked = await rows<{ zohoId: string; customerId: number }>(
      db,
      sql`select zoho_id as "zohoId", customer_id::int as "customerId" from zoho_contact`,
    );
    const of = (id: string) => linked.find((row) => row.zohoId === id)?.customerId;
    expect(of("z-100")).toBe(hospital);
    expect(of("z-101")).toBe(hospital);
    expect(of("z-108")).toBe(of("z-107"));
    expect(of("z-109")).not.toBe(of("z-107"));
    const [lorna] = await rows<{ code: string; phone: string; terms: string; review: string; kind: string }>(
      db,
      sql`select code, phone, payment_terms as terms, review, kind from customer where id = ${of("z-107")}`,
    );
    expect(lorna).toMatchObject({ phone: "0917 555 0202", terms: "advance", review: "ok", kind: "patient" });
    expect(lorna?.code).toMatch(/^CUS-\d{5}$/);
  });

  it("sending them again adds nothing", async () => {
    const before = await count("customer");
    const { said } = await send<ZohoCustomersResult>("zoho-customers", { customers, apply: true });
    expect(said).toMatchObject({ made: 0, joined: 0, alreadyHere: 10 });
    expect(await count("customer")).toBe(before);
  });
});

describe("bringing Zoho's sales orders", () => {
  it("brings each order once, as history only", async () => {
    const before = { moves: await count("stock_move"), invoices: await count("invoice"), orders: await count("sales_order") };
    expect((await send("zoho-orders", { orders: orders(), apply: true }, "sarla")).status).toBe(403);
    const dry = await send<ZohoOrdersResult>("zoho-orders", { orders: orders() });
    expect(dry.said).toMatchObject({ orders: 6, made: 4, drafts: 1, noCustomer: 1, lines: 6, freeLines: 1 });
    expect(await count("past_order")).toBe(0);

    const { said } = await send<ZohoOrdersResult>("zoho-orders", { orders: orders(), apply: true });
    expect(said).toMatchObject({ made: 4, alreadyHere: 0, drafts: 1, noCustomer: 1 });
    expect(await count("past_order")).toBe(4);
    expect(await count("past_order_item")).toBe(6);
    const again = await send<ZohoOrdersResult>("zoho-orders", { orders: orders(), apply: true });
    expect(again.said).toMatchObject({ made: 0, alreadyHere: 4 });
    expect(await count("past_order")).toBe(4);
    expect(await count("past_order_item")).toBe(6);
    // History only: no stock moved, nothing invoiced, no order of this CRM made.
    expect({ moves: await count("stock_move"), invoices: await count("invoice"), orders: await count("sales_order") }).toEqual(before);
  });
});

describe("what the customer was given before", () => {
  it("the customer's prices: both Zoho contacts' orders, free pieces beside the paid, void left out", async () => {
    const prices = await read<CustomerPrices>("sarla", `/api/customers/${hospital}/prices`);
    expect(prices.past).toMatchObject({ orders: 2, bought: 552960, firstOn: "2026-06-03", lastOn: "2026-10-12" });
    expect(prices.orders.map((one) => one.code)).toEqual(["SO-67227", "SO-61500", "SO-61002"]);
    const known = prices.medicines.find((one) => one.medicineId === medicine.id);
    expect(known).toMatchObject({ times: 2, qty: 82, freeQty: 36, lastAt: "2026-10-12", lastPrice: 6680 });
    expect(known?.name).not.toBe("From Zoho");
    expect(known?.rows).toEqual([
      { at: "2026-10-12", code: "SO-67227", orderId: null, from: "zoho", qty: 36, freeQty: 36, unitPrice: 6680 },
      { at: "2026-06-03", code: "SO-61002", orderId: null, from: "zoho", qty: 10, freeQty: 0, unitPrice: 7200 },
    ]);
    // A medicine not listed here yet stands under Zoho's name and SKU.
    const unknown = prices.medicines.find((one) => one.sku === "GM-9999");
    expect(unknown).toMatchObject({ medicineId: null, name: "LetroGet 2.5", times: 1, lastPrice: 8016 });
  });

  it("an order being decided shows, line by line, what this customer paid before", async () => {
    const place = async () =>
      ((await (
        await post("ryan", "/api/orders", {
          customerId: hospital,
          items: [{ medicineId: medicine.id, qty: 10, priceKind: "hospital" }],
        })
      ).json()) as { id: number }).id;
    const first = await place();
    const detail = await read<OrderDetail>("sarla", `/api/orders/${first}`);
    const item = detail.items[0]?.id as number;
    const prices = await read<OrderPrices>("sarla", `/api/orders/${first}/prices`);
    expect(prices.customer).toMatchObject({ id: hospital, orders: 2, firstOn: "2026-06-03", lastOn: "2026-10-12", lastCode: "SO-67227" });
    expect(prices.customer.top[0]).toMatchObject({ times: 2, lastPrice: 6680 });
    expect(prices.lines[item]).toMatchObject({ times: 2, lastPrice: 6680 });
    expect(prices.lines[item]?.rows[0]).toMatchObject({ code: "SO-67227", from: "zoho", qty: 36, freeQty: 36 });
    // The MedRep who placed it sees the same.
    expect((await get("ryan", `/api/orders/${first}/prices`)).status).toBe(200);

    // The next order sees the first one too, newest first, and can open it.
    const second = await place();
    const next = await read<OrderPrices>("sarla", `/api/orders/${second}/prices`);
    const line = Object.values(next.lines)[0];
    expect(next.customer.orders).toBe(3);
    expect(line).toMatchObject({ times: 3, lastPrice: medicine.price });
    expect(line?.rows[0]).toMatchObject({ from: "crm", orderId: first, qty: 10, unitPrice: medicine.price });
    // The first order's own history did not change: only what came before it.
    expect((await read<OrderPrices>("sarla", `/api/orders/${first}/prices`)).lines[item]?.times).toBe(2);
  });

  it("is refused to someone who may not see the customer", async () => {
    const [davao] = await rows<{ id: number }>(
      db,
      sql`select customer_id::int as id from zoho_contact where zoho_id = 'z-102'`,
    );
    expect((await get("sarla", `/api/customers/${davao?.id}/prices`)).status).toBe(200);
    expect((await get("ryan", `/api/customers/${davao?.id}/prices`)).status).not.toBe(200);
    expect((await get("ryan", "/api/orders/999999/prices")).status).not.toBe(200);
  });
});
