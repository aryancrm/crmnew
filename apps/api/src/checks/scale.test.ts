// The whole company at its real size (Aryan: 130 people: the CEO, the Admin, several HR, two
// channels of teams with their team leads and MedReps), and who sees what: a MedRep their own,
// a team lead their team and not the next one, a channel head their channel and not the other,
// HR the people and not the orders, Management and the CEO everything. Then the data, checked
// against itself.

import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { ticked } from "../testing/approve";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedFixture } from "../inventory/fixture";
import { addPerson, addUnit } from "../org/service";
import { seedDemo } from "../seed";
import type { Catalogue, HrPeople, Me, OrderList } from "../types";
import { runChecks } from "./integrity";

const PASSWORD = "test-password-1";
const TEAMS = 4;
const REPS = 13;
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
let medicine: { id: number; price: number };
/** Each placed order, by who placed it ("hosp-1-1" = HOSP, team 1, MedRep 1). */
const orders: Record<string, number> = {};
const customers: Record<string, number> = {};

const login = async (email: string) => {
  const response = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(response.status, `sign in ${email}`).toBe(200);
  return response.headers.get("set-cookie")?.split(";")[0] as string;
};
const get = (who: string, path: string) =>
  app.request(path, { headers: { cookie: cookies[who] as string } });
const read = async <T>(who: string, path: string) => (await (await get(who, path)).json()) as T;
const post = (who: string, path: string, body: unknown = {}) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookies[who] as string },
    body: JSON.stringify(body),
  });
const sees = async (who: string, order: string) =>
  (await get(who, `/api/orders/${orders[order]}`)).status === 200;

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  await seedFixture(db);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  const [naresh] = await rows<{ id: number }>(
    db,
    sql`select id::int as id from person where email = 'naresh@2mg.test'`,
  );
  const ceo = { id: naresh?.id, name: "Naresh", role: "ceo" } as Me;
  const unitOf = async (name: string) =>
    (
      await rows<{ id: number }>(
        db,
        sql`select id::int as id from org_unit where name = ${name} and active`,
      )
    )[0]?.id as number;
  const person = (
    name: string,
    unitId: number,
    module: Me["role"],
    more: { lead?: boolean; area?: string; seatId?: number } = {},
  ) =>
    addPerson(db, ceo, {
      name,
      email: `${name.toLowerCase().replace(/\s+/g, ".")}@2mg.test`,
      password: PASSWORD,
      ...(more.seatId
        ? { seatId: more.seatId }
        : {
            unitId,
            title: module === "medrep" ? "MedRep" : module === "team_lead" ? "Team lead" : name,
            module,
            lead: more.lead ?? false,
            newArea: more.area ? { name: more.area, cities: [more.area] } : null,
          }),
      startsOn: "2025-06-01",
    });

  // The RX head's seat is vacant in the demo company: Rhea takes it.
  const rx = await unitOf("Prescription Business");
  const [rxHead] = await rows<{ id: number }>(
    db,
    sql`select id::int as id from seat where unit_id = ${rx} and lead and active`,
  );
  await person("Rhea Head", rx, "manager", { seatId: rxHead?.id });
  // Two channels of teams: a team lead and thirteen MedReps each, every MedRep in their own city.
  for (const [code, parent] of [
    ["hosp", await unitOf("Hospital Division")],
    ["rx", rx],
  ] as const)
    for (let team = 1; team <= TEAMS; team++) {
      const { unitId } = await addUnit(db, ceo, {
        name: `${code.toUpperCase()} Team ${team}`,
        kind: "team",
        parentId: parent,
      });
      await person(`${code} lead ${team}`, unitId, "team_lead", { lead: true });
      for (let rep = 1; rep <= REPS; rep++)
        await person(`${code} rep ${team}-${rep}`, unitId, "medrep", {
          area: `${code.toUpperCase()} City ${team}-${rep}`,
        });
    }
  // The desks, more than one of each.
  const hr = await unitOf("HR");
  for (const name of ["HR Two", "HR Three", "HR Four"]) await person(name, hr, "hr");
  await person("Mgmt Two", await unitOf("Management"), "management");
  const ops = await unitOf("Supply Chain, Ops & Finance");
  await person("Finance Two", ops, "finance");
  await person("Dispatch Two", ops, "dispatch");

  const catalogue = await (async () => {
    cookies.sarla = await login("sarla@2mg.test");
    return read<Catalogue>("sarla", "/api/inventory/medicines");
  })();
  const row = catalogue.rows.find(
    (item) => item.prices.hospital !== undefined && item.total >= 500,
  );
  if (!row) throw new Error("no medicine with a hospital price and stock");
  medicine = { id: row.id, price: row.prices.hospital as number };

  // Who signs in for the checks.
  for (const [key, email] of [
    ["ceo", "naresh@2mg.test"],
    ["admin", "admin@2mg.test"],
    ["vanessa", "vanessa@2mg.test"],
    ["rhea", "rhea.head@2mg.test"],
    ["hr2", "hr.two@2mg.test"],
    ["mgmt2", "mgmt.two@2mg.test"],
    ["fin2", "finance.two@2mg.test"],
    ["hlead1", "hosp.lead.1@2mg.test"],
    ["hlead2", "hosp.lead.2@2mg.test"],
    ["rlead1", "rx.lead.1@2mg.test"],
    ["h11", "hosp.rep.1-1@2mg.test"],
    ["h12", "hosp.rep.1-2@2mg.test"],
    ["h21", "hosp.rep.2-1@2mg.test"],
    ["r11", "rx.rep.1-1@2mg.test"],
  ] as const)
    cookies[key] = await login(email);

  // Four MedReps each add a hospital in their city and place an order for it.
  for (const [who, city] of [
    ["h11", "HOSP City 1-1"],
    ["h12", "HOSP City 1-2"],
    ["h21", "HOSP City 2-1"],
    ["r11", "RX City 1-1"],
  ] as const) {
    const made = await post(who, "/api/customers", {
      kind: "hospital",
      name: `Hospital of ${who}`,
      city,
      // From the field a hospital comes with its licence (the hub's rule).
      tin: "000-000-000-000",
      licenceOwner: `Owner of ${who}`,
      licenceNo: `LTO-${who}`,
      ltoType: "Hospital",
      licenceIssued: "2025-01-01",
      licenceExpires: "2028-01-01",
    });
    expect(made.status, `${who} adds a customer`).toBe(200);
    customers[who] = ((await made.json()) as { id: number }).id;
    const placed = await post(who, "/api/orders", {
      customerId: customers[who],
      items: [{ medicineId: medicine.id, qty: 5, priceKind: "hospital" }],
    });
    expect(placed.status, `${who} places an order`).toBe(200);
    orders[who] = ((await placed.json()) as { id: number }).id;
  }
}, 120_000);

