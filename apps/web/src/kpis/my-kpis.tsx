// My KPIs, as the hub shows them (its components/dashboard/MyKpiPanel.jsx; docs/PLAN.md 23): My Own
// KPI (the orders that are theirs) and, for anyone with people under them, My Team KPI; the CEO and
// the Admin see the company's. Sales without VAT against the target with the bar, with VAT and the
// VAT under it, then orders invoiced, new customers, orders raised and held; what waits for
// approval is shown, not counted. Today · Yesterday · Pick a date · This month: a day adds that
// day's sales and the invoices behind them; the KPI cards stay the day's month.

import type { KpiFigures, KpiPanel } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Target } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";

const CARD = "rounded-xl border border-slate-200 bg-white";
/** Centavos as "₱1,234.56", as the hub prints them. */
const peso = (centavos: number) =>
  `₱${(centavos / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const int = (n: number) => n.toLocaleString("en-PH");
const manilaDay = (back = 0) =>
  new Date(Date.now() + 8 * 3_600_000 - back * 86_400_000).toISOString().slice(0, 10);
const shiftMonth = (month: string, by: number) => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
};
const monthLabel = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-PH", { month: "long", year: "numeric", timeZone: "UTC" });
const dayLabel = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

/** Today · Yesterday · Pick a date · This month. `period` is "month" or a day. */
function PeriodPicker({ period, onChange }: { period: string; onChange: (next: string) => void }) {
  const today = manilaDay();
  const yesterday = manilaDay(1);
  const mode = period === "month" ? "month" : period === today ? "today" : period === yesterday ? "yesterday" : "day";
  const button = (key: string, label: string, pick: () => void) => (
    <button
      key={key}
      type="button"
      onClick={pick}
      className={`px-3 py-1.5 text-xs font-semibold ${mode === key ? "bg-brand text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
    >
      {label}
    </button>
  );
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex overflow-hidden rounded-lg border border-slate-300">
        {button("today", "Today", () => onChange(today))}
        {button("yesterday", "Yesterday", () => onChange(yesterday))}
        {button("day", "Pick a date", () => onChange(mode === "day" ? period : manilaDay(2)))}
        {button("month", "This month", () => onChange("month"))}
      </div>
      {mode === "day" && (
        <input
          type="date"
          aria-label="Date"
          value={period}
          max={today}
          onChange={(event) => event.target.value && event.target.value <= today && onChange(event.target.value)}
          className="h-8 rounded-lg border border-slate-300 bg-white px-2 text-xs"
        />
      )}
    </div>
  );
}

