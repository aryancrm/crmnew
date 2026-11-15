import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { countQueries, type Database, openDatabase } from "../db/index";
import { migrate } from "../db/migrate";
import { seedFixture } from "../inventory/fixture";
import { seedDemo } from "../seed";
import type {
  Catalogue,
  CustomerDetail,
  MyArea,
  MyOrders,
  OrderBoard,
  OrderDashboard,
  OrderDetail,
  OrderList,
  OrderRow,
  TargetList,
} from "../types";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
let hospital: number;
let creditHospital: number;
let medicine: { id: number; price: number; stock: number };

const get = (who: string, path: string) =>
  app.request(path, { headers: { cookie: cookies[who] as string } });
const read = async <T>(who: string, path: string) => (await (await get(who, path)).json()) as T;
const post = (who: string, path: string, body: unknown = {}) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookies[who] as string },
    body: JSON.stringify(body),
  });
const place = async (who: string, body: object) => {
  const response = await post(who, "/api/orders", body);
  return {
    status: response.status,
    body: (await response.json()) as {
      id: number;
      error?: { field?: string; fields?: Record<string, string> };
    },
  };
};
const order = (who: string, id: number) => read<OrderDetail>(who, `/api/orders/${id}`);
const act = (who: string, id: number, action: string, body: object = {}) =>
  post(who, `/api/orders/${id}/${action}`, body);
const queue = async (who: string) =>
  (await read<{ orders: OrderRow[] }>(who, "/api/orders/queue")).orders;
const line = (more: object = {}) => ({
  medicineId: medicine.id,
  qty: 10,
  priceKind: "hospital",
  ...more,
});

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  await seedFixture(db);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["ryan", "daniel", "sarla", "jane", "fiona", "vanessa", "naresh"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
  const add = async (body: object) =>
    ((await (await post("sarla", "/api/customers", body)).json()) as { id: number }).id;
  hospital = await add({
    kind: "hospital",
    name: "San Juan de Dios Hospital",
    city: "Pasay",
    address: "2772 Roxas Blvd",
  });
  creditHospital = await add({
    kind: "hospital",
    name: "Olivarez General Hospital",
    city: "Parañaque",
    paymentTerms: "days",
    paymentDays: 30,
  });
  const catalogue = await read<Catalogue>("sarla", "/api/inventory/medicines");
  const row = catalogue.rows.find(
    (item) => item.prices.hospital !== undefined && item.total >= 100,
  );
  if (!row) throw new Error("the fixture has no medicine with a hospital price and stock");
  medicine = { id: row.id, price: row.prices.hospital as number, stock: row.total };
});

