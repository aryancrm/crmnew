// Headquarters (27 Nov, PLAN 257): a lead sees each HQ of their team, who works it and what it sold;
// an HQ in a word is its territory's last part that isn't the person's own name.

import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase } from "../db/index";
import { migrate } from "../db/migrate";
import { seedDemoTeam } from "../orders/seed-team";
import { seedRxTeam } from "../rx/seed";
import { seedDemo } from "../seed";
import type { Headquarters } from "../types";
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
});
