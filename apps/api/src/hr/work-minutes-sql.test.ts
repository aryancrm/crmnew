// The database's work_minutes() and the shared workMinutes() give the same answer: queries and the
// screen time a desk alike.

import { sql } from "drizzle-orm";
import { beforeAll, expect, it } from "vitest";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { DEFAULT_SCHEDULE, manilaMoment, workMinutes } from "./work-time";

let db: Database;
beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  // The migrations bring the 2026 national holidays, Bonifacio Day (30 Nov) among them.
  await migrate(db);
});

it("matches the shared rule, weekends and holidays included", async () => {
  const spans: [string, string, string, string][] = [
    ["2026-11-16", "09:00", "2026-11-16", "11:30"],
    ["2026-11-16", "18:00", "2026-11-17", "09:00"],
    ["2026-11-20", "16:00", "2026-11-23", "09:00"],
    ["2026-11-27", "17:00", "2026-12-01", "10:00"],
    ["2026-11-16", "05:00", "2026-11-16", "07:59"],
    ["2026-10-01", "13:13", "2026-11-25", "16:47"],
  ];
  const holidays = new Set(
    (
      await rows<{ day: string }>(db, sql`select to_char(day, 'YYYY-MM-DD') as day from holiday`)
    ).map((one) => one.day),
  );
  expect(holidays.has("2026-11-30")).toBe(true);
  for (const [d1, c1, d2, c2] of spans) {
    const a = new Date(manilaMoment(d1, c1)).toISOString();
    const b = new Date(manilaMoment(d2, c2)).toISOString();
    const [found] = await rows<{ minutes: number }>(
      db,
      sql`select work_minutes(${a}::timestamptz, ${b}::timestamptz) as minutes`,
    );
    expect(found?.minutes, `${d1} ${c1} → ${d2} ${c2}`).toBe(
      workMinutes(a, b, DEFAULT_SCHEDULE, holidays),
    );
  }
});
