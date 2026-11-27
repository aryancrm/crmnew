// The MedRep's Home, as designed on the canvas (artboard "Main") in the old CRM's look: his
// area, one big New order button, this month's sales, where his orders stand (and what was
// sent back to him), the stock news, and his latest orders as the same cards Management sees.
// "My orders" is the same cards, every order, with tabs.

import { TeamSwitch, useTeamUnit, withUnit } from "../team/switch";
import type {
  CustomerKind,
  CustomerList,
  MyArea,
  MyKpis,
  MyOrderStage,
  MyOrders,
  Reorders,
  StockNews,
  ToCollect,
} from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { Gauge, Plus } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useMe } from "../auth";
import { shortPeso } from "../ceo";
import { avatarSolid, avatarTone, dayHeading, initials } from "../look";
import { Donut } from "../team/charts";
import { count, dayLabel, PageState, peso, manilaDay } from "../ui";
import { Figure, type Period, PeriodBox, periodWord as periodWordOf } from "../home/figures";
import { GoHereFirst, HuddleCard, TodaysPulse } from "./hospital-day";
import { RxHome } from "./rx";
import { TelesalesDay } from "./telesales";
import { CrrHome, NbdHome } from "./b2b";
import { ClidpHome } from "./clidp";
import { BiddingHome } from "./tenders";
import { b2bRole, shownChannel } from "../seat-words";
import { greeting, todayWords } from "../home/home";
import { OrderCardItem } from "../orders/board";
import { HospitalsCard } from "./hospitals";
import { MyKpis as KpiPanel } from "../kpis/my-kpis";
import { allItems, spaceFor } from "../menus";
import { EmptyState, NoInvoicesArt } from "../no-results";
import { FieldDayCard } from "../mr/home";

const NEWS: Record<StockNews["kind"], { label: string; style: string }> = {
  out: { label: "Out of stock", style: "bg-rose-50 text-rose-700" },
  low: { label: "Low stock", style: "bg-amber-50 text-amber-800" },
  back: { label: "Back in stock", style: "bg-emerald-50 text-emerald-800" },
  note: { label: "Note", style: "bg-slate-100 text-slate-700" },
};

const useMine = (stage: MyOrderStage = "all", page = 1, unit: string | null = null, division: string | null = null) =>
  useQuery({
    queryKey: ["orders", "mine", stage, page, unit, division],
    queryFn: () =>
      api<MyOrders>(
        withUnit(
          `/api/orders/mine?stage=${stage}&page=${page}${division ? `&division=${encodeURIComponent(division)}` : ""}`,
          unit,
        ),
      ),
    placeholderData: (previous) => previous,
    refetchInterval: 60_000,
  });

const STATUS_PILL: Partial<Record<string, string>> = {
  pending_approval: "bg-violet-50 text-violet-700",
  finance_check: "bg-amber-50 text-amber-800",
  ready_for_invoice: "bg-amber-50 text-amber-800",
  ready_for_dispatch: "bg-sky-50 text-sky-700",
  packing: "bg-sky-50 text-sky-700",
  shipped: "bg-teal-50 text-teal-700",
  completed: "bg-emerald-50 text-emerald-700",
  on_hold: "bg-rose-50 text-rose-700",
  exception: "bg-rose-50 text-rose-700",
  cancelled: "bg-slate-100 text-slate-500",
};

const SCORE_STATUS = {
  strong: {
    label: "Strong",
    style: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    bar: "bg-emerald-600",
  },
  watch: {
    label: "Watch",
    // Green, as Aryan asked (26 Nov).
    style: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    bar: "bg-amber-500",
  },
  review: { label: "Review", style: "bg-rose-50 text-rose-700 ring-rose-200", bar: "bg-rose-500" },
  none: {
    label: "No data yet",
    style: "bg-slate-50 text-slate-600 ring-slate-200",
    bar: "bg-slate-300",
  },
} as const;

const KIND_TABS: { key: CustomerKind; label: string }[] = [
  { key: "hospital", label: "Hospitals" },
  { key: "doctor", label: "Doctors" },
  { key: "patient", label: "Patients" },
];

/** The MedRep's Home: their figures for a day or the month, their scorecard, the orders of that
 *  period, and every customer and patient they look after. White and slate, the case page's
 *  boxes; the one green is New order. */
