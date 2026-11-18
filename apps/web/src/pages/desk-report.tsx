// Each of Management's (or Finance's) people over some days (Aryan, 18 Nov: "every person's data,
// all of it"): hours started on the common screen, orders given and taken over, what they did with
// the ones they moved on, how long each took them from when it was theirs, late, open now.

import type { DeskReport } from "@2mg/api/types";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useMe } from "../auth";
import { CARD, PageHead, PageState } from "../ui";

const manila = (offsetDays = 0) => {
  const day = new Date(Date.now() + offsetDays * 86_400_000);
  return day.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
};
/** Working minutes as "1h 20m" / "35m". */
const took = (minutes: number | null) => {
  if (minutes === null) return "—";
  const m = Math.round(minutes);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60 ? `${m % 60}m` : ""}`.trim() : `${m}m`;
};

export function DeskReportPage() {
  const me = useMe().data;
  const desk = me?.role === "finance" ? "finance" : "management";
  const [params, setParams] = useSearchParams();
  const today = manila();
  const monday = (() => {
    const now = new Date(`${today}T00:00:00Z`);
    return manila(-((now.getUTCDay() + 6) % 7));
  })();
  const ranges = [
    { key: "today", label: "Today", from: today, to: today },
    { key: "week", label: "This week", from: monday, to: today },
    { key: "month", label: "This month", from: `${today.slice(0, 7)}-01`, to: today },
  ];
  const range = ranges.find((one) => one.key === params.get("range")) ?? (ranges[0] as (typeof ranges)[number]);
  const query = useQuery({
    queryKey: ["desk", desk, "report", range.from, range.to],
    queryFn: () => api<DeskReport>(`/api/desk/${desk}/report?from=${range.from}&to=${range.to}`),
    placeholderData: keepPreviousData,
  });
  const data = query.data;
  const doneWord = desk === "management" ? "Approved" : "Let go to Dispatch";
  const totals = data?.people.reduce(
    (sum, one) => ({
      hours: sum.hours + one.hours,
      given: sum.given + one.given,
      took: sum.took + one.took,
      done: sum.done + one.done,
      sentBack: sum.sentBack + one.sentBack,
      held: sum.held + one.held,
      rejected: sum.rejected + one.rejected,
      late: sum.late + one.late,
      open: sum.open + one.open,
    }),
    { hours: 0, given: 0, took: 0, done: 0, sentBack: 0, held: 0, rejected: 0, late: 0, open: 0 },
  );

  return (
    <div>
      <PageHead
        title={desk === "management" ? "Management team" : "Finance team"}
        sub={`Each person: hours started, orders given, what they did, how long each took (from when it was theirs, working time). Late: over ${desk === "management" ? "4 working hours" : "a working day"}.`}
        actions={
          <span className="flex rounded-lg border border-slate-200 bg-white p-0.5 text-[13px] font-semibold">
            {ranges.map((one) => (
              <button
                key={one.key}
                type="button"
                aria-pressed={one.key === range.key}
                onClick={() => setParams({ range: one.key }, { replace: true })}
                className={`rounded-md px-3 py-1 ${one.key === range.key ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"}`}
              >
                {one.label}
              </button>
            ))}
          </span>
        }
      />
      <PageState query={query} what="the team's figures" />
      {data && totals && (
        <section className={`${CARD} overflow-x-auto p-0`}>
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-head text-[11px] text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-2.5 text-left font-semibold">Person</th>
                <th className="px-3 py-2.5 text-right font-semibold">Hours started</th>
                <th className="px-3 py-2.5 text-right font-semibold">Given</th>
                <th className="px-3 py-2.5 text-right font-semibold">Took over</th>
                <th className="px-3 py-2.5 text-right font-semibold">{doneWord}</th>
                {desk === "management" && <th className="px-3 py-2.5 text-right font-semibold">Sent back</th>}
                <th className="px-3 py-2.5 text-right font-semibold">Held</th>
                <th className="px-3 py-2.5 text-right font-semibold">Rejected</th>
                <th className="px-3 py-2.5 text-right font-semibold">Time per order</th>
                <th className="px-3 py-2.5 text-right font-semibold">Late</th>
                <th className="px-4 py-2.5 text-right font-semibold">Open now</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {data.people.map((one) => (
                <tr key={one.id} className="border-t border-slate-100">
                  <td className="px-4 py-2.5 font-semibold text-slate-900">{one.name}</td>
                  <td className="px-3 py-2.5 text-right">{one.hours ? one.hours.toFixed(1) : "—"}</td>
                  <td className="px-3 py-2.5 text-right">{one.given}</td>
                  <td className="px-3 py-2.5 text-right">{one.took}</td>
                  <td className="px-3 py-2.5 text-right font-semibold text-emerald-700">{one.done}</td>
                  {desk === "management" && <td className="px-3 py-2.5 text-right">{one.sentBack}</td>}
                  <td className="px-3 py-2.5 text-right">{one.held}</td>
                  <td className="px-3 py-2.5 text-right">{one.rejected}</td>
                  <td className="px-3 py-2.5 text-right">{took(one.medianMinutes)}</td>
                  <td className={`px-3 py-2.5 text-right ${one.late ? "font-semibold text-rose-700" : ""}`}>{one.late}</td>
                  <td className="px-4 py-2.5 text-right">{one.open}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                <td className="px-4 py-2.5">All</td>
                <td className="px-3 py-2.5 text-right">{totals.hours ? totals.hours.toFixed(1) : "—"}</td>
                <td className="px-3 py-2.5 text-right">{totals.given}</td>
                <td className="px-3 py-2.5 text-right">{totals.took}</td>
                <td className="px-3 py-2.5 text-right text-emerald-700">{totals.done}</td>
                {desk === "management" && <td className="px-3 py-2.5 text-right">{totals.sentBack}</td>}
                <td className="px-3 py-2.5 text-right">{totals.held}</td>
                <td className="px-3 py-2.5 text-right">{totals.rejected}</td>
                <td className="px-3 py-2.5 text-right">—</td>
                <td className="px-3 py-2.5 text-right">{totals.late}</td>
                <td className="px-4 py-2.5 text-right">{totals.open}</td>
              </tr>
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
