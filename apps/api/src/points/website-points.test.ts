// The 2MG website's own points calls, sent as it sends them (src/server/crm-wallet.ts there):
// the body with `site` (its address) and `sentAt`, signed `x-crm-signature: sha256=<hmac>`.

import { createHmac } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedFixture } from "../inventory/fixture";
import { todayManila } from "../inventory/rules";
import { useWebHttp } from "../online/websites";
import { seedDemo } from "../seed";
import { attachReceipt } from "../testing/receipt";

const PASSWORD = "test-password-1";
const SITE = "https://www.2mginc.com";
const MEMBER = { ref: "member-17", phone: "0917 123 4567" };
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
let secret = "";

useWebHttp({
  async file() {
    return null;
  },
  async post() {
    return { status: 200, json: { ok: true } };
  },
});

const post = (who: string, path: string, body: unknown = {}) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookies[who] as string },
    body: JSON.stringify(body),
  });
const sign = (body: string, key = secret) =>
  `sha256=${createHmac("sha256", key).update(body).digest("hex")}`;

/** One wallet call, as 2MG's walletRequest makes it. */
async function wallet(
  input: Record<string, unknown>,
  options: { key?: string; sentAt?: string; site?: string } = {},
) {
  const body = JSON.stringify({
    ...input,
    site: options.site ?? SITE,
    sentAt: options.sentAt ?? new Date().toISOString(),
  });
  const response = await app.request("/webhooks/store/2mg/points/manage", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-crm-event": "points.manage",
      "x-crm-delivery": crypto.randomUUID(),
      "x-crm-signature": sign(body, options.key),
    },
    body,
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

/** A website order event. */
function orderEvent(ref: string, extra: object = {}) {
  const body = JSON.stringify({
    event: "order.created",
    deliveryId: crypto.randomUUID(),
    sentAt: new Date().toISOString(),
    site: SITE,
    data: {
      orderNumber: ref,
      createdAt: new Date().toISOString(),
      status: "pending",
      customer: { name: "Lito Ramirez", phone: MEMBER.phone, address: "Pasay" },
      account: MEMBER,
      paymentMethod: "cod",
      items: [{ name: "Letrozole 2.5 mg", quantity: 1, unitPrice: 1400, lineTotal: 1400 }],
      subtotal: 1400,
      vatExempted: 0,
      discount: 0,
      deliveryFee: 0,
      total: 1400,
      ...extra,
    },
  });
  return app.request("/webhooks/store/2mg", {
    method: "POST",
    headers: { "content-type": "application/json", "x-crm-signature": sign(body) },
    body,
  });
}

/** The case of a website order, its Rx on file, placed as an order. */
async function placeFromWebsite(ref: string): Promise<number> {
  const [lead] = await rows<{ id: number }>(
    db,
    sql`select lead_id::int as id from web_order where ref = ${ref}`,
  );
  const leadId = lead?.id as number;
  const [file] = await rows<{ id: number }>(
    db,
    sql`select id::int as id from lead_file where lead_id = ${leadId} limit 1`,
  );
  if (!file) {
    const form = new FormData();
    form.set("kind", "rx");
    form.set(
      "file",
      new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1])], "rx.png", {
        type: "image/png",
      }),
    );
    await app.request(`/api/leads/${leadId}/files`, {
      method: "POST",
      headers: { cookie: cookies.jane as string },
      body: form,
    });
  }
  const placed = await post("jane", `/api/leads/${leadId}/order`);
  expect(placed.status, await placed.clone().text()).toBe(200);
  return ((await placed.json()) as { id: number }).id;
}

