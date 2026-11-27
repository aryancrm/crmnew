// The visits report over chosen days: each MedRep's visits done, skipped and still planned, how
// many doctors, hospitals and drugstores they covered, calls a day, this month's plan and coverage
// by class, check-ins away from the clinic, and what they spent. A team lead's for the team (with
// the plans and expenses waiting for them), the CEO's for everyone. A person opens their day.

import { TeamSwitch, useTeamUnit, withUnit } from "../team/switch";
import type { FieldReport } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { CalendarCheck, Search } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useMe } from "../auth";
import { EmptyState, NoResults } from "../no-results";
import { Ring } from "../team/charts";
import { manilaToday, RangePicker, short } from "../team/range";
import { CARD, PageHead, PageState, peso } from "../ui";
import { PLAN_WORDS } from "./visit-plan";

type Sort = "done" | "least" | "skipped" | "name";
type Row = FieldReport["people"][number];
const SORTS: { key: Sort; label: string; by: (a: Row, b: Row) => number }[] = [
  { key: "done", label: "Most visits", by: (a, b) => b.done - a.done },
  { key: "least", label: "Fewest visits", by: (a, b) => a.done - b.done },
  { key: "skipped", label: "Most skipped", by: (a, b) => b.skipped - a.skipped },
  { key: "name", label: "Name", by: (a, b) => a.name.localeCompare(b.name) },
];

