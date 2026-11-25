// The Admin panel's Slow screens: which addresses answered slowly online in the last two weeks,
// the costliest first (how often, how long, how many questions each asked the database, and whose
// seats met it). The server notes every answer that took it over 0.8 seconds.

import type { SlowScreens } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { count, PageHead, PageState, timeLabel } from "../ui";

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

export function AdminSlowScreens() {
  const query = useQuery({
    queryKey: ["admin", "slow-screens"],
    queryFn: () => api<SlowScreens>("/api/admin/slow-screens"),
    staleTime: 0,
  });
  const data = query.data;
  if (!data) return <PageState query={query} what="the slow screens" />;
  return (
    <div className="mx-auto max-w-5xl">
      <PageHead
        title="Slow screens"
        sub={
          data.times
            ? `${count(data.times)} slow answers since ${data.since ? timeLabel(data.since) : "the start"} · slow means over ${seconds(data.slowMs)} on the server`
            : `Nothing took the server over ${seconds(data.slowMs)} in the last two weeks`
        }
      />
      {data.rows.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
              <tr>
                <th className="px-3 py-2">What was asked</th>
                <th className="px-3 py-2 text-right">Times</th>
                <th className="px-3 py-2 text-right">Usually</th>
                <th className="px-3 py-2 text-right">Worst</th>
                <th className="px-3 py-2 text-right">Questions</th>
                <th className="px-3 py-2">Seats</th>
                <th className="px-3 py-2">Last</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.rows.map((row) => (
                <tr key={`${row.method} ${row.path}`}>
                  <td className="px-3 py-2 font-mono text-[12px] text-slate-800">
                    {row.method === "GET" ? "" : `${row.method} `}
                    {row.path}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{count(row.times)}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{seconds(row.avgMs)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-rose-700">{seconds(row.worstMs)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{count(row.questions)}</td>
                  <td className="px-3 py-2 text-slate-600">{row.roles}</td>
                  <td className="px-3 py-2 text-slate-500">{timeLabel(row.lastAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
