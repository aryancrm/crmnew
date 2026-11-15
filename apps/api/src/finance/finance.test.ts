import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase } from "../db/index";
import { migrate } from "../db/migrate";
import { seedFixture } from "../inventory/fixture";
import { todayManila } from "../inventory/rules";
import { seedDemo } from "../seed";
import type {
  Catalogue,
  InvoiceDetail,
  InvoiceList,
  OrderBoard,
  OrderDashboard,
  OrderDetail,
  OwedList,
  PaymentList,
  RefundList,
} from "../types";
import { addDays, invoiceState, vatSplit } from "./rules";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
let hospital: number;
let creditHospital: number;
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
const order = (who: string, id: number) => read<OrderDetail>(who, `/api/orders/${id}`);
const line = (qty = 10) => ({ medicineId: medicine.id, qty, priceKind: "hospital" });
const upload = (who: string, id: number) => {
  const form = new FormData();
  form.set("kind", "payment_proof");
  form.set(
    "file",
    new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])], "slip.png", {
      type: "image/png",
    }),
  );
  return app.request(`/api/orders/${id}/papers`, {
    method: "POST",
    headers: { cookie: cookies[who] as string },
    body: form,
  });
};

/** Ryan places an order and Sarla approves it: it then waits for Finance. */
async function approved(customerId: number, more: object = {}): Promise<number> {
  const placed = (await (
    await post("ryan", "/api/orders", { customerId, items: [line()], ...more })
  ).json()) as { id: number };
  expect((await post("sarla", `/api/orders/${placed.id}/approve`)).status).toBe(200);
  return placed.id;
}
const confirm = (who: string, id: number, body: object) =>
  post(who, `/api/finance/orders/${id}/confirm-payment`, body);
const pay = (total: number, more: object = {}) => ({
  amount: total,
  method: "bank",
  reference: "BDO-1",
  paidOn: todayManila(),
  checked: true,
  ...more,
});
const fieldOf = async (response: Response) => {
  const body = (await response.json()) as {
    error?: { field?: string; fields?: Record<string, string> };
  };
  return body.error?.field ?? Object.keys(body.error?.fields ?? {})[0];
};

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  await seedFixture(db);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["ryan", "sarla", "fiona", "naresh", "marco"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
  const add = async (body: object) =>
    ((await (await post("sarla", "/api/customers", body)).json()) as { id: number }).id;
  hospital = await add({ kind: "hospital", name: "San Juan de Dios Hospital", city: "Pasay" });
  creditHospital = await add({
    kind: "hospital",
    name: "Olivarez General Hospital",
    city: "Parañaque",
    paymentTerms: "days",
    paymentDays: 30,
  });
  const catalogue = await read<Catalogue>("sarla", "/api/inventory/medicines");
  const row = catalogue.rows.find(
    (item) => item.prices.hospital !== undefined && item.total >= 500,
  );
  if (!row) throw new Error("the fixture has no medicine with a hospital price and stock");
  medicine = { id: row.id, price: row.prices.hospital as number };
});

describe("the rules", () => {
  it("splits the VAT inside 12% lines and keeps the parts adding up", () => {
    const split = vatSplit([
      { amount: 11_200, vat: "vat12" },
      { amount: 5_000, vat: "exempt" },
      { amount: 1, vat: "vat12" },
    ]);
    expect(split).toEqual({ vatable: 10_001, vat: 1_200, exempt: 5_000, zeroRated: 0 });
    expect(split.vatable + split.vat + split.exempt + split.zeroRated).toBe(16_201);
  });

  it("says how an unpaid invoice stands, and cash on delivery is never late before delivery", () => {
    const open = {
      status: "open" as const,
      terms: "days" as const,
      paid: 0,
      total: 100,
      delivered: true,
    };
    expect(invoiceState({ ...open, dueOn: "2026-11-01" }, "2026-11-13").word).toBe(
      "Overdue by 12 days",
    );
    expect(invoiceState({ ...open, dueOn: "2026-11-13" }, "2026-11-13").word).toBe("Due today");
    expect(invoiceState({ ...open, dueOn: "2026-11-14", paid: 40 }, "2026-11-13").word).toBe(
      "Partly paid · Due in 1 day",
    );
    expect(
      invoiceState({ ...open, terms: "cod", delivered: false, dueOn: "2026-11-01" }, "2026-11-13")
        .word,
    ).toBe("Collect on delivery");
  });
});

