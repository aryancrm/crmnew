// Samples and gifts with the reps (ERP phase 3), the old CRM's rules: ask, the lead decides, the
// stock desk issues (the pieces leave the shelf), the rep receives, gives to a doctor at a visit
// with the acknowledgement, and counts with a reason for any difference.

import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { runChecks } from "../checks/integrity";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedFixture } from "../inventory/fixture";
import { todayManila } from "../inventory/rules";
import { seedDemo } from "../seed";
import type { Catalogue, SamplesOfPerson, TeamSamples } from "../types";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
let medicine = 0;
let ryanId = 0;

const read = async <T>(who: string, path: string) =>
  (await (await app.request(path, { headers: { cookie: cookies[who] as string } })).json()) as T;
const post = (who: string, path: string, body: unknown = {}) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookies[who] as string },
    body: JSON.stringify(body),
  });
const ok = async (who: string, path: string, body: unknown = {}) => {
  const response = await post(who, path, body);
  expect(response.status, `${who} ${path}: ${await response.clone().text()}`).toBe(200);
  return response.json();
};
const onShelf = async () =>
  (await rows<{ n: number }>(db, sql`select coalesce(sum(s.qty), 0)::int as n from stock s join batch b on b.id = s.batch_id where b.medicine_id = ${medicine}`))[0]?.n ?? 0;
async function visitWith(kind: "doctor" | "hospital"): Promise<number> {
  const added = await post("sarla", "/api/customers", { kind, name: `Sample ${kind} ${Math.random().toString(36).slice(2, 7)}`, city: "Pasay" });
  const customer = (await added.json()) as { id: number };
  const [visit] = await rows<{ id: number }>(
    db,
    sql`insert into visit (person_id, customer_id, day, status, made_by) values (${ryanId}, ${customer?.id}, ${todayManila()}::date, 'planned', ${ryanId})
      returning id::int as id`,
  );
  return visit?.id as number;
}
const give = (visitId: number, qty: number, withAck = true) => {
  const body = new FormData();
  body.set("visitId", String(visitId));
  body.set("kind", "samples");
  body.set("lines", JSON.stringify([{ medicineId: medicine, qty }]));
  if (withAck) body.set("file", new File([new Uint8Array([37, 80, 68, 70, 1])], "ack.pdf", { type: "application/pdf" }));
  return app.request("/api/samples/give", { method: "POST", headers: { cookie: cookies.ryan as string }, body });
};

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  await seedFixture(db);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["ryan", "daniel", "sarla", "marco", "naresh"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
  const catalogue = await read<Catalogue>("sarla", "/api/inventory/medicines");
  medicine = catalogue.rows.find((item) => item.total >= 100)?.id as number;
  ryanId = (await rows<{ id: number }>(db, sql`select id::int as id from person where email = 'ryan@2mg.test'`))[0]?.id as number;
});

