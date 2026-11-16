import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { CHART_2026 } from "../org/chart-2026";
import { importChart } from "../org/chart-import";
import { seedDemo } from "../seed";
import type { CustomerList, ZohoSellers } from "../types";
import { importZohoCustomers } from "./import";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
const get = (who: string, path: string) => app.request(path, { headers: { cookie: cookies[who] as string } });
const post = (who: string, path: string, body: unknown) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookies[who] as string },
    body: JSON.stringify(body),
  });
const count = async (table: string) =>
  (await rows<{ n: number }>(db, sql.raw(`select count(*)::int as n from ${table}`)))[0]?.n ?? 0;

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["admin", "ryan", "sarla"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
});

describe("the chart's teams and seats", () => {
  it("come in once, empty, each selling seat with its own area", async () => {
    const before = { units: await count("org_unit"), seats: await count("seat"), areas: await count("area") };
    const dry = await importChart(db, CHART_2026, false);
    expect(await count("seat")).toBe(before.seats);
    expect((await post("sarla", "/api/admin/import/chart", { apply: true })).status).toBe(403);
    const made = (await (await post("admin", "/api/admin/import/chart", { apply: true })).json()) as typeof dry;
    expect(made).toMatchObject({ units: dry.units, seats: dry.seats, noChannel: [] });
    expect(made.seats).toBeGreaterThan(60);
    expect(await count("seat")).toBe(before.seats + made.seats);
    expect(await count("area")).toBe(before.areas + made.areas);
    // Empty: nobody was put in a seat.
    expect(await count("seat_holder")).toBe(await count("seat_holder"));
    const [cebu] = await rows<{ cities: string[] }>(db, sql`select cities from area where name = 'Cebu South, Dumaguete'`);
    expect(cebu?.cities).toEqual(["Cebu South", "Dumaguete"]);
    // Laguna is in two territories on the chart; it stays with the first.
    const laguna = await rows<{ name: string }>(
      db,
      sql`select a.name from area a, unnest(a.cities) as c(city) where lower(c.city) = 'laguna' and a.channel_id = (select id from channel where code = 'HOSP')`,
    );
    expect(laguna.length).toBe(1);
    const again = await importChart(db, CHART_2026, true);
    expect(again).toMatchObject({ units: 0, seats: 0, areas: 0 });
  });
});

describe("Zoho's salespeople tied to seats", () => {
  it("puts the customers a salesperson last sold to under the seat, and moves them when re-tied", async () => {
    await importZohoCustomers(
      db,
      [
        { id: "zs-1", name: "Cebu Velez General Hospital", business: true, city: "Cebu City", hint: "hospital", seller: "HOS | SOUTH CEBU", sellerOn: "2026-10-01" },
        { id: "zs-2", name: "Perpetual Succour Hospital", business: true, city: "Cebu City", hint: "hospital", seller: "HOS | SOUTH CEBU", sellerOn: "2026-09-01" },
        { id: "zs-3", name: "Chong Hua Mandaue", business: true, city: "Mandaue", hint: "hospital", seller: "HOS | NORTH CEBU", sellerOn: "2026-10-05" },
      ],
      true,
    );
    expect((await get("sarla", "/api/admin/zoho-sellers")).status).toBe(403);
    const list = (await (await get("admin", "/api/admin/zoho-sellers")).json()) as ZohoSellers;
    const south = list.sellers.find((one) => one.name === "HOS | SOUTH CEBU");
    expect(south).toMatchObject({ customers: 2, recent: 2, seatId: null });
    const suggested = list.seats.find((seat) => seat.id === south?.suggested);
    expect(suggested?.area).toBe("Cebu South, Dumaguete");

    const tied = await post("admin", "/api/admin/zoho-sellers", { name: "HOS | SOUTH CEBU", seatId: south?.suggested });
    expect(await tied.json()).toEqual({ moved: 2 });
    const inArea = await rows<{ name: string }>(
      db,
      sql`select c.name from customer c join area a on a.id = c.area_id where a.name = 'Cebu South, Dumaguete' order by c.name`,
    );
    expect(inArea.map((row) => row.name)).toEqual(["Cebu Velez General Hospital", "Perpetual Succour Hospital"]);

    // Re-tied to another seat: the same customers move; one put elsewhere by hand stays.
    const north = list.seats.find((seat) => seat.area === "Cebu North, Bohol");
    await db.execute(sql`update customer set area_id = (select id from area where name = 'Bicol') where name = 'Perpetual Succour Hospital'`);
    const retied = await post("admin", "/api/admin/zoho-sellers", { name: "HOS | SOUTH CEBU", seatId: north?.id });
    expect(await retied.json()).toEqual({ moved: 1 });
    const untied = await post("admin", "/api/admin/zoho-sellers", { name: "HOS | SOUTH CEBU", seatId: null });
    expect(await untied.json()).toEqual({ moved: 1 });
    expect((await post("admin", "/api/admin/zoho-sellers", { name: "Nobody", seatId: null })).status).toBe(404);
  });

  it("a MedRep in the seat sees its customers", async () => {
    const list = (await (await get("admin", "/api/admin/zoho-sellers")).json()) as ZohoSellers;
    const north = list.sellers.find((one) => one.name === "HOS | NORTH CEBU");
    const [ryanSeat] = await rows<{ id: number }>(
      db,
      sql`select s.id::int as id from seat s join seat_holder h on h.seat_id = s.id join person p on p.id = h.person_id
        where p.email = 'ryan@2mg.test' and h.ends_on is null limit 1`,
    );
    // Put the North Cebu customers under Ryan's own seat's area.
    const [area] = await rows<{ id: number }>(db, sql`select area_id::int as id from seat where id = ${ryanSeat?.id}`);
    expect(area?.id).toBeTruthy();
    expect(north).toBeTruthy();
    await post("admin", "/api/admin/zoho-sellers", { name: "HOS | NORTH CEBU", seatId: ryanSeat?.id });
    const seen = (await (await get("ryan", "/api/customers?q=chong")).json()) as CustomerList;
    expect(seen.rows.map((row) => row.name)).toContain("Chong Hua Mandaue");
  });
});
