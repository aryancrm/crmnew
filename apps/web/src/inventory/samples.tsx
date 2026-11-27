// Samples and gifts with the reps (docs/ERP-PLAN.md phase 3), the old CRM's screens:
// - My samples & gifts (a rep): what I hold by medicine and batch (amber: expiring within 90 days,
//   red: expired), what is on the way (Mark received), my requests (Ask for, Withdraw), the month
//   (given, received) and the month's count.
// - Team samples & gifts (leads, the stock desk, the CEO): requests to approve or issue, each rep's
//   holdings and month, the counts' differences with their reasons, and what each doctor got.
// Samples and gifts are given at a visit (with the doctor's signed acknowledgement), never sold.

import type { Catalogue, SampleKind, SamplesOfPerson, TeamSamples } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useHqNames } from "../team/hq-name";
import { Dialog, PageState, useAction, useOpenOnPress } from "../ui";
import { EmptyState } from "../no-results";

const CARD = "rounded-xl border border-slate-200 bg-white";
const BTN = "h-8 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40";
const PRIMARY = "h-8 rounded-lg bg-brand px-3 text-xs font-semibold text-white disabled:opacity-40";
const STATUS: Record<string, string> = {
  submitted: "Waiting for your lead",
  approved: "Approved, to be sent",
  rejected: "Not approved",
  withdrawn: "Withdrawn",
  issued: "On the way to you",
  received: "Received",
};
const thisMonth = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date()).slice(0, 7);

function useRun() {
  const queries = useQueryClient();
  const action = useAction();
  return {
    ...action,
    async go(path: string, body: unknown = {}) {
      const done = await action.run(async () => {
        await api(path, { body });
      });
      await queries.invalidateQueries({ queryKey: ["samples"] });
      return done;
    },
  };
}

