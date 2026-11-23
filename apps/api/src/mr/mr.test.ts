// The field's day end to end (docs/PLAN.md 22), on the CRM's own customers, visits, orders and
// hierarchy: a MedRep starts working, checks in, places the CRM's own order at the call (it joins
// the visit and goes to Management as every order does), closes the call with its record, skips
// and misses visits with reasons, adds expenses, sends the day report. Up the line: the team lead
// sees the team, judges, reopens, approves plans, deviations and expenses; the head sees under
// them; the CEO reads everything and decides nothing. Who may do what is checked at every step.

import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { seedDemoCustomers } from "../customers/seed";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { addDays, todayManila } from "../inventory/rules";
import { seedDemoInventory } from "../inventory/seed";
import { seedDemo } from "../seed";
import type { FieldReport, Me } from "../types";
import type {
  ClientList,
  ClientPage,
  DayReport,
  ExpenseMonth,
  LeadQueue,
  MrHome,
  MrMe,
  PlanMonth,
  TeamToday,
  VisitList,
  VisitPage,
} from "./words";
import { townKey } from "./words";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
const ids: Record<string, number> = {};
const customers: Record<string, number> = {};
const visits: Record<string, number> = {};
let medicineId: number;
let orderId: number;
const today = () => todayManila();

const get = (who: string, path: string) => app.request(path, { headers: { cookie: cookies[who] as string } });
const read = async <T>(who: string, path: string) => {
  const response = await get(who, path);
  expect(response.status, `${who} GET ${path}`).toBe(200);
  return (await response.json()) as T;
};
const send = (who: string, path: string, body: unknown = {}) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookies[who] as string },
    body: JSON.stringify(body),
  });
const ok = async (who: string, path: string, body: unknown = {}) => {
  const response = await send(who, path, body);
  const text = await response.text();
  expect(response.status, `${who} POST ${path}: ${text}`).toBe(200);
  return JSON.parse(text) as Record<string, unknown>;
};
const form = (who: string, path: string, fields: Record<string, string>, file?: { name: string; type: string; bytes: Uint8Array }) => {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  if (file) body.set("file", new File([file.bytes as Uint8Array<ArrayBuffer>], file.name, { type: file.type }));
  return app.request(path, { method: "POST", headers: { cookie: cookies[who] as string }, body });
};
// A tiny PDF as a bill (kept as it comes: only photos are made smaller).
const BILL = { name: "bill.pdf", type: "application/pdf", bytes: new TextEncoder().encode("%PDF-1.4\n%%EOF\n") };
const customerId = async (name: string) => {
  const [found] = await rows<{ id: number }>(db, sql`select id::int as id from customer where name = ${name}`);
  return found?.id as number;
};

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  await seedDemoInventory(db);
  await seedDemoCustomers(db);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["ryan", "daniel", "vanessa", "naresh", "admin", "sarla", "jane"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
    ids[name] = ((await response.json()) as { me: Me }).me.id;
  }
  customers.hospital = await customerId("San Juan de Dios Hospital");
  customers.hospital2 = await customerId("Las Piñas Doctors Hospital");
  customers.doctor = await customerId("Dr. Marco Reyes");
  customers.firm = await customerId("MedExpress Drug");
  const [medicine] = await rows<{ id: number }>(
    db,
    sql`select m.id::int as id from medicine m join medicine_price p on p.medicine_id = m.id and p.buyer_type = 'hospital' limit 1`,
  );
  medicineId = medicine?.id as number;
});

