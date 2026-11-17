// The Admin panel's channels: a new channel is added in one step (its own box at the top of the
// company comes with it), its head, team, team lead and MedRep go in through the usual seats, and
// from there the rest of the product takes it: the MedRep's customers, his orders carrying the
// channel's own Division, the CEO's channel figures. A channel goes out of use only once nobody
// works in it, and then leaves the CEO's lists.

import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase } from "../db/index";
import { migrate } from "../db/migrate";
import { seedFixture } from "../inventory/fixture";
import { seedDemo } from "../seed";
import type { Catalogue, CeoHome, Me, OrderDetail, OrgLogin, OrgTree } from "../types";
import type { OrgMenuUnit } from "../types";

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
const signIn = async (who: string, email: string, password: string) => {
  const response = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  expect(response.status).toBe(200);
  cookies[who] = response.headers.get("set-cookie")?.split(";")[0] as string;
  return ((await response.json()) as { me: Me }).me;
};
const fieldOf = async (response: Response) =>
  ((await response.json()) as { error?: { field?: string } }).error?.field;
const tree = () => read<OrgTree>("admin", "/api/org");

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  await seedFixture(db);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["naresh", "admin", "daniel", "sarla"])
    await signIn(name, `${name}@2mg.test`, PASSWORD);
});

