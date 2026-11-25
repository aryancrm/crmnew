// Each person's papers on their HR record: HR adds and takes off (archived, never deleted), HR,
// the CEO, the Admin and the person read, nobody else, never while looking as someone.

import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { addDays, todayManila } from "../inventory/rules";
import { seedDemo } from "../seed";
import type { HrHistory, HrPapers, Me } from "../types";
import { sql } from "drizzle-orm";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
const ids: Record<string, number> = {};
const PDF = new TextEncoder().encode("%PDF-1.4\n% a contract\n%%EOF\n");

const get = (who: string, path: string) =>
  app.request(path, { headers: { cookie: cookies[who] as string } });
const read = async <T>(who: string, path: string) => (await (await get(who, path)).json()) as T;
const send = (who: string, path: string, body: unknown = {}) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookies[who] as string },
    body: JSON.stringify(body),
  });
const upload = (who: string, personId: number, fields: Record<string, string>, file?: File) => {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  if (file) form.set("file", file);
  return app.request(`/api/hr/people/${personId}/papers`, {
    method: "POST",
    headers: { cookie: cookies[who] as string },
    body: form,
  });
};
const contract = () => new File([PDF], "contract.pdf", { type: "application/pdf" });

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

describe("people's papers", () => {
  it("HR adds a paper; it is listed with who added it, and the trail says so", async () => {
    const ryan = ids.ryan as number;
    const added = await upload(
      "helen",
      ryan,
      { kind: "contract", title: "Employment contract 2026", expiresOn: addDays(todayManila(), 10) },
      contract(),
    );
    expect(added.status).toBe(200);
    const list = await read<HrPapers>("helen", `/api/hr/people/${ryan}/papers`);
    expect(list.can).toEqual({ add: true, archive: true });
    expect(list.papers).toHaveLength(1);
    expect(list.papers[0]).toMatchObject({
      kind: "contract",
      kindLabel: "Contract",
      title: "Employment contract 2026",
      expiry: "soon",
      fileName: "contract.pdf",
      fileMime: "application/pdf",
      addedBy: "Helen",
      archived: null,
    });
    const trail = await read<HrHistory>("helen", `/api/hr/people/${ryan}/history`);
    expect(trail.lines[0]).toMatchObject({ kind: "paper", what: "Paper added: Employment contract 2026 (Contract)" });
  });

  it("refuses a paper without a file, a name, a known kind, or of a type it can't keep", async () => {
    const ryan = ids.ryan as number;
    expect((await upload("helen", ryan, { kind: "contract", title: "No file" })).status).toBe(400);
    expect((await upload("helen", ryan, { kind: "contract", title: "" }, contract())).status).toBe(400);
    expect((await upload("helen", ryan, { kind: "payslip", title: "Odd" }, contract())).status).toBe(400);
    const page = new File(["<html></html>"], "page.html", { type: "text/html" });
    expect((await upload("helen", ryan, { kind: "other", title: "A page" }, page)).status).toBe(400);
  });

  it("only HR and the Admin add papers", async () => {
    const ryan = ids.ryan as number;
    for (const who of ["naresh", "daniel", "ryan"])
      expect((await upload(who, ryan, { kind: "other", title: "Try" }, contract())).status).toBe(403);
    expect((await upload("admin", ryan, { kind: "government_id", title: "UMID" }, contract())).status).toBe(200);
  });

  it("is read by HR, the CEO, the Admin and the person; not by a lead or a colleague", async () => {
    const ryan = ids.ryan as number;
    for (const who of ["helen", "naresh", "admin", "ryan"])
      expect((await get(who, `/api/hr/people/${ryan}/papers`)).status).toBe(200);
    for (const who of ["daniel", "marco"])
      expect((await get(who, `/api/hr/people/${ryan}/papers`)).status).toBe(403);
    const mine = await read<HrPapers>("ryan", `/api/hr/people/${ryan}/papers`);
    expect(mine.can).toEqual({ add: false, archive: false });
  });

  it("gives the file back as it was kept, to whoever may read it", async () => {
    const ryan = ids.ryan as number;
    const [first] = (await read<HrPapers>("helen", `/api/hr/people/${ryan}/papers`)).papers.filter(
      (one) => one.kind === "contract",
    );
    const file = await get("ryan", `/api/hr/papers/${first?.id}/file`);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("application/pdf");
    expect(file.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(PDF);
    expect((await get("daniel", `/api/hr/papers/${first?.id}/file`)).status).toBe(403);
    expect((await get("helen", "/api/hr/papers/999999/file")).status).toBe(404);
  });

  it("takes a paper off with a reason: archived, still readable, never deleted", async () => {
    const ryan = ids.ryan as number;
    const [first] = (await read<HrPapers>("helen", `/api/hr/people/${ryan}/papers`)).papers.filter(
      (one) => one.kind === "contract",
    );
    expect((await send("helen", `/api/hr/papers/${first?.id}/archive`, {})).status).toBe(400);
    expect((await send("ryan", `/api/hr/papers/${first?.id}/archive`, { reason: "Mine" })).status).toBe(403);
    expect((await send("helen", `/api/hr/papers/${first?.id}/archive`, { reason: "Replaced by the signed one" })).status).toBe(200);
    expect((await send("helen", `/api/hr/papers/${first?.id}/archive`, { reason: "Again" })).status).toBe(404);
    const list = await read<HrPapers>("helen", `/api/hr/people/${ryan}/papers`);
    // Kept ones first, then the archived.
    expect(list.papers.at(-1)).toMatchObject({
      id: first?.id,
      expiry: null,
      archived: { by: "Helen", reason: "Replaced by the signed one" },
    });
    expect((await get("helen", `/api/hr/papers/${first?.id}/file`)).status).toBe(200);
    const [kept] = await rows<{ count: number }>(db, sql`select count(*)::int as count from hr_paper where person_id = ${ryan}`);
    expect(kept?.count).toBe(2);
    const trail = await read<HrHistory>("helen", `/api/hr/people/${ryan}/history`);
    expect(trail.lines[0]?.what).toBe("Paper taken off: Employment contract 2026: Replaced by the signed one");
  });

  it("an expired paper says so", async () => {
    const marco = ids.marco as number;
    await upload("helen", marco, { kind: "government_id", title: "Driver's licence", expiresOn: addDays(todayManila(), -1) }, contract());
    const list = await read<HrPapers>("helen", `/api/hr/people/${marco}/papers`);
    expect(list.papers[0]?.expiry).toBe("expired");
  });
});
