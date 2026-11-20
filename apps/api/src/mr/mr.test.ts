// The MR App end to end (docs/PLAN.md 22): the Admin sets up its people (one team lead, the
// MRs); an MR adds clients, plans visits, starts working, checks in, books an order, closes the
// call with its record, skips and misses visits with reasons, adds expenses, sends the day
// report; the team lead sees the team, judges, reopens, approves plans, deviations and expenses.
// Who may do what is checked at every step.

import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { addDays, todayManila } from "../inventory/rules";
import { seedDemoInventory } from "../inventory/seed";
import { seedDemo } from "../seed";
import type { Me } from "../types";
import { sql } from "drizzle-orm";
import type {
  ClientList,
  DayReport,
  ExpenseMonth,
  MrHome,
  MrMe,
  OrderForm,
  PlanMonth,
  TeamToday,
  VisitList,
  VisitPage,
} from "./words";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
const ids: Record<string, number> = {};
const clients: Record<string, number> = {};
const visits: Record<string, number> = {};
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

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  await seedDemoInventory(db);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["ryan", "daniel", "vanessa", "naresh", "admin", "jane"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
    ids[name] = ((await response.json()) as { me: Me }).me.id;
  }
});

describe("the app's people", () => {
  it("is shut to everyone but the CEO and the Admin until the Admin sets it up", async () => {
    expect((await get("ryan", "/api/mr/home")).status).toBe(403);
    expect((await read<MrMe>("ryan", "/api/mr/me")).access).toBeNull();
    expect((await read<MrMe>("naresh", "/api/mr/me")).access).toBe("viewer");
    // Only the Admin (or the CEO) names the team lead.
    expect((await send("ryan", "/api/mr/members", { personId: ids.ryan, role: "lead" })).status).toBe(403);
    await ok("admin", "/api/mr/members", { personId: ids.daniel, role: "lead" });
    // The lead adds the MRs.
    await ok("daniel", "/api/mr/members", { personId: ids.ryan, role: "mr" });
    await ok("daniel", "/api/mr/members", { personId: ids.vanessa, role: "mr" });
    expect((await read<MrMe>("ryan", "/api/mr/me")).access).toBe("mr");
    expect((await read<MrMe>("ryan", "/api/mr/me")).lead?.id).toBe(ids.daniel);
    expect((await read<MrMe>("daniel", "/api/mr/me")).access).toBe("lead");
    // Someone outside it still can't come in.
    expect((await get("jane", "/api/mr/home")).status).toBe(403);
  });
});

describe("clients", () => {
  it("lets an MR add doctors, hospitals and firms (their own), refusing a twin", async () => {
    const hospital = await ok("ryan", "/api/mr/clients", { kind: "hospital", name: "Airforce City Hospital", city: "Angeles City", hospitalType: "government" });
    clients.hospital = hospital.id as number;
    expect(hospital.code).toBe("H0001");
    const doctor = await ok("ryan", "/api/mr/clients", {
      kind: "doctor", name: "Aaron Molano", city: "Angeles City", specialty: "IM-Oncology", category: "A",
      worksAt: clients.hospital, prefDays: ["mon", "wed"], prefTime: "9-11 AM",
    });
    clients.doctor = doctor.id as number;
    clients.firm = (await ok("ryan", "/api/mr/clients", { kind: "firm", name: "XYZ Pharma", city: "Antipolo", firmType: "distributor" })).id as number;
    clients.doctor2 = (await ok("ryan", "/api/mr/clients", { kind: "doctor", name: "John Non", city: "Angeles City" })).id as number;
    clients.doctor3 = (await ok("ryan", "/api/mr/clients", { kind: "doctor", name: "Abegail Santos", city: "Antipolo" })).id as number;
    const twin = await send("ryan", "/api/mr/clients", { kind: "doctor", name: "aaron molano", city: "Angeles city" });
    expect(twin.status).toBe(409);
    const firmWithoutType = await send("ryan", "/api/mr/clients", { kind: "firm", name: "ABC", city: "Antipolo" });
    expect(firmWithoutType.status).toBe(400);
    const list = await read<ClientList>("ryan", "/api/mr/clients?kind=doctor&scope=mine");
    expect(list.counts.mine).toBe(3);
    expect(list.rows.find((one) => one.id === clients.doctor)?.detail).toBe("Airforce City Hospital");
    // Vanessa sees them under Team, not as hers; she can't change Ryan's.
    const hers = await read<ClientList>("vanessa", "/api/mr/clients?kind=doctor&scope=mine");
    expect(hers.counts.mine).toBe(0);
    expect(hers.counts.team).toBe(3);
    expect((await send("vanessa", `/api/mr/clients/${clients.doctor}`, { kind: "doctor", name: "X", city: "Y" })).status).toBe(403);
  });
});

