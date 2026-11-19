// The invoice is made when Management approves (Aryan, 17 Nov), so it exists before Finance's
// check. Advance pay: not owed or late until Finance has checked the money, which comes in once.
// A paid order brought back after a cancel isn't paid twice. Finance weighs an order against
// what the customer owed before it, not against the order's own invoice. Management's own
// order for a patient waits for its prescription like anyone's.

import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { runChecks } from "../checks/integrity";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedFixture } from "../inventory/fixture";
import { todayManila } from "../inventory/rules";
import { seedDemo } from "../seed";
import { attachPaper } from "../testing/receipt";
import type { Catalogue, FinanceBoard, OrderBoard, OrderDetail, RefundList } from "../types";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
let advance = 0;
let credit = 0;
let patient = 0;
let medicine: { id: number; price: number };

const get = (who: string, path: string) =>
  app.request(path, { headers: { cookie: cookies[who] as string } });
const read = async <T>(who: string, path: string) => (await (await get(who, path)).json()) as T;
const post = (who: string, path: string, body: unknown = {}) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookies[who] as string },
    body: JSON.stringify(body),
  });
const ok = async (who: string, path: string, body: unknown = {}) => {
  const response = await post(who, path, body);
  expect(response.status, `${who} ${path}: ${await response.clone().text()}`).toBe(200);
  return response;
};
const order = (id: number) => read<OrderDetail>("fiona", `/api/orders/${id}`);
async function approved(customerId: number): Promise<number> {
  const response = await ok("ryan", "/api/orders", {
    customerId,
    items: [{ medicineId: medicine.id, qty: 10, priceKind: "hospital" }],
  });
  const { id } = (await response.json()) as { id: number };
  await ok("sarla", `/api/orders/${id}/approve`);
  return id;
}
const pay = (amount: number) => ({
  amount,
  method: "bank",
  reference: "BDO-1",
  paidOn: todayManila(),
  checked: true,
});
const overpaid = async () =>
  (await runChecks(db)).checks.find((check) => check.key === "overpaid")?.ok ?? true;

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  await seedFixture(db);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["ryan", "sarla", "fiona", "admin"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
  const catalogue = await read<Catalogue>("sarla", "/api/inventory/medicines");
  const row = catalogue.rows.find((item) => item.prices.hospital !== undefined && item.total >= 100);
  medicine = { id: row?.id as number, price: row?.prices.hospital as number };
  const add = async (body: unknown) =>
    ((await (await post("sarla", "/api/customers", body)).json()) as { id: number }).id;
  advance = await add({ kind: "hospital", name: "Advance Pay Hospital", city: "Pasay", paymentTerms: "advance" });
  // A credit limit the order fits under by itself: only its own invoice counted twice goes over.
  credit = await add({
    kind: "hospital",
    name: "Credit Line Hospital",
    city: "Pasay",
    paymentTerms: "days",
    paymentDays: 30,
    creditLimit: medicine.price * 10 + 100,
  });
  patient = await add({ kind: "patient", name: "Lolo Santos", phone: "0917 555 0144", city: "Pasay", paymentTerms: "advance" });
});

