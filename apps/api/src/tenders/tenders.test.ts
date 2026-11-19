import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { seedB2bTeam } from "../b2b/seed";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedDemoInventory } from "../inventory/seed";
import { seedDemo } from "../seed";
import type { BidReport, Tender, TenderDesk, TenderStanding } from "../types";
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

  it("the bid report: every price read, where ours stood, why we lost, by agency, the securities, late deliveries", async () => {
    const [agency] = await rows<{ id: number }>(db, sql`select id::int as id from customer where name = 'East Avenue Medical Center'`);
    const tender = async (title: string) => {
      const made = await post("hazel", "/api/tenders", { agencyId: agency?.id, title, mode: "competitive_bidding", abc: 90000000 });
      const { id } = (await made.json()) as { id: number };
      const step = (who: string, body: unknown) => post(who, `/api/tenders/${id}/step`, body);
      await step("hazel", { step: "preparing" });
      // Ours: ₱80,000 (100 × ₱800).
      await post("hazel", `/api/tenders/${id}/lines`, { lines: [{ medicineId: 1, qty: 100, unitPrice: 80000 }] });
      expect((await step("jimmy", { step: "price_approved" })).status).toBe(200);
      // The other bids are written once the bids are opened.
      expect((await post("hazel", `/api/tenders/${id}/bidders`, { name: "Rival Pharma", price: 7500000 })).status).toBe(409);
      const detail = (await (await get("hazel", `/api/tenders/${id}`)).json()) as { tender: Tender };
      await post("hazel", `/api/tenders/${id}`, { papers: detail.tender.papers.map((p) => ({ ...p, done: true })) });
      expect((await step("hazel", { step: "submitted" })).status).toBe(200);
      return { id, step };
    };

    const lost = await tender("Carboplatin 450 mg vials");
    for (const bidder of [
      { name: "Rival Pharma", price: 7500000 },
      { name: "Another Trading", price: 8200000 },
      { name: "Out Co", price: 7000000, disqualified: true, note: "No NFCC" },
    ])
      expect((await post("hazel", `/api/tenders/${lost.id}/bidders`, bidder)).status).toBe(200);
    const read = (await (await get("hazel", `/api/tenders/${lost.id}`)).json()) as { standing: TenderStanding };
    // The disqualified bid is not the lowest; ours is second, ₱5,000 (6.7%) above Rival Pharma.
    expect(read.standing).toMatchObject({ lowest: { name: "Rival Pharma", price: 7500000 }, rank: 2, gap: 500000, gapPct: 6.7 });
    // Losing needs the reason (or the winning bid, or a note).
    expect((await lost.step("hazel", { step: "lost" })).status).toBe(400);
    expect((await lost.step("hazel", { step: "lost", reason: "lower_price", winningBid: 7500000 })).status).toBe(200);

    const won = await tender("Docetaxel 80 mg vials");
    expect((await won.step("hazel", { step: "won" })).status).toBe(200);
    expect((await won.step("hazel", { step: "contract" })).status).toBe(200);
    // Delivery due yesterday and not delivered: late, 0.1% of the award a day.
    const yesterday = new Date(Date.now() - 86_400_000 + 8 * 3_600_000).toISOString().slice(0, 10);
    expect((await post("hazel", `/api/tenders/${won.id}`, { deliverBy: yesterday, performanceSecurityAmount: 400000 })).status).toBe(200);

    const report = (await (await get("hazel", "/api/tenders/report")).json()) as BidReport;
    const lostRow = report.rows.find((row) => row.id === lost.id);
    expect(lostRow).toMatchObject({ result: "lost", resultReason: "lower_price", rank: 2, gap: 500000, gapPct: 6.7 });
    expect(lostRow?.bids.map((bid) => bid.name)).toEqual(["Out Co", "Rival Pharma", "2MG (us)", "Another Trading"]);
    expect(report.rows.find((row) => row.id === won.id)).toMatchObject({ result: "won", rank: null });
    expect(report.byReason.find((one) => one.reason === "lower_price")?.count).toBeGreaterThanOrEqual(1);
    expect(report.byAgency.find((one) => one.agency === "East Avenue Medical Center")).toMatchObject({ won: expect.any(Number), lost: expect.any(Number) });
    expect(report.summary.won).toBeGreaterThanOrEqual(1);
    expect(report.summary.lost).toBeGreaterThanOrEqual(1);
    expect(report.securities).toContainEqual(expect.objectContaining({ id: won.id, kind: "performance", amount: 400000 }));
    expect(report.late).toContainEqual(expect.objectContaining({ id: won.id, daysLate: 1, penalty: 8000 }));
    // This month's desk counts this month's loss, not every loss ever.
    const desk = (await (await get("hazel", "/api/tenders/desk")).json()) as TenderDesk;
    expect(desk.month.lost).toBe(report.rows.filter((row) => row.result === "lost" && row.resultOn?.slice(0, 7) === desk.today.slice(0, 7)).length);
    // A bidder written by mistake comes off the report, kept.
    const bidders = await rows<{ id: number }>(db, sql`select id::int as id from tender_bidder where tender_id = ${lost.id} and name = 'Another Trading'`);
    expect((await post("hazel", `/api/tenders/bidders/${bidders[0]?.id}/remove`, {})).status).toBe(200);
    const after = (await (await get("hazel", `/api/tenders/${lost.id}`)).json()) as { standing: TenderStanding };
    expect(after.standing.bids.map((bid) => bid.name)).not.toContain("Another Trading");
    const [kept] = await rows<{ n: number }>(db, sql`select count(*)::int as n from tender_bidder where tender_id = ${lost.id}`);
    expect(kept?.n).toBe(3);
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