describe("who works the field", () => {
  it("follows the company's own tree: the MedRep, their team lead, the head, the CEO", async () => {
    const ryan = await read<MrMe>("ryan", "/api/mr/me");
    expect(ryan.access).toBe("mr");
    expect(ryan.lead?.id).toBe(ids.daniel);
    expect((await read<MrMe>("daniel", "/api/mr/me")).access).toBe("lead");
    expect((await read<MrMe>("vanessa", "/api/mr/me")).access).toBe("lead");
    expect((await read<MrMe>("naresh", "/api/mr/me")).access).toBe("viewer");
    // The Online desk isn't the field.
    expect((await read<MrMe>("jane", "/api/mr/me")).access).toBeNull();
    expect((await get("jane", "/api/mr/home")).status).toBe(403);
    expect((await get("jane", "/api/mr/clients")).status).toBe(403);
  });
});

describe("customers on the field's lists", () => {
  it("shows the customers the MedRep looks after as KOLs, hospitals and KBLs, a new one added on the CRM's own form", async () => {
    const added = await ok("ryan", "/api/customers", { kind: "doctor", name: "Dr. Ana Lim", city: "Pasay", specialty: "Cardiology" });
    customers.doctor2 = added.id as number;
    const kols = await read<ClientList>("ryan", "/api/mr/clients?kind=doctor");
    expect(kols.rows.map((one) => one.name)).toEqual(["Dr. Ana Lim", "Dr. Marco Reyes"]);
    expect(kols.rows.find((one) => one.id === customers.doctor)?.detail).toBe("San Juan de Dios Hospital");
    const hospitals = await read<ClientList>("ryan", "/api/mr/clients?kind=hospital");
    expect(hospitals.rows.map((one) => one.name)).toContain("San Juan de Dios Hospital");
    // A hospital in another area isn't his.
    expect(hospitals.rows.map((one) => one.name)).not.toContain("Davao Doctors Hospital");
    const kbls = await read<ClientList>("ryan", "/api/mr/clients?kind=firm");
    expect(kbls.rows.map((one) => one.name)).toEqual(["MedExpress Drug"]);
    // The head sees them under her team.
    const hers = await read<ClientList>("vanessa", "/api/mr/clients?kind=doctor&scope=team");
    expect(hers.rows.map((one) => one.name)).toEqual(expect.arrayContaining(["Dr. Ana Lim", "Dr. Marco Reyes"]));
  });

  it("keeps the field's profile; the category is the team lead's", async () => {
    await ok("ryan", `/api/mr/clients/${customers.doctor2}/profile`, {
      qualification: "MD, FPCC",
      gender: "female",
      prefDays: ["mon", "wed"],
      prefTime: "9-11 AM",
      dispensing: false,
    });
    expect((await send("ryan", `/api/mr/clients/${customers.doctor2}/profile`, { category: "A" })).status).toBe(403);
    await ok("daniel", `/api/mr/clients/${customers.doctor2}/profile`, { category: "A", prefDays: ["mon", "wed"], prefTime: "9-11 AM" });
    const page = await read<ClientPage>("ryan", `/api/mr/clients/${customers.doctor2}`);
    expect(page.client.category).toBe("A");
    expect(page.client.prefDays).toEqual(["mon", "wed"]);
    expect(page.can.visit).toBe(true);
    expect(page.can.category).toBe(false);
    // The CEO reads it, and edits nothing.
    expect((await read<ClientPage>("naresh", `/api/mr/clients/${customers.doctor2}`)).client.name).toBe("Dr. Ana Lim");
    expect((await send("naresh", `/api/mr/clients/${customers.doctor2}/profile`, { prefTime: "x" })).status).toBe(403);
  });
});

