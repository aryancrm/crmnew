import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase } from "../db/index";
import { migrate } from "../db/migrate";
import { seedFixture } from "../inventory/fixture";
import { todayManila } from "../inventory/rules";
import { seedDemo } from "../seed";
import { attachReceipt } from "../testing/receipt";
import type { Catalogue, LeadCase, LeadDesk, OrderDetail } from "../types";
import { deskStepOf, papersFor, quoteTotals, reliefPrice, roadStepOf } from "./rules";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
let medicine: { id: number; price: number; vat: string };

const get = (who: string, path: string) =>
  app.request(path, { headers: { cookie: cookies[who] as string } });
const read = async <T>(who: string, path: string) => (await (await get(who, path)).json()) as T;
const post = (who: string, path: string, body: unknown = {}) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookies[who] as string },
    body: JSON.stringify(body),
  });
const lead = (who: string, id: number) => read<LeadCase>(who, `/api/leads/${id}`);
const file = (who: string, id: number, kind: string) => {
  const form = new FormData();
  form.set("kind", kind);
  form.set(
    "file",
    new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])], `${kind}.png`, {
      type: "image/png",
    }),
  );
  return app.request(`/api/leads/${id}/files`, {
    method: "POST",
    headers: { cookie: cookies[who] as string },
    body: form,
  });
};
const fieldOf = async (response: Response) => {
  const body = (await response.json()) as {
    error?: { field?: string; fields?: Record<string, string> };
  };
  return body.error?.field ?? Object.keys(body.error?.fields ?? {})[0];
};
async function addLead(body: object): Promise<number> {
  const response = await post("jane", "/api/leads", {
    source: "messenger",
    name: "Maria Santos",
    phone: "0917 555 1234",
    city: "Pasay",
    ...body,
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { id: number }).id;
}

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  await seedFixture(db);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["jane", "sarla", "ryan", "naresh", "marco", "fiona"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
  const catalogue = await read<Catalogue>("sarla", "/api/inventory/medicines");
  const row = catalogue.rows.find(
    (item) => item.prices.patient !== undefined && item.total >= 200 && item.rx,
  );
  if (!row)
    throw new Error("the fixture has no prescription medicine with a patient price and stock");
  medicine = { id: row.id, price: row.prices.patient as number, vat: row.vat };
});

describe("the rules", () => {
  it("takes VAT out of a 12% medicine and then 20% off for a senior or PWD", () => {
    expect(reliefPrice(1120, "vat12")).toBe(800);
    expect(reliefPrice(1000, "exempt")).toBe(800);
    const line = {
      medicineId: 1,
      medicine: "X",
      qty: 2,
      packSize: 1,
      listPrice: 1120,
      unitPrice: 1120,
      reason: null,
      vat: "vat12" as const,
      rx: true,
    };
    expect(quoteTotals([line], "senior")).toEqual({
      subtotal: 2240,
      relief: { vatRemoved: 240, discount: 400 },
      total: 1600,
    });
    expect(quoteTotals([line], "regular")).toEqual({ subtotal: 2240, relief: null, total: 2240 });
  });

  it("reads where a case stands from its quotation, papers and order", () => {
    const base = {
      road: "regular" as const,
      agency: null,
      lost: false,
      quoted: true,
      rxNeeded: true,
      files: new Set<never>(),
      glApplied: false,
      glLetter: false,
      glVerified: false,
      glProblem: null,
      claimSent: false,
      order: null,
    };
    expect(roadStepOf({ ...base, quoted: false })).toBe("new");
    expect(roadStepOf(base)).toBe("rx_wait");
    expect(roadStepOf({ ...base, files: new Set(["rx"]) as never })).toBe("ready");
    expect(roadStepOf({ ...base, road: "senior", files: new Set(["rx"]) as never })).toBe("papers");
    expect(roadStepOf({ ...base, road: "gl" })).toBe("apply");
    expect(roadStepOf({ ...base, road: "gl", glApplied: true })).toBe("waiting");
    expect(
      roadStepOf({
        ...base,
        order: {
          status: "completed",
          paid: false,
          flagReason: null,
          courier: null,
          tracking: null,
          rider: null,
          method: null,
          advance: false,
          proof: false,
        },
      }),
    ).toBe("payment");
    expect(roadStepOf({ ...base, lost: true })).toBe("lost");
    // Senior citizens and PWDs: one road, one ID (either card) since 18 Nov.
    expect(papersFor("pwd", false)).toEqual(["osca_id"]);
    expect(papersFor("senior", true)).toEqual(["rx", "osca_id"]);
    expect(deskStepOf("verify")).toBe("papers");
  });
});

