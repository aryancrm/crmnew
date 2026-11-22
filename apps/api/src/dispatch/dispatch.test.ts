import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { ticked, shelfBack } from "../testing/approve";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { addDays } from "../finance/rules";
import { seedFixture } from "../inventory/fixture";
import { todayManila } from "../inventory/rules";
import { seedDemo } from "../seed";
import { attachReceipt } from "../testing/receipt";
import type {
  DispatchBoard,
  DispatchKpis,
  NotificationList,
  OrderBoard,
  OrderDashboard,
  OrderDetail,
  OwedInvoices,
  PackPlan,
  ShipmentList,
} from "../types";
import { firstExpiryFirst } from "./rules";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
let credit: number;
let cod: number;
let medicineId: number;
const batch: Record<string, number> = {};
let main: number;
let cebu: number;

const get = (who: string, path: string) =>
  app.request(path, { headers: { cookie: cookies[who] as string } });
const read = async <T>(who: string, path: string) => (await (await get(who, path)).json()) as T;
const post = (who: string, path: string, body: unknown = {}) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookies[who] as string },
    body: JSON.stringify(body),
  });
const order = (who: string, id: number) => read<OrderDetail>(who, `/api/orders/${id}`);
const fieldOf = async (response: Response) => {
  const body = (await response.json()) as {
    error?: { field?: string; fields?: Record<string, string> };
  };
  return body.error?.field ?? Object.keys(body.error?.fields ?? {})[0];
};
const shelf = async (code: string, warehouseId = main) =>
  (
    await rows<{ qty: number }>(
      db,
      sql`select qty::int as qty from stock where batch_id = ${batch[code]} and warehouse_id = ${warehouseId}`,
    )
  )[0]?.qty ?? 0;

/** Ryan places it, Sarla approves it, Fiona makes its invoice: it waits for Dispatch. */
async function readyToPack(customerId: number, qty: number): Promise<number> {
  const placed = (await (
    await post("ryan", "/api/orders", {
      customerId,
      items: [{ medicineId, qty, priceKind: "hospital" }],
    })
  ).json()) as { id: number };
  expect((await post("sarla", await ticked(db, `/api/orders/${placed.id}/approve`))).status).toBe(200);
  expect((await post("fiona", `/api/finance/orders/${placed.id}/invoice`)).status).toBe(200);
  return placed.id;
}
const pack = (who: string, id: number, picks?: object[]) =>
  post(who, `/api/dispatch/orders/${id}/pack`, picks ? { picks } : {});
/** Ships it; the address slip is checked unless the body says otherwise. */
const ship = (who: string, id: number, body: object) =>
  post(who, `/api/dispatch/orders/${id}/ship`, { addressChecked: true, ...body });
/** Delivers with the signed receipt's photo put on the order first (unless `receipt` is false). */
const deliver = async (who: string, id: number, body: object, receipt = true) => {
  if (receipt) await attachReceipt(app, cookies.marco as string, id);
  return post(who, `/api/dispatch/orders/${id}/deliver`, body);
};

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  await seedFixture(db);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["ryan", "sarla", "fiona", "marco", "naresh", "irene"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
  const add = async (body: object) =>
    ((await (await post("sarla", "/api/customers", body)).json()) as { id: number }).id;
  credit = await add({
    kind: "hospital",
    name: "Olivarez General Hospital",
    city: "Parañaque",
    paymentTerms: "days",
    paymentDays: 30,
  });
  cod = await add({
    kind: "hospital",
    name: "Las Piñas Doctors Hospital",
    city: "Las Piñas",
    paymentTerms: "cod",
  });
  // A medicine of our own with three batches in Main (one expired) and one in Cebu.
  const today = todayManila();
  const places = await rows<{ id: number; code: string }>(
    db,
    sql`select id::int as id, code from warehouse`,
  );
  main = places.find((place) => place.code === "MAIN")?.id as number;
  cebu = places.find((place) => place.code === "CEBU")?.id as number;
  const [made] = await rows<{ id: number }>(
    db,
    sql`insert into medicine (name, strength) values ('Testamine', '5 mg') returning id::int as id`,
  );
  medicineId = made?.id as number;
  await db.execute(
    sql`insert into medicine_price (medicine_id, buyer_type, amount) values (${medicineId}, 'hospital', 1000)`,
  );
  for (const [code, days, qty, warehouseId] of [
    ["OLD", -1, 50, main],
    ["NEAR", 60, 30, main],
    ["FAR", 400, 100, main],
    ["CB", 30, 500, cebu],
  ] as const) {
    const [made] = await rows<{ id: number }>(
      db,
      sql`insert into batch (medicine_id, batch_no, expires_on, unit_cost) values (${medicineId}, ${code}, ${addDays(today, days)}::date, 700) returning id::int as id`,
    );
    batch[code] = made?.id as number;
    await db.execute(
      sql`insert into stock (batch_id, warehouse_id, qty) values (${made?.id}, ${warehouseId}, ${qty})`,
    );
  }
});