describe("an advance order", () => {
  it("waits for Finance after Management, and Finance confirms the money it has checked", async () => {
    const id = await approved(hospital);
    const waiting = await order("fiona", id);
    expect(waiting.order.status).toBe("finance_check");
    expect(waiting.can).toMatchObject({
      confirm_payment: true,
      make_invoice: false,
      hold: true,
      approve: false,
    });

    // On Finance's board, with what is missing.
    const board = await read<OrderBoard>("fiona", "/api/orders/board");
    expect(board.desk).toBe("finance");
    expect(board.tab).toBe("needs");
    const card = board.cards.find((item) => item.id === id);
    expect(card?.next).toBe("Decide: pays in advance, no proof of payment yet");
    expect(board.counts.needs).toBe(board.cards.length);

    const total = waiting.order.total;
    expect(await fieldOf(await confirm("fiona", id, pay(total, { checked: false })))).toBe(
      "checked",
    );
    expect(await fieldOf(await confirm("fiona", id, pay(total, { reference: "" })))).toBe(
      "reference",
    );
    expect(await fieldOf(await confirm("fiona", id, pay(total + 1)))).toBe("amount");
    expect(
      await fieldOf(await confirm("fiona", id, pay(total, { paidOn: addDays(todayManila(), 1) }))),
    ).toBe("paidOn");
    expect((await confirm("ryan", id, pay(total))).status).toBe(403);
    expect((await confirm("sarla", id, pay(total))).status).toBe(403);

    expect((await upload("ryan", id)).status).toBe(200);
    expect((await confirm("fiona", id, pay(total, { reference: "" }))).status).toBe(200);
    const done = await order("ryan", id);
    expect(done.order.status).toBe("ready_for_dispatch");
    expect(done.money.invoice).toMatchObject({
      total,
      paid: total,
      balance: 0,
      status: "paid",
      terms: "advance",
    });
    expect(done.money.invoice?.code).toMatch(/^2MG-SI-\d{6}$/);
    expect(done.money.invoice?.state.word).toBe("Paid");
    expect(done.money.payments[0]).toMatchObject({
      amount: total,
      method: "bank",
      methodLabel: "Bank transfer",
      proofId: expect.any(Number),
    });
    const at = (key: string) => done.stages.find((stage) => stage.key === key)?.at;
    expect(at("finance_verified")).not.toBeNull();
    expect(at("invoiced")).not.toBeNull();
    expect(at("paid")).not.toBeNull();
    // Twice is refused: it has moved on.
    expect((await confirm("fiona", id, pay(total))).status).toBe(409);
  });

  it("is held by Finance for want of the proof, and the proof sends it back to Finance", async () => {
    const id = await approved(hospital);
    expect((await post("fiona", `/api/orders/${id}/hold`, {})).status).toBe(400);
    expect(
      (await post("fiona", `/api/orders/${id}/hold`, { reason: "No deposit slip yet" })).status,
    ).toBe(200);
    const held = await order("ryan", id);
    expect(held.order).toMatchObject({
      status: "on_hold",
      heldFrom: "finance_check",
      flagReason: "No deposit slip yet",
    });
    const mine = await read<{ cards: { id: number; next: string }[] }>("ryan", "/api/orders/mine");
    expect(mine.cards.find((item) => item.id === id)?.next).toBe(
      "On hold by Finance: No deposit slip yet Add the proof of payment and it goes back to Finance.",
    );
    expect((await order("fiona", id)).can.resume).toBe(true);
    expect((await upload("ryan", id)).status).toBe(200);
    const back = await order("fiona", id);
    expect(back.order.status).toBe("finance_check");
    expect(back.events.at(-1)?.message).toBe("Proof of payment added: back with Finance to check.");
  });

  it("Management's own order skips the queue, ships from the default warehouse and waits for Finance", async () => {
    const placed = (await (
      await post("sarla", "/api/orders", { customerId: hospital, items: [line()] })
    ).json()) as { id: number };
    const own = await order("fiona", placed.id);
    expect(own.order.status).toBe("finance_check");
    expect(own.order.warehouse).not.toBeNull();
  });

  it("Finance holds only at its own step and takes off only its own holds", async () => {
    const placed = (await (
      await post("ryan", "/api/orders", { customerId: hospital, items: [line()] })
    ).json()) as { id: number };
    expect((await order("fiona", placed.id)).can).toMatchObject({ approve: false, hold: false });
    expect((await post("fiona", `/api/orders/${placed.id}/approve`)).status).toBe(409);
    expect(
      (await post("sarla", `/api/orders/${placed.id}/hold`, { reason: "Ask Ms. Van" })).status,
    ).toBe(200);
    expect((await order("fiona", placed.id)).can.resume).toBe(false);
  });
});

