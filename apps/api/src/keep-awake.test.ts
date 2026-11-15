import { describe, expect, it } from "vitest";
import { awakeNow, nextGapMs } from "./keep-awake";

describe("staying awake in working hours", () => {
  it("is awake 7:00–20:59 Manila, Monday to Saturday", () => {
    // 2026-11-16 is a Monday; Manila is UTC+8.
    expect(awakeNow(new Date("2026-11-16T23:00:00Z"))).toBe(true); // Tue 07:00
    expect(awakeNow(new Date("2026-11-16T22:59:00Z"))).toBe(false); // Tue 06:59
    expect(awakeNow(new Date("2026-11-16T12:59:00Z"))).toBe(true); // Mon 20:59
    expect(awakeNow(new Date("2026-11-16T13:00:00Z"))).toBe(false); // Mon 21:00
    expect(awakeNow(new Date("2026-11-22T02:00:00Z"))).toBe(false); // Sun 10:00
  });
  it("waits 10 to 13 minutes between visits", () => {
    expect(nextGapMs(() => 0)).toBe(10 * 60_000);
    expect(nextGapMs(() => 1)).toBe(13 * 60_000);
  });
});
