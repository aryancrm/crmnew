// A lead's (or the CEO's, the Admin's) scorecards: one row per scored person under them (and per
// empty seat), the month's total, the card's kind and each KPI's points, the Field work card's
// total (PLAN 23), the 12-month average and its increment, the improvement-plan flag; then the
// questions waiting for their answer. A row opens the person's own card, pressed anywhere.

import type { TeamScores } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { TeamSwitch, useTeamUnit, withUnit } from "./switch";
import { CARD, PageHead, PageState, useOpenOnPress } from "../ui";
import { hqOfSeat, withHq } from "./hq-name";
import { Disputes, MonthPicker, toneOf } from "../sellers/my-score";

/** A lead's own card (it averages their team's cards), not a seller's. */
const leadCard = (row: TeamScores["rows"][number]) => row.card?.recipe === "lead" || row.card?.recipe === "team";

export function TeamScoresPage() {
  const [params, setParams] = useSearchParams();
  const month = params.get("month") ?? "";
  const unit = useTeamUnit();
  // A press anywhere on a person's row opens their scorecard (28 Nov, PLAN 271).
  const open = useOpenOnPress();
  const query = useQuery({
    queryKey: ["scores", "team", month, unit],
    queryFn: () => api<TeamScores>(withUnit(`/api/scores/team${month ? `?month=${month}` : ""}`, unit)),
  });
  const data = query.data;
  if (!data) return <PageState query={query} what="the team's scorecards" />;
  // Each person once: someone holding two seats (Honey, a lead) has one card, so one row.
  const seen = new Set<number>();
  const rows = data.rows.filter((row) => {
    if (!row.personId) return true;
    if (seen.has(row.personId)) return false;
    seen.add(row.personId);
    return true;
  });
  const filled = rows.filter((row) => row.card);
  // The team's average is its sellers' cards, not the leads' own.
  const sellers = filled.filter((row) => !leadCard(row));
  const average = sellers.length ? Math.round(sellers.reduce((sum, row) => sum + (row.card?.percent ?? 0), 0) / sellers.length) : null;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHead
        title="Scorecards"
        sub={`${filled.length} of ${rows.length} scored seats with a card${average === null ? "" : ` · team average ${average}`}`}
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
              <th className="px-3 py-2.5">KPIs (points)</th>
              <th className="px-3 py-2.5 text-right">Field</th>
              <th className="px-3 py-2.5 text-right">12-month</th>
              <th className="px-4 py-2.5">Increment</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => {
              // A seller after their HQ ("TAFT · Marwin Dy", "ON SITE · Mary Jane Viñas"); a lead by
              // name, with their title (PLAN 265). Never the territory's or the seat's own name.
              const lead = leadCard(row);
              const hq = hqOfSeat({ lead, area: row.area ? { name: row.area } : null, person: row.name ? { name: row.name } : null });
              const card = row.personId ? `/my/score?person=${row.personId}&month=${data.month}` : null;
              return (
                <tr key={row.seatId} onClick={card ? open(card) : undefined} className={`hover:bg-slate-50/60 ${card ? "cursor-pointer" : ""}`}>
                  <td className="px-4 py-2.5">
                    {card ? (
                      <Link to={card} className="font-semibold text-slate-900 hover:underline">
                        {withHq(hq, row.name ?? "")}
                      </Link>
                    ) : (
                      <span className="font-semibold text-slate-400">{withHq(hq, "Empty seat")}</span>
                    )}
                    <div className="text-[11.5px] text-slate-500">{[...new Set([lead ? row.title : null, row.unit].filter(Boolean))].join(" · ")}</div>
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
                  <td className="px-3 py-2.5">
                    {row.card ? (
                      <>
                        <div className="text-[11px] text-slate-500">{row.card.label}</div>
                        <div className="flex flex-wrap gap-1">
                          {row.card.kpis
                            .filter((kpi) => kpi.weight > 0)
                            .map((kpi) => (
                              <span key={kpi.key} title={`${kpi.label}: ${kpi.note ?? ""}`} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700 tabular-nums">
                                {kpi.label.split(" ·")[0]} {kpi.points ?? "—"}/{kpi.weight}
                              </span>
                            ))}
                        </div>
                      </>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {row.field ? (
                      <span className="font-semibold tabular-nums" style={{ color: toneOf(row.field.percent) }} title="Field work card (interim)">
                        {row.field.total}
                        <span className="text-[11px] font-normal text-slate-400">/{row.field.max}</span>
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{row.average ?? "—"}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    {row.increment ? `${row.increment.percent}% · ${row.increment.label}` : "—"}
                    {row.pip && <span className="ml-2 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-800">Plan</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {data.disputes.length > 0 && <Disputes disputes={data.disputes} canAnswer />}
    </div>
  );
}
