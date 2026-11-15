// Payroll as people use it: HR's draft follows the DTR, HR adds its own lines and releases an ended
// cut-off; released payslips are frozen; each person reads only their own; the CEO reads the
// register and changes nothing; nobody else sees anyone's pay.

import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { addDays, todayManila } from "../inventory/rules";
import { seedDemo } from "../seed";
import type { Me, MyPayslips, PayrollCutoff, PayrollList, Payslip } from "../types";
import { type Cutoff, cutoffByKey, cutoffOf, firstHalfOf, shiftCutoff } from "./pay-rules";
import { DEFAULT_SCHEDULE, isWorkDay } from "./work-time";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
const ids: Record<string, number> = {};
const now = cutoffOf(todayManila()).key;
// The last cut-off that has ended, and the last whole month (a and b both ended).
const past = shiftCutoff(now, -1);
const monthB = past.endsWith("-b") ? past : shiftCutoff(past, -1);
const monthA = firstHalfOf(monthB);

const get = (who: string, path: string) =>
  app.request(path, { headers: { cookie: cookies[who] as string } });
const read = async <T>(who: string, path: string) => (await (await get(who, path)).json()) as T;
const send = (who: string, path: string, body: unknown = {}, method = "POST") =>
  app.request(path, {
    method,
    headers: { "content-type": "application/json", cookie: cookies[who] as string },
    body: JSON.stringify(body),
  });
const slipOf = (register: PayrollCutoff, name: string) =>
  register.slips.find((one) => one.person.name === name) as Payslip;
const line = (slip: Payslip, key: string) =>
  [...slip.earnings, ...slip.less, ...slip.deductions].find((one) => one.key === key)?.amount ?? 0;

/** A full day, 7:00 to 16:00, on every working day of a cut-off except the ones skipped. */
async function workAll(personId: number, cutoff: Cutoff, skip: string[] = [], late: string[] = []) {
  const holidays = new Set(
    (
      await rows<{ day: string }>(
        db,
        sql`select to_char(day, 'YYYY-MM-DD') as day from holiday where active`,
      )
    ).map((one) => one.day),
  );
  for (let at = cutoff.from; at <= cutoff.to; at = addDays(at, 1)) {
    if (!isWorkDay(at, DEFAULT_SCHEDULE, holidays) || skip.includes(at)) continue;
    const starts = late.includes(at) ? "07:40" : "07:00";
    await db.execute(
      sql`insert into attendance (person_id, day, time_in, in_source, time_out, out_source, last_seen)
        values (${personId}, ${at}::date, (${at}::date + ${starts}::time) at time zone 'Asia/Manila', 'hr',
          (${at}::date + time '16:00') at time zone 'Asia/Manila', 'hr',
          (${at}::date + time '16:00') at time zone 'Asia/Manila')
        on conflict (person_id, day) do nothing`,
    );
  }
}
const workDaysOf = async (cutoff: Cutoff) => {
  const holidays = new Set(
    (
      await rows<{ day: string }>(
        db,
        sql`select to_char(day, 'YYYY-MM-DD') as day from holiday where active`,
      )
    ).map((one) => one.day),
  );
  const out: string[] = [];
  for (let at = cutoff.from; at <= cutoff.to; at = addDays(at, 1))
    if (isWorkDay(at, DEFAULT_SCHEDULE, holidays)) out.push(at);
  return out;
};

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["ryan", "daniel", "naresh", "fiona", "helen"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
    ids[name] = ((await response.json()) as { me: Me }).me.id;
  }
  await db.execute(sql`delete from attendance`);
  await db.execute(sql`update employee set hire_date = '2025-01-01'`);
  // HR puts the pay on the records.
  for (const [name, salary, allowance] of [
    ["ryan", 3_000_000, 200_000],
    ["daniel", 5_000_000, null],
  ] as const)
    expect(
      (await send("helen", `/api/hr/people/${ids[name]}`, { salary, allowance }, "PATCH")).status,
    ).toBe(200);
  const pastDays = await workDaysOf(cutoffByKey(past) as Cutoff);
  await workAll(
    ids.ryan as number,
    cutoffByKey(past) as Cutoff,
    [pastDays[0] as string],
    [pastDays[1] as string],
  );
  for (const key of [monthA, monthB])
    await workAll(ids.daniel as number, cutoffByKey(key) as Cutoff);
});

