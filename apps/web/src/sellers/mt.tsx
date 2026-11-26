// Modern Trade (docs/PLAN.md 16.7; docs/CHANNEL-WORK.md MT): the Chief Operating Officer's MT panel
// (each pharmacy chain against its own reorder gap with Order, what it bought from Modern Trade, owes
// and how old, deducted and sent back; the listings) and the Listings page (which of our medicines
// each chain carries, in how many branches; a change is kept as a new line).

import type { Catalogue, MtDay } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ShoppingCart } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { shortPeso } from "../ceo";
import { Button, CARD, dayLabel, Dialog, PageHead, PageState, Problem, useAction } from "../ui";
import { EmptyState, NoInvoicesArt } from "../no-results";

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
        <EmptyState art={<NoInvoicesArt size={72} />} title="No listing recorded yet.">Which of our medicines each chain carries, in how many branches, shows here.</EmptyState>
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

const REASON: Record<string, string> = {
  expired: "Expired or near expiry",
  damaged: "Damaged",
  wrong_item: "Wrong item",
  not_needed: "Not needed",
  other: "Other",
};
const KIND: Record<MtDay["deductions"][number]["kind"], string> = {
  near_expiry: "Near-expiry goods kept",
  listing_fee: "Listing fees",
  promo: "Promos and rebates",
  penalty: "Penalties",
  other: "Other",
  gl_waived: "Guarantee letter shortfall let go",
};

/** Modern Trade on the COO's Home (a press on MT): the chains' money with Modern Trade, what they
 *  deducted and sent back, which are due to reorder, the listings. Sold and target per seat are in
 *  the panel above it. */
