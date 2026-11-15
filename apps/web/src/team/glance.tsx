// The cards a Home shows its data with, open at a glance (the look of My team and Speed): orders
// right now as a donut, medicines and customers as ranked bars, who sold most and which team is
// ahead against their targets, and each desk's speed. Each card opens its full page for detail;
// nothing needs a click to be read.

import type { SpeedReport, TeamBoard } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { counted, shortPeso } from "../ceo";
import { StepCard, took } from "../pages/speed";
import { count } from "../ui";
import { Bars, Donut } from "./charts";

const CARD = "rounded-2xl border border-slate-200 bg-white shadow-sm";

/** The days the page shows (its range picker's), for the reads below. */
function useRange() {
  const [params] = useSearchParams();
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  return { from, to, query: from && to ? `from=${from}&to=${to}` : "" };
}

/** The team board (the whole company for the CEO; a lead's own teams) for the days picked. */
export function useBoard(unit?: number | null) {
  const range = useRange();
  return useQuery({
    queryKey: ["team", "board", unit ?? "", range.from, range.to],
    queryFn: () =>
      api<TeamBoard>(
        `/api/team/board?${[unit ? `unit=${unit}` : "", range.query].filter(Boolean).join("&")}`,
      ),
    placeholderData: (previous) => previous,
  });
}

/** How long each desk keeps an order, for the days picked. */
export function useSpeed() {
  const range = useRange();
  return useQuery({
    queryKey: ["speed", range.from, range.to],
    queryFn: () => api<SpeedReport>(`/api/speed${range.query ? `?${range.query}` : ""}`),
    placeholderData: (previous) => previous,
  });
}

/** A card with its title, a note at the right and, when it has one, a way to its full page. */
export function GlanceCard({
  title,
  note,
  to,
  children,
  className = "",
}: {
  title: string;
  note?: ReactNode;
  to?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`${CARD} min-w-0 p-4 sm:p-5 ${className}`}>
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        <span className="flex items-baseline gap-3">
          {note && <span className="text-xs text-slate-500">{note}</span>}
          {to && (
            <Link to={to} className="text-xs font-semibold text-emerald-700 hover:underline">
              All →
            </Link>
          )}
        </span>
      </header>
      {children}
    </section>
  );
}

export function OrdersNowCard({ board, to = "/orders" }: { board: TeamBoard; to?: string }) {
  const now = board.stagesNow;
  return (
    <GlanceCard title="Orders right now" note={`${board.totals.stopped} stopped`} to={to}>
      <Donut
        label="open"
        middle={String(board.totals.waiting + board.totals.stopped)}
        slices={[
          { label: "At Management", value: now.management, color: "#8b5cf6" },
          { label: "With Finance", value: now.finance, color: "#f59e0b" },
          { label: "Packing", value: now.dispatch, color: "#0ea5e9" },
          { label: "On the road", value: now.road, color: "#14b8a6" },
          { label: "On hold", value: now.held, color: "#f43f5e" },
          { label: "Sent back", value: now.sentBack, color: "#fbbf24" },
        ]}
      />
    </GlanceCard>
  );
}

export function MedicinesCard({ board }: { board: TeamBoard }) {
  return (
    <GlanceCard title="Medicines sold" note="Placed, by value" to="/medicines">
      {board.topMedicines.length ? (
        <Bars
          rows={board.topMedicines.slice(0, 6).map((one) => ({
            key: one.name,
            label: one.name,
            sub: `${count(one.qty)} pcs`,
            value: one.value,
          }))}
          color="bg-sky-500"
        />
      ) : (
        <p className="text-sm text-slate-500">No order in these days.</p>
      )}
    </GlanceCard>
  );
}

const KIND_WORD: Record<string, string> = {
  hospital: "Hospitals",
  doctor: "Doctors",
  patient: "Patients",
  drugstore: "Drugstores",
  distributor: "Distributors",
  government: "Government",
};

export function CustomersCard({ board }: { board: TeamBoard }) {
  return (
    <GlanceCard title="Customers" note="By kind, with their orders" to="/customers">
      <Bars
        rows={board.byKind.map((one) => ({
          key: one.kind,
          label: KIND_WORD[one.kind] ?? one.kind,
          sub: `${counted(one.orders, "order")} · ${shortPeso(one.value)}`,
          value: one.customers,
        }))}
        format={(value) => String(value)}
        color="bg-violet-500"
      />
    </GlanceCard>
  );
}

