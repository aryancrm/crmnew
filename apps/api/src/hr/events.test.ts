// HR's trail: every change to a person's HR record is written down with who made it, pay and
// government numbers only as "changed", read by HR, the CEO and the Admin, and in the Audit.

import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase } from "../db/index";
import { migrate } from "../db/migrate";
import { seedDemo } from "../seed";
import type { AuditTrail, HrHistory, HrPeople, HrPerson, Me } from "../types";
import { changeSentence, changesOf } from "./events";

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

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["helen", "naresh", "admin", "daniel", "ryan", "marco"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
    ids[name] = ((await response.json()) as { me: Me }).me.id;
  }
});

describe("the changes worked out", () => {
  it("keeps only what changed, and hides pay, bank, government numbers and the birth date", () => {
    const changes = changesOf(
      { position: "Hospital CHC", department: null, salary: 2_000_000, sss: "34-1", noTax: false, mobile: "0917" },
      { position: "Senior CHC", department: "Sales", salary: 2_200_000, sss: "34-1", noTax: true, mobile: "0917" },
    );
    expect(changes).toEqual([
      { field: "position", label: "Position", from: "Hospital CHC", to: "Senior CHC", hidden: false },
      { field: "department", label: "Department", from: null, to: "Sales", hidden: false },
      { field: "salary", label: "Monthly salary", from: null, to: null, hidden: true },
      { field: "noTax", label: "Not taxed", from: "No", to: "Yes", hidden: false },
    ]);
    expect(changeSentence(changes)).toBe("Position, Department, Monthly salary and 1 more changed");
    expect(changeSentence(changes.slice(0, 2))).toBe("Position, Department changed");
  });
});

describe("HR's trail", () => {
  it("writes down a record change, field by field, with who made it", async () => {
    const ryan = ids.ryan as number;
    const saved = await send(
      "helen",
      `/api/hr/people/${ryan}`,
      { position: "Senior Hospital CHC", salary: 3_100_000, tin: "123-456-789" },
      "PATCH",
    );
    expect(saved.status).toBe(200);
    const trail = await read<HrHistory>("helen", `/api/hr/people/${ryan}/history`);
    const line = trail.lines[0];
    expect(line).toMatchObject({ by: "Helen", kind: "record" });
    expect(line?.what).toBe("Position, Monthly salary, TIN changed");
    expect(line?.changes.find((one) => one.field === "position")).toMatchObject({
      to: "Senior Hospital CHC",
      hidden: false,
    });
    for (const field of ["salary", "tin"])
      expect(line?.changes.find((one) => one.field === field)).toMatchObject({ from: null, to: null, hidden: true });
    // Nothing secret anywhere in what is kept.
    expect(JSON.stringify(trail)).not.toContain("3100000");
    expect(JSON.stringify(trail)).not.toContain("123-456-789");
  });

  it("writes nothing when nothing changed", async () => {
    const ryan = ids.ryan as number;
    const before = (await read<HrHistory>("helen", `/api/hr/people/${ryan}/history`)).lines.length;
    await send("helen", `/api/hr/people/${ryan}`, { position: "Senior Hospital CHC" }, "PATCH");
    expect((await read<HrHistory>("helen", `/api/hr/people/${ryan}/history`)).lines).toHaveLength(before);
  });

  it("writes down a one-time password given, leaving and coming back", async () => {
    const marco = ids.marco as number;
    expect((await send("helen", `/api/hr/people/${marco}/login`, { password: "given-by-hr-2" })).status).toBe(200);
    expect((await send("helen", `/api/hr/people/${marco}/left`, { reason: "Resigned" })).status).toBe(200);
    expect((await send("helen", `/api/hr/people/${marco}/back`)).status).toBe(200);
    const trail = await read<HrHistory>("helen", `/api/hr/people/${marco}/history`);
    expect(trail.lines.map((one) => one.kind)).toEqual(["back", "left", "login"]);
    expect(trail.lines[1]?.what).toMatch(/^Marked as left \(last day \d{4}-\d{2}-\d{2}\): Resigned$/);
    expect(trail.lines[2]?.what).toBe("One-time password given");
    expect(JSON.stringify(trail)).not.toContain("given-by-hr-2");
  });

  it("is read by HR, the CEO and the Admin only, never while looking as someone", async () => {
    const ryan = ids.ryan as number;
    for (const who of ["naresh", "admin"]) expect((await get(who, `/api/hr/people/${ryan}/history`)).status).toBe(200);
    for (const who of ["daniel", "ryan"]) expect((await get(who, `/api/hr/people/${ryan}/history`)).status).toBe(403);
    expect((await get("helen", "/api/hr/people/999999/history")).status).toBe(404);
  });

  it("shows in the Audit as HR records", async () => {
    const audit = await read<AuditTrail>("admin", "/api/audit?kind=hr");
    expect(audit.kinds.map((one) => one.key)).toContain("hr");
    expect(audit.lines.length).toBeGreaterThanOrEqual(4);
    expect(audit.lines.every((one) => one.kind === "hr")).toBe(true);
    expect(audit.lines.find((one) => one.what.startsWith("Position"))).toMatchObject({
      who: "Helen",
      record: "Ryan",
      link: `/hr/people/${ids.ryan}`,
    });
  });

  it("makes the job history from the trail: the person sees their own, pay only as changed", async () => {
    const ryan = ids.ryan as number;
    for (const who of ["helen", "ryan"]) {
      const person = await read<HrPerson>(who, `/api/hr/people/${ryan}`);
      expect(person.career[0]?.what).toMatch(/^Position: .+ → Senior Hospital CHC; Monthly salary changed$/);
      // The TIN isn't part of a working life.
      expect(JSON.stringify(person.career)).not.toContain("TIN");
    }
    const marco = await read<HrPerson>("helen", `/api/hr/people/${ids.marco}`);
    expect(marco.career.map((one) => one.what.split(" ")[0])).toEqual(["Back", "Marked"]);
  });

  it("is in the people list's records too: nothing else changed", async () => {
    const list = await read<HrPeople>("helen", "/api/hr/people");
    expect(list.rows.find((one) => one.name === "Ryan")).toBeTruthy();
  });
});
