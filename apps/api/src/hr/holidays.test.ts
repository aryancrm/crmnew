// Holidays by town: the 2026 proclamations seeded, HR adding and archiving a holiday (national, a
// province's, a town's; never deleted), a person's work town on their record (in HR's trail),
// their seat area's first city when it is empty, and a local holiday counting only for people of
// that town or province: not a working day (never absent), the overtime form's kind of day. HR and
// the Admin change; the CEO reads; others get nothing.

import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { addDays, todayManila } from "../inventory/rules";
import { seedDemo } from "../seed";
import type { AttendanceMonth, HolidayYear, HrHistory, HrPerson, Me } from "../types";
import { holidaysOf, localApplies, placesOf, townFromName, townList, townOnList } from "./holidays";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
const ids: Record<string, number> = {};

const get = (who: string, path: string) =>
  app.request(path, { headers: { cookie: cookies[who] as string } });
const read = async <T>(who: string, path: string) => (await (await get(who, path)).json()) as T;
const send = (who: string, path: string, body: unknown = {}, method = "POST") =>
  app.request(path, {
    method,
    headers: { "content-type": "application/json", cookie: cookies[who] as string },
    body: JSON.stringify(body),
  });

/** Past Monday-to-Saturday days with no holiday anywhere in Metro Manila or Cebu, newest first. */
async function quietDays(count: number): Promise<string[]> {
  const out: string[] = [];
  for (let at = addDays(todayManila(), -2); out.length < count; at = addDays(at, -1)) {
    if (new Date(`${at}T00:00:00Z`).getUTCDay() === 0) continue;
    const [busy] = await rows<{ n: number }>(
      db,
      sql`select (select count(*) from holiday where active and day = ${at}::date)
          + (select count(*) from local_holiday where active and day = ${at}::date
              and province in ('Metro Manila', 'Cebu'))::int as n`,
    );
    if (Number(busy?.n ?? 0) === 0) out.push(at);
  }
  return out;
}

let D: string[] = [];

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["ryan", "daniel", "naresh", "helen", "admin"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
    ids[name] = ((await response.json()) as { me: Me }).me.id;
  }
  await db.execute(sql`update employee set hire_date = '2025-01-01'`);
  await db.execute(sql`delete from attendance`);
  D = await quietDays(3);
});

describe("the town list and whose holiday it is", () => {
  it("is the same list as the web's", () => {
    const api = readFileSync(new URL("../places/ph-towns.json", import.meta.url), "utf8");
    const web = readFileSync(new URL("../../../web/public/places/ph-towns.json", import.meta.url), "utf8");
    expect(api).toBe(web);
    expect(townList().length).toBeGreaterThan(1600);
  });

  it("reads an area's city as one town of the list, or none when several fit", () => {
    expect(townFromName("Pasay")).toEqual({ town: "Pasay City", province: "Metro Manila" });
    expect(townFromName("City of Makati")).toEqual({ town: "Makati City", province: "Metro Manila" });
    // A city and towns of one name: the city; several towns and no city: none.
    expect(townFromName("San Jose")).toEqual({ town: "San Jose City", province: "Nueva Ecija" });
    expect(townFromName("San Isidro")).toBeNull();
    expect(townFromName("San Jose, Batangas")).toEqual({ town: "San Jose", province: "Batangas" });
    expect(townOnList("cebu city", "CEBU")).toEqual({ town: "Cebu City", province: "Cebu" });
    expect(townOnList("Cebu City", "Bohol")).toBeNull();
  });

  it("applies a local holiday to its province, or to its one town", () => {
    const pasay = { province: "Metro Manila", town: "Pasay City" };
    expect(localApplies({ province: "Metro Manila", town: null }, pasay)).toBe(true);
    expect(localApplies({ province: "metro manila", town: "pasay city" }, pasay)).toBe(true);
    expect(localApplies({ province: "Metro Manila", town: "Manila" }, pasay)).toBe(false);
    expect(localApplies({ province: "Cebu", town: null }, pasay)).toBe(false);
    expect(localApplies({ province: "Cebu", town: null }, null)).toBe(false);
  });

  it("seeds the 2026 proclamations, a region's as its provinces, none on a national holiday", async () => {
    const [counted] = await rows<{ n: number; ncr: number; onNational: number }>(
      db,
      sql`select count(*)::int as n,
          count(*) filter (where day = '2026-11-17' and province = 'Metro Manila' and town is null)::int as ncr,
          count(*) filter (where day in (select day from holiday))::int as "onNational"
        from local_holiday where made_by is null`,
    );
    expect(counted?.n).toBeGreaterThan(350);
    expect(counted?.ncr).toBe(1);
    expect(counted?.onNational).toBe(0);
    const [manila] = await rows<{ name: string }>(
      db,
      sql`select name from local_holiday where day = '2026-01-09' and town = 'Manila'`,
    );
    expect(manila?.name).toBe("Feast of the Black Nazarene");
  });
});

