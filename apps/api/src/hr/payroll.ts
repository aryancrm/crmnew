// Payroll, HR's work: each cut-off's payslips are worked out from the DTR as it stands (attendance,
// leave, forms), so a day HR puts right shows on the slip at once. HR adds its own lines (a loan, a
// cash advance, a correction) and, once the cut-off has ended, releases it: the payslips are frozen
// as they were and each person reads their own. The CEO and the Admin read the register; nobody
// else sees anyone's pay. The arithmetic is src/hr/pay-rules.ts.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { allow, Refusal } from "../http";
import { todayManila } from "../inventory/rules";
import { clean, iso, type Runner } from "../inventory/service";
import { notify } from "../notify/service";
import type {
  Company,
  Me,
  MyPayslips,
  PayAdjustmentInput,
  PayPeriod,
  PayRuleRow,
  PayrollCutoff,
  PayrollList,
  Payslip,
} from "../types";
import { attendanceDays } from "./attendance";
import {
  type Cutoff,
  computeSlip,
  cutoffByKey,
  cutoffOf,
  firstHalfOf,
  type PayAdjustment,
  type PayAttendance,
  type PayRules,
  payDayOf,
  shiftCutoff,
} from "./pay-rules";
import { HR_ROLES, HR_WRITE_ROLES } from "./people";
import { isWorkDay } from "./work-time";

const MOST = 100_000_000; // ₱1,000,000: one line can't be more.

const shortDay = (day: string, withYear = false) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-PH", {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
export const cutoffLabel = (cutoff: Cutoff) =>
  `${shortDay(cutoff.from)} – ${shortDay(cutoff.to, true)}`;

function cutoffOrRefuse(key: string): Cutoff {
  const cutoff = cutoffByKey(key);
  if (!cutoff) throw new Refusal(404, "not_found", "No such cut-off.");
  return cutoff;
}

async function rulesOn(db: Runner, day: string): Promise<PayRules> {
  const found = await rows<{ kind: keyof PayRules; rule: unknown }>(
    db,
    sql`select distinct on (kind) kind, rule from pay_rule where starts_on <= ${day}::date
      order by kind, starts_on desc`,
  );
  const by = Object.fromEntries(
    found.map((row) => [row.kind, typeof row.rule === "string" ? JSON.parse(row.rule) : row.rule]),
  ) as Partial<PayRules>;
  if (!by.sss || !by.philhealth || !by.pagibig || !by.tax)
    throw new Refusal(
      409,
      "no_rules",
      `The pay rates in force on ${shortDay(day, true)} aren't set up.`,
    );
  return by as PayRules;
}

async function payDay(db: Runner, cutoff: Cutoff): Promise<string> {
  const found = await rows<{ day: string }>(
    db,
    sql`select to_char(day, 'YYYY-MM-DD') as day from holiday where active
      and day between (${cutoff.payOn}::date - 10) and ${cutoff.payOn}::date`,
  );
  return payDayOf(cutoff, new Set(found.map((one) => one.day)));
}

type Employee = {
  id: number;
  name: string;
  company: Company;
  employeeCode: string | null;
  position: string | null;
  department: string | null;
  hiredOn: string;
  leftOn: string | null;
  salary: number | null;
  allowance: number | null;
  noSss: boolean;
  noPhilhealth: boolean;
  noPagibig: boolean;
  noTax: boolean;
  bankName: string | null;
  bankAccount: string | null;
};

/** Everyone employed for some of the cut-off (the Admin's login isn't anyone's employee). */
async function employeesIn(db: Runner, cutoff: Cutoff): Promise<Employee[]> {
  return rows<Employee>(
    db,
    sql`select p.id::int as id, p.name, e.company, e.employee_code as "employeeCode", e.position, e.department,
        to_char(e.hire_date, 'YYYY-MM-DD') as "hiredOn", to_char(e.left_on, 'YYYY-MM-DD') as "leftOn",
        e.salary, e.allowance, e.no_sss as "noSss", e.no_philhealth as "noPhilhealth",
        e.no_pagibig as "noPagibig", e.no_tax as "noTax", e.bank_name as "bankName",
        e.bank_account as "bankAccount"
      from employee e join person p on p.id = e.person_id
      where p.role <> 'admin' and e.hire_date <= ${cutoff.to}::date
        and (e.status = 'active' or (e.left_on is not null and e.left_on >= ${cutoff.from}::date))
      order by p.name`,
  );
}

