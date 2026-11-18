// Sales performance (18 Nov 2026, the B2B team's end-of-day Excel, made here from the ERP's own
// invoices and calls): any day or days; the revenue against target (VAT-exclusive), TLB (different
// SKUs), billing efficiency (different customers), the calls, the channels ranked with their share,
// and the daily sales by salesperson and by channel. Weeks are fixed (1st–7th, 8th–14th, …). One
// press downloads it as their Excel file. A MedRep sees their own row, a lead their team, the CEO,
// Management and the Admin everyone (and can narrow it to one channel).

import type { SalesPerformance } from "@2mg/api/types";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Download, TrendingUp } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { CARD, PageHead, PageState } from "../ui";

const todayIn = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
const shift = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const peso = (centavos: number | null) => (centavos === null ? "—" : `₱${Math.round(centavos / 100).toLocaleString("en-PH")}`);
const count = (n: number | null) => (n === null ? "—" : n.toLocaleString("en-PH"));
const dayHead = (day: string) => {
  const date = new Date(`${day}T00:00:00Z`);
  return date.toLocaleDateString("en-PH", { day: "numeric", month: "short", timeZone: "UTC" });
};

function Pct({ value }: { value: number | null }) {
  if (value === null) return <span className="text-slate-400">—</span>;
  const tone = value >= 75 ? "bg-emerald-100 text-emerald-800" : value >= 50 ? "bg-yellow-100 text-yellow-800" : value >= 25 ? "bg-orange-100 text-orange-800" : "bg-rose-100 text-rose-800";
  return <span className={`inline-block min-w-16 rounded-md px-2 py-0.5 text-center font-semibold tabular-nums ${tone}`}>{value.toFixed(2)}%</span>;
}

function Bar({ value }: { value: number | null }) {
  const width = Math.max(0, Math.min(100, value ?? 0));
  return (
    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
      <div className="h-full rounded-full bg-brand" style={{ width: `${width}%` }} />
    </div>
  );
}

