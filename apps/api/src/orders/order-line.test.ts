// Who checks an order: a MedRep's goes to Management, then Finance, whatever is sent; Management's
// own follows the switch at the top of its form, and Management decides on approving whether
// Finance checks it.

import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedFixture } from "../inventory/fixture";
import { seedDemo } from "../seed";
import type { Catalogue, OrderChecks, OrderDetail } from "../types";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
let hospital = 0;
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

/** Ryan's order for the hospital with the switch as given; answers its id and where it stands. */
async function ryanOrders(
  checks: OrderChecks | undefined,
  unitPrice?: number,
): Promise<{ id: number; status: string; approvedBy: string | null; events: string[] }> {
  const placed = await post("ryan", "/api/orders", {
    customerId: hospital,
    items: [
      {
        medicineId: medicine.id,
        qty: 5,
        priceKind: "hospital",
        ...(unitPrice ? { unitPrice, reason: "Matched their tender" } : {}),
      },
    ],
    ...(checks ? { checks } : {}),
  });
  expect(placed.status, await placed.clone().text()).toBe(200);
  const id = ((await placed.json()) as { id: number }).id;
  const detail = await read<OrderDetail>("sarla", `/api/orders/${id}`);
  return {
    id,
    status: detail.order.status,
    approvedBy: detail.order.approvedBy,
    events: detail.events.map((event) => event.message),
  };
}
const invoiceOf = async (orderId: number) =>
  (
    await rows<{ id: number }>(
      db,
      sql`select id::int as id from invoice where order_id = ${orderId}`,
    )
  )[0] ?? null;

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
  // A hospital Management added (checked), paying cash on delivery.
  hospital = (
    (await (
      await post("sarla", "/api/customers", {
        kind: "hospital",
        name: "Pasay General Hospital",
        city: "Pasay",
        paymentTerms: "cod",
      })
    ).json()) as { id: number }
  ).id;
  const catalogue = await read<Catalogue>("sarla", "/api/inventory/medicines");
  const row = catalogue.rows.find(
    (item) => item.prices.hospital !== undefined && item.total >= 100,
  );
  if (!row) throw new Error("the fixture has no medicine with a hospital price and stock");
  medicine = { id: row.id, price: row.prices.hospital as number };
});

describe("who checks an order", () => {
  it("a MedRep's order goes to Management and then Finance", async () => {
    const order = await ryanOrders(undefined);
    expect(order.status).toBe("pending_approval");
    expect((await post("sarla", `/api/orders/${order.id}/approve`)).status).toBe(200);
    expect((await read<OrderDetail>("sarla", `/api/orders/${order.id}`)).order.status).toBe(
      "ready_for_invoice",
    );
  });

  it("a MedRep can't switch Management or Finance off, even through the API", async () => {
    const order = await ryanOrders({ management: false, finance: false });
    expect(order).toMatchObject({ status: "pending_approval", approvedBy: null });
    expect(await invoiceOf(order.id)).toBeNull();
    // Approved, it still goes to Finance: the MedRep's switch was not read.
    expect((await post("sarla", `/api/orders/${order.id}/approve`)).status).toBe(200);
    expect((await read<OrderDetail>("sarla", `/api/orders/${order.id}`)).order.status).toBe(
      "ready_for_invoice",
    );
  });

  it("Management decides on approving whether Finance checks it", async () => {
    const order = await ryanOrders(undefined, medicine.price - 100);
    expect(order.status).toBe("pending_approval");
    expect(order.events.at(-1)).not.toContain("straight");
    expect((await post("sarla", `/api/orders/${order.id}/approve`, { finance: false })).status).toBe(200);
    expect((await read<OrderDetail>("sarla", `/api/orders/${order.id}`)).order.status).toBe(
      "ready_for_dispatch",
    );
    expect(await invoiceOf(order.id)).not.toBeNull();
  });

  it("the Admin's own order follows its switch (Management places none, 19 Nov)", async () => {
    const placed = await post("admin", "/api/orders", {
      customerId: hospital,
      items: [{ medicineId: medicine.id, qty: 5, priceKind: "hospital" }],
      checks: { management: false, finance: true },
    });
    expect(placed.status, await placed.clone().text()).toBe(200);
    const id = ((await placed.json()) as { id: number }).id;
    const detail = await read<OrderDetail>("sarla", `/api/orders/${id}`);
    expect(detail.order.status).toBe("ready_for_invoice");
    expect((await read<OrderDetail>("fiona", `/api/orders/${id}`)).can.make_invoice).toBe(true);
  });
});

