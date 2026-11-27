// CLIDP's road (Aryan, 19 Nov: "the CLIDP page: how many pharmacies we went to, did they approve us,
// at what rate"): each pharmacy or distributor from the first visit to ordering — approached,
// interested, agreed (the distributorship agreement and the rate per medicine), listing filed with
// the FDA, listed (the certificate), ordering — or declined with why; the rate agreed and the
// price it really pays, its listings and their validity, the agreement's end, the next step,
// whether it is due or late to reorder, and what it owes. The coach works their own; a lead sees
// every CLIDP coach under them, coach by coach.

import type { Catalogue, ClidpRoad, ClidpStage, CustomerList } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useMe } from "../auth";
import { exactPeso, shortPeso } from "../ceo";
import { withUnit } from "../team/switch";
import { Button, CARD, Dialog, PageHead, PageState, Problem, peso, useAction } from "../ui";
import { EmptyState } from "../no-results";

type Row = ClidpRoad["rows"][number];

export const STAGE: Record<ClidpStage, { word: string; pill: string; hint: string }> = {
  approached: { word: "Approached", pill: "bg-slate-100 text-slate-700", hint: "visited or called" },
  interested: { word: "Interested", pill: "bg-sky-50 text-sky-800", hint: "wants to list it" },
  agreed: { word: "Agreed", pill: "bg-violet-50 text-violet-800", hint: "agreement and rate agreed" },
  filed: { word: "Listing filed", pill: "bg-amber-50 text-amber-800", hint: "with the FDA (30 working days)" },
  listed: { word: "Listed", pill: "bg-emerald-50 text-emerald-800", hint: "the CLIDP certificate in hand" },
  ordering: { word: "Ordering", pill: "bg-emerald-600 text-white", hint: "buying from us" },
  declined: { word: "Declined", pill: "bg-rose-50 text-rose-800", hint: "said no, with why" },
};
const ORDER: ClidpStage[] = ["approached", "interested", "agreed", "filed", "listed", "ordering", "declined"];
const REORDER: Record<NonNullable<Row["reorder"]>, string> = {
  ok: "Buying",
  due: "Due this week",
  late: "Late",
  stopped: "Stopped 90+ days",
  lost: "Lost 180+ days",
};
const day = (value: string | null) =>
  value ? new Date(`${value}T00:00:00Z`).toLocaleDateString("en-PH", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—";
const toCentavos = (pesos: string) => Math.round(Number(pesos.replace(/[^\d.]/g, "")) * 100) || 0;

function useRoad(unit: number | null = null) {
  return useQuery({
    queryKey: ["clidp", "road", unit ?? ""],
    queryFn: () => api<ClidpRoad>(withUnit("/api/clidp/road", unit ? String(unit) : null)),
  });
}

export function ClidpRoadPage() {
  const query = useRoad();
  const data = query.data;
  if (!data) return <PageState query={query} what="CLIDP's road" />;
  return (
    <div className="mx-auto w-full max-w-6xl space-y-4">
      <PageHead title="Pharmacies and distributors" sub="CLIDP's road: who we went to, who agreed, at what rate, their listings and orders" />
      <Road data={data} />
    </div>
  );
}

/** CLIDP's road on a Home (the coach's, or a head's CLIDP channel for one box). */
export function ClidpRoadCard({ unit = null }: { unit?: number | null }) {
  const query = useRoad(unit);
  if (!query.data) return null;
  return <Road data={query.data} limit={12} />;
}

function Road({ data, limit }: { data: ClidpRoad; limit?: number }) {
  const me = useMe().data;
  const [stage, setStage] = useState<ClidpStage | "all">("all");
  const [all, setAll] = useState(!limit);
  const [adding, setAdding] = useState(false);
  const [moving, setMoving] = useState<Row | null>(null);
  const [rating, setRating] = useState<Row | null>(null);
  const canEdit = data.canEdit && !me?.viewedBy;
  const shown = data.rows.filter((row) => stage === "all" || row.stage === stage);
  const page = all ? shown : shown.slice(0, limit ?? shown.length);
  return (
    <div className="space-y-3">
      {/* The road, stage by stage: a press shows the accounts at it. */}
      <section className={`${CARD} p-4`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-bold text-slate-900">CLIDP's road</h3>
          <span className="text-[12px] text-slate-500">
            This month: {data.month.approached} approached · {data.month.agreed} agreed · {data.month.listed} listed ·{" "}
            {data.month.firstOrders} first orders · {data.month.declined} declined
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {ORDER.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setStage(stage === key ? "all" : key)}
              aria-pressed={stage === key}
              className={`rounded-xl border px-3 py-2 text-left ${stage === key ? "border-emerald-500 bg-emerald-50" : "border-slate-200 hover:bg-slate-50"}`}
            >
              <span className="block text-[11.5px] font-semibold text-slate-500">{STAGE[key].word}</span>
              <span className="block text-xl font-semibold text-slate-900 tabular-nums">{data.counts[key]}</span>
              <span className="block truncate text-[10.5px] text-slate-400">{STAGE[key].hint}</span>
            </button>
          ))}
        </div>
      </section>

      {/* A lead's coaches side by side. */}
      {data.coaches.length > 1 && (
        <section className={`${CARD} min-w-0 overflow-x-auto`}>
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-[10.5px] font-semibold tracking-wide text-slate-400 uppercase">
                <th className="px-4 py-2">Sales Coach</th>
                <th className="px-3 py-2 text-right">Approached</th>
                <th className="px-3 py-2 text-right">Agreed</th>
                <th className="px-3 py-2 text-right">Listed</th>
                <th className="px-3 py-2 text-right">Ordering</th>
                <th className="px-3 py-2 text-right">Late or stopped</th>
                <th className="px-3 py-2 text-right">Listings ending</th>
                <th className="px-3 py-2 text-right">Owed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.coaches.map((one) => (
                <tr key={one.personId}>
                  <td className="px-4 py-2 font-semibold text-slate-900">{one.name}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{one.approached}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{one.agreed}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{one.listed}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{one.ordering}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${one.late ? "text-amber-700" : ""}`}>{one.late}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${one.listingsEnding ? "text-rose-700" : ""}`}>{one.listingsEnding}</td>
                  <td className="px-3 py-2 text-right tabular-nums" title={`Overdue ${exactPeso(one.overdue)}`}>
                    {shortPeso(one.owed)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className={`${CARD} min-w-0`}>
        <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <h3 className="text-sm font-bold text-slate-900">
            {stage === "all" ? "Every pharmacy and distributor" : STAGE[stage].word}{" "}
            <span className="font-normal text-slate-400">· {shown.length}</span>
          </h3>
          <span className="flex items-center gap-3">
            {limit && (
              <Link to="/clidp/road" className="text-[12.5px] font-semibold text-emerald-700 hover:underline">
                The whole road
              </Link>
            )}
            {canEdit && (
              <Button small variant="primary" onClick={() => setAdding(true)}>
                Add a pharmacy we went to
              </Button>
            )}
          </span>
        </header>
        {shown.length === 0 ? (
          <EmptyState title="None at this stage.">Pharmacies and distributors at this stage of the road show here.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left text-[10.5px] font-semibold tracking-wide text-slate-400 uppercase">
                  <th className="px-4 py-2">Pharmacy or distributor</th>
                  <th className="px-3 py-2">Stage</th>
                  <th className="px-3 py-2">Rate</th>
                  <th className="px-3 py-2">Listing</th>
                  <th className="px-3 py-2">Orders</th>
                  <th className="px-3 py-2 text-right">Owed</th>
                  <th className="px-3 py-2">Next</th>
                  {canEdit && <th className="px-3 py-2" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {page.map((row) => (
                  <tr key={row.customerId} className="align-top">
                    <td className="max-w-60 px-4 py-2">
                      <Link to={`/customers/${row.customerId}`} className="block truncate font-semibold text-slate-900 hover:underline">
                        {row.name}
                      </Link>
                      <span className="block truncate text-[11px] text-slate-500">
                        {[row.kind, row.city, row.coach].filter(Boolean).join(" · ")}
                      </span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${STAGE[row.stage].pill}`}>{STAGE[row.stage].word}</span>
                      <span className="mt-0.5 block text-[11px] text-slate-500">since {day(row.stageOn)}</span>
                      {row.declinedReason && <span className="block text-[11px] text-rose-700">{row.declinedReason}</span>}
                      {row.agreementUntil && <span className="block text-[11px] text-slate-500">agreement to {day(row.agreementUntil)}</span>}
                    </td>
                    <td className="max-w-56 px-3 py-2 text-[12px]">
                      {row.rates.map((rate) => (
                        <span key={`r-${rate.medicine}`} className="block">
                          <b>{peso(rate.unitPrice)}</b> {rate.medicine}
                          {rate.moq ? ` · min ${rate.moq}` : ""} <span className="text-slate-400">agreed {day(rate.agreedOn)}</span>
                        </span>
                      ))}
                      {row.lastPrices.map((price) => (
                        <span key={`p-${price.medicine}`} className="block text-slate-600">
                          paid {peso(price.unitPrice)} for {price.medicine} <span className="text-slate-400">({day(price.on)})</span>
                        </span>
                      ))}
                      {row.rates.length === 0 && row.lastPrices.length === 0 && <span className="text-slate-400">—</span>}
                    </td>
                    <td className="max-w-48 px-3 py-2 text-[12px]">
                      {row.listings.length === 0 ? (
                        <span className="text-slate-400">—</span>
                      ) : (
                        row.listings.map((listing) => (
                          <span key={`${listing.brand}-${listing.medicine}`} className="block">
                            <b>{listing.brand}</b> ({listing.medicine})
                            <span
                              className={`block text-[11px] ${listing.state === "expired" ? "text-rose-700" : listing.state === "expiring" ? "text-amber-700" : "text-slate-500"}`}
                            >
                              {listing.certificateNo ?? "no number"} · {listing.validUntil ? `valid to ${day(listing.validUntil)}` : "no date"}
                            </span>
                          </span>
                        ))
                      )}
                    </td>
                    <td className="px-3 py-2 text-[12px] whitespace-nowrap">
                      {row.lastOrderOn ? (
                        <>
                          last {day(row.lastOrderOn)}
                          {row.reorder && (
                            <span className={`block text-[11px] ${row.reorder === "late" || row.reorder === "stopped" ? "text-amber-700" : "text-slate-500"}`}>
                              {REORDER[row.reorder]}
                              {row.usual ? ` · every ~${row.usual} days` : ""}
                            </span>
                          )}
                          {row.soldYear > 0 && <span className="block text-[11px] text-slate-500">{shortPeso(row.soldYear)} a year</span>}
                        </>
                      ) : (
                        <span className="text-slate-400">No order yet</span>
                      )}
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums ${row.overdue ? "text-rose-700" : ""}`} title={`Overdue ${exactPeso(row.overdue)}`}>
                      {row.owed ? shortPeso(row.owed) : "—"}
                    </td>
                    <td className="max-w-44 px-3 py-2 text-[12px]">
                      {row.nextStep ? (
                        <>
                          {row.nextStep}
                          {row.nextOn && <span className="block text-[11px] text-slate-500">{day(row.nextOn)}</span>}
                        </>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    {canEdit && (
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <button type="button" onClick={() => setMoving(row)} className="text-[12px] font-semibold text-emerald-700 hover:underline">
                          Move
                        </button>
                        <button type="button" onClick={() => setRating(row)} className="ml-3 text-[12px] font-semibold text-emerald-700 hover:underline">
                          Rate
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {shown.length > page.length && (
          <button
            type="button"
            onClick={() => setAll(true)}
            className="w-full border-t border-slate-100 px-4 py-2.5 text-[12.5px] font-semibold text-emerald-700 hover:bg-slate-50"
          >
            Show all {shown.length}
          </button>
        )}
      </section>
      {adding && <AddDialog coaches={data.coaches} onClose={() => setAdding(false)} />}
      {moving && <MoveDialog row={moving} onClose={() => setMoving(null)} />}
      {rating && <RateDialog row={rating} onClose={() => setRating(null)} />}
    </div>
  );
}

function AddDialog({ coaches, onClose }: { coaches: ClidpRoad["coaches"]; onClose: () => void }) {
  const queries = useQueryClient();
  const action = useAction();
  const me = useMe().data;
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<{ id: number; name: string } | null>(null);
  const [form, setForm] = useState({ on: "", note: "", nextStep: "", nextOn: "", coachId: String(coaches[0]?.personId ?? "") });
  const found = useQuery({
    queryKey: ["customers", "clidp", q],
    queryFn: () => api<CustomerList>(`/api/customers?q=${encodeURIComponent(q)}&page=1`),
    enabled: q.trim().length >= 2,
  });
  const choices = (found.data?.rows ?? []).filter((row) => ["distributor", "drugstore", "hospital"].includes(row.kind));
  const lead = me && me.role !== "medrep";
  return (
    <Dialog title="A pharmacy or distributor we went to" sub="It starts on CLIDP's road as approached" onClose={onClose} busy={action.busy}>
      <label className="block text-[12.5px] font-semibold text-slate-600">
        Pharmacy or distributor
        <input className="field h-10 w-full" placeholder="Type to search" value={q} onChange={(event) => setQ(event.target.value)} />
      </label>
      {choices.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {choices.slice(0, 10).map((one) => (
            <button
              key={one.id}
              type="button"
              onClick={() => setPicked({ id: one.id, name: one.name })}
              className={`rounded-md px-2 py-1 text-[12px] ring-1 ${picked?.id === one.id ? "bg-brand text-white ring-brand" : "text-slate-700 ring-slate-200"}`}
            >
              {one.name}
            </button>
          ))}
        </div>
      )}
      <p className="mt-1 text-[11.5px] text-slate-500">
        Not on the list? Add them first under Customers (a distributor or a drugstore), then here.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {lead && coaches.length > 0 && (
          <label className="block text-[12.5px] font-semibold text-slate-600 sm:col-span-2">
            Sales Coach who works it
            <select className="field h-10 w-full" value={form.coachId} onChange={(event) => setForm({ ...form, coachId: event.target.value })}>
              {coaches.map((one) => (
                <option key={one.personId} value={one.personId}>
                  {one.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="block text-[12.5px] font-semibold text-slate-600">
          Went on (today if empty)
          <input type="date" className="field h-10 w-full" value={form.on} onChange={(event) => setForm({ ...form, on: event.target.value })} />
        </label>
        <label className="block text-[12.5px] font-semibold text-slate-600">
          Next step on
          <input type="date" className="field h-10 w-full" value={form.nextOn} onChange={(event) => setForm({ ...form, nextOn: event.target.value })} />
        </label>
        <label className="block text-[12.5px] font-semibold text-slate-600 sm:col-span-2">
          Next step
          <input
            className="field h-10 w-full"
            placeholder="Send the rate, visit the owner, collect the LTO"
            value={form.nextStep}
            onChange={(event) => setForm({ ...form, nextStep: event.target.value })}
          />
        </label>
        <label className="block text-[12.5px] font-semibold text-slate-600 sm:col-span-2">
          What they said
          <textarea className="field min-h-16 w-full" value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} />
        </label>
      </div>
      <Problem message={action.problem?.message} />
      <div className="mt-3 flex justify-end">
        <Button
          variant="primary"
          disabled={action.busy || !picked}
          onClick={() =>
            void action.run(async () => {
              await api("/api/clidp/road", {
                method: "POST",
                body: {
                  customerId: picked?.id,
                  on: form.on || null,
                  note: form.note || null,
                  nextStep: form.nextStep || null,
                  nextOn: form.nextOn || null,
                  coachId: lead && form.coachId ? Number(form.coachId) : null,
                },
              });
              await queries.invalidateQueries({ queryKey: ["clidp"] });
              onClose();
            })
          }
        >
          Add to the road
        </Button>
      </div>
    </Dialog>
  );
}

function MoveDialog({ row, onClose }: { row: Row; onClose: () => void }) {
  const queries = useQueryClient();
  const action = useAction();
  const next = ORDER[Math.min(ORDER.indexOf(row.stage) + 1, ORDER.length - 2)] as ClidpStage;
  const [form, setForm] = useState({
    stage: next,
    on: "",
    agreementUntil: row.agreementUntil ?? "",
    declinedReason: "",
    nextStep: row.nextStep ?? "",
    nextOn: row.nextOn ?? "",
    note: "",
  });
  return (
    <Dialog title={row.name} sub={`Now ${STAGE[row.stage].word.toLowerCase()}`} onClose={onClose} busy={action.busy}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-[12.5px] font-semibold text-slate-600">
          Move to
          <select
            className="field h-10 w-full"
            value={form.stage}
            onChange={(event) => setForm({ ...form, stage: event.target.value as ClidpStage })}
          >
            {ORDER.map((key) => (
              <option key={key} value={key}>
                {STAGE[key].word}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[12.5px] font-semibold text-slate-600">
          On (today if empty)
          <input type="date" className="field h-10 w-full" value={form.on} onChange={(event) => setForm({ ...form, on: event.target.value })} />
        </label>
        {["agreed", "filed", "listed", "ordering"].includes(form.stage) && (
          <label className="block text-[12.5px] font-semibold text-slate-600 sm:col-span-2">
            The distributorship agreement runs to
            <input
              type="date"
              className="field h-10 w-full"
              value={form.agreementUntil}
              onChange={(event) => setForm({ ...form, agreementUntil: event.target.value })}
            />
          </label>
        )}
        {form.stage === "declined" && (
          <label className="block text-[12.5px] font-semibold text-slate-600 sm:col-span-2">
            Why they said no
            <input
              className="field h-10 w-full"
              placeholder="Price too high, already lists another, no LTO"
              value={form.declinedReason}
              onChange={(event) => setForm({ ...form, declinedReason: event.target.value })}
            />
          </label>
        )}
        <label className="block text-[12.5px] font-semibold text-slate-600">
          Next step
          <input className="field h-10 w-full" value={form.nextStep} onChange={(event) => setForm({ ...form, nextStep: event.target.value })} />
        </label>
        <label className="block text-[12.5px] font-semibold text-slate-600">
          Next step on
          <input type="date" className="field h-10 w-full" value={form.nextOn} onChange={(event) => setForm({ ...form, nextOn: event.target.value })} />
        </label>
        <label className="block text-[12.5px] font-semibold text-slate-600 sm:col-span-2">
          Note
          <textarea className="field min-h-16 w-full" value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} />
        </label>
      </div>
      {form.stage === "listed" && (
        <p className="mt-2 text-[12px] text-slate-500">
          Add the certificate (their brand, its number and validity) under Listings, so its end is watched.
        </p>
      )}
      <Problem message={action.problem?.message} />
      <div className="mt-3 flex justify-end">
        <Button
          variant="primary"
          disabled={action.busy}
          onClick={() =>
            void action.run(async () => {
              await api(`/api/clidp/road/${row.customerId}`, {
                method: "POST",
                body: {
                  stage: form.stage,
                  on: form.on || null,
                  agreementUntil: form.agreementUntil || null,
                  declinedReason: form.declinedReason || null,
                  nextStep: form.nextStep || null,
                  nextOn: form.nextOn || null,
                  note: form.note || null,
                },
              });
              await queries.invalidateQueries({ queryKey: ["clidp"] });
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

function RateDialog({ row, onClose }: { row: Row; onClose: () => void }) {
  const queries = useQueryClient();
  const action = useAction();
  const medicines = useQuery({ queryKey: ["inventory", "medicines"], queryFn: () => api<Catalogue>("/api/inventory/medicines") });
  const [form, setForm] = useState({ medicineId: "", price: "", moq: "", on: "" });
  return (
    <Dialog title={`The rate agreed with ${row.name}`} sub="One piece, VAT in, and the least they order" onClose={onClose} busy={action.busy}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-[12.5px] font-semibold text-slate-600 sm:col-span-2">
          Our medicine
          <select className="field h-10 w-full" value={form.medicineId} onChange={(event) => setForm({ ...form, medicineId: event.target.value })}>
            <option value="">Pick</option>
            {(medicines.data?.rows ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} {m.strength ?? ""}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[12.5px] font-semibold text-slate-600">
          Rate for one piece (₱)
          <input className="field h-10 w-full" inputMode="decimal" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} />
        </label>
        <label className="block text-[12.5px] font-semibold text-slate-600">
          Least they order (pieces)
          <input className="field h-10 w-full" inputMode="numeric" value={form.moq} onChange={(event) => setForm({ ...form, moq: event.target.value })} />
        </label>
        <label className="block text-[12.5px] font-semibold text-slate-600">
          Agreed on (today if empty)
          <input type="date" className="field h-10 w-full" value={form.on} onChange={(event) => setForm({ ...form, on: event.target.value })} />
        </label>
      </div>
      <Problem message={action.problem?.message} />
      <div className="mt-3 flex justify-end">
        <Button
          variant="primary"
          disabled={action.busy || !form.medicineId || !form.price.trim()}
          onClick={() =>
            void action.run(async () => {
              await api("/api/clidp/rates", {
                method: "POST",
                body: {
                  customerId: row.customerId,
                  medicineId: Number(form.medicineId),
                  unitPrice: toCentavos(form.price),
                  moq: form.moq.trim() ? Number(form.moq) : null,
                  on: form.on || null,
                },
              });
              await queries.invalidateQueries({ queryKey: ["clidp"] });
              onClose();
            })
          }
        >
          Save the rate
        </Button>
      </div>
    </Dialog>
  );
}
