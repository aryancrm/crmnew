// A team's month, in the CEO Home's look: what the team sold (Finance invoiced) against its
// target with the pace marked, today's, what was placed, then each person under the team lead
// or manager by who reports to whom, each against their own target, and the team's orders that
// are stopped now. The team lead's and manager's Home; for the CEO and the Admin, every seller
// in the company ("Sales by person").

import type { OrderStatus, TeamBoard, TeamSales } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, CirclePause, Undo2 } from "lucide-react";
import type { ReactNode } from "react";
import { MyKpis } from "../kpis/my-kpis";
import { FieldTodayCard } from "../mr/team";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useMe } from "../auth";
import { counted, exactPeso, monthName, monthShort, shiftMonth, shortPeso } from "../ceo";
import { avatarTone, initials } from "../look";
import { LeadGlance, OrdersNowCard } from "./glance";
import { PageState } from "../ui";
import { PACE_TEXT, PaceBar } from "../company/ceo-home";
import { seatWords } from "../seat-words";
import { TeamDrill } from "./drill";
import { OrdersByPerson, OrderWaysCard } from "./ways-card";
import { channelsIn, useTeamTree } from "./hierarchy";
import { hqOfSeat, withHq } from "./hq-name";
import { toneOf } from "./pace";
import { HeadRisks } from "./mentor";
import { greeting, todayWords } from "../home/home";
import { EmptyState } from "../no-results";

const CARD = "rounded-xl border border-slate-200 bg-white";

function Figure({
  label,
  value,
  title,
  children,
}: {
  label: string;
  value: string;
  title?: string;
  children?: ReactNode;
}) {
  return (
    <div className={`${CARD} flex min-w-0 flex-col p-4 sm:p-5`}>
      <span className="text-sm text-slate-500">{label}</span>
      <span
        title={title}
        className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums sm:text-[28px]"
      >
        {value}
      </span>
      <span className="mt-auto pt-2 text-xs leading-snug">{children}</span>
    </div>
  );
}

