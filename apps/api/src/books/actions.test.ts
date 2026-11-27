import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedDemoInventory } from "../inventory/seed";
import { seedDemo } from "../seed";
import type { BookChoices, BookDoc, VendorDetail } from "../types";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
const get = (who: string, path: string) => app.request(path, { headers: { cookie: cookies[who] as string } });
const post = (who: string, path: string, body: unknown) =>
  app.request(path, { method: "POST", headers: { "content-type": "application/json", cookie: cookies[who] as string }, body: JSON.stringify(body) });
const json = async <T>(response: Response) => {
  if (response.status !== 200) throw new Error(`${response.status} ${await response.text()}`);
  return (await response.json()) as T;
};

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  await seedDemoInventory(db);
  // The company's chart has its freight account: since 27 Nov a bill names only the chart's accounts.
  await db.execute(sql`insert into book_account (name, type) values ('Freight Charges', 'expense'), ('Cash in Bank - BDO', 'bank') on conflict do nothing`);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["irene", "fiona", "ryan", "naresh"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
});

describe("making Purchases documents", () => {
  it("order → receive into stock → bill → pay part, credit the rest → void the payment", async () => {
    const vendor = await json<{ id: number }>(await post("irene", "/api/books/vendors", { name: "Venus Remedies", currency: "PHP", email: "orders@venus.test" }));
    const choices = await json<BookChoices>(await get("irene", "/api/books-choices"));
    const medicine = choices.medicines[0] as BookChoices["medicines"][number];
    const warehouse = choices.warehouses[0] as BookChoices["warehouses"][number];
    expect(choices.next.purchaseOrder).toBe("PO-00001");
    // Only Inventory and the Admin order; a MedRep sees nothing of it.
    expect((await post("fiona", "/api/books/purchase_order/new", {})).status).toBe(400);
    expect((await get("ryan", "/api/books-choices")).status).toBe(403);
    const order = await json<{ id: number }>(
      await post("irene", "/api/books/purchase_order/new", {
        supplierId: vendor.id,
        date: choices.today,
        warehouseId: warehouse.id,
        issue: true,
        terms: "Deliver by noon",
        lines: [
          { medicineId: medicine.id, qty: 100, rate: 25 },
          { itemName: "Freight", account: "Freight Charges", qty: 1, rate: 500 },
        ],
      }),
    );
    let po = await json<BookDoc>(await get("irene", `/api/books/purchase_order/${order.id}`));
    expect(po).toMatchObject({ number: "PO-00001", status: "issued", total: 300000, received: "none", billed: "none" });
    const [medLine, freight] = po.lines;
    // Expired or batch-less medicine isn't received; more than ordered isn't either.
    expect((await post("irene", `/api/books/purchase_order/${order.id}/receive`, { date: choices.today, lines: [{ lineId: medLine?.id, qty: 60 }] })).status).toBe(400);
    expect((await post("irene", `/api/books/purchase_order/${order.id}/receive`, { date: choices.today, lines: [{ lineId: medLine?.id, qty: 160, batchNo: "b1", expiresOn: "2030-01-31" }] })).status).toBe(400);
    const before = await rows<{ qty: number }>(db, sql`select coalesce(sum(s.qty), 0)::int as qty from stock s join batch b on b.id = s.batch_id where b.medicine_id = ${medicine.id}`);
    const receive = await json<{ id: number }>(
      await post("irene", `/api/books/purchase_order/${order.id}/receive`, { date: choices.today, lines: [{ lineId: medLine?.id, qty: 60, batchNo: "vr-2030", expiresOn: "2030-01-31" }] }),
    );
    const after = await rows<{ qty: number }>(db, sql`select coalesce(sum(s.qty), 0)::int as qty from stock s join batch b on b.id = s.batch_id where b.medicine_id = ${medicine.id}`);
    expect((after[0]?.qty ?? 0) - (before[0]?.qty ?? 0)).toBe(60);
    const [batch] = await rows<{ cost: number }>(db, sql`select unit_cost::int as cost from batch where batch_no = 'VR-2030'`);
    expect(batch?.cost).toBe(2500);
    po = await json<BookDoc>(await get("irene", `/api/books/purchase_order/${order.id}`));
    expect(po.received).toBe("partial");
    expect(po.linkedDocs.map((d) => [d.kind, d.number])).toEqual([["purchase_receive", "PR-00001"]]);
    // Convert to bill: what came, and the freight.
    const bill = await json<{ id: number }>(
      await post("irene", `/api/books/purchase_order/${order.id}/bill`, {
        number: "VR-INV-1",
        date: choices.today,
        dueDate: "2099-12-31",
        receiveId: receive.id,
        orderLines: [
          { lineId: medLine?.id, qty: 60, rate: 25 },
          { lineId: freight?.id, qty: 1, rate: 500 },
        ],
      }),
    );
    expect((await post("irene", `/api/books/purchase_order/${order.id}/bill`, { number: "VR-INV-1", date: choices.today, orderLines: [{ lineId: medLine?.id, qty: 1, rate: 25 }] })).status).toBe(409);
    po = await json<BookDoc>(await get("irene", `/api/books/purchase_order/${order.id}`));
    expect(po).toMatchObject({ status: "partially_billed", billed: "partial" });
    // Finance pays 1,500 of the 2,000 bill with a 2,000 payment: 500 stays unused, then goes on it.
    expect((await post("irene", "/api/books/vendor_payment/new", {})).status).toBe(400);
    const payment = await json<{ id: number }>(
      await post("fiona", "/api/books/vendor_payment/new", { supplierId: vendor.id, date: choices.today, amount: 200000, mode: "Bank Transfer", bills: [{ billId: bill.id, amount: 150000 }] }),
    );
    let paid = await json<BookDoc>(await get("fiona", `/api/books/bill/${bill.id}`));
    expect(paid).toMatchObject({ status: "partially_paid", balance: 50000 });
    let vendorNow = await json<VendorDetail>(await get("fiona", `/api/books/vendors/${vendor.id}`));
    expect(vendorNow).toMatchObject({ payables: 50000, credits: 50000 });
    const credit = await json<{ id: number }>(await post("fiona", "/api/books/vendor_credit/new", { supplierId: vendor.id, date: choices.today, lines: [{ medicineId: medicine.id, qty: 4, rate: 25 }] }));
    expect((await post("fiona", `/api/books/vendor_credit/${credit.id}/apply`, { date: choices.today, bills: [{ billId: bill.id, amount: 20000 }] })).status).toBe(400);
    await json(await post("fiona", `/api/books/vendor_credit/${credit.id}/apply`, { date: choices.today, bills: [{ billId: bill.id, amount: 10000 }] }));
    await json(await post("fiona", `/api/books/vendor_payment/${payment.id}/apply`, { date: choices.today, bills: [{ billId: bill.id, amount: 40000 }] }));
    paid = await json<BookDoc>(await get("fiona", `/api/books/bill/${bill.id}`));
    expect(paid).toMatchObject({ status: "paid", balance: 0 });
    // A bill with money on it isn't voided; voiding the payment puts its 1,900 back on the bill.
    expect((await post("fiona", `/api/books/bill/${bill.id}/void`, { reason: "typo" })).status).toBe(409);
    await json(await post("fiona", `/api/books/vendor_payment/${payment.id}/void`, { reason: "Bounced" }));
    paid = await json<BookDoc>(await get("fiona", `/api/books/bill/${bill.id}`));
    expect(paid).toMatchObject({ status: "partially_paid", balance: 190000 });
    vendorNow = await json<VendorDetail>(await get("naresh", `/api/books/vendors/${vendor.id}`));
    expect(vendorNow).toMatchObject({ payables: 190000, credits: 0 });
  });

  it("names only the chart's accounts: a typo is refused, a different spelling takes the chart's (27 Nov)", async () => {
    const vendor = await json<{ id: number }>(await post("fiona", "/api/books/vendors", { name: "Chart Check Supplies", currency: "PHP" }));
    const choices = await json<BookChoices>(await get("fiona", "/api/books-choices"));
    // The form's lists are the chart's, so a new company with no bills still has them.
    expect(choices.accounts).toContain("Freight Charges");
    expect(choices.paidThrough).toContain("Cash in Bank - BDO");
    expect(choices.paidThrough).not.toContain("Freight Charges");
    const typo = await post("fiona", "/api/books/bill/new", { supplierId: vendor.id, number: "CC-1", date: choices.today, lines: [{ itemName: "Courier", account: "Freight Charge", qty: 1, rate: 100 }] });
    expect(typo.status).toBe(400);
    expect(((await typo.json()) as { error: { field: string } }).error.field).toBe("lines.0.account");
    const bill = await json<{ id: number }>(
      await post("fiona", "/api/books/bill/new", { supplierId: vendor.id, number: "CC-2", date: choices.today, lines: [{ itemName: "Courier", account: "freight charges", qty: 1, rate: 100 }] }),
    );
    const [line] = await rows<{ account: string }>(db, sql`select account from book_line where doc_id = ${bill.id}`);
    expect(line?.account).toBe("Freight Charges");
    // Paid through an account the chart doesn't have, or one that isn't money: refused.
    const pay = (paidThrough: string) =>
      post("fiona", "/api/books/vendor_payment/new", { supplierId: vendor.id, date: choices.today, amount: 10000, paidThrough, bills: [{ billId: bill.id, amount: 10000 }] });
    expect((await pay("BDO Bank")).status).toBe(400);
    expect((await pay("Freight Charges")).status).toBe(400);
    expect((await pay("cash in bank - bdo")).status).toBe(200);
  });
});