describe("the first-expiry-first pick", () => {
  it("takes the nearest expiry first, never an expired batch, and says what is short", () => {
    const batches = [
      { batchId: 1, expiresOn: "2026-12-01", onShelf: 10 },
      { batchId: 2, expiresOn: "2026-11-01", onShelf: 99 },
      { batchId: 3, expiresOn: "2027-01-01", onShelf: 5 },
    ];
    expect(firstExpiryFirst(12, batches, "2026-11-15")).toEqual({
      picks: [
        { batchId: 1, qty: 10 },
        { batchId: 3, qty: 2 },
      ],
      short: 0,
    });
    expect(firstExpiryFirst(20, batches, "2026-11-15")).toEqual({
      picks: [
        { batchId: 1, qty: 10 },
        { batchId: 3, qty: 5 },
      ],
      short: 5,
    });
  });
});

describe("packing", () => {
  it("shows Dispatch what to pick, and packs the nearest expiry off the shelf", async () => {
    const id = await readyToPack(credit, 50);
    const board = await read<OrderBoard>("marco", "/api/orders/board");
    expect(board.desk).toBe("dispatch");
    expect(board.cards.find((card) => card.id === id)?.next).toBe("Pack it from Main warehouse");
    expect((await order("marco", id)).can).toMatchObject({ pack: true, ship: false, hold: true });

    const plan = await read<PackPlan>("marco", `/api/dispatch/orders/${id}/pack`);
    expect(plan.warehouse).toBe("Main warehouse");
    expect(plan.lines[0]?.batches.map((row) => row.batchNo)).toEqual(["NEAR", "FAR"]);
    expect(plan.lines[0]?.suggested).toEqual([
      { batchId: batch.NEAR, qty: 30 },
      { batchId: batch.FAR, qty: 20 },
    ]);
    expect((await get("ryan", `/api/dispatch/orders/${id}/pack`)).status).toBe(403);
    expect((await pack("fiona", id)).status).toBe(403);

    expect((await pack("marco", id)).status).toBe(200);
    const packed = await order("ryan", id);
    expect(packed.order).toMatchObject({
      status: "packing",
      statusLabel: "Packed",
      packedBy: "Marco",
    });
    expect(packed.picks.map((pick) => [pick.batchNo, pick.qty])).toEqual([
      ["NEAR", 30],
      ["FAR", 20],
    ]);
    expect(packed.stages.find((stage) => stage.key === "packed")?.at).not.toBeNull();
    expect(await shelf("NEAR")).toBe(0);
    expect(await shelf("FAR")).toBe(80);
    expect(await shelf("OLD")).toBe(50);
    const moves = await rows<{ kind: string; qty: number; ref: string }>(
      db,
      sql`select kind, qty::int as qty, ref from stock_move where ref = ${packed.order.code} order by id`,
    );
    expect(moves).toEqual([
      { kind: "deliver", qty: -30, ref: packed.order.code },
      { kind: "deliver", qty: -20, ref: packed.order.code },
    ]);

    // Unpacked: the pieces go back where they came from, and it can be packed again by hand.
    expect(
      (
        await post("marco", `/api/dispatch/orders/${id}/unpack`, {
          reason: "Customer wants a longer expiry",
        })
      ).status,
    ).toBe(200);
    expect(await shelf("NEAR")).toBe(30);
    expect(await shelf("FAR")).toBe(100);
    expect((await order("marco", id)).order.status).toBe("ready_for_dispatch");
    expect(
      await fieldOf(
        await pack("marco", id, [{ itemId: plan.lines[0]?.itemId, batchId: batch.FAR, qty: 40 }]),
      ),
    ).toBe("lines.0");
    expect(
      (await pack("marco", id, [{ itemId: plan.lines[0]?.itemId, batchId: batch.OLD, qty: 50 }]))
        .status,
    ).toBe(400);
    expect(
      (await pack("marco", id, [{ itemId: plan.lines[0]?.itemId, batchId: batch.CB, qty: 50 }]))
        .status,
    ).toBe(400);
    expect(
      (await pack("marco", id, [{ itemId: plan.lines[0]?.itemId, batchId: batch.FAR, qty: 50 }]))
        .status,
    ).toBe(200);
    expect(await shelf("FAR")).toBe(50);
    expect(await shelf("NEAR")).toBe(30);
  });

  it("picks a promo's free line from what its paid line left (19 Nov: a nearly empty first batch refused the box)", async () => {
    // Two vials left in the batch that expires first, plenty in the next.
    const today = todayManila();
    const [twin] = await rows<{ id: number }>(db, sql`insert into medicine (name, strength) values ('Twinamine', '2 mg') returning id::int as id`);
    await db.execute(sql`insert into medicine_price (medicine_id, buyer_type, amount) values (${twin?.id}, 'hospital', 1000)`);
    for (const [code, days, qty] of [["TW-A", 30, 2], ["TW-B", 300, 100]] as const) {
      const [made] = await rows<{ id: number }>(
        db,
        sql`insert into batch (medicine_id, batch_no, expires_on, unit_cost) values (${twin?.id}, ${code}, ${addDays(today, days)}::date, 700) returning id::int as id`,
      );
      await db.execute(sql`insert into stock (batch_id, warehouse_id, qty) values (${made?.id}, ${main}, ${qty})`);
    }
    const ready = async () => {
      const placed = (await (await post("ryan", "/api/orders", { customerId: credit, items: [{ medicineId: twin?.id, qty: 6, priceKind: "hospital" }] })).json()) as { id: number };
      // The promo's free line: the same medicine again.
      await db.execute(
        sql`insert into order_item (order_id, medicine_id, qty, price_kind, list_price, unit_price, free) values (${placed.id}, ${twin?.id}, 6, 'hospital', 1000, 0, true)`,
      );
      expect((await post("sarla", await ticked(db, `/api/orders/${placed.id}/approve`))).status).toBe(200);
      expect((await post("fiona", `/api/finance/orders/${placed.id}/invoice`)).status).toBe(200);
      return placed.id;
    };
    // The plan Dispatch is shown never asks a batch for more than it holds, over all the lines.
    const first = await ready();
    const plan = await read<PackPlan>("marco", `/api/dispatch/orders/${first}/pack`);
    const asked = new Map<number, number>();
    for (const line of plan.lines) for (const pick of line.suggested) asked.set(pick.batchId, (asked.get(pick.batchId) ?? 0) + pick.qty);
    for (const line of plan.lines)
      for (const one of line.batches) expect(asked.get(one.batchId) ?? 0).toBeLessThanOrEqual(one.onShelf);
    // Packed as shown (the screen sends the plan's picks), and packed with no picks at all.
    const shown = plan.lines.flatMap((line) => line.suggested.map((pick) => ({ itemId: line.itemId, ...pick })));
    expect((await pack("marco", first, shown)).status).toBe(200);
    const second = await ready();
    expect((await pack("marco", second)).status).toBe(200);
    expect((await order("marco", second)).picks.reduce((sum, pick) => sum + pick.qty, 0)).toBe(12);
  });

  it("refuses when the warehouse hasn't enough that hasn't expired, and says so", async () => {
    const id = await readyToPack(credit, 500);
    // Approved while the shelf had it (what isn't in stock isn't approved, 23 Nov); then it went.
    await shelfBack(db, id);
    const plan = await read<PackPlan>("marco", `/api/dispatch/orders/${id}/pack`);
    expect(plan.lines[0]?.short).toBe(500 - 30 - (await shelf("FAR")));
    const refused = await pack("marco", id);
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: { message: string } }).error.message).toMatch(
      /^Testamine 5 mg: 500 ordered, only \d+ in Main warehouse/,
    );
    expect((await order("marco", id)).order.status).toBe("ready_for_dispatch");
  });
});

