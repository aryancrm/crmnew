// The prescription business at a glance (19 Nov): prescriptions this month from this CRM's orders
// and Zoho's history (its salesperson tied to the seat), the doctors writing, the first-time ones,
// the guarantee letters by agency; a seller's own, their lead's team.

import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { todayManila } from "../inventory/rules";
import { seedDemoTeam } from "../orders/seed-team";
import { seedDemo } from "../seed";
import type { MyScore, RxBusiness } from "../types";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
const get = (who: string, path: string) => app.request(path, { headers: { cookie: cookies[who] as string } });

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  await seedDemoTeam(db, PASSWORD);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["joy", "sarla"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
});

describe("the prescription business", () => {
  it("counts this CRM's and Zoho's prescriptions, the doctors and first-timers, and the letters", async () => {
    const [joy] = await rows<{ id: number; seat: number }>(
      db,
      sql`select p.id::int as id, h.seat_id::int as seat from person p join seat_holder h on h.person_id = p.id and h.kind = 'holder'
        where p.email = 'joy@2mg.test' limit 1`,
    );
    const today = todayManila();
    // Zoho's history: Joy's Zoho salesperson tied to her seat; a doctor's order this month, one older
    // with another doctor (not a first-timer this month), and a DSWD letter.
    await db.execute(sql`insert into zoho_seller (name, seat_id) values ('RX | TEST JOY', ${joy?.seat})`);
    const [customer] = await rows<{ id: number }>(
      db,
      sql`insert into customer (name, kind, added_by) values ('Zoho Patient', 'patient', ${joy?.id}) returning id::int as id`,
    );
    for (const [code, doctor, day, source, total] of [
      ["SO-T1", "Dr. Old Writer", "2026-01-15", "Doctor order", 100000],
      ["SO-T2", "Dr. Old Writer", today, "Doctor order", 250000],
      ["SO-T3", "Dr. New Writer", today, "Patient order referred by doctor", 150000],
      ["SO-T4", null, today, "DSWD", 500000],
    ] as const)
      await db.execute(
        sql`insert into past_order (zoho_id, code, customer_id, ordered_on, status, total, seller, source, doctor)
          values (${code}, ${code}, ${customer?.id}, ${day}::date, 'confirmed', ${total}, 'RX | TEST JOY', ${source}, ${doctor})`,
      );
    const mine = (await (await get("joy", "/api/rx/business")).json()) as RxBusiness;
    const row = mine.people.find((one) => one.personId === joy?.id);
    expect(row).toMatchObject({ prescriptions: 2, prescribers: 2, newPrescribers: 1, value: 400000, letters: 1 });
    expect(mine.doctors.map((one) => one.name).sort()).toEqual(["Dr. New Writer", "Dr. Old Writer"]);
    expect(mine.letters.find((one) => one.programme === "DSWD")?.zoho).toEqual({ count: 1, amount: 500000 });
    // The CHC's own scorecard counts the same doctors (27 Nov, PLAN 254): one new prescribing doctor
    // this month (Dr. Old Writer first ordered in January), and the DSWD letter's order.
    const score = (await (await get("joy", "/api/scores")).json()) as MyScore;
    expect(score.card?.recipe).toBe("rx");
    const kpi = (key: string) => score.card?.kpis.find((one) => one.key === key)?.value;
    expect(kpi("nbd")).toBe(row?.newPrescribers);
    expect(kpi("nbd")).toBe(1);
    expect(kpi("pap")).toBe(1);
    // Management sells nothing: not theirs to read.
    expect((await get("sarla", "/api/rx/business")).status).toBe(403);
  });
});
