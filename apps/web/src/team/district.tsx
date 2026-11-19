// A District Sales Coach's Home blocks (Hospital CHC Playbook): who needs the coach today, the
// district now (each CHC's month so far, worst first), tonight's huddle in one line, and from the
// 15th the rescue list. Each name opens that person's scorecard.

import type { District } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { LifeBuoy, Megaphone, TriangleAlert } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { shortPeso } from "../ceo";
import { CARD } from "../ui";
import { withUnit } from "./switch";

const tone = (good: boolean | null, warn: boolean) =>
  good === null ? "text-slate-400" : good ? "text-emerald-700" : warn ? "text-amber-700" : "text-rose-700";

export function DistrictNow({ unit = null }: { unit?: number | null } = {}) {
  const query = useQuery({
    queryKey: ["team", "district", unit ?? ""],
    queryFn: () => api<District>(withUnit("/api/team/district", unit ? String(unit) : null)),
    refetchInterval: 120_000,
  });
  const data = query.data;
  if (!data) return null;
  const needs = data.rows.filter((row) => row.needs.length);
  const units = [...new Set(data.rows.map((row) => row.unit))];
  const rescue = data.rows.filter((row) => row.rescue.length);
  const declared = data.rows.filter((row) => row.huddle?.declared).length;
  const blockers = data.rows.filter((row) => row.huddle?.blocker);
  return (
    <>
      <section className={`${CARD} min-w-0`}>
        <header className="flex items-baseline justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
          <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-900">
            <TriangleAlert className="size-4 text-amber-600" /> Needs you today
          </h2>
          <span className="text-xs text-slate-500">{needs.length ? `${needs.length} of ${data.rows.length} CHCs` : "Nothing urgent"}</span>
        </header>
        {needs.length === 0 ? (
          <p className="px-4 py-3 text-[13px] text-slate-500 sm:px-5">Every CHC invoiced in the last three days, collections are under 90 days and the huddle is in.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {needs.map((row) => (
              <li key={row.personId} className="px-4 py-2.5 sm:px-5">
                <Link to={`/my/score?person=${row.personId}`} className="text-[13px] font-semibold text-slate-900 hover:underline">
                  {row.name}
                </Link>
                <span className="text-[12px] text-slate-500"> · {row.area ?? row.seat}</span>
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {row.needs.map((why) => (
                    <li
                      key={why}
                      className={`rounded-md px-2 py-0.5 text-[11.5px] font-medium ${why.startsWith("Three") ? "bg-rose-50 text-rose-800" : why.startsWith("Days") ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-700"}`}
                    >
                      {why}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={`${CARD} min-w-0 overflow-x-auto`}>
        <header className="flex items-baseline justify-between gap-3 px-4 pt-4 pb-2 sm:px-5">
          <h2 className="text-sm font-semibold text-slate-900">District now{units.length === 1 ? ` · ${units[0]}` : ""}</h2>
          <span className="text-xs text-slate-500">This month so far, worst first</span>
        </header>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-y border-slate-100 bg-slate-50/60 text-left text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
              <th className="px-4 py-2 sm:px-5">CHC</th>
              <th className="px-3 py-2 text-right">Sales vs target</th>
              <th className="px-3 py-2 text-right">Days to collect</th>
              <th className="px-3 py-2 text-right">Lapsed</th>
              <th className="px-3 py-2 text-right">Zero-sales days</th>
              <th className="px-4 py-2">Tonight</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.rows.map((row) => (
              <tr key={row.personId} className="hover:bg-slate-50/60">
                <td className="px-4 py-2.5 sm:px-5">
                  <Link to={`/my/score?person=${row.personId}`} className="font-semibold text-slate-900 hover:underline">
                    {row.name}
                  </Link>
                  <div className="text-[11.5px] text-slate-500">{row.area ?? row.seat}</div>
                </td>
                <td className={`px-3 py-2.5 text-right font-semibold tabular-nums ${tone(row.ist === null ? null : row.ist >= 91, (row.ist ?? 0) >= 71)}`}>
                  {row.ist === null ? "No target" : `${row.ist}%`}
                  <div className="text-[11px] font-normal text-slate-400">
                    {shortPeso(row.sales)}
                    {row.target ? ` of ${shortPeso(row.target)}` : ""}
                  </div>
                </td>
                <td className={`px-3 py-2.5 text-right font-semibold tabular-nums ${tone(row.dso === null ? null : row.dso <= 70, (row.dso ?? 0) < 90)}`}>
                  {row.dso === null ? "—" : row.dso}
                  <div className="text-[11px] font-normal text-slate-400">{shortPeso(row.owed)} owed</div>
                </td>
                <td className={`px-3 py-2.5 text-right tabular-nums ${tone(row.lapsedShare === null ? null : row.lapsedShare <= 10, (row.lapsedShare ?? 0) <= 20)}`}>
                  {row.lapsed}
                  {row.lapsedShare !== null && <div className="text-[11px] text-slate-400">{row.lapsedShare}%</div>}
                </td>
                <td className={`px-3 py-2.5 text-right tabular-nums ${tone(row.zeroDays === 0, row.zeroDays <= 2)}`}>
                  {row.zeroDays}
                  <div className="text-[11px] text-slate-400">of {row.workedSoFar} days</div>
                </td>
                <td className="px-4 py-2.5 text-[12px] whitespace-nowrap">
                  {row.huddle?.declared ? (
                    <span className="font-semibold text-emerald-700">Declared</span>
                  ) : (
                    <span className="text-slate-400">Not yet</span>
                  )}
                  <div className={row.huddle?.invoiced ? "text-emerald-700" : "text-rose-700"}>{row.huddle?.invoiced ? "Invoiced today" : "No invoice today"}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="grid gap-3 lg:grid-cols-2">
        <section className={`${CARD} min-w-0 p-4`}>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-900">
              <Megaphone className="size-4 text-slate-500" /> Tonight's huddle
            </h2>
            <Link to="/huddle" className="text-[12px] font-semibold text-emerald-700 hover:underline">
              Open
            </Link>
          </div>
          <p className="mt-1 text-[13px] text-slate-600">
            {declared} of {data.rows.length} declared · {data.rows.filter((row) => row.huddle && !row.huddle.invoiced).length} without an invoice today
          </p>
          {blockers.length > 0 && (
            <ul className="mt-2 space-y-1 text-[12.5px]">
              {blockers.map((row) => (
                <li key={row.personId}>
                  <b className="text-slate-800">{row.name}:</b> <span className="text-slate-600">{row.huddle?.blocker}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className={`${CARD} min-w-0 p-4`}>
          <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-900">
            <LifeBuoy className="size-4 text-rose-600" /> 15th rescue
          </h2>
          {!data.rescueOpen ? (
            <p className="mt-1 text-[13px] text-slate-500">Opens on the 15th: IST below 40%, DSO over 75, over 20% lapsed, NZSD under 80%.</p>
          ) : rescue.length === 0 ? (
            <p className="mt-1 text-[13px] text-slate-500">No one in the district needs the rescue plan.</p>
          ) : (
            <ul className="mt-2 space-y-1.5 text-[12.5px]">
              {rescue.map((row) => (
                <li key={row.personId}>
                  <Link to={`/my/score?person=${row.personId}`} className="font-semibold text-slate-900 hover:underline">
                    {row.name}
                  </Link>{" "}
                  <span className="text-rose-700">{row.rescue.join(" · ")}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
