// The biometric timekeeping workbook: the TIMEKEEPING sheet read as Automated-Excel's parser reads
// it (two rows a person, day columns, totals after), previewed with nothing kept, rows matched by
// the device ID HR set or the employee ID (a name is only a suggestion HR confirms), imported beside
// the CRM's attendance (never over it), re-imported with the older rows kept, and Needs review:
// HR uses the biometric times for a day (marked biometric, in HR's trail) or dismisses its flag
// with a note. HR and the Admin work; the CEO reads; leads and MedReps get nothing.

import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { runChecks } from "../checks/integrity";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { addDays, todayManila } from "../inventory/rules";
import { workbook } from "../reports/xlsx";
import type { Sheet as GridSheet } from "../reports/xlsx-read";
import { seedDemo } from "../seed";
import type { AttendanceMonth, HrHistory, Me, TimekeepingPage, TimekeepingPreview } from "../types";
import { setDay } from "./attendance";
import { looksLike } from "./timekeeping";
import { readDayCell, readTimekeeping } from "./timekeeping-sheet";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
const ids: Record<string, number> = {};

const get = (who: string, path: string) =>
  app.request(path, { headers: { cookie: cookies[who] as string } });
const read = async <T>(who: string, path: string) => (await (await get(who, path)).json()) as T;
const send = (who: string, path: string, body: unknown = {}) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookies[who] as string },
    body: JSON.stringify(body),
  });
