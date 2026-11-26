// Payroll's arithmetic against figures worked by hand (2MG's register rules, BIR's monthly table).

import { describe, expect, it } from "vitest";
import {
  computeSlip,
  noOvertime,
  OVERTIME_RATES,
  type PayAttendance,
  type PayMonth,
  type PayRules,
  pagibigMonth,
  payDayOf,
  payMonthByKey,
  payMonthOf,
  philhealthMonth,
  shiftMonth,
  splitOvertime,
  sssMonth,
  withholdingTax,
} from "./pay-rules";

// As migration 0044 seeds them.
const RULES: PayRules = {
  sss: {
    mscMin: 500000,
    mscMax: 3500000,
    step: 50000,
    employeeBps: 500,
    employerBps: 1000,
    ecLow: 1000,
    ecHigh: 3000,
    ecBreak: 1500000,
  },
  philhealth: { rateBps: 500, floor: 1000000, ceiling: 10000000 },
  pagibig: { employeeBps: 200, employerBps: 200, maxBase: 1000000 },
  tax: {
    rows: [
      { over: 0, base: 0, rateBps: 0 },
      { over: 2083300, base: 0, rateBps: 1500 },
      { over: 3333300, base: 187500, rateBps: 2000 },
      { over: 6666700, base: 854180, rateBps: 2500 },
      { over: 16666700, base: 3354180, rateBps: 3000 },
      { over: 66666700, base: 18354180, rateBps: 3500 },
    ],
  },
};
const peso = (p: number) => Math.round(p * 100);
const NOTHING: PayAttendance = {
  workDays: 26,
  present: 26,
  absent: 0,
  unpaidLeave: 0,
  paidLeave: { vl: 0, sl: 0, other: 0 },
  notEmployed: 0,
  lateMinutes: 0,
  undertimeMinutes: 0,
  overtime: noOvertime(),
  nightMinutes: 0,
  holidaysWorked: { regular: 0, special: 0 },
};
const NONE = { sss: false, philhealth: false, pagibig: false, tax: false };
const month = (key: string) => payMonthByKey(key) as PayMonth;

describe("the pay month", () => {
  it("runs from the 1st to the month's last day", () => {
    expect(payMonthOf("2026-11-15")).toEqual({
      key: "2026-11",
      from: "2026-11-01",
      to: "2026-11-30",
      payOn: "2026-11-30",
    });
    expect(month("2026-02").to).toBe("2026-02-28");
    expect(month("2028-02").to).toBe("2028-02-29");
    expect(payMonthByKey("2026-13")).toBeNull();
    expect(payMonthByKey("2026-11-a")).toBeNull();
  });

  it("steps back and forth across a year", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-11", -5)).toBe("2026-06");
  });

  it("moves the pay day back off weekends and holidays", () => {
    // 30 Nov 2026 is Bonifacio Day; the 28th and 29th a weekend.
    expect(payDayOf(month("2026-11"), new Set(["2026-11-30"]))).toBe("2026-11-27");
    // 31 Oct 2026 is a Saturday.
    expect(payDayOf(month("2026-10"), new Set())).toBe("2026-10-30");
    // 31 and 30 Dec 2026 are holidays.
    expect(payDayOf(month("2026-12"), new Set(["2026-12-30", "2026-12-31"]))).toBe("2026-12-29");
  });
});

