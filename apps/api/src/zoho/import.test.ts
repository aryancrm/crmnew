import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedFixture } from "../inventory/fixture";
import { seedDemo } from "../seed";
import type { CustomerPrices, OrderDetail, OrderPrices } from "../types";
import {
  identityPhone,
  importZohoInvoices,
  importZohoPayments,
  kindOf,
  termsOf,
  unitPriceOf,
  type ZohoCustomersResult,
  type ZohoOrdersResult,
} from "./import";
import { importMedicines, importOpeningStock } from "./medicines";

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
  { id: "z-103", name: "Mercury Drug Baclaran", business: true, city: "Pasay", licenceNo: "LTO-DS-7781", licenceType: "Drugstore", licenceExpires: "2027-03-31" },
  { id: "z-104", name: "Medisource Trading", business: true, hint: "distributor" },
  { id: "z-105", name: "Quezon Province", business: true, hint: "government" },
  { id: "z-106", name: "Dr. Ana Reyes", business: false, mobile: "0917 555 0101" },
  { id: "z-107", name: "Lorna Santos", business: false, mobile: "+63 917 555 0202", terms: "Paid" },
  // The same patient again, the number written another way: one customer.
  { id: "z-108", name: "LORNA SANTOS", business: false, mobile: "09175550202" },
  // A line three or more names share (an office line, a placeholder) says nothing about who
  // they are: each stays their own customer.
  { id: "z-109", name: "Pedro Santos", business: false, mobile: "09175550202", sharedPhone: true },
  // Whose customer it was in Zoho comes along.
  { id: "z-110", name: "Cebu Doctors Hospital", business: true, city: "Cebu City", hint: "hospital", seller: "HOS | CEBU", sellerOn: "2026-10-01", division: "HOS", subDivision: "CEBU", headquarter: "CEBU" },
  // The same number as Dr. Ana Reyes under another spelling: the same doctor.
  { id: "z-111", name: "Dra. Ana P. Reyes", business: false, mobile: "+63 917 555 0101" },
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
    // The licence says what a business is, before its name does.
    expect(kindOf({ name: "Southstar", business: true, licenceType: "DRUGSTORE" })).toBe("drugstore");
    expect(kindOf({ name: "Southstar", business: true, licenceType: "Drug Importer|Wholesaler" })).toBe("distributor");
    expect(kindOf({ name: "St. Luke's", business: true, licenceType: "Hospital" })).toBe("hospital");
    // Zoho has thousands of people typed as a business: no company, no licence, no business order.
    expect(kindOf({ name: "Lorna Santos", business: true, company: false })).toBe("patient");
    expect(kindOf({ name: "Dr. Ana Reyes", business: true, company: false })).toBe("doctor");
    expect(kindOf({ name: "Lorna Santos", business: true, company: false, hint: "patient" })).toBe("patient");
    expect(kindOf({ name: "Lorna Santos", business: true, company: false, hint: "distributor" })).toBe("distributor");
    expect(kindOf({ name: "Lorna Santos", business: true, company: false, licenceNo: "LTO-1" })).toBe("distributor");
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
    expect(dry.said).toMatchObject({ customers: 12, made: 8, joined: 4, alreadyHere: 0 });
    expect(await count("customer")).toBe(before);
    expect(await count("zoho_contact")).toBe(0);
  });

  it("makes each buyer once: twins in Zoho and customers already here are joined", async () => {
    const before = await count("customer");
    const { said } = await send<ZohoCustomersResult>("zoho-customers", { customers, apply: true });
    expect(said).toMatchObject({ made: 8, joined: 4, skipped: 0 });
    expect(said.byKind).toEqual({ hospital: 2, drugstore: 1, distributor: 1, government: 1, doctor: 1, patient: 2 });
    expect(await count("customer")).toBe(before + 8);
    expect(await count("zoho_contact")).toBe(12);
    const linked = await rows<{ zohoId: string; customerId: number }>(
      db,
      sql`select zoho_id as "zohoId", customer_id::int as "customerId" from zoho_contact`,
    );
    const of = (id: string) => linked.find((row) => row.zohoId === id)?.customerId;
    expect(of("z-100")).toBe(hospital);
    expect(of("z-101")).toBe(hospital);
    expect(of("z-108")).toBe(of("z-107"));
    expect(of("z-109")).not.toBe(of("z-107"));
    expect(of("z-111")).toBe(of("z-106"));
    const [cebu] = await rows<{ seller: string; on: string; division: string; sub: string; hq: string }>(
      db,
      sql`select seller, to_char(seller_on, 'YYYY-MM-DD') as on, division, sub_division as sub, headquarter as hq
        from zoho_contact where zoho_id = 'z-110'`,
    );
    expect(cebu).toEqual({ seller: "HOS | CEBU", on: "2026-10-01", division: "HOS", sub: "CEBU", hq: "CEBU" });
    const [lorna] = await rows<{ code: string; phone: string; terms: string; review: string; kind: string }>(
      db,
      sql`select code, phone, payment_terms as terms, review, kind from customer where id = ${of("z-107")}`,
    );
    expect(lorna).toMatchObject({ phone: "0917 555 0202", terms: "advance", review: "ok", kind: "patient" });
    expect(lorna?.code).toMatch(/^CUS-\d{5}$/);
    const [drugstore] = await rows<{ kind: string; licence: string; expires: string }>(
      db,
      sql`select kind, licence_no as licence, to_char(licence_expires, 'YYYY-MM-DD') as expires from customer where id = ${of("z-103")}`,
    );
    expect(drugstore).toEqual({ kind: "drugstore", licence: "LTO-DS-7781", expires: "2027-03-31" });
  });

  it("sending them again adds nothing", async () => {
    const before = await count("customer");
    const { said } = await send<ZohoCustomersResult>("zoho-customers", { customers, apply: true });
    expect(said).toMatchObject({ made: 0, joined: 0, alreadyHere: 12 });
    expect(await count("customer")).toBe(before);
  });
});

