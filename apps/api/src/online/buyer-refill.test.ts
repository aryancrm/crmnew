// Aryan, 19 Nov: a business that orders through the Online desk is Online's entry (priced from its
// own list, no prescription asked, the agent as its MedRep); every desk sees an Online order as
// one ("Online · Messenger"); and the next refill is set by the one who took the order, counts
// until the customer's next order, and lists them in Refills due.

import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedFixture } from "../inventory/fixture";
import { todayManila } from "../inventory/rules";
import { seedDemo } from "../seed";
import type { Catalogue, CustomerPage, LeadCase, OrderBoard, OrderDetail, Reorders } from "../types";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};

const read = async <T>(who: string, path: string) =>
  (await (await app.request(path, { headers: { cookie: cookies[who] as string } })).json()) as T;
const post = (who: string, path: string, body: unknown = {}) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookies[who] as string },
    body: JSON.stringify(body),
  });
const plus = (days: number) => {
  const date = new Date(`${todayManila()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const file = (id: number, kind: string) => {
  const form = new FormData();
  form.set("kind", kind);
  form.set("file", new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])], `${kind}.png`, { type: "image/png" }));
  return app.request(`/api/leads/${id}/files`, { method: "POST", headers: { cookie: cookies.jane as string }, body: form });
};

let medicine: { id: number; patient: number; drugstore: number };

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  await seedFixture(db);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["jane", "sarla", "ryan"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
  const catalogue = await read<Catalogue>("sarla", "/api/inventory/medicines");
  const row = catalogue.rows.find((one) => one.prices.patient !== undefined && one.total >= 200);
  if (!row) throw new Error("the fixture has no medicine with a patient price and stock");
  // Its drugstore price, below the patient's (the fixture keeps only some lists).
  const patient = row.prices.patient as number;
  const drugstore = Math.round(patient * 0.8);
  await db.execute(
    sql`insert into medicine_price (medicine_id, buyer_type, amount) values (${row.id}, 'drugstore', ${drugstore})
      on conflict (medicine_id, buyer_type) do update set amount = excluded.amount`,
  );
  medicine = { id: row.id, patient, drugstore };
});

describe("a business buying through the Online desk", () => {
  it("is priced from its own list, needs no prescription, and is Online's order", async () => {
    const made = await post("jane", "/api/leads", { source: "facebook", name: "Corner Drugstore", phone: "0917 555 7788", city: "Pasig" });
    const id = ((await made.json()) as { id: number }).id;
    // A drugstore on file, picked by name.
    const [store] = await rows<{ id: number; name: string }>(
      db,
      sql`insert into customer (kind, name, city, payment_terms, payment_days, review, added_by)
        values ('drugstore', 'Buyer Test Pharmacy', 'Pasig', 'days', 30, 'ok', (select id from person where email = 'sarla@2mg.test'))
        returning id::int as id, name`,
    );
    const found = await read<{ id: number; name: string }[]>("jane", `/api/leads/${id}/buyers?q=buyer test`);
    expect(found.map((one) => one.id)).toContain(store?.id);
    expect((await post("jane", `/api/leads/${id}/buyer`, { kind: "drugstore", customerId: store?.id })).status).toBe(200);
    // A business can't take the senior / PWD road.
    expect((await post("jane", `/api/leads/${id}`, { source: "facebook", name: "Corner Drugstore", road: "senior" })).status).toBe(400);

    expect((await post("jane", `/api/leads/${id}/quote`, { lines: [{ medicineId: medicine.id, qty: 10 }] })).status).toBe(200);
    const quoted = await read<LeadCase>("jane", `/api/leads/${id}`);
    expect(quoted.lead.buyerKind).toBe("drugstore");
    expect(quoted.lead.buyerTerms).toBe("30 days");
    expect(quoted.quote.lines[0]?.listPrice).toBe(medicine.drugstore);
    // No prescription for a business: ready to order on the quotation alone.
    expect(quoted.next).toBe("Place the order");

    const placed = await post("jane", `/api/leads/${id}/order`, { pay: "terms" });
    expect(placed.status, await placed.clone().text()).toBe(200);
    const orderId = ((await placed.json()) as { id: number }).id;
    const order = await read<OrderDetail>("sarla", `/api/orders/${orderId}`);
    expect(order.order.customerId).toBe(store?.id);
    expect(order.order.medrep).toBe("Jane");
    expect(order.order.via).toMatchObject({ source: "Facebook" });
    expect(order.items.find((item) => !item.free)?.unitPrice).toBe(medicine.drugstore);
    const [money] = await rows<{ terms: string; days: number | null; channel: string | null }>(
      db,
      sql`select o.payment_terms as terms, o.payment_days::int as days, ch.code as channel from sales_order o
        left join channel ch on ch.id = o.channel_id where o.id = ${orderId}`,
    );
    // Its own terms on file, and the agent's channel: Online's entry.
    expect(money).toMatchObject({ terms: "days", days: 30 });
    expect(money?.channel).toBe((await rows<{ code: string }>(db, sql`select ch.code from person p join channel ch on ch.id = p.channel_id where p.email = 'jane@2mg.test'`))[0]?.code);
    // Management's board marks it as Online's.
    const board = await read<OrderBoard>("sarla", "/api/orders/board?desk=management&tab=all");
    expect(board.cards.find((card) => card.id === orderId)?.via?.code).toBe(quoted.lead.code);
  });

  it("adds a new business as that kind when none on file is picked, for Management to check", async () => {
    const made = await post("jane", "/api/leads", { source: "messenger", name: "New Clinic Buyer", phone: "0917 555 3344", city: "Taguig" });
    const id = ((await made.json()) as { id: number }).id;
    expect((await post("jane", `/api/leads/${id}/buyer`, { kind: "hospital" })).status).toBe(200);
    expect((await post("jane", `/api/leads/${id}/quote`, { lines: [{ medicineId: medicine.id, qty: 2 }] })).status).toBe(200);
    expect((await post("jane", `/api/leads/${id}/order`, { pay: "terms" })).status).toBe(400);
    const placed = await post("jane", `/api/leads/${id}/order`, { pay: "cod" });
    expect(placed.status, await placed.clone().text()).toBe(200);
    const [customer] = await rows<{ kind: string; review: string; name: string }>(
      db,
      sql`select c.kind, c.review, c.name from lead l join customer c on c.id = l.customer_id where l.id = ${id}`,
    );
    expect(customer).toMatchObject({ kind: "hospital", review: "to_review", name: "New Clinic Buyer" });
  });
});

describe("the next refill", () => {
  it("is set by the agent after the order, counts until the next order, and shows in Refills due", async () => {
    const made = await post("jane", "/api/leads", { source: "messenger", name: "Refill Patient", phone: "0917 555 9911", city: "Pasay" });
    const id = ((await made.json()) as { id: number }).id;
    expect((await post("jane", `/api/leads/${id}/quote`, { lines: [{ medicineId: medicine.id, qty: 2 }] })).status).toBe(200);
    // Not before the order: the refill is kept on the customer.
    expect((await post("jane", `/api/leads/${id}/refill`, { on: plus(30) })).status).toBe(409);
    expect(await file(id, "rx")).toHaveProperty("status", 200);
    const placed = await post("jane", `/api/leads/${id}/order`, { pay: "cod" });
    expect(placed.status, await placed.clone().text()).toBe(200);

    // The suggestion before anyone sets it: the last order plus the usual gap (28 days for one order).
    const before = (await read<LeadCase>("jane", `/api/leads/${id}`)).refill;
    expect(before).toMatchObject({ setOn: null, suggestedOn: plus(28), nextOn: plus(28), canSet: true });
    // A past day is refused; tomorrow is kept with who set it, and lists them as due in two days.
    expect((await post("jane", `/api/leads/${id}/refill`, { on: plus(-1) })).status).toBe(400);
    expect((await post("jane", `/api/leads/${id}/refill`, { on: plus(1), note: "30 tablets, 1 a day" })).status).toBe(200);
    const after = await read<LeadCase>("jane", `/api/leads/${id}`);
    expect(after.refill).toMatchObject({ setOn: plus(1), nextOn: plus(1), setBy: "Jane", note: "30 tablets, 1 a day" });
    expect(after.events.some((event) => event.message.startsWith("Next refill set for"))).toBe(true);
    const soon = await read<Reorders>("jane", "/api/my/reorders?state=soon");
    expect(soon.rows.find((row) => row.customerId === after.lead.customerId)).toMatchObject({ setOn: plus(1), setBy: "Jane", expectedOn: plus(1) });
    expect(await read<{ soon: number }>("jane", "/api/my/refills-waiting")).toMatchObject({ soon: 1 });

    // On the customer's page too; a MedRep who can't see the customer can't set it.
    const page = await read<CustomerPage>("jane", `/api/customers/${after.lead.customerId}/page`);
    expect(page.refill.setOn).toBe(plus(1));
    expect((await post("ryan", `/api/customers/${after.lead.customerId}/refill`, { on: plus(5) })).status).toBe(404);

    // Cleared: the usual gap counts again.
    expect((await post("jane", `/api/customers/${after.lead.customerId}/refill`, { on: null })).status).toBe(200);
    expect((await read<CustomerPage>("jane", `/api/customers/${after.lead.customerId}/page`)).refill).toMatchObject({ setOn: null, nextOn: plus(28) });
  });
});
