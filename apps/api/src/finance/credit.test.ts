// A customer's credit (step C3): Zoho's open credit notes and money kept from a bill. Finance sees
// it with the order's dues, uses it on an invoice (no cash in, never given back as cash), gets it
// back for the customer when that invoice is cancelled, and can keep an overpayment as credit
// instead of giving it back.

import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { ticked } from "../testing/approve";
import { createApp } from "../app";
import { runChecks } from "../checks/integrity";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedFixture } from "../inventory/fixture";
import { todayManila } from "../inventory/rules";
import { seedDemo } from "../seed";
import { attachPaper } from "../testing/receipt";
import type { Catalogue, CustomerCredit, FinanceBoard, OrderDetail, RefundList } from "../types";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
let hospital = 0;
let advance = 0;
let medicine: { id: number; price: number };
let note = 0;

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
const credit = (customer: number) => read<CustomerCredit>("fiona", `/api/customers/${customer}/credit`);
async function approved(customerId: number, qty = 10): Promise<number> {
  const response = await ok("ryan", "/api/orders", {
    customerId,
    items: [{ medicineId: medicine.id, qty, priceKind: "hospital" }],
  });
  const { id } = (await response.json()) as { id: number };
  await ok("sarla", await ticked(db, `/api/orders/${id}/approve`));
  return id;
}

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
  const catalogue = await read<Catalogue>("sarla", "/api/inventory/medicines");
  const row = catalogue.rows.find((item) => item.prices.hospital !== undefined && item.total >= 100);
  medicine = { id: row?.id as number, price: row?.prices.hospital as number };
  const add = async (body: unknown) =>
    ((await (await post("sarla", "/api/customers", body)).json()) as { id: number }).id;
  hospital = await add({ kind: "hospital", name: "Credit Note Hospital", city: "Pasay", paymentTerms: "days", paymentDays: 30 });
  advance = await add({ kind: "hospital", name: "Paid Ahead Hospital", city: "Pasay", paymentTerms: "advance" });
  // A credit note Zoho left open for the hospital: ₱3,000 still theirs.
  const [made] = await rows<{ id: number }>(
    db,
    sql`insert into book_doc (kind, zoho_id, number, doc_date, status, customer_id, party_name, total, balance)
      values ('credit_note', 'zcn-1', 'CN-00893', '2026-03-02', 'open', ${hospital}, 'Credit Note Hospital', 500000, 300000)
      returning id::int as id`,
  );
  note = made?.id as number;
});

describe("a customer's credit", () => {
  it("shows Zoho's open credit note, is used on an invoice, and comes back if it is cancelled", async () => {
    expect(await credit(hospital)).toMatchObject({
      total: 300000,
      sources: [{ kind: "zoho", number: "CN-00893", amount: 300000, left: 300000 }],
    });
    const id = await approved(hospital);
    await ok("fiona", `/api/finance/orders/${id}/invoice`);
    const placed = await order(id);
    expect(placed.dues.credit).toBe(300000);
    const invoice = placed.money.invoice;
    const before = (await read<FinanceBoard>("fiona", "/api/finance/board")).money.inToday;
    // More than is left of the note, or a MedRep, is refused.
    expect((await post("fiona", `/api/invoices/${invoice?.id}/credit`, { kind: "zoho", sourceId: note, amount: 300001 })).status).toBe(400);
    expect((await post("ryan", `/api/invoices/${invoice?.id}/credit`, { kind: "zoho", sourceId: note, amount: 100 })).status).toBe(403);
    const use = Math.min(200000, invoice?.total as number);
    await ok("fiona", `/api/invoices/${invoice?.id}/credit`, { kind: "zoho", sourceId: note, amount: use });
    const after = await order(id);
    expect(after.money.invoice?.paid).toBe(use);
    expect(after.money.payments.at(-1)).toMatchObject({ method: "credit", amount: use, reference: "CN-00893" });
    expect((await credit(hospital)).total).toBe(300000 - use);
    // Not money in.
    expect((await read<FinanceBoard>("fiona", "/api/finance/board")).money.inToday).toBe(before);
    // Cancelled: the credit is the customer's again, and nothing is owed back as cash.
    await ok("sarla", `/api/orders/${id}/cancel`, { reason: "Hospital cancelled" });
    expect((await credit(hospital)).total).toBe(300000);
    const owed = await read<RefundList>("fiona", "/api/finance/refunds");
    expect(owed.owed.some((row) => row.orderId === id)).toBe(false);
  });

  it("keeps money paid beyond a bill as credit for the next invoice instead of giving it back", async () => {
    const first = await approved(advance, 10);
    const total = (await order(first)).order.total;
    expect(await attachPaper(app, cookies.ryan as string, first, "payment_proof")).toBe(200);
    await ok("fiona", `/api/finance/orders/${first}/confirm-payment`, {
      amount: total,
      method: "bank",
      reference: "BDO-7",
      paidOn: todayManila(),
      checked: true,
    });
    await ok("sarla", `/api/orders/${first}/cancel`, { reason: "Changed their mind" });
    const owed = (await read<RefundList>("fiona", "/api/finance/refunds")).owed.find((row) => row.orderId === first);
    expect(owed?.owed).toBe(total);
    await ok("fiona", `/api/invoices/${owed?.invoiceId}/refunds`, {
      amount: total,
      method: "credit",
      refundedOn: todayManila(),
    });
    expect((await read<RefundList>("fiona", "/api/finance/refunds")).owed.some((row) => row.orderId === first)).toBe(false);
    const kept = await credit(advance);
    expect(kept).toMatchObject({ total, sources: [{ kind: "kept", amount: total, left: total }] });
    // Their next order is paid from it.
    const next = await approved(advance, 5);
    const invoice = (await order(next)).money.invoice;
    const source = kept.sources[0];
    await ok("fiona", `/api/invoices/${invoice?.id}/credit`, {
      kind: "kept",
      sourceId: source?.id,
      amount: invoice?.total,
    });
    expect((await order(next)).money.invoice?.status).toBe("paid");
    expect((await credit(advance)).total).toBe(total - (invoice?.total as number));
    expect((await runChecks(db)).checks.filter((check) => !check.ok).map((check) => check.key)).toEqual([]);
  });
});
