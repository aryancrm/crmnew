// Collections: money to collect, customer by customer, oldest first. Each line is what the
// hospital owes, its oldest unpaid invoice and that invoice's age, flagged at 60 (amber), 75
// (orange) and 90 days (red: escalate to the coach). A seller sees their own; a coach the team's.

import type { Collections } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { Phone } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { TeamSwitch, useTeamUnit, withUnit } from "../team/switch";
import { useMe } from "../auth";
import { exactPeso, shortPeso } from "../ceo";
import { seatWords } from "../seat-words";
import { CARD, count, dayLabel, PageHead, PageState, useOpenOnPress } from "../ui";
import { EmptyState } from "../no-results";

/** The desks that open the books (Zoho's documents). */
const BOOK_READERS = ["inventory", "management", "finance", "ceo", "admin"];

const FLAG: Record<Collections["rows"][number]["flag"], { bar: string; pill: string; word: string }> = {
  ok: { bar: "bg-emerald-500", pill: "bg-emerald-50 text-emerald-800", word: "Under 60 days" },
  d60: { bar: "bg-amber-400", pill: "bg-amber-50 text-amber-800", word: "60 days: call" },
  d75: { bar: "bg-orange-500", pill: "bg-orange-50 text-orange-800", word: "75 days: visit" },
  d90: { bar: "bg-rose-500", pill: "bg-rose-50 text-rose-800", word: "90 days: to the coach" },
};

