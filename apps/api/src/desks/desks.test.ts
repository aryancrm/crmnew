import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedFixture } from "../inventory/fixture";
import { seedDemo } from "../seed";
import type { DeskDuty, DeskReport } from "../types";

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
  it("shares the waiting orders among the people started, each acting in their own name", async () => {
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

    const idOf = async (name: string) =>
      (await rows<{ id: number }>(db, sql`select id::int as id from person where name = ${name}`))[0]?.id as number;
    const start = (who: string, person: string, desk: string, on = true) =>
      idOf(person).then((id) => post(who, `/api/desk/${desk}/people/${id}/start`, { on }));

    // Nobody started: the order waits for anyone, as before.
    const first = await place();
    expect((await ownerOf(first))?.manage).toBeNull();
    expect((await start("ryan", "Sarla", "management")).status).toBe(403);

    // On the common screen Sarla and Kate press Start: the waiting orders are shared between them.
    expect((await start("sarla", "Sarla", "management")).status).toBe(200);
    expect((await start("sarla", "Kate", "management")).status).toBe(403); // not for someone else
    expect((await start("kate", "Kate", "management")).status).toBe(200);
    const second = await place();
    expect([(await ownerOf(first))?.manage, (await ownerOf(second))?.manage].sort()).toEqual(["Kate", "Sarla"]);
    const team = (await (await get("sarla", "/api/desk/management/team")).json()) as DeskDuty;
    expect(team.canStart).toBe(true);
    expect(team.people.filter((one) => one.startedAt).map((one) => [one.name, one.open])).toEqual([["Kate", 1], ["Sarla", 1]]);
    expect((await get("ryan", "/api/desk/management/team")).status).toBe(403);

    // Each approves on their own login, in their own name.
    const kates = (await ownerOf(first))?.manage === "Kate" ? first : second;
    const sarlas = kates === first ? second : first;
    expect((await post("kate", `/api/orders/${kates}/approve`)).status).toBe(200);
    const [approved] = await rows<{ by: string }>(
      db,
      sql`select p.name as by from sales_order o join person p on p.id = o.approved_by where o.id = ${kates}`,
    );
    expect(approved?.by).toBe("Kate");

    // Kate stops: what she still had goes to Sarla; a new order goes to Sarla too.
    const third = await place();
    if ((await ownerOf(third))?.manage === "Kate") {
      await start("sarla", "Kate", "management", false);
      expect((await ownerOf(third))?.manage).toBe("Sarla");
    } else await start("sarla", "Kate", "management", false);
    expect((await ownerOf((await place()) as number))?.manage).toBe("Sarla");

    // At Finance: Fiona starts, and the approved order is hers there.
    expect((await start("fiona", "Fiona", "finance")).status).toBe(200);
    expect((await ownerOf(kates))?.finance).toBe("Fiona");
    expect((await post("sarla", `/api/orders/${sarlas}/approve`)).status).toBe(200);
    expect((await ownerOf(sarlas))?.finance).toBe("Fiona");
    const timeline = await rows<{ message: string }>(db, sql`select message from order_event where order_id = ${kates} order by at, id`);
    expect(timeline.map((one) => one.message)).toEqual(expect.arrayContaining(["Given to Fiona (Finance)."]));
    expect((await post("ryan", `/api/finance/orders/${kates}/take`, {})).status).toBe(403);

    // Each person's figures for today: given, done in their name, open now.
    const report = (await (await get("sarla", "/api/desk/management/report")).json()) as DeskReport;
    const kate = report.people.find((one) => one.name === "Kate");
    const sarla = report.people.find((one) => one.name === "Sarla");
    expect(kate).toMatchObject({ done: 1, given: expect.any(Number) });
    expect((kate?.given ?? 0) + (sarla?.given ?? 0)).toBeGreaterThanOrEqual(3);
    expect(sarla?.done).toBe(1);
    expect(kate?.open).toBe(0);
    expect(typeof kate?.hours).toBe("number");
    expect((await get("ryan", "/api/desk/management/report")).status).toBe(403);
    const finance = (await (await get("fiona", "/api/desk/finance/report")).json()) as DeskReport;
    expect(finance.people.find((one) => one.name === "Fiona")?.given).toBeGreaterThanOrEqual(2);
  });
});
