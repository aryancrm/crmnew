// A telesales team at a glance (19 Nov): each seller's calls today and this month, those that
// reached someone and those that ended in an order, the callbacks due, orders, customers and money;
// a seller's own row, their lead's team, nobody else's.

import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { addDays, todayManila } from "../inventory/rules";
import { seedDemoTeam } from "../orders/seed-team";
import { seedDemo } from "../seed";
import type { TelesalesTeam } from "../types";

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
  for (const name of ["ryan", "daniel", "sarla"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
});

describe("the telesales team", () => {
  it("counts each seller's calls, what came of them and the callbacks due; the lead sees the team", async () => {
    const [ryan] = await rows<{ id: number; seat: number }>(
      db,
      sql`select p.id::int as id, h.seat_id::int as seat from person p join seat_holder h on h.person_id = p.id and h.kind = 'holder'
        where p.email = 'ryan@2mg.test' limit 1`,
    );
    const today = todayManila();
    const before = (await (await get("ryan", "/api/telesales/team")).json()) as TelesalesTeam;
    const was = before.rows.find((one) => one.personId === ryan?.id);
    expect(was).toBeTruthy();
    // Today: an order, no answer, a callback promised for today, not interested. Earlier this
    // month (or today, on the 1st): a callback for yesterday since called again (not due).
    const earlier = today.slice(8) === "01" ? today : addDays(today, -1);
    for (const [whom, outcome, nextOn, at] of [
      ["Pharmacy One", "ordered", null, today],
      ["Pharmacy Two", "no_answer", null, today],
      ["Pharmacy Three", "call_back", today, today],
      ["Pharmacy Four", "not_interested", null, today],
    ] as const)
      await db.execute(
        sql`insert into account_call (customer_text, by_person, seat_id, outcome, next_on, at)
          values (${whom}, ${ryan?.id}, ${ryan?.seat}, ${outcome}, ${nextOn}::date, (${at}::date + time '10:00') at time zone 'Asia/Manila')`,
      );
    await db.execute(
      sql`insert into account_call (customer_text, by_person, seat_id, outcome, next_on, at)
        values ('Pharmacy One', ${ryan?.id}, ${ryan?.seat}, 'call_back', ${earlier}::date, (${earlier}::date + time '08:00') at time zone 'Asia/Manila')`,
    );
    const mine = (await (await get("ryan", "/api/telesales/team")).json()) as TelesalesTeam;
    const row = mine.rows.find((one) => one.personId === ryan?.id);
    expect(row).toMatchObject({
      callsToday: (was?.callsToday ?? 0) + (earlier === today ? 5 : 4),
      callsMonth: (was?.callsMonth ?? 0) + 5,
      reached: (was?.reached ?? 0) + 4,
      ordered: (was?.ordered ?? 0) + 1,
      callbacksDue: (was?.callbacksDue ?? 0) + 1,
    });
    expect(mine.rows.every((one) => one.personId === ryan?.id)).toBe(true);
    expect(mine.summary.conversion).toBe(Math.round((mine.summary.ordered / mine.summary.callsMonth) * 100));
    // The lead sees the seller in the team, with the same row.
    const team = (await (await get("daniel", "/api/telesales/team")).json()) as TelesalesTeam;
    expect(team.rows.find((one) => one.personId === ryan?.id)).toEqual(row);
    // Management sells nothing: not theirs to read.
    expect((await get("sarla", "/api/telesales/team")).status).toBe(403);
  });
});