describe("a credit order", () => {
  it("gets its invoice from Finance, due its days later, and goes on", async () => {
    const id = await approved(creditHospital);
    expect((await order("fiona", id)).order.status).toBe("ready_for_invoice");
    const board = await read<OrderBoard>("fiona", "/api/orders/board?status=ready_for_invoice");
    expect(board.cards.find((card) => card.id === id)?.next).toBe(
      "Make the invoice (pays in 30 days)",
    );
    expect((await post("ryan", `/api/finance/orders/${id}/invoice`)).status).toBe(403);
    expect((await post("fiona", `/api/finance/orders/${id}/invoice`)).status).toBe(200);
    const done = await order("fiona", id);
    expect(done.order.status).toBe("ready_for_dispatch");
    const invoice = done.money.invoice;
    expect(invoice).toMatchObject({
      terms: "days",
      paid: 0,
      status: "open",
      dueOn: addDays(todayManila(), 30),
    });
    expect(invoice?.state.word).toBe("Due in 30 days");
    const detail = await read<InvoiceDetail>("fiona", `/api/invoices/${invoice?.id}`);
    const { vatable, vat, exempt, zeroRated, total } = detail.invoice;
    expect(vatable + vat + exempt + zeroRated).toBe(total);
    expect(detail.items.reduce((sum, item) => sum + item.amount, 0)).toBe(total);
    expect(detail.can).toMatchObject({ pay: true, refund: false });
    // The MedRep reads the invoice of his own order, and may not record money on it.
    const his = await read<InvoiceDetail>("ryan", `/api/invoices/${invoice?.id}`);
    expect(his.invoice.total).toBe(total);
    expect(his.can).toMatchObject({ pay: false, refund: false });
  });

  it("moves to the Finance step new terms take, and takes cash on delivery only after delivery", async () => {
    const id = await approved(creditHospital);
    expect((await order("fiona", id)).order.status).toBe("ready_for_invoice");
    const terms = (paymentTerm: string) =>
      post("sarla", `/api/orders/${id}/details`, { paymentTerm });
    // Now paid in advance: Finance checks the money first; back to credit, the invoice again.
    expect((await terms("Advanced Payment")).status).toBe(200);
    expect((await order("fiona", id)).order.status).toBe("finance_check");
    expect((await terms("COD")).status).toBe(200);
    expect((await order("fiona", id)).order.status).toBe("ready_for_invoice");
    // Cash on delivery: no money recorded before the goods arrive.
    await post("fiona", `/api/finance/orders/${id}/invoice`);
    const invoice = (await order("fiona", id)).money.invoice;
    if (!invoice) throw new Error("no invoice");
    expect((await read<InvoiceDetail>("fiona", `/api/invoices/${invoice.id}`)).can.pay).toBe(false);
    const early = await post("fiona", `/api/invoices/${invoice.id}/payments`, {
      amount: invoice.total,
      method: "cash",
      reference: "COD-1",
      paidOn: todayManila(),
    });
    expect(early.status).toBe(409);
  });

  it("takes its money later, part by part; a mistaken payment is taken off with why", async () => {
    const id = await approved(creditHospital);
    await post("fiona", `/api/finance/orders/${id}/invoice`);
    const invoice = (await order("fiona", id)).money.invoice;
    if (!invoice) throw new Error("no invoice");
    const half = Math.floor(invoice.total / 2);
    const paying = (amount: number) =>
      post("fiona", `/api/invoices/${invoice.id}/payments`, {
        amount,
        method: "check",
        reference: "CHK-9",
        paidOn: todayManila(),
      });
    expect((await paying(half)).status).toBe(200);
    let now = (await order("ryan", id)).money.invoice;
    expect(now).toMatchObject({ paid: half, balance: invoice.total - half, status: "open" });
    expect(now?.state.word).toBe("Partly paid · Due in 30 days");
    expect(await fieldOf(await paying(invoice.total))).toBe("amount");
    expect((await paying(invoice.total - half)).status).toBe(200);
    let detail = await order("fiona", id);
    expect(detail.money.invoice?.status).toBe("paid");
    expect(detail.stages.find((stage) => stage.key === "paid")?.at).not.toBeNull();
    expect((await paying(1)).status).toBe(409);

    const last = detail.money.payments.at(-1);
    expect((await post("fiona", `/api/payments/${last?.id}/remove`, {})).status).toBe(400);
    expect(
      (await post("ryan", `/api/payments/${last?.id}/remove`, { reason: "Typed twice" })).status,
    ).toBe(403);
    expect(
      (await post("fiona", `/api/payments/${last?.id}/remove`, { reason: "The check bounced" }))
        .status,
    ).toBe(200);
    detail = await order("fiona", id);
    now = detail.money.invoice;
    expect(now).toMatchObject({ status: "open", paid: half });
    expect(detail.stages.find((stage) => stage.key === "paid")?.at).toBeNull();
    expect(detail.money.payments.find((row) => row.id === last?.id)).toMatchObject({
      active: false,
      removedReason: "The check bounced",
    });
  });
});

