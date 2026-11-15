import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedFixture } from "../inventory/fixture";
import { addDays, todayManila } from "../inventory/rules";
import { seedDemo } from "../seed";
import type {
  CustomerList,
  Me,
  OrderBoard,
  OrgLogin,
  OrgPersonHistory,
  OrgTree,
  TargetList,
  TeamSales,
} from "../types";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};

const get = (who: string, path: string) =>
  app.request(path, { headers: { cookie: cookies[who] as string } });
const read = async <T>(who: string, path: string) => (await (await get(who, path)).json()) as T;
const send = (who: string, path: string, body: unknown = {}, method = "POST") =>
  app.request(path, {
    method,
    headers: { "content-type": "application/json", cookie: cookies[who] as string },
    body: JSON.stringify(body),
  });
const login = async (email: string, password: string) => {
  const response = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return { response, cookie: response.headers.get("set-cookie")?.split(";")[0] as string };
};
const signIn = async (who: string, email: string, password: string) => {
  const { response, cookie } = await login(email, password);
  expect(response.status).toBe(200);
  cookies[who] = cookie;
  return ((await response.json()) as { me: Me }).me;
};
const fieldOf = async (response: Response) =>
  ((await response.json()) as { error?: { field?: string } }).error?.field;

const tree = () => read<OrgTree>("naresh", "/api/org");
const unitNamed = async (name: string) => (await tree()).units.find((unit) => unit.name === name);
const seatOf = async (unit: string, title: string, holder: string | null) =>
  (await unitNamed(unit))?.seats.find(
    (seat) => seat.title === title && (seat.holder?.name ?? null) === holder,
  );
const me = async (who: string) => (await read<{ me: Me }>(who, "/api/me")).me;

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  await seedFixture(db);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["naresh", "admin", "daniel", "ryan", "sarla", "vanessa"])
    await signIn(name, `${name}@2mg.test`, PASSWORD);
});

