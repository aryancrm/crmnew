// Management's Home: who and when, four figures (what waits for them, orders today, this month,
// sales against the targets), what is held or with Dispatch, then the queue to approve with who
// sold what beside it. Nothing Management only looks at (Aryan, 15 Nov: how fast each approver
// is lives under Speed).

import type { CompanyKpis } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useMe } from "../auth";
import { count, peso } from "../ui";
import { Figure, type Period } from "../home/figures";
import { todayWords } from "../home/home";
import { OrdersToCheck } from "../orders/board";

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

  // One common screen for the whole of Management (Aryan, 18 Nov): the desk's name, not a person's;
  // Management's own work only; the people beside it, each with their Start.
  return (
    <div className="mx-auto max-w-screen-2xl">
      <div className="min-w-0 space-y-4">
        <div>
          <div className="text-xs text-slate-500">{todayWords()}</div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Management desk</h1>
          <div className="mt-0.5 text-xs text-slate-500">
            Every order to approve, shared automatically among the people started (left).
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Figure
            label="Waiting for approval"
            value={data ? count(data.waiting) : "—"}
            sub={data ? (oldest ? `oldest ${oldest}` : "nothing waiting") : undefined}
            tone={late ? "warn" : undefined}
            to="/#queue"
          />
          <Figure
            label="On hold"
            value={data ? count(data.onHold) : "—"}
            sub="held with a reason"
            to="/on-hold"
          />
          <Figure
            label="Customers to check"
            value={data ? count(data.toReview) : "—"}
            sub="before their first order"
            to="/customers?review=1"
          />
          <Figure
            label="Orders today"
            value={data ? count(data.todayOrders) : "—"}
            sub={data ? peso(data.todayValue) : undefined}
            to="/orders"
          />
        </div>

        {/* The queue to approve, each card naming whose it is. */}
        <div id="queue" className="scroll-mt-20">
          <OrdersToCheck embedded />
        </div>
      </div>
    </div>
  );
}
