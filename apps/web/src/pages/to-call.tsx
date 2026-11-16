// Customers to call: who is due to reorder against their own usual gap (this CRM's orders and
// the old system's), who is late, at risk or lost, biggest last order first. A seller sees their
// customers; a lead or above also sees per area whose customers are slipping.

import type { Reorders, ReorderState } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { Phone } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useMe } from "../auth";
import { seatWords } from "../seat-words";
import { shortPeso } from "../ceo";
import { CARD, count, dayLabel, PageHead, PageState, Tabs } from "../ui";

const STATE_LABEL: Record<ReorderState, string> = { soon: "In 2 days", due: "Due now", late: "Late", at_risk: "At risk", lost: "Lost" };
const STATE_SUB: Record<ReorderState, string> = {
  soon: "Their refill falls in the next two days: reach them before they run out.",
  due: "Their usual gap has passed: call before they order elsewhere.",
  late: "Past 1.5 times their usual gap.",
  at_risk: "Past 2.5 times their usual gap, or 90 days and late.",
  lost: "No order in 180 days and far past their gap (last two years only).",
};

export function ToCallPage() {
  const me = useMe().data;
  const words = seatWords(me);
  // A seller's own list: every line is theirs, so no seller column.
  const own = me?.role === "medrep" || me?.role === "online";
  const [params, setParams] = useSearchParams();
  // MD Telesales start on the refills coming due; everyone else on the ones due now.
  const state = (params.get("state") as ReorderState | null) ?? (me?.channel?.code === "TS" && me.business === "RX" ? "soon" : "due");
  const area = params.get("area");
  const kind = params.get("kind");
  const query = useQuery({
    queryKey: ["reorders", state, area, kind],
    queryFn: () =>
      api<Reorders>(`/api/my/reorders?${new URLSearchParams({ state, ...(area ? { area } : {}), ...(kind ? { kind } : {}) })}`),
  });
  const data = query.data;
  if (!data) return <PageState query={query} what={`the ${words.customers} to call`} />;
  const set = (key: string, value: string | null) => {
    const copy = new URLSearchParams(params);
    if (value) copy.set(key, value);
    else copy.delete(key);
    setParams(copy, { replace: true });
  };
  const of = (key: ReorderState | "ok") => data.counts.find((one) => one.state === key);
  const areaName = area ? data.areas.find((one) => String(one.areaId) === area)?.area : null;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHead
        title={words.toCall}
        tags={
          <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[12px] font-semibold text-emerald-800 ring-1 ring-emerald-200">
            {areaName ?? data.scope.label}
          </span>
        }
        sub={`${data.scope.detail.replace("My customers", words.myCustomers)} · ${count(of("ok")?.customers ?? 0)} ordering on time · each against their own usual gap between orders`}
        actions={
          area ? (
            <button type="button" className="text-[13px] font-semibold text-emerald-700 hover:underline" onClick={() => set("area", null)}>
              All areas
            </button>
          ) : undefined
        }
      />
      <Tabs
        tabs={(["soon", "due", "late", "at_risk", "lost"] as const).map((key) => ({ key, label: STATE_LABEL[key], count: of(key)?.customers ?? 0 }))}
        value={state}
        onChange={(key) => set("state", key)}
      />
      <p className="mt-2 mb-3 text-[12.5px] text-slate-500">{STATE_SUB[state]}</p>
      <div className={`${CARD} mb-5 overflow-x-auto`}>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
              <th className="px-4 py-2.5">Customer</th>
              {!own && <th className="px-3 py-2.5">Seller · area</th>}
              <th className="px-3 py-2.5">Last order</th>
              <th className="px-3 py-2.5 text-right">Usually every</th>
              <th className="px-3 py-2.5">Expected</th>
              <th className="px-4 py-2.5 text-right">Last order value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.rows.length === 0 && (
              <tr>
                <td colSpan={own ? 5 : 6} className="px-4 py-6 text-center text-slate-500">
                  No one here.
                </td>
              </tr>
            )}
            {data.rows.map((row) => (
              <tr key={row.customerId} className="hover:bg-slate-50/60">
                <td className="px-4 py-2.5">
                  <Link to={`/customers/${row.customerId}`} className="font-semibold text-slate-900 hover:underline">
                    {row.name}
                  </Link>
                  <div className="flex flex-wrap items-center gap-x-2 text-[11.5px] text-slate-500">
                    <span className="capitalize">{row.kind}</span>
                    {row.city && <span>{row.city}</span>}
                    {row.lastItems && <span className="text-slate-600">Last: {row.lastItems}</span>}
                    {row.phone && row.phone.replace(/\D/g, "").length >= 7 && (
                      <a href={`tel:${row.phone.replace(/\s/g, "")}`} className="inline-flex items-center gap-1 text-emerald-700 hover:underline">
                        <Phone className="size-3" /> {row.phone}
                      </a>
                    )}
                  </div>
                </td>
                {!own && (
                  <td className="px-3 py-2.5 text-slate-600">
                    {row.seller ?? <span className="text-slate-400">No seller</span>}
                    {row.area && <div className="text-[11.5px] text-slate-400">{row.area}</div>}
                  </td>
                )}
                <td className="px-3 py-2.5 whitespace-nowrap text-slate-600">
                  {dayLabel(row.lastOn)}
                  <div className="text-[11.5px] text-slate-400">{row.since} days ago</div>
                </td>
                <td className="px-3 py-2.5 text-right text-slate-600 tabular-nums">
                  {row.usual} days
                  <div className="text-[11.5px] text-slate-400">{row.orders} orders</div>
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap text-slate-600">{dayLabel(row.expectedOn)}</td>
                <td className="px-4 py-2.5 text-right font-semibold text-slate-900 tabular-nums">{shortPeso(row.lastTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.areas.length > 0 && !area && (
        <section className={`${CARD} overflow-x-auto`}>
          <h2 className="border-b border-slate-100 px-4 py-3 text-[14px] font-semibold text-slate-900">By seller: whose customers are slipping</h2>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-slate-100 text-left text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                <th className="px-4 py-2">Area</th>
                <th className="px-3 py-2 text-right">On time</th>
                <th className="px-3 py-2 text-right">Due</th>
                <th className="px-3 py-2 text-right">Late</th>
                <th className="px-3 py-2 text-right">At risk</th>
                <th className="px-4 py-2 text-right">Lost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.areas.map((row) => (
                <tr key={row.areaId ?? "none"} className="hover:bg-slate-50/60">
                  <td className="px-4 py-2">
                    {row.areaId ? (
                      <button type="button" className="font-semibold text-slate-900 hover:underline" onClick={() => set("area", String(row.areaId))}>
                        {row.area}
                      </button>
                    ) : (
                      <span className="font-semibold text-slate-500">{row.area}</span>
                    )}
                    <div className="text-[11.5px] text-slate-400">{row.seller ?? (row.areaId ? "Empty seat" : "Old customers not placed on a seat yet")}</div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{count(row.ok)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{count(row.due)}</td>
                  <td className="px-3 py-2 text-right text-amber-700 tabular-nums">{count(row.late)}</td>
                  <td className="px-3 py-2 text-right text-red-700 tabular-nums">{count(row.atRisk)}</td>
                  <td className="px-4 py-2 text-right text-slate-500 tabular-nums">{count(row.lost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
