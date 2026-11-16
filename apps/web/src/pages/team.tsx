// A team's month, in the CEO Home's look: what the team sold (Finance invoiced) against its
// target with the pace marked, today's, what was placed, then each person under the team lead
// or manager by who reports to whom, each against their own target, and the team's orders that
// are stopped now. The team lead's and manager's Home; for the CEO and the Admin, every seller
// in the company ("Sales by person").

import type { TeamSales } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, CirclePause, Undo2 } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useMe } from "../auth";
import { counted, exactPeso, monthName, monthShort, shiftMonth, shortPeso } from "../ceo";
import { avatarTone, initials } from "../look";
import { LeadGlance } from "../team/glance";
import { PageState } from "../ui";
import { PACE_TEXT, PaceBar } from "./ceo-home";
import { seatWords } from "../seat-words";
import { DistrictNow } from "./district";
import { MentorHome } from "./mentor";
import { greeting, todayWords } from "./home";

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
  const data = query.data;
  if (!data || !me) return <PageState query={query} what="the team's sales" />;
  const whole = data.lead === null;
  const coach = me.role === "team_lead" && me.channel?.code === "HOSP";
  const mentor = me.role === "manager" && me.channel?.code === "HOSP";
  const current = data.today.slice(0, 7);
  const href = (month: string) =>
    month >= current ? location.pathname : `${location.pathname}?month=${month}`;
  const { total } = data;
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
              {coach || mentor
                ? `${seatWords(me).desk} · ${mentor ? "the Hospital Division" : "your district"}`
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

      {!coach && !mentor && <LeadGlance />}

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
        <Figure label="Stopped now" value={data.stopped.length.toLocaleString("en-PH")}>
          <span className={data.stopped.length ? "text-rose-600" : "text-slate-500"}>
            {data.stopped.length ? "On hold or sent back" : "Nothing stopped"}
          </span>
        </Figure>
      </section>

      {/* A Hospital coach's day: who needs them, the district now, the huddle, the rescue. */}
      {coach && <DistrictNow />}
      {mentor && <MentorHome />}

      {!coach && !mentor && (
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
          <p className="px-4 pb-4 text-sm text-slate-500 sm:px-5">Nobody sells under you yet.</p>
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
                      No target{data.can.setTargets ? " · set it on Targets" : ""}
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
                      {order.statusLabel} · {order.medrep}
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