describe("the invoice made at approval", () => {
  it("leaves an advance order's money to Finance's check: not owed, not collected, taken in once", async () => {
    const id = await approved(advance);
    const placed = await order(id);
    expect(placed.order.status).toBe("finance_check");
    const invoice = placed.money.invoice;
    expect(invoice?.status).toBe("open");
    // Days later, still waiting for the money: not late, not on the Collect lane.
    await db.execute(
      sql`update invoice set issued_on = issued_on - 3, due_on = due_on - 3 where order_id = ${id}`,
    );
    const board = await read<FinanceBoard>("fiona", "/api/finance/board");
    expect(board.collect.some((row) => row.orderId === id)).toBe(false);
    expect(board.check.some((card) => card.id === id)).toBe(true);
    expect(placed.can.recordPayment).toBe(false);
    // Recording it on the invoice is refused: the money comes in with the payment check.
    const recorded = await post("fiona", `/api/invoices/${invoice?.id}/payments`, {
      amount: invoice?.total,
      method: "bank",
      reference: "X",
      paidOn: todayManila(),
    });
    expect(recorded.status).toBe(409);
    expect(await attachPaper(app, cookies.ryan as string, id, "payment_proof")).toBe(200);
    await ok("fiona", `/api/finance/orders/${id}/confirm-payment`, pay(invoice?.total as number));
    const paid = await order(id);
    expect(paid.money.invoice).toMatchObject({ status: "paid", paid: invoice?.total });
    expect(await overpaid()).toBe(true);
  });

  it("confirms a paid order brought back after a cancel with nothing more to pay", async () => {
    const id = await approved(advance);
    const total = (await order(id)).order.total;
    expect(await attachPaper(app, cookies.ryan as string, id, "payment_proof")).toBe(200);
    await ok("fiona", `/api/finance/orders/${id}/confirm-payment`, pay(total));
    await ok("sarla", `/api/orders/${id}/cancel`, { reason: "Customer cancelled" });
    const owed = () => read<RefundList>("fiona", "/api/finance/refunds");
    expect((await owed()).owed.some((row) => row.orderId === id)).toBe(true);
    const count = async () =>
      (await read<FinanceBoard>("fiona", "/api/finance/board")).money.refunds;
    const before = await count();
    await ok("sarla", `/api/orders/${id}/restore`, { reason: "They want it after all" });
    // Brought back: the money waits for the order again, off Refunds owed and its count.
    expect((await owed()).owed.some((row) => row.orderId === id)).toBe(false);
    expect(await count()).toBe(before - 1);
    await ok("sarla", `/api/orders/${id}/approve`);
    const again = await order(id);
    expect(again.order.status).toBe("finance_check");
    expect(again.money.invoice).toMatchObject({ status: "paid", paid: total });
    // More than what is left is refused; ₱0 confirms it.
    expect((await post("fiona", `/api/finance/orders/${id}/confirm-payment`, pay(total))).status).toBe(400);
    await ok("fiona", `/api/finance/orders/${id}/confirm-payment`, pay(0));
    const done = await order(id);
    expect(done.order.status).toBe("ready_for_dispatch");
    expect(done.money.invoice).toMatchObject({ status: "paid", paid: total });
    expect(await overpaid()).toBe(true);
  });

  it("weighs a credit order against what the customer owed before it", async () => {
    const id = await approved(credit);
    const board = await read<FinanceBoard>("fiona", "/api/finance/board");
    const card = board.invoice.find((row) => row.id === id);
    expect(card?.owed).toBe(0);
    const cards = await read<OrderBoard>("fiona", "/api/orders/board?desk=finance&tab=needs");
    const own = cards.cards.find((row) => row.id === id);
    expect(own?.findings.map((finding) => finding.kind)).not.toContain("credit");
    // The order page shows Finance the same.
    expect((await order(id)).findings.map((finding) => finding.kind)).not.toContain("credit");
  });

  it("takes the tax a customer withheld with its 2307: settled, but no cash and never given back", async () => {
    const id = await approved(credit);
    const total = (await order(id)).order.total;
    await ok("fiona", `/api/finance/orders/${id}/invoice`, {});
    const invoice = (await order(id)).money.invoice;
    const withheld = Math.round(total * 0.01);
    const pay = (body: object) =>
      post("fiona", `/api/invoices/${invoice?.id}/payments`, {
        amount: total - withheld,
        method: "bank",
        reference: "BDO-9",
        paidOn: todayManila(),
        withheld,
        ...body,
      });
    // The 2307's number is needed with the tax withheld.
    expect((await pay({})).status).toBe(400);
    const before = (await read<FinanceBoard>("fiona", "/api/finance/board")).money.inToday;
    expect((await pay({ form2307: "2307-0001" })).status).toBe(200);
    const paid = await order(id);
    expect(paid.money.invoice).toMatchObject({ status: "paid", paid: total });
    expect(paid.money.payments.map((one) => [one.method, one.amount])).toEqual([
      ["bank", total - withheld],
      ["withholding", withheld],
    ]);
    // Money in counts only the cash.
    expect((await read<FinanceBoard>("fiona", "/api/finance/board")).money.inToday).toBe(
      before + total - withheld,
    );
    expect(await overpaid()).toBe(true);
  });

  it("keeps an invoice's lines as billed when Inventory renames the medicine or changes its VAT", async () => {
    const id = await approved(credit);
    const invoice = (await order(id)).money.invoice;
    const before = await read<{ items: { medicine: string; vat: string }[] }>("fiona", `/api/invoices/${invoice?.id}`);
    const [was] = await rows<{ name: string; vat: string }>(db, sql`select name, vat from medicine where id = ${medicine.id}`);
    await db.execute(
      sql`update medicine set name = name || ' (new pack)', vat = case when vat = 'vat12' then 'exempt' else 'vat12' end where id = ${medicine.id}`,
    );
    const after = await read<{ items: { medicine: string; vat: string }[] }>("fiona", `/api/invoices/${invoice?.id}`);
    expect(after.items).toEqual(before.items);
    expect(after.items[0]?.vat).toBe(was?.vat);
    await db.execute(sql`update medicine set name = ${was?.name}, vat = ${was?.vat} where id = ${medicine.id}`);
  });

  it("holds the Admin's own order for a patient until its prescription is on it", async () => {
    const response = await ok("admin", "/api/orders", {
      customerId: patient,
      items: [{ medicineId: medicine.id, qty: 2, priceKind: "patient" }],
    });
    const { id } = (await response.json()) as { id: number };
    const placed = await order(id);
    expect(placed.order.status).toBe("pending_approval");
    expect(placed.money.invoice).toBeNull();
    expect((await post("sarla", `/api/orders/${id}/approve`)).status).toBe(409);
    expect(await attachPaper(app, cookies.sarla as string, id, "prescription")).toBe(200);
    await ok("sarla", `/api/orders/${id}/approve`);
    expect((await order(id)).money.invoice?.status).toBe("open");
  });
});
