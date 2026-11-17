// The order line kept safe (docs/PLAN.md 18, Aryan 17 Nov): Management sees the MedRep's note and
// any price other than the list's, up or down; every version of an order is kept and the MedRep
// sees what Management changed; a senior citizen's or PWD's order is priced by the law, never
// twice, and its invoice shows their ID; Finance's checks count what Zoho says is still owed.

import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedFixture } from "../inventory/fixture";
import { seedDemo } from "../seed";
import type {
  Catalogue,
  OwedList,
  FinanceBoard,
  InvoiceDetail,
  MyOrders,
  OrderDetail,
} from "../types";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
let hospital = 0;
let patient = 0;
let medicine: { id: number; hospital: number; patient: number; vat: string };

const get = (who: string, path: string) =>
  app.request(path, { headers: { cookie: cookies[who] as string } });
const read = async <T>(who: string, path: string) => (await (await get(who, path)).json()) as T;
const post = (who: string, path: string, body: unknown = {}) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookies[who] as string },
    body: JSON.stringify(body),
  });
const placed = async (who: string, body: unknown) => {
  const response = await post(who, "/api/orders", body);
  expect(response.status, await response.clone().text()).toBe(200);
  return ((await response.json()) as { id: number }).id;
};
const detail = (id: number) => read<OrderDetail>("sarla", `/api/orders/${id}`);
/** The law's price: VAT out of a 12% medicine, then 20% off. */
const lawPrice = (price: number, vat: string) =>
  Math.round((vat === "vat12" ? price / 1.12 : price) * 0.8);

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  await seedFixture(db);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["ryan", "sarla", "fiona"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
  const add = async (body: unknown) =>
    ((await (await post("sarla", "/api/customers", body)).json()) as { id: number }).id;
  hospital = await add({ kind: "hospital", name: "Pasay General Hospital", city: "Pasay", paymentTerms: "cod" });
  patient = await add({ kind: "patient", name: "Lola Cruz", phone: "0917 555 0199", city: "Pasay", paymentTerms: "cod" });
  const catalogue = await read<Catalogue>("sarla", "/api/inventory/medicines");
  const row = catalogue.rows.find(
    (item) =>
      item.prices.hospital !== undefined &&
      item.prices.patient !== undefined &&
      item.total >= 100 &&
      !item.promo,
  );
  if (!row) throw new Error("the fixture has no medicine with hospital and patient prices and no promo");
  medicine = {
    id: row.id,
    hospital: row.prices.hospital as number,
    patient: row.prices.patient as number,
    vat: row.vat,
  };
});

describe("what Management sees on a MedRep's order", () => {
  it("the MedRep's note, as a check to read", async () => {
    const id = await placed("ryan", {
      customerId: hospital,
      items: [{ medicineId: medicine.id, qty: 5, priceKind: "hospital" }],
      note: "Their pharmacist asked for delivery before Friday",
    });
    const found = (await detail(id)).findings;
    expect(found.find((one) => one.kind === "note")?.text).toContain("before Friday");
  });

  it("a price above the list, with its reason; none without one", async () => {
    const above = {
      customerId: hospital,
      items: [{ medicineId: medicine.id, qty: 5, priceKind: "hospital", unitPrice: medicine.hospital + 500 }],
    };
    const refused = await post("ryan", "/api/orders", above);
    expect(refused.status).toBe(400);
    expect(await refused.text()).toContain("above");
    const id = await placed("ryan", {
      ...above,
      items: [{ ...above.items[0], reason: "Their own quote was higher" }],
    });
    const order = await detail(id);
    expect(order.items[0]).toMatchObject({ unitPrice: medicine.hospital + 500, reason: "Their own quote was higher" });
    expect(order.findings.map((one) => one.short)).toContain("Above hospital price");
  });
});

describe("an order's versions", () => {
  it("keeps the placed lines and Management's change, and marks the order changed for the MedRep", async () => {
    const id = await placed("ryan", {
      customerId: hospital,
      items: [{ medicineId: medicine.id, qty: 5, priceKind: "hospital" }],
    });
    const change = (answer: string) =>
      post("sarla", `/api/orders/${id}/change`, {
        customerId: hospital,
        items: [
          { medicineId: medicine.id, qty: 10, priceKind: "hospital", unitPrice: medicine.hospital },
          { medicineId: medicine.id, qty: 1, priceKind: "hospital", free: true, reason: "Buy 10 Take 1" },
        ],
        answer,
      });
    // Management says why every time: the MedRep reads it.
    expect((await change("")).status).toBe(400);
    const changed = await change("Promo Buy 10 Take 1");
    expect(changed.status, await changed.clone().text()).toBe(200);
    const order = await detail(id);
    expect(order.versions.map((one) => [one.n, one.kind, one.total])).toEqual([
      [1, "placed", 5 * medicine.hospital],
      [2, "changed", 10 * medicine.hospital],
    ]);
    expect(order.versions[1]?.why).toBe("Promo Buy 10 Take 1");
    expect(order.versions[1]?.by).toBeTruthy();
    expect(order.versions[0]?.lines.map((line) => [line.qty, line.free])).toEqual([[5, false]]);
    expect(order.versions[1]?.lines.map((line) => [line.qty, line.free])).toEqual([
      [10, false],
      [1, true],
    ]);
    const mine = await read<MyOrders>("ryan", "/api/orders/mine");
    expect(mine.cards.find((card) => card.id === id)?.changed).toBe(true);
    // An order never changed carries no mark.
    expect(mine.cards.filter((card) => card.id !== id).every((card) => !card.changed)).toBe(true);
  });

  it("keeps the MedRep's fix as its own version", async () => {
    const id = await placed("ryan", {
      customerId: hospital,
      items: [{ medicineId: medicine.id, qty: 5, priceKind: "hospital" }],
    });
    expect((await post("sarla", `/api/orders/${id}/send_back`, { reason: "Make it 8" })).status).toBe(200);
    const fixed = await post("ryan", `/api/orders/${id}/revise`, {
      customerId: hospital,
      items: [{ medicineId: medicine.id, qty: 8, priceKind: "hospital" }],
      answer: "Made it 8",
    });
    expect(fixed.status, await fixed.clone().text()).toBe(200);
    const order = await detail(id);
    expect(order.versions.map((one) => one.kind)).toEqual(["placed", "fixed"]);
    expect(order.versions[1]?.lines[0]?.qty).toBe(8);
  });
});

