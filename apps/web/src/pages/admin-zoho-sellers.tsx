// The Admin panel's Zoho salespeople: each name Zoho's orders carry ("HOS | PASAY"), how many
// customers it last sold to, and the seat it is tied to here. Tying it puts those customers
// under the seat's area, so its holder, their coach and their channel see them. A first step
// sets up the 2026 chart's selling teams and seats (empty, for HR to fill).

import type { ZohoSellers } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, LoaderCircle, Wand2 } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "../api";
import { Button, count, dayLabel, PageHead, PageState, peso, Problem, Tabs } from "../ui";

type ChartResult = { units: number; seats: number; areas: number; alreadyHere: number; citiesTaken: string[]; noChannel: string[] };

export function AdminZohoSellers() {
  const queries = useQueryClient();
  const query = useQuery({ queryKey: ["admin", "zoho-sellers"], queryFn: () => api<ZohoSellers>("/api/admin/zoho-sellers") });
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [moved, setMoved] = useState<Record<string, number>>({});
  const [chart, setChart] = useState<ChartResult | null>(null);
  const [onlyRecent, setOnlyRecent] = useState(true);
  const [view, setView] = useState<"compare" | "tie">("compare");
  const data = query.data;
  const byChannel = useMemo(() => {
    const groups = new Map<string, ZohoSellers["seats"]>();
    for (const seat of data?.seats ?? []) groups.set(seat.channel ?? "—", [...(groups.get(seat.channel ?? "—") ?? []), seat]);
    return [...groups];
  }, [data]);
  if (!data) return <PageState query={query} what="the old system's salespeople" />;

  const tie = async (name: string, seatId: number | null) => {
    setBusy(name);
    setProblem(null);
    try {
      const said = await api<{ moved: number }>("/api/admin/zoho-sellers", { method: "POST", body: { name, seatId } });
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
      setChart(await api<ChartResult>("/api/admin/import/chart", { method: "POST", body: { apply } }));
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
      <div className="mb-4">
        <Tabs
          value={view}
          onChange={setView}
          tabs={[
            { key: "compare", label: "Who was under whom" },
            { key: "tie", label: "Tie to seats" },
          ]}
        />
      </div>
      {view === "compare" ? (
        <Compare data={data} />
      ) : (
      <>
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
      </>
      )}
    </div>
  );
}

const squash = (text: string | null | undefined) =>
  (text ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]/g, "");
/** The hub's manager and our "reports to" are the same person when one name starts the other. */
const sameLead = (hub: string, ours: string | null) => {
  const a = squash(hub);
  const b = squash(ours);
  return Boolean(a && b && (b.startsWith(a) || a.startsWith(b)));
};

/** Who was under whom (Aryan, 18 Nov: "tell me first; I decide"): each Zoho salesperson name as
 *  the old hub's Sep 2026 sheet placed it (channel, head, manager, person, place) beside where this
 *  CRM's org chart has that person today. Nothing is tied from here. */
function Compare({ data }: { data: ZohoSellers }) {
  const [onlyThisYear, setOnlyThisYear] = useState(true);
  const shown = data.sellers.filter((seller) => !onlyThisYear || seller.year > 0 || seller.recent > 0);
  const groups = new Map<string, typeof shown>();
  for (const seller of shown) {
    const key = seller.hub ? `${seller.hub.channel}` : "Not in the hub's sheet (older names)";
    groups.set(key, [...(groups.get(key) ?? []), seller]);
  }
  const ordered = [...groups].sort((a, b) => (a[0].startsWith("Not in") ? 1 : b[0].startsWith("Not in") ? -1 : a[0].localeCompare(b[0])));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[13px] text-slate-700 shadow-2xs">
        <span>
          Left: the old hub's sheet (Sep 2026) — the channel, its head, the manager and the person on each Zoho name. Right: where that
          person sits in this CRM's org chart today. Nothing is tied from here.
        </span>
        <label className="inline-flex items-center gap-2 text-slate-600">
          <input type="checkbox" checked={onlyThisYear} onChange={(event) => setOnlyThisYear(event.target.checked)} className="accent-emerald-600" />
          Only names that sold lately
        </label>
      </div>
      {ordered.map(([group, sellers]) => {
        const head = sellers.find((one) => one.hub)?.hub?.head;
        const sorted = [...sellers].sort((a, b) => (a.hub?.manager ?? "").localeCompare(b.hub?.manager ?? "") || b.year - a.year);
        return (
          <section key={group} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xs">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/70 px-4 py-2.5">
              <h2 className="text-[14px] font-semibold text-slate-900">
                {group}
                {head && <span className="ml-2 text-[12.5px] font-normal text-slate-500">head in the hub: {head}</span>}
              </h2>
              <span className="text-[12px] text-slate-500">
                {sellers.length} names · {peso(sellers.reduce((sum, one) => sum + one.year, 0))} this year
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                    <th className="px-4 py-2">Old system name</th>
                    <th className="px-3 py-2 text-right">This year</th>
                    <th className="px-3 py-2">In the hub: person · under</th>
                    <th className="px-3 py-2">In our org chart today</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sorted.map((seller) => {
                    const place = seller.ours ?? seller.looksLike;
                    const same = seller.hub && place ? sameLead(seller.hub.manager, place.reportsTo) : false;
                    return (
                      <tr key={seller.name} className="align-top">
                        <td className="px-4 py-2.5">
                          <div className="font-semibold text-slate-900">{seller.name}</div>
                          <div className="text-[11.5px] text-slate-500">
                            {count(seller.customers)} customers{seller.lastOn ? ` · last ${dayLabel(seller.lastOn)}` : ""}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right whitespace-nowrap tabular-nums">{seller.year ? peso(seller.year) : "—"}</td>
                        <td className="px-3 py-2.5">
                          {seller.hub ? (
                            <>
                              <div className={seller.hub.vacant ? "font-semibold text-amber-700" : "font-medium text-slate-800"}>
                                {seller.hub.vacant ? "Vacant" : seller.hub.person.replace(/^[^|]*\|\s*/, "")}
                              </div>
                              <div className="text-[11.5px] text-slate-500">
                                under {seller.hub.manager}
                                {seller.hub.hq ? ` · ${seller.hub.hq}` : ""}
                              </div>
                            </>
                          ) : (
                            <span className="text-slate-400">Not in the sheet</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          {place ? (
                            <>
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="font-medium text-slate-800">{place.person}</span>
                                {seller.ours ? (
                                  <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10.5px] font-semibold text-emerald-700">tied</span>
                                ) : (
                                  <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10.5px] font-semibold text-slate-600">by name, not tied</span>
                                )}
                                {seller.hub && (
                                  <span className={`rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold ${same ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>
                                    {same ? "same lead" : "different lead"}
                                  </span>
                                )}
                              </div>
                              <div className="text-[11.5px] text-slate-500">
                                {[place.team, place.channel, place.reportsTo ? `reports to ${place.reportsTo}` : "reports to nobody"].filter(Boolean).join(" · ")}
                              </div>
                            </>
                          ) : (
                            <span className="text-slate-400">{seller.hub?.vacant ? "—" : "Nobody here by that name"}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}
