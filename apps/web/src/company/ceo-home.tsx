// The CEO Home, brought over from the old CRM as it was (frontend/components/ceo-home.tsx, the
// shape the owner approved): the greeting and the month picker; four figures for the month
// (sales against target with the pace, collected, what customers owe, the orders waiting); the
// company as eight summaries, each opening its app; the channels against their targets; and
// what needs the CEO now. One read, `/api/ceo/home`.

import type { CeoAlert, CeoHome as Data, MoneySummary, PaceTone } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  ChevronRight,
  Hourglass,
  Landmark,
  PackageX,
  TrendingDown,
  Undo2,
  UserPlus,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useMe } from "../auth";
import { collectedChange, counted, exactPeso, monthShort, shortPeso } from "../ceo";
import { AtWorkCard } from "../hr/parts";
import {
  ChannelSalesCard,
  CollectedCard,
  CustomersCard,
  MedicinesCard,
  OrdersNowCard,
  OwedCard,
  PeopleCard,
  PlacedToDeliveredCard,
  SpeedCards,
  TeamsCard,
  useBoard,
  useSpeed,
} from "../team/glance";
import { RangePicker } from "../team/range";
import { PageState } from "../ui";
import { CompanyGlance } from "./glance";
import { KpiCard } from "./kpi-card";
import { MyKpis } from "../kpis/my-kpis";
import { greeting, todayWords } from "../home/home";

type Icon = React.ComponentType<{ className?: string }>;
const num = (n: number) => n.toLocaleString("en-PH");
/** A white card with a hairline border, flat. */
const CARD = "rounded-xl border border-slate-200 bg-white";

/** The company at a glance for the days picked: orders right now, how long each desk takes, who
 *  sells most, which team is ahead, the medicines and the customers; each card opens its page. */
function AtAGlance({ money, stock }: { money: Data["money"]; stock: Data["stock"] }) {
  const board = useBoard();
  const speed = useSpeed();
  return (
    <>
      {speed.data && (
        <section aria-label="Desks" className="space-y-3">
          <SpeedCards report={speed.data} />
        </section>
      )}
      <section aria-label="Delivery, what we owe, stock" className="grid gap-3 lg:grid-cols-3">
        {speed.data ? <PlacedToDeliveredCard report={speed.data} /> : <span />}
        <MoneySide
          title="We owe"
          tone="out"
          total={money.refundsOwed + money.billsValue}
          rows={[
            {
              label: `Supplier bills unpaid (${num(money.billsOpen)})`,
              value: money.billsValue,
              to: "/books/bills",
            },
            {
              label: "Refunds to customers",
              value: money.refundsOwed,
              to: "/refunds",
              bad: money.refundsOwed > 0,
            },
            {
              label: `Ordered from suppliers, not received (${money.purchasesOpen})`,
              value: money.purchasesValue,
              to: "/books/purchaseorders",
              note: "Billed when it comes in",
            },
          ]}
        />
        <StockCard stock={stock} />
      </section>
      <AtWorkCard />
      {board.data && (
        <section aria-label="Who and what sells" className="grid gap-3 lg:grid-cols-2">
          <PeopleCard board={board.data} />
          <TeamsCard board={board.data} />
          <MedicinesCard board={board.data} />
          <CustomersCard board={board.data} />
        </section>
      )}
    </>
  );
}

/** Orders waiting, open: how many and at which desk, the donut of where they stand. */
function OrdersBox({ line, stuck }: { line: string; stuck: boolean }) {
  const board = useBoard();
  if (!board.data) return null;
  return (
    <OrdersNowCard
      board={board.data}
      title="Orders right now"
      to="/orders/check"
      head={
        <>
          <div className="text-3xl font-semibold tracking-tight text-slate-900 tabular-nums">
            {num(board.data.totals.waiting + board.data.totals.stopped)}{" "}
            <span className="text-sm font-normal text-slate-500">open</span>
          </div>
          <div className={`text-xs ${stuck ? "text-rose-600" : "text-slate-500"}`}>{line}</div>
        </>
      }
    />
  );
}