describe("HR's holidays", () => {
  it("adds a town's and a province's holiday; the CEO reads; nobody else", async () => {
    const cebu = { day: D[0], name: "Cebu City Charter Day", kind: "special", province: "Cebu", town: "Cebu City" };
    expect((await send("naresh", "/api/hr/holidays", cebu)).status).toBe(403);
    expect((await send("ryan", "/api/hr/holidays", cebu)).status).toBe(403);
    expect((await send("helen", "/api/hr/holidays", { ...cebu, town: "Pasay City" })).status).toBe(400);
    expect((await send("helen", "/api/hr/holidays", { ...cebu, province: "Atlantis" })).status).toBe(400);
    expect((await send("helen", "/api/hr/holidays", { ...cebu, name: " " })).status).toBe(400);
    expect((await send("helen", "/api/hr/holidays", cebu)).status).toBe(200);
    expect((await send("helen", "/api/hr/holidays", cebu)).status).toBe(409);
    const metro = { day: D[1], name: "Metro day", kind: "special", province: "Metro Manila" };
    expect((await send("admin", "/api/hr/holidays", metro)).status).toBe(200);
    // A national day is one a day: a local one can't sit on it.
    const [national] = await rows<{ day: string }>(
      db,
      sql`select to_char(day, 'YYYY-MM-DD') as day from holiday where active limit 1`,
    );
    expect(
      (await send("helen", "/api/hr/holidays", { ...metro, day: national?.day })).status,
    ).toBe(409);

    const year = (D[0] as string).slice(0, 4);
    expect((await get("ryan", `/api/hr/holidays?year=${year}`)).status).toBe(403);
    const all = await read<HolidayYear>("naresh", `/api/hr/holidays?year=${year}`);
    expect(all.can.change).toBe(false);
    expect(all.holidays.some((one) => one.scope === "national")).toBe(true);
    const town = await read<HolidayYear>(
      "helen",
      `/api/hr/holidays?year=${year}&province=Cebu&town=${encodeURIComponent("Cebu City")}`,
    );
    expect(town.can.change).toBe(true);
    const local = town.holidays.filter((one) => one.scope === "local");
    expect(local.map((one) => one.name)).toContain("Cebu City Charter Day");
    expect(local.every((one) => one.province === "Cebu" && (one.town === null || one.town === "Cebu City"))).toBe(true);
    expect(local.find((one) => one.name === "Cebu City Charter Day")?.madeBy).toBe("Helen");
  });

  it("archives a holiday (kept, said who), never deletes it", async () => {
    const extra = { day: D[2], name: "Moved day", kind: "special", province: "Cebu" };
    const { id } = (await (await send("helen", "/api/hr/holidays", extra)).json()) as { id: number };
    expect((await send("naresh", `/api/hr/holidays/local/${id}/archive`, {})).status).toBe(403);
    expect((await send("helen", `/api/hr/holidays/local/${id}/archive`, { note: "Moved" })).status).toBe(200);
    expect((await send("helen", `/api/hr/holidays/local/${id}/archive`, {})).status).toBe(404);
    expect((await send("helen", `/api/hr/holidays/other/${id}/archive`, {})).status).toBe(404);
    const list = await read<HolidayYear>("helen", `/api/hr/holidays?year=${(D[2] as string).slice(0, 4)}&province=Cebu`);
    expect(list.holidays.find((one) => one.id === id && one.scope === "local")?.archived).toMatchObject({
      by: "Helen",
      note: "Moved",
    });
    const [kept] = await rows<{ n: number }>(db, sql`select count(*)::int as n from local_holiday where id = ${id}`);
    expect(kept?.n).toBe(1);
    // Archived, it is nobody's holiday.
    const daniel = (await holidaysOf(db, [ids.daniel as number], D[2] as string, D[2] as string)).get(ids.daniel as number);
    expect(daniel?.has(D[2] as string)).toBe(false);
  });
});

