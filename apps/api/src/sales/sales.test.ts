import { beforeAll, describe, expect, it } from "vitest";
import { ticked } from "../testing/approve";
import { createApp } from "../app";
import { type Database, openDatabase } from "../db/index";
import { migrate } from "../db/migrate";
import { seedFixture } from "../inventory/fixture";
import { todayManila } from "../inventory/rules";
import { seedDemo } from "../seed";
import type {
  Catalogue,
  CeoHome,
  ChannelFigures,
  CompanyTreeData,
  MyOrders,
  OrderDetail,
  TargetList,
  TeamSales,
} from "../types";
import { monthFacts, paceTone, sameDaysBefore } from "./rules";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
let credit: number;
let medicine: { id: number; price: number };
const month = todayManila().slice(0, 7);

const get = (who: string, path: string) =>
  app.request(path, { headers: { cookie: cookies[who] as string } });
const read = async <T>(who: string, path: string) => (await (await get(who, path)).json()) as T;
const post = (who: string, path: string, body: unknown = {}) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookies[who] as string },
    body: JSON.stringify(body),
  });

/** Ryan places it and Sarla approves it (its invoice is made then: it is sold); with `invoice`,
 *  Fiona also checks it and lets it go to Dispatch. */
async function order(qty: number, invoice: boolean): Promise<{ id: number; total: number }> {
  const placed = (await (
    await post("ryan", "/api/orders", {
      customerId: credit,
      items: [{ medicineId: medicine.id, qty, priceKind: "hospital" }],
    })
  ).json()) as { id: number };
  expect((await post("sarla", await ticked(db, `/api/orders/${placed.id}/approve`))).status).toBe(200);
  if (invoice)
    expect((await post("fiona", `/api/finance/orders/${placed.id}/invoice`)).status).toBe(200);
  const detail = (await (await get("ryan", `/api/orders/${placed.id}`)).json()) as OrderDetail;
  return { id: placed.id, total: detail.order.total };
}

let sold = 0;

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  await seedFixture(db);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["ryan", "daniel", "vanessa", "sarla", "fiona", "naresh", "admin"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
  credit = (
    (await (
      await post("sarla", "/api/customers", {
        kind: "hospital",
        name: "Olivarez General Hospital",
        city: "Parañaque",
        paymentTerms: "days",
        paymentDays: 30,
      })
    ).json()) as { id: number }
  ).id;
  const catalogue = await read<Catalogue>("sarla", "/api/inventory/medicines");
  const row = catalogue.rows.find(
    (item) => item.prices.hospital !== undefined && item.total >= 500,
  );
  if (!row) throw new Error("the fixture has no medicine with a hospital price and stock");
  medicine = { id: row.id, price: row.prices.hospital as number };
  // Four orders approved, so invoiced and sold (Aryan, 17 Nov: the invoice is made when
  // Management approves): two past Finance, one waiting for Finance, one on hold.
  sold += (await order(20, true)).total;
  sold += (await order(10, true)).total;
  sold += (await order(5, false)).total;
  const held = await order(3, false);
  sold += held.total;
  await post("fiona", `/api/orders/${held.id}/hold`, { reason: "Customer's account to check" });
  const ryanId = (await read<TargetList>("vanessa", `/api/targets?month=${month}`)).rows.find(
    (row) => row.name === "Ryan",
  )?.personId;
  expect(
    (await post("vanessa", "/api/targets", { personId: ryanId, month, amount: sold * 4 })).status,
  ).toBe(200);
});

describe("the rules", () => {
  it("knows how far through the month we are and where a figure stands against it", () => {
    const facts = monthFacts("2026-11", new Date("2026-11-15T04:00:00Z"));
    expect(facts).toMatchObject({
      month: "2026-11",
      today: "2026-11-15",
      running: true,
      pace: 0.5,
      daysLeft: 15,
      monthLabel: "November 2026",
    });
    expect(monthFacts("2026-10", new Date("2026-11-15T04:00:00Z"))).toMatchObject({
      running: false,
      pace: 1,
      daysLeft: 0,
    });
    expect(monthFacts("2027-01", new Date("2026-11-15T04:00:00Z")).month).toBe("2026-11");
    expect(paceTone(50, 100, 0.5)).toBe("on");
    expect(paceTone(30, 100, 0.5)).toBe("behind");
    expect(paceTone(20, 100, 0.5)).toBe("far");
    expect(paceTone(2, 100, 0.1)).toBe("behind");
    expect(paceTone(50, null, 0.5)).toBe("none");
    expect(sameDaysBefore({ month: "2026-03", today: "2026-03-30", running: true })).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
    });
    expect(sameDaysBefore({ month: "2026-10", today: "2026-11-15", running: false })).toEqual({
      from: "2026-09-01",
      to: "2026-09-30",
    });
  });
});

