// One seat, one Division (Aryan, 19 Nov: "a MedRep comes under one Division; if a Hospital MedRep
// brings another Division's order, under which head does it go?"): an order carries the Division of
// the person whose order it is (their seat's: CLIDP, RX Business and its lines, MD Telesales, else
// the channel's), another may be picked, and the Admin may set any (Management places none). The
// Divisions are the sales tracker's eight channels (19 Nov); a hub word is read as its channel.

import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedFixture } from "../inventory/fixture";
import { seedDemo } from "../seed";
import type { Me, OrderDetail } from "../types";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
let medicine = 0;
let customer = 0;

const read = async <T>(who: string, path: string) =>
  (await (await app.request(path, { headers: { cookie: cookies[who] as string } })).json()) as T;
const post = (who: string, path: string, body: unknown = {}) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookies[who] as string },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  await seedFixture(db);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["ryan", "sarla", "admin"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
  const [found] = await rows<{ id: number }>(
    db,
    sql`select m.id::int as id from medicine m join medicine_price p on p.medicine_id = m.id and p.buyer_type = 'hospital' limit 1`,
  );
  medicine = found?.id as number;
  const made = await post("sarla", "/api/customers", { kind: "hospital", name: "Division Test Hospital", city: "Pasay" });
  customer = ((await made.json()) as { id: number }).id;
  // Ryan's channel carries HOSP, as the Admin panel sets it.
  await db.execute(
    sql`update channel set division = 'HOSP' where id = (select channel_id from person where email = 'ryan@2mg.test')`,
  );
});

describe("an order's Division", () => {
  it("starts as the MedRep's own; another may be picked and still counts for him; the Admin may set any", async () => {
    const me = (await read<{ me: Me }>("ryan", "/api/me")).me;
    expect(me.divisions?.[0]).toBe("HOSP");

    // His own: placed, and carried on the order.
    const placed = await post("ryan", "/api/orders", { customerId: customer, items: [{ medicineId: medicine, qty: 1, priceKind: "hospital" }] });
    expect(placed.status, await placed.clone().text()).toBe(200);
    const id = ((await placed.json()) as { id: number }).id;
    expect((await read<OrderDetail>("ryan", `/api/orders/${id}`)).order.division).toBe("HOSP");

    // Another Division (19 Nov, evening: the screen universal, as the hub's): taken, carried on
    // the order, and still his (his channel, his lead and head).
    const other = await post("ryan", "/api/orders", {
      customerId: customer,
      division: "CLIDP",
      items: [{ medicineId: medicine, qty: 1, priceKind: "hospital" }],
    });
    expect(other.status, await other.clone().text()).toBe(200);
    const otherId = ((await other.json()) as { id: number }).id;
    const otherDetail = await read<OrderDetail>("ryan", `/api/orders/${otherId}`);
    expect(otherDetail.order.division).toBe("CLIDP");
    expect(otherDetail.order.medrep).toBe(me.name);

    // The Admin, ordering for nobody in particular, may set any; Management places no orders (19 Nov).
    const admin = await post("admin", "/api/orders", {
      customerId: customer,
      division: "B2B",
      items: [{ medicineId: medicine, qty: 1, priceKind: "hospital" }],
    });
    expect(admin.status, await admin.clone().text()).toBe(200);
    expect(
      (
        await post("sarla", "/api/orders", {
          customerId: customer,
          division: "B2B",
          items: [{ medicineId: medicine, qty: 1, priceKind: "hospital" }],
        })
      ).status,
    ).toBe(403);
  });

  it("brings the hub's Sub-division and Headquarter with another Division, and a prescription Division asks why there is none", async () => {
    const placed = await post("ryan", "/api/orders", {
      customerId: customer,
      division: "RX Business",
      type: "no_po",
      headquarter: "TAFT",
      noRxReason: "The doctor sends it before delivery",
      items: [{ medicineId: medicine, qty: 1, priceKind: "hospital" }],
    });
    expect(placed.status, await placed.clone().text()).toBe(200);
    const detail = await read<OrderDetail>("ryan", `/api/orders/${((await placed.json()) as { id: number }).id}`);
    expect(detail.order).toMatchObject({ division: "RX Business", subDivision: "MD Telesales", headquarter: "TAFT" });
    const rx = detail.paperList.find((row) => row.kind === "prescription");
    expect(rx?.needed).toBe(true);
    expect(rx?.why).toContain("The doctor sends it before delivery");
  });

  it("takes only the sales tracker's eight channels, reading a hub word as its channel", async () => {
    // A page still open from before sends the hub's word: it is booked under its channel.
    const old = await post("ryan", "/api/orders", {
      customerId: customer,
      division: "URO",
      type: "no_po",
      noRxReason: "Coming with the delivery",
      items: [{ medicineId: medicine, qty: 1, priceKind: "hospital" }],
    });
    expect(old.status, await old.clone().text()).toBe(200);
    const oldDetail = await read<OrderDetail>("ryan", `/api/orders/${((await old.json()) as { id: number }).id}`);
    expect(oldDetail.order.division).toBe("RX Business");
    // The hub's MSA had nobody: no such Division now.
    const none = await post("ryan", "/api/orders", {
      customerId: customer,
      division: "MSA",
      items: [{ medicineId: medicine, qty: 1, priceKind: "hospital" }],
    });
    expect(none.status).toBe(400);
    // My orders split by the same eight (an old link's word is read too).
    const mine = await read<{ total: number; division: string | null }>("ryan", "/api/orders/mine?division=HOS");
    const tracker = await read<{ total: number }>("ryan", "/api/orders/mine?division=HOSP");
    expect(mine).toMatchObject({ division: "HOSP", total: tracker.total });
  });

  it("follows the seat's box on the chart where it names a Division", async () => {
    const [seat] = await rows<{ id: number }>(
      db,
      sql`select s.id::int as id from seat s join seat_holder h on h.seat_id = s.id where h.person_id = (select id from person where email = 'ryan@2mg.test') limit 1`,
    );
    if (!seat) return; // the demo has no seat for him: the channel's Division is his
    const unit = sql`(select unit_id from seat where id = ${seat.id})`;
    const [before] = await rows<{ name: string }>(db, sql`select name from org_unit where id = ${unit}`);
    await db.execute(sql`update org_unit set name = 'Uro & Onco Care' where id = ${unit}`);
    const [division] = await rows<{ d: string | null }>(db, sql`select seat_division(${seat.id}) as d`);
    expect(division?.d).toBe("RX Business");
    // Javed's MD Telesales sits on the Telesales channel; its box says it is MD Telesales.
    await db.execute(sql`update org_unit set name = 'MD Telesales' where id = ${unit}`);
    const [telesales] = await rows<{ d: string | null }>(db, sql`select seat_division(${seat.id}) as d`);
    expect(telesales?.d).toBe("MD Telesales");
    await db.execute(sql`update org_unit set name = ${before?.name ?? ""} where id = ${unit}`);
  });
});
