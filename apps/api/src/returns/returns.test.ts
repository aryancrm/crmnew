import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedFixture } from "../inventory/fixture";
import { todayManila } from "../inventory/rules";
import { seedDemo } from "../seed";
import { attachReceipt } from "../testing/receipt";
import type {
  Catalogue,
  OrderDetail,
  OrderReturns,
  RefundList,
  ReturnList,
  ReturnRow,
} from "../types";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
let medicine: { id: number; price: number };
let creditHospital: number;
let advanceHospital: number;

const get = (who: string, path: string) =>
  app.request(path, { headers: { cookie: cookies[who] as string } });
const read = async <T>(who: string, path: string) => (await (await get(who, path)).json()) as T;
const post = (who: string, path: string, body: unknown = {}) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookies[who] as string },
    body: JSON.stringify(body),
  });
const invoiceOf = async (orderId: number) =>
  (
    await rows<{ id: number; total: number; credited: number; paid: number; status: string }>(
      db,
      sql`select id::int as id, total::int as total, credited::int as credited, paid::int as paid, status from invoice where order_id = ${orderId}`,
    )
  )[0];
const onShelf = async () =>
  (
    await rows<{ n: number }>(
      db,
      sql`select coalesce(sum(s.qty), 0)::int as n from stock s join batch b on b.id = s.batch_id where b.medicine_id = ${medicine.id}`,
    )
  )[0]?.n ?? 0;

/** Ryan's order, approved, its money done (an invoice on credit, or paid in advance), packed,
 *  shipped and delivered. */
async function delivered(customerId: number, qty: number, advance = false): Promise<number> {
  const placed = (await (
    await post("ryan", "/api/orders", {
      customerId,
      items: [{ medicineId: medicine.id, qty, priceKind: "hospital" }],
    })
  ).json()) as { id: number };
  const id = placed.id;
  expect((await post("sarla", `/api/orders/${id}/approve`, { finance: true })).status).toBe(200);
  if (advance) {
    const total = (await read<OrderDetail>("fiona", `/api/orders/${id}`)).order.total;
    expect(
      (
        await post("fiona", `/api/finance/orders/${id}/confirm-payment`, {
          amount: total,
          method: "bank",
          reference: "BDO-9",
          paidOn: todayManila(),
          checked: true,
        })
      ).status,
    ).toBe(200);
  } else expect((await post("fiona", `/api/finance/orders/${id}/invoice`)).status).toBe(200);
  expect((await post("marco", `/api/dispatch/orders/${id}/pack`)).status).toBe(200);
  expect(
    (
      await post("marco", `/api/dispatch/orders/${id}/ship`, {
        method: "courier",
        addressChecked: true,
        courier: "LBC",
        tracking: "1",
      })
    ).status,
  ).toBe(200);
  expect(await attachReceipt(app, cookies.marco as string, id)).toBe(200);
  expect(
    (
      await post("marco", `/api/dispatch/orders/${id}/deliver`, {
        receivedBy: "Nurse Ana",
        deliveredOn: todayManila(),
      })
    ).status,
  ).toBe(200);
  return id;
}

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  await seedFixture(db);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["ryan", "sarla", "fiona", "marco", "naresh"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
  const add = async (body: object) =>
    ((await (await post("sarla", "/api/customers", body)).json()) as { id: number }).id;
  creditHospital = await add({
    kind: "hospital",
    name: "Olivarez General Hospital",
    city: "Parañaque",
    paymentTerms: "days",
    paymentDays: 30,
  });
  advanceHospital = await add({ kind: "hospital", name: "San Juan de Dios", city: "Pasay" });
  const catalogue = await read<Catalogue>("sarla", "/api/inventory/medicines");
  const row = catalogue.rows.find(
    (item) => item.prices.hospital !== undefined && item.total >= 500,
  );
  if (!row) throw new Error("no medicine with a hospital price and stock");
  medicine = { id: row.id, price: row.prices.hospital as number };
});

