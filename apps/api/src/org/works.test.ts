// Office or field (docs/PLAN.md 29): every MedRep's seat is one or the other. The seat's kind is
// on the sign-in, the CEO or Admin changes it on the seat (in the holder's trail), an office seat
// is refused the field's pages, an office seller sees the customers they took orders for, and the
// customer page names both sellers.
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedFixture } from "../inventory/fixture";
import { todayManila } from "../inventory/rules";
import { seedDemo } from "../seed";
import type { CustomerPage, Me, OrgTree } from "../types";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
const get = (who: string, path: string) => app.request(path, { headers: { cookie: cookies[who] as string } });
const read = async <T>(who: string, path: string) => (await (await get(who, path)).json()) as T;
const send = (who: string, path: string, body: unknown = {}, method = "POST") =>
  app.request(path, {
    method,
    headers: { "content-type": "application/json", cookie: cookies[who] as string },
    body: JSON.stringify(body),
  });
const me = async (who: string) => (await read<{ me: Me }>(who, "/api/me")).me;
const ryanSeat = async () =>
  (await read<OrgTree>("admin", "/api/org")).units.flatMap((unit) => unit.seats).find((seat) => seat.holder?.name === "Ryan");
const setWorks = (works: "office" | "field", seatId: number) =>
  send("admin", `/api/org/seats/${seatId}`, { works }, "PATCH");

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  await seedFixture(db);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["admin", "ryan", "sarla", "jane"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
});

describe("office or field", () => {
  let customerId = 0;
  let elsewhereId = 0;

  it("a MedRep's seat works as its channel does; anyone else's is neither", async () => {
    expect((await me("ryan")).works).toBe("field");
    expect((await me("jane")).works ?? null).toBeNull();
    expect((await ryanSeat())?.works).toBe("field");
  });

  it("the Admin makes a seat an office seat: the holder's screens follow, and their trail says so", async () => {
    const seat = await ryanSeat();
    // Ryan sells to a hospital in his area, and to one outside it.
    customerId = ((await (await send("sarla", "/api/customers", { kind: "hospital", name: "Pasay General", city: "Pasay" })).json()) as { id: number }).id;
    elsewhereId = ((await (await send("sarla", "/api/customers", { kind: "hospital", name: "Cebu Doctors", city: "Cebu" })).json()) as { id: number }).id;
    const [medicine] = await rows<{ id: number }>(
      db,
      sql`select m.id::int as id from medicine m join medicine_price p on p.medicine_id = m.id and p.buyer_type = 'hospital' limit 1`,
    );
    for (const id of [customerId, customerId]) {
      const placed = await send("ryan", "/api/orders", { customerId: id, items: [{ medicineId: medicine?.id, qty: 2, priceKind: "hospital" }] });
      expect(placed.status).toBe(200);
    }
    // The second order is the one outside the area (moved there by hand: the order form keeps a
    // MedRep to their own customers).
    await db.execute(sql`update sales_order set customer_id = ${elsewhereId}
      where id = (select max(id) from sales_order where medrep_id = (select id from person where name = 'Ryan'))`);
    expect((await get("ryan", `/api/customers/${elsewhereId}`)).status).not.toBe(200);

    expect((await setWorks("office", seat?.id as number)).status).toBe(200);
    expect((await me("ryan")).works).toBe("office");
    expect((await ryanSeat())?.works).toBe("office");
    const [trail] = await rows<{ what: string }>(
      db,
      sql`select what from hr_event where person_id = (select id from person where name = 'Ryan') and kind = 'move' order by id desc limit 1`,
    );
    expect(trail?.what).toBe("Their seat now works from the office");
  });

  it("an office seat is refused the field's pages", async () => {
    for (const response of [
      await get("ryan", "/api/field/day"),
      await send("ryan", "/api/field/visits", { customerId, day: todayManila() }),
    ]) {
      expect(response.status).toBe(403);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe("office_seat");
    }
  });

  it("an office seller sees the customers they took orders for, and the page names both sellers", async () => {
    expect((await get("ryan", `/api/customers/${elsewhereId}`)).status).toBe(200);
    const page = await read<CustomerPage>("sarla", `/api/customers/${elsewhereId}/page`);
    expect(page.sellers).toEqual({ field: null, office: "Ryan" });

    // Back in the field: he visits his area again, and the page says who visits.
    expect((await setWorks("field", (await ryanSeat())?.id as number)).status).toBe(200);
    expect((await me("ryan")).works).toBe("field");
    expect((await get("ryan", "/api/field/day")).status).toBe(200);
    const home = await read<CustomerPage>("sarla", `/api/customers/${customerId}/page`);
    expect(home.sellers.field).toBe("Ryan");
    expect(home.sellers.office).toBeNull();
  });
});
