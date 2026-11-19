import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedDemo } from "../seed";
import type { Me, NotificationList, OrgLogin, OrgTree, SeatRequestForm } from "../types";

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
const tree = () => read<OrgTree>("naresh", "/api/org");

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["naresh", "admin", "daniel", "ryan", "vanessa", "sarla"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
});

describe("areas", () => {
  it("are added and changed by the CEO, and take the customers of their cities", async () => {
    const hosp = (await tree()).channels.find((channel) => channel.code === "HOSP");
    expect(
      (
        await send("sarla", "/api/customers", {
          kind: "hospital",
          name: "Manila Doctors Hospital",
          city: "Manila",
        })
      ).ok,
    ).toBe(true);
    const made = await send("naresh", "/api/org/areas", {
      channelId: hosp?.id,
      name: "HOS | Manila",
      cities: ["Manila"],
    });
    expect(made.status).toBe(201);
    const area = (await tree()).areas.find((one) => one.name === "HOS | Manila");
    expect(area).toMatchObject({ cities: ["Manila"], seatId: null, customers: 1 });
    expect(
      (
        await send("naresh", "/api/org/areas", {
          channelId: hosp?.id,
          name: "hos | manila",
          cities: [],
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await send(
          "naresh",
          `/api/org/areas/${area?.id}`,
          { cities: ["Manila", "Malabon"] },
          "PATCH",
        )
      ).status,
    ).toBe(200);
    expect((await tree()).areas.find((one) => one.id === area?.id)?.cities).toEqual([
      "Manila",
      "Malabon",
    ]);
    expect(
      (await send("daniel", "/api/org/areas", { channelId: hosp?.id, name: "Mine", cities: [] }))
        .status,
    ).toBe(403);
  });
});

describe("a team lead asks for a new person", () => {
  it("asks for their own teams only; the CEO approves and the login is made", async () => {
    const form = await read<SeatRequestForm>("daniel", "/api/org/requests/form");
    expect(form.units.map((unit) => unit.name)).toEqual(["NCR 1"]);
    expect(form.areas.map((area) => area.name)).toContain("HOS | Manila");
    expect((await get("ryan", "/api/org/requests/form")).status).toBe(403);
    const mindanao = (await tree()).units.find((unit) => unit.name === "Mindanao");
    expect(
      (await send("daniel", "/api/org/requests", { unitId: mindanao?.id, module: "medrep" }))
        .status,
    ).toBe(403);
    const asked = await send("daniel", "/api/org/requests", {
      unitId: form.units[0]?.id,
      module: "medrep",
      newArea: { name: "HOS | Caloocan", cities: ["Caloocan"] },
      personName: "Tess Garcia",
      personPhone: "0917 444 1212",
      reason: "North Manila hospitals have nobody.",
    });
    expect(asked.status).toBe(201);
    const { requestId } = (await asked.json()) as { requestId: number };
    const bell = await read<NotificationList>("naresh", "/api/notifications");
    expect(bell.rows.some((row) => row.title === "Daniel asks for a new MedRep")).toBe(true);
    expect((await tree()).requests[0]).toMatchObject({
      status: "open",
      personName: "Tess Garcia",
      askedBy: "Daniel",
    });

    // Declining needs a reason.
    expect(
      (await send("naresh", `/api/org/requests/${requestId}/decide`, { approve: false })).status,
    ).toBe(400);
    const approved = await send("naresh", `/api/org/requests/${requestId}/decide`, {
      approve: true,
    });
    expect(approved.status).toBe(200);
    const { login } = (await approved.json()) as { login: OrgLogin };
    expect(login.login).toMatch(/^hos\d+@2mginc\.com$/);
    const signed = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: login.login, password: login.password }),
    });
    const tess = ((await signed.json()) as { me: Me }).me;
    expect(tess).toMatchObject({
      name: "Tess Garcia",
      role: "medrep",
      area: { name: "HOS | Caloocan" },
      reportsTo: { name: "Daniel" },
    });
    // Decided once only, and Daniel hears of it.
    expect(
      (await send("naresh", `/api/org/requests/${requestId}/decide`, { approve: true })).status,
    ).toBe(409);
    const told = await read<NotificationList>("daniel", "/api/notifications");
    expect(told.rows.some((row) => row.title.startsWith("Naresh approved your ask"))).toBe(true);
  });

  it("an empty seat is asked for without a name; a decline says why", async () => {
    const form = await read<SeatRequestForm>("daniel", "/api/org/requests/form");
    const asked = (await (
      await send("daniel", "/api/org/requests", {
        unitId: form.units[0]?.id,
        module: "medrep",
        reason: "Hiring",
      })
    ).json()) as { requestId: number };
    const declined = await send("admin", `/api/org/requests/${asked.requestId}/decide`, {
      approve: false,
      answer: "Not this quarter",
    });
    expect(declined.status).toBe(200);
    const mine = await read<SeatRequestForm>("daniel", "/api/org/requests/form");
    expect(mine.mine.find((request) => request.id === asked.requestId)).toMatchObject({
      status: "declined",
      answer: "Not this quarter",
    });
  });
});

