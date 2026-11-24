// Leave as a list: what waits for this person's decision (a team lead's team, everything for HR),
// and every request by where it stands. HR and team leads approve or refuse with a word; HR also
// cancels; the CEO reads. A month narrows it. Forms (OB, WFH, overtime) and requests to put an
// attendance day right are decided here too, so a lead and HR decide in one place.

import type { FixList, FormList, LeaveLine, LeaveList } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronLeft, ChevronRight, FileText, Undo2 } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { manilaToday } from "../team/range";
import { Button, CARD, PageHead, PageState, Problem, Tabs, useAction } from "../ui";
import { LEAVE_WORDS } from "./attendance-report";
import { FixLineRow } from "./corrections";
import { daysWords, FormLineRow, LEAVE_STATUS, spanWords } from "./my-leave";

type View = "waiting" | "asked" | "approved" | "refused" | "cancelled";
const shiftMonth = (month: string, by: number) => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
};
const monthName = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-PH", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

export function LeaveListPage() {
  const [params, setParams] = useSearchParams();
  const view = (params.get("view") as View | null) ?? "waiting";
  const month = params.get("month");
  const of = params.get("of");
  const forms = of === "forms";
  const fixes = of === "fixes";
  const fixesQuery = useQuery({
    queryKey: ["leave", "fixes", view, month],
    queryFn: () =>
      api<FixList>(
        `/api/hr/fixes/list?${new URLSearchParams({ view, ...(month ? { month } : {}) })}`,
      ),
    placeholderData: (previous) => previous,
    enabled: fixes,
  });
  const formsQuery = useQuery({
    queryKey: ["leave", "forms", view, month],
    queryFn: () =>
      api<FormList>(
        `/api/hr/forms/list?${new URLSearchParams({ view, ...(month ? { month } : {}) })}`,
      ),
    placeholderData: (previous) => previous,
    enabled: forms,
  });
  const query = useQuery({
    queryKey: ["leave", "list", view, month],
    queryFn: () =>
      api<LeaveList>(
        `/api/hr/leave/list?${new URLSearchParams({ view, ...(month ? { month } : {}) })}`,
      ),
    placeholderData: (previous) => previous,
  });
  const data = query.data;
  if (!data) return <PageState query={query} what="the leave" />;
  const counts = forms
    ? (formsQuery.data?.counts ?? data.counts)
    : fixes
      ? (fixesQuery.data?.counts ?? data.counts)
      : data.counts;
  const set = (key: string, value: string | null) => {
    const out = new URLSearchParams(params);
    if (value === null) out.delete(key);
    else out.set(key, value);
    setParams(out, { replace: true });
  };
  const shownMonth = month ?? manilaToday().slice(0, 7);
  const tabs: { key: View; label: string; count: number }[] = [
    ...(counts.waiting || view === "waiting"
      ? [{ key: "waiting" as View, label: "Waiting for you", count: counts.waiting }]
      : []),
    { key: "asked", label: "Asked", count: counts.asked },
    { key: "approved", label: "Approved", count: counts.approved },
    { key: "refused", label: "Not approved", count: counts.refused },
    { key: "cancelled", label: "Cancelled", count: counts.cancelled },
  ];

  return (
    <div className={`flex flex-col gap-4 ${query.isPlaceholderData ? "opacity-60" : ""}`}>
      <PageHead
        title={forms ? "Forms" : fixes ? "Attendance days to put right" : "Leave"}
        tags={
          <span className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs font-semibold">
            {[
              { key: null, label: "Leave" },
              { key: "forms", label: "Forms" },
              { key: "fixes", label: "Attendance" },
            ].map((one) => (
              <button
                key={one.label}
                type="button"
                onClick={() => set("of", one.key)}
                className={`rounded-md px-2.5 py-1 ${one.key === of || (one.key === null && !forms && !fixes) ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-100"}`}
              >
                {one.label}
              </button>
            ))}
          </span>
        }
        actions={
          <div className="flex items-center gap-1">
            {month && (
              <Button small variant="quiet" onClick={() => set("month", null)}>
                Every month
              </Button>
            )}
            <Button
              small
              variant="quiet"
              aria-label="The month before"
              onClick={() => set("month", shiftMonth(shownMonth, -1))}
            >
              <ChevronLeft size={16} />
            </Button>
            <span className="min-w-28 text-center text-sm font-semibold text-slate-800">
              {month ? monthName(month) : "Every month"}
            </span>
            <Button
              small
              variant="quiet"
              aria-label="The month after"
              onClick={() => set("month", shiftMonth(shownMonth, 1))}
            >
              <ChevronRight size={16} />
            </Button>
          </div>
        }
      >
        <Tabs<View> value={view} onChange={(next) => set("view", next)} tabs={tabs} />
      </PageHead>
      <section className={`${CARD} overflow-hidden`}>
        <ul className="divide-y divide-slate-100">
          {forms
            ? (formsQuery.data?.lines ?? []).map((line) => (
                <FormLineRow key={line.id} line={line} showPerson />
              ))
            : fixes
              ? (fixesQuery.data?.lines ?? []).map((line) => (
                  <FixLineRow key={line.id} line={line} showPerson />
                ))
              : data.lines.map((line) => <Line key={line.id} line={line} />)}
          {(forms
            ? (formsQuery.data?.lines.length ?? 0)
            : fixes
              ? (fixesQuery.data?.lines.length ?? 0)
              : data.lines.length) === 0 && (
            <li className="px-4 py-8 text-center text-sm text-slate-500">
              {view === "waiting" ? "Nothing waiting for you." : "Nothing here."}
            </li>
          )}
        </ul>
      </section>
    </div>
  );
}

