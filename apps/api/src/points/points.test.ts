import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedFixture } from "../inventory/fixture";
import { todayManila } from "../inventory/rules";
import { type Cursor, type Mailbox, type OutgoingMail, useMailTransport } from "../online/email";
import { seedDemo } from "../seed";
import { attachReceipt } from "../testing/receipt";
import type { Catalogue, LeadCase, OrderDetail, PointsAccountDetail, PointsList } from "../types";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
let medicine: { id: number; price: number };
const outbox: OutgoingMail[] = [];

useMailTransport({
  async check() {
    return { error: null, cursor: { uidValidity: "1", lastUid: 0 } };
  },
  async read(_m: Mailbox, cursor: Cursor | null) {
    return { cursor: cursor ?? { uidValidity: "1", lastUid: 0 }, sources: [] };
  },
  async send(_m: Mailbox, mail: OutgoingMail) {
    outbox.push(mail);
  },
});

const get = (who: string, path: string) =>
  app.request(path, { headers: { cookie: cookies[who] as string } });
const read = async <T>(who: string, path: string) => (await (await get(who, path)).json()) as T;
const post = (who: string, path: string, body: unknown = {}) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookies[who] as string },
    body: JSON.stringify(body),
  });
const file = (id: number, kind: string) => {
  const form = new FormData();
  form.set("kind", kind);
  form.set(
    "file",
    new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2])], `${kind}.png`, {
      type: "image/png",
    }),
  );
  return app.request(`/api/leads/${id}/files`, {
    method: "POST",
    headers: { cookie: cookies.jane as string },
    body: form,
  });
};

/** A ready case on a phone: quoted, prescription on file. */
async function readyCase(phone: string, extra: object = {}, qty = 2): Promise<number> {
  const made = await post("jane", "/api/leads", {
    source: "phone",
    name: "Rosa Mendoza",
    phone,
    email: "rosa@mail.test",
    ...extra,
  });
  const id = ((await made.json()) as { id: number }).id;
  expect(
    (await post("jane", `/api/leads/${id}/quote`, { lines: [{ medicineId: medicine.id, qty }] }))
      .status,
  ).toBe(200);
  await file(id, "rx");
  if ((extra as { road?: string }).road === "senior") await file(id, "osca_id");
  return id;
}

/** Placed (no check needed: it goes straight to Dispatch with its invoice) and delivered; answers
 *  the order and its invoice. */
async function delivered(leadId: number): Promise<{ orderId: number; invoiceId: number }> {
  const placed = await post("jane", `/api/leads/${leadId}/order`, { pay: "cod" });
  expect(placed.status).toBe(200);
  const orderId = ((await placed.json()) as { id: number }).id;
  // Management approves every order (Aryan, 17 Nov).
  expect((await post("sarla", `/api/orders/${orderId}/approve`)).status).toBe(200);
  const [invoice] = await rows<{ id: number }>(
    db,
    sql`select id::int as id from invoice where order_id = ${orderId}`,
  );
  await db.execute(
    sql`update sales_order set status = 'shipped', courier = 'LBC' where id = ${orderId}`,
  );
  await attachReceipt(app, cookies.marco as string, orderId);
  expect(
    (
      await post("marco", `/api/dispatch/orders/${orderId}/deliver`, {
        receivedBy: "Rosa",
        deliveredOn: todayManila(),
      })
    ).status,
  ).toBe(200);
  return { orderId, invoiceId: invoice?.id as number };
}
const pay = (invoiceId: number, amount: number) =>
  post("fiona", `/api/invoices/${invoiceId}/payments`, {
    amount,
    method: "cash",
    paidOn: todayManila(),
  });
const balanceOf = async (phoneKey: string) =>
  (
    await rows<{ balance: number }>(
      db,
      sql`select balance from points_account where phone_key = ${phoneKey}`,
    )
  )[0]?.balance ?? null;

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  await seedFixture(db);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["jane", "sarla", "naresh", "fiona", "marco"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
  const catalogue = await read<Catalogue>("sarla", "/api/inventory/medicines");
  const row = catalogue.rows.find(
    (item) => item.prices.patient !== undefined && item.total >= 200 && item.vat === "exempt",
  );
  if (!row) throw new Error("no medicine to sell");
  medicine = { id: row.id, price: row.prices.patient as number };
});

afterAll(() => useMailTransport(null));

