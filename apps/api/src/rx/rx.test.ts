import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedDemoTeam } from "../orders/seed-team";
import { seedDemo } from "../seed";
import type { RxDay } from "../types";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
const get = (who: string, path: string) => app.request(path, { headers: { cookie: cookies[who] as string } });
const post = (who: string, path: string, body: unknown) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookies[who] as string },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  await seedDemoTeam(db, PASSWORD);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["joy", "ryan"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
});

describe("an Rx CHC's doctors", () => {
  it("are listed in tiers with visits due, a light each, and only the Rx CHC keeps the list", async () => {
    const [joy] = await rows<{ id: number }>(db, sql`select id::int as id from person where email = 'joy@2mg.test'`);
    const [doctor] = await rows<{ id: number }>(
      db,
      sql`insert into customer (name, kind, city, area_id, added_by)
        values ('Dr. Ana Lim', 'doctor', 'Cebu City', (select area_id from person where email = 'joy@2mg.test'), ${joy?.id}) returning id::int as id`,
    );
    const before = (await (await get("joy", "/api/rx/day")).json()) as RxDay;
    expect(before.doctors.find((one) => one.customerId === doctor?.id)?.tier).toBeNull();
    expect((await post("joy", "/api/rx/doctors", { customerId: doctor?.id, tier: 1 })).status).toBe(200);
    const after = (await (await get("joy", "/api/rx/day")).json()) as RxDay;
    const listed = after.doctors.find((one) => one.customerId === doctor?.id);
    expect(listed).toMatchObject({ tier: 1, due: 4, visits: 0, light: "green" });
    expect(after.tiers[0]).toMatchObject({ tier: 1, doctors: 1, visitsDue: 4, visitsDone: 0 });
    // Moved to Tier 2, then off the list: the history stays.
    await post("joy", "/api/rx/doctors", { customerId: doctor?.id, tier: 2 });
    await post("joy", "/api/rx/doctors", { customerId: doctor?.id, tier: null });
    const [lines] = await rows<{ n: number; open: number }>(
      db,
      sql`select count(*)::int as n, count(*) filter (where ended_at is null)::int as open from doctor_list where customer_id = ${doctor?.id}`,
    );
    expect(lines).toEqual({ n: 2, open: 0 });
    expect((await get("ryan", "/api/rx/day")).status).toBe(403);
    expect((await post("ryan", "/api/rx/doctors", { customerId: doctor?.id, tier: 1 })).status).toBe(403);
  });
});