describe("the MedRep's day", () => {
  it("plans today's visits, starts working (attendance and the day's allowances with it), and wants an objective before I'm here", async () => {
    const planned = await ok("ryan", "/api/mr/visits", {
      day: today(),
      customerIds: [customers.hospital, customers.doctor, customers.firm, customers.doctor2],
    });
    [visits.hospital, visits.doctor, visits.firm, visits.doctor2] = planned.ids as [number, number, number, number];
    // I'm here needs the day started.
    expect((await send("ryan", `/api/mr/visits/${visits.hospital}/check-in`, { place: "14.5545,120.9960" })).status).toBe(409);
    await ok("ryan", "/api/mr/day/start", { workType: "hq", cities: ["Pasay"], place: "14.5500,120.9900" });
    expect((await send("ryan", "/api/mr/day/start", { workType: "hq", cities: ["Pasay"] })).status).toBe(409);
    const home = await read<MrHome>("ryan", "/api/mr/home");
    expect(home.day?.workType).toBe("hq");
    expect(home.counts.planned).toBe(4);
    expect(home.tiles.doctors).toBe(2);
    // My day lists today's visits of every kind together (where are you going now?).
    expect(home.visits.map((one) => one.id).sort()).toEqual(Object.values(visits).sort());
    // The day's town comes from the country's list: "Makati City", "City of Makati" and "Makati" are one town.
    expect(townKey("City of Makati")).toBe(townKey("Makati City"));
    expect(townKey("San Jose, Batangas")).toBe("san jose");
    const [where] = await rows<{ city: string }>(db, sql`select city from customer where id = ${customers.hospital}`);
    const inTown = await read<{ id: number }[]>("ryan", `/api/mr/clients/pick?kind=hospital&cities=${encodeURIComponent(`City of ${(where?.city ?? "").replace(/ City$/, "")}`)}`);
    expect(inTown.map((one) => one.id)).toContain(customers.hospital);
    const [attendance] = await rows<{ n: number }>(
      db,
      sql`select count(*)::int as n from attendance where person_id = ${ids.ryan} and day = ${today()}::date and time_in is not null`,
    );
    expect(attendance?.n).toBe(1);
    const [lines] = await rows<{ n: number }>(db, sql`select count(*)::int as n from field_expense where person_id = ${ids.ryan} and auto`);
    expect(lines?.n).toBe(2);
    expect((await send("ryan", `/api/mr/visits/${visits.hospital}/check-in`, { place: "14.5545,120.9960" })).status).toBe(400);
    await ok("ryan", `/api/mr/visits/${visits.hospital}/plan`, { objectives: ["business_call", "payment"] });
    await ok("ryan", `/api/mr/visits/${visits.hospital}/check-in`, { place: "14.5545,120.9960" });
    // One place at a time.
    await ok("ryan", `/api/mr/visits/${visits.doctor}/plan`, { objectives: ["thank_you_call"] });
    expect((await send("ryan", `/api/mr/visits/${visits.doctor}/check-in`, {})).status).toBe(409);
  });

  it("places the CRM's own order at the call: it joins the visit and goes to Management like any order", async () => {
    // "Business generated" needs the order first.
    const early = await send("ryan", `/api/mr/visits/${visits.hospital}/close`, {
      meeting: "met", objectives: ["business_call"], products: [], nature: "business", outcome: "business", productive: "yes",
    });
    expect(early.status).toBe(400);
    expect((await read<VisitPage>("ryan", `/api/mr/visits/${visits.hospital}`)).can.book).toBe(true);
    // Saving the call as typed before stepping out to the order form.
    await ok("ryan", `/api/mr/visits/${visits.hospital}/draft`, { draft: { feedback: "Wants the new pack" } });
    expect((await read<VisitPage>("ryan", `/api/mr/visits/${visits.hospital}`)).draft).toEqual({ feedback: "Wants the new pack" });
    const [before] = await rows<{ n: number }>(db, sql`select count(*)::int as n from sales_order`);
    // An order for another customer than the visit's is refused whole.
    const wrong = await send("ryan", "/api/orders", {
      customerId: customers.hospital,
      items: [{ medicineId, qty: 5, priceKind: "hospital" }],
      visitId: visits.doctor,
    });
    expect(wrong.status).toBe(400);
    const [after] = await rows<{ n: number }>(db, sql`select count(*)::int as n from sales_order`);
    expect(after?.n).toBe(before?.n);
    const placed = await ok("ryan", "/api/orders", {
      customerId: customers.hospital,
      items: [{ medicineId, qty: 5, priceKind: "hospital" }],
      visitId: visits.hospital,
    });
    orderId = placed.id as number;
    const [order] = await rows<{ status: string; medrepId: number }>(
      db,
      sql`select status, medrep_id::int as "medrepId" from sales_order where id = ${orderId}`,
    );
    expect(order?.status).toBe("pending_approval");
    expect(order?.medrepId).toBe(ids.ryan);
    const page = await read<VisitPage>("ryan", `/api/mr/visits/${visits.hospital}`);
    expect(page.placed.map((one) => one.id)).toEqual([orderId]);
    expect(page.placed[0]?.total).toBeGreaterThan(0);
    expect(page.can.close).toBe(true);
  });

  it("closes the call with its full record; closed stays closed for the MedRep", async () => {
    const closed = await ok("ryan", `/api/mr/visits/${visits.hospital}/close`, {
      meeting: "met",
      objectives: ["business_call", "payment"],
      products: [{ medicineId, promoted: true, reaction: "will_prescribe", inStock: true, stock: 12 }],
      call: { met: ["Pharmacy head"], pharmacy: "Stocks it", purchasing: "PO next week" },
      nature: "both",
      outcome: "business",
      productive: "yes",
      feedback: "Wants the new pack",
      followUp: { on: addDays(today(), 7), kind: "payment", what: "Collect the cheque" },
      nextDay: addDays(today(), 14),
      place: "14.5546,120.9961",
    });
    expect(closed.followUpId).toBeTruthy();
    expect(closed.nextVisitId).toBeTruthy();
    const page = await read<VisitPage>("ryan", `/api/mr/visits/${visits.hospital}`);
    expect(page.visit.status).toBe("done");
    expect(page.visit.products[0]?.stock).toBe(12);
    expect(page.visit.call?.met).toEqual(["Pharmacy head"]);
    expect(page.draft).toBeNull();
    expect(page.visit.changes.map((one) => one.what)).toContain("closed");
    // The customer's field page shows the order.
    const client = await read<ClientPage>("ryan", `/api/mr/clients/${customers.hospital}`);
    expect(client.orders.map((one) => one.id)).toContain(orderId);
    expect(
      (await send("ryan", `/api/mr/visits/${visits.hospital}/close`, { meeting: "met", objectives: ["business_call"], products: [], nature: "both", outcome: "none", productive: "yes" })).status,
    ).toBe(409);
  });

  it("closes a not-met call as not sure yet: productive is never worked out by itself", async () => {
    await ok("ryan", `/api/mr/visits/${visits.doctor}/check-in`, {});
    const missing = await send("ryan", `/api/mr/visits/${visits.doctor}/close`, { meeting: "not_met", objectives: ["thank_you_call"], products: [], outcome: "none" });
    expect(missing.status).toBe(400);
    await ok("ryan", `/api/mr/visits/${visits.doctor}/close`, {
      meeting: "not_met",
      objectives: ["thank_you_call"],
      products: [],
      outcome: "follow_up",
      productive: "pending",
      followUp: { on: addDays(today(), 2), kind: "visit", what: "Try again in the morning" },
    });
  });

  it("adds a visit on the day only with why, and skips with a reason", async () => {
    expect((await send("ryan", "/api/mr/visits", { day: today(), customerIds: [customers.hospital2] })).status).toBe(400);
    const added = await ok("ryan", "/api/mr/visits", { day: today(), customerIds: [customers.hospital2], why: "Pharmacy called me" });
    visits.hospital2 = (added.ids as number[])[0] as number;
    expect((await read<VisitPage>("ryan", `/api/mr/visits/${visits.hospital2}`)).visit.unplanned).toBe(true);
    expect((await send("ryan", `/api/mr/visits/${visits.firm}/skip`, { reason: "other" })).status).toBe(400);
    await ok("ryan", `/api/mr/visits/${visits.firm}/skip`, { reason: "closed", note: "Shop shut" });
  });

  it("sends the day report only with a reason for each visit not done; those become missed and the day ends", async () => {
    const report = await read<DayReport>("ryan", "/api/mr/day/report");
    expect(report.visits.done).toBe(2);
    expect(report.visits.skipped).toBe(1);
    expect(report.open.map((one) => one.id).sort()).toEqual([visits.doctor2, visits.hospital2].sort());
    expect(report.business.booked).toBe(1);
    expect(report.business.bookedAmount).toBeGreaterThan(0);
    expect(report.can.send).toBe(true);
    expect((await send("ryan", "/api/mr/day/report", { missed: [], note: "Good day" })).status).toBe(400);
    await ok("ryan", "/api/mr/day/report", {
      missed: [
        { visitId: visits.doctor2, reason: "not_available" },
        { visitId: visits.hospital2, reason: "rescheduled", note: "Tomorrow" },
      ],
      note: "Good day",
      place: "14.5500,120.9900",
    });
    const sent = await read<DayReport>("ryan", "/api/mr/day/report");
    expect(sent.visits.missed).toBe(2);
    expect(sent.state?.report.status).toBe("sent");
    const [out] = await rows<{ n: number }>(
      db,
      sql`select count(*)::int as n from attendance where person_id = ${ids.ryan} and day = ${today()}::date and time_out is not null`,
    );
    expect(out?.n).toBe(1);
    expect((await send("ryan", "/api/mr/day/break", { on: true })).status).toBe(409);
  });
});

