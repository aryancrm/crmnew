// The pieces both Homes (a MedRep's and Management's) are built from, so they read alike: a figure
// tile, and the period box (its title, Today / Yesterday / This month and a day of one's choosing
// on the same line, then a row of figures). White and slate, the case page's boxes; never black.

import { CalendarDays } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { count, dayLabel } from "../ui";

export type Period = "today" | "yesterday" | "month" | "day";

const PERIODS: { key: Exclude<Period, "day">; label: string; short?: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "month", label: "This month", short: "Month" },
];

/** The period in words, for titles. */
export function periodWord(period: Period, day: string | null): string {
  if (period === "today") return "Today";
  if (period === "yesterday") return "Yesterday";
  if (period === "month") return "This month";
  return day ? dayLabel(day) : "That day";
}

/** A figure tile: what it counts, the number, a line under it; a link when it opens a list. */
export function Figure({
  label,
  value,
  sub,
  to,
  tone,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  to?: string;
  tone?: "warn" | "bad";
}) {
  const body = (
    <>
      <div className="truncate text-[11px] font-semibold text-slate-500">{label}</div>
      <div
        className={`mt-0.5 truncate text-xl font-bold tracking-tight tabular-nums ${
          tone === "bad" ? "text-rose-700" : tone === "warn" ? "text-amber-700" : "text-slate-900"
        }`}
      >
        {value}
      </div>
      {sub && <div className="truncate text-[11px] text-slate-400">{sub}</div>}
    </>
  );
  const frame =
    "block min-w-0 rounded-2xl border border-slate-200/90 bg-white px-4 py-3 shadow-2xs";
  return to ? (
    <Link
      to={to}
      className={`${frame} transition-colors hover:border-slate-300 hover:bg-slate-50/60`}
    >
      {body}
    </Link>
  ) : (
    <div className={frame}>{body}</div>
  );
}

/** Figures as one strip of touching, square, coloured tiles (Aryan, 26 Nov: the MedRep's Home);
 *  white text, dark on the yellow. Shared by My orders and the hospitals' figures. */
export const STRIP = [
  "bg-[#1d9fda] text-white",
  "bg-[#f5c400] text-[#3b2f00]",
  "bg-[#e8505b] text-white",
  "bg-[#22b378] text-white",
  "bg-[#7c5cff] text-white",
  "bg-[#3f8f8b] text-white",
];

export type PeriodCell = {
  label: string;
  /** A count, or a figure already in words ("1h"). */
  value: number | string | undefined;
  sub?: ReactNode;
  to?: string;
};

