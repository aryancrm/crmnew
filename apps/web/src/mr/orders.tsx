// SEFMED's Add Order and Order details (docs/PLAN.md 22): every product with its MRP and this
// client's rate (from the CRM's price book), the quantity in packs, the amount; a photo of the PO;
// Submit → "Order created successfully". The list shows the month's booked orders (an MR's own, the
// team lead's anyone's), each with its lines; booked business, not sales.

import type { OrderForm, OrderRow } from "@2mg/api/mr";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Paperclip, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { manilaToday } from "../team/range";
import { Button, CARD, Dialog, PageState, Problem, peso, useAction } from "../ui";
import { dayWords, FIELD, MrHead, monthWords, shiftMonth, useMrMe } from "./parts";

export function MrAddOrderPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const client = Number(params.get("client")) || 0;
  const visit = Number(params.get("visit")) || null;
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3">
      <OrderBooking client={client} visit={visit} onDone={() => navigate(visit ? `/mr/visits/${visit}` : "/mr/orders", { replace: true })} page />
    </div>
  );
}

/** The Add Order step: on its own page (from a firm), or over the visit (the call stays as typed). */
export function OrderBooking({ client, visit, onDone, page }: { client: number; visit: number | null; onDone: () => void; page?: boolean }) {
  const queries = useQueryClient();
  const action = useAction();
  const query = useQuery({ queryKey: ["mr", "order-form", client], queryFn: () => api<OrderForm>(`/api/mr/orders/form?client=${client}`) });
  const [packs, setPacks] = useState<Record<number, string>>({});
  const [find, setFind] = useState("");
  const [only, setOnly] = useState<"all" | "picked">("all");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const data = query.data;
  const amountOf = (medicine: OrderForm["medicines"][number], count: number) =>
    medicine.packRate !== null ? count * medicine.packRate : medicine.rate !== null ? count * medicine.packSize * medicine.rate : 0;
  const rows = useMemo(() => {
    const words = find.trim().toLowerCase();
    return (data?.medicines ?? []).filter(
      (one) => (!words || one.name.toLowerCase().includes(words)) && (only === "all" || Number(packs[one.id]) > 0),
    );
  }, [data, find, only, packs]);
  if (!data) return <PageState query={query} what="the products" />;
  const picked = data.medicines.filter((one) => Number(packs[one.id]) > 0);
  const total = picked.reduce((sum, one) => sum + amountOf(one, Number(packs[one.id])), 0);
  const submit = () =>
    action.run(async () => {
      const body = new FormData();
      body.set("clientId", String(client));
      if (visit) body.set("visitId", String(visit));
      body.set("lines", JSON.stringify(picked.map((one) => ({ medicineId: one.id, packs: Number(packs[one.id]) }))));
      if (note) body.set("note", note);
      if (file) body.set("file", file);
      await api("/api/mr/orders", { body });
      await queries.invalidateQueries({ queryKey: ["mr"] });
      onDone();
    });
  return (
    <>
      {page && <MrHead title="Add order" sub={`${data.client.name} · ${data.rateKind} price`} />}
      {!page && <p className="-mt-2 mb-1 text-xs text-slate-500">{data.client.name} · {data.rateKind} price</p>}
      <div className="flex gap-2">
        <select className={`${FIELD} w-40`} value={only} onChange={(event) => setOnly(event.target.value as "all" | "picked")}>
          <option value="all">All product</option>
          <option value="picked">Picked ({picked.length})</option>
        </select>
        <label className="flex flex-1 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3">
          <Search size={15} className="text-slate-400" />
          <input value={find} onChange={(event) => setFind(event.target.value)} placeholder="Search a product" className="h-10 flex-1 bg-transparent text-sm outline-none" />
        </label>
      </div>
      <ul className={`${CARD} my-3 divide-y divide-slate-100`}>
        {rows.map((one) => {
          const count = Number(packs[one.id]) || 0;
          return (
            <li key={one.id} className="flex flex-col gap-2 px-4 py-3">
              <div className="font-semibold text-slate-900">{one.name} {one.strength}</div>
              <div className="grid grid-cols-3 gap-2 text-xs text-slate-600">
                <span>MRP<br /><b className="text-slate-800">{one.mrp !== null ? peso(one.mrp * one.packSize) : "—"}</b></span>
                <span>Rate (inc. tax)<br /><b className="text-slate-800">{one.packRate !== null ? peso(one.packRate) : one.rate !== null ? peso(one.rate * one.packSize) : "no price"}</b></span>
                <span>Tax<br /><b className="text-slate-800">{one.vat === "vat12" ? "12%" : one.vat === "exempt" ? "Exempt" : "0%"}</b></span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  aria-label={`Quantity of ${one.name}`}
                  placeholder="Qty"
                  className={`${FIELD} h-9 w-24 text-center`}
                  value={packs[one.id] ?? ""}
                  onChange={(event) => setPacks((all) => ({ ...all, [one.id]: event.target.value }))}
                />
                <span className="text-xs text-slate-500">{one.packSize > 1 ? `pack of ${one.packSize}${one.unit ? ` ${one.unit}` : ""}` : (one.unit ?? "piece")}</span>
              </div>
              {count > 0 && <div className="text-sm font-semibold text-slate-800">Amount: {peso(amountOf(one, count))} (inc. tax)</div>}
            </li>
          );
        })}
      </ul>
      <label className="block">
        <span className="text-xs font-semibold text-slate-600">Remark</span>
        <input className={FIELD} value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      <label className="mt-3 inline-flex w-fit cursor-pointer items-center gap-2 rounded-full bg-orange-500 px-4 py-2 text-sm font-semibold text-white">
        <Paperclip size={15} /> {file ? file.name : "Attach the PO (photo)"}
        <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
      </label>
      <Problem message={action.problem?.message} />
      <div className="sticky bottom-0 mt-3 bg-white/95 pt-2 pb-1 backdrop-blur">
        <Button variant="primary" className="w-full" disabled={action.busy || picked.length === 0} onClick={submit}>
          {action.busy ? "Booking…" : `SUBMIT · ${picked.length} products · ${peso(total)}`}
        </Button>
      </div>
    </>
  );
}

