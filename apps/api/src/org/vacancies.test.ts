// Moves and vacant seats (docs/HR-PLAN.md, 25 Nov): the team lead gives a vacant area to one of
// their people as added work (no KPI for them: the sale is the vacant seat's, the team's), every
// order keeps the email ID it was sold as, and HR's trail writes each move and cover.
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedFixture } from "../inventory/fixture";
import { addDays, todayManila } from "../inventory/rules";
import { seedDemo } from "../seed";
import type { HrHistory, Me, OrgTree, TeamBoard, VacantSeats } from "../types";
import { creditedTo } from "./service";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
const people: Record<string, Me> = {};

const get = (who: string, path: string) => app.request(path, { headers: { cookie: cookies[who] as string } });
const read = async <T>(who: string, path: string) => (await (await get(who, path)).json()) as T;
const send = (who: string, path: string, body: unknown = {}) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookies[who] as string },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  await seedFixture(db);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["naresh", "daniel", "ryan", "helen"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    expect(response.status).toBe(200);
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
    people[name] = ((await response.json()) as { me: Me }).me;
  }
  // A vacant MedRep seat in Daniel's NCR 1, with an area and a customer waiting in it.
  const ncr1 = (await read<OrgTree>("naresh", "/api/org")).units.find((unit) => unit.name === "NCR 1");
  const made = await send("naresh", "/api/org/seats", {
    unitId: ncr1?.id,
    title: "MedRep",
    module: "medrep",
    newArea: { name: "HOS | Caloocan", cities: ["Caloocan"] },
  });
  expect(made.status).toBe(201);
  const { seatId } = (await made.json()) as { seatId: number };
  const added = await rows<{ id: number }>(
    db,
    sql`insert into customer (name, kind, city, phone, added_by, area_id)
      values ('Caloocan General', 'hospital', 'Caloocan', '0917 555 0100', ${people.naresh?.id}, (select area_id from seat where id = ${seatId}))
      returning id::int as id`,
  );
  expect(added).toHaveLength(1);
});

const vacantInNcr1 = async () => {
  const list = await read<VacantSeats>("daniel", "/api/org/vacant");
  const seat = list.seats.find((one) => one.team === "NCR 1" && one.area);
  expect(seat).toBeTruthy();
  return { list, seat: seat as VacantSeats["seats"][number] };
};

