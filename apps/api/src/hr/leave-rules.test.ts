// The leave and overtime rules on their own (no database): the credits ledger, half-day steps,
// the vacation notice and the after-the-fact window, the year-end conversion, the kind of day and
// the overtime hours (Automated-Excel's computeOvertime).

import { describe, expect, it } from "vitest";
import {
  dailyRate,
  dayKindOf,
  earliestVl,
  halfDaysOf,
  leaveStartRefusal,
  ledger,
  onHalfHour,
  otTypesFor,
  overtimeOf,
  SL_DAYS_BACK,
  vlConversion,
} from "./leave-rules";

const WEEK = [1, 2, 3, 4, 5, 6];
const regular = { dayKind: "regular" as const, workStart: "07:00", workEnd: "16:00" };

describe("the credits ledger", () => {
  it("adds HR's adjustments to the opening days and takes off what is used and asked", () => {
    expect(ledger({ opening: 10, adjustments: [2.5, -1], used: 3, asked: 1 })).toEqual({
      opening: 10,
      adjusted: 1.5,
      total: 11.5,
      used: 3,
      asked: 1,
      left: 7.5,
    });
  });
  it("never goes below nothing", () => {
    expect(ledger({ opening: 0, adjustments: [-2], used: 0, asked: 0 })).toMatchObject({ total: 0, left: 0 });
    expect(ledger({ opening: 10, adjustments: [], used: 9, asked: 3 }).left).toBe(0);
  });
  it("takes days in half-day steps only, never nothing", () => {
    expect(halfDaysOf(1.5)).toBe(3);
    expect(halfDaysOf(-0.5)).toBe(-1);
    expect(halfDaysOf(0.3)).toBeNull();
    expect(halfDaysOf(0)).toBeNull();
    expect(halfDaysOf(Number.NaN)).toBeNull();
  });
});

describe("when leave may start", () => {
  const today = "2026-11-24";
  it("asks 7 days' notice for vacation leave", () => {
    expect(earliestVl(today)).toBe("2026-12-01");
    expect(leaveStartRefusal("vl", "2026-11-30", today)).toMatch(/7 days' notice/);
    expect(leaveStartRefusal("vl", "2026-12-01", today)).toBeNull();
    expect(leaveStartRefusal("vl", "2026-11-20", today)).not.toBeNull();
  });
  it("lets sick leave be asked after the fact, within the window", () => {
    expect(leaveStartRefusal("sl", "2026-11-23", today)).toBeNull();
    expect(leaveStartRefusal("sl", "2026-10-25", today)).toBeNull();
    expect(SL_DAYS_BACK).toBe(30);
    expect(leaveStartRefusal("sl", "2026-10-24", today)).toMatch(/after the fact/);
    expect(leaveStartRefusal("lwop", "2026-11-24", today)).toBeNull();
  });
});

describe("year-end conversion", () => {
  it("is half the unused vacation leave at monthly × 12 ÷ 313 a day", () => {
    expect(dailyRate(3_130_000)).toBe(120_000);
    expect(vlConversion(7, 3_130_000)).toEqual({ days: 3.5, perDay: 120_000, amount: 420_000 });
    // Half of an odd half day rounds down to the half day.
    expect(vlConversion(2.5, 3_130_000).days).toBe(1);
    expect(vlConversion(4, null)).toEqual({ days: 2, perDay: null, amount: null });
    expect(vlConversion(-1, 100).days).toBe(0);
  });
});

describe("the kind of day", () => {
  it("is a rest day off the schedule, a holiday, or both", () => {
    expect(dayKindOf("2026-11-24", WEEK, null)).toBe("regular");
    expect(dayKindOf("2026-11-29", WEEK, null)).toBe("rest");
    expect(dayKindOf("2026-11-30", WEEK, "regular")).toBe("legal");
    expect(dayKindOf("2026-11-29", WEEK, "special")).toBe("rest_special");
    expect(dayKindOf("2026-11-29", WEEK, "regular")).toBe("rest_legal");
    expect(otTypesFor("rest")).toEqual(["rest", "broken"]);
  });
  it("takes times on the hour or the half hour", () => {
    expect(onHalfHour("16:30")).toBe(true);
    expect(onHalfHour("16:15")).toBe(false);
  });
});

describe("overtime hours", () => {
  it("never counts the working hours of a regular day", () => {
    expect(overtimeOf({ ...regular, from: "16:00", to: "18:00" })).toEqual({
      minutes: 120,
      nightMinutes: 0,
      lunchMinutes: 0,
    });
    expect(overtimeOf({ ...regular, from: "15:00", to: "17:00" })).toMatchObject({ minutes: 60 });
    expect(overtimeOf({ ...regular, from: "05:00", to: "07:00" })).toMatchObject({
      minutes: 120,
      nightMinutes: 60,
    });
  });
  it("needs one whole hour, then counts in half hours", () => {
    expect(overtimeOf({ ...regular, from: "16:00", to: "16:30" })).toHaveProperty("error");
    expect(overtimeOf({ ...regular, from: "16:00", to: "17:30" })).toMatchObject({ minutes: 90 });
  });
  it("keeps the night part apart, past midnight too", () => {
    expect(overtimeOf({ ...regular, from: "20:00", to: "02:00" })).toEqual({
      minutes: 360,
      nightMinutes: 240,
      lunchMinutes: 0,
    });
  });
  it("counts every hour of a rest day, less an hour's lunch from nine hours, daytime first", () => {
    expect(overtimeOf({ ...regular, dayKind: "rest", from: "08:00", to: "18:00" })).toEqual({
      minutes: 540,
      nightMinutes: 0,
      lunchMinutes: 60,
    });
    expect(overtimeOf({ ...regular, dayKind: "legal", from: "14:00", to: "00:00" })).toEqual({
      minutes: 540,
      nightMinutes: 120,
      lunchMinutes: 60,
    });
  });
});