describe("up the line", () => {
  it("shows the team lead each MedRep's day and what waits; the head sees it too; an MR only their own", async () => {
    const team = await read<TeamToday>("daniel", "/api/mr/team");
    const ryan = team.people.find((one) => one.id === ids.ryan);
    expect(ryan?.done).toBe(2);
    expect(ryan?.missed).toBe(2);
    expect(ryan?.report).toBe("sent");
    expect(ryan?.bookedAmount).toBeGreaterThan(0);
    expect(team.waiting.reports).toBe(1);
    expect(team.waiting.judge).toBe(1);
    expect(team.champions[0]?.id).toBe(ids.ryan);
    const queue = await read<LeadQueue>("daniel", "/api/mr/team/queue");
    expect(queue.reports.map((one) => one.personId)).toEqual([ids.ryan]);
    expect(queue.judge.map((one) => one.id)).toEqual([visits.doctor]);
    // The head, above the team lead.
    const head = await read<TeamToday>("vanessa", "/api/mr/team");
    expect(head.people.map((one) => one.id)).toContain(ids.ryan);
    expect((await read<VisitPage>("vanessa", `/api/mr/visits/${visits.hospital}`)).visit.status).toBe("done");
    // The CEO reads everything and decides nothing.
    expect((await read<TeamToday>("naresh", "/api/mr/team")).people.map((one) => one.id)).toContain(ids.ryan);
    expect((await read<VisitPage>("naresh", `/api/mr/visits/${visits.hospital}`)).can.judge).toBe(false);
    expect((await send("naresh", `/api/mr/visits/${visits.doctor}/judge`, { productive: "yes" })).status).toBe(403);
    // An MR doesn't get the team's pages; the Online desk nothing.
    expect((await get("ryan", "/api/mr/team")).status).toBe(403);
    expect((await get("jane", `/api/mr/visits/${visits.hospital}`)).status).toBe(403);
  });

  it("lets the team lead judge a not-sure call, mark the report seen, and reopen a call for a correction", async () => {
    expect((await send("ryan", `/api/mr/visits/${visits.doctor}/judge`, { productive: "yes" })).status).toBe(403);
    await ok("daniel", `/api/mr/visits/${visits.doctor}/judge`, { productive: "no", note: "Not met is not productive" });
    expect((await send("daniel", `/api/mr/visits/${visits.doctor}/judge`, { productive: "yes" })).status).toBe(409);
    await ok("daniel", "/api/mr/day/report/seen", { person: ids.ryan, day: today(), note: "Good" });
    expect((await send("daniel", `/api/mr/visits/${visits.hospital}/reopen`, { note: "" })).status).toBe(400);
    await ok("daniel", `/api/mr/visits/${visits.hospital}/reopen`, { note: "Feedback missing the pharmacy's words" });
    const page = await read<VisitPage>("ryan", `/api/mr/visits/${visits.hospital}`);
    expect(page.visit.status).toBe("planned");
    expect(page.visit.changes.map((one) => one.what)).toEqual(["closed", "reopened"]);
    // The order stays with the visit.
    expect(page.placed.map((one) => one.id)).toEqual([orderId]);
  });

  it("lists the calls over days and the month's attendance; the CRM's own visits report counts the same day", async () => {
    const calls = await read<{ rows: { id: number }[] }>("daniel", `/api/mr/reports/calls?from=${today()}&to=${today()}`);
    expect(calls.rows.length).toBe(5);
    const attendance = await read<{ totals: { present: number } }>("daniel", `/api/mr/reports/attendance?person=${ids.ryan}`);
    expect(attendance.totals.present).toBe(1);
    const report = await read<FieldReport>("daniel", `/api/field/report?from=${today()}&to=${today()}`);
    const ryan = report.people.find((one) => one.personId === ids.ryan);
    // The reopened call is planned again; the not-met one done; skipped and missed are not done.
    expect(ryan).toMatchObject({ planned: 1, done: 1, skipped: 3 });
    const list = await read<VisitList>("vanessa", `/api/mr/visits?person=${ids.ryan}&kind=hospital`);
    expect(list.rows.map((one) => one.id).sort()).toEqual([visits.hospital, visits.hospital2].sort());
  });
});

