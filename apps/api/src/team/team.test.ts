import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedFixture } from "../inventory/fixture";
import { divisionOfChannel } from "../orders/divisions";
import { seedDemo } from "../seed";
import type { CustomerList, Me, MyOrders, OrderForList, OrgTree, TeamBoard } from "../types";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
let medicineId: number;

const get = (who: string, path: string) =>
  app.request(path, { headers: { cookie: cookies[who] as string } });
const read = async <T>(who: string, path: string) => (await (await get(who, path)).json()) as T;
const send = (who: string, path: string, body: unknown = {}) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookies[who] as string },
    body: JSON.stringify(body),
  });
const signIn = async (who: string, email = `${who}@2mg.test`, password = PASSWORD) => {
  const response = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  expect(response.status).toBe(200);
  cookies[who] = response.headers.get("set-cookie")?.split(";")[0] as string;
};
const board = (who: string, query = "") => read<TeamBoard>(who, `/api/team/board${query}`);
const tree = () => read<OrgTree>("naresh", "/api/org");
const order = async (who: string, customerId: number, qty = 5) =>
  (
    (await (
      await send(who, "/api/orders", {
        customerId,
        items: [{ medicineId, qty, priceKind: "hospital" }],
      })
    ).json()) as { id: number }
  ).id;
const customer = async (name: string, city: string) =>
  (
    (await (await send("sarla", "/api/customers", { kind: "hospital", name, city })).json()) as {
      id: number;
    }
  ).id;

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
});

