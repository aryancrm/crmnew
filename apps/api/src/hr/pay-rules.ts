// Payroll's arithmetic, with no database: the pay month, a day's and an hour's pay, and one person's
// payslip for one month from their attendance. Money is whole centavos; each line is rounded once,
// from the exact rate, as 2MG's register does.
//
// One payroll a month, the 1st to the month's last day (Aryan, 15 Nov), paid on the last day (moved
// back off a Saturday, Sunday or holiday). The rates are 2MG's, as HR confirmed them for the HR
// portal's engine: the monthly salary and allowance; a day = monthly × 12 ÷ 313, an hour = a day
// ÷ 8; absent, leave without pay, late and undertime come off at those rates; SSS on what was
// earned in the month; PhilHealth 5% of the salary (₱10,000 to ₱100,000), half each; Pag-IBIG ₱200;
// BIR's monthly withholding table on the month's taxable pay. Approved overtime is paid by its type
// (OVERTIME_RATES) and a holiday worked without an overtime form adds a regular holiday's 100% or
// a special day's 30% of the day. Night differential is shown, not paid (PLAN 12.16, HR-PLAN step
// 3). The law-set rates are dated rows in pay_rule, passed in here.

import type { OtType } from "./leave-rules";

export const DAYS_PER_YEAR = 313;
export const HOURS_PER_DAY = 8;
/** An overtime form's first 8 hours are the day's own; past them the Labor Code's overtime rate. */
export const FIRST_MINUTES = 8 * 60;

/**
 * Approved overtime by its type, in basis points of the hourly rate: its first 8 hours and past
 * them. PLAN 12.16: 125% on a working day, 130% on a rest day, 169% on a special day, 260% on a
 * regular holiday, and a holiday worked +100% (regular) or +30% (special) of the day. An overtime
 * form on a holiday counts every hour of it (HR-PLAN step 3), so its first 8 hours are the holiday
 * worked (the monthly pay at 313 days a year already carries the day's 100%: +100% or +30%) and
 * the hours past 8 are PLAN's overtime rates. The rest, from the Labor Code (DOLE's handbook), to
 * confirm with HR: a rest day past 8 hours 169%; a special day on a rest day 150% (195% past 8); a
 * regular holiday on a rest day 260% (338% past 8); broken time as a working day's 125%.
 */
export const OVERTIME_RATES: Record<OtType, { first8: number; over8: number }> = {
  regular: { first8: 12_500, over8: 12_500 },
  broken: { first8: 12_500, over8: 12_500 },
  rest: { first8: 13_000, over8: 16_900 },
  special: { first8: 3_000, over8: 16_900 },
  legal: { first8: 10_000, over8: 26_000 },
  rest_special: { first8: 15_000, over8: 19_500 },
  rest_legal: { first8: 26_000, over8: 33_800 },
};
export const OT_ORDER: OtType[] = [
  "regular",
  "broken",
  "rest",
  "special",
  "legal",
  "rest_special",
  "rest_legal",
];
/** A holiday worked with no overtime form for it, on top of the monthly pay: basis points of the
 *  daily rate (PLAN 12.16). */
export const HOLIDAY_WORKED_BPS = { regular: 10_000, special: 3_000 } as const;
/** Night differential's rate (Labor Code: 10% of the hourly rate), shown for HR, not paid. */
export const NIGHT_BPS = 1_000;

export type OvertimeSplit = { first8: number; over8: number };
export const noOvertime = (): Record<OtType, OvertimeSplit> =>
  Object.fromEntries(OT_ORDER.map((type) => [type, { first8: 0, over8: 0 }])) as Record<
    OtType,
    OvertimeSplit
  >;
/** One overtime form's minutes split at 8 hours (a working day's all count alike). */
export function splitOvertime(type: OtType, minutes: number): OvertimeSplit {
  if (type === "regular" || type === "broken") return { first8: minutes, over8: 0 };
  const first8 = Math.min(minutes, FIRST_MINUTES);
  return { first8, over8: minutes - first8 };
}

export type SssRule = {
  /** The monthly salary credit's bounds and step, centavos. */
  mscMin: number;
  mscMax: number;
  step: number;
  employeeBps: number;
  employerBps: number;
  /** Employees' compensation on top of the employer's share: low below the break, high from it. */
  ecLow: number;
  ecHigh: number;
  ecBreak: number;
};
export type PhilhealthRule = { rateBps: number; floor: number; ceiling: number };
export type PagibigRule = { employeeBps: number; employerBps: number; maxBase: number };
/** BIR's monthly table: above `over`, `base` plus `rateBps` of the excess. */
export type TaxRule = { rows: { over: number; base: number; rateBps: number }[] };
export type PayRules = {
  sss: SssRule;
  philhealth: PhilhealthRule;
  pagibig: PagibigRule;
  tax: TaxRule;
};