/** The case of a website order, placed, approved, invoiced, delivered and paid in cash. */
async function deliveredAndPaid(ref: string): Promise<number> {
  const orderId = await placeFromWebsite(ref);
  const [invoice] = await rows<{ id: number }>(
    db,
    sql`select id::int as id from invoice where order_id = ${orderId}`,
  );
  await db.execute(sql`update sales_order set status = 'shipped' where id = ${orderId}`);
  await attachReceipt(app, cookies.marco as string, orderId);
  expect(
    (
      await post("marco", `/api/dispatch/orders/${orderId}/deliver`, {
        receivedBy: "Lito",
        deliveredOn: todayManila(),
      })
    ).status,
  ).toBe(200);
  const [due] = await rows<{ due: number }>(
    db,
    sql`select (total - paid)::int as due from invoice where id = ${invoice?.id}`,
  );
  if (due?.due)
    expect(
      (
        await post("fiona", `/api/invoices/${invoice?.id}/payments`, {
          amount: due.due,
          method: "cash",
          paidOn: todayManila(),
        })
      ).status,
    ).toBe(200);
  return orderId;
}

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
  secret = (
    (await (
      await post("naresh", "/api/channels/website", { name: "2MG website", site: SITE })
    ).json()) as { secret: string }
  ).secret;
  expect(
    (await post("naresh", "/api/settings/points", { enabled: true, rateBps: 1000 })).status,
  ).toBe(200);
});

afterAll(() => useWebHttp(null));