describe("cold chain", () => {
  it("is set in Inventory and follows the order to Dispatch: the lines, the cards, the slip", async () => {
    const detail = await read<{ medicine: Record<string, unknown> }>(
      "sarla",
      `/api/inventory/medicines/${medicineId}`,
    );
    const { id: _id, code: _code, active: _active, ...input } = detail.medicine;
    expect(detail.medicine.coldChain).toBe(false);
    expect(
      (await post("irene", `/api/inventory/medicines/${medicineId}`, { ...input, coldChain: true }))
        .status,
    ).toBe(200);
    // Saved again without the field (an older screen): the mark stays.
    const { coldChain: _cold, ...without } = input;
    expect((await post("irene", `/api/inventory/medicines/${medicineId}`, without)).status).toBe(200);
    const id = await readyToPack(credit, 2);
    expect((await order("marco", id)).items.map((item) => item.cold)).toEqual([true]);
    const cards = await read<OrderBoard>("marco", "/api/orders/board?desk=dispatch&tab=needs");
    expect(cards.cards.find((card) => card.id === id)?.items[0]?.cold).toBe(true);
    // Back to room temperature for the other tests.
    expect(
      (await post("irene", `/api/inventory/medicines/${medicineId}`, { ...input, coldChain: false }))
        .status,
    ).toBe(200);
    expect((await order("marco", id)).items[0]?.cold).toBe(false);
    expect((await post("sarla", `/api/orders/${id}/cancel`, { reason: "Test order" })).status).toBe(200);
  });
});