describe("placing an order", () => {
  it("a MedRep's order waits for Management, at the price he picked", async () => {
    const made = await place("ryan", {
      customerId: hospital,
      items: [line()],
      note: "Deliver before noon",
    });
    expect(made.status).toBe(200);
    const detail = await order("ryan", made.body.id);
    expect(detail.order).toMatchObject({
      status: "pending_approval",
      medrep: "Ryan",
      raisedBy: "Ryan",
      total: 10 * medicine.price,
      channel: "HOSP",
    });
    expect(detail.order.code).toMatch(/^2MG-5\d{5}$/);
    expect(detail.order.deliveryAddress).toBe("2772 Roxas Blvd, Pasay");
    expect(detail.items[0]).toMatchObject({
      qty: 10,
      unitPrice: medicine.price,
      listPrice: medicine.price,
      priceLabel: "Hospital",
    });
    expect(detail.stages[0]).toMatchObject({ key: "created" });
    expect(detail.stages[0]?.at).not.toBeNull();
    expect(detail.stages[1]?.at).toBeNull();
    // The customer pays in advance and no proof is attached yet: Management is told.
    expect(detail.findings.map((finding) => finding.kind)).toEqual(["papers"]);
    // Ryan may not approve his own order; Management may.
    expect(detail.can.approve).toBe(false);
    expect((await order("sarla", made.body.id)).can).toMatchObject({
      approve: true,
      send_back: true,
      reject: true,
      hold: true,
    });
  });

  it("a lower price needs a reason, and Management is told", async () => {
    const lower = medicine.price - 500;
    const refused = await place("ryan", {
      customerId: hospital,
      items: [line({ unitPrice: lower })],
    });
    expect(refused.status).toBe(400);
    expect(refused.body.error?.field ?? Object.keys(refused.body.error?.fields ?? {})[0]).toBe(
      "items.0.reason",
    );
    const made = await place("ryan", {
      customerId: hospital,
      items: [line({ unitPrice: lower, reason: "Bulk order, matched last month's price" })],
    });
    expect(made.status).toBe(200);
    const card = (await queue("sarla")).find((row) => row.id === made.body.id);
    expect(card?.findings?.map((finding) => finding.kind)).toEqual(["price", "papers"]);
    expect(card?.findings?.[0]?.text).toContain("Bulk order");
    expect(card?.total).toBe(10 * lower);
  });

  it("says when more is ordered than is in stock, and refuses a price the medicine doesn't have", async () => {
    const made = await place("ryan", {
      customerId: hospital,
      items: [line({ qty: medicine.stock + 50 })],
    });
    expect((await order("sarla", made.body.id)).findings.map((finding) => finding.kind)).toContain(
      "stock",
    );
    expect(
      (await place("ryan", { customerId: hospital, items: [line({ priceKind: "promo" })] })).status,
    ).toBe(400);
    expect((await place("ryan", { customerId: hospital, items: [line(), line()] })).status).toBe(
      400,
    );
    expect((await place("ryan", { customerId: hospital, items: [] })).status).toBe(400);
    expect((await place("fiona", { customerId: hospital, items: [line()] })).status).toBe(403);
  });

  it("Management's own order skips the queue", async () => {
    const made = await place("sarla", { customerId: hospital, items: [line()] });
    const detail = await order("sarla", made.body.id);
    expect(detail.order).toMatchObject({
      status: "finance_check",
      raisedBy: "Sarla",
      medrep: "Ryan",
    });
    expect(detail.stages[1]?.at).not.toBeNull();
    expect((await queue("sarla")).some((row) => row.id === made.body.id)).toBe(false);
  });
});

describe("who sees an order", () => {
  it("the MedRep, his team lead and Management, not another desk", async () => {
    const made = await place("ryan", { customerId: hospital, items: [line()] });
    for (const who of ["ryan", "daniel", "sarla", "fiona"])
      expect((await get(who, `/api/orders/${made.body.id}`)).status).toBe(200);
    expect((await get("jane", `/api/orders/${made.body.id}`)).status).toBe(404);
    expect((await read<OrderList>("jane", "/api/orders")).total).toBe(0);
    expect((await read<OrderList>("ryan", "/api/orders")).total).toBeGreaterThan(0);
  });
});

