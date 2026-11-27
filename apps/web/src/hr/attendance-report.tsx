// The attendance report over chosen days: who worked how long, who less, who came late, who was
// absent and who was on leave. The CEO's page for people's time (HR's and a team lead's for their
// team too). It only reads: HR puts days right and records leave on a person's month.

import type { AttendanceReport, LeaveKind } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { hours } from "./parts";
import { Ring } from "../team/charts";
import { manilaToday, RangePicker, short } from "../team/range";
import { CARD, PageHead, PageState } from "../ui";
import { EmptyState, NoResults } from "../no-results";

export const LEAVE_WORDS: Record<LeaveKind, string> = {
  vl: "Vacation",
  sl: "Sick",
  lwop: "Without pay",
  other: "Other",
};
const LEAVE_SHORT: Record<LeaveKind, string> = { vl: "VL", sl: "SL", lwop: "LWOP", other: "Other" };

type Sort = "hours" | "late" | "absent" | "leave" | "name";
type Row = AttendanceReport["people"][number];
const SORTS: { key: Sort; label: string; by: (a: Row, b: Row) => number }[] = [
  {
    key: "hours",
    label: "Fewest hours",
    // Against what their days asked for, so a person with leave isn't ranked short.
    by: (a, b) => share(a) - share(b) || a.workedMinutes - b.workedMinutes,
  },
  { key: "late", label: "Most late", by: (a, b) => b.lateMinutes - a.lateMinutes },
  { key: "absent", label: "Most absent", by: (a, b) => b.absent - a.absent },
  { key: "leave", label: "Most leave", by: (a, b) => b.leaveDays - a.leaveDays },
  { key: "name", label: "Name", by: (a, b) => a.name.localeCompare(b.name) },
];
const share = (one: Row) =>
  one.expectedMinutes ? one.workedMinutes / one.expectedMinutes : one.workedMinutes ? 1 : 0;
const days = (value: number) => (value % 1 ? value.toFixed(1) : String(value));
const percent = (value: number) => `${Math.round(value * 100)}%`;