export function MrOrdersPage() {
  const [params, setParams] = useSearchParams();
  const mr = useMrMe();
  const queries = useQueryClient();
  const action = useAction();
  const month = params.get("month") ?? manilaToday().slice(0, 7);
  const [cancelling, setCancelling] = useState<number | null>(null);
  const [why, setWhy] = useState("");
  const person = params.get("person");
  const query = useQuery({
    queryKey: ["mr", "orders", month, person],
    queryFn: () => api<{ month: string; rows: OrderRow[]; total: number; people: { id: number; name: string }[] }>(`/api/mr/orders?${new URLSearchParams({ month, ...(person ? { person } : {}) })}`),
    placeholderData: (previous) => previous,
  });
  const set = (next: Record<string, string | null>) => {
    const out = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) if (value === null) out.delete(key); else out.set(key, value);
    setParams(out, { replace: true });
  };
  const data = query.data;
  if (!data) return <PageState query={query} what="the orders" />;
  const cancel = (id: number) => {
    setWhy("");
    setCancelling(id);
  };
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-3">
      <MrHead
        title="Order details"
        back="/mr"
        sub={`${monthWords(data.month)} · ${data.rows.filter((one) => one.status === "booked").length} booked · ${peso(data.total)} (booked business, not sales)`}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button small variant="quiet" aria-label="Month before" onClick={() => set({ month: shiftMonth(data.month, -1) })}><ChevronLeft size={16} /></Button>
        <span className="text-sm font-semibold">{monthWords(data.month)}</span>
        <Button small variant="quiet" aria-label="Month after" onClick={() => set({ month: shiftMonth(data.month, 1) })}><ChevronRight size={16} /></Button>
        {data.people.length > 0 && (
          <select aria-label="Whose orders" className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm" value={person ?? ""} onChange={(event) => set({ person: event.target.value || null })}>
            <option value="">Everyone</option>
            {data.people.map((one) => (
              <option key={one.id} value={one.id}>{one.name}</option>
            ))}
          </select>
        )}
      </div>
      <ul className="flex flex-col gap-2">
        {data.rows.map((one) => (
          <li key={one.id} className={`${CARD} p-4 ${params.get("focus") === String(one.id) ? "ring-2 ring-sky-400" : ""}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="font-semibold text-slate-900">{one.client.name}</div>
                <div className="text-xs text-slate-500">{one.code} · {dayWords(one.madeAt.slice(0, 10))} · {one.person.name}{one.visitId ? " · at a visit" : ""}</div>
              </div>
              <div className="text-right">
                <div className={`font-bold ${one.status === "cancelled" ? "text-slate-400 line-through" : "text-slate-900"}`}>{peso(one.amount)}</div>
                <div className={`text-xs font-semibold ${one.status === "cancelled" ? "text-rose-600" : "text-amber-600"}`}>{one.status === "cancelled" ? "Cancelled" : "Pending"}</div>
              </div>
            </div>
            <ul className="mt-2 text-[13px] text-slate-700">
              {one.lines.map((line) => (
                <li key={line.medicineId}>{line.name} × {line.packs} · {peso(line.amount)}</li>
              ))}
            </ul>
            {one.note && <div className="mt-1 text-xs text-slate-500">{one.note}</div>}
            {one.cancelNote && <div className="mt-1 text-xs text-rose-700">Cancelled: {one.cancelNote}</div>}
            <div className="mt-2 flex gap-3 text-xs">
              {one.hasFile && <a href={`/api/mr/orders/${one.id}/file`} target="_blank" rel="noreferrer" className="font-semibold text-sky-700">PO photo</a>}
              {one.status === "booked" && mr.data && one.person.id && (mr.data.access === "mr" || mr.data.access === "lead") && (
                <button type="button" className="font-semibold text-rose-700" onClick={() => cancel(one.id)}>Cancel</button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {data.rows.length === 0 && <div className={`${CARD} px-4 py-8 text-center text-sm text-slate-500`}>No order booked this month.</div>}
      <Problem message={action.problem?.message} />
      {cancelling && (
        <Dialog title="Cancel this booked order" sub="It is kept, marked cancelled, with why." onClose={() => setCancelling(null)} busy={action.busy}>
          <div className="flex flex-col gap-3">
            <input className={FIELD} value={why} onChange={(event) => setWhy(event.target.value)} placeholder="Why? *" />
            <Problem message={action.problem?.message} />
            <Button
              variant="primary"
              disabled={action.busy || !why.trim()}
              onClick={() =>
                action.run(async () => {
                  await api(`/api/mr/orders/${cancelling}/cancel`, { body: { note: why } });
                  await queries.invalidateQueries({ queryKey: ["mr"] });
                  setCancelling(null);
                })
              }
            >
              Cancel the order
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
