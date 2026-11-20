// Three bugs an outside review found (20 Nov), each kept from coming back:
// 1. A company total over ₱21.47M (2^31 centavos) stopped the dashboard ("integer out of range").
// 2. A seat held from today (Manila) was missed by the session while the database's own date was
//    still yesterday (00:00–08:00 Manila on a UTC database).
// 3. Looking as a desk person (read only) gave their desk's waiting orders out in their name.

import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { todayManila } from "../inventory/rules";
import { seedDemo } from "../seed";
import type { Me } from "../types";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
const ids: Record<string, number> = {};
const call = (who: string, path: string, method = "GET") =>
  app.request(path, { method, headers: { "content-type": "application/json", cookie: cookies[who] as string } });

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["naresh", "fiona", "ryan"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
    ids[name] = ((await response.json()) as { me: Me }).me.id;
  }
});

/** An order straight into the table (the line's rules are not what is tested here). */
let made = 0;
async function order(total: number, status: string): Promise<number> {
  made += 1;
  const [customer] = await rows<{ id: number }>(
    db,
    sql`insert into customer (name, kind, added_by) values (${`Review Test Hospital ${made}`}, 'hospital', ${ids.naresh}) returning id::int as id`,
  );
  const [placed] = await rows<{ id: number }>(
    db,
    sql`insert into sales_order (customer_id, medrep_id, raised_by, status, payment_terms, total, submitted_at)
      values (${customer?.id}, ${ids.ryan}, ${ids.ryan}, ${status}, 'days', ${total}, now()) returning id::int as id`,
  );
  return placed?.id as number;
}

describe("the review's three bugs", () => {
  it("a company total over ₱21.47M adds up instead of failing", async () => {
    // Two orders of ₱11M each today: ₱22M, past what a 32-bit number holds in centavos.
    await order(1_100_000_000, "pending_approval");
    await order(1_100_000_000, "pending_approval");
    const response = await call("naresh", "/api/orders/company-kpis");
    expect(response.status, await response.clone().text()).toBe(200);
    const body = JSON.stringify(await response.json());
    expect(body).toContain("2200000000");
  });

  it("a seat held from today in Manila counts, whatever date the database keeps", async () => {
    // The database's clock far west of Manila: its own date is Manila's yesterday most of the day.
    await db.execute(sql`set time zone 'Pacific/Honolulu'`);
    try {
      const today = todayManila();
      // The database's own date is behind Manila's (most of the day from Honolulu), so the bug shows.
      const [dates] = await rows<{ db: string }>(db, sql`select to_char(current_date, 'YYYY-MM-DD') as db`);
      // Ryan moves today (Manila) to a seat in another business: his old seat ends yesterday.
      const [seat] = await rows<{ id: number }>(
        db,
        sql`insert into seat (unit_id, title, module, lead)
          select u.id, 'Moved here today', 'medrep', false from org_unit u join channel c on c.id = u.channel_id
          where u.active and u.kind = 'business'
            and c.code is distinct from (select seat_business_channel(h.seat_id) from seat_holder h
              where h.person_id = ${ids.ryan} and h.ends_on is null limit 1)
          order by u.id limit 1 returning id::int as id`,
      );
      await db.execute(sql`update seat_holder set ends_on = ${today}::date - 1 where person_id = ${ids.ryan} and ends_on is null`);
      await db.execute(sql`insert into seat_holder (seat_id, person_id, kind, starts_on) values (${seat?.id}, ${ids.ryan}, 'holder', ${today}::date)`);
      const me = ((await (await call("ryan", "/api/me")).json()) as { me: Me }).me;
      const [expected] = await rows<{ business: string | null }>(db, sql`select seat_business_channel(${seat?.id}) as business`);
      expect(expected?.business).toBeTruthy();
      expect(me.business, `database date ${dates?.db}, Manila ${today}`).toBe(expected?.business);
    } finally {
      await db.execute(sql`set time zone 'UTC'`);
    }
  });

  it("looking as a desk person gives nothing out in their name", async () => {
    // The CEO looks as Fiona (his own press shares out what waits, in his name, as any press does).
    await db.execute(sql`insert into desk_shift (person_id, desk) values (${ids.fiona}, 'finance')`);
    const opened = await call("naresh", `/api/auth/view/${ids.fiona}`, "POST");
    expect(opened.status).toBe(200);
    const looking = opened.headers.getSetCookie().find((one) => one.startsWith("sid="))?.split(";")[0] as string;
    // Then an order comes to Finance with nobody's name on it.
    const waiting = await order(50_000, "finance_check");
    const owner = async () =>
      (await rows<{ by: number | null; given: number }>(
        db,
        sql`select finance_by::int as by, (select count(*)::int from order_assignment a where a.order_id = ${waiting}) as given
          from sales_order where id = ${waiting}`,
      ))[0];
    // Opening her desk while looking as her: read only, nothing given out.
    const seen = await app.request("/api/desk/finance/team", { headers: { cookie: looking } });
    expect(seen.status).toBe(200);
    expect(await owner()).toEqual({ by: null, given: 0 });
    // Fiona herself opening it shares it out as before.
    expect((await call("fiona", "/api/desk/finance/team")).status).toBe(200);
    expect((await owner())?.by).toBe(ids.fiona);
  });
});
