// Complaints and side-effects (docs/ERP-PLAN.md 7.3): anyone reports what a customer told them;
// Regulatory (with Management, the CEO, the Admin) handles each to its due day (a serious
// side-effect: 15 days, the FDA's window) and closes it with the outcome. The batch opens its trace.

import type { Catalogue, ComplaintKind, ComplaintList } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { Dialog, PageState, useAction } from "../ui";
import { EmptyState } from "../no-results";

const BTN = "h-8 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40";
const PRIMARY = "h-9 rounded-lg bg-brand px-3 text-sm font-semibold text-white disabled:opacity-40";
const INPUT = "h-9 w-full rounded-lg border border-slate-200 px-2 text-sm";
const KINDS: { key: ComplaintKind; label: string }[] = [
  { key: "quality", label: "Product quality" },
  { key: "side_effect", label: "Side-effect" },
  { key: "delivery", label: "Wrong or damaged delivery" },
  { key: "service", label: "Service" },
  { key: "other", label: "Other" },
];

function useRun() {
  const queries = useQueryClient();
  const action = useAction();
  return {
    ...action,
    async go(path: string, body: unknown) {
      let answer: unknown = null;
      const done = await action.run(async () => {
        answer = await api(path, { body });
      });
      await queries.invalidateQueries({ queryKey: ["complaints"] });
      await queries.invalidateQueries({ queryKey: ["decisions"] });
      return done ? answer : null;
    },
  };
}

