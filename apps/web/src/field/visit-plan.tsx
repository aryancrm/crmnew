// A MedRep's month of visits as one plan: each customer they look after with the visits its class
// asks for (A 4, B 2, C 1, D 1; no class yet, once), planned and done; the month's days. The MedRep
// makes it and sends it to their team lead, who approves it or sends it back; the team lead sets
// each customer's class. The CEO opens anyone's plan to look.

import type { VisitPlanPage as PlanData, PlanStatus, VisitClass } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronLeft, ChevronRight, Send, Sparkles, Undo2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { EmptyState } from "../no-results";
import { FIELD } from "../org/dialogs";
import { Ring } from "../team/charts";
import { hqName } from "../team/hq-name";
import { Button, CARD, Dialog, PageHead, PageState, Problem, useAction } from "../ui";

export const PLAN_WORDS: Record<PlanStatus, { word: string; tone: string }> = {
  draft: { word: "Not sent yet", tone: "bg-slate-100 text-slate-700 ring-slate-200" },
  sent: { word: "With the team lead", tone: "bg-amber-50 text-amber-800 ring-amber-200" },
  approved: { word: "Approved", tone: "bg-emerald-50 text-emerald-800 ring-emerald-200" },
  sent_back: { word: "Sent back", tone: "bg-rose-50 text-rose-700 ring-rose-200" },
};
const KIND_WORDS: Record<string, string> = {
  doctor: "Doctor",
  hospital: "Hospital",
  drugstore: "Drugstore",
};

const shiftMonth = (month: string, by: number) => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const at = new Date(Date.UTC(y, m - 1 + by, 1));
  return at.toISOString().slice(0, 7);
};
const monthName = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-PH", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
const dayWords = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-PH", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

