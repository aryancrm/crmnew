import { createHmac } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedFixture } from "../inventory/fixture";
import { seedDemo } from "../seed";
import type { ChannelsData, LeadCase, LeadDesk, OrderDetail } from "../types";
import { pushWebsites, useWebHttp } from "./websites";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
let secret = "";

// ---- the website, as the tests want it
const posted: { url: string; body: string; headers: Record<string, string> }[] = [];
let answer: { status: number; json: Record<string, unknown> | null } = {
  status: 200,
  json: { ok: true },
};
useWebHttp({
  async file(url) {
    if (url.includes("broken")) return null;
    return { bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2]), mime: "image/png" };
  },
  async post(url, body, headers) {
    posted.push({ url, body, headers });
    return answer;
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

const sign = (body: string, key = secret) =>
  `sha256=${createHmac("sha256", key).update(body).digest("hex")}`;
function call(event: string, data: object, options: { key?: string; site?: string } = {}) {
  const body = JSON.stringify({
    event,
    deliveryId: crypto.randomUUID(),
    sentAt: new Date().toISOString(),
    site: options.site ?? "https://www.2mginc.com",
    statusUrl: "https://www.2mginc.com/api/crm/order-status",
    data,
  });
  return app.request("/webhooks/store/2mg", {
    method: "POST",
    headers: { "content-type": "application/json", "x-crm-signature": sign(body, options.key) },
    body,
  });
}
const order = (ref: string, extra: object = {}) => ({
  orderNumber: ref,
  createdAt: new Date().toISOString(),
  status: "pending",
  customer: {
    name: "Lito Ramirez",
    phone: "0918 222 4410",
    email: "lito@mail.test",
    address: "12 Taft Ave, Pasay",
  },
  paymentMethod: "cod",
  items: [{ name: "Letrozole 2.5 mg", quantity: 2, unitPrice: 1400, lineTotal: 2800 }],
  currency: "PHP",
  subtotal: 2800,
  vatExempted: 0,
  discount: 0,
  deliveryFee: 150,
  total: 2950,
  ...extra,
});
const caseOfRef = async (ref: string) =>
  (
    await rows<{ id: number | null }>(
      db,
      sql`select lead_id::int as id from web_order where ref = ${ref}`,
    )
  )[0]?.id ?? null;

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  await seedFixture(db);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["jane", "sarla", "naresh", "fiona"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
});

afterAll(() => useWebHttp(null));

describe("a website", () => {
  it("is connected by the Admin or the CEO, with a secret shown once", async () => {
    expect(
      (
        await post("jane", "/api/channels/website", {
          name: "2MG website",
          site: "https://www.2mginc.com",
        })
      ).status,
    ).toBe(403);
    const made = await post("naresh", "/api/channels/website", {
      name: "2MG website",
      site: "https://www.2mginc.com",
    });
    expect(made.status).toBe(200);
    const body = (await made.json()) as { key: string; secret: string };
    expect(body.key).toBe("2mginc.com");
    secret = body.secret;
    expect(JSON.stringify(await read<ChannelsData>("naresh", "/api/channels"))).not.toContain(
      secret,
    );
    const [stored] = await rows<{ secret: string }>(
      db,
      sql`select secret from channel_account where key = '2mginc.com'`,
    );
    expect(stored?.secret).not.toContain(secret);
  });

  it("refuses a website it doesn't know and a body it didn't sign", async () => {
    expect((await call("order.created", order("X-1"), { site: "unknown.test" })).status).toBe(404);
    expect((await call("order.created", order("X-1"), { key: "not-the-secret" })).status).toBe(401);
  });
});

