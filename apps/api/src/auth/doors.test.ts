// The sign-in page's Heads and Team leads doors (Aryan, 19 Nov: "open Heads, one password, all the
// heads come; press one and their page opens with their team's data"): the company's password
// lists the door's people, a press signs that person in as themself, someone with their own
// password is left out, and wrong passwords close the door for a while.

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

const door = (body: unknown, from = "10.0.0.1") =>
  app.request("/api/auth/door", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": from },
    body: JSON.stringify(body),
  });
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
    expect(opened.status, await opened.clone().text()).toBe(200);
    const { people } = (await opened.json()) as DoorList;
    const vanessa = people.find((one) => one.name.startsWith("Vanessa"));
    expect(vanessa).toMatchObject({ head: null, boxes: ["Hospital Division"] });
    // Only heads: no team lead, no MedRep.
    expect(people.some((one) => one.name.startsWith("Daniel") || one.name.startsWith("Ryan"))).toBe(false);
    const signed = await login(vanessa?.login as string, PASSWORD);
    expect(signed.status).toBe(200);
    expect(signed.me).toMatchObject({ role: "manager" });
    expect(signed.me?.name.startsWith("Vanessa")).toBe(true);
  });

  it("lists the team leads under their head, and leaves out one whose password is their own", async () => {
    const opened = await door({ door: "leads", password: PASSWORD });
    expect(opened.status, await opened.clone().text()).toBe(200);
    const { people } = (await opened.json()) as DoorList;
    const daniel = people.find((one) => one.name.startsWith("Daniel"));
    expect(daniel?.boxes).toEqual(["NCR 1"]);
    expect(daniel?.head?.startsWith("Vanessa")).toBe(true);
    expect(people.some((one) => one.name.startsWith("Vanessa"))).toBe(false);
    expect((await login(daniel?.login as string, PASSWORD)).me?.role).toBe("team_lead");

    // Daniel keeps a password of his own: the company's no longer lists him.
    const [before] = await rows<{ hash: string }>(db, sql`select password_hash as hash from person where email = 'daniel@2mg.test'`);
    await db.execute(
      sql`update person set password_hash = ${await hashPassword("daniels-own-1")} where email = 'daniel@2mg.test'`,
    );
    const now = await door({ door: "leads", password: PASSWORD });
    const listed = now.status === 200 ? ((await now.json()) as DoorList).people : [];
    expect(listed.some((one) => one.name.startsWith("Daniel"))).toBe(false);
    await db.execute(sql`update person set password_hash = ${before?.hash as string} where email = 'daniel@2mg.test'`);
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
