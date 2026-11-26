// Every return, by where it stands: waiting for Management, waiting for Dispatch's check, done.
// Each desk does its part on the card itself; a MedRep sees the returns of their own orders.

import type { ReturnList, ReturnRow } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { ReturnCard } from "./returns";
import { count, PageHead, PageState } from "../ui";
import { EmptyState } from "../no-results";

const TABS: { key: "" | ReturnRow["status"]; label: string }[] = [
  { key: "", label: "All" },
  { key: "requested", label: "Waiting for Management" },
  { key: "approved", label: "Goods to check" },
  { key: "checked", label: "Checked: to credit" },
  { key: "received", label: "Credited" },
  { key: "rejected", label: "Not approved" },
];

export function Returns() {
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "";
  const query = useQuery({
    queryKey: ["returns", status],
    queryFn: () => api<ReturnList>(`/api/returns${status ? `?status=${status}` : ""}`),
    placeholderData: (previous) => previous,
  });
  const data = query.data;
  return (
    <div className="mx-auto max-w-5xl">
      <PageHead
        title="Returns & refunds"
        sub="Asked on an order with where the goods are: Management decides, Dispatch checks what comes back"
      />
      {/* Our tabs (Aryan, 26 Nov): a soft grey track, the picked one a raised white chip. */}
      <div role="tablist" aria-label="Returns" className="mb-4 flex gap-0.5 overflow-x-auto rounded-lg bg-slate-100 p-1 [scrollbar-width:none]">
        {TABS.map((tab) => {
          const on = status === tab.key;
          const n = tab.key
            ? (data?.counts[tab.key] ?? 0)
            : Object.values(data?.counts ?? {}).reduce((sum, one) => sum + (one ?? 0), 0);
          return (
            <button
              key={tab.key || "all"}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setParams(tab.key ? { status: tab.key } : {}, { replace: true })}
              className={`flex shrink-0 items-center gap-1.5 rounded-md px-3.5 py-1.5 text-[13px] transition-colors ${
                on ? "bg-white text-slate-900 shadow-[0_1px_3px_rgba(15,23,42,0.12)]" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              {tab.label}
              <span
                className={`inline-grid h-5 min-w-5 shrink-0 place-items-center rounded-full px-1 text-[10px] leading-none font-semibold text-slate-900 tabular-nums ${on ? "bg-slate-100" : "bg-white"}`}
              >
                {count(n)}
              </span>
            </button>
          );
        })}
      </div>
      {!data ? (
        <PageState query={query} what="the returns" />
      ) : data.rows.length === 0 ? (
        // The same words, with the receipt drawn above them (Aryan, 26 Nov).
        <div className="rounded-2xl border border-slate-200 bg-white">
          <EmptyState title="No return here.">
            A return is asked on its order's page. It shows here while Management decides and Dispatch checks the goods
            that come back.
          </EmptyState>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {data.rows.map((row) => (
            <ReturnCard key={row.id} row={row} showOrder />
          ))}
        </div>
      )}
    </div>
  );
}