describe("what Management does with an order", () => {
  it("approves: an advance customer's goes to Finance, a credit customer's to invoicing", async () => {
    const advance = await place("ryan", { customerId: hospital, items: [line()] });
    expect((await act("ryan", advance.body.id, "approve")).status).toBe(409);
    expect((await act("sarla", advance.body.id, "approve")).status).toBe(200);
    const first = await order("sarla", advance.body.id);
    expect(first.order).toMatchObject({ status: "finance_check", approvedBy: "Sarla" });
    expect(first.order.warehouse).not.toBeNull();
    expect(first.stages[1]?.at).not.toBeNull();
    // The same button pressed twice does nothing the second time.
    expect((await act("sarla", advance.body.id, "approve")).status).toBe(409);

    const credit = await place("ryan", { customerId: creditHospital, items: [line()] });
    await act("sarla", credit.body.id, "approve");
    expect((await order("sarla", credit.body.id)).order).toMatchObject({
      status: "ready_for_invoice",
      credit: true,
    });
  });

  it("sends back with a reason, and the MedRep places it again", async () => {
    const made = await place("ryan", { customerId: hospital, items: [line()] });
    expect((await act("sarla", made.body.id, "send_back")).status).toBe(400);
    expect(
      (await act("sarla", made.body.id, "send_back", { reason: "Wrong delivery address" })).status,
    ).toBe(200);
    const back = await order("ryan", made.body.id);
    expect(back.order).toMatchObject({ status: "draft", flagReason: "Wrong delivery address" });
    expect(back.can.resubmit).toBe(true);
    expect(back.order).toMatchObject({
      sentBackCount: 1,
      sentBackReason: "Wrong delivery address",
      sentBackBy: "Sarla",
    });
    // Sent again unchanged, the MedRep says why it is right as it is.
    expect((await act("ryan", made.body.id, "resubmit")).status).toBe(400);
    expect(
      (
        await act("ryan", made.body.id, "resubmit", {
          reason: "The address is right: their new branch",
        })
      ).status,
    ).toBe(200);
    expect((await order("ryan", made.body.id)).order).toMatchObject({
      status: "pending_approval",
      flagReason: null,
      sentBackReason: "Wrong delivery address",
      reply: "The address is right: their new branch",
    });
    // Management sees both on the card.
    const card = (await read<OrderBoard>("sarla", "/api/orders/board")).cards.find(
      (item) => item.id === made.body.id,
    );
    expect(card).toMatchObject({
      sentBackCount: 1,
      sentBackReason: "Wrong delivery address",
      reply: "The address is right: their new branch",
    });
  });

  it("is fixed by the MedRep and sent again with an answer; Management sees what changed", async () => {
    const made = await place("ryan", { customerId: hospital, items: [line()] });
    await act("sarla", made.body.id, "send_back", { reason: "Quantity too high for them" });
    expect(
      (await read<OrderBoard>("sarla", "/api/orders/board?tab=sent")).cards.some(
        (item) => item.id === made.body.id,
      ),
    ).toBe(true);
    expect(
      (await read<MyOrders>("ryan", "/api/orders/mine?stage=sent_back")).cards.map(
        (item) => item.id,
      ),
    ).toContain(made.body.id);
    const before = await order("ryan", made.body.id);
    const fixed = {
      customerId: hospital,
      items: [line({ qty: 4 })],
      answer: "Lowered to 4 as they asked",
    };
    // An answer is needed, the customer stays, and only the MedRep fixes it.
    expect(
      (await post("ryan", `/api/orders/${made.body.id}/revise`, { ...fixed, answer: " " })).status,
    ).toBe(400);
    expect((await post("sarla", `/api/orders/${made.body.id}/revise`, fixed)).status).toBe(409);
    expect((await post("ryan", `/api/orders/${made.body.id}/revise`, fixed)).status).toBe(200);
    const after = await order("sarla", made.body.id);
    expect(after.order).toMatchObject({
      status: "pending_approval",
      reply: "Lowered to 4 as they asked",
    });
    expect(after.items.map((item) => item.qty)).toEqual([4]);
    expect(after.order.total).toBe(4 * (before.items[0]?.unitPrice ?? 0));
    expect(
      after.events.some(
        (event) => event.message.startsWith("Changed: ") && event.message.includes("10 → 4"),
      ),
    ).toBe(true);
    // Not sent back now: it can't be fixed again until Management sends it back.
    expect((await post("ryan", `/api/orders/${made.body.id}/revise`, fixed)).status).toBe(409);
  });

  it("keeps how long it stood at each step, and a card counts from its own step", async () => {
    const made = await place("ryan", { customerId: hospital, items: [line()] });
    await db.execute(
      sql`update order_step set entered_at = now() - interval '25 minutes' where order_id = ${made.body.id}`,
    );
    await act("sarla", made.body.id, "approve");
    const after = await order("sarla", made.body.id);
    const [waiting, next] = after.steps;
    expect(waiting).toMatchObject({
      status: "pending_approval",
      label: "Pending Management Approval",
    });
    expect(waiting?.leftAt).not.toBeNull();
    expect(waiting?.minutes).toBeGreaterThanOrEqual(24);
    expect(next).toMatchObject({ leftAt: null });
    expect(next?.status).toBe(after.order.status);
    // The card's clock starts again at Finance.
    const card = (await read<OrderBoard>("sarla", "/api/orders/board?tab=finance")).cards.find(
      (item) => item.id === made.body.id,
    );
    expect(Date.now() - Date.parse(card?.stepSince ?? "")).toBeLessThan(60_000);
  });

  it("takes back an approval given by mistake, while the next desk hasn't acted", async () => {
    const made = await place("ryan", { customerId: hospital, items: [line()] });
    await act("sarla", made.body.id, "approve");
    const approved = await order("sarla", made.body.id);
    expect(approved.can.take_back).toBe(true);
    expect(approved.order.takeBackUntil).not.toBeNull();
    expect((await act("sarla", made.body.id, "take_back")).status).toBe(400);
    expect((await act("ryan", made.body.id, "take_back", { reason: "x" })).status).toBe(409);
    expect(
      (await act("sarla", made.body.id, "take_back", { reason: "Approved the wrong order" }))
        .status,
    ).toBe(200);
    const back = await order("sarla", made.body.id);
    expect(back.order).toMatchObject({
      status: "pending_approval",
      approvedBy: null,
      takeBackUntil: null,
    });
    // Past the half hour it can't be taken back any more.
    await act("sarla", made.body.id, "approve");
    await db.execute(
      sql`update sales_order set approved_at = now() - interval '31 minutes' where id = ${made.body.id}`,
    );
    expect((await order("sarla", made.body.id)).can.take_back).toBe(false);
    expect((await act("sarla", made.body.id, "take_back", { reason: "Too late" })).status).toBe(
      409,
    );
  });

  it("rejects, holds and marks an exception with a reason, and resumes to where it was", async () => {
    const made = await place("ryan", { customerId: hospital, items: [line()] });
    await act("sarla", made.body.id, "reject", { reason: "Price too low" });
    expect((await order("sarla", made.body.id)).order).toMatchObject({
      status: "on_hold",
      flagReason: "Price too low",
    });
    await act("sarla", made.body.id, "resume");
    expect((await order("sarla", made.body.id)).order.status).toBe("pending_approval");

    await act("sarla", made.body.id, "approve");
    await act("sarla", made.body.id, "hold", { reason: "Waiting for stock" });
    // An order on hold can't also be marked an exception.
    expect(
      (await act("sarla", made.body.id, "exception", { reason: "Customer disputes the order" }))
        .status,
    ).toBe(409);
    await act("sarla", made.body.id, "resume");
    const resumed = await order("sarla", made.body.id);
    expect(resumed.order.status).toBe("finance_check");
    expect(resumed.events.map((event) => event.kind)).toContain("status");
    expect(resumed.events.at(-1)?.message).toContain("Taken off hold");
    await act("sarla", made.body.id, "cancel", { reason: "Customer cancelled" });
    expect((await order("sarla", made.body.id)).can).toMatchObject({
      approve: false,
      hold: false,
      resume: false,
      cancel: false,
    });
  });
});