describe("the MR's day", () => {
  it("plans today's visits, starts working (the day's allowances made), and refuses I'm here before an objective", async () => {
    const planned = await ok("ryan", "/api/mr/visits", { day: today(), clientIds: [clients.doctor, clients.firm, clients.doctor2] });
    const made = planned.ids as number[];
    expect(made).toHaveLength(3);
    [visits.doctor, visits.firm, visits.doctor2] = made as [number, number, number];
    // I'm here needs the day started.
    expect((await send("ryan", `/api/mr/visits/${visits.doctor}/check-in`, { place: "15.1850,120.5450" })).status).toBe(409);
    await ok("ryan", "/api/mr/day/start", { workType: "hq", cities: ["Angeles City"], place: "15.1800,120.5400" });
    expect((await send("ryan", "/api/mr/day/start", { workType: "hq", cities: ["Angeles City"] })).status).toBe(409);
    const home = await read<MrHome>("ryan", "/api/mr/home");
    expect(home.day?.workType).toBe("hq");
    expect(home.counts.planned).toBe(3);
    const [lines] = await rows<{ n: number }>(db, sql`select count(*)::int as n from mr_expense where person_id = ${ids.ryan} and auto`);
    expect(lines?.n).toBe(2);
    // No objective yet: I'm here is refused.
    expect((await send("ryan", `/api/mr/visits/${visits.doctor}/check-in`, { place: "15.1850,120.5450" })).status).toBe(400);
    await ok("ryan", `/api/mr/visits/${visits.doctor}/plan`, { objectives: ["business_call", "promotion"], objectiveNote: "New pack" });
    await ok("ryan", `/api/mr/visits/${visits.doctor}/check-in`, { place: "15.1850,120.5450" });
    // One place at a time: another check-in waits for this call to close.
    await ok("ryan", `/api/mr/visits/${visits.doctor2}/plan`, { objectives: ["thank_you_call"] });
    expect((await send("ryan", `/api/mr/visits/${visits.doctor2}/check-in`, {})).status).toBe(409);
  });

  it("books an order at the call at the client's price, and closes the call with its full record", async () => {
    // "Business generated" needs an order booked first.
    const early = await send("ryan", `/api/mr/visits/${visits.doctor}/close`, {
      meeting: "met", objectives: ["business_call"], products: [], nature: "business", outcome: "business", productive: "yes",
    });
    expect(early.status).toBe(400);
    const offer = await read<OrderForm>("ryan", `/api/mr/orders/form?client=${clients.doctor}`);
    expect(offer.rateKind).toBe("doctor");
    const priced = offer.medicines.find((one) => one.rate !== null) as OrderForm["medicines"][number];
    expect(priced).toBeTruthy();
    const booked = await form("ryan", "/api/mr/orders", {
      clientId: String(clients.doctor), visitId: String(visits.doctor),
      lines: JSON.stringify([{ medicineId: priced.id, packs: 2 }]), note: "Next week",
    });
    expect(booked.status, await booked.clone().text()).toBe(200);
    const page = await read<VisitPage>("ryan", `/api/mr/visits/${visits.doctor}`);
    const expected = priced.packRate !== null ? 2 * priced.packRate : 2 * priced.packSize * (priced.rate as number);
    expect(page.order?.amount).toBe(expected);
    expect(page.can.close).toBe(true);
    const closed = await ok("ryan", `/api/mr/visits/${visits.doctor}/close`, {
      meeting: "met", objectives: ["business_call", "promotion"], objectiveNote: "New pack",
      products: [{ medicineId: priced.id, promoted: true, samples: 2, reaction: "will_prescribe" }],
      prescribing: [{ medicineId: priced.id, prescribing: true, top5: true }],
      nature: "both", outcome: "business", productive: "yes", feedback: "Liked the new pack",
      followUp: { on: addDays(today(), 7), kind: "visit", what: "Bring the study" }, nextDay: addDays(today(), 14),
      place: "15.1851,120.5451",
    });
    expect(closed.followUpId).toBeTruthy();
    expect(closed.nextVisitId).toBeTruthy();
    const after = await read<VisitPage>("ryan", `/api/mr/visits/${visits.doctor}`);
    expect(after.visit.status).toBe("done");
    expect(after.visit.products[0]?.samples).toBe(2);
    expect(after.prescribing[0]?.top5).toBe(true);
    expect(after.visit.changes.map((one) => one.what)).toContain("closed");
    // Closed stays closed for the MR.
    expect((await send("ryan", `/api/mr/visits/${visits.doctor}/close`, { meeting: "met", objectives: ["business_call"], products: [], nature: "both", outcome: "none", productive: "yes" })).status).toBe(409);
  });

  it("closes a not-met call as not productive or not sure yet: never worked out by itself", async () => {
    await ok("ryan", `/api/mr/visits/${visits.doctor2}/check-in`, {});
    // The productive answer is required.
    const missing = await send("ryan", `/api/mr/visits/${visits.doctor2}/close`, { meeting: "not_met", objectives: ["thank_you_call"], products: [], outcome: "none" });
    expect(missing.status).toBe(400);
    await ok("ryan", `/api/mr/visits/${visits.doctor2}/close`, {
      meeting: "not_met", objectives: ["thank_you_call"], products: [], outcome: "follow_up", productive: "pending",
      followUp: { on: addDays(today(), 2), kind: "visit", what: "Try again in the morning" },
    });
  });

  it("adds a visit on the day only with why, and skips with a reason", async () => {
    expect((await send("ryan", "/api/mr/visits", { day: today(), clientIds: [clients.doctor3] })).status).toBe(400);
    const added = await ok("ryan", "/api/mr/visits", { day: today(), clientIds: [clients.doctor3], why: "Called me to come" });
    visits.doctor3 = (added.ids as number[])[0] as number;
    const page = await read<VisitPage>("ryan", `/api/mr/visits/${visits.doctor3}`);
    expect(page.visit.unplanned).toBe(true);
    expect((await send("ryan", `/api/mr/visits/${visits.firm}/skip`, { reason: "other" })).status).toBe(400);
    await ok("ryan", `/api/mr/visits/${visits.firm}/skip`, { reason: "closed", note: "Shop shut" });
  });

  it("sends the day report only with a reason for each visit not done; the open one becomes missed", async () => {
    const report = await read<DayReport>("ryan", "/api/mr/day/report");
    expect(report.visits.done).toBe(2);
    expect(report.visits.skipped).toBe(1);
    expect(report.open.map((one) => one.id)).toEqual([visits.doctor3]);
    expect(report.business.bookedAmount).toBeGreaterThan(0);
    expect(report.business.samples).toBe(2);
    expect(report.can.send).toBe(true);
    expect((await send("ryan", "/api/mr/day/report", { missed: [], note: "Good day" })).status).toBe(400);
    await ok("ryan", "/api/mr/day/report", { missed: [{ visitId: visits.doctor3, reason: "not_available" }], note: "Good day", place: "15.1800,120.5400" });
    const after = await read<DayReport>("ryan", "/api/mr/day/report");
    expect(after.visits.missed).toBe(1);
    expect(after.state?.report.status).toBe("sent");
    // The day is closed: no more check-ins.
    expect((await send("ryan", "/api/mr/day/break", { on: true })).status).toBe(409);
  });
});

