import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { countQueries, type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedFixture } from "../inventory/fixture";
import { seedDemo } from "../seed";
import { shelfBack, shelfUp, ticked } from "../testing/approve";
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
const act = async (who: string, id: number, action: string, body: object = {}) =>
  post(who, action === "approve" ? await ticked(db, `/api/orders/${id}/approve`) : `/api/orders/${id}/${action}`, body);
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
  for (const name of [
    "ryan",
    "daniel",
    "sarla",
    "jane",
    "fiona",
    "vanessa",
    "naresh",
    "marco",
    "admin",
  ]) {
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
    // The customer pays in advance and no proof is attached yet: Management is told; and it
    // reads the MedRep's note.
    expect(detail.findings.map((finding) => finding.kind)).toEqual(["note", "papers"]);
    // Ryan may not approve his own order; Management may.
    expect(detail.can.approve).toBe(false);
    expect((await order("sarla", made.body.id)).can).toMatchObject({
      approve: true,
      send_back: true,
      // Reject is gone (23 Nov): it left the order on hold as Put on hold does.
      reject: false,
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

  it("keeps the hub's Source, the reason there is no proof, and why it goes on short", async () => {
    const made = await place("ryan", {
      customerId: hospital,
      items: [line({ qty: medicine.stock + 50 })],
      source: "Hospital PO",
      note: "For the OR",
      noProofReason: "on_terms",
      stockReason: "They take what is there and wait for the rest",
    });
    expect(made.status).toBe(200);
    expect((await order("sarla", made.body.id)).order).toMatchObject({
      source: "Hospital PO",
      noProofReason: "on_terms",
      stockReason: "They take what is there and wait for the rest",
    });
    // Only the hub's list.
    expect(
      (await place("ryan", { customerId: hospital, items: [line()], source: "Walk-in" })).status,
    ).toBe(400);
  });

  it("Management places no orders (19 Nov); the Admin's own order waits for Management too (22 Nov)", async () => {
    // Management checks and approves orders; it doesn't raise them (Aryan, 19 Nov).
    expect((await post("sarla", "/api/orders", { customerId: hospital, items: [line()] })).status).toBe(403);
    const made = await place("admin", { customerId: hospital, items: [line()] });
    const detail = await order("sarla", made.body.id);
    expect(detail.order).toMatchObject({ status: "pending_approval", raisedBy: "Admin", medrep: "Ryan" });
    expect((await queue("sarla")).some((row) => row.id === made.body.id)).toBe(true);
  });

  it("stock short for two orders: the one placed first is served, the later one waits (23 Nov)", async () => {
    const code = async (response: Response) => ((await response.json()) as { error: { code: string } }).error.code;
    // The shelf holds just what the first order needs (the earlier orders have theirs); a second
    // one placed after it finds nothing left.
    const first = await place("ryan", { customerId: hospital, items: [line({ qty: 30 })] });
    await shelfUp(db, first.body.id);
    const second = await place("ryan", { customerId: hospital, items: [line({ qty: 10 })], stockReason: "They will wait" });
    // The first isn't short (only its checks are open); it used to be refused for the second's promise.
    expect(await code(await post("sarla", `/api/orders/${first.body.id}/approve`))).toBe("checks_open");
    expect((await order("sarla", first.body.id)).can.waitStock).toBe(false);
    // The second is: it is held (Wait for stock) or sent back, never approved.
    expect(await code(await post("sarla", `/api/orders/${second.body.id}/approve`))).toBe("short_stock");
    expect((await order("sarla", second.body.id)).findings.some((one) => one.kind === "stock")).toBe(true);
    expect((await act("sarla", second.body.id, "hold", { stock: true })).status).toBe(200);
    // The first gone, its pieces are free: the second has enough.
    await act("sarla", first.body.id, "cancel", { reason: "Hospital withdrew it" });
    expect((await order("sarla", second.body.id)).waitingStock?.short ?? []).toEqual([]);
    await act("sarla", second.body.id, "cancel", { reason: "Test done" });
    // The shelf as it was, for the tests after this one.
    await shelfBack(db, first.body.id);
  });

  it("Approve is refused until every check is approved (22 Nov)", async () => {
    const made = await place("ryan", { customerId: hospital, items: [line()] });
    // What isn't in stock isn't approved at all (23 Nov): held with Wait for stock instead.
    const noStock = await post("sarla", `/api/orders/${made.body.id}/approve`);
    expect(noStock.status).toBe(409);
    expect(((await noStock.json()) as { error: { code: string } }).error.code).toBe("short_stock");
    expect((await post("sarla", `/api/orders/${made.body.id}/checks/stock`)).status).toBe(409);
    await shelfUp(db, made.body.id);
    const refused = await post("sarla", `/api/orders/${made.body.id}/approve`);
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe("checks_open");
    expect((await post("sarla", `/api/orders/${made.body.id}/checks/papers`)).status).toBe(200);
    const open = await order("sarla", made.body.id);
    for (const key of ["price", "stock", "customer"])
      if (open.findings.some((one) => (key === "price" ? ["price", "note"] : key === "stock" ? ["stock"] : ["customer", "licence", "owes", "credit"]).includes(one.kind)))
        expect((await post("sarla", `/api/orders/${made.body.id}/checks/${key}`)).status).toBe(200);
    expect((await post("sarla", `/api/orders/${made.body.id}/approve`)).status).toBe(200);
  });
});

describe("an order's type, picked first (Aryan, 19 Nov)", () => {
  it("says which papers it carries; a patient's own order is a patient's type", async () => {
    // A business with their PO: the PO is needed, and its number kept.
    const withPo = await place("ryan", { customerId: hospital, items: [line()], type: "po", customerPo: "PO-1187" });
    expect(withPo.status, JSON.stringify(withPo.body)).toBe(200);
    let detail = await order("ryan", withPo.body.id);
    expect(detail.order.type).toBe("po");
    expect(detail.paperList.find((row) => row.kind === "po")?.needed).toBe(true);
    // Without a PO: it may come, it is never needed.
    const noPo = await place("ryan", { customerId: hospital, items: [line()], type: "no_po" });
    detail = await order("ryan", noPo.body.id);
    expect(detail.paperList.find((row) => row.kind === "po")?.needed).toBe(false);
    // A patient's type for a hospital: an order for one patient, their prescription and ID asked.
    const forPatient = await place("ryan", {
      customerId: hospital,
      items: [line()],
      type: "patient",
      patientName: "Lito Ramos",
    });
    detail = await order("ryan", forPatient.body.id);
    expect(detail.order.patientOrder).toBe(true);
    expect(detail.paperList.find((row) => row.kind === "valid_id")?.needed).toBe(true);
    // A patient never orders as a business; Senior / PWD carries their ID.
    const patient = ((await (await post("sarla", "/api/customers", {
      kind: "patient",
      name: "Rosa Lim",
      phone: "0917 555 0142",
      city: "Pasay",
      paymentTerms: "cod",
    })).json()) as { id: number }).id;
    const wrong = await place("ryan", { customerId: patient, items: [line({ priceKind: "patient" })], type: "po" });
    expect(wrong.status).toBe(400);
    const noId = await place("ryan", { customerId: patient, items: [line({ priceKind: "patient" })], type: "senior_pwd" });
    expect(noId.status).toBe(400);
    const senior = await place("ryan", {
      customerId: patient,
      items: [line({ priceKind: "patient" })],
      type: "senior_pwd",
      relief: { kind: "senior", idNo: "OSCA-5512", name: "Rosa Lim" },
    });
    expect(senior.status, JSON.stringify(senior.body)).toBe(200);
    detail = await order("ryan", senior.body.id);
    expect(detail.paperList.find((row) => row.kind === "senior_id")?.needed).toBe(true);
    expect(detail.paperList.some((row) => row.kind === "po")).toBe(false);
  });
});

describe("a guarantee letter's amount (Aryan, 19 Nov)", () => {
  it("is written when the letter is in, by the order's MedRep, Management or Finance", async () => {
    const gl = { customerId: hospital, items: [line()], type: "gl", patientName: "Lito Ramos", source: "DSWD" };
    // A seller doesn't place it himself: a guarantee letter is PAP's work (22 Nov), and the server
    // says so as the form does. (Here the Admin places it for him, so the letter's amount is tried.)
    expect((await place("ryan", gl)).status).toBe(403);
    const [ryan] = await rows<{ id: number }>(db, sql`select id::int as id from person where email = 'ryan@2mg.test'`);
    const made = await place("admin", { ...gl, medrepId: ryan?.id });
    expect(made.status, JSON.stringify(made.body)).toBe(200);
    const id = made.body.id;
    expect((await order("ryan", id)).order.glAmount).toBeNull();
    expect((await post("jane", `/api/orders/${id}/gl`, { amount: 100 })).status).not.toBe(200);
    const wrote = await post("ryan", `/api/orders/${id}/gl`, { number: "DSWD-2026-0042", amount: 2_500_00 });
    expect(wrote.status, await wrote.clone().text()).toBe(200);
    const detail = await order("fiona", id);
    expect(detail.order).toMatchObject({ glNumber: "DSWD-2026-0042", glAmount: 2_500_00, glSetBy: "Ryan" });
    expect(detail.events.some((event) => event.message.includes("DSWD-2026-0042"))).toBe(true);
    // Not on another kind of order.
    const other = await place("ryan", { customerId: hospital, items: [line()], type: "no_po" });
    expect((await post("ryan", `/api/orders/${other.body.id}/gl`, { amount: 100 })).status).toBe(409);
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
  it("approves a check at a time, then the order; taking it back clears them (19 Nov)", async () => {
    const made = await place("ryan", { customerId: hospital, items: [line()] });
    const id = made.body.id;
    expect((await post("ryan", `/api/orders/${id}/checks/price`, {})).status).toBe(403);
    expect((await post("sarla", `/api/orders/${id}/checks/nope`, {})).status).toBe(404);
    await shelfUp(db, id);
    for (const key of ["papers", "price", "stock", "customer"]) {
      const answer = await post("sarla", `/api/orders/${id}/checks/${key}`, {});
      expect(answer.status, await answer.clone().text()).toBe(200);
    }
    let detail = await order("sarla", id);
    expect(detail.order.status).toBe("pending_approval");
    expect(detail.checksApproved.map((one) => one.key).sort()).toEqual(["customer", "papers", "price", "stock"]);
    expect(detail.order.papersCheckedBy).toBe("Sarla");
    // The order itself: the Approve action, as always.
    expect((await act("sarla", id, "approve")).status).toBe(200);
    detail = await order("sarla", id);
    expect(detail.order.status).toBe("finance_check");
    expect(detail.order.approvedBy).toBe("Sarla");
    expect(detail.events.some((event) => event.message === "Customer & licence: approved by Sarla.")).toBe(true);
    // Gone on: nothing left to approve here.
    expect((await post("sarla", `/api/orders/${id}/checks/price`, {})).status).toBe(409);
    // Undone: back with Management, its checks looked at afresh.
    expect((await act("sarla", id, "take_back", { reason: "Undone straight after approving" })).status).toBe(200);
    detail = await order("sarla", id);
    expect(detail.order.status).toBe("pending_approval");
    expect(detail.checksApproved).toEqual([]);
  });

  it("Finance approves its own checks while the order is with it, and only those (19 Nov)", async () => {
    const made = await place("ryan", { customerId: hospital, items: [line()] });
    const id = made.body.id;
    // Not yet Finance's.
    expect((await post("fiona", `/api/orders/${id}/checks/finance_dues`, {})).status).toBe(409);
    expect((await act("sarla", id, "approve")).status).toBe(200);
    expect((await post("sarla", `/api/orders/${id}/checks/finance_dues`, {})).status).toBe(403);
    expect((await post("fiona", `/api/orders/${id}/checks/price`, {})).status).toBe(403);
    const answer = await post("fiona", `/api/orders/${id}/checks/finance_dues`, {});
    expect(answer.status, await answer.clone().text()).toBe(200);
    const detail = await order("fiona", id);
    expect(detail.checksApproved.map((one) => one.key).filter((key) => key.startsWith("finance_"))).toEqual(["finance_dues"]);
    expect(detail.events.some((event) => event.message === "Owed from before: approved by Fiona.")).toBe(true);
  });

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

  it("is changed by Management before approving; the MedRep is told what and why", async () => {
    const made = await place("ryan", { customerId: hospital, items: [line()] });
    const before = await order("sarla", made.body.id);
    const changed = {
      customerId: hospital,
      items: [line({ qty: 6 })],
      answer: "Only 6 in stock this week",
    };
    // A reason is needed, nothing-changed is refused, and only Management changes it.
    expect(
      (await post("sarla", `/api/orders/${made.body.id}/change`, { ...changed, answer: "" }))
        .status,
    ).toBe(400);
    expect(
      (
        await post("sarla", `/api/orders/${made.body.id}/change`, {
          ...changed,
          items: [line()],
        })
      ).status,
    ).toBe(400);
    expect((await post("ryan", `/api/orders/${made.body.id}/change`, changed)).status).toBe(409);
    expect((await post("sarla", `/api/orders/${made.body.id}/change`, changed)).status).toBe(200);
    const after = await order("sarla", made.body.id);
    // Still Management's to approve; the total follows the lines.
    expect(after.order.status).toBe("pending_approval");
    expect(after.items.map((item) => item.qty)).toEqual([6]);
    expect(after.order.total).toBe(6 * (before.items[0]?.unitPrice ?? 0));
    expect(
      after.events.some(
        (event) =>
          event.message.includes("changed the order before approving it") &&
          event.message.includes("10 → 6") &&
          event.message.includes("Only 6 in stock"),
      ),
    ).toBe(true);
    const [told] = await rows<{ title: string; body: string }>(
      db,
      sql`select title, body from notification where kind = 'order_changed' and order_id = ${made.body.id}`,
    );
    expect(told?.title).toContain("changed your order");
    expect(told?.body).toContain("Only 6 in stock");
    // Once approved it can't be changed this way.
    await act("sarla", made.body.id, "approve");
    expect((await post("sarla", `/api/orders/${made.body.id}/change`, changed)).status).toBe(409);
  });

  it("waits for stock: held with what is short, and the holder and MedRep told when it comes", async () => {
    // A medicine with stock free to sell (the tests before took this one's).
    const free = (await read<Catalogue>("sarla", "/api/inventory/medicines")).rows.find(
      (row) => row.free >= 5 && row.prices.hospital !== undefined && row.id !== medicine.id,
    );
    const covered = await place("ryan", {
      customerId: hospital,
      items: [{ medicineId: free?.id, qty: 1, priceKind: "hospital" }],
    });
    // Nothing short: no need to wait.
    expect((await act("sarla", covered.body.id, "hold", { stock: true })).status).toBe(409);
    const short = await place("ryan", {
      customerId: hospital,
      items: [line({ qty: medicine.stock + 50 })],
    });
    expect((await act("sarla", short.body.id, "hold", { stock: true })).status).toBe(200);
    const held = await order("ryan", short.body.id);
    expect(held.order.status).toBe("on_hold");
    expect(held.order.flagReason).toMatch(/^Waiting for stock: .*needs/);
    const [place2] = await rows<{ id: number }>(
      db,
      sql`select id::int as id from warehouse where active order by is_default desc, id limit 1`,
    );
    const receive = (qty: number, batchNo: string) =>
      post("marco", "/api/inventory/receive", {
        medicineId: medicine.id,
        warehouseId: place2?.id,
        batchNo,
        expiresOn: "2030-12-31",
        qty,
        ref: "PO test",
      });
    // A little isn't enough: nobody is told.
    expect((await receive(1, "WAIT-1")).status).toBe(200);
    const told = () =>
      rows<{ person: number; kind: string }>(
        db,
        sql`select person_id::int as person, kind from notification
          where order_id = ${short.body.id} and kind like 'stock_back%' order by kind`,
      );
    expect(await told()).toEqual([]);
    expect((await receive(100_000, "WAIT-2")).status).toBe(200);
    expect((await told()).map((one) => one.kind)).toEqual(["stock_back", "stock_back_info"]);
    // Told once per wait.
    expect((await receive(10, "WAIT-3")).status).toBe(200);
    expect(await told()).toHaveLength(2);
    expect(
      (await act("sarla", short.body.id, "resume", { reason: "The stock is in" })).status,
    ).toBe(200);
    const resumed = await order("sarla", short.body.id);
    expect(resumed.order.status).toBe("pending_approval");
    expect(resumed.order.flagReason).toBeNull();
  });

  it("lets one person in Management say they handle it, take it over or let it go", async () => {
    const made = await place("ryan", { customerId: hospital, items: [line({ qty: 2 })] });
    const card = async (who: string) =>
      (await read<OrderBoard>(who, "/api/orders/board?tab=needs")).cards.find(
        (one) => one.id === made.body.id,
      );
    expect((await post("ryan", `/api/orders/${made.body.id}/handle`)).status).toBe(403);
    // Nobody has started on Management's common screen: nobody has it until someone says so.
    expect((await card("admin"))?.handledBy).toBeNull();
    expect((await post("sarla", `/api/orders/${made.body.id}/handle`)).status).toBe(200);
    expect((await card("admin"))?.handledBy).toBe("Sarla");
    // Another takes it over; the one who no longer has it can't let it go for them.
    expect((await post("admin", `/api/orders/${made.body.id}/handle`)).status).toBe(200);
    expect(
      (await post("sarla", `/api/orders/${made.body.id}/handle`, { release: true })).status,
    ).toBe(200);
    expect((await card("sarla"))?.handledBy).toBe("Admin");
    const events = (await order("sarla", made.body.id)).events.map((one) => one.message);
    expect(events).toContain("Sarla is handling it.");
    expect(events).toContain("Admin took it over from Sarla.");
    expect(
      (await post("admin", `/api/orders/${made.body.id}/handle`, { release: true })).status,
    ).toBe(200);
    expect((await card("sarla"))?.handledBy).toBeNull();
    await act("sarla", made.body.id, "approve");
    expect((await post("sarla", `/api/orders/${made.body.id}/handle`)).status).toBe(409);
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
    // Approved again: the invoice cancelled with the take-back is made good again, same number.
    const first = (await order("sarla", made.body.id)).money.invoice;
    expect((await act("sarla", made.body.id, "approve")).status).toBe(200);
    const again = (await order("sarla", made.body.id)).money.invoice;
    expect(again?.state).not.toBe("cancelled");
    expect(again?.code).toBe(first?.code);
    // Past the half hour it can't be taken back any more.
    await db.execute(
      sql`update sales_order set approved_at = now() - interval '31 minutes' where id = ${made.body.id}`,
    );
    expect((await order("sarla", made.body.id)).can.take_back).toBe(false);
    expect((await act("sarla", made.body.id, "take_back", { reason: "Too late" })).status).toBe(
      409,
    );
  });

  it("holds with a reason and resumes to where it was; Reject and Exception are gone (23 Nov)", async () => {
    const made = await place("ryan", { customerId: hospital, items: [line()] });
    expect((await act("sarla", made.body.id, "reject", { reason: "Price too low" })).status).toBe(409);
    await act("sarla", made.body.id, "hold", { reason: "Price too low" });
    expect((await order("sarla", made.body.id)).order).toMatchObject({
      status: "on_hold",
      flagReason: "Price too low",
    });
    await act("sarla", made.body.id, "resume", { reason: "The price is right after all" });
    expect((await order("sarla", made.body.id)).order.status).toBe("pending_approval");

    await act("sarla", made.body.id, "approve");
    await act("sarla", made.body.id, "hold", { reason: "Waiting for stock" });
    // No order is marked an exception any more.
    expect(
      (await act("sarla", made.body.id, "exception", { reason: "Customer disputes the order" }))
        .status,
    ).toBe(409);
    await act("sarla", made.body.id, "resume", { reason: "The stock is in" });
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

  it("takes a held order back to an earlier desk, and brings back a cancelled one (the hub's Resume and Restore)", async () => {
    const made = await place("ryan", { customerId: hospital, items: [line()] });
    await act("sarla", made.body.id, "approve");
    const invoice = (await order("sarla", made.body.id)).money.invoice;
    expect(invoice?.status).toBe("open");
    await act("sarla", made.body.id, "hold", { reason: "Check the price again" });
    const held = await order("sarla", made.body.id);
    // Where it stopped first, then earlier desks; the MedRep gets no choice.
    expect(held.resumeTo.map((one) => one.status)).toEqual(["finance_check", "pending_approval"]);
    expect((await order("ryan", made.body.id)).resumeTo).toEqual([]);
    // Management says why, and never skips a desk ahead.
    expect((await act("sarla", made.body.id, "resume")).status).toBe(400);
    expect(
      (await act("sarla", made.body.id, "resume", { reason: "Fine", to: "ready_for_dispatch" }))
        .status,
    ).toBe(400);
    expect(
      (
        await act("sarla", made.body.id, "resume", {
          reason: "Change the price first",
          to: "pending_approval",
        })
      ).status,
    ).toBe(200);
    const back = await order("sarla", made.body.id);
    expect(back.order).toMatchObject({ status: "pending_approval", approvedBy: null });
    expect(back.money.invoice?.status).toBe("cancelled");
    expect(back.events.at(-1)?.message).toContain("back to Pending Management Approval");
    // Approved again: the same invoice, made good again.
    expect((await act("sarla", made.body.id, "approve")).status).toBe(200);
    expect((await order("sarla", made.body.id)).money.invoice).toMatchObject({
      code: invoice?.code,
      status: "open",
    });

    // Cancelled, then restored to Management's approval, with a reason, by Management only.
    expect(
      (await act("sarla", made.body.id, "cancel", { reason: "Customer cancelled" })).status,
    ).toBe(200);
    expect((await order("sarla", made.body.id)).can.restore).toBe(true);
    expect((await order("ryan", made.body.id)).can.restore).toBe(false);
    expect((await act("sarla", made.body.id, "restore")).status).toBe(400);
    expect(
      (await act("sarla", made.body.id, "restore", { reason: "The customer wants it after all" }))
        .status,
    ).toBe(200);
    const restored = await order("sarla", made.body.id);
    expect(restored.order.status).toBe("pending_approval");
    expect(restored.events.at(-1)?.message).toContain("Restored by Sarla");
    expect((await act("sarla", made.body.id, "approve")).status).toBe(200);
    expect((await order("sarla", made.body.id)).money.invoice).toMatchObject({
      code: invoice?.code,
      status: "open",
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
    // Every channel, not only those with orders (19 Nov): the target sheet's, and PAP (22 Nov).
    expect(board.channels).toEqual(["RX Business", "MD Telesales", "B2B", "BID", "CLIDP", "TeleSales", "HOSP", "MT", "PAP"]);
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
    // Sold is what was invoiced this month: the invoice is made when Management approves, so his
    // approved orders count and this one (still waiting) does not.
    const [invoiced] = await rows<{ value: number }>(
      db,
      sql`select coalesce(sum(i.total), 0)::float8 as value from invoice i join sales_order o on o.id = i.order_id
        join person p on p.id = o.medrep_id
        where p.name = 'Ryan' and i.status <> 'cancelled'
          and date_trunc('month', i.issued_on) = date_trunc('month', (now() at time zone 'Asia/Manila')::date)`,
    );
    expect(mine.sales.value).toBe(invoiced?.value ?? 0);
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

  it("a business's papers on an order go on its own file too, and count on the next order", async () => {
    const made = await place("ryan", { customerId: hospital, items: [line()] });
    const before = await read<CustomerDetail>("ryan", `/api/customers/${hospital}`);
    expect(before.papers.some((paper) => paper.kind === "lto_permit")).toBe(false);
    const added = await upload("ryan", made.body.id, "lto_permit", png());
    expect(added.status).toBe(200);
    const paperId = ((await added.json()) as { id: number }).id;
    // The PO stays with the order.
    expect((await upload("ryan", made.body.id, "po", png())).status).toBe(200);

    const after = await read<CustomerDetail>("ryan", `/api/customers/${hospital}`);
    expect(after.papers.filter((paper) => paper.kind === "lto_permit")).toMatchObject([
      { kindLabel: "LTO permit", name: "slip.png", by: "Ryan" },
    ]);
    expect(after.papers.some((paper) => paper.kind === ("po" as string))).toBe(false);
    expect(after.missing).not.toContain("LTO permit");
    // Its Files list it once, as theirs, with the order it came on.
    const files = await read<{ files: { source: string; kind: string; record: string | null }[] }>(
      "ryan",
      `/api/customers/${hospital}/files`,
    );
    const lto = files.files.filter((file) => file.kind === "lto_permit");
    expect(lto).toMatchObject([{ source: "customer", record: (await order("ryan", made.body.id)).order.code }]);
    expect(files.files.some((file) => file.kind === "po" && file.source === "order")).toBe(true);
    // The customer's file opens with the same bytes.
    const theirs = after.papers.find((paper) => paper.kind === "lto_permit");
    expect(new Uint8Array(await (await get("ryan", `/api/customer-papers/${theirs?.id}`)).arrayBuffer())).toHaveLength(11);

    // The next order finds it on their file.
    const next = await place("ryan", { customerId: hospital, items: [line()] });
    expect((await order("ryan", next.body.id)).paperList.find((row) => row.kind === "lto_permit")).toMatchObject({
      onFile: true,
      onCustomer: true,
    });

    // Taken off the order as the wrong file: off their file too.
    expect((await post("ryan", `/api/papers/${paperId}/remove`)).status).toBe(200);
    const gone = await read<CustomerDetail>("ryan", `/api/customers/${hospital}`);
    expect(gone.papers.some((paper) => paper.kind === "lto_permit")).toBe(false);
  });

  it("a patient's ID on their order goes on their file; a prescription is asked again", async () => {
    const patient = (
      (await (
        await post("sarla", "/api/customers", {
          kind: "patient",
          name: "Lito Cruz",
          phone: "0917 555 0177",
          city: "Pasay",
          paymentTerms: "cod",
        })
      ).json()) as { id: number }
    ).id;
    const made = await place("ryan", { customerId: patient, items: [line({ priceKind: "patient" })], type: "patient" });
    expect(made.status, JSON.stringify(made.body)).toBe(200);
    expect((await upload("ryan", made.body.id, "valid_id", png())).status).toBe(200);
    expect((await upload("ryan", made.body.id, "prescription", png())).status).toBe(200);
    const detail = await read<CustomerDetail>("ryan", `/api/customers/${patient}`);
    expect(detail.papers.map((paper) => paper.kind).sort()).toEqual(["prescription", "valid_id"]);
    const next = await place("ryan", { customerId: patient, items: [line({ priceKind: "patient" })], type: "patient" });
    const list = (await order("ryan", next.body.id)).paperList;
    expect(list.find((row) => row.kind === "valid_id")).toMatchObject({ onFile: true, onCustomer: true });
    expect(list.find((row) => row.kind === "prescription")).toMatchObject({ onFile: false });
  });

  it("bills as the company itself, keeps the doctor, and numbers orders one after another", async () => {
    const doctor = (
      (await (
        await post("sarla", "/api/customers", { kind: "doctor", name: "Ana Reyes", city: "Pasay", licenceNo: "0567001" })
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
      invoiceFrom: "gpi",
    });
    const second = await place("ryan", { customerId: hospital, items: [line()] });
    const a = await order("ryan", first.body.id);
    const b = await order("ryan", second.body.id);
    // One company per database since the separation (26 Nov night): asking for another is ignored.
    expect(a.order).toMatchObject({
      doctor: "Ana Reyes",
      invoiceFrom: "2mg",
      invoiceFromLabel: "2MG Inc.",
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
