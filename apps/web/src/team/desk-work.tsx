// A team that doesn't sell (Supply Chain, Ops & Finance; Management) is shown by its desk work, not
// by sales it never makes: how many orders each person moved on in the days picked, how long they
// took against the step's limit, and how many were late. From the Speed report, narrowed to the
// people sitting in the team.

import type { SpeedReport } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { took } from "../desk/speed";
import { Ring } from "./charts";

const CARD = "rounded-2xl border border-slate-200 bg-white shadow-sm";
const STEP_WORD: Record<string, string> = {
  management: "Management approval",
  finance: "Finance check & invoice",
  dispatch: "Packing & shipping",
  fix: "Fixing sent-back orders",
  road: "On the road",
};

export function DeskWork({ personIds }: { personIds: number[] }) {
  const [params] = useSearchParams();
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const query = useQuery({
    queryKey: ["speed", from, to],
    queryFn: () => api<SpeedReport>(`/api/speed${from && to ? `?from=${from}&to=${to}` : ""}`),
  });
  const data = query.data;
  if (!data)
    return (
      <div className={`${CARD} p-5 text-sm text-slate-500`}>
        {query.isError ? "Couldn't read the desk work." : "Reading the desk work…"}
      </div>
    );
  const mine = new Set(personIds);
  const people = data.people.filter((person) => mine.has(person.personId));
  const limitOf = (step: string) =>
    data.steps.find((one) => one.step === step)?.lateAfterMinutes ?? 60;
  const orders = people.reduce((sum, person) => sum + person.orders, 0);
  const late = people.reduce((sum, person) => sum + person.late, 0);
  const average = orders
    ? people.reduce((sum, person) => sum + person.avgMinutes * person.orders, 0) / orders
    : 0;

  return (
    <section aria-label="Desk work" className="space-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["Orders moved on", String(orders), "by this team, in these days"],
          ["Average time", orders ? took(average) : "—", "an order waited with them"],
          ["Late", String(late), late ? "past the step's limit" : "none past the limit"],
          ["People at a desk", String(people.length), "who moved an order on"],
        ].map(([label, value, note]) => (
          <div key={label} className={`${CARD} p-4`}>
            <div className="text-[11px] text-slate-500">{label}</div>
            <div
              className={`mt-1 text-2xl font-semibold tracking-tight tabular-nums ${label === "Late" && late ? "text-rose-600" : "text-slate-900"}`}
            >
              {value}
            </div>
            <div className="text-[11px] text-slate-400">{note}</div>
          </div>
        ))}
      </div>
      {people.length === 0 ? (
        <div className={`${CARD} p-5 text-sm text-slate-500`}>
          Nobody in this team moved an order on in these days. It doesn't sell, so it has no sales
          figures; its people's work shows here once they act on orders.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {people
            .sort((a, b) => b.orders - a.orders)
            .map((person) => {
              const limit = limitOf(person.step);
              const lateShare = person.orders ? person.late / person.orders : 0;
              const over = person.avgMinutes > limit;
              return (
                <Link
                  key={`${person.personId}-${person.step}`}
                  to={`/speed?step=${person.step}`}
                  className={`${CARD} flex flex-col gap-3 p-4 hover:border-slate-300`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-900">
                        {person.name}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {STEP_WORD[person.step] ?? person.step} · limit {took(limit)}
                      </div>
                      <div
                        className={`mt-2 text-2xl font-semibold tracking-tight tabular-nums ${over ? "text-amber-700" : "text-emerald-700"}`}
                      >
                        {took(person.avgMinutes)}
                      </div>
                      <div className="text-[11px] text-slate-500">average</div>
                    </div>
                    <Ring share={lateShare} color={person.late ? "#f43f5e" : "#10b981"} size={56}>
                      <span className="text-[11px] font-semibold text-slate-700">
                        {Math.round(lateShare * 100)}%
                      </span>
                    </Ring>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full ${over ? "bg-amber-400" : "bg-emerald-500"}`}
                      style={{ width: `${Math.min(100, (person.avgMinutes / limit) * 100)}%` }}
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-1.5 text-center">
                    {[
                      ["Orders", String(person.orders)],
                      ["Half took", took(person.medianMinutes)],
                      ["Late", String(person.late)],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-lg bg-slate-50 py-1.5">
                        <div className="text-[10px] text-slate-500">{label}</div>
                        <div
                          className={`text-xs font-semibold tabular-nums ${label === "Late" && person.late ? "text-rose-600" : "text-slate-800"}`}
                        >
                          {value}
                        </div>
                      </div>
                    ))}
                  </div>
                </Link>
              );
            })}
        </div>
      )}
    </section>
  );
}
