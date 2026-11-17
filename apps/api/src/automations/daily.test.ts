// Automations: each tells the right person once, and only tells.

import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedFixture } from "../inventory/fixture";
import { todayManila } from "../inventory/rules";
import { seedDemo } from "../seed";
import type { Catalogue } from "../types";
import { runAutomations } from "./daily";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
const post = (who: string, path: string, body: unknown = {}) =>
  app.request(path, { method: "POST", headers: { "content-type": "application/json", cookie: cookies[who] as string }, body: JSON.stringify(body) });
const told = (email: string, kind: string) =>
  rows<{ title: string }>(db, sql`select n.title from notification n join person p on p.id = n.person_id where p.email = ${email} and n.kind = ${kind} order by n.id`);

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
});

describe("automations", () => {
  it("tell the lead of a stuck order and the CEO each morning, once each", async () => {
    const catalogue = (await (await app.request("/api/inventory/medicines", { headers: { cookie: cookies.sarla as string } })).json()) as Catalogue;
    const row = catalogue.rows.find((item) => item.prices.hospital !== undefined && item.total >= 100);
    const customer = ((await (await post("sarla", "/api/customers", { kind: "hospital", name: "Stuck General", city: "Pasay", paymentTerms: "days", paymentDays: 30 })).json()) as { id: number }).id;
    const placed = (await (await post("ryan", "/api/orders", { customerId: customer, items: [{ medicineId: row?.id, qty: 5, priceKind: "hospital" }] })).json()) as { id: number };
    // It has waited at Management for ten days.
    await db.execute(sql`update sales_order set status_since = now() - interval '10 days', submitted_at = now() - interval '10 days' where id = ${placed.id}`);
    const morning = new Date(`${todayManila()}T01:30:00Z`); // 9:30 in Manila
    const first = await runAutomations(db, morning);
    expect(first.stuck).toBeGreaterThan(0);
    expect(first.morning).toBe(1);
    expect((await told("daniel@2mg.test", "team_stop")).some((one) => one.title.includes("has not moved"))).toBe(true);
    expect((await told("naresh@2mg.test", "morning_summary")).length).toBe(1);
    // Run again: nothing told twice.
    await runAutomations(db, morning);
    expect((await told("naresh@2mg.test", "morning_summary")).length).toBe(1);
    expect((await told("daniel@2mg.test", "team_stop")).filter((one) => one.title.includes("has not moved")).length).toBe(
      (await told("daniel@2mg.test", "team_stop")).filter((one) => one.title.includes("has not moved")).length,
    );
    // Before 8 in the morning the CEO isn't told yet.
    await db.execute(sql`delete from notification where kind = 'morning_summary'`);
    expect((await runAutomations(db, new Date(`${todayManila()}T21:00:00Z`))).morning).toBe(0);
    // Only told: the order is still where it was.
    const [order] = await rows<{ status: string }>(db, sql`select status from sales_order where id = ${placed.id}`);
    expect(order?.status).toBe("pending_approval");
  });

  it("tell the MedRep of a licence about to expire", async () => {
    const [area] = await rows<{ areaId: number }>(
      db,
      sql`select s.area_id::int as "areaId" from seat s join seat_holder h on h.seat_id = s.id and h.ends_on is null
        join person p on p.id = h.person_id where p.email = 'ryan@2mg.test' and s.area_id is not null limit 1`,
    );
    const soon = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    const id = ((await (await post("sarla", "/api/customers", { kind: "drugstore", name: "Licence Soon Pharmacy", city: "Pasay", licenceNo: "LTO-1", licenceExpires: soon, areaId: area?.areaId })).json()) as { id: number }).id;
    expect(id).toBeGreaterThan(0);
    await runAutomations(db);
    expect((await told("ryan@2mg.test", "licence_expiring")).some((one) => one.title.includes("Licence Soon Pharmacy"))).toBe(true);
  });
});
