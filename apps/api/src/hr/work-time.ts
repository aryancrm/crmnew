// Working time, the same on the server and on the screen (no imports: the web app uses this file).
// A desk's clock (Management's four hours, Finance's day) runs only in the company's working hours,
// on its working days, and stops on holidays: an order placed at 6 in the evening isn't late by
// morning. Manila time throughout (UTC+8, no daylight saving).

export type WorkSchedule = {
  /** Working days: 0 Sunday … 6 Saturday. */
  days: number[];
  /** When the working day starts and ends, "08:00" and "17:00". */
  start: string;
  end: string;
  /** Minutes after the start a time in still counts as on time. */
  graceMinutes: number;
  /** The unpaid break inside the day (lunch), taken off the hours worked, not off the clock. */
  breakMinutes: number;
};

/** The company's hours as HR keeps them: Monday to Saturday, 7:00 to 16:00 with an hour's lunch
 *  (eight hours), Sunday the rest day, no grace period. */
export const DEFAULT_SCHEDULE: WorkSchedule = {
  days: [1, 2, 3, 4, 5, 6],
  start: "07:00",
  end: "16:00",
  graceMinutes: 0,
  breakMinutes: 60,
};

/** HR counts late and undertime in 15-minute blocks, rounded up; time after hours rounded down. */
const BLOCK = 15;
const blocksUp = (minutes: number) => Math.ceil(minutes / BLOCK) * BLOCK;
const blocksDown = (minutes: number) => Math.floor(minutes / BLOCK) * BLOCK;

const MANILA_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const minutesOf = (clock: string): number => {
  const [h, m] = clock.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** The Manila calendar day of a moment, "2026-11-16". */
export function manilaDay(at: number | string | Date): string {
  const ms = typeof at === "number" ? at : new Date(at).getTime();
  return new Date(ms + MANILA_MS).toISOString().slice(0, 10);
}

/** The moment a Manila day's clock time falls on. */
export function manilaMoment(day: string, clock: string): number {
  return Date.parse(`${day}T00:00:00Z`) - MANILA_MS + minutesOf(clock) * 60_000;
}

/** Whether a Manila day is a working day: on the schedule and not a holiday. */
export function isWorkDay(day: string, schedule: WorkSchedule, holidays: ReadonlySet<string>) {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return schedule.days.includes(weekday) && !holidays.has(day);
}

/**
 * Working minutes between two moments: the parts of them inside the working hours of working
 * days. A span over a weekend or a holiday counts only the working days around it.
 */
export function workMinutes(
  from: number | string | Date,
  to: number | string | Date,
  schedule: WorkSchedule = DEFAULT_SCHEDULE,
  holidays: ReadonlySet<string> = new Set(),
): number {
  const a = typeof from === "number" ? from : new Date(from).getTime();
  const b = typeof to === "number" ? to : new Date(to).getTime();
  if (!(b > a)) return 0;
  let total = 0;
  // A long wait is still a few hundred days at most: walk them.
  for (let day = manilaDay(a); ; ) {
    const opens = manilaMoment(day, schedule.start);
    if (opens > b) break;
    if (isWorkDay(day, schedule, holidays)) {
      const closes = manilaMoment(day, schedule.end);
      const overlap = Math.min(b, closes) - Math.max(a, opens);
      if (overlap > 0) total += overlap;
    }
    day = new Date(Date.parse(`${day}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
  }
  return Math.floor(total / 60_000);
}

/** The minutes a full working day has on the clock (start to end). */
export const dayMinutes = (schedule: WorkSchedule = DEFAULT_SCHEDULE) =>
  minutesOf(schedule.end) - minutesOf(schedule.start);

/** A day's time in and out turned into what HR counts, in minutes. The lunch break comes off a
 *  day longer than the break plus four hours. Late counts from the start once past the grace, in
 *  15-minute blocks rounded up; so does undertime (leaving before the end); time after the end
 *  is rounded down to 15 minutes (overtime only once approved). */
export type DayFigures = {
  workedMinutes: number;
  lateMinutes: number;
  undertimeMinutes: number;
  afterHoursMinutes: number;
};

export function dayFigures(
  day: string,
  timeIn: number | string | Date,
  timeOut: number | string | Date | null,
  schedule: WorkSchedule = DEFAULT_SCHEDULE,
  workDay = true,
): DayFigures {
  const a = typeof timeIn === "number" ? timeIn : new Date(timeIn).getTime();
  const b =
    timeOut === null ? null : typeof timeOut === "number" ? timeOut : new Date(timeOut).getTime();
  const opens = manilaMoment(day, schedule.start);
  const closes = manilaMoment(day, schedule.end);
  const span = b === null ? 0 : Math.max(0, Math.floor((b - a) / 60_000));
  const worked = span > schedule.breakMinutes + 4 * 60 ? span - schedule.breakMinutes : span;
  const lateBy = Math.floor((a - opens) / 60_000);
  const leftEarlyBy = b === null ? 0 : Math.ceil((closes - Math.max(b, opens)) / 60_000);
  const afterBy = b === null ? 0 : Math.floor((b - Math.max(a, closes)) / 60_000);
  return {
    workedMinutes: worked,
    lateMinutes: workDay && lateBy > schedule.graceMinutes ? blocksUp(lateBy) : 0,
    undertimeMinutes: workDay && leftEarlyBy > 0 ? blocksUp(leftEarlyBy) : 0,
    afterHoursMinutes: afterBy > 0 ? blocksDown(afterBy) : 0,
  };
}
