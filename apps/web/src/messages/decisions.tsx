// To decide (docs/ERP-PLAN.md phase 2): every decision waiting on this person, from every desk,
// with how many and the page where each is made; under it, what they asked others for that is
// still open. Read from each desk's own list, so the numbers agree with the pages they open.

import type { DecisionLine, Decisions } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { PageState } from "../ui";
import { EmptyState } from "../no-results";

const CARD = "rounded-xl border border-slate-200 bg-white";

function Lines({ lines, empty, emptySub }: { lines: DecisionLine[]; empty: string; emptySub: string }) {
  if (!lines.length) return <EmptyState title={empty}>{emptySub}</EmptyState>;
  return (
    <ul className="divide-y divide-slate-100">
      {lines.map((line) => (
        <li key={line.key}>
          <Link to={line.to} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
            <span
              className={`grid min-w-8 place-items-center rounded-full px-2 py-0.5 text-sm font-bold tabular-nums ${line.kind === "orders" ? "bg-amber-100 text-amber-900" : "bg-sky-100 text-sky-900"}`}
            >
              {line.count}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">{line.label}</span>
            {line.since && (
              <span className="text-xs text-slate-500">
                since {new Date(line.since).toLocaleString("en-PH", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
              </span>
            )}
            <ChevronRight className="size-4 text-slate-400" aria-hidden="true" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function DecisionsPage() {
  const query = useQuery({ queryKey: ["decisions"], queryFn: () => api<Decisions>("/api/decisions") });
  if (!query.data) return <PageState query={query} what="what waits on you" />;
  const data = query.data;
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">To decide</h1>
        <p className="mt-1 text-[13px] text-slate-500">
          {data.total ? `${data.total} waiting on you` : "Nothing waits on you"} · from every desk you work on; press a line to open it
        </p>
      </header>
      <section aria-labelledby="for-me" className={CARD}>
        <h2 id="for-me" className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">
          Waiting on you
        </h2>
        <Lines
          lines={data.forMe}
          empty="Nothing waits on you now."
          emptySub="Decisions waiting on you, from every desk you work on, show here."
        />
      </section>
      <section aria-labelledby="mine" className={CARD}>
        <h2 id="mine" className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">
          What you asked for, still open
        </h2>
        <Lines
          lines={data.mine}
          empty="Nothing you asked for is waiting."
          emptySub="What you asked others for shows here while it is still open."
        />
      </section>
    </div>
  );
}