describe("a team's month", () => {
  it("counts what was invoiced against the target, for the team lead and the head above him", async () => {
    const lead = await read<TeamSales>("daniel", "/api/team/sales");
    const ryan = lead.people.find((row) => row.name === "Ryan");
    expect(ryan).toMatchObject({
      sold,
      target: sold * 4,
      pct: 25,
      placed: 4,
      waiting: 1,
      held: 1,
      depth: 0,
      area: "HOS | Pasay",
    });
    expect(lead.total).toMatchObject({ sold, target: sold * 4 });
    expect(lead.stopped.map((row) => row.reason)).toEqual(["Customer's account to check"]);
    expect(lead.lead?.name).toBe("Daniel");

    const head = await read<TeamSales>("vanessa", "/api/team/sales");
    expect(head.people.map((row) => [row.name, row.depth])).toEqual([
      ["Daniel", 0],
      ["Ryan", 1],
    ]);
    expect(head.total.sold).toBe(sold);
    expect((await get("ryan", "/api/team/sales")).status).toBe(403);
    expect((await get("sarla", "/api/team/sales")).status).toBe(403);
  });

  it("is the whole company for the CEO, and a month gone by is its own", async () => {
    const all = await read<TeamSales>("naresh", "/api/team/sales");
    expect(all.lead).toBeNull();
    expect(all.total.sold).toBe(sold);
    expect(all.people.some((row) => row.name === "Jane")).toBe(true);
    const before = await read<TeamSales>("naresh", "/api/team/sales?month=2020-01");
    expect(before).toMatchObject({ month: "2020-01", running: false, pace: 1 });
    expect(before.total.sold).toBe(0);
  });

  it("shows the MedRep and the targets page the same sold figure", async () => {
    const mine = await read<MyOrders>("ryan", "/api/orders/mine");
    expect(mine.sales).toMatchObject({ value: sold, orders: 4, target: sold * 4 });
    const targets = await read<TargetList>("vanessa", "/api/targets");
    expect(targets.rows.find((row) => row.name === "Ryan")?.sold).toBe(sold);
  });
});

describe("the channels and the CEO", () => {
  it("adds each channel's sales against its people's targets", async () => {
    const channels = await read<{ channels: ChannelFigures[] }>("naresh", "/api/channel-sales");
    const hosp = channels.channels.find((row) => row.code === "HOSP");
    expect(hosp).toMatchObject({ sold, target: sold * 4, pct: 25, head: "Vanessa" });
    expect(channels.channels.find((row) => row.code === "ONLINE")).toMatchObject({
      sold: 0,
      target: null,
      tone: "none",
    });
    expect((await get("ryan", "/api/channel-sales")).status).toBe(403);
  });

  it("draws the CEO Home from the same figures", async () => {
    const home = await read<CeoHome>("naresh", "/api/ceo/home");
    expect(home.sales).toMatchObject({ achieved: sold, target: sold * 4, pct: 25, collected: 0 });
    // The channels are the Company tree's boxes under each business (22 Nov): they add up to it.
    expect(home.sales.channels.filter((row) => row.business === "Hospital Division").reduce((sum, row) => sum + row.sold, 0)).toBe(sold);
    expect(home.sales.channels.reduce((sum, row) => sum + row.sold, 0)).toBe(sold);
    expect(home.money.owed).toBe(sold);
    expect(home.orders).toMatchObject({ finance: 1, onHold: 1 });
    expect(home.alerts.map((alert) => alert.text)).toContain("1 order is on hold");
    expect(home.sales.collectedBefore.from.slice(8)).toBe("01");
    expect((await read<CeoHome>("admin", "/api/ceo/home")).sales.achieved).toBe(sold);
    expect((await get("ryan", "/api/ceo/home")).status).toBe(403);
    expect((await get("sarla", "/api/ceo/home")).status).toBe(403);
  });

  it("gives the company tree its areas, holders, managers and figures", async () => {
    const tree = await read<CompanyTreeData>("naresh", "/api/company/tree");
    expect(tree.ceo).toBe("Naresh");
    const pasay = tree.territories.find((row) => row.name === "HOS | Pasay");
    expect(pasay).toMatchObject({
      holder: "Ryan",
      manager: "Daniel",
      achieved: sold,
      target: sold * 4,
    });
    const hosp = tree.channels.find((row) => row.code === "HOSP");
    expect(hosp).toMatchObject({ head: "Vanessa", crmAchieved: 0 });
    expect(tree.people.find((row) => row.name === "Ryan")).toMatchObject({
      rep: true,
      reportsToId: tree.people.find((row) => row.name === "Daniel")?.id,
    });
    expect((await get("daniel", "/api/company/tree")).status).toBe(403);
  });
});