describe("a regular enquiry", () => {
  it("goes from the chat to an order on the same line, the agent as its MedRep", async () => {
    const id = await addLead({ request: "Asking for her mother's tablets" });
    let now = await lead("jane", id);
    expect(now.lead).toMatchObject({
      code: expect.stringMatching(/^ENQ-\d{5}$/),
      sourceLabel: "Messenger",
      assignedName: "Jane",
      road: "regular",
    });
    expect(now.step.value).toBe("new");
    expect(now.next).toBe("Answer the enquiry and save the quotation");
    expect((await get("ryan", `/api/leads/${id}`)).status).toBe(403);

    const quote = (lines: object[]) => post("jane", `/api/leads/${id}/quote`, { lines });
    expect(
      await fieldOf(
        await quote([{ medicineId: medicine.id, qty: 30, unitPrice: medicine.price - 100 }]),
      ),
    ).toBe("lines.0.reason");
    expect((await quote([{ medicineId: medicine.id, qty: 30 }])).status).toBe(200);
    now = await lead("jane", id);
    expect(now.step.value).toBe("rx_wait");
    expect(now.next).toBe("Add the prescription photo");
    expect(now.quote.total).toBe(30 * medicine.price);
    expect(now.can).toMatchObject({ placeOrder: false, placeWhy: "Add the prescription photo" });
    expect((await post("jane", `/api/leads/${id}/order`)).status).toBe(409);

    expect((await file("jane", id, "rx")).status).toBe(200);
    now = await lead("jane", id);
    expect(now.step.value).toBe("ready");
    expect(now.papers.find((paper) => paper.kind === "rx")?.files).toHaveLength(1);

    // A patient pays cash on delivery or in advance: the agent says which.
    expect(await fieldOf(await post("jane", `/api/leads/${id}/order`))).toBe("pay");
    const placed = await post("jane", `/api/leads/${id}/order`, { pay: "advance" });
    expect(placed.status).toBe(200);
    const orderId = ((await placed.json()) as { id: number }).id;
    // Management approves every order (Aryan, 17 Nov); approved, it goes to Finance with its
    // invoice, then to Dispatch (Aryan, 18 Nov: a case's order too).
    expect((await post("sarla", `/api/orders/${orderId}/approve`)).status).toBe(200);
    let order = await read<OrderDetail>("sarla", `/api/orders/${orderId}`);
    expect(order.order.status).toBe("finance_check");
    expect((await lead("jane", id)).next).toBe("With Finance: they confirm the advance payment (put the slip on the order)");
    expect((await post("marco", `/api/dispatch/orders/${orderId}/pack`, {})).status).toBe(409);
    // Finance sees the money and lets it go to Dispatch.
    const confirmed = await post("fiona", `/api/finance/orders/${orderId}/confirm-payment`, {
      amount: 30 * medicine.price,
      method: "ewallet",
      reference: "GC-5521",
      paidOn: todayManila(),
      checked: true,
    });
    expect(confirmed.status, await confirmed.clone().text()).toBe(200);
    order = await read<OrderDetail>("sarla", `/api/orders/${orderId}`);
    expect(order.order).toMatchObject({
      status: "ready_for_dispatch",
      medrep: "Jane",
      channel: "ONLINE",
      customer: "Maria Santos",
      receiver: "Maria Santos",
      deliveryAddress: "Pasay",
    });
    expect(order.papers.map((paper) => paper.kind)).toEqual(["prescription"]);
    expect(order.order.customerReview).toBe("to_review");
    now = await lead("jane", id);
    expect(now.step.value).toBe("ordered");
    expect(now.next).toBe("Dispatch packs it");
    expect(now.order?.code).toBe(order.order.code);
    expect(now.order?.trail.check).toMatchObject({ state: "approved", by: "Sarla" });
    expect(now.order?.trail.invoice).toMatchObject({ total: 30 * medicine.price, balance: 0 });
    expect(now.can).toMatchObject({ pay: false, deliver: false });
    expect((await post("jane", `/api/leads/${id}/order`)).status).toBe(409);
    // The road is fixed once the order is placed.
    expect(
      await fieldOf(
        await post("jane", `/api/leads/${id}`, {
          source: "messenger",
          name: "Maria Santos",
          road: "senior",
        }),
      ),
    ).toBe("road");
    expect(now.order).toMatchObject({ terms: "advance", proof: false });
    // Approved once: nothing more for Management.
    expect((await post("sarla", `/api/orders/${orderId}/approve`)).status).toBe(409);
    // A second enquiry on the same number finds the patient already on file.
    const again = await addLead({ name: "Maria Santos", source: "phone" });
    await post("jane", `/api/leads/${again}/quote`, {
      lines: [{ medicineId: medicine.id, qty: 10 }],
    });
    await file("jane", again, "rx");
    const second = (
      (await (await post("jane", `/api/leads/${again}/order`, { pay: "cod" })).json()) as {
        id: number;
      }
    ).id;
    const secondOrder = await read<OrderDetail>("sarla", `/api/orders/${second}`);
    expect(secondOrder.order.customerId).toBe(order.order.customerId);
    expect(secondOrder.order.paymentTerms).toBe("cod");
  });
});

