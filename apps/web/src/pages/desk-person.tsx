// One of Management's (or Finance's) people (Aryan, 18 Nov: "click their name and everything they
// did comes up"): their figures for the days picked, the orders they have now, and every order they
// moved on — approved (or let go to Dispatch), sent back, held, rejected — with the time each took
// from when it was theirs.

import type { DeskPerson } from "@2mg/api/types";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useMe } from "../auth";
import { CARD, PageHead, PageState, peso } from "../ui";

const manila = (offsetDays = 0) =>
  new Date(Date.now() + offsetDays * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
const took = (minutes: number | null) => {
  if (minutes === null) return "—";
  const m = Math.round(minutes);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60 ? `${m % 60}m` : ""}`.trim() : `${m}m`;
};
const at = (iso: string) =>
  new Date(iso).toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" });
const OUTCOME: Record<DeskPerson["done"][number]["outcome"], { word: string; tone: string }> = {
  done: { word: "Approved", tone: "bg-emerald-100 text-emerald-800" },
  sent_back: { word: "Sent back", tone: "bg-amber-100 text-amber-800" },
  held: { word: "Held", tone: "bg-orange-100 text-orange-800" },
  rejected: { word: "Rejected", tone: "bg-rose-100 text-rose-700" },
  moved: { word: "Moved on", tone: "bg-slate-100 text-slate-600" },
};

export function DeskPersonPage() {
  const me = useMe().data;
  const [deskParams] = useSearchParams();
  // The desk's own people see their desk; the CEO and the Admin pick it (?desk=finance).
  const desk = me?.role === "finance" || (me?.role !== "management" && deskParams.get("desk") === "finance") ? "finance" : "management";
  const id = Number(useParams().id);
  const [params, setParams] = useSearchParams();
  const today = manila();
  const monday = manila(-((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
  const ranges = [
    { key: "today", label: "Today", from: today, to: today },
    { key: "week", label: "This week", from: monday, to: today },
    { key: "month", label: "This month", from: `${today.slice(0, 7)}-01`, to: today },
  ];
  const range = ranges.find((one) => one.key === params.get("range")) ?? (ranges[0] as (typeof ranges)[number]);
  const query = useQuery({
    queryKey: ["desk", desk, "person", id, range.from, range.to],
    queryFn: () => api<DeskPerson>(`/api/desk/${desk}/people/${id}?from=${range.from}&to=${range.to}`),
    placeholderData: keepPreviousData,
  });
  const data = query.data;
  const doneWord = desk === "management" ? "Approved" : "Let go to Dispatch";
  const f = data?.figures;

  return (
    <div>
      <PageHead
        title={data ? data.person.name : "…"}
        sub={
          data
            ? `${data.person.title ?? (desk === "management" ? "Management" : "Finance")} · ${data.person.startedAt ? `started today at ${new Date(data.person.startedAt).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" })}` : "not started today"}`
            : undefined
        }
        actions={
          <span className="flex rounded-lg border border-slate-200 bg-white p-0.5 text-[13px] font-semibold">
            {ranges.map((one) => (
              <button
                key={one.key}
                type="button"
                aria-pressed={one.key === range.key}
                onClick={() => setParams({ range: one.key, ...(deskParams.get("desk") ? { desk: deskParams.get("desk") as string } : {}) }, { replace: true })}
                className={`rounded-md px-3 py-1 ${one.key === range.key ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"}`}
              >
                {one.label}
              </button>
            ))}
          </span>
        }
      />
      <PageState query={query} what="their figures" />
      {data && f && (
        <>
          <section className={`mb-4 grid grid-cols-3 gap-3 sm:grid-cols-5 ${desk === "management" ? "xl:grid-cols-9" : "xl:grid-cols-8"}`}>
            {(
              [
                ["Hours started", f.hours ? f.hours.toFixed(1) : "—"],
                ["Given", f.given],
                ["Took over", f.took],
                [doneWord, f.done],
                ...(desk === "management" ? ([["Sent back", f.sentBack]] as [string, number][]) : []),
                ["Held", f.held],
                ["Time per order", took(f.medianMinutes)],
                ["Late", f.late],
                ["Open now", f.open],
              ] as [string, string | number][]
            ).map(([label, value]) => (
              <div key={label} className={`${CARD} px-3.5 py-2.5`}>
                <div className={`text-[20px] font-bold tabular-nums ${label === "Late" && Number(value) > 0 ? "text-rose-700" : label === doneWord ? "text-emerald-700" : "text-slate-900"}`}>
                  {value}
                </div>
                <div className="text-[12px] text-slate-500">{label}</div>
              </div>
            ))}
          </section>

          <section className={`${CARD} mb-4 overflow-hidden p-0`}>
            <h2 className="border-b border-slate-100 px-4 py-2.5 text-[14px] font-semibold text-slate-900">
              Has now · {data.open.length}
            </h2>
            {data.open.length ? (
              <ul className="divide-y divide-slate-100">
                {data.open.map((one) => (
                  <li key={one.id}>
                    <Link to={`/orders/${one.id}`} className="flex items-center gap-4 px-4 py-2.5 text-sm hover:bg-slate-50">
                      <span className="w-28 shrink-0 font-semibold text-brand">{one.code}</span>
                      <span className="min-w-0 flex-1 truncate">{one.customer}</span>
                      <span className="text-[12px] text-slate-500">since {at(one.since)}</span>
                      <span className="w-28 text-right font-semibold tabular-nums">{peso(one.total)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-5 text-sm text-slate-500">Nothing in hand now.</p>
            )}
          </section>

          <section className={`${CARD} overflow-x-auto p-0`}>
            <h2 className="border-b border-slate-100 px-4 py-2.5 text-[14px] font-semibold text-slate-900">
              What they did · {data.done.length}
            </h2>
            {data.done.length ? (
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-head text-[11px] text-slate-500 uppercase">
                  <tr>
                    <th className="px-4 py-2 text-left font-semibold">Order</th>
                    <th className="px-3 py-2 text-left font-semibold">Customer</th>
                    <th className="px-3 py-2 text-left font-semibold">What</th>
                    <th className="px-3 py-2 text-left font-semibold">When</th>
                    <th className="px-3 py-2 text-right font-semibold">Took</th>
                    <th className="px-4 py-2 text-right font-semibold">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {data.done.map((one) => {
                    const look = OUTCOME[one.outcome];
                    const late = one.minutes > data.limitMinutes;
                    return (
                      <tr key={`${one.id}-${one.at}`} className="border-t border-slate-100">
                        <td className="px-4 py-2">
                          <Link to={`/orders/${one.id}`} className="font-semibold text-brand hover:underline">
                            {one.code}
                          </Link>
                        </td>
                        <td className="px-3 py-2">{one.customer}</td>
                        <td className="px-3 py-2">
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${look.tone}`}>
                            {one.outcome === "done" ? doneWord : look.word}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-slate-600">{at(one.at)}</td>
                        <td className={`px-3 py-2 text-right tabular-nums ${late ? "font-semibold text-rose-700" : ""}`}>
                          {took(one.minutes)}
                          {late ? " · late" : ""}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">{peso(one.total)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <p className="px-4 py-5 text-sm text-slate-500">Nothing moved on in these days.</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