export function MedrepHome() {
  const me = useMe().data;
  const [params, setParams] = useSearchParams();
  const period = (params.get("period") ?? "today") as Period;
  const day = params.get("day") ?? "";
  // Each seat opens on the buyers it serves (Aryan, 19 Nov: every screen by its own work): an Rx
  // CHC's doctors; MD Telesales' and the PAP officer's patients; everyone else's hospitals.
  const [kind, setKind] = useState<CustomerKind>(
    me?.channel?.code === "RX"
      ? "doctor"
      : (me?.channel?.code === "TS" && me.business === "RX") || me?.channel?.code === "PAP"
        ? "patient"
        : "hospital",
  );
  const set = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next, { replace: true });
  };
  const kpis = useQuery({
    queryKey: ["orders", "kpis", period, day],
    queryFn: () => api<MyKpis>(`/api/orders/kpis?period=${period}${day ? `&day=${day}` : ""}`),
    placeholderData: (previous) => previous,
    refetchInterval: 60_000,
  });
  const area = useQuery({
    queryKey: ["customers", "area"],
    queryFn: () => api<MyArea>("/api/my/area"),
  });
  const mine = useMine();
  const customers = useQuery({
    queryKey: ["customers", "list", kind, "", 1, false],
    queryFn: () => api<CustomerList>(`/api/customers?kind=${kind}&q=&page=1`),
  });
  const news = useQuery({
    queryKey: ["inventory", "news"],
    queryFn: async () => (await api<{ news: StockNews[] }>("/api/stock-news")).news,
  });
  if (!me) return null;
  const hospital = me.channel?.code === "HOSP";
  const rx = me.channel?.code === "RX";
  // Telesales by their box on the chart: oncology (Prescription) or anesthesia (Hospital Division).
  const telesales = me.channel?.code === "TS" && me.business === "RX";
  const anesthesia = me.channel?.code === "TS" && me.business === "HOSP";
  const b2b = b2bRole(me);
  const bidding = me.channel?.code === "BID";
  const data = kpis.data;
  const sales = mine.data?.sales;
  const periodWord = periodWordOf(period, data?.day ?? null);

  return (
    // home-skin: the boxes take the KPI cards' look (styles.css), the page only.
    <div className="home-skin mx-auto max-w-screen-xl space-y-4">
      {/* Who and when, and the one thing to do. */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs text-slate-500">{todayWords()}</div>
          <h1 className="text-[28px] font-semibold tracking-tight text-slate-900">
            {greeting()}, {me.name.split(" ")[0]}
          </h1>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
            {me.channel && (
              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-medium tracking-wide text-slate-600 uppercase">
                {shownChannel(me)}
              </span>
            )}
            {me.area && <span>{me.area.name}</span>}
            {area.data && area.data.line.length > 0 && (
              <span className="text-slate-400">· reports to {area.data.line.join(" · ")}</span>
            )}
          </div>
        </div>
      </div>

      {/* A field rep's day first: where it stands and the one thing to do next (Aryan, 23 Nov). */}
      <FieldDayCard />

      {/* The hub's My KPIs: sales without VAT against target, the counts, a day's sales (PLAN 23). */}
      <KpiPanel />

      {/* A Hospital CHC's day starts with the pulse and where to go first (docs/PLAN.md 16.1). */}
      {(hospital || anesthesia) && <TodaysPulse />}
      {(hospital || anesthesia) && <GoHereFirst />}
      {/* Their hospitals: whom to call, accreditation ending, formulary waiting, money (19 Nov). */}
      {hospital && <HospitalsCard first="due" colours />}
      {/* An Rx CHC's day: the doctors, today's route, PAP (docs/PLAN.md 16.2). No sales target here. */}
      {rx && <RxHome />}
      {/* MD Telesales: the pulse, the groups waiting (15 minutes), the refills due. */}
      {telesales && <TodaysPulse />}
      {telesales && <TelesalesDay />}
      {/* B2B: the NBD's prospects to hand-over, the CRR's accounts against their usual gap. */}
      {b2b === "nbd" && <NbdHome />}
      {b2b === "crr" && <CrrHome />}
      {b2b === "clidp" && <ClidpHome />}
      {/* Government Bidding: tenders from posting to payment. */}
      {(bidding || (hospital && /bidding/i.test(me.title ?? ""))) && <BiddingHome />}

      {/* Today and this month at a glance: the two numbers asked most. */}
      {!hospital && !anesthesia && !rx && !telesales && !b2b && !bidding && (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Figure
          label="Orders today"
          value={data ? count(data.todayOrders) : "—"}
          sub={data ? peso(data.todayValue) : undefined}
        />
        <Figure
          label="Orders this month"
          value={data ? count(data.monthOrders) : "—"}
          sub={data ? peso(data.monthValue) : undefined}
        />
        <Figure
          label={`Sales${sales ? `, ${sales.month}` : ""}`}
          value={sales ? peso(sales.value) : "—"}
          sub={sales?.target ? `of ${peso(sales.target)} target` : "invoiced"}
        />
        <Figure
          label="Scorecard"
          value={
            data
              ? data.scorecard.max
                ? `${data.scorecard.total}/${data.scorecard.max}`
                : "—"
              : "—"
          }
          sub={data ? SCORE_STATUS[data.scorecard.status].label : undefined}
        />
      </div>
      )}

      {/* The period's figures: what was submitted and where it stands now. */}
      <PeriodBox
        colours
        title="My orders"
        period={period}
        day={day}
        shownDay={data?.day}
        today={data?.today}
        faded={kpis.isPlaceholderData}
        error={kpis.isError ? "Couldn't read your figures. Pull to refresh." : null}
        onPick={(next, picked) => set({ period: next === "today" ? "" : next, day: picked })}
        cells={[
          {
            label: "Total submitted",
            value: data?.submitted,
            sub: data ? peso(data.submittedValue) : null,
            to: "/orders?stage=all",
          },
          {
            label: "Pending validation",
            value: data?.pending,
            sub: "Management or Finance",
            to: "/orders?stage=management",
          },
          {
            label: "In fulfilment",
            value: data?.fulfilment,
            sub: "packing or on the way",
            to: "/orders?stage=dispatch",
          },
          {
            label: "Completed",
            value: data?.completed,
            sub: data ? peso(data.completedValue) : null,
            to: "/orders?stage=delivered",
          },
          { label: "Cancelled", value: data?.cancelled, to: "/orders?stage=all" },
          { label: "New customers", value: data?.newCustomers, sub: "added by you" },
        ]}
      />

      {/* What came from which Division this month (Aryan, 19 Nov: every MedRep's screen says what
          they brought from which channel); each opens those orders. */}
      {(mine.data?.byDivision.length ?? 0) > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-semibold text-slate-500">
            {mine.data?.sales.month} by Division
          </span>
          {mine.data?.byDivision.map((one) => (
            <Link
              key={one.division}
              to={`/orders?division=${encodeURIComponent(one.division)}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:border-slate-300 hover:bg-slate-50"
            >
              {one.division}
              <span className="text-slate-500 tabular-nums">
                {count(one.orders)} · {shortPeso(one.value)}
              </span>
            </Link>
          ))}
        </div>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-4">
          {/* The scorecard: the seat's playbook card, this month so far; My score has the whole of it. */}
          {data && data.scorecard.status !== "none" && (
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-slate-50/70 px-4 py-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white text-slate-600">
                  <Gauge className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-bold text-slate-900">
                    My KPIs · {data.scorecard.month}
                  </h3>
                  <div className="text-[11px] text-slate-500">
                    {data.scorecard.card} scorecard, this month so far ·{" "}
                    <Link to="/my/score" className="font-semibold text-emerald-700 hover:underline">
                      Open
                    </Link>
                  </div>
                </div>
                <span
                  className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ring-1 ${SCORE_STATUS[data.scorecard.status].style}`}
                >
                  {SCORE_STATUS[data.scorecard.status].label}
                </span>
                <span className="text-xl font-bold tracking-tight text-slate-900 tabular-nums">
                  {data.scorecard.total}
                  <span className="text-sm font-semibold text-slate-400">
                    /{data.scorecard.max || 100}
                  </span>
                </span>
              </header>
              <ul className="divide-y divide-slate-100">
                {data.scorecard.kpis.map((kpi) => (
                  <li
                    key={kpi.code}
                    className="grid grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3"
                  >
                    <span className="rounded-md bg-white py-1 text-center text-[11px] font-bold text-slate-700">
                      {kpi.code}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="text-sm font-semibold text-slate-900">{kpi.label}</span>
                        <span className="text-sm font-bold text-slate-900 tabular-nums">
                          {kpi.value === null
                            ? "—"
                            : `${count(kpi.value)}${kpi.unit === "%" ? "%" : kpi.unit === "days" ? " days" : ""}`}
                        </span>
                      </div>
                      <div className="truncate text-[11px] text-slate-500">{kpi.note}</div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={`h-full rounded-full ${kpi.points === null ? "bg-slate-200" : kpi.points >= kpi.weight * 0.8 ? "bg-emerald-600" : kpi.points > 0 ? "bg-amber-500" : "bg-rose-500"}`}
                          style={{
                            width: `${kpi.points === null ? 0 : Math.max(4, (kpi.points / kpi.weight) * 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                    <span className="text-right text-sm font-bold text-slate-900 tabular-nums">
                      {kpi.weight === 0 ? (
                        <span className="text-xs font-medium text-slate-500">gate</span>
                      ) : kpi.points === null ? (
                        <span className="text-xs font-medium text-slate-400">no data</span>
                      ) : (
                        kpi.points
                      )}
                      {kpi.weight > 0 && <span className="text-[11px] font-medium text-slate-400">/{kpi.weight}</span>}
                    </span>
                  </li>
                ))}
              </ul>
              {data.scorecard.capped && (
                <div className="border-t border-slate-100 px-4 py-2.5 text-[11px] text-rose-700">
                  The total is capped at {data.scorecard.total}: a capping rule of the card applies (see My score).
                </div>
              )}
            </section>
          )}

          {/* The period's orders. */}
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <header className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/70 px-4 py-3">
              <h3 className="text-sm font-bold text-slate-900">
                Orders · {periodWord}
                {data && (
                  <span className="ml-1.5 text-xs font-medium text-slate-400">
                    {count(data.orders.length)}
                  </span>
                )}
              </h3>
              <Link
                to="/orders"
                className="text-xs font-medium text-slate-600 hover:text-slate-900"
              >
                All my orders
              </Link>
            </header>
            {!data ? (
              <div className="px-4 py-6 text-center text-sm text-slate-500">
                {kpis.isError ? "Couldn't read your orders." : "Reading…"}
              </div>
            ) : data.orders.length === 0 ? (
              // The same words and link, with the receipt drawn above them (Aryan, 26 Nov).
              <EmptyState
                title={`No order ${period === "month" ? "this month" : period === "today" ? "today" : "that day"}.`}
              >
                <Link
                  to="/orders/new"
                  className="font-semibold text-emerald-700 underline-offset-2 hover:underline"
                >
                  Place one
                </Link>
              </EmptyState>
            ) : (
              <ul className="divide-y divide-slate-100">
                {data.orders.map((order) => (
                  <li key={order.id}>
                    <Link
                      to={`/orders/${order.id}`}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50"
                    >
                      <span
                        className={`flex size-9 shrink-0 items-center justify-center rounded-xl text-[11px] font-bold ${avatarTone(order.customer)}`}
                      >
                        {initials(order.customer)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-2">
                          <span className="truncate text-sm font-semibold text-slate-900">
                            {order.customer}
                          </span>
                          <span className="shrink-0 text-[11px] text-slate-400">{order.code}</span>
                          {order.changed && (
                            <span className="shrink-0 rounded-md bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700">
                              Changed by Mgmt
                            </span>
                          )}
                        </span>
                        <span className="block truncate text-xs text-slate-500">
                          {order.lines ?? "—"}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-sm font-semibold text-slate-900 tabular-nums">
                          {peso(order.total)}
                        </span>
                        <span
                          className={`mt-0.5 inline-block rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_PILL[order.status] ?? ""}`}
                        >
                          {order.statusLabel}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {(mine.data?.held ?? []).map((row) => (
            <Link
              key={row.id}
              // A sent-back order opens straight in its fix form; a held one on its page.
              to={row.status === "draft" ? `/orders/${row.id}/fix` : `/orders/${row.id}`}
              className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs text-slate-700 shadow-2xs hover:border-slate-300"
            >
              <span
                className={`size-2 shrink-0 rounded-full ${row.status === "draft" ? "bg-amber-400" : "bg-rose-500"}`}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">
                <span className="font-semibold">
                  {row.code} · {row.customer}{" "}
                  {row.status === "draft" ? "was sent back." : "is on hold."}
                </span>{" "}
                {row.reason}
              </span>
              <span className="font-semibold text-emerald-700">
                {row.status === "draft" ? "Fix" : "Open"}
              </span>
            </Link>
          ))}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          {/* Every customer they look after. */}
          {!b2b && (
<section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <header className="flex items-center justify-between gap-2 px-4 pt-3">
              <h3 className="text-sm font-bold text-slate-900">My customers</h3>
              <Link
                to={`/my/area?kind=${kind}`}
                className="text-xs font-medium text-slate-600 hover:text-slate-900"
              >
                See all
              </Link>
            </header>
            {/* As My KPIs' periods (Aryan, 26 Nov): a soft grey track, the picked one a white chip. */}
            <div role="tablist" className="mx-3 mt-2 flex gap-0.5 rounded-lg bg-slate-100 p-1">
              {KIND_TABS.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={kind === tab.key}
                  onClick={() => setKind(tab.key)}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors ${
                    kind === tab.key
                      ? "bg-white text-slate-900 shadow-[0_1px_3px_rgba(15,23,42,0.12)]"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  {tab.label}
                  <span
                    className={`inline-grid h-5 min-w-5 shrink-0 place-items-center rounded-full px-1 text-[10px] leading-none font-semibold text-slate-900 tabular-nums ${kind === tab.key ? "bg-slate-100" : "bg-white"}`}
                  >
                    {count(area.data?.counts[tab.key] ?? 0)}
                  </span>
                </button>
              ))}
            </div>
            <ul className="mt-2 divide-y divide-slate-100 border-t border-slate-100">
              {(customers.data?.rows ?? []).slice(0, 7).map((row) => (
                <li key={row.id}>
                  <Link
                    to={`/customers/${row.id}`}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50"
                  >
                    <span
                      className={`flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${avatarSolid(row.name)}`}
                    >
                      {initials(row.name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold text-slate-900">
                        {row.name}
                      </span>
                      <span className="block truncate text-[11px] text-slate-500">
                        {row.orders > 0
                          ? `${count(row.orders)} order${row.orders === 1 ? "" : "s"} · last ${row.lastOrderAt ? dayLabel(manilaDay(row.lastOrderAt)) : ""}`
                          : [row.city, row.phone].filter(Boolean).join(" · ") || "No order yet"}
                      </span>
                    </span>
                    {row.review === "to_review" && (
                      <span className="shrink-0 rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900">
                        New
                      </span>
                    )}
                  </Link>
                </li>
              ))}
              {customers.data && customers.data.rows.length === 0 && (
                <li>
                  <EmptyState art={<NoInvoicesArt size={72} />} title="None yet.">
                    The customers you look after show here.
                  </EmptyState>
                </li>
              )}
            </ul>
            {area.data && area.data.quiet > 0 && (
              <Link
                to="/customers?sort=quiet"
                className="flex items-center justify-between gap-2 border-t border-slate-100 px-4 py-2.5 text-xs text-slate-600 hover:bg-slate-50"
              >
                <span>
                  <b className="text-slate-900">{count(area.data.quiet)}</b> haven't ordered in 60
                  days
                </span>
                <span aria-hidden="true">→</span>
              </Link>
            )}
          </section>
          )}

          <MyOrdersNow />

          {hospital && !/bidding/i.test(me.title ?? "") && <HuddleCard />}
          {!hospital && <ToCollectPanel />}
          {!hospital && !anesthesia && !rx && !telesales && !b2b && !bidding && <ToCallPanel />}

          {!hospital && !anesthesia && !rx && !telesales && sales && sales.target !== null && sales.target > 0 && (
            <section className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-2xs">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold tracking-tight text-slate-900">
                  Target, {sales.month}
                </h3>
                <span className="text-[11px] text-slate-500">{sales.daysLeft} days left</span>
              </div>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
                <span className="text-xl font-bold tracking-tight text-slate-900 tabular-nums">
                  {peso(sales.value)}
                </span>
                <span className="text-xs text-slate-500">of {peso(sales.target)}</span>
              </div>
              <div className="mt-2">
                <TargetBar sales={sales} />
              </div>
            </section>
          )}

          {news.data && news.data.length > 0 && (
            <section className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-2xs">
              <h3 className="mb-1 border-b border-slate-100 pb-2.5 text-sm font-semibold tracking-tight text-slate-900">
                Stock news
              </h3>
              {news.data.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-3 border-b border-slate-100 py-2 text-xs last:border-b-0"
                >
                  <Link
                    to={`/medicines/${item.medicineId}`}
                    className="min-w-0 truncate text-slate-800 hover:text-slate-950"
                    title={item.message ?? undefined}
                  >
                    {item.medicine}
                  </Link>
                  <span
                    className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold ${NEWS[item.kind].style}`}
                  >
                    {NEWS[item.kind].label}
                  </span>
                </div>
              ))}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

const STAGE_TABS: { key: MyOrderStage; label: string }[] = [
  { key: "all", label: "All" },
  { key: "sent_back", label: "Sent back" },
  { key: "management", label: "With Management" },
  { key: "finance", label: "With Finance" },
  { key: "dispatch", label: "Packing or on the way" },
  { key: "held", label: "On hold" },
  { key: "delivered", label: "Delivered this month" },
];

/** The order banner's parcel in the portal's four colours (Aryan, 26 Nov): the top yellow, the
 *  front blue, the side red, a green plus. */
function OrderParcel() {
  return (
    <svg viewBox="0 0 48 48" className="size-16" aria-hidden="true">
      <path d="M24 6l16 8-16 8-16-8z" fill="#f5c400" stroke="#111827" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M8 14l16 8v20L8 34z" fill="#1d9fda" stroke="#111827" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M40 14l-16 8v20l16-8z" fill="#e8505b" stroke="#111827" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M16 10l16 8v6" fill="none" stroke="#111827" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="38" cy="37" r="7.5" fill="#22b378" stroke="#ffffff" strokeWidth="2" />
      <path d="M38 33.5v7M34.5 37h7" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** A MedRep's (or a team lead's) orders as cards, by where they stand. */
export function MyOrdersPage() {
  const me = useMe().data;
  const [params, setParams] = useSearchParams();
  const stage = (params.get("stage") ?? "all") as MyOrderStage;
  const page = Number(params.get("page")) || 1;
  const unit = useTeamUnit();
  const division = params.get("division");
  const mine = useMine(stage, page, unit, division);
  const data = mine.data;
  const team = me?.role === "team_lead" || me?.role === "manager";
  // A head's banner names the page as his menu does (Javed's and Subir's "Business orders").
  const menuName =
    me?.role === "manager"
      ? allItems(spaceFor(me, "/orders").groups.flatMap((group) => group.items)).find((item) => item.to === "/orders")?.label
      : undefined;
  if (!data) return <PageState query={mine} what="your orders" />;
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const days = [...new Set(data.cards.map((card) => card.placedOn))];
  // Nothing in any tab: no order placed in this CRM yet (the month's earlier orders came from Zoho).
  const none = STAGE_TABS.every((tab) => data.counts[tab.key] === 0);

  return (
    <div className="mx-auto max-w-screen-2xl">
      {/* The title sits in the order banner below (Aryan, 26 Nov); the Online desk, with no banner,
          keeps it here. No count pill after it: the All tab says it. */}
      {me?.role === "online" && (
        <h1 className="text-[28px] font-semibold tracking-tight text-ink">{team ? "Team orders" : "My orders"}</h1>
      )}

      {team && (
        <div className="mt-4">
          <TeamSwitch />
        </div>
      )}
      {/* What came from which Division this month (Aryan, 19 Nov: a MedRep may bring another
          Division's order; their screen says what came from which); a press shows only those. */}
      {/* The order banner (Aryan, 26 Nov, after a "Create Your Order" banner he gave, not copied): on
          the left a parcel in the four colours with speed lines, a thin line, the title and a line
          under it; on the right the month by Division and the black Create New Order. The Online desk
          doesn't place orders here (theirs start as cases): it keeps the Divisions alone. */}
      {me?.role !== "online" ? (
        // No box, no border (Aryan, 26 Nov): the parcel, the page's title and the line under it on the
        // left; the Divisions and Create New Order on the right.
        <section>
          <div className="grid items-center gap-y-3 md:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
            <div className="flex items-center gap-4">
              <span aria-hidden="true" className="flex shrink-0 items-center">
                {/* Speed lines, as if the parcel is on its way. */}
                <span className="mr-1.5 flex flex-col items-end gap-1">
                  <span className="h-0.5 w-4 rounded-full bg-slate-300" />
                  <span className="h-0.5 w-6 rounded-full bg-slate-400" />
                  <span className="h-0.5 w-3 rounded-full bg-slate-300" />
                </span>
                <OrderParcel />
              </span>
              <span aria-hidden="true" className="h-12 w-px shrink-0 bg-slate-200" />
              <div className="min-w-0">
                <h1 className="text-[32px] leading-tight font-semibold tracking-tight text-ink">
                  {menuName ?? (team ? "Team orders" : "My orders")}
                </h1>
                <p className="mt-0.5 text-[13px] text-slate-500">Pick the customer and the medicines; Management checks it next.</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            {data.byDivision.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-xs font-semibold text-slate-500">{data.sales.month} by Division</span>
                {data.byDivision.map((one) => {
                  const on = data.division === one.division;
                  return (
                    <button
                      key={one.division}
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        const next = new URLSearchParams(params);
                        if (on) next.delete("division");
                        else next.set("division", one.division);
                        next.delete("page");
                        setParams(next, { replace: true });
                      }}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors ${
                        on
                          ? "border-brand bg-brand text-white"
                          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      {one.division}
                      <span className={`tabular-nums ${on ? "text-white/80" : "text-slate-500"}`}>
                        {count(one.orders)} · {shortPeso(one.value)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
              {/* Every seller's own way in, as the hub's "+ New Order" on My Orders. */}
              <Link
                to="/orders/new"
                className="ml-auto inline-flex items-center justify-center gap-2 rounded-[10px] bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-black"
              >
                <Plus className="size-4" /> Create New Order
              </Link>
            </div>
          </div>
        </section>
      ) : (
        <div className="mt-4">
        {data.byDivision.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs font-semibold text-slate-500">{data.sales.month} by Division</span>
            {data.byDivision.map((one) => {
              const on = data.division === one.division;
              return (
                <button
                  key={one.division}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    const next = new URLSearchParams(params);
                    if (on) next.delete("division");
                    else next.set("division", one.division);
                    next.delete("page");
                    setParams(next, { replace: true });
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors ${
                    on
                      ? "border-brand bg-brand text-white"
                      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  {one.division}
                  <span className={`tabular-nums ${on ? "text-white/80" : "text-slate-500"}`}>
                    {count(one.orders)} · {shortPeso(one.value)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        </div>
      )}
      {/* As My KPIs' periods (Aryan, 26 Nov): a soft grey track, the picked tab a raised white chip. */}
      <div className="mt-3 rounded-lg bg-slate-100 p-1">
        <div
          role="tablist"
          aria-label="Orders"
          className="flex gap-0.5 overflow-x-auto [scrollbar-width:none]"
        >
          {STAGE_TABS.map((tab) => {
            const selected = tab.key === data.stage;
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() =>
                  setParams(
                    {
                      ...(tab.key === "all" ? {} : { stage: tab.key }),
                      ...(unit ? { unit } : {}),
                      ...(division ? { division } : {}),
                    },
                    { replace: true },
                  )
                }
                className={`flex shrink-0 items-center gap-1.5 rounded-md px-3.5 py-1.5 text-[13px] transition-colors ${
                  selected
                    ? "bg-white text-slate-900 shadow-[0_1px_3px_rgba(15,23,42,0.12)]"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                {(tab.key === "held" || tab.key === "sent_back") && (
                  <span
                    aria-hidden="true"
                    className={`size-1.5 rounded-full ${tab.key === "sent_back" ? "bg-amber-400" : "bg-rose-500"}`}
                  />
                )}
                <span>{tab.key === "sent_back" && !team ? "Sent back to me" : tab.label}</span>
                <span
                  className={`inline-grid h-5 min-w-5 shrink-0 place-items-center rounded-full px-1 text-[10px] leading-none font-semibold text-slate-900 tabular-nums ${selected ? "bg-slate-100" : "bg-white"}`}
                >
                  {count(data.counts[tab.key])}
                </span>
              </button>
            );
          })}
          <Link
            to="/returns"
            className="ml-auto flex shrink-0 items-center rounded-md px-3.5 py-1.5 text-[13px] text-slate-500 transition-colors hover:text-slate-800"
          >
            Returns
          </Link>
        </div>
      </div>

      <div className={`mt-4 space-y-4 ${mine.isPlaceholderData ? "opacity-60" : ""}`}>
        {data.cards.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white">
            {team && none ? (
              <EmptyState title="No order placed in this CRM yet for your team.">
                This month's earlier orders (from Zoho) are on your Home, under How the orders came and Orders by person.
              </EmptyState>
            ) : (
              <EmptyState title="No order here.">Orders in this tab show here. Try another tab.</EmptyState>
            )}
          </div>
        ) : (
          days.map((day) => {
            const cards = data.cards.filter((card) => card.placedOn === day);
            return (
              <section key={day} aria-label={`Orders placed ${dayHeading(day)}`}>
                <div className="mb-2.5 flex flex-wrap items-center gap-2">
                  <h2 className="text-xs font-semibold text-slate-700">{dayHeading(day)}</h2>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 tabular-nums">
                    {cards.length} {cards.length === 1 ? "order" : "orders"}
                  </span>
                  <span className="h-px min-w-6 flex-1 bg-slate-200/70" />
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {cards.map((card) => (
                    <OrderCardItem
                      key={card.id}
                      card={card}
                      fixable={!team || card.medrepId === me?.id}
                      showRep={team}
                      manage={false}
                      busy={false}
                      onApprove={() => {}}
                      onResume={() => {}}
                      onAsk={() => {}}
                    />
                  ))}
                </div>
              </section>
            );
          })
        )}
        {pages > 1 && (
          <div className="flex items-center justify-end gap-2 text-xs text-slate-500">
            Page {data.page} of {pages}
            <button
              type="button"
              disabled={data.page <= 1}
              onClick={() => setParams({ stage, page: String(data.page - 1), ...(unit ? { unit } : {}), ...(division ? { division } : {}) })}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-medium disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={data.page >= pages}
              onClick={() => setParams({ stage, page: String(data.page + 1), ...(unit ? { unit } : {}), ...(division ? { division } : {}) })}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-medium disabled:opacity-40"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function TargetBar({ sales }: { sales: MyOrders["sales"] }) {
  const target = sales.target ?? 1;
  const done = Math.round((100 * sales.value) / target);
  const shouldBe = Math.round((100 * sales.day) / sales.daysInMonth);
  const behind = done < shouldBe;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative h-2.5 rounded-full bg-slate-100">
        <div
          className={`h-2.5 rounded-full ${behind ? "bg-amber-500" : "bg-emerald-500"}`}
          style={{ width: `${Math.min(100, done)}%` }}
        />
        <div
          className="absolute -top-1 h-[18px] w-0.5 rounded bg-slate-800"
          style={{ left: `${shouldBe}%` }}
          title={`Where the month is: ${shouldBe}%`}
        />
      </div>
      <div className={`text-xs font-medium ${behind ? "text-amber-700" : "text-emerald-700"}`}>
        {done}% ·{" "}
        {behind ? `should be ${shouldBe}% today` : `ahead of the ${shouldBe}% the month is at`}
      </div>
    </div>
  );
}

const BUCKET_TONE: Record<string, { bar: string; text: string }> = {
  not_due: { bar: "bg-emerald-500", text: "text-emerald-700" },
  d30: { bar: "bg-amber-400", text: "text-amber-700" },
  d60: { bar: "bg-orange-500", text: "text-orange-700" },
  older: { bar: "bg-rose-500", text: "text-rose-700" },
};

/** The money his customers owe on his orders: the total, how late it is, and the oldest to chase. */
function ToCollectPanel() {
  const query = useQuery({
    queryKey: ["my", "collect"],
    queryFn: () => api<ToCollect>("/api/my/collect"),
  });
  const data = query.data;
  if (!data || data.total === 0) return null;
  const late = data.rows.filter((row) => row.daysLate > 0);
  return (
    <section className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-2xs">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold tracking-tight text-slate-900">To collect</h3>
        <span className="text-lg font-semibold tracking-tight text-slate-900 tabular-nums">
          {shortPeso(data.total)}
        </span>
      </div>
      <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-slate-100">
        {data.buckets
          .filter((one) => one.amount > 0)
          .map((one) => (
            <span
              key={one.key}
              className={BUCKET_TONE[one.key]?.bar}
              style={{ width: `${(one.amount / data.total) * 100}%` }}
              title={`${one.label}: ${shortPeso(one.amount)}`}
            />
          ))}
      </div>
      <ul className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
        {data.buckets.map((one) => (
          <li key={one.key} className="flex items-center justify-between gap-1">
            <span className="flex items-center gap-1.5 text-slate-500">
              <span className={`size-2 rounded-full ${BUCKET_TONE[one.key]?.bar}`} />
              {one.label}
            </span>
            <span
              className={`font-semibold tabular-nums ${one.amount ? BUCKET_TONE[one.key]?.text : "text-slate-300"}`}
            >
              {shortPeso(one.amount)}
            </span>
          </li>
        ))}
      </ul>
      {late.length > 0 && (
        <ul className="mt-3 divide-y divide-slate-100 border-t border-slate-100">
          {late.slice(0, 5).map((row) => (
            <li key={row.invoiceId}>
              <Link
                to={`/orders/${row.orderId}`}
                className="-mx-1 flex items-center justify-between gap-2 rounded-md px-1 py-1.5 hover:bg-slate-50"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium text-slate-800">
                    {row.customer}
                  </span>
                  <span className="text-[11px] text-slate-400">{row.orderCode}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-[13px] font-semibold tabular-nums text-slate-900">
                    {shortPeso(row.balance)}
                  </span>
                  <span
                    className={`text-[11px] font-semibold ${row.daysLate > 60 ? "text-rose-600" : row.daysLate > 30 ? "text-orange-600" : "text-amber-700"}`}
                  >
                    {row.daysLate} days late
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** His customers due to reorder against their own usual gap, the biggest first; the page has all. */
function ToCallPanel() {
  const query = useQuery({
    queryKey: ["reorders", "due", null, null],
    queryFn: () => api<Reorders>("/api/my/reorders?state=due"),
  });
  const data = query.data;
  if (!data) return null;
  const of = (key: string) => data.counts.find((one) => one.state === key)?.customers ?? 0;
  if (!of("due") && !of("late") && !of("at_risk")) return null;
  return (
    <section className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-2xs">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold tracking-tight text-slate-900">Customers to call</h3>
        <Link to="/to-call" className="text-[12px] font-semibold text-emerald-700 hover:underline">
          All
        </Link>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-center">
        {(
          [
            ["due", "Due now", "text-slate-900"],
            ["late", "Late", "text-amber-700"],
            ["at_risk", "At risk", "text-rose-700"],
          ] as const
        ).map(([key, label, tone]) => (
          <Link key={key} to={`/to-call?state=${key}`} className="rounded-lg bg-slate-50 px-2 py-1.5 hover:bg-slate-100">
            <div className={`text-lg font-semibold tabular-nums ${tone}`}>{count(of(key))}</div>
            <div className="text-[11px] text-slate-500">{label}</div>
          </Link>
        ))}
      </div>
      {data.rows.length > 0 && (
        <ul className="mt-3 divide-y divide-slate-100 border-t border-slate-100">
          {data.rows.slice(0, 5).map((row) => (
            <li key={row.customerId}>
              <Link
                to={`/customers/${row.customerId}`}
                className="-mx-1 flex items-center justify-between gap-2 rounded-md px-1 py-1.5 hover:bg-slate-50"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium text-slate-800">{row.name}</span>
                  <span className="text-[11px] text-slate-400">
                    every {row.usual} days · last {row.since} days ago
                  </span>
                </span>
                <span className="shrink-0 text-[13px] font-semibold tabular-nums text-slate-900">{shortPeso(row.lastTotal)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Where his open orders wait now, as the team page's donut. */
function MyOrdersNow() {
  const mine = useMine("all", 1);
  const counts = mine.data?.counts;
  if (!counts) return null;
  const open =
    counts.management + counts.finance + counts.dispatch + counts.held + counts.sent_back;
  if (!open) return null;
  return (
    <section className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-2xs">
      <h3 className="mb-3 text-sm font-semibold tracking-tight text-slate-900">
        My orders right now
      </h3>
      <Donut
        centred
        label="open"
        middle={String(open)}
        slices={[
          { label: "With Management", value: counts.management, color: "#8b5cf6" },
          { label: "With Finance", value: counts.finance, color: "#f59e0b" },
          { label: "Packing or on the way", value: counts.dispatch, color: "#0ea5e9" },
          { label: "On hold", value: counts.held, color: "#f43f5e" },
          { label: "Sent back to me", value: counts.sent_back, color: "#fbbf24" },
        ]}
      />
    </section>
  );
}
