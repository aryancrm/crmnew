// Field step 2: the team lead sets each customer's class and approves the MedRep's month plan;
// the plan fills each customer's visits by class; a check-in is compared with the clinic's pin;
// field expenses carry their bill's photo and wait for the team lead; the CEO reads it all.

import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { seedDemoCustomers } from "../customers/seed";
import { type Database, openDatabase } from "../db/index";
import { migrate } from "../db/migrate";
import { addDays, todayManila } from "../inventory/rules";
import { seedDemoInventory } from "../inventory/seed";
import { seedDemo } from "../seed";
import type { FieldDay, FieldExpenses, FieldForm, FieldReport, Me, VisitPlanPage } from "../types";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
const ids: Record<string, number> = {};
let form: FieldForm;

const get = (who: string, path: string) =>
  app.request(path, { headers: { cookie: cookies[who] as string } });
const read = async <T>(who: string, path: string) => (await (await get(who, path)).json()) as T;
const send = (who: string, path: string, body: unknown = {}) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookies[who] as string },
    body: JSON.stringify(body),
  });
const expense = (who: string, path: string, fields: Record<string, string>, photo = false) => {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  if (photo)
    body.set(
      "file",
      new File([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], "bill.png", { type: "image/png" }),
    );
  return app.request(path, { method: "POST", headers: { cookie: cookies[who] as string }, body });
};
const nextMonth = () => {
  const [y, m] = todayManila().slice(0, 7).split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
};

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  await seedDemoInventory(db);
  await seedDemoCustomers(db);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["ryan", "daniel", "naresh", "fiona"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
    ids[name] = ((await response.json()) as { me: Me }).me.id;
  }
  form = await read<FieldForm>("ryan", "/api/field/form");
});

describe("the month plan, by class, approved by the team lead", () => {
  it("lets the team lead set a customer's class, not the MedRep", async () => {
    const first = form.customers[0] as FieldForm["customers"][number];
    expect(
      (await send("ryan", `/api/field/customers/${first.id}/class`, { visitClass: "A" })).status,
    ).toBe(403);
    expect(
      (await send("daniel", `/api/field/customers/${first.id}/class`, { visitClass: "A" })).status,
    ).toBe(200);
  });

  it("fills the month by class, once, and sends it to the team lead who approves it", async () => {
    const month = nextMonth();
    const made = await send("ryan", "/api/field/plan/make", { month });
    expect(made.status).toBe(200);
    expect(((await made.json()) as { added: number }).added).toBeGreaterThan(0);
    const plan = await read<VisitPlanPage>("ryan", `/api/field/plan?month=${month}`);
    const classA = plan.customers.find((one) => one.visitClass === "A");
    expect(classA).toMatchObject({ needed: 4, planned: 4 });
    expect(plan.customers.every((one) => one.planned === one.needed)).toBe(true);
    // Never twice a day for one customer, never on a rest day.
    const days = await read<FieldDay[]>("ryan", "/api/field/day").then(() => plan.days);
    expect(days.filter((one) => !one.work).every((one) => one.planned === 0)).toBe(true);
    expect(
      ((await (await send("ryan", "/api/field/plan/make", { month })).json()) as { added: number })
        .added,
    ).toBe(0);
    expect(plan.can).toMatchObject({ make: true, send: true, decide: false, setClass: false });

    expect((await send("ryan", "/api/field/plan/send", { month })).status).toBe(200);
    expect((await send("ryan", "/api/field/plan/make", { month })).status).toBe(409);
    const asLead = await read<VisitPlanPage>(
      "daniel",
      `/api/field/plan?month=${month}&person=${ids.ryan}`,
    );
    expect(asLead.plan.status).toBe("sent");
    expect(asLead.can).toMatchObject({ decide: true, setClass: true, make: false });
    expect(
      (await send("fiona", `/api/field/plan/${ids.ryan}/decide`, { month, approve: true })).status,
    ).toBe(403);
    expect(
      (await send("ryan", `/api/field/plan/${ids.ryan}/decide`, { month, approve: true })).status,
    ).toBe(403);
    expect(
      (await send("naresh", `/api/field/plan/${ids.ryan}/decide`, { month, approve: true })).status,
    ).toBe(403);
    expect(
      (await send("daniel", `/api/field/plan/${ids.ryan}/decide`, { month, approve: false }))
        .status,
    ).toBe(400);
    expect(
      (
        await send("daniel", `/api/field/plan/${ids.ryan}/decide`, {
          month,
          approve: false,
          note: "Add Dr. Cruz twice",
        })
      ).status,
    ).toBe(200);
    expect(
      (await read<VisitPlanPage>("ryan", `/api/field/plan?month=${month}`)).plan,
    ).toMatchObject({
      status: "sent_back",
      note: "Add Dr. Cruz twice",
      decidedBy: "Daniel",
    });
    expect((await send("ryan", "/api/field/plan/send", { month })).status).toBe(200);
    expect(
      (await send("daniel", `/api/field/plan/${ids.ryan}/decide`, { month, approve: true })).status,
    ).toBe(200);
    const report = await read<FieldReport>(
      "naresh",
      `/api/field/report?from=${month}-01&to=${month}-28`,
    );
    expect(report.people.find((one) => one.personId === ids.ryan)?.plan).toBe("approved");
  });
});

