// The hospitals board (Aryan, 19 Nov: "which hospitals each has, whom to call, every relevant
// thing"; docs/CHANNEL-WORK.md HOSP): each hospital with 2MG's accreditation there and when it
// ends, our medicines on its formulary (asked by its doctors, decided by its P&T committee), its
// buying against its own reorder gap, its open orders (POs waiting to be delivered), what it owes,
// the last visit and the next one, the last call. A CHC's own; a team lead's team; a head's
// division (one box when one is pressed on the Home).

import type { Catalogue, HospitalBoard } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useMe } from "../auth";
import { exactPeso, shortPeso } from "../ceo";
import { withUnit } from "../team/switch";
import { Button, CARD, Dialog, PageHead, PageState, Problem, useAction } from "../ui";
import { NoResults } from "../no-results";
import { STRIP } from "../home/figures";

type Row = HospitalBoard["rows"][number];
type Filter = "all" | "papers" | "ending" | "formulary" | "due" | "late" | "stopped" | "owing" | "open";

const ACCREDITATION: Record<Row["accreditation"]["state"], { word: string; tone: string }> = {
  none: { word: "Not accredited", tone: "text-slate-500" },
  applied: { word: "Applied", tone: "text-sky-700" },
  accredited: { word: "Accredited", tone: "text-emerald-700" },
  expiring: { word: "Ending soon", tone: "text-amber-700" },
  expired: { word: "Expired", tone: "text-rose-700" },
  refused: { word: "Refused", tone: "text-rose-700" },
};
const REORDER: Record<Row["reorder"], { word: string; tone: string }> = {
  never: { word: "Never ordered", tone: "text-slate-400" },
  ok: { word: "Buying", tone: "text-emerald-700" },
  due: { word: "Due this week", tone: "text-amber-700" },
  late: { word: "Late", tone: "text-orange-700" },
  stopped: { word: "Stopped 90+ days", tone: "text-rose-700" },
  lost: { word: "Lost 180+ days", tone: "text-slate-500" },
};
const FORMULARY: Record<Row["formulary"]["items"][number]["status"], string> = {
  requested: "requested",
  approved: "approved",
  not_approved: "not approved",
  removed: "removed",
};
const day = (value: string | null) =>
  value ? new Date(`${value}T00:00:00Z`).toLocaleDateString("en-PH", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—";
const ago = (days: number | null) => (days === null ? "—" : days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`);

function useHospitals(unit: number | null = null) {
  return useQuery({
    queryKey: ["hospitals", unit ?? ""],
    queryFn: () => api<HospitalBoard>(withUnit("/api/hospitals", unit ? String(unit) : null)),
  });
}

export function HospitalsPage() {
  const me = useMe().data;
  const query = useHospitals();
  if (!query.data) return <PageState query={query} what="the hospitals" />;
  return (
    <div className="mx-auto w-full max-w-6xl space-y-4">
      <PageHead
        title={me?.role === "medrep" ? "My hospitals" : "Hospitals"}
        sub="Accreditation, formulary, buying, orders, money owed and visits, hospital by hospital"
      />
      {/* The Home's look here too (Aryan, 26 Nov): the coloured strip, the tabs above the table. */}
      <Board data={query.data} colours />
    </div>
  );
}

/** The board on a Home (a CHC's, or a head's HOSP channel for one box). */
export function HospitalsCard({ unit = null, first = "all", colours = false }: { unit?: number | null; first?: Filter; colours?: boolean }) {
  const query = useHospitals(unit);
  if (!query.data || query.data.rows.length === 0) return null;
  return <Board data={query.data} limit={12} first={first} colours={colours} />;
}

function Board({ data, limit, first = "all", colours = false }: { data: HospitalBoard; limit?: number; first?: Filter; colours?: boolean }) {
  const [filter, setFilter] = useState<Filter>(first);
  const [all, setAll] = useState(!limit);
  const [papers, setPapers] = useState<Row | null>(null);
  const [formulary, setFormulary] = useState<Row | null>(null);
  const s = data.summary;
  const pick = (row: Row) =>
    filter === "all"
      ? true
      : filter === "papers"
        ? ["none", "applied", "expired", "refused"].includes(row.accreditation.state)
        : filter === "ending"
          ? row.accreditation.state === "expiring" || row.accreditation.state === "expired"
          : filter === "formulary"
            ? row.formulary.requested > 0
            : filter === "owing"
              ? row.overdue > 0
              : filter === "open"
                ? row.openOrders > 0
                : row.reorder === filter;
  const shown = data.rows.filter(pick);
  const page = all ? shown : shown.slice(0, limit ?? shown.length);
  const tabs: [Filter, string, number][] = [
    ["all", "All", s.hospitals],
    ["due", "Due this week", s.due],
    ["late", "Late", s.late],
    ["stopped", "Stopped", s.stopped],
    ["owing", "Overdue money", data.rows.filter((row) => row.overdue > 0).length],
    ["open", "Open orders", data.rows.filter((row) => row.openOrders > 0).length],
    ["papers", "Not accredited", s.notAccredited],
    ["ending", "Accreditation ending", data.rows.filter((row) => row.accreditation.state === "expiring" || row.accreditation.state === "expired").length],
    ["formulary", "Formulary pending", data.rows.filter((row) => row.formulary.requested > 0).length],
  ];
  return (
    <div className="space-y-3">
      <section className={`grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 ${colours ? "" : "gap-3"}`}>
        {(
          [
            ["Hospitals", String(s.hospitals), `${s.due} due · ${s.late} late · ${s.stopped} stopped`],
            ["Accredited", String(s.accredited), s.expiring ? `${s.expiring} ending within 60 days` : `${s.notAccredited} not yet`],
            ["On formulary", String(s.formularyApproved), `${s.formularyPending} requests waiting`],
            ["Owed", shortPeso(s.owed), `${shortPeso(s.overdue)} overdue`],
            ["Open orders", String(s.openOrders), shortPeso(s.openValue)],
            ["Visits this month", `${s.visitsDone}`, `of ${s.visitsPlanned} planned`],
          ] as const
        ).map(([label, value, hint], n) =>
          colours ? (
            <div key={label} className={`p-3 ${STRIP[n % STRIP.length]}`}>
              <p className="text-[12px] opacity-85">{label}</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
              <p className="truncate text-[11.5px] opacity-85" title={hint}>
                {hint}
              </p>
            </div>
          ) : (
            <div key={label} className={`${CARD} p-3`}>
              <p className="text-[12px] text-slate-500">{label}</p>
              <p className="mt-1 text-xl font-semibold text-slate-900 tabular-nums">{value}</p>
              <p className="truncate text-[11.5px] text-slate-500" title={hint}>
                {hint}
              </p>
            </div>
          ),
        )}
      </section>

      {colours ? (
        // The Home (Aryan, 26 Nov): the tabs on their own above the table, as My KPIs' periods (a soft
        // grey track, the picked one a white chip); the table as the day's invoices (a plain
        // light-grey header, small corners). The same tabs, the same rows.
        <section className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex flex-wrap gap-0.5 rounded-lg bg-slate-100 p-1" role="tablist" aria-label="Which hospitals">
            {tabs
              .filter(([key, , n]) => key === "all" || n > 0)
              .map(([key, label, n]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={filter === key}
                  onClick={() => {
                    setFilter(key);
                    setAll(!limit);
                  }}
                  className={`rounded-md px-3.5 py-1.5 text-[13px] transition-colors ${filter === key ? "bg-white text-slate-900 shadow-[0_1px_3px_rgba(15,23,42,0.12)]" : "text-slate-500 hover:text-slate-800"}`}
                >
                  {label} <span className="tabular-nums opacity-70">{n}</span>
                </button>
              ))}
            </div>
            {limit && (
              <Link to="/hospital-board" className="text-[13px] font-semibold text-brand hover:underline">
                Every hospital
              </Link>
            )}
          </div>
          <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
            {shown.length === 0 ? (
              <NoResults title="No hospitals here">Try another tab, or open Every hospital.</NoResults>
            ) : (
              <div className="overflow-x-auto [scrollbar-color:#cbd5e1_#f8fafc]">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-left text-[12px] text-slate-400 [&>th]:font-medium [&>th]:whitespace-nowrap">
                      <th className="px-4 py-2">Hospital</th>
                      <th className="px-3 py-2">Accreditation</th>
                      <th className="px-3 py-2">Formulary</th>
                      <th className="px-3 py-2">Buying</th>
                      <th className="px-3 py-2 text-right">12 months</th>
                      <th className="px-3 py-2 text-right">Owed</th>
                      <th className="px-3 py-2">Visits and calls</th>
                      {data.canEdit && <th className="px-3 py-2" />}
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
                            {[row.kind === "government" ? "government" : "private", row.city, row.seller].filter(Boolean).join(" · ")}
                          </span>
                          {row.openOrders > 0 && (
                            <span className="block text-[11px] text-sky-700">
                              {row.openOrders} open {row.openOrders === 1 ? "order" : "orders"} · {shortPeso(row.openValue)}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className={`font-semibold ${ACCREDITATION[row.accreditation.state].tone}`}>{ACCREDITATION[row.accreditation.state].word}</span>
                          {row.accreditation.validUntil && <span className="block text-[11px] text-slate-500">to {day(row.accreditation.validUntil)}</span>}
                        </td>
                        <td className="max-w-56 px-3 py-2 text-[12px]">
                          {row.formulary.items.length === 0 ? (
                            <span className="text-slate-400">—</span>
                          ) : (
                            row.formulary.items.map((item) => (
                              <span key={item.medicine} className="block">
                                {item.medicine}{" "}
                                <span className={item.status === "approved" ? "text-emerald-700" : item.status === "requested" ? "text-amber-700" : "text-rose-700"}>
                                  {FORMULARY[item.status]}
                                </span>
                                {item.doctor && <span className="text-slate-400"> · {item.doctor}</span>}
                              </span>
                            ))
                          )}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className={`font-semibold ${REORDER[row.reorder].tone}`}>{REORDER[row.reorder].word}</span>
                          <span className="block text-[11px] text-slate-500">
                            {row.lastOrderOn ? `last ${ago(row.since)}${row.usual ? ` · every ~${row.usual} days` : ""}` : "no order yet"}
                          </span>
                          {row.soldMonth > 0 && <span className="block text-[11px] text-slate-500">{shortPeso(row.soldMonth)} this month</span>}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums" title={exactPeso(row.soldYear)}>
                          {row.soldYear ? shortPeso(row.soldYear) : "—"}
                        </td>
                        <td className={`px-3 py-2 text-right tabular-nums ${row.overdue ? "text-rose-700" : ""}`} title={`Overdue ${exactPeso(row.overdue)}`}>
                          {row.owed ? shortPeso(row.owed) : "—"}
                        </td>
                        <td className="px-3 py-2 text-[12px] whitespace-nowrap">
                          <span className="block">last visit {day(row.lastVisitOn)}</span>
                          <span className="block text-slate-500">next {day(row.nextVisitOn)}</span>
                          {row.lastCallOn && <span className="block text-slate-500">called {day(row.lastCallOn)}</span>}
                        </td>
                        {data.canEdit && (
                          <td className="px-3 py-2 text-right whitespace-nowrap">
                            <button type="button" onClick={() => setPapers(row)} className="rounded px-2.5 py-1 text-[12px] font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">
                              Accreditation
                            </button>
                            <button type="button" onClick={() => setFormulary(row)} className="ml-1.5 rounded px-2.5 py-1 text-[12px] font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">
                              Formulary
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
          </div>
        </section>
      ) : (
        <section className={`${CARD} min-w-0`}>
          <div className="m-3 flex flex-wrap gap-0.5 rounded-lg bg-slate-100 p-1" role="tablist" aria-label="Which hospitals">
            {tabs
              .filter(([key, , n]) => key === "all" || n > 0)
              .map(([key, label, n]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={filter === key}
                  onClick={() => {
                    setFilter(key);
                    setAll(!limit);
                  }}
                  className={`shrink-0 rounded-md px-3.5 py-1.5 text-[13px] whitespace-nowrap transition-colors ${filter === key ? "bg-white text-slate-900 shadow-[0_1px_3px_rgba(15,23,42,0.12)]" : "text-slate-500 hover:text-slate-800"}`}
                >
                  {label} <span className="tabular-nums opacity-70">{n}</span>
                </button>
              ))}
            {limit && (
              <Link to="/hospital-board" className="ml-auto self-center px-2 text-[12.5px] font-semibold text-emerald-700 hover:underline">
                Every hospital
              </Link>
            )}
          </div>
          {shown.length === 0 ? (
            <NoResults title="None here.">Try another tab, or open Every hospital.</NoResults>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-left text-[10.5px] font-semibold tracking-wide text-slate-400 uppercase">
                    <th className="px-4 py-2">Hospital</th>
                    <th className="px-3 py-2">Accreditation</th>
                    <th className="px-3 py-2">Formulary</th>
                    <th className="px-3 py-2">Buying</th>
                    <th className="px-3 py-2 text-right">12 months</th>
                    <th className="px-3 py-2 text-right">Owed</th>
                    <th className="px-3 py-2">Visits and calls</th>
                    {data.canEdit && <th className="px-3 py-2" />}
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
                          {[row.kind === "government" ? "government" : "private", row.city, row.seller].filter(Boolean).join(" · ")}
                        </span>
                        {row.openOrders > 0 && (
                          <span className="block text-[11px] text-sky-700">
                            {row.openOrders} open {row.openOrders === 1 ? "order" : "orders"} · {shortPeso(row.openValue)}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={`font-semibold ${ACCREDITATION[row.accreditation.state].tone}`}>{ACCREDITATION[row.accreditation.state].word}</span>
                        {row.accreditation.validUntil && <span className="block text-[11px] text-slate-500">to {day(row.accreditation.validUntil)}</span>}
                      </td>
                      <td className="max-w-56 px-3 py-2 text-[12px]">
                        {row.formulary.items.length === 0 ? (
                          <span className="text-slate-400">—</span>
                        ) : (
                          row.formulary.items.map((item) => (
                            <span key={item.medicine} className="block">
                              {item.medicine}{" "}
                              <span className={item.status === "approved" ? "text-emerald-700" : item.status === "requested" ? "text-amber-700" : "text-rose-700"}>
                                {FORMULARY[item.status]}
                              </span>
                              {item.doctor && <span className="text-slate-400"> · {item.doctor}</span>}
                            </span>
                          ))
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={`font-semibold ${REORDER[row.reorder].tone}`}>{REORDER[row.reorder].word}</span>
                        <span className="block text-[11px] text-slate-500">
                          {row.lastOrderOn ? `last ${ago(row.since)}${row.usual ? ` · every ~${row.usual} days` : ""}` : "no order yet"}
                        </span>
                        {row.soldMonth > 0 && <span className="block text-[11px] text-slate-500">{shortPeso(row.soldMonth)} this month</span>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums" title={exactPeso(row.soldYear)}>
                        {row.soldYear ? shortPeso(row.soldYear) : "—"}
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums ${row.overdue ? "text-rose-700" : ""}`} title={`Overdue ${exactPeso(row.overdue)}`}>
                        {row.owed ? shortPeso(row.owed) : "—"}
                      </td>
                      <td className="px-3 py-2 text-[12px] whitespace-nowrap">
                        <span className="block">last visit {day(row.lastVisitOn)}</span>
                        <span className="block text-slate-500">next {day(row.nextVisitOn)}</span>
                        {row.lastCallOn && <span className="block text-slate-500">called {day(row.lastCallOn)}</span>}
                      </td>
                      {data.canEdit && (
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <button type="button" onClick={() => setPapers(row)} className="text-[12px] font-semibold text-emerald-700 hover:underline">
                            Accreditation
                          </button>
                          <button type="button" onClick={() => setFormulary(row)} className="ml-3 text-[12px] font-semibold text-emerald-700 hover:underline">
                            Formulary
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
      )}
      {papers && <AccreditationDialog row={papers} onClose={() => setPapers(null)} />}
      {formulary && <FormularyDialog row={formulary} onClose={() => setFormulary(null)} />}
    </div>
  );
}

