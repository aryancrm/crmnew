// Payments to collect (Aryan, 18 Nov: "the orders whose money comes later: who marks it? Finance,
// on a page of its own"): every cash-on-delivery and credit order still owing, one row each, with
// a Mark paid button right there. Paid in full, the order is done and counted as collected, and it
// moves to Collected. Late first, then due now, then not delivered yet (not owed yet). Zoho's open
// invoices from before the switch are listed apart: their money is recorded in Books.

import type { CollectedLater, OwedInvoices } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useMe } from "../auth";
import { RecordPaymentDialog } from "../finance/parts";
import { Button, dayLabel, PageHead, PageState, peso } from "../ui";

type Row = OwedInvoices["rows"][number];
type Tab = "late" | "due" | "waiting" | "collected" | "zoho";

const TABS: { key: Tab; label: string; tone: string; note: string }[] = [
  { key: "late", label: "Late", tone: "text-rose-700", note: "Past the day they were to pay" },
  { key: "due", label: "Due now", tone: "text-amber-700", note: "Delivered: the money is due" },
  {
    key: "waiting",
    label: "Not delivered yet",
    tone: "text-slate-700",
    note: "Owed once it is delivered",
  },
  { key: "collected", label: "Collected", tone: "text-emerald-700", note: "Paid in full, last 30 days" },
  { key: "zoho", label: "From Zoho", tone: "text-slate-500", note: "Before the switch: record in Books" },
];

const tabOf = (row: Row): Tab =>
  row.invoiceId < 0
    ? "zoho"
    : row.state === "late"
      ? "late"
      : row.state === "on_delivery" || !row.deliveredOn
        ? "waiting"
        : "due";

export function CollectPage() {
  const me = useMe();
  const queries = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab | null) ?? "late";
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
  const byTab = (key: Tab) => all.filter((row) => tabOf(row) === key);
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
        title="Payments to collect"
        sub="Cash on delivery and credit orders: mark each one paid when the money comes in. Paid in full, the order is done and counted."
      />
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {TABS.map((item) => {
          const rows = item.key === "collected" ? null : byTab(item.key);
          const on = tab === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => pick(item.key)}
              aria-pressed={on}
              className={`rounded-2xl border px-3.5 py-3 text-left transition ${on ? "border-brand bg-emerald-50/60 ring-2 ring-brand/20" : "border-slate-200 bg-white hover:border-slate-300"}`}
            >
              <div className="text-[12px] font-semibold text-slate-600">{item.label}</div>
              <div className={`mt-0.5 text-lg font-bold tabular-nums ${item.tone}`}>
                {rows
                  ? peso(sum(rows))
                  : peso((collected.data?.rows ?? []).reduce((total, row) => total + row.total, 0))}
              </div>
              <div className="text-[11px] text-slate-500">
                {rows ? `${rows.length} ${rows.length === 1 ? "order" : "orders"}` : `${collected.data?.rows.length ?? 0} paid`}{" "}
                · {item.note}
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
                <th className="px-3 py-2">Terms</th>
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
                  <td className="px-3 py-2.5 text-slate-700">{row.terms}</td>
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
                    {row.invoiceId > 0 && row.orderId && canMark ? (
                      <Button small variant={tab === "waiting" ? "plain" : "primary"} onClick={() => setPaying(row)}>
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