export function TeamSalesPage() {
  const me = useMe().data;
  const location = useLocation();
  const [params] = useSearchParams();
  const asked = params.get("month") ?? "";
  const query = useQuery({
    queryKey: ["team", "sales", asked],
    queryFn: () => api<TeamSales>(`/api/team/sales?month=${asked}`),
    placeholderData: (previous) => previous,
    refetchInterval: 60_000,
  });
  // The team as the sales tracker draws it, for the month shown (Aryan, 19 Nov: "a tree on the Home").
  const span = monthSpan(asked);
  const board = useQuery({
    queryKey: ["team", "board", "", span.from, span.to],
    queryFn: () => api<TeamBoard>(`/api/team/board?from=${span.from}&to=${span.to}`),
    enabled: Boolean(me && (me.role === "team_lead" || me.role === "manager")),
    placeholderData: (previous) => previous,
    refetchInterval: 120_000,
  });
  const top = useTeamTree(board.data);
  const data = query.data;
  if (!data || !me) return <PageState query={query} what="the team's sales" />;
  const whole = data.lead === null;
  // The channels with a desk of their own (a team without one gets the team at a glance).
  const worked = top ? channelsIn(top).filter((division) => hasWork(division)) : [];
  const coach = me.role === "team_lead" && me.channel?.code === "HOSP";
  const mentor = me.role === "manager" && me.channel?.code === "HOSP";
  const tsCoach = me.role === "team_lead" && me.channel?.code === "TS" && me.business === "RX";
  const rxMentor = me.role === "manager" && me.channel?.code === "RX";
  const b2bHead = (me.role === "team_lead" || me.role === "manager") && me.channel?.code === "B2B";
  const bidAdmin = me.role === "team_lead" && me.channel?.code === "BID";
  // Modern Trade's COO has nobody under her: her own chains instead of a team.
  const mtHead = me.role === "manager" && me.channel?.code === "MT";
  const current = data.today.slice(0, 7);
  const href = (month: string) =>
    month >= current ? location.pathname : `${location.pathname}?month=${month}`;
  // A lead's or head's four figures are their boxes' (Aryan, 19 Nov: the target sheet is right):
  // every seat in them, vacant ones and their own included, as the sales tracker counts, so they
  // add up to the channels below. The company's view and a team without a tree keep the people's.
  const boxes = !whole && top && board.data ? board.data.totals : null;
  const total = boxes
    ? {
        target: boxes.target,
        sold: boxes.sold,
        today: boxes.today,
        placed: boxes.placed,
        placedValue: boxes.placedValue,
        pct: boxes.target ? (boxes.sold / boxes.target) * 100 : null,
        tone: toneOf(boxes.sold, boxes.target, data.pace),
      }
    : data.total;
  const stoppedNow = boxes ? boxes.stopped : data.stopped.length;
  // Where the team's orders stand, in the CEO Home's kind of line (28 Nov, PLAN 274).
  const ordersNow = board.data ? ordersNowLine(board.data) : null;
  // The HQ a stopped order was placed from: its seat on the team's board, found by the order's own
  // number (none when the board isn't read, as on the company's view).
  const stoppedHq = (orderId: number) => {
    const seatId = board.data?.needs.find((need) => need.orderId === orderId)?.seatId;
    const seat = board.data?.seats.find((one) => one.seatId === seatId);
    return seat ? hqOfSeat(seat) : null;
  };
  const pacePct = Math.round(data.pace * 100);
  const arrow = "grid size-9 place-items-center rounded-lg text-slate-600 hover:bg-slate-100";

  return (
    <div
      className={`mx-auto w-full max-w-6xl space-y-6 md:space-y-8 ${query.isPlaceholderData ? "opacity-60" : ""}`}
    >
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <p className="text-sm text-slate-500">
            {whole ? "Every seller in the company" : todayWords()}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
            {whole ? "Sales by person" : `${greeting()}, ${me.name.split(" ")[0]}`}
          </h1>
          {data.lead && (
            <p className="mt-1 text-[13px] text-slate-500">
              {coach || mentor || tsCoach || rxMentor || b2bHead || bidAdmin || mtHead
                ? `${seatWords(me).desk} · ${mentor ? "the Hospital Division" : rxMentor ? "the Prescription business" : tsCoach ? "MD Telesales and B2C" : b2bHead ? (me.role === "manager" ? "Sales and Marketing" : "B2B Telesales") : bidAdmin ? "Government Bidding" : mtHead ? "the pharmacy chains" : "your district"}`
                : `${[data.lead.title, data.lead.channel].filter(Boolean).join(" · ")} · your team`}
            </p>
          )}
        </div>
        <nav aria-label="Month" className={`${CARD} flex items-center p-0.5`}>
          <Link to={href(shiftMonth(data.month, -1))} aria-label="Previous month" className={arrow}>
            <ChevronLeft className="size-4" />
          </Link>
          <span className="min-w-36 px-1 text-center text-sm font-semibold text-slate-900">
            {monthName(data.month)}
          </span>
          {data.month < current ? (
            <Link to={href(shiftMonth(data.month, 1))} aria-label="Next month" className={arrow}>
              <ChevronRight className="size-4" />
            </Link>
          ) : (
            <span aria-hidden className="grid size-9 place-items-center text-slate-300">
              <ChevronRight className="size-4" />
            </span>
          )}
        </nav>
      </header>

      {/* My KPIs first on the head of the Prescription business's Home (Aryan, 28 Nov: "put My KPIs
          at the very top this time", PLAN 274), on the Home's month: a month gone by opens on that
          month, this month on today. */}
      {!whole && rxMentor && <MyKpis month={data.month < current ? data.month : undefined} />}
      {/* First, as his plan's Home has them (Aryan, 28 Nov, PLAN 259): how the month's orders came
          (doctor referral, doctor dispense, guarantee letters, others), then the team's tree (each
          HQ and who works it; the channels' tiles a press away). */}
      {!whole && <OrderWaysCard month={asked} />}
      {/* Where his team's orders stand now, as on the CEO's Home (Aryan, 28 Nov: "the CEO's Home shows
          which order is at Management, which at Finance; it should show on Javed's too", PLAN 274). */}
      {!whole && rxMentor && board.data && ordersNow && (
        <OrdersNowCard
          board={board.data}
          title="Orders right now"
          to="/orders"
          head={
            <>
              <div className="text-3xl font-semibold tracking-tight text-slate-900 tabular-nums">
                {(board.data.totals.waiting + board.data.totals.stopped).toLocaleString("en-PH")}{" "}
                <span className="text-sm font-normal text-slate-500">open</span>
              </div>
              {/* The CEO Home's kind of line, not the ring's labels again (Aryan, 28 Nov). */}
              <div className={`text-xs ${ordersNow.late ? "text-rose-600" : "text-slate-500"}`}>{ordersNow.line}</div>
            </>
          }
        />
      )}
      {/* The orders each person placed (Aryan, 28 Nov: "on Javed's screen, like the Orders tab"). */}
      {!whole && <OrdersByPerson month={asked} board={board.data} />}
      {!whole && top && <TeamDrill top={top} pace={data.pace} running={data.running} me={me} range={span} />}

      {/* The hub's My KPIs: their own and their team's (Aryan, 20 Nov; PLAN 23). */}
      {/* What the MedReps are doing in the field today, and what of it waits for this lead. */}
      {!whole && <FieldTodayCard />}
      {!whole && !rxMentor && <MyKpis />}

      {/* The month's four figures on the company's view only: a lead's or head's My Team KPI above
          says the same (sold against target, today, orders raised and held), so they aren't twice
          (Aryan, 27 Nov: "things repeat"). */}
      {whole && (
        <section aria-label="The team's month" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Figure
            label={data.running ? "Sold this month" : `Sold in ${monthShort(data.month)}`}
            value={shortPeso(total.sold)}
            title={exactPeso(total.sold)}
          >
            {total.pct !== null && total.target !== null ? (
              <>
                <PaceBar
                  pct={total.pct}
                  pace={data.running ? data.pace : null}
                  tone={total.tone === "far" ? "behind" : total.tone}
                />
                <span
                  className={`mt-2 block ${total.tone === "on" ? "text-emerald-700" : "text-amber-700"}`}
                >
                  {Math.round(total.pct)}% of {shortPeso(total.target)}
                  {data.running && ` · pace ${pacePct}%`}
                </span>
              </>
            ) : (
              <span className="text-slate-500">No targets set</span>
            )}
          </Figure>
          <Figure
            label="Today"
            value={data.running ? shortPeso(total.today) : "—"}
            title={exactPeso(total.today)}
          >
            <span className="text-slate-500">
              {data.running ? `${counted(data.daysLeft, "day")} left` : "A month gone by"}
            </span>
          </Figure>
          <Figure label="Orders placed" value={total.placed.toLocaleString("en-PH")}>
            <span className="text-slate-500">
              {shortPeso(total.placedValue)} · sold when Finance invoices
            </span>
          </Figure>
          <Figure label="Stopped now" value={stoppedNow.toLocaleString("en-PH")}>
            <span className={stoppedNow ? "text-rose-600" : "text-slate-500"}>
              {stoppedNow ? "On hold or sent back" : "Nothing stopped"}
            </span>
          </Figure>
        </section>
      )}


      {!whole && me.role === "manager" && <HeadRisks />}

      {/* A team with no channel desk of its own yet: the team at a glance. */}
      {!whole && top && worked.length === 0 && <LeadGlance />}

      {(whole || (!top && !board.isPending)) && (
      <section aria-labelledby="people" className={`${CARD} min-w-0`}>
        <header className="flex items-baseline justify-between gap-3 px-4 pt-4 pb-2 sm:px-5">
          <h2 id="people" className="text-sm font-semibold text-slate-900">
            {whole ? "Every seller" : "Your people"}
          </h2>
          <span className="flex items-center gap-3 text-xs text-slate-500">
            {data.running && <span>Pace {pacePct}%</span>}
            {data.can.setTargets && (
              <Link
                to={`/targets${data.running ? "" : `?month=${data.month}`}`}
                className="font-semibold text-emerald-700 hover:underline"
              >
                Targets
              </Link>
            )}
          </span>
        </header>
        {data.people.length === 0 ? (
          <EmptyState title="Nobody sells under you yet.">The people who sell under you show here with their month against the pace.</EmptyState>
        ) : (
          <ul className="pb-2">
            {data.people.map((person) => (
              <li
                key={person.personId}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 border-t border-slate-100 px-4 py-2.5 first:border-t-0 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_7.5rem_3.5rem] sm:px-5"
              >
                <span
                  className="col-start-1 row-start-1 flex min-w-0 items-center gap-2.5"
                  style={{ paddingLeft: `${Math.min(person.depth, 4) * 18}px` }}
                >
                  <span
                    className={`flex size-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold ${avatarTone(person.name)}`}
                  >
                    {initials(person.name)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-slate-900">
                      {person.name}
                    </span>
                    <span className="block truncate text-[11px] text-slate-500">
                      {[
                        person.title ?? person.roleLabel,
                        person.area,
                        whole ? person.channel : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                </span>
                <span className="col-span-2 row-start-2 sm:col-span-1 sm:col-start-2 sm:row-start-1">
                  {person.target !== null ? (
                    <PaceBar
                      pct={person.pct}
                      pace={data.running ? data.pace : null}
                      tone={person.tone}
                    />
                  ) : (
                    <span className="text-[11px] text-slate-400">
                      {/* Rx CHCs carry no sales target (the Rx playbook: telesales hold it); leads neither. */}
                      {person.channel === "RX" && person.roleLabel === "MedRep"
                        ? "Field: no sales target (MD Telesales hold it)"
                        : `No target${data.can.setTargets ? " · set it on Targets" : ""}`}
                    </span>
                  )}
                  <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
                    <span>{counted(person.placed, "order")} placed</span>
                    {data.running && person.today > 0 && (
                      <span>{shortPeso(person.today)} today</span>
                    )}
                    {person.waiting > 0 && (
                      <span className="text-amber-700">{person.waiting} waiting</span>
                    )}
                    {person.held > 0 && (
                      <span className="text-rose-600">{person.held} stopped</span>
                    )}
                  </span>
                </span>
                <span
                  className="hidden text-right text-[13px] text-slate-700 tabular-nums sm:col-start-3 sm:row-start-1 sm:block"
                  title={exactPeso(person.sold)}
                >
                  {shortPeso(person.sold)}
                  {person.target !== null && (
                    <span className="text-slate-400"> / {shortPeso(person.target)}</span>
                  )}
                </span>
                <span
                  className={`col-start-2 row-start-1 text-right text-sm tabular-nums sm:col-start-4 ${person.pct === null ? "text-slate-400" : `font-semibold ${PACE_TEXT[person.tone]}`}`}
                >
                  {person.pct === null ? (
                    <>
                      <span className="sm:hidden">{shortPeso(person.sold)}</span>
                      <span className="hidden sm:inline">—</span>
                    </>
                  ) : (
                    `${Math.round(person.pct)}%`
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      )}

      {data.stopped.length > 0 && (
        <section aria-labelledby="stopped" className={`${CARD} min-w-0`}>
          <header className="px-4 pt-4 pb-2 sm:px-5">
            <h2 id="stopped" className="text-sm font-semibold text-slate-900">
              Stopped now
            </h2>
          </header>
          <ul className="pb-2">
            {data.stopped.map((order) => (
              <li key={order.id}>
                <Link
                  to={`/orders/${order.id}`}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 sm:px-5"
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-rose-50 text-rose-600">
                    {order.status === "draft" ? (
                      <Undo2 className="size-4" />
                    ) : (
                      <CirclePause className="size-4" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-slate-900">
                      {order.code} · {order.customer}
                    </span>
                    <span className="block truncate text-xs text-slate-500">
                      {/* The HQ first, then who placed it ("TAFT · Marwin Dy"), as on every order card. */}
                      {order.statusLabel} · {withHq(stoppedHq(order.id), order.medrep)}
                      {order.reason ? ` · ${order.reason}` : ""}
                    </span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-slate-300" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** The days of the month shown: the 1st to its last day (the board shares targets over them). */
function monthSpan(asked: string): { from: string; to: string } {
  const month = /^\d{4}-\d{2}$/.test(asked)
    ? asked
    : new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }).slice(0, 7);
  const [y, m] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

/** The steps an order is open at, as the board counts it (Management, Finance, Dispatch, the road):
 *  not on hold or sent back. */
const OPEN_STEPS: OrderStatus[] = ["pending_approval", "finance_check", "ready_for_invoice", "ready_for_dispatch", "packing", "shipped"];

/** The team's orders in the CEO Home's kind of line (Aryan, 28 Nov, PLAN 274): how many wait for a
 *  decision (at Management or Finance), how long the oldest open order has stood at its step, and
 *  how many are late at their desk (the board's late: past the desk's own time, the count the team
 *  page's "Stuck in your team" shows). A part with nothing in it is left out. */
function ordersNowLine(board: TeamBoard): { line: string; late: number } {
  const waiting = board.stagesNow.management + board.stagesNow.finance;
  const since = board.seats.flatMap((seat) =>
    seat.oldest && OPEN_STEPS.includes(seat.oldest.status) ? [Date.parse(seat.oldest.since)] : [],
  );
  const oldest = since.length ? Math.round((Date.now() - Math.min(...since)) / 3_600_000) : 0;
  const late = board.needs.filter((need) => need.kind === "late").length;
  return {
    late,
    line: [
      waiting ? `${waiting.toLocaleString("en-PH")} waiting for a decision` : "Nothing waiting for a decision",
      oldest > 0 ? `oldest ${oldest}h` : null,
      late ? `${late.toLocaleString("en-PH")} late` : null,
    ]
      .filter(Boolean)
      .join(" · "),
  };
}

/** Whether a channel has a desk of its own to show under the tree. */
const hasWork = (division: string) =>
  ["RX Business", "MD Telesales", "B2B", "CLIDP", "BID", "HOSP", "MT", "TeleSales"].includes(division);
