// Dispatch's Home, like Management's (Aryan, 19 Nov: "make Dispatch's like Management's"): the
// desk's name, four figures (to pack, to ship, on the road, on hold), then the warehouse's queue.
// Its people press Start at the top of the menu; the orders to pack are shared out among them.

import type { DispatchBoard } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { count } from "../ui";
import { Figure } from "./figures";
import { todayWords } from "./home";
import { OrdersToCheck } from "./orders-board";

export function DispatchHome() {
  const board = useQuery({
    queryKey: ["dispatch", "board"],
    queryFn: () => api<DispatchBoard>("/api/dispatch/board"),
    refetchInterval: 60_000,
  });
  const counts = board.data?.counts;
  return (
    <div className="mx-auto max-w-screen-2xl">
      <div className="min-w-0 space-y-4">
        <div>
          <div className="text-xs text-slate-500">{todayWords()}</div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Dispatch desk</h1>
          <div className="mt-0.5 text-xs text-slate-500">
            Every order to pack and ship, shared automatically among the people started (left).
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Figure label="To pack" value={counts ? count(counts.toPack) : "—"} sub="approved and invoiced" to="/#queue" tone={counts && counts.toPack > 0 ? "warn" : undefined} />
          <Figure label="To ship" value={counts ? count(counts.toShip) : "—"} sub="packed, waiting for the courier" to="/#queue" />
          <Figure label="On the road" value={counts ? count(counts.road) : "—"} sub={counts ? `${count(counts.delivered)} delivered today` : undefined} to="/shipments" />
          <Figure label="On hold" value={counts ? count(counts.held) : "—"} sub="held with a reason" to="/dispatch/hold" />
        </div>
        <div id="queue" className="scroll-mt-20">
          <OrdersToCheck desk="dispatch" embedded />
        </div>
      </div>
    </div>
  );
}