describe("what customers owe", () => {
  it("lists unpaid invoices by how late they are, and Management is told before approving", async () => {
    const id = await approved(creditHospital);
    await post("fiona", `/api/finance/orders/${id}/invoice`);
    const invoice = (await order("fiona", id)).money.invoice;
    // Made and delivered 75 days ago: 45 days overdue (credit counts from delivery).
    await db.execute(
      sql`update invoice set issued_on = issued_on - 75, due_on = due_on - 75 where id = ${invoice?.id}`,
    );
    await db.execute(
      sql`update sales_order set status = 'completed', delivered_on = current_date - 75 where id = ${id}`,
    );
    const owed = await read<OwedList>("fiona", "/api/finance/owed");
    const row = owed.rows.find((item) => item.customerId === creditHospital);
    // Terms are the open invoices' own: this customer also has an earlier test's COD invoice open.
    expect(row).toMatchObject({ terms: "Mixed", oldestDays: 45 });
    expect(row?.d60).toBe(invoice?.total);
    expect(row?.overdue).toBe(
      (row?.d30 ?? 0) + (row?.d60 ?? 0) + (row?.d90 ?? 0) + (row?.older ?? 0),
    );
    expect(
      (row?.current ?? 0) +
        (row?.d30 ?? 0) +
        (row?.d60 ?? 0) +
        (row?.d90 ?? 0) +
        (row?.older ?? 0) +
        (row?.onDelivery ?? 0),
    ).toBe(row?.total);
    expect(owed.rows[0]?.overdue).toBeGreaterThan(0);
    expect((await get("ryan", "/api/finance/owed")).status).toBe(403);

    // The next order for that customer tells Management what is overdue.
    await db.execute(sql`update customer set credit_limit = 100 where id = ${creditHospital}`);
    const placed = (await (
      await post("ryan", "/api/orders", { customerId: creditHospital, items: [line()] })
    ).json()) as { id: number };
    const kinds = (await order("sarla", placed.id)).findings.map((finding) => finding.kind);
    expect(kinds).toEqual(expect.arrayContaining(["owes", "credit"]));
    const card = (await read<OrderBoard>("sarla", "/api/orders/board")).cards.find(
      (item) => item.id === placed.id,
    );
    expect(card?.findings.find((finding) => finding.kind === "owes")?.short).toBe(
      "Overdue 45 days",
    );
    await db.execute(sql`update customer set credit_limit = null where id = ${creditHospital}`);
  });
});