// ------------------------------------------------------------------ the pay month

export type PayMonth = {
  /** "2026-11": 1 to 30 November, paid 30 November. */
  key: string;
  from: string;
  to: string;
  /** The pay day before moving it off a weekend or holiday: the month's last day. */
  payOn: string;
};

const MONTH = /^(\d{4})-(\d{2})$/;
const ymd = (y: number, m: number, d: number) =>
  new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);

export function payMonthByKey(key: string): PayMonth | null {
  const match = MONTH.exec(key);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  if (m < 1 || m > 12 || y < 2000 || y > 2100) return null;
  return { key, from: ymd(y, m, 1), to: ymd(y, m + 1, 0), payOn: ymd(y, m + 1, 0) };
}

/** The pay month a day falls in. */
export const payMonthOf = (day: string) => payMonthByKey(day.slice(0, 7)) as PayMonth;

/** The month before or after one. */
export function shiftMonth(key: string, by: number): string {
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7));
  return ymd(y, m + by, 1).slice(0, 7);
}

/** The pay day moved back off Saturdays, Sundays and holidays. */
export function payDayOf(month: PayMonth, holidays: ReadonlySet<string>): string {
  const day = new Date(`${month.payOn}T00:00:00Z`);
  for (let tries = 0; tries < 10; tries += 1) {
    const at = day.toISOString().slice(0, 10);
    const weekday = day.getUTCDay();
    if (weekday !== 0 && weekday !== 6 && !holidays.has(at)) return at;
    day.setUTCDate(day.getUTCDate() - 1);
  }
  return month.payOn;
}

// ------------------------------------------------------------------ the law's shares

const ratio = (amount: number, bps: number) => (amount * bps) / 10_000;
const round = (x: number) => Math.round(x + Number.EPSILON);

/** The SSS monthly salary credit for a month's pay: the nearest step, within the bounds. */
export function sssCredit(rule: SssRule, monthly: number): number {
  const credit = Math.round(monthly / rule.step) * rule.step;
  return Math.min(rule.mscMax, Math.max(rule.mscMin, credit));
}

/** The month's SSS shares for a month's pay. */
export function sssMonth(rule: SssRule, monthly: number) {
  const credit = sssCredit(rule, monthly);
  return {
    credit,
    employee: round(ratio(credit, rule.employeeBps)),
    employer: round(
      ratio(credit, rule.employerBps) + (credit < rule.ecBreak ? rule.ecLow : rule.ecHigh),
    ),
  };
}

/** PhilHealth's month: 5% of the salary within its floor and ceiling, half each. */
export function philhealthMonth(rule: PhilhealthRule, monthlySalary: number) {
  const base = Math.min(rule.ceiling, Math.max(rule.floor, monthlySalary));
  const premium = round(ratio(base, rule.rateBps));
  const employee = round(premium / 2);
  return { employee, employer: premium - employee };
}

/** Pag-IBIG's month: 2% of the salary up to its most, matched by the employer. */
export function pagibigMonth(rule: PagibigRule, monthlySalary: number) {
  const base = Math.min(rule.maxBase, monthlySalary);
  return {
    employee: round(ratio(base, rule.employeeBps)),
    employer: round(ratio(base, rule.employerBps)),
  };
}

/** Withholding tax on a month's taxable pay. */
export function withholdingTax(rule: TaxRule, taxable: number): number {
  let row = rule.rows[0];
  for (const one of rule.rows) if (taxable > one.over) row = one;
  if (!row || row.rateBps === 0) return 0;
  return round(row.base + ratio(taxable - row.over, row.rateBps));
}

// ------------------------------------------------------------------ one payslip

export type PayAttendance = {
  /** Working days of their schedule in the month while employed. */
  workDays: number;
  present: number;
  /** Working days gone by with no time in, leave or form. */
  absent: number;
  /** Leave without pay (a half day is 0.5). */
  unpaidLeave: number;
  paidLeave: { vl: number; sl: number; other: number };
  /** Working days before they joined or after they left. */
  notEmployed: number;
  lateMinutes: number;
  undertimeMinutes: number;
  /** Approved overtime minutes by type, split at the form's first 8 hours. */
  overtime: Record<OtType, OvertimeSplit>;
  /** The night part (10 PM to 6 AM) of approved overtime: shown, not paid. */
  nightMinutes: number;
  /** Holidays worked (on a working day of their schedule) with no overtime form for that day. */
  holidaysWorked: { regular: number; special: number };
  /** Their own holidays in the month on working days of their schedule (national and their
   *  town's or province's); local: of them, their town's or province's. */
  holidays?: { regular: number; special: number; local: number };
};