describe("the cold-chain box", () => {
  it("is pointed out on a cold order, priced by Management, and packed from the shelf", async () => {
    // Inventory marks the medicine cold and keeps a styro box as an item with stock.
    await db.execute(sql`update medicine set cold_chain = true where id = ${medicineId}`);
    const [box] = await rows<{ id: number }>(
      db,
      sql`insert into medicine (name, unit) values ('Packaging : Cake Roll with Cover-Styro', 'pcs') returning id::int as id`,
    );
    const boxId = box?.id as number;
    const detail = await read<{ medicine: Record<string, unknown> }>(
      "irene",
      `/api/inventory/medicines/${boxId}`,
    );
    const { id: _id, code: _code, active: _active, ...input } = detail.medicine;
    expect(
      (await post("irene", `/api/inventory/medicines/${boxId}`, { ...input, coldBox: true })).status,
    ).toBe(200);
    const [shelf] = await rows<{ id: number }>(
      db,
      sql`insert into batch (medicine_id, batch_no, expires_on, unit_cost) values (${boxId}, 'STYRO', '2030-12-31', 4000) returning id::int as id`,
    );
    await db.execute(sql`insert into stock (batch_id, warehouse_id, qty) values (${shelf?.id}, ${main}, 20)`);

    const placed = (await (
      await post("ryan", "/api/orders", {
        customerId: credit,
        items: [{ medicineId, qty: 2, priceKind: "hospital" }],
      })
    ).json()) as { id: number };
    const before = await order("sarla", placed.id);
    expect(before.findings.map((finding) => finding.short)).toContain("No cold box");

    // Management adds the box at what the cold chain costs: no list, no reason needed.
    const changed = await post("sarla", `/api/orders/${placed.id}/change`, {
      customerId: credit,
      items: [
        { medicineId, qty: 2, priceKind: "hospital" },
        { medicineId: boxId, qty: 1, priceKind: "hospital", unitPrice: 8900 },
      ],
      answer: "Cold chain box added",
    });
    expect(changed.status, await changed.clone().text()).toBe(200);
    const after = await order("sarla", placed.id);
    const line = after.items.find((item) => item.medicineId === boxId);
    expect(line).toMatchObject({ unitPrice: 8900, coldBox: true, reason: "Cold-chain packaging" });
    expect(after.findings.map((finding) => finding.short)).not.toContain("No cold box");
    expect(after.findings.filter((finding) => finding.kind === "price")).toEqual([]);
    expect(after.order.total).toBe(2 * 1000 + 8900);

    // It goes on like any order, and the box comes off the shelf when packed.
    expect((await post("sarla", await ticked(db, `/api/orders/${placed.id}/approve`))).status).toBe(200);
    expect((await post("fiona", `/api/finance/orders/${placed.id}/invoice`)).status).toBe(200);
    expect((await pack("marco", placed.id)).status).toBe(200);
    const [left] = await rows<{ qty: number }>(
      db,
      sql`select qty::int as qty from stock where batch_id = ${shelf?.id} and warehouse_id = ${main}`,
    );
    expect(left?.qty).toBe(19);
    await db.execute(sql`update medicine set cold_chain = false where id = ${medicineId}`);
  });
});

