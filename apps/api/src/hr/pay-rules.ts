// Payroll's arithmetic, with no database: the cut-offs, a day's and an hour's pay, and one person's
// payslip for one cut-off from their attendance. Money is whole centavos; each line is rounded once,
// from the exact rate, as 2MG's register does.
//
// 2MG's own rules, as HR confirmed them for the HR portal's engine (Sep 2026):
//   - two cut-offs a month: the 26th to the 10th, paid the 15th ("a"); the 11th to the 25th, paid
//     the month's last day ("b"); a pay day on a Saturday, Sunday or holiday moves back to the
//     working day before;
//   - half the monthly salary and allowance per cut-off; daily rate = monthly × 12 ÷ 313, hourly =
//     daily ÷ 8; absences, leave without pay, late and undertime come off at those rates;
//   - SSS on what was actually earned: cut-off a takes 5% of its own earnings (doubled, put in its
//     ₱500 bracket, halved), cut-off b the month's share on both cut-offs' earnings less what a
//     took, rounded to ₱25. (Unlike the old register, a never takes more than the month's most.)
//   - PhilHealth 5% of the monthly salary (₱10,000 to ₱100,000), half each; half per cut-off, the
//     whole month on a joiner's first cut-off;
//   - Pag-IBIG ₱200 a month, ₱100 per cut-off; the employer matches;
//   - BIR's semi-monthly withholding table on the cut-off's taxable pay (gross less the three).
// Added here (the CRM knows them): approved overtime (125% on a working day, 130% on a rest day,
// 169% on a special day, 260% on a regular holiday) and a holiday worked (a regular holiday +100% of
// the daily rate, a special day +30%: the monthly pay already holds the day itself).
// The law-set rates (SSS, PhilHealth, Pag-IBIG, tax) are dated rows in pay_rule, passed in here.

export const DAYS_PER_YEAR = 313;
export const HOURS_PER_DAY = 8;

/** Overtime's rate by the day it was worked, in basis points of the hourly rate. */
export const OVERTIME_BPS = {
  ordinary: 12_500,
  restDay: 13_000,
  specialHoliday: 16_900,
  regularHoliday: 26_000,
} as const;
export type OvertimeKind = keyof typeof OVERTIME_BPS;
/** A holiday worked, on top of the monthly pay: basis points of the daily rate. */
export const HOLIDAY_WORKED_BPS = { regular: 10_000, special: 3_000 } as const;

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
/** BIR's semi-monthly table: above `over`, `base` plus `rateBps` of the excess. */
export type TaxRule = { rows: { over: number; base: number; rateBps: number }[] };
export type PayRules = {
  sss: SssRule;
  philhealth: PhilhealthRule;
  pagibig: PagibigRule;
  tax: TaxRule;
};

// ------------------------------------------------------------------ cut-offs

export type Cutoff = {
  /** "2026-11-a": 26 Oct – 10 Nov, paid 15 Nov; "2026-11-b": 11 – 25 Nov, paid 30 Nov. */
  key: string;
  half: "a" | "b";
  from: string;
  to: string;
  /** The pay day before moving it off a weekend or holiday. */
  payOn: string;
};

const CUTOFF = /^(\d{4})-(\d{2})-([ab])$/;
const ymd = (y: number, m: number, d: number) =>
  new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);

export function cutoffByKey(key: string): Cutoff | null {
  const match = CUTOFF.exec(key);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  if (m < 1 || m > 12 || y < 2000 || y > 2100) return null;
  const half = match[3] as "a" | "b";
  return half === "a"
    ? { key, half, from: ymd(y, m - 1, 26), to: ymd(y, m, 10), payOn: ymd(y, m, 15) }
    : { key, half, from: ymd(y, m, 11), to: ymd(y, m, 25), payOn: ymd(y, m + 1, 0) };
}

/** The cut-off a day falls in. */
export function cutoffOf(day: string): Cutoff {
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7));
  const d = Number(day.slice(8, 10));
  if (d >= 26)
    return cutoffByKey(
      ymd(y, m + 1, 1)
        .slice(0, 7)
        .concat("-a"),
    ) as Cutoff;
  return cutoffByKey(`${day.slice(0, 7)}-${d <= 10 ? "a" : "b"}`) as Cutoff;
}

/** The cut-off before or after one. */
export function shiftCutoff(key: string, by: number): string {
  let at = cutoffByKey(key) as Cutoff;
  for (let step = 0; step < Math.abs(by); step += 1) {
    const day = new Date(`${by > 0 ? at.to : at.from}T00:00:00Z`);
    day.setUTCDate(day.getUTCDate() + (by > 0 ? 1 : -1));
    at = cutoffOf(day.toISOString().slice(0, 10));
  }
  return at.key;
}

/** The other cut-off of the same month: for b, its a. */
export const firstHalfOf = (key: string) => key.replace(/-b$/, "-a");