type Prior = {
  sssBase: number;
  sss: number;
  sssEmployer: number;
  philhealth: number;
  philhealthEmployer: number;
};
const lineOf = (slip: Payslip, key: string) =>
  slip.deductions.find((one) => one.key === key)?.amount ?? 0;
const priorOf = (slip: Payslip): Prior => ({
  sssBase: slip.sssBase,
  sss: lineOf(slip, "sss"),
  sssEmployer: slip.employer?.sss ?? 0,
  philhealth: lineOf(slip, "philhealth"),
  philhealthEmployer: slip.employer?.philhealth ?? 0,
});

async function releasedSlips(db: Runner, key: string): Promise<Payslip[] | null> {
  const [run] = await rows<{ id: number }>(
    db,
    sql`select id::int as id from pay_run where cutoff = ${key}`,
  );
  if (!run) return null;
  const found = await rows<{ slip: Payslip | string }>(
    db,
    sql`select slip from payslip where run_id = ${run.id} order by slip->'person'->>'name'`,
  );
  return found.map((one) => (typeof one.slip === "string" ? JSON.parse(one.slip) : one.slip));
}

/** A cut-off's payslips worked out from the DTR as it stands, with HR's lines. */
async function workOut(
  db: Runner,
  cutoff: Cutoff,
): Promise<{ slips: Payslip[]; noSalary: Employee[] }> {
  const people = await employeesIn(db, cutoff);
  const paid = people.filter((one) => one.salary !== null && one.salary > 0);
  const noSalary = people.filter((one) => !(one.salary !== null && one.salary > 0));
  if (!paid.length) return { slips: [], noSalary };
  const rules = await rulesOn(db, cutoff.to);
  const holidayKinds = new Map(
    (
      await rows<{ day: string; kind: "regular" | "special" }>(
        db,
        sql`select to_char(day, 'YYYY-MM-DD') as day, kind from holiday where active
          and day between ${cutoff.from}::date and ${cutoff.to}::date`,
      )
    ).map((one) => [one.day, one.kind]),
  );
  const holidaySet = new Set(holidayKinds.keys());
  const worked = await attendanceDays(db, paid, cutoff.from, cutoff.to);
  const adjustments = await rows<PayAdjustment & { personId: number }>(
    db,
    sql`select id::int as id, person_id::int as "personId", label, kind, taxable, amount, note
      from pay_adjustment where cutoff = ${cutoff.key} and removed_at is null order by id`,
  );
  // Cut-off b settles SSS and PhilHealth with the same month's a: as released, else as it stands.
  const prior = new Map<number, Prior>();
  if (cutoff.half === "b") {
    const firstKey = firstHalfOf(cutoff.key);
    const first =
      (await releasedSlips(db, firstKey)) ??
      (await workOut(db, cutoffByKey(firstKey) as Cutoff)).slips;
    for (const slip of first) prior.set(slip.person.id, priorOf(slip));
  }

  const slips = paid.map((person): Payslip => {
    const { schedule, days } = worked.get(person.id) ?? { schedule: null, days: [] };
    const a: PayAttendance = {
      workDays: 0,
      present: 0,
      absent: 0,
      unpaidLeave: 0,
      paidLeave: { vl: 0, sl: 0, other: 0 },
      notEmployed: 0,
      lateMinutes: 0,
      undertimeMinutes: 0,
      overtime: { ordinary: 0, restDay: 0, specialHoliday: 0, regularHoliday: 0 },
      holidaysWorked: { regular: 0, special: 0 },
    };
    for (const day of days) {
      const work = schedule ? isWorkDay(day.day, schedule, holidaySet) : false;
      const employed = day.day >= person.hiredOn && (!person.leftOn || day.day <= person.leftOn);
      if (!employed) {
        if (work) a.notEmployed += 1;
        continue;
      }
      if (work) a.workDays += 1;
      if (work && (day.timeIn || day.form)) a.present += 1;
      if (day.absent) a.absent += 1;
      if (day.leave) {
        const share = day.halfDay ? 0.5 : 1;
        if (day.leave === "lwop") a.unpaidLeave += share;
        else a.paidLeave[day.leave] += share;
      }
      a.lateMinutes += day.lateMinutes;
      a.undertimeMinutes += day.undertimeMinutes;
      const holiday = holidayKinds.get(day.day);
      if (day.overtimeMinutes > 0)
        a.overtime[
          holiday === "regular"
            ? "regularHoliday"
            : holiday === "special"
              ? "specialHoliday"
              : work
                ? "ordinary"
                : "restDay"
        ] += day.overtimeMinutes;
      if (holiday && day.timeIn) a.holidaysWorked[holiday] += 1;
    }
    const figures = computeSlip({
      rules,
      monthlySalary: person.salary as number,
      monthlyAllowance: person.allowance ?? 0,
      half: cutoff.half,
      attendance: a,
      adjustments: adjustments.filter((one) => one.personId === person.id),
      exempt: {
        sss: person.noSss,
        philhealth: person.noPhilhealth,
        pagibig: person.noPagibig,
        tax: person.noTax,
      },
      prior: prior.get(person.id) ?? null,
      firstCutoff: person.hiredOn >= cutoff.from,
    });
    return {
      cutoff: cutoff.key,
      person: {
        id: person.id,
        name: person.name,
        employeeCode: person.employeeCode,
        company: person.company,
        position: person.position,
        department: person.department,
      },
      monthlySalary: person.salary as number,
      monthlyAllowance: person.allowance ?? 0,
      dailyRate: figures.dailyRate,
      hourlyRate: figures.hourlyRate,
      attendance: a,
      earnings: figures.earnings,
      less: figures.less,
      gross: figures.gross,
      sssBase: figures.sssBase,
      taxable: figures.taxable,
      deductions: figures.deductions,
      totalDeductions: figures.totalDeductions,
      net: figures.net,
      employer: {
        sss: figures.sss.employer,
        philhealth: figures.philhealth.employer,
        pagibig: figures.pagibig.employer,
        total: figures.sss.employer + figures.philhealth.employer + figures.pagibig.employer,
      },
      bank: { name: person.bankName, account: person.bankAccount },
    };
  });
  return { slips, noSalary };
}

