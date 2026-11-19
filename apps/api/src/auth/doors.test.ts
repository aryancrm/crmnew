// The sign-in page's Heads and Team leads doors (Aryan, 19 Nov: "open Heads, one password, all the
// heads come; press one and their page opens with their team's data"; then "Under Vanessa, under
// Javed, under Subir; there was no Under Mhalou"): the company's password lists the people it
// opens, a press signs that person in, someone with a password of their own is left out, a head
// who leads sellers with a target and no team lead between stands under their own name at Team
// leads, and wrong passwords close the door for a while.

import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedDemo } from "../seed";
import type { DoorList, Me } from "../types";
import { hashPassword } from "./password";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;

const door = async (body: unknown, from = "10.0.0.1") => {
  const response = await app.request("/api/auth/door", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": from },
    body: JSON.stringify(body),
  });
  return { status: response.status, people: response.status === 200 ? ((await response.json()) as DoorList).people : [] };
};
const login = async (email: string, password: string) => {
  const response = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return { status: response.status, me: ((await response.json()) as { me?: Me }).me };
};

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  app = createApp(db, { webUrl: "http://localhost:5180" });
});

describe("the heads' and the team leads' doors", () => {
  it("lists the heads for the company's password; a press signs that head in as themself", async () => {
    const opened = await door({ door: "heads", password: PASSWORD });
    expect(opened.status).toBe(200);
    const vanessa = opened.people.find((one) => one.name.startsWith("Vanessa"));
    expect(vanessa).toMatchObject({ head: null, boxes: ["Hospital Division"] });
    // Only heads: no team lead, no MedRep.
    expect(opened.people.some((one) => one.name.startsWith("Daniel") || one.name.startsWith("Ryan"))).toBe(false);
    const signed = await login(vanessa?.login as string, PASSWORD);
    expect(signed.status).toBe(200);
    expect(signed.me).toMatchObject({ role: "manager" });
    expect(signed.me?.name.startsWith("Vanessa")).toBe(true);
  });

  it("lists the team leads under their head, and leaves out one whose password is their own", async () => {
    const opened = await door({ door: "leads", password: PASSWORD });
    const daniel = opened.people.find((one) => one.name.startsWith("Daniel"));
    expect(daniel?.boxes).toEqual(["NCR 1"]);
    expect(daniel?.head?.startsWith("Vanessa")).toBe(true);
    // Vanessa leads no sellers herself in the demo: she isn't a manager of her own.
    expect(opened.people.some((one) => one.name.startsWith("Vanessa"))).toBe(false);
    expect((await login(daniel?.login as string, PASSWORD)).me?.role).toBe("team_lead");

    // Daniel keeps a password of his own: the company's no longer lists him.
    const [own] = await rows<{ hash: string }>(db, sql`select password_hash as hash from person where email = 'daniel@2mg.test'`);
    await db.execute(
      sql`update person set password_hash = ${await hashPassword("daniels-own-1")} where email = 'daniel@2mg.test'`,
    );
    const now = await door({ door: "leads", password: PASSWORD });
    expect(now.people.some((one) => one.name.startsWith("Daniel"))).toBe(false);
    await db.execute(sql`update person set password_hash = ${own?.hash as string} where email = 'daniel@2mg.test'`);
  });

  it("puts a head who leads sellers with a target and no team lead between under their own name", async () => {
    const [hospital] = await rows<{ id: number }>(db, sql`select id::int as id from org_unit where name = 'Hospital Division'`);
    const [box] = await rows<{ id: number }>(
      db,
      sql`insert into org_unit (name, kind, parent_id, sort) values ('Patient Assistance', 'line', ${hospital?.id}, 9) returning id::int as id`,
    );
    const [seat] = await rows<{ id: number }>(
      db,
      sql`insert into seat (unit_id, title, module) values (${box?.id}, 'PAP Officer', 'medrep') returning id::int as id`,
    );
    // No target on the seller's seat: not a row of the tracker, so no manager's line.
    const before = await door({ door: "leads", password: PASSWORD });
    expect(before.people.some((one) => one.name.startsWith("Vanessa"))).toBe(false);
    await db.execute(
      sql`insert into seat_target (seat_id, month, amount, set_by)
        values (${seat?.id}, date_trunc('month', now() at time zone 'Asia/Manila')::date, 50000000, (select id from person where email = 'naresh@2mg.test'))`,
    );
    const { people } = await door({ door: "leads", password: PASSWORD });
    const hers = people.filter((one) => one.head?.startsWith("Vanessa"));
    // First under her own name, with the box she leads; her team leads after her.
    expect(hers[0]?.name.startsWith("Vanessa")).toBe(true);
    expect(hers[0]?.boxes).toEqual(["Patient Assistance"]);
    expect(hers.some((one) => one.name.startsWith("Daniel"))).toBe(true);
    await db.execute(sql`delete from seat_target where seat_id = ${seat?.id}`);
    await db.execute(sql`update seat set active = false where id = ${seat?.id}`);
    await db.execute(sql`update org_unit set active = false where id = ${box?.id}`);
  });

  it("refuses a wrong password, closes after five, and opens no other door", async () => {
    expect((await door({ door: "sales", password: PASSWORD })).status).toBe(400);
    for (let tries = 0; tries < 5; tries += 1)
      expect((await door({ door: "heads", password: "not-the-password" }, "10.0.0.9")).status).toBe(401);
    // Closed for that address, even with the right password now; another still opens.
    expect((await door({ door: "heads", password: PASSWORD }, "10.0.0.9")).status).toBe(429);
    expect((await door({ door: "heads", password: PASSWORD }, "10.0.0.10")).status).toBe(200);
  });
});
