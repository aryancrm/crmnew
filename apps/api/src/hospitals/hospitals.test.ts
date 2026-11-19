// The hospitals board (19 Nov): each hospital a seller has, 2MG's accreditation there (expiring
// within 60 days flagged), our medicines on its formulary, its buying, orders, money, visits.

import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { addDays, todayManila } from "../inventory/rules";
import { seedFixture } from "../inventory/fixture";
import { seedDemo } from "../seed";
import type { HospitalBoard } from "../types";

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
  await seedFixture(db);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["ryan", "daniel", "sarla"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
});

describe("the hospitals board", () => {
  it("lists a CHC's hospitals with accreditation, formulary, money and buying; their lead sees them too", async () => {
    // A hospital in Ryan's area.
    const [area] = await rows<{ id: number }>(db, sql`select area_id::int as id from person where email = 'ryan@2mg.test'`);
    const [hospital] = await rows<{ id: number }>(
      db,
      sql`insert into customer (kind, name, city, area_id, added_by) values ('hospital', 'Board Test Hospital', 'Pasay', ${area?.id}, (select id from person order by id limit 1))
        returning id::int as id`,
    );
    const mine = (await (await get("ryan", "/api/hospitals")).json()) as HospitalBoard;
    expect(mine.rows.find((row) => row.customerId === hospital?.id)).toMatchObject({
      seller: expect.stringMatching(/^Ryan/),
      reorder: "never",
      accreditation: { state: "none" },
    });
    // Accredited until a day within 60 days: expiring.
    const until = addDays(todayManila(), 30);
    expect((await post("ryan", "/api/hospitals/accreditation", { customerId: hospital?.id, status: "accredited", validUntil: until })).status).toBe(200);
    expect((await post("ryan", "/api/hospitals/accreditation", { customerId: hospital?.id, status: "refused" })).status).toBe(400);
    // Two medicines: one requested by a doctor, one approved by the P&T committee.
    expect((await post("ryan", "/api/hospitals/formulary", { customerId: hospital?.id, medicineId: 1, status: "requested", doctor: "Dr. Cruz" })).status).toBe(200);
    expect((await post("ryan", "/api/hospitals/formulary", { customerId: hospital?.id, medicineId: 2, status: "requested" })).status).toBe(200);
    expect((await post("ryan", "/api/hospitals/formulary", { customerId: hospital?.id, medicineId: 2, status: "approved" })).status).toBe(200);
    const after = (await (await get("ryan", "/api/hospitals")).json()) as HospitalBoard;
    const row = after.rows.find((one) => one.customerId === hospital?.id);
    expect(row?.accreditation).toMatchObject({ status: "accredited", validUntil: until, daysLeft: 30, state: "expiring" });
    expect(row?.formulary).toMatchObject({ approved: 1, requested: 1 });
    expect(row?.formulary.items.find((item) => item.status === "requested")?.doctor).toBe("Dr. Cruz");
    expect(after.summary).toMatchObject({ expiring: 1, formularyApproved: 1, formularyPending: 1 });
    // His team lead sees the same hospital on the team's board.
    const team = (await (await get("daniel", "/api/hospitals")).json()) as HospitalBoard;
    expect(team.rows.some((one) => one.customerId === hospital?.id)).toBe(true);
    // Not a hospital: refused.
    const [store] = await rows<{ id: number }>(
      db,
      sql`insert into customer (kind, name, added_by) values ('drugstore', 'Not A Hospital', (select id from person order by id limit 1)) returning id::int as id`,
    );
    expect((await post("ryan", "/api/hospitals/accreditation", { customerId: store?.id, status: "applied" })).status).toBe(400);
    // Management isn't a seller.
    expect((await get("sarla", "/api/hospitals")).status).toBe(403);
  });
});
