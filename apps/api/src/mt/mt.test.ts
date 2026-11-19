import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { addDays, todayManila } from "../inventory/rules";
import { seedDemoInventory } from "../inventory/seed";
import { seedDemo } from "../seed";
import type { MtDay } from "../types";
import { seedModernTrade } from "./seed";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
const get = (who: string, path: string) => app.request(path, { headers: { cookie: cookies[who] as string } });
const post = (who: string, path: string, body: unknown) =>
  app.request(path, { method: "POST", headers: { "content-type": "application/json", cookie: cookies[who] as string }, body: JSON.stringify(body) });

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  await seedDemoInventory(db);
  expect(await seedModernTrade(db, PASSWORD)).toBe(true);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["malou", "ryan", "naresh"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
});

describe("Modern Trade", () => {
  it("the COO's chains against their own gap, their listings, and a change kept as a new line", async () => {
    const day = (await (await get("malou", "/api/mt/day")).json()) as MtDay;
    const state = Object.fromEntries(day.chains.map((c) => [c.name, c.state]));
    expect(state).toMatchObject({ "Mercury Drug Corporation (head office)": "ok", "Watsons Personal Care Stores": "late" });
    const mercury = day.listings.filter((l) => l.chain.startsWith("Mercury"));
    expect(mercury.length).toBe(3);
    const first = mercury[0];
    expect((await post("malou", "/api/mt/listings", { customerId: first?.customerId, medicineId: 1, branches: 150, listed: true })).status).toBe(200);
    const after = (await (await get("malou", "/api/mt/day")).json()) as MtDay;
    expect(after.listings.filter((l) => l.chain.startsWith("Mercury")).length).toBe(3);
    expect((await get("ryan", "/api/mt/day")).status).toBe(403);
    expect((await get("naresh", "/api/mt/day")).status).toBe(200);
  });

  it("each chain's money with Modern Trade, what it deducted and sent back; a chain invoiced outside its areas; the seats", async () => {
    const [malou] = await rows<{ id: number; seat: number }>(
      db,
      sql`select p.id::int as id, h.seat_id::int as seat from person p join seat_holder h on h.person_id = p.id and h.kind = 'holder'
        where p.email = 'malou@2mg.test' limit 1`,
    );
    const [watsons] = await rows<{ id: number }>(db, sql`select id::int as id from customer where name = 'Watsons Personal Care Stores'`);
    const today = todayManila();
    const first = `${today.slice(0, 7)}-01`;
    // This CRM: an order to Watsons invoiced this month (₱1,000), ₱600 settled of it: ₱550 by bank
    // and ₱50 the chain deducted as a listing fee; one return of expired goods credited ₱30.
    const [order] = await rows<{ id: number }>(
      db,
      sql`insert into sales_order (customer_id, medrep_id, raised_by, status, payment_terms, seat_id, total)
        values (${watsons?.id}, ${malou?.id}, ${malou?.id}, 'completed', 'days', ${malou?.seat}, 100000) returning id::int as id`,
    );
    const [invoice] = await rows<{ id: number }>(
      db,
      sql`insert into invoice (code, order_id, customer_id, invoice_from, terms, issued_on, due_on, total, paid, by_person, status)
        values ('INV-MT-1', ${order?.id}, ${watsons?.id}, '2mg', 'days', ${first}::date, ${addDays(today, 30)}::date, 100000, 60000, ${malou?.id}, 'open')
        returning id::int as id`,
    );
    for (const [amount, method, kind] of [
      [55000, "bank", null],
      [5000, "deduction", "listing_fee"],
    ] as const)
      await db.execute(
        sql`insert into payment (invoice_id, customer_id, amount, method, deduction_kind, paid_on, by_person)
          values (${invoice?.id}, ${watsons?.id}, ${amount}, ${method}, ${kind}, ${today}::date, ${malou?.id})`,
      );
    await db.execute(
      sql`insert into sales_return (code, order_id, reason, requested_by, status, credit, credited_at)
        values ('RT-MT-1', ${order?.id}, 'expired', ${malou?.id}, 'received', 3000, now())`,
    );
    // Zoho: a Mercury branch outside Modern Trade's areas, its order and invoice under Modern
    // Trade's Zoho salesperson.
    await db.execute(sql`insert into zoho_seller (name, seat_id) values ('MT | TEST', ${malou?.seat})`);
    const [branch] = await rows<{ id: number }>(
      db,
      sql`insert into customer (name, kind, added_by) values ('Mercury Drug Test Branch', 'drugstore', ${malou?.id}) returning id::int as id`,
    );
    await db.execute(
      sql`insert into past_order (zoho_id, code, customer_id, ordered_on, status, total, seller)
        values ('MT-SO1', 'SO-MT-Z1', ${branch?.id}, ${first}::date, 'closed', 20000, 'MT | TEST')`,
    );
    await db.execute(
      sql`insert into book_doc (kind, zoho_id, number, doc_date, due_date, status, customer_id, total, balance, fields)
        values ('invoice', 'MT-Z1', 'INV-Z1', ${first}::date, ${addDays(first, 30)}::date, 'sent', ${branch?.id}, 20000, 20000,
          ${JSON.stringify({ "Sales Person": "MT | TEST" })}::jsonb)`,
    );
    const day = (await (await get("malou", "/api/mt/day")).json()) as MtDay;
    expect(day.money.find((one) => one.customerId === watsons?.id)).toMatchObject({
      seller: "Malou",
      soldMonth: 100000,
      owed: 40000,
      deducted: 5000,
      returns: 1,
      returnsCredit: 3000,
    });
    expect(day.deductions).toEqual([{ kind: "listing_fee", count: 1, amount: 5000 }]);
    expect(day.returns).toEqual([{ reason: "expired", count: 1, credit: 3000 }]);
    expect(day.chains.some((one) => one.customerId === branch?.id)).toBe(true);
    expect(day.money.find((one) => one.customerId === branch?.id)).toMatchObject({ soldMonth: 20000, owed: 20000 });
    expect(day.seats.find((one) => one.seatId === malou?.seat)).toMatchObject({ lead: true, name: "Malou", soldMonth: 120000, owed: 60000 });
  });
});