/** The period box: a capital title with the period picker on its line, then the figures. */
export function PeriodBox({
  title,
  short,
  period,
  day,
  shownDay,
  today,
  cells,
  faded,
  error,
  onPick,
  colours = false,
}: {
  title: string;
  /** A shorter title for a phone. */
  short?: string;
  period: Period;
  /** The day picked (only for "day"). */
  day: string;
  /** The day the figures are for, from the server. */
  shownDay?: string;
  today?: string;
  cells: PeriodCell[];
  faded?: boolean;
  error?: string | null;
  onPick: (period: Period, day: string) => void;
  /** The MedRep's Home: the periods as My KPIs' tabs, the figures as the coloured strip. */
  colours?: boolean;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <h2 className="min-w-0 truncate text-xs font-bold tracking-wider text-stone-500 uppercase">
          {short ? (
            <>
              <span className="sm:hidden">{short}</span>
              <span className="hidden sm:inline">{title}</span>
            </>
          ) : (
            title
          )}
          <span className="hidden sm:inline"> · {periodWord(period, shownDay ?? null)}</span>
        </h2>
        <div className="flex shrink-0 items-center gap-1.5">
          <fieldset
            className={
              colours ? "inline-flex gap-0.5 rounded-lg bg-slate-100 p-1 text-[13px]" : "inline-flex rounded-lg bg-slate-100 p-0.5 text-[11px] font-semibold"
            }
          >
            <legend className="sr-only">Period</legend>
            {PERIODS.map((item) => (
              <button
                key={item.key}
                type="button"
                aria-pressed={period === item.key}
                onClick={() => onPick(item.key, "")}
                className={
                  colours
                    ? `rounded-md px-2.5 py-1.5 whitespace-nowrap transition-colors sm:px-3.5 ${
                        period === item.key ? "bg-white text-slate-900 shadow-[0_1px_3px_rgba(15,23,42,0.12)]" : "text-slate-500 hover:text-slate-800"
                      }`
                    : `rounded-md px-2 py-1 whitespace-nowrap transition-colors sm:px-2.5 ${
                        period === item.key
                          ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200"
                          : "text-slate-500 hover:text-slate-900"
                      }`
                }
              >
                {item.short ? (
                  <>
                    <span className="sm:hidden">{item.short}</span>
                    <span className="hidden sm:inline">{item.label}</span>
                  </>
                ) : (
                  item.label
                )}
              </button>
            ))}
          </fieldset>
          {/* A day of their choosing: the calendar opens from the icon. */}
          <label
            title={period === "day" && shownDay ? dayLabel(shownDay) : "Pick a day"}
            className={`relative grid shrink-0 cursor-pointer place-items-center ring-1 transition-colors ${
              colours ? "h-[38px] rounded-lg px-3" : "h-7 rounded-lg px-2"
            } ${
              period === "day"
                ? "bg-white text-slate-900 shadow-sm ring-slate-300"
                : "bg-slate-100 text-slate-500 ring-transparent hover:text-slate-900"
            }`}
          >
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold">
              <CalendarDays className="size-3.5" />
              {period === "day" && shownDay && (
                <span className="hidden sm:inline">{dayLabel(shownDay)}</span>
              )}
            </span>
            <span className="sr-only">Pick a day</span>
            <input
              type="date"
              value={period === "day" ? day : ""}
              max={today}
              onChange={(event) => onPick(event.target.value ? "day" : "today", event.target.value)}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
          </label>
        </div>
      </div>
      <dl
        className={`grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 ${colours ? "mx-4 mb-4" : "border-t border-slate-100"} ${faded ? "opacity-60" : ""}`}
      >
        {cells.map((cell, n) => {
          if (colours) {
            // The coloured strip: touching, square tiles, the words in the tile's own colour.
            const inner = (
              <>
                <dt className="truncate text-[11px] opacity-85">{cell.label}</dt>
                <dd className="mt-0.5 text-xl font-semibold tracking-tight tabular-nums">
                  {cell.value === undefined ? "—" : typeof cell.value === "string" ? cell.value : count(cell.value)}
                </dd>
                {cell.sub && <div className="truncate text-[11px] opacity-85">{cell.sub}</div>}
              </>
            );
            const tile = `min-w-0 px-4 py-3 ${STRIP[n % STRIP.length]}`;
            return cell.to ? (
              <Link key={cell.label} to={cell.to} className={`${tile} transition-[filter] hover:brightness-110`}>
                {inner}
              </Link>
            ) : (
              <div key={cell.label} className={tile}>
                {inner}
              </div>
            );
          }
          const body = (
            <>
              <dt className="truncate text-[11px] font-semibold text-slate-500">{cell.label}</dt>
              <dd className="mt-0.5 text-xl font-bold tracking-tight text-slate-900 tabular-nums">
                {cell.value === undefined
                  ? "—"
                  : typeof cell.value === "string"
                    ? cell.value
                    : count(cell.value)}
              </dd>
              {cell.sub && <div className="truncate text-[11px] text-slate-400">{cell.sub}</div>}
            </>
          );
          const frame = "min-w-0 border-r border-b border-slate-100 px-4 py-3 last:border-r-0";
          return cell.to ? (
            <Link
              key={cell.label}
              to={cell.to}
              className={`${frame} transition-colors hover:bg-slate-50`}
            >
              {body}
            </Link>
          ) : (
            <div key={cell.label} className={frame}>
              {body}
            </div>
          );
        })}
      </dl>
      {error && (
        <div className="border-t border-slate-100 px-4 py-3 text-xs text-rose-700">{error}</div>
      )}
    </section>
  );
}
