// Government Bidding (docs/PLAN.md 16.6): the bidding desk's Home (deadlines this week, prices to
// approve, bids awaiting award, awards on their way from delivery to acceptance (IAR) to billing
// and payment, this month's results, company papers ending), the tenders list, a tender (its
// details, envelope papers, our price per medicine, its next step, its history) and the company's
// eligibility papers.

import type {
  Catalogue,
  CompanyPaper,
  CustomerList,
  RegulatoryDesk,
  Tender,
  TenderBidder,
  TenderDesk,
  TenderReason,
  TenderStanding,
  TenderStep,
} from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { shortPeso } from "../ceo";
import { Button, CARD, dayLabel, Dialog, PageHead, PageState, Problem, peso, Tabs, useAction } from "../ui";
import { withUnit } from "../team/switch";
import { BidReportCard } from "./bid-report";
import { REASON } from "./tender-words";
import { EmptyState, NoInvoicesArt } from "../no-results";

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

function List({
  title,
  tenders,
  empty,
  emptySub,
  wide,
  extra,
}: {
  title: string;
  tenders: Tender[];
  empty: string;
  emptySub: string;
  wide?: boolean;
  extra?: (t: Tender) => string;
}) {
  return (
    <section className={`${CARD} min-w-0`}>
      <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-900">
        {title} <span className="font-normal text-slate-400">· {tenders.length}</span>
      </h3>
      {tenders.length === 0 ? (
        <EmptyState art={wide ? undefined : <NoInvoicesArt size={72} />} title={empty}>
          {emptySub}
        </EmptyState>
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
      <List title="Deadlines this week" tenders={data.deadlines} empty="No bid due this week." emptySub="Bids due this week show here." wide extra={deadline} />
      {data.canApprove && <List title="Bid prices to approve" tenders={data.toApprove} empty="No price waiting for you." emptySub="Bid prices waiting for your approval show here." />}
      <div className="grid gap-4 lg:grid-cols-2">
        <List title="Awaiting award" tenders={data.awaiting} empty="No bid waiting for its result." emptySub="Bids waiting for their award show here." />
        <List
          title="Won: to deliver"
          tenders={data.toDeliver}
          empty="Nothing to deliver."
          emptySub="Won tenders show here until they are delivered."
          extra={(t) => (t.deliverBy ? `by ${dayLabel(t.deliverBy)}` : "no delivery date")}
        />
        <List
          title="Delivered: waiting for acceptance (IAR)"
          tenders={data.toAccept}
          empty="Nothing waiting for acceptance."
          emptySub="Delivered tenders show here until they are accepted (IAR)."
          extra={(t) => `${sinceDays(t.deliveredOn, data.today)} days since delivery`}
        />
        <List title="Accepted: to bill" tenders={data.toBill} empty="Nothing to bill." emptySub="Accepted tenders show here until they are billed." extra={(t) => `accepted ${t.acceptedOn ? dayLabel(t.acceptedOn) : ""}`} />
        <List
          title="Billed: to collect"
          tenders={data.toCollect}
          empty="Nothing to collect."
          emptySub="Billed tenders show here until the money is collected."
          extra={(t) => `${sinceDays(t.acceptedOn, data.today)} days since acceptance`}
        />
        <section className={`${CARD} min-w-0`}>
          <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-900">Company papers ending</h3>
          {data.papersEnding.length === 0 ? (
            <EmptyState art={<NoInvoicesArt size={72} />} title="Every paper is valid for 60 days or more.">Company papers ending within 60 days show here.</EmptyState>
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
      {/* Their bids so far this year: every price read, won or lost and why, what is coming. */}
      <BidReportCard />
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
  const finder = useQuery({ queryKey: ["tenders", "found", "count"], queryFn: () => api<{ allowed: boolean; fresh: number }>("/api/tenders/found/count") });
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
          <>
            {/* The tender finder lives inside the CRM (docs/PLAN.md 24; Aryan, 23 Nov: "one CRM, not
                two"): the button opens its page, for the seats that have it, with how many found
                tenders are new. */}
            {finder.data?.allowed && (
              <Link
                to="/tenders/finder"
                className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Tender finder
                {finder.data.fresh > 0 && <span className="rounded-full bg-emerald-600 px-1.5 py-px text-[11px] font-bold text-white">{finder.data.fresh} new</span>}
              </Link>
            )}
            <Button variant="primary" onClick={() => setAdding(true)}>
              <Plus className="size-4" /> Record a tender
            </Button>
          </>
        }
      />
      {finder.data?.allowed && (
        <p className="-mt-2 text-[13px] text-slate-500">
          New tenders are found on PhilGEPS by the robot and listed in the <b>Tender finder</b>; one worth bidding on is made a tender there in
          one press. <b>Record a tender</b> is for one found another way.
        </p>
      )}
      <Tabs
        tabs={[
          { key: "open" as const, label: "Bidding", count: groups.open.length },
          { key: "awarded" as const, label: "Awarded", count: groups.awarded.length },
          { key: "closed" as const, label: "Paid, lost, dropped", count: groups.closed.length },
        ]}
        value={view}
        onChange={(key) => setParams({ view: key }, { replace: true })}
      />
      <List title={view === "open" ? "Bidding" : view === "awarded" ? "Awarded" : "Closed"} tenders={groups[view]} empty="None here." emptySub="Tenders in this tab show here. Try another tab." wide extra={view === "open" ? deadline : undefined} />
      {adding && <NewTenderDialog onClose={() => setAdding(false)} />}
    </div>
  );
}

type Detail = {
  tender: Tender;
  lines: { id: number; medicineId: number; medicine: string; qty: number; unitPrice: number }[];
  events: { step: string; note: string | null; by: string; at: string }[];
  next: TenderStep[];
  canApprove: boolean;
  bidders: TenderBidder[];
  standing: TenderStanding;
  canBidders: boolean;
  /** The notice it was made from in the tender finder, with what it asked line by line. */
  found: { id: number; source: "philgeps" | "ps"; refNo: string; link: string | null; asked: { id: number; description: string; qty: number | null; unit: string | null; abcUnit: number | null; medicineId: number | null }[] } | null;
};

function StepDialog({ tender, step, onClose }: { tender: Tender; step: TenderStep; onClose: () => void }) {
  const queries = useQueryClient();
  const action = useAction();
  const [note, setNote] = useState("");
  const [on, setOn] = useState("");
  const [winning, setWinning] = useState("");
  const [reason, setReason] = useState<TenderReason | "">("");
  return (
    <Dialog title={`${tender.code}: ${STEP[step]}`} sub={tender.title} onClose={onClose} busy={action.busy}>
      {step === "lost" && (
        <label className="mb-3 block text-[12.5px] font-semibold text-slate-600">
          Why we lost
          <select className="field h-10 w-full" value={reason} onChange={(event) => setReason(event.target.value as TenderReason)}>
            <option value="">Pick the reason…</option>
            {(Object.keys(REASON) as TenderReason[])
              .filter((key) => key !== "lowest")
              .map((key) => (
                <option key={key} value={key}>
                  {REASON[key]}
                </option>
              ))}
          </select>
        </label>
      )}
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
                body: {
                  step,
                  note: note || null,
                  on: on || null,
                  winningBid: winning ? toCentavos(winning) : null,
                  reason: step === "lost" && reason ? reason : null,
                },
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
  // Whoever follows the tender without having the finder (a division's head) reads what it asked, with no link.
  const finder = useQuery({ queryKey: ["tenders", "found", "count"], queryFn: () => api<{ allowed: boolean; fresh: number }>("/api/tenders/found/count") });
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
            {/* One job leads to the next (Aryan, 23 Nov): a tender won has its delivery to order; the
                order form opens on the agency and ties the order to the tender. */}
            {(t.step === "won" || t.step === "contract") && (
              <Link
                to={`/orders/new?customer=${t.agencyId}`}
                className="inline-flex h-8 items-center rounded-[10px] border border-emerald-300 bg-emerald-50 px-2.5 text-[13px] font-semibold text-emerald-800 hover:bg-emerald-100"
              >
                Place the delivery order
              </Link>
            )}
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
        {(t.resultReason || t.resultNote) && (
          <div className="sm:col-span-2">
            <b>Result</b> {[t.resultReason ? REASON[t.resultReason] : null, t.resultNote].filter(Boolean).join(" · ")}
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
      {data.found && <Asked found={data.found} open={finder.data?.allowed === true} />}
      <LinesEditor key={data.lines.map((l) => l.id).join("-")} detail={data} />
      <BidsRead detail={data} />
      {["won", "contract", "delivered", "accepted", "billed", "paid"].includes(t.step) && <Securities tender={t} />}
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

/** What the notice asked, as the tender finder read it: beside our bid, so no price goes above
 *  the budget for one piece. */
function Asked({ found, open }: { found: NonNullable<Detail["found"]>; open: boolean }) {
  const notice = `${found.source === "ps" ? "PS-PhilGEPS" : "PhilGEPS"} ${found.refNo}`;
  return (
    <section className={`${CARD} p-4`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold text-slate-900">What the tender asks for</h3>
        {open ? (
          <Link to={`/tenders/finder/${found.id}`} className="text-[12px] font-semibold text-emerald-700 hover:underline">
            The notice in the tender finder ({notice})
          </Link>
        ) : (
          <span className="text-[12px] text-slate-500">From the tender finder ({notice})</span>
        )}
      </div>
      {found.asked.length === 0 ? (
        <EmptyState art={<NoInvoicesArt size={72} />} title="No line was read on the notice.">
          What the tender asks for, line by line, shows here.
        </EmptyState>
      ) : (
        <ul className="mt-2 space-y-0.5 text-[13px] text-slate-700">
          {found.asked.map((line) => (
            <li key={line.id}>
              {line.description}
              <span className="text-slate-500">
                {line.qty !== null ? ` · ${line.qty.toLocaleString("en-PH")} ${line.unit ?? ""}` : ""}
                {line.abcUnit !== null ? ` · ABC ${peso(line.abcUnit)} a piece` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
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
      <ProductCprs />
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

/** The products' CPRs for the envelope, as Regulatory Affairs keeps them (read only here). */
function ProductCprs() {
  const query = useQuery({ queryKey: ["regulatory"], queryFn: () => api<RegulatoryDesk>("/api/regulatory/desk") });
  const cprs = (query.data?.registrations ?? []).filter((r) => ["approved", "renewal_filed"].includes(r.status));
  if (!query.data) return null;
  return (
    <section className={CARD}>
      <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-900">
        Product registrations (CPRs) <span className="font-normal text-slate-500">· kept by Regulatory Affairs</span>
      </h3>
      {cprs.length === 0 ? (
        <EmptyState title="No CPR recorded yet.">Approved product registrations kept by Regulatory Affairs show here.</EmptyState>
      ) : (
        <ul className="divide-y divide-slate-100">
          {cprs.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[13px]">
              <span>
                <b className="text-slate-900">{r.product}</b> {r.number && <span className="text-slate-500">· {r.number}</span>}
              </span>
              <span className={`text-[12px] font-semibold ${r.flag === "expired" ? "text-rose-700" : r.flag ? "text-amber-700" : "text-emerald-700"}`}>
                {r.status === "renewal_filed" ? "renewal filed · " : ""}
                {r.validUntil ? `${r.flag === "expired" ? "expired" : "valid until"} ${dayLabel(r.validUntil)}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The Mentor's card: the bidding pipeline. */
export function BiddingCard({ title = "Government Bidding", unit = null }: { title?: string; unit?: number | null }) {
  const query = useQuery({
    queryKey: ["tenders", "desk", unit ?? ""],
    queryFn: () => api<TenderDesk>(withUnit("/api/tenders/desk", unit ? String(unit) : null)),
  });
  const data = query.data;
  if (!data) return null;
  const awardedValue = [...data.toDeliver, ...data.toAccept, ...data.toBill, ...data.toCollect].reduce((sum, t) => sum + (t.ourBid ?? 0), 0);
  return (
    <section className={`${CARD} min-w-0 p-4`}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
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

/** The bids read at the opening (the abstract of bids): ours among them, the lowest first, each
 *  bidder's price (a total, or a price for each of our medicines), out or not; a bidder is added
 *  as read, and one written by mistake is taken off (kept, marked replaced). */
function BidsRead({ detail }: { detail: Detail }) {
  const queries = useQueryClient();
  const action = useAction();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [unit, setUnit] = useState<Record<number, string>>({});
  const [out, setOut] = useState(false);
  const [note, setNote] = useState("");
  const { standing, bidders, tender } = detail;
  const reset = () => {
    setName("");
    setPrice("");
    setUnit({});
    setOut(false);
    setNote("");
  };
  const ours = new Map(detail.lines.map((line) => [line.medicineId, line]));
  const unitTotal = Object.entries(unit).reduce((sum, [medicineId, value]) => {
    const line = ours.get(Number(medicineId));
    return sum + (line && value ? toCentavos(value) * line.qty : 0);
  }, 0);
  if (!detail.canBidders && bidders.length === 0)
    return (
      <section className={`${CARD} p-4`}>
        <h3 className="text-sm font-bold text-slate-900">The bids read at the opening</h3>
        <p className="mt-1 text-[13px] text-slate-500">Written once the bids are opened (after Submitted): every bidder's price and who was out.</p>
      </section>
    );
  return (
    <section className={`${CARD} min-w-0`}>
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <h3 className="text-sm font-bold text-slate-900">The bids read at the opening</h3>
        {standing.lowest && (
          <span className="text-[12.5px] text-slate-600">
            Lowest {shortPeso(standing.lowest.price)} ({standing.lowest.name})
            {standing.rank ? ` · ours is #${standing.rank}` : ""}
            {standing.gap !== null && standing.gap > 0 ? ` · ${shortPeso(standing.gap)} (${standing.gapPct}%) above it` : ""}
          </span>
        )}
      </header>
      {standing.bids.length > 0 && (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[10.5px] font-semibold tracking-wide text-slate-400 uppercase">
              <th className="px-4 py-2">#</th>
              <th className="px-3 py-2">Bidder</th>
              <th className="px-3 py-2 text-right">Bid</th>
              <th className="px-3 py-2 text-right">Against the ABC</th>
              <th className="px-3 py-2">Note</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {standing.bids.map((bid, index) => {
              const row = bidders.find((one) => one.name === bid.name && one.price === bid.price);
              const place = bid.disqualified ? null : standing.bids.filter((one) => !one.disqualified).indexOf(bid) + 1;
              return (
                <tr key={`${bid.name}-${index}`} className={bid.us ? "bg-emerald-50/60" : ""}>
                  <td className="px-4 py-2 text-slate-500 tabular-nums">{place ?? "—"}</td>
                  <td className={`px-3 py-2 ${bid.us ? "font-semibold text-emerald-800" : "text-slate-900"}`}>
                    {bid.name}
                    {bid.disqualified && <span className="ml-1.5 rounded bg-rose-50 px-1.5 py-0.5 text-[11px] font-semibold text-rose-700">Out</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{shortPeso(bid.price)}</td>
                  <td className="px-3 py-2 text-right text-slate-500 tabular-nums">
                    {tender.abc ? `${Math.round((bid.price / tender.abc) * 1000) / 10}%` : "—"}
                  </td>
                  <td className="px-3 py-2 text-[12px] text-slate-500">
                    {row?.note ?? ""}
                    {row && row.lines.length > 0 && (
                      <span className="block">
                        {row.lines
                          .map((line) => `${ours.get(line.medicineId)?.medicine ?? "a medicine"} ${peso(line.unitPrice)} each`)
                          .join(" · ")}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {row && detail.canBidders && (
                      <button
                        type="button"
                        disabled={action.busy}
                        onClick={() =>
                          void action.run(async () => {
                            await api(`/api/tenders/bidders/${row.id}/remove`, { method: "POST", body: {} });
                            await queries.invalidateQueries({ queryKey: ["tenders"] });
                          })
                        }
                        className="text-[12px] font-semibold text-slate-500 hover:text-rose-700"
                      >
                        Take off
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {detail.canBidders &&
        (adding ? (
          <div className="grid gap-2 border-t border-slate-100 p-4 sm:grid-cols-2">
            <label className="block text-[12.5px] font-semibold text-slate-600">
              Bidder (as read at the opening)
              <input className="field h-10 w-full" value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label className="block text-[12.5px] font-semibold text-slate-600">
              Their bid for the whole tender (₱)
              <input
                className="field h-10 w-full"
                inputMode="decimal"
                placeholder={unitTotal ? `${(unitTotal / 100).toLocaleString("en-PH")} from the prices below` : ""}
                value={price}
                onChange={(event) => setPrice(event.target.value)}
              />
            </label>
            {detail.lines.length > 0 && (
              <fieldset className="sm:col-span-2">
                <legend className="text-[12.5px] font-semibold text-slate-600">Their price for one piece, medicine by medicine (when read item by item)</legend>
                <div className="mt-1 grid gap-2 sm:grid-cols-2">
                  {detail.lines.map((line) => (
                    <label key={line.id} className="block text-[12px] text-slate-600">
                      {line.medicine} × {line.qty} (ours {shortPeso(line.unitPrice)})
                      <input
                        className="field h-9 w-full"
                        inputMode="decimal"
                        value={unit[line.medicineId] ?? ""}
                        onChange={(event) => setUnit({ ...unit, [line.medicineId]: event.target.value })}
                      />
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            <label className="flex items-center gap-2 text-[13px] text-slate-700">
              <input type="checkbox" className="accent-rose-600" checked={out} onChange={(event) => setOut(event.target.checked)} />
              Out (disqualified at the opening or the post-qualification)
            </label>
            <label className="block text-[12.5px] font-semibold text-slate-600 sm:col-span-2">
              Note (why out, a remark)
              <input className="field h-10 w-full" value={note} onChange={(event) => setNote(event.target.value)} />
            </label>
            <Problem message={action.problem?.message} />
            <div className="flex gap-2 sm:col-span-2">
              <Button
                variant="primary"
                disabled={action.busy || !name.trim()}
                onClick={() =>
                  void action.run(async () => {
                    const lines = Object.entries(unit)
                      .filter(([, value]) => value.trim())
                      .map(([medicineId, value]) => ({ medicineId: Number(medicineId), unitPrice: toCentavos(value) }));
                    await api(`/api/tenders/${tender.id}/bidders`, {
                      method: "POST",
                      body: {
                        name: name.trim(),
                        price: price.trim() ? toCentavos(price) : unitTotal || null,
                        lines,
                        disqualified: out,
                        note: note.trim() || null,
                      },
                    });
                    await queries.invalidateQueries({ queryKey: ["tenders"] });
                    reset();
                  })
                }
              >
                Add the bid
              </Button>
              <Button
                onClick={() => {
                  reset();
                  setAdding(false);
                }}
              >
                Done
              </Button>
            </div>
          </div>
        ) : (
          <div className="border-t border-slate-100 px-4 py-3">
            <Button small onClick={() => setAdding(true)}>
              Add a bidder's price
            </Button>
          </div>
        ))}
    </section>
  );
}

/** What the award ties up: the performance security and the retention, and when each comes back. */
function Securities({ tender }: { tender: Tender }) {
  const queries = useQueryClient();
  const action = useAction();
  const [form, setForm] = useState(tender.performanceSecurityForm ?? "");
  const [amount, setAmount] = useState(tender.performanceSecurityAmount ? String(tender.performanceSecurityAmount / 100) : "");
  const [back, setBack] = useState(tender.performanceSecurityBackOn ?? "");
  const [retention, setRetention] = useState(tender.retentionAmount ? String(tender.retentionAmount / 100) : "");
  const [retentionBack, setRetentionBack] = useState(tender.retentionBackOn ?? "");
  return (
    <section className={`${CARD} p-4`}>
      <h3 className="text-sm font-bold text-slate-900">Securities</h3>
      <p className="text-[12px] text-slate-500">
        The performance security (5% in cash or a bank guarantee, 30% by surety bond) and the retention (1% on medicines,
        three months after acceptance).
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        <label className="block text-[12.5px] font-semibold text-slate-600">
          Performance security: form
          <input className="field h-10 w-full" placeholder="Bank guarantee, surety bond, cash" value={form} onChange={(event) => setForm(event.target.value)} />
        </label>
        <label className="block text-[12.5px] font-semibold text-slate-600">
          Amount (₱)
          <input className="field h-10 w-full" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
        </label>
        <label className="block text-[12.5px] font-semibold text-slate-600">
          Came back on
          <input type="date" className="field h-10 w-full" value={back} onChange={(event) => setBack(event.target.value)} />
        </label>
        <label className="block text-[12.5px] font-semibold text-slate-600">
          Retention kept (₱)
          <input className="field h-10 w-full" inputMode="decimal" value={retention} onChange={(event) => setRetention(event.target.value)} />
        </label>
        <label className="block text-[12.5px] font-semibold text-slate-600">
          Retention released on
          <input type="date" className="field h-10 w-full" value={retentionBack} onChange={(event) => setRetentionBack(event.target.value)} />
        </label>
      </div>
      <Problem message={action.problem?.message} />
      <div className="mt-3">
        <Button
          small
          variant="primary"
          disabled={action.busy}
          onClick={() =>
            void action.run(async () => {
              await api(`/api/tenders/${tender.id}`, {
                method: "POST",
                body: {
                  performanceSecurityForm: form.trim() || null,
                  performanceSecurityAmount: amount.trim() ? toCentavos(amount) : null,
                  performanceSecurityBackOn: back || null,
                  retentionAmount: retention.trim() ? toCentavos(retention) : null,
                  retentionBackOn: retentionBack || null,
                },
              });
              await queries.invalidateQueries({ queryKey: ["tenders"] });
            })
          }
        >
          Save
        </Button>
      </div>
    </section>
  );
}
