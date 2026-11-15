// The cards a Home shows its data with, open at a glance (the look of My team and Speed): orders
// right now as a donut, medicines and customers as ranked bars, who sold most and which team is
// ahead against their targets, and each desk's speed. Each card opens its full page for detail;
// nothing needs a click to be read.

import type {
  ChannelFigures,
  ChannelReport,
  OwedList,
  PaymentList,
  SpeedReport,
  TeamBoard,
} from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
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
/** A card's "See all": how many rows are folded away, and whether they are shown. */
export type SeeAll = { hidden: number; open: boolean; toggle: () => void };

/** Rows folded to `limit` until See all opens them, in the card itself. */
export function useSeeAll<T>(rows: T[], limit: number): { shown: T[]; seeAll: SeeAll } {
  const [open, setOpen] = useState(false);
  return {
    shown: open ? rows : rows.slice(0, limit),
    seeAll: {
      hidden: Math.max(0, rows.length - limit),
      open,
      toggle: () => setOpen((now) => !now),
    },
  };
}

export function GlanceCard({
  title,
  note,
  to,
  seeAll,
  children,
  className = "",
}: {
  title: string;
  note?: ReactNode;
  /** Its own page, for more than the card holds. */
  to?: string;
  seeAll?: SeeAll;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`${CARD} min-w-0 p-4 sm:p-5 ${className}`}>
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        <span className="flex items-center gap-3">
          {note && <span className="text-xs text-slate-500">{note}</span>}
          {seeAll && (seeAll.hidden > 0 || seeAll.open) && (
            <button
              type="button"
              onClick={seeAll.toggle}
              className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
            >
              {seeAll.open ? "Show less" : `See all (${seeAll.hidden} more)`}
            </button>
          )}
          {to && (
            <Link
              to={to}
              className="text-xs font-semibold text-slate-500 hover:text-emerald-700"
              title="Open its page"
            >
              Open ↗
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
  const { shown, seeAll } = useSeeAll(board.topMedicines, 6);
  return (
    <GlanceCard title="Medicines sold" note="Placed, by value" to="/medicines" seeAll={seeAll}>
      {board.topMedicines.length ? (
        <Bars
          rows={shown.map((one) => ({
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
  const all = board.seats
    // Sellers only: MedReps, and anyone else (a lead) who sold or placed; desks never.
    .filter(
      (seat) =>
        seat.person && (seat.sold > 0 || seat.placedValue > 0 || /medrep/i.test(seat.moduleLabel)),
    )
    .sort((a, b) => b.sold - a.sold || b.placedValue - a.placedValue)
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
  const { shown: rows, seeAll } = useSeeAll(all, 6);
  return (
    <GlanceCard title={title} note="Sold; the line marks the target" to="/my-team" seeAll={seeAll}>
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
    .filter((step): step is NonNullable<typeof step> => Boolean(step?.orders));
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
      note={`${counted(report.endToEnd.orders, "order")} delivered`}
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

const TONE_BAR: Record<string, string> = {
  on: "bg-emerald-500",
  behind: "bg-amber-400",
  far: "bg-rose-500",
  none: "bg-slate-400",
};

/** What "Sales this month" opens, on the Home: every channel against its target, with its head,
 *  people and customers, and what it sold today. */
export function ChannelSalesCard({
  channels,
  label,
}: {
  channels: ChannelFigures[];
  label: string;
}) {
  const report = useQuery({
    queryKey: ["reports", "channels"],
    queryFn: () => api<ChannelReport>("/api/reports/channels"),
  });
  const extra = new Map((report.data?.channels ?? []).map((row) => [row.code, row]));
  const sorted = [...channels].sort((a, b) => b.sold - a.sold);
  const { shown, seeAll } = useSeeAll(sorted, 5);
  const sold = channels.reduce((sum, row) => sum + row.sold, 0);
  return (
    <GlanceCard
      title="Sales by channel"
      note={`${shortPeso(sold)} sold · ${label}`}
      to="/reports/channels"
      seeAll={seeAll}
    >
      <Bars
        rows={shown.map((row) => {
          const more = extra.get(row.code);
          return {
            key: row.code,
            label: `${row.code} · ${row.name}`,
            sub: [
              row.head ?? "No head named",
              more ? `${more.people} people · ${count(more.customers)} customers` : null,
              row.today ? `today ${shortPeso(row.today)}` : null,
              row.pct != null ? `${row.pct}% of ${shortPeso(row.target ?? 0)}` : "No target",
            ]
              .filter(Boolean)
              .join(" · "),
            value: row.sold,
            mark: row.target,
            tone: TONE_BAR[row.tone] ?? "bg-slate-400",
          };
        })}
      />
    </GlanceCard>
  );
}

const AGE: {
  key: "current" | "d30" | "d60" | "d90" | "older" | "onDelivery";
  label: string;
  color: string;
}[] = [
  { key: "current", label: "Not due yet", color: "bg-emerald-500" },
  { key: "d30", label: "1–30 days late", color: "bg-amber-400" },
  { key: "d60", label: "31–60 days", color: "bg-orange-500" },
  { key: "d90", label: "61–90 days", color: "bg-rose-500" },
  { key: "older", label: "Over 90 days", color: "bg-rose-700" },
  { key: "onDelivery", label: "Due on delivery", color: "bg-sky-400" },
];

/** What customers owe, big: how late it is, and who owes most (the latest first). */
export function OwedCard() {
  const query = useQuery({
    queryKey: ["finance", "owed"],
    queryFn: () => api<OwedList>("/api/finance/owed"),
  });
  const data = query.data;
  const { shown, seeAll } = useSeeAll(data?.rows ?? [], 6);
  if (!data) return null;
  const total = data.totals.total;
  return (
    <GlanceCard
      title="Customers owe us"
      note={counted(data.rows.length, "customer")}
      to="/owed"
      seeAll={seeAll}
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-3xl font-semibold tracking-tight text-slate-900 tabular-nums">
            {shortPeso(total)}
          </div>
          <div
            className={`text-xs ${data.totals.overdue ? "font-semibold text-rose-600" : "text-slate-500"}`}
          >
            {data.totals.overdue
              ? `${shortPeso(data.totals.overdue)} past due`
              : "Nothing past due"}
          </div>
        </div>
      </div>
      <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-slate-100">
        {AGE.filter((age) => data.totals[age.key] > 0).map((age) => (
          <span
            key={age.key}
            className={age.color}
            style={{ width: `${(data.totals[age.key] / Math.max(1, total)) * 100}%` }}
            title={`${age.label}: ${shortPeso(data.totals[age.key])}`}
          />
        ))}
      </div>
      <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] sm:grid-cols-3">
        {AGE.map((age) => (
          <li key={age.key} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-slate-500">
              <span className={`size-2 rounded-full ${age.color}`} /> {age.label}
            </span>
            <span
              className={`font-semibold tabular-nums ${data.totals[age.key] ? "text-slate-800" : "text-slate-300"}`}
            >
              {shortPeso(data.totals[age.key])}
            </span>
          </li>
        ))}
      </ul>
      <ul className="mt-4 divide-y divide-slate-100 border-t border-slate-100">
        {shown.map((row) => (
          <li key={row.customerId}>
            <Link
              to={`/customers/${row.customerId}`}
              className="-mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-slate-50"
            >
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-semibold text-slate-800">
                  {row.customer}
                </span>
                <span className="block truncate text-[11px] text-slate-500">
                  {[row.medrep, row.terms, counted(row.invoices, "invoice")]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-[13px] font-semibold tabular-nums text-slate-900">
                  {shortPeso(row.total)}
                </span>
                <span
                  className={`block text-[11px] ${row.overdue ? "font-semibold text-rose-600" : "text-slate-400"}`}
                >
                  {row.overdue ? `${shortPeso(row.overdue)} · ${row.oldestDays}d late` : "not late"}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </GlanceCard>
  );
}

/** The month's money in: how it came (bank, cash, check…) and day by day. */
export function CollectedCard() {
  const query = useQuery({
    queryKey: ["payments", "glance"],
    queryFn: () => api<PaymentList>("/api/payments"),
  });
  const data = query.data;
  const { shown, seeAll } = useSeeAll(data?.rows ?? [], 5);
  if (!data) return null;
  const top = Math.max(1, ...data.byDay.map((one) => one.amount));
  return (
    <GlanceCard title="Collected" note={data.monthLabel} to="/payments" seeAll={seeAll}>
      <div className="text-3xl font-semibold tracking-tight text-emerald-700 tabular-nums">
        {shortPeso(data.sum)}
      </div>
      <div className="mb-3 text-xs text-slate-500">{counted(data.total, "payment")} received</div>
      {data.byDay.length > 0 && (
        <div
          className="mb-4 flex h-16 items-end gap-1"
          role="img"
          aria-label="Collected day by day"
        >
          {data.byDay.map((one) => (
            <span
              key={one.day}
              className="min-w-1 max-w-6 flex-1 rounded-t bg-emerald-400/80"
              style={{ height: `${Math.max(6, (one.amount / top) * 100)}%` }}
              title={`${one.day}: ${shortPeso(one.amount)}`}
            />
          ))}
        </div>
      )}
      <Bars
        rows={data.byMethod.map((one) => ({
          key: one.method,
          label: one.label,
          sub: counted(one.count, "payment"),
          value: one.amount,
        }))}
        color="bg-emerald-500"
      />
      {shown.length > 0 && (
        <ul className="mt-4 divide-y divide-slate-100 border-t border-slate-100">
          {shown.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3 py-2 text-[13px]">
              <span className="min-w-0">
                <span className="block truncate font-medium text-slate-800">{row.customer}</span>
                <span className="block text-[11px] text-slate-500">
                  {row.paidOn} · {row.methodLabel}
                  {row.reference ? ` · ${row.reference}` : ""}
                </span>
              </span>
              <span className="shrink-0 font-semibold tabular-nums text-emerald-700">
                {shortPeso(row.amount)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </GlanceCard>
  );
}
