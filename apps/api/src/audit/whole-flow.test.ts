// One order walked through every desk, as the people who work it, checking at each step that the
// screens that read it elsewhere still agree: stock (promised, free, on the shelf), what the
// customer owes, the MedRep's money to collect, the CEO's figures, Speed and search. Written after
// many fixes from separate audits, so a change in one place can't quietly break another.

import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedFixture } from "../inventory/fixture";
import { addDays, todayManila } from "../inventory/rules";
import { seedDemo } from "../seed";
import type {
  Catalogue,
  CeoHome,
  CustomerList,
  InvoiceDetail,
  OrderDetail,
  SearchResult,
  SpeedReport,
  TeamBoard,
  ToCollect,
} from "../types";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
const get = (who: string, path: string) =>
  app.request(path, { headers: { cookie: cookies[who] as string } });
const read = async <T>(who: string, path: string) => {
  const response = await get(who, path);
  expect(response.status, `${who} GET ${path}`).toBe(200);
  return (await response.json()) as T;
};
const send = (who: string, path: string, body: unknown = {}) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookies[who] as string },
    body: JSON.stringify(body),
  });
const ok = async (who: string, path: string, body: unknown = {}) => {
  const response = await send(who, path, body);
  expect(response.status, `${who} POST ${path}: ${await response.clone().text()}`).toBe(200);
  return response;
};

let medicineId: number;
const today = todayManila();

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  await seedFixture(db);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["naresh", "sarla", "fiona", "marco", "ryan", "daniel"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
  // A medicine with a hospital price and plenty on the shelf.
  const [found] = await rows<{ id: number }>(
    db,
    sql`select m.id::int as id from medicine m join medicine_price p on p.medicine_id = m.id and p.buyer_type = 'hospital'
      where (select coalesce(sum(s.qty), 0) from stock s join batch b on b.id = s.batch_id
        where b.medicine_id = m.id and b.expires_on >= ${today}::date) >= 40
      order by m.id limit 1`,
  );
  medicineId = found?.id as number;
});

const stockOf = async () => {
  const list = await read<Catalogue>("ryan", "/api/inventory/medicines");
  const row = list.rows.find((one) => one.id === medicineId);
  return { total: row?.total ?? 0, promised: row?.promised ?? 0, free: row?.free ?? 0 };
};
const newHospital = async (name: string, terms: "days" | "cod") => {
  const response = await send("sarla", "/api/customers", {
    kind: "hospital",
    name,
    city: "Pasay",
    paymentTerms: terms,
    ...(terms === "days" ? { paymentDays: 30 } : {}),
  });
  expect(response.ok, await response.clone().text()).toBe(true);
  return ((await response.json()) as { id: number }).id;
};
const place = async (customerId: number, qty: number) => {
  const response = await ok("ryan", "/api/orders", {
    customerId,
    items: [{ medicineId, qty, priceKind: "hospital" }],
  });
  return ((await response.json()) as { id: number }).id;
};
const order = (who: string, id: number) => read<OrderDetail>(who, `/api/orders/${id}`);
const pack = (id: number) => ok("marco", `/api/dispatch/orders/${id}/pack`);
const ship = (id: number) =>
  ok("marco", `/api/dispatch/orders/${id}/ship`, { method: "rider", rider: "Jun" });
const deliver = (id: number) =>
  ok("marco", `/api/dispatch/orders/${id}/deliver`, {
    receivedBy: "Nurse Ana",
    deliveredOn: today,
  });

