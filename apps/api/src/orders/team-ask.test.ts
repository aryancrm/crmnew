// Step D: the Team Lead works the team's orders as the hub let them (fixes and sends again,
// answers, asks a refund; approves nothing) and hears about them; Management asks the Team Lead
// or the Business Mentor for a yes on the order; and who approves what is set per division.

import { beforeAll, describe, expect, it } from "vitest";
import { ticked } from "../testing/approve";
import { createApp } from "../app";
import { type Database, openDatabase } from "../db/index";
import { migrate } from "../db/migrate";
import { seedFixture } from "../inventory/fixture";
import { seedDemo } from "../seed";
import type { Approvers, Catalogue, NotificationList, OrderBoard, OrderDetail, OrderReturns } from "../types";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
let hospital = 0;
let medicine = 0;

const get = (who: string, path: string) =>
  app.request(path, { headers: { cookie: cookies[who] as string } });
const read = async <T>(who: string, path: string) => (await (await get(who, path)).json()) as T;
const post = (who: string, path: string, body: unknown = {}) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookies[who] as string },
    body: JSON.stringify(body),
  });
const ok = async (who: string, path: string, body: unknown = {}) => {
  const response = await post(who, path, body);
  expect(response.status, `${who} ${path}: ${await response.clone().text()}`).toBe(200);
  return response;
};
const order = (who: string, id: number) => read<OrderDetail>(who, `/api/orders/${id}`);
const news = async (who: string) => (await read<NotificationList>(who, "/api/notifications")).rows;
async function placed(): Promise<number> {
  const response = await ok("ryan", "/api/orders", {
    customerId: hospital,
    items: [{ medicineId: medicine, qty: 5, priceKind: "hospital" }],
  });
  return ((await response.json()) as { id: number }).id;
}

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  await seedFixture(db);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["ryan", "sarla", "daniel", "vanessa", "admin"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
  hospital = ((await (await post("sarla", "/api/customers", { kind: "hospital", name: "Team Ask Hospital", city: "Pasay", paymentTerms: "cod" })).json()) as { id: number }).id;
  const catalogue = await read<Catalogue>("sarla", "/api/inventory/medicines");
  medicine = catalogue.rows.find((row) => row.prices.hospital !== undefined && row.total >= 100)?.id as number;
});

describe("asking up", () => {
  it("Management asks the Team Lead and the Business Mentor; only they answer, with a word for a No", async () => {
    const id = await placed();
    const seen = await order("sarla", id);
    expect(seen.askUp).toMatchObject({ teamLead: { name: "Daniel" }, mentor: { name: "Vanessa" } });
    expect((await order("ryan", id)).askUp).toBeNull();
    expect((await post("ryan", `/api/orders/${id}/ask`, { to: "team_lead", question: "?" })).status).toBe(403);
    await ok("sarla", `/api/orders/${id}/ask`, { to: "team_lead", question: "10% off for this hospital: yes?" });
    // One open question to a person at a time.
    expect((await post("sarla", `/api/orders/${id}/ask`, { to: "team_lead", question: "Again?" })).status).toBe(409);
    expect((await news("daniel")).some((row) => row.kind === "ask_up" && row.body === "10% off for this hospital: yes?")).toBe(true);
    const ask = (await order("daniel", id)).asks[0];
    expect(ask).toMatchObject({ asWho: "team_lead", askedTo: "Daniel", mine: true, answer: null });
    expect((await post("vanessa", `/api/order-asks/${ask?.id}/answer`, { yes: true })).status).toBe(403);
    expect((await post("daniel", `/api/order-asks/${ask?.id}/answer`, { yes: false })).status).toBe(400);
    await ok("daniel", `/api/order-asks/${ask?.id}/answer`, { yes: true, note: "Regular buyer, fine" });
    expect((await order("sarla", id)).asks[0]).toMatchObject({ answer: true, answerNote: "Regular buyer, fine", mine: false });
    expect((await news("sarla")).some((row) => row.kind === "ask_answered")).toBe(true);
    await ok("sarla", `/api/orders/${id}/ask`, { to: "business_mentor", question: "Free goods too?" });
    expect((await order("vanessa", id)).asks.find((one) => one.mine)?.asWho).toBe("business_mentor");
  });
});

describe("the Team Lead and the team's orders", () => {
  it("hears when one stops, fixes and sends it again, and may ask a refund; approves nothing", async () => {
    const id = await placed();
    expect((await order("daniel", id)).can.approve).toBe(false);
    expect((await post("daniel", await ticked(db, `/api/orders/${id}/approve`))).status).toBe(409);
    await ok("sarla", `/api/orders/${id}/send_back`, { reason: "Add the hospital's PO" });
    expect((await news("daniel")).some((row) => row.kind === "team_stop" && row.title.startsWith("Ryan's order sent back"))).toBe(true);
    expect((await order("daniel", id)).can.resubmit).toBe(true);
    await ok("daniel", `/api/orders/${id}/resubmit`, { reason: "PO is on the order now" });
    expect((await order("sarla", id)).order.status).toBe("pending_approval");
    await ok("sarla", await ticked(db, `/api/orders/${id}/approve`));
    expect((await news("daniel")).some((row) => row.kind === "team_news" && row.title.startsWith("Ryan's order approved"))).toBe(true);
    // Approved, not shipped: the lead asks Management to cancel it and refund (the hub's Request refund).
    const asking = await read<OrderReturns>("daniel", `/api/orders/${id}/returns`);
    expect(asking.can).toEqual({ ask: true, goods: ["not_shipped"] });
    await ok("daniel", `/api/orders/${id}/returns`, { reason: "not_needed", goods: "not_shipped" });
  });
});

describe("who approves what", () => {
  it("keeps an order out of a Management person's piles and approval when its division isn't theirs", async () => {
    const id = await placed();
    const division = (await order("sarla", id)).order.division as string;
    const list = await read<Approvers>("admin", "/api/org/approvers");
    const sarla = list.people.find((one) => one.name === "Sarla");
    expect(sarla?.approves).toBeNull();
    expect((await post("sarla", `/api/org/approvers/${sarla?.id}`, { approves: [] })).status).toBe(403);
    const other = list.divisions.find((one) => one !== division) as string;
    await ok("admin", `/api/org/approvers/${sarla?.id}`, { approves: [other] });
    const needs = await read<OrderBoard>("sarla", "/api/orders/board?desk=management&tab=needs");
    expect(needs.cards.some((card) => card.id === id)).toBe(false);
    expect((await post("sarla", await ticked(db, `/api/orders/${id}/approve`))).status).toBe(403);
    await ok("admin", `/api/org/approvers/${sarla?.id}`, { approves: [division] });
    await ok("sarla", await ticked(db, `/api/orders/${id}/approve`));
    await ok("admin", `/api/org/approvers/${sarla?.id}`, { approves: null });
  });
});