export function MtHome() {
  const query = useMt();
  const [changing, setChanging] = useState(false);
  const data = query.data;
  if (!data) return null;
  const live = data.chains.filter((c) => c.state !== "lost");
  const toCall = live.filter((c) => c.state !== "ok");
  const moneyOf = (id: number) => data.money.find((m) => m.customerId === id);
  // The table: every chain still buying, any other with money in it (a lost chain still owing),
  // and a customer invoiced with no order on record to measure its gap by; so it adds up to the tiles.
  const shown: { customerId: number; name: string; chain: MtDay["chains"][number] | null }[] = [
    ...data.chains
      .filter((c) => c.state !== "lost" || (moneyOf(c.customerId)?.owed ?? 0) > 0 || (moneyOf(c.customerId)?.sold12 ?? 0) > 0)
      .map((c) => ({ customerId: c.customerId, name: c.name, chain: c })),
    ...data.money
      .filter((m) => !data.chains.some((c) => c.customerId === m.customerId))
      .map((m) => ({ customerId: m.customerId, name: m.name, chain: null })),
  ];
  const sum = (key: "soldMonth" | "sold12" | "owed" | "overdue") => data.money.reduce((total, one) => total + one[key], 0);
  const owing = data.money.filter((m) => m.owed > 0).length;
  const deducted = data.deductions.reduce((total, one) => total + one.amount, 0);
  const returned = data.returns.reduce((total, one) => total + one.count, 0);
  const credited = data.returns.reduce((total, one) => total + one.credit, 0);
  const listed = data.listings.filter((l) => l.listed);
  return (
    <>
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {(
          [
            ["Sold to the chains", shortPeso(sum("soldMonth")), `this month · ${shortPeso(sum("sold12"))} in 12 months`],
            ["Owed by the chains", shortPeso(sum("owed")), owing ? `${owing} chains · ${shortPeso(sum("overdue"))} past due` : "nothing owed"],
            ["Chains to call", String(toCall.length), "due, late or stopped"],
            ["Deducted", shortPeso(deducted), "from their payments, 12 months"],
            ["Returns", String(returned), returned ? `${shortPeso(credited)} credited, 12 months` : "none in 12 months"],
            ["Medicines listed", String(listed.length), `in ${new Set(listed.map((l) => l.chain)).size} chains`],
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
      <section className={`${CARD} min-w-0 overflow-x-auto`}>
        <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-900">
          The chains <span className="font-normal text-slate-400">· with Modern Trade, here and in Zoho</span>
        </h3>
        {shown.length === 0 ? (
          <EmptyState title="No chain with orders yet.">Each pharmacy chain shows here with what it bought, owes and sent back.</EmptyState>
        ) : (
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-[10.5px] font-semibold tracking-wide text-slate-400 uppercase">
                <th className="px-4 py-2">Chain</th>
                <th className="px-3 py-2">Seller</th>
                <th className="px-3 py-2 text-right">This month</th>
                <th className="px-3 py-2 text-right">12 months</th>
                <th className="px-3 py-2 text-right">Owed</th>
                <th className="px-3 py-2 text-right">Deducted</th>
                <th className="px-3 py-2 text-right">Returns</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map(({ customerId, name, chain: c }) => {
                const m = moneyOf(customerId);
                return (
                  <tr key={customerId}>
                    <td className="px-4 py-2">
                      <Link to={`/customers/${customerId}`} className="block font-semibold text-slate-900 hover:underline">
                        {name}
                      </Link>
                      {c ? (
                        <span className={`text-[11.5px] ${c.state === "ok" ? "text-slate-500" : "text-amber-700"}`}>
                          {STATE[c.state]} · orders every {c.usual} days · last {dayLabel(c.lastOrderOn)}
                        </span>
                      ) : (
                        <span className="text-[11.5px] text-slate-500">Invoiced, no order on record to time its reorders by</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {m?.seller ?? (m?.zoho ? <span className="text-amber-700">Vacant · {m.zoho}</span> : "—")}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{m?.soldMonth ? shortPeso(m.soldMonth) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{m?.sold12 ? shortPeso(m.sold12) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {m?.owed ? (
                        <>
                          <span className={m.overdue ? "font-semibold text-rose-700" : ""}>{shortPeso(m.owed)}</span>
                          {m.oldestDays !== null && <span className="block text-[11px] text-slate-500">oldest {m.oldestDays} days</span>}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{m?.deducted ? shortPeso(m.deducted) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {m?.returns ? (
                        <>
                          {m.returns}
                          {m.returnsCredit > 0 && <span className="block text-[11px] text-slate-500">{shortPeso(m.returnsCredit)} credited</span>}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Link
                        to={`/orders/new?customer=${customerId}`}
                        className="inline-flex items-center gap-1 rounded-lg bg-brand px-2 py-1 text-[12px] font-semibold text-white"
                      >
                        <ShoppingCart className="size-3" /> Order
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className={`${CARD} min-w-0`}>
          <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-900">
            Deductions and returns <span className="font-normal text-slate-400">· the last 12 months</span>
          </h3>
          {data.deductions.length === 0 && data.returns.length === 0 ? (
            <EmptyState art={<NoInvoicesArt size={72} />} title="None in 12 months.">
              Finance records a chain's deduction with its payment (near-expiry goods kept, listing fee, promo,
              penalty), and each return is asked for on its order.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.deductions.map((d) => (
                <li key={d.kind} className="flex items-center justify-between gap-2 px-4 py-2 text-[13px]">
                  <span className="min-w-0 truncate text-slate-900">
                    Deducted: {KIND[d.kind]} <span className="text-slate-500">· {d.count}</span>
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums">{shortPeso(d.amount)}</span>
                </li>
              ))}
              {data.returns.map((r) => (
                <li key={r.reason} className="flex items-center justify-between gap-2 px-4 py-2 text-[13px]">
                  <span className="min-w-0 truncate text-slate-900">
                    Returned: {REASON[r.reason] ?? r.reason} <span className="text-slate-500">· {r.count}</span>
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums">{r.credit ? `${shortPeso(r.credit)} credited` : "not credited yet"}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <Listings data={data} onChange={() => setChanging(true)} />
      </div>
      {changing && <ListingDialog chains={live} onClose={() => setChanging(false)} />}
    </>
  );
}

/** The chains, one page (the COO's "Chains"): each with its money, deductions, returns, listings. */
export function MtChainsPage() {
  const query = useMt();
  if (!query.data) return <PageState query={query} what="the chains" />;
  return (
    <div className="mx-auto w-full max-w-6xl space-y-3">
      <PageHead
        title="Chains"
        sub="Each pharmacy chain against its own reorder gap, what it bought from Modern Trade, owes, deducted and sent back"
      />
      <MtHome />
    </div>
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
