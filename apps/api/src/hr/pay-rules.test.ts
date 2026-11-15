// Payroll's arithmetic against figures worked by hand (2MG's register rules, BIR's table).

import { describe, expect, it } from "vitest";
import {
  type Cutoff,
  computeSlip,
  cutoffByKey,
  cutoffOf,
  type PayAttendance,
  type PayRules,
  pagibigMonth,
  payDayOf,
  philhealthMonth,
  shiftCutoff,
  sssForCutoff,
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
      { over: 1041700, base: 0, rateBps: 1500 },
      { over: 1666700, base: 93750, rateBps: 2000 },
      { over: 3333300, base: 427070, rateBps: 2500 },
      { over: 8333300, base: 1677070, rateBps: 3000 },
      { over: 33333300, base: 9177070, rateBps: 3500 },
    ],
  },
};
const peso = (p: number) => Math.round(p * 100);
const NOTHING: PayAttendance = {
  workDays: 13,
  present: 13,
  absent: 0,
  unpaidLeave: 0,
  paidLeave: { vl: 0, sl: 0, other: 0 },
  notEmployed: 0,
  lateMinutes: 0,
  undertimeMinutes: 0,
  overtime: { ordinary: 0, restDay: 0, specialHoliday: 0, regularHoliday: 0 },
  holidaysWorked: { regular: 0, special: 0 },
};
const NONE = { sss: false, philhealth: false, pagibig: false, tax: false };

