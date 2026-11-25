// Each input of a payslip month moving the slip as PLAN 12.16 and the Labor Code say: an absence and
// leave without pay at monthly × 12 ÷ 313 a day; late and undertime by the person's schedule in
// 15-minute blocks; approved overtime by its type (its first 8 hours and past them); night
// differential shown, not paid; a holiday worked by the person's own holidays (their town's too),
// a local holiday not worked never absent; and a released month frozen.
//
// Ryan earns ₱31,300 a month: a day is ₱1,200 and an hour ₱150, so every line reads by hand.

import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { addDays, todayManila } from "../inventory/rules";
import { seedDemo } from "../seed";
import type { Me, PayrollMonth, Payslip } from "../types";
import { holidaysOf } from "./holidays";
import { type PayMonth, payMonthByKey, payMonthOf, shiftMonth } from "./pay-rules";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
const ids: Record<string, number> = {};
const past = shiftMonth(payMonthOf(todayManila()).key, -1);
const month = payMonthByKey(past) as PayMonth;

const get = (who: string, path: string) =>
  app.request(path, { headers: { cookie: cookies[who] as string } });
const read = async <T>(who: string, path: string) => (await (await get(who, path)).json()) as T;
const send = (who: string, path: string, body: unknown = {}, method = "POST") =>
  app.request(path, {
    method,
    headers: { "content-type": "application/json", cookie: cookies[who] as string },
    body: JSON.stringify(body),
  });
const ryanSlip = async () =>
  (await read<PayrollMonth>("helen", `/api/hr/payroll/${past}`)).slips.find(
    (one) => one.person.name === "Ryan",
  ) as Payslip;
const amount = (slip: Payslip, key: string) =>
  [...slip.earnings, ...slip.less, ...slip.deductions].find((one) => one.key === key)?.amount ?? 0;

async function workDay(personId: number, day: string, from = "07:00", to = "16:00") {
  await db.execute(
    sql`insert into attendance (person_id, day, time_in, in_source, time_out, out_source, last_seen)
      values (${personId}, ${day}::date, (${day}::date + ${from}::time) at time zone 'Asia/Manila', 'hr',
        (${day}::date + ${to}::time) at time zone 'Asia/Manila', 'hr',
        (${day}::date + ${to}::time) at time zone 'Asia/Manila')`,
  );
}
async function overtime(personId: number, day: string, type: string, minutes: number, night = 0, from = "07:00", to = "18:00") {
  await db.execute(
    sql`insert into hr_form (person_id, kind, day, from_time, to_time, reason, status, made_by, decided_by, decided_at,
        ot_type, ot_minutes, ot_night_minutes)
      values (${personId}, 'ot', ${day}::date, ${from}::time, ${to}::time, 'Work', 'approved', ${personId},
        ${ids.helen}, now(), ${type}, ${minutes}, ${night})`,
  );
}

/** Monday-to-Saturday days of the month that are nobody's holiday in Metro Manila or Cebu. */
let W: string[] = [];
let sunday = "";

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["ryan", "naresh", "helen"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
    ids[name] = ((await response.json()) as { me: Me }).me.id;
  }
  await db.execute(sql`delete from attendance`);
  await db.execute(sql`delete from hr_form`);
  await db.execute(sql`update employee set hire_date = '2025-01-01'`);
  expect(
    (await send("helen", `/api/hr/people/${ids.ryan}`, { salary: 3_130_000 }, "PATCH")).status,
  ).toBe(200);
  const ryan = ids.ryan as number;
  for (let at = month.from; at <= month.to; at = addDays(at, 1)) {
    const weekday = new Date(`${at}T00:00:00Z`).getUTCDay();
    if (weekday === 0) {
      if (!sunday) sunday = at;
      continue;
    }
    const [busy] = await rows<{ n: number }>(
      db,
      sql`select ((select count(*) from holiday where active and day = ${at}::date)
          + (select count(*) from local_holiday where active and day = ${at}::date
              and province in ('Metro Manila', 'Cebu')))::int as n`,
    );
    if (Number(busy?.n ?? 0) === 0) W.push(at);
  }
  expect(W.length).toBeGreaterThan(12);
  // HR's local holidays: two of Metro Manila (Ryan's by his seat's area), one of Cebu (not his).
  for (const [day, kind, province, name] of [
    [W[4], "special", "Metro Manila", "Metro special day"],
    [W[5], "special", "Metro Manila", "Metro day off"],
    [W[6], "regular", "Metro Manila", "Metro regular holiday"],
    [W[7], "special", "Cebu", "Cebu day"],
  ] as const)
    expect((await send("helen", "/api/hr/holidays", { day, kind, province, name })).status).toBe(200);
  // Ryan works every one of his working days but W[0] (absent) and W[1] (leave without pay);
  // W[2] late and short; on his holidays W[4] and W[6] too; W[5] he stays home.
  const own = (await holidaysOf(db, [ryan], month.from, month.to)).get(ryan) ?? new Map();
  for (let at = month.from; at <= month.to; at = addDays(at, 1)) {
    if (new Date(`${at}T00:00:00Z`).getUTCDay() === 0) continue;
    if ([W[0], W[1], W[5]].includes(at)) continue;
    if (own.has(at) && at !== W[4] && at !== W[6]) continue;
    if (at === W[2]) await workDay(ryan, at, "07:20", "15:00");
    else await workDay(ryan, at);
  }
  await db.execute(
    sql`insert into person_leave (person_id, kind, from_day, to_day, half_day, reason, made_by, decided_by, decided_at)
      values (${ryan}, 'lwop', ${W[1]}::date, ${W[1]}::date, false, 'Family', ${ids.helen}, ${ids.helen}, now())`,
  );
  // Overtime: 2 hours after work (1 of it at night), 10 hours on his Sunday rest day, 9 hours on
  // the regular holiday W[6].
  await overtime(ryan, W[3] as string, "regular", 120, 60, "16:00", "18:00");
  await overtime(ryan, sunday, "rest", 600);
  await overtime(ryan, W[6] as string, "legal", 540);
});