function AccreditationDialog({ row, onClose }: { row: Row; onClose: () => void }) {
  const queries = useQueryClient();
  const action = useAction();
  const [form, setForm] = useState({ status: "accredited", on: "", validUntil: row.accreditation.validUntil ?? "", note: "" });
  return (
    <Dialog
      title={`2MG's accreditation at ${row.name}`}
      sub="Our papers filed with the hospital: SEC/DTI, BIR 2303, the mayor's permit, the FDA LTO, the CPRs"
      onClose={onClose}
      busy={action.busy}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-[12.5px] font-semibold text-slate-600">
          Where it stands
          <select className="field h-10 w-full" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
            <option value="applied">Applied (papers filed)</option>
            <option value="accredited">Accredited</option>
            <option value="refused">Refused</option>
          </select>
        </label>
        <label className="block text-[12.5px] font-semibold text-slate-600">
          On (today if empty)
          <input type="date" className="field h-10 w-full" value={form.on} onChange={(event) => setForm({ ...form, on: event.target.value })} />
        </label>
        {form.status === "accredited" && (
          <label className="block text-[12.5px] font-semibold text-slate-600">
            Valid until
            <input type="date" className="field h-10 w-full" value={form.validUntil} onChange={(event) => setForm({ ...form, validUntil: event.target.value })} />
          </label>
        )}
        <label className="block text-[12.5px] font-semibold text-slate-600 sm:col-span-2">
          Note {form.status === "refused" ? "(why)" : ""}
          <input className="field h-10 w-full" value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} />
        </label>
      </div>
      <Problem message={action.problem?.message} />
      <div className="mt-3 flex justify-end">
        <Button
          variant="primary"
          disabled={action.busy}
          onClick={() =>
            void action.run(async () => {
              await api("/api/hospitals/accreditation", {
                method: "POST",
                body: {
                  customerId: row.customerId,
                  status: form.status,
                  on: form.on || null,
                  validUntil: form.status === "accredited" ? form.validUntil || null : null,
                  note: form.note || null,
                },
              });
              await queries.invalidateQueries({ queryKey: ["hospitals"] });
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

function FormularyDialog({ row, onClose }: { row: Row; onClose: () => void }) {
  const queries = useQueryClient();
  const action = useAction();
  const medicines = useQuery({ queryKey: ["inventory", "medicines"], queryFn: () => api<Catalogue>("/api/inventory/medicines") });
  const [form, setForm] = useState({ medicineId: "", status: "requested", on: "", doctor: "", note: "" });
  return (
    <Dialog title={`Formulary at ${row.name}`} sub="Our medicine on the hospital's list: asked by its doctors, decided by its P&T committee" onClose={onClose} busy={action.busy}>
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
          Where it stands
          <select className="field h-10 w-full" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
            <option value="requested">Requested (a doctor asked)</option>
            <option value="approved">Approved by the P&amp;T committee</option>
            <option value="not_approved">Not approved</option>
            <option value="removed">Removed from the list</option>
          </select>
        </label>
        <label className="block text-[12.5px] font-semibold text-slate-600">
          On (today if empty)
          <input type="date" className="field h-10 w-full" value={form.on} onChange={(event) => setForm({ ...form, on: event.target.value })} />
        </label>
        <label className="block text-[12.5px] font-semibold text-slate-600">
          The doctor who asked
          <input className="field h-10 w-full" value={form.doctor} onChange={(event) => setForm({ ...form, doctor: event.target.value })} />
        </label>
        <label className="block text-[12.5px] font-semibold text-slate-600">
          Note
          <input className="field h-10 w-full" value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} />
        </label>
      </div>
      <Problem message={action.problem?.message} />
      <div className="mt-3 flex justify-end">
        <Button
          variant="primary"
          disabled={action.busy || !form.medicineId}
          onClick={() =>
            void action.run(async () => {
              await api("/api/hospitals/formulary", {
                method: "POST",
                body: {
                  customerId: row.customerId,
                  medicineId: Number(form.medicineId),
                  status: form.status,
                  on: form.on || null,
                  doctor: form.doctor || null,
                  note: form.note || null,
                },
              });
              await queries.invalidateQueries({ queryKey: ["hospitals"] });
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
