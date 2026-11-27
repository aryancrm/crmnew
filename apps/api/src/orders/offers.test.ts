// Offers (the hub's Buy 1 Take 1, Aryan's Christmas offers file): set in Inventory for a kind of
// buyer or every buyer; an order takes the free pieces by itself, worked out by the server (a
// free line typed by hand is replaced), at the offer's price when it has one; not with an SC/PWD
// price; an ended offer is not taken any more.

import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase } from "../db/index";
import { migrate } from "../db/migrate";
import { seedFixture } from "../inventory/fixture";
import { todayManila } from "../inventory/rules";
import { seedDemo } from "../seed";
import type { Catalogue, MedicineDetail, OrderDetail } from "../types";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
let hospital = 0;
let doctor = 0;
let medicine: { id: number; hospital: number; doctor: number };

const get = (who: string, path: string) =>
  app.request(path, { headers: { cookie: cookies[who] as string } });
const read = async <T>(who: string, path: string) => (await (await get(who, path)).json()) as T;
const post = (who: string, path: string, body: unknown = {}) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookies[who] as string },
    body: JSON.stringify(body),
  });
const place = async (body: unknown) => {
  const response = await post("ryan", "/api/orders", body);
  expect(response.status, await response.clone().text()).toBe(200);
  return read<OrderDetail>("sarla", `/api/orders/${((await response.json()) as { id: number }).id}`);
};
const later = (days: number) => {
  const date = new Date(`${todayManila()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  await seedFixture(db);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["ryan", "sarla"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
  const add = async (body: unknown) =>
    ((await (await post("sarla", "/api/customers", body)).json()) as { id: number }).id;
  hospital = await add({ kind: "hospital", name: "Offer Test Hospital", city: "Pasay", paymentTerms: "cod" });
  doctor = await add({ kind: "doctor", name: "Dr. Offer Test", city: "Pasay", paymentTerms: "cod", licenceNo: "0567002" });
  const catalogue = await read<Catalogue>("sarla", "/api/inventory/medicines");
  const row = catalogue.rows.find(
    (item) => item.prices.hospital !== undefined && item.prices.doctor !== undefined && item.total >= 200 && !item.promo,
  );
  medicine = { id: row?.id as number, hospital: row?.prices.hospital as number, doctor: row?.prices.doctor as number };
});

describe("offers", () => {
  it("Buy 1 Take 1 for hospitals: the free pieces come by themselves, never typed", async () => {
    const made = await post("sarla", `/api/inventory/medicines/${medicine.id}/offers`, {
      buyerKind: "hospital",
      buy: 1,
      take: 1,
      price: null,
      startsOn: todayManila(),
      endsOn: later(30),
    });
    expect(made.status).toBe(200);
    const offerId = ((await made.json()) as { id: number }).id;
    // Only those who set prices.
    expect(
      (
        await post("ryan", `/api/inventory/medicines/${medicine.id}/offers`, {
          buyerKind: null,
          buy: 1,
          take: 1,
          price: null,
          startsOn: todayManila(),
          endsOn: later(30),
        })
      ).status,
    ).toBe(403);
    // One running offer per kind of buyer at a time.
    expect(
      (
        await post("sarla", `/api/inventory/medicines/${medicine.id}/offers`, {
          buyerKind: "hospital",
          buy: 2,
          take: 1,
          price: null,
          startsOn: todayManila(),
          endsOn: later(10),
        })
      ).status,
    ).toBe(409);
    const shown = await read<MedicineDetail>("sarla", `/api/inventory/medicines/${medicine.id}`);
    expect(shown.offers[0]).toMatchObject({ name: "Buy 1 Take 1", buyerLabel: "Hospitals", state: "now" });

    // A free line typed by hand is replaced by what the offer gives.
    const order = await place({
      customerId: hospital,
      items: [
        { medicineId: medicine.id, qty: 10, priceKind: "hospital" },
        { medicineId: medicine.id, qty: 99, priceKind: "hospital", free: true, reason: "More please" },
      ],
    });
    expect(order.items.map((item) => [item.qty, item.unitPrice, item.free, item.offerId])).toEqual([
      [10, medicine.hospital, false, null],
      [10, 0, true, offerId],
    ]);
    expect(order.items[1]?.reason).toBe("Buy 1 Take 1");
    // The offer's free pieces aren't "free goods" for Management to question.
    expect(order.findings.map((finding) => finding.short)).not.toContain("Free goods");
    expect(order.order.total).toBe(10 * medicine.hospital);

    // Not for a doctor (the offer is for hospitals).
    const forDoctor = await place({
      customerId: doctor,
      items: [{ medicineId: medicine.id, qty: 4, priceKind: "doctor" }],
    });
    expect(forDoctor.items).toHaveLength(1);

    // Not with an SC/PWD price (the law: the discount or a promo, never both).
    const relief = await place({
      customerId: hospital,
      items: [{ medicineId: medicine.id, qty: 4, priceKind: "hospital" }],
      relief: { kind: "senior", idNo: "OSCA-1", name: "Lola" },
    });
    expect(relief.items.some((item) => item.free)).toBe(false);

    // Ended: orders from now on don't take it.
    expect((await post("sarla", `/api/inventory/offers/${offerId}/end`)).status).toBe(200);
    const after = await place({
      customerId: hospital,
      items: [{ medicineId: medicine.id, qty: 10, priceKind: "hospital" }],
    });
    expect(after.items).toHaveLength(1);
  });

  it("Buy 2 Take 1 at the offer's own price, for doctors", async () => {
    const price = medicine.doctor - 100;
    expect(
      (
        await post("sarla", `/api/inventory/medicines/${medicine.id}/offers`, {
          buyerKind: "doctor",
          buy: 2,
          take: 1,
          price,
          name: "Christmas: Buy 2 Take 1",
          startsOn: todayManila(),
          // No end day: it runs until someone ends it.
        })
      ).status,
    ).toBe(200);
    const catalogue = await read<Catalogue>("ryan", "/api/inventory/medicines");
    expect(catalogue.rows.find((row) => row.id === medicine.id)?.offers).toMatchObject([
      { buyerKind: "doctor", buy: 2, take: 1, price, endsOn: null },
    ]);
    const order = await place({
      customerId: doctor,
      items: [{ medicineId: medicine.id, qty: 5, priceKind: "offer" }],
    });
    expect(order.items.map((item) => [item.qty, item.unitPrice, item.free, item.priceLabel])).toEqual([
      [5, price, false, "Offer"],
      [2, 0, true, "Offer"],
    ]);
    expect(order.items[0]?.reason).toBe("Christmas: Buy 2 Take 1");
    // At the offer's price: not "below the list" for Management.
    expect(order.findings.map((finding) => finding.kind)).not.toContain("price");
    // The offer price is for doctors only.
    const wrong = await post("ryan", "/api/orders", {
      customerId: hospital,
      items: [{ medicineId: medicine.id, qty: 5, priceKind: "offer" }],
    });
    expect(wrong.status).toBe(400);
  });
});