const toneOf = (sold: number, target: number | null, pace: number) =>
  !target
    ? "bg-slate-400"
    : sold / target >= pace
      ? "bg-emerald-500"
      : sold / target >= pace / 2
        ? "bg-amber-400"
        : "bg-rose-500";

/** Who sold most (invoiced), the line marking each one's target: sellers only, leads who sell too. */
export function PeopleCard({
  board,
  title = "Who sold most",
}: {
  board: TeamBoard;
  title?: string;
}) {
  const rows = board.seats
    // Sellers only: MedReps, and anyone else (a lead) who sold or placed; desks never.
    .filter(
      (seat) =>
        seat.person && (seat.sold > 0 || seat.placedValue > 0 || /medrep/i.test(seat.moduleLabel)),
    )
    .sort((a, b) => b.sold - a.sold || b.placedValue - a.placedValue)
    .slice(0, 8)
    .map((seat) => ({
      key: seat.seatId,
      label: seat.person?.name ?? "",
      sub: [seat.area?.name, seat.placedValue ? `placed ${shortPeso(seat.placedValue)}` : null]
        .filter(Boolean)
        .join(" · "),
      value: seat.sold,
      mark: seat.target,
      tone: toneOf(seat.sold, seat.target, board.pace),
    }));
  return (
    <GlanceCard title={title} note="Sold; the line marks the target" to="/my-team">
      {rows.length ? (
        <Bars rows={rows} />
      ) : (
        <p className="text-sm text-slate-500">Nobody sold yet in these days.</p>
      )}
    </GlanceCard>
  );
}

/** Which team is ahead: each team right under the one shown, its people's sales against theirs. */
export function TeamsCard({ board }: { board: TeamBoard }) {
  const parentOf = new Map(board.units.map((unit) => [unit.id, unit.parentId]));
  const topOf = (unitId: number, tops: Set<number>): number | null => {
    let at: number | null | undefined = unitId;
    while (at != null) {
      if (tops.has(at)) return at;
      at = parentOf.get(at);
    }
    return null;
  };
  const tops = new Set(
    board.units
      .filter((unit) => unit.parentId != null && board.rootIds.includes(unit.parentId))
      .map((unit) => unit.id),
  );
  const sums = new Map<number, { sold: number; target: number }>();
  for (const seat of board.seats) {
    const top = topOf(seat.unitId, tops);
    if (top == null) continue;
    const now = sums.get(top) ?? { sold: 0, target: 0 };
    sums.set(top, { sold: now.sold + seat.sold, target: now.target + (seat.target ?? 0) });
  }
  const rows = board.units
    .filter((unit) => tops.has(unit.id))
    .map((unit) => ({ unit, ...(sums.get(unit.id) ?? { sold: 0, target: 0 }) }))
    .filter((row) => row.sold > 0 || row.target > 0)
    .sort((a, b) => b.sold - a.sold)
    .map((row) => ({
      key: row.unit.id,
      label: row.unit.name,
      sub: row.target
        ? `${Math.round((row.sold / row.target) * 100)}% of ${shortPeso(row.target)}`
        : "No target",
      value: row.sold,
      mark: row.target || null,
      tone: toneOf(row.sold, row.target || null, board.pace),
    }));
  if (!rows.length) return null;
  return (
    <GlanceCard title="Teams ahead" note="Sold against their targets" to="/my-team">
      <Bars rows={rows} />
    </GlanceCard>
  );
}

/** Each desk's speed as Speed draws it (average, late share, half took, slowest 10%). */
export function SpeedCards({
  report,
  steps = ["management", "finance", "dispatch", "road"],
}: {
  report: SpeedReport;
  steps?: string[];
}) {
  const shown = report.steps.filter((step) => steps.includes(step.step));
  return (
    <div
      className={`grid gap-3 ${shown.length > 2 ? "sm:grid-cols-2 xl:grid-cols-4" : "sm:grid-cols-2"}`}
    >
      {shown.map((step) => (
        <Link key={step.step} to={`/speed?step=${step.step}`} className="block rounded-2xl">
          <StepCard step={step} />
        </Link>
      ))}
    </div>
  );
}

