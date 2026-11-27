// The CEO Home's KPI picture (docs/PLAN.md 23, Aryan 20 Nov: "the KPI data must show on the CEO's
// Home"): the month's scorecards across the company: the sellers' average, how many are below 60,
// each kind of card and its average (the interim ones marked), the field cards, the leads, the best
// and the lowest; each name opens that person's card, the title opens Scorecards.

import type { CompanyScorePerson, CompanyScores } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Gauge } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { EmptyState, NoInvoicesArt } from "../no-results";
import { toneOf } from "../sellers/my-score";

const CARD = "rounded-xl border border-slate-200 bg-white";

export function KpiCard({ month }: { month: string }) {
  const query = useQuery({
    queryKey: ["scores", "company", month],
    queryFn: () => api<CompanyScores>(`/api/scores/company${month ? `?month=${month}` : ""}`),
    staleTime: 5 * 60_000,
  });
  const data = query.data;
  return (
    <section aria-labelledby="kpis" className={`${CARD} min-w-0`}>
      <header className="flex flex-wrap items-baseline justify-between gap-3 px-4 pt-4 pb-2 sm:px-5">
        <h2 id="kpis" className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <Gauge className="size-4 text-slate-500" /> KPIs {data ? (data.live ? "this month" : `in ${data.month}`) : ""}
        </h2>
        <Link to={`/team-scores${month ? `?month=${month}` : ""}`} className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 hover:underline">
          Scorecards <ChevronRight className="size-3.5" />
        </Link>
      </header>
      {!data ? (
        <p className="px-4 pb-4 text-sm text-slate-500 sm:px-5">{query.isError ? "The scorecards couldn't be read." : "Reading every scorecard…"}</p>
      ) : data.scored === 0 ? (
        <EmptyState art={<NoInvoicesArt size={72} />} title="No one has a card yet this month: a card starts with a target, a sale, an order or a field day.">
          The sellers' average and each person's score show here once there are cards.
        </EmptyState>
      ) : (
        <div className="grid gap-4 px-4 pb-4 sm:px-5 lg:grid-cols-3">
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-semibold tracking-tight tabular-nums" style={{ color: data.average === null ? undefined : toneOf(data.average) }}>
                {data.average ?? "—"}
              </span>
              <span className="text-xs text-slate-500">sellers' average, of 100</span>
            </div>
            <div className="mt-1 space-y-0.5 text-xs text-slate-600">
              <div>
                {data.scored} people scored ·{" "}
                <span className={data.below60 ? "font-semibold text-rose-600" : ""}>{data.below60} below 60</span>
              </div>
              {data.leadsAverage !== null && <div>Team leads' cards: {data.leadsAverage} on average</div>}
              {data.field.people > 0 && (
                <div>
                  Field work: {data.field.average} on average · {data.field.people} MedRep{data.field.people === 1 ? "" : "s"}
                </div>
              )}
              {data.questions > 0 && <div className="text-amber-700">{data.questions} question{data.questions === 1 ? "" : "s"} on locked figures open</div>}
            </div>
            <ul className="mt-3 space-y-1.5">
              {data.kinds.map((kind) => (
                <li key={kind.recipe} className="text-xs">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-slate-700">
                      {kind.label} <span className="text-slate-400">· {kind.people}</span>
                      {kind.interim && <span className="ml-1 text-[10px] text-amber-700">interim</span>}
                    </span>
                    <span className="font-semibold tabular-nums" style={{ color: toneOf(kind.average) }}>
                      {kind.average}
                    </span>
                  </div>
                  <div className="mt-0.5 h-1.5 rounded-full bg-slate-100">
                    <div className="h-1.5 rounded-full" style={{ width: `${Math.min(100, kind.average)}%`, background: toneOf(kind.average) }} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <People title="Best this month" people={data.best} month={data.month} />
          <People title="Lowest this month" people={data.lowest} month={data.month} />
        </div>
      )}
    </section>
  );
}

function People({ title, people, month }: { title: string; people: CompanyScorePerson[]; month: string }) {
  return (
    <div className="min-w-0">
      <h3 className="mb-1 text-xs font-semibold text-slate-500">{title}</h3>
      {people.length === 0 ? (
        <p className="text-xs text-slate-400">—</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {people.map((one) => (
            <li key={one.personId}>
              <Link to={`/my/score?person=${one.personId}&month=${month}`} className="flex items-center justify-between gap-2 py-1.5 hover:bg-slate-50">
                <span className="min-w-0">
                  <span className="block truncate text-sm text-slate-900">{one.name}</span>
                  <span className="block truncate text-[11px] text-slate-500">{[one.card, one.unit].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="shrink-0 text-sm font-semibold tabular-nums" style={{ color: toneOf(one.percent) }}>
                  {one.percent}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