describe("a team lead's team", () => {
  it("is every seat under them, empty ones too, with where their orders stand", async () => {
    const ncr1 = (await tree()).units.find((unit) => unit.name === "NCR 1");
    await send("naresh", "/api/org/seats", {
      unitId: ncr1?.id,
      title: "MedRep",
      module: "medrep",
      newArea: { name: "HOS | Quezon City", cities: ["Quezon City"] },
    });
    const pasay = await customer("Pasay City General", "Pasay");
    const qc = await customer("East Avenue Medical Center", "Quezon City");
    const first = await order("ryan", pasay);
    await order("ryan", pasay, 3);
    // The team lead places the empty seat's order himself.
    await order("daniel", qc, 2);
    const held = await order("ryan", pasay, 7);
    expect(
      (await send("sarla", `/api/orders/${held}/hold`, { reason: "Price to check" })).status,
    ).toBe(200);

    const seen = await board("daniel");
    expect(seen.lead).toMatchObject({ name: "Daniel", units: ["NCR 1"], covering: [] });
    expect(seen.units.map((unit) => unit.name)).toEqual(["NCR 1"]);
    const ryan = seen.seats.find((seat) => seat.person?.name === "Ryan");
    expect(ryan?.area?.name).toBe("HOS | Pasay");
    expect(ryan?.stages).toMatchObject({ management: 2, held: 1 });
    expect(ryan?.placed).toBe(3);
    expect(ryan?.oldest?.status).toBe("pending_approval");
    const empty = seen.seats.find((seat) => !seat.person);
    expect(empty?.area?.name).toBe("HOS | Quezon City");
    expect(empty?.stages.management).toBe(1);
    expect(empty?.customers).toBe(1);
    expect(seen.totals).toMatchObject({ waiting: 3, stopped: 1, vacant: 1, placed: 4 });
    // The order and seat needs; a scorecard one may follow, by the day of the month.
    expect(seen.needs.filter((need) => need.kind !== "score").map((need) => need.kind)).toEqual(["held", "vacant"]);
    expect(seen.needs[1]?.why).toContain("1 customer and 1 open order wait with you");

    // One seat's orders and customers, for the person's page.
    const mine = await read<MyOrders>("daniel", `/api/orders/mine?seat=${empty?.seatId}`);
    expect(mine.counts.all).toBe(1);
    expect(mine.cards[0]?.customer).toBe("East Avenue Medical Center");
    const theirs = await read<CustomerList>("daniel", `/api/customers?seat=${ryan?.seatId}`);
    expect(theirs.rows.map((row) => row.name)).toContain("Pasay City General");
    expect(theirs.rows.map((row) => row.name)).not.toContain("East Avenue Medical Center");
    // A MedRep can't read another seat's orders by naming it.
    const other = await read<MyOrders>("ryan", `/api/orders/mine?seat=${empty?.seatId}`);
    expect(other.counts.all).toBe(0);
    expect(first).toBeGreaterThan(0);
  });

  it("is late when an order stands too long at its step, and sent back first", async () => {
    const pasay = await customer("Pasay Late Hospital", "Pasay");
    const late = await order("ryan", pasay);
    await db.execute(
      // Ten days back holds more than Management's four working hours, whatever day it runs.
      sql`update sales_order set status_since = now() - interval '10 days' where id = ${late}`,
    );
    const back = await order("ryan", pasay, 4);
    expect(
      (await send("sarla", `/api/orders/${back}/send_back`, { reason: "Wrong price" })).status,
    ).toBe(200);
    const seen = await board("daniel");
    expect(seen.needs[0]).toMatchObject({
      kind: "sent_back",
      orderId: back,
      who: "Ryan",
      why: "Management sent it back to Ryan: Wrong price",
    });
    const flagged = seen.needs.find((need) => need.orderId === late);
    expect(flagged?.kind).toBe("late");
    expect(flagged?.why).toBe("At Management for 10d");
  });

  it("is every team under a head; the CEO picks any box; a MedRep has none", async () => {
    const head = await board("vanessa");
    // The Patient Assistance Program is its own channel, not the hospitals' head's.
    expect(head.units.map((unit) => unit.name)).toEqual(["Hospital Division", "NCR 1", "Mindanao"]);
    expect(head.seats.some((seat) => seat.person?.name === "Daniel" && seat.lead)).toBe(true);
    expect(head.seats.some((seat) => seat.person?.name === "Ryan")).toBe(true);
    // Mindanao's lead seat is empty: it is Vanessa's to fill or cover.
    expect(
      head.seats.some(
        (seat) =>
          seat.lead &&
          !seat.person &&
          seat.unitId === head.units.find((unit) => unit.name === "Mindanao")?.id,
      ),
    ).toBe(true);
    const ncr1 = (await tree()).units.find((unit) => unit.name === "NCR 1");
    const one = await board("naresh", `?unit=${ncr1?.id}`);
    expect(one.units.map((unit) => unit.name)).toEqual(["NCR 1"]);
    expect((await get("ryan", "/api/team/board")).status).toBe(403);
    // The CEO with no box asked sees the whole company; a head opens a team under them, not another.
    const company = await board("naresh");
    expect(company.viewing).toBe("2MG Inc.");
    expect(company.path).toEqual([{ id: company.rootIds[0], name: "2MG Inc." }]);
    expect(company.seats.some((seat) => seat.person?.name === "Sarla")).toBe(true);
    const down = await board("vanessa", `?unit=${ncr1?.id}`);
    expect(down.path.map((one) => one.name)).toEqual(["Hospital Division", "NCR 1"]);
    expect(down.seats.every((seat) => seat.unitId === ncr1?.id)).toBe(true);
    const rx = (await tree()).units.find((unit) => unit.name === "Prescription Business");
    expect((await get("vanessa", `/api/team/board?unit=${rx?.id}`)).status).toBe(403);
  });

  it("keeps a seat's orders with the team when its MedRep moves to another team", async () => {
    const pasay = await customer("Pasay Moved Hospital", "Pasay");
    const sold = await order("ryan", pasay);
    const mindanao = (await tree()).units.find((unit) => unit.name === "Mindanao");
    const spare = (await (
      await send("naresh", "/api/org/seats", {
        unitId: mindanao?.id,
        title: "MedRep",
        module: "medrep",
      })
    ).json()) as { seatId: number };
    const ryan = (await read<{ me: Me }>("ryan", "/api/me")).me.id;
    expect(
      (await send("naresh", `/api/org/seats/${spare.seatId}/fill`, { personId: ryan })).status,
    ).toBe(200);
    // Ryan now reports to Vanessa (Mindanao has no lead); his Pasay order stays in Daniel's team.
    expect((await read<{ me: Me }>("ryan", "/api/me")).me.reportsTo?.name).toBe("Vanessa");
    expect((await get("daniel", `/api/orders/${sold}`)).status).toBe(200);
    const seen = await board("daniel");
    const pasaySeat = seen.seats.find((seat) => seat.area?.name === "HOS | Pasay");
    expect(pasaySeat?.person).toBeNull();
    expect(pasaySeat?.stages.management).toBeGreaterThan(0);
  });

  it("lets a team lead place an order in one of their MedReps' names, not anyone else's", async () => {
    // Ryan moved to Mindanao above, so he is now under Vanessa, the head.
    const pasay = await customer("Pasay For Ryan Hospital", "Pasay");
    const ryan = (await read<{ me: Me }>("ryan", "/api/me")).me.id;
    const sarla = (await read<{ me: Me }>("sarla", "/api/me")).me.id;
    const list = await read<OrderForList>("vanessa", `/api/orders/for?customerId=${pasay}`);
    expect(list.can).toBe(true);
    expect(list.medreps.map((rep) => rep.name)).toContain("Ryan");
    expect((await read<OrderForList>("ryan", "/api/orders/for")).can).toBe(false);
    const placed = (await (
      await send("vanessa", "/api/orders", {
        customerId: pasay,
        medrepId: ryan,
        items: [{ medicineId, qty: 2, priceKind: "hospital" }],
      })
    ).json()) as { id: number };
    const [order] = await rows<{ medrepId: number; raisedBy: number; division: string | null }>(
      db,
      sql`select medrep_id::int as "medrepId", raised_by::int as "raisedBy", division from sales_order where id = ${placed.id}`,
    );
    expect(order?.medrepId).toBe(ryan);
    // Booked under Ryan's own channel (Hospital), whoever placed it.
    const [his] = await rows<{ code: string | null }>(
      db,
      sql`select ch.code from person p left join channel ch on ch.id = p.channel_id where p.id = ${ryan}`,
    );
    expect(order?.division).toBe(divisionOfChannel(his?.code) || null);
    const wrong = await send("vanessa", "/api/orders", {
      customerId: pasay,
      medrepId: sarla,
      items: [{ medicineId, qty: 2, priceKind: "hospital" }],
    });
    expect(wrong.status).toBe(400);
  });
});