describe("a website order", () => {
  it("opens a case with the road, the medicines as its quotation and the documents to file; a retry finishes the documents", async () => {
    const data = order("2MG-100040", {
      benefit: { type: "senior", status: "pending" },
      items: [
        { name: "Anastrozole 1 mg", quantity: 2, unitPrice: 1450, lineTotal: 2900 },
        { name: "Herbal tea", quantity: 1, unitPrice: 300, lineTotal: 300 },
      ],
      documents: [
        { id: "d1", kind: "prescription", url: "https://files.test/rx.png" },
        { id: "d2", kind: "id", url: "https://files.test/broken" },
      ],
    });
    const first = await call("order.created", data);
    expect(first.status).toBe(503);
    expect(await first.json()).toMatchObject({ outcome: "documents_pending" });
    const id = (await caseOfRef("2MG-100040")) as number;
    let lead = await read<LeadCase>("jane", `/api/leads/${id}`);
    expect(lead.lead).toMatchObject({
      caseType: "website_order",
      sourceLabel: "2MG website",
      road: "senior",
      name: "Lito Ramirez",
      phone: "0918 222 4410",
      email: "lito@mail.test",
    });
    expect(lead.quote.lines).toEqual([
      expect.objectContaining({ medicine: "Anastrozole 1 mg", qty: 2, unitPrice: 145000 }),
    ]);
    // An item the catalogue doesn't have keeps the quotation for the agent to check and save.
    expect(lead.quote.stale).toBe(true);
    expect(lead.unsorted).toHaveLength(1);
    expect(lead.web).toMatchObject({
      ref: "2MG-100040",
      site: "2MG website",
      statusLabel: "Order placed",
      money: { deliveryFee: 15000, total: 295000 },
    });
    expect(lead.web?.items.map((item) => item.matched)).toEqual([true, false]);

    // The website sends it again with fresh links: the ID comes, no second case.
    const again = await call("order.created", {
      ...data,
      documents: [
        { id: "d1", kind: "prescription", url: "https://files.test/rx.png" },
        { id: "d2", kind: "id", url: "https://files.test/id.png" },
      ],
    });
    expect(again.status).toBe(200);
    lead = await read<LeadCase>("jane", `/api/leads/${id}`);
    expect(lead.unsorted).toHaveLength(2);
    expect(await rows(db, sql`select id from lead where case_type = 'website_order'`)).toHaveLength(
      1,
    );
    const desk = await read<LeadDesk>("jane", "/api/leads");
    expect(desk.cards.find((card) => card.id === id)).toMatchObject({
      caseType: "website_order",
      sourceLabel: "2MG website",
    });
  });

  it("places the case's order with the website's delivery fee and payment, and tells the website each step", async () => {
    expect(
      (
        await call(
          "order.created",
          order("2MG-100041", {
            documents: [{ id: "r1", kind: "prescription", url: "https://files.test/rx.png" }],
          }),
        )
      ).status,
    ).toBe(200);
    const id = (await caseOfRef("2MG-100041")) as number;
    const lead = await read<LeadCase>("jane", `/api/leads/${id}`);
    expect(lead.quote.stale).toBe(false);
    expect(
      (await post("jane", `/api/lead-files/${lead.unsorted[0]?.id}/kind`, { kind: "rx" })).status,
    ).toBe(200);
    expect((await read<LeadCase>("jane", `/api/leads/${id}`)).step.value).toBe("ready");

    const placed = await post("jane", `/api/leads/${id}/order`);
    expect(placed.status).toBe(200);
    const orderId = ((await placed.json()) as { id: number }).id;
    // Management approves every order (Aryan, 17 Nov).
    expect((await post("sarla", `/api/orders/${orderId}/approve`)).status).toBe(200);
    const detail = await read<OrderDetail>("sarla", `/api/orders/${orderId}`);
    expect(detail.order).toMatchObject({
      total: 2 * 140000 + 15000,
      deliveryFee: 15000,
      paymentTerms: "cod",
    });

    // Approved, it goes to Dispatch with its invoice, and the website hears "confirmed".
    expect(detail.order.status).toBe("ready_for_dispatch");
    const [invoice] = await rows<{ total: number }>(
      db,
      sql`select total::int as total from invoice where order_id = ${orderId}`,
    );
    expect(invoice?.total).toBe(2 * 140000 + 15000);
    answer = { status: 200, json: { ok: true, status: "confirmed" } };
    expect(await pushWebsites(db)).toBe(1);
    const sent = posted.at(-1);
    expect(sent?.url).toBe("https://www.2mginc.com/api/crm/order-status");
    expect(sent?.headers["x-crm-signature"]).toBe(sign(sent?.body ?? ""));
    expect(JSON.parse(sent?.body ?? "{}").data).toMatchObject({
      orderNumber: "2MG-100041",
      status: "confirmed",
    });
    expect(await pushWebsites(db)).toBe(0);

    // On the way with its tracking.
    await db.execute(
      sql`update sales_order set status = 'shipped', courier = 'LBC', tracking = 'LBC-777' where id = ${orderId}`,
    );
    answer = { status: 200, json: { ok: true, status: "shipped" } };
    await pushWebsites(db);
    expect(JSON.parse(posted.at(-1)?.body ?? "{}").data).toMatchObject({
      status: "shipped",
      trackingNumber: "LBC-777",
    });

    // The website refuses one: no more tries until someone says try again.
    await db.execute(sql`update sales_order set status = 'completed' where id = ${orderId}`);
    answer = { status: 409, json: { message: "Order is on hold on the website." } };
    await pushWebsites(db);
    const [refused] = await rows<{ error: string; attempts: number }>(
      db,
      sql`select push_error as error, push_attempts::int as attempts from web_order where ref = '2MG-100041'`,
    );
    expect(refused).toMatchObject({ attempts: 30 });
    expect(refused?.error).toContain("on hold");
    const count = posted.length;
    await pushWebsites(db);
    expect(posted.length).toBe(count);
    answer = { status: 200, json: { ok: true, status: "delivered" } };
    const [webOrder] = await rows<{ id: number }>(
      db,
      sql`select id::int as id from web_order where ref = '2MG-100041'`,
    );
    expect((await post("jane", `/api/web-orders/${webOrder?.id}/push`)).status).toBe(200);
    expect(
      (
        await rows<{ status: string }>(
          db,
          sql`select status from web_order where ref = '2MG-100041'`,
        )
      )[0]?.status,
    ).toBe("delivered");
  });

  it("follows the website's own status forward only, and a cancel closes a case not ordered yet", async () => {
    await call("order.created", order("2MG-100042"));
    const id = (await caseOfRef("2MG-100042")) as number;
    const later = new Date(Date.now() + 60_000).toISOString();
    await call("order.status_updated", {
      orderNumber: "2MG-100042",
      status: "confirmed",
      changedAt: later,
    });
    await call("order.status_updated", {
      orderNumber: "2MG-100042",
      status: "pending",
      changedAt: new Date(Date.now() + 120_000).toISOString(),
    });
    expect(
      (
        await rows<{ status: string }>(
          db,
          sql`select status from web_order where ref = '2MG-100042'`,
        )
      )[0]?.status,
    ).toBe("confirmed");
    await call("order.status_updated", {
      orderNumber: "2MG-100042",
      status: "cancelled",
      cancelReason: "Changed my mind",
      changedAt: new Date(Date.now() + 180_000).toISOString(),
    });
    const lead = await read<LeadCase>("jane", `/api/leads/${id}`);
    expect(lead.lead).toMatchObject({
      state: "lost",
      lostReason: "Cancelled on the website: Changed my mind",
    });
  });

  it("leaves an order that came days late for a person, who can open its case", async () => {
    const old = new Date(Date.now() - 4 * 86_400_000).toISOString();
    expect((await call("order.created", order("2MG-100030", { createdAt: old }))).status).toBe(200);
    expect(await caseOfRef("2MG-100030")).toBeNull();
    const channels = await read<ChannelsData>("naresh", "/api/channels");
    const site = channels.channels.find((channel) => channel.kind === "website");
    expect(site?.website?.noCase.map((row) => row.ref)).toContain("2MG-100030");
    const webId = site?.website?.noCase.find((row) => row.ref === "2MG-100030")?.id;
    const opened = await post("jane", `/api/web-orders/${webId}/open-case`);
    expect(opened.status).toBe(200);
    expect(await caseOfRef("2MG-100030")).not.toBeNull();
  });

  it("lets the website's admin read where its order stands", async () => {
    const body = JSON.stringify({
      site: "https://www.2mginc.com",
      ref: "2MG-100041",
      sentAt: new Date().toISOString(),
    });
    const response = await app.request("/webhooks/store/2mg/order-progress", {
      method: "POST",
      headers: { "content-type": "application/json", "x-crm-signature": sign(body) },
      body,
    });
    expect(response.status).toBe(200);
    const answered = (await response.json()) as {
      case: { road: string; step: string; stops: { label: string }[]; order: { number: string } };
    };
    expect(answered.case.road).toBe("Regular");
    expect(answered.case.order.number).toMatch(/^2MG-/);
    expect(answered.case.stops.length).toBeGreaterThan(3);
  });
});

