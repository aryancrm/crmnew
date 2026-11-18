import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedFixture } from "../inventory/fixture";
import { seedDemo } from "../seed";
import type { PortalDepartment } from "../types";
import { PORTAL_DEPARTMENTS } from "./service";

let db: Database;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, "test-password-1");
  await seedFixture(db);
  app = createApp(db, { webUrl: "http://localhost:5180" });
});

describe("a department's page on the portal", () => {
  it("shows every department's counts and team seats before signing in, and nobody's name", async () => {
    const names = (await rows<{ name: string }>(db, sql`select name from person`)).map((one) => one.name);
    for (const key of PORTAL_DEPARTMENTS) {
      const response = await app.request(`/api/portal/departments/${key}`);
      expect(response.status, key).toBe(200);
      const page = (await response.json()) as PortalDepartment;
      expect(page.stats.length, key).toBeGreaterThan(0);
      for (const one of page.stats) if (one.unit === "count") expect(typeof one.value, `${key} ${one.label}`).toBe("number");
      const text = JSON.stringify(page);
      for (const name of names) expect(text.includes(`"${name}"`), `${key} shows ${name}`).toBe(false);
    }
    const finance = (await (await app.request("/api/portal/departments/finance")).json()) as PortalDepartment;
    expect(finance.stats.map((one) => one.label)).toContain("Payments received");
    expect(finance.team?.unit).toBe("The company");
    expect((await app.request("/api/portal/departments/nobody")).status).toBe(404);
  });
});
