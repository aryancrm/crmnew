// A lead's pages follow the Admin panel's tree (Aryan, 19 Nov: "Subir looks after CLIDP and BID:
// how does he see each one's data?"): a lead of two teams has both on the team switch, each page
// narrows to the box picked (?unit=) and the boxes under it, "All" is both; a box not theirs is
// refused; someone whose second seat leads a team works as that team's lead.

import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedFixture } from "../inventory/fixture";
import { seedDemo } from "../seed";
import type { MyOrders, OrgMenuUnit, OrgTree, TargetList, TeamBoard } from "../types";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
let medicineId: number;

const get = (who: string, path: string) => app.request(path, { headers: { cookie: cookies[who] as string } });
const read = async <T>(who: string, path: string) => {
  const response = await get(who, path);
  expect(response.status, `${path}: ${await response.clone().text()}`).toBe(200);
  return (await response.json()) as T;
};
const send = async (who: string, path: string, body: unknown = {}) => {
  const response = await app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookies[who] as string },
    body: JSON.stringify(body),
  });
  expect(response.status, `${path}: ${await response.clone().text()}`).toBeLessThan(300);
  return (await response.json()) as Record<string, unknown>;
};
const signIn = async (who: string) => {
  const response = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: `${who}@2mg.test`, password: PASSWORD }),
  });
  expect(response.status).toBe(200);
  cookies[who] = response.headers.get("set-cookie")?.split(";")[0] as string;
};
const personId = async (name: string) =>
  (await rows<{ id: number }>(db, sql`select id::int as id from person where name = ${name}`))[0]?.id as number;

let ncr1: number;
let mindanao: number;
let rx: number;
let ryanOrder: number;

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  await seedFixture(db);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["naresh", "daniel", "vanessa", "ryan", "sarla"]) await signIn(name);
  const [medicine] = await rows<{ id: number }>(
    db,
    sql`select m.id::int as id from medicine m join medicine_price p on p.medicine_id = m.id and p.buyer_type = 'hospital' limit 1`,
  );
  medicineId = medicine?.id as number;
  const tree = await read<OrgTree>("naresh", "/api/org");
  const unit = (name: string) => tree.units.find((one) => one.name === name)?.id as number;
  ncr1 = unit("NCR 1");
  mindanao = unit("Mindanao");
  rx = unit("Prescription Business");
  // Daniel, NCR 1's lead, takes Mindanao's empty lead seat too: he leads two teams.
  const mindanaoLead = tree.units.find((one) => one.id === mindanao)?.seats.find((seat) => seat.lead);
  await send("naresh", `/api/org/seats/${mindanaoLead?.id}/fill`, { personId: await personId("Daniel"), keepOther: true });
  // Ryan (NCR 1) sells one order.
  const customer = await send("sarla", "/api/customers", { kind: "hospital", name: "Scope Pasay Hospital", city: "Pasay" });
  ryanOrder = (await send("ryan", "/api/orders", { customerId: customer.id, items: [{ medicineId, qty: 5, priceKind: "hospital" }] })).id as number;
});

describe("a lead's pages follow the tree", () => {
  it("gives a lead of two teams both on the switch, and All is both", async () => {
    const menu = await read<{ units: OrgMenuUnit[]; whole: boolean }>("daniel", "/api/org/menu");
    expect(menu.whole).toBe(false);
    expect(menu.units.filter((one) => one.level === 0).map((one) => one.name)).toEqual(["NCR 1", "Mindanao"]);
    const all = await read<TeamBoard>("daniel", "/api/team/board");
    expect(new Set(all.units.map((one) => one.name))).toEqual(new Set(["NCR 1", "Mindanao"]));
    const one = await read<TeamBoard>("daniel", `/api/team/board?unit=${mindanao}`);
    expect(one.units.map((box) => box.name)).toEqual(["Mindanao"]);
  });

  it("narrows every page to the box picked: orders, targets, attendance, sales", async () => {
    const orders = async (unit?: number) =>
      (await read<MyOrders>("daniel", `/api/orders/mine?stage=all&page=1${unit ? `&unit=${unit}` : ""}`)).cards.map((card) => card.id);
    expect(await orders()).toContain(ryanOrder);
    expect(await orders(ncr1)).toContain(ryanOrder);
    expect(await orders(mindanao)).not.toContain(ryanOrder);

    const targets = async (unit: number) => (await read<TargetList>("daniel", `/api/targets?unit=${unit}`)).rows.map((row) => row.name);
    expect(await targets(ncr1)).toContain("Ryan");
    expect(await targets(mindanao)).not.toContain("Ryan");

    const working = async (unit: number) =>
      (await read<{ people: { name: string }[] }>("daniel", `/api/hr/attendance?unit=${unit}`)).people.map((one) => one.name);
    expect(await working(ncr1)).toContain("Ryan");
    expect(await working(mindanao)).not.toContain("Ryan");

    // The head above both opens either; the CEO any box.
    expect((await get("vanessa", `/api/orders/mine?unit=${mindanao}`)).status).toBe(200);
    expect((await get("naresh", `/api/sales-performance?unit=${rx}`)).status).toBe(200);
  });

  it("refuses a box that isn't under the person, on any page", async () => {
    for (const path of ["/api/orders/mine", "/api/targets", "/api/hr/attendance", "/api/team/board", "/api/my/collections"])
      expect((await get("daniel", `${path}?unit=${rx}`)).status, path).toBe(403);
    expect((await get("ryan", `/api/orders/mine?unit=${ncr1}`)).status).toBe(403);
  });

  it("makes someone whose second seat leads a team that team's lead", async () => {
    const team = await send("naresh", "/api/org/units", { name: "Scope Telesales", kind: "team", parentId: (await read<OrgTree>("naresh", "/api/org")).units.find((one) => one.name === "Hospital Division")?.id });
    const seat = await send("naresh", "/api/org/seats", { unitId: team.unitId, title: "Sales Coach – Scope Telesales", module: "team_lead", lead: true });
    await send("naresh", `/api/org/seats/${seat.seatId}/fill`, { personId: await personId("Ryan"), keepOther: true });
    const me = await read<{ me: { role: string; business: string | null } }>("ryan", "/api/me");
    expect(me.me.role).toBe("team_lead");
    expect(me.me.business).toBe("HOSP");
    const menu = await read<{ units: OrgMenuUnit[] }>("ryan", "/api/org/menu");
    expect(menu.units.map((one) => one.name)).toEqual(["Scope Telesales"]);
    // His own MedRep seat stays his: his order is still his.
    expect((await read<MyOrders>("ryan", "/api/orders/mine?stage=all&page=1")).cards.map((card) => card.id)).toContain(ryanOrder);
  });
});
