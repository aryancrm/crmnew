// Collections: money to collect, customer by customer, oldest first. Each line is what the
// hospital owes, its oldest unpaid invoice and that invoice's age, flagged at 60 (amber), 75
// (orange) and 90 days (red: escalate to the coach). A seller sees their own; a coach the team's.

import type { Collections } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { Phone } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useMe } from "../auth";
import { shortPeso } from "../ceo";
import { seatWords } from "../seat-words";
import { CARD, count, dayLabel, PageHead, PageState } from "../ui";

const FLAG: Record<Collections["rows"][number]["flag"], { bar: string; pill: string; word: string }> = {
  ok: { bar: "bg-emerald-500", pill: "bg-emerald-50 text-emerald-800", word: "Under 60 days" },
  d60: { bar: "bg-amber-400", pill: "bg-amber-50 text-amber-800", word: "60 days: call" },
  d75: { bar: "bg-orange-500", pill: "bg-orange-50 text-orange-800", word: "75 days: visit" },
  d90: { bar: "bg-rose-500", pill: "bg-rose-50 text-rose-800", word: "90 days: to the coach" },
};

export function CollectionsPage() {
  const me = useMe().data;
  const words = seatWords(me);
  const query = useQuery({ queryKey: ["my", "collections"], queryFn: () => api<Collections>("/api/my/collections") });
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
        sub={`${shortPeso(data.total)} owed by ${count(data.rows.length)} ${words.customers} · age counted from the oldest unpaid invoice`}
      />
      <section className={`${CARD} mb-4 p-4`}>
        <div className="flex h-3 overflow-hidden rounded-full bg-slate-100">
          {data.buckets
            .filter((one) => one.amount > 0)
            .map((one) => (
              <span key={one.key} className={FLAG[one.key].bar} style={{ width: `${(one.amount / Math.max(1, data.total)) * 100}%` }} />
            ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {data.buckets.map((one) => (
            <div key={one.key}>
              <div className="flex items-center gap-1.5 text-[11.5px] text-slate-500">
                <span className={`size-2 rounded-full ${FLAG[one.key].bar}`} /> {one.label}
              </div>
              <div className="text-[15px] font-bold text-slate-900 tabular-nums">{shortPeso(one.amount)}</div>
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
                <td colSpan={4} className="px-4 py-6 text-center text-slate-500">
                  Nothing owed. Every invoice is paid.
                </td>
              </tr>
            )}
            {data.rows.map((row) => (
              <tr key={row.customerId} className="hover:bg-slate-50/60">
                <td className="px-4 py-2.5">
                  <Link to={`/customers/${row.customerId}`} className="font-semibold text-slate-900 hover:underline">
                    {row.customer}
                  </Link>
                  <div className="flex flex-wrap items-center gap-x-2 text-[11.5px] text-slate-500">
                    {data.scope !== "My customers" && row.seller && <span>{row.seller}</span>}
                    {row.phone && row.phone.replace(/\D/g, "").length >= 7 && (
                      <a href={`tel:${row.phone.replace(/\s/g, "")}`} className="inline-flex items-center gap-1 text-emerald-700 hover:underline">
                        <Phone className="size-3" /> {row.phone}
                      </a>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2.5 text-right font-semibold text-slate-900 tabular-nums">
                  {shortPeso(row.owed)}
                  <div className="text-[11.5px] font-normal text-slate-400">
                    {row.invoices} invoice{row.invoices === 1 ? "" : "s"}
                  </div>
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  <Link to={`/orders/${row.oldestOrderId}`} className="text-slate-700 hover:underline">
                    {row.oldestCode}
                  </Link>
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
      </div>
    </div>
  );
}