/** A table with Zoho-like headings, a person per row and the Grand Total in red at the foot. */
function Table({ title, head, rows, foot }: { title: string; head: string[]; rows: React.ReactNode[][]; foot: React.ReactNode[] }) {
  return (
    <section className={`${CARD} mb-5 overflow-hidden`}>
      <h2 className="border-b border-slate-100 bg-head px-4 py-2 text-center text-[13px] font-bold tracking-wide text-slate-800 uppercase">{title}</h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-[13px]">
          <thead className="bg-sky-50 text-[11px] text-slate-600 uppercase">
            <tr>
              {head.map((h, at) => (
                <th key={h + at} className={`px-3 py-2 font-semibold whitespace-nowrap ${at === 0 ? "text-left" : "text-right"}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((cells, r) => (
              <tr key={r} className="border-t border-slate-100 hover:bg-slate-50/60">
                {cells.map((cell, c) => (
                  <td key={c} className={`px-3 py-2 tabular-nums ${c === 0 ? "font-medium text-slate-900" : "text-right"}`}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={head.length} className="px-3 py-6 text-center text-slate-500">
                  Nothing in these days.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-200 bg-lime-50/60 font-bold text-red-700">
              {foot.map((cell, c) => (
                <td key={c} className={`px-3 py-2 tabular-nums ${c === 0 ? "" : "text-right"}`}>
                  {cell}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

const PRESETS = (today: string) => {
  const day = Number(today.slice(8, 10));
  const weekStart = `${today.slice(0, 8)}${String(Math.floor((day - 1) / 7) * 7 + 1).padStart(2, "0")}`;
  const lastMonthEnd = shift(`${today.slice(0, 7)}-01`, -1);
  return [
    { key: "today", label: "Today", from: today, to: today },
    { key: "yesterday", label: "Yesterday", from: shift(today, -1), to: shift(today, -1) },
    { key: "week", label: "This week", from: weekStart, to: today },
    { key: "month", label: "This month", from: `${today.slice(0, 7)}-01`, to: today },
    { key: "last", label: "Last month", from: `${lastMonthEnd.slice(0, 7)}-01`, to: lastMonthEnd },
  ];
};
const LINES = ["B2B", "RX", "HOSP", "BID", "CLIDP", "TELESALES", "B2C", "MT"];

export function SalesPerformancePage() {
  const today = todayIn();
  const [params, setParams] = useSearchParams();
  const from = params.get("from") ?? `${today.slice(0, 7)}-01`;
  const to = params.get("to") ?? today;
  const channel = params.get("channel") ?? "";
  const tab = params.get("tab") ?? "values";
  const qs = new URLSearchParams({ from, to, ...(channel ? { channel } : {}) });
  const query = useQuery({
    queryKey: ["sales-performance", qs.toString()],
    queryFn: () => api<SalesPerformance>(`/api/sales-performance?${qs}`),
    placeholderData: keepPreviousData,
  });
  const r = query.data;
  const set = (next: Record<string, string | null>) => {
    const out = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) v ? out.set(k, v) : out.delete(k);
    setParams(out);
  };
  const weekHeads = r?.weeks.map((w) => w.label) ?? [];
  const tabs: [string, string][] = [
    ["values", "Revenue"],
    ["tlb", "TLB"],
    ["billing", "Billing efficiency"],
    ["calls", "Sales calls"],
    ["channels", "Channels"],
    ["daily", "Daily"],
  ];
  return (
    <div>
      <PageHead
        title={
          <span className="flex items-center gap-2">
            <TrendingUp className="size-6 text-brand" /> Sales performance
          </span>
        }
        sub={r ? `${from === to ? dayHead(from) : `${dayHead(from)} – ${dayHead(to)}`} · before VAT · ${r.scope === "company" ? (r.channel ? r.channel : "the whole company") : r.scope === "team" ? "your team" : "you"}` : undefined}
        actions={
          <a href={`/api/sales-performance/xlsx?${qs}`} className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700">
            <Download className="size-4" /> Excel
          </a>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          {PRESETS(today).map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => set({ from: p.from, to: p.to })}
              className={`rounded-full border px-3 py-1 text-[13px] ${from === p.from && to === p.to ? "border-brand bg-brand text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
            >
              {p.label}
            </button>
          ))}
          <input type="date" className="field" value={from} max={to} onChange={(event) => set({ from: event.target.value })} aria-label="From" />
          <span className="text-slate-400">to</span>
          <input type="date" className="field" value={to} min={from} max={today} onChange={(event) => set({ to: event.target.value })} aria-label="To" />
          {r?.scope === "company" && (
            <select className="field" value={channel} onChange={(event) => set({ channel: event.target.value || null })} aria-label="Channel">
              <option value="">All channels</option>
              {LINES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
        </div>
      </PageHead>
      <PageState query={query} what="the sales performance" />
      {r && (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Revenue", value: peso(r.revenue.total.total), pct: r.revenue.total.pct, sub: r.revenue.total.target !== null ? `of ${peso(r.revenue.total.target)}` : "no target set" },
              { label: "TLB (different SKUs)", value: count(r.tlb.total.total), pct: r.tlb.total.pct, sub: r.tlb.total.target !== null ? `of ${count(r.tlb.total.target)}` : "no target set" },
              { label: "Billing efficiency (customers)", value: count(r.billing.total.total), pct: r.billing.total.pct, sub: r.billing.total.target !== null ? `of ${count(r.billing.total.target)}` : "no target set" },
              { label: "Sales calls", value: count(r.calls.total.total), pct: null, sub: `${r.calls.rows.filter((x) => x.total > 0).length} people called` },
            ].map((k) => (
              <div key={k.label} className={`${CARD} p-4`}>
                <div className="text-[12px] font-medium text-slate-500">{k.label}</div>
                <div className="mt-1 flex items-baseline justify-between gap-2">
                  <span className="text-2xl font-bold text-slate-900 tabular-nums">{k.value}</span>
                  {k.pct !== null && <Pct value={k.pct} />}
                </div>
                <div className="text-[12px] text-slate-500">{k.sub}</div>
                {k.pct !== null && <Bar value={k.pct} />}
              </div>
            ))}
          </div>
          <div className="mb-4 flex flex-wrap gap-1.5">
            {tabs.map(([key, label]) => (
              <button key={key} type="button" onClick={() => set({ tab: key === "values" ? null : key })} className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold ${tab === key ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
                {label}
              </button>
            ))}
          </div>
          {tab === "values" && (
            <Table
              title="Values"
              head={["Sales person", "Target", "110%", ...weekHeads, "Total ach", "%age", "BTD"]}
              rows={r.revenue.rows.map((x) => [`${x.channel} | ${x.name}`, peso(x.target), peso(x.target110), ...x.weeks.map(peso), <b key="t">{peso(x.total)}</b>, <Pct key="p" value={x.pct} />, peso(x.btd)])}
              foot={["Grand Total", peso(r.revenue.total.target), peso(r.revenue.total.target110), ...r.revenue.total.weeks.map(peso), peso(r.revenue.total.total), r.revenue.total.pct === null ? "—" : `${r.revenue.total.pct.toFixed(2)}%`, peso(r.revenue.total.btd)]}
            />
          )}
          {(tab === "tlb" || tab === "billing") && (
            <Table
              title={tab === "tlb" ? "TLB · different SKUs sold" : "Billing efficiency · different customers billed"}
              head={["Sales person", "Target", ...weekHeads, "Total ach", "%age"]}
              rows={(tab === "tlb" ? r.tlb : r.billing).rows.map((x) => [`${x.channel} | ${x.name}`, count(x.target), ...x.weeks.map(count), <b key="t">{count(x.total)}</b>, <Pct key="p" value={x.pct} />])}
              foot={(() => {
                const t = (tab === "tlb" ? r.tlb : r.billing).total;
                return ["Grand Total", count(t.target), ...t.weeks.map(count), count(t.total), t.pct === null ? "—" : `${t.pct.toFixed(2)}%`];
              })()}
            />
          )}
          {tab === "calls" && (
            <Table
              title="Sales calls"
              head={["Sales person", ...(r.days.length ? r.days.map(dayHead) : weekHeads), "Grand total"]}
              rows={r.calls.rows.map((x) => [x.name, ...(r.days.length ? x.days : x.weeks).map((n) => (n ? n : "")), <b key="t">{x.total}</b>])}
              foot={["Grand Total", ...(r.days.length ? r.calls.total.days : r.calls.total.weeks), r.calls.total.total]}
            />
          )}
          {tab === "channels" && (
            <>
              <section className={`${CARD} mb-5 p-4`}>
                <h2 className="mb-3 text-[13px] font-bold tracking-wide text-slate-800 uppercase">Channel ranking and contribution</h2>
                <ul className="space-y-2.5">
                  {r.channels.rows.map((c) => (
                    <li key={c.channel} className="grid grid-cols-[2rem_6rem_1fr_auto] items-center gap-3 text-sm">
                      <span className="grid size-7 place-items-center rounded-full bg-slate-900 text-[12px] font-bold text-white">{c.rank}</span>
                      <span className="font-semibold text-slate-900">{c.channel}</span>
                      <span className="h-3 overflow-hidden rounded-full bg-slate-100">
                        <span className="block h-full rounded-full bg-brand" style={{ width: `${c.share}%` }} />
                      </span>
                      <span className="text-right tabular-nums">
                        {peso(c.total)} <span className="ml-2 inline-block w-14 font-semibold">{c.share.toFixed(0)}%</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
              <Table
                title="Channels by week"
                head={["Channel", ...weekHeads, "Grand total", "Cont"]}
                rows={r.channels.rows.map((c) => [c.channel, ...c.weeks.map((w) => (w ? peso(w) : "")), <b key="t">{peso(c.total)}</b>, `${c.share.toFixed(0)}%`])}
                foot={["Grand Total", ...r.channels.total.weeks.map(peso), peso(r.channels.total.total), "100%"]}
              />
            </>
          )}
          {tab === "daily" &&
            (r.days.length ? (
              <>
                <Table
                  title="Daily sales by salesperson (CHC)"
                  head={["Sales person", ...r.days.map(dayHead), "Grand total"]}
                  rows={r.daily.people.map((x) => [`${x.channel} | ${x.name}`, ...x.days.map((n) => (n ? peso(n) : "")), <b key="t">{peso(x.total)}</b>])}
                  foot={["Grand Total", ...r.days.map((_, at) => peso(r.daily.people.reduce((s, x) => s + (x.days[at] ?? 0), 0))), peso(r.daily.people.reduce((s, x) => s + x.total, 0))]}
                />
                <Table
                  title="Daily sales by channel"
                  head={["Channel", ...r.days.map(dayHead), "Grand total"]}
                  rows={r.channels.rows.map((c) => [c.channel, ...c.days.map((n) => (n ? peso(n) : "")), <b key="t">{peso(c.total)}</b>])}
                  foot={["Grand Total", ...r.channels.total.days.map(peso), peso(r.channels.total.total)]}
                />
              </>
            ) : (
              <p className={`${CARD} p-6 text-center text-sm text-slate-500`}>Pick 31 days or fewer to see each day.</p>
            ))}
        </>
      )}
    </div>
  );
}