const upload = (who: string, path: string, bytes: Uint8Array, name = "timekeeping.xlsx") => {
  const form = new FormData();
  form.set(
    "file",
    new File([bytes as Uint8Array<ArrayBuffer>], name, {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  return app.request(path, { method: "POST", headers: { cookie: cookies[who] as string }, body: form });
};

// Seven days, well past, so every day has come.
const start = addDays(todayManila(), -14);
const D = Array.from({ length: 7 }, (_, at) => addDays(start, at));
const dayNumber = (day: string) => Number(day.slice(8, 10));

const RYAN = ["08:0017:00", "08:05", "OFF", "TRAINING", "08:6017:00", "", "07:3016:30"];
const ZED = ["09:0018:00", "", "", "", "", "", ""];
const JANE = ["08:0017:00", "A", "", "", "", "", ""];
const MARCO = ["07:0016:00", "", "", "", "", "", ""];

/** The TIMEKEEPING sheet laid out as HR's workbook has it (and Automated-Excel's parser reads):
 *  row 1 the totals' headings after the day columns, C3 the dates, row 5 the day numbers, then two
 *  rows a person: "ID:" with the device ID in B or C and the name after "Name:", then the days. */
function timekeepingRows(): (string | number | null)[][] {
  const totals = 7 + 1; // the totals start a column after the days
  const heading: (string | null)[] = Array(totals).fill(null);
  heading.push("Regular Working Hours", "Night Differential", "OT within 8h");
  const person = (
    device: string,
    name: string,
    cells: string[],
    inC = false,
    code?: string,
  ): (string | number | null)[][] => {
    const idRow: (string | null)[] = ["ID:", inC ? "" : device, inC ? device : "", null, null, null, null, null, "Name:", null, name];
    if (code) {
      idRow[4] = "Emp No:";
      idRow[5] = code;
    }
    return [idRow, [...cells, null, 8, 0, 0]];
  };
  return [
    heading,
    [],
    ["Att. Time", null, `${D[0]}~ ${D[6]}`],
    [],
    D.map(dayNumber),
    ...person("101", "RYAN", RYAN, true),
    ...person("102", "Zed Nobody", ZED),
    ...person("103", "J. Online", JANE),
    ...person("77", "Marco Polo", MARCO, false, "2mg - 777"),
  ];
}
const WORKBOOK = new Uint8Array(
  workbook([
    { name: "STANDARD REPORT", rows: [["the raw export, not read"]] },
    { name: "TIMEKEEPING", rows: timekeepingRows() },
  ]),
);

const attendanceRows = () =>
  rows<{ personId: number; day: string; timeIn: string; timeOut: string | null; inSource: string; note: string | null }>(
    db,
    sql`select person_id::int as "personId", to_char(day, 'YYYY-MM-DD') as day,
        to_char(time_in at time zone 'Asia/Manila', 'HH24:MI') as "timeIn",
        to_char(time_out at time zone 'Asia/Manila', 'HH24:MI') as "timeOut", in_source as "inSource", note
      from attendance order by person_id, day`,
  );

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["helen", "admin", "naresh", "daniel", "ryan", "jane", "marco"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
    ids[name] = ((await response.json()) as { me: Me }).me.id;
  }
  await db.execute(sql`delete from attendance`);
  await db.execute(sql`update employee set hire_date = hire_date - 120`);
  await db.execute(sql`update employee set employee_code = '2MG-777' where person_id = ${ids.marco as number}`);
  // The CRM's own days: Ryan came in late by the CRM on the first day; Jane signed in on a day the
  // sheet marks absent, and on the first day within a few minutes of her punches.
  const by = ids.helen as number;
  await setDay(db, ids.ryan as number, by, { day: D[0] as string, timeIn: "08:30", timeOut: "17:00", note: "CRM" }, "hr");
  await setDay(db, ids.jane as number, by, { day: D[0] as string, timeIn: "08:10", timeOut: "17:05", note: "CRM" }, "hr");
  await setDay(db, ids.jane as number, by, { day: D[1] as string, timeIn: "08:00", timeOut: "17:00", note: "CRM" }, "hr");
});

describe("the timekeeping sheet, on its own", () => {
  it("reads each cell: punches, one punch, codes, a mistyped time, nothing", () => {
    expect(readDayCell("07:0216:01")).toMatchObject({ kind: "punch", firstIn: "07:02", lastOut: "16:01", punches: 2, review: null });
    expect(readDayCell("07:02 12:00 13:00 16:01")).toMatchObject({ kind: "punch", firstIn: "07:02", lastOut: "16:01", punches: 4, review: null });
    expect(readDayCell("08:05")).toMatchObject({ kind: "punch", firstIn: "08:05", lastOut: null, punches: 1 });
    expect(readDayCell("08:05").review).toMatch(/one punch/i);
    expect(readDayCell("07:0012:0016:00").review).toMatch(/odd number/i);
    expect(readDayCell("16:0007:00").review).toMatch(/isn't after/);
    expect(readDayCell("off")).toMatchObject({ kind: "code", code: "OFF", review: null });
    expect(readDayCell("OB")).toMatchObject({ kind: "code", code: "OB", review: null });
    expect(readDayCell("TRAINING")).toMatchObject({ kind: "code", code: "TRAINING" });
    expect(readDayCell("TRAINING").review).toMatch(/Training/);
    expect(readDayCell("LWOP").review).toBeTruthy();
    expect(readDayCell("08:6017:00")).toMatchObject({ kind: "unreadable", firstIn: null });
    expect(readDayCell("8:0017:00").review).toMatch(/mistyped/i);
    expect(readDayCell("came late")).toMatchObject({ kind: "unreadable" });
    expect(readDayCell("  ")).toMatchObject({ kind: "empty", review: null });
  });

  it("reads the grid: the dates from C3 and the day numbers, each person's device ID, name and days", () => {
    const grid: GridSheet[] = [
      {
        name: "TIMEKEEPING",
        hidden: false,
        rows: timekeepingRows().map((cells, at) => ({
          number: at + 1,
          cells: cells.map((one) => (one === null || one === undefined ? "" : String(one))),
        })),
      },
    ];
    const sheet = readTimekeeping(grid);
    expect(sheet).toMatchObject({ sheet: "TIMEKEEPING", from: D[0], to: D[6], warnings: [] });
    expect(sheet.people.map((one) => [one.row, one.deviceId, one.name, one.employeeCode])).toEqual([
      [6, "101", "RYAN", null],
      [8, "102", "Zed Nobody", null],
      [10, "103", "J. Online", null],
      [12, "77", "Marco Polo", "2mg - 777"],
    ]);
    const ryan = sheet.people[0]?.days ?? [];
    expect(ryan.map((one) => one.day)).toEqual(D);
    expect(ryan.map((one) => one.kind)).toEqual(["punch", "punch", "code", "code", "unreadable", "empty", "punch"]);
    expect(ryan.map((one) => one.column)).toEqual(["A", "B", "C", "D", "E", "F", "G"]);
    expect(ryan.filter((one) => one.review).map((one) => one.day)).toEqual([D[1], D[3], D[4]]);
  });

  it("dates a run over a month's end, and says when the sheet's own end date is wrong", () => {
    const sheet = readTimekeeping([
      {
        name: "Aug 26 - Sep 10",
        hidden: false,
        rows: [
          { number: 3, cells: ["Att. Time", "", "2026-08-30~ 2026-08-02"] },
          { number: 5, cells: ["30", "31", "1", "2"] },
          { number: 6, cells: ["ID:", "5", "", "", "", "", "", "", "", "", "Juan Dela Cruz"] },
          { number: 7, cells: ["07:0016:00", "OFF", "", "07:1016:05"] },
        ],
      },
    ]);
    expect(sheet.from).toBe("2026-08-30");
    expect(sheet.to).toBe("2026-09-02");
    expect(sheet.people[0]?.days.map((one) => one.day)).toEqual(["2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02"]);
    expect(sheet.warnings.join(" ")).toMatch(/ends on 2026-08-02/);
    expect(() => readTimekeeping([{ name: "Sheet1", hidden: false, rows: [] }])).toThrow(/no TIMEKEEPING sheet/);
  });

  it("a name looks like someone's only when its words agree", () => {
    expect(looksLike("DELA CRUZ, JUAN", "Juan Dela Cruz")).toBe(true);
    expect(looksLike("Juan Santos Dela Cruz", "Juan Dela Cruz")).toBe(true);
    expect(looksLike("Romel Petallana", "Rommel Petallana")).toBe(true);
    expect(looksLike("RYAN", "Ryan")).toBe(true);
    expect(looksLike("Juan", "Juan Dela Cruz")).toBe(false);
    expect(looksLike("Maria Dela Cruz", "Juan Dela Cruz")).toBe(false);
  });
});

describe("the timekeeping import", () => {
  let before: Awaited<ReturnType<typeof attendanceRows>>;
  let first = 0;
  let second = 0;

  it("the preview reads the sheet and keeps nothing; a name is only a suggestion", async () => {
    // HR said before that device ID 103 is Jane's.
    expect((await send("helen", "/api/hr/timekeeping/devices", { deviceId: "103", personId: ids.jane })).status).toBe(200);
    const response = await upload("helen", "/api/hr/timekeeping/preview", WORKBOOK);
    expect(response.status, await response.clone().text()).toBe(200);
    const preview = (await response.json()) as TimekeepingPreview;
    expect(preview).toMatchObject({ sheet: "TIMEKEEPING", from: D[0], to: D[6] });
    const byDevice = Object.fromEntries(preview.people.map((one) => [one.deviceId, one]));
    expect(byDevice["101"]).toMatchObject({ name: "RYAN", match: null, suggestion: { personId: ids.ryan } });
    expect(byDevice["102"]).toMatchObject({ match: null, suggestion: null });
    expect(byDevice["103"]).toMatchObject({ match: { how: "device", personId: ids.jane } });
    expect(byDevice["77"]).toMatchObject({ match: { how: "employee_id", personId: ids.marco } });
    expect(byDevice["101"]?.days[0]).toMatchObject({ day: D[0], firstIn: "08:00", lastOut: "17:00" });
    expect(byDevice["101"]?.counts).toEqual({ punched: 3, review: 3 });
    expect(preview.counts).toMatchObject({ people: 4, matched: 2, suggested: 1, unmatched: 2, days: 14, review: 0 });
    expect(preview.choices.some((one) => one.id === ids.ryan)).toBe(true);
    const [kept] = await rows<{ imports: number; days: number }>(
      db,
      sql`select (select count(*)::int from timekeeping_import) as imports, (select count(*)::int from biometric_day) as days`,
    );
    expect(kept).toEqual({ imports: 0, days: 0 });
  });

  it("imports only the matched rows, beside the CRM's attendance and never over it", async () => {
    before = await attendanceRows();
    const response = await upload("helen", "/api/hr/timekeeping/import", WORKBOOK);
    expect(response.status, await response.clone().text()).toBe(200);
    const made = (await response.json()) as { id: number; people: number; days: number; skipped: number };
    first = made.id;
    expect(made).toMatchObject({ people: 2, days: 14, skipped: 2 });
    const kept = await rows<{ personId: number; n: number }>(
      db,
      sql`select person_id::int as "personId", count(*)::int as n from biometric_day group by person_id order by person_id`,
    );
    expect(kept.map((one) => one.personId).sort()).toEqual([ids.jane, ids.marco].sort());
    expect(await attendanceRows()).toEqual(before);
  });

  it("confirming a suggestion saves the device ID, and the next import takes the row", async () => {
    const confirmed = await send("helen", "/api/hr/timekeeping/devices", {
      deviceId: "101",
      personId: ids.ryan,
      nameOnSheet: "RYAN",
    });
    expect(confirmed.status, await confirmed.clone().text()).toBe(200);
    const preview = (await (await upload("helen", "/api/hr/timekeeping/preview", WORKBOOK)).json()) as TimekeepingPreview;
    expect(preview.people.find((one) => one.deviceId === "101")?.match).toMatchObject({ how: "device", personId: ids.ryan });
    const trail = await read<HrHistory>("helen", `/api/hr/people/${ids.ryan}/history`);
    expect(trail.lines.some((one) => /device ID 101 is theirs/.test(one.what))).toBe(true);
    const page = await read<TimekeepingPage>("helen", "/api/hr/timekeeping");
    expect(page.devices.map((one) => one.deviceId).sort()).toEqual(["101", "103"]);
  });

  it("re-importing the same days makes the new rows current and keeps the old ones", async () => {
    const response = await upload("helen", "/api/hr/timekeeping/import", WORKBOOK);
    expect(response.status, await response.clone().text()).toBe(200);
    second = ((await response.json()) as { id: number }).id;
    const [counts] = await rows<{ all: number; current: number; superseded: number }>(
      db,
      sql`select count(*)::int as all, count(*) filter (where superseded_by is null)::int as current,
          count(*) filter (where superseded_by = ${second})::int as superseded from biometric_day`,
    );
    expect(counts).toEqual({ all: 14 + 21, current: 21, superseded: 14 });
    const [old] = await rows<{ n: number }>(
      db,
      sql`select count(*)::int as n from biometric_day where import_id = ${first} and superseded_by is null`,
    );
    expect(old?.n).toBe(0);
    expect(await attendanceRows()).toEqual(before);
    const page = await read<TimekeepingPage>("helen", "/api/hr/timekeeping");
    expect(page.imports.map((one) => [one.id, one.superseded])).toEqual([
      [second, false],
      [first, true],
    ]);
    expect((await runChecks(db)).checks.find((one) => one.key === "timekeeping_days")?.count).toBe(0);
  });

  it("Needs review lists unreadable days and disagreements with the CRM, across everyone", async () => {
    const page = await read<TimekeepingPage>("helen", "/api/hr/timekeeping");
    expect(page.range).toEqual({ from: D[0], to: D[6] });
    const line = (personId: number, day: string) =>
      page.review.find((one) => one.person.id === personId && one.biometric.day === day);
    const ryan = ids.ryan as number;
    const jane = ids.jane as number;
    expect(line(ryan, D[0] as string)?.biometric.flag).toMatch(/Time in differs by 30 min \(CRM 08:30\)/);
    expect(line(ryan, D[1] as string)?.biometric.review).toMatch(/one punch/i);
    expect(line(ryan, D[3] as string)?.biometric).toMatchObject({ code: "TRAINING", codeWords: "Training" });
    expect(line(ryan, D[4] as string)?.biometric.kind).toBe("unreadable");
    expect(line(ryan, D[6] as string)?.biometric.flag).toBe("On the biometrics, not on the CRM");
    expect(line(jane, D[1] as string)?.biometric.flag).toBe("On the CRM, but the sheet says A");
    expect(line(jane, D[1] as string)?.crm?.timeIn).toBeTruthy();
    // Within 15 minutes, a rest day, an empty day nobody signed in on: nothing to review.
    expect(line(jane, D[0] as string)).toBeUndefined();
    expect(line(ryan, D[2] as string)).toBeUndefined();
    expect(line(ryan, D[5] as string)).toBeUndefined();
    // Marco punched in on the first day and never signed in on the CRM; nothing else of his.
    expect(page.review.filter((one) => one.person.id === ids.marco).map((one) => [one.biometric.day, one.biometric.flag])).toEqual([
      [D[0], "On the biometrics, not on the CRM"],
    ]);
  });

  it("the person's attendance month shows the biometric times beside the CRM's, for HR and the CEO", async () => {
    const month = (D[0] as string).slice(0, 7);
    const hr = await read<AttendanceMonth>("helen", `/api/hr/attendance/${ids.ryan}?month=${month}`);
    expect(hr.can.biometric).toBe(true);
    const first = hr.biometric?.find((one) => one.day === D[0]);
    expect(first).toMatchObject({ firstIn: "08:00", lastOut: "17:00", flag: expect.stringMatching(/differs/) });
    const ceo = await read<AttendanceMonth>("naresh", `/api/hr/attendance/${ids.ryan}?month=${month}`);
    expect(ceo.biometric?.length).toBe(hr.biometric?.length);
    expect(ceo.can.biometric).toBe(false);
    const lead = await read<AttendanceMonth>("daniel", `/api/hr/attendance/${ids.ryan}?month=${month}`);
    expect(lead.biometric).toBeNull();
    const own = await read<AttendanceMonth>("ryan", `/api/hr/attendance/${ids.ryan}?month=${month}`);
    expect(own.biometric).toBeNull();
  });

  it("Use biometric times sets the CRM's day, marked biometric, and HR's trail says so", async () => {
    const page = await read<TimekeepingPage>("helen", "/api/hr/timekeeping");
    const pick = (day: string) =>
      page.review.find((one) => one.person.id === ids.ryan && one.biometric.day === day)?.biometric.id as number;
    const used = await send("helen", `/api/hr/timekeeping/days/${pick(D[0] as string)}/use`, {});
    expect(used.status, await used.clone().text()).toBe(200);
    const day = (await attendanceRows()).find((one) => one.personId === ids.ryan && one.day === D[0]);
    expect(day).toMatchObject({ timeIn: "08:00", timeOut: "17:00", inSource: "biometric" });
    expect(day?.note).toMatch(/biometric import/);
    const trail = await read<HrHistory>("helen", `/api/hr/people/${ids.ryan}/history`);
    expect(trail.lines.some((one) => one.what === `Attendance of ${D[0]} set from the biometrics: 08:00–17:00`)).toBe(true);
    // Answered once; a day with one punch can't be used; the list moves on.
    expect((await send("helen", `/api/hr/timekeeping/days/${pick(D[0] as string)}/use`, {})).status).toBe(409);
    expect((await send("helen", `/api/hr/timekeeping/days/${pick(D[1] as string)}/use`, {})).status).toBe(409);
    const after = await read<TimekeepingPage>("helen", "/api/hr/timekeeping");
    expect(after.review.some((one) => one.person.id === ids.ryan && one.biometric.day === D[0])).toBe(false);
  });

  it("dismissing a flag needs a note, keeps it, and a re-import of the same cell keeps the answer", async () => {
    const page = await read<TimekeepingPage>("helen", "/api/hr/timekeeping");
    const training = page.review.find((one) => one.person.id === ids.ryan && one.biometric.day === D[3])?.biometric.id as number;
    expect((await send("helen", `/api/hr/timekeeping/days/${training}/dismiss`, { note: " " })).status).toBe(400);
    const dismissed = await send("helen", `/api/hr/timekeeping/days/${training}/dismiss`, { note: "Company training, a full day" });
    expect(dismissed.status, await dismissed.clone().text()).toBe(200);
    const [row] = await rows<{ resolution: string; note: string }>(
      db,
      sql`select resolution, resolved_note as note from biometric_day where id = ${training}`,
    );
    expect(row).toEqual({ resolution: "dismissed", note: "Company training, a full day" });
    expect((await upload("helen", "/api/hr/timekeeping/import", WORKBOOK)).status).toBe(200);
    const again = await read<TimekeepingPage>("helen", "/api/hr/timekeeping");
    const ryanDays = again.review.filter((one) => one.person.id === ids.ryan).map((one) => one.biometric.day);
    expect(ryanDays).not.toContain(D[3]);
    expect(ryanDays).not.toContain(D[0]);
    expect(ryanDays).toContain(D[1]);
  });

  it("HR and the Admin work, the CEO reads, leads and MedReps get nothing", async () => {
    expect((await get("naresh", "/api/hr/timekeeping")).status).toBe(200);
    expect((await get("naresh", `/api/hr/timekeeping/imports/${first}/file`)).status).toBe(200);
    expect((await upload("naresh", "/api/hr/timekeeping/preview", WORKBOOK)).status).toBe(403);
    expect((await upload("naresh", "/api/hr/timekeeping/import", WORKBOOK)).status).toBe(403);
    expect((await send("naresh", "/api/hr/timekeeping/devices", { deviceId: "102", personId: ids.ryan })).status).toBe(403);
    const someDay = (await read<TimekeepingPage>("helen", "/api/hr/timekeeping")).review[0]?.biometric.id as number;
    expect((await send("naresh", `/api/hr/timekeeping/days/${someDay}/dismiss`, { note: "no" })).status).toBe(403);
    expect((await send("naresh", `/api/hr/timekeeping/days/${someDay}/use`, {})).status).toBe(403);
    for (const who of ["daniel", "ryan"]) {
      expect((await get(who, "/api/hr/timekeeping")).status).toBe(403);
      expect((await upload(who, "/api/hr/timekeeping/preview", WORKBOOK)).status).toBe(403);
      expect((await get(who, `/api/hr/timekeeping/imports/${first}/file`)).status).toBe(403);
    }
    expect((await upload("admin", "/api/hr/timekeeping/preview", WORKBOOK)).status).toBe(200);
    expect((await get("admin", "/api/hr/timekeeping")).status).toBe(200);
  });

  it("refuses what isn't the timekeeping workbook", async () => {
    const wrong = await upload("helen", "/api/hr/timekeeping/preview", new Uint8Array(workbook([{ name: "Sheet1", rows: [["x"]] }])));
    expect(wrong.status).toBe(400);
    expect(((await wrong.json()) as { error: { message: string } }).error.message).toMatch(/TIMEKEEPING/);
    expect((await upload("helen", "/api/hr/timekeeping/preview", new TextEncoder().encode("a,b"), "dtr.csv")).status).toBe(400);
    expect((await upload("helen", "/api/hr/timekeeping/preview", new TextEncoder().encode("not a zip"))).status).toBe(400);
  });
});
