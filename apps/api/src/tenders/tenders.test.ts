import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { seedB2bTeam } from "../b2b/seed";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedDemoInventory } from "../inventory/seed";
import { seedDemo } from "../seed";
import type { Tender, TenderDesk } from "../types";
import { seedHospitalBoxes } from "../sellers/seed";
import { seedBidding } from "./seed";

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
  await seedB2bTeam(db, PASSWORD);
  expect(await seedBidding(db, PASSWORD)).toBe(true);
  await seedHospitalBoxes(db, PASSWORD);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["jimmy", "hazel", "arron", "sam", "ryan", "rey", "vanessa"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
});

describe("government tenders", () => {
  it("the desk: deadlines this week, prices to approve, awards on their way to payment, papers ending", async () => {
    const desk = (await (await get("jimmy", "/api/tenders/desk")).json()) as TenderDesk;
    expect(desk.deadlines.map((t) => t.code).sort()).toEqual(["TND-DEMO-1", "TND-DEMO-2"]);
    expect(desk.toApprove.map((t) => t.code)).toEqual(["TND-DEMO-1"]);
    expect(desk.awaiting.map((t) => t.code)).toEqual(["TND-DEMO-3"]);
    expect(desk.toAccept.map((t) => t.code)).toEqual(["TND-DEMO-4"]);
    expect(desk.toCollect.map((t) => t.code)).toEqual(["TND-DEMO-5"]);
    expect(desk.papersEnding.map((p) => p.state).sort()).toEqual(["expired", "expiring"]);
    expect(desk.canApprove).toBe(true);
    expect((await get("sam", "/api/tenders")).status).toBe(200);
    expect(((await (await get("ryan", "/api/tenders")).json()) as Tender[]).length).toBe(0);
  });

  it("a tender from posting to payment: price approved by the Admin, a complete envelope, the award's steps", async () => {
    const [agency] = await rows<{ id: number }>(db, sql`select id::int as id from customer where name = 'East Avenue Medical Center'`);
    const made = await post("hazel", "/api/tenders", { agencyId: agency?.id, title: "Paclitaxel 300 mg vials", mode: "small_value", abc: 50000000 });
    expect(made.status).toBe(200);
    const { id } = (await made.json()) as { id: number };
    const step = (who: string, body: unknown) => post(who, `/api/tenders/${id}/step`, body);
    expect((await step("hazel", { step: "preparing" })).status).toBe(200);
    expect((await step("hazel", { step: "price_approved" })).status).toBe(403);
    expect((await step("jimmy", { step: "price_approved" })).status).toBe(400); // no bid price yet
    expect((await post("hazel", `/api/tenders/${id}/lines`, { lines: [{ medicineId: 1, qty: 100, unitPrice: 400000 }] })).status).toBe(200);
    expect((await step("jimmy", { step: "price_approved" })).status).toBe(200);
    expect((await step("hazel", { step: "submitted" })).status).toBe(400); // envelope not complete
    const detail = (await (await get("hazel", `/api/tenders/${id}`)).json()) as { tender: Tender };
    const papers = detail.tender.papers.map((p) => ({ ...p, done: true }));
    expect((await post("hazel", `/api/tenders/${id}`, { papers })).status).toBe(200);
    expect((await step("hazel", { step: "submitted" })).status).toBe(200);
    expect((await step("hazel", { step: "contract" })).status).toBe(409);
    for (const next of ["won", "contract", "delivered", "accepted", "billed", "paid"]) expect((await step("hazel", { step: next })).status).toBe(200);
    const done = (await (await get("hazel", `/api/tenders/${id}`)).json()) as { tender: Tender; events: unknown[]; next: string[] };
    expect(done.tender.step).toBe("paid");
    expect(done.events.length).toBe(10);
    expect(done.next).toEqual([]);
    const [lines] = await rows<{ n: number }>(db, sql`select count(*)::int as n from tender_line where tender_id = ${id}`);
    expect(lines?.n).toBe(1);
  });

  it("losing needs the winning bid or the reason; dropping needs the reason", async () => {
    const [agency] = await rows<{ id: number }>(db, sql`select id::int as id from customer where name = 'East Avenue Medical Center'`);
    const { id } = (await (await post("arron", "/api/tenders", { agencyId: agency?.id, title: "Heparin", mode: "competitive_bidding" })).json()) as { id: number };
    expect((await post("arron", `/api/tenders/${id}/step`, { step: "dropped" })).status).toBe(400);
    expect((await post("arron", `/api/tenders/${id}/step`, { step: "dropped", note: "Below our cost" })).status).toBe(200);
    expect((await post("ryan", "/api/tenders", { agencyId: agency?.id, title: "Paracetamol", mode: "other" })).status).toBe(403);
  });

  it("the Hospital Division's Government Account works its own tenders; its Mentor sees them", async () => {
    const [agency] = await rows<{ id: number }>(db, sql`select id::int as id from customer where name = 'East Avenue Medical Center'`);
    const made = await post("rey", "/api/tenders", { agencyId: agency?.id, title: "Cisplatin vials for the hospital", mode: "small_value" });
    expect(made.status).toBe(200);
    const mine = (await (await get("rey", "/api/tenders")).json()) as Tender[];
    expect(mine.map((t) => t.title)).toEqual(["Cisplatin vials for the hospital"]);
    const division = (await (await get("vanessa", "/api/tenders")).json()) as Tender[];
    expect(division.map((t) => t.title)).toEqual(["Cisplatin vials for the hospital"]);
    expect(((await (await get("ryan", "/api/tenders")).json()) as Tender[]).length).toBe(0);
  });
});
