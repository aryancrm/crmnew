import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedDemoTeam } from "../orders/seed-team";
import { seedDemo } from "../seed";
import type { CareGroups, Pulse, Reorders, RxField } from "../types";
import { seedRxTeam } from "./seed";

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
  expect(await seedRxTeam(db, PASSWORD)).toBe(true);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["joy", "kim", "lara", "rosa", "ryan"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
});

describe("the Prescription channel", () => {
  it("care groups: the CHC enrols with consent, MD Telesales makes first contact, the heads see every group", async () => {
    const [doctor] = await rows<{ id: number }>(
      db,
      sql`insert into customer (name, kind, city, area_id, added_by) values ('Dr. Ramon Cruz', 'doctor', 'Cebu City',
        (select area_id from person where email = 'joy@2mg.test'), (select id from person where email = 'joy@2mg.test')) returning id::int as id`,
    );
    expect((await post("joy", "/api/care-groups", { doctorId: doctor?.id, patients: 2, consent: false })).status).toBe(400);
    expect((await post("kim", "/api/care-groups", { doctorId: doctor?.id, patients: 2, consent: true })).status).toBe(403);
    const made = (await (await post("joy", "/api/care-groups", { doctorId: doctor?.id, patients: 2, consent: true })).json()) as { id: number };
    expect((await post("joy", "/api/care-groups", { doctorId: doctor?.id, patients: 1, consent: true })).status).toBe(409);

    const kimSees = (await (await get("kim", "/api/care-groups")).json()) as CareGroups;
    expect(kimSees.rows.find((row) => row.id === made.id)?.state).toBe("waiting");
    expect(kimSees.can.contact).toBe(true);
    expect((await post("joy", `/api/care-groups/${made.id}/contact`, {})).status).toBe(403);
    expect((await post("kim", `/api/care-groups/${made.id}/contact`, {})).status).toBe(200);
    expect((await post("kim", `/api/care-groups/${made.id}/contact`, {})).status).toBe(409);
    const joySees = (await (await get("joy", "/api/care-groups")).json()) as CareGroups;
    expect(joySees.rows.find((row) => row.id === made.id)).toMatchObject({ telesales: "Kim", state: "active" });
    expect(joySees.counts.contactedInTime).toBeGreaterThanOrEqual(1);
    for (const head of ["lara", "rosa"]) {
      const all = (await (await get(head, "/api/care-groups")).json()) as CareGroups;
      expect(all.rows.length).toBeGreaterThanOrEqual(3);
    }
    expect((await get("ryan", "/api/care-groups")).status).toBe(403);
    // Every group carries the CHC's seat, so it stays in the Prescription business.
    const [seats] = await rows<{ n: number }>(db, sql`select count(*)::int as n from care_group where seat_id is null`);
    expect(seats?.n).toBe(0);
  });

  it("MD Telesales: their pulse, and refills coming due in two days with what they took", async () => {
    const pulse = (await (await get("kim", "/api/my/pulse")).json()) as Pulse;
    expect(pulse.tiles.map((tile) => tile.key)).toEqual(["sales", "refills", "groups", "invoice"]);
    const soon = (await (await get("kim", "/api/my/reorders?state=soon")).json()) as Reorders;
    expect(soon.rows.map((row) => row.name)).toContain("Lourdes Ramos");
    expect(soon.rows[0]?.lastItems).toContain("Letrozole");
    const due = (await (await get("kim", "/api/my/reorders?state=due")).json()) as Reorders;
    expect(due.rows.map((row) => row.name)).toContain("Ernesto Bautista");
  });

  it("the Country Mentor's field team: each Rx CHC, and a seller can't open it", async () => {
    const field = (await (await get("rosa", "/api/rx/field")).json()) as RxField;
    const joy = field.rows.find((row) => row.name === "Joy");
    expect(joy).toBeTruthy();
    expect(joy?.groupsEnrolled).toBeGreaterThanOrEqual(1);
    expect((await get("kim", "/api/rx/field")).status).toBe(403);
  });
});