describe("what a field order carries", () => {
  it("takes the Division, Sub-division and the Payment Terms agreed; the terms set how it is paid", async () => {
    const placed = await post("ryan", "/api/orders", {
      customerId: hospital,
      items: [{ medicineId: medicine.id, qty: 5, priceKind: "hospital" }],
      division: "HOS",
      subDivision: "ILOILO",
      paymentTerm: "PDC 30",
    });
    expect(placed.status, await placed.clone().text()).toBe(200);
    const id = ((await placed.json()) as { id: number }).id;
    const detail = await read<OrderDetail>("sarla", `/api/orders/${id}`);
    expect(detail.order).toMatchObject({
      division: "HOS",
      subDivision: "ILOILO",
      paymentTerm: "PDC 30",
      paymentTerms: "days",
      paymentDays: 30,
    });
    expect(
      (
        await post("ryan", "/api/orders", {
          customerId: hospital,
          items: [{ medicineId: medicine.id, qty: 1, priceKind: "hospital" }],
          division: "XYZ",
        })
      ).status,
    ).toBe(400);
  });

  it("starts the Division from the MedRep's channel when he leaves it out", async () => {
    const order = await ryanOrders(undefined);
    const detail = await read<OrderDetail>("sarla", `/api/orders/${order.id}`);
    expect(detail.order.division).toBe("HOS");
    expect(detail.order.subDivision).toBe("PASAY");
  });

  it("takes the same medicine again as a free line, and Management sees the free goods", async () => {
    const placed = await post("ryan", "/api/orders", {
      customerId: hospital,
      items: [
        { medicineId: medicine.id, qty: 10, priceKind: "hospital" },
        {
          medicineId: medicine.id,
          qty: 10,
          priceKind: "hospital",
          free: true,
          reason: "Buy 1 Take 1",
        },
      ],
      checks: { management: false, finance: false },
    });
    expect(placed.status, await placed.clone().text()).toBe(200);
    const id = ((await placed.json()) as { id: number }).id;
    const detail = await read<OrderDetail>("sarla", `/api/orders/${id}`);
    expect(detail.order.status).toBe("pending_approval");
    expect(detail.order.total).toBe(10 * medicine.price);
    expect(detail.items.map((item) => [item.qty, item.unitPrice, item.free])).toEqual([
      [10, medicine.price, false],
      [10, 0, true],
    ]);
    expect(detail.findings.map((finding) => finding.short)).toContain("Free goods");
    // Twice paid, or only free, is refused.
    const twice = {
      customerId: hospital,
      items: [
        { medicineId: medicine.id, qty: 1, priceKind: "hospital" },
        { medicineId: medicine.id, qty: 1, priceKind: "hospital" },
      ],
    };
    expect((await post("ryan", "/api/orders", twice)).status).toBe(400);
    expect(
      (
        await post("ryan", "/api/orders", {
          customerId: hospital,
          items: [{ medicineId: medicine.id, qty: 1, priceKind: "hospital", free: true }],
        })
      ).status,
    ).toBe(400);
  });

  it("lets Management complete the details before approving; the MedRep can't", async () => {
    const order = await ryanOrders(undefined);
    expect(
      (await post("ryan", `/api/orders/${order.id}/details`, { paymentTerm: "NET 60" })).status,
    ).toBe(403);
    const saved = await post("sarla", `/api/orders/${order.id}/details`, {
      division: "HOS",
      subDivision: "CAVITE",
      paymentTerm: "NET 60",
      receiver: "Ms. Cruz",
      receiverPhone: "0918 220 1100",
      note: "Pharmacy, 2nd floor",
    });
    expect(saved.status, await saved.clone().text()).toBe(200);
    const detail = await read<OrderDetail>("sarla", `/api/orders/${order.id}`);
    expect(detail.order).toMatchObject({
      subDivision: "CAVITE",
      paymentTerm: "NET 60",
      paymentTerms: "days",
      paymentDays: 60,
      receiver: "Ms. Cruz",
    });
    expect(detail.events.at(-1)?.message).toContain("Payment Terms — → NET 60");
  });
});
