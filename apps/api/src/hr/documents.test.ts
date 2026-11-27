// HR's documents: numbered by kind and year, on the employer's letterhead, kept as issued, never
// deleted (voided with the reason); memos acknowledged and notices answered by the person; a
// clearance signed desk by desk, HR last.
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedDemo } from "../seed";
import type { HrDocList, HrDocPage, Me, MyDocuments, Printout } from "../types";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
const ids: Record<string, number> = {};

const get = (who: string, path: string) => app.request(path, { headers: { cookie: cookies[who] as string } });
const read = async <T>(who: string, path: string) => (await (await get(who, path)).json()) as T;
const send = (who: string, path: string, body: unknown = {}) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookies[who] as string },
    body: JSON.stringify(body),
  });
const year = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }).slice(0, 4);

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["helen", "ryan", "daniel", "fiona", "irene", "admin", "sarla"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
    ids[name] = ((await response.json()) as { me: Me }).me.id;
  }
  await db.execute(sql`update employee set position = 'Medical Representative', salary = 2500000, allowance = 300000,
    hire_date = '2025-03-01', classification = 'regular', company = 'gpi' where person_id = ${ids.ryan}`);
});

describe("HR's documents", () => {
  it("a person's page knows who they are before they have any document", async () => {
    const empty = await read<HrDocList>("helen", `/api/hr/documents?person=${ids.daniel}`);
    expect(empty.rows).toEqual([]);
    expect(empty.person).toMatchObject({ id: ids.daniel, name: "Daniel", active: true });
    expect((await get("helen", "/api/hr/documents?person=999999")).status).toBe(404);
  });

  it("a certificate of employment: numbered, on the company's own letterhead, kept as issued", async () => {
    expect((await send("helen", "/api/hr/documents", { kind: "coe", personId: ids.ryan })).status).toBe(400);
    const first = (await (await send("helen", "/api/hr/documents", { kind: "coe", personId: ids.ryan, subject: "a bank loan" })).json()) as { id: number; code: string };
    const second = (await (await send("helen", "/api/hr/documents", { kind: "coe_pay", personId: ids.ryan, subject: "a visa" })).json()) as { id: number; code: string };
    expect(first.code).toBe(`COE-${year}-00001`);
    expect(second.code).toBe(`COE-${year}-00002`);
    const paper = await read<HrDocPage>("helen", `/api/hr/documents/${first.id}`);
    // One company per database since the separation (26 Nov night): a record still marked GPI is
    // the company's own; its name comes from its Company details.
    expect(paper.letterhead.name).toBe("2MG Inc.");
    expect(paper.paragraphs.join(" ")).toMatch(/Ryan has been employed by 2MG Inc\. as Medical Representative since March 1, 2025, and is a regular employee/);
    expect(paper.paragraphs.join(" ")).not.toMatch(/₱/);
    expect(paper.paragraphs.join(" ")).toMatch(/for a bank loan/);
    // With the pay; and a later raise doesn't change the paper already issued.
    await db.execute(sql`update employee set salary = 9900000 where person_id = ${ids.ryan}`);
    const paid = await read<HrDocPage>("helen", `/api/hr/documents/${second.id}`);
    expect(paid.paragraphs.join(" ")).toMatch(/₱25,000\.00 and a monthly allowance of ₱3,000\.00/);
    // The person reads their own; a colleague doesn't; a seller can't issue.
    expect((await get("ryan", `/api/hr/documents/${first.id}`)).status).toBe(200);
    expect((await get("sarla", `/api/hr/documents/${first.id}`)).status).toBe(403);
    expect((await send("ryan", "/api/hr/documents", { kind: "coe", personId: ids.ryan, subject: "x" })).status).toBe(403);
    // Voided with the reason, never deleted.
    expect((await send("helen", `/api/hr/documents/${first.id}/void`, {})).status).toBe(400);
    expect((await send("helen", `/api/hr/documents/${first.id}/void`, { reason: "wrong purpose" })).status).toBe(200);
    const list = await read<HrDocList>("helen", `/api/hr/documents?person=${ids.ryan}`);
    expect(list.rows.find((one) => one.id === first.id)?.status).toBe("void");
    const trail = await rows<{ what: string }>(db, sql`select what from hr_event where person_id = ${ids.ryan} and kind = 'document' order by id`);
    expect(trail.map((one) => one.what).join(" | ")).toMatch(/COE-\d{4}-00001 issued.*COE-\d{4}-00001 voided: wrong purpose/);
  });

  it("a notice to explain: the person acknowledges and answers it; HR hears", async () => {
    const made = (await (
      await send("helen", "/api/hr/documents", { kind: "nte", personId: ids.ryan, subject: "Late three times", body: "You came in late on three days.\n\nPlease explain." })
    ).json()) as { id: number; code: string };
    expect(made.code).toBe(`NTE-${year}-00001`);
    expect((await read<MyDocuments>("ryan", "/api/hr/documents/mine")).rows.map((one) => one.id)).toContain(made.id);
    expect((await send("helen", `/api/hr/documents/${made.id}/acknowledge`, {})).status).toBe(403);
    expect((await send("ryan", `/api/hr/documents/${made.id}/acknowledge`, {})).status).toBe(200);
    expect((await send("ryan", `/api/hr/documents/${made.id}/acknowledge`, { reply: "Traffic on EDSA." })).status).toBe(200);
    const paper = await read<HrDocPage>("helen", `/api/hr/documents/${made.id}`);
    expect(paper.status).toBe("answered");
    expect(paper.reply?.text).toBe("Traffic on EDSA.");
    expect(paper.paragraphs).toHaveLength(3);
    expect(paper.signers.map((one) => one.box)).toEqual(["Issued by", "Received by"]);
    const told = await rows<{ title: string }>(db, sql`select title from notification where person_id = ${ids.helen} and kind = 'hr_document'`);
    expect(told.map((one) => one.title)).toContain(`Ryan answered ${made.code}`);
  });

  it("a clearance: each desk signs its own part, HR last; one open clearance a person", async () => {
    const made = (await (await send("helen", "/api/hr/documents", { kind: "clearance", personId: ids.ryan })).json()) as { id: number };
    expect((await send("helen", "/api/hr/documents", { kind: "clearance", personId: ids.ryan })).status).toBe(409);
    const desks = (await read<HrDocPage>("helen", `/api/hr/documents/${made.id}`)).clearance?.map((one) => one.desk);
    expect(desks).toEqual(["lead", "finance", "inventory", "admin", "hr"]);
    expect((await read<MyDocuments>("fiona", "/api/hr/documents/mine")).toSign.map((one) => one.id)).toContain(made.id);
    expect((await send("helen", `/api/hr/documents/${made.id}/sign`, { desk: "hr" })).status).toBe(403);
    expect((await send("fiona", `/api/hr/documents/${made.id}/sign`, { desk: "inventory" })).status).toBe(403);
    expect((await send("fiona", `/api/hr/documents/${made.id}/sign`, { desk: "finance", note: "No cash advance left" })).status).toBe(200);
    expect((await send("irene", `/api/hr/documents/${made.id}/sign`, { desk: "inventory" })).status).toBe(200);
    expect((await send("admin", `/api/hr/documents/${made.id}/sign`, { desk: "admin" })).status).toBe(200);
    expect((await send("daniel", `/api/hr/documents/${made.id}/sign`, { desk: "lead" })).status).toBe(200);
    expect((await send("helen", `/api/hr/documents/${made.id}/sign`, { desk: "hr" })).status).toBe(200);
    const paper = await read<HrDocPage>("ryan", `/api/hr/documents/${made.id}`);
    expect(paper.status).toBe("cleared");
    expect(paper.clearance?.find((one) => one.desk === "finance")?.note).toBe("No cash advance left");
    expect(paper.code).toBe(`CLR-${year}-00001`);
  });

  it("leave and form printouts carry a number and the company's own letterhead", async () => {
    // Another company's details kept here before the separation are never printed (26 Nov night).
    await db.execute(sql`insert into setting (key, value, updated_by) values ('company:gpi', ${JSON.stringify({ address: "Elsewhere", tin: "999-999-999-999" })}::jsonb, ${ids.admin})`);
    await db.execute(sql`insert into setting (key, value, updated_by) values ('company', ${JSON.stringify({ name: "2MG Incorporated", address: "Pasig City", tin: "123-456-789-000" })}::jsonb, ${ids.admin})
      on conflict (key) do update set value = excluded.value`);
    const [leave] = await rows<{ id: number }>(
      db,
      sql`insert into person_leave (person_id, kind, from_day, to_day, status, made_by, approver_id, decided_by, decided_at)
        values (${ids.ryan}, 'vl', current_date, current_date, 'approved', ${ids.ryan}, ${ids.daniel}, ${ids.daniel}, now()) returning id::int as id`,
    );
    const paper = await read<Printout>("helen", `/api/hr/print/leave/${leave?.id}`);
    expect(paper.code).toBe(`LV-${String(leave?.id).padStart(6, "0")}`);
    expect(paper.letterhead).toMatchObject({ name: "2MG Incorporated", address: "Pasig City", tin: "123-456-789-000" });
  });
});
