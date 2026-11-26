// What the bid papers say about the schedule, cut down to the value alone, the way the bidding team writes
// it: "October 27, 2026, 9:00 AM" and "30 Day/s" (as PhilGEPS shows delivery periods). The bidding
// system's own rules (its frontend/src/lib/bidDates.js), unchanged in what they read.

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTH = "(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?";
// "October 27, 2026", "Oct 13, 2026", "October 29 2026", "23 October 2026"
const DATE = new RegExp(`\\b${MONTH}\\s+(\\d{1,2}),?\\s+(\\d{4})|\\b(\\d{1,2})\\s+${MONTH},?\\s+(\\d{4})`, "i");
// "9:00 AM", "10:00am", "2PM", "2: 00 p.m.", "9 o'clock in the morning"
const TIME = /\b(\d{1,2})(?::\s?(\d{2}))?\s*(?:([ap])\.?\s?m\b\.?|o['’]clock in the (morning|afternoon|evening))/i;

const monthName = (text: string) => MONTHS.find((month) => month.slice(0, 3).toLowerCase() === text.slice(0, 3).toLowerCase());

function timeText(match: RegExpExecArray): string | null {
  const hour = Number(match[1]);
  if (hour > 12) return null;
  const pm = match[3] ? match[3].toLowerCase() === "p" : Boolean(match[4] && match[4].toLowerCase() !== "morning");
  return `${hour}:${match[2] || "00"} ${pm ? "PM" : "AM"}`;
}

/** The first date in a passage with its time (just after the date, else just before: "02:00 p.m. of
 *  October 19, 2026"); null when the passage has no date, so a row is left empty rather than filled
 *  with a sentence. */
export function bidDateText(passage: string | null | undefined): string | null {
  if (!passage) return null;
  const text = String(passage).replace(/\s+/g, " ");
  const date = DATE.exec(text);
  if (!date) return null;
  const [month, day, year] = date[1] ? [date[1], date[2], date[3]] : [date[5] ?? "", date[4], date[6]];
  const name = monthName(month);
  if (!name) return null;
  const after = TIME.exec(text.slice(date.index + date[0].length, date.index + date[0].length + 40));
  const before = after ? null : TIME.exec(text.slice(Math.max(0, date.index - 25), date.index));
  const found = after ?? before;
  const time = found ? timeText(found) : null;
  return `${name} ${Number(day)}, ${year}${time ? `, ${time}` : ""}`;
}

/** "Delivery of the Goods is required within thirty (30) calendar days …" → "30 Day/s"; "seven to
 *  fourteen (7-14) working days" → "7-14 Day/s"; null when no number of days or weeks is given. */
export function deliveryText(passage: string | null | undefined): string | null {
  if (!passage) return null;
  const match = /\(?\b(\d+(?:\s*(?:-|to)\s*\d+)?)\)?\s*(?:calendar\s+|working\s+)?(days?|weeks?)\b/i.exec(String(passage));
  if (!match?.[1] || !match[2]) return null;
  return `${match[1].replace(/\s*(?:-|to)\s*/, "-")} ${/^w/i.test(match[2]) ? "Week/s" : "Day/s"}`;
}