export type PayAdjustment = {
  id: number;
  label: string;
  kind: "earning" | "deduction";
  /** Earnings only: counted in taxable pay (and SSS's earnings) or not. */
  taxable: boolean;
  amount: number;
  note: string | null;
};

export type PayLine = {
  key: string;
  label: string;
  detail: string | null;
  amount: number;
  adjustmentId?: number;
};

export type SlipFigures = {
  dailyRate: number;
  hourlyRate: number;
  earnings: PayLine[];
  /** Time not worked, off the basic pay. */
  less: PayLine[];
  gross: number;
  /** What SSS is reckoned on: gross less earnings that aren't taxable. */
  sssBase: number;
  taxable: number;
  deductions: PayLine[];
  totalDeductions: number;
  net: number;
  sss: { employee: number; employer: number };
  philhealth: { employee: number; employer: number };
  pagibig: { employee: number; employer: number };
  tax: number;
  /** Shown on the slip for information: nothing added or taken. */
  notes: { key: string; label: string; detail: string }[];
};

const money = (centavos: number) =>
  `₱${(centavos / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const days = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)} day${n === 1 ? "" : "s"}`;
const hoursAndMinutes = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h ? `${h} h` : "", m ? `${m} min` : ""].filter(Boolean).join(" ") || "0 min";
};
const OVERTIME_WORDS: Record<OtType, string> = {
  regular: "Overtime",
  broken: "Broken time",
  rest: "Rest day worked",
  special: "Special day worked",
  legal: "Regular holiday worked",
  rest_special: "Rest day on a special day worked",
  rest_legal: "Rest day on a regular holiday worked",
};
const pct = (bps: number) => `${bps / 100}%`;

