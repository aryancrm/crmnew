// Management reads an order's papers by hand (Aryan, 19 Nov: "a prescription has to be looked at,
// right or wrong: don't tick it automatically"): a paper on file is not "checked" until a Management
// person says so (kept with who and when); a MedRep can't say it; a new paper asks for a new look.

import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedFixture } from "../inventory/fixture";
import { seedDemo } from "../seed";
import { attachPaper } from "../testing/receipt";
import type { OrderDetail } from "../types";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};

const post = (who: string, path: string, body: unknown = {}) =>
  app.request(path, { method: "POST", headers: { "content-type": "application/json", cookie: cookies[who] as string }, body: JSON.stringify(body) });
const order = async (who: string, id: number) =>
  (await (await app.request(`/api/orders/${id}`, { headers: { cookie: cookies[who] as string } })).json()) as OrderDetail;

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

describe("Management's papers check", () => {
  it("is never ticked by the system: a person reads them and says so", async () => {
    const [medicine] = await rows<{ id: number }>(
      db,
      sql`select m.id::int as id from medicine m join medicine_price p on p.medicine_id = m.id and p.buyer_type = 'hospital' limit 1`,
    );
    const customer = (await (await post("sarla", "/api/customers", { kind: "hospital", name: "Papers Check Hospital", city: "Pasay" })).json()) as { id: number };
    const placed = await post("ryan", "/api/orders", { customerId: customer.id, items: [{ medicineId: medicine?.id, qty: 2, priceKind: "hospital" }] });
    expect(placed.status, await placed.clone().text()).toBe(200);
    const id = ((await placed.json()) as { id: number }).id;

    // Their PO on file: still not checked.
    expect(await attachPaper(app, cookies.ryan as string, id, "po")).toBe(200);
    expect((await order("sarla", id)).order.papersCheckedAt).toBeNull();

    // A MedRep can't say the papers are right; Management can, and it is kept with who.
    expect((await post("ryan", `/api/orders/${id}/papers-check`, { ok: true })).status).toBe(403);
    expect((await post("sarla", `/api/orders/${id}/papers-check`, { ok: true })).status).toBe(200);
    const checked = (await order("sarla", id)).order;
    expect(checked.papersCheckedAt).not.toBeNull();
    expect(checked.papersCheckedBy).toBe("Sarla");

    // A new paper asks for a new look.
    expect(await attachPaper(app, cookies.ryan as string, id, "other")).toBe(200);
    expect((await order("sarla", id)).order.papersCheckedAt).toBeNull();

    // Taken back, and on the timeline both times.
    expect((await post("sarla", `/api/orders/${id}/papers-check`, { ok: true })).status).toBe(200);
    expect((await post("sarla", `/api/orders/${id}/papers-check`, { ok: false })).status).toBe(200);
    const after = await order("sarla", id);
    expect(after.order.papersCheckedAt).toBeNull();
    expect(after.events.some((event) => event.message.startsWith("Papers checked by hand"))).toBe(true);
  });
});