describe("the law's shares", () => {
  it("SSS by the monthly salary credit, with EC on the employer", () => {
    expect(sssMonth(RULES.sss, peso(20000))).toEqual({
      credit: peso(20000),
      employee: peso(1000),
      employer: peso(2030),
    });
    expect(sssMonth(RULES.sss, peso(12000))).toMatchObject({
      employee: peso(600),
      employer: peso(1210),
    });
    expect(sssMonth(RULES.sss, peso(4000)).employee).toBe(peso(250));
    expect(sssMonth(RULES.sss, peso(50000)).employee).toBe(peso(1750));
  });

  it("PhilHealth within its floor and ceiling; Pag-IBIG ₱200", () => {
    expect(philhealthMonth(RULES.philhealth, peso(20000))).toEqual({
      employee: peso(500),
      employer: peso(500),
    });
    expect(philhealthMonth(RULES.philhealth, peso(8000)).employee).toBe(peso(250));
    expect(philhealthMonth(RULES.philhealth, peso(150000)).employee).toBe(peso(2500));
    expect(pagibigMonth(RULES.pagibig, peso(20000))).toEqual({
      employee: peso(200),
      employer: peso(200),
    });
  });

  it("withholding tax by BIR's monthly table", () => {
    expect(withholdingTax(RULES.tax, peso(20833))).toBe(0);
    expect(withholdingTax(RULES.tax, peso(30000))).toBe(peso(1375.05));
    expect(withholdingTax(RULES.tax, peso(50000))).toBe(peso(5208.4));
    expect(withholdingTax(RULES.tax, peso(100000))).toBe(peso(16875.05));
  });
});

