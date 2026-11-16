// Government Bidding (docs/PLAN.md 16.6): the bidding desk's Home (deadlines this week, prices to
// approve, bids awaiting award, awards on their way from delivery to acceptance (IAR) to billing
// and payment, this month's results, company papers ending), the tenders list, a tender (its
// details, envelope papers, our price per medicine, its next step, its history) and the company's
// eligibility papers.

import type { Catalogue, CompanyPaper, CustomerList, Tender, TenderDesk, TenderStep } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { shortPeso } from "../ceo";
import { Button, CARD, dayLabel, Dialog, PageHead, PageState, Problem, Tabs, useAction } from "../ui";

const STEP: Record<TenderStep, string> = {
  found: "Found",
  preparing: "Preparing",
  price_approved: "Price approved",
  submitted: "Submitted",
  won: "Won",
  lost: "Lost",
  contract: "Contract / NTP",
  delivered: "Delivered",
  accepted: "Accepted (IAR)",
  billed: "Billed",
  paid: "Paid",
  dropped: "Dropped",
};
const MODE: Record<string, string> = {
  competitive_bidding: "Competitive bidding",
  limited_source: "Limited source",
  direct_contracting: "Direct contracting",
  direct_acquisition: "Direct acquisition",
  repeat_order: "Repeat order",
  small_value: "Small value procurement",
  negotiated: "Negotiated",
  direct_sales: "Direct sales",
  other: "Other",
};
const toCentavos = (pesos: string) => Math.round(Number(pesos.replace(/[^\d.]/g, "")) * 100) || 0;
const deadline = (t: Tender) => (t.deadlineAt ? new Date(t.deadlineAt).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" }) : "no deadline yet");

function TenderRow({ t, extra }: { t: Tender; extra?: string }) {
  const missing = t.papers.filter((p) => !p.done).length;
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[13px]">
      <span className="min-w-0">
        <Link to={`/tenders/${t.id}`} className="font-semibold text-slate-900 hover:underline">
          {t.code} · {t.title}
        </Link>
        <span className="block text-[11.5px] text-slate-500">
          {t.agency} · {STEP[t.step]}
          {t.ourBid ? ` · our bid ${shortPeso(t.ourBid)}` : ""}
          {t.abc ? ` · ABC ${shortPeso(t.abc)}` : ""}
          {missing && ["found", "preparing", "price_approved"].includes(t.step) ? ` · ${missing} papers missing` : ""}
        </span>
      </span>
      {extra && <span className="shrink-0 text-[12px] font-semibold text-slate-600">{extra}</span>}
    </li>
  );
}

function List({ title, tenders, empty, extra }: { title: string; tenders: Tender[]; empty: string; extra?: (t: Tender) => string }) {
  return (
    <section className={`${CARD} min-w-0`}>
      <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-900">
        {title} <span className="font-normal text-slate-400">· {tenders.length}</span>
      </h3>
      {tenders.length === 0 ? (
        <p className="px-4 py-3 text-[13px] text-slate-500">{empty}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {tenders.map((t) => (
            <TenderRow key={t.id} t={t} extra={extra?.(t)} />
          ))}
        </ul>
      )}
    </section>
  );
}

const sinceDays = (day: string | null, today: string) =>
  day ? Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000) : 0;