function totalsOf(slips: Payslip[]): PayrollCutoff["totals"] {
  const byCompany = new Map<Company, { company: Company; people: number; net: number }>();
  for (const slip of slips) {
    const one = byCompany.get(slip.person.company) ?? {
      company: slip.person.company,
      people: 0,
      net: 0,
    };
    one.people += 1;
    one.net += slip.net;
    byCompany.set(slip.person.company, one);
  }
  const sum = (pick: (slip: Payslip) => number) => slips.reduce((t, one) => t + pick(one), 0);
  return {
    people: slips.length,
    gross: sum((one) => one.gross),
    deductions: sum((one) => one.totalDeductions),
    tax: sum((one) => one.deductions.find((line) => line.key === "tax")?.amount ?? 0),
    net: sum((one) => one.net),
    employer: sum((one) => one.employer?.total ?? 0),
    byCompany: [...byCompany.values()],
  };
}

async function periodOf(db: Runner, cutoff: Cutoff, today: string): Promise<PayPeriod> {
  const [run] = await rows<{ by: string; at: string; payDay: string }>(
    db,
    sql`select p.name as by, ${iso("r.released_at")} as at,
        to_char(r.pay_day, 'YYYY-MM-DD') as "payDay"
      from pay_run r join person p on p.id = r.released_by where r.cutoff = ${cutoff.key}`,
  );
  return {
    key: cutoff.key,
    label: cutoffLabel(cutoff),
    from: cutoff.from,
    to: cutoff.to,
    payDay: run?.payDay ?? (await payDay(db, cutoff)),
    status: run ? "released" : cutoff.to < today ? "ready" : "running",
    released: run ? { by: run.by, at: run.at } : null,
  };
}

