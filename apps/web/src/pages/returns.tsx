// Every return, by where it stands: waiting for Management, waiting for Dispatch's check, done.
// Each desk does its part on the card itself; a MedRep sees the returns of their own orders.

import type { ReturnList, ReturnRow } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { ReturnCard } from "../orders/returns";
import { count, PageHead, PageState } from "../ui";

const TABS: { key: "" | ReturnRow["status"]; label: string }[] = [
  { key: "", label: "All" },
  { key: "requested", label: "Waiting for Management" },
  { key: "approved", label: "Goods to check" },
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
      <PageHead title="Returns" sub="Goods that come back after delivery" />
      <div className="mb-4 flex flex-wrap gap-1">
        {TABS.map((tab) => {
          const on = status === tab.key;
          const n = tab.key
            ? (data?.counts[tab.key] ?? 0)
            : Object.values(data?.counts ?? {}).reduce((sum, one) => sum + (one ?? 0), 0);
          return (
            <button
              key={tab.key || "all"}
              type="button"
              onClick={() => setParams(tab.key ? { status: tab.key } : {}, { replace: true })}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${on ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-100"}`}
            >
              {tab.label} <span className="ml-1 tabular-nums opacity-80">{count(n)}</span>
            </button>
          );
        })}
      </div>
      {!data ? (
        <PageState query={query} what="the returns" />
      ) : data.rows.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-500">
          No return here.
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
