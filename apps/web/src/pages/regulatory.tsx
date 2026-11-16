// In-licensing & Regulatory (docs/PLAN.md 16.9). The In-licensing team's pipeline (a product from
// first look to launch, each with its next step and day) and Regulatory Affairs' registrations (the
// FDA CPRs: filed, approved, valid until, renewal flagged from 180 days, urgent from 90). Each team
// changes its own list and reads the other's; the Founder reads both; the bidding desk reads the
// approved CPRs under Documents.

import type { Catalogue, PipelineRow, PipelineStage, RegEvent, RegistrationRow, RegistrationStatus, RegulatoryDesk } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";
import { Button, CARD, dayLabel, Dialog, PageHead, PageState, Problem, useAction } from "../ui";

export const STAGE: Record<PipelineStage, string> = {
  identified: "Identified", talks: "In talks", agreement: "Agreement signed", dossier: "Dossier in hand",
  filed: "Filed with the FDA", registered: "Registered", launched: "Launched", dropped: "Dropped",
};
const STATUS: Record<RegistrationStatus, string> = {
  preparing: "Preparing", filed: "Filed", approved: "Approved", renewal_filed: "Renewal filed", expired: "Expired", withdrawn: "Withdrawn",
};
const FLAG = { urgent: "text-rose-700", expired: "text-rose-700", soon: "text-amber-700" } as const;
const LIVE: PipelineStage[] = ["identified", "talks", "agreement", "dossier", "filed"];

export const useRegulatory = () => useQuery({ queryKey: ["regulatory"], queryFn: () => api<RegulatoryDesk>("/api/regulatory/desk") });
const label = "block text-[12.5px] font-semibold text-slate-600";

