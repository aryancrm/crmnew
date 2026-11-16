import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedDemoTeam } from "../orders/seed-team";
import { seedDemo } from "../seed";
import type { B2bTeam, CrrDay, NbdDay } from "../types";
import { seedB2bTeam } from "./seed";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
const get = (who: string, path: string) => app.request(path, { headers: { cookie: cookies[who] as string } });
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
  await seedDemoTeam(db, PASSWORD);
  expect(await seedB2bTeam(db, PASSWORD)).toBe(true);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["flor", "fritz", "jess", "sam", "ryan"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
});

describe("B2B Telesales", () => {
  it("NBD: prospects by stage with their missing papers; adding one; calls and papers move them on", async () => {
    const day = (await (await get("flor", "/api/b2b/nbd")).json()) as NbdDay;
    const stages = Object.fromEntries(day.prospects.map((p) => [p.name, p.stage]));
    expect(stages).toMatchObject({ "Botika ng Bayan Marikina": "prospect", "Medcare Distributors Inc.": "contacted", "San Roque Pharmacy": "papers" });
    const medcare = day.prospects.find((p) => p.name === "Medcare Distributors Inc.");
    expect(medcare?.missing).toEqual(["business permit", "BIR (TIN)"]);
    expect((await get("fritz", "/api/b2b/nbd")).status).toBe(403);

    const added = await post("flor", "/api/b2b/prospects", { customer: { kind: "drugstore", name: "Farmacia Santiago", city: "Taguig" } });
    expect(added.status).toBe(200);
    const { customerId } = (await added.json()) as { customerId: number };
    expect((await post("flor", "/api/b2b/prospects", { customerId })).status).toBe(409);
    expect((await post("flor", "/api/b2b/calls", { customerId, outcome: "reached", nextOn: "2030-01-01" })).status).toBe(200);
    expect((await post("flor", "/api/b2b/papers", { customerId, licenceNo: "L-1", licenceExpires: "2030-01-01", permitNo: "P-1", tin: "111" })).status).toBe(200);
    const after = (await (await get("flor", "/api/b2b/nbd")).json()) as NbdDay;
    expect(after.prospects.find((p) => p.customerId === customerId)).toMatchObject({ stage: "papers", missing: [], callDue: false });
    // Not ready (no orders): the NBD can't hand it over yet; the coach can.
    const [fritz] = await rows<{ id: number }>(db, sql`select id::int as id from person where email = 'fritz@2mg.test'`);
    expect((await post("flor", "/api/b2b/hand-over", { customerId, crrId: fritz?.id })).status).toBe(400);
    expect((await post("jess", "/api/b2b/hand-over", { customerId, crrId: fritz?.id })).status).toBe(200);
    expect((await post("ryan", "/api/b2b/calls", { customerId, outcome: "reached" })).status).toBe(403);
  });

  it("CRR: each account against its own gap and 3-month average", async () => {
    const day = (await (await get("fritz", "/api/b2b/crr")).json()) as CrrDay;
    const state = Object.fromEntries(day.accounts.map((a) => [a.name, a.state]));
    expect(state).toMatchObject({
      "Mercury Drug Pasig Branch": "due",
      "Rose Pharmacy Ortigas": "late",
      "Generika Kapitolyo": "stopped",
    });
    expect(day.accounts.find((a) => a.name === "Southstar Drug Libis")?.trend).toBe("down");
    expect((await get("flor", "/api/b2b/crr")).status).toBe(403);
  });

  it("the coach and the Mentor see the pipeline per NBD and the accounts per CRR", async () => {
    for (const head of ["jess", "sam"]) {
      const team = (await (await get(head, "/api/b2b/team")).json()) as B2bTeam;
      expect(team.nbd.find((row) => row.name === "Flor")?.open).toBeGreaterThanOrEqual(3);
      expect(team.crr.find((row) => row.name === "Fritz")?.stopped).toBeGreaterThanOrEqual(1);
    }
    expect((await get("flor", "/api/b2b/team")).status).toBe(403);
  });
});
