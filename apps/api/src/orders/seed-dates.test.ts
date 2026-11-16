// The demo company's money tells a believable story: no invoice is dated before its order, no
// payment before its invoice, and the long-overdue invoice belongs to an order delivered long ago.

import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { seedDemoCustomers } from "../customers/seed";
import { openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedDemoDispatch } from "../dispatch/seed";
import { seedDemoFinance } from "../finance/seed";
import { todayManila } from "../inventory/rules";
import { seedDemoInventory } from "../inventory/seed";
import { seedDemoOnline } from "../online/seed";
import { seedDemo } from "../seed";
import { seedDemoOrders } from "./seed";
import { seedDemoTeam } from "./seed-team";
import { alignDemoMoneyDates } from "./seed-times";

it("dates every demo invoice after its order, and keeps a truly late one", async () => {
  const db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, "test-password-1");
  await seedDemoInventory(db);
  await seedDemoCustomers(db);
  await seedDemoOrders(db);
  await seedDemoFinance(db);
  await seedDemoDispatch(db);
  await seedDemoOnline(db);
  await seedDemoTeam(db, "test-password-1");
  const found = await rows<{
    status: string;
    placed: string;
    issued: string;
    delivered: string | null;
    due: string;
    paid: string | null;
  }>(
    db,
    sql`select o.status, (o.created_at at time zone 'Asia/Manila')::date::text as placed, i.issued_on::text as issued,
        o.delivered_on::text as delivered, i.due_on::text as due,
        (select min(p.paid_on)::text from payment p where p.invoice_id = i.id and p.active) as paid
      from invoice i join sales_order o on o.id = i.order_id`,
  );
  expect(found.length).toBeGreaterThan(3);
  for (const one of found) {
    expect(one.issued >= one.placed, JSON.stringify(one)).toBe(true);
    if (one.paid) expect(one.paid >= one.issued, JSON.stringify(one)).toBe(true);
    if (one.delivered) expect(one.delivered >= one.placed, JSON.stringify(one)).toBe(true);
  }
  // A completed credit order delivered long ago, its invoice past due.
  expect(found.some((one) => one.status === "completed" && one.due < todayManila())).toBe(true);
  // Running it again changes nothing.
  expect(await alignDemoMoneyDates(db)).toBe(0);
  // It seeds the whole demo inside the test: give it room when the full suite runs at once.
}, 90_000);
