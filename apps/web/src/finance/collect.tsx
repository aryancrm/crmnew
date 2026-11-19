// Due payments (Aryan, 18 Nov: "the orders whose money comes later, on a page of their own, each kind
// of terms apart: 30 days, 45 days, cash on delivery"): every order still owing, one tab per terms,
// one row each with Mark paid right there; late first, then due now, then not delivered yet (not
// owed yet). Paid in full, the order is done, counted and moves to Collected. Zoho's open invoices
// from before the switch are a tab of their own: their money is recorded in Books.

import type { CollectedLater, OwedInvoices } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useMe } from "../auth";
import { RecordPaymentDialog } from "./parts";
import { Button, dayLabel, PageHead, PageState, peso } from "../ui";

type Row = OwedInvoices["rows"][number];
/** A tab: one way of paying ("cod", "30 days", "45 days"…), Zoho's open invoices, or Collected. */
type Tab = string;

/** Which tab a row sits in: its terms (Aryan, 18 Nov: "30 days, 45 days, cash on delivery, each
 *  apart"); Zoho's open invoices from before the switch apart. */
const termOf = (row: Row): Tab => (row.invoiceId < 0 ? "zoho" : row.terms === "COD" ? "cod" : row.terms);
const termLabel = (key: Tab) =>
  key === "cod" ? "Cash on delivery" : key === "zoho" ? "From before" : key === "collected" ? "Collected" : key;
/** Cash on delivery first, then the credit terms shortest first, then Advance, then Zoho's. */
const termRank = (key: Tab) =>
  key === "cod" ? 0 : key === "zoho" ? 10_000 : /^\d+/.test(key) ? Number.parseInt(key, 10) : 5_000;
/** Where a row stands: late, due now (delivered), or not delivered yet (not owed yet). */
const stateOf = (row: Row): "late" | "due" | "waiting" =>
  row.state === "late" ? "late" : row.state === "on_delivery" || !row.deliveredOn ? "waiting" : "due";
const STATE_RANK = { late: 0, due: 1, waiting: 2 } as const;