describe("a team lead asks for a new region or a new area", () => {
  it("the CEO approves: it is made, given, and the team hears it on Messages", async () => {
    const form = await read<SeatRequestForm>("vanessa", "/api/org/requests/form");
    const division = form.units.find((unit) => unit.name === "Hospital Division");
    const daniel = form.people.find((person) => person.name === "Daniel");
    expect(division && daniel).toBeTruthy();
    // A region with no name, or someone outside her team to lead it, is refused.
    expect(
      (await send("vanessa", "/api/org/requests", { kind: "region", unitId: division?.id })).status,
    ).toBe(400);
    const region = await send("vanessa", "/api/org/requests", {
      kind: "region",
      unitId: division?.id,
      name: "Visayas",
      leadPersonId: daniel?.id,
      reason: "Cebu and Iloilo hospitals are growing.",
    });
    expect(region.status).toBe(201);
    const regionAsk = ((await region.json()) as { requestId: number }).requestId;
    const bell = await read<NotificationList>("naresh", "/api/notifications");
    expect(bell.rows.some((row) => row.title === "Vanessa asks for a new region: Visayas")).toBe(
      true,
    );
    expect(
      (await send("naresh", `/api/org/requests/${regionAsk}/decide`, { approve: true })).status,
    ).toBe(200);
    const after = await tree();
    const visayas = after.units.find((unit) => unit.name === "Visayas");
    expect(visayas?.parentId).toBe(division?.id);
    const lead = after.units
      .find((unit) => unit.id === visayas?.id)
      ?.seats.find((seat) => seat.lead);
    expect(lead?.holder?.name).toBe("Daniel");

    // A new area, given to a seat of the team that has none (an empty MedRep seat in Visayas).
    expect(
      (
        await send("naresh", "/api/org/seats", {
          unitId: visayas?.id,
          title: "MedRep",
          module: "medrep",
        })
      ).status,
    ).toBe(201);
    const again = await read<SeatRequestForm>("vanessa", "/api/org/requests/form");
    const free = again.seats.find((seat) => seat.unitId === visayas?.id);
    const area = await send("vanessa", "/api/org/requests", {
      kind: "area",
      unitId: free?.unitId,
      newArea: { name: "HOS | Cebu", cities: ["Cebu City", "Mandaue"] },
      forSeatId: free?.id,
    });
    expect(area.status).toBe(201);
    const areaAsk = ((await area.json()) as { requestId: number }).requestId;
    expect((await tree()).requests.find((one) => one.id === areaAsk)).toMatchObject({
      kind: "area",
      title: "HOS | Cebu",
    });
    expect(
      (await send("naresh", `/api/org/requests/${areaAsk}/decide`, { approve: true })).status,
    ).toBe(200);
    const made = (await tree()).areas.find((one) => one.name === "HOS | Cebu");
    expect(made).toBeTruthy();
    const [seat] = await rows<{ areaId: number | null }>(
      db,
      sql`select area_id::int as "areaId" from seat where id = ${free?.id}`,
    );
    expect(seat?.areaId).toBe(made?.id);

    // The team heard both, as announcements from the CEO.
    const threads = await read<{ threads: { title: string; last: string | null }[] }>(
      "ryan",
      "/api/messages",
    );
    const said = JSON.stringify(threads);
    expect(said).toContain("New region: Visayas");
  });
});

describe("looking as someone", () => {
  it("lets the CEO see a person's screens, read only, then go back", async () => {
    const daniel = (await read<{ me: Me }>("daniel", "/api/me")).me;
    const vanessa = (await read<{ me: Me }>("vanessa", "/api/me")).me;
    // Since 19 Nov a lead looks as the people under them (Vanessa as her team lead Daniel), never
    // the other way (auth/look.test.ts); the CEO as anyone.
    expect((await send("daniel", `/api/auth/view/${vanessa.id}`)).status).toBe(403);
    const view = await send("naresh", `/api/auth/view/${daniel.id}`);
    expect(view.status).toBe(200);
    const cookieLines = view.headers.getSetCookie();
    const as = cookieLines.find((line) => line.startsWith("sid="))?.split(";")[0] as string;
    const back = cookieLines.find((line) => line.startsWith("sid_back="))?.split(";")[0] as string;
    const both = `${as}; ${back}`;
    const seen = (
      (await (await app.request("/api/me", { headers: { cookie: both } })).json()) as { me: Me }
    ).me;
    expect(seen).toMatchObject({ name: "Daniel", viewedBy: { name: "Naresh" } });
    expect((await app.request("/api/team/board", { headers: { cookie: both } })).status).toBe(200);
    // Nothing can be changed while looking.
    const write = await app.request("/api/messages", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: both },
      body: JSON.stringify({ to: { kind: "everyone" }, body: "x" }),
    });
    expect(write.status).toBe(403);
    const returned = await app.request("/api/auth/view/back", {
      method: "POST",
      headers: { cookie: both },
    });
    expect(((await returned.json()) as { me: Me }).me.name).toBe("Naresh");
    // The looking session is over.
    expect((await app.request("/api/me", { headers: { cookie: as } })).status).toBe(401);
  });
});