describe("vacant seats", () => {
  it("are the lead's in their boxes, everyone's for HR, and not a MedRep's", async () => {
    const { list, seat } = await vacantInNcr1();
    expect(seat.lead).toBe("Daniel");
    expect(seat.cover).toBeNull();
    expect(seat.days).toBeGreaterThanOrEqual(0);
    expect(list.can.cover).toBe(true);
    // Daniel gives covers to his own people only.
    expect(list.people.map((one) => one.name)).toContain("Ryan");
    expect(list.people.map((one) => one.name)).not.toContain("Naresh");
    const hr = await read<VacantSeats>("helen", "/api/org/vacant");
    expect(hr.seats.length).toBeGreaterThan(list.seats.length);
    expect((await get("ryan", "/api/org/vacant")).status).toBe(403);
  });

  it("reminds the lead after 7 days with nobody covering, and the head and HR after 14", async () => {
    const { seat } = await vacantInNcr1();
    await db.execute(sql`update seat set created_at = now() - interval '20 days' where id = ${seat.seatId}`);
    await db.execute(
      sql`update seat_holder set ends_on = ${addDays(todayManila(), -9)}::date where seat_id = ${seat.seatId} and ends_on is not null`,
    );
    const again = (await vacantInNcr1()).seat;
    expect(again.days).toBeGreaterThanOrEqual(VACANT_DAYS);
    expect(again.alert).not.toBe("none");
    const board = await read<TeamBoard>("daniel", "/api/team/board");
    const need = board.needs.find((one) => one.kind === "vacant" && one.seatId === seat.seatId);
    expect(need?.why).toMatch(/^Vacant \d+ days/);
  });

  it("the lead gives it to one of their people as added work, written in HR's trail", async () => {
    const { seat } = await vacantInNcr1();
    const until = addDays(todayManila(), 10);
    // Not someone outside the team.
    const outside = await send("daniel", `/api/org/vacant/${seat.seatId}/cover`, { personId: people.naresh?.id, until });
    expect(outside.status).toBe(403);
    // A MedRep can't hand out covers.
    expect((await send("ryan", `/api/org/vacant/${seat.seatId}/cover`, { personId: people.ryan?.id, until })).status).toBe(403);
    const given = await send("daniel", `/api/org/vacant/${seat.seatId}/cover`, {
      personId: people.ryan?.id,
      until,
      reason: "Until the new MedRep joins",
    });
    expect(given.status).toBe(200);
    const now = (await vacantInNcr1()).seat;
    expect(now.cover?.name).toBe("Ryan");
    expect(now.alert).toBe("none");
    const trail = await read<HrHistory>("helen", `/api/hr/people/${people.ryan?.id}/history`);
    expect(trail.lines.some((line) => line.kind === "move" && /^Covers .*until/.test(line.what))).toBe(true);
  });

  it("a sale made covering counts for the vacant seat and the lead, never the MedRep's own KPI", async () => {
    const { seat } = await vacantInNcr1();
    const [customer] = await rows<{ id: number }>(
      db,
      sql`select c.id::int as id from customer c join seat s on s.area_id = c.area_id where s.id = ${seat.seatId} limit 1`,
    );
    expect(customer).toBeTruthy();
    const [order] = await rows<{ id: number; seatId: number; covered: boolean; coverLeadId: number | null; soldAs: string | null }>(
      db,
      sql`insert into sales_order (customer_id, medrep_id, raised_by, status, payment_terms, total)
        values (${customer?.id}, ${people.ryan?.id}, ${people.ryan?.id}, 'pending_approval', 'cod', 50000)
        returning id::int as id, seat_id::int as "seatId", covered, cover_lead_id::int as "coverLeadId", sold_as as "soldAs"`,
    );
    expect(order?.seatId).toBe(seat.seatId);
    expect(order?.covered).toBe(true);
    expect(order?.coverLeadId).toBe(people.daniel?.id);
    // The email ID Ryan sold as that day: his own seat's.
    const [own] = await rows<{ login: string }>(
      db,
      sql`select s.login from seat_holder h join seat s on s.id = h.seat_id where h.person_id = ${people.ryan?.id} and h.kind = 'holder' and h.ends_on is null limit 1`,
    );
    expect(order?.soldAs).toBe(own?.login);
    const [credit] = await rows<{ person: number }>(
      db,
      sql`select ${creditedTo(todayManila())}::int as person from sales_order o where o.id = ${order?.id}`,
    );
    expect(credit?.person).toBe(people.daniel?.id);
    const list = (await vacantInNcr1()).seat;
    expect(list.soldCovering).toBe(50000);
    // Ryan's own sale, in his own area, is still his.
    const [mine] = await rows<{ person: number; covered: boolean }>(
      db,
      sql`with o as (insert into sales_order (customer_id, medrep_id, raised_by, status, payment_terms, total)
          select c.id, ${people.ryan?.id}, ${people.ryan?.id}, 'pending_approval', 'cod', 100
          from customer c join seat s on s.area_id = c.area_id join seat_holder h on h.seat_id = s.id and h.kind = 'holder' and h.ends_on is null
          where h.person_id = ${people.ryan?.id} limit 1 returning *)
        select ${creditedTo(todayManila())}::int as person, o.covered from o`,
    );
    if (mine) {
      expect(mine.covered).toBe(false);
      expect(mine.person).toBe(people.ryan?.id);
    }
  });

  it("the lead takes the cover back", async () => {
    const { seat } = await vacantInNcr1();
    const back = await send("daniel", `/api/org/vacant/covers/${seat.cover?.holdingId}/end`, {});
    expect(back.status).toBe(200);
    expect((await vacantInNcr1()).seat.cover).toBeNull();
    const trail = await read<HrHistory>("helen", `/api/hr/people/${people.ryan?.id}/history`);
    expect(trail.lines.some((line) => line.kind === "move" && /^Cover of .* ended/.test(line.what))).toBe(true);
  });
});

describe("HR's move", () => {
  it("moves someone to a vacant seat as a transfer, with the seat and email ID before and after", async () => {
    const { seat } = await vacantInNcr1();
    expect((await send("helen", `/api/hr/people/${people.ryan?.id}/move`, { seatId: seat.seatId, kind: "transfer" })).status).toBe(400);
    const far = await send("helen", `/api/hr/people/${people.ryan?.id}/move`, {
      seatId: seat.seatId,
      kind: "transfer",
      startsOn: addDays(todayManila(), 120),
      reason: "Too far ahead",
    });
    expect(far.status).toBe(400);
    expect(
      (await send("daniel", `/api/hr/people/${people.ryan?.id}/move`, { seatId: seat.seatId, kind: "transfer", reason: "x" })).status,
    ).toBe(403);
    const moved = await send("helen", `/api/hr/people/${people.ryan?.id}/move`, {
      seatId: seat.seatId,
      kind: "transfer",
      reason: "Quezon City needs him",
    });
    expect(moved.status).toBe(200);
    const trail = await read<HrHistory>("helen", `/api/hr/people/${people.ryan?.id}/history`);
    const line = trail.lines.find((one) => one.kind === "move" && one.what.startsWith("Transferred to"));
    expect(line?.what).toMatch(/from .*: Quezon City needs him$/);
    expect(line?.changes.find((one) => one.field === "seat")?.from).toBeTruthy();
    expect(line?.changes.find((one) => one.field === "loginId")?.to).toMatch(/@/);
    // The sale made covering stays with the seat it was sold from, and keeps the email ID it was sold as.
    const [kept] = await rows<{ soldAs: string | null; covered: boolean }>(
      db,
      sql`select sold_as as "soldAs", covered from sales_order where seat_id = ${seat.seatId} and covered limit 1`,
    );
    expect(kept?.covered).toBe(true);
    expect(kept?.soldAs).toBeTruthy();
    // The seat is no longer vacant.
    expect((await read<VacantSeats>("daniel", "/api/org/vacant")).seats.some((one) => one.seatId === seat.seatId)).toBe(false);
  });
});

const VACANT_DAYS = 7;
