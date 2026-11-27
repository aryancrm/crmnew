// How the team's orders came (27 Nov, PLAN 252): each order's Source, the doctor's dispensing
// ("Doctor order": the doctors who bought) and referral ("Patient order referred by doctor": the
// patients and the doctors who sent them) and the rest, for the month asked; the leads' view.

import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { addDays, todayManila } from "../inventory/rules";
import { seedDemoTeam } from "../orders/seed-team";
import { seedRxTeam } from "../rx/seed";
import { seedDemo } from "../seed";
import type { OrderWays } from "../types";

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

describe("how the team's orders came", () => {
  it("splits the month by source: the doctor dispensing, the doctor's referral, the rest", async () => {
    const [joy] = await rows<{ id: number; seat: number }>(
      db,
      sql`select p.id::int as id, h.seat_id::int as seat from person p join seat_holder h on h.person_id = p.id and h.kind = 'holder'
        where p.email = 'joy@2mg.test' limit 1`,
    );
    await db.execute(sql`insert into zoho_seller (name, seat_id) values ('RX | WAYS JOY', ${joy?.seat})`);
    const customer = async (name: string, kind: string) =>
      (
        await rows<{ id: number }>(
          db,
          sql`insert into customer (name, kind, added_by) values (${name}, ${kind}, ${joy?.id}) returning id::int as id`,
        )
      )[0]?.id as number;
    const drCruz = await customer("Dr. Ways Cruz", "doctor");
    const drLim = await customer("Dr. Ways Lim", "doctor");
    const ana = await customer("Ana Ways", "patient");
    const ben = await customer("Ben Ways", "patient");
    const today = todayManila();
    // Older than this month: not counted.
    const before = addDays(`${today.slice(0, 7)}-01`, -3);
    for (const [code, buyer, day, source, doctor, total] of [
      ["SO-W1", drCruz, today, "Doctor order", null, 300000],
      ["SO-W2", drCruz, today, "Doctor order", null, 200000],
      ["SO-W3", drLim, today, "Doctor order", null, 100000],
      ["SO-W4", ana, today, "Patient order referred by doctor", "Dr. Ways Cruz", 50000],
      ["SO-W5", ben, today, "Patient order referred by doctor", "Dr. Ways Lim", 40000],
      ["SO-W6", ana, today, "Patient order referred by doctor", "Dr. Ways Cruz", 30000],
      ["SO-W7", ben, today, "DSWD", "Dr. Ways Lim", 20000],
      ["SO-W8", drCruz, before, "Doctor order", null, 999900],
    ] as const)
      await db.execute(
        sql`insert into past_order (zoho_id, code, customer_id, ordered_on, status, total, seller, source, doctor)
          values (${code}, ${code}, ${buyer}, ${day}::date, 'confirmed', ${total}, 'RX | WAYS JOY', ${source}, ${doctor})`,
      );
    const ways = (await (await get("rosa", "/api/team/ways")).json()) as OrderWays;
    // The doctor dispensing: three orders, two doctors bought.
    expect(ways.dispense).toMatchObject({ orders: 3, value: 600000, doctors: 2 });
    // The referral: the patients' orders, the guarantee letter's among them (a patient's order an
    // agency pays, 28 Nov): four orders, two patients, sent by two doctors.
    expect(ways.referral).toMatchObject({ orders: 4, value: 140000, patients: 2, doctors: 2 });
    expect(ways.referral.roads).toMatchObject({ regular: { orders: 3, value: 120000 }, senior: { orders: 0 }, gl: { orders: 1, value: 20000 } });
    // Zoho's orders kept no terms: the buyer's own (here paid first) stand for them.
    expect(ways.referral.pay.prepaid.orders + ways.referral.pay.unknown.orders).toBe(4);
    expect(ways.others.orders).toBe(0);
    expect(ways.lastOrderOn).toBe(today);
    // Joy's line: her HQ's seven orders this month, by way.
    const joyLine = ways.people.find((one) => one.person === "Joy");
    expect(joyLine).toMatchObject({ orders: 7, referral: { orders: 4 }, dispense: { orders: 3 } });
    // Last month's own figures when asked for it.
    const last = (await (await get("rosa", `/api/team/ways?month=${before.slice(0, 7)}`)).json()) as OrderWays;
    expect(last.dispense).toMatchObject({ orders: 1, value: 999900 });
    // A seller doesn't read the team's.
    expect((await get("joy", "/api/team/ways")).status).toBe(403);
  });
});
