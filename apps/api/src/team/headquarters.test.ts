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
import type { DoctorHistory, Headquarters, HqDoctors, HqPeople } from "../types";
import { hqOf } from "./headquarters";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
const get = (who: string, path: string) => app.request(path, { headers: { cookie: cookies[who] as string } });
const send = (who: string, method: string, path: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: { cookie: cookies[who] as string, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  await seedDemoTeam(db, PASSWORD);
  expect(await seedRxTeam(db, PASSWORD)).toBe(true);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["joy", "rosa", "daniel", "lara"]) {
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
    // A second on-site HQ of a channel (PLAN 264), whoever works it or nobody.
    expect(hqOf("B2C | ON SITE | 2", null)).toBe("ON SITE");
    expect(hqOf("B2C | ON SITE", "Rachelle Upao")).toBe("ON SITE");
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

describe("the head's HQs (28 Nov, PLAN 264)", () => {
  const hqs = async () => ((await (await get("rosa", "/api/headquarters")).json()) as Headquarters).channels.flatMap((one) => one.hqs);
  const people = async () => ((await (await get("rosa", "/api/headquarters/people")).json()) as HqPeople).people;

  it("lets the head make an HQ, put someone in it, rename it, leave it empty and close it; a team lead only sees", async () => {
    const data = (await (await get("rosa", "/api/headquarters")).json()) as Headquarters;
    const dispensing = data.channels.find((one) => one.hqs.some((hq) => hq.person === "Joy"));
    expect(dispensing?.canChange).toBe(true);
    const unitId = dispensing?.unitId as number;
    // A team lead sees the HQs but doesn't change them; a seller doesn't either.
    const lara = (await (await get("lara", "/api/headquarters")).json()) as Headquarters;
    expect(lara.channels.every((one) => !one.canChange)).toBe(true);
    expect((await send("lara", "POST", "/api/headquarters", { unitId, name: "Makati" })).status).toBe(403);
    expect((await get("lara", "/api/headquarters/people")).status).toBe(403);
    expect((await send("joy", "POST", "/api/headquarters", { unitId, name: "Makati" })).status).toBe(403);
    // Whom the head can put in one: the people working the team's HQs; not another head's people.
    const kim = (await people()).find((one) => one.name === "Kim");
    expect(kim).toMatchObject({ hq: "Oncology", team: "MD Telesales" });
    expect((await people()).some((one) => one.name === "Mia")).toBe(false);
    const mia = await rows<{ id: number }>(db, sql`select id::int as id from person where email = 'mia@2mg.test'`);
    expect((await send("rosa", "POST", "/api/headquarters", { unitId, name: "Makati", personId: mia[0]?.id })).status).toBe(404);

    // Made like the box's other HQs, Kim moved into it: her own HQ is left empty, remembering her.
    const made = await send("rosa", "POST", "/api/headquarters", { unitId, name: "  makati ", personId: kim?.id });
    expect(made.status).toBe(201);
    const { seatId } = (await made.json()) as { seatId: number };
    let all = await hqs();
    const makati = all.find((one) => one.seatId === seatId);
    expect(makati).toMatchObject({ hq: "MAKATI", zoho: "RX | MAKATI", person: "Kim", title: "MedRep" });
    expect(makati?.login).toMatch(/^[a-z]+\d+$/);
    expect(all.find((one) => one.seatId === kim?.seatId)).toMatchObject({ hq: "Oncology", person: null, before: [{ name: "Kim" }] });
    // Kim's screens follow her HQ: its territory is hers now.
    const [kimNow] = await rows<{ area: string }>(
      db,
      sql`select a.name as area from person p join area a on a.id = p.area_id where p.id = ${kim?.id}`,
    );
    expect(kimNow?.area).toBe("RX | MAKATI");
    // One name, one HQ.
    expect((await send("rosa", "POST", "/api/headquarters", { unitId, name: "Makati" })).status).toBe(409);
    expect((await send("rosa", "PATCH", `/api/headquarters/${seatId}`, { name: "cebu" })).status).toBe(409);

    // Renamed: the same HQ, its person and customers with it.
    expect((await send("rosa", "PATCH", `/api/headquarters/${seatId}`, { name: "Makati City" })).status).toBe(200);
    // Closed only when nobody works it.
    expect((await send("rosa", "POST", `/api/headquarters/${seatId}/close`)).status).toBe(409);
    expect((await send("rosa", "POST", `/api/headquarters/${seatId}/person`, { personId: null })).status).toBe(200);
    expect((await send("rosa", "POST", `/api/headquarters/${seatId}/person`, { personId: null })).status).toBe(409);
    all = await hqs();
    expect(all.find((one) => one.seatId === seatId)).toMatchObject({ hq: "MAKATI CITY", person: null });
    // Kim, with no HQ now, is among those the head can put in one: back to her own.
    expect((await people()).find((one) => one.id === kim?.id)).toMatchObject({ seatId: null, hq: null });
    expect((await send("rosa", "POST", `/api/headquarters/${kim?.seatId}/person`, { personId: kim?.id })).status).toBe(200);
    expect((await hqs()).find((one) => one.seatId === kim?.seatId)?.person).toBe("Kim");
    expect((await send("rosa", "POST", `/api/headquarters/${seatId}/close`)).status).toBe(200);
    expect((await hqs()).some((one) => one.seatId === seatId)).toBe(false);
    // Making it again opens its territory again (its customers come back with it).
    expect((await send("rosa", "POST", "/api/headquarters", { unitId, name: "Makati City" })).status).toBe(201);
    const [areas] = await rows<{ n: number }>(db, sql`select count(*)::int as n from area where name = 'RX | MAKATI CITY'`);
    expect(areas?.n).toBe(1);
  });

  it("keeps an on-site HQ ON SITE whoever works it, or nobody", async () => {
    const data = (await (await get("rosa", "/api/headquarters")).json()) as Headquarters;
    const telesales = data.channels.find((one) => one.hqs.some((hq) => hq.person === "Kim"));
    const unitId = telesales?.unitId as number;
    const kim = (await people()).find((one) => one.name === "Kim");
    const joy = (await people()).find((one) => one.name === "Joy");
    const made = await send("rosa", "POST", "/api/headquarters", { unitId, name: "On site", personId: kim?.id });
    expect(made.status).toBe(201);
    const { seatId } = (await made.json()) as { seatId: number };
    // Two on-site HQs in one channel.
    expect((await send("rosa", "POST", "/api/headquarters", { unitId, name: "ON SITE" })).status).toBe(201);
    // Its territory named after its person, as the old ones are ("B2C | Rachelle Upao").
    await db.execute(sql`update area set name = 'TS | Kim' where id = (select area_id from seat where id = ${seatId})`);
    expect((await hqs()).find((one) => one.seatId === seatId)).toMatchObject({ hq: "ON SITE", person: "Kim" });
    // Joy in Kim's place: still ON SITE; Kim's name leaves it.
    expect((await send("rosa", "POST", `/api/headquarters/${seatId}/person`, { personId: joy?.id })).status).toBe(200);
    expect((await hqs()).find((one) => one.seatId === seatId)).toMatchObject({ hq: "ON SITE", person: "Joy" });
    expect((await send("rosa", "POST", `/api/headquarters/${seatId}/person`, { personId: null })).status).toBe(200);
    expect((await hqs()).find((one) => one.seatId === seatId)).toMatchObject({ hq: "ON SITE", person: null });
    // Back as they were.
    expect((await send("rosa", "POST", `/api/headquarters/${joy?.seatId}/person`, { personId: joy?.id })).status).toBe(200);
    expect((await send("rosa", "POST", `/api/headquarters/${kim?.seatId}/person`, { personId: kim?.id })).status).toBe(200);
  });
});
