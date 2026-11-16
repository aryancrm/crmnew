import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase } from "../db/index";
import { migrate } from "../db/migrate";
import { seedDemoInventory } from "../inventory/seed";
import { seedDemo } from "../seed";
import type { MtDay } from "../types";
import { seedModernTrade } from "./seed";

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
  expect(await seedModernTrade(db, PASSWORD)).toBe(true);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["malou", "ryan", "naresh"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
});

describe("Modern Trade", () => {
  it("the COO's chains against their own gap, their listings, and a change kept as a new line", async () => {
    const day = (await (await get("malou", "/api/mt/day")).json()) as MtDay;
    const state = Object.fromEntries(day.chains.map((c) => [c.name, c.state]));
    expect(state).toMatchObject({ "Mercury Drug Corporation (head office)": "ok", "Watsons Personal Care Stores": "late" });
    const mercury = day.listings.filter((l) => l.chain.startsWith("Mercury"));
    expect(mercury.length).toBe(3);
    const first = mercury[0];
    expect((await post("malou", "/api/mt/listings", { customerId: first?.customerId, medicineId: 1, branches: 150, listed: true })).status).toBe(200);
    const after = (await (await get("malou", "/api/mt/day")).json()) as MtDay;
    expect(after.listings.filter((l) => l.chain.startsWith("Mercury")).length).toBe(3);
    expect((await get("ryan", "/api/mt/day")).status).toBe(403);
    expect((await get("naresh", "/api/mt/day")).status).toBe(200);
  });
});