describe("the Admin panel's channels", () => {
  it("knows each channel's Division", async () => {
    const channels = (await tree()).channels;
    expect(channels.find((one) => one.code === "HOSP")).toMatchObject({
      division: "HOS",
      active: true,
    });
    expect(channels.find((one) => one.code === "ONLINE")?.division).toBe("B2C");
  });

  it("keeps the Patient Assistance Program a channel of its own, and stands a box alone when moved", async () => {
    let now = await tree();
    const byId = new Map(now.units.map((unit) => [unit.id, unit]));
    const pap = now.units.find((unit) => unit.channel?.code === "PAP");
    expect(pap?.kind).toBe("business");
    expect(byId.get(pap?.parentId ?? 0)?.kind).toBe("company");
    const hospital = now.units.find((unit) => unit.name === "Hospital Division");
    expect(
      now.units.filter((unit) => unit.parentId === hospital?.id).map((unit) => unit.name),
    ).toEqual(["NCR 1", "Mindanao"]);
    // A line moved straight under the company becomes a business of its own.
    const company = now.units.find((unit) => unit.kind === "company");
    const md = now.units.find((unit) => unit.name === "MD Telesales");
    expect(md?.kind).toBe("line");
    expect(
      (await send("admin", `/api/org/units/${md?.id}`, { parentId: company?.id }, "PATCH")).status,
    ).toBe(200);
    now = await tree();
    expect(now.units.find((unit) => unit.id === md?.id)).toMatchObject({
      kind: "business",
      parentId: company?.id,
    });
  });

  it("adds a channel whose people, customers and orders work like every other", async () => {
    // Only the CEO and the Admin add channels, with a short code and a Division from the list.
    expect(
      (await send("daniel", "/api/org/channels", { code: "URO", name: "Uro & Onco Care" })).status,
    ).toBe(403);
    const badCode = await send("admin", "/api/org/channels", { code: "U R O", name: "Uro" });
    expect(badCode.status).toBe(400);
    expect(await fieldOf(badCode)).toBe("code");
    const badDivision = await send("admin", "/api/org/channels", {
      code: "URO",
      name: "Uro & Onco Care",
      division: "Nowhere",
    });
    expect(badDivision.status).toBe(400);
    expect(await fieldOf(badDivision)).toBe("division");

    const made = await send("admin", "/api/org/channels", {
      code: "uro",
      name: "Uro & Onco Care",
      division: "URO",
    });
    expect(made.status, await made.clone().text()).toBe(201);
    const { channelId, unitId } = (await made.json()) as { channelId: number; unitId: number };
    expect(
      (await send("admin", "/api/org/channels", { code: "URO", name: "Something else" })).status,
    ).toBe(409);

    // Its box sits at the top of the company, with the channel on it.
    let now = await tree();
    expect(now.channels.find((one) => one.id === channelId)).toMatchObject({
      code: "URO",
      division: "URO",
      active: true,
    });
    const box = now.units.find((unit) => unit.id === unitId);
    expect(box).toMatchObject({ kind: "business", channel: { code: "URO" } });
    expect(now.units.find((unit) => unit.id === box?.parentId)?.kind).toBe("company");

    // Its head, a team under it, and the team's MedRep with a new area.
    const head = await send("admin", "/api/org/people", {
      name: "Rosa Lim",
      email: "rosa@2mg.test",
      unitId,
      title: "URO head",
      module: "team_lead",
      lead: true,
    });
    expect(head.status, await head.clone().text()).toBe(201);
    const team = await send("admin", "/api/org/units", {
      name: "Visayas",
      kind: "team",
      parentId: unitId,
    });
    expect(team.status).toBe(201);
    const teamId = ((await team.json()) as { unitId: number }).unitId;
    const rep = await send("admin", "/api/org/people", {
      name: "Paolo Reyes",
      email: "paolo@2mg.test",
      unitId: teamId,
      title: "MedRep",
      module: "medrep",
      newArea: { name: "URO | Iloilo", cities: ["Iloilo City"] },
    });
    expect(rep.status, await rep.clone().text()).toBe(201);
    const paoloLogin = (await rep.json()) as OrgLogin;
    const paolo = await signIn("paolo", "paolo@2mg.test", paoloLogin.password as string);
    expect(paolo.channel?.code).toBe("URO");
    expect(paolo.area?.name).toBe("URO | Iloilo");
    expect(paolo.reportsTo?.name).toBe("Rosa Lim");

    // A hospital in his area becomes his; his order carries the channel's own Division.
    const customer = await send("sarla", "/api/customers", {
      kind: "hospital",
      name: "Iloilo Doctors' Hospital",
      city: "Iloilo City",
      paymentTerms: "cod",
    });
    expect(customer.status).toBe(200);
    const customerId = ((await customer.json()) as { id: number }).id;
    const catalogue = await read<Catalogue>("sarla", "/api/inventory/medicines");
    const medicine = catalogue.rows.find(
      (row) => row.prices.hospital !== undefined && row.total >= 20,
    );
    expect(medicine).toBeTruthy();
    const placed = await send("paolo", "/api/orders", {
      customerId,
      items: [{ medicineId: medicine?.id, qty: 2, priceKind: "hospital" }],
    });
    expect(placed.status, await placed.clone().text()).toBe(200);
    const orderId = ((await placed.json()) as { id: number }).id;
    const detail = await read<OrderDetail>("sarla", `/api/orders/${orderId}`);
    expect(detail.order.division).toBe("URO");

    // The CEO's channels list it with every other.
    const home = await read<CeoHome>("naresh", "/api/ceo/home");
    expect(home.sales.channels.some((one) => one.code === "URO")).toBe(true);

    // A rename keeps its box's name in step; it can't leave use while people work in it.
    expect(
      (
        await send(
          "admin",
          `/api/org/channels/${channelId}`,
          { name: "Uro and Onco Care", division: "URO" },
          "PATCH",
        )
      ).status,
    ).toBe(200);
    now = await tree();
    expect(now.units.find((unit) => unit.id === unitId)?.name).toBe("Uro and Onco Care");
    const busy = await send("admin", `/api/org/channels/${channelId}`, { active: false }, "PATCH");
    expect(busy.status).toBe(409);
    expect(await fieldOf(busy)).toBe("active");
  });

  it("takes an empty channel out of use, off the CEO's lists, and back again", async () => {
    const made = await send("admin", "/api/org/channels", {
      code: "STC",
      name: "Solid Tumor Care",
      division: "STC",
    });
    expect(made.status).toBe(201);
    const { channelId } = (await made.json()) as { channelId: number };
    const out = await send("admin", `/api/org/channels/${channelId}`, { active: false }, "PATCH");
    expect(out.status, await out.clone().text()).toBe(200);
    expect((await tree()).channels.find((one) => one.id === channelId)?.active).toBe(false);
    const home = await read<CeoHome>("naresh", "/api/ceo/home");
    expect(home.sales.channels.some((one) => one.code === "STC")).toBe(false);
    const menu = await read<{ units: { name: string }[] }>("naresh", "/api/org/menu");
    expect(menu.units.some((unit) => unit.name === "Solid Tumor Care")).toBe(false);
    expect(
      (await send("admin", `/api/org/channels/${channelId}`, { active: true }, "PATCH")).status,
    ).toBe(200);
    expect((await tree()).channels.find((one) => one.id === channelId)?.active).toBe(true);
  });

  it("gives the team switch every box under a lead, with the box above and who leads it", async () => {
    const menu = await read<{ units: OrgMenuUnit[] }>("naresh", "/api/org/menu");
    const ids = new Set(menu.units.map((unit) => unit.id));
    // Every box below the top hangs from a box in the list, at any depth.
    for (const unit of menu.units.filter((one) => one.level > 0))
      expect(ids.has(unit.parentId as number), unit.name).toBe(true);
    // A box whose lead seat is held names its lead.
    expect(menu.units.some((unit) => unit.lead)).toBe(true);
  });
});