describe("expenses", () => {
  it("adds a head with its bill, claims the day's allowance; the team lead approves (less) or rejects", async () => {
    const noBill = await form("ryan", "/api/mr/expenses", { day: today(), head: "mktg_snack", amount: "500", note: "snacks" });
    expect(noBill.status).toBe(400);
    const added = await form("ryan", "/api/mr/expenses", { day: today(), head: "mktg_snack", amount: "500", note: "snacks" }, BILL);
    expect(added.status, await added.clone().text()).toBe(200);
    const month = await read<ExpenseMonth>("ryan", "/api/mr/expenses");
    const perDiem = month.rows.find((one) => one.head === "er_per_diem") as ExpenseMonth["rows"][number];
    expect(perDiem.auto).toBe(true);
    expect(perDiem.generated).toBe(0);
    const claim = await form("ryan", `/api/mr/expenses/${perDiem.id}/claim`, { amount: "300", note: "Per diem" });
    expect(claim.status, await claim.clone().text()).toBe(200);
    const snack = (await read<ExpenseMonth>("ryan", "/api/mr/expenses")).rows.find((one) => one.head === "mktg_snack") as ExpenseMonth["rows"][number];
    expect(snack.claimed).toBe(50_000);
    // Waiting with the team lead (and seen by the head above).
    const waiting = await read<ExpenseMonth>("daniel", "/api/mr/expenses?waiting=1");
    expect(waiting.rows.map((one) => one.id).sort()).toEqual([perDiem.id, snack.id].sort());
    expect((await read<ExpenseMonth>("vanessa", "/api/mr/expenses?waiting=1")).rows.length).toBe(2);
    expect((await send("ryan", `/api/mr/expenses/${snack.id}/decide`, { approve: true })).status).toBe(403);
    expect((await send("naresh", `/api/mr/expenses/${snack.id}/decide`, { approve: true })).status).toBe(403);
    expect((await send("daniel", `/api/mr/expenses/${snack.id}/decide`, { approve: true, amount: 600 })).status).toBe(400);
    await ok("daniel", `/api/mr/expenses/${snack.id}/decide`, { approve: true, amount: 450 });
    expect((await send("daniel", `/api/mr/expenses/${perDiem.id}/decide`, { approve: false })).status).toBe(400);
    await ok("daniel", `/api/mr/expenses/${perDiem.id}/decide`, { approve: false, note: "No rate yet" });
    expect((await read<ExpenseMonth>("ryan", "/api/mr/expenses")).totals.approved).toBe(45_000);
    // The CRM's own visits report spends what was approved.
    const report = await read<FieldReport>("daniel", `/api/field/report?from=${today()}&to=${today()}`);
    expect(report.people.find((one) => one.personId === ids.ryan)?.spent).toBe(45_000);
    // The rates are the company's: Management or the Admin, not a team lead.
    expect((await send("daniel", "/api/mr/expenses/rates", { rates: [{ workType: "hq", perDiem: 250, ta: 150 }] })).status).toBe(403);
    await ok("sarla", "/api/mr/expenses/rates", { rates: [{ workType: "hq", perDiem: 250, ta: 150 }] });
  });
});

