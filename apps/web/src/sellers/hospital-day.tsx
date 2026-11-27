// The top of a Hospital CHC's Home, as the Hospital CHC Playbook runs the day: today's pulse
// (four numbers with their light), "go here first" (the biggest hospitals due to reorder, then a
// few whose money is long overdue, each with its button), and tonight's 7 PM huddle.

import type { Collections, Huddle, Pulse, Reorders } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { Check, FileText, HandCoins, Megaphone, PhoneCall, Pill, RefreshCw, TrendingUp, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { shortPeso } from "../ceo";
import { EmptyState } from "../no-results";

/** The light of each number, as the colour of its icon's circle (Aryan, 26 Nov). */
const TONE: Record<Pulse["tiles"][number]["tone"], string> = {
  green: "bg-emerald-500",
  amber: "bg-amber-400",
  red: "bg-rose-500",
  none: "bg-slate-400",
};

/** Each number's icon, by its key (the API's: sales, dso, reorder, invoice; refills, groups). */
const PULSE_ICON: Record<string, typeof TrendingUp> = {
  sales: TrendingUp,
  dso: HandCoins,
  reorder: RefreshCw,
  invoice: FileText,
  refills: Pill,
  groups: Users,
};

export function TodaysPulse() {
  const query = useQuery({ queryKey: ["my", "pulse"], queryFn: () => api<Pulse>("/api/my/pulse"), refetchInterval: 120_000 });
  const tiles = query.data?.tiles;
  return (
    <section aria-label="Today's pulse" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {(tiles ?? Array.from({ length: 4 }, () => null)).map((tile, n) =>
        tile ? (
          // A thin light-grey line, the icon in a circle of the number's light on the left, the words black and medium
          // (Aryan, 26 Nov).
          <Link
            key={tile.key}
            to={tile.to}
            className="flex min-w-0 items-center gap-3 rounded-2xl bg-white px-4 py-3 ring-1 ring-slate-200 hover:bg-slate-50"
          >
            {(() => {
              const Icon = PULSE_ICON[tile.key] ?? TrendingUp;
              return (
                <span aria-hidden="true" className={`grid size-10 shrink-0 place-items-center rounded-full text-white ${TONE[tile.tone]}`}>
                  <Icon className="size-[18px]" strokeWidth={2} />
                </span>
              );
            })()}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[11px] font-medium text-slate-900">{tile.label}</span>
              <span className="mt-0.5 block truncate text-xl font-medium tracking-tight text-slate-900 tabular-nums">{tile.value}</span>
              <span className="block truncate text-[11px] font-medium text-slate-600" title={tile.sub}>
                {tile.sub}
              </span>
            </span>
          </Link>
        ) : (
          <div key={`slot-${n}`} className="h-[78px] animate-pulse rounded-2xl bg-white ring-1 ring-slate-100" />
        ),
      )}
    </section>
  );
}

type Stop = { key: string; kind: "collect" | "reorder"; customerId: number; name: string; amount: number; why: string; phone: string | null; orderId?: number };

/** The hospitals due or late to reorder first, the biggest buyers first (Aryan, 19 Nov: "why do
 *  the ones who owe money come first?"), then up to two whose money is 60 days and more overdue
 *  (they owe us: collect on the visit). At most six stops. */
export function GoHereFirst() {
  const owed = useQuery({ queryKey: ["my", "collections"], queryFn: () => api<Collections>("/api/my/collections") });
  const due = useQuery({ queryKey: ["reorders", "due", null, null], queryFn: () => api<Reorders>("/api/my/reorders?state=due") });
  const late = useQuery({ queryKey: ["reorders", "late", null, null], queryFn: () => api<Reorders>("/api/my/reorders?state=late") });
  if (!owed.data || !due.data || !late.data) return null;
  const reorders: Stop[] = [...due.data.rows, ...late.data.rows]
    .sort((a, b) => b.lastTotal - a.lastTotal)
    .map((row): Stop => ({
      key: `r${row.customerId}`,
      kind: "reorder",
      customerId: row.customerId,
      name: row.name,
      amount: row.lastTotal,
      why: `Due to reorder: orders every ${row.usual} days · last ${row.since} days ago · last order ${shortPeso(row.lastTotal)}`,
      phone: row.phone,
    }));
  const collect: Stop[] = owed.data.rows
    .filter((row) => row.flag !== "ok" && !reorders.some((one) => one.customerId === row.customerId))
    .map((row): Stop => ({
      key: `c${row.customerId}`,
      kind: "collect",
      customerId: row.customerId,
      name: row.customer,
      amount: row.owed,
      why: `They owe us ${shortPeso(row.owed)} · oldest invoice ${row.age} days: collect on the visit`,
      phone: row.phone,
      orderId: row.oldestOrderId ?? undefined,
    }));
  const stops: Stop[] = [...reorders.slice(0, collect.length ? 4 : 6), ...collect.slice(0, 2)].slice(0, 6);
  return (
    <section className="rounded-2xl border border-slate-200/90 bg-white shadow-2xs">
      <header className="flex items-baseline justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <h3 className="text-sm font-bold text-slate-900">Go here first</h3>
        <span className="text-[11px] text-slate-500">Hospitals due to reorder first; then money owed to us 60 days and more</span>
      </header>
      {stops.length === 0 ? (
        <EmptyState title="No hospital due to reorder and nothing owed past 60 days.">Plan new hospitals.</EmptyState>
      ) : (
        <ul className="divide-y divide-slate-100">
          {stops.map((stop, n) => (
            <li key={stop.key} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              {/* The number plain, the icon light grey with no tile behind it (Aryan, 26 Nov). */}
              <span className="w-5 shrink-0 text-center text-[12px] font-semibold text-slate-500 tabular-nums">{n + 1}</span>
              <span className="grid size-8 shrink-0 place-items-center text-slate-400">
                {stop.kind === "collect" ? <HandCoins className="size-4" /> : <PhoneCall className="size-4" />}
              </span>
              {/* On a phone the name keeps the row and the buttons go under it (Aryan, 19 Nov: the
                  MedReps work on their phones). */}
              <span className="min-w-0 flex-1 basis-[55%] sm:basis-0">
                <Link to={`/customers/${stop.customerId}`} className="block truncate text-[13px] font-semibold text-slate-900 hover:underline">
                  {stop.name}
                </Link>
                <span className="block truncate text-[11.5px] text-slate-500">{stop.why}</span>
              </span>
              <span className="ml-auto flex shrink-0 gap-1.5">
                {stop.phone && stop.phone.replace(/\D/g, "").length >= 7 && (
                  <a
                    href={`tel:${stop.phone.replace(/\s/g, "")}`}
                    className="inline-flex items-center rounded px-2.5 py-1 text-[12px] font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
                  >
                    Call
                  </a>
                )}
                {stop.kind === "collect" && stop.orderId ? (
                  <Link
                    to={`/orders/${stop.orderId}`}
                    className="inline-flex items-center rounded bg-emerald-600 px-2.5 py-1 text-[12px] font-semibold text-white hover:bg-emerald-700"
                  >
                    Collect
                  </Link>
                ) : (
                  <Link
                    to={`/orders/new?customer=${stop.customerId}`}
                    className="inline-flex items-center rounded bg-brand px-2.5 py-1 text-[12px] font-semibold text-white"
                  >
                    New order
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
