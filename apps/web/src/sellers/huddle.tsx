// The 7 PM huddle. A seller declares the day's four numbers to their coach (sales invoiced,
// money collected, visits, an invoice today or not), prefilled from the data; a day without an
// invoice needs the blocker, and tomorrow's first stop is asked. A coach (or head) sees the
// team's evening instead: who declared, who is red, who has gone three working days without an
// invoice (go with them tomorrow), and every blocker.

import type { Huddle, TeamHuddle } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronLeft, ChevronRight, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useMe } from "../auth";
import { shortPeso } from "../ceo";
import { Button, CARD, dayLabel, PageHead, PageState, Problem, useAction } from "../ui";
import { EmptyState } from "../no-results";

const LEADS = ["team_lead", "manager", "ceo", "admin"];

export function HuddlePage() {
  const me = useMe().data;
  if (!me) return null;
  return LEADS.includes(me.role) ? <TeamHuddlePage /> : <MyHuddlePage />;
}

const toPesos = (centavos: number) => String(Math.round(centavos / 100));
const toCentavos = (pesos: string) => Math.max(0, Math.round(Number(pesos.replace(/[^\d.]/g, "")) * 100) || 0);

function MyHuddlePage() {
  const queries = useQueryClient();
  const query = useQuery({ queryKey: ["huddle", "mine"], queryFn: () => api<Huddle>("/api/huddle") });
  const action = useAction();
  const [form, setForm] = useState({ sales: "", collected: "", visits: "", invoiced: false, blocker: "", tomorrow: "" });
  const data = query.data;
  useEffect(() => {
    if (!data) return;
    const from = data.declared ?? data.actual;
    setForm({
      sales: toPesos(from.sales),
      collected: toPesos(from.collected),
      visits: String(from.visits),
      invoiced: from.invoiced,
      blocker: data.declared?.blocker ?? "",
      tomorrow: data.declared?.tomorrow ?? "",
    });
  }, [data]);
  if (!data) return <PageState query={query} what="tonight's huddle" />;
  const declare = () =>
    void action.run(async () => {
      await api("/api/huddle", {
        method: "POST",
        body: {
          sales: toCentavos(form.sales),
          collected: toCentavos(form.collected),
          visits: Number(form.visits) || 0,
          invoiced: form.invoiced,
          blocker: form.blocker || null,
          tomorrow: form.tomorrow || null,
        },
      });
      await queries.invalidateQueries({ queryKey: ["huddle"] });
    });
  const field = "field h-10 w-full text-[14px]";
  return (
    <div className="mx-auto max-w-2xl">
      <PageHead
        title="Tonight's huddle"
        sub={`${dayLabel(data.day)} · declare by 7:00 PM to ${data.coach ?? "your coach"} · prefilled from today's invoices, payments and visits`}
        tags={
          data.declared ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[12px] font-semibold text-emerald-800 ring-1 ring-emerald-200">
              <Check className="size-3" /> Declared at {data.declared.at}
            </span>
          ) : undefined
        }
      />
      <section className={`${CARD} p-5`}>
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="text-[12.5px] font-semibold text-slate-600">
            Sales invoiced today (₱)
            <input className={field} inputMode="decimal" value={form.sales} onChange={(e) => setForm({ ...form, sales: e.target.value })} />
            <span className="text-[11px] font-normal text-slate-400">The data says {shortPeso(data.actual.sales)}</span>
          </label>
          <label className="text-[12.5px] font-semibold text-slate-600">
            Collected today (₱)
            <input className={field} inputMode="decimal" value={form.collected} onChange={(e) => setForm({ ...form, collected: e.target.value })} />
            <span className="text-[11px] font-normal text-slate-400">The data says {shortPeso(data.actual.collected)}</span>
          </label>
          <label className="text-[12.5px] font-semibold text-slate-600">
            Visits done
            <input className={field} inputMode="numeric" value={form.visits} onChange={(e) => setForm({ ...form, visits: e.target.value })} />
            <span className="text-[11px] font-normal text-slate-400">The data says {data.actual.visits}</span>
          </label>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {[true, false].map((value) => (
            <button
              key={String(value)}
              type="button"
              onClick={() => setForm({ ...form, invoiced: value })}
              className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold ring-1 ${
                form.invoiced === value
                  ? value
                    ? "bg-emerald-600 text-white ring-emerald-600"
                    : "bg-rose-600 text-white ring-rose-600"
                  : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50"
              }`}
            >
              {value ? "An invoice today" : "No invoice today"}
            </button>
          ))}
        </div>
        {!form.invoiced && (
          <label className="mt-4 block text-[12.5px] font-semibold text-slate-600">
            What stood in the way (required)
            <textarea
              className="field min-h-20 w-full text-[14px]"
              value={form.blocker}
              placeholder="PO not signed, fund not released, stock-out…"
              onChange={(e) => setForm({ ...form, blocker: e.target.value })}
            />
          </label>
        )}
        <label className="mt-4 block text-[12.5px] font-semibold text-slate-600">
          Tomorrow's first stop
          <input className={field} value={form.tomorrow} onChange={(e) => setForm({ ...form, tomorrow: e.target.value })} />
        </label>
        <Problem message={action.problem?.message} />
        <div className="mt-4 flex justify-end">
          <Button variant="primary" disabled={action.busy} onClick={declare}>
            {data.declared ? "Declare again" : `Declare to ${data.coach ?? "my coach"}`}
          </Button>
        </div>
      </section>
    </div>
  );
}

const shift = (day: string, by: number) => new Date(Date.parse(`${day}T00:00:00Z`) + by * 86_400_000).toISOString().slice(0, 10);

function TeamHuddlePage() {
  const [params, setParams] = useSearchParams();
  const day = params.get("day") ?? "";
  const query = useQuery({
    queryKey: ["huddle", "team", day],
    queryFn: () => api<TeamHuddle>(`/api/huddle/team${day ? `?day=${day}` : ""}`),
  });
  const data = query.data;
  if (!data) return <PageState query={query} what="the team's huddle" />;
  const red = data.rows.filter((row) => row.red).length;
  const dry = data.rows.filter((row) => row.threeDry).length;
  return (
    <div className="mx-auto max-w-5xl">
      <PageHead
        title="Team huddle"
        sub={`${dayLabel(data.day)} · ${data.declared} of ${data.rows.length} declared · ${red} without an invoice${dry ? ` · ${dry} with no invoice three working days running` : ""}`}
        actions={
          <div className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-2xs">
            <button type="button" className="rounded-lg p-1.5 hover:bg-slate-100" onClick={() => setParams({ day: shift(data.day, -1) }, { replace: true })} aria-label="Day before">
              <ChevronLeft className="size-4" />
            </button>
            <span className="min-w-28 text-center text-[13px] font-semibold text-slate-800">{dayLabel(data.day)}</span>
            <button
              type="button"
              className="rounded-lg p-1.5 hover:bg-slate-100 disabled:opacity-30"
              disabled={data.day >= data.today}
              onClick={() => setParams({ day: shift(data.day, 1) }, { replace: true })}
              aria-label="Day after"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        }
      />
      <div className={`${CARD} overflow-x-auto`}>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
              <th className="px-4 py-2.5">Person</th>
              <th className="px-3 py-2.5 text-right">Sales</th>
              <th className="px-3 py-2.5 text-right">Collected</th>
              <th className="px-3 py-2.5 text-right">Visits</th>
              <th className="px-3 py-2.5">Invoice</th>
              <th className="px-4 py-2.5">Blocker · tomorrow</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.rows.length === 0 && (
              <tr>
                <td colSpan={6}>
                  <EmptyState title="No sellers under you.">Your team's evening numbers show here once your sellers declare them.</EmptyState>
                </td>
              </tr>
            )}
            {data.rows.map((row) => {
              const shown = row.declared ?? row.actual;
              return (
                <tr key={row.personId} className={row.threeDry ? "bg-rose-50/50" : "hover:bg-slate-50/60"}>
                  <td className="px-4 py-2.5">
                    <div className="font-semibold text-slate-900">{row.name}</div>
                    <div className="text-[11.5px] text-slate-500">
                      {row.area ?? row.seat} · {row.declared ? `declared ${row.declared.at}` : "not declared"}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{shortPeso(shown.sales)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{shortPeso(shown.collected)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{shown.visits}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    {row.actual.invoiced ? (
                      <span className="font-semibold text-emerald-700">Yes</span>
                    ) : (
                      <span className="font-semibold text-rose-700">No</span>
                    )}
                    {row.threeDry && (
                      <div className="mt-0.5 flex items-center gap-1 text-[11px] font-semibold text-rose-700">
                        <TriangleAlert className="size-3" /> 3 days: go with them tomorrow
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">
                    {row.declared?.blocker ?? (row.red && !row.declared ? <span className="text-slate-400">No word yet</span> : "—")}
                    {row.declared?.tomorrow && <div className="text-[11.5px] text-slate-400">Tomorrow: {row.declared.tomorrow}</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