describe("the other roads", () => {
  it("a senior citizen's order takes the VAT out and 20% off, which Management isn't asked about", async () => {
    const id = await addLead({ name: "Lolo Pedro", road: "senior", phone: "0918 222 3333" });
    await post("jane", `/api/leads/${id}/quote`, { lines: [{ medicineId: medicine.id, qty: 10 }] });
    await file("jane", id, "rx");
    let now = await lead("jane", id);
    expect(now.step.value).toBe("papers");
    expect(now.next).toBe("Add the senior citizen or PWD ID");
    expect(now.quote.relief).not.toBeNull();
    await file("jane", id, "osca_id");
    now = await lead("jane", id);
    expect(now.step.value).toBe("ready");
    const orderId = (
      (await (await post("jane", `/api/leads/${id}/order`, { pay: "cod" })).json()) as {
        id: number;
      }
    ).id;
    const order = await read<OrderDetail>("sarla", `/api/orders/${orderId}`);
    expect(order.order.total).toBe(now.quote.total);
    expect(order.items[0]?.unitPrice).toBe(
      reliefPrice(medicine.price, medicine.vat as "vat12" | "exempt"),
    );
    expect(order.findings.map((finding) => finding.kind)).not.toContain("price");
    expect(order.order.relief?.kind).toBe("senior");
  });

  it("a PWD walks the same road with their PWD ID, and the order says PWD", async () => {
    const id = await addLead({ name: "Mang Tonyo", road: "senior", phone: "0918 444 5555" });
    await post("jane", `/api/leads/${id}/quote`, { lines: [{ medicineId: medicine.id, qty: 2 }] });
    await file("jane", id, "rx");
    await file("jane", id, "pwd_id");
    const now = await lead("jane", id);
    expect(now.step.value).toBe("ready");
    const slot = now.papers.find((paper) => paper.kind === "osca_id");
    expect(slot).toMatchObject({ label: "Senior citizen or PWD ID", needed: true });
    expect(slot?.files).toHaveLength(1);
    expect(now.papers.some((paper) => paper.kind === "pwd_id")).toBe(false);
    const placed = await post("jane", `/api/leads/${id}/order`, { pay: "cod" });
    const orderId = ((await placed.json()) as { id: number }).id;
    expect((await read<OrderDetail>("sarla", `/api/orders/${orderId}`)).order.relief?.kind).toBe("pwd");
  });

  it("a guarantee letter walks the application and the letter, and the agency is billed", async () => {
    const id = await addLead({
      name: "Ana Reyes",
      road: "gl",
      agency: "pcso",
      phone: "0919 777 8888",
    });
    await post("jane", `/api/leads/${id}/quote`, { lines: [{ medicineId: medicine.id, qty: 5 }] });
    expect((await lead("jane", id)).next).toBe(
      "Send the quotation and record the PCSO application",
    );
    expect((await post("jane", `/api/leads/${id}/quote-sent`, { via: "messenger" })).status).toBe(
      200,
    );
    expect((await post("jane", `/api/leads/${id}/gl`, { appliedOn: todayManila() })).status).toBe(
      200,
    );
    expect((await lead("jane", id)).step.value).toBe("waiting");
    expect(
      await fieldOf(
        await post("jane", `/api/leads/${id}/gl`, {
          appliedOn: todayManila(),
          letterNo: "PCSO-123",
          amount: medicine.price * 5,
          verify: true,
        }),
      ),
    ).toBe("verify");
    await file("jane", id, "gl_letter");
    expect((await lead("jane", id)).step.value).toBe("verify");
    expect(
      (
        await post("jane", `/api/leads/${id}/gl`, {
          appliedOn: todayManila(),
          letterNo: "PCSO-123",
          amount: medicine.price * 5,
          letterOn: todayManila(),
          verify: true,
        })
      ).status,
    ).toBe(200);
    let now = await lead("jane", id);
    expect(now.step.value).toBe("papers");
    await file("jane", id, "rx");
    await file("jane", id, "valid_id");
    await file("jane", id, "med_cert");
    now = await lead("jane", id);
    expect(now.step.value).toBe("ready");
    expect(now.journey.gl).toMatchObject({ state: "verified" });
    const orderId = (
      (await (await post("jane", `/api/leads/${id}/order`)).json()) as { id: number }
    ).id;
    // Management approves it; Finance looks at the agency's bill (60 days), then it goes to
    // Dispatch with the agency's invoice.
    expect((await post("sarla", `/api/orders/${orderId}/approve`)).status).toBe(200);
    expect((await read<OrderDetail>("sarla", `/api/orders/${orderId}`)).order.status).toBe("ready_for_invoice");
    expect((await post("fiona", `/api/finance/orders/${orderId}/invoice`, {})).status).toBe(200);
    const order = await read<OrderDetail>("sarla", `/api/orders/${orderId}`);
    expect(order.order).toMatchObject({
      status: "ready_for_dispatch",
      paymentTerms: "days",
      paymentDays: 60,
    });
    expect(order.papers.map((paper) => paper.kind).sort()).toEqual([
      "gl",
      "med_cert",
      "prescription",
      "valid_id",
    ]);
  });

  it("changing the road before the order asks for the quotation again", async () => {
    const id = await addLead({ name: "Jose Cruz", phone: "0920 111 2222" });
    await post("jane", `/api/leads/${id}/quote`, { lines: [{ medicineId: medicine.id, qty: 3 }] });
    expect(
      (
        await post("jane", `/api/leads/${id}`, {
          source: "messenger",
          name: "Jose Cruz",
          road: "pwd",
        })
      ).status,
    ).toBe(200);
    const now = await lead("jane", id);
    expect(now.quote.stale).toBe(true);
    expect(now.step.value).toBe("new");
  });
});