/** The cut-offs: this one and the eleven before it (six months), the released ones with their totals. */
export async function payrollList(db: Database, me: Me): Promise<PayrollList> {
  allow(me, HR_ROLES, "read payroll");
  const today = todayManila();
  const keys = [cutoffOf(today).key];
  for (let at = 1; at < 12; at += 1) keys.push(shiftCutoff(keys[0] as string, -at));
  const runs = new Map(
    (
      await rows<{ cutoff: string; people: number; gross: number; net: number }>(
        db,
        sql`select cutoff, people::int as people, gross::bigint::float8 as gross, net::bigint::float8 as net
          from pay_run where cutoff in (${sql.join(
            keys.map((key) => sql`${key}`),
            sql`, `,
          )})`,
      )
    ).map((one) => [one.cutoff, one]),
  );
  const periods = [];
  for (const key of keys) {
    const period = await periodOf(db, cutoffByKey(key) as Cutoff, today);
    const run = runs.get(key);
    periods.push({
      ...period,
      people: run?.people ?? null,
      gross: run ? Number(run.gross) : null,
      net: run ? Number(run.net) : null,
    });
  }
  return { periods };
}

/** One cut-off's register: released (frozen) or as it stands from the DTR. */
export async function payrollCutoff(db: Database, me: Me, key: string): Promise<PayrollCutoff> {
  allow(me, HR_ROLES, "read payroll");
  const cutoff = cutoffOrRefuse(key);
  const today = todayManila();
  const period = await periodOf(db, cutoff, today);
  const released = await releasedSlips(db, key);
  const { slips, noSalary } = released
    ? { slips: released, noSalary: [] as Employee[] }
    : await workOut(db, cutoff);
  const writer = HR_WRITE_ROLES.includes(me.role) && !me.viewedBy;
  const whyNotRelease =
    period.status === "released"
      ? null
      : period.status === "running"
        ? `This cut-off runs to ${shortDay(cutoff.to)}; it can be released from ${shortDay(
            cutoffByKey(shiftCutoff(key, 1))?.from ?? cutoff.to,
          )}.`
        : slips.length === 0
          ? "Nobody here has a salary on record."
          : null;
  const next = cutoffByKey(shiftCutoff(key, 1)) as Cutoff;
  return {
    ...period,
    slips,
    noSalary: noSalary.map((one) => ({ id: one.id, name: one.name, position: one.position })),
    totals: totalsOf(slips),
    can: {
      adjust: writer && period.status !== "released",
      release: writer && period.status === "ready" && slips.length > 0,
    },
    whyNotRelease: writer ? whyNotRelease : null,
    before: shiftCutoff(key, -1),
    after: next.from <= today ? next.key : null,
  };
}

/** HR adds a line to someone's payslip while the cut-off is a draft. */
export async function addAdjustment(
  db: Database,
  me: Me,
  key: string,
  input: PayAdjustmentInput,
): Promise<{ id: number }> {
  allow(me, HR_WRITE_ROLES, "change payslips");
  if (me.viewedBy) throw new Refusal(403, "not_allowed", "Look-only: nothing changes.");
  const cutoff = cutoffOrRefuse(key);
  const label = clean(input.label);
  if (!label) throw new Refusal(400, "invalid", "Name the line (cash advance, loan…).", "label");
  if (label.length > 80) throw new Refusal(400, "invalid", "Keep the name short.", "label");
  if (input.kind !== "earning" && input.kind !== "deduction")
    throw new Refusal(400, "invalid", "Pick whether it adds or takes off.", "kind");
  if (!Number.isInteger(input.amount) || input.amount <= 0 || input.amount > MOST)
    throw new Refusal(400, "invalid", "Type the amount in pesos.", "amount");
  return db.transaction(async (tx) => {
    const [run] = await rows<{ id: number }>(
      tx,
      sql`select id::int as id from pay_run where cutoff = ${key}`,
    );
    if (run)
      throw new Refusal(409, "released", "This cut-off is released; add it to the next one.");
    const [person] = await rows<{ name: string }>(
      tx,
      sql`select p.name from employee e join person p on p.id = e.person_id
        where e.person_id = ${input.personId} and e.hire_date <= ${cutoff.to}::date
          and (e.status = 'active' or e.left_on >= ${cutoff.from}::date)`,
    );
    if (!person)
      throw new Refusal(
        404,
        "not_found",
        "That person isn't employed in this cut-off.",
        "personId",
      );
    const [made] = await rows<{ id: number }>(
      tx,
      sql`insert into pay_adjustment (cutoff, person_id, label, kind, taxable, amount, note, made_by)
        values (${key}, ${input.personId}, ${label}, ${input.kind},
          ${input.kind === "deduction" ? true : input.taxable !== false}, ${input.amount},
          ${clean(input.note) ?? null}, ${me.id})
        returning id::int as id`,
    );
    return { id: made?.id as number };
  });
}