describe("the team lead", () => {
  it("sees each MR's day and what waits; an MR sees only their own", async () => {
    const team = await read<TeamToday>("daniel", "/api/mr/team");
    const ryan = team.people.find((one) => one.id === ids.ryan);
    expect(ryan?.done).toBe(2);
    expect(ryan?.report).toBe("sent");
    expect(team.waiting.reports).toBe(1);
    expect(team.waiting.judge).toBe(1);
    expect(team.closed.today).toBe(2);
    expect(team.champions[0]?.id).toBe(ids.ryan);
    expect(team.feed.length).toBeGreaterThan(0);
    expect((await get("vanessa", "/api/mr/team")).status).toBe(403);
    expect((await get("vanessa", `/api/mr/visits/${visits.doctor}`)).status).toBe(403);
    expect((await get("vanessa", `/api/mr/day/report?person=${ids.ryan}`)).status).toBe(403);
    // The CEO looks, and decides nothing.
    expect((await get("naresh", `/api/mr/visits/${visits.doctor}`)).status).toBe(200);
    expect((await send("naresh", `/api/mr/visits/${visits.doctor2}/judge`, { productive: "yes" })).status).toBe(403);
  });

  it("judges a not-sure call, marks the report seen, and reopens a call for a correction", async () => {
    expect((await send("ryan", `/api/mr/visits/${visits.doctor2}/judge`, { productive: "yes" })).status).toBe(403);
    await ok("daniel", `/api/mr/visits/${visits.doctor2}/judge`, { productive: "no", note: "Not met is not productive" });
    await ok("daniel", "/api/mr/day/report/seen", { person: ids.ryan, day: today(), note: "Good" });
    expect((await send("daniel", "/api/mr/visits/0/reopen", { note: "x" })).status).toBe(404);
    expect((await send("daniel", `/api/mr/visits/${visits.doctor}/reopen`, { note: "" })).status).toBe(400);
    await ok("daniel", `/api/mr/visits/${visits.doctor}/reopen`, { note: "Feedback missing the doctor's words" });
    const page = await read<VisitPage>("ryan", `/api/mr/visits/${visits.doctor}`);
    expect(page.visit.status).toBe("planned");
    expect(page.visit.changes.map((one) => one.what)).toEqual(["closed", "reopened"]);
  });

  it("lists calls over days, and the month's attendance", async () => {
    const report = await read<{ rows: { id: number; status: string }[] }>("daniel", `/api/mr/reports/calls?from=${today()}&to=${today()}`);
    expect(report.rows.length).toBe(4);
    const attendance = await read<{ totals: { present: number } }>("daniel", `/api/mr/reports/attendance?person=${ids.ryan}`);
    expect(attendance.totals.present).toBe(1);
  });
});