/** Placed to delivered, and the share of it each desk took. */
export function PlacedToDeliveredCard({ report }: { report: SpeedReport }) {
  const parts = (["management", "finance", "dispatch", "road"] as const)
    .map((key) => report.steps.find((step) => step.step === key))
    .filter((step): step is NonNullable<typeof step> => Boolean(step && step.orders));
  const top = Math.max(1, ...parts.map((step) => step.avgMinutes));
  const COLOR: Record<string, string> = {
    management: "bg-violet-500",
    finance: "bg-amber-500",
    dispatch: "bg-sky-500",
    road: "bg-teal-500",
  };
  const NAME: Record<string, string> = {
    management: "Management",
    finance: "Finance",
    dispatch: "Dispatch",
    road: "Courier / rider",
  };
  return (
    <GlanceCard
      title="Placed to delivered"
      note={counted(report.endToEnd.orders, "order") + " delivered"}
      to="/speed"
    >
      <div className="text-3xl font-semibold tracking-tight text-slate-900 tabular-nums">
        {report.endToEnd.orders ? took(report.endToEnd.avgMinutes) : "—"}
      </div>
      <div className="mb-3 text-xs text-slate-500">on average, from placing to the customer</div>
      <ul className="grid gap-2">
        {parts.map((step) => (
          <li
            key={step.step}
            className="grid grid-cols-[7rem_minmax(0,1fr)_4.5rem] items-center gap-3 text-[13px]"
          >
            <span className="text-slate-600">{NAME[step.step]}</span>
            <span className="h-2 overflow-hidden rounded-full bg-slate-100">
              <span
                className={`block h-full rounded-full ${COLOR[step.step]}`}
                style={{ width: `${(step.avgMinutes / top) * 100}%` }}
              />
            </span>
            <span className="text-right font-semibold tabular-nums">{took(step.avgMinutes)}</span>
          </li>
        ))}
      </ul>
    </GlanceCard>
  );
}

/** A team lead's Home: his team's orders right now, who sells most, the medicines and customers,
 *  and how long the desks take with his team's orders. */
export function LeadGlance() {
  const board = useBoard();
  const speed = useSpeed();
  return (
    <>
      {board.data && (
        <section aria-label="The team at a glance" className="grid gap-3 lg:grid-cols-2">
          <PeopleCard board={board.data} title="Who sold most in the team" />
          <OrdersNowCard board={board.data} />
          <MedicinesCard board={board.data} />
          <CustomersCard board={board.data} />
        </section>
      )}
      {speed.data && (
        <SpeedCards report={speed.data} steps={["management", "finance", "dispatch"]} />
      )}
    </>
  );
}

/** One desk's Home: how fast it is, and each person on it (slowest first). */
export function DeskGlance({ steps, people }: { steps: string[]; people: string }) {
  const speed = useSpeed();
  if (!speed.data) return null;
  const mine = speed.data.people
    .filter((person) => person.step === people)
    .sort((a, b) => b.avgMinutes - a.avgMinutes);
  const limit = speed.data.steps.find((step) => step.step === people)?.lateAfterMinutes ?? 60;
  return (
    <section
      aria-label="This desk at a glance"
      className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"
    >
      <SpeedCards report={speed.data} steps={steps} />
      <GlanceCard
        title="Who takes how long"
        note={`limit ${took(limit)}`}
        to={`/speed?step=${people}`}
      >
        {mine.length ? (
          <Bars
            rows={mine.map((person) => ({
              key: person.personId,
              label: person.name,
              sub: `${counted(person.orders, "order")}${person.late ? ` · ${person.late} late` : ""}`,
              value: Math.round(person.avgMinutes),
              mark: limit,
              tone: person.avgMinutes > limit ? "bg-rose-500" : "bg-emerald-500",
            }))}
            format={(minutes) => took(minutes)}
          />
        ) : (
          <p className="text-sm text-slate-500">Nobody moved an order on in these days.</p>
        )}
      </GlanceCard>
    </section>
  );
}