describe("cut-offs", () => {
  it("runs the 26th to the 10th (paid the 15th) and the 11th to the 25th (paid month-end)", () => {
    expect(cutoffOf("2026-11-05")).toMatchObject({
      key: "2026-11-a",
      from: "2026-10-26",
      to: "2026-11-10",
      payOn: "2026-11-15",
    });
    expect(cutoffOf("2026-11-15")).toMatchObject({
      key: "2026-11-b",
      from: "2026-11-11",
      to: "2026-11-25",
      payOn: "2026-11-30",
    });
    expect(cutoffOf("2026-11-27").key).toBe("2026-12-a");
    expect(cutoffOf("2026-12-28")).toMatchObject({
      key: "2027-01-a",
      from: "2026-12-26",
      to: "2027-01-10",
    });
    expect(cutoffOf("2026-01-03").from).toBe("2025-12-26");
    expect(cutoffByKey("2026-13-a")).toBeNull();
    expect(cutoffByKey("nonsense")).toBeNull();
  });

  it("steps back and forth, across a year", () => {
    expect(shiftCutoff("2026-11-a", -1)).toBe("2026-10-b");
    expect(shiftCutoff("2026-11-b", 1)).toBe("2026-12-a");
    expect(shiftCutoff("2026-01-a", -1)).toBe("2025-12-b");
    expect(shiftCutoff("2026-11-b", -3)).toBe("2026-10-a");
  });

  it("moves a pay day back off weekends and holidays", () => {
    // 30 Nov 2026 is Bonifacio Day; the 28th and 29th a weekend.
    expect(payDayOf(cutoffByKey("2026-11-b") as Cutoff, new Set(["2026-11-30"]))).toBe(
      "2026-11-27",
    );
    // 15 Nov 2026 is a Sunday.
    expect(payDayOf(cutoffByKey("2026-11-a") as Cutoff, new Set())).toBe("2026-11-13");
    expect(payDayOf(cutoffByKey("2026-12-a") as Cutoff, new Set())).toBe("2026-12-15");
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

  it("SSS on what was earned: a on its own, b on the month less what a took", () => {
    const a = sssForCutoff(RULES.sss, peso(20000), peso(9800), "a", null);
    expect(a.employee).toBe(peso(487.5));
    const b = sssForCutoff(RULES.sss, peso(20000), peso(10000), "b", {
      earnings: peso(9800),
      employee: a.employee,
      employer: a.employer,
    });
    // The month on ₱19,800 (credit ₱20,000): ₱1,000 less ₱487.50 = ₱512.50, rounded to ₱25 as
    // the register does.
    expect(b.employee).toBe(peso(525));
    // As the register: a high first cut-off isn't capped at the bracket's top...
    expect(sssForCutoff(RULES.sss, peso(40000), peso(20000), "a", null).employee).toBe(peso(1000));
    // ...but never takes more than the month's most.
    expect(sssForCutoff(RULES.sss, peso(100000), peso(50000), "a", null).employee).toBe(peso(1750));
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

  it("withholding tax by BIR's semi-monthly table", () => {
    expect(withholdingTax(RULES.tax, peso(10417))).toBe(0);
    expect(withholdingTax(RULES.tax, peso(15000))).toBe(peso(687.45));
    expect(withholdingTax(RULES.tax, peso(20000))).toBe(peso(1604.1));
    expect(withholdingTax(RULES.tax, peso(40000))).toBe(peso(5937.45));
  });
});

describe("one payslip", () => {
  it("adds overtime and HR's lines, takes off time not worked, the shares and tax", () => {
    const slip = computeSlip({
      rules: RULES,
      monthlySalary: peso(30000),
      monthlyAllowance: peso(2000),
      half: "a",
      attendance: {
        ...NOTHING,
        absent: 1,
        present: 12,
        lateMinutes: 30,
        overtime: { ...NOTHING.overtime, ordinary: 120 },
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
      prior: null,
      firstCutoff: false,
    });
    // Daily ₱30,000 × 12 ÷ 313 = ₱1,150.16; hourly ₱143.77.
    expect(slip.dailyRate).toBe(peso(1150.16));
    expect(slip.hourlyRate).toBe(peso(143.77));
    expect(slip.earnings.map((one) => [one.key, one.amount])).toEqual([
      ["basic", peso(15000)],
      ["allowance", peso(1000)],
      ["ot_ordinary", peso(359.42)],
      ["adj_2", peso(500)],
    ]);
    expect(slip.less.map((one) => [one.key, one.amount])).toEqual([
      ["absent", peso(1150.16)],
      ["late", peso(71.88)],
    ]);
    expect(slip.gross).toBe(peso(15637.38));
    expect(slip.sssBase).toBe(peso(15137.38));
    expect(slip.deductions.map((one) => [one.key, one.amount])).toEqual([
      ["sss", peso(762.5)],
      ["philhealth", peso(375)],
      ["pagibig", peso(100)],
      ["tax", peso(522.43)],
      ["adj_1", peso(1000)],
    ]);
    expect(slip.taxable).toBe(peso(13899.88));
    expect(slip.net).toBe(peso(15637.38 - 762.5 - 375 - 100 - 522.43 - 1000));
  });

  it("takes the whole month's PhilHealth on a joiner's first cut-off and what a left on b", () => {
    const base = {
      rules: RULES,
      monthlySalary: peso(20000),
      monthlyAllowance: 0,
      attendance: NOTHING,
      adjustments: [],
      exempt: NONE,
    };
    const joiner = computeSlip({ ...base, half: "b", prior: null, firstCutoff: true });
    expect(joiner.philhealth.employee).toBe(peso(500));
    const a = computeSlip({ ...base, half: "a", prior: null, firstCutoff: false });
    expect(a.philhealth.employee).toBe(peso(250));
    const b = computeSlip({
      ...base,
      half: "b",
      prior: {
        sssBase: a.sssBase,
        sss: a.sss.employee,
        sssEmployer: a.sss.employer,
        philhealth: a.philhealth.employee,
        philhealthEmployer: a.philhealth.employer,
      },
      firstCutoff: false,
    });
    expect(b.philhealth.employee).toBe(peso(250));
    expect(a.sss.employee + b.sss.employee).toBe(peso(1000));
    expect(a.pagibig.employee + b.pagibig.employee).toBe(peso(200));
  });

  it("charges nothing for a scheme they aren't covered by, and no tax when exempt", () => {
    const slip = computeSlip({
      rules: RULES,
      monthlySalary: peso(80000),
      monthlyAllowance: 0,
      half: "a",
      attendance: NOTHING,
      adjustments: [],
      exempt: { sss: true, philhealth: true, pagibig: true, tax: true },
      prior: null,
      firstCutoff: false,
    });
    expect(slip.totalDeductions).toBe(0);
    expect(slip.net).toBe(peso(40000));
    expect(slip.deductions.every((one) => one.detail === "not covered")).toBe(true);
  });

  it("never takes more than was earned: the shares first, then HR's lines", () => {
    const slip = computeSlip({
      rules: RULES,
      monthlySalary: peso(20000),
      monthlyAllowance: 0,
      half: "a",
      // Away all but half a day of the cut-off.
      attendance: { ...NOTHING, present: 0, absent: 12.5 },
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
      prior: null,
      firstCutoff: false,
    });
    expect(slip.gross).toBeGreaterThan(0);
    expect(slip.net).toBe(0);
    expect(slip.totalDeductions).toBe(slip.gross);
    const advance = slip.deductions.find((one) => one.key === "adj_7");
    expect(advance?.detail).toContain("not taken: not enough pay");
    expect(slip.sss.employee).toBe(slip.deductions.find((one) => one.key === "sss")?.amount);
  });

  it("pays a holiday worked and overtime on holidays and rest days at their rates", () => {
    const slip = computeSlip({
      rules: RULES,
      monthlySalary: peso(31300),
      monthlyAllowance: 0,
      half: "a",
      attendance: {
        ...NOTHING,
        overtime: { ordinary: 0, restDay: 480, specialHoliday: 0, regularHoliday: 60 },
        holidaysWorked: { regular: 1, special: 1 },
      },
      adjustments: [],
      exempt: NONE,
      prior: null,
      firstCutoff: false,
    });
    // Daily ₱1,200, hourly ₱150.
    const lines = Object.fromEntries(slip.earnings.map((one) => [one.key, one.amount]));
    expect(lines.ot_restDay).toBe(peso(150 * 8 * 1.3));
    expect(lines.ot_regularHoliday).toBe(peso(150 * 2.6));
    expect(lines.holiday_regular).toBe(peso(1200));
    expect(lines.holiday_special).toBe(peso(360));
  });
});