export function BiddingHome() {
  const query = useQuery({ queryKey: ["tenders", "desk"], queryFn: () => api<TenderDesk>("/api/tenders/desk") });
  const data = query.data;
  if (!data) return null;
  return (
    <>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {(
          [
            ["Deadlines this week", data.deadlines.length],
            ["Prices to approve", data.toApprove.length],
            ["Awaiting award", data.awaiting.length],
            ["Won this month", `${data.month.won}${data.month.winRate === null ? "" : ` · ${data.month.winRate}% win rate`}`],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className={`${CARD} px-4 py-3`}>
            <div className="text-[11px] font-semibold text-slate-500">{label}</div>
            <div className="text-xl font-bold text-slate-900 tabular-nums">{value}</div>
          </div>
        ))}
      </section>
      <List title="Deadlines this week" tenders={data.deadlines} empty="No bid due this week." extra={deadline} />
      {data.canApprove && <List title="Bid prices to approve" tenders={data.toApprove} empty="No price waiting for you." />}
      <div className="grid gap-4 lg:grid-cols-2">
        <List title="Awaiting award" tenders={data.awaiting} empty="No bid waiting for its result." />
        <List
          title="Won: to deliver"
          tenders={data.toDeliver}
          empty="Nothing to deliver."
          extra={(t) => (t.deliverBy ? `by ${dayLabel(t.deliverBy)}` : "no delivery date")}
        />
        <List
          title="Delivered: waiting for acceptance (IAR)"
          tenders={data.toAccept}
          empty="Nothing waiting for acceptance."
          extra={(t) => `${sinceDays(t.deliveredOn, data.today)} days since delivery`}
        />
        <List title="Accepted: to bill" tenders={data.toBill} empty="Nothing to bill." extra={(t) => `accepted ${t.acceptedOn ? dayLabel(t.acceptedOn) : ""}`} />
        <List
          title="Billed: to collect"
          tenders={data.toCollect}
          empty="Nothing to collect."
          extra={(t) => `${sinceDays(t.acceptedOn, data.today)} days since acceptance`}
        />
        <section className={`${CARD} min-w-0`}>
          <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-900">Company papers ending</h3>
          {data.papersEnding.length === 0 ? (
            <p className="px-4 py-3 text-[13px] text-slate-500">Every paper is valid for 60 days or more.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.papersEnding.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 px-4 py-2 text-[13px]">
                  <span className="font-medium text-slate-900">{p.name}</span>
                  <span className={`text-[12px] font-semibold ${p.state === "expired" ? "text-rose-700" : "text-amber-700"}`}>
                    {p.state === "expired" ? "expired" : "ends"} {p.expiresOn ? dayLabel(p.expiresOn) : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

function NewTenderDialog({ onClose }: { onClose: () => void }) {
  const queries = useQueryClient();
  const action = useAction();
  const [q, setQ] = useState("");
  const found = useQuery({
    queryKey: ["customers", "agencies", q],
    queryFn: () => api<CustomerList>(`/api/customers?q=${encodeURIComponent(q)}&page=1`),
    enabled: q.trim().length >= 2,
  });
  const agencies = (found.data?.rows ?? []).filter((row) => row.kind === "government" || row.kind === "hospital");
  const [form, setForm] = useState({ agencyId: 0, title: "", philgepsRef: "", mode: "competitive_bidding", abc: "", deadline: "" });
  return (
    <Dialog title="Record a tender" sub="From the PhilGEPS posting" onClose={onClose} busy={action.busy}>
      <label className="block text-[12.5px] font-semibold text-slate-600">
        Buying agency or government hospital
        <input className="field h-10 w-full" placeholder="Type to search" value={q} onChange={(event) => setQ(event.target.value)} />
      </label>
      {agencies.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {agencies.slice(0, 8).map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setForm({ ...form, agencyId: a.id })}
              className={`rounded-md px-2 py-1 text-[12px] ring-1 ${form.agencyId === a.id ? "bg-brand text-white ring-brand" : "text-slate-700 ring-slate-200"}`}
            >
              {a.name}
            </button>
          ))}
        </div>
      )}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block text-[12.5px] font-semibold text-slate-600 sm:col-span-2">
          What it buys
          <input className="field h-10 w-full" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
        </label>
        <label className="block text-[12.5px] font-semibold text-slate-600">
          Mode
          <select className="field h-10 w-full" value={form.mode} onChange={(event) => setForm({ ...form, mode: event.target.value })}>
            {Object.entries(MODE).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[12.5px] font-semibold text-slate-600">
          PhilGEPS reference
          <input className="field h-10 w-full" value={form.philgepsRef} onChange={(event) => setForm({ ...form, philgepsRef: event.target.value })} />
        </label>
        <label className="block text-[12.5px] font-semibold text-slate-600">
          ABC (₱)
          <input className="field h-10 w-full" inputMode="decimal" value={form.abc} onChange={(event) => setForm({ ...form, abc: event.target.value })} />
        </label>
        <label className="block text-[12.5px] font-semibold text-slate-600">
          Bid deadline
          <input type="datetime-local" className="field h-10 w-full" value={form.deadline} onChange={(event) => setForm({ ...form, deadline: event.target.value })} />
        </label>
      </div>
      <Problem message={action.problem?.message} />
      <div className="mt-3 flex justify-end">
        <Button
          variant="primary"
          disabled={action.busy || !form.agencyId || !form.title.trim()}
          onClick={() =>
            void action.run(async () => {
              await api("/api/tenders", {
                method: "POST",
                body: {
                  agencyId: form.agencyId,
                  title: form.title,
                  mode: form.mode,
                  philgepsRef: form.philgepsRef || null,
                  abc: form.abc ? toCentavos(form.abc) : null,
                  deadlineAt: form.deadline ? `${form.deadline}:00+08:00` : null,
                },
              });
              await queries.invalidateQueries({ queryKey: ["tenders"] });
              onClose();
            })
          }
        >
          Record the tender
        </Button>
      </div>
    </Dialog>
  );
}

export function TendersPage() {
  const query = useQuery({ queryKey: ["tenders", "list"], queryFn: () => api<Tender[]>("/api/tenders") });
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(false);
  const view = (params.get("view") ?? "open") as "open" | "awarded" | "closed";
  const data = query.data;
  if (!data) return <PageState query={query} what="the tenders" />;
  const groups = {
    open: data.filter((t) => ["found", "preparing", "price_approved", "submitted"].includes(t.step)),
    awarded: data.filter((t) => ["won", "contract", "delivered", "accepted", "billed"].includes(t.step)),
    closed: data.filter((t) => ["paid", "lost", "dropped"].includes(t.step)),
  };
  return (
    <div className="mx-auto max-w-5xl space-y-3">
      <PageHead
        title="Tenders"
        sub="Found on PhilGEPS → preparing → price approved → submitted → won or lost → contract → delivered → accepted (IAR) → billed → paid"
        actions={
          <Button variant="primary" onClick={() => setAdding(true)}>
            <Plus className="size-4" /> Record a tender
          </Button>
        }
      />
      <Tabs
        tabs={[
          { key: "open" as const, label: "Bidding", count: groups.open.length },
          { key: "awarded" as const, label: "Awarded", count: groups.awarded.length },
          { key: "closed" as const, label: "Paid, lost, dropped", count: groups.closed.length },
        ]}
        value={view}
        onChange={(key) => setParams({ view: key }, { replace: true })}
      />
      <List title={view === "open" ? "Bidding" : view === "awarded" ? "Awarded" : "Closed"} tenders={groups[view]} empty="None here." extra={view === "open" ? deadline : undefined} />
      {adding && <NewTenderDialog onClose={() => setAdding(false)} />}
    </div>
  );
}

type Detail = { tender: Tender; lines: { id: number; medicineId: number; medicine: string; qty: number; unitPrice: number }[]; events: { step: string; note: string | null; by: string; at: string }[]; next: TenderStep[]; canApprove: boolean };

function StepDialog({ tender, step, onClose }: { tender: Tender; step: TenderStep; onClose: () => void }) {
  const queries = useQueryClient();
  const action = useAction();
  const [note, setNote] = useState("");
  const [on, setOn] = useState("");
  const [winning, setWinning] = useState("");
  return (
    <Dialog title={`${tender.code}: ${STEP[step]}`} sub={tender.title} onClose={onClose} busy={action.busy}>
      {["won", "contract", "delivered", "accepted", "billed", "paid"].includes(step) && (
        <label className="block text-[12.5px] font-semibold text-slate-600">
          On which day (today if empty)
          <input type="date" className="field h-10 w-full" value={on} onChange={(event) => setOn(event.target.value)} />
        </label>
      )}
      {step === "lost" && (
        <label className="block text-[12.5px] font-semibold text-slate-600">
          Winning bid (₱)
          <input className="field h-10 w-full" inputMode="decimal" value={winning} onChange={(event) => setWinning(event.target.value)} />
        </label>
      )}
      <label className="mt-3 block text-[12.5px] font-semibold text-slate-600">
        Note {step === "dropped" || step === "lost" ? "(why)" : ""}
        <textarea className="field min-h-20 w-full" value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      <Problem message={action.problem?.message} />
      <div className="mt-3 flex justify-end">
        <Button
          variant="primary"
          disabled={action.busy}
          onClick={() =>
            void action.run(async () => {
              await api(`/api/tenders/${tender.id}/step`, {
                method: "POST",
                body: { step, note: note || null, on: on || null, winningBid: winning ? toCentavos(winning) : null },
              });
              await queries.invalidateQueries({ queryKey: ["tenders"] });
              onClose();
            })
          }
        >
          Mark {STEP[step].toLowerCase()}
        </Button>
      </div>
    </Dialog>
  );
}

function LinesEditor({ detail }: { detail: Detail }) {
  const queries = useQueryClient();
  const action = useAction();
  const medicines = useQuery({ queryKey: ["inventory", "medicines"], queryFn: () => api<Catalogue>("/api/inventory/medicines") });
  const [lines, setLines] = useState(detail.lines.map((l) => ({ medicineId: String(l.medicineId), qty: String(l.qty), price: String(l.unitPrice / 100) })));
  const editable = ["found", "preparing"].includes(detail.tender.step);
  return (
    <section className={`${CARD} p-4`}>
      <h3 className="text-sm font-bold text-slate-900">Our bid, medicine by medicine</h3>
      {!editable ? (
        <ul className="mt-2 text-[13px] text-slate-700">
          {detail.lines.map((l) => (
            <li key={l.id}>
              {l.medicine} × {l.qty} at {shortPeso(l.unitPrice)} = {shortPeso(l.qty * l.unitPrice)}
            </li>
          ))}
          {detail.lines.length === 0 && <li className="text-slate-500">No lines.</li>}
        </ul>
      ) : (
        <>
          {lines.map((line, n) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows being typed
            <div key={n} className="mt-2 grid grid-cols-[minmax(0,1fr)_6rem_8rem] gap-2">
              <select className="field h-9" value={line.medicineId} onChange={(event) => setLines(lines.map((l, k) => (k === n ? { ...l, medicineId: event.target.value } : l)))}>
                <option value="">Medicine</option>
                {(medicines.data?.rows ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} {m.strength ?? ""}
                  </option>
                ))}
              </select>
              <input className="field h-9" placeholder="Qty" value={line.qty} onChange={(event) => setLines(lines.map((l, k) => (k === n ? { ...l, qty: event.target.value } : l)))} />
              <input className="field h-9" placeholder="₱ a piece" value={line.price} onChange={(event) => setLines(lines.map((l, k) => (k === n ? { ...l, price: event.target.value } : l)))} />
            </div>
          ))}
          <div className="mt-2 flex justify-between">
            <Button small onClick={() => setLines([...lines, { medicineId: "", qty: "", price: "" }])}>
              <Plus className="size-3.5" /> Add a medicine
            </Button>
            <Button
              small
              variant="primary"
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  await api(`/api/tenders/${detail.tender.id}/lines`, {
                    method: "POST",
                    body: {
                      lines: lines
                        .filter((l) => l.medicineId && Number(l.qty) > 0)
                        .map((l) => ({ medicineId: Number(l.medicineId), qty: Number(l.qty), unitPrice: toCentavos(l.price) })),
                    },
                  });
                  await queries.invalidateQueries({ queryKey: ["tenders"] });
                })
              }
            >
              Save the bid price
            </Button>
          </div>
          <Problem message={action.problem?.message} />
        </>
      )}
    </section>
  );
}