export function CollectPage() {
  const me = useMe();
  const queries = useQueryClient();
  const [params, setParams] = useSearchParams();
  const askedTab = params.get("tab");
  const [q, setQ] = useState("");
  const [paying, setPaying] = useState<Row | null>(null);
  const owed = useQuery({
    queryKey: ["finance", "collect", "owed"],
    queryFn: () => api<OwedInvoices>("/api/finance/owed/invoices"),
  });
  const collected = useQuery({
    queryKey: ["finance", "collect", "collected"],
    queryFn: () => api<CollectedLater>("/api/finance/collected?days=30"),
  });
  const canMark = ["finance", "admin"].includes(me.data?.role ?? "");
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hits = (text: string) => words.every((word) => text.toLowerCase().includes(word));
  const all = owed.data?.rows ?? [];
  const terms = [...new Set(all.map(termOf))].sort((a, b) => termRank(a) - termRank(b));
  const tabs: Tab[] = [...terms, "collected"];
  const tab: Tab = askedTab && tabs.includes(askedTab) ? askedTab : (terms[0] ?? "collected");
  const byTab = (key: Tab) =>
    all
      .filter((row) => termOf(row) === key)
      .sort((a, b) => STATE_RANK[stateOf(a)] - STATE_RANK[stateOf(b)] || b.daysLate - a.daysLate);
  const sum = (rows: Row[]) => rows.reduce((total, row) => total + row.balance, 0);
  const shown = byTab(tab).filter((row) =>
    hits([row.invoiceCode, row.orderCode, row.customer, row.medrep, row.city].filter(Boolean).join(" ")),
  );
  const done = (collected.data?.rows ?? []).filter((row) =>
    hits([row.invoiceCode, row.orderCode, row.customer, row.medrep].join(" ")),
  );
  const pick = (key: Tab) => {
    const next = new URLSearchParams(params);
    next.set("tab", key);
    setParams(next, { replace: true });
  };

  return (
    <div>
      <PageHead
        title="Due payments"
        sub="Every order paid later, by its terms: cash on delivery, 30 days, 45 days… Mark each one paid when the money comes in; paid in full, the order is done and counted."
      />
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {tabs.map((key) => {
          const rows = key === "collected" ? null : byTab(key);
          const late = rows ? rows.filter((row) => stateOf(row) === "late") : [];
          const on = tab === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => pick(key)}
              aria-pressed={on}
              className={`rounded-2xl border px-3.5 py-3 text-left transition ${on ? "border-brand bg-emerald-50/60 ring-2 ring-brand/20" : "border-slate-200 bg-white hover:border-slate-300"}`}
            >
              <div className="text-[12px] font-semibold text-slate-600">{termLabel(key)}</div>
              <div className={`mt-0.5 text-lg font-bold tabular-nums ${key === "collected" ? "text-emerald-700" : "text-slate-900"}`}>
                {rows
                  ? peso(sum(rows))
                  : peso((collected.data?.rows ?? []).reduce((total, row) => total + row.total, 0))}
              </div>
              <div className="text-[11px] text-slate-500">
                {rows ? (
                  <>
                    {rows.length} {rows.length === 1 ? "order" : "orders"}
                    {late.length > 0 && <span className="font-semibold text-rose-700"> · {late.length} late</span>}
                    {key === "zoho" && " · record in Books"}
                  </>
                ) : (
                  `${collected.data?.rows.length ?? 0} paid in the last 30 days`
                )}
              </div>
            </button>
          );
        })}
      </div>

      <div className="relative mb-3 max-w-md">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="Search customer, order, invoice or seller"
          aria-label="Search the payments"
          className="h-10 w-full rounded-[10px] border border-slate-300 bg-white pr-3 pl-9 text-sm focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none"
        />
      </div>

      <PageState query={tab === "collected" ? collected : owed} what="the payments" />

      {tab !== "collected" && owed.data && (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="w-full min-w-[760px] text-[13px]">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                <th className="px-4 py-2">Order</th>
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2">Seller</th>
                <th className="px-3 py-2">Where it stands</th>
                <th className="px-3 py-2">Delivered</th>
                <th className="px-3 py-2">To pay by</th>
                <th className="px-3 py-2 text-right">Still to pay</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((row) => (
                <tr key={row.invoiceId} className="hover:bg-slate-50/70">
                  <td className="px-4 py-2.5">
                    {row.orderId ? (
                      <Link to={`/orders/${row.orderId}`} className="font-semibold text-slate-900 hover:underline">
                        {row.orderCode}
                      </Link>
                    ) : (
                      <span className="font-semibold text-slate-900">{row.orderCode ?? "—"}</span>
                    )}
                    <Link
                      to={row.invoiceId < 0 ? `/books/invoices/${-row.invoiceId}` : `/invoices/${row.invoiceId}`}
                      className="block text-[11px] text-slate-500 hover:underline"
                    >
                      {row.invoiceCode}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5">
                    <Link to={`/customers/${row.customerId}`} className="hover:underline">
                      {row.customer}
                    </Link>
                    {row.city && <span className="block text-[11px] text-slate-500">{row.city}</span>}
                  </td>
                  <td className="px-3 py-2.5 text-slate-700">
                    {row.medrep}
                    {row.team && <span className="block text-[11px] text-slate-500">{row.team}</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    {stateOf(row) === "late" ? (
                      <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700">{row.daysLate}d late</span>
                    ) : stateOf(row) === "due" ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">Due</span>
                    ) : (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">Not delivered yet</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-slate-700">
                    {row.deliveredOn ? dayLabel(row.deliveredOn) : <span className="text-slate-400">Not yet</span>}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    {row.dueOn ? (
                      <>
                        <span className="text-slate-700">{dayLabel(row.dueOn)}</span>
                        {row.state === "late" && (
                          <span className="ml-1.5 rounded-full bg-rose-100 px-1.5 py-0.5 text-[11px] font-semibold text-rose-700">
                            {row.daysLate}d late
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-slate-400">{row.terms === "COD" ? "On delivery" : "After delivery"}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold whitespace-nowrap tabular-nums">
                    {peso(row.balance)}
                    {row.paid > 0 && (
                      <span className="block text-[11px] font-normal text-slate-500">of {peso(row.total)}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {row.invoiceId > 0 && row.orderId && canMark && stateOf(row) === "waiting" && row.terms === "COD" ? (
                      <span className="text-[11px] text-slate-400">After delivery</span>
                    ) : row.invoiceId > 0 && row.orderId && canMark ? (
                      <Button small variant={stateOf(row) === "waiting" ? "plain" : "primary"} onClick={() => setPaying(row)}>
                        Mark paid
                      </Button>
                    ) : row.invoiceId < 0 ? (
                      <span className="text-[11px] text-slate-400">In Books</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-slate-500">
              {q ? "Nothing matches the search." : "Nothing here."}
            </p>
          )}
        </div>
      )}

      {tab === "collected" && collected.data && (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="w-full min-w-[680px] text-[13px]">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                <th className="px-4 py-2">Order</th>
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2">Seller</th>
                <th className="px-3 py-2">Terms</th>
                <th className="px-3 py-2">Paid on</th>
                <th className="px-3 py-2">Marked by</th>
                <th className="px-4 py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {done.map((row) => (
                <tr key={row.invoiceId}>
                  <td className="px-4 py-2.5">
                    <Link to={`/orders/${row.orderId}`} className="font-semibold text-slate-900 hover:underline">
                      {row.orderCode}
                    </Link>
                    <Link to={`/invoices/${row.invoiceId}`} className="block text-[11px] text-slate-500 hover:underline">
                      {row.invoiceCode}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5">{row.customer}</td>
                  <td className="px-3 py-2.5 text-slate-700">{row.medrep}</td>
                  <td className="px-3 py-2.5 text-slate-700">{row.terms}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-slate-700">{dayLabel(row.paidOn)}</td>
                  <td className="px-3 py-2.5 text-slate-700">{row.by}</td>
                  <td className="px-4 py-2.5 text-right font-semibold tabular-nums">
                    {peso(row.total)}
                    <span className="block text-[11px] font-normal text-emerald-700">
                      {row.delivered ? "Done" : "Paid before delivery"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {done.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-slate-500">No later payment came in the last 30 days.</p>
          )}
        </div>
      )}

      {paying && paying.orderId && (
        <RecordPaymentDialog
          invoiceId={paying.invoiceId}
          code={paying.invoiceCode}
          balance={paying.balance}
          orderId={paying.orderId}
          proofs={[]}
          onClose={() => {
            setPaying(null);
            void queries.invalidateQueries({ queryKey: ["finance", "collect"] });
          }}
        />
      )}
    </div>
  );
}