describe("the clinic's pin", () => {
  it("compares a check-in with the pin, says far away, and lets only the lead move a pin", async () => {
    const customer = form.customers[1] as FieldForm["customers"][number];
    // About 1.1 km north of the pin.
    await db.execute(sql`update customer set pin = '14.55000,121.02000' where id = ${customer.id}`);
    const planned = await send("ryan", "/api/field/visits", {
      customerId: customer.id,
      day: todayManila(),
    });
    const { id } = (await planned.json()) as { id: number };
    expect(
      (await send("ryan", `/api/field/visits/${id}/check-in`, { place: "14.56000,121.02000" }))
        .status,
    ).toBe(200);
    const day = await read<FieldDay>("ryan", "/api/field/day");
    const visit = day.visits.find((one) => one.id === id);
    expect(visit?.distanceM).toBeGreaterThan(1000);
    expect(visit?.distanceM).toBeLessThan(1200);
    expect(visit?.customer.pinned).toBe(true);
    expect((await send("ryan", `/api/field/visits/${id}/pin`)).status).toBe(409);
    expect((await send("daniel", `/api/field/visits/${id}/pin`)).status).toBe(200);
    await send("ryan", `/api/field/visits/${id}/report`, {
      detailed: [],
      notes: "Met the secretary",
    });
    const report = await read<FieldReport>("naresh", "/api/field/report");
    expect(report.people.find((one) => one.personId === ids.ryan)?.away).toBe(0);
  });
});

describe("field expenses with their bills", () => {
  let petrol = 0;
  let fare = 0;
  it("asks for the bill's photo (a fare may have none), a past day and a word for Other", async () => {
    const today = todayManila();
    const base = { day: today, kind: "petrol", amount: "450.50", km: "38" };
    const noPhoto = await expense("ryan", "/api/field/expenses", base);
    expect(noPhoto.status).toBe(400);
    expect(((await noPhoto.json()) as { error: { field: string } }).error.field).toBe("file");
    expect(
      (await expense("ryan", "/api/field/expenses", { ...base, day: addDays(today, 1) }, true))
        .status,
    ).toBe(400);
    expect(
      (await expense("ryan", "/api/field/expenses", { ...base, kind: "other" }, true)).status,
    ).toBe(400);
    expect((await expense("fiona", "/api/field/expenses", base, true)).status).toBe(403);
    const made = await expense("ryan", "/api/field/expenses", base, true);
    expect(made.status).toBe(200);
    petrol = ((await made.json()) as { id: number }).id;
    const ride = await expense("ryan", "/api/field/expenses", {
      day: today,
      kind: "fare",
      amount: "60",
    });
    expect(ride.status).toBe(200);
    fare = ((await ride.json()) as { id: number }).id;
    const mine = await read<FieldExpenses>("ryan", "/api/field/expenses");
    expect(mine.totals).toMatchObject({
      pending: 51050,
      km: 38,
      byKind: { petrol: 45050, fare: 6000 },
    });
    expect(mine.rows.find((one) => one.id === petrol)?.receipt).toEqual({
      name: "bill.png",
      mime: "image/png",
    });
    expect(mine.can.add).toBe(true);
  });

  it("waits for the team lead, who approves or sends back with a word; the CEO reads only", async () => {
    const waiting = await read<FieldExpenses>("daniel", "/api/field/expenses?waiting=1");
    expect(waiting.rows.map((one) => one.id).sort()).toEqual([petrol, fare].sort());
    expect(waiting.rows.every((one) => one.canDecide)).toBe(true);
    expect((await get("ryan", "/api/field/expenses?waiting=1")).status).toBe(403);
    expect(
      (await send("naresh", `/api/field/expenses/${petrol}/decide`, { approve: true })).status,
    ).toBe(403);
    expect(
      (await send("daniel", `/api/field/expenses/${petrol}/decide`, { approve: true })).status,
    ).toBe(200);
    expect(
      (await send("daniel", `/api/field/expenses/${fare}/decide`, { approve: false })).status,
    ).toBe(400);
    expect(
      (
        await send("daniel", `/api/field/expenses/${fare}/decide`, {
          approve: false,
          note: "Which route?",
        })
      ).status,
    ).toBe(200);
    // The MedRep puts the sent-back line right: it waits again. An approved one stays as it is.
    expect(
      (
        await expense("ryan", `/api/field/expenses/${fare}`, {
          day: todayManila(),
          kind: "fare",
          amount: "60",
          note: "Pasay to Makati",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await expense("ryan", `/api/field/expenses/${petrol}`, {
          day: todayManila(),
          kind: "petrol",
          amount: "1",
        })
      ).status,
    ).toBe(409);
    const report = await read<FieldReport>("naresh", "/api/field/report");
    expect(report.people.find((one) => one.personId === ids.ryan)).toMatchObject({
      spent: 45050,
      spentPending: 6000,
    });
  });

  it("shows the bill to the person, their team lead and the CEO; nobody else", async () => {
    for (const who of ["ryan", "daniel", "naresh"]) {
      const bill = await get(who, `/api/field/expenses/${petrol}/receipt`);
      expect(bill.status).toBe(200);
      expect(bill.headers.get("content-type")).toBe("image/png");
    }
    expect((await get("fiona", `/api/field/expenses/${petrol}/receipt`)).status).toBe(403);
    expect((await get("ryan", `/api/field/expenses/${fare}/receipt`)).status).toBe(404);
  });
});
