// Headquarters (27 Nov, PLAN 257): a lead sees each HQ of their team, who works it and what it sold;
// an HQ in a word is its territory's last part that isn't the person's own name.

import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { todayManila } from "../inventory/rules";
import { migrate } from "../db/migrate";
import { seedDemoTeam } from "../orders/seed-team";
import { seedRxTeam } from "../rx/seed";
import { seedDemo } from "../seed";
import type { DoctorHistory, Headquarters, HqDoctors } from "../types";
import { hqOf } from "./headquarters";

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
  for (const name of ["joy", "rosa", "daniel"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
});

describe("headquarters", () => {
  it("names an HQ by its territory, never by the person", () => {
    expect(hqOf("RX | NCL", "Gienel Carlos")).toBe("NCL");
    expect(hqOf("RX | ORTIGAS/TMC", "Noel Valencia")).toBe("ORTIGAS/TMC");
    expect(hqOf("B2C | Rachelle Upao", "Rachelle Upao")).toBe("ON SITE");
    expect(hqOf("B2C | Mary Jane Vinas", "Mary Jane Viñas")).toBe("ON SITE");
    expect(hqOf("RX | NCR 2 | Noel Valencia", "Noel Valencia")).toBe("NCR 2");
  });

  it("shows a lead each HQ of the team with who works it and what it sold; a seller reads none", async () => {
    for (const lead of ["rosa", "daniel"]) {
      const response = await get(lead, "/api/headquarters");
      expect(response.status).toBe(200);
      const data = (await response.json()) as Headquarters;
      const hqs = data.channels.flatMap((channel) => channel.hqs);
      expect(hqs.length).toBeGreaterThan(0);
      for (const hq of hqs) {
        expect(hq.hq.length).toBeGreaterThan(0);
        expect(hq.zoho.length).toBeGreaterThan(0);
        expect(hq.sold).toBeGreaterThanOrEqual(0);
      }
      // The channels add up to the whole.
      expect(data.sold).toBe(data.channels.reduce((sum, channel) => sum + channel.sold, 0));
    }
    expect((await get("joy", "/api/headquarters")).status).toBe(403);
  });

  it("counts an HQ's doctors by their way: one who bought (dispense), one who sent a patient (referral)", async () => {
    const [joy] = await rows<{ id: number; seat: number }>(
      db,
      sql`select p.id::int as id, h.seat_id::int as seat from person p join seat_holder h on h.person_id = p.id and h.kind = 'holder'
        where p.email = 'joy@2mg.test' limit 1`,
    );
    await db.execute(sql`insert into zoho_seller (name, seat_id) values ('RX | HQ TEST', ${joy?.seat})`);
    const add = async (name: string, kind: string) =>
      (await rows<{ id: number }>(db, sql`insert into customer (name, kind, added_by) values (${name}, ${kind}, ${joy?.id}) returning id::int as id`))[0]
        ?.id as number;
    const doctor = await add("Dr. Hq Buyer", "doctor");
    const patient = await add("Hq Patient", "patient");
    const today = todayManila();
    for (const [code, buyer, source, named, total] of [
      ["SO-HQ1", doctor, "Doctor order", null, 300000],
      ["SO-HQ2", patient, "Patient order referred by doctor", "Dr. Hq Sender", 120000],
    ] as const)
      await db.execute(
        sql`insert into past_order (zoho_id, code, customer_id, ordered_on, status, total, seller, source, doctor)
          values (${code}, ${code}, ${buyer}, ${today}::date, 'confirmed', ${total}, 'RX | HQ TEST', ${source}, ${named})`,
      );
    const data = (await (await get("rosa", "/api/headquarters")).json()) as Headquarters;
    const hq = data.channels.flatMap((channel) => channel.hqs).find((one) => one.seatId === joy?.seat);
    expect(hq?.dispense).toMatchObject({ doctors: 1, month: { doctors: 1, value: 300000 } });
    expect(hq?.dispense.top[0]?.name).toBe("Dr. Hq Buyer");
    expect(hq?.referral).toMatchObject({ doctors: 1, month: { doctors: 1, patients: 1, value: 120000 } });
    expect(hq?.referral.top[0]?.name).toBe("Dr. Hq Sender");
    expect(hq?.doctors).toBeGreaterThanOrEqual(2);

    // Pressing the person: their doctors by way (28 Nov, PLAN 261).
    const doctors = (await (await get("rosa", `/api/headquarters/${joy?.seat}/doctors`)).json()) as HqDoctors;
    expect(doctors.referral.find((one) => one.key === "dr. hq sender")).toMatchObject({ orders: 1, value: 120000, month: { orders: 1 } });
    expect(doctors.dispense.find((one) => one.key === "dr. hq buyer")).toMatchObject({ orders: 1, value: 300000 });
    // Pressing a doctor: every order through them, what happened, what is pending.
    const history = (await (await get("rosa", `/api/headquarters/doctor?key=${encodeURIComponent("dr. hq buyer")}`)).json()) as DoctorHistory;
    expect(history.total).toMatchObject({ orders: 1, value: 300000 });
    expect(history.dispense).toEqual({ orders: 1, value: 300000 });
    expect(history.orders[0]).toMatchObject({ code: "SO-HQ1", way: "dispense", buyer: "Dr. Hq Buyer", status: "Confirmed" });
    // Not the sellers', and not another team's HQ.
    expect((await get("joy", `/api/headquarters/${joy?.seat}/doctors`)).status).toBe(403);
    expect((await get("daniel", `/api/headquarters/${joy?.seat}/doctors`)).status).toBe(404);
  });
});