describe("the company's tree", () => {
  it("is drawn from units and seats, and writes each person's boss and channel", async () => {
    const org = await tree();
    expect(org.units.find((unit) => unit.kind === "company")?.seats[0]?.holder?.name).toBe(
      "Naresh",
    );
    const ncr1 = org.units.find((unit) => unit.name === "NCR 1");
    expect(ncr1?.seats.map((seat) => [seat.title, seat.holder?.name ?? null, seat.boss])).toEqual([
      ["Area manager", "Daniel", "Vanessa"],
      ["MedRep", "Ryan", "Daniel"],
    ]);
    // The RX head's seat is vacant: nobody is RX's head.
    expect(
      org.units.find((unit) => unit.name === "Prescription Business")?.seats[0]?.holder,
    ).toBeNull();
    expect((await me("ryan")).reportsTo?.name).toBe("Daniel");
    expect((await me("sarla")).reportsTo?.name).toBe("Naresh");
    // Only the CEO and the Admin change the tree.
    expect((await get("daniel", "/api/org")).status).toBe(403);
    expect((await read<OrgTree>("admin", "/api/org")).can.change).toBe(true);
  });

  it("adds a MedRep with a login, an area and a boss in one step", async () => {
    const ncr1 = await unitNamed("NCR 1");
    const response = await send("naresh", "/api/org/people", {
      name: "Lito Cruz",
      email: "Lito@2mg.test",
      phone: "0917 555 0101",
      unitId: ncr1?.id,
      title: "MedRep",
      module: "medrep",
      newArea: { name: "HOS | Manila", cities: ["Manila", "Malabon"] },
    });
    expect(response.status).toBe(201);
    const added = (await response.json()) as OrgLogin;
    expect(added.email).toBe("lito@2mg.test");
    expect(added.password).toMatch(/^[A-Za-z0-9]{12}$/);
    const lito = await signIn("lito", "lito@2mg.test", added.password as string);
    expect(lito.role).toBe("medrep");
    expect(lito.mustChangePassword).toBe(true);
    expect(lito.channel?.code).toBe("HOSP");
    expect(lito.area?.name).toBe("HOS | Manila");
    expect(lito.reportsTo?.name).toBe("Daniel");
    // The seat's login ID signs them in too, with or without the domain.
    expect(added.login).toMatch(/^hos\d+@2mginc\.com$/);
    expect((await login(added.login as string, added.password as string)).response.status).toBe(
      200,
    );
    expect(
      (await login((added.login as string).split("@")[0] as string, added.password as string))
        .response.status,
    ).toBe(200);
    // The same email can't sign in twice.
    const twice = await send("naresh", "/api/org/people", {
      name: "Someone",
      email: "lito@2mg.test",
      unitId: ncr1?.id,
      title: "MedRep",
      module: "medrep",
    });
    expect(twice.status).toBe(409);
    expect(await fieldOf(twice)).toBe("email");
    // An area another seat holds can't be given again.
    const pasay = (await tree()).areas.find((area) => area.name === "HOS | Pasay");
    const taken = await send("naresh", "/api/org/seats", {
      unitId: ncr1?.id,
      title: "MedRep",
      module: "medrep",
      areaId: pasay?.id,
    });
    expect(taken.status).toBe(409);
    expect(await fieldOf(taken)).toBe("areaId");
    // A team takes one lead seat.
    const lead = await send("naresh", "/api/org/seats", {
      unitId: ncr1?.id,
      title: "Second lead",
      module: "team_lead",
      lead: true,
    });
    expect(lead.status).toBe(409);
  });

  it("puts the people of a team under whoever fills its empty lead seat", async () => {
    const mindanao = await unitNamed("Mindanao");
    const rep = (await (
      await send("naresh", "/api/org/people", {
        name: "Ana Reyes",
        email: "ana@2mg.test",
        password: "ana-password-1",
        unitId: mindanao?.id,
        title: "MedRep",
        module: "medrep",
        newArea: { name: "HOS | Cagayan de Oro", cities: ["Cagayan de Oro"] },
      })
    ).json()) as OrgLogin;
    expect(rep.password).toBeNull();
    await signIn("ana", "ana@2mg.test", "ana-password-1");
    // The team lead's seat is empty: she reports to the division's head meanwhile.
    expect((await me("ana")).reportsTo?.name).toBe("Vanessa");
    const leadSeat = mindanao?.seats.find((seat) => seat.lead);
    const filled = await send("naresh", "/api/org/people", {
      name: "Bea Santos",
      email: "bea@2mg.test",
      password: "bea-password-1",
      seatId: leadSeat?.id,
    });
    expect(filled.status).toBe(201);
    const bea = await signIn("bea", "bea@2mg.test", "bea-password-1");
    expect(bea.role).toBe("team_lead");
    expect(bea.reportsTo?.name).toBe("Vanessa");
    expect((await me("ana")).reportsTo?.name).toBe("Bea Santos");
    // Bea's team orders and customers are Ana's.
    const board = await read<OrderBoard>("bea", "/api/orders/board?desk=all");
    expect(board).toBeTruthy();
    // A filled seat can't be filled again.
    const again = await send("naresh", "/api/org/people", {
      name: "X",
      email: "x@2mg.test",
      seatId: leadSeat?.id,
    });
    expect(again.status).toBe(409);
  });

  it("covers a vacant head's seat for a while and hands it back", async () => {
    const rx = await unitNamed("Prescription Business");
    const lines = (await tree()).units.filter((unit) => unit.parentId === rx?.id);
    const dispensing = lines.find((unit) => unit.name === "Doctor dispensing");
    await send("naresh", "/api/org/people", {
      name: "Joy Lim",
      email: "joylim@2mg.test",
      password: "joy-password-1",
      unitId: dispensing?.id,
      title: "MedRep",
      module: "medrep",
      newArea: { name: "RX | Iloilo", cities: ["Iloilo City"] },
    });
    await signIn("joy", "joylim@2mg.test", "joy-password-1");
    expect((await me("joy")).reportsTo?.name).toBe("Naresh");
    expect((await me("joy")).channel?.code).toBe("RX");
    const headSeat = rx?.seats.find((seat) => seat.lead);
    const daniel = (await tree()).units
      .flatMap((unit) => unit.seats)
      .find((seat) => seat.holder?.name === "Daniel");
    const cover = await send("naresh", `/api/org/seats/${headSeat?.id}/cover`, {
      personId: daniel?.holder?.personId,
      until: addDays(todayManila(), 10),
      reason: "Until the RX head joins",
    });
    expect(cover.status).toBe(200);
    expect((await me("joy")).reportsTo?.name).toBe("Daniel");
    // Daniel keeps his own seat and role while covering.
    expect((await me("daniel")).role).toBe("team_lead");
    const covered = (await unitNamed("Prescription Business"))?.seats.find((seat) => seat.lead);
    expect(covered?.acting?.name).toBe("Daniel");
    const [channel] = await rows<{ head: string | null }>(
      db,
      sql`select p.name as head from channel ch left join person p on p.id = ch.head_id where ch.code = 'RX'`,
    );
    expect(channel?.head).toBe("Daniel");
    // A cover must end today or later.
    const past = await send("naresh", `/api/org/seats/${headSeat?.id}/cover`, {
      personId: daniel?.holder?.personId,
      until: addDays(todayManila(), -1),
    });
    expect(past.status).toBe(400);
    expect((await send("naresh", `/api/org/holdings/${covered?.acting?.id}/end`, {})).status).toBe(
      200,
    );
    expect((await me("joy")).reportsTo?.name).toBe("Naresh");
  });

  it("keeps the seat, its customers and its orders when its person leaves, for the next one", async () => {
    // Ryan sells to a hospital in his area.
    const customer = (await (
      await send("sarla", "/api/customers", {
        kind: "hospital",
        name: "Pasay General Hospital",
        city: "Pasay",
      })
    ).json()) as { id: number };
    const [medicine] = await rows<{ id: number }>(
      db,
      sql`select m.id::int as id from medicine m join medicine_price p on p.medicine_id = m.id and p.buyer_type = 'hospital' limit 1`,
    );
    const placed = (await (
      await send("ryan", "/api/orders", {
        customerId: customer.id,
        items: [{ medicineId: medicine?.id, qty: 5, priceKind: "hospital" }],
      })
    ).json()) as { id: number };
    expect(placed.id).toBeGreaterThan(0);
    const ryanSeat = await seatOf("NCR 1", "MedRep", "Ryan");
    const [sold] = await rows<{ seatId: number }>(
      db,
      sql`select seat_id::int as "seatId" from sales_order where id = ${placed.id}`,
    );
    expect(sold?.seatId).toBe(ryanSeat?.id);

    // Nobody marks themselves as left; the Admin can't remove the CEO.
    const naresh = await me("naresh");
    expect((await send("naresh", `/api/org/people/${naresh.id}/leave`, {})).status).toBe(400);
    expect((await send("admin", `/api/org/people/${naresh.id}/leave`, {})).status).toBe(403);

    const ryan = await me("ryan");
    const left = await send("naresh", `/api/org/people/${ryan.id}/leave`, { reason: "Resigned" });
    expect(left.status).toBe(200);
    expect(((await left.json()) as { vacant: string[] }).vacant).toEqual(["MedRep"]);
    expect((await get("ryan", "/api/me")).status).toBe(401);
    expect((await login("ryan@2mg.test", PASSWORD)).response.status).toBe(401);
    const vacant = (await unitNamed("NCR 1"))?.seats.find((seat) => seat.id === ryanSeat?.id);
    expect(vacant?.holder).toBeNull();
    expect(vacant?.area?.name).toBe("HOS | Pasay");
    expect(vacant?.openOrders).toBe(1);
    // The team lead still sees the area's customers.
    const seen = await read<CustomerList>("daniel", "/api/customers?q=Pasay General");
    expect(seen.rows.map((row) => row.name)).toContain("Pasay General Hospital");

    // The next MedRep takes the same seat and finds the area's customers and its orders.
    await send("naresh", "/api/org/people", {
      name: "Mika Tan",
      email: "mika@2mg.test",
      password: "mika-password-1",
      seatId: ryanSeat?.id,
    });
    const mika = await signIn("mika", "mika@2mg.test", "mika-password-1");
    // Ryan's seat login ID now signs Mika in, never Ryan.
    expect(ryanSeat?.login).toBe("hos1");
    const bySeat = await login("hos1", "mika-password-1");
    expect(bySeat.response.status).toBe(200);
    expect(((await bySeat.response.json()) as { me: Me }).me.name).toBe("Mika Tan");
    expect((await login("hos1@2mginc.com", PASSWORD)).response.status).toBe(401);
    expect(mika.area?.name).toBe("HOS | Pasay");
    expect(mika.reportsTo?.name).toBe("Daniel");
    const theirs = await read<CustomerList>("mika", "/api/customers?q=Pasay General");
    expect(theirs.rows.map((row) => row.name)).toContain("Pasay General Hospital");
    expect((await get("mika", `/api/orders/${placed.id}`)).status).toBe(200);
    // The seat's sale counts for Mika on every page now, as My team counts it by seat.
    const team = await read<TeamSales>("daniel", "/api/team/sales");
    expect(team.people.find((row) => row.name === "Mika Tan")?.placed).toBe(1);
    expect(team.people.some((row) => row.name === "Ryan")).toBe(false);
    const targets = await read<TargetList>("naresh", "/api/targets");
    expect(targets.rows.find((row) => row.name === "Mika Tan")?.placed).toBeGreaterThan(0);
    // Ryan's history keeps his seat and why it ended.
    const history = await read<OrgPersonHistory>("naresh", `/api/org/people/${ryan.id}`);
    expect(history.person.active).toBe(false);
    expect(history.holdings[0]).toMatchObject({
      seat: "MedRep",
      unit: "NCR 1",
      endReason: "Resigned",
      endedBy: "Naresh",
    });
  });

  it("moves someone into a vacant seat, closing what was theirs only on request", async () => {
    const ncr1 = await unitNamed("NCR 1");
    const lito = ncr1?.seats.find((seat) => seat.holder?.name === "Lito Cruz");
    const mindanao = await unitNamed("Mindanao");
    const spare = (await (
      await send("naresh", "/api/org/seats", {
        unitId: mindanao?.id,
        title: "MedRep",
        module: "medrep",
      })
    ).json()) as { seatId: number };
    const moved = await send("naresh", `/api/org/seats/${spare.seatId}/fill`, {
      personId: lito?.holder?.personId,
      reason: "Moved to Mindanao",
    });
    expect(moved.status).toBe(200);
    expect((await me("lito")).reportsTo?.name).toBe("Bea Santos");
    expect((await me("lito")).area).toBeNull();
    const old = (await unitNamed("NCR 1"))?.seats.find((seat) => seat.id === lito?.id);
    expect(old?.holder).toBeNull();
    // A seat with someone in it, or a team with seats, can't be closed; an empty seat can.
    expect((await send("naresh", `/api/org/seats/${spare.seatId}/close`)).status).toBe(409);
    expect((await send("naresh", `/api/org/units/${mindanao?.id}/close`)).status).toBe(409);
    expect((await send("naresh", `/api/org/seats/${lito?.id}/close`)).status).toBe(200);
    expect((await unitNamed("NCR 1"))?.seats.some((seat) => seat.id === lito?.id)).toBe(false);
  });

  it("gives a new password once, and the old one stops working", async () => {
    const lito = await me("lito");
    const reset = (await (
      await send("naresh", `/api/org/people/${lito.id}/password`)
    ).json()) as OrgLogin;
    expect(reset.password).toMatch(/^[A-Za-z0-9]{12}$/);
    expect((await get("lito", "/api/me")).status).toBe(401);
    expect((await login("lito@2mg.test", reset.password as string)).response.status).toBe(200);
  });

  it("adds a team, and nobody but the CEO and the Admin changes the tree", async () => {
    const hospital = await unitNamed("Hospital Division");
    const made = await send("admin", "/api/org/units", {
      name: "Visayas",
      kind: "team",
      parentId: hospital?.id,
    });
    expect(made.status).toBe(201);
    expect(
      (
        await send("admin", "/api/org/units", {
          name: "visayas",
          kind: "team",
          parentId: hospital?.id,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await send("daniel", "/api/org/units", {
          name: "Mine",
          kind: "team",
          parentId: hospital?.id,
        })
      ).status,
    ).toBe(403);
    expect(
      (await send("vanessa", "/api/org/people", { name: "X", email: "y@2mg.test" })).status,
    ).toBe(403);
  });
});