export function VisitPlanPage() {
  const queries = useQueryClient();
  const [params, setParams] = useSearchParams();
  const person = params.get("person");
  const asked = params.get("month");
  const query = useQuery({
    queryKey: ["field", "plan", person, asked],
    queryFn: () =>
      api<PlanData>(
        `/api/field/plan?${new URLSearchParams({ ...(person ? { person } : {}), ...(asked ? { month: asked } : {}) })}`,
      ),
    placeholderData: (previous) => previous,
  });
  const action = useAction();
  const [made, setMade] = useState<number | null>(null);
  const [sendingBack, setSendingBack] = useState(false);
  const data = query.data;
  if (!data) return <PageState query={query} what="the visit plan" />;
  const mine = !person;
  const go = (next: string) => {
    const out = new URLSearchParams(params);
    out.set("month", next);
    setParams(out, { replace: true });
  };
  const refresh = () => queries.invalidateQueries({ queryKey: ["field"] });
  const status = data.plan.status;
  const t = data.totals;
  const workDays = data.days.filter((one) => one.work).length;
  const busiest = Math.max(1, ...data.days.map((one) => one.planned + one.done));

  return (
    <div className={`flex flex-col gap-4 ${query.isPlaceholderData ? "opacity-60" : ""}`}>
      {/* One way back: the shell's ‹ over every page (its own crumb here made two). */}
      <PageHead
        // The tour plan seen by customer (one plan, two views: the calendar is the other).
        title={mine ? "My tour plan · by customer" : `${data.person.name}'s tour plan · by customer`}
        tags={
          status && (
            <span
              className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ${PLAN_WORDS[status].tone}`}
            >
              {PLAN_WORDS[status].word}
              {status !== "draft" && data.plan.decidedBy ? ` · ${data.plan.decidedBy}` : ""}
            </span>
          )
        }
        // The person's HQ ("TAFT"), never the territory's whole name ("RX | TAFT").
        sub={`${data.customers.length} customers · ${workDays} working days${data.person.area ? ` · ${hqName(data.person.area, data.person.name)}` : ""}`}
        actions={
          <div className="flex flex-wrap items-center gap-1">
            <Link
              to={`/field/plan?${new URLSearchParams({ ...(person ? { person } : {}), month: data.month.slice(0, 7) })}`}
              className="rounded-lg px-2 py-1 text-[13px] font-semibold text-emerald-700 hover:bg-emerald-50"
            >
              Calendar
            </Link>
            {data.can.make && (
              <Button
                small
                disabled={action.busy}
                onClick={() =>
                  action.run(async () => {
                    const answer = await api<{ added: number }>("/api/field/plan/make", {
                      body: { month: data.month },
                    });
                    setMade(answer.added);
                    await refresh();
                  })
                }
              >
                <Sparkles size={15} /> Make my plan
              </Button>
            )}
            {data.can.send && (
              <Button
                small
                variant="primary"
                disabled={action.busy || t.planned === 0}
                onClick={() =>
                  action.run(async () => {
                    await api("/api/field/plan/send", { body: { month: data.month } });
                    await refresh();
                  })
                }
              >
                <Send size={15} /> Send to my team lead
              </Button>
            )}
            {data.can.decide && (
              <>
                <Button
                  small
                  variant="primary"
                  disabled={action.busy}
                  onClick={() =>
                    action.run(async () => {
                      await api(`/api/field/plan/${data.person.id}/decide`, {
                        body: { month: data.month, approve: true },
                      });
                      await refresh();
                    })
                  }
                >
                  <Check size={15} /> Approve
                </Button>
                <Button small onClick={() => setSendingBack(true)}>
                  <Undo2 size={15} /> Send back
                </Button>
              </>
            )}
            <span className="ml-2 flex items-center gap-1">
              <Button
                small
                variant="quiet"
                aria-label="The month before"
                onClick={() => go(shiftMonth(data.month, -1))}
              >
                <ChevronLeft size={16} />
              </Button>
              <span className="min-w-28 text-center text-sm font-semibold text-slate-800">
                {monthName(data.month)}
              </span>
              <Button
                small
                variant="quiet"
                aria-label="The month after"
                onClick={() => go(shiftMonth(data.month, 1))}
              >
                <ChevronRight size={16} />
              </Button>
            </span>
          </div>
        }
      />
      {status === "sent_back" && data.plan.note && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-800">
          {data.plan.decidedBy} sent it back: {data.plan.note}
        </div>
      )}
      {made !== null && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
          {made
            ? `${made} visits added to the month.`
            : "Every customer already has the visits its class asks for."}
        </div>
      )}
      <Problem message={action.problem?.message} />

      <div className="grid gap-3 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <div className={`${CARD} flex items-center gap-4 p-4`}>
          <Ring
            share={t.needed ? t.done / t.needed : null}
            pace={t.needed ? (t.done + t.planned) / t.needed : null}
            color="#059669"
            size={80}
          >
            <span className="text-sm font-semibold text-slate-900 tabular-nums">
              {t.needed ? `${Math.round((t.done / t.needed) * 100)}%` : "—"}
            </span>
          </Ring>
          <div className="text-sm">
            <div className="font-semibold text-slate-900">{t.done} done</div>
            <div className="text-slate-600">{t.planned} still planned</div>
            <div className="text-xs text-slate-400">of {t.needed} the classes ask for</div>
          </div>
        </div>
        <div className={`${CARD} p-4`}>
          <div className="mb-2 text-xs font-semibold text-slate-500">Visits by day</div>
          <div className="flex h-24 items-end gap-0.5">
            {data.days.map((one) => {
              const total = one.planned + one.done;
              return (
                <div
                  key={one.day}
                  className="flex h-full min-w-0 flex-1 flex-col justify-end"
                  title={`${dayWords(one.day)}${one.leave ? " · on leave" : !one.work ? " · not a working day" : ""}: ${one.done} done, ${one.planned} planned`}
                >
                  {total > 0 ? (
                    <div
                      className="flex flex-col overflow-hidden rounded-sm"
                      style={{ height: `${(total / busiest) * 100}%` }}
                    >
                      <div className="bg-sky-300" style={{ flex: one.planned }} />
                      <div className="bg-emerald-500" style={{ flex: one.done }} />
                    </div>
                  ) : (
                    <div
                      className={`h-1 rounded-sm ${one.leave ? "bg-violet-300" : one.work ? "bg-slate-200" : "bg-transparent"}`}
                    />
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-500">
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-sm bg-emerald-500" /> Done
            </span>
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-sm bg-sky-300" /> Planned
            </span>
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-sm bg-violet-300" /> Leave
            </span>
          </div>
        </div>
      </div>

      <section className={`${CARD} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                <th className="px-4 py-2">Customer</th>
                <th className="px-3 py-2">Class</th>
                <th className="px-3 py-2 text-right">A month</th>
                <th className="px-3 py-2 text-right">Planned</th>
                <th className="px-3 py-2 text-right">Done</th>
                <th className="px-3 py-2">Last visit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.customers.map((one) => {
                const short = one.needed - one.done - one.planned;
                return (
                  <tr key={one.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-2.5">
                      <Link
                        to={`/customers/${one.id}`}
                        className="font-semibold text-slate-900 hover:text-emerald-700"
                      >
                        {one.name}
                      </Link>
                      <div className="text-xs text-slate-500">
                        {[KIND_WORDS[one.kind] ?? one.kind, one.specialty, one.city]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      {data.can.setClass ? (
                        <ClassPicker customerId={one.id} value={one.visitClass} />
                      ) : (
                        <span className="font-semibold text-slate-700">
                          {one.visitClass ?? "—"}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{one.needed}</td>
                    <td
                      className={`px-3 py-2.5 text-right tabular-nums ${short > 0 ? "font-semibold text-amber-700" : ""}`}
                    >
                      {one.planned}
                      {short > 0 && <span className="ml-1 text-[11px]">({short} short)</span>}
                    </td>
                    <td
                      className={`px-3 py-2.5 text-right tabular-nums ${one.done >= one.needed ? "text-emerald-700" : ""}`}
                    >
                      {one.done}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-600">
                      {one.lastVisit ? dayWords(one.lastVisit) : "Never"}
                    </td>
                  </tr>
                );
              })}
              {data.customers.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <EmptyState title="No doctors, hospitals or drugstores in this area yet.">
                      Each customer looked after here shows with the visits its class asks for.
                    </EmptyState>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      {sendingBack && (
        <SendBackDialog
          personId={data.person.id}
          month={data.month}
          onClose={() => setSendingBack(false)}
        />
      )}
    </div>
  );
}

function ClassPicker({ customerId, value }: { customerId: number; value: VisitClass | null }) {
  const queries = useQueryClient();
  const action = useAction();
  return (
    <select
      value={value ?? ""}
      disabled={action.busy}
      aria-label="Visit class"
      title={action.problem?.message}
      onChange={(event) =>
        action.run(async () => {
          await api(`/api/field/customers/${customerId}/class`, {
            body: { visitClass: event.target.value || null },
          });
          await queries.invalidateQueries({ queryKey: ["field"] });
        })
      }
      className="h-8 rounded-lg border border-slate-300 bg-white px-1.5 text-sm"
    >
      <option value="">—</option>
      {(["A", "B", "C", "D"] as VisitClass[]).map((key) => (
        <option key={key} value={key}>
          {key}
        </option>
      ))}
    </select>
  );
}

function SendBackDialog({
  personId,
  month,
  onClose,
}: {
  personId: number;
  month: string;
  onClose: () => void;
}) {
  const queries = useQueryClient();
  const action = useAction();
  const [note, setNote] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const done = await action.run(() =>
      api(`/api/field/plan/${personId}/decide`, { body: { month, approve: false, note } }),
    );
    if (done) {
      await queries.invalidateQueries({ queryKey: ["field"] });
      onClose();
    }
  }
  return (
    <Dialog title="Send the plan back" onClose={onClose} busy={action.busy}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-slate-600">What to change *</span>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className={`${FIELD} min-h-20`}
          />
          {action.at("note") && (
            <span className="text-xs font-medium text-rose-700">{action.at("note")}</span>
          )}
        </label>
        <Problem message={action.general(["note"])} />
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button onClick={onClose} disabled={action.busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={action.busy}>
            {action.busy ? "Sending…" : "Send back"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
