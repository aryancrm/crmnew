// HR's sheets in and out: the masterlist exported and brought back unchanged, a test run that
// changes nothing, saving what passes with each problem said by line, leave balances reached by
// adjustments, holidays added once.
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { readXlsxBytes } from "../reports/xlsx-read";
import { seedDemo } from "../seed";
import type { HrImportRead, HrImportResult, Me } from "../types";
import { centavosOf, csvRows, dayOf } from "./sheets";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
const ids: Record<string, number> = {};

const get = (who: string, path: string) => app.request(path, { headers: { cookie: cookies[who] as string } });
const send = (who: string, path: string, body: unknown) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookies[who] as string },
    body: JSON.stringify(body),
  });
const upload = async (who: string, kind: string, name: string, bytes: Uint8Array | string) => {
  const form = new FormData();
  form.append("file", new File([bytes as BlobPart], name));
  return app.request(`/api/hr/import/${kind}/read`, { method: "POST", headers: { cookie: cookies[who] as string }, body: form });
};
/** Reads a file and runs it: a test run, or saved. */
const run = async (kind: string, name: string, bytes: Uint8Array | string, save: boolean) => {
  const read = (await (await upload("helen", kind, name, bytes)).json()) as HrImportRead;
  return (await (await send("helen", `/api/hr/import/${kind}`, { mapping: read.mapping, rows: read.rows, save })).json()) as HrImportResult;
};

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["helen", "ryan", "naresh"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
    ids[name] = ((await response.json()) as { me: Me }).me.id;
  }
  await db.execute(sql`update employee set employee_code = 'E-0042', classification = 'regular' where person_id = ${ids.ryan}`);
});

describe("reading cells", () => {
  it("days, pesos and .csv rows as Excel and HR write them", () => {
    expect(dayOf("2025-03-01")).toBe("2025-03-01");
    expect(dayOf("3/1/2025")).toBe("2025-03-01");
    expect(dayOf("45717")).toBe("2025-03-01");
    expect(dayOf("March")).toBeNull();
    expect(centavosOf("₱25,000.50")).toBe(2_500_050);
    expect(centavosOf("abc")).toBeNull();
    expect(csvRows('a,"b, c"\r\n"say ""hi""",d\n')).toEqual([["a", "b, c"], ['say "hi"', "d"]]);
  });
});

describe("HR's sheets", () => {
  it("the masterlist exports as Excel, and the template has the headings only", async () => {
    const file = await get("helen", "/api/hr/export/people.xlsx");
    expect(file.status).toBe(200);
    const [sheet] = readXlsxBytes(new Uint8Array(await file.arrayBuffer()));
    expect(sheet?.rows[0]?.cells.slice(0, 3)).toEqual(["Employee ID", "Login email", "Name"]);
    expect(sheet?.rows.some((row) => row.cells.includes("ryan@2mg.test"))).toBe(true);
    const template = readXlsxBytes(new Uint8Array(await (await get("helen", "/api/hr/export/people.xlsx?template=1")).arrayBuffer()));
    expect(template[0]?.rows).toHaveLength(1);
    expect(template[1]?.name).toBe("How to fill it");
    // Only HR, the CEO and the Admin.
    expect((await get("ryan", "/api/hr/export/people.xlsx")).status).toBe(403);
    expect((await upload("ryan", "people", "a.csv", "Employee ID\nE-1")).status).toBe(403);
  });

  it("an import: a test run changes nothing; saving keeps what passes and says why the rest didn't", async () => {
    const csv = [
      "Employee No,Email,Department,Monthly salary,Hire date,Birthday",
      "E-0042,ryan@2mg.test,Field sales,\"30,000.00\",3/1/2025,1990-05-04",
      ",nobody@2mg.test,Sales,,,",
      "E-0042,,Sales,,someday,",
      "E-0042,helen@2mg.test,Sales,,,",
    ].join("\n");
    const tried = await run("people", "people.csv", csv, false);
    expect(tried.saved).toBe(false);
    expect(tried.rows.map((one) => [one.line, one.status])).toEqual([[2, "update"], [3, "not_found"], [4, "problem"], [5, "problem"]]);
    expect(tried.rows[0]?.changes).toEqual(expect.arrayContaining(["Department: — → Field sales", "Monthly salary changed"]));
    expect(tried.rows[2]?.problem).toMatch(/Hire date: "someday" isn't a day/);
    expect(tried.rows[3]?.problem).toMatch(/E-0042 is Ryan's but helen@2mg\.test is Helen's/);
    const [before] = await rows<{ department: string | null }>(db, sql`select department from employee where person_id = ${ids.ryan}`);
    expect(before?.department).toBeNull();

    const saved = await run("people", "people.csv", csv, true);
    expect(saved.counts).toMatchObject({ update: 1, not_found: 1, problem: 2 });
    const [after] = await rows<{ department: string; salary: number; hire: string; birth: string }>(
      db,
      sql`select department, salary, to_char(hire_date, 'YYYY-MM-DD') as hire, to_char(birth_date, 'YYYY-MM-DD') as birth
        from employee where person_id = ${ids.ryan}`,
    );
    expect(after).toEqual({ department: "Field sales", salary: 3_000_000, hire: "2025-03-01", birth: "1990-05-04" });
    const [trail] = await rows<{ what: string }>(db, sql`select what from hr_event where person_id = ${ids.ryan} and kind = 'record' order by id desc limit 1`);
    expect(trail?.what).toMatch(/Department/);
  });

  it("the exported masterlist comes back with nothing to change", async () => {
    const bytes = new Uint8Array(await (await get("helen", "/api/hr/export/people.xlsx")).arrayBuffer());
    const back = await run("people", "people.xlsx", bytes, false);
    expect(back.counts.update + back.counts.problem + back.counts.not_found).toBe(0);
    expect(back.counts.same).toBeGreaterThan(5);
  });

  it("leave balances: the days left are reached with an adjustment each, with the reason", async () => {
    const year = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }).slice(0, 4);
    const csv = `Employee ID,VL left,SL left,Year\nE-0042,7.5,10,${year}\n`;
    const result = await run("leave-balances", "balances.csv", csv, true);
    expect(result.rows[0]).toMatchObject({ status: "update", changes: [`${year} vacation leave left: 10 → 7.5`] });
    const lines = await rows<{ kind: string; half_days: number; reason: string }>(
      db,
      sql`select kind, half_days, reason from leave_credit where person_id = ${ids.ryan}`,
    );
    expect(lines).toEqual([{ kind: "vl", half_days: -5, reason: "Balance brought over from the old system" }]);
    expect((await run("leave-balances", "balances.csv", csv, false)).rows[0]?.status).toBe("same");
    expect((await run("leave-balances", "bad.csv", "Employee ID,VL left\nE-0042,7.3\n", false)).rows[0]?.problem).toMatch(/half-day/);
  });

  it("holidays: added once; the same day and name again is left as it is", async () => {
    const csv = "Date,Holiday,Kind,Province,Town\n2031-08-21,Ninoy Aquino Day,Special,,\n";
    expect((await run("holidays", "h.csv", csv, true)).rows[0]?.status).toBe("new");
    expect((await run("holidays", "h.csv", csv, false)).rows[0]?.status).toBe("same");
    const [found] = await rows<{ n: number }>(db, sql`select count(*)::int as n from holiday where day = '2031-08-21' and active`);
    expect(found?.n).toBe(1);
  });
});
