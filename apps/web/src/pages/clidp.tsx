// CLIDP (docs/PLAN.md 16.5): the CLIDP Sales Coach's Home (volume on pace, money owed with the
// biggest balances, accounts due to reorder or late, listings coming to the end of their
// validity), the Listings page (each distributor's own brand of our medicine and its certificate)
// and the Sales and Marketing Mentor's card of the CLIDP coaches.

import type { Catalogue, ClidpDay, ClidpTeam } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, ShoppingCart } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { shortPeso } from "../ceo";
import { Button, CARD, dayLabel, Dialog, PageHead, PageState, Problem, useAction } from "../ui";

const useClidp = () => useQuery({ queryKey: ["clidp", "day"], queryFn: () => api<ClidpDay>("/api/clidp/day") });

const LISTING: Record<ClidpDay["listings"][number]["state"], string> = {
  valid: "text-emerald-700",
  expiring: "text-amber-700",
  expired: "text-rose-700",
  "no date": "text-slate-500",
};

function ListingDialog({ accounts, onClose }: { accounts: ClidpDay["accounts"]; onClose: () => void }) {
  const queries = useQueryClient();
  const action = useAction();
  const medicines = useQuery({ queryKey: ["inventory", "medicines"], queryFn: () => api<Catalogue>("/api/inventory/medicines") });
  const [form, setForm] = useState({ customerId: "", medicineId: "", brand: "", certificateNo: "", validUntil: "" });
  return (
    <Dialog title="Add a listing" sub="A distributor's own brand of one of our medicines (its CLIDP certificate)" onClose={onClose} busy={action.busy}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-[12.5px] font-semibold text-slate-600">
          Distributor
          <select className="field h-10 w-full" value={form.customerId} onChange={(event) => setForm({ ...form, customerId: event.target.value })}>
            <option value="">Pick</option>
            {accounts.map((a) => (
              <option key={a.customerId} value={a.customerId}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[12.5px] font-semibold text-slate-600">
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
        {(
          [
            ["brand", "Their brand name", "text"],
            ["certificateNo", "Certificate number", "text"],
            ["validUntil", "Valid until", "date"],
          ] as const
        ).map(([key, label, type]) => (
          <label key={key} className="block text-[12.5px] font-semibold text-slate-600">
            {label}
            <input type={type} className="field h-10 w-full" value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} />
          </label>
        ))}
      </div>
      <Problem message={action.problem?.message} />
      <div className="mt-3 flex justify-end">
        <Button
          variant="primary"
          disabled={action.busy || !form.customerId || !form.medicineId || !form.brand.trim()}
          onClick={() =>
            void action.run(async () => {
              await api("/api/clidp/listings", {
                method: "POST",
                body: {
                  customerId: Number(form.customerId),
                  medicineId: Number(form.medicineId),
                  brand: form.brand,
                  certificateNo: form.certificateNo || null,
                  validUntil: form.validUntil || null,
                },
              });
              await queries.invalidateQueries({ queryKey: ["clidp"] });
              onClose();
            })
          }
        >
          Save the listing
        </Button>
      </div>
    </Dialog>
  );
}

function ListingRows({ listings }: { listings: ClidpDay["listings"] }) {
  return (
    <ul className="divide-y divide-slate-100">
      {listings.map((l) => (
        <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-[13px]">
          <span className="min-w-0">
            <b className="text-slate-900">{l.brand}</b> <span className="text-slate-500">· {l.medicine} · {l.customer}</span>
            {l.certificateNo && <span className="text-slate-400"> · {l.certificateNo}</span>}
          </span>
          <span className={`shrink-0 text-[12px] font-semibold ${LISTING[l.state]}`}>
            {l.validUntil ? `${l.state === "expired" ? "expired" : "valid until"} ${dayLabel(l.validUntil)}` : "no validity date"}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ClidpHome() {
  const query = useClidp();
  const [adding, setAdding] = useState(false);
  const data = query.data;
  if (!data) return null;
  const live = data.accounts.filter((a) => a.state !== "lost");
  const toCall = live.filter((a) => a.state === "due" || a.state === "late" || a.state === "stopped");
  const ending = data.listings.filter((l) => l.state === "expiring" || l.state === "expired");
  return (
    <>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {(
          [
            ["Volume vs target", data.volume.pace === null ? "No target" : `${data.volume.pace}%`, data.volume.note],
            ["Owed to us", shortPeso(data.owed.total), `${data.owed.rows.length} accounts`],
            ["Accounts to call", String(toCall.length), "due, late or stopped"],
            ["Listings ending", String(ending.length), "within 60 days or past"],
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
        <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-900">Accounts to call (bulk reorders)</h3>
        {toCall.length === 0 ? (
          <p className="px-4 py-3 text-[13px] text-slate-500">No account due or late.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {toCall.map((a) => (
              <li key={a.customerId} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <span className="min-w-0 flex-1">
                  <Link to={`/customers/${a.customerId}`} className="block truncate text-[13px] font-semibold text-slate-900 hover:underline">
                    {a.name}
                  </Link>
                  <span className="text-[11.5px] text-slate-500">
                    {a.state === "due" ? "Due to reorder" : a.state === "late" ? "Late" : "Stopped 90 days"} · every {a.usual} days · last {dayLabel(a.lastOrderOn)}
                  </span>
                </span>
                <Link to={`/orders/new?customer=${a.customerId}`} className="inline-flex items-center gap-1 rounded-lg bg-brand px-2 py-1 text-[12px] font-semibold text-white">
                  <ShoppingCart className="size-3" /> Order
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className={`${CARD} min-w-0`}>
          <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-900">Money owed, biggest first</h3>
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
        <section className={`${CARD} min-w-0`}>
          <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h3 className="text-sm font-bold text-slate-900">Listings ending</h3>
            <Button small onClick={() => setAdding(true)}>
              <Plus className="size-3.5" /> Add
            </Button>
          </header>
          {ending.length === 0 ? <p className="px-4 py-3 text-[13px] text-slate-500">No listing ends within 60 days.</p> : <ListingRows listings={ending} />}
        </section>
      </div>
      {adding && <ListingDialog accounts={live} onClose={() => setAdding(false)} />}
    </>
  );
}

export function ClidpListingsPage() {
  const query = useClidp();
  const [adding, setAdding] = useState(false);
  const data = query.data;
  if (!data) return <PageState query={query} what="the listings" />;
  return (
    <div className="mx-auto max-w-5xl space-y-3">
      <PageHead
        title="Listings"
        sub="Each distributor's own brand of our medicines (CLIDP certificates), with how long each is valid; a renewal is added as a new line"
        actions={
          <Button variant="primary" onClick={() => setAdding(true)}>
            <Plus className="size-4" /> Add a listing
          </Button>
        }
      />
      <section className={CARD}>{data.listings.length === 0 ? <p className="px-4 py-4 text-[13px] text-slate-500">No listing yet.</p> : <ListingRows listings={data.listings} />}</section>
      {adding && <ListingDialog accounts={data.accounts.filter((a) => a.state !== "lost")} onClose={() => setAdding(false)} />}
    </div>
  );
}

/** The Mentor's card: each CLIDP coach. */
export function ClidpTeamCard() {
  const query = useQuery({ queryKey: ["clidp", "team"], queryFn: () => api<ClidpTeam>("/api/clidp/team") });
  const data = query.data;
  if (!data || data.rows.length === 0) return null;
  return (
    <section className={`${CARD} min-w-0 overflow-x-auto`}>
      <header className="flex items-baseline justify-between gap-3 px-4 pt-4 pb-2 sm:px-5">
        <h2 className="text-sm font-semibold text-slate-900">CLIDP</h2>
        <span className="text-xs text-slate-500">Bulk to distributors under their own listings</span>
      </header>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-y border-slate-100 bg-slate-50/60 text-left text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
            <th className="px-4 py-2 sm:px-5">Sales Coach</th>
            <th className="px-3 py-2 text-right">Volume on pace</th>
            <th className="px-3 py-2 text-right">Owed</th>
            <th className="px-3 py-2 text-right">Accounts</th>
            <th className="px-3 py-2 text-right">Late or stopped</th>
            <th className="px-4 py-2 text-right">Listings ending</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {data.rows.map((row) => (
            <tr key={row.personId}>
              <td className="px-4 py-2.5 font-semibold text-slate-900 sm:px-5">{row.name}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{row.pace === null ? "No target" : `${row.pace}%`}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{shortPeso(row.owed)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{row.accounts}</td>
              <td className={`px-3 py-2.5 text-right tabular-nums ${row.late ? "text-amber-700" : ""}`}>{row.late}</td>
              <td className={`px-4 py-2.5 text-right tabular-nums ${row.listingsExpiring ? "text-amber-700" : ""}`}>{row.listingsExpiring}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function ClidpTeamPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHead title="CLIDP" sub="Each CLIDP Sales Coach: volume on pace, money owed, accounts, listings ending" />
      <ClidpTeamCard />
    </div>
  );
}
