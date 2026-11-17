// Complaints and side-effects: anyone reports, Regulatory/Management handle to a due day, closed with
// the outcome; a serious side-effect is due in 15 days and the CEO is told.

import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedFixture } from "../inventory/fixture";
import { todayManila } from "../inventory/rules";
import { seedDemo } from "../seed";
import type { AuditTrail, Catalogue, ComplaintList } from "../types";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
const read = async <T>(who: string, path: string) => (await (await app.request(path, { headers: { cookie: cookies[who] as string } })).json()) as T;
const post = (who: string, path: string, body: unknown = {}) =>
  app.request(path, { method: "POST", headers: { "content-type": "application/json", cookie: cookies[who] as string }, body: JSON.stringify(body) });

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  await seedFixture(db);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["ryan", "sarla", "naresh"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
});

describe("complaints and side-effects", () => {
  it("go from a report to a closed case with its outcome", async () => {
    const catalogue = await read<Catalogue>("sarla", "/api/inventory/medicines");
    const medicineId = catalogue.rows[0]?.id;
    expect((await post("ryan", "/api/complaints", { kind: "side_effect", description: "Rash after the second dose" })).status).toBe(400);
    const made = await post("ryan", "/api/complaints", { kind: "side_effect", serious: true, medicineId, batchNo: "LZ-1", patientName: "Maria", description: "Hospitalised after the second dose" });
    expect(made.status, await made.clone().text()).toBe(200);
    const { id, code } = (await made.json()) as { id: number; code: string };
    expect(code).toMatch(/^CMP-/);
    const mine = await read<ComplaintList>("ryan", "/api/complaints");
    const row = mine.rows.find((one) => one.id === id);
    expect(row?.serious).toBe(true);
    expect(row?.dueOn).toBe(new Date(Date.parse(`${todayManila()}T00:00:00Z`) + 15 * 86_400_000).toISOString().slice(0, 10));
    expect(mine.can.handle).toBe(false);
    // The CEO is told of a serious side-effect.
    const [told] = await rows<{ n: number }>(db, sql`select count(*)::int as n from notification n join person p on p.id = n.person_id where p.email = 'naresh@2mg.test' and n.kind = 'complaint'`);
    expect(told?.n).toBe(1);
    // Only the handlers move it; closing needs the outcome.
    expect((await post("ryan", `/api/complaints/${id}`, { status: "investigating" })).status).toBe(403);
    expect((await post("sarla", `/api/complaints/${id}`, { status: "investigating", note: "Asked the hospital for the chart" })).status).toBe(200);
    expect((await post("sarla", `/api/complaints/${id}`, { status: "closed" })).status).toBe(400);
    expect((await post("sarla", `/api/complaints/${id}`, { fdaRef: "FDA-ADR-2026-11", status: "closed", outcome: "Reported to the FDA; batch checked, no fault found" })).status).toBe(200);
    const all = await read<ComplaintList>("sarla", "/api/complaints?view=closed");
    const closed = all.rows.find((one) => one.id === id);
    expect(closed).toMatchObject({ status: "closed", fdaRef: "FDA-ADR-2026-11" });
    expect(closed?.events.length).toBe(3);
    // In the audit.
    const trail = await read<AuditTrail>("naresh", "/api/audit?kind=complaint");
    expect(trail.lines.some((one) => one.record === code)).toBe(true);
  });
});
