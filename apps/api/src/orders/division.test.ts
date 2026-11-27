// One seat, one Division (Aryan, 19 Nov: "a MedRep comes under one Division; if a Hospital MedRep
// brings another Division's order, under which head does it go?"): an order carries the Division of
// the person whose order it is (their seat's: CLIDP, RX Business and its lines, MD Telesales, else
// the channel's). Since 26 Nov the order counts for the account it is placed from: a seller orders in
// their account's Divisions only (another Division's order comes from an account of that Division,
// switched to); the Admin may set any (Management places none). The Divisions are the sales
// tracker's eight channels (19 Nov); a hub word is read as its channel.

import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedFixture } from "../inventory/fixture";
import { seedDemo } from "../seed";
import type { CustomerDetail, Me, OrderAssignment, OrderDetail, OrgTree } from "../types";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
let medicine = 0;
let customer = 0;

const read = async <T>(who: string, path: string) =>
  (await (await app.request(path, { headers: { cookie: cookies[who] as string } })).json()) as T;
const post = (who: string, path: string, body: unknown = {}) =>
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
  for (const name of ["ryan", "sarla", "admin"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
  const [found] = await rows<{ id: number }>(
    db,
    sql`select m.id::int as id from medicine m join medicine_price p on p.medicine_id = m.id and p.buyer_type = 'hospital' limit 1`,
  );
  medicine = found?.id as number;
  const made = await post("sarla", "/api/customers", { kind: "hospital", name: "Division Test Hospital", city: "Pasay" });
  customer = ((await made.json()) as { id: number }).id;
  // Ryan's channel carries HOSP, as the Admin panel sets it.
  await db.execute(
    sql`update channel set division = 'HOSP' where id = (select channel_id from person where email = 'ryan@2mg.test')`,
  );
});