describe("expenses", () => {
  it("adds a head with its bill, claims a day's allowance, and the lead approves (less) or rejects", async () => {
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
    expect((await send("ryan", `/api/mr/expenses/${snack.id}/decide`, { approve: true })).status).toBe(403);
    expect((await send("daniel", `/api/mr/expenses/${snack.id}/decide`, { approve: true, amount: 600 })).status).toBe(400);
    await ok("daniel", `/api/mr/expenses/${snack.id}/decide`, { approve: true, amount: 450 });
    expect((await send("daniel", `/api/mr/expenses/${perDiem.id}/decide`, { approve: false })).status).toBe(400);
    await ok("daniel", `/api/mr/expenses/${perDiem.id}/decide`, { approve: false, note: "No rate yet" });
    const after = await read<ExpenseMonth>("ryan", "/api/mr/expenses");
    expect(after.totals.approved).toBe(45_000);
    // Rates are set by the lead (0 until then).
    await ok("daniel", "/api/mr/expenses/rates", { rates: [{ workType: "hq", perDiem: 250, ta: 150 }] });
    expect((await send("ryan", "/api/mr/expenses/rates", { rates: [] })).status).toBe(403);
  });
});

describe("the tour plan", () => {
  it("plans a day by city, sends the month, the lead approves; after that a change is a deviation", async () => {
    const next = addDays(today(), 1);
    const nextMonth = next.slice(0, 7);
    await ok("vanessa", "/api/mr/plan/day", { day: next, workType: "ex_station", cities: ["Antipolo"] });
    await ok("vanessa", "/api/mr/visits", { day: next, clientIds: [clients.doctor3] });
    await ok("vanessa", "/api/mr/plan/send", { month: nextMonth });
    expect((await send("vanessa", "/api/mr/plan/send", { month: nextMonth })).status).toBe(409);
    const sent = await read<PlanMonth>("daniel", `/api/mr/plan?person=${ids.vanessa}&month=${nextMonth}`);
    expect(sent.plan.status).toBe("sent");
    expect(sent.can.decide).toBe(true);
    expect((await send("daniel", "/api/mr/plan/decide", { person: ids.vanessa, month: nextMonth, approve: false })).status).toBe(400);
    await ok("daniel", "/api/mr/plan/decide", { person: ids.vanessa, month: nextMonth, approve: true });
    const approved = await read<PlanMonth>("vanessa", `/api/mr/plan?month=${nextMonth}`);
    expect(approved.plan.status).toBe("approved");
    expect(approved.revisions[0]?.visits).toBe(1);
    // A change now needs why, and goes to the lead.
    const list = await read<VisitList>("vanessa", `/api/mr/visits?kind=doctor&day=${next}`);
    const visit = list.rows[0] as VisitList["rows"][number];
    expect((await send("vanessa", `/api/mr/visits/${visit.id}/move`, { day: addDays(next, 1) })).status).toBe(400);
    await ok("vanessa", `/api/mr/visits/${visit.id}/move`, { day: addDays(next, 1), why: "Doctor asked for Friday" });
    const waiting = await read<{ rows: { id: number; kind: string }[] }>("daniel", "/api/mr/deviations");
    expect(waiting.rows.map((one) => one.kind)).toContain("moved");
    await ok("daniel", `/api/mr/deviations/${waiting.rows[0]?.id}`, { approve: true });
    expect((await read<{ rows: unknown[] }>("daniel", "/api/mr/deviations")).rows).toHaveLength(0);
  });
});
