// The field as a calendar (a person's visits by day, a team's counts and who was out, any day's
// visits) and live location (kept only while the person's day runs; a team lead sees the team,
// the CEO everyone, a MedRep nobody's).

import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { seedDemoCustomers } from "../customers/seed";
import { type Database, openDatabase } from "../db/index";
import { migrate } from "../db/migrate";
import { todayManila } from "../inventory/rules";
import { seedDemoInventory } from "../inventory/seed";
import { seedDemo } from "../seed";
import type { FieldCalendar, FieldForm, LivePeople, Me } from "../types";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
const ids: Record<string, number> = {};

const get = (who: string, path: string) =>
  app.request(path, { headers: { cookie: cookies[who] as string } });
const read = async <T>(who: string, path: string) => (await (await get(who, path)).json()) as T;
const send = (who: string, path: string, body: unknown = {}) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookies[who] as string },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  await seedDemoInventory(db);
  await seedDemoCustomers(db);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["ryan", "daniel", "naresh", "fiona"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
    ids[name] = ((await response.json()) as { me: Me }).me.id;
  }
  const form = await read<FieldForm>("ryan", "/api/field/form");
  const planned = await send("ryan", "/api/field/visits", {
    customerId: form.customers[0]?.id,
    day: todayManila(),
  });
  const { id } = (await planned.json()) as { id: number };
  await send("ryan", `/api/field/visits/${id}/check-in`, { place: "14.55000,121.02000" });
  await send("ryan", `/api/field/visits/${id}/report`, { detailed: [], notes: "Met the doctor" });
  await send("ryan", "/api/field/visits", {
    customerId: form.customers[1]?.id,
    day: todayManila(),
  });
});

describe("the field calendar", () => {
  it("shows a MedRep their own month, each visit on its day; nobody else's", async () => {
    const mine = await read<FieldCalendar>("ryan", "/api/field/calendar");
    expect(mine.person?.name).toBe("Ryan");
    expect(mine.people.map((one) => one.name)).toEqual(["Ryan"]);
    const today = mine.days.find((one) => one.day === todayManila());
    expect(today).toMatchObject({ done: 1, planned: 1 });
    expect(today?.visits.map((one) => one.status).sort()).toEqual(["done", "planned"]);
    expect((await get("ryan", `/api/field/calendar?person=${ids.daniel}`)).status).toBe(403);
  });

  it("shows a team lead and the CEO the whole team as counts, and any day's visits", async () => {
    const team = await read<FieldCalendar>("daniel", "/api/field/calendar");
    expect(team.person).toBeNull();
    expect(team.people.map((one) => one.name)).toContain("Ryan");
    const today = team.days.find((one) => one.day === todayManila());
    expect(today).toMatchObject({ done: 1, planned: 1, visits: [] });
    const day = await read<{ visits: { personName: string }[] }>(
      "naresh",
      `/api/field/calendar/day?day=${todayManila()}`,
    );
    expect(day.visits.map((one) => one.personName)).toEqual(["Ryan", "Ryan"]);
    const one = await read<FieldCalendar>("naresh", `/api/field/calendar?person=${ids.ryan}`);
    expect(one.person?.name).toBe("Ryan");
    expect(
      (await read<{ visits: unknown[] }>("fiona", `/api/field/calendar/day?day=${todayManila()}`))
        .visits,
    ).toEqual([]);
  });
});

describe("live location", () => {
  it("keeps the place only while the day runs, and shows it to the team lead and the CEO", async () => {
    await db.execute(sql`delete from attendance where person_id = ${ids.ryan}`);
    expect(
      (
        (await (
          await send("ryan", "/api/field/where", { place: "14.55100,121.02100" })
        ).json()) as { kept: boolean }
      ).kept,
    ).toBe(false);
    await send("ryan", "/api/hr/day/start", {});
    expect(
      (
        (await (
          await send("ryan", "/api/field/where", { place: "14.55100,121.02100", accuracy: 12 })
        ).json()) as {
          kept: boolean;
        }
      ).kept,
    ).toBe(true);
    expect((await send("ryan", "/api/field/where", { place: "somewhere" })).status).toBe(400);
    const lead = await read<LivePeople>("daniel", "/api/field/where");
    expect(lead.people.find((one) => one.personId === ids.ryan)).toMatchObject({
      place: "14.55100,121.02100",
      accuracyM: 12,
      working: true,
    });
    expect((await read<LivePeople>("naresh", "/api/field/where")).people.length).toBeGreaterThan(0);
    expect((await get("ryan", "/api/field/where")).status).toBe(403);
    expect((await get("fiona", "/api/field/where")).status).toBe(403);
    // Once the day ends, the place no longer says where they are.
    await send("ryan", "/api/hr/day/end", {});
    const after = await read<LivePeople>("daniel", "/api/field/where");
    expect(after.people.find((one) => one.personId === ids.ryan)).toMatchObject({
      place: null,
      working: false,
    });
  });
});