describe("a prescription or enquiry from a website", () => {
  it("lands on the person's open case by their number, else opens one", async () => {
    const before =
      (await rows<{ n: number }>(db, sql`select count(*)::int as n from lead`))[0]?.n ?? 0;
    const onCase = await call("prescription.uploaded", {
      requestNumber: "RX-100003",
      createdAt: new Date().toISOString(),
      customer: { name: "Lito R.", phone: "+63 918 222 4410" },
      fileName: "rx.jpg",
      fileUrl: "https://files.test/rx2.png",
    });
    expect(onCase.status).toBe(200);
    expect((await rows<{ n: number }>(db, sql`select count(*)::int as n from lead`))[0]?.n).toBe(
      before,
    );
    const [request] = await rows<{ leadId: number }>(
      db,
      sql`select lead_id::int as "leadId" from web_request where ref = 'RX-100003'`,
    );
    const [lead] = await rows<{ phone: string }>(
      db,
      sql`select phone_key as phone from lead where id = ${request?.leadId}`,
    );
    expect(lead?.phone).toBe("9182224410");

    const fresh = await call("enquiry.created", {
      requestNumber: "ENQ-100006",
      subject: "Bulk enquiry",
      customer: { name: "Ana Clinic", phone: "0917 000 1111" },
      message: "Price for 50 boxes?",
    });
    expect(fresh.status).toBe(200);
    const [made] = await rows<{ request: string; source: string }>(
      db,
      sql`select l.request, l.source from web_request r join lead l on l.id = r.lead_id where r.ref = 'ENQ-100006'`,
    );
    expect(made).toMatchObject({ source: "website" });
    expect(made?.request).toContain("Bulk enquiry · ENQ-100006");
  });
});
