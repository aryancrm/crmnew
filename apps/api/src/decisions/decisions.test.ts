// To decide (ERP phase 2): what waits on each person, from each desk's own list, and what the
// person asked others for.

import { beforeAll, describe, expect, it } from "vitest";
import { ticked } from "../testing/approve";
import { createApp } from "../app";
import { sql } from "drizzle-orm";
import { type Database, openDatabase, rows as dbRows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedFixture } from "../inventory/fixture";
import { seedDemo } from "../seed";
import type { AuditTrail, Catalogue, Decisions, Insight } from "../types";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};

const read = async <T>(who: string, path: string) =>
  (await (await app.request(path, { headers: { cookie: cookies[who] as string } })).json()) as T;
const post = (who: string, path: string, body: unknown = {}) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookies[who] as string },
    body: JSON.stringify(body),
  });
const rows_ = (text: string) => dbRows<{ n: number }>(db, sql.raw(text));
const line = (list: Decisions["forMe"], key: string) => list.find((one) => one.key === key)?.count ?? 0;

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  await seedFixture(db);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["ryan", "sarla", "fiona", "marco", "naresh", "daniel"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
});

describe("to decide", () => {
  it("puts an order on Management's list, then on Finance's, and never on the MedRep's", async () => {
    const before = await read<Decisions>("sarla", "/api/decisions");
    const catalogue = await read<Catalogue>("sarla", "/api/inventory/medicines");
    const row = catalogue.rows.find((item) => item.prices.hospital !== undefined && item.total >= 100);
    const customer = ((await (await post("sarla", "/api/customers", { kind: "hospital", name: "Decide General", city: "Pasay", paymentTerms: "days", paymentDays: 30 })).json()) as { id: number }).id;
    const placed = (await (await post("ryan", "/api/orders", { customerId: customer, items: [{ medicineId: row?.id, qty: 5, priceKind: "hospital" }] })).json()) as { id: number };
    const after = await read<Decisions>("sarla", "/api/decisions");
    expect(line(after.forMe, "awaiting")).toBe(line(before.forMe, "awaiting") + 1);
    expect(after.forMe.find((one) => one.key === "awaiting")?.to).toBe("/orders/check");
    expect(after.total).toBeGreaterThan(0);
    // The MedRep decides none of it; Finance has nothing of it yet.
    expect(line((await read<Decisions>("ryan", "/api/decisions")).forMe, "awaiting")).toBe(0);
    const financeBefore = line((await read<Decisions>("fiona", "/api/decisions")).forMe, "toInvoice");
    expect((await post("sarla", await ticked(db, `/api/orders/${placed.id}/approve`), { finance: true })).status).toBe(200);
    expect(line((await read<Decisions>("sarla", "/api/decisions")).forMe, "awaiting")).toBe(line(before.forMe, "awaiting"));
    const finance = await read<Decisions>("fiona", "/api/decisions");
    expect(line(finance.forMe, "toInvoice") + line(finance.forMe, "toConfirm")).toBeGreaterThan(financeBefore);
  });

  it("shows a leave asked: on the lead's list to approve, on the person's as asked", async () => {
    // A weekday three weeks ahead.
    let day = new Date(Date.now() + 21 * 86_400_000);
    while ([0, 6].includes(day.getUTCDay())) day = new Date(day.getTime() + 86_400_000);
    const iso = day.toISOString().slice(0, 10);
    // A week, so a holiday that day still leaves working days in it.
    const until = new Date(day.getTime() + 6 * 86_400_000).toISOString().slice(0, 10);
    const body = new FormData();
    for (const [key, value] of Object.entries({ kind: "lwop", from: iso, to: until, reason: "Family" })) body.set(key, value);
    const asked = await app.request("/api/hr/leave/request", { method: "POST", headers: { cookie: cookies.ryan as string }, body });
    expect(asked.status, await asked.clone().text()).toBe(200);
    expect(line((await read<Decisions>("ryan", "/api/decisions")).mine, "my-leave")).toBe(1);
    const lead = await read<Decisions>("daniel", "/api/decisions");
    expect(line(lead.forMe, "leave")).toBe(1);
    expect(lead.forMe.find((one) => one.key === "leave")?.to).toBe("/hr/leave");
  });
  it("keeps who did what in the audit, for the CEO and the Admin only", async () => {
    const trail = await read<AuditTrail>("naresh", "/api/audit?kind=order");
    expect(trail.lines.length).toBeGreaterThan(0);
    expect(trail.lines.every((one) => one.kind === "order" && one.link?.startsWith("/orders/"))).toBe(true);
    const ryans = await read<AuditTrail>("naresh", "/api/audit?who=Ryan");
    expect(ryans.lines.every((one) => one.who.includes("Ryan"))).toBe(true);
    expect((await app.request("/api/audit", { headers: { cookie: cookies.ryan as string } })).status).toBe(403);
    expect((await app.request("/api/audit", { headers: { cookie: cookies.sarla as string } })).status).toBe(403);
  });
  it("gives the old CRM's insight reports to the desks they serve", async () => {
    for (const key of ["sales-trend", "sales-by-branch", "top-medicines", "stock-aging", "stock-turnover", "abc", "purchases", "cases", "senior-pwd"]) {
      const response = await app.request(`/api/books/insights/${key}`, { headers: { cookie: cookies.naresh as string } });
      expect(response.status, key).toBe(200);
      const report = (await response.json()) as Insight;
      expect(report.columns.length, key).toBeGreaterThan(1);
    }
    // The stock on the fixture's shelves, at cost.
    const stock = await read<Insight>("naresh", "/api/books/insights/stock-aging");
    expect(stock.rows.length).toBeGreaterThan(0);
    expect(Number(stock.totals.value)).toBeGreaterThan(0);
    // The order billed above shows among the top medicines.
    const top = await read<Insight>("sarla", "/api/books/insights/top-medicines");
    expect(top.rows.length).toBeGreaterThan(0);
    expect((await app.request("/api/books/insights/top-medicines", { headers: { cookie: cookies.ryan as string } })).status).toBe(403);
    expect((await app.request("/api/books/insights/stock-aging", { headers: { cookie: cookies.marco as string } })).status).toBe(403);
    expect((await app.request("/api/books/insights/nothing", { headers: { cookie: cookies.naresh as string } })).status).toBe(404);
  });
  it("imports customers from a sheet: checked first without keeping anything, then kept", async () => {
    const rows = [
      { Name: "Sheet Hospital One", Type: "Hospital", City: "Makati", Mobile: "09171230001" },
      { Name: "No Kind Clinic", City: "Pasig" },
      { Name: "Sheet Hospital Two", Type: "hospital", City: "Taguig", Mobile: "0917 123 0001" },
    ];
    const count = async () => (await rows_(`select count(*)::int as n from customer where name like 'Sheet Hospital%'`))[0]?.n;
    const check = (await (await post("sarla", "/api/customers/import", { rows })).json()) as { applied: boolean; results: { ok: boolean; message: string | null }[] };
    expect(check.applied).toBe(false);
    expect(check.results.map((one) => one.ok)).toEqual([true, false, false]);
    expect(check.results[1]?.message).toMatch(/kind/);
    expect(await count()).toBe(0);
    const done = (await (await post("sarla", "/api/customers/import", { rows, apply: true })).json()) as { added: number };
    expect(done.added).toBe(1);
    expect(await count()).toBe(1);
    expect((await post("ryan", "/api/customers/import", { rows })).status).toBe(403);
  });
});
