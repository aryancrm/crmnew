// Sales vs target (Aryan, 28 Nov: "Team numbers: what repeats? one number everywhere"; "Yes, do
// it", PLAN 272): one page in place of Targets, Sales performance and Whole business's sales tables,
// laid out as the team's November sheet: each channel with its manager, each HQ with who works it,
// its target for the month, what it sold, the balance to do, today's sales and the share done; the
// channel's total and the whole team's. Sold is what My KPIs and Headquarters count (without VAT).
// A press anywhere on an HQ's row opens its person's page. Whole business's own parts come here too:
// the team's sales day by day and the medicines sold. Targets are set on Targets; weeks, SKUs and
// customers billed are on Sales performance (both a press away).

import type { SalesVsTarget } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { exactPeso, monthName, shiftMonth, shortPeso } from "../ceo";
import { withUnit, useTeamUnit, TeamSwitch } from "./switch";
import { CARD, PageHead, PageState, useOpenOnPress } from "../ui";

const pct = (sold: number, target: number | null) => (target ? Math.round((sold / target) * 1000) / 10 : null);

export function SalesVsTargetPage() {
  const [params, setParams] = useSearchParams();
  const asked = params.get("month") ?? "";
  const unit = useTeamUnit();
  const query = useQuery({
    queryKey: ["team", "sales-vs-target", asked, unit],
    queryFn: () => api<SalesVsTarget>(withUnit(`/api/team/sales-vs-target${asked ? `?month=${asked}` : ""}`, unit)),
    placeholderData: (previous) => previous,
  });
  const open = useOpenOnPress();
  const data = query.data;
  if (!data) return <PageState query={query} what="the sales against target" />;
  const current = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }).slice(0, 7);
  const goTo = (month: string) => {
    const next = new URLSearchParams(params);
    if (month >= current) next.delete("month");
    else next.set("month", month);
    setParams(next, { replace: true });
  };
  const arrow = "grid size-9 place-items-center rounded-lg text-slate-600 hover:bg-slate-100 disabled:text-slate-300 disabled:hover:bg-transparent";
  const t = data.total;
  const share = pct(t.sold, t.target);
  const pace = Math.round((data.daysGone / data.daysInMonth) * 100);
  const TH = "px-3 py-2 text-[10.5px] font-semibold tracking-wide text-slate-500 uppercase";

  return (
    <div className={`mx-auto w-full max-w-6xl space-y-4 ${query.isPlaceholderData ? "opacity-60" : ""}`}>
      <PageHead
        title="Sales vs target"
        sub="Each HQ's target for the month, what it sold (without VAT), the balance to do, today's sales and the share done. Press an HQ for its person's page."
        actions={
          <nav aria-label="Month" className={`${CARD} flex items-center p-0.5`}>
            <button type="button" aria-label="Month before" onClick={() => goTo(shiftMonth(data.month, -1))} className={arrow}>
              <ChevronLeft className="size-4" />
            </button>
            <span className="min-w-32 px-1 text-center text-sm font-semibold text-slate-900">{monthName(data.month)}</span>
            <button type="button" aria-label="Month after" disabled={data.month >= current} onClick={() => goTo(shiftMonth(data.month, 1))} className={arrow}>
              <ChevronRight className="size-4" />
            </button>
          </nav>
        }
      />
      <TeamSwitch />

      {/* The whole team at a glance: the same figures as My KPIs on the Home. */}
      <section aria-label="The team's month" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Figure label="Target" value={t.target === null ? "—" : shortPeso(t.target)} title={t.target === null ? undefined : exactPeso(t.target)} />
        <Figure label="Sold" value={shortPeso(t.sold)} title={exactPeso(t.sold)} hint={share === null ? "no target set" : `${share}% of target`} />
        <Figure
          label="Balance to do"
          value={t.target === null ? "—" : shortPeso(Math.max(0, t.target - t.sold))}
          hint={t.target !== null && data.daysGone < data.daysInMonth ? `${shortPeso(Math.max(0, t.target - t.sold) / Math.max(1, data.daysInMonth - data.daysGone))} a day for ${data.daysInMonth - data.daysGone} days` : undefined}
        />
        <Figure label="Today" value={shortPeso(t.today)} title={exactPeso(t.today)} />
        <Figure label="Days gone" value={`${data.daysGone} of ${data.daysInMonth}`} hint={`${pace}% of the month`} />
      </section>

      {data.channels.length === 0 ? (
        <section className={`${CARD} px-5 py-8 text-center text-sm text-slate-500`}>No HQ in your team yet.</section>
      ) : (
        <section className={`${CARD} min-w-0 overflow-x-auto`}>
          <table className="w-full min-w-[760px] text-[13px]">
            <thead>
              <tr className="border-b border-slate-100 text-left">
                <th className={`${TH} pl-4`}>HQ · person</th>
                <th className={`${TH} text-right`}>Target</th>
                <th className={`${TH} text-right`}>Sold</th>
                <th className={`${TH} text-right`}>Balance to do</th>
                <th className={`${TH} text-right`}>Today</th>
                <th className={`${TH} pr-4 text-right`}>%</th>
              </tr>
            </thead>
            {data.channels.map((channel) => (
              <tbody key={channel.unitId} className="divide-y divide-slate-100 border-b border-slate-200">
                <tr className="bg-slate-50/70">
                  <th colSpan={6} className="px-4 py-2 text-left text-[13px] font-semibold text-slate-900">
                    {channel.name}
                    {channel.manager && <span className="font-normal text-slate-500"> · Manager: {channel.manager}</span>}
                  </th>
                </tr>
                {channel.hqs.map((hq) => (
                  <tr key={hq.seatId} onClick={open(`/my-team/seat/${hq.seatId}`)} className="cursor-pointer hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      <Link
                        to={`/my-team/seat/${hq.seatId}`}
                        state={{ from: `/sales-vs-target${asked ? `?month=${asked}` : ""}` }}
                        className="block font-bold text-slate-900 hover:underline"
                      >
                        {hq.hq}
                      </Link>
                      <span className="block text-[11.5px] text-slate-500">{hq.person ?? "Empty"}</span>
                    </td>
                    <Money value={hq.target} />
                    <Money value={hq.sold} strong />
                    <Money value={hq.target === null ? null : Math.max(0, hq.target - hq.sold)} />
                    <Money value={hq.today} />
                    <Share sold={hq.sold} target={hq.target} pace={pace} />
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className="px-4 py-2.5 text-slate-700">{channel.name} total</td>
                  <Money value={channel.target} />
                  <Money value={channel.sold} strong />
                  <Money value={channel.target === null ? null : Math.max(0, channel.target - channel.sold)} />
                  <Money value={channel.today} />
                  <Share sold={channel.sold} target={channel.target} pace={pace} />
                </tr>
              </tbody>
            ))}
            {data.channels.length > 1 && (
              <tfoot>
                <tr className="bg-slate-50 font-bold">
                  <td className="px-4 py-3 text-slate-900">All</td>
                  <Money value={t.target} />
                  <Money value={t.sold} strong />
                  <Money value={t.target === null ? null : Math.max(0, t.target - t.sold)} />
                  <Money value={t.today} />
                  <Share sold={t.sold} target={t.target} pace={pace} />
                </tr>
              </tfoot>
            )}
          </table>
          <p className="border-t border-slate-100 px-4 py-2.5 text-[12px] text-slate-500">
            The share is green when it keeps up with the month ({pace}% gone), amber when behind, red when far behind.{" "}
            <Link to="/targets" className="font-semibold text-sky-700 hover:underline">
              Set targets
            </Link>{" "}
            ·{" "}
            <Link to="/sales-performance" className="font-semibold text-sky-700 hover:underline">
              By week, by day, SKUs and customers billed
            </Link>
          </p>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <DayByDay data={data} />
        <Medicines data={data} />
      </div>
    </div>
  );
}

function Figure({ label, value, hint, title }: { label: string; value: string; hint?: string; title?: string }) {
  return (
    <div className={`${CARD} px-4 py-3`}>
      <p className="text-[12.5px] font-medium text-slate-600">{label}</p>
      <p className="text-2xl font-semibold tracking-tight text-slate-900 tabular-nums" title={title}>
        {value}
      </p>
      {hint && <p className="text-[11.5px] text-slate-500">{hint}</p>}
    </div>
  );
}

function Money({ value, strong }: { value: number | null; strong?: boolean }) {
  return (
    <td className={`px-3 py-2.5 text-right tabular-nums ${strong ? "font-semibold text-slate-900" : "text-slate-700"}`} title={value === null ? undefined : exactPeso(value)}>
      {value === null ? <span className="text-slate-300">—</span> : shortPeso(value)}
    </td>
  );
}

/** The share of the target done, coloured against how much of the month is gone. */
function Share({ sold, target, pace }: { sold: number; target: number | null; pace: number }) {
  const share = pct(sold, target);
  const tone = share === null ? "text-slate-300" : share >= pace ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : share >= pace / 2 ? "bg-amber-50 text-amber-800 ring-amber-200" : "bg-rose-50 text-rose-700 ring-rose-200";
  return (
    <td className="px-3 py-2.5 pr-4 text-right">
      {share === null ? <span className={tone}>—</span> : <span className={`rounded-full px-1.5 py-0.5 text-[11.5px] font-bold tabular-nums ring-1 ${tone}`}>{share}%</span>}
    </td>
  );
}

/** The team's sales day by day this month (Whole business's chart). */
function DayByDay({ data }: { data: SalesVsTarget }) {
  const byDay = new Map(data.daily.map((one) => [one.day, one.sold]));
  const days = Array.from({ length: data.daysInMonth }, (_, n) => `${data.month}-${String(n + 1).padStart(2, "0")}`);
  const top = Math.max(1, ...data.daily.map((one) => one.sold));
  return (
    <section className={`${CARD} px-4 py-4`}>
      <h2 className="text-sm font-semibold text-slate-900">Day by day</h2>
      <p className="text-[12px] text-slate-500">What the team sold each day, without VAT</p>
      <div className="mt-3 flex h-28 items-end gap-[3px]" role="img" aria-label="Sales each day of the month">
        {days.map((day) => {
          const value = byDay.get(day) ?? 0;
          return (
            <span
              key={day}
              title={`${Number(day.slice(8))} ${monthName(data.month).split(" ")[0]}: ${exactPeso(value)}`}
              className={`flex-1 rounded-t ${day > data.day ? "bg-slate-100" : value ? "bg-emerald-500" : "bg-slate-200"}`}
              style={{ height: `${Math.max(3, (value / top) * 100)}%` }}
            />
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-[10.5px] text-slate-400">
        <span>1</span>
        <span>{data.daysInMonth}</span>
      </div>
    </section>
  );
}

/** The medicines the team sold most this month, by value (Whole business's list, Zoho's too). */
function Medicines({ data }: { data: SalesVsTarget }) {
  const top = Math.max(1, ...data.medicines.map((one) => one.value));
  return (
    <section className={`${CARD} px-4 py-4`}>
      <h2 className="text-sm font-semibold text-slate-900">Medicines sold</h2>
      <p className="text-[12px] text-slate-500">The ten selling most this month, by value without VAT</p>
      {data.medicines.length === 0 ? (
        <p className="mt-3 text-[12.5px] text-slate-500">Nothing sold yet this month.</p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {data.medicines.map((one) => (
            <li key={one.name} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-2 text-[12.5px]">
              <span className="truncate text-slate-800" title={one.name}>
                {one.name}
              </span>
              <span className="h-1.5 rounded-full bg-slate-100" aria-hidden="true">
                <span className="block h-full rounded-full bg-sky-500" style={{ width: `${(one.value / top) * 100}%` }} />
              </span>
              <span className="text-right tabular-nums text-slate-900" title={exactPeso(one.value)}>
                {shortPeso(one.value)} <span className="text-[11px] text-slate-500">· {Math.round(one.qty).toLocaleString("en-PH")} pcs</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