describe("one order through every desk", () => {
  it("a credit order: placed, approved, invoiced, packed, shipped, delivered, part paid", async () => {
    expect(medicineId).toBeTruthy();
    const customer = await newHospital("Flow Credit Hospital", "days");
    const before = await stockOf();

    // MedRep places it: still on the shelf, but promised.
    const id = await place(customer, 4);
    expect((await order("ryan", id)).order.status).toBe("pending_approval");
    let now = await stockOf();
    expect(now.total).toBe(before.total);
    expect(now.promised - before.promised).toBe(4);
    expect(now.free).toBe(Math.max(0, now.total - now.promised));

    // Management approves; a credit customer goes straight to its invoice.
    await ok("sarla", `/api/orders/${id}/approve`);
    expect((await order("fiona", id)).order.status).toBe("ready_for_invoice");
    await ok("fiona", `/api/finance/orders/${id}/invoice`);
    const invoiced = await order("fiona", id);
    expect(invoiced.order.status).toBe("ready_for_dispatch");
    const invoice = invoiced.money.invoice;
    if (!invoice) throw new Error("no invoice");
    // Owed, but not late before it is delivered.
    const owes = (await read<CustomerList>("sarla", "/api/customers?sort=owed")).rows.find(
      (row) => row.id === customer,
    );
    expect(owes).toMatchObject({ owed: invoice.total, overdue: 0 });

    // Dispatch packs: the pieces leave the shelf and are no longer promised.
    await pack(id);
    now = await stockOf();
    expect(before.total - now.total).toBe(4);
    expect(now.promised).toBe(before.promised);
    await ship(id);
    await deliver(id);
    const delivered = await order("ryan", id);
    expect(delivered.order.status).toBe("completed");
    // Credit counts its days from delivery.
    const detail = await read<InvoiceDetail>("fiona", `/api/invoices/${invoice.id}`);
    expect(detail.invoice.dueOn).toBe(addDays(today, 30));
    // The MedRep reads it, and sees it to collect, not due yet.
    expect((await read<InvoiceDetail>("ryan", `/api/invoices/${invoice.id}`)).can.pay).toBe(false);
    const collect = await read<ToCollect>("ryan", "/api/my/collect");
    expect(collect.rows.find((row) => row.invoiceId === invoice.id)?.daysLate).toBeLessThanOrEqual(
      0,
    );

    // Finance takes half; the balance follows everywhere.
    const half = Math.floor(invoice.total / 2);
    await ok("fiona", `/api/invoices/${invoice.id}/payments`, {
      amount: half,
      method: "check",
      reference: "CHK-FLOW",
      paidOn: today,
    });
    const after = await read<ToCollect>("ryan", "/api/my/collect");
    expect(after.rows.find((row) => row.invoiceId === invoice.id)?.balance).toBe(
      invoice.total - half,
    );

    // The CEO's, a lead's and the desks' screens all read it.
    const home = await read<CeoHome>("naresh", "/api/ceo/home");
    expect(home.sales.achieved).toBeGreaterThan(0);
    expect(home.money.owed).toBeGreaterThan(0);
    const thisMonth = await read<CeoHome>(
      "naresh",
      `/api/ceo/home?from=${today.slice(0, 8)}01&to=${today}`,
    );
    expect(thisMonth.sales.target).toBe(home.sales.target);
    await read<CeoHome>("naresh", `/api/ceo/home?from=${today}&to=${today}`);
    await read<TeamBoard>("daniel", "/api/team/board");
    await read<TeamBoard>("naresh", "/api/team/board");
    const speed = await read<SpeedReport>("naresh", "/api/speed");
    expect(speed.steps.length).toBeGreaterThan(0);
    const found = await read<SearchResult>("naresh", `/api/search?q=${delivered.order.code}`);
    expect(found.orders.map((one) => one.id)).toContain(id);
  });

  it("cash on delivery: no money before the delivery, all of it after", async () => {
    const customer = await newHospital("Flow COD Hospital", "cod");
    const id = await place(customer, 2);
    await ok("sarla", `/api/orders/${id}/approve`);
    expect((await order("fiona", id)).order.status).toBe("ready_for_invoice");
    await ok("fiona", `/api/finance/orders/${id}/invoice`);
    const invoice = (await order("fiona", id)).money.invoice;
    if (!invoice) throw new Error("no invoice");
    await pack(id);
    await ship(id);
    const pay = () =>
      send("fiona", `/api/invoices/${invoice.id}/payments`, {
        amount: invoice.total,
        method: "cash",
        reference: "COD-FLOW",
        paidOn: today,
      });
    expect((await pay()).status).toBe(409);
    await deliver(id);
    expect((await pay()).status).toBe(200);
    expect((await read<InvoiceDetail>("fiona", `/api/invoices/${invoice.id}`)).invoice.status).toBe(
      "paid",
    );
  });

  it("sent back, fixed, held, answered and approved: the order still reaches Finance", async () => {
    const customer = await newHospital("Flow Back Hospital", "days");
    const id = await place(customer, 1);
    await ok("sarla", `/api/orders/${id}/send_back`, { reason: "Wrong quantity?" });
    expect((await order("ryan", id)).order.status).toBe("draft");
    await ok("ryan", `/api/orders/${id}/resubmit`, { reason: "It is right, they asked for one" });
    expect((await order("sarla", id)).order.status).toBe("pending_approval");
    await ok("sarla", `/api/orders/${id}/hold`, { reason: "Which ward?" });
    await ok("ryan", `/api/orders/${id}/answer`, { reason: "Oncology" });
    await ok("sarla", `/api/orders/${id}/resume`);
    await ok("sarla", `/api/orders/${id}/approve`);
    expect((await order("fiona", id)).order.status).toBe("ready_for_invoice");
  });
});
