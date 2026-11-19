// One seat, one Division (Aryan, 19 Nov: "a MedRep comes under one Division; if a Hospital MedRep
// brings another Division's order, under which head does it go?"): an order carries the Division of
// the person whose order it is (their seat's: CLIDP, Uro & Onco Care is URO, Blood & Bone Care is
// B&B, else the channel's), another is refused, and the Admin may set any (Management places none).

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
  // Ryan's channel carries HOS, as the Admin panel sets it.
  await db.execute(
    sql`update channel set division = 'HOS' where id = (select channel_id from person where email = 'ryan@2mg.test')`,
  );
});

describe("an order's Division", () => {
  it("is the MedRep's own; another is refused; the Admin may set any", async () => {
    const me = (await read<{ me: Me }>("ryan", "/api/me")).me;
    expect(me.divisions?.[0]).toBe("HOS");

    // His own: placed, and carried on the order.
    const placed = await post("ryan", "/api/orders", { customerId: customer, items: [{ medicineId: medicine, qty: 1, priceKind: "hospital" }] });
    expect(placed.status, await placed.clone().text()).toBe(200);
    const id = ((await placed.json()) as { id: number }).id;
    expect((await read<OrderDetail>("ryan", `/api/orders/${id}`)).order.division).toBe("HOS");

    // Another Division: refused, saying his own.
    const other = await post("ryan", "/api/orders", {
      customerId: customer,
      division: "CLIDP",
      items: [{ medicineId: medicine, qty: 1, priceKind: "hospital" }],
    });
    expect(other.status).toBe(400);
    expect(await other.text()).toContain("HOS");

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

  it("follows the seat's box on the chart where it names a Division", async () => {
    const [seat] = await rows<{ id: number }>(
      db,
      sql`select s.id::int as id from seat s join seat_holder h on h.seat_id = s.id where h.person_id = (select id from person where email = 'ryan@2mg.test') limit 1`,
    );
    if (!seat) return; // the demo has no seat for him: the channel's Division is his
    await db.execute(sql`update org_unit set name = 'Uro & Onco Care' where id = (select unit_id from seat where id = ${seat.id})`);
    const [division] = await rows<{ d: string | null }>(db, sql`select seat_division(${seat.id}) as d`);
    expect(division?.d).toBe("URO");
  });
});
