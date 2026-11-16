// A selling person's monthly scorecard, as their playbook writes it: the total out of 100 in a
// ring, each KPI with its figure, its band and what reaches the next band; the last 12 locked
// months as bars with their average and the increment it comes to. A locked month's figure can
// be questioned (the lead answers). A lead opens a team member's card with ?person=.

import type { MyScore, ScoreCard } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Lock, MessageSquareWarning, Radio, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { Ring } from "../team/charts";
import { Button, CARD, Dialog, Field, PageHead, PageState, Problem, useAction } from "../ui";

export const shiftMonth = (month: string, by: number) => {
  const [year, m] = month.split("-").map(Number) as [number, number];
  const date = new Date(Date.UTC(year, m - 1 + by, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
};
export const monthLabel = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-PH", { month: "long", year: "numeric", timeZone: "UTC" });

/** Green from 85, amber from 60, red below: the playbooks' increment bands. */
export const toneOf = (percent: number | null) =>
  percent === null ? "#94a3b8" : percent >= 85 ? "#10b981" : percent >= 60 ? "#f59e0b" : "#ef4444";

export function MonthPicker({ month, today, onChange }: { month: string; today: string; onChange: (month: string) => void }) {
  const latest = today.slice(0, 7);
  return (
    <div className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-2xs">
      <button type="button" className="rounded-lg p-1.5 hover:bg-slate-100" onClick={() => onChange(shiftMonth(month, -1))} aria-label="Month before">
        <ChevronLeft className="size-4" />
      </button>
      <span className="min-w-32 text-center text-[13px] font-semibold text-slate-800">{monthLabel(month)}</span>
      <button
        type="button"
        className="rounded-lg p-1.5 hover:bg-slate-100 disabled:opacity-30"
        disabled={month >= latest}
        onClick={() => onChange(shiftMonth(month, 1))}
        aria-label="Month after"
      >
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}

const figure = (value: number | null, unit: "%" | "days") =>
  value === null ? "—" : unit === "%" ? `${value.toFixed(value < 10 && value % 1 ? 1 : 0)}%` : `${Math.round(value)} days`;

function KpiRow({ kpi, onQuestion }: { kpi: ScoreCard["kpis"][number]; onQuestion?: () => void }) {
  const share = kpi.points === null ? 0 : kpi.points / kpi.weight;
  const color = kpi.points === null ? "bg-slate-200" : share >= 0.8 ? "bg-emerald-500" : share >= 0.4 ? "bg-amber-400" : "bg-red-500";
  return (
    <div className="flex flex-col gap-2 px-4 py-3.5 sm:flex-row sm:items-center sm:gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-[13.5px] font-semibold text-slate-900">{kpi.label}</span>
          {kpi.band && <span className="text-[11.5px] font-medium text-slate-500">{kpi.band}</span>}
        </div>
        <div className="mt-0.5 text-[12px] text-slate-500">{kpi.note || kpi.how}</div>
        {kpi.next && kpi.points !== null && (
          <div className="mt-0.5 text-[11.5px] text-emerald-700">
            {kpi.unit === "days" ? `At ${kpi.next.value} days or less` : `At ${kpi.next.value}%`}: {kpi.next.points} points
          </div>
        )}
      </div>
      <div className="flex items-center gap-4 sm:w-72">
        <div className="w-20 text-right text-[15px] font-bold text-slate-900 tabular-nums">{figure(kpi.value, kpi.unit)}</div>
        <div className="flex-1">
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.round(share * 100)}%` }} />
          </div>
          <div className="mt-1 text-right text-[11.5px] text-slate-500 tabular-nums">
            {kpi.points === null ? "nothing to measure yet" : `${kpi.points} of ${kpi.weight}`}
          </div>
        </div>
        {onQuestion && (
          <button type="button" onClick={onQuestion} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Question this figure">
            <MessageSquareWarning className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
}

export function YearBars({ history }: { history: { month: string; percent: number }[] }) {
  if (!history.length) return <div className="text-[12.5px] text-slate-500">No month locked yet.</div>;
  return (
    <div className="flex h-28 items-end gap-1.5">
      {history.map((one) => (
        <div key={one.month} className="flex flex-1 flex-col items-center gap-1" title={`${monthLabel(one.month)}: ${one.percent}`}>
          <span className="text-[10.5px] text-slate-500 tabular-nums">{one.percent}</span>
          <div className="w-full rounded-t-md" style={{ height: `${Math.max(4, one.percent * 0.8)}px`, background: toneOf(one.percent) }} />
          <span className="text-[10px] text-slate-400">{monthLabel(one.month).slice(0, 3)}</span>
        </div>
      ))}
    </div>
  );
}

export function MyScorePage() {
  const [params, setParams] = useSearchParams();
  const person = params.get("person");
  const month = params.get("month") ?? "";
  const query = useQuery({
    queryKey: ["scores", person, month],
    queryFn: () => api<MyScore>(`/api/scores?${new URLSearchParams({ ...(person ? { personId: person } : {}), ...(month ? { month } : {}) })}`),
  });
  const [asking, setAsking] = useState<string | null>(null);
  const data = query.data;
  if (!data) return <PageState query={query} what="the scorecard" />;
  const card = data.card;
  const pick = (next: string) => {
    const copy = new URLSearchParams(params);
    copy.set("month", next);
    setParams(copy, { replace: true });
  };

  return (
    <div className="mx-auto max-w-4xl">
      <PageHead
        title={data.mine ? "My score" : data.name}
        sub={[data.seat, data.area, card ? `${card.label} · ${card.source}` : null].filter(Boolean).join(" · ")}
        actions={<MonthPicker month={data.month} today={data.today} onChange={pick} />}
      />
      {!card ? (
        <div className={`${CARD} p-6 text-[13.5px] text-slate-600`}>
          No scorecard for {monthLabel(data.month)}: only hospital MedReps and the online desk are scored for now, and only once
          there is a target or a sale to measure.
        </div>
      ) : (
        <>
          <section className={`${CARD} mb-4 flex flex-col gap-5 p-5 sm:flex-row sm:items-center`}>
            <Ring share={card.max ? card.total / 100 : null} color={toneOf(card.percent)} size={112}>
              <div className="text-center">
                <div className="text-3xl font-bold text-slate-900 tabular-nums">{card.total}</div>
                <div className="text-[11px] text-slate-500">of {card.max}</div>
              </div>
            </Ring>
            <div className="min-w-0 flex-1 text-[13px] text-slate-600">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                {card.live ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[11.5px] font-semibold text-sky-800">
                    <Radio className="size-3" /> Running, to {card.upTo.slice(8)} {monthLabel(card.month).split(" ")[0]}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11.5px] font-semibold text-slate-700">
                    <Lock className="size-3" /> Locked on {card.lockedOn}
                  </span>
                )}
                {card.capped && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11.5px] font-semibold text-red-800">
                    <TriangleAlert className="size-3" /> IST below 60%: capped at 40
                  </span>
                )}
              </div>
              {card.max < 100 && <div>KPIs with nothing to measure are left out: {card.max} points were in play.</div>}
              {card.live && <div>It locks on the 1st; no one changes it by hand after that.</div>}
            </div>
          </section>
          <section className={`${CARD} mb-4 divide-y divide-slate-100`}>
            {card.kpis.map((kpi) => (
              <KpiRow key={kpi.key} kpi={kpi} onQuestion={data.mine && !card.live ? () => setAsking(kpi.key) : undefined} />
            ))}
          </section>
        </>
      )}
      <section className={`${CARD} mb-4 p-5`}>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[14px] font-semibold text-slate-900">The last 12 locked months</h2>
          <div className="text-[13px] text-slate-600">
            {data.average === null ? (
              "No average yet"
            ) : (
              <>
                Average <b className="text-slate-900">{data.average}</b> · {data.increment?.label} · increment{" "}
                <b className="text-slate-900">{data.increment?.percent}%</b>
              </>
            )}
            {data.pip && <span className="ml-2 rounded-full bg-red-50 px-2 py-0.5 text-[11.5px] font-semibold text-red-800">Improvement plan</span>}
          </div>
        </div>
        <YearBars history={data.history} />
      </section>
      {data.disputes.length > 0 && <Disputes disputes={data.disputes} canAnswer={!data.mine} />}
      {asking && card && <AskDialog month={card.month} kpi={card.kpis.find((kpi) => kpi.key === asking)} onClose={() => setAsking(null)} />}
    </div>
  );
}

function AskDialog({ month, kpi, onClose }: { month: string; kpi?: ScoreCard["kpis"][number]; onClose: () => void }) {
  const queries = useQueryClient();
  const action = useAction();
  const [note, setNote] = useState("");
  if (!kpi) return null;
  return (
    <Dialog title={`Question ${kpi.label.split(" ·")[0]}`} sub={`${monthLabel(month)} · your lead answers`} onClose={onClose} busy={action.busy}>
      <Field label="What looks wrong" error={action.at("note")}>
        {(props) => <textarea {...props} className="field min-h-24" value={note} onChange={(event) => setNote(event.target.value)} />}
      </Field>
      <Problem message={action.general(["note"])} />
      <div className="mt-3 flex justify-end">
        <Button
          variant="primary"
          disabled={action.busy}
          onClick={() =>
            void action.run(async () => {
              await api("/api/scores/disputes", { method: "POST", body: JSON.stringify({ month, kpi: kpi.key, note }) });
              await queries.invalidateQueries({ queryKey: ["scores"] });
              onClose();
            })
          }
        >
          Send to my lead
        </Button>
      </div>
    </Dialog>
  );
}

export function Disputes({ disputes, canAnswer }: { disputes: MyScore["disputes"]; canAnswer: boolean }) {
  const queries = useQueryClient();
  const action = useAction();
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const answer = (id: number, upheld: boolean) =>
    void action.run(async () => {
      await api(`/api/scores/disputes/${id}/answer`, { method: "POST", body: JSON.stringify({ upheld, answer: answers[id] ?? "" }) });
      await queries.invalidateQueries({ queryKey: ["scores"] });
    });
  return (
    <section className={`${CARD} mb-4`}>
      <h2 className="border-b border-slate-100 px-4 py-3 text-[14px] font-semibold text-slate-900">Questions on the figures</h2>
      <Problem message={action.problem?.message} />
      <div className="divide-y divide-slate-100">
        {disputes.map((one) => (
          <div key={one.id} className="px-4 py-3 text-[13px]">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span>
                <b className="text-slate-900">{one.person}</b> · {one.kpi.toUpperCase()} · {monthLabel(one.month)}
              </span>
              <span className={`text-[11.5px] font-semibold ${one.state === "open" ? "text-amber-700" : one.state === "upheld" ? "text-emerald-700" : "text-slate-500"}`}>
                {one.state === "open" ? "Waiting for the lead" : one.state === "upheld" ? "Upheld" : "Turned down"}
              </span>
            </div>
            <div className="mt-1 text-slate-700">{one.note}</div>
            {one.answer && (
              <div className="mt-1 text-slate-500">
                {one.answeredBy}: {one.answer}
              </div>
            )}
            {canAnswer && one.state === "open" && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  className="field h-8 min-w-60 flex-1 text-[12.5px]"
                  placeholder="Your answer"
                  value={answers[one.id] ?? ""}
                  onChange={(event) => setAnswers((old) => ({ ...old, [one.id]: event.target.value }))}
                />
                <Button small disabled={action.busy} onClick={() => answer(one.id, true)}>
                  Upheld: fix the source
                </Button>
                <Button small disabled={action.busy} onClick={() => answer(one.id, false)}>
                  Turn down
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
