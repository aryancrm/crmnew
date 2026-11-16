// The Admin panel's Zoho salespeople: each name Zoho's orders carry ("HOS | PASAY"), how many
// customers it last sold to, and the seat it is tied to here. Tying it puts those customers
// under the seat's area, so its holder, their coach and their channel see them. A first step
// sets up the 2026 chart's selling teams and seats (empty, for HR to fill).

import type { ZohoSellers } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, LoaderCircle, Wand2 } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "../api";
import { Button, count, dayLabel, PageHead, PageState, Problem } from "../ui";

type ChartResult = { units: number; seats: number; areas: number; alreadyHere: number; citiesTaken: string[]; noChannel: string[] };

export function AdminZohoSellers() {
  const queries = useQueryClient();
  const query = useQuery({ queryKey: ["admin", "zoho-sellers"], queryFn: () => api<ZohoSellers>("/api/admin/zoho-sellers") });
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [moved, setMoved] = useState<Record<string, number>>({});
  const [chart, setChart] = useState<ChartResult | null>(null);
  const [onlyRecent, setOnlyRecent] = useState(true);
  const data = query.data;
  const byChannel = useMemo(() => {
    const groups = new Map<string, ZohoSellers["seats"]>();
    for (const seat of data?.seats ?? []) groups.set(seat.channel ?? "—", [...(groups.get(seat.channel ?? "—") ?? []), seat]);
    return [...groups];
  }, [data]);
  if (!data) return <PageState query={query} what="Zoho's salespeople" />;

  const tie = async (name: string, seatId: number | null) => {
    setBusy(name);
    setProblem(null);
    try {
      const said = await api<{ moved: number }>("/api/admin/zoho-sellers", { method: "POST", body: JSON.stringify({ name, seatId }) });
      setMoved((old) => ({ ...old, [name]: said.moved }));
      await queries.invalidateQueries({ queryKey: ["admin", "zoho-sellers"] });
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };
  const setUpChart = async (apply: boolean) => {
    setBusy("chart");
    setProblem(null);
    try {
      setChart(await api<ChartResult>("/api/admin/import/chart", { method: "POST", body: JSON.stringify({ apply }) }));
      if (apply) await queries.invalidateQueries({ queryKey: ["admin", "zoho-sellers"] });
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const shown = data.sellers.filter((seller) => !onlyRecent || seller.recent > 0);
  const tied = data.sellers.filter((seller) => seller.seatId).length;
  const seatName = (id: number | null) => {
    const seat = data.seats.find((one) => one.id === id);
    return seat ? `${seat.area ?? seat.title}${seat.holder ? ` · ${seat.holder}` : ""}` : "";
  };

  return (
    <div className="mx-auto max-w-5xl">
      <PageHead
        title="Old customers to seats"
        sub={`From the old system's orders, once: ${tied} of ${data.sellers.length} sellers placed · placing one puts the customers it last sold to under that seat`}
      />
      <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 text-[13px] text-slate-700">
            <b className="text-slate-900">The 2026 chart's selling teams and seats.</b> Hospital, Prescription, Sales and Marketing, Modern Trade: every
            team and seat, empty for HR to fill, each selling seat with its own area. Safe to run again.
          </div>
          <div className="flex gap-2">
            <Button small disabled={busy !== null} onClick={() => void setUpChart(false)}>
              See what it adds
            </Button>
            <Button small variant="primary" disabled={busy !== null} onClick={() => void setUpChart(true)}>
              {busy === "chart" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Set them up
            </Button>
          </div>
        </div>
        {chart && (
          <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-[12.5px] text-slate-700">
            {count(chart.units)} teams, {count(chart.seats)} seats, {count(chart.areas)} areas
            {chart.alreadyHere ? ` · ${count(chart.alreadyHere)} seats already here` : ""}
            {chart.citiesTaken.length ? ` · cities already in another area: ${chart.citiesTaken.join(", ")}` : ""}
            {chart.noChannel.length ? ` · channels missing: ${chart.noChannel.join(", ")}` : ""}
          </div>
        )}
      </section>
      <Problem message={problem} />
      <div className="mb-2 flex items-center justify-between gap-3 text-[12.5px]">
        <label className="inline-flex items-center gap-2 text-slate-600">
          <input type="checkbox" checked={onlyRecent} onChange={(event) => setOnlyRecent(event.target.checked)} className="accent-emerald-600" />
          Only those who sold in the last 18 months
        </label>
        <span className="text-slate-500">{count(shown.length)} shown</span>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
              <th className="px-4 py-2.5">Seller on old orders</th>
              <th className="px-3 py-2.5 text-right">Customers</th>
              <th className="px-3 py-2.5">Last sold</th>
              <th className="px-4 py-2.5">Seat here</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.map((seller) => (
              <tr key={seller.name} className="hover:bg-slate-50/60">
                <td className="px-4 py-2.5 font-semibold text-slate-900">{seller.name}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {count(seller.customers)}
                  {seller.recent < seller.customers && <span className="text-[11px] text-slate-400"> · {count(seller.recent)} lately</span>}
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap text-slate-500">{seller.lastOn ? dayLabel(seller.lastOn) : "—"}</td>
                <td className="px-4 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      className="field h-8 max-w-72 text-[12.5px]"
                      value={seller.seatId ?? ""}
                      disabled={busy !== null}
                      onChange={(event) => void tie(seller.name, event.target.value ? Number(event.target.value) : null)}
                      aria-label={`Seat for ${seller.name}`}
                    >
                      <option value="">Not tied</option>
                      {byChannel.map(([channel, seats]) => (
                        <optgroup key={channel} label={channel}>
                          {seats.map((seat) => (
                            <option key={seat.id} value={seat.id}>
                              {seat.area ?? seat.title}
                              {seat.holder ? ` · ${seat.holder}` : " · empty"}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    {!seller.seatId && seller.suggested && (
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void tie(seller.name, seller.suggested)}
                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-1 text-[11.5px] font-semibold text-emerald-800 hover:bg-emerald-100"
                        title="The seat whose area matches this name"
                      >
                        <Wand2 className="size-3" /> {seatName(seller.suggested)}
                      </button>
                    )}
                    {busy === seller.name && <LoaderCircle className="size-3.5 animate-spin text-slate-400" />}
                    {moved[seller.name] !== undefined && busy !== seller.name && (
                      <span className="text-[11.5px] text-emerald-700">{count(moved[seller.name] ?? 0)} customers moved</span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