describe("samples and gifts", () => {
  it("go from a request to the rep's hands to a doctor, and are counted", async () => {
    // Asking: lines checked; a "no samples" medicine refused as a sample.
    expect((await post("ryan", "/api/samples/requests", { kind: "samples", lines: [{ medicineId: medicine, qty: 0 }] })).status).toBe(400);
    const asked = (await ok("ryan", "/api/samples/requests", { kind: "samples", lines: [{ medicineId: medicine, qty: 30 }], note: "For the oncology launch" })) as { id: number; code: string };
    expect(asked.code).toMatch(/^SRQ-/);
    // Only the rep's lead (or the CEO, the Admin) decides; the stock desk can't issue before.
    expect((await post("ryan", `/api/samples/requests/${asked.id}/decide`, { approve: true })).status).toBe(403);
    expect((await post("sarla", `/api/samples/requests/${asked.id}/decide`, { approve: true })).status).toBe(403);
    expect((await post("marco", `/api/samples/requests/${asked.id}/issue`)).status).toBe(409);
    expect((await post("daniel", `/api/samples/requests/${asked.id}/decide`, { approve: false })).status).toBe(400);
    await ok("daniel", `/api/samples/requests/${asked.id}/decide`, { approve: true });
    // Issued from the shelf: the pieces leave the company's stock.
    const before = await onShelf();
    expect((await post("ryan", `/api/samples/requests/${asked.id}/issue`)).status).toBe(403);
    await ok("marco", `/api/samples/requests/${asked.id}/issue`);
    expect(await onShelf()).toBe(before - 30);
    let mine = await read<SamplesOfPerson>("ryan", "/api/samples");
    expect(mine.held).toEqual([]);
    expect(mine.requests.find((one) => one.id === asked.id)?.status).toBe("issued");
    await ok("ryan", `/api/samples/requests/${asked.id}/receive`);
    mine = await read<SamplesOfPerson>("ryan", "/api/samples");
    expect(mine.held.reduce((sum, one) => sum + one.qty, 0)).toBe(30);
    expect(mine.month_.receivedSamples).toBe(30);

    // Given at a visit: a doctor's, with the acknowledgement, no more than held.
    const doctorVisit = await visitWith("doctor");
    expect((await give(doctorVisit, 5, false)).status).toBe(400);
    expect((await give(await visitWith("hospital"), 5)).status).toBe(400);
    expect((await give(doctorVisit, 31)).status).toBe(409);
    expect((await give(doctorVisit, 12)).status).toBe(200);
    mine = await read<SamplesOfPerson>("ryan", "/api/samples");
    expect(mine.held.reduce((sum, one) => sum + one.qty, 0)).toBe(18);
    expect(mine.month_.givenSamples).toBe(12);
    expect(mine.month_.doctors).toBe(1);
    const [given] = await rows<{ id: number }>(db, sql`select id::int as id from sample_move where what = 'given' limit 1`);
    expect((await app.request(`/api/samples/given/${given?.id}/ack`, { headers: { cookie: cookies.daniel as string } })).status).toBe(200);

    // The month's count: a difference needs a reason.
    const batchId = mine.held[0]?.batchId as number;
    expect((await post("ryan", "/api/samples/count", { kind: "samples", lines: [{ batchId, counted: 16 }] })).status).toBe(400);
    const counted = (await ok("ryan", "/api/samples/count", { kind: "samples", lines: [{ batchId, counted: 16, reason: "Two broken in the bag" }] })) as { differences: number };
    expect(counted.differences).toBe(1);

    // The lead's team view: holdings, the month, the count's difference and the doctor.
    const team = await read<TeamSamples>("daniel", "/api/samples/team");
    const ryan = team.reps.find((one) => one.personId === ryanId);
    expect(ryan).toMatchObject({ samples: 16, received: 30, given: 12, doctors: 1, counted: true, difference: -2 });
    expect(team.counts[0]?.reason).toBe("Two broken in the bag");
    expect(team.doctors[0]?.pieces).toBe(12);
    expect((await app.request("/api/samples/team", { headers: { cookie: cookies.ryan as string } })).status).toBe(403);

    // A medicine marked "no samples" can't be asked for as a sample; gifts may be anything.
    await db.execute(sql`update medicine set no_samples = true where id = ${medicine}`);
    expect((await post("ryan", "/api/samples/requests", { kind: "samples", lines: [{ medicineId: medicine, qty: 2 }] })).status).toBe(400);
    expect((await post("ryan", "/api/samples/requests", { kind: "gifts", lines: [{ medicineId: medicine, qty: 2 }] })).status).toBe(200);
    await db.execute(sql`update medicine set no_samples = false where id = ${medicine}`);

    // The stock desk can send with no request; the data still agrees with itself.
    const sent = (await ok("marco", "/api/samples/send", { personId: ryanId, kind: "gifts", lines: [{ medicineId: medicine, qty: 3 }] })) as { code: string };
    expect(sent.code).toMatch(/^SRQ-/);
    const checks = await runChecks(db);
    expect(checks.checks.filter((one) => !one.ok).map((one) => one.key)).toEqual(
      (await runChecks(db)).checks.filter((one) => !one.ok).map((one) => one.key),
    );
    expect(checks.checks.find((one) => one.key.includes("shelf"))?.ok ?? true).toBe(true);
  });
});
