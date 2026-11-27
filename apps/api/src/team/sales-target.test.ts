// Sales vs target and one number everywhere (28 Nov, PLAN 272): each HQ's target, sold (without
// VAT), balance and today, as the team's sheet; Whole business, My KPIs and Targets give the very
// same sold and target.

import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { todayManila } from "../inventory/rules";
import { migrate } from "../db/migrate";
import { seedDemoTeam } from "../orders/seed-team";
import { seedRxTeam } from "../rx/seed";
import { seedDemo } from "../seed";
import type { SalesVsTarget, TargetList, TeamBoard } from "../types";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
const get = (who: string, path: string) => app.request(path, { headers: { cookie: cookies[who] as string } });
const read = async <T>(who: string, path: string) => (await (await get(who, path)).json()) as T;

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  await seedDemoTeam(db, PASSWORD);
  expect(await seedRxTeam(db, PASSWORD)).toBe(true);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["joy", "rosa"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
});

describe("sales vs target", () => {
  it("gives each HQ its target, sold without VAT, balance and today, the same as every other page", async () => {
    const [joy] = await rows<{ id: number; seat: number; customer: number }>(
      db,
      sql`select p.id::int as id, h.seat_id::int as seat,
          (select c.id::int from customer c where c.area_id = s.area_id order by c.id limit 1) as customer
        from person p join seat_holder h on h.person_id = p.id and h.kind = 'holder' and h.ends_on is null join seat s on s.id = h.seat_id
        where p.email = 'joy@2mg.test' limit 1`,
    );
    const today = todayManila();
    const month = today.slice(0, 7);
    // Joy's target for the month, and a Zoho invoice of today under her HQ's Zoho name: ₱11,200
    // with VAT, ₱10,000 without.
    await db.execute(sql`insert into sales_target (person_id, month, amount, set_by) values (${joy?.id}, ${`${month}-01`}::date, 5000000, ${joy?.id})
      on conflict (person_id, month) do update set amount = excluded.amount`);
    await db.execute(sql`insert into zoho_seller (name, seat_id) values ('RX | SVT JOY', ${joy?.seat})`);
    const [doc] = await rows<{ id: number }>(
      db,
      sql`insert into book_doc (kind, zoho_id, number, doc_date, due_date, status, customer_id, total, balance, fields)
        values ('invoice', 'z-svt-1', 'INV-SVT-1', ${today}::date, ${today}::date, 'sent', ${joy?.customer}, 1120000, 1120000,
          '{"Sales Person": "RX | SVT JOY"}'::jsonb) returning id::int as id`,
    );
    await db.execute(sql`insert into book_line (doc_id, n, item_name, qty, amount) values (${doc?.id}, 1, 'Test medicine 10 mg', 10, 1000000)`);

    const data = await read<SalesVsTarget>("rosa", "/api/team/sales-vs-target");
    const hq = data.channels.flatMap((one) => one.hqs).find((one) => one.seatId === joy?.seat);
    expect(hq).toMatchObject({ hq: "Cebu", person: "Joy", target: 5000000 });
    expect(hq?.sold).toBeGreaterThanOrEqual(1000000);
    expect(hq?.today).toBeGreaterThanOrEqual(1000000);
    // The channel and the team add up.
    for (const channel of data.channels) expect(channel.sold).toBe(channel.hqs.reduce((sum, one) => sum + one.sold, 0));
    expect(data.total.sold).toBe(data.channels.reduce((sum, one) => sum + one.sold, 0));
    expect(data.medicines.some((one) => one.name === "Test medicine 10 mg" && one.value === 1000000)).toBe(true);
    expect(data.daily.find((one) => one.day === today)?.sold).toBeGreaterThanOrEqual(1000000);

    // One number everywhere: Whole business's card, Targets and My KPIs say the same for Joy.
    const board = await read<TeamBoard>("rosa", "/api/team/board");
    expect(board.seats.find((one) => one.seatId === joy?.seat)?.sold).toBe(hq?.sold);
    const targets = await read<TargetList>("rosa", "/api/targets");
    expect(targets.rows.find((one) => one.personId === joy?.id)).toMatchObject({ sold: hq?.sold, target: 5000000 });
    const own = (await read<{ own: { sales: number; target: number | null } }>("joy", "/api/kpis/me")).own;
    expect(own).toMatchObject({ sales: hq?.sold, target: 5000000 });
    // The leads' view only.
    expect((await get("joy", "/api/team/sales-vs-target")).status).toBe(403);
  });
});