describe("a cancelled order Finance took money for", () => {
  it("cancels its invoice and lists the money to give back until it is given back", async () => {
    const id = await approved(hospital);
    const total = (await order("fiona", id)).order.total;
    await confirm("fiona", id, pay(total));
    expect(
      (await post("sarla", `/api/orders/${id}/cancel`, { reason: "Hospital bought elsewhere" }))
        .status,
    ).toBe(200);
    const after = await order("fiona", id);
    expect(after.money.invoice).toMatchObject({ status: "cancelled", balance: 0, paid: total });
    const refunds = await read<RefundList>("fiona", "/api/finance/refunds");
    const owed = refunds.owed.find((row) => row.orderId === id);
    expect(owed).toMatchObject({
      received: total,
      refunded: 0,
      owed: total,
      reason: "Hospital bought elsewhere",
    });
    const invoiceId = owed?.invoiceId as number;
    const refund = (amount: number) =>
      post("fiona", `/api/invoices/${invoiceId}/refunds`, {
        amount,
        method: "bank",
        reference: "BDO-R1",
        refundedOn: todayManila(),
      });
    expect(await fieldOf(await refund(total + 1))).toBe("amount");
    expect((await refund(total)).status).toBe(200);
    expect((await refund(1)).status).toBe(409);
    const later = await read<RefundList>("fiona", "/api/finance/refunds");
    expect(later.owed.find((row) => row.orderId === id)).toBeUndefined();
    expect(later.done[0]).toMatchObject({
      amount: total,
      orderId: id,
      methodLabel: "Bank transfer",
    });
    // Its payment can't be taken off now: the money went back by refund.
    expect(
      (await post("fiona", `/api/payments/${after.money.payments[0]?.id}/remove`, { reason: "x" }))
        .status,
    ).toBe(409);
  });
});

describe("numbers and lists", () => {
  it("numbers each company's invoices in its own series, without gaps", async () => {
    const before = await read<InvoiceList>("fiona", "/api/invoices");
    const getmeds = await approved(creditHospital, { invoiceFrom: "getmeds" });
    await post("fiona", `/api/finance/orders/${getmeds}/invoice`);
    const first = (await order("fiona", getmeds)).money.invoice?.code;
    const again = await approved(creditHospital, { invoiceFrom: "getmeds" });
    await post("fiona", `/api/finance/orders/${again}/invoice`);
    expect(first).toBe("INV-000001");
    expect((await order("fiona", again)).money.invoice?.code).toBe("INV-000002");
    const after = await read<InvoiceList>("fiona", "/api/invoices");
    expect(after.counts.all).toBe(before.counts.all + 2);
    expect(after.rows[0]?.invoiceFromLabel).toBe("GetMeds Philippines Inc.");
  });

  it("lists invoices by tab, payments by month, and keeps them from those who don't keep the books", async () => {
    const list = await read<InvoiceList>("fiona", "/api/invoices");
    expect(list.counts.all).toBe(list.counts.unpaid + list.counts.paid + list.counts.cancelled);
    const overdue = await read<InvoiceList>("fiona", "/api/invoices?tab=overdue");
    expect(overdue.rows.every((row) => row.state.tone === "bad")).toBe(true);
    expect(overdue.rows.length).toBe(overdue.counts.overdue);
    const narrowed = await read<InvoiceList>("fiona", `/api/invoices?customer=${creditHospital}`);
    expect(narrowed.customer?.name).toBe("Olivarez General Hospital");
    expect(narrowed.rows.every((row) => row.customerId === creditHospital)).toBe(true);
    const payments = await read<PaymentList>("fiona", "/api/payments");
    expect(payments.sum).toBe(payments.rows.reduce((sum, row) => sum + row.amount, 0));
    expect(payments.rows.every((row) => row.active)).toBe(true);
    expect((await read<InvoiceList>("naresh", "/api/invoices")).counts.all).toBe(list.counts.all);
    expect((await get("ryan", "/api/invoices")).status).toBe(403);
    expect((await get("marco", "/api/payments")).status).toBe(403);
  });

  it("counts Finance's work for its menu", async () => {
    const id = await approved(hospital);
    const dashboard = await read<OrderDashboard>("fiona", "/api/orders/dashboard");
    const board = await read<OrderBoard>("fiona", "/api/orders/board");
    expect(dashboard.attention.toConfirm + dashboard.attention.toInvoice).toBe(board.counts.needs);
    expect(dashboard.attention.toConfirm).toBeGreaterThan(0);
    expect((await read<OrderDashboard>("ryan", "/api/orders/dashboard")).attention.toConfirm).toBe(
      0,
    );
    expect(board.cards.some((card) => card.id === id)).toBe(true);
  });
});