describe("the whole company, 130 people", () => {
  it("has the people and every MedRep reports to their team lead, who reports to the head", async () => {
    const [count] = await rows<{ n: number }>(
      db,
      sql`select count(*)::int as n from person where active`,
    );
    expect(count?.n).toBeGreaterThanOrEqual(130);
    const line = await rows<{ rep: string; lead: string | null; head: string | null }>(
      db,
      sql`select p.name as rep, l.name as lead, h.name as head from person p
        left join person l on l.id = p.reports_to left join person h on h.id = l.reports_to
        where p.email like '%.rep.%'`,
    );
    expect(line).toHaveLength(2 * TEAMS * REPS);
    for (const one of line) {
      const team = one.rep.split(" ")[2]?.split("-")[0];
      const code = one.rep.split(" ")[0];
      expect(one.lead, one.rep).toBe(`${code} lead ${team}`);
      expect(one.head, one.rep).toBe(code === "hosp" ? "Vanessa" : "Rhea Head");
    }
  });

  it("a MedRep sees their own orders and customers, never a teammate's", async () => {
    expect(await sees("h11", "h11")).toBe(true);
    expect(await sees("h11", "h12")).toBe(false);
    expect(await sees("h11", "h21")).toBe(false);
    expect(await sees("h11", "r11")).toBe(false);
    const list = await read<OrderList>("h11", "/api/orders");
    expect(list.rows.map((row) => row.id)).toEqual([orders.h11]);
    expect((await get("h11", `/api/customers/${customers.h12}`)).status).toBe(404);
  });

  it("a team lead sees their team, not the next team", async () => {
    expect(await sees("hlead1", "h11")).toBe(true);
    expect(await sees("hlead1", "h12")).toBe(true);
    expect(await sees("hlead1", "h21")).toBe(false);
    expect(await sees("hlead1", "r11")).toBe(false);
    expect(await sees("hlead2", "h21")).toBe(true);
    expect(await sees("hlead2", "h11")).toBe(false);
    expect(await sees("rlead1", "r11")).toBe(true);
    expect(await sees("rlead1", "h11")).toBe(false);
  });

  it("a channel head sees their channel, not the other", async () => {
    for (const order of ["h11", "h12", "h21"]) expect(await sees("vanessa", order)).toBe(true);
    expect(await sees("vanessa", "r11")).toBe(false);
    expect(await sees("rhea", "r11")).toBe(true);
    expect(await sees("rhea", "h11")).toBe(false);
  });

  it("Management, Finance, the CEO and the Admin see every order; only Management approves", async () => {
    for (const who of ["mgmt2", "fin2", "ceo", "admin"])
      for (const order of ["h11", "h21", "r11"]) expect(await sees(who, order), who).toBe(true);
    for (const who of ["h11", "hlead1", "vanessa", "hr2", "fin2"])
      expect((await post(who, await ticked(db, `/api/orders/${orders.h21}/approve`))).status, who).not.toBe(200);
    expect((await post("mgmt2", await ticked(db, `/api/orders/${orders.h21}/approve`))).status).toBe(200);
  });

  it("HR sees every person and no order", async () => {
    const people = await read<HrPeople>("hr2", "/api/hr/people");
    expect(people.rows.length).toBeGreaterThanOrEqual(110);
    for (const order of ["h11", "r11"]) expect(await sees("hr2", order)).toBe(false);
    // A MedRep can't open the people's records.
    expect((await get("h11", "/api/hr/people")).status).toBe(403);
  });

  it("the same sales on every screen: the CEO's, the channel head's, the team lead's, the MedRep's", async () => {
    cookies.marco = await login("marco@2mg.test");
    // Every order approved, paid, packed, shipped and delivered.
    for (const who of ["h11", "h12", "h21", "r11"]) {
      const id = orders[who] as number;
      const before = (
        await read<{ order: { status: string; total: number } }>("ceo", `/api/orders/${id}`)
      ).order;
      if (before.status === "pending_approval")
        expect((await post("mgmt2", await ticked(db, `/api/orders/${id}/approve`), { finance: true })).status).toBe(
          200,
        );
      const now = (await read<{ order: { status: string } }>("ceo", `/api/orders/${id}`)).order;
      if (now.status === "finance_check")
        expect(
          (
            await post("fin2", `/api/finance/orders/${id}/confirm-payment`, {
              amount: before.total,
              method: "bank",
              reference: `BDO-${id}`,
              paidOn: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(
                new Date(),
              ),
              checked: true,
            })
          ).status,
        ).toBe(200);
      else if (now.status === "ready_for_invoice")
        expect((await post("fin2", `/api/finance/orders/${id}/invoice`)).status).toBe(200);
    }
    const sum = async (where: ReturnType<typeof sql>) =>
      (
        await rows<{ n: number }>(
          db,
          sql`select coalesce(sum(i.total), 0)::int as n from invoice i join sales_order o on o.id = i.order_id
            join channel ch on ch.id = o.channel_id where i.status <> 'cancelled' and ${where}`,
        )
      )[0]?.n ?? 0;
    const all = await sum(sql`true`);
    const hosp = await sum(sql`ch.code = 'HOSP'`);
    const team1 = await sum(sql`o.id in (${orders.h11}, ${orders.h12})`);
    const mine = await sum(sql`o.id = ${orders.h11}`);
    expect(all).toBeGreaterThan(0);
    const ceo = await read<{
      sales: { achieved: number; channels: { business: string | null; sold: number }[] };
    }>("ceo", "/api/ceo/home");
    expect(ceo.sales.achieved).toBe(all);
    // The channels are the Company tree's boxes under each business (22 Nov): the Hospital
    // Division's add up to its head's figure, and all of them to the company's.
    expect(ceo.sales.channels.filter((one) => one.business === "Hospital Division").reduce((sum, one) => sum + one.sold, 0)).toBe(hosp);
    expect(ceo.sales.channels.reduce((sum, one) => sum + one.sold, 0)).toBe(all);
    const vanessa = await read<{ total: { sold: number } }>("vanessa", "/api/team/sales");
    expect(vanessa.total.sold).toBe(hosp);
    const lead = await read<{ total: { sold: number } }>("hlead1", "/api/team/sales");
    expect(lead.total.sold).toBe(team1);
    // The MedRep's own Home: this month's sales.
    const rep = await read<{ sales: { value: number } }>("h11", "/api/orders/mine");
    expect(rep.sales.value).toBe(mine);
  });

  it("the data comes out clean", async () => {
    const result = await runChecks(db);
    const wrong = result.checks.filter((check) => !check.ok);
    expect(wrong.map((check) => `${check.label}: ${check.problems.join("; ")}`)).toEqual([]);
  });
});
