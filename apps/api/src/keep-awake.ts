// Render's free server sleeps after 15 minutes with no visit, and the next visit then waits
// about 50 seconds. This visits the API's own public address every 10 to 13 minutes (a random
// gap) so it stays awake, but only in working hours: the free plan has 750 hours a month for
// the whole workspace, shared with every other free service in it.
//
// KEEP_AWAKE: "off" (default), "work_hours" or "always".
// KEEP_AWAKE_URL: the public address (Render sets RENDER_EXTERNAL_URL by itself).
// KEEP_AWAKE_HOURS: Manila hours it stays awake, "7-21" by default (7:00 to 20:59).
// KEEP_AWAKE_DAYS: Manila weekdays, 1 = Monday … 7 = Sunday, "1-6" by default.

const MANILA = "Asia/Manila";

function range(text: string | undefined, fallback: [number, number]): [number, number] {
  const match = /^\s*(\d{1,2})\s*-\s*(\d{1,2})\s*$/.exec(text ?? "");
  if (!match) return fallback;
  return [Number(match[1]), Number(match[2])];
}

/** Whether this moment is inside the hours and days it should stay awake (Manila time). */
export function awakeNow(
  at: Date,
  hours: [number, number] = [7, 21],
  days: [number, number] = [1, 6],
): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: MANILA,
    hour: "numeric",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(at);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(
    parts.find((part) => part.type === "weekday")?.value ?? "",
  ) + 1;
  return hour >= hours[0] && hour < hours[1] && weekday >= days[0] && weekday <= days[1];
}

/** The next gap: 10 to 13 minutes, so the visits don't fall on a fixed beat. */
export function nextGapMs(random: () => number = Math.random): number {
  return Math.round((10 + random() * 3) * 60 * 1000);
}

export function startKeepAwake(): void {
  const mode = process.env.KEEP_AWAKE ?? "off";
  if (mode === "off") return;
  const base = (process.env.KEEP_AWAKE_URL ?? process.env.RENDER_EXTERNAL_URL ?? "").replace(/\/$/, "");
  if (!base) {
    console.warn("keep-awake: no KEEP_AWAKE_URL or RENDER_EXTERNAL_URL, so it can't visit itself.");
    return;
  }
  const hours = range(process.env.KEEP_AWAKE_HOURS, [7, 21]);
  const days = range(process.env.KEEP_AWAKE_DAYS, [1, 6]);
  const visit = async () => {
    if (mode === "always" || awakeNow(new Date(), hours, days)) {
      try {
        await fetch(`${base}/api/me`, { signal: AbortSignal.timeout(20_000) });
      } catch {
        // A missed visit is fine; the next one comes in a few minutes.
      }
    }
    setTimeout(visit, nextGapMs()).unref();
  };
  setTimeout(visit, nextGapMs()).unref();
  console.log(
    mode === "always"
      ? "keep-awake: visiting itself every 10–13 minutes, all day"
      : `keep-awake: visiting itself every 10–13 minutes, ${hours[0]}:00–${hours[1]}:00 Manila, days ${days[0]}–${days[1]}`,
  );
}