describe("the agent takes the case to Paid", () => {
  it("sends a discount to Management, then Dispatch packs, ships and hands it over, and Finance takes the money (as every channel's, 19 Nov)", async () => {
    const id = await addLead({ name: "Lito Reyes", phone: "0917 222 3333", source: "phone" });
    // Quoted below the patient price: that is the agent's discount, so Management checks it.
    const below = medicine.price - 1000;
    expect(
      (
        await post("jane", `/api/leads/${id}/quote`, {
          lines: [{ medicineId: medicine.id, qty: 4, unitPrice: below, reason: "Loyal patient" }],
        })
      ).status,
    ).toBe(200);
    await file("jane", id, "rx");
    const orderId = (
      (await (await post("jane", `/api/leads/${id}/order`, { pay: "cod" })).json()) as {
        id: number;
      }
    ).id;
    let now = await lead("jane", id);
    expect(now.order).toMatchObject({ status: "pending_approval" });
    expect(now.order?.trail.finance.state).toBe("later");
    expect(now.order?.trail.check.state).toBe("waiting");
    // Checked as every channel's order (19 Nov): the discount, the patient's ID not on it yet, and
    // a new customer for Management to check.
    expect(now.order?.trail.check.reasons).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Loyal patient"),
        expect.stringContaining("patient's ID"),
        expect.stringContaining("New customer"),
      ]),
    );
    expect(now.order?.trail.invoice).toBeNull();
    expect(now.next).toBe("With Management for a check");
    expect(now.order?.trail.check.reasons).toHaveLength(3);
    expect((await post("marco", `/api/dispatch/orders/${orderId}/pack`, {})).status).toBe(409);

    // Sarla passes it: it goes to Finance with its invoice (cash on delivery: Finance looks at
    // what the customer owes), then to Dispatch.
    expect((await post("sarla", `/api/orders/${orderId}/approve`)).status).toBe(200);
    now = await lead("jane", id);
    expect(now.order?.status).toBe("ready_for_invoice");
    expect(now.next).toBe("With Finance for a check");
    expect(now.order?.trail.finance.state).toBe("waiting");
    expect((await post("fiona", `/api/finance/orders/${orderId}/invoice`, {})).status).toBe(200);
    now = await lead("jane", id);
    expect(now.order?.status).toBe("ready_for_dispatch");
    expect(now.order?.trail.finance).toMatchObject({ state: "done", by: "Fiona" });
    expect(now.order?.trail.check).toMatchObject({ state: "approved", by: "Sarla" });
    expect(now.order?.trail.invoice).toMatchObject({ total: 4 * below, balance: 4 * below });
    // Cash on delivery: no money before the handover.
    expect(now.can).toMatchObject({ pay: false, deliver: false });

    expect((await post("marco", `/api/dispatch/orders/${orderId}/pack`, {})).status).toBe(200);
    expect(
      (
        await post("marco", `/api/dispatch/orders/${orderId}/ship`, {
          method: "courier",
          addressChecked: true,
          courier: "LBC",
          tracking: "7781 2290",
        })
      ).status,
    ).toBe(200);
    now = await lead("jane", id);
    expect(now.next).toBe("On the way with LBC · 7781 2290: Dispatch marks it delivered");
    expect(now.order?.trail.packed).toMatchObject({ by: "Marco" });
    expect(now.order?.trail.packed?.batches[0]).toContain("batch");
    expect(now.order?.trail.shipped).toMatchObject({ how: "LBC · 7781 2290", by: "Marco" });
    expect(now.can).toMatchObject({ deliver: false, pay: false });

    // Neither a MedRep nor the agent hands it over: Dispatch does, as for every channel.
    for (const who of ["ryan", "jane"])
      expect(
        (
          await post(who, `/api/dispatch/orders/${orderId}/deliver`, {
            receivedBy: "Lito",
            deliveredOn: todayManila(),
          })
        ).status,
      ).toBe(403);
    // Dispatch keeps the signed receipt on the order, then hands it over.
    expect(await attachReceipt(app, cookies.marco as string, orderId)).toBe(200);
    expect(
      (
        await post("marco", `/api/dispatch/orders/${orderId}/deliver`, {
          receivedBy: "Lito Reyes",
          deliveredOn: todayManila(),
        })
      ).status,
    ).toBe(200);
    now = await lead("jane", id);
    expect(now.step.value).toBe("payment");
    expect(now.next).toBe("Delivered: Finance records the payment when it comes in");
    expect(now.order?.trail.delivered).toMatchObject({ receivedBy: "Lito Reyes", by: "Marco" });
    expect(now.can).toMatchObject({ pay: false, deliver: false });

    // Finance records the money; neither a MedRep nor the agent.
    const invoiceId = now.order?.trail.invoice?.id as number;
    // Delivered and unpaid: on Finance's Payments to collect, due now.
    const owed = await read<{ rows: { invoiceId: number; state: string; deliveredOn: string | null }[] }>(
      "fiona",
      "/api/finance/owed/invoices",
    );
    expect(owed.rows.find((row) => row.invoiceId === invoiceId)).toMatchObject({ state: "due" });
    for (const who of ["ryan", "jane"])
      expect(
        (
          await post(who, `/api/invoices/${invoiceId}/payments`, {
            amount: 4 * below,
            method: "cash",
            paidOn: todayManila(),
          })
        ).status,
      ).toBe(403);
    expect(
      (
        await post("fiona", `/api/invoices/${invoiceId}/payments`, {
          amount: 4 * below,
          method: "cash",
          reference: "LBC remit 22",
          paidOn: todayManila(),
        })
      ).status,
    ).toBe(200);
    now = await lead("jane", id);
    expect(now.step.value).toBe("done");
    expect(now.order?.trail.payments).toEqual([
      expect.objectContaining({
        amount: 4 * below,
        methodLabel: "Cash",
        reference: "LBC remit 22",
        by: "Fiona",
      }),
    ]);
    expect(now.can.pay).toBe(false);
    // Paid in full: Collected, with who marked it.
    const collected = await read<{ rows: { invoiceId: number; by: string; terms: string; delivered: boolean }[] }>(
      "fiona",
      "/api/finance/collected",
    );
    expect(collected.rows.find((row) => row.invoiceId === invoiceId)).toMatchObject({
      by: "Fiona",
      terms: "COD",
      delivered: true,
    });
  });

  it("keeps the agent off a MedRep's order", async () => {
    // Ryan's own order for a hospital goes through Management and Finance as before.
    const hospital = (
      (await (
        await post("sarla", "/api/customers", {
          kind: "hospital",
          name: "Pasay General Hospital",
          city: "Pasay",
        })
      ).json()) as { id: number }
    ).id;
    const placed = await post("ryan", "/api/orders", {
      customerId: hospital,
      items: [{ medicineId: medicine.id, qty: 1, priceKind: "patient" }],
    });
    expect(placed.status, await placed.clone().text()).toBe(200);
    const orderId = ((await placed.json()) as { id: number }).id;
    expect((await read<OrderDetail>("sarla", `/api/orders/${orderId}`)).order.status).toBe(
      "pending_approval",
    );
    expect((await post("sarla", `/api/orders/${orderId}/approve`)).status).toBe(200);
    expect((await read<OrderDetail>("sarla", `/api/orders/${orderId}`)).order.status).not.toBe(
      "ready_for_dispatch",
    );
    expect(
      (
        await post("jane", `/api/dispatch/orders/${orderId}/deliver`, {
          receivedBy: "X",
          deliveredOn: todayManila(),
        })
      ).status,
    ).not.toBe(200);
  });
});

