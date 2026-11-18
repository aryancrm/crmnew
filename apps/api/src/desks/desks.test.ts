import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedFixture } from "../inventory/fixture";
import { seedDemo } from "../seed";
import type { DeskDuty } from "../types";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
const get = (who: string, path: string) => app.request(path, { headers: { cookie: cookies[who] as string } });
const post = (who: string, path: string, body: unknown = {}) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookies[who] as string },
    body: JSON.stringify(body),
  });
const ownerOf = async (id: number) =>
  (
    await rows<{ manage: string | null; finance: string | null }>(
      db,
      sql`select m.name as manage, f.name as finance from sales_order o left join person m on m.id = o.manage_by
        left join person f on f.id = o.finance_by where o.id = ${id}`,
    )
  )[0];

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  await seedFixture(db);
  // A second person in Management, signing in with the same demo password.
  await db.execute(
    sql`insert into person (name, email, role, title, password_hash, active)
      select 'Kate', 'kate@2mg.test', 'management', 'Operations management', password_hash, true from person where name = 'Sarla'`,
  );
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["sarla", "kate", "fiona", "ryan"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
});

describe("on duty at Management and Finance", () => {
  it("gives each waiting order to one of the desk's people, fewest open first, someone on leave skipped", async () => {
    const customer = (await (
      await post("sarla", "/api/customers", { kind: "hospital", name: "Duty Hospital", city: "Pasay" })
    ).json()) as { id: number };
    const [medicine] = await rows<{ id: number }>(
      db,
      sql`select m.id::int as id from medicine m join medicine_price p on p.medicine_id = m.id and p.buyer_type = 'hospital' limit 1`,
    );
    const place = async () => {
      const response = await post("ryan", "/api/orders", {
        customerId: customer?.id,
        items: [{ medicineId: medicine?.id, qty: 2, priceKind: "hospital" }],
      });
      expect(response.status, await response.clone().text()).toBe(200);
      return ((await response.json()) as { id: number }).id;
    };

    // Each new order is given to one of Management's people, whoever has the fewest open.
    const first = await place();
    const second = await place();
    const names = [(await ownerOf(first))?.manage, (await ownerOf(second))?.manage].sort();
    expect(names).toEqual(["Kate", "Sarla"]);
    let team = (await (await get("sarla", "/api/desk/management/team")).json()) as DeskDuty;
    expect(team.mine).toBe(true);
    expect(team.unassigned).toBe(0);
    expect(team.people.map((one) => [one.name, one.open])).toEqual([["Kate", 1], ["Sarla", 1]]);
    expect((await get("ryan", "/api/desk/management/team")).status).toBe(403);

    // Kate is on leave today: her order goes to Sarla at the next move.
    const kateFirst = (await ownerOf(first))?.manage === "Kate" ? first : second;
    await db.execute(
      sql`insert into person_leave (person_id, kind, from_day, to_day, half_day, reason, status, made_by)
        select id, 'vl', (now() at time zone 'Asia/Manila')::date, (now() at time zone 'Asia/Manila')::date, false, 'Test', 'approved', id
        from person where name = 'Kate'`,
    );
    const third = await place();
    expect((await ownerOf(third))?.manage).toBe("Sarla");
    expect((await ownerOf(kateFirst))?.manage).toBe("Sarla");
    team = (await (await get("sarla", "/api/desk/management/team")).json()) as DeskDuty;
    expect(team.people.find((one) => one.name === "Kate")?.away).toBe(true);

    // Approved, it goes to Finance and is Fiona's there; she can let it go and take it back.
    expect((await post("sarla", `/api/orders/${first}/approve`)).status).toBe(200);
    expect((await ownerOf(first))?.finance).toBe("Fiona");
    const timeline = await rows<{ message: string }>(db, sql`select message from order_event where order_id = ${first} order by at, id`);
    expect(timeline.map((one) => one.message)).toEqual(expect.arrayContaining(["Given to Fiona (Finance)."]));
    expect((await post("ryan", `/api/finance/orders/${first}/take`, {})).status).toBe(403);
  });
});