describe("returns", () => {
  it("goods back: Management approves, Dispatch restocks, the bill comes down", async () => {
    const orderId = await delivered(creditHospital, 20);
    const before = await invoiceOf(orderId);
    const shelf = await onShelf();
    const lines = (
      await read<{ left: { orderItemId: number; left: number }[] }>(
        "ryan",
        `/api/orders/${orderId}/returns`,
      )
    ).left;
    const itemId = lines[0]?.orderItemId as number;
    expect(lines[0]?.left).toBe(20);
    // More than was delivered is refused.
    expect(
      (
        await post("ryan", `/api/orders/${orderId}/returns`, {
          reason: "expired",
          lines: [{ orderItemId: itemId, qty: 21 }],
        })
      ).status,
    ).toBe(400);
    const asked = await post("ryan", `/api/orders/${orderId}/returns`, {
      reason: "not_needed",
      note: "Ward closed",
      lines: [{ orderItemId: itemId, qty: 5 }],
    });
    expect(asked.status).toBe(200);
    const returnId = ((await asked.json()) as { id: number }).id;
    // Only what is left can be asked again.
    expect(
      (await read<{ left: { left: number }[] }>("ryan", `/api/orders/${orderId}/returns`)).left[0]
        ?.left,
    ).toBe(15);
    // Dispatch can't take it in before Management says yes; a MedRep can't approve.
    const line = (await read<ReturnList>("sarla", "/api/returns")).rows.find(
      (row) => row.id === returnId,
    ) as ReturnRow;
    const take = { lines: [{ lineId: line.lines[0]?.id as number, outcome: "restocked" }] };
    expect((await post("marco", `/api/returns/${returnId}/receive`, take)).status).toBe(409);
    expect((await post("ryan", `/api/returns/${returnId}/decide`, { approve: true })).status).toBe(
      403,
    );
    expect((await post("sarla", `/api/returns/${returnId}/decide`, { approve: true })).status).toBe(
      200,
    );
    const received = await post("marco", `/api/returns/${returnId}/receive`, take);
    expect(received.status).toBe(200);
    expect(((await received.json()) as { credit: number }).credit).toBe(5 * medicine.price);
    // Checked, back on the shelf; the bill waits for Management's credit (the hub's Refund press).
    expect(await onShelf()).toBe(shelf + 5);
    expect((await invoiceOf(orderId))?.total).toBe(before?.total);
    const checked = (await read<ReturnList>("sarla", "/api/returns?status=checked")).rows.find(
      (row) => row.id === returnId,
    );
    expect(checked?.can.credit).toBe(true);
    expect((await post("marco", `/api/returns/${returnId}/credit`, { credit: true })).status).toBe(403);
    expect((await post("sarla", `/api/returns/${returnId}/credit`, { credit: true })).status).toBe(200);
    const after = await invoiceOf(orderId);
    expect(after?.total).toBe((before?.total ?? 0) - 5 * medicine.price);
    expect(after?.credited).toBe(5 * medicine.price);
    expect(await onShelf()).toBe(shelf + 5);
    const mine = await read<ReturnList>("ryan", "/api/returns");
    expect(mine.rows.find((row) => row.id === returnId)?.status).toBe("received");
  });

  it("damaged goods are credited but not put back; missing ones aren't credited", async () => {
    const orderId = await delivered(creditHospital, 10);
    const shelf = await onShelf();
    const itemId = (
      await read<{ left: { orderItemId: number }[] }>("sarla", `/api/orders/${orderId}/returns`)
    ).left[0]?.orderItemId as number;
    // Management's own request is approved as it is made.
    const asked = await post("sarla", `/api/orders/${orderId}/returns`, {
      reason: "damaged",
      lines: [{ orderItemId: itemId, qty: 4 }],
    });
    const returnId = ((await asked.json()) as { id: number }).id;
    const row = (await read<ReturnList>("marco", "/api/returns")).rows.find(
      (one) => one.id === returnId,
    ) as ReturnRow;
    expect(row.status).toBe("approved");
    expect(
      (
        await post("marco", `/api/returns/${returnId}/receive`, {
          lines: [{ lineId: row.lines[0]?.id, outcome: "damaged" }],
        })
      ).status,
    ).toBe(200);
    expect(await onShelf()).toBe(shelf);
    expect((await post("sarla", `/api/returns/${returnId}/credit`, { credit: true })).status).toBe(200);
    expect((await invoiceOf(orderId))?.credited).toBe(4 * medicine.price);
  });

  it("checked goods Management doesn't credit: why is needed, the bill stays", async () => {
    const orderId = await delivered(creditHospital, 8);
    const before = await invoiceOf(orderId);
    const itemId = (
      await read<{ left: { orderItemId: number }[] }>("sarla", `/api/orders/${orderId}/returns`)
    ).left[0]?.orderItemId as number;
    const returnId = (
      (await (
        await post("sarla", `/api/orders/${orderId}/returns`, {
          reason: "damaged",
          lines: [{ orderItemId: itemId, qty: 3 }],
        })
      ).json()) as { id: number }
    ).id;
    const row = (await read<ReturnList>("marco", "/api/returns")).rows.find(
      (one) => one.id === returnId,
    ) as ReturnRow;
    await post("marco", `/api/returns/${returnId}/receive`, {
      lines: [{ lineId: row.lines[0]?.id, outcome: "damaged" }],
    });
    expect((await post("sarla", `/api/returns/${returnId}/credit`, { credit: false })).status).toBe(400);
    expect(
      (
        await post("sarla", `/api/returns/${returnId}/credit`, {
          credit: false,
          note: "Broken by the hospital's staff",
        })
      ).status,
    ).toBe(200);
    expect(await invoiceOf(orderId)).toEqual(before);
    const done = (await read<ReturnList>("ryan", "/api/returns")).rows.find((one) => one.id === returnId);
    expect(done?.status).toBe("rejected");
  });

  it("the customer keeps the goods: credited when Management approves, nothing to check", async () => {
    const orderId = await delivered(creditHospital, 10);
    const before = await invoiceOf(orderId);
    const shelf = await onShelf();
    const ask = await read<OrderReturns>("ryan", `/api/orders/${orderId}/returns`);
    expect(ask.can.goods).toEqual(["coming_back", "customer_keeps"]);
    const returnId = (
      (await (
        await post("ryan", `/api/orders/${orderId}/returns`, {
          reason: "expired",
          goods: "customer_keeps",
          note: "Short expiry, destroyed at the hospital",
          lines: [{ orderItemId: ask.left[0]?.orderItemId, qty: 3 }],
        })
      ).json()) as { id: number }
    ).id;
    expect((await post("sarla", `/api/returns/${returnId}/decide`, { approve: true })).status).toBe(200);
    const row = (await read<ReturnList>("marco", "/api/returns")).rows.find((one) => one.id === returnId);
    expect(row).toMatchObject({ status: "received", goods: "customer_keeps", credit: 3 * medicine.price });
    expect(row?.can.receive).toBe(false);
    expect((await invoiceOf(orderId))?.total).toBe((before?.total ?? 0) - 3 * medicine.price);
    expect(await onShelf()).toBe(shelf);
  });

  it("not shipped yet: the MedRep asks, Management approving cancels the order", async () => {
    const placed = (await (
      await post("ryan", "/api/orders", {
        customerId: creditHospital,
        items: [{ medicineId: medicine.id, qty: 4, priceKind: "hospital" }],
      })
    ).json()) as { id: number };
    // Before Management approves there is nothing to ask: it is still the MedRep's to take back.
    expect((await read<OrderReturns>("ryan", `/api/orders/${placed.id}/returns`)).can.ask).toBe(false);
    expect((await post("sarla", `/api/orders/${placed.id}/approve`)).status).toBe(200);
    const ask = await read<OrderReturns>("ryan", `/api/orders/${placed.id}/returns`);
    expect(ask.can.goods).toEqual(["not_shipped"]);
    // Management cancels it itself instead.
    expect(
      (await post("sarla", `/api/orders/${placed.id}/returns`, { reason: "not_needed", goods: "not_shipped" }))
        .status,
    ).toBe(400);
    const asked = await post("ryan", `/api/orders/${placed.id}/returns`, {
      reason: "not_needed",
      goods: "not_shipped",
      note: "The hospital bought elsewhere",
    });
    expect(asked.status, await asked.clone().text()).toBe(200);
    const returnId = ((await asked.json()) as { id: number }).id;
    // One request at a time.
    expect(
      (await post("ryan", `/api/orders/${placed.id}/returns`, { reason: "other", goods: "not_shipped" })).status,
    ).toBe(409);
    expect((await post("sarla", `/api/returns/${returnId}/decide`, { approve: true })).status).toBe(200);
    const order = await read<{ order: { status: string } }>("sarla", `/api/orders/${placed.id}`);
    expect(order.order.status).toBe("cancelled");
    const row = (await read<ReturnList>("ryan", "/api/returns")).rows.find((one) => one.id === returnId);
    expect(row?.statusLabel).toBe("Order cancelled: Finance gives back what was paid");
  });

  it("paid in advance: what was paid beyond the new bill is given back by Finance", async () => {
    const orderId = await delivered(advanceHospital, 10, true);
    const itemId = (
      await read<{ left: { orderItemId: number }[] }>("ryan", `/api/orders/${orderId}/returns`)
    ).left[0]?.orderItemId as number;
    const returnId = (
      (await (
        await post("ryan", `/api/orders/${orderId}/returns`, {
          reason: "wrong_item",
          lines: [{ orderItemId: itemId, qty: 2 }],
        })
      ).json()) as { id: number }
    ).id;
    await post("sarla", `/api/returns/${returnId}/decide`, { approve: true });
    const row = (await read<ReturnList>("marco", "/api/returns")).rows.find(
      (one) => one.id === returnId,
    ) as ReturnRow;
    await post("marco", `/api/returns/${returnId}/receive`, {
      lines: [{ lineId: row.lines[0]?.id, outcome: "restocked" }],
    });
    await post("sarla", `/api/returns/${returnId}/credit`, { credit: true });
    const owed = (await read<RefundList>("fiona", "/api/finance/refunds")).owed.find(
      (one) => one.orderId === orderId,
    );
    expect(owed?.owed).toBe(2 * medicine.price);
    expect(
      (
        await post("fiona", `/api/invoices/${owed?.invoiceId}/refunds`, {
          amount: 2 * medicine.price,
          method: "bank",
          reference: "BDO-R1",
          refundedOn: todayManila(),
        })
      ).status,
    ).toBe(200);
    const left = (await read<RefundList>("fiona", "/api/finance/refunds")).owed.find(
      (one) => one.orderId === orderId,
    );
    expect(left).toBeUndefined();
  });

  it("a rejected return needs a reason and changes nothing", async () => {
    const orderId = await delivered(creditHospital, 6);
    const before = await invoiceOf(orderId);
    const itemId = (
      await read<{ left: { orderItemId: number }[] }>("ryan", `/api/orders/${orderId}/returns`)
    ).left[0]?.orderItemId as number;
    const returnId = (
      (await (
        await post("ryan", `/api/orders/${orderId}/returns`, {
          reason: "other",
          lines: [{ orderItemId: itemId, qty: 1 }],
        })
      ).json()) as { id: number }
    ).id;
    expect(
      (await post("sarla", `/api/returns/${returnId}/decide`, { approve: false })).status,
    ).toBe(400);
    expect(
      (
        await post("sarla", `/api/returns/${returnId}/decide`, {
          approve: false,
          note: "Opened box",
        })
      ).status,
    ).toBe(200);
    expect(await invoiceOf(orderId)).toEqual(before);
  });
});

describe("the data, checked against itself", () => {
  it("comes out clean after orders, payments, deliveries, returns and refunds", async () => {
    const { runChecks } = await import("../checks/integrity");
    const result = await runChecks(db);
    const wrong = result.checks.filter((check) => !check.ok);
    expect(wrong.map((check) => `${check.label}: ${check.problems.join("; ")}`)).toEqual([]);
  });
});
