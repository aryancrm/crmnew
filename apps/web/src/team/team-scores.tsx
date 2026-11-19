// A lead's (or the CEO's, the Admin's) scorecards: one row per scored seat under them, the
// month's total, each KPI's points, the 12-month average and its increment, the improvement-plan
// flag; then the questions waiting for their answer. A row opens the person's own card.

import type { TeamScores } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { TeamSwitch, useTeamUnit, withUnit } from "./switch";
import { CARD, PageHead, PageState } from "../ui";
import { Disputes, MonthPicker, toneOf } from "../sellers/my-score";

export function TeamScoresPage() {
  const [params, setParams] = useSearchParams();
  const month = params.get("month") ?? "";
  const unit = useTeamUnit();
  const query = useQuery({
    queryKey: ["scores", "team", month, unit],
    queryFn: () => api<TeamScores>(withUnit(`/api/scores/team${month ? `?month=${month}` : ""}`, unit)),
  });
  const data = query.data;
  if (!data) return <PageState query={query} what="the team's scorecards" />;
  const keys = [...new Set(data.rows.flatMap((row) => row.card?.kpis.map((kpi) => kpi.key) ?? []))];
  const filled = data.rows.filter((row) => row.card);
  const average = filled.length ? Math.round(filled.reduce((sum, row) => sum + (row.card?.percent ?? 0), 0) / filled.length) : null;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHead
        title="Scorecards"
        sub={`${filled.length} of ${data.rows.length} scored seats with a card${average === null ? "" : ` · team average ${average}`}`}
        actions={
          <MonthPicker
            month={data.month}
            today={data.today}
            onChange={(next) =>
              setParams(
                (now) => {
                  now.set("month", next);
                  return now;
                },
                { replace: true },
              )
            }
          />
        }
      />
      <div className="mb-4">
        <TeamSwitch />
      </div>
      <div className={`${CARD} mb-4 overflow-x-auto`}>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
              <th className="px-4 py-2.5">Seat</th>
              <th className="px-3 py-2.5 text-right">Score</th>
              {keys.map((key) => (
                <th key={key} className="px-3 py-2.5 text-right">
                  {key}
                </th>
              ))}
              <th className="px-3 py-2.5 text-right">12-month</th>
              <th className="px-4 py-2.5">Increment</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.rows.map((row) => (
              <tr key={row.seatId} className="hover:bg-slate-50/60">
                <td className="px-4 py-2.5">
                  {row.personId ? (
                    <Link to={`/my/score?person=${row.personId}&month=${data.month}`} className="font-semibold text-slate-900 hover:underline">
                      {row.name}
                    </Link>
                  ) : (
                    <span className="font-semibold text-slate-400">Empty seat</span>
                  )}
                  <div className="text-[11.5px] text-slate-500">{[row.area ?? row.title, row.unit].join(" · ")}</div>
                </td>
                <td className="px-3 py-2.5 text-right">
                  {row.card ? (
                    <span className="inline-flex items-center gap-1.5 font-bold tabular-nums" style={{ color: toneOf(row.card.percent) }}>
                      {row.card.total}
                      <span className="text-[11px] font-normal text-slate-400">/{row.card.max}</span>
                      {row.card.live && <span className="size-1.5 rounded-full bg-sky-500" title="Running" />}
                    </span>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                {keys.map((key) => {
                  const kpi = row.card?.kpis.find((one) => one.key === key);
                  return (
                    <td key={key} className="px-3 py-2.5 text-right text-slate-700 tabular-nums" title={kpi?.note}>
                      {kpi?.points ?? "—"}
                    </td>
                  );
                })}
                <td className="px-3 py-2.5 text-right tabular-nums">{row.average ?? "—"}</td>
                <td className="px-4 py-2.5 whitespace-nowrap">
                  {row.increment ? `${row.increment.percent}% · ${row.increment.label}` : "—"}
                  {row.pip && <span className="ml-2 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-800">Plan</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.disputes.length > 0 && <Disputes disputes={data.disputes} canAnswer />}
    </div>
  );
}