export function CollectionsPage() {
  const me = useMe().data;
  const words = seatWords(me);
  const unit = useTeamUnit();
  // The oldest 300 listed; every one on "Show all". The total and the boxes always count them all
  // (Aryan, 28 Nov: "Yes, fix it", PLAN 267). "Show all" is kept in the address (?all=1, beside the
  // team switch's unit), so coming back from a customer keeps the whole list.
  const [params, setParams] = useSearchParams();
  const all = params.get("all") === "1";
  const showAll = () => {
    const next = new URLSearchParams(params);
    next.set("all", "1");
    setParams(next, { replace: true });
  };
  // A press anywhere on a customer's row opens the customer, not only the name (28 Nov, PLAN 271).
  const open = useOpenOnPress();
  const query = useQuery({
    queryKey: ["my", "collections", unit, all],
    queryFn: () => api<Collections>(withUnit(`/api/my/collections${all ? "?all=1" : ""}`, unit)),
    placeholderData: (previous) => previous,
  });
  const data = query.data;
  if (!data) return <PageState query={query} what="the money to collect" />;
  return (
    <div className="mx-auto max-w-5xl">
      <PageHead
        title="Collections"
        tags={
          <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[12px] font-semibold text-emerald-800 ring-1 ring-emerald-200">
            {data.scope === "My customers" ? words.myCustomers : data.scope}
          </span>
        }
        sub={
          // Each figure shows its exact pesos on hover.
          <>
            <span title={exactPeso(data.total)}>{shortPeso(data.total)}</span>
            {` owed by ${count(data.customers)} customer${data.customers === 1 ? "" : "s"} · `}
            <span title={exactPeso(data.pastDue)}>{shortPeso(data.pastDue)}</span>
            {" past due · age counted from the oldest unpaid invoice"}
          </>
        }
      />
      <div className="mb-4">
        <TeamSwitch />
      </div>
      {/* Bigger, no shadow, a lighter line (Aryan, 27 Nov); the amounts as the dashboards' numbers. */}
      <section className="mb-4 rounded-2xl border border-slate-200/60 bg-white p-5">
        <div className="flex h-3 overflow-hidden rounded-full bg-slate-100">
          {data.buckets
            .filter((one) => one.amount > 0)
            .map((one) => (
              <span key={one.key} className={FLAG[one.key].bar} style={{ width: `${(one.amount / Math.max(1, data.total)) * 100}%` }} />
            ))}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {data.buckets.map((one) => (
            <div key={one.key}>
              <div className="flex items-center gap-1.5 text-[13px] text-slate-500">
                <span className={`size-2 rounded-full ${FLAG[one.key].bar}`} /> {one.label}
              </div>
              <div className="mt-1 text-[28px] leading-tight font-medium tracking-tight text-slate-900 tabular-nums" title={exactPeso(one.amount)}>
                {shortPeso(one.amount)}
              </div>
            </div>
          ))}
        </div>
      </section>
      <div className={`${CARD} overflow-x-auto`}>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
              <th className="px-4 py-2.5">Customer</th>
              <th className="px-3 py-2.5 text-right">Owes</th>
              <th className="px-3 py-2.5">Oldest unpaid</th>
              <th className="px-4 py-2.5">Age</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.rows.length === 0 && (
              <tr>
                <td colSpan={4}>
                  <EmptyState title="Nothing owed.">Every invoice is paid.</EmptyState>
                </td>
              </tr>
            )}
            {data.rows.map((row) => (
              <tr key={row.customerId} onClick={open(`/customers/${row.customerId}`)} className="cursor-pointer hover:bg-slate-50/60">
                <td className="px-4 py-2.5">
                  <Link to={`/customers/${row.customerId}`} className="font-semibold text-slate-900 hover:underline">
                    {row.customer}
                  </Link>
                  <div className="flex flex-wrap items-center gap-x-2 text-[11.5px] text-slate-500">
                    {/* The HQ it was sold from, then who sold it (Aryan's phase 5, PLAN 266). */}
                    {data.scope !== "My customers" && (row.hq || row.seller) && (
                      <span>
                        {row.hq && <b className="font-semibold text-slate-700">{row.hq}</b>}
                        {row.hq && row.seller ? " · " : ""}
                        {row.seller}
                      </span>
                    )}
                    {row.phone && row.phone.replace(/\D/g, "").length >= 7 && (
                      <a href={`tel:${row.phone.replace(/\s/g, "")}`} className="inline-flex items-center gap-1 text-emerald-700 hover:underline">
                        <Phone className="size-3" /> {row.phone}
                      </a>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2.5 text-right font-semibold text-slate-900 tabular-nums">
                  <span title={exactPeso(row.owed)}>{shortPeso(row.owed)}</span>
                  <div className="text-[11.5px] font-normal text-slate-400">
                    {row.invoices} invoice{row.invoices === 1 ? "" : "s"}
                  </div>
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  {/* An invoice from Zoho opens in the books, for the desks that read them. */}
                  {row.oldestHref.startsWith("/books") && !BOOK_READERS.includes(me?.role ?? "") ? (
                    <span className="text-slate-700">{row.oldestCode}</span>
                  ) : (
                    <Link to={row.oldestHref} className="text-slate-700 hover:underline">
                      {row.oldestCode}
                    </Link>
                  )}
                  {row.oldestHref.startsWith("/books") && <span className="ml-1 rounded bg-slate-100 px-1 text-[10.5px] text-slate-500">Earlier</span>}
                  <div className="text-[11.5px] text-slate-400">
                    {dayLabel(row.oldestOn)}
                    {row.daysLate > 0 ? ` · ${row.daysLate} days past due` : ""}
                  </div>
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap">
                  <span className="font-semibold text-slate-900 tabular-nums">{row.age} days</span>
                  <div>
                    <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${FLAG[row.flag].pill}`}>{FLAG[row.flag].word}</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.rows.length < data.customers && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-3 text-[12.5px] text-slate-500">
            <span>
              The {count(data.rows.length)} oldest of {count(data.customers)} are listed; the total and the boxes above count every one.
            </span>
            <button type="button" onClick={showAll} disabled={query.isFetching} className="font-semibold text-emerald-700 hover:underline disabled:opacity-50">
              {query.isFetching ? "Reading…" : `Show all ${count(data.customers)}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