describe("earning", () => {
  it("earns nothing while the program is off, then 10% of the money actually paid once it is on", async () => {
    const off = await delivered(await readyCase("0917 111 2222"));
    expect((await pay(off.invoiceId, 2 * medicine.price)).status).toBe(200);
    expect(await balanceOf("9171112222")).toBeNull();

    expect(
      (await post("jane", "/api/settings/points", { enabled: true, rateBps: 1000 })).status,
    ).toBe(403);
    expect(
      (await post("naresh", "/api/settings/points", { enabled: true, rateBps: 1000 })).status,
    ).toBe(200);

    const { orderId, invoiceId } = await delivered(await readyCase("0917 333 4444"));
    // Delivered but not paid: nothing yet.
    expect((await balanceOf("9173334444")) ?? 0).toBe(0);
    expect((await pay(invoiceId, medicine.price)).status).toBe(200);
    expect(await balanceOf("9173334444")).toBe(Math.floor(medicine.price / 1000));
    expect((await pay(invoiceId, medicine.price)).status).toBe(200);
    expect(await balanceOf("9173334444")).toBe(Math.floor((2 * medicine.price) / 1000));
    // A payment taken off takes its points back; the same money again earns them once.
    const [payment] = await rows<{ id: number }>(
      db,
      sql`select p.id::int as id from payment p join invoice i on i.id = p.invoice_id where i.order_id = ${orderId} order by p.id desc limit 1`,
    );
    expect(
      (await post("fiona", `/api/payments/${payment?.id}/remove`, { reason: "Recorded twice" }))
        .status,
    ).toBe(200);
    expect(await balanceOf("9173334444")).toBe(Math.floor(medicine.price / 1000));
    expect((await pay(invoiceId, medicine.price)).status).toBe(200);
    expect(await balanceOf("9173334444")).toBe(Math.floor((2 * medicine.price) / 1000));
    const entries = await rows(db, sql`select id from points_entry where order_id = ${orderId}`);
    expect(entries).toHaveLength(4);
  });

  it("lists the accounts and lets the Admin or the CEO adjust one, never below zero", async () => {
    const list = await read<PointsList>("jane", "/api/points?q=3334444");
    expect(list.accounts).toHaveLength(1);
    expect(list.accounts[0]?.phone).toMatch(/4444$/);
    expect(list.can.adjust).toBe(false);
    const id = list.accounts[0]?.id as number;
    expect(
      (await post("jane", `/api/points/${id}/adjust`, { points: 10, reason: "Goodwill" })).status,
    ).toBe(403);
    expect(
      (await post("naresh", `/api/points/${id}/adjust`, { points: 10, reason: "Goodwill" })).status,
    ).toBe(200);
    expect(
      (await post("naresh", `/api/points/${id}/adjust`, { points: -100000, reason: "Oops" }))
        .status,
    ).toBe(400);
    const detail = await read<PointsAccountDetail>("naresh", `/api/points/${id}`);
    expect(detail.entries[0]).toMatchObject({
      kind: "adjust",
      points: 10,
      note: "Goodwill",
      by: "Naresh",
    });
  });
});

describe("using points", () => {
  it("takes the points off the order and pays them on its invoice; a cancel gives them back", async () => {
    const before = (await balanceOf("9173334444")) as number;
    const id = await readyCase("0917 333 4444", {}, 1);
    let lead = await read<LeadCase>("jane", `/api/leads/${id}`);
    expect(lead.points).toMatchObject({ balance: before, why: null, toUse: 0 });
    expect((await post("jane", `/api/leads/${id}/points`, { points: before + 1 })).status).toBe(
      400,
    );
    const set = await post("jane", `/api/leads/${id}/points`, { points: 20 });
    expect(set.status, await set.clone().text()).toBe(200);
    lead = await read<LeadCase>("jane", `/api/leads/${id}`);
    expect(lead.points.toUse).toBe(20);

    const placed = await post("jane", `/api/leads/${id}/order`, { pay: "cod" });
    const orderId = ((await placed.json()) as { id: number }).id;
    expect(await balanceOf("9173334444")).toBe(before - 20);
    // Management approves it; its invoice is made then, the points paid on it.
    expect((await post("sarla", `/api/orders/${orderId}/approve`)).status).toBe(200);
    const detail = await read<OrderDetail>("sarla", `/api/orders/${orderId}`);
    expect(detail.order.pointsUsed).toBe(20);
    const [invoice] = await rows<{ paid: number; total: number }>(
      db,
      sql`select paid::int as paid, total::int as total from invoice where order_id = ${orderId}`,
    );
    expect(invoice).toMatchObject({ paid: 2000, total: medicine.price });

    expect(
      (
        await post("sarla", `/api/orders/${orderId}/cancel`, {
          reason: "Customer changed their mind",
        })
      ).status,
    ).toBe(200);
    expect(await balanceOf("9173334444")).toBe(before);
    // The points went back as points: nothing is owed back as money.
    const [owed] = await rows<{ refunded: number }>(
      db,
      sql`select refunded::int as refunded from invoice where order_id = ${orderId}`,
    );
    expect(owed?.refunded).toBe(0);
  });

  it("never combines points with the senior / PWD discount", async () => {
    const id = await readyCase("0917 333 4444", { road: "senior" }, 1);
    const lead = await read<LeadCase>("jane", `/api/leads/${id}`);
    expect(lead.points.why).toContain("senior");
    expect((await post("jane", `/api/leads/${id}/points`, { points: 5 })).status).toBe(409);
  });
});

describe("the quotation", () => {
  it("opens as a PDF, goes out as a link for 30 days, and by email attached", async () => {
    const id = await readyCase("0917 555 6666", {}, 3);
    const pdf = await get("jane", `/api/leads/${id}/quotation.pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(new TextDecoder().decode((await pdf.arrayBuffer()).slice(0, 5))).toBe("%PDF-");

    const link = (await (await post("jane", `/api/leads/${id}/quotation-link`)).json()) as {
      path: string;
    };
    const opened = await app.request(link.path);
    expect(opened.status).toBe(200);
    expect((await app.request("/api/public/quotation/not-a-token")).status).toBe(404);
    await db.execute(sql`update quotation_link set expires_at = now() - interval '1 day'`);
    expect((await app.request(link.path)).status).toBe(404);

    expect(
      (
        await post("naresh", "/api/channels/email", {
          address: "info@2mg.test",
          password: "x",
          imapHost: "imap.gmail.com",
          imapPort: 993,
          smtpHost: "smtp.gmail.com",
          smtpPort: 465,
        })
      ).status,
    ).toBe(200);
    expect((await post("jane", `/api/leads/${id}/quotation-send`, { via: "email" })).status).toBe(
      200,
    );
    const mail = outbox.at(-1);
    expect(mail?.to).toBe("rosa@mail.test");
    expect(mail?.attachments?.[0]?.contentType).toBe("application/pdf");
    expect(mail?.subject).toContain("Your quotation from 2MG Inc.");
    const lead = await read<LeadCase>("jane", `/api/leads/${id}`);
    expect(lead.lead).toMatchObject({ quoteSentVia: "email", chatChannel: "email" });
  });
});