function Line({ line }: { line: LeaveLine }) {
  const queries = useQueryClient();
  const action = useAction();
  const [refusing, setRefusing] = useState(false);
  const [note, setNote] = useState("");
  const status = LEAVE_STATUS[line.status];
  const done = () => queries.invalidateQueries({ queryKey: ["leave"] });
  const decide = (approve: boolean) =>
    action.run(async () => {
      await api(`/api/hr/leave/${line.id}/decide`, { body: { approve, note: note || null } });
      await done();
    });
  return (
    <li className="flex flex-col gap-2 px-4 py-3 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to={`/hr/attendance/${line.person.id}?month=${line.from.slice(0, 7)}`}
            className="font-semibold text-slate-900 hover:text-emerald-700"
          >
            {line.person.name}
          </Link>
          <span className="text-slate-700">{LEAVE_WORDS[line.kind]} leave</span>
          <span className="text-slate-700">{spanWords(line.from, line.to)}</span>
          <span className="text-xs text-slate-500">{daysWords(line)}</span>
          <span
            className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ${status.tone}`}
          >
            {status.word}
          </span>
        </div>
        <div className="text-xs text-slate-500">
          {[
            line.person.team,
            line.reason,
            line.status === "asked" ? `with ${line.approver ?? "HR"}` : null,
            line.decidedBy && line.status !== "asked" ? `by ${line.decidedBy}` : null,
            line.madeBy !== line.person.name ? `recorded by ${line.madeBy}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
        {line.decisionNote && <div className="mt-1 text-xs text-rose-700">{line.decisionNote}</div>}
        {line.file && (
          <a
            href={`/api/hr/leave/${line.id}/file`}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:underline"
          >
            <FileText size={12} /> {line.file.name}
          </a>
        )}
        <Problem message={action.problem?.message} />
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {line.canDecide &&
          (refusing ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void decide(false);
              }}
              className="flex items-center gap-2"
            >
              <input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Why not"
                className="h-8 w-48 rounded-lg border border-slate-300 px-2 text-sm"
              />
              <Button small type="submit" disabled={action.busy}>
                Not approved
              </Button>
            </form>
          ) : (
            <>
              <Button small variant="primary" disabled={action.busy} onClick={() => decide(true)}>
                <Check size={14} /> Approve
              </Button>
              <Button small onClick={() => setRefusing(true)}>
                <Undo2 size={14} /> Not approved
              </Button>
            </>
          ))}
        {line.canCancel && !line.canDecide && (
          <Button
            small
            variant="quiet"
            disabled={action.busy}
            onClick={() =>
              action.run(async () => {
                await api(`/api/hr/leave/${line.id}/cancel`, { body: {} });
                await done();
              })
            }
          >
            Cancel it
          </Button>
        )}
      </div>
    </li>
  );
}
