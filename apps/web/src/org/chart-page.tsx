// The company chart in the same look as the rest: every team as a box (or every person), each
// opening its page, with zoom, drag and Fit for a company of 130 people and more. The colour of a
// box's bar is how it sells against its target: green on pace, amber behind, red far behind.

import type { TeamBoard } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { TeamChart } from "../team/tree";
import { ZoomBox } from "../team/zoom";
import { PageState } from "../ui";

export function OrgChartPage() {
  const [params] = useSearchParams();
  const unit = params.get("unit");
  const [all, setAll] = useState(false);
  const query = useQuery({
    queryKey: ["team", "board", unit ?? "", "", ""],
    queryFn: () => api<TeamBoard>(`/api/team/board${unit ? `?unit=${unit}` : ""}`),
  });
  const data = query.data;
  if (!data) return <PageState query={query} what="the company chart" />;
  const unitHref = (id: number) => `/my-team?unit=${id}`;
  const seatHref = (id: number) => `/my-team/seat/${id}${unit ? `?unit=${unit}` : ""}`;
  const people = data.seats.filter((seat) => seat.person).length;
  return (
    <div className="mx-auto w-full max-w-screen-2xl space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Company chart</h1>
          <p className="mt-1 text-[13px] text-slate-500">
            {data.viewing ?? "Your team"} · {people} people · {data.seats.length - people} empty
            seats · click a team for its page, a person for theirs
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-sm font-semibold shadow-sm">
            {(
              [
                [false, "Teams"],
                [true, "Everyone"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={label}
                type="button"
                onClick={() => setAll(value)}
                className={`rounded-md px-3 py-1.5 ${all === value ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-50"}`}
              >
                {label}
              </button>
            ))}
          </span>
          <Link
            to="/people"
            className="rounded-lg px-3 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50"
          >
            Change teams
          </Link>
        </div>
      </header>
      <div className="flex flex-wrap gap-3 text-xs text-slate-600">
        {[
          ["bg-emerald-500", "On pace"],
          ["bg-amber-400", "Behind"],
          ["bg-rose-500", "Far behind"],
          ["bg-slate-300", "No target"],
        ].map(([tone, label]) => (
          <span key={label} className="flex items-center gap-1.5">
            <span className={`h-1.5 w-5 rounded-full ${tone}`} /> {label}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-5 rounded border border-amber-300 bg-amber-50" /> Empty seat
        </span>
      </div>
      <section className="rounded-2xl border border-slate-200/90 bg-white p-3 shadow-sm">
        <ZoomBox key={String(all)} height={Math.max(480, window.innerHeight - 260)}>
          <TeamChart board={data} seatHref={seatHref} unitHref={unitHref} compact={!all} />
        </ZoomBox>
      </section>
    </div>
  );
}