describe("the dashboard and the lists", () => {
  it("counts what the lists hold", async () => {
    const dashboard = await read<OrderDashboard>("sarla", "/api/orders/dashboard");
    const all = await read<OrderList>("sarla", "/api/orders");
    expect(dashboard.tiles.today).toBe(all.total);
    expect(dashboard.attention.awaiting).toBe((await queue("sarla")).length);
    expect(dashboard.attention.awaiting).toBe(
      (await read<OrderList>("sarla", "/api/orders?status=pending_approval")).total,
    );
    expect(dashboard.tiles.pendingPayment).toBe(
      (await read<OrderList>("sarla", "/api/orders?group=pendingPayment")).total,
    );
    expect(dashboard.tiles.exceptions).toBe(
      (await read<OrderList>("sarla", "/api/orders?group=exceptions")).total,
    );
    expect(dashboard.byStatus.reduce((sum, row) => sum + row.count, 0)).toBe(all.total);
    expect(all.totalValue).toBeGreaterThan(0);
    expect(all.medreps.map((person) => person.name)).toContain("Ryan");
    expect((await read<OrderList>("sarla", "/api/orders?q=olivarez")).total).toBe(1);
    expect((await read<OrderList>("sarla", "/api/orders?stuck=1")).total).toBe(0);
  });

  it("the board's tabs count what they hold, and a card says what to decide", async () => {
    const board = await read<OrderBoard>("sarla", "/api/orders/board");
    expect(board.tab).toBe("needs");
    expect(board.counts.needs).toBe(board.cards.length);
    expect(board.counts.needs).toBe((await queue("sarla")).length);
    const lower = board.cards.find((card) =>
      card.findings.some((finding) => finding.kind === "price"),
    );
    expect(lower).toMatchObject({
      step: 1,
      channel: "HOSP",
      customerKind: "hospital",
      area: "HOS | Pasay",
    });
    expect(lower?.next).toMatch(/^Decide: .+ given at ₱/);
    expect(lower?.findings.map((finding) => finding.short)).toContain("Below hospital price");
    expect(
      board.cards.find((card) => card.findings.length === 1 && card.findings[0]?.kind === "papers")
        ?.next,
    ).toBe("Decide: pays in advance, no proof of payment yet");
    const finance = await read<OrderBoard>("sarla", "/api/orders/board?tab=finance");
    expect(finance.cards.length).toBe(finance.counts.finance);
    // While an order waits for Finance only the money is shown: prices were Management's to decide.
    expect(
      finance.cards.every(
        (card) =>
          card.step === 2 &&
          card.findings.every((finding) => ["owes", "credit", "papers"].includes(finding.kind)),
      ),
    ).toBe(true);
    expect(
      (await read<OrderBoard>("sarla", "/api/orders/board?tab=hold")).cards.every((card) =>
        card.next.startsWith("On Hold: "),
      ),
    ).toBe(true);
    expect((await read<OrderBoard>("sarla", "/api/orders/board?channel=RX")).cards).toHaveLength(0);
    expect(board.channels).toEqual(["HOSP"]);
    // The step line's counts and one status picked from it.
    expect(board.byStatus.pending_approval).toBe(board.counts.needs);
    const picked = await read<OrderBoard>("sarla", "/api/orders/board?status=finance_check");
    expect(picked.status).toBe("finance_check");
    expect(picked.cards.length).toBe(picked.byStatus.finance_check ?? 0);
    expect(picked.cards.every((card) => card.status === "finance_check")).toBe(true);
    // Search: by customer, and by a medicine on the order.
    expect(
      (await read<OrderBoard>("sarla", "/api/orders/board?q=olivarez")).cards.every((card) =>
        card.customer.startsWith("Olivarez"),
      ),
    ).toBe(true);
    expect((await read<OrderBoard>("sarla", "/api/orders/board?q=zzzz")).counts.needs).toBe(0);
    expect(board.cards[0]?.placedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Who the orders are from: each MedRep with how many they have here, adding up to the tab.
    expect(board.byRep.reduce((sum, rep) => sum + rep.orders, 0)).toBe(board.counts.needs);
    const ryan = board.byRep.find((rep) => rep.name === "Ryan");
    expect(ryan).toMatchObject({ channel: "HOSP", area: "HOS | Pasay" });
    expect(board.cards.every((card) => card.medrepId === ryan?.id)).toBe(true);
    // Picking a MedRep narrows the cards, not the strip (so another can be picked from it).
    const nobody = await read<OrderBoard>("sarla", "/api/orders/board?medrep=999999");
    expect(nobody.cards).toHaveLength(0);
    expect(nobody.byRep).toEqual(board.byRep);
    expect(
      (await countQueries(async () => get("sarla", "/api/orders/board"))).queries,
    ).toBeLessThanOrEqual(7);
  });

  it("answers in a fixed number of queries", async () => {
    expect(
      (await countQueries(async () => get("sarla", "/api/orders/dashboard"))).queries,
    ).toBeLessThanOrEqual(4);
    expect(
      (await countQueries(async () => get("sarla", "/api/orders"))).queries,
    ).toBeLessThanOrEqual(4);
    expect(
      (await countQueries(async () => get("sarla", "/api/orders/queue"))).queries,
    ).toBeLessThanOrEqual(3);
  });
});

describe("the MedRep's own view", () => {
  it("shows where his orders stand, what was sent back, this month's sales, and cards worded for him", async () => {
    const made = await place("ryan", {
      customerId: hospital,
      items: [line({ unitPrice: medicine.price - 100, reason: "Matched last order" })],
      customerPo: "PO-4500-1182",
    });
    expect((await order("ryan", made.body.id)).order.customerPo).toBe("PO-4500-1182");
    const mine = await read<MyOrders>("ryan", "/api/orders/mine");
    expect(mine.stage).toBe("all");
    expect(mine.counts.management).toBe(
      (await read<OrderList>("ryan", "/api/orders?status=pending_approval")).total,
    );
    const card = mine.cards.find((item) => item.id === made.body.id);
    // (Earlier orders in this file hold the medicine's pieces, so it may read "stock short" too.)
    expect(card?.next).toMatch(
      /^Management is checking it: below hospital price, .*no payment proof$/,
    );
    expect(mine.sales.orders).toBeGreaterThan(0);
    // Sold is what Finance invoiced: nothing of his is invoiced yet.
    expect(mine.sales.value).toBe(0);
    expect(mine.sales.month).toMatch(/^[A-Z][a-z]+$/);

    await act("sarla", made.body.id, "send_back", { reason: "Attach the PO photo" });
    const after = await read<MyOrders>("ryan", "/api/orders/mine?stage=sent_back");
    expect(after.held.find((row) => row.id === made.body.id)).toMatchObject({
      status: "draft",
      reason: "Attach the PO photo",
    });
    expect(after.cards.find((item) => item.id === made.body.id)?.next).toBe(
      "Sent back to you: Attach the PO photo. Fix it and place it again.",
    );
    expect(after.cards.every((item) => item.status === "draft")).toBe(true);
    // Another desk sees none of Ryan's orders as its own.
    expect((await read<MyOrders>("jane", "/api/orders/mine")).counts.all).toBe(0);
  });

  it("knows his area's quiet customers, his line of bosses, and a customer's last order", async () => {
    const area = await read<MyArea>("ryan", "/api/my/area");
    expect(area.line).toEqual(["Daniel, Area manager", "Vanessa, HOSP head"]);
    expect(area.quiet).toBeGreaterThanOrEqual(0);
    const detail = await read<CustomerDetail>("ryan", `/api/customers/${hospital}`);
    expect(detail.customer.lastOrderOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(detail.customer.inMyArea).toBe(true);
  });
});

describe("papers, the billing company, the doctor and order numbers", () => {
  const upload = (who: string, id: number, kind: string, file: File) => {
    const form = new FormData();
    form.set("kind", kind);
    form.set("file", file);
    return app.request(`/api/orders/${id}/papers`, {
      method: "POST",
      headers: { cookie: cookies[who] as string },
      body: form,
    });
  };
  const png = () =>
    new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])], "slip.png", {
      type: "image/png",
    });

  it("a proof of payment clears the finding, and only those who see the order see the paper", async () => {
    const made = await place("ryan", { customerId: hospital, items: [line()] });
    expect((await order("sarla", made.body.id)).findings.map((finding) => finding.kind)).toContain(
      "papers",
    );

    expect(
      (
        await upload(
          "ryan",
          made.body.id,
          "payment_proof",
          new File(["x"], "slip.exe", { type: "application/x-msdownload" }),
        )
      ).status,
    ).toBe(400);
    expect((await upload("ryan", made.body.id, "receipt", png())).status).toBe(400);
    const added = await upload("ryan", made.body.id, "payment_proof", png());
    expect(added.status).toBe(200);
    const paperId = ((await added.json()) as { id: number }).id;

    const detail = await order("sarla", made.body.id);
    expect(detail.findings.map((finding) => finding.kind)).not.toContain("papers");
    expect(detail.papers).toMatchObject([
      { kind: "payment_proof", kindLabel: "Proof of payment", name: "slip.png", by: "Ryan" },
    ]);
    expect(detail.paperList.find((paper) => paper.kind === "payment_proof")).toMatchObject({
      needed: true,
      onFile: true,
    });
    expect(detail.events.at(-1)?.message).toBe("Proof of payment attached (slip.png).");

    const file = await get("sarla", `/api/papers/${paperId}`);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await file.arrayBuffer())).toHaveLength(11);
    expect((await get("jane", `/api/papers/${paperId}`)).status).toBe(404);

    expect((await post("ryan", `/api/papers/${paperId}/remove`)).status).toBe(200);
    expect((await order("sarla", made.body.id)).findings.map((finding) => finding.kind)).toContain(
      "papers",
    );
    expect((await get("sarla", `/api/papers/${paperId}`)).status).toBe(404);
  });

  it("keeps the billing company and the doctor, and numbers orders one after another", async () => {
    const doctor = (
      (await (
        await post("sarla", "/api/customers", { kind: "doctor", name: "Ana Reyes", city: "Pasay" })
      ).json()) as { id: number }
    ).id;
    expect(
      (await place("ryan", { customerId: hospital, items: [line()], doctorId: creditHospital }))
        .status,
    ).toBe(400);
    const first = await place("ryan", {
      customerId: hospital,
      items: [line()],
      doctorId: doctor,
      invoiceFrom: "getmeds",
    });
    const second = await place("ryan", { customerId: hospital, items: [line()] });
    const a = await order("ryan", first.body.id);
    const b = await order("ryan", second.body.id);
    expect(a.order).toMatchObject({
      doctor: "Ana Reyes",
      invoiceFrom: "getmeds",
      invoiceFromLabel: "GetMeds Philippines Inc.",
    });
    expect(b.order.invoiceFrom).toBe("2mg");
    expect(Number(b.order.code.slice(4)) - Number(a.order.code.slice(4))).toBe(1);
  });
});

