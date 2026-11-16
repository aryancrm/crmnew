// Modern Trade (docs/PLAN.md 16.7): the Chief Operating Officer's Home (sales on pace, each pharmacy
// chain against its own reorder gap with Order, money owed by chain and its age, the listings) and
// the Listings page (which of our medicines each chain carries, in how many branches; a change is
// kept as a new line).

import type { Catalogue, MtDay } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ShoppingCart } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { shortPeso } from "../ceo";
import { Button, CARD, dayLabel, Dialog, PageHead, PageState, Problem, useAction } from "../ui";

const useMt = () => useQuery({ queryKey: ["mt", "day"], queryFn: () => api<MtDay>("/api/mt/day") });
const STATE: Record<string, string> = { ok: "On track", due: "Due to reorder", late: "Late", stopped: "Stopped 90 days", lost: "Lost" };

function ListingDialog({ chains, onClose }: { chains: MtDay["chains"]; onClose: () => void }) {
  const queries = useQueryClient();
  const action = useAction();
  const medicines = useQuery({ queryKey: ["inventory", "medicines"], queryFn: () => api<Catalogue>("/api/inventory/medicines") });
  const [form, setForm] = useState({ customerId: "", medicineId: "", branches: "", listed: true });
  return (
    <Dialog title="A chain's listing" sub="Which of our medicines the chain carries, and in how many branches" onClose={onClose} busy={action.busy}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-[12.5px] font-semibold text-slate-600">
          Chain
          <select className="field h-10 w-full" value={form.customerId} onChange={(event) => setForm({ ...form, customerId: event.target.value })}>
            <option value="">Pick</option>
            {chains.map((c) => (
              <option key={c.customerId} value={c.customerId}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[12.5px] font-semibold text-slate-600">
          Medicine
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
          Branches carrying it
          <input className="field h-10 w-full" inputMode="numeric" value={form.branches} onChange={(event) => setForm({ ...form, branches: event.target.value })} />
        </label>
        <label className="mt-6 flex items-center gap-2 text-[13px] text-slate-700">
          <input type="checkbox" className="accent-emerald-600" checked={form.listed} onChange={(event) => setForm({ ...form, listed: event.target.checked })} />
          Listed (untick when the chain delists it)
        </label>
      </div>
      <Problem message={action.problem?.message} />
      <div className="mt-3 flex justify-end">
        <Button
          variant="primary"
          disabled={action.busy || !form.customerId || !form.medicineId}
          onClick={() =>
            void action.run(async () => {
              await api("/api/mt/listings", {
                method: "POST",
                body: { customerId: Number(form.customerId), medicineId: Number(form.medicineId), branches: Number(form.branches) || 0, listed: form.listed },
              });
              await queries.invalidateQueries({ queryKey: ["mt"] });
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

function Listings({ data, onChange }: { data: MtDay; onChange: () => void }) {
  return (
    <section className={`${CARD} min-w-0`}>
      <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <h3 className="text-sm font-bold text-slate-900">Listings</h3>
        <Button small onClick={onChange}>
          Add or change
        </Button>
      </header>
      {data.listings.length === 0 ? (
        <p className="px-4 py-3 text-[13px] text-slate-500">No listing recorded yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {data.listings.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-2 px-4 py-2 text-[13px]">
              <span className="min-w-0 truncate">
                <b className="text-slate-900">{l.medicine}</b> <span className="text-slate-500">· {l.chain}</span>
              </span>
              <span className={`shrink-0 text-[12px] font-semibold ${l.listed ? "text-emerald-700" : "text-rose-700"}`}>
                {l.listed ? `${l.branches} branches` : "delisted"} · since {dayLabel(l.since)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function MtHome() {
  const query = useMt();
  const [changing, setChanging] = useState(false);
  const data = query.data;
  if (!data) return null;
  const live = data.chains.filter((c) => c.state !== "lost");
  const toCall = live.filter((c) => c.state !== "ok");
  return (
    <>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {(
          [
            ["Owed by the chains", shortPeso(data.owed.total), `${data.owed.rows.length} chains`],
            ["Chains to call", String(toCall.length), "due, late or stopped"],
            ["Medicines listed", String(data.listings.filter((l) => l.listed).length), `in ${new Set(data.listings.map((l) => l.chain)).size} chains`],
          ] as const
        ).map(([label, value, sub]) => (
          <div key={label} className={`${CARD} px-4 py-3`}>
            <div className="text-[11px] font-semibold text-slate-500">{label}</div>
            <div className="text-xl font-bold text-slate-900 tabular-nums">{value}</div>
            <div className="truncate text-[11px] text-slate-400" title={sub}>
              {sub}
            </div>
          </div>
        ))}
      </section>
      <section className={`${CARD} min-w-0`}>
        <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-900">The chains</h3>
        {live.length === 0 ? (
          <p className="px-4 py-3 text-[13px] text-slate-500">No chain with orders yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {live.map((c) => (
              <li key={c.customerId} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <span className="min-w-0 flex-1">
                  <Link to={`/customers/${c.customerId}`} className="block truncate text-[13px] font-semibold text-slate-900 hover:underline">
                    {c.name}
                  </Link>
                  <span className={`text-[11.5px] ${c.state === "ok" ? "text-slate-500" : "text-amber-700"}`}>
                    {STATE[c.state]} · orders every {c.usual} days · last {dayLabel(c.lastOrderOn)}
                  </span>
                </span>
                <Link to={`/orders/new?customer=${c.customerId}`} className="inline-flex items-center gap-1 rounded-lg bg-brand px-2 py-1 text-[12px] font-semibold text-white">
                  <ShoppingCart className="size-3" /> Order
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className={`${CARD} min-w-0`}>
          <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-900">Money owed by chain</h3>
          {data.owed.rows.length === 0 ? (
            <p className="px-4 py-3 text-[13px] text-slate-500">Nothing owed.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.owed.rows.map((row) => (
                <li key={row.customerId} className="flex items-center justify-between gap-2 px-4 py-2 text-[13px]">
                  <span className="min-w-0 truncate font-medium text-slate-900">{row.customer}</span>
                  <span className="shrink-0 font-semibold tabular-nums">
                    {shortPeso(row.owed)} <span className="text-[11px] font-normal text-slate-400">{row.age}d</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <Listings data={data} onChange={() => setChanging(true)} />
      </div>
      <p className="text-[12px] text-slate-500">
        Chains' deductions and near-expiry returns are not in the CRM yet: they need Finance's record of a short payment.
      </p>
      {changing && <ListingDialog chains={live} onClose={() => setChanging(false)} />}
    </>
  );
}

export function MtListingsPage() {
  const query = useMt();
  const [changing, setChanging] = useState(false);
  const data = query.data;
  if (!data) return <PageState query={query} what="the chains' listings" />;
  return (
    <div className="mx-auto max-w-5xl space-y-3">
      <PageHead title="Listings" sub="Which of our medicines each chain carries, and in how many branches; a change is kept as a new line" />
      <Listings data={data} onChange={() => setChanging(true)} />
      {changing && <ListingDialog chains={data.chains.filter((c) => c.state !== "lost")} onClose={() => setChanging(false)} />}
    </div>
  );
}