describe("a person's work town", () => {
  it("is set from the list on the record, written in HR's trail", async () => {
    const daniel = ids.daniel as number;
    expect(
      (await send("helen", `/api/hr/people/${daniel}`, { workTown: "Cebu City", workProvince: "Bohol" }, "PATCH")).status,
    ).toBe(400);
    expect((await send("helen", `/api/hr/people/${daniel}`, { workTown: "Cebu City" }, "PATCH")).status).toBe(400);
    expect((await send("naresh", `/api/hr/people/${daniel}`, { workTown: "Cebu City", workProvince: "Cebu" }, "PATCH")).status).toBe(403);
    expect(
      (await send("helen", `/api/hr/people/${daniel}`, { workTown: "cebu city", workProvince: "cebu" }, "PATCH")).status,
    ).toBe(200);
    const person = await read<HrPerson>("helen", `/api/hr/people/${daniel}`);
    expect(person.record).toMatchObject({
      workTown: "Cebu City",
      workProvince: "Cebu",
      holidayPlace: { town: "Cebu City", province: "Cebu", from: "record" },
    });
    const trail = await read<HrHistory>("helen", `/api/hr/people/${daniel}/history`);
    expect(trail.lines[0]?.changes.find((one) => one.field === "workTown")).toMatchObject({
      to: "Cebu City",
      hidden: false,
    });
  });

  it("falls back to the seat area's first city when the record has none", async () => {
    const places = await placesOf(db, [ids.ryan as number, ids.naresh as number]);
    // Ryan's area is HOS | Pasay (Pasay, Parañaque, Las Piñas); the CEO has no area.
    expect(places.get(ids.ryan as number)).toEqual({ town: "Pasay City", province: "Metro Manila", from: "area" });
    expect(places.get(ids.naresh as number)).toBeNull();
    const ryan = await read<HrPerson>("helen", `/api/hr/people/${ids.ryan}`);
    expect(ryan.record.holidayPlace).toMatchObject({ town: "Pasay City", from: "area" });
  });
});

describe("attendance on a local holiday", () => {
  it("is a holiday only for that town's or province's people, never absent", async () => {
    const month = (D[0] as string).slice(0, 7);
    const dayOf = async (who: string, day: string) => {
      const m = await read<AttendanceMonth>("helen", `/api/hr/attendance/${ids[who]}?month=${day.slice(0, 7)}`);
      return m.days.find((one) => one.day === day);
    };
    expect(month).toBeTruthy();
    // D[0]: Cebu City's holiday. Daniel works in Cebu City; Ryan in Pasay.
    expect(await dayOf("daniel", D[0] as string)).toMatchObject({ kind: "holiday", absent: false, holiday: "Cebu City Charter Day" });
    expect(await dayOf("ryan", D[0] as string)).toMatchObject({ kind: "work", absent: true });
    // D[1]: Metro Manila's, Ryan's by his seat's area.
    expect(await dayOf("ryan", D[1] as string)).toMatchObject({ kind: "holiday", absent: false });
    expect(await dayOf("daniel", D[1] as string)).toMatchObject({ kind: "work", absent: true });
    // The company's calendar (desks' clocks) stays on the national holidays.
    const calendar = await read<{ holidays: string[] }>("helen", "/api/hr/calendar");
    expect(calendar.holidays.length).toBeGreaterThan(0);
    expect(calendar.holidays).not.toContain(D[0]);
    expect(calendar.holidays).not.toContain(D[1]);
  });

  it("gives the overtime form the person's own kind of day", async () => {
    const response = await send("daniel", "/api/hr/forms", {
      kind: "ot",
      day: D[0],
      from: "08:00",
      to: "12:00",
      reason: "Stock count",
    });
    expect(response.status).toBe(200);
    const { id } = (await response.json()) as { id: number };
    const [form] = await rows<{ type: string }>(db, sql`select ot_type as type from hr_form where id = ${id}`);
    expect(form?.type).toBe("special");
  });
});
