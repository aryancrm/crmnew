import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { seedB2bTeam } from "../b2b/seed";
import { type Database, openDatabase } from "../db/index";
import { migrate } from "../db/migrate";
import { seedDemoInventory } from "../inventory/seed";
import { seedDemoTeam } from "../orders/seed-team";
import { seedDemo } from "../seed";
import { sql } from "drizzle-orm";
import { rows } from "../db/index";
import type { ClidpDay, ClidpRoad, ClidpTeam } from "../types";
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

  it("CLIDP's road: who we went to, who agreed, the rate, and the accounts already buying", async () => {
    // The three accounts already buying stand at "ordering", each with the price it paid last.
    const road = (await (await get("annie", "/api/clidp/road")).json()) as ClidpRoad;
    expect(road.counts.ordering).toBe(3);
    expect(road.rows.every((row) => row.stage === "ordering" && row.coach === "Annie")).toBe(true);
    // A pharmacy approached, interested, agreed with a rate and an agreement, then declined by another.
    const [pharmacy] = await rows<{ id: number }>(
      db,
      sql`insert into customer (kind, name, city, added_by) values ('drugstore', 'Road Test Pharmacy', 'Davao City', (select id from person order by id limit 1)) returning id::int as id`,
    );
    expect((await post("annie", "/api/clidp/road", { customerId: pharmacy?.id, note: "Owner keen", nextStep: "Send the rate" })).status).toBe(200);
    expect((await post("annie", "/api/clidp/road", { customerId: pharmacy?.id })).status).toBe(409);
    expect((await post("annie", `/api/clidp/road/${pharmacy?.id}`, { stage: "interested" })).status).toBe(200);
    expect((await post("annie", "/api/clidp/rates", { customerId: pharmacy?.id, medicineId: 1, unitPrice: 185000, moq: 50 })).status).toBe(200);
    expect((await post("annie", "/api/clidp/rates", { customerId: pharmacy?.id, medicineId: 1, unitPrice: 180000, moq: 50 })).status).toBe(200);
    expect((await post("annie", `/api/clidp/road/${pharmacy?.id}`, { stage: "agreed", agreementUntil: "2027-12-31" })).status).toBe(200);
    const [other] = await rows<{ id: number }>(
      db,
      sql`insert into customer (kind, name, added_by) values ('distributor', 'Road Test Distributor', (select id from person order by id limit 1)) returning id::int as id`,
    );
    await post("annie", "/api/clidp/road", { customerId: other?.id });
    expect((await post("annie", `/api/clidp/road/${other?.id}`, { stage: "declined" })).status).toBe(400);
    expect((await post("annie", `/api/clidp/road/${other?.id}`, { stage: "declined", declinedReason: "Lists a rival brand" })).status).toBe(200);
    const after = (await (await get("annie", "/api/clidp/road")).json()) as ClidpRoad;
    const agreed = after.rows.find((row) => row.customerId === pharmacy?.id);
    // The latest rate stands (the first kept, replaced).
    expect(agreed).toMatchObject({ stage: "agreed", agreementUntil: "2027-12-31", nextStep: "Send the rate" });
    expect(agreed?.rates).toEqual([expect.objectContaining({ unitPrice: 180000, moq: 50 })]);
    expect(after.rows.find((row) => row.customerId === other?.id)).toMatchObject({ stage: "declined", declinedReason: "Lists a rival brand" });
    expect(after.counts).toMatchObject({ agreed: 1, declined: 1, ordering: 3 });
    expect(after.month).toMatchObject({ approached: 2, agreed: 1, declined: 1 });
    // The Mentor sees the same road, coach by coach; a B2B seller doesn't.
    const head = (await (await get("sam", "/api/clidp/road")).json()) as ClidpRoad;
    expect(head.coaches.find((one) => one.name === "Annie")).toMatchObject({ ordering: 3 });
    expect((await get("flor", "/api/clidp/road")).status).toBe(403);
  });
});