describe("a senior citizen's or PWD's order", () => {
  const relief = { kind: "senior", idNo: "OSCA-2026-0042", name: "Lola Cruz" };

  it("needs the ID number, and goes on any order whose buyer shows the ID", async () => {
    const noId = await post("ryan", "/api/orders", {
      customerId: patient,
      items: [{ medicineId: medicine.id, qty: 2, priceKind: "patient" }],
      relief: { kind: "senior" },
    });
    expect(noId.status).toBe(400);
    expect(await noId.text()).toContain("OSCA");
    // A hospital's order too (Aryan, 17 Nov): from the patient price, without VAT, 20% off.
    const id = await placed("ryan", {
      customerId: hospital,
      items: [{ medicineId: medicine.id, qty: 2, priceKind: "hospital" }],
      relief: { kind: "pwd", idNo: "PWD-13-0007", name: "Juan Dela Cruz" },
    });
    const order = await detail(id);
    expect(order.items[0]).toMatchObject({
      unitPrice: lawPrice(medicine.patient, medicine.vat),
      listPrice: medicine.patient,
      priceKind: "patient",
      relief: true,
    });
    expect(order.findings.map((one) => one.short)).toContain("No SC/PWD ID");
  });

  it("is priced by the law whatever price is sent, keeps it through a change, and invoices it VAT-exempt with the ID", async () => {
    const id = await placed("ryan", {
      customerId: patient,
      // A typed price on an SC/PWD line is not taken: the law's is.
      items: [{ medicineId: medicine.id, qty: 2, priceKind: "patient", unitPrice: 100 }],
      relief,
    });
    const law = lawPrice(medicine.patient, medicine.vat);
    let order = await detail(id);
    expect(order.order.relief).toEqual(relief);
    expect(order.items[0]).toMatchObject({ unitPrice: law, relief: true, listPrice: medicine.patient });
    expect(order.findings.map((one) => one.short)).toContain("No SC/PWD ID");
    expect(order.findings.map((one) => one.short)).not.toContain("Below patient price");

    // Management adds a free piece and sends the line back at its price: not VAT-stripped again.
    const changed = await post("sarla", `/api/orders/${id}/change`, {
      customerId: patient,
      items: [
        { medicineId: medicine.id, qty: 2, priceKind: "patient", unitPrice: law },
        { medicineId: medicine.id, qty: 1, priceKind: "patient", free: true, reason: "Sample" },
      ],
      answer: "One sample for her",
    });
    expect(changed.status, await changed.clone().text()).toBe(200);
    order = await detail(id);
    expect(order.order.relief).toEqual(relief);
    expect(order.items.map((item) => [item.unitPrice, item.relief, item.free])).toEqual([
      [law, true, false],
      [0, false, true],
    ]);

    expect((await post("sarla", `/api/orders/${id}/approve`)).status).toBe(200);
    const made = await post("fiona", `/api/finance/orders/${id}/invoice`);
    expect(made.status, await made.clone().text()).toBe(200);
    const [invoice] = await rows<{ id: number }>(db, sql`select id::int as id from invoice where order_id = ${id}`);
    const printed = await read<InvoiceDetail>("fiona", `/api/invoices/${invoice?.id}`);
    expect(printed.invoice).toMatchObject({ vat: 0, vatable: 0, exempt: 2 * law });
    expect(printed.invoice.relief).toEqual(relief);
  });
});

describe("what Finance counts as owed", () => {
  it("Zoho's unpaid invoices and opening balance, beside this CRM's", async () => {
    await db.execute(
      sql`insert into book_doc (kind, zoho_id, number, doc_date, due_date, status, customer_id, total, balance)
        values ('invoice', 'Z-1', 'INV-Z-1', '2026-01-10', '2026-02-09', 'overdue', ${hospital}, 500000, 300000),
               ('invoice', 'Z-2', 'INV-Z-2', '2026-01-10', '2026-02-09', 'void', ${hospital}, 900000, 900000)`,
    );
    await db.execute(sql`update customer set opening_receivables = 20000 where id = ${hospital}`);
    const id = await placed("ryan", {
      customerId: hospital,
      items: [{ medicineId: medicine.id, qty: 1, priceKind: "hospital" }],
    });
    const order = await detail(id);
    expect(order.findings.map((one) => one.kind)).toContain("owes");
    const owe = await read<OwedList>("fiona", "/api/finance/owed");
    const row = owe.rows.find((one) => one.customerId === hospital);
    // The void Zoho invoice counts for nothing; the opening balance is the oldest.
    expect(row).toMatchObject({ total: 320000, overdue: 320000 });
    expect(row?.older).toBeGreaterThanOrEqual(20000);
    // Finance's board counts it on the order's card.
    expect((await post("sarla", `/api/orders/${id}/approve`)).status).toBe(200);
    const board = await read<FinanceBoard>("fiona", "/api/finance/board");
    const card = [...board.check, ...board.invoice].find((one) => one.id === id);
    expect(card).toMatchObject({ owed: 320000, overdue: 320000 });
  });
});