export function AttendanceReportPage() {
  const [params, setParams] = useSearchParams();
  const today = manilaToday();
  const from = params.get("from") ?? `${today.slice(0, 7)}-01`;
  const to = params.get("to") ?? today;
  const sort = (params.get("sort") as Sort | null) ?? "hours";
  const query = useQuery({
    queryKey: ["attendance", "report", from, to],
    queryFn: () => api<AttendanceReport>(`/api/hr/attendance/report?from=${from}&to=${to}`),
    placeholderData: (previous) => previous,
  });
  const [q, setQ] = useState("");
  const data = query.data;
  if (!data) return <PageState query={query} what="the attendance report" />;
  const t = data.totals;
  const askedDays = t.workDays - t.leaveDays;
  const words = q.trim().toLowerCase();
  const order = SORTS.find((one) => one.key === sort) ?? (SORTS[0] as (typeof SORTS)[number]);
  const rows = data.people
    .filter((one) => !words || `${one.name} ${one.team ?? ""}`.toLowerCase().includes(words))
    .sort(order.by);
  const leaveByKind = (["vl", "sl", "lwop", "other"] as LeaveKind[])
    .map(
      (kind) => [kind, data.people.reduce((sum, one) => sum + (one.leave[kind] ?? 0), 0)] as const,
    )
    .filter(([, value]) => value > 0);
  const setSort = (next: Sort) => {
    const out = new URLSearchParams(params);
    if (next === "hours") out.delete("sort");
    else out.set("sort", next);
    setParams(out, { replace: true });
  };
  const month = (one: Row) => `/hr/attendance/${one.personId}?month=${data.to.slice(0, 7)}`;

  return (
    <div className={`flex flex-col gap-4 ${query.isPlaceholderData ? "opacity-60" : ""}`}>
      <PageHead
        title="Attendance report"
        sub={`${data.from === data.to ? short(data.from) : `${short(data.from)} – ${short(data.to)}`} · ${t.people} people`}
      >
        <RangePicker />
      </PageHead>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className={`${CARD} flex items-center gap-4 p-4`}>
          <Ring share={askedDays ? t.present / askedDays : null} color="#059669" size={72}>
            <span className="text-sm font-semibold text-slate-900 tabular-nums">
              {askedDays ? percent(t.present / askedDays) : "—"}
            </span>
          </Ring>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-slate-500">Came in</div>
            <div className="mt-1 text-sm text-slate-700">
              {t.present} of {days(askedDays)} working days
            </div>
            <div className="text-xs text-slate-400">leave days left out</div>
          </div>
        </div>
        <div className={`${CARD} p-4`}>
          <div className="text-xs font-semibold text-slate-500">Hours worked</div>
          <div className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums">
            {hours(t.workedMinutes)}
          </div>
          <div className="mt-2 h-2 rounded-full bg-slate-100">
            <div
              className="h-2 rounded-full bg-emerald-500"
              style={{
                width: `${Math.min(100, t.expectedMinutes ? (t.workedMinutes / t.expectedMinutes) * 100 : 0)}%`,
              }}
            />
          </div>
          <div className="mt-1 text-xs text-slate-500">
            of {hours(t.expectedMinutes)} their days ask for
          </div>
        </div>
        <div className={`${CARD} p-4`}>
          <div className="text-xs font-semibold text-slate-500">Came late</div>
          <div className="mt-1 text-2xl font-semibold text-amber-700 tabular-nums">
            {t.lateDays}
            <span className="text-sm font-medium text-slate-500"> times</span>
          </div>
          <div className="mt-1 text-xs text-slate-500">{hours(t.lateMinutes)} late in all</div>
        </div>
        <div className={`${CARD} p-4`}>
          <div className="text-xs font-semibold text-slate-500">Absent and on leave</div>
          <div className="mt-1 flex items-baseline gap-4 tabular-nums">
            <span className="text-2xl font-semibold text-rose-700">
              {t.absent}
              <span className="text-sm font-medium text-slate-500"> absent</span>
            </span>
            <span className="text-2xl font-semibold text-violet-700">
              {days(t.leaveDays)}
              <span className="text-sm font-medium text-slate-500"> leave</span>
            </span>
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {leaveByKind.length
              ? leaveByKind
                  .map(([kind, value]) => `${LEAVE_SHORT[kind]} ${days(value)}`)
                  .join(" · ")
              : "No leave recorded"}
          </div>
        </div>
      </div>

      <section className={`${CARD} overflow-hidden`}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <label className="relative flex items-center">
            <Search size={15} className="pointer-events-none absolute left-3 text-slate-400" />
            <input
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="Find a person or team"
              className="h-9 w-56 max-w-full rounded-lg border border-slate-300 bg-white pr-3 pl-9 text-sm"
            />
          </label>
          <fieldset className="flex flex-wrap items-center gap-1" aria-label="Order by">
            {SORTS.map((one) => (
              <button
                key={one.key}
                type="button"
                onClick={() => setSort(one.key)}
                aria-pressed={one.key === order.key}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ${one.key === order.key ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-100"}`}
              >
                {one.label}
              </button>
            ))}
          </fieldset>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                <th className="px-4 py-2">Person</th>
                <th className="px-3 py-2">Hours worked</th>
                <th className="px-3 py-2 text-right">Days in</th>
                <th className="px-3 py-2 text-right">A day</th>
                <th className="px-3 py-2 text-right">Late</th>
                <th className="px-3 py-2 text-right">Undertime</th>
                <th className="px-3 py-2 text-right">Overtime</th>
                <th className="px-3 py-2 text-right">Absent</th>
                <th className="px-3 py-2">Leave</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((one) => {
                const filled = share(one);
                return (
                  <tr key={one.personId} className="hover:bg-slate-50/70">
                    <td className="px-4 py-2.5">
                      <Link
                        to={month(one)}
                        className="font-semibold text-slate-900 hover:text-emerald-700"
                      >
                        {one.name}
                      </Link>
                      <div className="text-xs text-slate-500">
                        {[one.title, one.team].filter(Boolean).join(" · ")}
                      </div>
                    </td>
                    <td className="min-w-44 px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="h-2 flex-1 rounded-full bg-slate-100">
                          <div
                            className={`h-2 rounded-full ${filled >= 0.95 ? "bg-emerald-500" : filled >= 0.8 ? "bg-amber-400" : "bg-rose-500"}`}
                            style={{ width: `${Math.min(100, filled * 100)}%` }}
                          />
                        </div>
                        <span className="w-16 text-right text-xs text-slate-700 tabular-nums">
                          {hours(one.workedMinutes)}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400">
                        of {hours(one.expectedMinutes)}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {one.present}
                      <span className="text-slate-400">/{days(one.workDays - one.leaveDays)}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {hours(one.averageMinutes)}
                    </td>
                    <td
                      className={`px-3 py-2.5 text-right tabular-nums ${one.lateDays ? "text-amber-700" : "text-slate-400"}`}
                    >
                      {one.lateDays ? `${one.lateDays}× · ${hours(one.lateMinutes)}` : "—"}
                    </td>
                    <td
                      className={`px-3 py-2.5 text-right tabular-nums ${one.undertimeMinutes ? "text-amber-700" : "text-slate-400"}`}
                    >
                      {hours(one.undertimeMinutes)}
                    </td>
                    <td
                      className={`px-3 py-2.5 text-right tabular-nums ${one.overtimeMinutes ? "text-emerald-700" : "text-slate-400"}`}
                      title={
                        one.formDays
                          ? `${one.formDays} days of official business or work from home`
                          : undefined
                      }
                    >
                      {hours(one.overtimeMinutes)}
                    </td>
                    <td
                      className={`px-3 py-2.5 text-right tabular-nums ${one.absent ? "font-semibold text-rose-700" : "text-slate-400"}`}
                    >
                      {one.absent || "—"}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-violet-700">
                      {one.leaveDays ? (
                        (Object.entries(one.leave) as [LeaveKind, number][])
                          .map(([kind, value]) => `${LEAVE_SHORT[kind]} ${days(value)}`)
                          .join(" · ")
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9}>
                    {words ? (
                      <NoResults title="Nobody here.">Check the spelling, or clear the search.</NoResults>
                    ) : (
                      <EmptyState title="Nobody here.">People's hours, lateness, absence and leave over these days show here.</EmptyState>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