function History({ path, title, onClose }: { path: string; title: string; onClose: () => void }) {
  const query = useQuery({ queryKey: ["regulatory", "history", path], queryFn: () => api<RegEvent[]>(path) });
  return (
    <Dialog title={title} sub="Every change, newest first" onClose={onClose}>
      {!query.data ? (
        <PageState query={query} what="the history" />
      ) : (
        <ul className="divide-y divide-slate-100 text-[13px]">
          {query.data.map((e, i) => (
            <li key={i} className="flex justify-between gap-3 py-2">
              <span className="text-slate-800">{e.what}</span>
              <span className="shrink-0 text-[12px] text-slate-500">
                {e.by} · {e.at}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

function PipelineDialog({ row, people, onClose }: { row: PipelineRow | null; people: RegulatoryDesk["people"]; onClose: () => void }) {
  const queries = useQueryClient();
  const action = useAction();
  const [form, setForm] = useState({
    name: row?.name ?? "", generic: row?.generic ?? "", strength: row?.strength ?? "", partner: row?.partner ?? "", country: row?.country ?? "",
    stage: row?.stage ?? ("identified" as PipelineStage), handledBy: row?.handledBy ? String(row.handledBy.id) : "",
    nextStep: row?.nextStep ?? "", nextOn: row?.nextOn ?? "", note: row?.note ?? "",
  });
  const text = (key: keyof typeof form, title: string, wide?: boolean) => (
    <label className={`${label} ${wide ? "sm:col-span-2" : ""}`}>
      {title}
      <input className="field h-10 w-full" value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} />
    </label>
  );
  return (
    <Dialog title={row ? row.name : "A product for the pipeline"} sub="From first look to launch; at Dossier in hand it goes to Regulatory Affairs" onClose={onClose} busy={action.busy} wide>
      <div className="grid gap-3 sm:grid-cols-2">
        {text("name", "Product")}
        {text("generic", "Generic name")}
        {text("strength", "Strength")}
        {text("partner", "Partner (manufacturer)")}
        {text("country", "Country")}
        <label className={label}>
          Stage
          <select className="field h-10 w-full" value={form.stage} onChange={(event) => setForm({ ...form, stage: event.target.value as PipelineStage })}>
            {Object.entries(STAGE).map(([value, word]) => (
              <option key={value} value={value}>
                {word}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Handled by
          <select className="field h-10 w-full" value={form.handledBy} onChange={(event) => setForm({ ...form, handledBy: event.target.value })}>
            <option value="">Me</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.title}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Next step by
          <input type="date" className="field h-10 w-full" value={form.nextOn} onChange={(event) => setForm({ ...form, nextOn: event.target.value })} />
        </label>
        {text("nextStep", "Next step", true)}
        {text("note", "Note", true)}
      </div>
      <Problem message={action.problem?.message} />
      <div className="mt-3 flex justify-end">
        <Button
          variant="primary"
          disabled={action.busy || form.name.trim().length < 2}
          onClick={() =>
            void action.run(async () => {
              const { handledBy, nextOn, ...rest } = form;
              await api(row ? `/api/regulatory/pipeline/${row.id}` : "/api/regulatory/pipeline", {
                method: "POST",
                body: { ...rest, handledBy: handledBy ? Number(handledBy) : null, nextOn: nextOn || null },
              });
              await queries.invalidateQueries({ queryKey: ["regulatory"] });
              onClose();
            })
          }
        >
          Save
        </Button>
      </div>
    </Dialog>
  );
}

function RegistrationDialog({ row, people, onClose }: { row: RegistrationRow | null; people: RegulatoryDesk["people"]; onClose: () => void }) {
  const queries = useQueryClient();
  const action = useAction();
  const medicines = useQuery({ queryKey: ["inventory", "medicines"], queryFn: () => api<Catalogue>("/api/inventory/medicines") });
  const [form, setForm] = useState({
    product: row?.product ?? "", medicineId: row?.medicineId ? String(row.medicineId) : "", number: row?.number ?? "",
    status: row?.status ?? ("preparing" as RegistrationStatus), filedOn: row?.filedOn ?? "", validUntil: row?.validUntil ?? "",
    handledBy: row?.handledBy ? String(row.handledBy.id) : "", note: row?.note ?? "",
  });
  return (
    <Dialog title={row ? row.product : "A registration (CPR)"} sub="The FDA's Certificate of Product Registration: filed, approved, valid until" onClose={onClose} busy={action.busy} wide>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={label}>
          Product
          <input className="field h-10 w-full" value={form.product} onChange={(event) => setForm({ ...form, product: event.target.value })} />
        </label>
        <label className={label}>
          Medicine we sell (if it is one)
          <select
            className="field h-10 w-full"
            value={form.medicineId}
            onChange={(event) => {
              const m = medicines.data?.rows.find((x) => String(x.id) === event.target.value);
              setForm({ ...form, medicineId: event.target.value, product: form.product || (m ? `${m.name} ${m.strength ?? ""}`.trim() : "") });
            }}
          >
            <option value="">Not in our list yet</option>
            {(medicines.data?.rows ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} {m.strength ?? ""}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Status
          <select className="field h-10 w-full" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as RegistrationStatus })}>
            {Object.entries(STATUS).map(([value, word]) => (
              <option key={value} value={value}>
                {word}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          CPR number
          <input className="field h-10 w-full" value={form.number} onChange={(event) => setForm({ ...form, number: event.target.value })} />
        </label>
        <label className={label}>
          Filed with the FDA on
          <input type="date" className="field h-10 w-full" value={form.filedOn} onChange={(event) => setForm({ ...form, filedOn: event.target.value })} />
        </label>
        <label className={label}>
          Valid until
          <input type="date" className="field h-10 w-full" value={form.validUntil} onChange={(event) => setForm({ ...form, validUntil: event.target.value })} />
        </label>
        <label className={label}>
          Handled by
          <select className="field h-10 w-full" value={form.handledBy} onChange={(event) => setForm({ ...form, handledBy: event.target.value })}>
            <option value="">Me</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.title}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Note
          <input className="field h-10 w-full" value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} />
        </label>
      </div>
      <Problem message={action.problem?.message} />
      <div className="mt-3 flex justify-end">
        <Button
          variant="primary"
          disabled={action.busy || form.product.trim().length < 2}
          onClick={() =>
            void action.run(async () => {
              await api(row ? `/api/regulatory/registrations/${row.id}` : "/api/regulatory/registrations", {
                method: "POST",
                body: {
                  product: form.product, medicineId: form.medicineId ? Number(form.medicineId) : null, number: form.number || null, status: form.status,
                  filedOn: form.filedOn || null, validUntil: form.validUntil || null, handledBy: form.handledBy ? Number(form.handledBy) : null, note: form.note || null,
                },
              });
              await queries.invalidateQueries({ queryKey: ["regulatory"] });
              onClose();
            })
          }
        >
          Save
        </Button>
      </div>
    </Dialog>
  );
}

export function PipelineList({ data, only }: { data: RegulatoryDesk; only?: "live" }) {
  const [editing, setEditing] = useState<PipelineRow | null | "new">(null);
  const [history, setHistory] = useState<PipelineRow | null>(null);
  const shown = only === "live" ? data.pipeline.filter((p) => LIVE.includes(p.stage)) : data.pipeline;
  return (
    <section className={`${CARD} min-w-0`}>
      <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <h3 className="text-sm font-bold text-slate-900">Pipeline (In-licensing)</h3>
        {data.canPipeline && (
          <Button small onClick={() => setEditing("new")}>
            Add a product
          </Button>
        )}
      </header>
      {shown.length === 0 ? (
        <p className="px-4 py-3 text-[13px] text-slate-500">No product in the pipeline.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {shown.map((p) => {
            const late = p.nextOn && p.nextOn < data.today && LIVE.includes(p.stage);
            return (
              <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-slate-900">
                    {p.name} {p.strength} <span className="font-normal text-slate-500">· {[p.partner, p.country].filter(Boolean).join(", ") || "no partner yet"}</span>
                  </span>
                  <span className={`text-[11.5px] ${late ? "text-rose-700" : "text-slate-500"}`}>
                    {STAGE[p.stage]}
                    {p.nextStep && ` · next: ${p.nextStep}`}
                    {p.nextOn && ` by ${dayLabel(p.nextOn)}`}
                    {late && " (late)"}
                    {p.handledBy && ` · ${p.handledBy.name}`}
                  </span>
                </span>
                <Button small variant="quiet" onClick={() => setHistory(p)}>
                  History
                </Button>
                {data.canPipeline && (
                  <Button small onClick={() => setEditing(p)}>
                    Change
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {editing && <PipelineDialog row={editing === "new" ? null : editing} people={data.people} onClose={() => setEditing(null)} />}
      {history && <History path={`/api/regulatory/pipeline/${history.id}/history`} title={history.name} onClose={() => setHistory(null)} />}
    </section>
  );
}

export function RegistrationList({ data, only }: { data: RegulatoryDesk; only?: "flagged" }) {
  const [editing, setEditing] = useState<RegistrationRow | null | "new">(null);
  const [history, setHistory] = useState<RegistrationRow | null>(null);
  const shown = only === "flagged" ? data.registrations.filter((r) => r.flag || ["preparing", "filed", "renewal_filed"].includes(r.status)) : data.registrations;
  return (
    <section className={`${CARD} min-w-0`}>
      <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <h3 className="text-sm font-bold text-slate-900">{only === "flagged" ? "Registrations needing work" : "Registrations (CPRs)"}</h3>
        {data.canRegistrations && (
          <Button small onClick={() => setEditing("new")}>
            Add a registration
          </Button>
        )}
      </header>
      {shown.length === 0 ? (
        <p className="px-4 py-3 text-[13px] text-slate-500">{only === "flagged" ? "Nothing to renew or follow up." : "No registration recorded."}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {shown.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-slate-900">
                  {r.product} {r.number && <span className="font-normal text-slate-500">· {r.number}</span>}
                </span>
                <span className={`text-[11.5px] ${r.flag ? FLAG[r.flag] : "text-slate-500"}`}>
                  {STATUS[r.status]}
                  {r.filedOn && ` · filed ${dayLabel(r.filedOn)}`}
                  {r.validUntil && ` · valid until ${dayLabel(r.validUntil)}`}
                  {r.flag === "expired" && " · expired: file the renewal"}
                  {(r.flag === "urgent" || r.flag === "soon") && ` · ${r.daysLeft} days left, no renewal filed`}
                  {r.handledBy && ` · ${r.handledBy.name}`}
                </span>
              </span>
              <Button small variant="quiet" onClick={() => setHistory(r)}>
                History
              </Button>
              {data.canRegistrations && (
                <Button small onClick={() => setEditing(r)}>
                  Change
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && <RegistrationDialog row={editing === "new" ? null : editing} people={data.people} onClose={() => setEditing(null)} />}
      {history && <History path={`/api/regulatory/registrations/${history.id}/history`} title={history.product} onClose={() => setHistory(null)} />}
    </section>
  );
}

function Tiles({ data }: { data: RegulatoryDesk }) {
  const live = data.pipeline.filter((p) => LIVE.includes(p.stage));
  const tiles: [string, string, string][] = [
    ["CPRs to renew", String(data.registrations.filter((r) => r.flag).length), "within 180 days or expired"],
    ["Waiting at the FDA", String(data.registrations.filter((r) => ["filed", "renewal_filed"].includes(r.status)).length), "filed or renewal filed"],
    ["Products in the pipeline", String(live.length), `${live.filter((p) => p.nextOn && p.nextOn < data.today).length} next steps late`],
    ["Being prepared", String(data.registrations.filter((r) => r.status === "preparing").length), "handed over, not filed yet"],
  ];
  const order = data.team === "inlicensing" ? [2, 3, 0, 1] : [0, 1, 3, 2];
  return (
    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {order.map((i) => {
        const [title, value, sub] = tiles[i] as [string, string, string];
        return (
          <div key={title} className={`${CARD} px-4 py-3`}>
            <div className="text-[11px] font-semibold text-slate-500">{title}</div>
            <div className="text-xl font-bold text-slate-900 tabular-nums">{value}</div>
            <div className="truncate text-[11px] text-slate-400">{sub}</div>
          </div>
        );
      })}
    </section>
  );
}

/** The Home of In-licensing & Regulatory's people: their own team's list first. */
export function RegulatoryHome() {
  const query = useRegulatory();
  const data = query.data;
  if (!data) return <PageState query={query} what="the pipeline and registrations" />;
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Tiles data={data} />
      {data.team === "inlicensing" ? (
        <>
          <PipelineList data={data} only="live" />
          <RegistrationList data={data} only="flagged" />
        </>
      ) : (
        <>
          <RegistrationList data={data} only="flagged" />
          <PipelineList data={data} only="live" />
        </>
      )}
    </div>
  );
}

export function PipelinePage() {
  const query = useRegulatory();
  const data = query.data;
  if (!data) return <PageState query={query} what="the pipeline" />;
  return (
    <div className="mx-auto max-w-5xl space-y-3">
      <PageHead title="Pipeline" sub="Products the In-licensing team is bringing in, from first look to launch, with each one's next step" />
      <PipelineList data={data} />
    </div>
  );
}

export function RegistrationsPage() {
  const query = useRegulatory();
  const data = query.data;
  if (!data) return <PageState query={query} what="the registrations" />;
  return (
    <div className="mx-auto max-w-5xl space-y-3">
      <PageHead title="Registrations (CPRs)" sub="Each product's FDA registration; a renewal is flagged 180 days before it runs out, urgent at 90" />
      <RegistrationList data={data} />
    </div>
  );
}

/** For the Founder's Reports: both lists. */
export function RegulatoryReportPage() {
  const query = useRegulatory();
  const data = query.data;
  if (!data) return <PageState query={query} what="the pipeline and registrations" />;
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHead title="In-licensing & Regulatory" sub="The product pipeline and the FDA registrations" />
      <Tiles data={data} />
      <RegistrationList data={data} />
      <PipelineList data={data} />
    </div>
  );
}
