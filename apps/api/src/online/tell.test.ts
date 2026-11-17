// The customer hears of each step of their order, as in the old CRM: confirmed, on the way,
// delivered, payment received. A hospital's PO and a patient's case alike, by email on its own
// once per step; and "Send to customer" for WhatsApp, Viber, SMS and Messenger.

import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedFixture } from "../inventory/fixture";
import { todayManila } from "../inventory/rules";
import { seedDemo } from "../seed";
import { attachReceipt } from "../testing/receipt";
import type { Catalogue, CustomerUpdate, LeadCase, OrderDetail } from "../types";
import { type Mailbox, type OutgoingMail, useMailTransport } from "./email";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
let hospital = 0;
let hospitalMedicine = 0;
let patientMedicine = 0;

const outbox: OutgoingMail[] = [];
useMailTransport({
  async check(_mailbox: Mailbox) {
    return { error: null, cursor: { uidValidity: "1", lastUid: 0 } };
  },
  async read() {
    return { cursor: { uidValidity: "1", lastUid: 0 }, sources: [] };
  },
  async send(_mailbox: Mailbox, mail: OutgoingMail) {
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
const ok = async (response: Response) => {
  expect(response.status, await response.clone().text()).toBe(200);
  return response;
};

/** The emails sent to one address, once the step's email (sent after the answer) has gone. */
async function mailTo(to: string, count: number): Promise<OutgoingMail[]> {
  for (let tries = 0; tries < 100; tries++) {
    const found = outbox.filter((mail) => mail.to === to);
    if (found.length >= count) return found;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return outbox.filter((mail) => mail.to === to);
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  await seedFixture(db);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["ryan", "sarla", "fiona", "marco", "jane", "naresh"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
  await ok(
    await post("naresh", "/api/channels/email", {
      address: "info@2mg.test",
      password: "app-password",
      imapHost: "imap.gmail.com",
      imapPort: 993,
      smtpHost: "smtp.gmail.com",
      smtpPort: 465,
    }),
  );
  hospital = (
    (await (
      await ok(
        await post("sarla", "/api/customers", {
          kind: "hospital",
          name: "Pasay General Hospital",
          city: "Pasay",
          email: "accounts@pasaygeneral.test",
          phone: "0917 111 2222",
          paymentTerms: "cod",
        }),
      )
    ).json()) as { id: number }
  ).id;
  const catalogue = await read<Catalogue>("sarla", "/api/inventory/medicines");
  hospitalMedicine =
    catalogue.rows.find((item) => item.prices.hospital !== undefined && item.total >= 100)?.id ?? 0;
  patientMedicine =
    catalogue.rows.find((item) => item.prices.patient !== undefined && item.total >= 100 && item.rx)
      ?.id ?? 0;
  expect(hospitalMedicine && patientMedicine).toBeTruthy();
});

describe("a hospital's order", () => {
  let orderId = 0;
  const to = "accounts@pasaygeneral.test";

  it("emails the hospital when it is confirmed, by its name, once", async () => {
    const placed = await ok(
      await post("ryan", "/api/orders", {
        customerId: hospital,
        items: [{ medicineId: hospitalMedicine, qty: 5, priceKind: "hospital" }],
        checks: { management: false, finance: false },
      }),
    );
    orderId = ((await placed.json()) as { id: number }).id;
    // A MedRep's order always waits for Management (Aryan, 17 Nov), whatever the switch says;
    // Management approves it straight to Dispatch.
    expect((await post("sarla", `/api/orders/${orderId}/approve`, { finance: false })).status).toBe(200);
    const order = await read<OrderDetail>("sarla", `/api/orders/${orderId}`);
    expect(order.order.status).toBe("ready_for_dispatch");
    const [mail] = await mailTo(to, 1);
    expect(mail?.subject).toBe(`Your order ${order.order.code} is confirmed`);
    expect(mail?.text).toContain("Good day, Pasay General Hospital!");
    expect(mail?.text).toContain(`We've confirmed your order ${order.order.code}.`);
    expect(mail?.text).toContain("Total: ₱");
    // Packing tells nobody; the confirmation never goes twice.
    await ok(await post("marco", `/api/dispatch/orders/${orderId}/pack`, {}));
    await settle();
    expect(outbox.filter((item) => item.to === to)).toHaveLength(1);
  });

  it("then on the way (with the courier), delivered and each payment", async () => {
    const code = (await read<OrderDetail>("sarla", `/api/orders/${orderId}`)).order.code;
    await ok(
      await post("marco", `/api/dispatch/orders/${orderId}/ship`, {
        method: "courier",
        courier: "LBC",
        tracking: "7781 2290",
      }),
    );
    let mails = await mailTo(to, 2);
    expect(mails[1]?.subject).toBe(`Your order ${code} is on the way`);
    expect(mails[1]?.text).toContain("Courier & tracking: LBC · 7781 2290");
    expect(mails[1]?.text).toContain("for payment on delivery");

    await attachReceipt(app, cookies.marco as string, orderId);
    await ok(
      await post("marco", `/api/dispatch/orders/${orderId}/deliver`, {
        receivedBy: "Nurse Joy",
        deliveredOn: todayManila(),
      }),
    );
    mails = await mailTo(to, 3);
    expect(mails[2]?.subject).toBe(`Delivered: order ${code}`);
    expect(mails[2]?.text).toContain("Balance to pay: ₱");

    const [invoice] = await rows<{ id: number; total: number }>(
      db,
      sql`select id::int as id, total::int as total from invoice where order_id = ${orderId}`,
    );
    const half = Math.floor((invoice?.total ?? 0) / 2);
    for (const reference of ["OR-1", "OR-2"])
      await ok(
        await post("fiona", `/api/invoices/${invoice?.id}/payments`, {
          amount: half,
          method: "cash",
          reference,
          paidOn: todayManila(),
        }),
      );
    mails = await mailTo(to, 5);
    expect(mails.slice(3).map((mail) => mail.subject)).toEqual([
      `Payment received for ${code}`,
      `Payment received for ${code}`,
    ]);
    expect(mails[4]?.text).toContain("Reference: OR-2");

    const events = (await read<OrderDetail>("sarla", `/api/orders/${orderId}`)).events.map(
      (event) => event.message,
    );
    expect(events).toContain("Emailed the customer: On the way");
    expect(
      events.filter((message) => message.startsWith("Emailed the customer: Payment received")),
    ).toHaveLength(2);
  });

  it("Send to customer: the newest step's words, emailed again or noted when sent by an app", async () => {
    const { update } = await read<{ update: CustomerUpdate }>(
      "ryan",
      `/api/orders/${orderId}/update`,
    );
    expect(update).toMatchObject({
      event: "paid",
      email: to,
      phone: "0917 111 2222",
      messenger: false,
    });
    expect(update.short).toContain("Thank you! We received your payment");
    expect(update.emailedAt).not.toBeNull();

    const before = outbox.length;
    await ok(await post("ryan", `/api/orders/${orderId}/update/email`));
    expect(outbox.length).toBe(before + 1);
    await ok(await post("ryan", `/api/orders/${orderId}/update/sent`, { via: "whatsapp" }));
    const events = (await read<OrderDetail>("sarla", `/api/orders/${orderId}`)).events.map(
      (event) => event.message,
    );
    expect(events).toContain("Sent to the customer by WhatsApp: Payment received");
    // Someone who can't see the order can't send it either.
    expect((await get("jane", `/api/orders/${orderId}/update`)).status).toBe(404);
  });

  it("a customer with no email: nothing goes on its own, and the button says why", async () => {
    const noEmail = (
      (await (
        await ok(
          await post("sarla", "/api/customers", {
            kind: "hospital",
            name: "Pasay Doctors Clinic",
            city: "Pasay",
            paymentTerms: "cod",
          }),
        )
      ).json()) as { id: number }
    ).id;
    const placed = await ok(
      await post("ryan", "/api/orders", {
        customerId: noEmail,
        items: [{ medicineId: hospitalMedicine, qty: 2, priceKind: "hospital" }],
        checks: { management: false, finance: false },
      }),
    );
    const id = ((await placed.json()) as { id: number }).id;
    expect((await post("sarla", `/api/orders/${id}/approve`, { finance: false })).status).toBe(200);
    const refused = await post("ryan", `/api/orders/${id}/update/email`);
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: { message: string } }).error.message).toContain(
      "no email",
    );
  });
});

describe("a patient's case", () => {
  it("emails the patient on the case's own conversation, greeting them by first name", async () => {
    const made = await ok(
      await post("jane", "/api/leads", {
        source: "phone",
        name: "Maria Santos",
        phone: "0917 555 1234",
        email: "maria@example.test",
        city: "Pasay",
      }),
    );
    const id = ((await made.json()) as { id: number }).id;
    await ok(
      await post("jane", `/api/leads/${id}/quote`, {
        lines: [{ medicineId: patientMedicine, qty: 2 }],
      }),
    );
    const form = new FormData();
    form.set("kind", "rx");
    form.set(
      "file",
      new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1])], "rx.png", {
        type: "image/png",
      }),
    );
    await ok(
      await app.request(`/api/leads/${id}/files`, {
        method: "POST",
        headers: { cookie: cookies.jane as string },
        body: form,
      }),
    );
    const placed = await ok(await post("jane", `/api/leads/${id}/order`, { pay: "cod" }));
    const orderId = ((await placed.json()) as { id: number }).id;
    const [mail] = await mailTo("maria@example.test", 1);
    expect(mail?.subject).toMatch(/is confirmed$/);
    expect(mail?.text).toContain("Good day, Maria!");
    // The email sits in the case's chat, and the case says it went.
    const now = await read<LeadCase>("jane", `/api/leads/${id}`);
    expect(JSON.stringify(now)).toContain("Emailed the customer: Order confirmed");
    const { update } = await read<{ update: CustomerUpdate }>(
      "jane",
      `/api/orders/${orderId}/update`,
    );
    expect(update.leadId).toBe(id);
  });
});