export function computeSlip(input: {
  rules: PayRules;
  monthlySalary: number;
  monthlyAllowance: number;
  attendance: PayAttendance;
  adjustments: PayAdjustment[];
  exempt: { sss: boolean; philhealth: boolean; pagibig: boolean; tax: boolean };
}): SlipFigures {
  const { rules, monthlySalary, attendance: a } = input;
  const daily = (monthlySalary * 12) / DAYS_PER_YEAR;
  const hourly = daily / HOURS_PER_DAY;
  const earnings: PayLine[] = [
    {
      key: "basic",
      label: "Basic pay",
      detail: "The monthly salary",
      amount: monthlySalary,
    },
  ];
  if (input.monthlyAllowance > 0)
    earnings.push({
      key: "allowance",
      label: "Allowance",
      detail: null,
      amount: input.monthlyAllowance,
    });
  for (const type of OT_ORDER) {
    const split = a.overtime?.[type] ?? { first8: 0, over8: 0 };
    const rate = OVERTIME_RATES[type];
    const premium = type === "special" || type === "legal";
    if (split.first8 > 0)
      earnings.push({
        key: `ot_${type}`,
        label: OVERTIME_WORDS[type],
        detail: premium
          ? `${hoursAndMinutes(split.first8)}, +${pct(rate.first8)} (the monthly pay carries the day)`
          : `${hoursAndMinutes(split.first8)} at ${pct(rate.first8)}`,
        amount: round(ratio((hourly * split.first8) / 60, rate.first8)),
      });
    if (split.over8 > 0)
      earnings.push({
        key: `ot_${type}_over8`,
        label: `${OVERTIME_WORDS[type]}, past 8 hours`,
        detail: `${hoursAndMinutes(split.over8)} at ${pct(rate.over8)}`,
        amount: round(ratio((hourly * split.over8) / 60, rate.over8)),
      });
  }
  for (const kind of ["regular", "special"] as const)
    if (a.holidaysWorked[kind] > 0)
      earnings.push({
        key: `holiday_${kind}`,
        label: kind === "regular" ? "Regular holiday worked" : "Special day worked",
        detail: `${days(a.holidaysWorked[kind])}, +${HOLIDAY_WORKED_BPS[kind] / 100}% of the day`,
        amount: round(ratio(daily * a.holidaysWorked[kind], HOLIDAY_WORKED_BPS[kind])),
      });
  let notTaxable = 0;
  for (const one of input.adjustments.filter((x) => x.kind === "earning")) {
    earnings.push({
      key: `adj_${one.id}`,
      label: one.label,
      detail: [one.taxable ? null : "not taxable", one.note].filter(Boolean).join(" · ") || null,
      amount: one.amount,
      adjustmentId: one.id,
    });
    if (!one.taxable) notTaxable += one.amount;
  }

  const less: PayLine[] = [];
  const offDays = (key: string, label: string, n: number) => {
    if (n > 0) less.push({ key, label, detail: days(n), amount: round(daily * n) });
  };
  offDays("absent", "Absent", a.absent);
  offDays("unpaid_leave", "Leave without pay", a.unpaidLeave);
  offDays("not_employed", "Days before joining or after leaving", a.notEmployed);
  if (a.lateMinutes > 0)
    less.push({
      key: "late",
      label: "Late",
      detail: hoursAndMinutes(a.lateMinutes),
      amount: round((hourly * a.lateMinutes) / 60),
    });
  if (a.undertimeMinutes > 0)
    less.push({
      key: "undertime",
      label: "Undertime",
      detail: hoursAndMinutes(a.undertimeMinutes),
      amount: round((hourly * a.undertimeMinutes) / 60),
    });

  const earned = earnings.reduce((sum, one) => sum + one.amount, 0);
  const off = less.reduce((sum, one) => sum + one.amount, 0);
  const gross = Math.max(0, earned - off);
  const sssBase = Math.max(0, gross - notTaxable);

  // SSS on what was earned in the month; PhilHealth and Pag-IBIG on the salary.
  const none = { employee: 0, employer: 0 };
  const sss = input.exempt.sss ? none : sssMonth(rules.sss, sssBase);
  const philhealth = input.exempt.philhealth
    ? none
    : philhealthMonth(rules.philhealth, monthlySalary);
  const pagibig = input.exempt.pagibig ? none : pagibigMonth(rules.pagibig, monthlySalary);

  // Deductions come off what was earned, in order (the three shares, tax, then HR's lines), and
  // never past it: a month with too little pay takes what it can and says what it couldn't.
  let room = gross;
  const take = (amount: number) => {
    const taken = Math.min(amount, room);
    room -= taken;
    return taken;
  };
  const short = (amount: number, taken: number) =>
    taken < amount ? `${money(amount - taken)} not taken: not enough pay this month` : null;
  const deductions: PayLine[] = [];
  const share = (key: string, label: string, amount: number, exempt: boolean) => {
    const taken = take(amount);
    deductions.push({
      key,
      label,
      detail: exempt ? "not covered" : short(amount, taken),
      amount: taken,
    });
    return taken;
  };
  const sssTaken = share("sss", "SSS", sss.employee, input.exempt.sss);
  const philhealthTaken = share(
    "philhealth",
    "PhilHealth",
    philhealth.employee,
    input.exempt.philhealth,
  );
  const pagibigTaken = share("pagibig", "Pag-IBIG", pagibig.employee, input.exempt.pagibig);
  const taxable = Math.max(0, sssBase - sssTaken - philhealthTaken - pagibigTaken);
  const tax = share(
    "tax",
    "Withholding tax",
    input.exempt.tax ? 0 : withholdingTax(rules.tax, taxable),
    input.exempt.tax,
  );
  for (const one of input.adjustments.filter((x) => x.kind === "deduction")) {
    const taken = take(one.amount);
    deductions.push({
      key: `adj_${one.id}`,
      label: one.label,
      detail: [one.note, short(one.amount, taken)].filter(Boolean).join(" · ") || null,
      amount: taken,
      adjustmentId: one.id,
    });
  }
  const totalDeductions = deductions.reduce((sum, one) => sum + one.amount, 0);
  const notes: SlipFigures["notes"] = [];
  if ((a.nightMinutes ?? 0) > 0)
    notes.push({
      key: "night",
      label: "Night differential",
      detail: `${hoursAndMinutes(a.nightMinutes)} of the overtime fell between 10 PM and 6 AM: shown, not paid (${money(round(ratio((hourly * a.nightMinutes) / 60, NIGHT_BPS)))} at 10%)`,
    });
  if (a.holidays && a.holidays.local > 0)
    notes.push({
      key: "local_holidays",
      label: "Local holidays",
      detail: `${days(a.holidays.local)} of their town or province this month, not working days`,
    });

  return {
    dailyRate: round(daily),
    hourlyRate: round(hourly),
    earnings,
    less,
    gross,
    sssBase,
    taxable,
    deductions,
    totalDeductions,
    net: gross - totalDeductions,
    sss: { employee: sssTaken, employer: sss.employer },
    philhealth: { employee: philhealthTaken, employer: philhealth.employer },
    pagibig: { employee: pagibigTaken, employer: pagibig.employer },
    tax,
    notes,
  };
}
