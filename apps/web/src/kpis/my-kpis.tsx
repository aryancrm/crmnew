// My KPIs, as the hub shows them (its components/dashboard/MyKpiPanel.jsx; docs/PLAN.md 23): My Own
// KPI (the orders that are theirs) and, for anyone with people under them, My Team KPI; the CEO and
// the Admin see the company's. Sales without VAT against the target with the bar, with VAT and the
// VAT under it, then orders invoiced, new customers, orders raised and held; what waits for
// approval is shown, not counted. Today · Yesterday · Pick a date · This month: a day adds that
// day's sales and the invoices behind them; the KPI cards stay the day's month.

import type { KpiFigures, KpiPanel } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { EmptyState } from "../no-results";

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
      aria-pressed={mode === key}
      className={`rounded-md px-3.5 py-1.5 text-[13px] transition-colors ${mode === key ? "bg-white text-slate-900 shadow-[0_1px_3px_rgba(15,23,42,0.12)]" : "text-slate-500 hover:text-slate-800"}`}
    >
      {label}
    </button>
  );
  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* A soft grey track, the picked one a raised white chip (Aryan, 26 Nov). */}
      <div className="inline-flex gap-0.5 rounded-lg bg-slate-100 p-1">
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

/** The target as a dotted half circle (after the "Target Range" gauge, Aryan 26 Nov): three rows
 *  of dots, as many lit as the share of the target reached, the percent in the middle. */
function TargetGauge({ percent }: { percent: number | null }) {
  const per = 19;
  const rings = [44, 37, 30];
  const lit = percent === null ? 0 : Math.round((Math.min(percent, 100) / 100) * per);
  const tone = percent === null ? "#cbd5e1" : percent >= 100 ? "#059669" : percent >= 70 ? "#1d9fda" : "#f59e0b";
  return (
    <div className="relative w-[104px] shrink-0">
      <svg viewBox="0 0 100 54" className="w-full" aria-hidden="true">
        {rings.map((r) =>
          Array.from({ length: per }, (_, i) => {
            const angle = Math.PI - (i / (per - 1)) * Math.PI;
            return (
              <circle
                key={`${r}-${i}`}
                cx={50 + r * Math.cos(angle)}
                cy={50 - r * Math.sin(angle)}
                r={r === 44 ? 2.1 : 1.8}
                fill={i < lit ? tone : "#e2e8f0"}
              />
            );
          }),
        )}
      </svg>
      <div className="absolute inset-x-0 bottom-0 text-center">
        <p className="text-[16px] leading-none font-medium text-slate-900 tabular-nums">{percent === null ? "—" : `${percent}%`}</p>
        <p className="mt-0.5 text-[10px] text-slate-500">{percent === null ? "no target" : "of target"}</p>
      </div>
    </div>
  );
}

const ordinal = (n: number) => {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th"}`;
};

/** The month as a wave of thin bars (Aryan, 26 Nov, after a "Daily Stress" card): one bar a day,
 *  its height that day's sales without VAT; days with sales dark, the rest a short light tick. */
function DailyWave({ daily }: { daily?: number[] }) {
  // An older API (or a month with no days) sends none: no wave then.
  if (!daily?.length) return null;
  const top = Math.max(...daily, 0);
  const best = top > 0 ? daily.indexOf(top) + 1 : null;
  return (
    <div>
      <div
        role="img"
        aria-label={best ? `Sales each day this month; the best day was the ${ordinal(best)}, ${peso(top)}` : "No sales yet this month"}
        className="flex h-10 w-full items-end gap-[3px]"
      >
        {daily.map((sales, i) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: one bar per day of the month
            key={i}
            title={`Day ${i + 1}: ${peso(sales)}`}
            className={`min-w-0 flex-1 rounded-full ${sales > 0 ? "bg-slate-800" : "bg-slate-300"}`}
            style={{ height: sales > 0 && top > 0 ? `${Math.max(28, (sales / top) * 100)}%` : "22%" }}
          />
        ))}
      </div>
      <div aria-hidden="true" className="mt-1 flex justify-between text-[10px] text-slate-400 tabular-nums">
        <span>1</span>
        <span>{Math.ceil(daily.length / 2)}</span>
        <span>{daily.length}</span>
      </div>
    </div>
  );
}