describe("payroll", () => {
  it("lists the cut-offs for HR and the CEO; nobody else", async () => {
    const list = await read<PayrollList>("helen", "/api/hr/payroll");
    expect(list.periods).toHaveLength(12);
    expect(list.periods[0]).toMatchObject({ key: now, status: "running" });
    expect(list.periods[1]).toMatchObject({ key: past, status: "ready", people: null });
    expect((await get("naresh", "/api/hr/payroll")).status).toBe(200);
    for (const who of ["ryan", "daniel", "fiona"])
      expect((await get(who, `/api/hr/payroll/${past}`)).status).toBe(403);
  });

  it("works each slip out from the DTR: absent, late, the shares and tax", async () => {
    const register = await read<PayrollCutoff>("helen", `/api/hr/payroll/${past}`);
    expect(register.can).toEqual({ adjust: true, release: true });
    expect(register.noSalary.map((one) => one.name)).toContain("Fiona");
    const ryan = slipOf(register, "Ryan");
    expect(ryan.attendance).toMatchObject({ absent: 1, lateMinutes: 45 });
    // ₱30,000 × 12 ÷ 313 = ₱1,150.16 a day; 45 minutes at ₱143.77 an hour.
    expect(line(ryan, "absent")).toBe(115016);
    expect(line(ryan, "late")).toBe(10783);
    expect(line(ryan, "basic")).toBe(1_500_000);
    expect(line(ryan, "allowance")).toBe(100_000);
    expect(line(ryan, "pagibig")).toBe(10_000);
    expect(ryan.net).toBe(ryan.gross - ryan.totalDeductions);
    expect(register.totals.people).toBe(register.slips.length);
    const ceo = await read<PayrollCutoff>("naresh", `/api/hr/payroll/${past}`);
    expect(ceo.can).toEqual({ adjust: false, release: false });
    expect(slipOf(ceo, "Ryan").net).toBe(ryan.net);
  });

  it("settles SSS and PhilHealth over the month's two cut-offs", async () => {
    const a = slipOf(await read<PayrollCutoff>("helen", `/api/hr/payroll/${monthA}`), "Daniel");
    const b = slipOf(await read<PayrollCutoff>("helen", `/api/hr/payroll/${monthB}`), "Daniel");
    // ₱50,000: the month's most, ₱1,750 of SSS; PhilHealth 2.5% each, ₱1,250.
    expect(line(a, "sss") + line(b, "sss")).toBe(175_000);
    expect(line(a, "philhealth") + line(b, "philhealth")).toBe(125_000);
    expect(line(a, "pagibig") + line(b, "pagibig")).toBe(20_000);
  });

  it("lets HR add and take off its own lines; the CEO can't", async () => {
    const before = slipOf(await read<PayrollCutoff>("helen", `/api/hr/payroll/${past}`), "Ryan");
    const advance = {
      personId: ids.ryan,
      label: "Cash advance",
      kind: "deduction",
      amount: 100_000,
    };
    expect((await send("naresh", `/api/hr/payroll/${past}/lines`, advance)).status).toBe(403);
    expect(
      (await send("helen", `/api/hr/payroll/${past}/lines`, { ...advance, amount: 0 })).status,
    ).toBe(400);
    expect(
      (await send("helen", `/api/hr/payroll/${past}/lines`, { ...advance, label: " " })).status,
    ).toBe(400);
    const made = (await (await send("helen", `/api/hr/payroll/${past}/lines`, advance)).json()) as {
      id: number;
    };
    const rice = {
      personId: ids.ryan,
      label: "Rice",
      kind: "earning",
      taxable: false,
      amount: 50_000,
    };
    const riceId = (
      (await (await send("helen", `/api/hr/payroll/${past}/lines`, rice)).json()) as { id: number }
    ).id;
    const after = slipOf(await read<PayrollCutoff>("helen", `/api/hr/payroll/${past}`), "Ryan");
    expect(line(after, `adj_${made.id}`)).toBe(100_000);
    expect(after.net).toBe(before.net - 100_000 + 50_000);
    // Not taxable: tax and SSS are reckoned without it.
    expect(after.taxable).toBe(before.taxable);
    expect((await send("helen", `/api/hr/payroll/lines/${riceId}/remove`)).status).toBe(200);
    expect((await send("helen", `/api/hr/payroll/lines/${riceId}/remove`)).status).toBe(404);
  });

  it("releases only an ended cut-off, once; then it's frozen and each person reads their own", async () => {
    expect((await send("helen", `/api/hr/payroll/${now}/release`)).status).toBe(409);
    expect((await send("naresh", `/api/hr/payroll/${past}/release`)).status).toBe(403);
    const draft = slipOf(await read<PayrollCutoff>("helen", `/api/hr/payroll/${past}`), "Ryan");
    const released = await send("helen", `/api/hr/payroll/${past}/release`);
    expect(released.status).toBe(200);
    expect((await send("helen", `/api/hr/payroll/${past}/release`)).status).toBe(409);
    expect(
      (
        await send("helen", `/api/hr/payroll/${past}/lines`, {
          personId: ids.ryan,
          label: "Late fix",
          kind: "earning",
          amount: 1000,
        })
      ).status,
    ).toBe(409);
    const [told] = await rows<{ n: number }>(
      db,
      sql`select count(*)::int as n from notification where person_id = ${ids.ryan} and kind = 'payslip'`,
    );
    expect(told?.n).toBe(1);
    // A day put right afterwards doesn't change what was released.
    await db.execute(sql`delete from attendance where person_id = ${ids.ryan}`);
    const frozen = await read<PayrollCutoff>("helen", `/api/hr/payroll/${past}`);
    expect(frozen.status).toBe("released");
    expect(frozen.can).toEqual({ adjust: false, release: false });
    expect(slipOf(frozen, "Ryan").net).toBe(draft.net);
    const mine = await read<MyPayslips>("ryan", "/api/hr/payslips/mine");
    expect(mine.slips.map((one) => one.cutoff)).toEqual([past]);
    expect(mine.slips[0]?.net).toBe(draft.net);
    const slip = await read<{ slip: Payslip }>("ryan", `/api/hr/payslips/${past}`);
    expect(slip.slip.person.name).toBe("Ryan");
    expect((await get("ryan", `/api/hr/payslips/${now}`)).status).toBe(404);
    expect((await get("ryan", `/api/hr/payroll/${past}/slip/${ids.daniel}`)).status).toBe(403);
    expect((await get("naresh", `/api/hr/payroll/${past}/slip/${ids.ryan}`)).status).toBe(200);
    const list = await read<PayrollList>("naresh", "/api/hr/payroll");
    expect(list.periods[1]).toMatchObject({ status: "released", people: frozen.totals.people });
  });

  it("gives the register as a sheet, and drops a scheme HR marks not covered", async () => {
    const csv = await get("naresh", `/api/hr/payroll/${past}/register.csv`);
    expect(csv.headers.get("content-type")).toContain("text/csv");
    const text = await csv.text();
    expect(text.split("\n")[0]).toContain("Net pay");
    expect(text).toContain("Ryan");
    expect(
      (await send("helen", `/api/hr/people/${ids.daniel}`, { noPagibig: true }, "PATCH")).status,
    ).toBe(200);
    const draft = slipOf(await read<PayrollCutoff>("helen", `/api/hr/payroll/${now}`), "Daniel");
    expect(draft.deductions.find((one) => one.key === "pagibig")).toMatchObject({
      amount: 0,
      detail: "not covered",
    });
    expect(
      (await send("ryan", `/api/hr/people/${ids.ryan}`, { noTax: true }, "PATCH")).status,
    ).toBe(403);
  });
});