function AskDialog({ onClose, kind }: { onClose: () => void; kind: SampleKind }) {
  const run = useRun();
  const catalogue = useQuery({ queryKey: ["inventory", "medicines"], queryFn: () => api<Catalogue>("/api/inventory/medicines") });
  const [lines, setLines] = useState<{ medicineId: string; qty: string }[]>([{ medicineId: "", qty: "" }]);
  const [note, setNote] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const sent = lines.filter((one) => one.medicineId).map((one) => ({ medicineId: Number(one.medicineId), qty: Number(one.qty) }));
    if (await run.go("/api/samples/requests", { kind, lines: sent, note })) onClose();
  }
  return (
    <Dialog title={`Ask for ${kind}`} onClose={onClose} busy={run.busy}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        {lines.map((line, n) => (
          <div key={`line-${n}`} className="flex gap-2">
            <select
              className="h-9 flex-1 rounded-lg border border-slate-200 px-2 text-sm"
              value={line.medicineId}
              onChange={(event) => setLines(lines.map((one, at) => (at === n ? { ...one, medicineId: event.target.value } : one)))}
            >
              <option value="">Pick a medicine…</option>
              {(catalogue.data?.rows ?? []).map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name} {row.strength ?? ""}
                </option>
              ))}
            </select>
            <input
              inputMode="numeric"
              placeholder="Pieces"
              className="h-9 w-24 rounded-lg border border-slate-200 px-2 text-sm"
              value={line.qty}
              onChange={(event) => setLines(lines.map((one, at) => (at === n ? { ...one, qty: event.target.value } : one)))}
            />
          </div>
        ))}
        {lines.length < 20 && (
          <button type="button" className="self-start text-xs font-semibold text-brand" onClick={() => setLines([...lines, { medicineId: "", qty: "" }])}>
            + Another medicine
          </button>
        )}
        <textarea className="rounded-lg border border-slate-200 p-2 text-sm" placeholder="Why (the doctors, the launch…)" value={note} onChange={(event) => setNote(event.target.value)} />
        {run.problem && <p className="text-sm text-rose-700">{run.problem.message}</p>}
        <div className="flex justify-end">
          <button type="submit" className={PRIMARY} disabled={run.busy}>
            Ask
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function CountDialog({ data, kind, onClose }: { data: SamplesOfPerson; kind: SampleKind; onClose: () => void }) {
  const run = useRun();
  const held = data.held.filter((one) => one.kind === kind);
  const [counted, setCounted] = useState<Record<number, string>>(Object.fromEntries(held.map((one) => [one.batchId, String(one.qty)])));
  const [reasons, setReasons] = useState<Record<number, string>>({});
  async function submit(event: FormEvent) {
    event.preventDefault();
    const lines = held.map((one) => ({ batchId: one.batchId, counted: Number(counted[one.batchId] ?? 0), reason: reasons[one.batchId] ?? null }));
    if (await run.go("/api/samples/count", { kind, lines })) onClose();
  }
  return (
    <Dialog title={`Count your ${kind}`} onClose={onClose} busy={run.busy}>
      <form onSubmit={submit} className="flex flex-col gap-2">
        <p className="text-xs text-slate-500">Type what you really have. Where it differs from the system, say why.</p>
        {held.map((one) => {
          const differs = Number(counted[one.batchId] ?? one.qty) !== one.qty;
          return (
            <div key={one.batchId} className="rounded-lg border border-slate-100 p-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate font-medium">
                  {one.medicine} <span className="text-xs text-slate-500">batch {one.batchNo}</span>
                </span>
                <span className="text-xs text-slate-500">In the system {one.qty}</span>
                <input
                  inputMode="numeric"
                  className="h-8 w-20 rounded border border-slate-200 px-2"
                  value={counted[one.batchId] ?? ""}
                  onChange={(event) => setCounted({ ...counted, [one.batchId]: event.target.value })}
                  aria-label={`Counted ${one.medicine}`}
                />
              </div>
              {differs && (
                <input
                  className="mt-1 h-8 w-full rounded border border-amber-300 px-2 text-xs"
                  placeholder="Why it differs"
                  value={reasons[one.batchId] ?? ""}
                  onChange={(event) => setReasons({ ...reasons, [one.batchId]: event.target.value })}
                />
              )}
            </div>
          );
        })}
        {run.problem && <p className="text-sm text-rose-700">{run.problem.message}</p>}
        <div className="flex justify-end">
          <button type="submit" className={PRIMARY} disabled={run.busy || !held.length}>
            Save the count
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** "2026-11" as "November 2026". */
const monthWords = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleString("en-PH", { month: "long", year: "numeric", timeZone: "UTC" });

export function MySamplesPage() {
  const [params, setParams] = useSearchParams();
  const kind = (params.get("show") === "gifts" ? "gifts" : "samples") as SampleKind;
  const person = params.get("rep");
  const query = useQuery({
    queryKey: ["samples", "person", person ?? "me"],
    queryFn: () => api<SamplesOfPerson>(`/api/samples${person ? `?person=${person}` : ""}`),
  });
  const run = useRun();
  const [asking, setAsking] = useState(false);
  const [counting, setCounting] = useState(false);
  if (!query.data) return <PageState query={query} what="your samples" />;
  const data = query.data;
  const held = data.held.filter((one) => one.kind === kind);
  const byMedicine = new Map<string, typeof held>();
  for (const one of held) byMedicine.set(one.medicine, [...(byMedicine.get(one.medicine) ?? []), one]);
  const coming = data.requests.filter((one) => one.kind === kind && one.status === "issued");
  const requests = data.requests.filter((one) => one.kind === kind);
  const counted = kind === "samples" ? data.month_.countedSamples : data.month_.countedGifts;
  return (
    <div className="mx-auto w-full max-w-4xl space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{data.own ? "My samples & gifts" : `${data.person}'s samples & gifts`}</h1>
          <p className="mt-1 text-[13px] text-slate-500">
            {held.reduce((sum, one) => sum + one.qty, 0).toLocaleString("en-PH")} pieces of {byMedicine.size} medicines · given this month{" "}
            {(kind === "samples" ? data.month_.givenSamples : data.month_.givenGifts).toLocaleString("en-PH")} to {data.month_.doctors} doctors · received{" "}
            {(kind === "samples" ? data.month_.receivedSamples : data.month_.receivedGifts).toLocaleString("en-PH")}
          </p>
        </div>
        <div className="flex overflow-hidden rounded-lg border border-slate-200 bg-white">
          {(["samples", "gifts"] as const).map((one) => (
            <button key={one} type="button" onClick={() => setParams(one === "gifts" ? { show: "gifts", ...(person ? { rep: person } : {}) } : person ? { rep: person } : {})} className={`px-3 py-1.5 text-sm font-semibold capitalize ${kind === one ? "bg-brand text-white" : "text-slate-600"}`}>
              {one}
            </button>
          ))}
        </div>
      </header>
      {data.own && (
        <div className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-4 py-3 text-sm ${counted ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
          <span>{counted ? `Your ${kind} are counted for ${monthWords(data.month)}.` : `Count your ${kind} this month: what you really hold, and why it differs.`}</span>
          <div className="flex gap-2">
            <button type="button" className={BTN} onClick={() => setCounting(true)} disabled={!held.length}>
              Count now
            </button>
            {data.can.ask && (
              <button type="button" className={PRIMARY} onClick={() => setAsking(true)}>
                Ask for {kind}
              </button>
            )}
          </div>
        </div>
      )}
      {coming.length > 0 && (
        <section className={CARD}>
          <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">On the way to you</h2>
          {coming.map((one) => (
            <div key={one.id} className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2 text-sm last:border-b-0">
              <span>
                <b>{one.code}</b> · {one.lines.map((line) => `${line.medicine} ${line.qty}`).join(", ")}
              </span>
              {data.own && (
                <button type="button" className={PRIMARY} disabled={run.busy} onClick={() => run.go(`/api/samples/requests/${one.id}/receive`)}>
                  Mark received
                </button>
              )}
            </div>
          ))}
        </section>
      )}
      <section className={CARD}>
        <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold capitalize">{kind} you hold</h2>
        {[...byMedicine.entries()].map(([medicine, batches]) => (
          <div key={medicine} className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2 text-sm last:border-b-0">
            <span className="min-w-48 flex-1 font-medium">{medicine}</span>
            <span className="font-bold tabular-nums">{batches.reduce((sum, one) => sum + one.qty, 0)}</span>
            {batches.map((one) => (
              <span
                key={one.batchId}
                className={`rounded-full px-2 py-0.5 text-[11px] ${one.tone === "expired" ? "bg-rose-100 text-rose-800" : one.tone === "soon" ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-700"}`}
                title={one.tone === "expired" ? "Expired: can't be given" : one.tone === "soon" ? "Expires within 90 days" : ""}
              >
                {one.batchNo} · {one.qty} · exp {one.expires ?? "—"}
              </span>
            ))}
          </div>
        ))}
        {!held.length && <EmptyState title="Nothing held.">What is issued to you shows here, by medicine and batch.</EmptyState>}
      </section>
      <section className={CARD}>
        <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">Requests</h2>
        {requests.map((one) => (
          <div key={one.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2 text-sm last:border-b-0">
            <span>
              <b>{one.code}</b> · {one.lines.map((line) => `${line.medicine} ${line.qty}`).join(", ")}
              {one.rejectReason && <span className="text-rose-700"> · {one.rejectReason}</span>}
            </span>
            <span className="flex items-center gap-2 text-xs text-slate-600">
              {STATUS[one.status]}
              {data.own && ["submitted", "approved"].includes(one.status) && (
                <button type="button" className={BTN} disabled={run.busy} onClick={() => run.go(`/api/samples/requests/${one.id}/withdraw`)}>
                  Withdraw
                </button>
              )}
            </span>
          </div>
        ))}
        {!requests.length && <EmptyState title="No requests this month.">What you ask for shows here with where it stands.</EmptyState>}
      </section>
      {run.problem && <p className="text-sm text-rose-700">{run.problem.message}</p>}
      <p className="text-xs text-slate-500">Give samples and gifts from a doctor's visit (Today's visits), with the doctor's signed acknowledgement. They are never sold.</p>
      {asking && <AskDialog kind={kind} onClose={() => setAsking(false)} />}
      {counting && <CountDialog data={data} kind={kind} onClose={() => setCounting(false)} />}
    </div>
  );
}

export function TeamSamplesPage() {
  const [params, setParams] = useSearchParams();
  // A press anywhere on a row opens it, not only its name (Aryan, 28 Nov, PLAN 271).
  const open = useOpenOnPress();
  // Each rep after their HQ (Aryan's phase 5, PLAN 269): "TAFT · Marwin Dy".
  const { named } = useHqNames();
  const month = params.get("month") ?? thisMonth();
  const query = useQuery({ queryKey: ["samples", "team", month], queryFn: () => api<TeamSamples>(`/api/samples/team?month=${month}`) });
  const run = useRun();
  const [refusing, setRefusing] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  if (!query.data) return <PageState query={query} what="the team's samples" />;
  const data = query.data;
  const shift = (n: number) => {
    const [y, m] = month.split("-").map(Number) as [number, number];
    return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
  };
  return (
    <div className="mx-auto w-full max-w-screen-xl space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Samples & gifts</h1>
          <p className="mt-1 text-[13px] text-slate-500">
            Given {data.reps.reduce((sum, one) => sum + one.given, 0).toLocaleString("en-PH")} pieces to {data.doctors.length} doctors in {monthWords(month)} ·{" "}
            {data.reps.filter((one) => !one.counted).length} reps not counted
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <button type="button" className={BTN} onClick={() => setParams({ month: shift(-1) })}>
            ‹
          </button>
          <span className="font-semibold">{monthWords(month)}</span>
          <button type="button" className={BTN} onClick={() => setParams({ month: shift(1) })}>
            ›
          </button>
        </div>
      </header>
      <section className={CARD}>
        <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">Requests open ({data.requests.length})</h2>
        {data.requests.map((one) => (
          <div key={one.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2 text-sm last:border-b-0">
            <span>
              <b>{one.code}</b> · {named(one.personId, one.person)} · <span className="capitalize">{one.kind}</span>: {one.lines.map((line) => `${line.medicine} ${line.qty}`).join(", ")}
              {one.note && <span className="text-slate-500"> · {one.note}</span>}
            </span>
            <span className="flex items-center gap-2 text-xs">
              <span className="text-slate-600">{STATUS[one.status]?.replace("your lead", "the lead").replace("to you", "")}</span>
              {one.canDecide && (
                <>
                  <button type="button" className={PRIMARY} disabled={run.busy} onClick={() => run.go(`/api/samples/requests/${one.id}/decide`, { approve: true })}>
                    Approve
                  </button>
                  <button type="button" className={BTN} onClick={() => setRefusing(one.id)}>
                    Reject
                  </button>
                </>
              )}
              {one.canIssue && (
                <button type="button" className={PRIMARY} disabled={run.busy} onClick={() => run.go(`/api/samples/requests/${one.id}/issue`)}>
                  Issue it
                </button>
              )}
            </span>
          </div>
        ))}
        {!data.requests.length && <EmptyState title="No request open.">Requests from reps to approve or issue show here.</EmptyState>}
      </section>
      {run.problem && <p className="text-sm text-rose-700">{run.problem.message}</p>}
      <section className={CARD}>
        <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">Reps</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                <th className="px-3 py-2">Rep</th>
                <th className="px-3 py-2 text-right">Samples held</th>
                <th className="px-3 py-2 text-right">Gifts held</th>
                <th className="px-3 py-2 text-right">Received</th>
                <th className="px-3 py-2 text-right">Given</th>
                <th className="px-3 py-2 text-right">Doctors</th>
                <th className="px-3 py-2">Counted</th>
              </tr>
            </thead>
            <tbody>
              {data.reps.map((one) => (
                <tr key={one.personId} onClick={open(`/me/samples?rep=${one.personId}`)} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <Link to={`/me/samples?rep=${one.personId}`} className="font-semibold text-brand hover:underline">
                      {named(one.personId, one.name)}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{one.samples}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{one.gifts}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{one.received}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{one.given}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{one.doctors}</td>
                  <td className={`px-3 py-2 ${one.counted ? (one.difference ? "text-amber-800" : "text-emerald-700") : "text-rose-700"}`}>
                    {one.counted ? (one.difference ? `Yes, ${one.difference > 0 ? "+" : ""}${one.difference}` : "Yes") : "Not yet"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.reps.length && <EmptyState title="No rep holds or has asked for samples.">Each rep's holdings and month show here once they hold or ask for some.</EmptyState>}
        </div>
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className={CARD}>
          <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">Counts that differed</h2>
          {data.counts.map((one, n) => (
            <div key={`${one.at}-${n}`} className="flex justify-between gap-2 border-b border-slate-100 px-4 py-2 text-sm last:border-b-0">
              <span>
                {named(one.personId, one.person)} · {one.medicine} <span className="text-slate-500">({one.kind})</span>
              </span>
              <span>
                <b className={one.difference < 0 ? "text-rose-700" : "text-emerald-700"}>{one.difference > 0 ? `+${one.difference}` : one.difference}</b>{" "}
                <span className="text-slate-600">{one.reason}</span>
              </span>
            </div>
          ))}
          {!data.counts.length && <EmptyState title="No difference this month.">Counts that found more or fewer pieces show here with their reasons.</EmptyState>}
        </section>
        <section className={CARD}>
          <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">Given by doctor</h2>
          {data.doctors.map((one) => (
            <div
              key={`${one.customerId}-${one.personId}`}
              onClick={open(`/customers/${one.customerId}`)}
              className="flex cursor-pointer justify-between gap-2 border-b border-slate-100 px-4 py-2 text-sm last:border-b-0 hover:bg-slate-50"
            >
              <span>
                <Link to={`/customers/${one.customerId}`} className="font-semibold text-brand hover:underline">
                  {one.doctor}
                </Link>{" "}
                <span className="text-slate-500">· {named(one.personId, one.person)} · {one.medicines}</span>
              </span>
              <span className="tabular-nums">
                {one.pieces} pcs · {one.visits} visits
              </span>
            </div>
          ))}
          {!data.doctors.length && <EmptyState title="Nothing given this month.">What each doctor got at a visit this month shows here.</EmptyState>}
        </section>
      </div>
      {refusing !== null && (
        <Dialog title="Why not?" onClose={() => setRefusing(null)} busy={run.busy}>
          <form
            className="flex flex-col gap-3"
            onSubmit={async (event) => {
              event.preventDefault();
              if (await run.go(`/api/samples/requests/${refusing}/decide`, { approve: false, reason })) setRefusing(null);
            }}
          >
            <textarea className="rounded-lg border border-slate-200 p-2 text-sm" value={reason} onChange={(event) => setReason(event.target.value)} />
            <div className="flex justify-end">
              <button type="submit" className={PRIMARY}>
                Reject
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}

/** Samples or gifts given to the doctor at this visit, with the doctor's signed acknowledgement. */
export function GiveSamplesDialog({ visitId, doctor, onClose }: { visitId: number; doctor: string; onClose: () => void }) {
  const run = useRun();
  const [kind, setKind] = useState<SampleKind>("samples");
  const mine = useQuery({ queryKey: ["samples", "person", "me"], queryFn: () => api<SamplesOfPerson>("/api/samples") });
  const [qty, setQty] = useState<Record<number, string>>({});
  const [file, setFile] = useState<File | null>(null);
  const usable = (mine.data?.held ?? []).filter((one) => one.kind === kind && one.tone !== "expired");
  const medicines = new Map<number, { name: string; have: number }>();
  for (const one of usable) {
    const now = medicines.get(one.medicineId);
    medicines.set(one.medicineId, { name: one.medicine, have: (now?.have ?? 0) + one.qty });
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    const lines = [...medicines.keys()].filter((id) => Number(qty[id]) > 0).map((id) => ({ medicineId: id, qty: Number(qty[id]) }));
    const body = new FormData();
    body.set("visitId", String(visitId));
    body.set("kind", kind);
    body.set("lines", JSON.stringify(lines));
    if (file) body.set("file", file);
    if (await run.go("/api/samples/give", body)) onClose();
  }
  return (
    <Dialog title={`Give to ${doctor}`} onClose={onClose} busy={run.busy}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="flex overflow-hidden rounded-lg border border-slate-200 self-start">
          {(["samples", "gifts"] as const).map((one) => (
            <button key={one} type="button" onClick={() => setKind(one)} className={`px-3 py-1.5 text-sm font-semibold capitalize ${kind === one ? "bg-brand text-white" : "text-slate-600"}`}>
              {one}
            </button>
          ))}
        </div>
        {[...medicines.entries()].map(([id, one]) => (
          <div key={id} className="flex items-center justify-between gap-2 text-sm">
            <span className="min-w-0 flex-1 truncate">{one.name}</span>
            <span className="text-xs text-slate-500">you have {one.have}</span>
            <input inputMode="numeric" className="h-8 w-20 rounded border border-slate-200 px-2" value={qty[id] ?? ""} onChange={(event) => setQty({ ...qty, [id]: event.target.value })} aria-label={`Pieces of ${one.name}`} />
          </div>
        ))}
        {!medicines.size && <p className="text-sm text-slate-500">You hold no unexpired {kind}. Ask for them under My samples & gifts.</p>}
        <label className="text-sm">
          The doctor's signed acknowledgement (photo or PDF)
          <input type="file" accept="image/*,application/pdf" className="mt-1 block text-sm" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        </label>
        {run.problem && <p className="text-sm text-rose-700">{run.problem.message}</p>}
        <div className="flex justify-end">
          <button type="submit" className={PRIMARY} disabled={run.busy || !medicines.size}>
            Give
          </button>
        </div>
      </form>
    </Dialog>
  );
}
