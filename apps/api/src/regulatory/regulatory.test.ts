import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase } from "../db/index";
import { migrate } from "../db/migrate";
import { seedDemoInventory } from "../inventory/seed";
import { seedDemo } from "../seed";
import type { Me, RegEvent, RegulatoryDesk } from "../types";
import { seedRegulatory } from "./seed";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
const get = (who: string, path: string) => app.request(path, { headers: { cookie: cookies[who] as string } });
const post = (who: string, path: string, body: unknown) =>
  app.request(path, { method: "POST", headers: { "content-type": "application/json", cookie: cookies[who] as string }, body: JSON.stringify(body) });
const desk = async (who: string) => (await (await get(who, "/api/regulatory/desk")).json()) as RegulatoryDesk;

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  await seedDemoInventory(db);
  expect(await seedRegulatory(db, PASSWORD)).toBe(true);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["esther", "dhebbie", "ivy", "alikka", "ryan", "naresh"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
});

describe("In-licensing & Regulatory", () => {
  it("each team keeps its own list and reads the other's; the Founder reads; a seller nothing", async () => {
    const { me } = (await (await get("ivy", "/api/me")).json()) as { me: Me };
    expect(me.role).toBe("regulatory");
    expect(me.reportsTo?.name).toMatch(/Naresh/);
    const ra = await desk("alikka");
    expect(ra).toMatchObject({ team: "ra", canRegistrations: true, canPipeline: false });
    expect(ra.pipeline.length).toBe(4);
    expect(ra.registrations.map((r) => r.flag).slice(0, 2)).toEqual(["urgent", "soon"]);
    expect((await desk("dhebbie")).team).toBe("inlicensing");
    expect((await post("alikka", "/api/regulatory/pipeline", { name: "Something" })).status).toBe(403);
    expect((await post("dhebbie", "/api/regulatory/registrations", { product: "Something" })).status).toBe(403);
    expect((await get("naresh", "/api/regulatory/desk")).status).toBe(200);
    expect((await get("ryan", "/api/regulatory/desk")).status).toBe(403);
  });

  it("a product handed over at dossier opens its registration; filing and approval move it along", async () => {
    const made = (await (await post("dhebbie", "/api/regulatory/pipeline", { name: "Cabazitaxel", strength: "60 mg", partner: "Natco", country: "India", stage: "talks" })).json()) as { id: number };
    expect((await post("dhebbie", `/api/regulatory/pipeline/${made.id}`, { name: "Cabazitaxel", strength: "60 mg", stage: "dossier", nextStep: "Wait for RA" })).status).toBe(200);
    let reg = (await desk("alikka")).registrations.find((r) => r.pipelineId === made.id);
    expect(reg).toMatchObject({ status: "preparing", product: "Cabazitaxel 60 mg" });
    const approvedNoNumber = await post("alikka", `/api/regulatory/registrations/${reg?.id}`, { product: "Cabazitaxel 60 mg", status: "approved" });
    expect(approvedNoNumber.status).toBe(400);
    expect((await post("alikka", `/api/regulatory/registrations/${reg?.id}`, { product: "Cabazitaxel 60 mg", status: "filed", filedOn: "2026-11-01" })).status).toBe(200);
    expect((await desk("esther")).pipeline.find((p) => p.id === made.id)?.stage).toBe("filed");
    expect(
      (await post("alikka", `/api/regulatory/registrations/${reg?.id}`, { product: "Cabazitaxel 60 mg", status: "approved", number: "DR-XY50001", filedOn: "2026-11-01", validUntil: "2031-11-01" })).status,
    ).toBe(200);
    const after = await desk("esther");
    expect(after.pipeline.find((p) => p.id === made.id)?.stage).toBe("registered");
    reg = after.registrations.find((r) => r.pipelineId === made.id);
    expect(reg?.flag).toBeNull();
    // A registered product does not go back to talks.
    expect((await post("dhebbie", `/api/regulatory/pipeline/${made.id}`, { name: "Cabazitaxel", stage: "talks" })).status).toBe(400);
    const history = (await (await get("ivy", `/api/regulatory/pipeline/${made.id}/history`)).json()) as RegEvent[];
    expect(history.map((e) => e.what)).toEqual([
      "→ Registered (from its registration)",
      "→ Filed with the FDA (from its registration)",
      "Handed to Regulatory Affairs: registration opened",
      "In talks → Dossier in hand",
      'Added at "In talks"',
    ]);
  });
});