describe("the tour plan", () => {
  it("plans a day by city, sends the month, the team lead approves; after that a change is a deviation", async () => {
    const next = addDays(today(), 1);
    const nextMonth = next.slice(0, 7);
    await ok("ryan", "/api/mr/plan/day", { day: next, workType: "ex_station", cities: ["Parañaque"] });
    const added = await ok("ryan", "/api/mr/visits", { day: next, customerIds: [customers.doctor2] });
    const visitId = (added.ids as number[])[0] as number;
    await ok("ryan", "/api/mr/plan/send", { month: nextMonth });
    expect((await send("ryan", "/api/mr/plan/send", { month: nextMonth })).status).toBe(409);
    const team = await read<{ people: { id: number; status: string | null }[] }>("daniel", `/api/mr/plan/team?month=${nextMonth}`);
    expect(team.people.find((one) => one.id === ids.ryan)?.status).toBe("sent");
    const sent = await read<PlanMonth>("daniel", `/api/mr/plan?person=${ids.ryan}&month=${nextMonth}`);
    expect(sent.plan.status).toBe("sent");
    expect(sent.can.decide).toBe(true);
    expect((await read<PlanMonth>("naresh", `/api/mr/plan?person=${ids.ryan}&month=${nextMonth}`)).can.decide).toBe(false);
    expect((await send("daniel", "/api/mr/plan/decide", { person: ids.ryan, month: nextMonth, approve: false })).status).toBe(400);
    await ok("daniel", "/api/mr/plan/decide", { person: ids.ryan, month: nextMonth, approve: true });
    const approved = await read<PlanMonth>("ryan", `/api/mr/plan?month=${nextMonth}`);
    expect(approved.plan.status).toBe("approved");
    expect(approved.revisions[0]?.visits).toBeGreaterThanOrEqual(1);
    // A change now needs why, and goes to the team lead.
    expect((await send("ryan", `/api/mr/visits/${visitId}/move`, { day: addDays(next, 1) })).status).toBe(400);
    await ok("ryan", `/api/mr/visits/${visitId}/move`, { day: addDays(next, 1), why: "Doctor asked for the next day" });
    const waiting = await read<{ rows: { id: number; kind: string }[] }>("daniel", "/api/mr/deviations");
    expect(waiting.rows.map((one) => one.kind)).toContain("moved");
    expect((await send("naresh", `/api/mr/deviations/${waiting.rows[0]?.id}`, { approve: true })).status).toBe(403);
    await ok("daniel", `/api/mr/deviations/${waiting.rows[0]?.id}`, { approve: true });
    expect((await read<{ rows: unknown[] }>("daniel", "/api/mr/deviations")).rows).toHaveLength(0);
  });
});