function ReportDialog({ onClose, customerId }: { onClose: () => void; customerId: number | null }) {
  const run = useRun();
  const catalogue = useQuery({ queryKey: ["inventory", "medicines"], queryFn: () => api<Catalogue>("/api/inventory/medicines") });
  const [kind, setKind] = useState<ComplaintKind>("quality");
  const [serious, setSerious] = useState(false);
  const [medicineId, setMedicineId] = useState("");
  const [batchNo, setBatchNo] = useState("");
  const [patientName, setPatientName] = useState("");
  const [receivedOn, setReceivedOn] = useState(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date()));
  const [description, setDescription] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const done = await run.go("/api/complaints", {
      kind,
      serious: kind === "side_effect" && serious,
      customerId,
      medicineId: medicineId ? Number(medicineId) : null,
      batchNo,
      patientName,
      receivedOn,
      description,
    });
    if (done) onClose();
  }
  return (
    <Dialog title="Report a complaint or side-effect" onClose={onClose} busy={run.busy}>
      <form onSubmit={submit} className="flex flex-col gap-3 text-sm">
        <label>
          About
          <select className={INPUT} value={kind} onChange={(event) => setKind(event.target.value as ComplaintKind)}>
            {KINDS.map((one) => (
              <option key={one.key} value={one.key}>
                {one.label}
              </option>
            ))}
          </select>
        </label>
        {kind === "side_effect" && (
          <label className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-rose-900">
            <input type="checkbox" checked={serious} onChange={(event) => setSerious(event.target.checked)} />
            Serious: hospitalised, life-threatening, disabling or died (due in 15 days)
          </label>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <label>
            Medicine
            <select className={INPUT} value={medicineId} onChange={(event) => setMedicineId(event.target.value)}>
              <option value="">{kind === "side_effect" ? "Pick the medicine…" : "None"}</option>
              {(catalogue.data?.rows ?? []).map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name} {row.strength ?? ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Batch number
            <input className={INPUT} value={batchNo} onChange={(event) => setBatchNo(event.target.value)} />
          </label>
          <label>
            Patient (if any)
            <input className={INPUT} value={patientName} onChange={(event) => setPatientName(event.target.value)} />
          </label>
          <label>
            We heard of it on
            <input type="date" className={INPUT} value={receivedOn} onChange={(event) => setReceivedOn(event.target.value)} />
          </label>
        </div>
        <label>
          What happened
          <textarea className="min-h-24 w-full rounded-lg border border-slate-200 p-2" value={description} onChange={(event) => setDescription(event.target.value)} />
        </label>
        {run.problem && <p className="text-rose-700">{run.problem.message}</p>}
        <div className="flex justify-end">
          <button type="submit" className={PRIMARY} disabled={run.busy}>
            Report it
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function Handle({ row }: { row: ComplaintList["rows"][number] }) {
  const run = useRun();
  const [note, setNote] = useState("");
  const [fdaRef, setFdaRef] = useState(row.fdaRef ?? "");
  const [outcome, setOutcome] = useState("");
  const [dueOn, setDueOn] = useState(row.dueOn);
  return (
    <div className="mt-2 grid gap-2 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-2">
      <input className={INPUT} placeholder="A note: what was done" value={note} onChange={(event) => setNote(event.target.value)} />
      <input className={INPUT} placeholder="FDA reference, once reported" value={fdaRef} onChange={(event) => setFdaRef(event.target.value)} />
      <label className="flex items-center gap-2 text-xs text-slate-600">
        Due
        <input type="date" className={INPUT} value={dueOn} onChange={(event) => setDueOn(event.target.value)} />
      </label>
      <div className="flex flex-wrap gap-2">
        {row.status === "open" && (
          <button type="button" className={BTN} disabled={run.busy} onClick={() => run.go(`/api/complaints/${row.id}`, { status: "investigating", note, fdaRef, dueOn: dueOn !== row.dueOn ? dueOn : null })}>
            Looking into it
          </button>
        )}
        <button
          type="button"
          className={BTN}
          disabled={run.busy || (!note.trim() && fdaRef === (row.fdaRef ?? "") && dueOn === row.dueOn)}
          onClick={() => run.go(`/api/complaints/${row.id}`, { note, fdaRef: fdaRef !== (row.fdaRef ?? "") ? fdaRef : null, dueOn: dueOn !== row.dueOn ? dueOn : null })}
        >
          Save
        </button>
      </div>
      <input className={`${INPUT} sm:col-span-2`} placeholder="How it ended (to close it)" value={outcome} onChange={(event) => setOutcome(event.target.value)} />
      <div className="sm:col-span-2">
        <button type="button" className={PRIMARY} disabled={run.busy || !outcome.trim()} onClick={() => run.go(`/api/complaints/${row.id}`, { status: "closed", outcome, note, fdaRef: fdaRef !== (row.fdaRef ?? "") ? fdaRef : null })}>
          Close with this outcome
        </button>
      </div>
      {run.problem && <p className="text-rose-700 sm:col-span-2">{run.problem.message}</p>}
    </div>
  );
}

export function ComplaintsPage() {
  const [params, setParams] = useSearchParams();
  const view = params.get("view") ?? "open";
  const opened = Number(params.get("open")) || null;
  const [reporting, setReporting] = useState(params.get("report") === "1");
  const query = useQuery({ queryKey: ["complaints", view], queryFn: () => api<ComplaintList>(`/api/complaints?view=${view}`) });
  if (!query.data) return <PageState query={query} what="the complaints" />;
  const data = query.data;
  return (
    <div className="mx-auto w-full max-w-5xl space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Complaints and side-effects</h1>
          <p className="mt-1 text-[13px] text-slate-500">
            {data.counts.open} open{data.counts.serious ? ` · ${data.counts.serious} serious side-effects` : ""}
            {data.counts.late ? ` · ${data.counts.late} past due` : ""}
            {data.can.handle ? "" : " · the ones you reported"}
          </p>
        </div>
        <button type="button" className={PRIMARY} onClick={() => setReporting(true)}>
          Report one
        </button>
      </header>
      <div className="flex gap-1">
        {(["open", "closed", "all"] as const).map((one) => (
          <button key={one} type="button" onClick={() => setParams({ view: one })} className={`rounded-lg px-3 py-1.5 text-sm font-semibold capitalize ${view === one ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-100"}`}>
            {one}
          </button>
        ))}
      </div>
      <div className="space-y-2">
        {data.rows.map((row) => (
          <details key={row.id} open={row.id === opened} className={`rounded-xl border bg-white p-4 ${row.serious && row.status !== "closed" ? "border-rose-300" : "border-slate-200"}`}>
            <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-1">
              <b>{row.code}</b>
              <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${row.serious ? "bg-rose-100 text-rose-800" : "bg-slate-100 text-slate-700"}`}>
                {row.serious ? "Serious side-effect" : row.kindLabel}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{row.description}</span>
              <span className={`text-xs ${row.late ? "font-semibold text-rose-700" : "text-slate-500"}`}>
                {row.status === "closed" ? "Closed" : `${row.status === "investigating" ? "Looking into it" : "Open"} · due ${row.dueOn}`}
              </span>
            </summary>
            <div className="mt-3 grid gap-1 text-sm text-slate-700 sm:grid-cols-2">
              <div>Reported by {row.reportedBy} · heard on {row.receivedOn}</div>
              {row.medicine && (
                <div>
                  {row.medicine}
                  {row.batchNo && (
                    <>
                      {" · batch "}
                      <Link to={`/inventory/trace?batch=${encodeURIComponent(row.batchNo)}`} className="font-semibold text-brand hover:underline">
                        {row.batchNo}
                      </Link>
                    </>
                  )}
                </div>
              )}
              {row.customer && (
                <div>
                  Customer{" "}
                  <Link to={`/customers/${row.customerId}`} className="text-brand hover:underline">
                    {row.customer}
                  </Link>
                </div>
              )}
              {row.patientName && <div>Patient: {row.patientName}</div>}
              {row.fdaRef && <div>FDA reference: {row.fdaRef}</div>}
              {row.outcome && <div className="sm:col-span-2">Outcome: {row.outcome}</div>}
            </div>
            <ul className="mt-2 space-y-0.5 text-xs text-slate-500">
              {row.events.map((event) => (
                <li key={event.at}>
                  {event.at.slice(0, 16)} · {event.message}
                </li>
              ))}
            </ul>
            {data.can.handle && row.status !== "closed" && <Handle row={row} />}
          </details>
        ))}
        {!data.rows.length && (
          <EmptyState title="None here.">Complaints and side-effects customers reported show here. Try another view.</EmptyState>
        )}
      </div>
      {reporting && <ReportDialog customerId={Number(params.get("customer")) || null} onClose={() => setReporting(false)} />}
    </div>
  );
}
