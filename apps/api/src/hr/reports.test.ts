// HR's reports: every report runs on the demo company, its figures add up, a company filter narrows
// it, Excel carries the same rows, and only HR, the CEO and the Admin read them.
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase } from "../db/index";
import { migrate } from "../db/migrate";
import { addDays, todayManila } from "../inventory/rules";
import { readXlsxBytes } from "../reports/xlsx-read";
import { seedDemo } from "../seed";
import type { HrReport, HrReportList, Me } from "../types";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
const ids: Record<string, number> = {};
const get = (who: string, path: string) => app.request(path, { headers: { cookie: cookies[who] as string } });
const read = async <T>(who: string, path: string) => (await (await get(who, path)).json()) as T;
const today = todayManila();

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["helen", "naresh", "ryan"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
    ids[name] = ((await response.json()) as { me: Me }).me.id;
  }
  // Ryan: GPI, probationary, hired two months and a week ago, a birthday in ten days.
  const hired = addDays(today, -69);
  const birthday = `1990-${addDays(today, 10).slice(5)}`;
  await db.execute(sql`update employee set company = 'gpi', classification = 'probationary', department = 'Sales',
    hire_date = ${hired}::date, birth_date = ${birthday}::date where person_id = ${ids.ryan}`);
  await db.execute(sql`insert into hr_form (person_id, kind, day, from_time, to_time, reason, status, ot_type, ot_minutes, ot_night_minutes, approver_id, made_by)
    values (${ids.ryan}, 'ot', ${today}::date, '18:00', '23:00', 'Month end', 'approved', 'regular', 300, 60, ${ids.helen}, ${ids.ryan})`);
});

describe("HR's reports", () => {
  it("lists ten reports for HR and the CEO, none for a seller", async () => {
    const list = await read<HrReportList>("helen", "/api/hr/reports");
    expect(list.reports.map((one) => one.key)).toHaveLength(10);
    expect((await get("naresh", "/api/hr/reports")).status).toBe(200);
    expect((await get("ryan", "/api/hr/reports")).status).toBe(403);
    expect((await get("ryan", "/api/hr/reports/headcount")).status).toBe(403);
  });

  it("every report runs, and the total row adds its rows up", async () => {
    const { reports } = await read<HrReportList>("helen", "/api/hr/reports");
    for (const { key } of reports) {
      const response = await get("helen", `/api/hr/reports/${key}?from=${addDays(today, -90)}&to=${today}`);
      expect(response.status, key).toBe(200);
      const report = (await response.json()) as HrReport;
      expect(report.columns.length, key).toBeGreaterThan(2);
      expect(report.preparedBy).toBe("Helen");
      for (const column of report.columns.filter((one) => one.type === "number" && report.totals))
        if (key !== "attrition")
          expect(report.totals?.[column.key], `${key} ${column.key}`).toBeCloseTo(
            report.rows.reduce((total, row) => total + ((row[column.key] as number) ?? 0), 0),
          );
    }
  });

  it("the figures say what happened, and a company filter narrows them", async () => {
    const count = await read<HrReport>("helen", "/api/hr/reports/headcount");
    const gpi = await read<HrReport>("helen", "/api/hr/reports/headcount?company=gpi");
    expect(gpi.totals?.total).toBe(1);
    expect(gpi.letterhead.name).toBe("Getmeds Philippines Incorporated");
    expect(count.letterhead.name).toMatch(/2MG Incorporated and Getmeds Philippines Incorporated/);
    expect(Number(count.totals?.total)).toBeGreaterThan(5);

    const ot = await read<HrReport>("helen", `/api/hr/reports/overtime?from=${today}&to=${today}`);
    expect(ot.rows).toEqual([expect.objectContaining({ name: "Ryan", hours: 5, night: 1, type: "Regular day" })]);

    const due = await read<HrReport>("helen", "/api/hr/reports/due-soon?days=30");
    expect(due.rows.filter((one) => one.name === "Ryan").map((one) => one.what)).toEqual(
      expect.arrayContaining(["Birthday", "Probation review (month 3)"]),
    );
    const missing = await read<HrReport>("helen", "/api/hr/reports/missing");
    expect(String(missing.rows.find((one) => one.name === "Ryan")?.missing)).toMatch(/SSS/);
  });

  it("Excel carries the title, the period and the same rows", async () => {
    const file = await get("helen", `/api/hr/reports/overtime.xlsx?from=${today}&to=${today}`);
    expect(file.headers.get("content-type")).toContain("spreadsheetml");
    const [sheet] = readXlsxBytes(new Uint8Array(await file.arrayBuffer()));
    expect(sheet?.rows[0]?.cells[0]).toMatch(/^Overtime · /);
    expect(sheet?.rows.some((row) => row.cells.includes("Ryan"))).toBe(true);
    expect(sheet?.rows.at(-1)?.cells[0]).toBe("Total");
  });
});
