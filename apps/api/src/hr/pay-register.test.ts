// HR's own payroll register beside the CRM's month: amounts read as centavos, the headings found by
// a mapping HR makes once (used again for the next file), rows matched by employee ID, then by an
// exact name HR confirms, each figure CRM − HR with any ₱0.01 flagged, people on one side only;
// each file, mapping, confirmation and comparison kept. HR works; the CEO reads; nobody else.

import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { todayManila } from "../inventory/rules";
import { workbook } from "../reports/xlsx";
import { seedDemo } from "../seed";
import type { Me, PayRegisterPage, PayrollMonth, Payslip } from "../types";
import { centavosOf, codeKey, crmFigure, guessHeaderRow } from "./pay-register";
import { payMonthOf, shiftMonth } from "./pay-rules";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
const ids: Record<string, number> = {};
const past = shiftMonth(payMonthOf(todayManila()).key, -1);

const get = (who: string, path: string) =>
  app.request(path, { headers: { cookie: cookies[who] as string } });
const read = async <T>(who: string, path: string) => (await (await get(who, path)).json()) as T;
const send = (who: string, path: string, body: unknown = {}, method = "POST") =>
  app.request(path, {
    method,
    headers: { "content-type": "application/json", cookie: cookies[who] as string },
    body: JSON.stringify(body),
  });
