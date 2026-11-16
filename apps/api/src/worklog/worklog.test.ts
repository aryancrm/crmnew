import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedDemo } from "../seed";
import type { Me, WorkLog, WorkLogDay } from "../types";
import { seedOfficeStaff } from "./seed";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
const get = (who: string, path: string) => app.request(path, { headers: { cookie: cookies[who] as string } });
const post = (who: string, path: string, body: unknown) =>
  app.request(path, { method: "POST", headers: { "content-type": "application/json", cookie: cookies[who] as string }, body: JSON.stringify(body) });

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  expect(await seedOfficeStaff(db, PASSWORD)).toBe(true);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["kriscel", "jade", "ryan", "naresh"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
});

describe("the work log", () => {
  it("the office staff sit under the Founder in their own boxes", async () => {
    const { me } = (await (await get("kriscel", "/api/me")).json()) as { me: Me };
    expect(me.role).toBe("staff");
    const boss = await rows<{ boss: string; unit: string }>(
      db,
      sql`select b.name as boss, u.name as unit from person p join person b on b.id = p.reports_to
        join seat_holder h on h.person_id = p.id and h.ends_on is null join seat s on s.id = h.seat_id join org_unit u on u.id = s.unit_id
        where p.email in ('kriscel@2mg.test', 'jade@2mg.test') order by p.email`,
    );
    expect(boss.map((b) => b.unit)).toEqual(["IT Division", "Digital Marketing Coaching Department"]);
    expect(boss.map((b) => b.boss)).toEqual([expect.stringMatching(/Naresh/), expect.stringMatching(/Naresh/)]);
  });

  it("is optional, one entry a day, changed during the day; the Founder reads everyone's, a seller nobody's", async () => {
    const before = (await (await get("kriscel", "/api/work-log")).json()) as WorkLog;
    expect(before.todayEntry).toBeNull();
    expect(before.entries.length).toBe(2);
    expect((await post("kriscel", "/api/work-log", { done: " ", today: "", tomorrow: null })).status).toBe(400);
    expect((await post("kriscel", "/api/work-log", { today: "Reels for the refill reminder" })).status).toBe(200);
    expect((await post("kriscel", "/api/work-log", { done: "Replied to the page", today: "Reels", tomorrow: "Boost" })).status).toBe(200);
    const after = (await (await get("kriscel", "/api/work-log")).json()) as WorkLog;
    expect(after.entries.length).toBe(3);
    expect(after.todayEntry).toMatchObject({ done: "Replied to the page", today: "Reels", tomorrow: "Boost" });
    const founder = (await (await get("naresh", "/api/work-log/day")).json()) as WorkLogDay;
    expect(founder.entries.map((e) => e.name)).toEqual(["Kriscel"]);
    expect(founder.entries[0]?.unit).toBe("Digital Marketing Coaching Department");
    const yesterday = (await (await get("naresh", `/api/work-log/day?day=${before.entries[0]?.day}`)).json()) as WorkLogDay;
    expect(yesterday.entries.map((e) => e.name).sort()).toEqual(["Jade", "Kriscel"]);
    expect((await get("ryan", "/api/work-log/day")).status).toBe(403);
    expect((await get("jade", "/api/work-log/day")).status).toBe(403);
  });
});