describe("an order's Division", () => {
  it("is the MedRep's account's own; another is refused (switch account); the Admin may set any", async () => {
    const me = (await read<{ me: Me }>("ryan", "/api/me")).me;
    expect(me.divisions?.[0]).toBe("HOSP");

    // His own: placed, and carried on the order.
    const placed = await post("ryan", "/api/orders", { customerId: customer, items: [{ medicineId: medicine, qty: 1, priceKind: "hospital" }] });
    expect(placed.status, await placed.clone().text()).toBe(200);
    const id = ((await placed.json()) as { id: number }).id;
    const own = (await read<OrderDetail>("ryan", `/api/orders/${id}`)).order;
    expect(own.division).toBe("HOSP");
    // His Sub-division is his account's too (27 Nov): another one sent is not taken.
    const sent = await post("ryan", "/api/orders", {
      customerId: customer,
      subDivision: "GENSAN",
      items: [{ medicineId: medicine, qty: 1, priceKind: "hospital" }],
    });
    expect(sent.status, await sent.clone().text()).toBe(200);
    const kept = (await read<OrderDetail>("ryan", `/api/orders/${((await sent.json()) as { id: number }).id}`)).order;
    expect(own.subDivision).toBeTruthy();
    expect(kept.subDivision).toBe(own.subDivision);

    // Another Division (26 Nov: "the General part is the account's"): refused, saying to switch
    // to an account of that Division; nothing placed.
    const other = await post("ryan", "/api/orders", {
      customerId: customer,
      division: "CLIDP",
      items: [{ medicineId: medicine, qty: 1, priceKind: "hospital" }],
    });
    expect(other.status).toBe(400);
    expect(((await other.json()) as { error: { message: string } }).error.message).toBe(
      "This account's orders count for HOSP. For CLIDP, switch to an account of that Division.",
    );

    // The Admin, ordering for nobody in particular, may set any; Management places no orders (19 Nov).
    const admin = await post("admin", "/api/orders", {
      customerId: customer,
      division: "B2B",
      items: [{ medicineId: medicine, qty: 1, priceKind: "hospital" }],
    });
    expect(admin.status, await admin.clone().text()).toBe(200);
    expect(
      (
        await post("sarla", "/api/orders", {
          customerId: customer,
          division: "B2B",
          items: [{ medicineId: medicine, qty: 1, priceKind: "hospital" }],
        })
      ).status,
    ).toBe(403);
  });

  it("brings the hub's Sub-division and Headquarter with another Division, and a prescription Division asks why there is none", async () => {
    const placed = await post("admin", "/api/orders", {
      customerId: customer,
      division: "RX Business",
      type: "no_po",
      headquarter: "TAFT",
      noRxReason: "The doctor sends it before delivery",
      items: [{ medicineId: medicine, qty: 1, priceKind: "hospital" }],
    });
    expect(placed.status, await placed.clone().text()).toBe(200);
    const detail = await read<OrderDetail>("admin", `/api/orders/${((await placed.json()) as { id: number }).id}`);
    expect(detail.order).toMatchObject({ division: "RX Business", subDivision: "MD Telesales", headquarter: "TAFT" });
    const rx = detail.paperList.find((row) => row.kind === "prescription");
    expect(rx?.needed).toBe(true);
    expect(rx?.why).toContain("The doctor sends it before delivery");
  });

  it("takes only the sales tracker's eight channels, reading a hub word as its channel", async () => {
    // A page still open from before sends the hub's word: it is booked under its channel.
    const old = await post("admin", "/api/orders", {
      customerId: customer,
      division: "URO",
      type: "no_po",
      noRxReason: "Coming with the delivery",
      items: [{ medicineId: medicine, qty: 1, priceKind: "hospital" }],
    });
    expect(old.status, await old.clone().text()).toBe(200);
    const oldDetail = await read<OrderDetail>("admin", `/api/orders/${((await old.json()) as { id: number }).id}`);
    expect(oldDetail.order.division).toBe("RX Business");
    // The hub's MSA had nobody: no such Division now.
    const none = await post("admin", "/api/orders", {
      customerId: customer,
      division: "MSA",
      items: [{ medicineId: medicine, qty: 1, priceKind: "hospital" }],
    });
    expect(none.status).toBe(400);
    // My orders split by the same eight (an old link's word is read too).
    const mine = await read<{ total: number; division: string | null }>("ryan", "/api/orders/mine?division=HOS");
    const tracker = await read<{ total: number }>("ryan", "/api/orders/mine?division=HOSP");
    expect(mine).toMatchObject({ division: "HOSP", total: tracker.total });
  });

  it("offers what the account holds on the tree; with two seats, either, each with its own Sub-division", async () => {
    const one = await read<{ assignments: OrderAssignment[] }>("ryan", "/api/orders/assignments");
    expect(one.assignments.map((a) => [a.division, a.subDivision])).toEqual([["HOSP", "Hospital"]]);

    // Ryan is given a second seat: B2B's CRR (an account that handles two).
    const tree = await read<OrgTree>("admin", "/api/org");
    const b2b = tree.units.find((unit) => unit.channel?.code === "B2B");
    const seat = await post("admin", "/api/org/seats", { unitId: b2b?.id, title: "CRR", module: "medrep" });
    expect(seat.status, await seat.clone().text()).toBe(201);
    const [made] = await rows<{ id: number }>(db, sql`select max(id)::int as id from seat`);
    await db.execute(
      sql`insert into seat_holder (seat_id, person_id, kind, starts_on, reason, by_person)
        values (${made?.id}, (select id from person where email = 'ryan@2mg.test'), 'holder', '2026-01-01', 'Second seat', (select id from person where email = 'admin@2mg.test'))`,
    );
    const two = await read<{ assignments: OrderAssignment[] }>("ryan", "/api/orders/assignments");
    expect(two.assignments.map((a) => [a.division, a.subDivision])).toEqual([
      ["HOSP", "Hospital"],
      ["B2B", "CRR"],
    ]);
    // An order in the second: its Sub-division is the seat's, whatever else is sent.
    const placed = await post("ryan", "/api/orders", {
      customerId: customer,
      division: "B2B",
      subDivision: "NBD",
      items: [{ medicineId: medicine, qty: 1, priceKind: "hospital" }],
    });
    expect(placed.status, await placed.clone().text()).toBe(200);
    const detail = await read<OrderDetail>("ryan", `/api/orders/${((await placed.json()) as { id: number }).id}`);
    expect(detail.order).toMatchObject({ division: "B2B", subDivision: "CRR" });
    // Still nothing outside what he holds.
    expect((await post("ryan", "/api/orders", { customerId: customer, division: "MT", items: [{ medicineId: medicine, qty: 1, priceKind: "hospital" }] })).status).toBe(400);
    await db.execute(sql`delete from seat_holder where seat_id = ${made?.id}`);
  });

  it("follows the seat's box on the chart where it names a Division", async () => {
    const [seat] = await rows<{ id: number }>(
      db,
      sql`select s.id::int as id from seat s join seat_holder h on h.seat_id = s.id where h.person_id = (select id from person where email = 'ryan@2mg.test') limit 1`,
    );
    if (!seat) return; // the demo has no seat for him: the channel's Division is his
    const unit = sql`(select unit_id from seat where id = ${seat.id})`;
    const [before] = await rows<{ name: string }>(db, sql`select name from org_unit where id = ${unit}`);
    await db.execute(sql`update org_unit set name = 'Uro & Onco Care' where id = ${unit}`);
    const [division] = await rows<{ d: string | null }>(db, sql`select seat_division(${seat.id}) as d`);
    expect(division?.d).toBe("RX Business");
    // Javed's MD Telesales sits on the Telesales channel; its box says it is MD Telesales.
    await db.execute(sql`update org_unit set name = 'MD Telesales' where id = ${unit}`);
    const [telesales] = await rows<{ d: string | null }>(db, sql`select seat_division(${seat.id}) as d`);
    expect(telesales?.d).toBe("MD Telesales");
    await db.execute(sql`update org_unit set name = ${before?.name ?? ""} where id = ${unit}`);
  });

  it("brings the customer's standing for its channel; a bidding order says which award it delivers", async () => {
    const [ryan] = await rows<{ id: number }>(db, sql`select id::int as id from person where email = 'ryan@2mg.test'`);
    const [other] = await rows<{ id: number }>(
      db,
      sql`insert into customer (name, kind, added_by) values ('Another Agency', 'government', ${ryan?.id}) returning id::int as id`,
    );
    // The hospital awarded us a tender (won, no order yet); another agency awarded one too.
    const award = async (code: string, agencyId: number) =>
      (
        await rows<{ id: number }>(
          db,
          sql`insert into tender (code, agency_id, title, owner_id, step, created_by)
            values (${code}, ${agencyId}, 'Ceftriaxone 1 g vials', ${ryan?.id}, 'won', ${ryan?.id}) returning id::int as id`,
        )
      )[0]?.id as number;
    const ours = await award("TND-T-1", customer);
    const theirs = await award("TND-T-2", other?.id as number);
    // Its accreditation with 2MG and a medicine on its formulary.
    await db.execute(
      sql`insert into hospital_accreditation (customer_id, status, on_day, valid_until, by_person)
        values (${customer}, 'accredited', '2026-01-10', '2027-01-09', ${ryan?.id})`,
    );
    await db.execute(
      sql`insert into hospital_formulary (customer_id, medicine_id, status, on_day, by_person) values (${customer}, ${medicine}, 'approved', '2026-02-01', ${ryan?.id})`,
    );
    const before = await read<CustomerDetail>("ryan", `/api/customers/${customer}`);
    expect(before.standing).toMatchObject({
      accreditation: { status: "accredited", validUntil: "2027-01-09" },
      formulary: { approved: 1, requested: 0 },
      awards: [{ id: ours, code: "TND-T-1", step: "won" }],
    });
    // Another agency's award: refused, nothing placed.
    const count = async () => (await rows<{ n: number }>(db, sql`select count(*)::int as n from sales_order`))[0]?.n;
    const was = await count();
    const wrong = await post("ryan", "/api/orders", {
      customerId: customer,
      tenderId: theirs,
      items: [{ medicineId: medicine, qty: 1, priceKind: "hospital" }],
    });
    expect(wrong.status).toBe(400);
    expect(await count()).toBe(was);
    const placed = await post("ryan", "/api/orders", {
      customerId: customer,
      tenderId: ours,
      items: [{ medicineId: medicine, qty: 1, priceKind: "hospital" }],
    });
    expect(placed.status).toBe(200);
    const { id } = (await placed.json()) as { id: number };
    const [linked] = await rows<{ orderId: number | null; events: number }>(
      db,
      sql`select order_id::int as "orderId", (select count(*)::int from tender_event e where e.tender_id = t.id) as events from tender t where t.id = ${ours}`,
    );
    expect(linked).toEqual({ orderId: id, events: 1 });
    // Delivered by an order now: no longer offered.
    expect((await read<CustomerDetail>("ryan", `/api/customers/${customer}`)).standing.awards).toEqual([]);
  });
});