export async function removeAdjustment(db: Database, me: Me, id: number): Promise<void> {
  allow(me, HR_WRITE_ROLES, "change payslips");
  if (me.viewedBy) throw new Refusal(403, "not_allowed", "Look-only: nothing changes.");
  await db.transaction(async (tx) => {
    const [line] = await rows<{ cutoff: string; removed: boolean }>(
      tx,
      sql`select cutoff, removed_at is not null as removed from pay_adjustment where id = ${id} for update`,
    );
    if (!line || line.removed) throw new Refusal(404, "not_found", "No such line.");
    const [run] = await rows<{ id: number }>(
      tx,
      sql`select id::int as id from pay_run where cutoff = ${line.cutoff}`,
    );
    if (run) throw new Refusal(409, "released", "This cut-off is released; it stays as it was.");
    await tx.execute(
      sql`update pay_adjustment set removed_at = now(), removed_by = ${me.id} where id = ${id}`,
    );
  });
}

/** HR releases an ended cut-off: its payslips are frozen and each person is told. */
export async function releaseCutoff(
  db: Database,
  me: Me,
  key: string,
): Promise<{ people: number; net: number }> {
  allow(me, HR_WRITE_ROLES, "release payslips");
  if (me.viewedBy) throw new Refusal(403, "not_allowed", "Look-only: nothing changes.");
  const cutoff = cutoffOrRefuse(key);
  const today = todayManila();
  if (cutoff.to >= today)
    throw new Refusal(
      409,
      "running",
      `This cut-off runs to ${shortDay(cutoff.to)}; release it once it has ended.`,
    );
  return db.transaction(async (tx) => {
    const [taken] = await rows<{ id: number }>(
      tx,
      sql`select id::int as id from pay_run where cutoff = ${key}`,
    );
    if (taken) throw new Refusal(409, "released", "This cut-off is already released.");
    const paidOn = await payDay(tx, cutoff);
    const { slips } = await workOut(tx, cutoff);
    if (!slips.length) throw new Refusal(409, "empty", "Nobody here has a salary on record.");
    const totals = totalsOf(slips);
    const [run] = await rows<{ id: number }>(
      tx,
      sql`insert into pay_run (cutoff, period_from, period_to, pay_day, people, gross, deductions, net, employer, released_by)
        values (${key}, ${cutoff.from}::date, ${cutoff.to}::date, ${paidOn}::date,
          ${totals.people}, ${totals.gross}, ${totals.deductions}, ${totals.net}, ${totals.employer}, ${me.id})
        returning id::int as id`,
    );
    for (const slip of slips)
      await tx.execute(
        sql`insert into payslip (run_id, cutoff, person_id, company, gross, net, tax, slip)
          values (${run?.id}, ${key}, ${slip.person.id}, ${slip.person.company}, ${slip.gross}, ${slip.net},
            ${slip.deductions.find((one) => one.key === "tax")?.amount ?? 0}, ${JSON.stringify(slip)}::jsonb)`,
      );
    await notify(tx, {
      to: slips.map((one) => one.person.id),
      kind: "payslip",
      title: `Your payslip for ${cutoffLabel(cutoff)} is out`,
      body: `Paid ${shortDay(paidOn, true)}`,
      link: `/me/payslips/${key}`,
      key: `payslip:${key}`,
    });
    return { people: totals.people, net: totals.net };
  });
}

/** A person's own released payslips, newest first. */
export async function myPayslips(db: Database, me: Me): Promise<MyPayslips> {
  const found = await rows<{ cutoff: string; payDay: string; gross: number; net: number }>(
    db,
    sql`select s.cutoff, to_char(r.pay_day, 'YYYY-MM-DD') as "payDay", s.gross::int as gross, s.net::int as net
      from payslip s join pay_run r on r.id = s.run_id where s.person_id = ${me.id}
      order by r.period_from desc`,
  );
  return {
    slips: found.map((one) => ({
      ...one,
      label: cutoffLabel(cutoffByKey(one.cutoff) as Cutoff),
    })),
  };
}