/** The shelf: what it is worth, what ran out, what expires soon. */
function StockCard({ stock }: { stock: Data["stock"] }) {
  return (
    <section className={`${CARD} min-w-0 p-4 sm:p-5`}>
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">Stock</h2>
        <Link
          to="/inventory/overview"
          className="text-xs font-semibold text-slate-500 hover:text-emerald-700"
        >
          Open ↗
        </Link>
      </div>
      <div className="text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">
        {stock.value != null ? shortPeso(stock.value) : counted(stock.medicines, "medicine")}
      </div>
      <div className="mb-3 text-xs text-slate-500">
        {stock.value != null ? `at cost · ${counted(stock.medicines, "medicine")}` : "on the shelf"}
      </div>
      <ul className="divide-y divide-slate-100 text-[13px]">
        {(
          [
            ["Out of stock", stock.out, "/inventory?show=out", "text-rose-600"],
            ["Running low", stock.low, "/inventory?show=low", "text-amber-700"],
            ["Expiring in 90 days", stock.expiring, "/inventory?show=expiring", "text-amber-700"],
          ] as const
        ).map(([label, value, to, tone]) => (
          <li key={label}>
            <Link
              to={to}
              className="-mx-2 flex justify-between rounded-lg px-2 py-1.5 hover:bg-slate-50"
            >
              <span className="text-slate-600">{label}</span>
              <span className={`font-semibold tabular-nums ${value ? tone : "text-slate-300"}`}>
                {num(value)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** One side of the money: its total large, then each part with where to look at it. */
function MoneySide({
  title,
  tone,
  total,
  rows,
}: {
  title: string;
  tone: "in" | "out";
  total: number;
  rows: {
    label: string;
    value: number;
    to: string;
    note?: string;
    bad?: boolean;
    good?: boolean;
  }[];
}) {
  return (
    <div className={`${CARD} min-w-0 p-4 sm:p-5`}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        <span
          className={`text-2xl font-semibold tracking-tight tabular-nums ${tone === "in" ? "text-emerald-700" : "text-slate-900"}`}
          title={exactPeso(total)}
        >
          {shortPeso(total)}
        </span>
      </div>
      <ul className="mt-3 divide-y divide-slate-100">
        {rows.map((row) => (
          <li key={row.label}>
            <Link
              to={row.to}
              className="-mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-slate-50"
            >
              <span className="min-w-0">
                <span className="block truncate text-[13px] text-slate-700">{row.label}</span>
                {row.note && <span className="block text-[11px] text-slate-400">{row.note}</span>}
              </span>
              <span
                className={`shrink-0 text-sm font-semibold tabular-nums ${row.bad && row.value > 0 ? "text-rose-600" : row.good ? "text-emerald-700" : "text-slate-900"}`}
                title={exactPeso(row.value)}
              >
                {shortPeso(row.value)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One of the four month figures: a label, the figure large, a line under it. */
function _Metric({
  label,
  to,
  value,
  title,
  children,
}: {
  label: string;
  to: string;
  value: string;
  title?: string;
  children?: ReactNode;
}) {
  return (
    <Link
      to={to}
      className={`${CARD} flex min-w-0 flex-col p-4 transition-colors hover:border-slate-300 sm:p-5`}
    >
      <span className="text-sm text-slate-500">{label}</span>
      <span
        title={title}
        className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums sm:text-[28px]"
      >
        {value}
      </span>
      <span className="mt-auto pt-2 text-xs leading-snug">{children}</span>
    </Link>
  );
}

const BAR: Record<PaceTone, string> = {
  on: "bg-emerald-500",
  behind: "bg-amber-400",
  far: "bg-rose-500",
  none: "bg-slate-300",
};
const PCT: Record<PaceTone, string> = {
  on: "text-emerald-700",
  behind: "text-amber-700",
  far: "text-rose-600",
  none: "text-slate-400",
};

/** A thin bar of sold against the target, the month's pace marked. */
export function PaceBar({
  pct,
  pace,
  tone,
}: {
  pct: number | null;
  pace: number | null;
  tone: PaceTone;
}) {
  const fill = Math.min(100, Math.max(0, pct ?? 0));
  return (
    <span className="relative block h-1.5 rounded-full bg-slate-100">
      <span
        className={`absolute inset-y-0 left-0 rounded-full ${BAR[tone]}`}
        style={{ width: `${fill}%` }}
      />
      {pace !== null && pace > 0 && pace < 1 && (
        <span
          aria-hidden
          className="absolute -top-1 h-3.5 w-0.5 rounded bg-slate-500"
          style={{ left: `${pace * 100}%` }}
        />
      )}
    </span>
  );
}
export { PCT as PACE_TEXT };

const FIGURE = {
  plain: "text-base font-semibold text-slate-900 sm:text-lg",
  bad: "text-base font-semibold text-rose-600 sm:text-lg",
  warn: "text-base font-semibold text-amber-700 sm:text-lg",
  quiet: "text-sm text-slate-400",
} as const;

/** One of the company's eight summaries: icon, name, a grey line, one figure; opens its app. */
function _Summary({
  to,
  icon: SummaryIcon,
  tint,
  name,
  line,
  figure,
  figureTone = "plain",
  title,
}: {
  to: string;
  icon: Icon;
  tint: string;
  name: string;
  line: ReactNode;
  figure: ReactNode;
  figureTone?: keyof typeof FIGURE;
  title?: string;
}) {
  return (
    <Link
      to={to}
      className={`${CARD} flex min-w-0 flex-col p-4 transition-colors hover:border-slate-300`}
    >
      <span className={`grid size-9 place-items-center rounded-lg ${tint}`}>
        <SummaryIcon className="size-[18px]" />
      </span>
      <span className="mt-3 text-sm font-semibold text-slate-900">{name}</span>
      <span className="mt-0.5 text-xs leading-snug text-slate-500">{line}</span>
      <span
        title={title}
        className={`mt-auto pt-2 leading-snug tabular-nums ${FIGURE[figureTone]}`}
      >
        {figure}
      </span>
    </Link>
  );
}

const ALERT_ICONS: Record<CeoAlert["kind"], Icon> = {
  channel: TrendingDown,
  orders: Hourglass,
  money: Landmark,
  stock: PackageX,
  refunds: Undo2,
  customers: UserPlus,
};

export function CeoHomePage() {
  const me = useMe().data;
  const [params] = useSearchParams();
  const asked = params.get("month") ?? "";
  // Any days picked (Today, This week, from–to); none picked = this month.
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const query = useQuery({
    queryKey: ["ceo", "home", asked, from, to],
    queryFn: () =>
      api<Data>(`/api/ceo/home?month=${asked}${from && to ? `&from=${from}&to=${to}` : ""}`),
    placeholderData: (previous) => previous,
    refetchInterval: 60_000,
  });
  const data = query.data;
  if (!data || !me) return <PageState query={query} what="the company's figures" />;
  const { sales, money, orders, stock } = data;
  const pacePct = Math.round(data.pace * 100);
  const collected = collectedChange(sales.collected, sales.collectedBefore);
  const waiting = orders.awaiting + orders.finance;
  const inMonth = data.range
    ? data.range.label
    : data.running
      ? "this month"
      : `in ${monthShort(data.month)}`;

  return (
    <div
      className={`mx-auto w-full max-w-6xl space-y-6 md:space-y-8 ${query.isPlaceholderData ? "opacity-60" : ""}`}
    >
      {/* 1. Greeting and the month */}
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <p className="text-sm text-slate-500">{todayWords()}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
            {greeting()}, {me.name.split(" ")[0]}
          </h1>
        </div>
        <div className="w-full lg:w-auto">
          <RangePicker />
        </div>
      </header>

      {/* 2. The four boxes, open: each holds what clicking it used to lead to. The business comes
          first (Aryan, 19 Nov: sales, collected, customers owe, orders now, profit, medicines,
          customers on top; the people below). */}
      <section aria-label="The month" className="grid gap-3 lg:grid-cols-2">
        <ChannelSalesCard
          all
          channels={sales.channels}
          label={inMonth}
          title={
            data.range
              ? `Sales · ${data.range.label}`
              : data.running
                ? "Sales this month"
                : `Sales in ${monthShort(data.month)}`
          }
          head={
            <>
              <div
                className="text-3xl font-semibold tracking-tight text-slate-900 tabular-nums"
                title={exactPeso(sales.achieved)}
              >
                {shortPeso(sales.achieved)}
              </div>
              {sales.pct !== null && sales.target !== null ? (
                <>
                  <div className="mt-2">
                    <PaceBar
                      pct={sales.pct}
                      pace={data.running ? data.pace : null}
                      tone={sales.tone === "far" ? "behind" : sales.tone}
                    />
                  </div>
                  <div
                    className={`mt-1.5 text-xs ${sales.tone === "on" ? "text-emerald-700" : "text-amber-700"}`}
                  >
                    {Math.round(sales.pct)}% of {shortPeso(sales.target)}
                    {data.running && ` · pace ${pacePct}%`}
                  </div>
                </>
              ) : (
                <div className="text-xs text-slate-500">No target set</div>
              )}
            </>
          }
        />
        <CollectedCard
          all
          head={
            <>
              <div
                className="text-3xl font-semibold tracking-tight text-emerald-700 tabular-nums"
                title={exactPeso(sales.collected)}
              >
                {shortPeso(sales.collected)}
              </div>
              <div
                className={`text-xs ${collected?.tone === "up" ? "text-emerald-700" : collected?.tone === "down" ? "text-rose-600" : "text-slate-500"}`}
              >
                {collected ? collected.text : inMonth}
              </div>
            </>
          }
        />
        <OwedCard />
        <OrdersBox
          line={[
            waiting ? `${num(waiting)} waiting for a decision` : "Nothing waiting for a decision",
            orders.oldestHours ? `oldest ${orders.oldestHours}h` : null,
            orders.stuck ? `${num(orders.stuck)} stuck over 2 days` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
          stuck={Boolean(orders.stuck)}
        />
      </section>

      {/* The hub's KPI for the company: sales without VAT against the target, the counts, a day. */}
      <MyKpis company />

      {/* The month's profit and how fast customers pay (ERP phase 1: from the books). */}
      <ProfitStrip />

      {/* The month's KPIs: every scorecard in the company (Aryan, 20 Nov; PLAN 23). */}
      <KpiCard month={data.range ? "" : asked} />

      {/* The company at a glance: the month's sales by day and channel, the top sellers, customers
          and medicines, enquiries, orders by step, stock, customers (Aryan, 19 Nov). */}
      <CompanyGlance part="business" />

      {/* 4. The day's work and who sells, open: the cards of My team and Speed */}
      <AtAGlance money={money} stock={stock} />

      {/* 7. What needs the CEO */}
      <div className="grid gap-3">
        <section aria-labelledby="needs-you" className={`${CARD} min-w-0`}>
          <header className="flex items-baseline justify-between gap-3 px-4 pt-4 pb-2 sm:px-5">
            <h2 id="needs-you" className="text-sm font-semibold text-slate-900">
              Needs you
            </h2>
            {data.alerts.length > 0 && (
              <span className="text-xs text-slate-500 tabular-nums">{data.alerts.length}</span>
            )}
          </header>
          {data.alerts.length === 0 ? (
            <p className="flex items-center gap-2 px-4 pb-4 text-sm text-slate-500 sm:px-5">
              <CheckCircle2 className="size-4 text-emerald-600" /> Nothing needs you right now
            </p>
          ) : (
            <ul className="pb-2">
              {data.alerts.map((alert) => {
                const AlertIcon = ALERT_ICONS[alert.kind];
                return (
                  <li key={`${alert.kind}:${alert.text}`}>
                    <Link
                      to={alert.href}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 sm:px-5"
                    >
                      <span
                        className={`grid size-8 shrink-0 place-items-center rounded-lg ${alert.tone === "bad" ? "bg-rose-50 text-rose-600" : "bg-amber-50 text-amber-700"}`}
                      >
                        <AlertIcon className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm text-slate-900">{alert.text}</span>
                        {alert.note && (
                          <span className="block text-xs text-slate-500">{alert.note}</span>
                        )}
                      </span>
                      <ChevronRight className="size-4 shrink-0 text-slate-300" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {/* The company's people at the foot: headcount, who's in today, people by department. */}
      <CompanyGlance part="people" />
    </div>
  );
}

/** Gross profit and margin this month on the CRM's orders whose goods have left (their batches'
 *  cost), and the company's days of sales owed; each opens its report in the books. */
function ProfitStrip() {
  const query = useQuery({
    queryKey: ["books", "money-summary"],
    queryFn: () => api<MoneySummary>("/api/books/reports/money-summary"),
    staleTime: 60_000,
  });
  const data = query.data;
  if (!data) return null;
  const tile = (to: string, label: string, value: string, line: string, tone = "text-slate-900") => (
    <Link to={to} className={`${CARD} block min-w-0 px-4 py-3 hover:border-emerald-300`}>
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={`text-2xl font-semibold tracking-tight tabular-nums ${tone}`}>{value}</div>
      <div className="truncate text-xs text-slate-500">{line}</div>
    </Link>
  );
  const { profit } = data;
  return (
    <section aria-label="Profit and how fast customers pay" className="grid gap-3 sm:grid-cols-3">
      {tile(
        "/books/reports/gross-profit",
        "Gross profit this month",
        shortPeso(profit.profit),
        profit.revenue ? `on ${shortPeso(profit.revenue)} sold (less VAT) · CRM orders out` : "No CRM order's goods out yet this month",
        profit.profit < 0 ? "text-rose-700" : "text-emerald-700",
      )}
      {tile(
        "/books/reports/gross-profit?by=channel",
        "Gross margin",
        profit.margin === null ? "—" : `${profit.margin}%`,
        data.notOut.invoices ? `${data.notOut.invoices} billed, goods not out yet` : "sales less the batches' cost",
      )}
      {tile(
        "/owed",
        "Days customers take to pay (DSO)",
        data.dso === null ? "—" : `${data.dso} days`,
        `${shortPeso(data.owed)} owed against ${shortPeso(data.billed90)} billed in 90 days`,
        data.dso !== null && data.dso > 60 ? "text-amber-700" : "text-slate-900",
      )}
    </section>
  );
}
