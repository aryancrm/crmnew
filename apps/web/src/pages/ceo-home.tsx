// The CEO Home, brought over from the old CRM as it was (frontend/components/ceo-home.tsx, the
// shape the owner approved): the greeting and the month picker; four figures for the month
// (sales against target with the pace, collected, what customers owe, the orders waiting); the
// company as eight summaries, each opening its app; the channels against their targets; and
// what needs the CEO now. One read, `/api/ceo/home`.

import type { CeoAlert, CeoHome as Data, PaceTone } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  Boxes,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Hourglass,
  Landmark,
  Network,
  PackageX,
  Target,
  TrendingDown,
  Truck,
  Undo2,
  UserPlus,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useMe } from "../auth";
import { collectedChange, counted, exactPeso, monthShort, shortPeso } from "../ceo";
import { RangePicker } from "../team/range";
import { PageState } from "../ui";
import { greeting, todayWords } from "./home";

type Icon = React.ComponentType<{ className?: string }>;
const num = (n: number) => n.toLocaleString("en-PH");
/** A white card with a hairline border, flat. */
const CARD = "rounded-xl border border-slate-200 bg-white";

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
function Metric({
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
function Summary({
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
  const { sales, money, orders, dispatch, stock, customers, people } = data;
  const monthQuery = data.running ? "" : `?month=${data.month}`;
  const pacePct = Math.round(data.pace * 100);
  const collected = collectedChange(sales.collected, sales.collectedBefore);
  const waiting = orders.awaiting + orders.finance;
  const channels = sales.channels;
  const behind = channels.filter(
    (channel) => channel.tone === "behind" || channel.tone === "far",
  ).length;
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

      {/* 2. The month in four figures */}
      <section aria-label="The month" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric
          label={
            data.range
              ? `Sales · ${data.range.label}`
              : data.running
                ? "Sales this month"
                : `Sales in ${monthShort(data.month)}`
          }
          to={`/reports/channels${monthQuery}`}
          value={shortPeso(sales.achieved)}
          title={exactPeso(sales.achieved)}
        >
          {sales.pct !== null && sales.target !== null ? (
            <>
              <PaceBar
                pct={sales.pct}
                pace={data.running ? data.pace : null}
                tone={sales.tone === "far" ? "behind" : sales.tone}
              />
              <span
                className={`mt-2 block ${sales.tone === "on" ? "text-emerald-700" : "text-amber-700"}`}
              >
                {Math.round(sales.pct)}% of {shortPeso(sales.target)}
                {data.running && ` · pace ${pacePct}%`}
              </span>
            </>
          ) : (
            <span className="text-slate-500">No target set</span>
          )}
        </Metric>
        <Metric
          label="Collected"
          to="/payments"
          value={shortPeso(sales.collected)}
          title={exactPeso(sales.collected)}
        >
          {collected ? (
            <span
              className={
                collected.tone === "up"
                  ? "text-emerald-700"
                  : collected.tone === "down"
                    ? "text-rose-600"
                    : "text-slate-500"
              }
            >
              {collected.text}
            </span>
          ) : (
            <span className="text-slate-500">{inMonth}</span>
          )}
        </Metric>
        <Metric
          label="Customers owe us"
          to="/owed"
          value={shortPeso(money.owed)}
          title={exactPeso(money.owed)}
        >
          {money.overdue > 0 ? (
            <span className="text-rose-600" title={exactPeso(money.overdue)}>
              {shortPeso(money.overdue)} overdue
            </span>
          ) : (
            <span className="text-slate-500">Nothing overdue</span>
          )}
        </Metric>
        <Metric label="Orders waiting" to="/orders/check" value={num(waiting)}>
          {waiting > 0 || orders.onHold > 0 ? (
            <span className={orders.stuck ? "text-rose-600" : "text-slate-500"}>
              {[
                orders.awaiting ? `${num(orders.awaiting)} with Management` : null,
                orders.finance ? `${num(orders.finance)} with Finance` : null,
                orders.onHold ? `${num(orders.onHold)} on hold` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          ) : (
            <span className="text-slate-500">Nothing waiting</span>
          )}
        </Metric>
      </section>

      {/* 3. The company, one summary per app */}
      {/* 3. Money at a glance: what is to come in, what is to go out */}
      <section aria-label="Money" className="grid gap-3 md:grid-cols-2">
        <MoneySide
          title="To come in"
          tone="in"
          total={money.owed}
          rows={[
            {
              label: "Customers owe us",
              value: money.owed,
              to: "/owed",
              note: money.lateCustomers
                ? `${money.lateCustomers} customers over 60 days late`
                : undefined,
            },
            { label: "Of it, past due", value: money.overdue, to: "/owed", bad: true },
            {
              label: "Cash on delivery with couriers",
              value: money.codOnTheRoad,
              to: "/shipments",
              note: "Shipped, the rider collects it",
            },
            { label: `Collected ${inMonth}`, value: sales.collected, to: "/payments", good: true },
          ]}
        />
        <MoneySide
          title="To go out"
          tone="out"
          total={money.refundsOwed + money.purchasesValue}
          rows={[
            {
              label: "Refunds we owe customers",
              value: money.refundsOwed,
              to: "/refunds",
              bad: money.refundsOwed > 0,
            },
            {
              label: `Supplier orders not received (${money.purchasesOpen})`,
              value: money.purchasesValue,
              to: "/purchases",
              note: "Landed cost; supplier bills aren't kept in the CRM yet",
            },
          ]}
        />
      </section>

      <section aria-labelledby="your-company">
        <h2 id="your-company" className="mb-3 text-sm font-semibold text-slate-900">
          Your company
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Summary
            to={`/reports/channels${monthQuery}`}
            icon={BarChart3}
            tint="bg-emerald-50 text-emerald-700"
            name="Sales"
            line={`${counted(channels.length, "channel")} · ${behind ? `${behind} behind` : "none behind"}`}
            figure={
              data.running
                ? `${shortPeso(sales.today)} today`
                : sales.pct !== null
                  ? `${Math.round(sales.pct)}% of target`
                  : shortPeso(sales.achieved)
            }
          />
          <Summary
            to="/orders/check"
            icon={ClipboardCheck}
            tint="bg-teal-50 text-teal-700"
            name="Orders"
            line={
              orders.awaiting
                ? `${counted(orders.awaiting, "order")} waiting for approval`
                : "Nothing waiting for approval"
            }
            figure={`${counted(orders.today, "order")} placed today`}
            figureTone={orders.stuck ? "bad" : "plain"}
          />
          <Summary
            to="/owed"
            icon={Landmark}
            tint="bg-sky-50 text-sky-700"
            name="Money"
            line={`${shortPeso(money.owed)} owed`}
            figure={money.overdue > 0 ? `${shortPeso(money.overdue)} overdue` : "Nothing overdue"}
            figureTone={money.overdue > 0 ? "bad" : "plain"}
            title={exactPeso(money.overdue)}
          />
          <Summary
            to="/dispatch"
            icon={Truck}
            tint="bg-blue-50 text-blue-700"
            name="Dispatch"
            line={`${num(dispatch.toPack)} to pack · ${num(dispatch.toShip)} to ship`}
            figure={`${num(dispatch.onTheWay)} on the way`}
          />
          <Summary
            to="/inventory/overview"
            icon={Boxes}
            tint="bg-amber-50 text-amber-700"
            name="Stock"
            line={
              stock.value != null
                ? `${shortPeso(stock.value)} at cost`
                : counted(stock.medicines, "medicine")
            }
            figure={`${num(stock.out)} out · ${num(stock.expiring)} expiring`}
            figureTone={stock.out ? "warn" : "plain"}
            title={stock.value != null ? exactPeso(stock.value) : undefined}
          />
          <Summary
            to="/customers"
            icon={Users}
            tint="bg-violet-50 text-violet-700"
            name="Customers"
            line={counted(customers.total, "customer")}
            figure={customers.toReview ? `${num(customers.toReview)} to check` : "All checked"}
            figureTone={customers.toReview ? "warn" : "plain"}
          />
          <Summary
            to="/company"
            icon={Network}
            tint="bg-fuchsia-50 text-fuchsia-700"
            name="People"
            line={`${counted(people.total, "person", "people")} · ${counted(people.sellers, "MedRep")}`}
            figure="Company tree"
          />
          <Summary
            to={`/targets${monthQuery}`}
            icon={Target}
            tint="bg-slate-100 text-slate-600"
            name="Targets"
            line={
              people.withoutTarget
                ? `${counted(people.withoutTarget, "MedRep")} without a target`
                : "Every MedRep has one"
            }
            figure={sales.target !== null ? shortPeso(sales.target) : "Not set"}
            figureTone={sales.target === null ? "quiet" : people.withoutTarget ? "warn" : "plain"}
          />
        </div>
      </section>

      {/* 4. The channels against their targets, and what needs the CEO */}
      <div className="grid gap-3 lg:grid-cols-2">
        <section aria-labelledby="channels-target" className={`${CARD} min-w-0`}>
          <header className="flex items-baseline justify-between gap-3 px-4 pt-4 pb-2 sm:px-5">
            <h2 id="channels-target" className="text-sm font-semibold text-slate-900">
              Channels against target
            </h2>
            {data.running && <span className="text-xs text-slate-500">Pace {pacePct}%</span>}
          </header>
          {channels.length === 0 ? (
            <p className="px-4 pb-4 text-sm text-slate-500 sm:px-5">No sales channels yet.</p>
          ) : (
            <ul className="pb-2">
              {channels.map((channel) => (
                <li key={channel.code}>
                  <Link
                    to={`/reports/channels${monthQuery}#${channel.code}`}
                    title={
                      channel.target === null
                        ? `${channel.name}: ${exactPeso(channel.sold)}, no target`
                        : `${channel.name}: ${exactPeso(channel.sold)} of ${exactPeso(channel.target)}`
                    }
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-4 py-2 hover:bg-slate-50 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_3.5rem] sm:px-5 lg:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_3.5rem]"
                  >
                    <span className="col-start-1 row-start-1 truncate text-sm text-slate-800">
                      {channel.name}
                    </span>
                    <span className="col-span-2 row-start-2 sm:col-span-1 sm:col-start-2 sm:row-start-1">
                      <PaceBar
                        pct={channel.pct}
                        pace={data.running ? data.pace : null}
                        tone={channel.tone}
                      />
                    </span>
                    <span
                      className={`col-start-2 row-start-1 text-right text-sm tabular-nums sm:col-start-3 ${channel.pct === null ? "text-slate-400" : `font-semibold ${PCT[channel.tone]}`}`}
                    >
                      {channel.pct === null ? "—" : `${Math.round(channel.pct)}%`}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

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
    </div>
  );
}
