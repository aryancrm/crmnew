// HR's list of positions and the record's new fields: a position is one of the list (or a seat's
// title HR hasn't archived), HR keeps the list, archived ones are never deleted; gender, civil
// status, family, education, work arrangement, company phone, equipment, job description.

import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase } from "../db/index";
import { migrate } from "../db/migrate";
import { seedDemo } from "../seed";
import type { HrHistory, HrPerson, HrPositions, Me } from "../types";

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
  for (const name of ["helen", "naresh", "admin", "daniel", "ryan"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
    ids[name] = ((await response.json()) as { me: Me }).me.id;
  }
});

describe("HR's positions", () => {
  it("starts from the company tree's seat titles, and counts who holds each", async () => {
    const list = await read<HrPositions>("helen", "/api/hr/positions");
    expect(list.can.change).toBe(true);
    expect(list.positions.length).toBeGreaterThan(3);
    expect(list.positions.every((one) => !one.archived)).toBe(true);
    expect((await read<HrPositions>("naresh", "/api/hr/positions")).can.change).toBe(false);
    for (const who of ["daniel", "ryan"]) expect((await get(who, "/api/hr/positions")).status).toBe(403);
  });

  it("refuses a position not on the list; takes it once HR adds it", async () => {
    const ryan = ids.ryan as number;
    const refused = await send("helen", `/api/hr/people/${ryan}`, { position: "Hospital CHC Sr" }, "PATCH");
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { error: { field: string } }).error.field).toBe("position");
    expect((await send("helen", "/api/hr/positions", { name: " Hospital  CHC Sr " })).status).toBe(200);
    expect((await send("helen", "/api/hr/positions", { name: "hospital chc sr" })).status).toBe(409);
    expect((await send("naresh", "/api/hr/positions", { name: "Chief" })).status).toBe(403);
    expect((await send("helen", `/api/hr/people/${ryan}`, { position: "Hospital CHC Sr" }, "PATCH")).status).toBe(200);
  });

  it("an archived position isn't given any more, but records that say it keep it", async () => {
    const list = await read<HrPositions>("helen", "/api/hr/positions");
    const sr = list.positions.find((one) => one.name === "Hospital CHC Sr");
    expect(sr?.people).toBe(1);
    expect((await send("helen", `/api/hr/positions/${sr?.id}`, { archived: true })).status).toBe(200);
    expect((await send("helen", `/api/hr/positions/${sr?.id}`, { archived: true })).status).toBe(404);
    const daniel = ids.daniel as number;
    expect((await send("helen", `/api/hr/people/${daniel}`, { position: "Hospital CHC Sr" }, "PATCH")).status).toBe(400);
    // Ryan's record still says it, and saving something else doesn't trip on it.
    const ryan = ids.ryan as number;
    expect((await read<HrPerson>("helen", `/api/hr/people/${ryan}`)).record.position).toBe("Hospital CHC Sr");
    expect((await send("helen", `/api/hr/people/${ryan}`, { position: "Hospital CHC Sr", mobile: "0917 555 0199" }, "PATCH")).status).toBe(200);
    // Archived ones go last.
    const after = await read<HrPositions>("helen", "/api/hr/positions");
    expect(after.positions.at(-1)).toMatchObject({ name: "Hospital CHC Sr", archived: true });
    expect((await send("helen", `/api/hr/positions/${sr?.id}`, { archived: false })).status).toBe(200);
  });
});

describe("the record's new fields", () => {
  it("are kept, checked, read back and written in the trail", async () => {
    const ryan = ids.ryan as number;
    const fields = {
      gender: "male",
      civilStatus: "married",
      citizenship: "Filipino",
      spouseName: "Ana Cruz",
      fatherName: "Jose Cruz",
      motherName: "Maria Cruz",
      education: "College",
      school: "UST",
      course: "BS Pharmacy",
      workArrangement: "field",
      companyPhone: "0917 555 0102",
      issuedEquipment: "Laptop, company phone",
      jobDescription: "Visits hospitals in Pasay.",
    };
    expect((await send("helen", `/api/hr/people/${ryan}`, fields, "PATCH")).status).toBe(200);
    expect((await read<HrPerson>("helen", `/api/hr/people/${ryan}`)).record).toMatchObject(fields);
    expect((await read<HrPerson>("ryan", `/api/hr/people/${ryan}`)).record).toMatchObject(fields);
    const trail = await read<HrHistory>("helen", `/api/hr/people/${ryan}/history`);
    expect(trail.lines[0]?.what).toBe("Gender, Civil status, Citizenship and 10 more changed");
    expect(trail.lines[0]?.changes.find((one) => one.field === "workArrangement")).toMatchObject({ to: "Field" });
    for (const [field, value] of [
      ["gender", "other"],
      ["civilStatus", "complicated"],
      ["workArrangement", "beach"],
      ["companyPhone", "call me"],
      ["jobDescription", "x".repeat(2001)],
    ] as const)
      expect((await send("helen", `/api/hr/people/${ryan}`, { [field]: value }, "PATCH")).status).toBe(400);
    expect((await send("daniel", `/api/hr/people/${ryan}`, { gender: "female" }, "PATCH")).status).toBe(403);
  });
});
