// Signatures and printouts, step 3 of docs/HR-PLAN.md: each person draws their signature (a PNG,
// replaced by drawing again, the old one archived and kept); an approved leave or form prints with
// the signers' signatures, each box filled only once that person signed or decided; the person,
// whom it went to, their leads, HR, the CEO and the Admin open a printout, nobody else.

import { sql } from "drizzle-orm";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { addDays, todayManila } from "../inventory/rules";
import { seedDemo } from "../seed";
import type { Me, MySignature, Printout } from "../types";
import { DEFAULT_SCHEDULE, isWorkDay } from "./work-time";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
const ids: Record<string, number> = {};
const soon: string[] = [];

const get = (who: string, path: string) =>
  app.request(path, { headers: { cookie: cookies[who] as string } });
const read = async <T>(who: string, path: string) => (await (await get(who, path)).json()) as T;
const send = (who: string, path: string, body: unknown = {}) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookies[who] as string },
    body: JSON.stringify(body),
  });
const drawing = (shade: number) =>
  sharp({ create: { width: 40, height: 16, channels: 4, background: { r: shade, g: 0, b: 0, alpha: 1 } } })
    .png()
    .toBuffer();
const sign = async (who: string, bytes: Uint8Array<ArrayBuffer>, type = "image/png") => {
  const body = new FormData();
  body.set("file", new File([bytes], "signature.png", { type }));
  return app.request("/api/hr/signature", { method: "POST", headers: { cookie: cookies[who] as string }, body });
};

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["ryan", "daniel", "naresh", "helen", "admin", "jane", "irene", "sarla"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
    ids[name] = ((await response.json()) as { me: Me }).me.id;
  }
  const holidays = new Set(
    (await rows<{ day: string }>(db, sql`select to_char(day, 'YYYY-MM-DD') as day from holiday`)).map(
      (one) => one.day,
    ),
  );
  for (let at = addDays(todayManila(), 1); soon.length < 3; at = addDays(at, 1))
    if (isWorkDay(at, DEFAULT_SCHEDULE, holidays)) soon.push(at);
});

describe("signatures", () => {
  it("are drawn once, replaced by drawing again; the old one is archived, never deleted", async () => {
    expect((await read<MySignature>("ryan", "/api/hr/signature")).signature).toBeNull();
    expect((await sign("ryan", new Uint8Array([1, 2, 3]))).status).toBe(400);
    expect((await sign("ryan", new Uint8Array(await drawing(10)), "image/jpeg")).status).toBe(400);
    expect((await sign("ryan", new Uint8Array(await drawing(10)))).status).toBe(200);
    const first = (await read<MySignature>("ryan", "/api/hr/signature")).signature;
    expect(first?.image).toMatch(/^data:image\/(png|webp);base64,/);
    expect((await sign("ryan", new Uint8Array(await drawing(200)))).status).toBe(200);
    const second = (await read<MySignature>("ryan", "/api/hr/signature")).signature;
    expect(second?.id).not.toBe(first?.id);
    const kept = await rows<{ archived: boolean }>(
      db,
      sql`select archived_at is not null as archived from person_signature where person_id = ${ids.ryan} order by id`,
    );
    expect(kept).toEqual([{ archived: true }, { archived: false }]);
  });
});

describe("printouts", () => {
  let leaveId = 0;
  it("open for an approved leave only, to the person, the approver, HR, the CEO and the Admin", async () => {
    const body = new FormData();
    for (const [key, value] of Object.entries({ kind: "lwop", from: soon[0] as string, to: soon[0] as string, reason: "Errand" }))
      body.set(key, value);
    const asked = await app.request("/api/hr/leave/request", { method: "POST", headers: { cookie: cookies.ryan as string }, body });
    leaveId = ((await asked.json()) as { id: number }).id;
    expect((await get("ryan", `/api/hr/print/leave/${leaveId}`)).status).toBe(409);
    expect((await send("daniel", `/api/hr/leave/${leaveId}/decide`, { approve: true })).status).toBe(200);
    for (const who of ["ryan", "daniel", "helen", "naresh", "admin"])
      expect((await get(who, `/api/hr/print/leave/${leaveId}`)).status).toBe(200);
    for (const who of ["jane", "irene", "sarla"])
      expect((await get(who, `/api/hr/print/leave/${leaveId}`)).status).toBe(403);
    expect((await get("helen", "/api/hr/print/leave/999999")).status).toBe(404);
  });

  it("fill each box once its signer signed or decided, with the signature in force", async () => {
    let paper = await read<Printout>("helen", `/api/hr/print/leave/${leaveId}`);
    expect(paper).toMatchObject({ title: "Application for Leave", status: "Approved", person: { name: "Ryan" } });
    expect(paper.fields.find((one) => one.label === "Reason")?.value).toBe("Errand");
    const box = (name: string) => paper.signers.find((one) => one.box === name);
    expect(box("Employee")).toMatchObject({ name: "Ryan" });
    expect(box("Employee")?.image).toMatch(/^data:image/);
    // Daniel decided but has drawn no signature yet: his name, no picture; HR never acted.
    expect(box("Immediate superior")).toMatchObject({ name: "Daniel", image: null });
    expect(box("Immediate superior")?.at).not.toBeNull();
    expect(box("Human Resources")).toMatchObject({ name: null, at: null, image: null });
    // Drawn afterwards, it shows (the first one drawn after deciding).
    expect((await sign("daniel", new Uint8Array(await drawing(90)))).status).toBe(200);
    paper = await read<Printout>("ryan", `/api/hr/print/leave/${leaveId}`);
    expect(box("Immediate superior")?.image).toMatch(/^data:image/);
  });

  it("print a form with its signers: Head Requisition signed by the lead, approved by HR", async () => {
    const made = await send("daniel", "/api/hr/forms", {
      kind: "ot",
      day: soon[1],
      from: "18:00",
      to: "23:00",
      reason: "Inventory count",
      forPersonId: ids.ryan,
    });
    const { id } = (await made.json()) as { id: number };
    expect((await get("ryan", `/api/hr/print/form/${id}`)).status).toBe(409);
    expect((await send("helen", `/api/hr/forms/${id}/decide`, { approve: true })).status).toBe(200);
    for (const who of ["ryan", "daniel", "helen", "naresh", "admin"])
      expect((await get(who, `/api/hr/print/form/${id}`)).status).toBe(200);
    expect((await get("jane", `/api/hr/print/form/${id}`)).status).toBe(403);
    const paper = await read<Printout>("ryan", `/api/hr/print/form/${id}`);
    expect(paper.title).toBe("Overtime Requisition Form");
    expect(paper.fields).toEqual(
      expect.arrayContaining([
        { label: "Type of overtime", value: "Regular day" },
        { label: "Total hours", value: "5h (4h regular, 1h night differential)" },
        { label: "Filed by (Head Requisition)", value: "Daniel" },
      ]),
    );
    const box = (name: string) => paper.signers.find((one) => one.box === name);
    expect(box("Employee")).toMatchObject({ name: "Daniel" });
    expect(box("Employee")?.image).toMatch(/^data:image/);
    expect(box("Immediate superior")).toMatchObject({ name: "Daniel" });
    // Helen decided without a signature drawn: her name and when, no picture.
    expect(box("Human Resources")).toMatchObject({ name: "Helen", image: null });
  });
});