export function FieldReportPage() {
  const me = useMe().data;
  const [params, setParams] = useSearchParams();
  const today = manilaToday();
  const from = params.get("from") ?? `${today.slice(0, 7)}-01`;
  const to = params.get("to") ?? today;
  const sort = (params.get("sort") as Sort | null) ?? "done";
  const unit = useTeamUnit();
  const query = useQuery({
    queryKey: ["field", "report", from, to, unit],
    queryFn: () => api<FieldReport>(withUnit(`/api/field/report?from=${from}&to=${to}`, unit)),
    placeholderData: (previous) => previous,
  });
  const [q, setQ] = useState("");
  const data = query.data;
  if (!data) return <PageState query={query} what="the visits report" />;
  const t = data.totals;
  const closed = t.done + t.skipped;
  const order = SORTS.find((one) => one.key === sort) ?? (SORTS[0] as (typeof SORTS)[number]);
  const words = q.trim().toLowerCase();
  const rows = data.people
    .filter((one) => !words || `${one.name} ${one.team ?? ""}`.toLowerCase().includes(words))
    .sort(order.by);
  const setSort = (next: Sort) => {
    const out = new URLSearchParams(params);
    if (next === "done") out.delete("sort");
    else out.set("sort", next);
    setParams(out, { replace: true });
  };
  const visitsOn = me && ["team_lead", "manager"].includes(me.role);
  const plansWaiting = data.people.filter((one) => one.plan === "sent");

  return (
    <div className={`flex flex-col gap-4 ${query.isPlaceholderData ? "opacity-60" : ""}`}>
      <PageHead
        title="Visits report"
        sub={`${data.from === data.to ? short(data.from) : `${short(data.from)} – ${short(data.to)}`} · ${data.people.length} people`}
        actions={
          visitsOn && (
            <Link
              to="/visits"
              className="inline-flex h-8 items-center gap-1.5 rounded-[10px] border border-line bg-white px-2.5 text-[13px] font-semibold text-slate-700 shadow-sm hover:bg-hover"
            >
              <CalendarCheck size={15} /> My visits
            </Link>
          )
        }
      >
        <RangePicker />
      </PageHead>
      <TeamSwitch />

      {visitsOn && plansWaiting.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          Plans waiting for you:{" "}
          {plansWaiting.map((one, at) => (
            <span key={one.personId}>
              {at > 0 && ", "}
              <Link
                to={`/visits/plan?person=${one.personId}&month=${data.month}`}
                className="font-semibold underline-offset-2 hover:underline"
              >
                {one.name}
              </Link>
            </span>
          ))}
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <div className={`${CARD} flex items-center gap-4 p-4`}>
          <Ring share={closed ? t.done / closed : null} color="#0284c7" size={72}>
            <span className="text-sm font-semibold text-slate-900 tabular-nums">
              {closed ? `${Math.round((t.done / closed) * 100)}%` : "—"}
            </span>
          </Ring>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-slate-500">Visits done</div>
            <div className="mt-1 text-sm text-slate-700">
              {t.done} done, {t.skipped} skipped
            </div>
            <div className="text-xs text-slate-400">{t.planned} still planned</div>
          </div>
        </div>
        <div className={`${CARD} p-4`}>
          <div className="text-xs font-semibold text-slate-500">Customers covered</div>
          <div className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums">{t.covered}</div>
          <div className="mt-1 text-xs text-slate-500">doctors, hospitals and drugstores</div>
        </div>
        <div className={`${CARD} p-4`}>
          <div className="text-xs font-semibold text-slate-500">Calls a field day</div>
          <div className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums">
            {t.fieldDays ? (t.done / t.fieldDays).toFixed(1) : "—"}
          </div>
          <div className="mt-1 text-xs text-slate-500">over {t.fieldDays} days in the field</div>
        </div>
        <div className={`${CARD} p-4`}>
          <div className="text-xs font-semibold text-slate-500">Seen as their class asks</div>
          <div className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums">
            {t.seenEnough}
            <span className="text-sm font-medium text-slate-500"> of {t.customers}</span>
          </div>
          <div className="mt-1 text-xs text-slate-500">
            customers this month{t.away ? ` · ${t.away} check-ins away from the clinic` : ""}
          </div>
        </div>
        <div className={`${CARD} p-4`}>
          <div className="text-xs font-semibold text-slate-500">Spent in the field</div>
          <div className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums">
            {peso(t.spent)}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {t.done ? `${peso(Math.round(t.spent / t.done))} a visit` : "approved"}
            {t.spentPending ? ` · ${peso(t.spentPending)} waiting` : ""}
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
                <th className="px-3 py-2 text-right">Done</th>
                <th className="px-3 py-2 text-right">Skipped</th>
                <th className="px-3 py-2 text-right">Planned</th>
                <th className="px-3 py-2 text-right">Covered</th>
                <th className="px-3 py-2 text-right">Field days</th>
                <th className="px-3 py-2 text-right">A day</th>
                <th className="px-3 py-2 text-right">Seen enough</th>
                <th className="px-3 py-2 text-right">Away</th>
                <th className="px-3 py-2">Plan</th>
                <th className="px-3 py-2 text-right">Spent</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((one) => (
                <tr key={one.personId} className="hover:bg-slate-50/70">
                  <td className="px-4 py-2.5">
                    <Link
                      to={`/visits?person=${one.personId}&day=${data.to}`}
                      className="font-semibold text-slate-900 hover:text-emerald-700"
                    >
                      {one.name}
                    </Link>
                    <div className="text-xs text-slate-500">
                      {[one.title, one.team].filter(Boolean).join(" · ")}
                    </div>
                  </td>
                  <td
                    className={`px-3 py-2.5 text-right tabular-nums ${one.done ? "font-semibold text-slate-900" : "text-rose-700"}`}
                  >
                    {one.done}
                  </td>
                  <td className="px-3 py-2.5 text-right text-slate-600 tabular-nums">
                    {one.skipped || "—"}
                  </td>
                  <td className="px-3 py-2.5 text-right text-slate-600 tabular-nums">
                    {one.planned || "—"}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{one.covered || "—"}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{one.fieldDays || "—"}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{one.perDay || "—"}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {one.customers ? `${one.seenEnough}/${one.customers}` : "—"}
                  </td>
                  <td
                    className={`px-3 py-2.5 text-right tabular-nums ${one.away ? "font-semibold text-rose-700" : "text-slate-400"}`}
                    title={one.noPlace ? `${one.noPlace} with no location shared` : undefined}
                  >
                    {one.away || "—"}
                  </td>
                  <td className="px-3 py-2.5">
                    <Link
                      to={`/visits/plan?person=${one.personId}&month=${data.month}`}
                      className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ${one.plan ? PLAN_WORDS[one.plan].tone : "bg-white text-slate-400 ring-slate-200"}`}
                    >
                      {one.plan ? PLAN_WORDS[one.plan].word : "No plan"}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    <Link
                      to={`/visits/expenses?person=${one.personId}&from=${data.from}&to=${data.to}`}
                      className="hover:text-emerald-700"
                    >
                      {one.spent ? peso(one.spent) : "—"}
                      {one.spentPending ? (
                        <span className="block text-[11px] text-amber-700">
                          +{peso(one.spentPending)} waiting
                        </span>
                      ) : null}
                    </Link>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={11}>
                    {words ? (
                      <NoResults title="Nobody here.">No one by that name or team. Try other words.</NoResults>
                    ) : (
                      <EmptyState title="Nobody here.">Each MedRep shows here with their visits done, skipped and still planned.</EmptyState>
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
