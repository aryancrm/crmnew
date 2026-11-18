// The target sheet in one click: each row's target, what it achieved from the invoices (VAT out)
// by its Zoho name or its seat, the day's invoicing, and what sold under no row.

import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { todayManila } from "../inventory/rules";
import { seedDemo } from "../seed";
import type { TargetSheet } from "../types";
import { SHEET_2026_11 } from "./target-sheet-2026-11";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["naresh", "ryan"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
});

describe("target sheet", () => {
  it("the November sheet adds up to the company's grand total", () => {
    expect(SHEET_2026_11.reduce((sum, row) => sum + row.target, 0)).toBe(57_642_166);
    expect(SHEET_2026_11.length).toBe(57);
  });

  it("each row's achieved comes from Zoho's invoices under its names, VAT out; the rest apart", async () => {
    const today = todayManila();
    const month = `${today.slice(0, 7)}-01`;
    await db.execute(sql`insert into target_sheet_row (month, sort, head, channel, manager, salesperson, zoho_names, hq, target)
      values (${month}::date, 1, 'Javed', 'RX Business', 'Honey', 'RX | GIENEL', array['RX | NCL'], 'NCL', 200000000),
             (${month}::date, 2, 'Javed', 'RX Business', 'Honey', 'RX | SEAN', array['RX | SL NORTH'], 'SL NORTH', 100000000)`);
    const [customer] = await rows<{ id: number }>(db, sql`select id::int as id from customer order by id limit 1`);
    const invoice = async (salesperson: string, amount: number, number: string) => {
      const [doc] = await rows<{ id: number }>(
        db,
        sql`insert into book_doc (kind, number, doc_date, status, customer_id, party_name, currency, fx_rate, total, balance, fields, zoho_id)
          values ('invoice', ${number}, ${today}::date, 'open', ${customer?.id ?? null}, 'Test', 'PHP', 1, ${amount}, ${amount}, ${JSON.stringify({ "Sales Person": salesperson })}::jsonb, ${`z-${number}`})
          returning id::int as id`,
      );
      await db.execute(sql`insert into book_line (doc_id, n, item_name, qty, rate, amount) values (${doc?.id}, 1, 'Medicine', 1, ${amount / 100}, ${amount})`);
    };
    await invoice("RX | NCL", 50_000_00, "T-1");
    await invoice("RX  |  ncl", 25_000_00, "T-2");
    await invoice("RX | TAFT", 10_000_00, "T-3");
    const response = await app.request(`/api/target-sheet?month=${today.slice(0, 7)}&day=${today}`, { headers: { cookie: cookies.naresh as string } });
    expect(response.status, await response.clone().text()).toBe(200);
    const sheet = (await response.json()) as TargetSheet;
    expect(sheet.rows.map((row) => [row.salesperson, row.target, row.ach, row.today])).toEqual([
      ["RX | GIENEL", 200000000, 75_000_00, 75_000_00],
      ["RX | SEAN", 100000000, 0, 0],
    ]);
    expect(sheet.apart).toEqual([{ name: "RX | TAFT", ach: 10_000_00, today: 10_000_00 }]);
    // A MedRep doesn't see the company's sheet.
    expect((await app.request("/api/target-sheet", { headers: { cookie: cookies.ryan as string } })).status).toBe(403);
  });
});
