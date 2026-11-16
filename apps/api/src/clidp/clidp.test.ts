import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { seedB2bTeam } from "../b2b/seed";
import { type Database, openDatabase } from "../db/index";
import { migrate } from "../db/migrate";
import { seedDemoInventory } from "../inventory/seed";
import { seedDemoTeam } from "../orders/seed-team";
import { seedDemo } from "../seed";
import type { ClidpDay, ClidpTeam } from "../types";
import { seedClidp } from "./seed";

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
  await seedDemoInventory(db);
  await seedDemoTeam(db, PASSWORD);
  await seedB2bTeam(db, PASSWORD);
  expect(await seedClidp(db, PASSWORD)).toBe(true);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["annie", "sam", "flor"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
});

describe("CLIDP", () => {
  it("the Sales Coach's accounts, listings by validity, and a new listing", async () => {
    const day = (await (await get("annie", "/api/clidp/day")).json()) as ClidpDay;
    expect(day.accounts.map((a) => a.name).sort()).toEqual(["Bansan Pharma Distributor", "Kaufmann Pharma Inc.", "Medserve Pharmaceutical Products Wholesaling"]);
    const states = Object.fromEntries(day.listings.map((l) => [l.brand, l.state]));
    expect(states).toMatchObject({ "Aemadex 200": "expiring", "Godagamet 200": "valid", "Sugamacen 200": "expiring" });
    const first = day.listings.find((l) => l.brand === "Aemadex 200");
    expect((await post("annie", "/api/clidp/listings", { customerId: first?.customerId, medicineId: 1, brand: "Aemadex 200", validUntil: "2031-01-01" })).status).toBe(200);
    const after = (await (await get("annie", "/api/clidp/day")).json()) as ClidpDay;
    expect(after.listings.find((l) => l.brand === "Aemadex 200")?.state).toBe("valid");
    expect((await get("flor", "/api/clidp/day")).status).toBe(403);
  });

  it("the Mentor sees each CLIDP coach", async () => {
    const team = (await (await get("sam", "/api/clidp/team")).json()) as ClidpTeam;
    expect(team.rows.find((row) => row.name === "Annie")?.accounts).toBe(3);
    expect((await get("annie", "/api/clidp/team")).status).toBe(403);
  });
});