const upload = (who: string, path: string, bytes: Uint8Array, name = "PayRegister.xlsx") => {
  const form = new FormData();
  form.set(
    "file",
    new File([bytes as Uint8Array<ArrayBuffer>], name, {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  return app.request(path, { method: "POST", headers: { cookie: cookies[who] as string }, body: form });
};

const HEADINGS = ["Emp No", "Employee Name", "Basic Pay", "OT Amount", "GROSS PAY", "SSS", "PhilHealth", "PAGIBIG", "TAX", "DEDUCTION", "NET PAY"];
const pesos = (centavos: number) => centavos / 100;

/** HR's register as its workbook lays it out: a title, headings on row 5, a row a person, totals. */
function register(slips: Payslip[], netOff = 0): Uint8Array {
  const ryan = slips.find((one) => one.person.name === "Ryan") as Payslip;
  const daniel = slips.find((one) => one.person.name === "Daniel") as Payslip;
  const row = (code: string | null, name: string, slip: Payslip, off = 0) => [
    code,
    name,
    pesos(crmFigure(slip, "basic")),
    pesos(crmFigure(slip, "ot")),
    pesos(slip.gross),
    pesos(crmFigure(slip, "sss")),
    pesos(crmFigure(slip, "philhealth")),
    pesos(crmFigure(slip, "pagibig")),
    pesos(crmFigure(slip, "tax")),
    pesos(slip.totalDeductions),
    pesos(slip.net - off),
  ];
  return new Uint8Array(
    workbook([
      { name: "Summary", rows: [["Nothing here"]] },
      {
        name: "PAY REGISTER",
        rows: [
          ["2MG Incorporated"],
          ["Payroll register"],
          [past],
          [],
          HEADINGS,
          // Ryan by his employee ID written loosely; Daniel by name only; someone the CRM hasn't.
          row(" 2mg-0007 ", "RYAN", ryan, netOff),
          row(null, "Daniel", daniel),
          ["2MG-9999", "Zed Nobody", 1000, 0, 1000, 0, 0, 0, 0, 0, 1000],
          [null, "TOTAL", 1, 1, 1, 1, 1, 1, 1, 1, 1],
        ],
      },
    ]),
  );
}

let slips: Payslip[] = [];

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["ryan", "daniel", "naresh", "helen"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
    ids[name] = ((await response.json()) as { me: Me }).me.id;
  }
  await db.execute(sql`update employee set hire_date = '2025-01-01'`);
  for (const [name, salary, code] of [
    ["ryan", 3_000_000, "2MG-0007"],
    ["daniel", 5_000_000, null],
    ["helen", 4_000_000, null],
  ] as const)
    expect(
      (await send("helen", `/api/hr/people/${ids[name]}`, { salary, employeeCode: code }, "PATCH")).status,
    ).toBe(200);
  slips = (await read<PayrollMonth>("helen", `/api/hr/payroll/${past}`)).slips;
});

describe("reading a register", () => {
  it("reads amounts as centavos and employee IDs as one", () => {
    expect(centavosOf("1,150.16")).toBe(115016);
    expect(centavosOf("(100.00)")).toBe(-10000);
    expect(centavosOf("₱ 5")).toBe(500);
    expect(centavosOf("")).toBe(0);
    expect(centavosOf("-")).toBe(0);
    expect(centavosOf("n/a")).toBeNull();
    expect(centavosOf("29123.449999999997")).toBe(2912345);
    expect(codeKey(" 2mg- 0007")).toBe("2MG-0007");
  });

  it("guesses the row the headings are on", () => {
    expect(
      guessHeaderRow({
        name: "PAY REGISTER",
        hidden: false,
        rows: [
          { number: 1, cells: ["2MG"] },
          { number: 5, cells: HEADINGS },
          { number: 6, cells: ["2MG-1", "Ryan", "30000"] },
        ],
      }),
    ).toBe(5);
  });
});

describe("HR's register beside the CRM's month", () => {
  it("lets HR upload it; the CEO reads; nobody else", async () => {
    const bytes = register(slips, 1);
    expect((await upload("naresh", `/api/hr/payroll/${past}/register`, bytes)).status).toBe(403);
    expect((await upload("ryan", `/api/hr/payroll/${past}/register`, bytes)).status).toBe(403);
    expect((await get("ryan", `/api/hr/payroll/${past}/register`)).status).toBe(403);
    expect((await get("daniel", `/api/hr/payroll/${past}/register`)).status).toBe(403);
    expect(
      (await upload("helen", `/api/hr/payroll/${past}/register`, new TextEncoder().encode("not a workbook"))).status,
    ).toBe(400);
    const made = await upload("helen", `/api/hr/payroll/${past}/register`, bytes);
    expect(made.status).toBe(200);
    // No mapping yet: kept, not compared.
    expect(await made.json()).toMatchObject({ compared: false });
    const page = await read<PayRegisterPage>("naresh", `/api/hr/payroll/${past}/register`);
    expect(page.can.upload).toBe(false);
    expect(page.current).toMatchObject({ fits: false, mapping: null, compare: null });
    const sheet = page.current?.sheets.find((one) => one.name === "PAY REGISTER");
    expect(sheet?.guessedRow).toBe(5);
    expect(sheet?.rows.find((one) => one.number === 5)?.cells).toEqual(HEADINGS);
    expect((await read<PayRegisterPage>("helen", `/api/hr/payroll/${past}/register`)).can.upload).toBe(true);
  });

  it("maps the headings once and compares: by ID, a name to confirm, one side only, ₱0.01 flagged", async () => {
    const page = await read<PayRegisterPage>("helen", `/api/hr/payroll/${past}/register`);
    const id = page.current?.id as number;
    const columns = {
      code: "Emp No",
      name: "Employee Name",
      basic: "Basic Pay",
      ot: "OT Amount",
      gross: "GROSS PAY",
      sss: "SSS",
      philhealth: "PhilHealth",
      pagibig: "PAGIBIG",
      tax: "TAX",
      deductions: "DEDUCTION",
      net: "NET PAY",
    };
    const map = { sheet: "PAY REGISTER", headerRow: 5, columns };
    expect((await send("naresh", `/api/hr/payroll/register/${id}/map`, map)).status).toBe(403);
    expect((await send("helen", `/api/hr/payroll/register/${id}/map`, { ...map, columns: { ...columns, net: "Net" } })).status).toBe(400);
    expect((await send("helen", `/api/hr/payroll/register/${id}/map`, { ...map, columns: { net: "NET PAY" } })).status).toBe(400);
    expect((await send("helen", `/api/hr/payroll/register/${id}/map`, { ...map, headerRow: 4 })).status).toBe(400);
    expect((await send("helen", `/api/hr/payroll/register/${id}/map`, map)).status).toBe(200);
    const compared = (await read<PayRegisterPage>("helen", `/api/hr/payroll/${past}/register`)).current;
    expect(compared?.fits).toBe(true);
    const result = compared?.compare;
    expect(result?.crmStatus).toBe("draft");
    // Ryan by his employee ID, every figure the same but net, ₱0.01 apart.
    const ryan = result?.rows.find((one) => one.name === "Ryan");
    expect(ryan).toMatchObject({ match: "code", differs: true });
    expect(ryan?.figures.find((one) => one.field === "net")).toMatchObject({ diff: 1 });
    expect(ryan?.figures.filter((one) => one.diff !== 0).map((one) => one.field)).toEqual(["net"]);
    // Daniel by his exact name: waiting for HR to say it is him.
    expect(result?.toConfirm).toEqual([
      expect.objectContaining({ hrName: "Daniel", personId: ids.daniel, name: "Daniel" }),
    ]);
    expect(result?.onlyHr.map((one) => one.hrName)).toEqual(["Zed Nobody"]);
    expect(result?.onlyCrm.map((one) => one.name)).toContain("Helen");
    expect(result?.onlyCrm.map((one) => one.name)).not.toContain("Daniel");
    // 1 figure, 1 to confirm, 1 on HR's side only, Helen on the CRM's.
    expect(result?.differences).toBe(1 + 1 + 1 + (result?.onlyCrm.length ?? 0));
  });

  it("matches a name once HR confirms it", async () => {
    const page = await read<PayRegisterPage>("helen", `/api/hr/payroll/${past}/register`);
    const id = page.current?.id as number;
    const row = page.current?.compare?.toConfirm[0]?.row as number;
    expect((await send("naresh", `/api/hr/payroll/register/${id}/confirm`, { row, personId: ids.daniel })).status).toBe(403);
    expect((await send("helen", `/api/hr/payroll/register/${id}/confirm`, { row, personId: ids.naresh })).status).toBe(404);
    expect((await send("helen", `/api/hr/payroll/register/${id}/confirm`, { row, personId: ids.daniel })).status).toBe(200);
    expect((await send("helen", `/api/hr/payroll/register/${id}/confirm`, { row, personId: ids.daniel })).status).toBe(409);
    const result = (await read<PayRegisterPage>("helen", `/api/hr/payroll/${past}/register`)).current?.compare;
    expect(result?.toConfirm).toEqual([]);
    expect(result?.rows.find((one) => one.name === "Daniel")).toMatchObject({ match: "name", differs: false });
  });

  it("uses the mapping again for the next file, and keeps every file and comparison", async () => {
    const made = await upload("helen", `/api/hr/payroll/${past}/register`, register(slips));
    expect(await made.json()).toMatchObject({ compared: true });
    const page = await read<PayRegisterPage>("helen", `/api/hr/payroll/${past}/register`);
    expect(page.registers).toHaveLength(2);
    expect(page.current?.compare?.rows.find((one) => one.name === "Ryan")?.differs).toBe(false);
    // The older one is still there to open, with its own comparison.
    const older = page.registers[1]?.id as number;
    const first = await read<PayRegisterPage>("naresh", `/api/hr/payroll/${past}/register?register=${older}`);
    expect(first.current?.compare?.rows.find((one) => one.name === "Daniel")?.match).toBe("name");
    expect((await get("naresh", `/api/hr/payroll/register/${older}/file`)).status).toBe(200);
    expect((await get("ryan", `/api/hr/payroll/register/${older}/file`)).status).toBe(403);
    const [kept] = await rows<{ files: number; compares: number; maps: number }>(
      db,
      sql`select (select count(*) from pay_register)::int as files, (select count(*) from pay_register_compare)::int as compares,
          (select count(*) from pay_register_map)::int as maps`,
    );
    expect(kept).toEqual({ files: 2, compares: 3, maps: 1 });
    expect((await send("helen", `/api/hr/payroll/register/${older}/compare`)).status).toBe(200);
  });
});
