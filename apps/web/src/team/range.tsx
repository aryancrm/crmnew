// The days a page looks at: Today, This week, This month, Last month, Last 30 days, This year,
// or two dates picked; kept in the address as ?from= and ?to= (Manila days).

import { CalendarRange } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";

const CARD = "rounded-2xl border border-slate-200/90 bg-white shadow-sm";

export const manilaToday = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
const shift = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
function presets(today: string): { key: string; label: string; from: string; to: string }[] {
  const [y, m] = today.split("-").map(Number) as [number, number];
  const monday = shift(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
  const lastMonthEnd = shift(`${today.slice(0, 7)}-01`, -1);
  return [
    { key: "today", label: "Today", from: today, to: today },
    { key: "week", label: "This week", from: monday, to: today },
    { key: "month", label: "This month", from: `${today.slice(0, 7)}-01`, to: today },
    { key: "last", label: "Last month", from: `${lastMonthEnd.slice(0, 7)}-01`, to: lastMonthEnd },
    { key: "30", label: "Last 30 days", from: shift(today, -29), to: today },
    { key: "year", label: "This year", from: `${y}-01-01`, to: today },
  ].map((one) => ({ ...one, from: one.from, to: one.to, m }));
}
/**
 * The days a company report asks the board for. This month (the first look, or the chip) is the
 * whole month: the month's target, and the pace mark where day N of the month should be (the old
 * reports' way). Any other range as picked.
 */
export function reportRange(params: URLSearchParams): { from: string; to: string } {
  const today = manilaToday();
  const first = `${today.slice(0, 7)}-01`;
  const from = params.get("from");
  const to = params.get("to");
  if (!to || (from === first && to === today)) {
    const [y, m] = today.split("-").map(Number) as [number, number];
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { from: first, to: `${today.slice(0, 7)}-${String(last).padStart(2, "0")}` };
  }
  return { from: from ?? first, to };
}
export const short = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-PH", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

export function RangePicker() {
  const [params, setParams] = useSearchParams();
  const today = manilaToday();
  const list = presets(today);
  const from = params.get("from") ?? list[2]?.from ?? today;
  const to = params.get("to") ?? today;
  const picked = list.find((one) => one.from === from && one.to === to)?.key ?? "custom";
  const [custom, setCustom] = useState(picked === "custom");
  const set = (next: { from: string; to: string }) =>
    setParams(
      (now) => {
        const out = new URLSearchParams(now);
        out.set("from", next.from);
        out.set("to", next.to);
        return out;
      },
      { replace: true },
    );
  return (
    <div className={`${CARD} flex flex-wrap items-center gap-1 p-1.5`}>
      <CalendarRange className="mx-1.5 size-4 text-slate-400" aria-hidden="true" />
      {list.map((one) => (
        <button
          key={one.key}
          type="button"
          onClick={() => {
            setCustom(false);
            set(one);
          }}
          className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ${picked === one.key && !custom ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-100"}`}
        >
          {one.label}
        </button>
      ))}
      <button
        type="button"
        onClick={() => setCustom(true)}
        className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ${custom || picked === "custom" ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-100"}`}
      >
        Pick dates
      </button>
      {(custom || picked === "custom") && (
        <span className="flex items-center gap-1.5 px-1 text-xs text-slate-500">
          <input
            type="date"
            value={from}
            max={to}
            onChange={(event) => event.target.value && set({ from: event.target.value, to })}
            className="h-8 rounded-lg border border-slate-300 px-2 text-xs text-slate-800"
            aria-label="From"
          />
          to
          <input
            type="date"
            value={to}
            min={from}
            max={today}
            onChange={(event) => event.target.value && set({ from, to: event.target.value })}
            className="h-8 rounded-lg border border-slate-300 px-2 text-xs text-slate-800"
            aria-label="To"
          />
        </span>
      )}
    </div>
  );
}