export function TenderPage() {
  const { id } = useParams();
  const queries = useQueryClient();
  const action = useAction();
  const query = useQuery({ queryKey: ["tenders", "one", id], queryFn: () => api<Detail>(`/api/tenders/${id}`) });
  const [moving, setMoving] = useState<TenderStep | null>(null);
  const data = query.data;
  if (!data) return <PageState query={query} what="the tender" />;
  const t = data.tender;
  const togglePaper = (paper: string) =>
    void action.run(async () => {
      await api(`/api/tenders/${t.id}`, { method: "POST", body: { papers: t.papers.map((p) => (p.paper === paper ? { ...p, done: !p.done } : p)) } });
      await queries.invalidateQueries({ queryKey: ["tenders"] });
    });
  const moves = data.next.filter((step) => step !== "price_approved" || data.canApprove);
  return (
    <div className="mx-auto max-w-5xl space-y-3">
      <PageHead
        title={`${t.code} · ${t.title}`}
        sub={`${t.agency} · ${MODE[t.mode] ?? t.mode}${t.philgepsRef ? ` · PhilGEPS ${t.philgepsRef}` : ""} · run by ${t.owner}`}
        tags={<span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[12px] font-semibold text-emerald-800 ring-1 ring-emerald-200">{STEP[t.step]}</span>}
        actions={
          <div className="flex flex-wrap gap-2">
            {moves.map((step) => (
              <Button key={step} small variant={step === "dropped" || step === "lost" ? undefined : "primary"} onClick={() => setMoving(step)}>
                {STEP[step]}
              </Button>
            ))}
          </div>
        }
      />
      <section className={`${CARD} grid gap-2 p-4 text-[13px] sm:grid-cols-3`}>
        <div>
          <b>ABC</b> {t.abc ? shortPeso(t.abc) : "—"}
        </div>
        <div>
          <b>Our bid</b> {t.ourBid ? shortPeso(t.ourBid) : "—"}
          {t.priceApprovedBy ? ` · approved by ${t.priceApprovedBy}` : ""}
        </div>
        <div>
          <b>Deadline</b> {deadline(t)}
        </div>
        {t.winningBid !== null && (
          <div>
            <b>Winning bid</b> {shortPeso(t.winningBid)}
          </div>
        )}
        {t.resultNote && (
          <div className="sm:col-span-2">
            <b>Result</b> {t.resultNote}
          </div>
        )}
        {t.noaOn && (
          <div>
            <b>Notice of award</b> {dayLabel(t.noaOn)}
          </div>
        )}
        {t.deliveredOn && (
          <div>
            <b>Delivered</b> {dayLabel(t.deliveredOn)}
          </div>
        )}
        {t.acceptedOn && (
          <div>
            <b>Accepted (IAR)</b> {dayLabel(t.acceptedOn)}
          </div>
        )}
        {t.droppedReason && (
          <div className="sm:col-span-3">
            <b>Dropped</b> {t.droppedReason}
          </div>
        )}
      </section>
      <section className={`${CARD} p-4`}>
        <h3 className="text-sm font-bold text-slate-900">
          Envelope papers <span className="font-normal text-slate-400">· {t.papers.filter((p) => p.done).length} of {t.papers.length}</span>
        </h3>
        <ul className="mt-2 grid gap-1 sm:grid-cols-2">
          {t.papers.map((p) => (
            <li key={p.paper}>
              <label className="flex items-center gap-2 text-[13px] text-slate-700">
                <input type="checkbox" className="accent-emerald-600" checked={p.done} disabled={action.busy} onChange={() => togglePaper(p.paper)} />
                {p.paper}
              </label>
            </li>
          ))}
        </ul>
        <Problem message={action.problem?.message} />
      </section>
      <LinesEditor key={data.lines.map((l) => l.id).join("-")} detail={data} />
      <section className={`${CARD} p-4`}>
        <h3 className="text-sm font-bold text-slate-900">History</h3>
        <ul className="mt-2 space-y-1 text-[12.5px] text-slate-600">
          {data.events.map((e) => (
            <li key={`${e.at}-${e.step}`}>
              {new Date(e.at).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" })} · <b>{STEP[e.step as TenderStep] ?? e.step}</b> by {e.by}
              {e.note ? ` · ${e.note}` : ""}
            </li>
          ))}
        </ul>
      </section>
      {moving && <StepDialog tender={t} step={moving} onClose={() => setMoving(null)} />}
    </div>
  );
}

export function CompanyPapersPage() {
  const queries = useQueryClient();
  const action = useAction();
  const query = useQuery({ queryKey: ["tenders", "papers"], queryFn: () => api<CompanyPaper[]>("/api/company-papers") });
  const [form, setForm] = useState({ name: "", number: "", expiresOn: "" });
  const data = query.data;
  if (!data) return <PageState query={query} what="the company's papers" />;
  return (
    <div className="mx-auto max-w-4xl space-y-3">
      <PageHead title="Documents" sub="The company's eligibility papers with their expiry; a renewed paper is added again and the newest counts" />
      <section className={CARD}>
        <ul className="divide-y divide-slate-100">
          {data.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[13px]">
              <span>
                <b className="text-slate-900">{p.name}</b> {p.number && <span className="text-slate-500">· {p.number}</span>}
              </span>
              <span className={`text-[12px] font-semibold ${p.state === "expired" ? "text-rose-700" : p.state === "expiring" ? "text-amber-700" : "text-emerald-700"}`}>
                {p.expiresOn ? `${p.state === "expired" ? "expired" : "valid until"} ${dayLabel(p.expiresOn)}` : "no expiry"}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section className={`${CARD} grid gap-2 p-4 sm:grid-cols-[1fr_12rem_10rem_auto]`}>
        <input className="field h-9" placeholder="Paper (e.g. PhilGEPS Platinum certificate)" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        <input className="field h-9" placeholder="Number" value={form.number} onChange={(event) => setForm({ ...form, number: event.target.value })} />
        <input type="date" className="field h-9" value={form.expiresOn} onChange={(event) => setForm({ ...form, expiresOn: event.target.value })} />
        <Button
          small
          variant="primary"
          disabled={action.busy || !form.name.trim()}
          onClick={() =>
            void action.run(async () => {
              await api("/api/company-papers", { method: "POST", body: { name: form.name, number: form.number || null, expiresOn: form.expiresOn || null } });
              setForm({ name: "", number: "", expiresOn: "" });
              await queries.invalidateQueries({ queryKey: ["tenders"] });
            })
          }
        >
          Add
        </Button>
        <div className="sm:col-span-4">
          <Problem message={action.problem?.message} />
        </div>
      </section>
    </div>
  );
}

/** The Mentor's card: the bidding pipeline. */
export function BiddingCard() {
  const query = useQuery({ queryKey: ["tenders", "desk"], queryFn: () => api<TenderDesk>("/api/tenders/desk") });
  const data = query.data;
  if (!data) return null;
  const awardedValue = [...data.toDeliver, ...data.toAccept, ...data.toBill, ...data.toCollect].reduce((sum, t) => sum + (t.ourBid ?? 0), 0);
  return (
    <section className={`${CARD} min-w-0 p-4`}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">Government Bidding</h2>
        <Link to="/tenders" className="text-[12px] font-semibold text-emerald-700 hover:underline">
          Tenders
        </Link>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-center sm:grid-cols-5">
        {(
          [
            ["Deadlines this week", data.deadlines.length],
            ["Awaiting award", data.awaiting.length],
            ["Won / lost this month", `${data.month.won} / ${data.month.lost}`],
            ["Awarded, not yet paid", shortPeso(awardedValue)],
            ["Waiting for IAR", data.toAccept.length],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="rounded-lg bg-slate-50 px-2 py-1.5">
            <div className="text-lg font-semibold text-slate-900 tabular-nums">{value}</div>
            <div className="text-[11px] text-slate-500">{label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
