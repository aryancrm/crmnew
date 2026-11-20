import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { seedDemoCustomers } from "../customers/seed";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { todayManila } from "../inventory/rules";
import { seedDemoInventory } from "../inventory/seed";
import { seedDemoOrders } from "../orders/seed";
import { seedDemo } from "../seed";
import type { KpiPanel } from "../types";

// My KPIs, the hub's way (docs/PLAN.md 23): sales without VAT line by line against the target,
// the counts, the team summed, a day's sales.

const PASSWORD = "demo-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
const ids: Record<string, number> = {};

const panel = async (who: string, query = "") => {
  const response = await app.request(`/api/kpis/me${query}`, { headers: { cookie: cookies[who] as string } });
  expect(response.status).toBe(200);
  return (await response.json()) as KpiPanel;
};

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  await seedDemoInventory(db);
  await seedDemoCustomers(db);
  await seedDemoOrders(db);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["ryan", "daniel", "naresh"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
    const [person] = await rows<{ id: number }>(db, sql`select id::int as id from person where email = ${`${name}@2mg.test`}`);
    ids[name] = person?.id as number;
  }
});

describe("My KPIs", () => {
  it("a MedRep's own month: sales without VAT line by line, with VAT, the counts; no team", async () => {
    const mine = await panel("ryan");
    expect(mine.team).toBeNull();
    const own = mine.own as NonNullable<KpiPanel["own"]>;
    expect(own.sales).toBeGreaterThan(0);
    expect(own.withVat).toBeGreaterThanOrEqual(own.sales);
    expect(own.vat).toBe(Math.max(0, own.withVat - own.sales));
    // Without VAT is each invoiced line's amount ÷ 1.12 when it carries 12% VAT.
    const [lines] = await rows<{ net: number }>(
      db,
      sql`select coalesce(sum(round(oi.qty::numeric * oi.unit_price / case when coalesce(oi.vat_then, m.vat) = 'vat12' then 1.12 else 1 end)), 0)::float8 as net
        from invoice i join sales_order o on o.id = i.order_id join order_item oi on oi.order_id = o.id join medicine m on m.id = oi.medicine_id
        where i.status <> 'cancelled' and date_trunc('month', i.issued_on) = date_trunc('month', ${todayManila()}::date)
          and coalesce((select h.person_id from seat_holder h where h.seat_id = o.seat_id and h.kind = 'holder' and h.starts_on <= i.issued_on
            and (h.ends_on is null or h.ends_on >= i.issued_on) order by h.starts_on desc limit 1), o.medrep_id) = ${ids.ryan}`,
    );
    expect(own.sales).toBe(lines?.net);
    expect(own.ordersInvoiced).toBeGreaterThan(0);
    expect(own.percent).toBeNull();
  });

  it("% of target is sales without VAT ÷ target, one decimal", async () => {
    const first = `${todayManila().slice(0, 7)}-01`;
    await db.execute(
      sql`insert into sales_target (person_id, month, amount, set_by) values (${ids.ryan}, ${first}::date, 50000000, ${ids.daniel})
        on conflict (person_id, month) do update set amount = excluded.amount`,
    );
    const own = (await panel("ryan")).own as NonNullable<KpiPanel["own"]>;
    expect(own.target).toBe(50000000);
    expect(own.percent).toBe(Math.round((own.sales / 50000000) * 1000) / 10);
  });

  it("a lead's team is their own plus everyone under them, each order once; the CEO sees the company", async () => {
    const lead = await panel("daniel");
    const team = lead.team as NonNullable<KpiPanel["team"]>;
    const ryan = (await panel("ryan")).own as NonNullable<KpiPanel["own"]>;
    expect(team.label).toBe("My team");
    expect(team.people).toBeGreaterThanOrEqual(2);
    expect(team.sales).toBeGreaterThanOrEqual(ryan.sales);
    expect(team.target).toBeGreaterThanOrEqual(50000000);
    const company = await panel("naresh");
    expect(company.own).toBeNull();
    expect(company.team?.label).toBe("The company");
    expect(company.team?.sales).toBeGreaterThanOrEqual(team.sales);
  });

  it("a day adds that day's sales and the invoices behind them", async () => {
    const [last] = await rows<{ day: string }>(
      db,
      sql`select to_char(max(i.issued_on), 'YYYY-MM-DD') as day from invoice i join sales_order o on o.id = i.order_id
        where i.status <> 'cancelled' and o.medrep_id = ${ids.ryan}`,
    );
    const day = last?.day as string;
    const mine = await panel("ryan", `?day=${day}`);
    expect(mine.day).toBe(day);
    expect(mine.month).toBe(day.slice(0, 7));
    expect(mine.ownDay?.orders).toBe(mine.dayOrders.length);
    expect(mine.ownDay?.sales).toBe(mine.dayOrders.reduce((sum, row) => sum + row.sales, 0));
    // A month not yet started is refused.
    const response = await app.request("/api/kpis/me?month=2999-01", { headers: { cookie: cookies.ryan as string } });
    expect(response.status).toBe(400);
  });
});
