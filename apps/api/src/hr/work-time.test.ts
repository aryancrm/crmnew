import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCHEDULE,
  dayFigures,
  dayMinutes,
  isWorkDay,
  manilaDay,
  manilaMoment,
  workMinutes,
} from "./work-time";

// 16 Nov 2026 is a Monday; 14 Nov a Saturday, 15 Nov a Sunday.
const at = (day: string, clock: string) => manilaMoment(day, clock);

describe("working time on the company's hours (Monday to Saturday, 7:00 to 16:00)", () => {
  it("counts only working hours on working days, Manila time", () => {
    expect(dayMinutes()).toBe(9 * 60);
    expect(manilaDay(at("2026-11-16", "00:30"))).toBe("2026-11-16");
    expect(workMinutes(at("2026-11-16", "09:00"), at("2026-11-16", "11:30"))).toBe(150);
    // Placed at six in the evening, looked at the next morning at nine: two working hours.
    expect(workMinutes(at("2026-11-16", "18:00"), at("2026-11-17", "09:00"))).toBe(120);
    // Saturday 3 pm to Monday 8 am: an hour on Saturday, none on Sunday, an hour on Monday.
    expect(workMinutes(at("2026-11-14", "15:00"), at("2026-11-16", "08:00"))).toBe(120);
    expect(workMinutes(at("2026-11-16", "05:00"), at("2026-11-16", "06:59"))).toBe(0);
    expect(workMinutes(at("2026-11-16", "16:00"), at("2026-11-16", "23:00"))).toBe(0);
    expect(workMinutes(at("2026-11-16", "10:00"), at("2026-11-16", "09:00"))).toBe(0);
  });

  it("stops on Sundays and holidays, and follows another schedule", () => {
    const holidays = new Set(["2026-11-30"]); // Bonifacio Day, a Monday
    expect(isWorkDay("2026-11-14", DEFAULT_SCHEDULE, holidays)).toBe(true);
    expect(isWorkDay("2026-11-15", DEFAULT_SCHEDULE, holidays)).toBe(false);
    expect(isWorkDay("2026-11-30", DEFAULT_SCHEDULE, holidays)).toBe(false);
    // Saturday 28th 4 pm to Tuesday 1 Dec 8 am: only Tuesday's first hour.
    expect(
      workMinutes(at("2026-11-28", "16:00"), at("2026-12-01", "08:00"), DEFAULT_SCHEDULE, holidays),
    ).toBe(60);
    const mornings = { ...DEFAULT_SCHEDULE, days: [1, 2, 3, 4, 5], start: "08:00", end: "12:00" };
    expect(workMinutes(at("2026-11-13", "11:00"), at("2026-11-16", "09:00"), mornings)).toBe(120);
  });

  it("works a day out as HR does: 15-minute blocks for late and undertime, no grace", () => {
    const day = "2026-11-16";
    expect(dayFigures(day, at(day, "07:00"), at(day, "16:00"))).toEqual({
      workedMinutes: 8 * 60,
      lateMinutes: 0,
      undertimeMinutes: 0,
      afterHoursMinutes: 0,
    });
    // Seven minutes late is one block; leaving ten minutes early is one block.
    expect(dayFigures(day, at(day, "07:07"), at(day, "15:50"))).toMatchObject({
      lateMinutes: 15,
      undertimeMinutes: 15,
    });
    // 40 minutes after hours rounds down to 30; a short day keeps its lunch.
    expect(dayFigures(day, at(day, "06:55"), at(day, "16:40")).afterHoursMinutes).toBe(30);
    expect(dayFigures(day, at(day, "07:00"), at(day, "10:00")).workedMinutes).toBe(180);
    // A rest day has no late or undertime.
    expect(
      dayFigures(
        "2026-11-15",
        at("2026-11-15", "10:00"),
        at("2026-11-15", "12:00"),
        DEFAULT_SCHEDULE,
        false,
      ),
    ).toMatchObject({ lateMinutes: 0, undertimeMinutes: 0 });
  });
});
