// Sales calls and the daily sales performance (the B2B team's end-of-day report): a call is logged by
// the person and seen up their line; revenue is each line before VAT; TLB and billing efficiency
// count each SKU or customer once (for the team too); weeks are fixed (1st–7th, 8th–14th…); the
// Excel file opens.

import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { todayManila } from "../inventory/rules";
import { seedDemo } from "../seed";
import type { CallList, SalesPerformance } from "../types";
import { weekOf } from "./performance";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
const month = todayManila().slice(0, 7);
const on = (d: number) => `${month}-${String(d).padStart(2, "0")}`;

const get = (who: string, path: string) => app.request(path, { headers: { cookie: cookies[who] as string } });
const read = async <T>(who: string, path: string) => {
  const response = await get(who, path);
  expect(response.status, `${who} ${path}: ${await response.clone().text()}`).toBe(200);
  return (await response.json()) as T;
};
const post = (who: string, path: string, body: unknown) =>
  app.request(path, { method: "POST", headers: { "content-type": "application/json", cookie: cookies[who] as string }, body: JSON.stringify(body) });

/** A Zoho invoice for a salesperson, with its lines (amounts in pesos, before VAT as Zoho's Item Total). */
async function zohoInvoice(n: number, day: string, seller: string, customer: string, lines: [sku: string, pesos: number][]) {
  const total = lines.reduce((s, [, p]) => s + p * 100, 0);
  const [doc] = await rows<{ id: number }>(
    db,
    sql`insert into book_doc (kind, zoho_id, number, doc_date, status, party_name, total, balance, fields)
      values ('invoice', ${`T${n}`}, ${`INV-T${n}`}, ${day}::date, 'sent', ${customer}, ${total}, ${total}, ${JSON.stringify({ "Sales Person": seller })}::jsonb)
      returning id::int as id`,
  );
  for (const [at, [sku, pesos]] of lines.entries())
    await db.execute(sql`insert into book_line (doc_id, n, sku, item_name, qty, amount) values (${doc?.id}, ${at + 1}, ${sku}, ${sku}, 1, ${pesos * 100})`);
}

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["ryan", "daniel", "jane", "sarla", "naresh", "marco"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
});

describe("sales calls", () => {
  it("are logged by the person who sells and seen up their line, not sideways", async () => {
    expect((await post("ryan", "/api/calls", { customerName: "Perez Pharmacy", outcome: "reached", note: "Will order Monday" })).status).toBe(200);
    expect((await post("ryan", "/api/calls", { outcome: "reached" })).status).toBe(400);
    expect((await post("marco", "/api/calls", { customerName: "X Pharmacy", outcome: "reached" })).status).toBe(403);
    const mine = await read<CallList>("ryan", "/api/calls");
    expect(mine.rows.map((r) => r.customer)).toEqual(["Perez Pharmacy"]);
    expect((await read<CallList>("daniel", "/api/calls")).rows).toHaveLength(1);
    expect((await read<CallList>("sarla", "/api/calls")).rows).toHaveLength(1);
    expect((await read<CallList>("jane", "/api/calls")).rows).toHaveLength(0);
  });
});

describe("daily sales performance", () => {
  it("adds the revenue before VAT, counts SKUs and customers once, by fixed weeks", async () => {
    expect([1, 7, 8, 14, 15, 28, 29, 31].map((d) => weekOf(on(d)))).toEqual([1, 1, 2, 2, 3, 4, 5, 5]);
    await zohoInvoice(1, on(2), "B2B | TEST SELLER", "Alpha Drug", [["SKU-1", 1000], ["SKU-2", 500]]);
    await zohoInvoice(2, on(3), "B2B | TEST SELLER", "Alpha Drug", [["SKU-1", 300]]);
    await zohoInvoice(3, on(9), "B2B | TEST SELLER", "Beta Drug", [["SKU-1", 200], ["SKU-3", 100]]);
    await zohoInvoice(4, on(9), "HOS | OTHER SELLER", "Gamma Hospital", [["SKU-1", 50]]);
    // A void one never counts.
    await zohoInvoice(5, on(9), "B2B | TEST SELLER", "Delta", [["SKU-9", 9999]]);
    await db.execute(sql`update book_doc set status = 'void' where zoho_id = 'T5'`);

    const report = await read<SalesPerformance>("naresh", `/api/sales-performance?from=${on(1)}&to=${on(14)}`);
    expect(report.weeks.map((w) => w.label)).toEqual(["W1", "W2"]);
    const seller = report.revenue.rows.find((r) => r.name === "B2B | TEST SELLER");
    expect(seller?.channel).toBe("B2B");
    expect(seller?.weeks).toEqual([180_000, 30_000]);
    expect(seller?.total).toBe(210_000);
    // TLB: SKU-1 and SKU-2 in W1, SKU-1 and SKU-3 in W2, three different in all.
    expect(report.tlb.rows.find((r) => r.key === seller?.key)?.weeks).toEqual([2, 2]);
    expect(report.tlb.rows.find((r) => r.key === seller?.key)?.total).toBe(3);
    // The team: SKU-1 sold by both counts once.
    expect(report.tlb.total.total).toBe(3);
    expect(report.billing.rows.find((r) => r.key === seller?.key)?.total).toBe(2);
    expect(report.billing.total.total).toBe(3);
    // Channels ranked, HOS read as HOSP, shares add to 100.
    expect(report.channels.rows.map((r) => [r.channel, r.rank])).toEqual([["B2B", 1], ["HOSP", 2]]);
    expect(report.channels.rows.reduce((s, r) => s + r.share, 0)).toBeCloseTo(100, 1);
    expect(report.days).toHaveLength(14);
    // Ryan's call (today) shows in the calls part, under his name, on its day.
    const toToday = await read<SalesPerformance>("naresh", `/api/sales-performance?from=${on(1)}&to=${todayManila()}`);
    expect(toToday.calls.total.total).toBe(1);
    expect(toToday.calls.rows.find((r) => r.total === 1)?.name).toBe("Ryan");

    // A MedRep sees only himself; Dispatch sees nothing.
    const own = await read<SalesPerformance>("ryan", `/api/sales-performance?from=${on(1)}&to=${on(14)}`);
    expect(own.revenue.rows.every((r) => r.key.startsWith("P"))).toBe(true);
    expect((await get("marco", "/api/sales-performance")).status).toBe(403);

    const file = await get("naresh", `/api/sales-performance/xlsx?from=${on(1)}&to=${on(14)}`);
    expect(file.status).toBe(200);
    const bytes = new Uint8Array(await file.arrayBuffer());
    expect(String.fromCharCode(bytes[0] as number, bytes[1] as number)).toBe("PK");
  });
});
