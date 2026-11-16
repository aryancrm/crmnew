import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase } from "../db/index";
import { migrate } from "../db/migrate";
import { seedDemoTeam } from "../orders/seed-team";
import { seedRxTeam } from "../rx/seed";
import { seedDemo } from "../seed";
import type { B2cDay, B2cTeam } from "../types";
import { seedB2cTeam } from "./seed";

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
  await seedRxTeam(db, PASSWORD);
  expect(await seedB2cTeam(db, PASSWORD)).toBe(true);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["mae", "lara", "rosa", "ryan"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
});

describe("the B2C channel", () => {
  it("a B2C CHC's morning pulse, enquiries waiting oldest first, refills and late replies", async () => {
    const response = await get("mae", "/api/b2c/day");
    expect(response.status).toBe(200);
    const day = (await response.json()) as B2cDay;
    expect(day.pulse.map((one) => one.key)).toEqual(["waiting", "prospects", "refills", "invoice", "uncoded", "late"]);
    expect(day.waiting.map((row) => row.name)).toEqual(["Rosario Lim", "Benjie Santos"]);
    expect(day.waiting[0]?.minutes).toBeGreaterThan(15);
    // Only Mae's own patients, not every patient of the company.
    expect(day.refills.map((row) => row.name).sort()).toEqual(["Manuel Ocampo", "Teresa Villanueva"]);
    expect((await get("ryan", "/api/b2c/day")).status).toBe(403);
  });

  it("the coach sees each B2C CHC's desk now; a seller can't", async () => {
    for (const head of ["lara", "rosa"]) {
      const team = (await (await get(head, "/api/b2c/team")).json()) as B2cTeam;
      const mae = team.rows.find((row) => row.name === "Mae");
      expect(mae?.waiting).toBe(2);
    }
    expect((await get("mae", "/api/b2c/team")).status).toBe(403);
  });
});
