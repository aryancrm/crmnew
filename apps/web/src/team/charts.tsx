// Small charts drawn by hand in SVG and CSS: no chart library, so the pages stay light. A ring
// (sold against target), a sparkline, bars by day, a donut (orders by where they stand) and
// labelled horizontal bars.

import { Link } from "react-router-dom";
import { shortPeso } from "../ceo";
import { useOpenOnPress } from "../ui";

export type Slice = { label: string; value: number; color: string };

/** A ring filled to a share (0–1), the pace marked; its figure in the middle. */
export function Ring({
  share,
  pace,
  color,
  size = 64,
  children,
}: {
  share: number | null;
  pace?: number | null;
  color: string;
  size?: number;
  children?: React.ReactNode;
}) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const filled = Math.max(0, Math.min(1, share ?? 0));
  const paceAt = pace && pace > 0 && pace < 1 ? pace : null;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
        <circle cx="32" cy="32" r={r} fill="none" stroke="#e2e8f0" strokeWidth="7" />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${filled * c} ${c}`}
          transform="rotate(-90 32 32)"
        />
        {paceAt !== null && (
          <line
            x1="32"
            y1="2.5"
            x2="32"
            y2="11.5"
            stroke="#334155"
            strokeWidth="2"
            transform={`rotate(${paceAt * 360} 32 32)`}
          />
        )}
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center text-[11px] leading-tight font-bold text-slate-800 tabular-nums">
        {children}
      </div>
    </div>
  );
}

/** A small line of values, the last one dotted. */
export function Spark({
  values,
  color = "#059669",
  height = 28,
}: {
  values: number[];
  color?: string;
  height?: number;
}) {
  if (values.length < 2) return <div style={{ height }} />;
  const top = Math.max(...values, 1);
  const w = 100;
  const step = w / (values.length - 1);
  const points = values.map(
    (value, n) =>
      `${(n * step).toFixed(2)},${(height - 2 - (value / top) * (height - 6)).toFixed(2)}`,
  );
  const last = points[points.length - 1]?.split(",") ?? ["0", "0"];
  return (
    <svg
      viewBox={`0 0 ${w} ${height}`}
      preserveAspectRatio="none"
      className="block w-full"
      style={{ height }}
      aria-hidden="true"
    >
      <polyline
        points={`0,${height} ${points.join(" ")} ${w},${height}`}
        fill={color}
        opacity="0.08"
      />
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke={color}
        strokeWidth="1.6"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={last[0]} cy={last[1]} r="2" fill={color} />
    </svg>
  );
}

/** Bars by day: what was placed (light) and what was invoiced (dark), the days under them. */
export function DayBars({
  days,
}: {
  days: { day: string; sold: number; placed: number; collected: number }[];
}) {
  const top = Math.max(1, ...days.map((one) => Math.max(one.sold, one.placed)));
  const every = Math.max(1, Math.ceil(days.length / 10));
  return (
    <div className="flex flex-col gap-2">
      <div
        className="flex h-44 items-end gap-[3px]"
        role="img"
        aria-label="Placed and sold each day"
      >
        {days.map((one) => (
          <div
            key={one.day}
            className="group relative flex h-full min-w-0 flex-1 items-end justify-center"
            title={`${one.day}: placed ${shortPeso(one.placed)} · sold ${shortPeso(one.sold)} · collected ${shortPeso(one.collected)}`}
          >
            <div
              className="absolute bottom-0 w-full rounded-t bg-emerald-100"
              style={{ height: `${(one.placed / top) * 100}%` }}
            />
            <div
              className="relative w-3/5 rounded-t bg-emerald-600"
              style={{ height: `${(one.sold / top) * 100}%` }}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-[3px] text-[10px] text-slate-400 tabular-nums">
        {days.map((one, n) => (
          <div key={one.day} className="min-w-0 flex-1 text-center">
            {n % every === 0 ? Number(one.day.slice(8)) : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

/** A donut of parts, the total in the middle, with its legend. */
export function Donut({
  slices,
  middle,
  label,
  centred = false,
}: {
  slices: Slice[];
  middle: string;
  label: string;
  /** The circle centred on its own line, the list under it (a narrow card). */
  centred?: boolean;
}) {
  const total = slices.reduce((sum, one) => sum + one.value, 0);
  const r = 40;
  const c = 2 * Math.PI * r;
  let at = 0;
  return (
    <div className={centred ? "flex flex-col items-center gap-4" : "flex flex-wrap items-center gap-5"}>
      <div className="relative size-36 shrink-0">
        <svg viewBox="0 0 100 100" className="size-36" role="img" aria-label={label}>
          <circle cx="50" cy="50" r={r} fill="none" stroke="#f1f5f9" strokeWidth="14" />
          {total > 0 &&
            slices
              .filter((one) => one.value > 0)
              .map((one) => {
                const length = (one.value / total) * c;
                const dash = (
                  <circle
                    key={one.label}
                    cx="50"
                    cy="50"
                    r={r}
                    fill="none"
                    stroke={one.color}
                    strokeWidth="14"
                    strokeDasharray={`${length} ${c - length}`}
                    strokeDashoffset={-at}
                    transform="rotate(-90 50 50)"
                  />
                );
                at += length;
                return dash;
              })}
        </svg>
        {middle && (
          // No middle when the card already says the number above (never twice).
          <div className="absolute inset-0 grid place-items-center text-center">
            <div>
              <div className="text-2xl font-semibold text-slate-900 tabular-nums">{middle}</div>
              <div className="text-[11px] text-slate-500">{label}</div>
            </div>
          </div>
        )}
      </div>
      {/* minmax(0, 1fr): the list takes the room there is, the long labels shorten, and the numbers
          stay inside the card (they ran past its edge, Aryan 26 Nov). */}
      <ul className={`grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1.5 text-[13px] ${centred ? "w-full" : "flex-1 basis-40"}`}>
        {slices.map((one) => (
          <li key={one.label} className="flex min-w-0 items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-sm" style={{ background: one.color }} />
            <span className="min-w-0 flex-1 truncate text-slate-600">{one.label}</span>
            <span className="shrink-0 pl-2 font-semibold text-slate-900 tabular-nums">{one.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Labelled bars, longest first: a value against an optional mark (a target). A row with a page
 *  behind it (`to`) opens it when pressed anywhere on it. */
export function Bars({
  rows,
  format = shortPeso,
  color = "bg-emerald-500",
}: {
  rows: {
    key: string | number;
    label: string;
    sub?: string;
    value: number;
    mark?: number | null;
    tone?: string;
    /** The page the row opens (a person's page), when it has one. */
    to?: string;
  }[];
  format?: (value: number) => string;
  color?: string;
}) {
  const open = useOpenOnPress();
  const top = Math.max(1, ...rows.map((row) => Math.max(row.value, row.mark ?? 0)));
  return (
    <ul className="grid gap-2.5">
      {rows.map((row) => (
        <li
          key={row.key}
          onClick={row.to ? open(row.to) : undefined}
          className={`grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-3 text-[13px] ${
            row.to ? "-mx-2 -my-1 cursor-pointer rounded-lg px-2 py-1 hover:bg-slate-50" : ""
          }`}
        >
          <span className="min-w-0">
            {row.to ? (
              // The name stays a link, for the keyboard.
              <Link to={row.to} className="block truncate font-medium text-slate-800 hover:underline">
                {row.label}
              </Link>
            ) : (
              <span className="block truncate font-medium text-slate-800">{row.label}</span>
            )}
            {row.sub && (
              <span className="block truncate text-[11px] text-slate-400">{row.sub}</span>
            )}
          </span>
          <span className="relative h-3 rounded-full bg-slate-100">
            <span
              className={`absolute inset-y-0 left-0 rounded-full ${row.tone ?? color}`}
              style={{ width: `${(row.value / top) * 100}%` }}
            />
            {row.mark ? (
              <span
                className="absolute -top-1 h-5 w-0.5 rounded bg-slate-500"
                style={{ left: `${(row.mark / top) * 100}%` }}
                title={`Target ${format(row.mark)}`}
              />
            ) : null}
          </span>
          <span className="text-right font-semibold text-slate-900 tabular-nums">
            {format(row.value)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Lines over days: a few series (null = nothing that day), each in its colour, with a legend. */
export function Lines({
  days,
  series,
  format,
  limit,
}: {
  days: string[];
  series: { label: string; color: string; values: (number | null)[] }[];
  format: (value: number) => string;
  /** A dashed line: the limit to stay under. */
  limit?: { value: number; label: string } | null;
}) {
  const height = 180;
  const width = 600;
  const top = Math.max(
    1,
    limit?.value ?? 0,
    ...series.flatMap((one) => one.values.filter((value): value is number => value !== null)),
  );
  const x = (n: number) => (days.length <= 1 ? width / 2 : (n / (days.length - 1)) * width);
  const y = (value: number) => height - 6 - (value / top) * (height - 16);
  const every = Math.max(1, Math.ceil(days.length / 10));
  return (
    <div className="flex flex-col gap-2">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="h-44 w-full"
        role="img"
        aria-label="Average time by day"
      >
        {[0.25, 0.5, 0.75, 1].map((share) => (
          <line
            key={share}
            x1="0"
            x2={width}
            y1={y(top * share)}
            y2={y(top * share)}
            stroke="#f1f5f9"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {limit && (
          <line
            x1="0"
            x2={width}
            y1={y(limit.value)}
            y2={y(limit.value)}
            stroke="#f43f5e"
            strokeDasharray="6 4"
            strokeWidth="1.2"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {series.map((one) => {
          const points = one.values
            .map((value, n) =>
              value === null ? null : `${x(n).toFixed(1)},${y(value).toFixed(1)}`,
            )
            .filter((point): point is string => point !== null);
          return (
            <g key={one.label}>
              {points.length > 1 && (
                <polyline
                  points={points.join(" ")}
                  fill="none"
                  stroke={one.color}
                  strokeWidth="2"
                  vectorEffect="non-scaling-stroke"
                  strokeLinejoin="round"
                />
              )}
              {one.values.map((value, n) =>
                value === null ? null : (
                  <circle
                    key={days[n]}
                    cx={x(n)}
                    cy={y(value)}
                    r="3"
                    fill={one.color}
                    vectorEffect="non-scaling-stroke"
                  >
                    <title>{`${days[n]} · ${one.label}: ${format(value)}`}</title>
                  </circle>
                ),
              )}
            </g>
          );
        })}
      </svg>
      <div className="flex justify-between text-[10px] text-slate-400 tabular-nums">
        {days.map((name, n) => (
          <span key={name} className="min-w-0 flex-1 text-center">
            {n % every === 0 ? Number(name.slice(8)) : ""}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-3 text-xs text-slate-600">
        {series.map((one) => (
          <span key={one.label} className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded" style={{ background: one.color }} /> {one.label}
          </span>
        ))}
        {limit && (
          <span className="flex items-center gap-1.5 text-rose-600">
            <span className="h-0 w-4 border-t border-dashed border-rose-500" /> {limit.label}
          </span>
        )}
        <span className="text-slate-400">Top of the chart: {format(top)}</span>
      </div>
    </div>
  );
}