/** One payslip: a person's own once released; anyone's, released or as it stands, for HR and the CEO. */
export async function payslipOf(
  db: Database,
  me: Me,
  key: string,
  personId?: number | null,
): Promise<{ slip: Payslip; period: PayPeriod }> {
  const cutoff = cutoffOrRefuse(key);
  const who = personId ?? me.id;
  const reader = HR_ROLES.includes(me.role);
  if (who !== me.id && !reader)
    throw new Refusal(403, "not_allowed", "Someone else's payslip isn't yours to see.");
  const period = await periodOf(db, cutoff, todayManila());
  const released = await releasedSlips(db, key);
  const slips = released ?? (reader ? (await workOut(db, cutoff)).slips : []);
  const slip = slips.find((one) => one.person.id === who);
  if (!slip)
    throw new Refusal(
      404,
      "not_found",
      released || reader ? "No payslip for this cut-off." : "This payslip isn't out yet.",
    );
  return { slip, period };
}

const CSV_COLUMNS: [string, (slip: Payslip) => string | number][] = [
  ["Employee ID", (s) => s.person.employeeCode ?? ""],
  ["Name", (s) => s.person.name],
  [
    "Company",
    (s) => (s.person.company === "gpi" ? "Getmeds Philippines Inc." : "2MG Incorporated"),
  ],
  ["Department", (s) => s.person.department ?? ""],
  ["Days worked", (s) => s.attendance.present],
  ["Absent", (s) => s.attendance.absent],
  ["Late (min)", (s) => s.attendance.lateMinutes],
  ["Undertime (min)", (s) => s.attendance.undertimeMinutes],
  ["Monthly salary", (s) => s.monthlySalary / 100],
  ["Earnings", (s) => s.earnings.reduce((t, one) => t + one.amount, 0) / 100],
  ["Time not worked", (s) => s.less.reduce((t, one) => t + one.amount, 0) / 100],
  ["Gross pay", (s) => s.gross / 100],
  ["SSS", (s) => lineOf(s, "sss") / 100],
  ["PhilHealth", (s) => lineOf(s, "philhealth") / 100],
  ["Pag-IBIG", (s) => lineOf(s, "pagibig") / 100],
  ["Withholding tax", (s) => lineOf(s, "tax") / 100],
  [
    "Other deductions",
    (s) =>
      s.deductions.filter((one) => one.adjustmentId).reduce((t, one) => t + one.amount, 0) / 100,
  ],
  ["Net pay", (s) => s.net / 100],
  ["SSS (employer)", (s) => (s.employer?.sss ?? 0) / 100],
  ["PhilHealth (employer)", (s) => (s.employer?.philhealth ?? 0) / 100],
  ["Pag-IBIG (employer)", (s) => (s.employer?.pagibig ?? 0) / 100],
  ["Bank", (s) => s.bank?.name ?? ""],
  ["Account", (s) => s.bank?.account ?? ""],
];
const cell = (value: string | number) => {
  const text = typeof value === "number" ? value.toFixed(2).replace(/\.00$/, "") : value;
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** The register as a sheet (for the bank and the books): HR and the CEO. */
export async function registerCsv(
  db: Database,
  me: Me,
  key: string,
): Promise<{ name: string; csv: string }> {
  const register = await payrollCutoff(db, me, key);
  const lines = [CSV_COLUMNS.map(([name]) => cell(name)).join(",")];
  for (const slip of register.slips)
    lines.push(CSV_COLUMNS.map(([, pick]) => cell(pick(slip))).join(","));
  return {
    name: `payroll-${key}${register.status === "released" ? "" : "-draft"}.csv`,
    csv: `${lines.join("\n")}\n`,
  };
}

/** The law-set rates, each from the day it starts: HR and the CEO read them. */
export async function payRules(db: Database, me: Me): Promise<{ rules: PayRuleRow[] }> {
  allow(me, HR_ROLES, "read the pay rates");
  const found = await rows<PayRuleRow & { rule: unknown }>(
    db,
    sql`select kind, to_char(starts_on, 'YYYY-MM-DD') as "startsOn", source, rule from pay_rule
      order by kind, starts_on desc`,
  );
  return {
    rules: found.map((one) => ({
      ...one,
      rule: typeof one.rule === "string" ? JSON.parse(one.rule) : one.rule,
    })),
  };
}