describe("a payslip month's inputs", () => {
  it("takes off an absence and leave without pay at a day's rate", async () => {
    const slip = await ryanSlip();
    expect(slip.dailyRate).toBe(120_000);
    expect(slip.hourlyRate).toBe(15_000);
    // W[5] is his own holiday: never absent though he stayed home.
    expect(slip.attendance).toMatchObject({ absent: 1, unpaidLeave: 1 });
    expect(amount(slip, "absent")).toBe(120_000);
    expect(amount(slip, "unpaid_leave")).toBe(120_000);
  });

  it("takes off late and undertime by his schedule, in 15-minute blocks", async () => {
    const slip = await ryanSlip();
    // In at 7:20 on a 7:00 day: 20 minutes, a 30-minute block; out at 15:00 of 16:00: an hour.
    expect(slip.attendance).toMatchObject({ lateMinutes: 30, undertimeMinutes: 60 });
    expect(amount(slip, "late")).toBe(7_500);
    expect(amount(slip, "undertime")).toBe(15_000);
  });

  it("pays approved overtime by its type, and shows night differential without paying it", async () => {
    const slip = await ryanSlip();
    expect(amount(slip, "ot_regular")).toBe(37_500); // 2 h × ₱150 × 125%
    expect(amount(slip, "ot_rest")).toBe(156_000); // 8 h × ₱150 × 130%
    expect(amount(slip, "ot_rest_over8")).toBe(50_700); // 2 h × ₱150 × 169%
    expect(amount(slip, "ot_legal")).toBe(120_000); // 8 h × ₱150 × +100%
    expect(amount(slip, "ot_legal_over8")).toBe(39_000); // 1 h × ₱150 × 260%
    expect(slip.attendance.nightMinutes).toBe(60);
    expect(slip.notes?.find((one) => one.key === "night")?.detail).toContain("not paid");
    expect(slip.earnings.some((one) => one.key.includes("night"))).toBe(false);
  });

  it("pays a holiday worked by his own holidays: his town's, not another's, never twice", async () => {
    const slip = await ryanSlip();
    // W[4], Metro Manila's special day, worked with no overtime form: +30% of the day.
    expect(amount(slip, "holiday_special")).toBe(36_000);
    // W[6] has a regular holiday overtime form: its premium is the form's, not a day's on top.
    expect(amount(slip, "holiday_regular")).toBe(0);
    expect(slip.attendance.holidaysWorked).toEqual({ regular: 0, special: 1 });
    // Cebu's day W[7] is a working day for him.
    expect(slip.attendance.holidays?.local).toBeGreaterThanOrEqual(3);
    expect(slip.notes?.some((one) => one.key === "local_holidays")).toBe(true);
    // Every line adds up.
    const earned = slip.earnings.reduce((sum, one) => sum + one.amount, 0);
    const off = slip.less.reduce((sum, one) => sum + one.amount, 0);
    expect(slip.gross).toBe(earned - off);
    expect(slip.net).toBe(slip.gross - slip.totalDeductions);
  });

  it("keeps a released month as it was: nothing recomputed", async () => {
    const before = await ryanSlip();
    expect((await send("helen", `/api/hr/payroll/${past}/release`)).status).toBe(200);
    await db.execute(sql`delete from attendance where person_id = ${ids.ryan} and day = ${W[8]}::date`);
    await db.execute(sql`update hr_form set status = 'revoked' where person_id = ${ids.ryan}`);
    const after = await ryanSlip();
    expect(after.net).toBe(before.net);
    expect(after.attendance.absent).toBe(1);
    expect(amount(after, "ot_rest")).toBe(156_000);
    expect((await read<PayrollMonth>("naresh", `/api/hr/payroll/${past}`)).status).toBe("released");
  });
});