describe("monthly targets", () => {
  it("a head sets his team's, the CEO anyone's, and the MedRep sees his own", async () => {
    const team = await read<TargetList>("vanessa", "/api/targets");
    expect(team.rows.map((row) => row.name)).toEqual(expect.arrayContaining(["Daniel", "Ryan"]));
    expect(team.rows.map((row) => row.name)).not.toContain("Jane");
    const ryan = team.rows.find((row) => row.name === "Ryan");
    expect(ryan?.placed).toBeGreaterThan(0);

    expect(
      (
        await post("vanessa", "/api/targets", {
          personId: ryan?.personId,
          month: team.month,
          amount: 4_200_000_00,
        })
      ).status,
    ).toBe(200);
    expect((await read<MyOrders>("ryan", "/api/orders/mine")).sales.target).toBe(4_200_000_00);
    expect(
      (await read<TargetList>("vanessa", "/api/targets")).rows.find((row) => row.name === "Ryan"),
    ).toMatchObject({ target: 4_200_000_00, setBy: "Vanessa" });

    const jane = (await read<TargetList>("naresh", "/api/targets")).rows.find(
      (row) => row.name === "Jane",
    );
    expect(jane).toBeDefined();
    expect(
      (
        await post("vanessa", "/api/targets", {
          personId: jane?.personId,
          month: team.month,
          amount: 100,
        })
      ).status,
    ).toBe(403);
    expect((await get("ryan", "/api/targets")).status).toBe(403);
    expect((await get("sarla", "/api/targets")).status).toBe(403);
    expect(
      (
        await post("vanessa", "/api/targets", {
          personId: ryan?.personId,
          month: team.month,
          amount: null,
        })
      ).status,
    ).toBe(200);
    expect((await read<MyOrders>("ryan", "/api/orders/mine")).sales.target).toBeNull();
  });
});