describe("shipping and delivery", () => {
  it("ships with a courier, takes the tracking later, comes back, goes out with our rider, is delivered", async () => {
    const id = await readyToPack(credit, 10);
    await pack("marco", id);
    expect(await fieldOf(await ship("marco", id, { method: "courier" }))).toBe("courier");
    expect(await fieldOf(await ship("marco", id, { method: "rider" }))).toBe("rider");
    // No tracking number yet: why (the hub's "not ready yet").
    expect(await fieldOf(await ship("marco", id, { method: "courier", courier: "LBC" }))).toBe(
      "trackingWait",
    );
    // The slip on the parcel checked against the order first (the hub's Confirm for delivery).
    expect(
      await fieldOf(
        await ship("marco", id, {
          method: "courier",
          courier: "LBC",
          trackingWait: "Waiting for the waybill",
          addressChecked: false,
        }),
      ),
    ).toBe("addressChecked");
    expect(
      (
        await ship("marco", id, {
          method: "courier",
          courier: "LBC",
          trackingWait: "Waiting for the waybill",
        })
      ).status,
    ).toBe(200);
    const shipped = await order("marco", id);
    expect(shipped.order.trackingWait).toBe("Waiting for the waybill");
    expect(shipped.events.map((event) => event.message).join(" ")).toMatch(
      /tracking to follow \(waiting for the waybill\)\. Address slip checked against the order/,
    );
    const mine = async () =>
      (
        await read<{ cards: { id: number; next: string }[] }>("ryan", "/api/orders/mine")
      ).cards.find((card) => card.id === id)?.next;
    expect(await mine()).toBe("On the way with LBC, tracking to follow");
    expect(
      (await post("marco", `/api/dispatch/orders/${id}/tracking`, { tracking: "LBC-5521-8890" }))
        .status,
    ).toBe(200);
    expect(await mine()).toBe("On the way with LBC · LBC-5521-8890");
    expect((await order("marco", id)).order.trackingWait).toBeNull();
    // On the road it can't be cancelled: it must come back first.
    expect((await order("sarla", id)).can.cancel).toBe(false);
    expect((await post("sarla", `/api/orders/${id}/cancel`, { reason: "x" })).status).toBe(409);

    expect((await post("marco", `/api/dispatch/orders/${id}/failed`, {})).status).toBe(400);
    expect(
      (
        await post("marco", `/api/dispatch/orders/${id}/failed`, {
          reason: "Nobody at the receiving area",
        })
      ).status,
    ).toBe(200);
    const back = await order("marco", id);
    expect(back.order).toMatchObject({ status: "packing", courier: null, tracking: null });
    expect(back.picks).toHaveLength(1);
    expect((await ship("marco", id, { method: "rider", rider: "Jun" })).status).toBe(200);

    // No photo of the signed receipt on the order: not delivered.
    expect(
      await fieldOf(
        await deliver("marco", id, { receivedBy: "Nurse Ana", deliveredOn: todayManila() }, false),
      ),
    ).toBe("proof");
    expect(
      await fieldOf(await deliver("marco", id, { receivedBy: "", deliveredOn: todayManila() })),
    ).toBe("receivedBy");
    expect(
      await fieldOf(
        await deliver("marco", id, {
          receivedBy: "Nurse Ana",
          deliveredOn: addDays(todayManila(), 1),
        }),
      ),
    ).toBe("deliveredOn");
    // Nor a day before it left the warehouse (a mistyped month would make its invoice long overdue).
    expect(
      await fieldOf(await deliver("marco", id, { receivedBy: "Nurse Ana", deliveredOn: addDays(todayManila(), -30) })),
    ).toBe("deliveredOn");
    expect(
      (await deliver("ryan", id, { receivedBy: "Nurse Ana", deliveredOn: todayManila() })).status,
    ).toBe(403);
    expect(
      (await deliver("marco", id, { receivedBy: "Nurse Ana", deliveredOn: todayManila() })).status,
    ).toBe(200);
    let done = await order("ryan", id);
    expect(done.order).toMatchObject({
      status: "completed",
      deliveryMethod: "rider",
      rider: "Jun",
      receivedBy: "Nurse Ana",
      deliveredOn: todayManila(),
    });
    const at = (key: string) => done.stages.find((stage) => stage.key === key)?.at;
    expect(at("delivered")).not.toBeNull();
    expect(at("completed")).toBeNull();
    // Paid later: then it is complete.
    const invoice = done.money.invoice;
    expect(
      (
        await post("fiona", `/api/invoices/${invoice?.id}/payments`, {
          amount: invoice?.balance,
          method: "check",
          reference: "CHK-1",
          paidOn: todayManila(),
        })
      ).status,
    ).toBe(200);
    done = await order("ryan", id);
    expect(done.stages.find((stage) => stage.key === "completed")?.at).not.toBeNull();
  });

  it("hands a cash-on-delivery order over at the warehouse, and its invoice falls due that day", async () => {
    const id = await readyToPack(cod, 5);
    const before = (await order("fiona", id)).money.invoice;
    expect(before?.state.word).toBe("Collect on delivery");
    await pack("marco", id);
    expect((await order("marco", id)).can.deliver).toBe(true);
    expect(
      (
        await deliver("marco", id, {
          receivedBy: "Juan dela Cruz (driver)",
          deliveredOn: todayManila(),
        })
      ).status,
    ).toBe(200);
    const done = await order("fiona", id);
    expect(done.order).toMatchObject({ status: "completed", deliveryMethod: "pickup" });
    expect(done.money.invoice).toMatchObject({ dueOn: todayManila(), status: "open" });
    expect(done.money.invoice?.state.word).toBe("Due today");
    expect(done.events.find((event) => event.stage === "delivered")?.message).toMatch(
      /^Picked up at the warehouse: received by Juan dela Cruz \(driver\) on .+ Cash on delivery: ₱50\.00 to collect/,
    );
  });

  it("notes who has the cash on delivery, shows it to Dispatch and Finance, and Finance records it (19 Nov)", async () => {
    const id = await readyToPack(cod, 3);
    await pack("marco", id);
    expect((await ship("marco", id, { method: "rider", rider: "Pedro (rider)" })).status).toBe(200);
    // Not more than it owes, and someone has to have it.
    const tooMuch = await deliver("marco", id, {
      receivedBy: "Nurse Santos",
      deliveredOn: todayManila(),
      cod: { amount: 3001, by: "Pedro (rider)" },
    });
    expect(tooMuch.status).toBe(400);
    expect(await fieldOf(tooMuch)).toBe("amount");
    expect((await order("fiona", id)).order.status).toBe("shipped");
    const delivered = await deliver(
      "marco",
      id,
      { receivedBy: "Nurse Santos", deliveredOn: todayManila(), cod: { amount: 3000, by: "Pedro (rider)" } },
      false,
    );
    expect(delivered.status).toBe(200);
    const detail = await order("fiona", id);
    expect(detail.order.status).toBe("completed");
    expect(detail.events.find((event) => event.stage === "delivered")?.message).toMatch(
      /Cash on delivery collected: ₱30\.00, with Pedro \(rider\)\. Finance records it when it is in the bank\./,
    );
    // Dispatch: under Delivered, cash on delivery, with who has the cash; not paid yet.
    const board = await read<DispatchBoard>("marco", "/api/dispatch/board");
    const card = board.done.find((one) => one.id === id);
    expect(card?.pay).toMatchObject({ terms: "cod", total: 3000, balance: 3000, paid: false });
    expect(card?.cod).toMatchObject({ amount: 3000, by: "Pedro (rider)", on: todayManila() });
    expect(board.counts.done).toBeGreaterThanOrEqual(1);
    // Finance: the same note on its due payments.
    const owed = await read<OwedInvoices>("fiona", "/api/finance/owed/invoices");
    const row = owed.rows.find((one) => one.orderId === id);
    expect(row?.codCash).toMatchObject({ amount: 3000, by: "Pedro (rider)" });
    // Only Dispatch notes it; Finance records the payment when it is in the bank.
    expect((await post("fiona", `/api/dispatch/orders/${id}/cod`, { amount: 3000, by: "x" })).status).toBe(403);
    const invoiceId = detail.money.invoice?.id as number;
    expect(
      (
        await post("fiona", `/api/invoices/${invoiceId}/payments`, {
          amount: 3000,
          method: "cash",
          reference: "Rider's cash, deposited",
          paidOn: todayManila(),
        })
      ).status,
    ).toBe(200);
    const after = (await read<DispatchBoard>("marco", "/api/dispatch/board")).done.find((one) => one.id === id);
    expect(after?.pay).toMatchObject({ paid: true, balance: 0 });
    // Paid: there is nothing left to note.
    expect((await post("marco", `/api/dispatch/orders/${id}/cod`, { amount: 100, by: "Pedro" })).status).toBe(409);
  });

  it("notes the cash later, refuses before delivery and on an order that isn't cash on delivery", async () => {
    const id = await readyToPack(cod, 2);
    expect((await post("marco", `/api/dispatch/orders/${id}/cod`, { amount: 2000, by: "LBC" })).status).toBe(409);
    await pack("marco", id);
    expect((await ship("marco", id, { method: "courier", courier: "LBC", tracking: "LBC-1" })).status).toBe(200);
    expect((await deliver("marco", id, { receivedBy: "Pharmacy", deliveredOn: todayManila() })).status).toBe(200);
    const missing = await post("marco", `/api/dispatch/orders/${id}/cod`, { amount: 2000, by: "" });
    expect(missing.status).toBe(400);
    expect(await fieldOf(missing)).toBe("by");
    expect((await post("marco", `/api/dispatch/orders/${id}/cod`, { amount: 1500, by: "LBC remittance" })).status).toBe(200);
    expect((await order("fiona", id)).events.at(-1)?.message).toMatch(/₱15\.00 \(₱5\.00 short\), with LBC remittance/);
    const termsOrder = await readyToPack(credit, 1);
    await pack("marco", termsOrder);
    expect((await deliver("marco", termsOrder, { receivedBy: "Olivarez", deliveredOn: todayManila() })).status).toBe(200);
    expect((await post("marco", `/api/dispatch/orders/${termsOrder}/cod`, { amount: 100, by: "x" })).status).toBe(409);
    const card = (await read<DispatchBoard>("marco", "/api/dispatch/board")).done.find((one) => one.id === termsOrder);
    expect(card?.pay).toMatchObject({ terms: "days", days: 30, paid: false });
  });
});