/** A KPI as a card (Aryan, 26 Nov, after the dashboards he gave; kept short): the title, the sales
 *  in large with VAT beside the words and a pill for the target, the target gauge on the right,
 *  the month's wave, then the four counts as soft tiles in one row. The figures are the same as before; only the look changed. */
export function KpiBlock({ title, sub, k, extra }: { title: string; sub?: string; k: KpiFigures; extra?: ReactNode }) {
  const pill =
    k.percent === null
      ? { text: "No target set for this month", tone: "bg-slate-100 text-slate-600" }
      : {
          text: `${k.percent}% of ${peso(k.target ?? 0)} target`,
          tone: k.percent >= 100 ? "bg-emerald-50 text-emerald-700" : k.percent >= 70 ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-800",
        };
  return (
    <div className="flex flex-col rounded-[22px] border border-slate-200/80 bg-[linear-gradient(160deg,#ffffff_0%,#f8fafc_55%,#eef4ff_100%)] p-4">
      <div>
        <p className="text-[15px] font-medium text-slate-900">{title}</p>
        {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
      </div>

      {/* The amount and the gauge side by side; the words and the target pill under the amount. */}
      <div className="mt-3 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[32px] leading-none font-medium tracking-[-0.03em] text-slate-900 tabular-nums">{peso(k.sales)}</p>
          <p className="mt-1 text-xs text-slate-500">
            invoiced, without VAT · With VAT {peso(k.withVat)} · VAT {peso(k.vat)}
          </p>
          <span className={`mt-2 inline-flex w-fit items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${pill.tone}`}>{pill.text}</span>
        </div>
        <TargetGauge percent={k.percent} />
      </div>

      <div className="mt-3">
        <DailyWave daily={k.daily} />
      </div>
      {k.vacantTarget > 0 && <p className="mt-2 text-[11px] text-slate-500">Target includes {peso(k.vacantTarget)} for empty seats</p>}

      {/* The four counts in four colours, square and touching (Aryan, 26 Nov). */}
      <dl className="mt-3 grid grid-cols-2 sm:grid-cols-4">
        {(
          [
            ["Orders invoiced", k.ordersInvoiced, "bg-[#1d9fda] text-white", "text-white/85"],
            ["New customers", k.newCustomers, "bg-[#f5c400] text-[#3b2f00]", "text-[#3b2f00]/80"],
            ["Orders raised", k.ordersRaised, "bg-[#e8505b] text-white", "text-white/85"],
            ["Orders held", k.ordersHeld, "bg-[#22b378] text-white", "text-white/85"],
          ] as const
        ).map(([label, value, tone, soft]) => (
          <div key={label} className={`flex flex-col-reverse px-3 py-2.5 ${tone}`}>
            <dt className={`truncate text-[11px] ${soft}`}>{label}</dt>
            <dd className="text-[18px] leading-tight font-medium tabular-nums">{int(value)}</dd>
          </div>
        ))}
      </dl>
      {k.waitingOrders > 0 && (
        <p className="mt-2 rounded-xl bg-sky-50 px-3 py-1.5 text-[11px] text-sky-900">
          {int(k.waitingOrders)} order{k.waitingOrders === 1 ? "" : "s"} ({peso(k.waitingSales)}) waiting for approval, not invoiced
          yet: not counted yet
        </p>
      )}
      {extra}
    </div>
  );
}

/** A day's sales as a blue card (after the dashboards' coloured cards): the day in large, the
 *  orders in a pill, and a grid of 36 dots lit for the day's share of the month's sales. */
function DayCard({ label, sales, orders, month, note }: { label: string; sales: number; orders: number; month: number; note: string }) {
  const dots = 36;
  const share = month > 0 ? Math.min(sales / month, 1) : 0;
  const lit = Math.round(share * dots);
  return (
    <div className="flex flex-col rounded-[22px] bg-[linear-gradient(155deg,#1784b5_0%,#1d9fda_45%,#38bdf8_100%)] p-4 text-white">
      <p className="text-[15px] font-medium">{label}</p>
      <p className="mt-0.5 text-xs text-white/75">{note}</p>
      <p className="mt-3 text-[32px] leading-none font-medium tracking-[-0.03em] tabular-nums">{peso(sales)}</p>
      <span className="mt-2 inline-flex w-fit items-center rounded-full bg-white/20 px-2.5 py-1 text-[11px] font-medium ring-1 ring-white/30">
        {int(orders)} order{orders === 1 ? "" : "s"} invoiced
      </span>
      <div className="mt-auto pt-4">
        <div role="img" aria-label={`${Math.round(share * 100)}% of the month's sales`} className="grid grid-cols-12 gap-1">
          {Array.from({ length: dots }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed grid of dots
            <span key={i} className={`aspect-square rounded-[3px] ${i < lit ? "bg-white" : "bg-white/20"}`} />
          ))}
        </div>
        <p className="mt-2 text-[12px] text-white/85">
          <span className="text-[17px] font-medium text-white tabular-nums">{Math.round(share * 100)}%</span> of the month's sales so far
        </p>
      </div>
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
        <h2 className="text-base font-semibold text-slate-900">
          {company ? "Company KPIs" : "My KPIs"}
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
          {/* Two tall cards side by side (Aryan, 26 Nov): My Own KPI and My Team KPI, or, with no team,
              My Own KPI and the day's sales; then the other day cards and the day's invoices. */}
          {(() => {
            const days = (
              [
                ["own", data.ownDay, `My sales ${dayWord}`, data.own?.sales ?? 0],
                ["team", data.teamDay, company ? `The company's sales ${dayWord}` : `My team's sales ${dayWord}`, data.team?.sales ?? 0],
              ] as const
            ).filter(([, figures]) => onDay && figures);
            const dayCard = ([key, figures, label, monthSales]: (typeof days)[number]) => (
              <DayCard
                key={key}
                label={label}
                sales={figures?.sales ?? 0}
                orders={figures?.orders ?? 0}
                month={monthSales}
                note={`without VAT${period === today ? " · so far today" : ""}`}
              />
            );
            const both = Boolean(data.own && data.team);
            return (
              <>
                <div className="grid gap-4 md:grid-cols-2">
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
                  {!both && days[0] && dayCard(days[0])}
                </div>
                {both && days.length > 0 && <div className="grid gap-4 md:grid-cols-2">{days.map(dayCard)}</div>}
                {onDay && (data.ownDay || data.teamDay) && (
                  <DayOrders rows={data.dayOrders} names={Boolean(data.team)} />
                )}
              </>
            );
          })()}
        </>
      )}
    </section>
  );
}

/** The invoices of the day: order, invoice, customer, amount without VAT; the first five, then
 *  See more (Aryan, 20 Nov: a busy day's list ran far down the CEO's Home). */
const DAY_ROWS = 5;
function DayOrders({ rows: all, names }: { rows: KpiPanel["dayOrders"]; names: boolean }) {
  const [open, setOpen] = useState(false);
  const rows = open ? all : all.slice(0, DAY_ROWS);
  return (
    <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
      <table className="w-full min-w-[560px] text-sm">
        <thead className="border-b border-slate-200 bg-slate-50">
          <tr className="text-left text-[12px] text-slate-400 [&>th]:font-medium">
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
              <td colSpan={names ? 5 : 4}>
                <EmptyState title="No invoiced orders on this day">
                  An order shows here once Management approves it and its invoice is made.
                </EmptyState>
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {all.length > DAY_ROWS && (
        <button
          type="button"
          onClick={() => setOpen((now) => !now)}
          className="w-full border-t border-slate-100 px-3 py-2 text-center text-xs font-semibold text-brand hover:bg-slate-50"
        >
          {open ? "Show fewer" : `See more (${all.length - DAY_ROWS} more)`}
        </button>
      )}
    </div>
  );
}