describe("the desk", () => {
  it("counts its queues and steps, finds by number, and keeps a lost case's history", async () => {
    const id = await addLead({ name: "Lost Cause", phone: "0921 999 0000" });
    expect((await post("jane", `/api/leads/${id}/lost`, {})).status).toBe(400);
    expect(
      (await post("jane", `/api/leads/${id}/lost`, { reason: "Bought elsewhere" })).status,
    ).toBe(200);
    const lost = await read<LeadDesk>("jane", "/api/leads?queue=lost");
    expect(lost.cards.find((card) => card.id === id)).toMatchObject({
      lost: true,
      lostReason: "Bought elsewhere",
      deskStep: "lost",
    });
    const active = await read<LeadDesk>("jane", "/api/leads");
    expect(active.queue).toBe("active");
    expect(active.cards.some((card) => card.id === id)).toBe(false);
    expect(active.counts.all).toBe(active.counts.active + active.counts.done + active.counts.lost);
    expect(Object.values(active.steps).reduce((sum, n) => sum + n, 0)).toBe(active.counts.active);
    expect(
      (await read<LeadDesk>("jane", "/api/leads?queue=all&q=9990000")).cards.map((card) => card.id),
    ).toEqual([id]);
    expect(
      (await read<LeadDesk>("jane", "/api/leads?queue=deliver")).cards.every(
        (card) => card.step.value === "ordered",
      ),
    ).toBe(true);
    // Needs you: the cases waiting on the agent's word, as many as its count says.
    const needs = await read<LeadDesk>("jane", "/api/leads?queue=attention");
    expect(needs.queue).toBe("attention");
    expect(needs.cards.length).toBe(active.counts.attention);
    expect(
      needs.cards.every(
        (card) =>
          card.awaitingReply ||
          card.next.startsWith("Order on hold") ||
          card.next.startsWith("Order sent back"),
      ),
    ).toBe(true);
    expect((await post("jane", `/api/leads/${id}/reopen`)).status).toBe(200);
    expect((await lead("jane", id)).lead.state).toBe("open");
    expect((await read<LeadDesk>("naresh", "/api/leads")).can.add).toBe(false);
    expect((await post("naresh", "/api/leads", { source: "phone", name: "X" })).status).toBe(403);
    expect((await get("ryan", "/api/leads")).status).toBe(403);
    const timeline = (await lead("jane", id)).events.map((event) => event.message);
    expect(timeline).toContain("Closed as lost: Bought elsewhere.");
    expect(timeline[0]).toBe("Reopened.");
  });
});