describe("holds, cancelling and the lists", () => {
  it("puts packed pieces back on the shelf when the order is cancelled", async () => {
    const id = await readyToPack(credit, 7);
    const far = await shelf("FAR");
    const near = await shelf("NEAR");
    await pack("marco", id);
    expect((await shelf("NEAR")) + (await shelf("FAR"))).toBe(near + far - 7);
    expect(
      (await post("sarla", `/api/orders/${id}/cancel`, { reason: "Hospital cancelled" })).status,
    ).toBe(200);
    expect(await shelf("NEAR")).toBe(near);
    expect(await shelf("FAR")).toBe(far);
    const after = await order("sarla", id);
    expect(after.picks).toHaveLength(0);
    expect(after.events.map((event) => event.message)).toContain(
      "7 packed pieces back on the shelf.",
    );
  });

  it("Dispatch holds at its own step and takes off only its own holds", async () => {
    const id = await readyToPack(credit, 3);
    expect(
      (
        await post("marco", `/api/orders/${id}/hold`, {
          reason: "Address unclear: call the hospital",
        })
      ).status,
    ).toBe(200);
    const held = await order("ryan", id);
    expect(held.order).toMatchObject({
      status: "on_hold",
      heldRole: "dispatch",
      heldFrom: "ready_for_dispatch",
    });
    const card = (await read<OrderBoard>("marco", "/api/orders/board?tab=hold")).cards.find(
      (item) => item.id === id,
    );
    expect(card?.next).toBe("On hold by Dispatch: Address unclear: call the hospital");
    expect((await order("fiona", id)).can.resume).toBe(false);
    expect((await order("marco", id)).can.resume).toBe(true);
    expect((await post("marco", `/api/orders/${id}/resume`)).status).toBe(200);
    expect((await order("marco", id)).order).toMatchObject({
      status: "ready_for_dispatch",
      heldRole: null,
    });
    // Dispatch can't hold what isn't at its step.
    const placed = (await (
      await post("ryan", "/api/orders", {
        customerId: credit,
        items: [{ medicineId, qty: 1, priceKind: "hospital" }],
      })
    ).json()) as { id: number };
    expect((await post("marco", `/api/orders/${placed.id}/hold`, { reason: "x" })).status).toBe(
      409,
    );
  });

  it("lists shipments, counts Dispatch's work, and keeps the lists from those who don't ship", async () => {
    const shipments = await read<ShipmentList>("marco", "/api/shipments?tab=all");
    expect(shipments.rows.length).toBe(shipments.counts.all);
    expect(shipments.counts.all).toBeGreaterThanOrEqual(2);
    expect(
      shipments.rows.some((row) => row.rider === "Jun" && row.receivedBy === "Nurse Ana"),
    ).toBe(true);
    expect(
      (await read<ShipmentList>("marco", "/api/shipments?tab=road")).rows.every(
        (row) => row.status === "shipped",
      ),
    ).toBe(true);
    expect((await get("ryan", "/api/shipments")).status).toBe(403);
    const dashboard = await read<OrderDashboard>("marco", "/api/orders/dashboard");
    const board = await read<OrderBoard>("marco", "/api/orders/board");
    expect(
      dashboard.attention.toPack + dashboard.attention.toShip + dashboard.attention.onTheWay,
    ).toBe(board.counts.needs);
    expect((await read<OrderDashboard>("ryan", "/api/orders/dashboard")).attention.toPack).toBe(0);
  });
});