describe("a number that says who someone is", () => {
  it("leaves out placeholders and lines many names share", () => {
    expect(identityPhone("0917 555 0101")).toBe("9175550101");
    expect(identityPhone("+63 917 555 0101")).toBe("9175550101");
    expect(identityPhone("0000000000")).toBeNull();
    expect(identityPhone("1234567890")).toBeNull();
    expect(identityPhone("0917 555 0101", true)).toBeNull();
    expect(identityPhone(null)).toBeNull();
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
    expect(prices.customer).toMatchObject({ id: hospital, orders: 2, bought: 552960, firstOn: "2026-06-03", lastOn: "2026-10-12", lastCode: "SO-67227" });
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

describe("Zoho's invoices and payments", () => {
  const invoices = [
    { id: "inv-1", code: "INV-9001", customerId: "z-100", orderCode: "SO-67227", date: "2026-10-13", dueOn: "2026-11-12", status: "Overdue", total: 4809.6, balance: 1809.6, terms: "30 days" },
    { id: "inv-2", code: "INV-8001", customerId: "z-101", orderCode: "SO-61002", date: "2026-06-04", dueOn: "2026-06-04", status: "Closed", total: 720, balance: 0 },
    { id: "inv-3", code: "INV-8500", customerId: "z-100", date: "2026-08-02", status: "Void", total: 100, balance: 100 },
    { id: "inv-4", code: "INV-0001", customerId: "z-nobody", date: "2026-08-02", status: "Open", total: 50, balance: 50 },
  ];
  const payments = [
    { id: "pay-1", paymentNo: "26289", customerId: "z-100", invoiceCode: "INV-9001", date: "2026-10-20", mode: "Bank Transfer", amount: 3000, paymentTotal: 3720 },
    { id: "pay-2", paymentNo: "26289", customerId: "z-101", invoiceCode: "INV-8001", date: "2026-10-20", mode: "Bank Transfer", amount: 720, paymentTotal: 3720 },
  ];

  it("come once, tied to their order, and a rerun brings the latest balance", async () => {
    const dry = await importZohoInvoices(db, invoices, false);
    expect(dry).toMatchObject({ invoices: 4, made: 3, updated: 0, noCustomer: 1, owed: 1809.6 });
    expect(await count("past_invoice")).toBe(0);
    expect(await importZohoInvoices(db, invoices, true)).toMatchObject({ made: 3, noCustomer: 1 });
    expect(await importZohoPayments(db, payments, true)).toMatchObject({ made: 2, alreadyHere: 0 });
    expect(await importZohoPayments(db, payments, true)).toMatchObject({ made: 0, alreadyHere: 2 });
    const [first] = await rows<{ order: string | null; balance: number; status: string; paid: number }>(
      db,
      sql`select (select p.code from past_order p where p.id = v.past_order_id) as order, v.balance::int as balance, v.status,
          (select coalesce(sum(amount), 0)::int from past_payment where past_invoice_id = v.id) as paid
        from past_invoice v where v.zoho_id = 'inv-1'`,
    );
    expect(first).toEqual({ order: "SO-67227", balance: 180960, status: "overdue", paid: 300000 });
    // Paid in Zoho since: the same invoice, its balance now nothing.
    const later = await importZohoInvoices(db, [{ ...invoices[0], status: "Closed", balance: 0 } as (typeof invoices)[number]], true);
    expect(later).toMatchObject({ made: 0, updated: 1, owed: 0 });
    expect(await count("past_invoice")).toBe(3);
    const [now] = await rows<{ balance: number; status: string }>(
      db,
      sql`select balance::int as balance, status from past_invoice where zoho_id = 'inv-1'`,
    );
    expect(now).toEqual({ balance: 0, status: "closed" });
  });
});

describe("the price list's medicines and the shelf", () => {
  const list = [
    {
      sku: "GM-7001",
      aliases: ["GM-7001 ( 500 mg ) ( Tablet )", "GM-9999"],
      name: "TestaGet",
      generic: "Testamycin",
      strength: "500 mg",
      form: "Film-coated Tablet",
      unit: "tablet",
      pack: "Box of 10's",
      packSize: 10,
      category: "ONCOLOGY",
      brand: "2MG",
      rx: true,
      vat: "vat12" as const,
      shelfLifeMonths: 24,
      coldChain: true,
      listNote: "New Med",
      prices: { doctor: 38.61, patient: 55.6, distributor: 30, drugstore: 46.2, hospital: 46.2 },
      packPrices: { doctor: 386.1, patient: 556 },
      srp: 69.5,
      srpPack: 695,
    },
  ];
  const shelf = [
    { sku: "GM-7001", batchNo: "bt26190a", expiresOn: "2028-02-29", warehouse: "Getmeds Philippines Inc.", qty: 77518, unitCost: 12.5 },
    { sku: "GM-9999", batchNo: "BT26190A", expiresOn: "2028-02-29", warehouse: "CEBU WAREHOUSE", qty: 1414, unitCost: 12.5 },
    { sku: "GM-0000", batchNo: "X1", expiresOn: "2028-02-29", warehouse: "CEBU WAREHOUSE", qty: 5, unitCost: null },
  ];

  it("a medicine comes with its SKU, its other SKUs, its prices and its SRP; a rerun changes nothing", async () => {
    expect(await importMedicines(db, list, false)).toMatchObject({ medicines: 1, made: 1, prices: 5 });
    expect(await count("medicine_sku where sku like 'GM-7001%'")).toBe(0);
    expect(await importMedicines(db, list, true)).toMatchObject({ made: 1, updated: 0, prices: 5, aliases: 2, problems: [] });
    const [made] = await rows<Record<string, unknown>>(
      db,
      sql`select code, name, strength, pack_size::int as "packSize", vat, srp::int as srp, srp_pack::int as "srpPack",
          shelf_life_months::int as months, cold_chain as cold, list_note as note,
          (select amount::int from medicine_price where medicine_id = m.id and buyer_type = 'doctor') as doctor,
          (select pack_amount::int from medicine_price where medicine_id = m.id and buyer_type = 'doctor') as "doctorPack",
          (select amount::int from medicine_price where medicine_id = m.id and buyer_type = 'hospital') as hospital,
          (select count(*)::int from price_change where medicine_id = m.id) as logged
        from medicine m where sku = 'GM-7001'`,
    );
    expect(made).toMatchObject({ name: "TestaGet", strength: "500 mg", packSize: 10, vat: "vat12", srp: 6950, srpPack: 69500, months: 24, cold: true, note: "New Med", doctor: 3861, doctorPack: 38610, hospital: 4620, logged: 5 });
    expect(String(made?.code)).toMatch(/^MED-\d{5}$/);
    expect(await importMedicines(db, list, true)).toMatchObject({ made: 0, updated: 1, prices: 0, aliases: 0 });
    // A new price list: only the price that moved is set, and logged.
    const moved = [{ ...list[0], prices: { ...list[0]?.prices, doctor: 40 } }] as typeof list;
    expect(await importMedicines(db, moved, true)).toMatchObject({ updated: 1, prices: 1 });
    expect(await count("price_change where medicine_id = (select id from medicine where sku = 'GM-7001')")).toBe(6);
  });

  it("the batches go on the shelf in their warehouses once, under whichever SKU they came", async () => {
    const before = await count("warehouse");
    const said = await importOpeningStock(db, shelf, true);
    expect(said).toMatchObject({ batches: 3, put: 2, pieces: 78932, alreadyHere: 0, noMedicine: 1 });
    expect(await count("warehouse")).toBe(before + said.warehouses.length);
    const [held] = await rows<{ batches: number; pieces: number; moves: number; cost: number }>(
      db,
      sql`select count(distinct b.id)::int as batches, sum(s.qty)::int as pieces,
          (select coalesce(sum(qty), 0)::int from stock_move v where v.medicine_id = b.medicine_id and v.ref = 'ZOHO') as moves,
          max(b.unit_cost)::int as cost
        from batch b join stock s on s.batch_id = b.id
        where b.medicine_id = (select id from medicine where sku = 'GM-7001') group by b.medicine_id`,
    );
    // One batch in two warehouses; the shelf is the sum of its moves.
    expect(held).toEqual({ batches: 1, pieces: 78932, moves: 78932, cost: 1250 });
    expect(await importOpeningStock(db, shelf, true)).toMatchObject({ put: 0, alreadyHere: 2 });
  });

  it("an old order's line finds the medicine through any SKU it went by", async () => {
    const said = await send<ZohoOrdersResult>("zoho-orders", {
      apply: true,
      orders: [
        { id: "so-90", code: "SO-69001", customerId: "z-100", date: "2026-11-02", status: "invoiced", total: 500, lines: [{ sku: "gm-9999", name: "Old name in Zoho", qty: 10, rate: 50, itemTotal: 500 }] },
      ],
    });
    expect(said.said).toMatchObject({ made: 1 });
    const prices = await read<CustomerPrices>("sarla", `/api/customers/${hospital}/prices`);
    const found = prices.medicines.find((one) => one.sku === "GM-7001");
    // This order, and the older one whose line stood under Zoho's name until the SKU was known.
    expect(found).toMatchObject({ name: "TestaGet 500 mg", times: 2, lastPrice: 5000 });
    expect(found?.medicineId).not.toBeNull();
  });
});
