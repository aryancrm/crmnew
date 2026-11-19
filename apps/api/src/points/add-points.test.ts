import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase } from "../db/index";
import { migrate } from "../db/migrate";
import { seedFixture } from "../inventory/fixture";
import { seedDemo } from "../seed";
import type { PointsAccountDetail } from "../types";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
const post = (who: string, path: string, body: unknown) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookies[who] as string },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  await seedFixture(db);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["admin", "sarla", "ryan"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
});

describe("adding points by a customer's mobile number (Aryan, 19 Nov)", () => {
  it("opens the number's points account and adds the points typed; only the Admin or the CEO", async () => {
    expect((await post("ryan", "/api/points/add", { phone: "0917 555 0101", points: 500 })).status).toBe(403);
    expect((await post("sarla", "/api/points/add", { phone: "0917 555 0101", points: 500 })).status).toBe(403);
    expect((await post("admin", "/api/points/add", { phone: "0917 555 0101", points: 0 })).status).toBe(400);
    expect((await post("admin", "/api/points/add", { phone: "", points: 5 })).status).toBe(400);
    const first = await post("admin", "/api/points/add", { phone: "0917 555 0101", points: 500, name: "Nena Cruz" });
    expect(first.status).toBe(200);
    const made = (await first.json()) as { id: number; balance: number };
    expect(made.balance).toBe(500);
    // The same number again: the same account, more points.
    const again = (await (await post("admin", "/api/points/add", { phone: "+63 917 555 0101", points: 100, reason: "Birthday" })).json()) as {
      id: number;
      balance: number;
    };
    expect(again).toEqual({ id: made.id, balance: 600 });
    const detail = (await (
      await app.request(`/api/points/${made.id}`, { headers: { cookie: cookies.admin as string } })
    ).json()) as PointsAccountDetail;
    expect(detail.account.name).toBe("Nena Cruz");
  });
});
