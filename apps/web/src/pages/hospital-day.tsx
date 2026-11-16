// The top of a Hospital CHC's Home, as the Hospital CHC Playbook runs the day: today's pulse
// (four numbers with their light), "go here first" (money first: the oldest money owed, then the
// biggest hospitals due to reorder, each with its button), and tonight's 7 PM huddle.

import type { Collections, Huddle, Pulse, Reorders } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { Check, HandCoins, Megaphone, Phone, PhoneCall, ShoppingCart } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { shortPeso } from "../ceo";

const TONE: Record<Pulse["tiles"][number]["tone"], { dot: string; ring: string; text: string }> = {
  green: { dot: "bg-emerald-500", ring: "ring-emerald-200", text: "text-emerald-800" },
  amber: { dot: "bg-amber-400", ring: "ring-amber-200", text: "text-amber-800" },
  red: { dot: "bg-rose-500", ring: "ring-rose-200", text: "text-rose-800" },
  none: { dot: "bg-slate-300", ring: "ring-slate-200", text: "text-slate-500" },
};

export function TodaysPulse() {
  const query = useQuery({ queryKey: ["my", "pulse"], queryFn: () => api<Pulse>("/api/my/pulse"), refetchInterval: 120_000 });
  const tiles = query.data?.tiles;
  return (
    <section aria-label="Today's pulse" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {(tiles ?? Array.from({ length: 4 }, () => null)).map((tile, n) =>
        tile ? (
          <Link
            key={tile.key}
            to={tile.to}
            className={`block min-w-0 rounded-2xl bg-white px-4 py-3 shadow-2xs ring-1 hover:bg-slate-50 ${TONE[tile.tone].ring}`}
          >
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
              <span className={`size-2 rounded-full ${TONE[tile.tone].dot}`} /> {tile.label}
            </div>
            <div className={`mt-0.5 truncate text-xl font-bold tracking-tight tabular-nums ${TONE[tile.tone].text}`}>{tile.value}</div>
            <div className="truncate text-[11px] text-slate-400" title={tile.sub}>
              {tile.sub}
            </div>
          </Link>
        ) : (
          <div key={`slot-${n}`} className="h-[78px] animate-pulse rounded-2xl bg-white ring-1 ring-slate-100" />
        ),
      )}
    </section>
  );
}

type Stop = { key: string; kind: "collect" | "reorder"; customerId: number; name: string; amount: number; why: string; phone: string | null; orderId?: number };

/** Money first: owed 60 days and more (oldest first), then the biggest hospitals due or late to
 *  reorder. At most six stops. */