describe("one payslip", () => {
  it("adds overtime and HR's lines, takes off time not worked, the shares and tax", () => {
    const slip = computeSlip({
      rules: RULES,
      monthlySalary: peso(30000),
      monthlyAllowance: peso(2000),
      attendance: {
        ...NOTHING,
        absent: 1,
        present: 25,
        lateMinutes: 30,
        overtime: { ...noOvertime(), regular: { first8: 120, over8: 0 } },
      },
      adjustments: [
        {
          id: 1,
          label: "Cash advance",
          kind: "deduction",
          taxable: true,
          amount: peso(1000),
          note: null,
        },
        {
          id: 2,
          label: "Rice subsidy",
          kind: "earning",
          taxable: false,
          amount: peso(500),
          note: null,
        },
      ],
      exempt: NONE,
    });
    // Daily ₱30,000 × 12 ÷ 313 = ₱1,150.16; hourly ₱143.77.
    expect(slip.dailyRate).toBe(peso(1150.16));
    expect(slip.hourlyRate).toBe(peso(143.77));
    expect(slip.earnings.map((one) => [one.key, one.amount])).toEqual([
      ["basic", peso(30000)],
      ["allowance", peso(2000)],
      ["ot_regular", peso(359.42)],
      ["adj_2", peso(500)],
    ]);
    expect(slip.less.map((one) => [one.key, one.amount])).toEqual([
      ["absent", peso(1150.16)],
      ["late", peso(71.88)],
    ]);
    expect(slip.gross).toBe(peso(31637.38));
    // SSS on ₱31,137.38 earned (the rice isn't taxable): a ₱31,000 credit.
    expect(slip.sssBase).toBe(peso(31137.38));
    expect(slip.deductions.map((one) => [one.key, one.amount])).toEqual([
      ["sss", peso(1550)],
      ["philhealth", peso(750)],
      ["pagibig", peso(200)],
      ["tax", peso(1170.66)],
      ["adj_1", peso(1000)],
    ]);
    expect(slip.taxable).toBe(peso(28637.38));
    expect(slip.net).toBe(peso(31637.38 - 1550 - 750 - 200 - 1170.66 - 1000));
  });

  it("never takes more than was earned: the shares first, then HR's lines", () => {
    const slip = computeSlip({
      rules: RULES,
      monthlySalary: peso(20000),
      monthlyAllowance: 0,
      // Away all month.
      attendance: { ...NOTHING, present: 0, absent: 26 },
      adjustments: [
        {
          id: 7,
          label: "Cash advance",
          kind: "deduction",
          taxable: true,
          amount: peso(500),
          note: null,
        },
      ],
      exempt: NONE,
    });
    expect(slip.gross).toBeGreaterThan(0);
    expect(slip.net).toBe(0);
    expect(slip.totalDeductions).toBe(slip.gross);
    const advance = slip.deductions.find((one) => one.key === "adj_7");
    expect(advance?.detail).toContain("not taken: not enough pay");
    expect(slip.sss.employee).toBe(slip.deductions.find((one) => one.key === "sss")?.amount);
  });

  it("charges nothing for a scheme they aren't covered by, and no tax when exempt", () => {
    const slip = computeSlip({
      rules: RULES,
      monthlySalary: peso(80000),
      monthlyAllowance: 0,
      attendance: NOTHING,
      adjustments: [],
      exempt: { sss: true, philhealth: true, pagibig: true, tax: true },
    });
    expect(slip.totalDeductions).toBe(0);
    expect(slip.net).toBe(peso(80000));
    expect(slip.deductions.every((one) => one.detail === "not covered")).toBe(true);
  });

  it("pays a holiday worked and overtime on holidays and rest days at their rates", () => {
    const overtime = noOvertime();
    overtime.rest = splitOvertime("rest", 480);
    overtime.legal = splitOvertime("legal", 540);
    const slip = computeSlip({
      rules: RULES,
      monthlySalary: peso(31300),
      monthlyAllowance: 0,
      attendance: {
        ...NOTHING,
        overtime,
        holidaysWorked: { regular: 1, special: 1 },
      },
      adjustments: [],
      exempt: NONE,
    });
    // Daily ₱1,200, hourly ₱150.
    const lines = Object.fromEntries(slip.earnings.map((one) => [one.key, one.amount]));
    expect(lines.ot_rest).toBe(peso(150 * 8 * 1.3));
    // A regular holiday's form: its first 8 hours +100% (the month carries the day), the 9th at 260%.
    expect(lines.ot_legal).toBe(peso(150 * 8));
    expect(lines.ot_legal_over8).toBe(peso(150 * 2.6));
    expect(lines.holiday_regular).toBe(peso(1200));
    expect(lines.holiday_special).toBe(peso(360));
  });

  it("pays each overtime type at PLAN's and the Labor Code's rates", () => {
    // Hourly ₱150: each type for 10 hours (8 + 2 past 8; a working day's all at one rate).
    const expected: Record<string, [number, number]> = {
      regular: [1.25 * 10, 0],
      broken: [1.25 * 10, 0],
      rest: [1.3 * 8, 1.69 * 2],
      special: [0.3 * 8, 1.69 * 2],
      legal: [1.0 * 8, 2.6 * 2],
      rest_special: [1.5 * 8, 1.95 * 2],
      rest_legal: [2.6 * 8, 3.38 * 2],
    };
    for (const [type, [first, over]] of Object.entries(expected)) {
      const overtime = noOvertime();
      overtime[type as keyof typeof OVERTIME_RATES] = splitOvertime(
        type as keyof typeof OVERTIME_RATES,
        600,
      );
      const slip = computeSlip({
        rules: RULES,
        monthlySalary: peso(31300),
        monthlyAllowance: 0,
        attendance: { ...NOTHING, overtime },
        adjustments: [],
        exempt: NONE,
      });
      const lines = Object.fromEntries(slip.earnings.map((one) => [one.key, one.amount]));
      expect(lines[`ot_${type}`]).toBe(peso(150 * first));
      expect(lines[`ot_${type}_over8`] ?? 0).toBe(peso(150 * over));
    }
  });

  it("shows night differential and pays nothing for it", () => {
    const overtime = noOvertime();
    overtime.regular = splitOvertime("regular", 120);
    const plain = computeSlip({
      rules: RULES,
      monthlySalary: peso(31300),
      monthlyAllowance: 0,
      attendance: { ...NOTHING, overtime },
      adjustments: [],
      exempt: NONE,
    });
    const night = computeSlip({
      rules: RULES,
      monthlySalary: peso(31300),
      monthlyAllowance: 0,
      attendance: { ...NOTHING, overtime, nightMinutes: 120 },
      adjustments: [],
      exempt: NONE,
    });
    expect(night.net).toBe(plain.net);
    expect(night.notes.find((one) => one.key === "night")?.detail).toContain("not paid");
    expect(plain.notes).toEqual([]);
  });
});
