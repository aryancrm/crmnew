import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { ticked } from "../testing/approve";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedFixture } from "../inventory/fixture";
import { seedDemo } from "../seed";
import type { SpeedReport } from "../types";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};

const get = (who: string, path: string) =>
  app.request(path, { headers: { cookie: cookies[who] as string } });
const send = (who: string, path: string, body: unknown = {}) =>
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
  for (const name of ["naresh", "sarla", "ryan", "daniel"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
});

describe("speed", () => {
  it("says how long Management took, who approved and what was late", async () => {
    const customer = (await (
      await send("sarla", "/api/customers", {
        kind: "hospital",
        name: "Speed Hospital",
        city: "Pasay",
      })
    ).json()) as { id: number };
    const [medicine] = await rows<{ id: number }>(
      db,
      sql`select m.id::int as id from medicine m join medicine_price p on p.medicine_id = m.id and p.buyer_type = 'hospital' limit 1`,
    );
    const place = async () =>
      (
        (await (
          await send("ryan", "/api/orders", {
            customerId: customer.id,
            items: [{ medicineId: medicine?.id, qty: 3, priceKind: "hospital" }],
          })
        ).json()) as { id: number }
      ).id;
    const slow = await place();
    const quick = await place();
    // The slow one waited ten days at Management before Sarla approved it: more than its four
    // working hours whatever day the test runs (a desk's clock counts working hours only).
    await db.execute(
      sql`update order_step set entered_at = entered_at - interval '10 days' where order_id = ${slow} and status = 'pending_approval'`,
    );
    expect((await send("sarla", await ticked(db, `/api/orders/${slow}/approve`))).status).toBe(200);
    expect((await send("sarla", await ticked(db, `/api/orders/${quick}/approve`))).status).toBe(200);

    const report = (await (await get("naresh", "/api/speed")).json()) as SpeedReport;
    const management = report.steps.find((step) => step.step === "management");
    expect(management?.orders).toBe(2);
    expect(management?.late).toBe(1);
    expect(management?.avgMinutes).toBeGreaterThan(140);
    const sarla = report.people.find(
      (person) => person.name === "Sarla" && person.step === "management",
    );
    expect(sarla).toMatchObject({ orders: 2, late: 1 });
    expect(report.slowest[0]).toMatchObject({ orderId: slow, step: "management", by: "Sarla" });
    expect(report.waitingNow.find((one) => one.step === "finance")?.orders).toBeGreaterThanOrEqual(
      2,
    );
    // A team lead sees his team's orders; a MedRep has no Speed page.
    expect(((await (await get("daniel", "/api/speed")).json()) as SpeedReport).scope).toBe(
      "Your team's orders",
    );
    expect((await get("ryan", "/api/speed")).status).toBe(403);
  });
});