describe("the 2MG website's points", () => {
  it("refuses a call it didn't sign, an old one, and a website that isn't connected", async () => {
    expect(
      (await wallet({ operation: "wallet_read", account: MEMBER }, { key: "wrong" })).status,
    ).toBe(401);
    expect(
      (
        await wallet(
          { operation: "wallet_read", account: MEMBER },
          { sentAt: new Date(Date.now() - 600_000).toISOString() },
        )
      ).status,
    ).toBe(400);
    expect(
      (await wallet({ operation: "wallet_read", account: MEMBER }, { site: "https://other.test" }))
        .status,
    ).toBe(404);
  });

  it("shows a member nothing for a typed number, then their points once their delivered order earned", async () => {
    // Not proved yet, and no points session: refused, never someone else's balance.
    expect((await wallet({ operation: "wallet_read", account: MEMBER })).status).toBe(400);
    expect((await orderEvent("2MG-100100")).status).toBe(200);
    await deliveredAndPaid("2MG-100100");
    const read = await wallet({ operation: "wallet_read", account: MEMBER });
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({
      enabled: true,
      ratePercent: 10,
      linked: true,
      phone: "+639171234567",
      account: { name: "Lito Ramirez", balance: 140, earned: 140 },
    });
    expect((read.body.orders as Record<string, unknown>[])[0]).toMatchObject({
      reference: "2MG-100100",
      site: "2mginc.com",
      status: "delivered",
      points: 140,
      total: 1400,
      eligiblePaid: 1400,
      agency: false,
    });
    expect((read.body.entries as Record<string, unknown>[])[0]).toMatchObject({
      kind: "earn",
      label: "Earned on a delivery",
      points: 140,
      reference: expect.stringMatching(/^2MG-/),
    });
  });

  it("opens the points session with the member's own sign-in, and connects the number's points (claimByNumber)", async () => {
    const wrongFirst = await wallet({
      operation: "auth_member",
      phone: "0918 000 0000",
      password: "secret-1",
    });
    expect(wrongFirst.body).toMatchObject({ token: null });
    const joined = await wallet({
      operation: "auth_member",
      phone: MEMBER.phone,
      password: "secret-1",
      name: "Lito Ramirez",
      claimByNumber: true,
    });
    expect(joined.body).toMatchObject({ linked: true, created: true, claimed: true });
    expect(joined.body.token).toMatch(/^[a-f0-9]{64}$/);
    const wrong = await wallet({
      operation: "auth_member",
      phone: MEMBER.phone,
      password: "not-it",
    });
    expect(wrong.body).toMatchObject({ token: null });
    const session = await wallet({ operation: "wallet_read", walletToken: joined.body.token });
    expect(session.body).toMatchObject({ linked: true, account: { balance: 140 } });
  });

  it("holds points at checkout only with the points session, once per checkout, and the order takes them", async () => {
    const token = (
      await wallet({ operation: "auth_member", phone: MEMBER.phone, password: "secret-1" })
    ).body.token as string;
    expect(
      (
        await wallet({
          operation: "reserve",
          account: MEMBER,
          requestKey: "order:2MG-100101",
          reference: "2MG-100101",
          maximum: 50,
        })
      ).status,
    ).toBe(400);
    const held = await wallet({
      operation: "reserve",
      account: MEMBER,
      walletToken: token,
      requestKey: "order:2MG-100101",
      reference: "2MG-100101",
      maximum: 50,
    });
    expect(held.status).toBe(200);
    expect(held.body).toMatchObject({ points: 50, reference: "2MG-100101", state: "reserved" });
    expect(held.body.id).toMatch(/^[0-9a-f-]{36}$/);
    const again = await wallet({
      operation: "reserve",
      account: MEMBER,
      walletToken: token,
      requestKey: "order:2MG-100101",
      reference: "2MG-100101",
      maximum: 50,
    });
    expect(again.body.id).toBe(held.body.id);
    expect(
      (
        (await wallet({ operation: "wallet_read", account: MEMBER })).body.account as {
          balance: number;
        }
      ).balance,
    ).toBe(90);

    // The website's server finds it (a page closed mid-checkout) and commits it.
    const found = await wallet({
      operation: "site_reservation_read",
      requestKey: "order:2MG-100101",
    });
    expect(found.body.reservation).toMatchObject({
      id: held.body.id,
      state: "reserved",
      site: "2mginc.com",
    });
    const spent = await wallet({
      operation: "site_reservation_settle",
      requestKey: "order:2MG-100101",
      outcome: "commit",
      reason: "Applied to website order 2MG-100101.",
    });
    expect(spent.body.reservation).toMatchObject({ state: "spent" });

    // The order comes with them: the case's order is paid that much by points, nothing taken twice.
    expect(
      (
        await orderEvent("2MG-100101", {
          rewards: { reservation: held.body.id, points: 50 },
          total: 1350,
        })
      ).status,
    ).toBe(200);
    const orderId = await placeFromWebsite("2MG-100101");
    const [order] = await rows<{ pointsUsed: number }>(
      db,
      sql`select points_used::int as "pointsUsed" from sales_order where id = ${orderId}`,
    );
    expect(order?.pointsUsed).toBe(50);
    expect(
      (
        (await wallet({ operation: "wallet_read", account: MEMBER })).body.account as {
          balance: number;
        }
      ).balance,
    ).toBe(90);

    // Cancelled: the points come back, once.
    expect(
      (await post("sarla", `/api/orders/${orderId}/cancel`, { reason: "Out of stock" })).status,
    ).toBe(200);
    expect(
      (
        (await wallet({ operation: "wallet_read", account: MEMBER })).body.account as {
          balance: number;
        }
      ).balance,
    ).toBe(140);
  });

  it("gives back a checkout's points the customer didn't finish", async () => {
    const token = (
      await wallet({ operation: "auth_member", phone: MEMBER.phone, password: "secret-1" })
    ).body.token as string;
    await wallet({
      operation: "reserve",
      account: MEMBER,
      walletToken: token,
      requestKey: "order:2MG-100102",
      reference: "2MG-100102",
      maximum: 30,
    });
    const released = await wallet({
      operation: "site_reservation_settle",
      requestKey: "order:2MG-100102",
      outcome: "release",
      reason: "Checkout closed.",
    });
    expect(released.body.reservation).toMatchObject({ state: "released", points: 30 });
    expect(
      (
        (await wallet({ operation: "wallet_read", account: MEMBER })).body.account as {
          balance: number;
        }
      ).balance,
    ).toBe(140);
    expect(
      (
        await wallet({
          operation: "site_reservation_settle",
          requestKey: "order:nothing",
          outcome: "release",
          reason: "x",
        })
      ).status,
    ).toBe(404);
  });

  it("gives a checkout's points back when the website cancels an order the CRM hadn't placed", async () => {
    const token = (
      await wallet({ operation: "auth_member", phone: MEMBER.phone, password: "secret-1" })
    ).body.token as string;
    const held = await wallet({
      operation: "reserve",
      account: MEMBER,
      walletToken: token,
      requestKey: "order:2MG-100104",
      reference: "2MG-100104",
      maximum: 20,
    });
    await wallet({
      operation: "site_reservation_settle",
      requestKey: "order:2MG-100104",
      outcome: "commit",
      reason: "Applied.",
    });
    expect(
      (
        await orderEvent("2MG-100104", {
          rewards: { reservation: held.body.id, points: 20 },
          total: 1380,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        (await wallet({ operation: "wallet_read", account: MEMBER })).body.account as {
          balance: number;
        }
      ).balance,
    ).toBe(120);
    const cancel = JSON.stringify({
      event: "order.status_updated",
      deliveryId: crypto.randomUUID(),
      sentAt: new Date().toISOString(),
      site: SITE,
      data: { orderNumber: "2MG-100104", status: "cancelled" },
    });
    expect(
      (
        await app.request("/webhooks/store/2mg", {
          method: "POST",
          headers: { "content-type": "application/json", "x-crm-signature": sign(cancel) },
          body: cancel,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        (await wallet({ operation: "wallet_read", account: MEMBER })).body.account as {
          balance: number;
        }
      ).balance,
    ).toBe(140);
    // The same cancel again gives nothing twice.
    const again = JSON.stringify({
      event: "order.status_updated",
      deliveryId: crypto.randomUUID(),
      sentAt: new Date().toISOString(),
      site: SITE,
      data: { orderNumber: "2MG-100104", status: "cancelled" },
    });
    await app.request("/webhooks/store/2mg", {
      method: "POST",
      headers: { "content-type": "application/json", "x-crm-signature": sign(again) },
      body: again,
    });
    expect(
      (
        (await wallet({ operation: "wallet_read", account: MEMBER })).body.account as {
          balance: number;
        }
      ).balance,
    ).toBe(140);
  });

  it("lets the website's admin look a number up and adjust it once per request", async () => {
    expect((await wallet({ operation: "admin_lookup", phone: MEMBER.phone })).status).toBe(400);
    const looked = await wallet({
      operation: "admin_lookup",
      phone: MEMBER.phone,
      staff: "admin@2mginc.com",
    });
    expect(looked.body).toMatchObject({ account: { balance: 140 } });
    const adjust = {
      operation: "admin_adjust",
      phone: MEMBER.phone,
      staff: "admin@2mginc.com",
      points: 10,
      reason: "Goodwill",
      requestKey: "adj-1",
    };
    expect((await wallet(adjust)).body).toMatchObject({ account: { balance: 150 } });
    expect((await wallet(adjust)).body).toMatchObject({ account: { balance: 150 } });
  });

  it("answers the member's rewards with their own orders, and links an order placed before they signed in", async () => {
    expect((await orderEvent("2MG-100103", { account: undefined })).status).toBe(200);
    const linked = await wallet({ operation: "order_account", ref: "2MG-100103", account: MEMBER });
    expect(linked.body).toMatchObject({ ok: true, bound: false });
    expect(
      (
        await wallet({
          operation: "order_account",
          ref: "2MG-100103",
          account: { ref: "someone-else", phone: MEMBER.phone },
        })
      ).status,
    ).toBe(400);
    const rewards = await wallet({
      operation: "member_rewards",
      account: MEMBER,
      orders: ["2MG-100100", "2MG-100103"],
    });
    expect(rewards.body).toMatchObject({ linked: true, account: { balance: 150 }, pending: false });
  });

  it("keeps the points page's own sign-in and its five-try pause", async () => {
    const made = await wallet({
      operation: "auth_register",
      phone: "0919 555 0000",
      password: "pass-1",
      name: "Ana",
    });
    expect(made.body).toMatchObject({ linked: false, phone: "+639195550000" });
    for (let i = 0; i < 5; i += 1)
      expect(
        (await wallet({ operation: "auth_login", phone: "0919 555 0000", password: "wrong" }))
          .status,
      ).toBe(400);
    expect(
      (await wallet({ operation: "auth_login", phone: "0919 555 0000", password: "pass-1" }))
        .status,
    ).toBe(400);
    const out = await wallet({ operation: "auth_logout", walletToken: made.body.token });
    expect(out.body).toEqual({ ok: true });
    expect((await wallet({ operation: "wallet_read", walletToken: made.body.token })).status).toBe(
      400,
    );
  });
});
