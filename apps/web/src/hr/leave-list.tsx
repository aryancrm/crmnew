// Leave as a list: what waits for this person's decision (a team lead's team, everything for HR),
// and every request by where it stands. HR and team leads approve or refuse with a word; HR also
// cancels and revokes; the CEO reads. A month narrows it. Forms (OB, WFH, overtime, the daily
// report, incidents) and requests to put an attendance day right are decided here too, so a lead
// and HR decide in one place: "All waiting" puts the three together, each switch with its count.

import type { FixList, FormList, HrQueue, LeaveLine, LeaveList } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronLeft, ChevronRight, Undo2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useMe } from "../auth";
import { manilaToday } from "../team/range";
import { Button, CARD, PageHead, PageState, Problem, Tabs, useAction } from "../ui";
import { LEAVE_WORDS } from "./attendance-report";
import { FixLineRow } from "./corrections";
import { daysWords, FormLineRow, LEAVE_STATUS, LeavePapers, PrintLink, spanWords } from "./my-leave";

type View = "waiting" | "asked" | "approved" | "refused" | "cancelled" | "returned" | "revoked";
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
  const me = useMe().data;
  const of = params.get("of");
  const all = of === "all";
  const view = all ? "waiting" : ((params.get("view") as View | null) ?? "waiting");
  const month = params.get("month");
  const forms = of === "forms";
  const fixes = of === "fixes";
  const search = new URLSearchParams({ view, ...(month ? { month } : {}) });
  const queue = useQuery({
    queryKey: ["leave", "queue"],
    queryFn: () => api<HrQueue>("/api/hr/queue"),
    staleTime: 30_000,
  });
  const fixesQuery = useQuery({
    queryKey: ["leave", "fixes", view, month],
    queryFn: () => api<FixList>(`/api/hr/fixes/list?${search}`),
    placeholderData: (previous) => previous,
    enabled: fixes || all,
  });
  const formsQuery = useQuery({
    queryKey: ["leave", "forms", view, month],
    queryFn: () => api<FormList>(`/api/hr/forms/list?${search}`),
    placeholderData: (previous) => previous,
    enabled: forms || all,
  });
  const query = useQuery({
    queryKey: ["leave", "list", view, month],
    queryFn: () => api<LeaveList>(`/api/hr/leave/list?${search}`),
    placeholderData: (previous) => previous,
  });
  const data = query.data;
  if (!data) return <PageState query={query} what="the leave" />;
  const counts: Partial<Record<View, number>> & { waiting: number } = forms
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
  const tab = (key: View, label: string) =>
    counts[key] !== undefined ? [{ key, label, count: counts[key] as number }] : [];
  const tabs: { key: View; label: string; count: number }[] = [
    ...(counts.waiting || view === "waiting"
      ? [{ key: "waiting" as View, label: "Waiting for you", count: counts.waiting }]
      : []),
    ...tab("asked", "Asked"),
    ...tab("approved", "Approved"),
    ...(forms ? tab("returned", "Returned to fix") : []),
    ...tab("refused", "Not approved"),
    ...tab("cancelled", "Cancelled"),
    ...(fixes ? [] : tab("revoked", "Revoked")),
  ];
  const q = queue.data;
  const switches = [
    ...(q && q.total > 0 ? [{ key: "all", label: "All waiting", count: q.total }] : []),
    { key: null, label: "Leave", count: q?.leave ?? 0 },
    { key: "forms", label: "Forms", count: q?.forms ?? 0 },
    { key: "fixes", label: "Attendance", count: q?.fixes ?? 0 },
  ];
  const empty = (
    <li className="px-4 py-8 text-center text-sm text-slate-500">
      {view === "waiting" ? "Nothing waiting for you." : "Nothing here."}
    </li>
  );
  const section = (title: string, lines: ReactNode[]) => (
    <section className={`${CARD} overflow-hidden`}>
      <h2 className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-900">
        {title} <span className="text-slate-500">· {lines.length}</span>
      </h2>
      <ul className="divide-y divide-slate-100">{lines.length ? lines : empty}</ul>
    </section>
  );

  return (
    <div className={`flex flex-col gap-4 ${query.isPlaceholderData ? "opacity-60" : ""}`}>
      <PageHead
        title={all ? "Waiting for you" : forms ? "Forms" : fixes ? "Attendance days to put right" : "Leave"}
        sub={
          all && q?.atHr
            ? `${q.atHr.total} came to HR itself; the rest wait for a lead first (HR may decide them too).`
            : undefined
        }
        tags={
          <span className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs font-semibold">
            {switches.map((one) => (
              <button
                key={one.label}
                type="button"
                onClick={() => set("of", one.key)}
                className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 ${one.key === of || (one.key === null && !forms && !fixes && !all) ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-100"}`}
              >
                {one.label}
                {one.count > 0 && (
                  <span className="rounded-full bg-amber-100 px-1.5 text-[10px] font-bold text-amber-800 tabular-nums">
                    {one.count}
                  </span>
                )}
              </button>
            ))}
          </span>
        }
        actions={
          <div className="flex items-center gap-1">
            {me && ["hr", "ceo", "admin"].includes(me.role) && (
              <Link
                to="/hr/leave/conversion"
                className="mr-2 text-xs font-semibold text-emerald-700 hover:underline"
              >
                Year-end VL
              </Link>
            )}
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
        {!all && <Tabs<View> value={view} onChange={(next) => set("view", next)} tabs={tabs} />}
      </PageHead>
      {all ? (
        <>
          {section(
            "Leave",
            data.lines.map((line) => <Line key={line.id} line={line} />),
          )}
          {section(
            "Forms",
            (formsQuery.data?.lines ?? []).map((line) => <FormLineRow key={line.id} line={line} showPerson />),
          )}
          {section(
            "Attendance days to put right",
            (fixesQuery.data?.lines ?? []).map((line) => <FixLineRow key={line.id} line={line} showPerson />),
          )}
        </>
      ) : (
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
                : data.lines.length) === 0 && empty}
          </ul>
        </section>
      )}
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
  const post = (path: string, body: unknown) =>
    action.run(async () => {
      await api(`/api/hr/leave/${line.id}/${path}`, { body });
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
            line.status === "asked"
              ? `with ${line.approver ?? "HR"}${line.secondApprover ? ` or ${line.secondApprover}` : ""}`
              : null,
            line.decidedBy && line.status !== "asked" ? `by ${line.decidedBy}` : null,
            line.revokedBy ? `revoked by ${line.revokedBy}${line.revokeReason ? `: ${line.revokeReason}` : ""}` : null,
            line.madeBy !== line.person.name ? `recorded by ${line.madeBy}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
        {line.decisionNote && <div className="mt-1 text-xs text-rose-700">{line.decisionNote}</div>}
        <LeavePapers line={line} />
        <Problem message={action.problem?.message} />
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {line.canDecide &&
          (refusing ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void post("decide", { approve: false, note: note || null });
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
              <Button
                small
                variant="primary"
                disabled={action.busy}
                onClick={() => post("decide", { approve: true, note: null })}
              >
                <Check size={14} /> Approve
              </Button>
              <Button small onClick={() => setRefusing(true)}>
                <Undo2 size={14} /> Not approved
              </Button>
            </>
          ))}
        {line.canPrint && <PrintLink to={`/hr/print/leave/${line.id}`} />}
        {line.canRevoke ? (
          <Button
            small
            variant="quiet"
            disabled={action.busy}
            onClick={() => {
              const reason = window.prompt("Why is it revoked? (optional)") ?? null;
              void post("revoke", { reason });
            }}
          >
            Revoke
          </Button>
        ) : (
          line.canCancel &&
          !line.canDecide && (
            <Button small variant="quiet" disabled={action.busy} onClick={() => post("cancel", {})}>
              Cancel it
            </Button>
          )
        )}
      </div>
    </li>
  );
}