export function GoHereFirst() {
  const owed = useQuery({ queryKey: ["my", "collections"], queryFn: () => api<Collections>("/api/my/collections") });
  const due = useQuery({ queryKey: ["reorders", "due", null, null], queryFn: () => api<Reorders>("/api/my/reorders?state=due") });
  const late = useQuery({ queryKey: ["reorders", "late", null, null], queryFn: () => api<Reorders>("/api/my/reorders?state=late") });
  if (!owed.data || !due.data || !late.data) return null;
  const stops: Stop[] = [
    ...owed.data.rows
      .filter((row) => row.flag !== "ok")
      .map((row): Stop => ({
        key: `c${row.customerId}`,
        kind: "collect",
        customerId: row.customerId,
        name: row.customer,
        amount: row.owed,
        why: `${shortPeso(row.owed)} owed · oldest invoice ${row.age} days`,
        phone: row.phone,
        orderId: row.oldestOrderId ?? undefined,
      })),
    ...[...late.data.rows, ...due.data.rows].map((row): Stop => ({
      key: `r${row.customerId}`,
      kind: "reorder",
      customerId: row.customerId,
      name: row.name,
      amount: row.lastTotal,
      why: `Orders every ${row.usual} days · last ${row.since} days ago · last order ${shortPeso(row.lastTotal)}`,
      phone: row.phone,
    })),
  ].slice(0, 6);
  return (
    <section className="rounded-2xl border border-slate-200/90 bg-white shadow-2xs">
      <header className="flex items-baseline justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <h3 className="text-sm font-bold text-slate-900">Go here first</h3>
        <span className="text-[11px] text-slate-500">Money first: owed 60 days and more, then hospitals due to reorder</span>
      </header>
      {stops.length === 0 ? (
        <p className="px-4 py-4 text-[13px] text-slate-500">Nothing owed past 60 days and no hospital due to reorder. Plan new hospitals.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {stops.map((stop, n) => (
            <li key={stop.key} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-600">{n + 1}</span>
              <span className={`grid size-8 shrink-0 place-items-center rounded-lg ${stop.kind === "collect" ? "bg-amber-50 text-amber-700" : "bg-sky-50 text-sky-700"}`}>
                {stop.kind === "collect" ? <HandCoins className="size-4" /> : <PhoneCall className="size-4" />}
              </span>
              <span className="min-w-0 flex-1">
                <Link to={`/customers/${stop.customerId}`} className="block truncate text-[13px] font-semibold text-slate-900 hover:underline">
                  {stop.name}
                </Link>
                <span className="block truncate text-[11.5px] text-slate-500">{stop.why}</span>
              </span>
              <span className="flex shrink-0 gap-1.5">
                {stop.phone && stop.phone.replace(/\D/g, "").length >= 7 && (
                  <a
                    href={`tel:${stop.phone.replace(/\s/g, "")}`}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
                  >
                    <Phone className="size-3" /> Call
                  </a>
                )}
                {stop.kind === "collect" && stop.orderId ? (
                  <Link
                    to={`/orders/${stop.orderId}`}
                    className="inline-flex items-center gap-1 rounded-lg bg-amber-600 px-2 py-1 text-[12px] font-semibold text-white hover:bg-amber-700"
                  >
                    <HandCoins className="size-3" /> Collect
                  </Link>
                ) : (
                  <Link
                    to={`/orders/new?customer=${stop.customerId}`}
                    className="inline-flex items-center gap-1 rounded-lg bg-brand px-2 py-1 text-[12px] font-semibold text-white"
                  >
                    <ShoppingCart className="size-3" /> New order
                  </Link>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Tonight's huddle: declared or not, with the day's numbers from the data. */
export function HuddleCard() {
  const query = useQuery({ queryKey: ["huddle", "mine"], queryFn: () => api<Huddle>("/api/huddle") });
  const data = query.data;
  if (!data) return null;
  const said = data.declared;
  return (
    <section className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-2xs">
      <div className="flex items-center justify-between gap-2">
        <h3 className="inline-flex items-center gap-1.5 text-sm font-semibold tracking-tight text-slate-900">
          <Megaphone className="size-4 text-slate-500" /> Tonight's huddle
        </h3>
        {said ? (
          <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-emerald-700">
            <Check className="size-3" /> Declared {said.at}
          </span>
        ) : (
          <span className="text-[11.5px] font-semibold text-amber-700">Due at 7:00 PM</span>
        )}
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
        <dt className="text-slate-500">Invoiced today</dt>
        <dd className="text-right font-semibold tabular-nums">{shortPeso((said ?? data.actual).sales)}</dd>
        <dt className="text-slate-500">Collected today</dt>
        <dd className="text-right font-semibold tabular-nums">{shortPeso((said ?? data.actual).collected)}</dd>
        <dt className="text-slate-500">Visits</dt>
        <dd className="text-right font-semibold tabular-nums">{(said ?? data.actual).visits}</dd>
        <dt className="text-slate-500">An invoice today</dt>
        <dd className={`text-right font-semibold ${(said ?? data.actual).invoiced ? "text-emerald-700" : "text-rose-700"}`}>
          {(said ?? data.actual).invoiced ? "Yes" : "No"}
        </dd>
      </dl>
      <Link
        to="/huddle"
        className={`mt-3 block rounded-lg px-3 py-1.5 text-center text-[13px] font-semibold ${said ? "text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-50" : "bg-brand text-white"}`}
      >
        {said ? "See or change" : "Declare to my coach"}
      </Link>
    </section>
  );
}