function Bar({ percent }: { percent: number | null }) {
  if (percent === null) return <p className="mt-2 text-xs text-slate-500">No target set for this month</p>;
  const tone = percent >= 100 ? "bg-emerald-600" : percent >= 70 ? "bg-brand" : "bg-amber-500";
  return (
    <div className="mt-2">
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full ${tone}`} style={{ width: `${Math.min(percent, 100)}%` }} />
      </div>
      <p className="mt-1 text-xs text-slate-500">
        <b className="text-slate-900">{percent}%</b> of target
      </p>
    </div>
  );
}

export function KpiBlock({ title, sub, k, extra }: { title: string; sub?: string; k: KpiFigures; extra?: ReactNode }) {
  return (
    <div className={`${CARD} p-4`}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-slate-900">{title}</p>
        {sub && <p className="text-xs text-slate-500">{sub}</p>}
      </div>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <p className="text-2xl font-bold text-slate-900 tabular-nums">{peso(k.sales)}</p>
        <p className="mb-1 text-xs text-slate-500">
          invoiced, without VAT{k.target ? ` · of ${peso(k.target)} target` : ""}
        </p>
      </div>
      <p className="mt-0.5 text-[11px] text-slate-500">
        With VAT {peso(k.withVat)} · VAT {peso(k.vat)}
      </p>
      <Bar percent={k.percent} />
      {k.vacantTarget > 0 && (
        <p className="mt-1 text-[11px] text-slate-500">Target includes {peso(k.vacantTarget)} for empty seats</p>
      )}
      <dl className="mt-3 grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
        {(
          [
            ["Orders invoiced", k.ordersInvoiced],
            ["New customers", k.newCustomers],
            ["Orders raised", k.ordersRaised],
            ["Orders held", k.ordersHeld],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="rounded-lg bg-slate-50 py-2">
            <dd className="text-base font-semibold text-slate-900 tabular-nums">{int(value)}</dd>
            <dt className="text-[11px] text-slate-500">{label}</dt>
          </div>
        ))}
      </dl>
      {k.waitingOrders > 0 && (
        <p className="mt-2 rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-900">
          {int(k.waitingOrders)} order{k.waitingOrders === 1 ? "" : "s"} ({peso(k.waitingSales)}) waiting for approval, not invoiced
          yet: not counted yet
        </p>
      )}
      {extra}
    </div>
  );
}

/** The panel. `company` (the CEO's Home) titles the team block as the company's. */
export function MyKpis({ company = false }: { company?: boolean }) {
  const [monthPicked, setMonth] = useState(manilaDay().slice(0, 7));
  const [period, setPeriod] = useState(manilaDay());
  const month = period === "month" ? monthPicked : period.slice(0, 7);
  const query = useQuery({
    queryKey: ["kpis", "me", month, period],
    queryFn: () =>
      api<KpiPanel>(`/api/kpis/me?month=${month}${period !== "month" ? `&day=${period}` : ""}`),
    placeholderData: (previous) => previous,
    staleTime: 60_000,
  });
  const data = query.data;
  const today = manilaDay();
  const onDay = period !== "month";
  const dayWord = period === today ? "today" : `on ${dayLabel(period)}`;
  return (
    <section aria-label="My KPIs" className={`space-y-3 ${query.isPlaceholderData ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="inline-flex items-center gap-2 text-base font-semibold text-slate-900">
          <Target className="size-4 text-brand" /> {company ? "Company KPIs" : "My KPIs"}
        </h2>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <PeriodPicker period={period} onChange={setPeriod} />
          {period === "month" && (
            <>
              <button type="button" aria-label="Month before" onClick={() => setMonth(shiftMonth(month, -1))} className="rounded-md border border-slate-300 bg-white p-1">
                <ChevronLeft className="size-4" />
              </button>
              <span
                className={`rounded-full border px-2.5 py-1 font-semibold ${data?.running ? "border-amber-300 bg-amber-50 text-amber-900" : "border-slate-300 bg-slate-50 text-slate-600"}`}
              >
                {monthLabel(month)} · {data?.running ? "so far" : "final"}
              </span>
              <button
                type="button"
                aria-label="Month after"
                disabled={month >= today.slice(0, 7)}
                onClick={() => setMonth(shiftMonth(month, 1))}
                className="rounded-md border border-slate-300 bg-white p-1 disabled:opacity-40"
              >
                <ChevronRight className="size-4" />
              </button>
            </>
          )}
        </div>
      </div>
      {!data ? (
        <p className="text-sm text-slate-500">{query.isError ? "Your KPIs couldn't be read right now." : "Reading your KPIs…"}</p>
      ) : (
        <>
          <div className={`grid gap-3 ${data.own && data.team ? "md:grid-cols-2" : ""}`}>
            {data.own && (
              <KpiBlock
                title="My Own KPI"
                sub="orders that are yours"
                k={data.own}
                extra={
                  data.own.enteredForOthers > 0 || data.own.enteredForMe > 0 ? (
                    <div className="mt-3 space-y-1 text-xs text-slate-500">
                      {data.own.enteredForOthers > 0 && (
                        <p>
                          You also entered <b className="text-slate-900">{peso(data.own.enteredForOthers)}</b> for others (counted on their KPI).
                        </p>
                      )}
                      {data.own.enteredForMe > 0 && (
                        <p>
                          Others entered <b className="text-slate-900">{peso(data.own.enteredForMe)}</b> for you (counted here).
                        </p>
                      )}
                    </div>
                  ) : null
                }
              />
            )}
            {data.team && (
              <KpiBlock
                title={company ? (data.team.label === "The company" ? "Company KPI" : `KPI · ${data.team.label}`) : data.team.label === "My team" ? "My Team KPI" : `My Team KPI · ${data.team.label}`}
                sub={`${int(data.team.people)} people · ${int(data.team.peopleWithTarget)} with a target`}
                k={data.team}
              />
            )}
          </div>
          {onDay && (data.ownDay || data.teamDay) && (
            <div className="space-y-3">
              <div className={`grid gap-3 ${data.ownDay && data.teamDay ? "md:grid-cols-2" : ""}`}>
                {(
                  [
                    ["own", data.ownDay, `My sales ${dayWord}`],
                    ["team", data.teamDay, company ? `The company's sales ${dayWord}` : `My team's sales ${dayWord}`],
                  ] as const
                )
                  .filter(([, figures]) => figures)
                  .map(([key, figures, label]) => (
                    <div key={key} className={`${CARD} p-4`}>
                      <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{label}</p>
                      <p className="mt-1 text-2xl font-bold text-slate-900 tabular-nums">{peso(figures?.sales ?? 0)}</p>
                      <p className="text-xs text-slate-500">
                        {int(figures?.orders ?? 0)} order{figures?.orders === 1 ? "" : "s"} invoiced · without VAT
                        {period === today ? " · so far today" : ""}
                      </p>
                    </div>
                  ))}
              </div>
              <DayOrders rows={data.dayOrders} names={Boolean(data.team)} />
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** The invoices of the day: order, invoice, customer, amount without VAT. */
function DayOrders({ rows, names }: { rows: KpiPanel["dayOrders"]; names: boolean }) {
  return (
    <div className={`${CARD} overflow-x-auto`}>
      <table className="w-full min-w-[560px] text-sm">
        <thead className="border-b border-slate-200 bg-slate-50">
          <tr className="text-left text-[11px] tracking-wide text-slate-500 uppercase">
            <th className="px-3 py-2">Order</th>
            {names && <th className="px-3 py-2">Salesperson</th>}
            <th className="px-3 py-2">Invoice</th>
            <th className="px-3 py-2">Customer</th>
            <th className="px-3 py-2 text-right">Amount (without VAT)</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.length ? (
            rows.map((row) => (
              <tr key={`${row.code}-${row.invoice}`}>
                <td className="px-3 py-2 font-semibold text-slate-900">
                  {row.orderId ? <Link to={`/orders/${row.orderId}`} className="hover:underline">{row.code}</Link> : row.code}
                </td>
                {names && <td className="px-3 py-2 text-slate-600">{row.person ?? "—"}</td>}
                <td className="px-3 py-2 text-slate-600">{row.invoice}</td>
                <td className="px-3 py-2 text-slate-600">{row.customer || "—"}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{peso(row.sales)}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={names ? 5 : 4} className="px-3 py-4 text-slate-500">
                No invoiced orders on this day.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
