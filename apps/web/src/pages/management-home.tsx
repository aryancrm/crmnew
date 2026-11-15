// Management's Home: who and when, four figures (what waits for them, orders today, this month,
// sales against the targets), what is held or with Dispatch, then the queue to approve with who
// sold what beside it. Nothing Management only looks at (Aryan, 15 Nov: how fast each approver
// is lives under Speed).

import type { CompanyKpis } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useMe } from "../auth";
import { count, peso } from "../ui";
import { Figure, type Period } from "./figures";
import { greeting, todayWords } from "./home";
import { OrdersToCheck } from "./orders-board";

/** How long the oldest order has waited, in hours or days. */
function waitedFor(iso: string | null): string | null {
  if (!iso) return null;
  const hours = (Date.now() - Date.parse(iso)) / 3_600_000;
  if (hours < 1) return "under an hour";
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)} days`;
}

export function ManagementHome() {
  const me = useMe().data;
  const [params] = useSearchParams();
  const location = useLocation();
  // "Waiting for you" and "on hold" open the queue below, on its tab: once per link followed,
  // after the page has drawn (a link opened from outside lands before the figures are read).
  const scrolledFor = useRef<string | null>(null);
  const period = (params.get("period") ?? "today") as Period;
  const day = params.get("day") ?? "";
  const kpis = useQuery({
    queryKey: ["orders", "company-kpis", period, day],
    queryFn: () =>
      api<CompanyKpis>(`/api/orders/company-kpis?period=${period}${day ? `&day=${day}` : ""}`),
    placeholderData: (previous) => previous,
    refetchInterval: 60_000,
  });
  const drawn = Boolean(me && kpis.data);
  useEffect(() => {
    if (!drawn || location.hash !== "#queue" || scrolledFor.current === location.key) return;
    scrolledFor.current = location.key;
    requestAnimationFrame(() =>
      document.getElementById("queue")?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  }, [drawn, location.hash, location.key]);
  if (!me) return null;
  const data = kpis.data;
  const oldest = waitedFor(data?.oldestWaiting ?? null);
  const late = data?.oldestWaiting
    ? (Date.now() - Date.parse(data.oldestWaiting)) / 3_600_000 >= 4
    : false;
  const share = data && data.target > 0 ? Math.round((data.sales / data.target) * 100) : null;

  return (
    <div className="mx-auto max-w-screen-2xl space-y-4">
      {/* Who and when. */}
      <div>
        <div className="text-xs text-slate-500">{todayWords()}</div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          {greeting()}, {me.name.split(" ")[0]}
        </h1>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-medium tracking-wide text-slate-600 uppercase">
            Management
          </span>
          <span>2MG Inc.</span>
          {data && data.waiting > 0 && (
            <span className="text-slate-400">
              · {count(data.waiting)} {data.waiting === 1 ? "order waits" : "orders wait"} for you
            </span>
          )}
        </div>
      </div>

      {/* The four numbers asked most. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Figure
          label="Waiting for you"
          value={data ? count(data.waiting) : "—"}
          sub={data ? (oldest ? `oldest ${oldest}` : "nothing waiting") : undefined}
          tone={late ? "warn" : undefined}
          to="/#queue"
        />
        <Figure
          label="Orders today"
          value={data ? count(data.todayOrders) : "—"}
          sub={data ? peso(data.todayValue) : undefined}
          to="/orders"
        />
        <Figure
          label="Orders this month"
          value={data ? count(data.monthOrders) : "—"}
          sub={data ? peso(data.monthValue) : undefined}
          to="/orders"
        />
        <Figure
          label="Sales this month"
          value={data ? peso(data.sales) : "—"}
          sub={
            data
              ? data.target > 0
                ? `${share}% of ${peso(data.target)} target`
                : "invoiced · no target set"
              : undefined
          }
          to="/team"
        />
      </div>

      {/* Right now beyond Management: on hold, at Dispatch. */}
      {data && (data.onHold > 0 || data.toPack > 0 || data.onTheWay > 0) && (
        <div className="flex flex-wrap gap-2 text-xs">
          {data.onHold > 0 && (
            <Link
              to="/?tab=hold#queue"
              className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-2.5 py-1.5 font-semibold text-white hover:bg-rose-700"
            >
              <span className="size-1.5 rounded-full bg-white" /> {count(data.onHold)} on hold
            </Link>
          )}
          {data.toPack > 0 && (
            <Link
              to="/orders?tab=dispatch"
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1.5 font-semibold text-slate-800 hover:bg-slate-200"
            >
              <span className="size-1.5 rounded-full bg-sky-500" /> {count(data.toPack)} with
              Dispatch to pack
            </Link>
          )}
          {data.onTheWay > 0 && (
            <Link
              to="/orders?status=shipped"
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1.5 font-semibold text-slate-800 hover:bg-slate-200"
            >
              <span className="size-1.5 rounded-full bg-teal-500" /> {count(data.onTheWay)} on the
              way
            </Link>
          )}
        </div>
      )}

      {/* The queue to approve, the cards across the whole width (Aryan: three or more a row). */}
      <div id="queue" className="scroll-mt-20">
        <OrdersToCheck embedded />
      </div>
    </div>
  );
}