describe("the warehouse's day and the bell", () => {
  const bell = (who: string) => read<NotificationList>(who, "/api/notifications");
  it("tells each desk its own work, keeps who has an order in hand, and counts the day", async () => {
    const placed = (await (
      await post("ryan", "/api/orders", {
        customerId: credit,
        items: [{ medicineId, qty: 4, priceKind: "hospital" }],
      })
    ).json()) as { id: number };
    const id = placed.id;
    // Sent back and fixed: each side hears it, with the reason and the answer.
    await post("sarla", `/api/orders/${id}/send_back`, { reason: "Wrong quantity" });
    const sentBack = (await bell("ryan")).rows.find(
      (row) => row.kind === "sent_back" && row.link === `/orders/${id}`,
    );
    expect(sentBack?.body).toContain("Wrong quantity");
    expect(sentBack?.read).toBe(false);
    expect(
      (
        await post("ryan", `/api/orders/${id}/revise`, {
          customerId: credit,
          items: [{ medicineId, qty: 2, priceKind: "hospital" }],
          answer: "Two only, as they asked",
        })
      ).status,
    ).toBe(200);
    expect((await bell("sarla")).rows.find((row) => row.link === `/orders/${id}`)).toMatchObject({
      kind: "resent",
    });
    // Approved: Finance hears it has an invoice to make; invoiced: Dispatch hears it has one to pack.
    await post("sarla", await ticked(db, `/api/orders/${id}/approve`));
    expect(
      (await bell("fiona")).rows.some(
        (row) => row.kind === "to_finance" && row.link === `/orders/${id}`,
      ),
    ).toBe(true);
    expect(
      (await bell("ryan")).rows.some(
        (row) => row.kind === "approved" && row.link === `/orders/${id}`,
      ),
    ).toBe(true);
    await post("fiona", `/api/finance/orders/${id}/invoice`);
    expect(
      (await bell("marco")).rows.some(
        (row) => row.kind === "to_pack" && row.link === `/orders/${id}`,
      ),
    ).toBe(true);

    // Taken in the warehouse: the card says who has it, how many pieces.
    expect((await post("marco", `/api/dispatch/orders/${id}/take`)).status).toBe(200);
    expect((await post("ryan", `/api/dispatch/orders/${id}/take`)).status).toBe(403);
    const card = (
      await read<OrderBoard>("marco", "/api/orders/board?desk=dispatch&tab=to_pack")
    ).cards.find((item) => item.id === id);
    expect(card).toMatchObject({ dispatchBy: "Marco", pieces: 2 });

    // Packed, shipped, came back: the MedRep hears it go out, and Management and the MedRep that it came back.
    expect((await pack("marco", id)).status).toBe(200);
    expect(
      (await ship("marco", id, { method: "courier", courier: "LBC", tracking: "TRK-9" })).status,
    ).toBe(200);
    expect(
      (await bell("ryan")).rows.find(
        (row) => row.kind === "shipped" && row.link === `/orders/${id}`,
      )?.body,
    ).toContain("TRK-9");
    expect(
      (
        await post("marco", `/api/dispatch/orders/${id}/failed`, {
          reason: "Nobody at the address",
        })
      ).status,
    ).toBe(200);
    expect(
      (await bell("sarla")).rows.some(
        (row) => row.kind === "came_back" && row.link === `/orders/${id}`,
      ),
    ).toBe(true);
    const back = (
      await read<OrderBoard>("marco", "/api/orders/board?desk=dispatch&tab=came_back")
    ).cards.find((item) => item.id === id);
    expect(back).toMatchObject({ cameBackCount: 1, cameBackReason: "Nobody at the address" });
    expect(
      (await read<OrderBoard>("marco", "/api/orders/board?desk=dispatch&tab=to_ship")).cards.some(
        (item) => item.id === id,
      ),
    ).toBe(false);

    // The warehouse's day counts it.
    const day = await read<DispatchKpis>("marco", "/api/dispatch/kpis");
    expect(day.work.shipped).toBeGreaterThanOrEqual(1);
    expect(day.work.cameBack).toBeGreaterThanOrEqual(1);
    expect(day.now.cameBack).toBeGreaterThanOrEqual(1);
    expect(day.byCourier.some((row) => row.courier === "LBC")).toBe(true);
    expect((await get("ryan", "/api/dispatch/kpis")).status).toBe(403);

    // Read one, then all.
    const before = await bell("ryan");
    const first = before.rows.find((row) => !row.read);
    expect((await post("ryan", `/api/notifications/${first?.id}/read`)).status).toBe(200);
    expect((await bell("ryan")).unread).toBe(before.unread - 1);
    expect((await post("sarla", `/api/notifications/${first?.id}/read`)).status).toBe(404);
    await post("ryan", "/api/notifications/read-all");
    expect((await bell("ryan")).unread).toBe(0);
  });
});