/** The pay day moved back off Saturdays, Sundays and holidays. */
export function payDayOf(cutoff: Cutoff, holidays: ReadonlySet<string>): string {
  const day = new Date(`${cutoff.payOn}T00:00:00Z`);
  for (let tries = 0; tries < 10; tries += 1) {
    const at = day.toISOString().slice(0, 10);
    const weekday = day.getUTCDay();
    if (weekday !== 0 && weekday !== 6 && !holidays.has(at)) return at;
    day.setUTCDate(day.getUTCDate() - 1);
  }
  return cutoff.payOn;
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

/** SSS on a cut-off's own earnings; b needs what a earned and took. */
export function sssForCutoff(
  rule: SssRule,
  monthlySalary: number,
  earnings: number,
  half: "a" | "b",
  prior: { earnings: number; employee: number; employer: number } | null,
): { employee: number; employer: number; basis: string } {
  const fixed = sssMonth(rule, monthlySalary);
  const most = sssMonth(rule, rule.mscMax).employee;
  // Cut-off a: 5% of its earnings, doubled to a month, put in its bracket (no top, as the register
  // does), halved; never more than the month's most.
  const firstShare = (e: number) => {
    const credit = Math.max(rule.mscMin, Math.round((Math.max(0, e) * 2) / rule.step) * rule.step);
    return Math.min(most, round(ratio(credit, rule.employeeBps) / 2));
  };
  if (half === "a")
    return {
      employee: firstShare(earnings),
      employer: round(fixed.employer / 2),
      basis: "this cut-off's earnings",
    };
  const before = prior ?? {
    earnings: 0,
    employee: 0,
    employer: 0,
  };
  const month = sssMonth(rule, before.earnings + Math.max(0, earnings));
  return {
    employee: Math.max(0, Math.round((month.employee - before.employee) / 2500) * 2500),
    employer: Math.max(0, month.employer - before.employer),
    basis: prior ? "the month's earnings, less the first cut-off's" : "this cut-off's earnings",
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

/** Withholding tax on a cut-off's taxable pay. */
export function withholdingTax(rule: TaxRule, taxable: number): number {
  let row = rule.rows[0];
  for (const one of rule.rows) if (taxable > one.over) row = one;
  if (!row || row.rateBps === 0) return 0;
  return round(row.base + ratio(taxable - row.over, row.rateBps));
}

// ------------------------------------------------------------------ one payslip

export type PayAttendance = {
  /** Working days of their schedule in the cut-off while employed. */
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
  overtime: Record<OvertimeKind, number>;
  holidaysWorked: { regular: number; special: number };
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
};

const money = (centavos: number) =>
  `₱${(centavos / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const days = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)} day${n === 1 ? "" : "s"}`;
const hoursAndMinutes = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h ? `${h} h` : "", m ? `${m} min` : ""].filter(Boolean).join(" ") || "0 min";
};
const OVERTIME_WORDS: Record<OvertimeKind, string> = {
  ordinary: "Overtime",
  restDay: "Rest day worked",
  specialHoliday: "Overtime on a special day",
  regularHoliday: "Overtime on a regular holiday",
};

export function computeSlip(input: {
  rules: PayRules;
  monthlySalary: number;
  monthlyAllowance: number;
  half: "a" | "b";
  attendance: PayAttendance;
  adjustments: PayAdjustment[];
  exempt: { sss: boolean; philhealth: boolean; pagibig: boolean; tax: boolean };
  /** This month's cut-off a (for b): what it earned and took. */
  prior: {
    sssBase: number;
    sss: number;
    sssEmployer: number;
    philhealth: number;
    philhealthEmployer: number;
  } | null;
  /** Their first cut-off (joined within it): the whole month's PhilHealth is taken on it. */
  firstCutoff: boolean;
}): SlipFigures {
  const { rules, monthlySalary, attendance: a } = input;
  const daily = (monthlySalary * 12) / DAYS_PER_YEAR;
  const hourly = daily / HOURS_PER_DAY;
  const earnings: PayLine[] = [
    {
      key: "basic",
      label: "Basic pay",
      detail: "Half the monthly salary",
      amount: round(monthlySalary / 2),
    },
  ];
  if (input.monthlyAllowance > 0)
    earnings.push({
      key: "allowance",
      label: "Allowance",
      detail: "Half the monthly allowance",
      amount: round(input.monthlyAllowance / 2),
    });
  for (const kind of Object.keys(OVERTIME_BPS) as OvertimeKind[]) {
    const minutes = a.overtime[kind];
    if (minutes > 0)
      earnings.push({
        key: `ot_${kind}`,
        label: OVERTIME_WORDS[kind],
        detail: `${hoursAndMinutes(minutes)} at ${OVERTIME_BPS[kind] / 100}%`,
        amount: round(ratio((hourly * minutes) / 60, OVERTIME_BPS[kind])),
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

  const sss = input.exempt.sss
    ? { employee: 0, employer: 0 }
    : sssForCutoff(
        rules.sss,
        monthlySalary,
        sssBase,
        input.half,
        input.half === "b" && input.prior
          ? {
              earnings: input.prior.sssBase,
              employee: input.prior.sss,
              employer: input.prior.sssEmployer,
            }
          : null,
      );
  const phMonth = philhealthMonth(rules.philhealth, monthlySalary);
  const halfMonth = {
    employee: round(phMonth.employee / 2),
    employer: round(phMonth.employer / 2),
  };
  // Cut-off a takes half the month (all of it on a joiner's first); b takes what a left.
  const philhealth = input.exempt.philhealth
    ? { employee: 0, employer: 0 }
    : input.half === "b" && input.prior
      ? {
          employee: Math.max(0, phMonth.employee - input.prior.philhealth),
          employer: Math.max(0, phMonth.employer - input.prior.philhealthEmployer),
        }
      : input.firstCutoff
        ? phMonth
        : halfMonth;
  const piMonth = pagibigMonth(rules.pagibig, monthlySalary);
  const pagibig = input.exempt.pagibig
    ? { employee: 0, employer: 0 }
    : { employee: round(piMonth.employee / 2), employer: round(piMonth.employer / 2) };

  // Deductions come off what was earned, in order (the three shares, tax, then HR's lines), and
  // never past it: a cut-off with too little pay takes what it can and says what it couldn't.
  let room = gross;
  const take = (amount: number) => {
    const taken = Math.min(amount, room);
    room -= taken;
    return taken;
  };
  const short = (amount: number, taken: number) =>
    taken < amount ? `${money(amount - taken)} not taken: not enough pay this cut-off` : null;
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
  };
}
