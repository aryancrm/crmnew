// The field's visits: a MedRep plans visits to the customers they look after, checks in on the
// day, reports the call or skips it with a reason; the next visit is planned from the report. A
// team lead sees the team's days, the CEO everyone's; the report counts done, skipped and covered.

import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { seedDemoCustomers } from "../customers/seed";
import { type Database, openDatabase } from "../db/index";
import { migrate } from "../db/migrate";
import { addDays, todayManila } from "../inventory/rules";
import { seedDemoInventory } from "../inventory/seed";
import { seedDemo } from "../seed";
import type { FieldDay, FieldForm, FieldReport, Me } from "../types";

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

const today = () => todayManila();

describe("visits", () => {
  it("offers the customers a MedRep looks after and the medicines; not to finance", async () => {
    expect(form.customers.length).toBeGreaterThan(0);
    expect(
      form.customers.every((one) => ["doctor", "hospital", "drugstore"].includes(one.kind)),
    ).toBe(true);
    expect(form.medicines.length).toBeGreaterThan(0);
    expect((await get("fiona", "/api/field/form")).status).toBe(403);
  });

  it("plans, checks in, reports the call and plans the next visit from it", async () => {
    const customer = form.customers[0] as FieldForm["customers"][number];
    const medicine = form.medicines[0] as FieldForm["medicines"][number];
    expect(
      (
        await send("ryan", "/api/field/visits", {
          customerId: customer.id,
          day: addDays(today(), -1),
        })
      ).status,
    ).toBe(400);
    const planned = await send("ryan", "/api/field/visits", {
      customerId: customer.id,
      day: today(),
      objective: "Introduce the new pack",
    });
    expect(planned.status).toBe(200);
    const { id } = (await planned.json()) as { id: number };
    expect(
      (await send("ryan", "/api/field/visits", { customerId: customer.id, day: today() })).status,
    ).toBe(409);

    const report = {
      detailed: [{ medicineId: medicine.id, reaction: "will_prescribe" }],
      notes: "Asked for the price list",
      nextDay: addDays(today(), 7),
    };
    expect((await send("ryan", `/api/field/visits/${id}/report`, report)).status).toBe(400);
    expect((await send("daniel", `/api/field/visits/${id}/check-in`)).status).toBe(403);
    expect(
      (await send("ryan", `/api/field/visits/${id}/check-in`, { place: "14.5547,121.0244" }))
        .status,
    ).toBe(200);
    expect(
      (await send("ryan", `/api/field/visits/${id}/report`, { detailed: [], notes: "" })).status,
    ).toBe(400);
    const done = await send("ryan", `/api/field/visits/${id}/report`, report);
    expect(done.status).toBe(200);
    expect(((await done.json()) as { nextVisitId: number | null }).nextVisitId).toBeTruthy();

    const day = await read<FieldDay>("ryan", "/api/field/day");
    expect(day.can.work).toBe(true);
    const visit = day.visits.find((one) => one.id === id);
    expect(visit).toMatchObject({
      status: "done",
      checkInPlace: "14.5547,121.0244",
      notes: "Asked for the price list",
      detailed: [{ medicineId: medicine.id, name: medicine.name, reaction: "will_prescribe" }],
    });
    const next = await read<FieldDay>("ryan", `/api/field/day?day=${addDays(today(), 7)}`);
    expect(next.visits.map((one) => one.customer.id)).toEqual([customer.id]);
    expect(next.visits[0]?.lastVisit).toBe(today());
    expect((await send("ryan", `/api/field/visits/${id}/skip`, { reason: "busy" })).status).toBe(
      409,
    );
  });

  it("skips with a reason and moves a visit not started", async () => {
    const customer = form.customers[1] ?? (form.customers[0] as FieldForm["customers"][number]);
    const later = addDays(today(), 2);
    const planned = await send("ryan", "/api/field/visits", {
      customerId: customer.id,
      day: later,
    });
    const { id } = (await planned.json()) as { id: number };
    expect((await send("ryan", `/api/field/visits/${id}/check-in`)).status).toBe(400);
    expect(
      (await send("ryan", `/api/field/visits/${id}/move`, { day: addDays(today(), 3) })).status,
    ).toBe(200);
    expect((await send("ryan", `/api/field/visits/${id}/skip`, { reason: "other" })).status).toBe(
      400,
    );
    expect(
      (
        await send("ryan", `/api/field/visits/${id}/skip`, {
          reason: "out_of_town",
          note: "Conference",
        })
      ).status,
    ).toBe(200);
    const day = await read<FieldDay>("ryan", `/api/field/day?day=${addDays(today(), 3)}`);
    expect(day.visits.find((one) => one.id === id)).toMatchObject({
      status: "skipped",
      skipReason: "Out of town: Conference",
    });
  });

  it("lets the team lead and the CEO look, not work; others not even look", async () => {
    const lead = await read<FieldDay>("daniel", `/api/field/day?person=${ids.ryan}`);
    expect(lead.person.name).toBe("Ryan");
    expect(lead.can.work).toBe(false);
    expect((await get("naresh", `/api/field/day?person=${ids.ryan}`)).status).toBe(200);
    expect((await get("fiona", `/api/field/day?person=${ids.ryan}`)).status).toBe(403);
  });

  it("reports visits done, skipped and doctors covered per person over the chosen days", async () => {
    const range = `from=${today()}&to=${addDays(today(), 7)}`;
    const report = await read<FieldReport>("naresh", `/api/field/report?${range}`);
    const ryan = report.people.find((one) => one.personId === ids.ryan);
    expect(ryan).toMatchObject({
      done: 1,
      skipped: 1,
      planned: 1,
      covered: 1,
      fieldDays: 1,
      perDay: 1,
    });
    const team = await read<FieldReport>("daniel", `/api/field/report?${range}`);
    expect(team.people.map((one) => one.name)).toContain("Ryan");
    expect(team.people.every((one) => ["Ryan", "Daniel"].includes(one.name))).toBe(true);
    expect((await get("ryan", "/api/field/report")).status).toBe(403);
  });
});
